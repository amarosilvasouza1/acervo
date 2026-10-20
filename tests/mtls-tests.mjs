import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createConnectManager } from '../lib/connect.js';
import { loadTlsIdentity } from '../lib/tls.js';

const PC_PIN = '1234567890abcdef'.repeat(4);
const interfaces = () => ({ WiFi: [{ address: '192.168.10.20', internal: false }] });
const status = code => error => error.statusCode === code;
const asCookie = result => result.cookie.split(';')[0];

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'acervo-mtls-tests-'));
  t.after(async () => {
    const relative = path.relative(os.tmpdir(), directory);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(directory).startsWith('acervo-mtls-tests-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const identities = await Promise.all(['phone-a', 'phone-b'].map(name => loadTlsIdentity({ directory: path.join(directory, name) })));
  const deviceFile = path.join(directory, 'paired-phone.json');
  const create = overrides => createConnectManager({ networkInterfaces: interfaces, qrCode: async value => 'fixture:' + value,
    secureTransport: { port: 4311, pin: PC_PIN, requireClientIdentity: true, deviceFile }, ...overrides });
  function req({ identity, local = false, method = 'GET', headers = {}, encrypted = !local } = {}) {
    return { method, url: '/api/connect/info', headers: { host: (local ? 'localhost:4310' : '192.168.10.20:4311'), ...headers },
      socket: { remoteAddress: local ? '127.0.0.1' : '192.168.10.30', encrypted,
        getPeerCertificate: () => identity ? { raw: new crypto.X509Certificate(identity.cert).raw } : {} } };
  }
  function local(connect) { return connect.authorize(req({ local: true }), '/api/connect/info'); }
  async function pair(connect, identity = identities[0]) {
    const pairing = await connect.createPairing(local(connect));
    const claimRequest = req({ identity, method: 'POST' });
    const context = connect.authorize(claimRequest, '/api/connect/claim');
    return { pairing, result: connect.claim(context, { code: pairing.code, name: 'Meu telefone' }) };
  }
  return { directory, deviceFile, identities, create, req, local, pair };
}

test('mutual pairing requires TLS peer proof, binds one phone and ignores claimed identity headers', async t => {
  const f = await fixture(t); const connect = f.create();
  const pairing = await connect.createPairing(f.local(connect));
  assert.deepEqual(pairing.security, { type: 'mtls-pinned', pin: PC_PIN, mutual: true, exclusive: true });
  assert.equal(new URLSearchParams(new URL(pairing.url).hash.slice(1)).get('mutual'), '1');
  assert.throws(() => connect.authorize(f.req({ method: 'POST', headers: { 'x-acervo-client-pin': f.identities[0].spkiPin, 'x-forwarded-proto': 'https' } }), '/api/connect/claim'), status(401));
  const request = f.req({ identity: f.identities[0], method: 'POST' });
  const result = connect.claim(connect.authorize(request, '/api/connect/claim'), { code: pairing.code, name: 'Meu telefone' });
  assert.equal(result.snapshot.local, false); assert.equal(result.snapshot.admin, false);
  assert.equal(result.snapshot.security.phonePin, f.identities[0].spkiPin);
  assert.match(result.cookie, /; HttpOnly; SameSite=Strict; Max-Age=2592000; Secure$/);
  assert.throws(() => connect.claim(connect.authorize(request, '/api/connect/claim'), { code: pairing.code }), status(401));
  const next = await connect.createPairing(f.local(connect));
  const other = connect.authorize(f.req({ identity: f.identities[1], method: 'POST' }), '/api/connect/claim');
  assert.throws(() => connect.claim(other, { code: next.code }), status(409));
  const correct = connect.authorize(f.req({ identity: f.identities[0] }), '/api/library');
  assert.equal(correct.device.id, result.snapshot.deviceId);
  assert.throws(() => connect.authorize(f.req({ headers: { cookie: asCookie(result) } }), '/api/library'), status(401));
  assert.throws(() => connect.authorize(f.req({ identity: f.identities[1], headers: { cookie: asCookie(result), 'x-acervo-device': result.snapshot.deviceId } }), '/api/library'), status(401));
  assert.throws(() => connect.register(correct, { name: 'Fake PC' }), status(403));
});

test('only public certificate binding persists and correct phone reconnects after restart without cookies', async t => {
  const f = await fixture(t); const first = f.create(); const { result } = await f.pair(first);
  const text = await fs.readFile(f.deviceFile, 'utf8');
  const record = JSON.parse(text);
  assert.equal(record.phone.pin, f.identities[0].spkiPin);
  assert.equal(text.includes(asCookie(result).split('=')[1]), false);
  assert.equal(text.includes('PRIVATE KEY'), false);
  const second = f.create();
  const resumed = second.authorize(f.req({ identity: f.identities[0] }), '/api/library');
  assert.equal(resumed.device.id, result.snapshot.deviceId);
  assert.equal(resumed.local, false); assert.equal(resumed.device.admin, false);
  assert.throws(() => second.authorize(f.req({ identity: f.identities[1], headers: { cookie: asCookie(result) } }), '/api/library'), status(401));
  if (process.platform !== 'win32') assert.equal((await fs.stat(f.deviceFile)).mode & 0o777, 0o600);
});

test('revocation persists before granting another phone and blocks contexts already in flight', async t => {
  const f = await fixture(t); const connect = f.create(); const { result } = await f.pair(connect);
  const context = connect.authorize(f.req({ identity: f.identities[0] }), '/api/connect/command');
  connect.revoke(f.local(connect), result.snapshot.deviceId);
  assert.equal(JSON.parse(await fs.readFile(f.deviceFile, 'utf8')).phone, null);
  await assert.rejects(connect.command(context, { type: 'pause' }), status(401));
  assert.throws(() => f.create().authorize(f.req({ identity: f.identities[0] }), '/api/library'), status(401));
  const other = await f.pair(connect, f.identities[1]);
  assert.notEqual(other.result.snapshot.deviceId, result.snapshot.deviceId);
  assert.equal(other.result.snapshot.security.phonePin, f.identities[1].spkiPin);
  assert.throws(() => connect.authorize(f.req({ identity: f.identities[0], headers: { cookie: asCookie(result) } }), '/api/library'), status(401));
});

test('damaged or symbolic persisted phone identities fail closed without overwriting records', async t => {
  const f = await fixture(t);
  await fs.writeFile(f.deviceFile, '{broken');
  assert.throws(() => f.create(), /nenhuma identidade será substituída/);
  assert.equal(await fs.readFile(f.deviceFile, 'utf8'), '{broken');
  await fs.writeFile(f.deviceFile, JSON.stringify({ version: 1, phone: { id: 'phone', pin: 'bad' } }));
  assert.throws(() => f.create(), status(500));
});

test('storage failures do not create access and revocation failures close live phone streams', async t => {
  const f = await fixture(t); const connect = f.create(); const { result } = await f.pair(connect);
  const context = connect.authorize(f.req({ identity: f.identities[0] }), '/api/connect/events');
  const listeners = new Map(); let ended = false;
  const response = { destroyed: false, writableEnded: false, writeHead() {}, flushHeaders() {}, write() {},
    once(name, listener) { listeners.set(name, listener); }, end() { ended = true; this.writableEnded = true; listeners.get('close')?.(); } };
  connect.events({}, response, context);
  await fs.rename(f.deviceFile, f.deviceFile + '.original');
  await fs.mkdir(f.deviceFile);
  assert.throws(() => connect.revoke(f.local(connect), result.snapshot.deviceId), status(503));
  assert.equal(ended, true);
  assert.throws(() => connect.authorize(f.req({ identity: f.identities[0] }), '/api/library'), status(503));
  assert.equal(JSON.parse(await fs.readFile(f.deviceFile + '.original', 'utf8')).phone.pin, f.identities[0].spkiPin);
});

test('the first claim cannot grant access when the public identity cannot be committed', async t => {
  const f = await fixture(t); const connect = f.create();
  const owner = f.local(connect);
  const pairing = await connect.createPairing(owner);
  const req = f.req({ identity: f.identities[0], method: 'POST' });
  const context = connect.authorize(req, '/api/connect/claim');
  await fs.mkdir(f.deviceFile);
  assert.throws(() => connect.claim(context, { code: pairing.code }), status(503));
  assert.throws(() => connect.authorize(f.req({ identity: f.identities[0] }), '/api/library'), status(503));
  assert.equal(connect.snapshot().devices.length, 0);
  assert.deepEqual(await fs.readdir(f.deviceFile), []);
  await fs.rmdir(f.deviceFile);
  assert.throws(() => connect.claim(context, { code: pairing.code }), status(503), 'A request authorized before the failure cannot resume writes after repair');
  assert.throws(() => connect.register(owner, { name: 'Delayed PC request' }), status(503));
  await assert.rejects(fs.access(f.deviceFile));
});

test('expired or not-yet-valid certificates cannot authenticate even with a matching public key', async t => {
  const f = await fixture(t); const connect = f.create(); await f.pair(connect);
  const cert = new crypto.X509Certificate(f.identities[0].cert);
  for (const now of [Date.parse(cert.validFrom) - 1000, Date.parse(cert.validTo) + 1000]) {
    const restarted = f.create({ now: () => now });
    assert.throws(() => restarted.authorize(f.req({ identity: f.identities[0] }), '/api/library'), status(401));
  }
});

test('public endpoints allow only their actual TLS socket and exact configured authority', async t => {
  const f = await fixture(t);
  const connect = f.create({ secureTransport: { port: 4311, pin: PC_PIN, requireClientIdentity: true,
    deviceFile: f.deviceFile, publicEndpoint: 'https://music.example.test' } });
  const pairing = await connect.createPairing(f.local(connect));
  assert.equal(new URL(pairing.url).origin, 'https://music.example.test');
  assert.equal(pairing.candidates.length, 2);
  assert.equal(connect.snapshot(f.local(connect)).security.publicEndpoint, 'https://music.example.test');
  const req = f.req({ identity: f.identities[0], method: 'POST', headers: { host: 'music.example.test', origin: 'https://music.example.test' } });
  req.socket.remoteAddress = '203.0.113.40';
  const result = connect.claim(connect.authorize(req, '/api/connect/claim'), { code: pairing.code });
  assert.equal(result.snapshot.admin, false);
  assert.equal(Object.hasOwn(result.snapshot.security, 'publicEndpoint'), false);
  req.method = 'GET';
  assert.equal(connect.authorize(req, '/api/library').device.id, result.snapshot.deviceId);
  for (const host of ['attacker.example.test', 'music.example.test:4311', '192.168.10.20:4311']) {
    const hostile = { ...req, headers: { host }, socket: { ...req.socket } };
    assert.throws(() => connect.authorize(hostile, '/api/library'), status(403));
  }
  const plaintext = { ...req, socket: { ...req.socket, encrypted: false }, headers: { host: 'music.example.test',
    'x-forwarded-proto': 'https', 'x-forwarded-for': '127.0.0.1' } };
  assert.throws(() => connect.authorize(plaintext, '/api/library'), status(426));
});

test('public endpoint configuration refuses URL credentials, paths, fragments and non-mutual mode', async t => {
  const f = await fixture(t);
  for (const publicEndpoint of ['http://music.example.test', 'https://music.example.test/music', 'https://user:pass@music.example.test',
    'https://music.example.test/#key', 'https://music.example.test/?q=1']) {
    assert.throws(() => f.create({ secureTransport: { port: 4311, pin: PC_PIN, requireClientIdentity: true, deviceFile: f.deviceFile, publicEndpoint } }), status(500));
  }
  assert.throws(() => f.create({ secureTransport: { port: 4311, pin: PC_PIN, publicEndpoint: 'https://music.example.test' } }), status(500));
});

test('revocation cancels active remote HTTP bodies, leaves finished responses and local owner intact', async t => {
  const f = await fixture(t); const connect = f.create(); const { result } = await f.pair(connect);
  const context = connect.authorize(f.req({ identity: f.identities[0] }), '/api/stream/song');
  function response() {
    const value = new EventEmitter(); value.destroyed = false;
    value.destroy = () => { value.destroyed = true; value.emit('close'); };
    return value;
  }
  const audio = response(); const completed = response(); const owner = response();
  connect.trackResponse({ url: '/api/stream/song' }, audio, context);
  connect.trackResponse({ url: '/api/library' }, completed, context); completed.emit('finish');
  connect.trackResponse({ url: '/api/library' }, owner, f.local(connect));
  connect.revoke(f.local(connect), result.snapshot.deviceId);
  assert.equal(audio.destroyed, true);
  assert.equal(completed.destroyed, false);
  assert.equal(owner.destroyed, false);
  assert.throws(() => connect.trackResponse({ url: '/api/stream/song' }, response(), context), status(401));
});

test('fresh QR invitations contain 32 random bytes and only the newest one can bind a phone', async t => {
  const f = await fixture(t); const connect = f.create(); const owner = f.local(connect);
  const codes = [];
  for (let index = 0; index < 32; index++) {
    const pairing = await connect.createPairing(owner);
    assert.match(pairing.code, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(pairing.code, 'base64url').length, 32);
    assert.equal(pairing.expiresAt > Date.now(), true);
    assert.equal(pairing.expiresAt <= Date.now() + 5 * 60 * 1000, true);
    assert.equal(new URLSearchParams(new URL(pairing.url).hash.slice(1)).get('pair'), pairing.code);
    codes.push(pairing.code);
  }
  assert.equal(new Set(codes).size, codes.length);
  const claimContext = connect.authorize(f.req({ identity: f.identities[0], method: 'POST' }), '/api/connect/claim');
  for (const code of codes.slice(0, 3)) assert.throws(() => connect.claim(claimContext, { code }), status(401));
  const result = connect.claim(claimContext, { code: codes.at(-1) });
  assert.equal(result.snapshot.security.pcPin, PC_PIN, 'Generating invitations does not rotate the PC identity');
  const persisted = await fs.readFile(f.deviceFile, 'utf8');
  const publicState = JSON.stringify(connect.snapshot(owner));
  for (const code of codes) {
    assert.equal(persisted.includes(code), false);
    assert.equal(publicState.includes(code), false);
  }
  assert.throws(() => connect.claim(claimContext, { code: codes.at(-1) }), status(401));
});

test('an older QR still rendering cannot replace the latest invitation', async t => {
  const f = await fixture(t); const pending = [];
  const connect = f.create({ qrCode: url => new Promise(resolve => pending.push({ url, resolve })) });
  const owner = f.local(connect);
  const olderPromise = connect.createPairing(owner);
  const olderRejected = assert.rejects(olderPromise, status(409));
  const newerPromise = connect.createPairing(owner);
  assert.equal(pending.length, 2);
  pending[1].resolve('fixture-new');
  const newer = await newerPromise;
  pending[0].resolve('fixture-old');
  await olderRejected;
  const olderCode = new URLSearchParams(new URL(pending[0].url).hash.slice(1)).get('pair');
  const remote = connect.authorize(f.req({ identity: f.identities[0], method: 'POST' }), '/api/connect/claim');
  assert.throws(() => connect.claim(remote, { code: olderCode }), status(401));
  assert.equal(connect.claim(remote, { code: newer.code }).snapshot.security.phonePin, f.identities[0].spkiPin);
});

test('starting QR regeneration invalidates the displayed invitation even while the new image renders', async t => {
  const f = await fixture(t); let resume;
  let delayed = false;
  const connect = f.create({ qrCode: async url => delayed ? new Promise(resolve => { resume = () => resolve('fixture-new'); }) : 'fixture:' + url });
  const owner = f.local(connect); const first = await connect.createPairing(owner);
  delayed = true;
  const secondPromise = connect.createPairing(owner);
  const remote = connect.authorize(f.req({ identity: f.identities[0], method: 'POST' }), '/api/connect/claim');
  assert.throws(() => connect.claim(remote, { code: first.code }), status(401));
  resume();
  const second = await secondPromise;
  assert.notEqual(second.code, first.code);
  assert.equal(connect.claim(remote, { code: second.code }).snapshot.security.phonePin, f.identities[0].spkiPin);
});

test('QR expiry and phone revocation cannot revive an invitation that was already rendering', async t => {
  const f = await fixture(t); let clock = Date.now(); let resume; let delayed = false;
  const connect = f.create({ now: () => clock,
    qrCode: async url => delayed ? new Promise(resolve => { resume = () => resolve('fixture'); }) : 'fixture:' + url });
  const owner = f.local(connect);
  const expired = await connect.createPairing(owner);
  clock = expired.expiresAt;
  const remote = connect.authorize(f.req({ identity: f.identities[0], method: 'POST' }), '/api/connect/claim');
  assert.throws(() => connect.claim(remote, { code: expired.code }), status(401));
  const current = await connect.createPairing(owner);
  const paired = connect.claim(remote, { code: current.code });
  delayed = true;
  const rendering = connect.createPairing(owner);
  const rejected = assert.rejects(rendering, status(409));
  connect.revoke(owner, paired.snapshot.deviceId);
  resume(); await rejected;
  assert.throws(() => connect.authorize(f.req({ identity: f.identities[0] }), '/api/library'), status(401));
});
