import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRadio, recentRadioSeeds, seedFromResult, songKey, validateRadioInput, fetchRelatedArtists, collaborationArtists } from '../lib/radio.js';

const seed = { id: 'seed', videoId: 'seed', title: 'Seed song', artist: 'Artist A', lastPlayedAt: '2026-10-18T12:00:00.000Z' };
const tick = () => new Promise(resolve => setImmediate(resolve));
const candidate = (videoId, title = 'Artist A - New song', duration = 200) => ({ videoId, title, channel: 'Artist A - Topic', duration });

test('recent listening balances recency, repetition and artist diversity', () => {
  const tracks = [seed, { id: 'b', title: 'B', artist: 'Artist B' }, { id: 'a2', artist: 'Artist A' }, { id: 'c', artist: 'Artist C' }];
  const history = [
    { trackId: 'seed', playedAt: '2026-10-18T12:00:00Z' },
    { trackId: 'a2', playedAt: '2026-10-18T11:00:00Z' },
    { trackId: 'b', playedAt: '2026-10-17T12:00:00Z' },
    { trackId: 'b', playedAt: '2026-10-17T12:00:00Z' },
    { trackId: 'missing', playedAt: '2026-10-18T12:00:00Z' },
    { trackId: 'c', playedAt: '2025-10-18T12:00:00Z' }
  ];
  assert.deepEqual(recentRadioSeeds(tracks, history, Date.parse('2026-10-18T12:00:00Z')).map(t => t.id), ['seed', 'b', 'c']);
  assert.deepEqual(recentRadioSeeds([seed]).map(t => t.id), ['seed']);
  assert.deepEqual(recentRadioSeeds([{ id: 'unheard', plays: 30 }]), []);
});

test('title parsing rejects reuploads of the seed or previously downloaded song', () => {
  assert.equal(songKey(seed), songKey(candidate('copy', 'Artist A - Seed song (Official Audio)')));
  assert.equal(songKey(candidate('a', 'Artist A - New song [Lyrics]')), songKey(candidate('b', 'Artist A - New song (Official Video)')));
  assert.deepEqual(seedFromResult(candidate('x', 'Artist A - Seed song (Official Music Video)')), { id: 'x', videoId: 'x', title: 'Seed song', artist: 'Artist A', thumbnail: '' });
});

test('real Shooter duplicates share song identity across subject annotations and metadata pipes', async () => {
  const concise = { videoId: 'oX6BGYlh6eg', title: 'Vínculos', channel: 'Shooter_sz', duration: 200 };
  const annotated = { videoId: '-R6_x1YkN4E', title: 'Shooter - Vínculos (Frieren)', channel: 'Shooter_sz', duration: 200 };
  const piped = { videoId: 'anothercopy', title: 'Vínculos | Shooter | Frieren', channel: 'Shooter_sz', duration: 200 };
  const artistFirst = { videoId: 'artistfirst', title: 'Shooter | Vínculos | Frieren', channel: 'Shooter_sz', duration: 200 };
  assert.equal(songKey(concise), songKey(annotated));
  assert.equal(songKey(concise), songKey(piped));
  assert.equal(songKey(concise), songKey(artistFirst));
  assert.equal(songKey(concise), songKey({ artist: 'Shooter_sz', title: 'Vínculos (Frieren)' }));
  assert.notEqual(songKey(concise), songKey({ artist: 'Another Artist', title: 'Vínculos' }));

  const events = [];
  const result = await runRadio({ seedId: 'seed' }, {
    tracks: [{ id: 'seed', title: 'Abismo', artist: 'Shooter_sz' }], relatedArtists: async () => [],
    search: async () => [annotated, concise, piped, artistFirst],
    onEvent: (event, data) => events.push({ event, data })
  });
  const items = events.filter(event => event.event === 'results').flatMap(event => event.data.items);
  assert.equal(result.total, 1);
  assert.equal(items[0].videoId, annotated.videoId);
  assert.equal(items[0].title, 'Shooter - Vínculos (Frieren)', 'the original display title is retained');
});

