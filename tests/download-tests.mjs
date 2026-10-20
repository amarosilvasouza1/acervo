import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { downloadAudio } from '../lib/yt.js';
import { createPlaylistImports } from '../lib/playlist-imports.js';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { validateImportInput, parseYouTubeVideoId } from '../lib/input-policy.js';
import { resolveTrackMetadata } from '../lib/track-metadata.js';

test('one extraction supplies audio and metadata; partial files are never accepted as audio', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'acervo-download-fixture-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const result = await downloadAudio('abcdefghijk', directory, null, { run: async args => {
    calls++;
    assert.ok(args.includes('--write-info-json'));
    assert.deepEqual(args.slice(args.indexOf('--concurrent-fragments'), args.indexOf('--concurrent-fragments') + 2), ['--concurrent-fragments', '4']);
    const target = args[args.indexOf('-o') + 1];
    await fs.writeFile(target.replace('%(ext)s', 'info.json'), JSON.stringify({ title: 'Real title', artist: 'Artist' }));
    await fs.writeFile(target.replace('%(ext)s', 'm4a.part'), 'partial');
    await fs.writeFile(target.replace('%(ext)s', 'm4a'), 'audio-fixture');
  } });
  assert.equal(calls, 1);
  assert.equal(result.info.title, 'Real title');
  assert.equal(await fs.readFile(result.file, 'utf8'), 'audio-fixture');
});

test('missing media and incomplete extractor output retry and then report failure', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'acervo-download-fixture-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let attempts = 0;
  await assert.rejects(downloadAudio('abcdefghijk', directory, null, { run: async args => {
    attempts++;
    const target = args[args.indexOf('-o') + 1];
    await fs.writeFile(target.replace('%(ext)s', 'm4a.part'), 'incomplete');
  } }), /completo/);
  assert.equal(attempts, 4);
});

test('playlist import fills two audio slots and continues after one failure without duplicating entries', async () => {
  const entries = ['abcdefghijk', 'lmnopqrstuv', '12345678901'].map((videoId, index) => ({ id: String(index), videoId, title: 'Song ' + index, artist: 'Artist', status: 'pending' }));
  const playlist = { id: 'playlist', provider: 'youtube', entries };
  const tracks = [], jobs = new Map(), waiters = new Map(), started = [];
  const store = { all: async () => [playlist], get: async () => playlist,
    updateEntry: async (_id, entryId, patch) => Object.assign(entries.find(entry => entry.id === entryId), patch) };
  const imports = createPlaylistImports({ store, getTracks: async () => tracks, concurrency: 2,
    enqueue: input => { const job = { id: input.videoId, status: 'queued' }; jobs.set(job.id, job); started.push(job.id); return job; },
    waitForJob: job => new Promise(resolve => waiters.set(job.id, resolve)), getJob: id => jobs.get(id) });
  const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
  await Promise.all([imports.start('playlist'), imports.start('playlist')]); await flush();
  assert.equal(started.length, 2);
  assert.equal(entries[2].status, 'queued');
  jobs.get(started[0]).status = 'error'; waiters.get(started[0])({ status: 'error', error: 'Source unavailable' }); await flush();
  assert.equal(started.length, 3); assert.equal(entries[0].status, 'error');
  assert.equal(new Set(started).size, 3);
  for (const id of started.slice(1)) {
    tracks.push({ id, videoId: id }); jobs.get(id).status = 'done'; waiters.get(id)({ status: 'done', trackId: id });
  }
  await flush();
  const report = await imports.report('playlist');
  assert.equal(report.summary.done, 2); assert.equal(report.summary.failed, 1);
  assert.equal(report.entries[0].reason, 'Source unavailable');
});

test('the shipped server shares duplicate imports and a resolved search cannot deadlock behind its queued copy', async () => {
  const source = await fs.readFile(new URL('../server.js', import.meta.url), 'utf8');
  const workers = source.slice(source.indexOf('function bumpJob('), source.indexOf('async function removeDir('));
  const jobs = new Map(), tracks = new Map(), downloads = [], releases = new Map();
  const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
  const firstSearch = deferred(), secondSearch = deferred();
  const context = vm.createContext({ jobs, jobWaiters: new Map(), queue: [], activeByVideo: new Map(), activeDownloads: 0, DOWNLOAD_CONCURRENCY: 2,
    crypto, path, Date, Math, Number, String, Boolean, Object, Map, Promise, console, TMP: 'fixture-temp', TRACKS: 'fixture-tracks',
    validateImportInput, parseVideoId: parseYouTubeVideoId, validVideoId: value => /^[A-Za-z0-9_-]{11}$/.test(value), resolveTrackMetadata,
    Library: { findByVideo: async id => tracks.get(id), add: async track => tracks.set(track.id, track) },
    searchYouTube: query => query === 'first' ? firstSearch.promise : secondSearch.promise,
    downloadAudio: async id => { downloads.push(id); const gate = deferred(); releases.set(id, gate); await gate.promise; return { file: 'fixture', info: { title: 'Song', artist: 'Artist', duration: 10 } }; },
    pickThumb: () => null, mkdir: async () => {}, removeDir: async () => {}, fetchCover: async () => null,
    measureLoudness: async () => ({}), normalizeTo: async () => ({}), extractFeatures: async () => ({}), probe: async () => ({ duration: 10, bitrate: 128000 }),
    connect: { publishLibraryChange() {} } });
  vm.runInContext(workers, context);
  const flush = async () => { for (let i = 0; i < 120; i++) await Promise.resolve(); };
  const a = context.enqueueImport({ query: 'first' });
  const b = context.enqueueImport({ query: 'second' });
  const queued = context.enqueueImport({ videoId: 'abcdefghijk' });
  assert.equal(context.enqueueImport({ videoId: 'abcdefghijk' }).id, queued.id);
  firstSearch.resolve([{ videoId: 'abcdefghijk', title: 'Song' }]);
  secondSearch.resolve([{ videoId: 'abcdefghijk', title: 'Song' }]);
  await flush();
  assert.deepEqual(downloads, ['abcdefghijk']);
  releases.get('abcdefghijk').resolve(); await flush();
  for (const job of [a, b, queued]) { assert.equal(job.status, 'done'); assert.equal(job.trackId, 'abcdefghijk'); }
  assert.equal(tracks.size, 1); assert.equal(context.activeDownloads, 0); assert.equal(context.queue.length, 0);
});
