import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createConnectManager } from '../lib/connect.js';

const PUBLIC_ORIGIN = 'https://music.example.test';
const PASSWORD = 'an independent Acervo password';
const startTime = Date.parse('2026-10-18T12:00:00Z');
const COOKIE = result => result.cookie.split(';')[0];
const rejected = status => error => error.statusCode === status;
function request(pathname = '/api/connect/info', { method = 'GET', address = '203.0.113.44', headers = {} } = {}) {
  return { method, url: pathname, socket: { remoteAddress: address }, headers: { host: 'music.example.test', ...headers } };
}
function fixture(options = {}) {
  let time = startTime;
  const manager = createConnectManager({ mode: 'cloud', publicOrigin: PUBLIC_ORIGIN, adminPassword: PASSWORD, now: () => time,
    qrCode: async url => 'data:image/png;base64,' + Buffer.from(url).toString('base64'), getTrack: async () => ({ duration: 240 }), ...options });
  return { manager, advance: milliseconds => { time += milliseconds; } };
}
function owner(manager, { address = '203.0.113.44', name = 'My phone', kind = 'mobile' } = {}) {
  const req = request('/api/connect/login', { method: 'POST', address });
  const result = manager.login(manager.authorize(req, '/api/connect/login'), { password: PASSWORD, name, kind }, req.socket.remoteAddress);
  const cookie = COOKIE(result);
  return { ...result, cookie, context: manager.authorize(request('/api/connect/info', { address, headers: { cookie } }), '/api/connect/info') };
}
async function paired(manager, admin, address = '198.51.100.55') {
  const pairing = await manager.createPairing(admin.context);
  const req = request('/api/connect/claim', { method: 'POST', address });
  const result = manager.claim(manager.authorize(req, '/api/connect/claim'), { code: pairing.code, name: 'Other phone', kind: 'mobile', admin: true, local: true, deviceId: admin.snapshot.deviceId }, address);
  const cookie = COOKIE(result);
  return { ...result, cookie, pairing, context: manager.authorize(request('/api/connect/info', { address, headers: { cookie } }), '/api/connect/info') };
}
function statePath(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'acervo-cloud-tests-'));
  t.after(() => {
    const relative = path.relative(os.tmpdir(), directory);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(directory).startsWith('acervo-cloud-tests-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return path.join(directory, 'connections.json');
}
class Response extends EventEmitter {
  chunks = []; destroyed = false; writableEnded = false; headers = {};
  writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); }
  setHeader(name, value) { this.headers[name.toLowerCase()] = value; }
  flushHeaders() {}
  write(value) { this.chunks.push(value); return true; }
  end() { if (this.writableEnded) return; this.writableEnded = true; this.emit('close'); }
  events(type) { return this.chunks.map(chunk => { const found = chunk.match(/^event: (.+)\ndata: (.+)\n\n$/); return found ? { type: found[1], data: JSON.parse(found[2]) } : null; }).filter(value => value && (!type || value.type === type)); }
}

test('cloud requires a strict HTTPS origin and a sufficiently long owner password', () => {
  for (const publicOrigin of [undefined, '', 'http://music.example.test', 'https://user@music.example.test', 'https://u:p@music.example.test', 'https://music.example.test/music', 'https://music.example.test/?', 'https://music.example.test/#', ' https://music.example.test', 'https:\\music.example.test', 'file:///music']) {
    assert.throws(() => fixture({ publicOrigin }), rejected(500), String(publicOrigin));
  }
  for (const adminPassword of [undefined, '', 'short', 'a'.repeat(1025)]) assert.throws(() => fixture({ adminPassword }), rejected(500));
  assert.throws(() => fixture({ mode: 'unknown' }), rejected(500));
  assert.doesNotThrow(() => fixture({ publicOrigin: 'https://MUSIC.example.test:443/' }));
});