test('live results stream before all searches finish and exclude duplicates, library and shown videos', async () => {
  const pending = new Map();
  const events = [];
  const run = runRadio({ seedId: 'seed', excludeIds: ['shown'], limit: 9 }, {
    tracks: [seed, { id: 'existing', videoId: 'existing', artist: 'Other', title: 'Old song' }],
    search: query => new Promise(resolve => pending.set(query, resolve)),
    relatedArtists: async () => ['Artist B', 'Artist C'],
    onEvent: (event, data) => events.push({ event, data })
  });
  await tick();
  assert.equal(pending.size, 3);
  pending.get('Artist A official audio music')([
    candidate('seed'), candidate('copy', 'Artist A - Seed song (Official Audio)'), candidate('existing'), candidate('shown'),
    candidate('new'), candidate('copy-new', 'Artist A - New song [Lyrics]'), candidate('long', 'Artist A - Full album', 2000)
  ]);
  await tick();
  assert.equal(events.filter(e => e.event === 'results').length, 1);
  assert.equal(events.some(e => e.event === 'done'), false);
  pending.get('Artist B official audio music')([candidate('new'), candidate('b', 'Artist B - Another song')]);
  pending.get('Artist C official audio music')([]);
  const result = await run;
  const items = events.filter(e => e.event === 'results').flatMap(e => e.data.items);
  assert.deepEqual(items.map(t => t.videoId), ['new', 'b']);
  assert.equal(items[1].recommendationType, 'related-artist');
  assert.equal(items[1].sourceArtist, 'Artist B');
  assert.equal(result.total, 2);
  assert.equal(result.partial, false);
  assert.equal(events.at(-1).event, 'done');
});

test('fresh invocation searches again and query resolves into a seed', async () => {
  const calls = [];
  const events = [];
  const dependencies = {
    search: async query => {
      calls.push(query);
      return query === 'my reference' ? [candidate('ref', 'Artist B - My reference')] : [candidate('new', 'Artist B - Another song')];
    },
    relatedArtists: async () => [],
    onEvent: (event, data) => events.push({ event, data })
  };
  await runRadio({ query: 'my reference' }, dependencies);
  await runRadio({ query: 'my reference', excludeIds: ['new'] }, dependencies);
  assert.deepEqual(calls, ['my reference', 'Artist B official audio music', 'my reference', 'Artist B official audio music']);
  assert.equal(events[0].data.mode, 'query');
  assert.equal(events[0].data.query, 'my reference');
  assert.equal(events.find(e => e.event === 'status' && e.data.seeds).data.seeds[0].title, 'My reference');
  assert.equal(events.at(-1).data.total, 0);
});

test('failure of related artist lookup preserves real primary results', async () => {
  const events = [];
  const result = await runRadio({ seedId: 'seed' }, {
    tracks: [seed], search: async () => [candidate('new')],
    relatedArtists: async () => { throw new Error('network down'); },
    onEvent: (event, data) => events.push({ event, data })
  });
  assert.equal(result.total, 1);
  assert.equal(result.partial, true);
  assert.equal(events.some(e => e.event === 'error'), false);
  assert.equal(result.warnings.length, 1);
});

test('failed sources return no invented fallback recommendations', async () => {
  const events = [];
  const result = await runRadio({ seedId: 'seed' }, {
    tracks: [seed], search: async () => { throw new Error('YouTube down'); }, relatedArtists: async () => [],
    onEvent: (event, data) => events.push({ event, data })
  });
  assert.equal(result.total, 0);
  assert.equal(result.partial, true);
  assert.equal(events.some(e => e.event === 'results'), false);
});

test('no history asks for a reference without performing an arbitrary search', async () => {
  const events = [];
  await runRadio({}, { search: () => { throw new Error('must not search'); }, onEvent: (event, data) => events.push({ event, data }) });
  assert.match(events.find(e => e.event === 'error').data.message, /Ouça uma faixa/);
  assert.equal(events.at(-1).event, 'done');
});

test('cancellation aborts inflight work and does not emit further events', async () => {
  const controller = new AbortController();
  const events = [];
  let searchSignal;
  const running = runRadio({ seedId: 'seed' }, {
    tracks: [seed], signal: controller.signal,
    search: (query, count, { signal }) => { searchSignal = signal; return new Promise(() => {}); },
    relatedArtists: async () => [], onEvent: (event, data) => events.push({ event, data })
  });
  await tick();
  const before = events.length;
  controller.abort();
  await running;
  assert.equal(searchSignal.aborted, true);
  assert.equal(events.length, before);
});

test('limit is enforced and cancels unnecessary searches', async () => {
  const signals = [];
  const result = await runRadio({ seedId: 'seed', limit: 1 }, {
    tracks: [seed], relatedArtists: async () => ['Artist B'],
    search: async (query, count, { signal }) => { signals.push(signal); return [candidate('a'), candidate('b', 'Artist A - Other song')]; }
  });
  assert.equal(result.total, 1);
  assert.equal(result.partial, false);
  assert.equal(signals[0].aborted, true);
});

test('request validation bounds work and rejects conflicting references', () => {
  assert.equal(validateRadioInput({ limit: 9999 }).limit, 30);
  assert.equal(validateRadioInput({ limit: -1 }).limit, 1);
  assert.throws(() => validateRadioInput({ seedId: 'seed', query: 'artist' }), /Escolha uma faixa/);
  assert.throws(() => validateRadioInput(null), /objeto JSON/);
});

