import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createConnectManager, isPrivateIPv4, lanAddresses, assertSameOrigin, validatePlaybackPatch, validateCommand } from '../lib/connect.js';

const interfaces = () => ({ WiFi: [{ address: '192.168.10.20', internal: false }, { address: '203.0.113.8', internal: false }], Loopback: [{ address: '127.0.0.1', internal: true }], Virtual: [{ address: '172.17.0.1', internal: false }] });
const request = (remote = false, extra = {}) => ({ method: 'GET', url: '/api/connect/info', socket: { remoteAddress: remote ? '192.168.10.30' : '127.0.0.1' }, headers: { host: remote ? '192.168.10.20:4310' : 'localhost:4310', ...extra } });
const local = { local: true, device: null };
function fixture(options = {}) {
  let time = Date.parse('2026-10-18T12:00:00Z');
  const manager = createConnectManager({ networkInterfaces: interfaces, now: () => time, qrCode: async url => 'data:image/png;base64,' + Buffer.from(url).toString('base64'), getTrack: async id => id !== 'missing', ...options });
  return { manager, advance: milliseconds => { time += milliseconds; } };
}
async function paired(manager, name = 'Phone') {
  const pairing = await manager.createPairing(local);
  const req = request(true);
  req.method = 'POST';
  const context = manager.authorize(req, '/api/connect/claim');
  const result = manager.claim(context, { code: pairing.code, name, deviceId: 'spoofed' }, req.socket.remoteAddress);
  const cookie = result.cookie.split(';')[0];
  return { ...result, cookie, context: manager.authorize(request(true, { cookie }), '/api/connect/info') };
}
class Response extends EventEmitter {
  chunks = [];
  destroyed = false;
  writableEnded = false;
  writeHead(code, headers) { this.status = code; this.headers = headers; }
  flushHeaders() {}
  write(value) { this.chunks.push(value); return true; }
  end() { if (this.writableEnded) return; this.writableEnded = true; this.emit('close'); }
  events(type) { return this.chunks.map(chunk => { const found = chunk.match(/^event: (.+)\ndata: (.+)\n\n$/); return found ? { type: found[1], data: JSON.parse(found[2]) } : null; }).filter(value => value && (!type || value.type === type)); }
}