test('cloud loopback, private, public and proxy clients all require sessions and cannot spoof local trust', () => {
  const { manager } = fixture();
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '192.168.1.12', '100.107.110.50', '203.0.113.44', '2001:db8::2']) {
    const req = request('/', { address, headers: { 'x-forwarded-for': '127.0.0.1', 'x-acervo-device': 'pc' } });
    const context = manager.authorize(req, '/');
    assert.equal(context.local, false); assert.equal(context.device, null);
    for (const api of ['/api/library', '/api/stream/song', '/api/connect/info', '/api/connect/events', '/api/health']) assert.throws(() => manager.authorize(req, api), rejected(401));
    assert.throws(() => manager.register(context, { deviceId: 'pc' }), rejected(403));
  }
  assert.throws(() => manager.register({ local: true }, { deviceId: 'spoofed-pc' }), rejected(403));
  assert.equal(manager.snapshot({ local: true }).local, false);
});

test('cloud Host and mutation origins remain fixed despite proxy header spoofing', () => {
  const { manager } = fixture();
  for (const host of ['localhost:4310', '127.0.0.1:4310', 'attacker.example', 'music.example.test.attacker.test', 'music.example.test:80', 'music.example.test/path', 'music.example.test@attacker.test']) {
    assert.throws(() => manager.authorize(request('/', { headers: { host, 'x-forwarded-host': 'music.example.test', 'x-forwarded-proto': 'https' } }), '/'), rejected(403));
  }
  for (const origin of ['http://music.example.test', 'https://evil.example', 'null', 'https://music.example.test/', 'https://music.example.test:444']) {
    assert.throws(() => manager.authorize(request('/api/connect/login', { method: 'POST', headers: { origin } }), '/api/connect/login'), rejected(403));
  }
  assert.throws(() => manager.authorize(request('/api/connect/login', { method: 'POST', headers: { origin: PUBLIC_ORIGIN, 'sec-fetch-site': 'cross-site' } }), '/api/connect/login'), rejected(403));
  for (const origin of [undefined, PUBLIC_ORIGIN]) assert.doesNotThrow(() => manager.authorize(request('/api/connect/login', { method: 'POST', headers: origin ? { origin } : {} }), '/api/connect/login'));
});

test('only config, APK version and POST login/claim APIs are anonymous in cloud mode', async () => {
  const { manager } = fixture();
  for (const pathname of ['/', '/app.js', '/downloads/acervo.apk', '/api/connect/config', '/api/app/version']) assert.doesNotThrow(() => manager.authorize(request(pathname), pathname));
  for (const pathname of ['/api/connect/login', '/api/connect/claim']) assert.doesNotThrow(() => manager.authorize(request(pathname, { method: 'POST' }), pathname));
  for (const [method, pathname] of [['POST', '/api/connect/config'], ['POST', '/api/app/version'], ['GET', '/api/connect/login'], ['GET', '/api/connect/claim'], ['POST', '/api/connect/logout'], ['DELETE', '/api/connect/devices/id']]) assert.throws(() => manager.authorize(request(pathname, { method }), pathname), rejected(401));
  let result;
  assert.equal(await manager.handle(request('/api/connect/config'), new Response(), '/api/connect/config', {}, async () => ({}), (_res, status, data) => { result = { status, data }; }), true);
  assert.deepEqual(result, { status: 200, data: { cloud: true } });
});

test('owner login creates a secure cookie identity and playback output without granting local registration', async () => {
  const { manager } = fixture();
  const admin = owner(manager);
  assert.match(admin.cookie, /^acervo_connect=[A-Za-z0-9_-]{43}$/);
  const login = manager.login({}, { password: PASSWORD, name: 'Desktop', kind: 'desktop', local: true }, '198.51.100.88');
  assert.match(login.cookie, /HttpOnly; SameSite=Strict; Max-Age=2592000; Secure$/);
  assert.equal(admin.snapshot.local, false); assert.equal(admin.snapshot.cloud, true); assert.equal(admin.snapshot.admin, true);
  assert.equal(admin.snapshot.playback.activeDeviceId, admin.snapshot.deviceId);
  assert.equal(admin.context.device.local, false); assert.equal(admin.context.device.admin, true);
  const spoofed = manager.authorize(request('/api/library', { headers: { cookie: admin.cookie, 'x-acervo-device': login.snapshot.deviceId } }), '/api/library');
  assert.equal(spoofed.device.id, admin.snapshot.deviceId);
  assert.throws(() => manager.register(admin.context, { deviceId: 'pc' }), rejected(403));
  await manager.updateState(admin.context, { trackId: 'song', queue: ['song'], qi: 0, playing: true, position: 21 });
  assert.equal(manager.snapshot(admin.context).playback.position, 21);
});