test('related artist lookup uses the returned artist id and handles HTTP failure', async () => {
  const urls = [];
  const result = await fetchRelatedArtists('Artist A', { fetchImpl: async url => {
    urls.push(url);
    return { ok: true, json: async () => urls.length === 1 ? { data: [{ id: 123, name: 'Artist A' }] } : { data: [{ name: 'Artist B' }] } };
  } });
  assert.deepEqual(result, ['Artist B']);
  assert.match(urls[1], /artist\/123\/related/);
  await assert.rejects(fetchRelatedArtists('Artist A', { fetchImpl: async () => ({ ok: false }) }), /indisponível/);
});

test('niche artist aliases retain their channel identity and reject fuzzy catalog matches', async () => {
  const parsed = seedFromResult({ videoId: 'seed', title: 'Shooter - Abismo (Subaru)', channel: 'Shooter_sz' });
  assert.equal(parsed.artist, 'Shooter_sz');
  let requests = 0;
  assert.deepEqual(await fetchRelatedArtists('Shooter_sz', { fetchImpl: async () => {
    requests++;
    return { ok: true, json: async () => ({ data: [{ id: 1, name: 'Shooter' }] }) };
  } }), []);
  assert.equal(requests, 1);
  const events = [];
  await runRadio({ seedId: 'seed' }, {
    tracks: [parsed], relatedArtists: async () => [],
    search: async () => [
      { videoId: 'good', title: 'Shooter - Refém (Itadori)', channel: 'Shooter_sz', duration: 180 },
      { videoId: 'bad', title: 'JayDaYoungan "Shooters" (Official Audio)', channel: 'JayDaYoungan', duration: 180 }
    ], onEvent: (event, data) => events.push({ event, data })
  });
  assert.deepEqual(events.filter(e => e.event === 'results').flatMap(e => e.data.items).map(item => item.videoId), ['good']);
});

test('explicit collaborators yield additional live searches with an accurate reason', async () => {
  assert.deepEqual(collaborationArtists('Song Ft. @Hyatogami and @Hyatogami'), ['Hyatogami']);
  const calls = [];
  const events = [];
  await runRadio({ seedId: 'seed', limit: 8 }, {
    tracks: [seed], relatedArtists: async () => [],
    search: async query => {
      calls.push(query);
      return query.startsWith('Artist A') ? [candidate('collab', 'Artist A - My Song Ft. @SingerB')] : [{ videoId: 'other', title: 'SingerB - Their Song', channel: 'SingerB', duration: 180 }];
    }, onEvent: (event, data) => events.push({ event, data })
  });
  assert.deepEqual(calls, ['Artist A official audio music', 'SingerB official audio music']);
  const items = events.filter(e => e.event === 'results').flatMap(e => e.data.items);
  assert.equal(items[1].recommendationType, 'collaboration');
  assert.match(items[1].because, /participa com Artist A/);
});

test('playback persists a bounded timestamp history and play count without losing metadata', async () => {
  const originalCwd = process.cwd();
  const fixtureParent = fileURLToPath(new URL('.', import.meta.url));
  const fixture = await mkdtemp(path.join(fixtureParent, 'acervo-radio-test-'));
  try {
    await mkdir(path.join(fixture, 'data'));
    await writeFile(path.join(fixture, 'data', 'library.json'), JSON.stringify({ version: 1, custom: 'preserved', tracks: [{ ...seed, plays: 7 }] }));
    process.chdir(fixture);
    const libraryPath = new URL('../lib/library.js?radio-test', import.meta.url);
    const library = await import(libraryPath.href);
    await library.recordPlay(seed.id, '2026-10-18T13:00:00Z');
    const saved = JSON.parse(await readFile(path.join(fixture, 'data', 'library.json'), 'utf8'));
    assert.equal(saved.tracks[0].plays, 8);
    assert.equal(saved.tracks[0].lastPlayedAt, '2026-10-18T13:00:00Z');
    assert.deepEqual(saved.listeningHistory, [{ trackId: seed.id, playedAt: '2026-10-18T13:00:00Z' }]);
    assert.equal(saved.custom, 'preserved');
    assert.equal(await library.recordPlay('missing'), null);
    const loaded = await library.load();
    loaded.listeningHistory = Array.from({ length: 200 }, () => ({ trackId: seed.id, playedAt: '2026-10-17T00:00:00Z' }));
    await library.recordPlay(seed.id);
    assert.equal((await library.history()).length, 200);
  } finally {
    process.chdir(originalCwd);
    const resolved = path.resolve(fixture);
    if (path.dirname(resolved) !== path.resolve(fixtureParent) || !path.basename(resolved).startsWith('acervo-radio-test-')) throw new Error('Unsafe fixture cleanup');
    await rm(resolved, { recursive: true, force: true });
  }
});
