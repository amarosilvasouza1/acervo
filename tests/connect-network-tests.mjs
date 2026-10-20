import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createConnectNetwork, publicEndpointOrigin } from '../lib/connect-network.js';
import { createConnectManager } from '../lib/connect.js';

const PIN = '1234567890abcdef'.repeat(4);
const rejected = statusCode => error => error.statusCode === statusCode;
const interfaces = () => ({ WiFi: [{ address: '192.168.10.20', internal: false }] });

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'acervo-connect-network-'));
  t.after(async () => {
    const relative = path.relative(os.tmpdir(), directory);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(directory).startsWith('acervo-connect-network-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const file = path.join(directory, 'connect-network.json');
  const create = (extra = {}) => createConnectManager({ networkInterfaces: interfaces, qrCode: async value => 'fixture:' + value,
    secureTransport: { port: 4311, pin: PIN, requireClientIdentity: true, deviceFile: path.join(directory, 'paired-phone.json'), endpointFile: file }, ...extra });
  const ownerRequest = { method: 'POST', url: '/api/connect/endpoint', headers: { host: 'localhost:4310', origin: 'http://localhost:4310' }, socket: { remoteAddress: '127.0.0.1', encrypted: false } };
  const owner = connect => connect.authorize(ownerRequest, '/api/connect/endpoint');
  return { directory, file, create, owner, ownerRequest };
}

test('public endpoints accept canonical HTTPS authorities and reject URL tricks or additional components', () => {
  for (const [input, expected] of [['https://music.example.test', 'https://music.example.test'],
    ['https://MUSIC.example.test:443/', 'https://music.example.test'], ['https://203.0.113.10:4311', 'https://203.0.113.10:4311'],
    ['https://[2001:db8::1]:4311/', 'https://[2001:db8::1]:4311']]) assert.equal(publicEndpointOrigin(input).origin, expected);
  assert.equal(publicEndpointOrigin(null), null); assert.equal(publicEndpointOrigin(''), null);
  for (const input of [undefined, {}, [], 1, true, 'http://music.example.test', 'ftp://music.example.test', 'https://user:pass@music.example.test',
    'https://music.example.test/path', 'https://music.example.test/?q=x', 'https://music.example.test/#token',
    'https://music.example.test/path/..', 'https://music.example.test/%2e%2e',
    'https://music.example.test?', 'https://music.example.test#', ' https://music.example.test', 'https://music.example.test ',
    'https://music.example.test\\@other.example.test', 'https://music.example.test\n', 'https://' + 'a'.repeat(2048)]) {
    assert.throws(() => publicEndpointOrigin(input), rejected(400), String(input));
  }
});

test('saved endpoints survive restart, can be cleared and contain no credentials or cryptographic keys', async t => {
  const f = await fixture(t);
  const first = createConnectNetwork({ file: f.file });
  assert.deepEqual(first.snapshot(), { publicEndpoint: null, publicEndpointSource: null, publicEndpointEditable: true });
  first.update('https://MUSIC.example.test:443/');
  assert.deepEqual(first.snapshot(), { publicEndpoint: 'https://music.example.test', publicEndpointSource: 'saved', publicEndpointEditable: true });
  assert.deepEqual(JSON.parse(await fs.readFile(f.file, 'utf8')), { version: 1, publicEndpoint: 'https://music.example.test' });
  assert.deepEqual(createConnectNetwork({ file: f.file }).snapshot(), first.snapshot());
  if (process.platform !== 'win32') assert.equal((await fs.stat(f.file)).mode & 0o777, 0o600);
  first.update(null);
  assert.deepEqual(createConnectNetwork({ file: f.file }).snapshot(), { publicEndpoint: null, publicEndpointSource: null, publicEndpointEditable: true });
  assert.deepEqual(JSON.parse(await fs.readFile(f.file, 'utf8')), { version: 1, publicEndpoint: null });
});

test('environment endpoint overrides a saved address and locks changes without rewriting the saved record', async t => {
  const f = await fixture(t);
  createConnectNetwork({ file: f.file }).update('https://saved.example.test');
  const before = await fs.readFile(f.file, 'utf8');
  const network = createConnectNetwork({ file: f.file, publicEndpoint: 'https://environment.example.test:8443' });
  assert.deepEqual(network.snapshot(), { publicEndpoint: 'https://environment.example.test:8443', publicEndpointSource: 'environment', publicEndpointEditable: false });
  assert.throws(() => network.update('https://other.example.test'), rejected(409));
  assert.throws(() => network.update(null), rejected(409));
  assert.equal(await fs.readFile(f.file, 'utf8'), before);
  const unconfigured = createConnectNetwork();
  assert.equal(unconfigured.snapshot().publicEndpointEditable, false);
  assert.throws(() => unconfigured.update('https://other.example.test'), rejected(409));
});

test('damaged, oversized or nonregular configuration fails closed and is not overwritten', async t => {
  const f = await fixture(t);
  for (const text of ['{broken', JSON.stringify({ version: 2, publicEndpoint: null }), JSON.stringify({ version: 1 }),
    JSON.stringify({ version: 1, publicEndpoint: '' }), JSON.stringify({ version: 1, publicEndpoint: 'http://music.example.test' }),
    'x'.repeat(4097)]) {
    await fs.writeFile(f.file, text);
    assert.throws(() => createConnectNetwork({ file: f.file }), rejected(500));
    assert.equal(await fs.readFile(f.file, 'utf8'), text);
  }
  await fs.unlink(f.file); await fs.mkdir(f.file);
  assert.throws(() => createConnectNetwork({ file: f.file }), rejected(500));
  assert.throws(() => createConnectNetwork({ file: 'relative-file.json' }), rejected(500));
  assert.throws(() => createConnectNetwork({ file: f.file, publicEndpoint: 'https://environment.example.test' }), rejected(500));
});

test('symbolic endpoint files are refused rather than reading or replacing their target', async t => {
  const f = await fixture(t); const target = path.join(f.directory, 'original.json');
  const content = JSON.stringify({ version: 1, publicEndpoint: 'https://target.example.test' });
  await fs.writeFile(target, content);
  try { await fs.symlink(target, f.file, 'file'); }
  catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) { t.skip('Windows file symlinks require Developer Mode or symlink privilege. Nonregular configuration is tested separately.'); return; }
    throw error;
  }
  assert.throws(() => createConnectNetwork({ file: f.file }), rejected(500));
  assert.equal(await fs.readFile(target, 'utf8'), content);
});