test('LAN addresses contain only private IPv4 and prefer physical adapters', () => {
  assert.deepEqual(lanAddresses(interfaces()).map(item => item.address), ['192.168.10.20', '172.17.0.1']);
  for (const ip of ['10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '::ffff:192.168.1.1']) assert.equal(isPrivateIPv4(ip), true);
  for (const ip of ['8.8.8.8', '127.0.0.1', '169.254.1.1', '172.32.0.1', '192.168.999.1', '10. .0.1', '::1']) assert.equal(isPrivateIPv4(ip), false);
});

test('anonymous LAN clients can load the app but all APIs except claim require pairing', () => {
  const { manager } = fixture();
  assert.equal(manager.authorize(request(true), '/').local, false);
  assert.throws(() => manager.authorize(request(true), '/api/library'), error => error.statusCode === 401);
  assert.throws(() => manager.authorize(request(true), '/api/connect/info'), error => error.statusCode === 401);
  const claimRequest = request(true); claimRequest.method = 'POST';
  assert.equal(manager.authorize(claimRequest, '/api/connect/claim').device, null);
  const publicRequest = request(true); publicRequest.socket.remoteAddress = '8.8.8.8'; publicRequest.headers['x-forwarded-for'] = '127.0.0.1';
  assert.throws(() => manager.authorize(publicRequest, '/'), error => error.statusCode === 403);
  assert.throws(() => manager.authorize(request(false, { host: 'attacker.example:4310' }), '/api/library'), error => error.statusCode === 403);
});

test('mutations reject foreign, opaque and cross-site browser origins', () => {
  const req = request(); req.method = 'POST';
  for (const origin of ['http://evil.example', 'null', 'https://localhost:4310', 'http://localhost:9999']) assert.throws(() => assertSameOrigin({ ...req, headers: { ...req.headers, origin } }), error => error.statusCode === 403);
  assert.doesNotThrow(() => assertSameOrigin({ ...req, headers: { ...req.headers, origin: 'http://localhost:4310' } }));
  assert.throws(() => assertSameOrigin({ ...req, headers: { ...req.headers, 'sec-fetch-site': 'cross-site' } }), error => error.statusCode === 403);
  assert.doesNotThrow(() => assertSameOrigin({ ...req, headers: { host: '192.168.10.20:4310', origin: 'http://192.168.10.20:4310' } }));
});

test('QR codes are single use and local only; sessions bind server-assigned device identity', async () => {
  const { manager } = fixture();
  const pc = manager.register(local, { deviceId: 'computer-stable', name: 'PC' });
  assert.equal(manager.register(local, { deviceId: pc.deviceId }).deviceId, pc.deviceId);
  const pairing = await manager.createPairing(local);
  assert.equal(pairing.candidates.length, 2);
  assert.equal(typeof pairing.expiresAt, 'number');
  assert.equal(pairing.expiresAt - Date.parse('2026-10-18T12:00:00Z'), 300000);
  assert.match(pairing.url, /^http:\/\/192\.168\.10\.20:4310\/#pair=/);
  assert.match(pairing.code, /^[A-Za-z0-9_-]{43}$/);
  await assert.rejects(manager.createPairing({ local: false }), error => error.statusCode === 403);
  const remote = manager.authorize(Object.assign(request(true), { method: 'POST' }), '/api/connect/claim');
  const claimed = manager.claim(remote, { code: pairing.code, deviceId: pc.deviceId, name: 'Phone' }, '192.168.10.30');
  assert.notEqual(claimed.snapshot.deviceId, pc.deviceId);
  assert.equal(claimed.snapshot.devices.find(device => device.id === claimed.snapshot.deviceId).kind, 'mobile');
  assert.match(claimed.cookie, /HttpOnly; SameSite=Strict; Max-Age=2592000/);
  const authenticated = manager.authorize(request(true, { cookie: claimed.cookie.split(';')[0], 'x-acervo-device': pc.deviceId }), '/api/library');
  assert.equal(authenticated.device.id, claimed.snapshot.deviceId);
  assert.throws(() => manager.claim(remote, { code: pairing.code }, '192.168.10.30'), error => error.statusCode === 401);
  assert.throws(() => manager.register(authenticated, { deviceId: pc.deviceId }), error => error.statusCode === 403);
});

test('pairing expiration, attempt limits and session expiration are enforced', async () => {
  const { manager, advance } = fixture();
  const pairing = await manager.createPairing(local);
  advance(300001);
  assert.throws(() => manager.claim({ local: false }, { code: pairing.code }, '192.168.10.30'), error => error.statusCode === 401);
  for (let count = 0; count < 9; count++) assert.throws(() => manager.claim({ local: false }, { code: 'wrong' }, '192.168.10.30'), error => error.statusCode === 401);
  assert.throws(() => manager.claim({ local: false }, { code: 'wrong' }, '192.168.10.30'), error => error.statusCode === 429);
  advance(60001);
  const phone = await paired(manager);
  advance(30 * 86400000 + 1);
  assert.throws(() => manager.authorize(request(true, { cookie: phone.cookie }), '/api/library'), error => error.statusCode === 401);
});

test('player commands reach the active device once; transfer preserves playback and changes telemetry ownership', async () => {
  const { manager } = fixture();
  const pc = manager.register(local, { deviceId: 'pc', name: 'PC' });
  const pcContext = manager.authorize(request(false, { 'x-acervo-device': pc.deviceId }), '/api/connect/info');
  const phone = await paired(manager);
  const pcStream = new Response(); const phoneStream = new Response();
  manager.events(request(), pcStream, pcContext);
  manager.events(request(true), phoneStream, phone.context);
  try {
    assert.equal(phoneStream.events('snapshot')[0].data.deviceId, phone.snapshot.deviceId);
    await manager.updateState(pcContext, { trackId: 'song', queue: ['song', 'next-song'], qi: 0, playing: true, position: 42, volume: 0.6, shuffle: false, repeat: 'all' });
    await assert.rejects(manager.updateState(phone.context, { position: 7 }), error => error.statusCode === 409);
    const volumeCommand = await manager.command(phone.context, { type: 'volume', args: { volume: 0.25 } });
    assert.equal(pcStream.events('command').length, 1);
    assert.equal(phoneStream.events('command').length, 0);
    assert.equal(volumeCommand.command.targetDeviceId, pc.deviceId);
    const transfer = await manager.command(phone.context, { type: 'transfer', args: { targetDeviceId: phone.snapshot.deviceId } });
    assert.equal(transfer.playback.activeDeviceId, phone.snapshot.deviceId);
    assert.equal(transfer.playback.position, 42);
    assert.equal(transfer.playback.playing, true);
    assert.deepEqual(transfer.playback.queue, ['song', 'next-song']);
    assert.equal(pcStream.events('command').at(-1).data.id, phoneStream.events('command').at(-1).data.id);
    assert.notEqual(transfer.command.id, volumeCommand.command.id);
    await assert.rejects(manager.updateState(pcContext, { position: 8 }), error => error.statusCode === 409);
    assert.equal((await manager.updateState(phone.context, { position: 45 })).playback.position, 45);
    await assert.rejects(manager.command(phone.context, { type: 'play', args: { trackId: 'missing' } }), error => error.statusCode === 404);
  } finally { pcStream.end(); phoneStream.end(); }
});

test('presence, library updates and revocation propagate and revoke cookie access', async () => {
  const { manager } = fixture();
  const pc = manager.register(local, { deviceId: 'pc' });
  const context = manager.authorize(request(false, { 'x-acervo-device': pc.deviceId }), '/api/connect/info');
  const phone = await paired(manager);
  const pcStream = new Response(); const phoneStream = new Response();
  manager.events(request(), pcStream, context); manager.events(request(true), phoneStream, phone.context);
  try {
    manager.publishLibraryChange('imported', 'song');
    assert.equal(phoneStream.events('library-changed')[0].data.trackId, 'song');
    phoneStream.end();
    assert.equal(pcStream.events('devices').at(-1).data.devices.find(device => device.id === phone.snapshot.deviceId).online, false);
    await assert.rejects(manager.command(context, { type: 'transfer', args: { targetDeviceId: phone.snapshot.deviceId } }), error => error.statusCode === 409);
    assert.throws(() => manager.revoke(phone.context, pc.deviceId), error => error.statusCode === 403);
    const reopened = new Response(); manager.events(request(true), reopened, phone.context);
    manager.revoke(context, phone.snapshot.deviceId);
    assert.equal(reopened.events('revoked').length, 1);
    assert.equal(reopened.writableEnded, true);
    assert.throws(() => manager.authorize(request(true, { cookie: phone.cookie }), '/api/library'), error => error.statusCode === 401);
  } finally { pcStream.end(); phoneStream.end(); }
});

test('transfer advances the last playing position and caps it at the track duration', async () => {
  const { manager, advance } = fixture({ getTrack: async () => ({ duration: 50 }) });
  const pc = manager.register(local, { deviceId: 'pc' });
  const context = manager.authorize(request(false, { 'x-acervo-device': pc.deviceId }), '/api/connect/info');
  const phone = await paired(manager);
  await manager.updateState(context, { trackId: 'song', queue: ['song'], qi: 0, playing: true, position: 49 });
  advance(2000);
  const result = await manager.command(context, { type: 'transfer', args: { targetDeviceId: phone.snapshot.deviceId } });
  assert.equal(result.playback.position, 50);
  assert.equal(result.playback.playing, true);
});

test('playback telemetry and commands reject malformed fields and discard identity overrides', () => {
  const current = { queue: ['song'], qi: 0, trackId: 'song', playing: false };
  for (const value of [{ volume: 1.1 }, { volume: -0.1 }, { position: Infinity }, { playing: 'yes' }, { queue: ['../../secret'] }, { qi: 3 }, { repeat: 'random' }]) assert.throws(() => validatePlaybackPatch(value, current));
  assert.deepEqual(validatePlaybackPatch({ activeDeviceId: 'spoofed', revision: 999, position: 3 }, current), { position: 3 });
  assert.deepEqual(validatePlaybackPatch({ queue: [], qi: 0, trackId: null, playing: false }, current), { queue: [], qi: -1, trackId: null, playing: false });
  for (const value of [{ type: 'shell' }, { type: 'seek', args: { position: -1 } }, { type: 'volume', args: { volume: 2 } }, { type: 'shuffle', args: { shuffle: 'yes' } }, { type: 'play', args: { qi: 4, queue: ['song'] } }]) assert.throws(() => validateCommand(value));
  assert.deepEqual(validateCommand({ type: 'shuffle', args: { shuffle: true, targetDeviceId: 'spoofed' } }), { type: 'shuffle', args: { shuffle: true } });
  assert.deepEqual(validateCommand({ type: 'queue', args: { queue: ['song'], qi: 0, targetDeviceId: 'spoofed' } }), { type: 'queue', args: { queue: ['song'], qi: 0 } });
  for (const args of [{ queue: ['song'], qi: -1 }, { queue: ['song'], qi: 1 }, { queue: [], qi: 0 }, { queue: ['../file'], qi: 0 }, { queue: Array(1001).fill('song'), qi: 0 }]) assert.throws(() => validateCommand({ type: 'queue', args }));
});