test('login attempts are bounded by actual socket address and share the limit with QR guessing', () => {
  const { manager, advance } = fixture();
  const req = request('/api/connect/login', { method: 'POST', address: '127.0.0.1', headers: { 'x-forwarded-for': '203.0.113.1' } });
  for (let count = 0; count < 10; count++) {
    req.headers['x-forwarded-for'] = '203.0.113.' + (count + 1);
    const context = manager.authorize(req, '/api/connect/login');
    assert.throws(() => manager.login(context, { password: 'wrong' }, req.socket.remoteAddress), rejected(401));
  }
  assert.throws(() => manager.login(manager.authorize(req, '/api/connect/login'), { password: PASSWORD }, req.socket.remoteAddress), rejected(429));
  assert.throws(() => manager.claim({ local: false }, { code: 'wrong' }, '127.0.0.1'), rejected(429));
  assert.doesNotThrow(() => owner(manager, { address: '198.51.100.55' }));
  advance(60001);
  assert.doesNotThrow(() => manager.login(manager.authorize(req, '/api/connect/login'), { password: PASSWORD }, req.socket.remoteAddress));
});

test('public QR pairing remains single use, short lived and gives no owner role', async () => {
  const { manager, advance } = fixture();
  const admin = owner(manager);
  const phone = await paired(manager, admin, '127.0.0.1');
  assert.match(phone.pairing.url, /^https:\/\/music\.example\.test\/#pair=[A-Za-z0-9_-]{43}$/);
  assert.equal(phone.pairing.candidates.length, 1); assert.equal(phone.pairing.candidates[0].address, 'music.example.test');
  assert.equal(phone.snapshot.local, false); assert.equal(phone.snapshot.cloud, true); assert.equal(phone.snapshot.admin, false);
  assert.equal(phone.context.device.admin, false); assert.notEqual(phone.snapshot.deviceId, admin.snapshot.deviceId);
  await assert.rejects(manager.createPairing(phone.context), rejected(403));
  await assert.rejects(manager.createPairing({ local: true }), rejected(403));
  assert.throws(() => manager.revoke(phone.context, admin.snapshot.deviceId), rejected(403));
  assert.throws(() => manager.claim({ local: false }, { code: phone.pairing.code }, '198.51.100.8'), rejected(401));
  const expired = await manager.createPairing(admin.context); advance(300001);
  assert.throws(() => manager.claim({ local: false }, { code: expired.code }, '198.51.100.8'), rejected(401));
});

test('owner-specific snapshots stay correct in shared event streams and revocation disconnects immediately', async () => {
  const { manager } = fixture(); const admin = owner(manager); const phone = await paired(manager, admin);
  const adminStream = new Response(); const phoneStream = new Response();
  manager.events(request(), adminStream, admin.context); manager.events(request(), phoneStream, phone.context);
  try {
    assert.equal(adminStream.events('devices').at(-1).data.admin, true);
    assert.equal(phoneStream.events('devices').at(-1).data.admin, false);
    assert.equal(adminStream.events('devices').at(-1).data.local, false);
    assert.equal(phoneStream.events('snapshot')[0].data.cloud, true);
    manager.revoke(admin.context, phone.snapshot.deviceId);
    assert.equal(phoneStream.writableEnded, true); assert.equal(phoneStream.events('revoked').length, 1);
    assert.throws(() => manager.authorize(request('/api/library', { headers: { cookie: phone.cookie } }), '/api/library'), rejected(401));
    assert.equal(adminStream.events('devices').at(-1).data.admin, true);
  } finally { adminStream.end(); phoneStream.end(); }
});

test('revocation also blocks playback commands and QR generation that were already in flight', async () => {
  const { manager } = fixture(); const admin = owner(manager); const phone = await paired(manager, admin);
  const pendingCommand = manager.command(phone.context, { type: 'pause' });
  manager.revoke(admin.context, phone.snapshot.deviceId);
  await assert.rejects(pendingCommand, rejected(401));
  const pendingState = manager.updateState(admin.context, { position: 20 });
  manager.logout(admin.context);
  await assert.rejects(pendingState, rejected(401));
  let finishQR;
  const gate = new Promise(resolve => { finishQR = resolve; });
  const next = fixture({ qrCode: async () => { await gate; return 'data:image/png;base64,aGVsbG8='; } }).manager;
  const other = owner(next); const pendingQR = next.createPairing(other.context);
  next.logout(other.context); finishQR();
  await assert.rejects(pendingQR, rejected(401));
});

test('persistent cloud sessions contain only hashed tokens, reload offline and recover ownership without playback restoration', async t => {
  const stateFile = statePath(t); const { manager } = fixture({ stateFile });
  const admin = owner(manager); const phone = await paired(manager, admin);
  await manager.updateState(admin.context, { trackId: 'song', queue: ['song'], qi: 0, playing: true, position: 72 });
  const contents = fs.readFileSync(stateFile, 'utf8');
  const stored = JSON.parse(contents);
  assert.equal(stored.sessions.length, 2); assert.equal(stored.devices.length, 2);
  assert.doesNotMatch(contents, new RegExp(PASSWORD));
  assert.equal(contents.includes(admin.cookie.split('=')[1]), false); assert.equal(contents.includes(phone.cookie.split('=')[1]), false);
  assert.ok(stored.sessions.some(session => session.hash === crypto.createHash('sha256').update(admin.cookie.split('=')[1]).digest('hex')));
  assert.equal(stored.devices.find(device => device.id === admin.snapshot.deviceId).admin, true);
  assert.equal('playback' in stored, false);
  const restarted = fixture({ stateFile }).manager;
  assert.equal(restarted.snapshot().devices.every(device => device.online === false), true);
  assert.equal(restarted.snapshot().playback.activeDeviceId, null); assert.equal(restarted.snapshot().playback.trackId, null);
  const req = request('/api/connect/info', { headers: { cookie: phone.cookie } });
  const context = restarted.authorize(req, '/api/connect/info');
  assert.equal(context.device.id, phone.snapshot.deviceId); assert.equal(context.device.online, true);
  assert.equal(restarted.snapshot(context).playback.activeDeviceId, phone.snapshot.deviceId);
  assert.equal(restarted.snapshot(context).admin, false);
  const ownerContext = restarted.authorize(request('/api/connect/info', { headers: { cookie: admin.cookie } }), '/api/connect/info');
  assert.equal(restarted.snapshot(ownerContext).admin, true);
});

test('persistent logout and owner revocation survive restarts and logout clears the secure cookie', async t => {
  const stateFile = statePath(t); const { manager } = fixture({ stateFile });
  const admin = owner(manager); const phone = await paired(manager, admin); const next = await paired(manager, admin, '198.51.100.77');
  manager.revoke(admin.context, phone.snapshot.deviceId);
  const result = manager.logout(next.context);
  assert.match(result.cookie, /^acervo_connect=; Path=\/; HttpOnly; SameSite=Strict; Max-Age=0; Secure$/);
  const restarted = fixture({ stateFile }).manager;
  for (const cookie of [phone.cookie, next.cookie]) assert.throws(() => restarted.authorize(request('/api/library', { headers: { cookie } }), '/api/library'), rejected(401));
  assert.doesNotThrow(() => restarted.authorize(request('/api/library', { headers: { cookie: admin.cookie } }), '/api/library'));
  assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).devices.length, 1);
});

