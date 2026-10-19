import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// An isolated proxy simulation: no public listener, real account, media download or user data.
const publicOrigin = 'https://cloud-http.acervo.test';
const publicHost = new URL(publicOrigin).host;
const password = 'isolated HTTP fixture owner password';
const serverFile = fileURLToPath(new URL('../server.js', import.meta.url));
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'acervo-cloud-http-'));
const dataDirectory = path.join(directory, 'data');
const audio = Buffer.concat([Buffer.from('ID3'), Buffer.from(Array.from({ length: 1021 }, (_, index) => index % 256))]);
const cover = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 0xff, 0xd9]);
const fixtureTrack = { id: 'cloud-fixture-song', videoId: 'cloud-video-id', title: 'Fixture song', artist: 'Fixture artist', duration: 240, plays: 0, addedAt: '2026-10-18T12:00:00Z', hasCover: true, thumbnail: '/api/cover/cloud-fixture-song' };
const fixtureLibrary = JSON.stringify({ version: 1, tracks: [fixtureTrack], listeningHistory: [] });
let child = null; let childClosed = null; let output = ''; const streams = new Set();
const port = await availablePort();

async function availablePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const value = probe.address().port;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return value;
}

function raw(pathname, { method = 'GET', body, cookie, headers = {} } = {}) {
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method, agent: false,
      headers: { Host: publicHost, ...(method !== 'GET' ? { Origin: publicOrigin } : {}),
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
        ...(cookie ? { Cookie: cookie } : {}), ...headers } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.setTimeout(5000, () => req.destroy(new Error('HTTP fixture request timed out: ' + pathname)));
    req.on('error', reject);
    req.end(payload);
  });
}

async function json(pathname, options) {
  const result = await raw(pathname, options);
  return { ...result, data: JSON.parse(result.body.toString('utf8')) };
}

async function until(predicate, message = 'Expected event was not received', timeout = 4000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error(message);
}

async function openEvents(cookie) {
  const seen = [];
  let response; let closed = false; let finish;
  const done = new Promise(resolve => { finish = resolve; });
  const req = http.request({ hostname: '127.0.0.1', port, path: '/api/connect/events', method: 'GET', agent: false, headers: { Host: publicHost, Cookie: cookie } });
  const stream = { seen, done, get closed() { return closed; }, close() { req.destroy(); response?.destroy(); } };
  streams.add(stream);
  req.once('error', () => { closed = true; finish(); });
  req.once('close', () => { closed = true; finish(); });
  await new Promise((resolve, reject) => {
    req.once('error', reject);
    req.once('response', res => {
      response = res;
      if (res.statusCode !== 200) { res.resume(); reject(new Error('SSE returned HTTP ' + res.statusCode)); return; }
      try { assert.match(String(res.headers['content-type']), /^text\/event-stream/); }
      catch (error) { req.destroy(); reject(error); return; }
      let pending = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        pending += chunk;
        const parts = pending.split('\n\n'); pending = parts.pop();
        for (const part of parts) {
          const type = part.match(/^event: (.+)$/m)?.[1]; const data = part.match(/^data: (.+)$/m)?.[1];
          if (type && data) seen.push({ type, data: JSON.parse(data) });
        }
      });
      res.once('close', () => { closed = true; finish(); });
      res.once('error', () => { closed = true; finish(); });
      resolve();
    });
    req.end();
  });
  await until(() => seen.some(event => event.type === 'snapshot'), 'Initial SSE snapshot was not received');
  return stream;
}

async function startServer() {
  assert.equal(child, null);
  output = '';
  child = spawn(process.execPath, [serverFile], { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...process.env, PORT: String(port), ACERVO_HOST: '127.0.0.1', ACERVO_MODE: 'cloud', ACERVO_PUBLIC_ORIGIN: publicOrigin,
    ACERVO_ADMIN_PASSWORD: password, ACERVO_DATA_DIR: dataDirectory
  } });
  const current = child;
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  childClosed = new Promise(resolve => child.once('close', resolve));
  let ready = false;
  for (let index = 0; index < 60; index++) {
    if (current.exitCode !== null) throw new Error('Cloud fixture server exited: ' + output);
    try { ready = (await raw('/healthz')).status === 200; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, output || 'Cloud fixture server starts');
}

async function stopServer() {
  for (const stream of streams) stream.close();
  await Promise.allSettled([...streams].map(stream => stream.done)); streams.clear();
  if (!child) return;
  const current = child; const done = childClosed; child = null; childClosed = null;
  current.kill();
  await done;
}

function cookie(result) {
  const value = result.headers['set-cookie']?.[0];
  assert.match(value || '', /^acervo_connect=/);
  assert.match(value, /HttpOnly; SameSite=Strict; Max-Age=2592000; Secure$/);
  return value.split(';')[0];
}

