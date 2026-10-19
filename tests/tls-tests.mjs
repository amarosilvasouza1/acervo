import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadTlsIdentity } from '../lib/tls.js';
import { createConnectManager, assertSameOrigin } from '../lib/connect.js';

const PIN = '1234567890abcdef'.repeat(4);
const interfaces = () => ({ WiFi: [{ address: '192.168.10.20', internal: false }], Loopback: [{ address: '127.0.0.1', internal: true }] });
const rejected = code => error => error.statusCode === code;
const cookie = result => result.cookie.split(';')[0];
function request({ tls = false, local = false, method = 'GET', headers = {} } = {}) {
  return { method, url: '/api/connect/info', socket: { remoteAddress: local ? '127.0.0.1' : '192.168.10.30', encrypted: tls },
    headers: { host: (local ? 'localhost' : '192.168.10.20') + ':' + (tls ? '4311' : '4310'), ...headers } };
}
function manager(options = {}) {
  return createConnectManager({ secureTransport: { port: 4311, pin: PIN }, networkInterfaces: interfaces,
    qrCode: async value => 'data:image/png;base64,' + Buffer.from(value).toString('base64'), ...options });
}
async function temp(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'acervo-tls-tests-'));
  t.after(async () => {
    const relative = path.relative(os.tmpdir(), directory);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(directory).startsWith('acervo-tls-tests-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test('TLS identity persists the original P-256 key and verifies the QR pin against the certificate', async t => {
  const directory = path.join(await temp(t), 'identity');
  const first = await loadTlsIdentity({ directory });
  const certificate = new crypto.X509Certificate(first.cert);
  assert.equal(certificate.publicKey.asymmetricKeyType, 'ec');
  assert.equal(certificate.publicKey.asymmetricKeyDetails.namedCurve, 'prime256v1');
  assert.equal(certificate.ca, false);
  assert.equal(certificate.checkPrivateKey(crypto.createPrivateKey(first.key)), true);
  assert.equal(certificate.verify(certificate.publicKey), true);
  assert.equal(first.spkiPin, crypto.createHash('sha256').update(certificate.publicKey.export({ type: 'spki', format: 'der' })).digest('hex'));
  assert.equal(first.fingerprint, certificate.fingerprint256.replaceAll(':', '').toLowerCase());
  assert.ok(Date.parse(certificate.validTo) - Date.now() > 9 * 365 * 86400000);
  const reloaded = await loadTlsIdentity({ directory, opensslPath: path.join(directory, 'missing-openssl') });
  assert.equal(first.spkiPin, reloaded.spkiPin);
  assert.deepEqual(first.key, reloaded.key);
  assert.deepEqual(first.cert, reloaded.cert);
  if (process.platform !== 'win32') assert.equal((await fs.stat(path.join(directory, 'private-key.pem'))).mode & 0o777, 0o600);
});

test('a damaged or incomplete persisted TLS identity is rejected without replacing it', async t => {
  const directory = path.join(await temp(t), 'identity');
  const first = await loadTlsIdentity({ directory });
  await fs.writeFile(path.join(directory, 'certificate.pem'), 'damaged-certificate');
  await assert.rejects(loadTlsIdentity({ directory }), /não será substituída/);
  assert.equal(await fs.readFile(path.join(directory, 'certificate.pem'), 'utf8'), 'damaged-certificate');
  assert.deepEqual(await fs.readFile(path.join(directory, 'private-key.pem')), first.key);
  await fs.unlink(path.join(directory, 'certificate.pem'));
  await assert.rejects(loadTlsIdentity({ directory }), /não será substituída/);
  await assert.rejects(fs.access(path.join(directory, 'certificate.pem')));
});

test('identity pin metadata cannot silently select a different key and failed generation leaves no partial identity', async t => {
  const parent = await temp(t);
  const directory = path.join(parent, 'identity');
  await loadTlsIdentity({ directory });
  await fs.writeFile(path.join(directory, 'identity.json'), JSON.stringify({ version: 1, spkiPin: PIN, fingerprint: PIN }));
  await assert.rejects(loadTlsIdentity({ directory }), /identidade segura/);
  const missing = path.join(parent, 'never-created');
  await assert.rejects(loadTlsIdentity({ directory: missing, opensslPath: path.join(parent, 'missing-openssl') }), /OpenSSL não foi encontrado/);
  await assert.rejects(fs.access(missing));
  assert.deepEqual((await fs.readdir(parent)).sort(), ['identity']);
});

test('secure local mode rejects plaintext LAN APIs before reading a cookie or pairing token', async () => {
  const connect = manager();
  for (const pathname of ['/api/library', '/api/stream/song', '/api/cover/song', '/api/connect/info', '/api/connect/events', '/api/connect/claim']) {
    const req = request({ method: pathname.endsWith('/claim') ? 'POST' : 'GET', headers: { cookie: 'acervo_connect=stolen', 'x-forwarded-proto': 'https', 'x-forwarded-for': '127.0.0.1' } });
    assert.throws(() => connect.authorize(req, pathname), rejected(426));
  }
  for (const pathname of ['/', '/app.js', '/api/connect/config', '/api/app/version']) {
    const context = connect.authorize(request({ headers: { cookie: 'acervo_connect=stolen' } }), pathname);
    assert.equal(context.local, false); assert.equal(context.device, null);
  }
  assert.equal(connect.authorize(request({ local: true }), '/api/library').local, true);
  assert.throws(() => connect.authorize(request({ tls: true, local: true }), '/api/library'), rejected(401));
  assert.equal(connect.authorize(request({ tls: true, local: true }), '/').local, false);
});

test('secure QR links pin the PC identity, issue Secure cookies and reject reuse or plaintext replay', async () => {
  const connect = manager();
  const local = connect.authorize(request({ local: true }), '/api/connect/info');
  const pairing = await connect.createPairing(local);
  assert.equal(pairing.url, 'https://192.168.10.20:4311/#pair=' + pairing.code + '&spki=' + PIN);
  assert.deepEqual(pairing.security, { type: 'tls-pinned', pin: PIN });
  const req = request({ tls: true, method: 'POST', headers: { origin: 'https://192.168.10.20:4311' } });
  const remote = connect.authorize(req, '/api/connect/claim');
  const paired = connect.claim(remote, { code: pairing.code, name: 'Phone' }, req.socket.remoteAddress);
  assert.match(paired.cookie, /; Secure$/);
  assert.equal(connect.authorize(request({ tls: true, headers: { cookie: cookie(paired) } }), '/api/library').device.id, paired.snapshot.deviceId);
  assert.throws(() => connect.authorize(request({ headers: { cookie: cookie(paired) } }), '/api/library'), rejected(426));
  assert.throws(() => connect.claim(remote, { code: pairing.code }, req.socket.remoteAddress), rejected(401));
  const next = await connect.createPairing(local);
  assert.throws(() => connect.claim({ local: false, secure: false }, { code: next.code }, '192.168.10.30'), rejected(426));
  const loopbackReq = request({ tls: true, local: true, method: 'POST' });
  assert.doesNotThrow(() => connect.claim(connect.authorize(loopbackReq, '/api/connect/claim'), { code: next.code }, '127.0.0.1'));
});

test('TLS origin and host validation use the actual encrypted socket and configured secure port', () => {
  const connect = manager();
  for (const host of ['192.168.10.20:4310', 'attacker.test:4311', '192.168.10.20:80']) {
    assert.throws(() => connect.authorize(request({ tls: true, headers: { host } }), '/'), rejected(403));
  }
  for (const origin of ['http://192.168.10.20:4311', 'https://192.168.10.20:4310', 'https://attacker.test:4311', 'null']) {
    assert.throws(() => connect.authorize(request({ tls: true, method: 'POST', headers: { origin } }), '/api/connect/claim'), rejected(403));
  }
  assert.doesNotThrow(() => assertSameOrigin(request({ tls: true, method: 'POST', headers: { origin: 'https://192.168.10.20:4311' } })));
  assert.throws(() => assertSameOrigin(request({ method: 'POST', headers: { origin: 'https://192.168.10.20:4310', 'x-forwarded-proto': 'https' } })), rejected(403));
  for (const secureTransport of [{ port: 0, pin: PIN }, { port: 4311, pin: 'bad' }, { port: '4311', pin: PIN }, null]) assert.throws(() => manager({ secureTransport }), rejected(500));
});