test('changing the owner password invalidates stored sessions permanently, including after reverting the password', t => {
  const stateFile = statePath(t); const { manager } = fixture({ stateFile }); const admin = owner(manager);
  const changed = fixture({ stateFile, adminPassword: 'a different strong Acervo password' }).manager;
  assert.throws(() => changed.authorize(request('/api/library', { headers: { cookie: admin.cookie } }), '/api/library'), rejected(401));
  assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).sessions.length, 0);
  const reverted = fixture({ stateFile }).manager;
  assert.throws(() => reverted.authorize(request('/api/library', { headers: { cookie: admin.cookie } }), '/api/library'), rejected(401));
});

test('session expiry applies both in memory and after loading persisted sessions', t => {
  const stateFile = statePath(t); const { manager, advance } = fixture({ stateFile }); const admin = owner(manager);
  advance(30 * 86400000 + 1);
  assert.throws(() => manager.authorize(request('/api/library', { headers: { cookie: admin.cookie } }), '/api/library'), rejected(401));
  assert.equal(manager.snapshot().devices.length, 0);
  const expired = fixture({ stateFile, now: () => startTime + 30 * 86400000 + 1 }).manager;
  assert.equal(expired.snapshot().devices.length, 0);
  assert.throws(() => expired.authorize(request('/api/library', { headers: { cookie: admin.cookie } }), '/api/library'), rejected(401));
});

