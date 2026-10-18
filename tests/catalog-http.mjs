import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// All requests stay on loopback. A child-process preload rejects every external fetch.
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'acervo-catalog-http-'));
const dataDirectory = path.join(directory, 'data');
const serverFile = fileURLToPath(new URL('../server.js', import.meta.url));
const publicOrigin = 'https://catalog-http.acervo.test';
const publicHost = new URL(publicOrigin).host;
const password = 'isolated catalog HTTP owner password';
const noNetworkFile = path.join(directory, 'no-external-network.mjs');
let child = null; let childClosed = null; let output = ''; const allOutput = [];
const port = await availablePort();
const tracks = [
  { id: 'new-download-unplayed', videoId: 'not-listened', title: 'Unplayed newest download', artist: 'Unplayed artist', duration: 180, addedAt: '2030-01-01T00:00:00Z', plays: 0 },
  { id: 'history-second', videoId: 'real-second', title: 'Second recent', artist: 'Shiny_sz', duration: 220, addedAt: '2026-10-17T00:00:00Z', lastPlayedAt: '2026-10-18T10:00:00Z', plays: 5 },
  { id: 'history-first', videoId: 'real-first', title: 'First recent', artist: 'Shooter_sz', duration: 240, addedAt: '2024-01-01T00:00:00Z', lastPlayedAt: '2026-10-17T10:00:00Z', plays: 2 },
  { id: 'timestamp-fallback', videoId: 'real-fallback', title: 'Older listened', artist: 'Ark King', duration: 200, addedAt: '2026-10-17T00:00:00Z', lastPlayedAt: '2026-10-15T10:00:00Z', plays: 1 }
];
const history = [
  { trackId: 'history-second', playedAt: '2026-10-17T15:00:00Z' },
  { trackId: 'deleted-track', playedAt: '2026-10-19T15:00:00Z' },
  { trackId: 'history-first', playedAt: '2026-10-18T15:00:00Z' },
  { trackId: 'history-first', playedAt: '2026-10-16T15:00:00Z' }
];

async function availablePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const value = probe.address().port; await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve())); return value;
}

function json(pathname, { method = 'GET', cookie, body, headers = {} } = {}) {
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, method, path: pathname, agent: false, headers: {
      Host: publicHost, ...(method !== 'GET' ? { Origin: publicOrigin } : {}), ...(cookie ? { Cookie: cookie } : {}),
      ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}), ...headers
    } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.once('error', reject);
      res.once('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch (error) { reject(error); }
      });
    });
    req.setTimeout(4000, () => req.destroy(new Error('Catalog HTTP fixture timed out: ' + pathname))); req.once('error', reject); req.end(payload);
  });
}

async function start() {
  output = '';
  child = spawn(process.execPath, ['--import', pathToFileURL(noNetworkFile).href, serverFile], { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...process.env, PORT: String(port), ACERVO_HOST: '127.0.0.1', ACERVO_MODE: 'cloud', ACERVO_PUBLIC_ORIGIN: publicOrigin,
    ACERVO_ADMIN_PASSWORD: password, ACERVO_DATA_DIR: dataDirectory
  } });
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  childClosed = new Promise(resolve => child.once('close', resolve));
  let ready = false;
  for (let index = 0; index < 50; index++) {
    if (child.exitCode !== null) throw new Error(output || 'Catalog fixture server exited');
    try { ready = (await json('/healthz')).status === 200; } catch {}
    if (ready) break; await new Promise(resolve => setTimeout(resolve, 60));
  }
  assert.equal(ready, true, output || 'Catalog fixture server starts');
}

async function stop() {
  if (!child) return;
  child.kill(); await childClosed; allOutput.push(output); child = null; childClosed = null;
}

async function fixture(listeningHistory, fixtureTracks = tracks) {
  const content = JSON.stringify({ version: 1, tracks: fixtureTracks, listeningHistory });
  await fs.writeFile(path.join(dataDirectory, 'library.json'), content);
  return content;
}

try {
  await fs.mkdir(dataDirectory, { recursive: true });
  await fs.writeFile(noNetworkFile, "globalThis.fetch = async function () { console.error('CATALOG_UNEXPECTED_EXTERNAL_FETCH'); throw new Error('External fetch is disabled in catalog integration tests'); };\n");
  const initialLibrary = await fixture(history);
  await start();
  for (const pathname of ['/api/explore?section=recent', '/api/artist?name=Shooter_sz', '/api/artist?name=']) {
    const result = await json(pathname, { headers: { 'X-Forwarded-For': '127.0.0.1', 'X-Acervo-Device': 'local-admin' } });
    assert.equal(result.status, 401, 'Cloud catalog is protected even through a loopback proxy: ' + pathname);
  }
  const login = await json('/api/connect/login', { method: 'POST', body: { password, name: 'Catalog HTTP fixture', kind: 'desktop' } });
  assert.equal(login.status, 200); assert.equal(login.data.local, false);
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  for (const pathname of ['/api/artist', '/api/artist?name=', '/api/artist?name=%20%20', '/api/artist?name=bad%00name', '/api/artist?name=' + 'a'.repeat(121), '/api/explore?section=unknown']) {
    assert.equal((await json(pathname, { cookie })).status, 400, 'Catalog validates: ' + pathname);
  }
  const recent = await json('/api/explore?section=recent', { cookie });
  assert.equal(recent.status, 200); assert.equal(recent.data.section, 'recent');
  assert.deepEqual(recent.data.items.map(track => track.id), ['history-first', 'history-second']);
  assert.equal(recent.data.items.every(track => track.kind === 'track'), true);
  assert.deepEqual(recent.data.items.map(track => track.videoId), ['real-first', 'real-second']);
  assert.equal(recent.data.items.some(track => track.id === 'new-download-unplayed'), false);
  assert.equal(new Set(recent.data.items.map(track => track.id)).size, recent.data.items.length);
  assert.equal(await fs.readFile(path.join(dataDirectory, 'library.json'), 'utf8'), initialLibrary);

  await stop();
  const fallbackLibrary = await fixture([]); await start();
  const fallback = await json('/api/explore?section=recent', { cookie });
  assert.equal(fallback.status, 200, 'The owner session survives restart');
  assert.deepEqual(fallback.data.items.map(track => track.id), ['history-second', 'history-first', 'timestamp-fallback']);
  assert.equal(await fs.readFile(path.join(dataDirectory, 'library.json'), 'utf8'), fallbackLibrary);

  await stop();
  const unplayed = tracks.map(({ lastPlayedAt, ...track }) => ({ ...track, plays: 0 }));
  const unplayedLibrary = await fixture([], unplayed); await start();
  const empty = await json('/api/explore?section=recent', { cookie });
  assert.equal(empty.status, 200); assert.deepEqual(empty.data.items, []);
  assert.ok(empty.data.emptyReason, 'Unplayed library explains its empty listening history instead of using recent downloads');
  assert.equal(await fs.readFile(path.join(dataDirectory, 'library.json'), 'utf8'), unplayedLibrary);
  await stop();
  assert.equal(allOutput.some(value => value.includes('CATALOG_UNEXPECTED_EXTERNAL_FETCH')), false, 'Recent and invalid-input paths must never attempt external network requests');
  console.log('Catalog HTTP passed: cloud authorization, input validation, real listening-history order and deduplication, lastPlayedAt fallback, no invented recent listens, no external fetches, isolated library unchanged.');
} finally {
  await stop();
  const relative = path.relative(os.tmpdir(), directory);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(directory).startsWith('acervo-catalog-http-'));
  await fs.rm(directory, { recursive: true, force: true });
}