test('a failed atomic update preserves the active address and cleans its temporary file', async t => {
  const f = await fixture(t); const network = createConnectNetwork({ file: f.file });
  network.update('https://previous.example.test');
  await fs.rename(f.file, f.file + '.original'); await fs.mkdir(f.file);
  assert.throws(() => network.update('https://replacement.example.test'), rejected(503));
  assert.deepEqual(network.snapshot(), { publicEndpoint: 'https://previous.example.test', publicEndpointSource: 'saved', publicEndpointEditable: true });
  assert.equal(JSON.parse(await fs.readFile(f.file + '.original', 'utf8')).publicEndpoint, 'https://previous.example.test');
  assert.equal((await fs.readdir(f.directory)).some(file => file.endsWith('.tmp')), false);
});

test('only the loopback PC owner can change endpoints and the full protected snapshot reflects durable updates', async t => {
  const f = await fixture(t); const connect = f.create({ internetRelayStatus: () => ({ status: 'offline' }) }); const owner = f.owner(connect);
  const state = connect.updateEndpoint(owner, { publicEndpoint: 'https://public.example.test:8443' });
  assert.equal(state.local, true); assert.equal(state.admin, true);
  assert.equal(state.security.publicEndpoint, 'https://public.example.test:8443');
  assert.equal(state.security.publicEndpointSource, 'saved'); assert.equal(state.security.publicEndpointEditable, true);
  assert.equal(state.security.internetRelaySupported, true); assert.deepEqual(state.security.internetRelay, { status: 'offline' });
  const renewed = f.create();
  assert.equal(renewed.snapshot(f.owner(renewed)).security.publicEndpoint, 'https://public.example.test:8443');
  const remoteState = connect.snapshot({ local: false, device: { id: 'phone' } });
  for (const field of ['publicEndpoint', 'publicEndpointSource', 'publicEndpointEditable', 'internetRelaySupported', 'internetRelay']) {
    assert.equal(Object.hasOwn(remoteState.security, field), false);
  }
  assert.throws(() => connect.updateEndpoint({ local: false }, { publicEndpoint: null }), rejected(403));
  assert.throws(() => connect.updateEndpoint(owner, {}), rejected(400));
  assert.throws(() => connect.updateEndpoint(owner, { publicEndpoint: 'http://invalid.example.test' }), rejected(400));
  const cloud = createConnectManager({ mode: 'cloud', publicOrigin: 'https://cloud.example.test', adminPassword: 'isolated-password-at-least-16' });
  assert.throws(() => cloud.updateEndpoint({ local: true }, { publicEndpoint: null }), rejected(403));
});