test('corrupt persisted data fails closed and is left unchanged for recovery', t => {
  const stateFile = statePath(t); fs.writeFileSync(stateFile, '{ corrupt file');
  assert.throws(() => fixture({ stateFile }), rejected(500));
  assert.equal(fs.readFileSync(stateFile, 'utf8'), '{ corrupt file');
  fs.unlinkSync(stateFile);
  const { manager } = fixture({ stateFile }); owner(manager);
  const valid = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  for (const mutation of [value => { value.version = 2; }, value => { value.devices[0].local = true; }, value => { value.devices[0].admin = 'true'; }, value => { value.sessions[0].hash = 'raw-token'; }, value => { value.sessions[0].deviceId = 'unknown'; }, value => { value.devices.push({ ...value.devices[0] }); }, value => { value.sessions.push({ ...value.sessions[0] }); }]) {
    const value = structuredClone(valid); mutation(value); const contents = JSON.stringify(value); fs.writeFileSync(stateFile, contents);
    assert.throws(() => fixture({ stateFile }), rejected(500)); assert.equal(fs.readFileSync(stateFile, 'utf8'), contents);
  }
});

test('HTTP handlers set cloud login/logout cookies without exposing session tokens in JSON', async () => {
  const { manager } = fixture(); const loginRequest = request('/api/connect/login', { method: 'POST' }); const loginResponse = new Response();
  let payload;
  const sendJson = (_res, status, data) => { assert.equal(status, 200); payload = data; };
  assert.equal(await manager.handle(loginRequest, loginResponse, '/api/connect/login', manager.authorize(loginRequest, '/api/connect/login'), async () => ({ password: PASSWORD, kind: 'mobile' }), sendJson), true);
  assert.equal(payload.admin, true); assert.equal(payload.local, false); assert.equal(payload.cloud, true);
  assert.equal('cookie' in payload, false); assert.equal('token' in payload, false);
  assert.match(loginResponse.headers['set-cookie'], /; Secure$/);
  const logoutRequest = request('/api/connect/logout', { method: 'POST', headers: { cookie: loginResponse.headers['set-cookie'].split(';')[0] } });
  const logoutResponse = new Response();
  assert.equal(await manager.handle(logoutRequest, logoutResponse, '/api/connect/logout', manager.authorize(logoutRequest, '/api/connect/logout'), async () => ({}), sendJson), true);
  assert.deepEqual(payload, { ok: true }); assert.match(logoutResponse.headers['set-cookie'], /Max-Age=0; Secure$/);
});