try {
  await fs.mkdir(path.join(dataDirectory, 'tracks'), { recursive: true });
  await fs.mkdir(path.join(dataDirectory, 'covers'), { recursive: true });
  await fs.writeFile(path.join(dataDirectory, 'library.json'), fixtureLibrary);
  await fs.writeFile(path.join(dataDirectory, 'tracks', fixtureTrack.id + '.mp3'), audio);
  await fs.writeFile(path.join(dataDirectory, 'covers', fixtureTrack.id + '.jpg'), cover);
  await startServer();

  assert.equal((await raw('/')).status, 200);
  assert.deepEqual((await json('/api/connect/config')).data, { cloud: true });
  for (const pathname of ['/api/library', '/api/cover/' + fixtureTrack.id, '/api/stream/' + fixtureTrack.id, '/api/connect/info', '/api/connect/events']) {
    assert.equal((await raw(pathname, { headers: { 'X-Acervo-Device': 'pc', 'X-Forwarded-For': '127.0.0.1' } })).status, 401, pathname + ' is protected even behind a loopback proxy');
  }
  assert.equal((await raw('/api/connect/config', { headers: { Host: 'localhost:' + port, 'X-Forwarded-Host': publicHost } })).status, 403);
  assert.equal((await json('/api/connect/login', { method: 'POST', body: { password }, headers: { Origin: 'http://' + publicHost } })).status, 403);
  assert.equal((await json('/api/connect/login', { method: 'POST', body: { password }, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await json('/api/connect/login', { method: 'POST', body: { password: 'wrong' } })).status, 401);

  const login = await json('/api/connect/login', { method: 'POST', body: { password, name: 'Cloud HTTP owner', kind: 'desktop' } });
  assert.equal(login.status, 200); assert.equal(login.data.local, false); assert.equal(login.data.cloud, true); assert.equal(login.data.admin, true);
  const ownerCookie = cookie(login); const ownerId = login.data.deviceId;
  assert.equal(login.data.playback.activeDeviceId, ownerId);
  assert.equal((await json('/api/connect/register', { method: 'POST', cookie: ownerCookie, body: { deviceId: 'pc' } })).status, 403);
  const ownerStream = await openEvents(ownerCookie);
  assert.equal(ownerStream.seen.find(event => event.type === 'snapshot').data.admin, true);

  const pairing = await json('/api/connect/pairing', { method: 'POST', cookie: ownerCookie, body: {} });
  assert.equal(pairing.status, 200); assert.equal(pairing.data.candidates.length, 1);
  assert.equal(pairing.data.url, publicOrigin + '/#pair=' + pairing.data.code);
  assert.equal(Buffer.from(pairing.data.qrDataUrl.split(',')[1], 'base64').subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const claim = await json('/api/connect/claim', { method: 'POST', body: { code: pairing.data.code, name: 'Cloud HTTP guest', kind: 'mobile', admin: true, local: true, deviceId: ownerId } });
  assert.equal(claim.status, 200); assert.equal(claim.data.local, false); assert.equal(claim.data.admin, false); assert.notEqual(claim.data.deviceId, ownerId);
  const guestCookie = cookie(claim); const guestId = claim.data.deviceId;
  assert.equal((await json('/api/connect/claim', { method: 'POST', body: { code: pairing.data.code } })).status, 401);
  assert.equal((await json('/api/connect/pairing', { method: 'POST', cookie: guestCookie, body: {} })).status, 403);
  const guestStream = await openEvents(guestCookie);
  assert.equal(guestStream.seen.find(event => event.type === 'snapshot').data.admin, false);
  const library = await json('/api/library', { cookie: guestCookie });
  assert.equal(library.status, 200); assert.deepEqual(library.data.tracks, [fixtureTrack]);
  assert.equal((await json('/api/connect/info', { cookie: guestCookie, headers: { 'X-Acervo-Device': ownerId } })).data.deviceId, guestId);

  const audioResponse = await raw('/api/stream/' + fixtureTrack.id, { cookie: guestCookie });
  assert.equal(audioResponse.status, 200); assert.deepEqual(audioResponse.body, audio); assert.equal(audioResponse.headers['content-type'], 'audio/mpeg');
  assert.equal(audioResponse.headers['cache-control'], 'private, no-store'); assert.equal(audioResponse.headers['accept-ranges'], 'bytes');
  const range = await raw('/api/stream/' + fixtureTrack.id, { cookie: guestCookie, headers: { Range: 'bytes=19-58' } });
  assert.equal(range.status, 206); assert.deepEqual(range.body, audio.subarray(19, 59));
  assert.equal(range.headers['content-range'], 'bytes 19-58/' + audio.length); assert.equal(range.headers['cache-control'], 'private, no-store');
  const image = await raw('/api/cover/' + fixtureTrack.id, { cookie: guestCookie });
  assert.equal(image.status, 200); assert.deepEqual(image.body, cover); assert.equal(image.headers['cache-control'], 'private, no-store');

  const state = await json('/api/connect/state', { method: 'POST', cookie: ownerCookie, body: { trackId: fixtureTrack.id, queue: [fixtureTrack.id], qi: 0, playing: true, position: 37, volume: .5, shuffle: false, repeat: 'off' } });
  assert.equal(state.status, 200);
  await until(() => guestStream.seen.some(event => event.type === 'state' && event.data.position === 37));
  const transfer = await json('/api/connect/command', { method: 'POST', cookie: guestCookie, body: { type: 'transfer', args: { targetDeviceId: guestId } } });
  assert.equal(transfer.status, 200); assert.equal(transfer.data.playback.activeDeviceId, guestId);
  assert.ok(transfer.data.playback.position >= 37 && transfer.data.playback.position < 45);
  await until(() => ownerStream.seen.some(event => event.type === 'command' && event.data.type === 'transfer') && guestStream.seen.some(event => event.type === 'command' && event.data.type === 'transfer'));
  assert.equal((await json('/api/connect/state', { method: 'POST', cookie: ownerCookie, body: { position: 5 } })).status, 409);
  assert.equal((await json('/api/connect/state', { method: 'POST', cookie: guestCookie, body: { position: 41, playing: false } })).status, 200);
  await until(() => ownerStream.seen.some(event => event.type === 'state' && event.data.position === 41));

  const metadata = await json('/api/app/version');
  assert.ok([200, 404].includes(metadata.status));
  if (metadata.status === 200) {
    const manifest = await fs.readFile(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
    assert.equal(metadata.data.versionCode, Number(manifest.match(/android:versionCode="(\d+)"/)[1]));
    assert.equal(metadata.data.versionName, manifest.match(/android:versionName="([^"]+)"/)[1]);
    assert.match(metadata.data.sha256, /^[a-f0-9]{64}$/);
    const apk = await raw(metadata.data.downloadUrl);
    assert.equal(apk.status, 200); assert.equal(crypto.createHash('sha256').update(apk.body).digest('hex'), metadata.data.sha256);
  }

  await stopServer(); await startServer();
  const ownerAfterRestart = await json('/api/connect/info', { cookie: ownerCookie });
  assert.equal(ownerAfterRestart.status, 200); assert.equal(ownerAfterRestart.data.admin, true); assert.equal(ownerAfterRestart.data.deviceId, ownerId);
  assert.equal(ownerAfterRestart.data.playback.trackId, null); assert.equal(ownerAfterRestart.data.playback.playing, false);
  assert.equal(ownerAfterRestart.data.devices.find(device => device.id === guestId).online, false);
  assert.equal((await json('/api/library', { cookie: guestCookie })).status, 200);
  const reconnectedGuest = await openEvents(guestCookie);
  assert.equal((await json('/api/connect/devices/' + guestId, { method: 'DELETE', cookie: guestCookie })).status, 403);
  assert.equal((await json('/api/connect/devices/' + guestId, { method: 'DELETE', cookie: ownerCookie })).status, 200);
  await until(() => reconnectedGuest.seen.some(event => event.type === 'revoked'));
  assert.equal((await json('/api/library', { cookie: guestCookie })).status, 401);

  await stopServer(); await startServer();
  assert.equal((await json('/api/library', { cookie: guestCookie })).status, 401, 'Revocation survives a second restart');
  assert.equal((await json('/api/library', { cookie: ownerCookie })).status, 200);
  const logout = await json('/api/connect/logout', { method: 'POST', cookie: ownerCookie, body: {} });
  assert.equal(logout.status, 200); assert.deepEqual(logout.data, { ok: true });
  assert.match(logout.headers['set-cookie'][0], /^acervo_connect=; Path=\/; HttpOnly; SameSite=Strict; Max-Age=0; Secure$/);
  assert.equal((await json('/api/library', { cookie: ownerCookie })).status, 401);
  assert.equal((await fs.readFile(path.join(dataDirectory, 'library.json'), 'utf8')), fixtureLibrary, 'The isolated library was never mutated');
  assert.equal(JSON.parse(await fs.readFile(path.join(dataDirectory, 'connect-sessions.json'), 'utf8')).sessions.length, 0);
  console.log('Cloud HTTP passed: loopback auth, fixed HTTPS Host/Origin, secure owner login, public QR guest, media protection and Range, two SSE clients and transfer, restart persistence, durable revocation and logout. Only isolated temporary data used.');
} finally {
  await stopServer();
  const relative = path.relative(os.tmpdir(), directory);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(directory).startsWith('acervo-cloud-http-'));
  await fs.rm(directory, { recursive: true, force: true });
}