test('endpoint HTTP handling refuses remote callers before consuming a body and rechecks the owner after reading', async t => {
  const f = await fixture(t); const connect = f.create(); let read = false; let sent;
  const readBody = async () => { read = true; return { publicEndpoint: 'https://public.example.test' }; };
  await assert.rejects(connect.handle(f.ownerRequest, {}, '/api/connect/endpoint', { local: false }, readBody, () => {}), rejected(403));
  assert.equal(read, false);
  const owner = f.owner(connect);
  await assert.rejects(connect.handle(f.ownerRequest, {}, '/api/connect/endpoint', owner, async () => {
    owner.local = false; return { publicEndpoint: 'https://public.example.test' };
  }, () => {}), rejected(403));
  assert.equal(connect.snapshot(f.owner(connect)).security.publicEndpoint, null);
  await connect.handle(f.ownerRequest, {}, '/api/connect/endpoint', f.owner(connect), readBody, (_res, status, data) => { sent = { status, data }; });
  assert.equal(sent.status, 200); assert.equal(sent.data.security.publicEndpoint, 'https://public.example.test');
});

test('changing an endpoint invalidates displayed and still-rendering QR invitations', async t => {
  const f = await fixture(t); const waiting = []; let delayed = false;
  const connect = f.create({ qrCode: async url => delayed ? new Promise(resolve => waiting.push({ url, resolve })) : 'fixture:' + url });
  const owner = f.owner(connect); const displayed = await connect.createPairing(owner);
  delayed = true;
  const pending = connect.createPairing(owner);
  const rejectedPending = assert.rejects(pending, rejected(409));
  connect.updateEndpoint(owner, { publicEndpoint: 'https://public.example.test' });
  waiting[0].resolve('fixture'); await rejectedPending;
  const phone = { local: false, secure: true, peerPin: 'a'.repeat(64), address: '192.168.10.30' };
  assert.throws(() => connect.claim(phone, { code: displayed.code }), rejected(401));
  delayed = false;
  const latest = await connect.createPairing(owner);
  assert.equal(new URL(latest.url).origin, 'https://public.example.test');
  assert.equal(latest.candidates.length, 2);
  assert.equal(connect.claim(phone, { code: latest.code }).snapshot.security.phonePin, phone.peerPin);
});

test('failed persistence keeps the previous QR and routing address usable', async t => {
  const f = await fixture(t); const connect = f.create(); const owner = f.owner(connect);
  connect.updateEndpoint(owner, { publicEndpoint: 'https://previous.example.test' });
  const pairing = await connect.createPairing(owner);
  await fs.rename(f.file, f.file + '.original'); await fs.mkdir(f.file);
  assert.throws(() => connect.updateEndpoint(owner, { publicEndpoint: 'https://replacement.example.test' }), rejected(503));
  assert.equal(connect.snapshot(owner).security.publicEndpoint, 'https://previous.example.test');
  const phone = { local: false, secure: true, peerPin: 'a'.repeat(64), address: '192.168.10.30' };
  assert.equal(connect.claim(phone, { code: pairing.code }).snapshot.security.phonePin, phone.peerPin);
});
