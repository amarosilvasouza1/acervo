import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { lanAddresses } from '../lib/connect.js';

// This fixture owns both servers and every file it writes. No user library is opened.
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'acervo-tls-http-'));
const dataDirectory = path.join(directory, 'data');
const identityDirectory = path.join(dataDirectory, 'identity');
const serverFile = fileURLToPath(new URL('../server.js', import.meta.url));
const noNetworkFile = path.join(directory, 'no-network.mjs');
const [port, securePort] = await availablePorts();
const origin = 'http://127.0.0.1:' + port;
const secureOrigin = 'https://127.0.0.1:' + securePort;
const lanAddress = lanAddresses()[0]?.address;
const trackId = 'tls-fixture-track';
const audioBytes = Buffer.from('Artificial audio fixture. These bytes are not a real song. 0123456789');
const libraryText = JSON.stringify({ version: 1, tracks: [{ id: trackId, title: 'TLS fixture', artist: 'Isolated test artist', duration: 80, addedAt: '2026-10-19T00:00:00Z', plays: 0 }], listeningHistory: [] });
const streams = new Set();
const outputs = [];
let child = null;
let childClosed = null;
let output = '';
let certificate;
let trustedPin;

async function availablePorts() {
  const probes = [net.createServer(), net.createServer()];
  try {
    for (const probe of probes) await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '0.0.0.0', resolve); });
    return probes.map(probe => probe.address().port);
  } finally {
    await Promise.all(probes.filter(probe => probe.listening).map(probe => new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()))));
  }
}

function pinChecker(expected) {
  return (hostname, peer) => {
    const identityError = tls.checkServerIdentity(hostname, peer);
    if (identityError) return identityError;
    const actual = crypto.createHash('sha256').update(new crypto.X509Certificate(peer.raw).publicKey.export({ type: 'spki', format: 'der' })).digest();
    const pin = Buffer.from(expected, 'hex');
    if (pin.length !== actual.length || !crypto.timingSafeEqual(pin, actual)) return Object.assign(new Error('Pinned PC identity mismatch'), { code: 'ACERVO_PIN_MISMATCH' });
  };
}

function options(encrypted, pathname, { method = 'GET', body, cookie, deviceId, headers = {}, address = '127.0.0.1', trust = true, pin = trustedPin } = {}) {
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  const base = encrypted ? secureOrigin : origin;
  return { payload, request: { hostname: address, port: encrypted ? securePort : port, path: pathname, method, agent: false,
    ...(encrypted ? { rejectUnauthorized: true, ...(trust ? { ca: certificate } : {}), ...(pin ? { checkServerIdentity: pinChecker(pin) } : {}) } : {}),
    headers: { ...(method !== 'GET' ? { Origin: base } : {}), ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
      ...(cookie ? { Cookie: cookie } : {}), ...(deviceId ? { 'X-Acervo-Device': deviceId } : {}), ...headers } } };
}

function request(encrypted, pathname, configuration = {}) {
  const prepared = options(encrypted, pathname, configuration);
  return new Promise((resolve, reject) => {
    const req = (encrypted ? https : http).request(prepared.request, res => {
      const chunks = [];
      const negotiated = encrypted ? res.socket.getProtocol() : null;
      res.on('data', chunk => chunks.push(chunk)); res.once('error', reject);
      res.once('end', () => {
        const bytes = Buffer.concat(chunks);
        let data = null;
        if (String(res.headers['content-type']).includes('application/json')) {
          try { data = JSON.parse(bytes.toString('utf8')); } catch (error) { reject(error); return; }
        }
        resolve({ status: res.statusCode, headers: res.headers, bytes, data, protocol: negotiated });
      });
    });
    req.setTimeout(8000, () => req.destroy(new Error('TLS HTTP fixture request timed out: ' + pathname)));
    req.once('error', reject); req.end(prepared.payload);
  });
}

async function until(predicate, message = 'Expected TLS fixture event was not received') {
  for (let index = 0; index < 150; index++) {
    if (predicate()) return;
    if (child && child.exitCode !== null) throw new Error(output || 'TLS fixture exited unexpectedly');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(message);
}

async function events(encrypted, pathname, configuration = {}) {
  const prepared = options(encrypted, pathname, configuration);
  const stream = { seen: [], req: null, res: null, error: null, protocol: null, closing: false };
  streams.add(stream);
  stream.closed = new Promise(resolve => {
    const req = (encrypted ? https : http).request(prepared.request, res => {
      stream.res = res; stream.status = res.statusCode; stream.protocol = encrypted ? res.socket.getProtocol() : null;
      let pending = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        pending += chunk;
        const frames = pending.split('\n\n'); pending = frames.pop();
        for (const frame of frames) {
          const type = frame.match(/^event: (.+)$/m)?.[1];
          const data = frame.match(/^data: (.+)$/m)?.[1];
          if (type && data) {
            try { stream.seen.push({ type, data: JSON.parse(data) }); }
            catch (error) { stream.error = error; }
          }
        }
      });
      res.once('error', error => { if (!stream.closing) stream.error = error; });
      res.once('close', resolve);
    });
    stream.req = req;
    req.once('error', error => { if (!stream.closing) stream.error = error; resolve(); });
    req.end();
  });
  await until(() => stream.seen.some(event => event.type === 'snapshot') || stream.error || stream.status && stream.status !== 200);
  if (stream.error) throw stream.error;
  assert.equal(stream.status, 200);
  return stream;
}

async function closeStreams() {
  for (const stream of streams) { stream.closing = true; stream.res?.destroy(); stream.req?.destroy(); }
  await Promise.allSettled([...streams].map(stream => stream.closed));
  streams.clear();
}

async function start() {
  output = '';
  child = spawn(process.execPath, ['--import', pathToFileURL(noNetworkFile).href, serverFile], { cwd: directory, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ACERVO_DATA_DIR: dataDirectory, ACERVO_MODE: 'local', ACERVO_HOST: '0.0.0.0',
      PORT: String(port), ACERVO_HTTPS_PORT: String(securePort), ACERVO_TRUST_TAILSCALE: '0' } });
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  childClosed = new Promise(resolve => child.once('close', resolve));
  let ready = false;
  for (let index = 0; index < 100; index++) {
    if (child.exitCode !== null) throw new Error(output || 'TLS fixture server exited');
    try { ready = (await request(false, '/api/health')).status === 200; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, output || 'TLS fixture starts both listeners');
  certificate = await fs.readFile(path.join(identityDirectory, 'certificate.pem'));
  trustedPin = crypto.createHash('sha256').update(new crypto.X509Certificate(certificate).publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
}

async function stop() {
  await closeStreams();
  if (!child) return;
  child.kill(); await childClosed; outputs.push(output); child = null; childClosed = null;
}

try {
  await fs.mkdir(path.join(dataDirectory, 'tracks'), { recursive: true });
  await fs.writeFile(path.join(dataDirectory, 'library.json'), libraryText);
  await fs.writeFile(path.join(dataDirectory, 'tracks', trackId + '.mp3'), audioBytes);
  await fs.writeFile(noNetworkFile, "import os from 'node:os';\nglobalThis.fetch=async()=>{ console.error('TLS_UNEXPECTED_EXTERNAL_FETCH'); throw new Error('External fetch disabled in TLS fixture'); };\n"
    + (lanAddress ? '' : "os.networkInterfaces=()=>({Fixture:[{address:'192.168.253.2',internal:false,family:'IPv4'}]});\n"));
  await start();
  const originalPin = trustedPin;
  const originalCertificate = certificate;
  const originalIdentityRecord = JSON.parse(await fs.readFile(path.join(identityDirectory, 'identity.json'), 'utf8'));
  assert.equal(originalIdentityRecord.spkiPin, trustedPin);
  assert.equal(originalIdentityRecord.fingerprint, new crypto.X509Certificate(certificate).fingerprint256.replaceAll(':', '').toLowerCase());
  await assert.rejects(request(true, '/api/connect/config', { trust: false, pin: null }), error => ['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(error.code));
  await assert.rejects(request(true, '/api/connect/config', { pin: '00'.repeat(32) }), error => error.code === 'ACERVO_PIN_MISMATCH');
  const config = await request(true, '/api/connect/config');
  assert.equal(config.status, 200); assert.ok(['TLSv1.2', 'TLSv1.3'].includes(config.protocol));
  assert.deepEqual(config.data.security, { type: 'tls-pinned', required: true, port: securePort });
  assert.equal((await request(true, '/api/library')).status, 401, 'TLS loopback is not the desktop owner');
  const pc = await request(false, '/api/connect/register', { method: 'POST', body: { deviceId: 'tls-http-pc', name: 'TLS fixture PC', kind: 'desktop' } });
  assert.equal(pc.status, 200); assert.equal(pc.data.local, true);
  const pcId = pc.data.deviceId;
  const pcStream = await events(false, '/api/connect/events?deviceId=' + encodeURIComponent(pcId));
  const pairing = await request(false, '/api/connect/pairing', { method: 'POST', body: {} });
  assert.equal(pairing.status, 200); assert.equal(pairing.data.security.pin, trustedPin);
  for (const candidate of pairing.data.candidates) {
    const parsed = new URL(candidate.url);
    assert.equal(parsed.protocol, 'https:'); assert.equal(parsed.port, String(securePort));
    assert.equal(new URLSearchParams(parsed.hash.slice(1)).get('spki'), trustedPin);
    assert.equal(new URLSearchParams(parsed.hash.slice(1)).get('pair'), pairing.data.code);
  }
  assert.equal(Buffer.from(pairing.data.qrDataUrl.split(',')[1], 'base64').subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const claim = await request(true, '/api/connect/claim', { method: 'POST', body: { code: pairing.data.code, name: 'TLS fixture phone', kind: 'mobile' } });
  assert.equal(claim.status, 200); assert.equal(claim.data.local, false); assert.equal(claim.data.admin, false);
  const setCookie = claim.headers['set-cookie'][0];
  assert.match(setCookie, /; HttpOnly; SameSite=Strict; Max-Age=2592000; Secure$/);
  const cookie = setCookie.split(';')[0];
  assert.equal((await request(true, '/api/connect/claim', { method: 'POST', body: { code: pairing.data.code } })).status, 401);
  const library = await request(true, '/api/library', { cookie });
  assert.equal(library.status, 200); assert.deepEqual(library.data.tracks.map(track => track.id), [trackId]);
  assert.equal((await request(true, '/api/connect/info', { cookie, deviceId: pcId })).data.deviceId, claim.data.deviceId, 'A spoofed device header does not replace the cookie identity');
  const range = await request(true, '/api/stream/' + trackId, { cookie, headers: { Range: 'bytes=11-28' } });
  assert.equal(range.status, 206); assert.equal(range.headers['content-range'], 'bytes 11-28/' + audioBytes.length);
  assert.deepEqual(range.bytes, audioBytes.subarray(11, 29)); assert.ok(['TLSv1.2', 'TLSv1.3'].includes(range.protocol));
  const phoneStream = await events(true, '/api/connect/events', { cookie });
  assert.ok(['TLSv1.2', 'TLSv1.3'].includes(phoneStream.protocol));
  const transfer = await request(true, '/api/connect/command', { method: 'POST', cookie, body: { type: 'transfer', args: { targetDeviceId: claim.data.deviceId } } });
  assert.equal(transfer.status, 200);
  await until(() => pcStream.seen.some(event => event.type === 'command') && phoneStream.seen.some(event => event.type === 'command'));
  const telemetry = await request(true, '/api/connect/state', { method: 'POST', cookie, body: { trackId, queue: [trackId], qi: 0, position: 12, playing: true } });
  assert.equal(telemetry.status, 200);
  await until(() => pcStream.seen.some(event => event.type === 'state' && event.data.position === 12));
  assert.equal((await request(false, '/api/connect/state', { method: 'POST', deviceId: pcId, body: { position: 4 } })).status, 409);
  assert.equal((await request(true, '/api/connect/state', { method: 'POST', cookie, body: { position: -1 } })).status, 400);
  const phoneCommands = phoneStream.seen.filter(event => event.type === 'command').length;
  const pcCommands = pcStream.seen.filter(event => event.type === 'command').length;
  assert.equal((await request(true, '/api/connect/command', { method: 'POST', cookie, body: { type: 'pause' } })).status, 200);
  await until(() => phoneStream.seen.filter(event => event.type === 'command').length === phoneCommands + 1);
  assert.equal(pcStream.seen.filter(event => event.type === 'command').length, pcCommands, 'Commands reach only the active output');
  const backToPc = await request(true, '/api/connect/command', { method: 'POST', cookie, body: { type: 'transfer', args: { targetDeviceId: pcId } } });
  assert.equal(backToPc.status, 200); assert.equal(backToPc.data.playback.activeDeviceId, pcId);
  assert.ok(backToPc.data.playback.position >= 12 && backToPc.data.playback.position <= 80);
  assert.deepEqual(backToPc.data.playback.queue, [trackId]);
  assert.equal((await request(true, '/api/connect/state', { method: 'POST', cookie, body: { position: 15 } })).status, 409);
  assert.equal((await request(false, '/api/connect/state', { method: 'POST', deviceId: pcId, body: { position: 16, playing: false } })).status, 200);
  await until(() => phoneStream.seen.some(event => event.type === 'state' && event.data.position === 16));
  assert.equal((await request(true, '/api/connect/pairing', { method: 'POST', cookie, body: {} })).status, 403);
  assert.equal((await request(true, '/api/connect/register', { method: 'POST', cookie, body: {} })).status, 403);
  assert.equal((await request(true, '/api/connect/claim', { method: 'POST', headers: { Origin: origin }, body: { code: 'wrong' } })).status, 403);
  assert.equal((await request(false, '/api/connect/register', { method: 'POST', body: {}, headers: { Origin: 'http://evil.example' } })).status, 403);
  assert.equal((await request(false, '/api/connect/register', { method: 'POST', body: {}, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  if (lanAddress) {
    for (const pathname of ['/api/library', '/api/stream/' + trackId, '/api/connect/events']) {
      assert.equal((await request(false, pathname, { address: lanAddress, cookie, headers: { 'X-Forwarded-For': '127.0.0.1', 'X-Forwarded-Proto': 'https', 'X-Acervo-Device': pcId } })).status, 426);
    }
    assert.equal((await request(false, '/api/connect/claim', { address: lanAddress, method: 'POST', body: { code: pairing.data.code }, headers: { 'X-Forwarded-Proto': 'https' } })).status, 426);
    assert.equal((await request(false, '/api/connect/config', { address: lanAddress, cookie })).status, 200);
  } else console.log('TLS HTTP: no private LAN interface; actual LAN plaintext checks skipped, unit coverage remains active.');
  assert.equal((await request(true, '/api/connect/devices/' + pcId, { method: 'DELETE', cookie })).status, 403);
  assert.equal((await request(false, '/api/connect/devices/' + claim.data.deviceId, { method: 'DELETE', deviceId: pcId })).status, 200);
  await until(() => phoneStream.seen.some(event => event.type === 'revoked'));
  assert.equal((await request(true, '/api/library', { cookie })).status, 401);
  const beforeRestart = await request(false, '/api/connect/pairing', { method: 'POST', body: {} });
  const beforeRestartClaim = await request(true, '/api/connect/claim', { method: 'POST', body: { code: beforeRestart.data.code } });
  assert.equal(beforeRestartClaim.status, 200);
  const restartCookie = beforeRestartClaim.headers['set-cookie'][0].split(';')[0];
  assert.equal((await request(true, '/api/library', { cookie: restartCookie })).status, 200);
  assert.equal(await fs.readFile(path.join(dataDirectory, 'library.json'), 'utf8'), libraryText);
  await stop();
  await start();
  assert.equal(trustedPin, originalPin, 'PC cryptographic identity survives restart');
  assert.deepEqual(certificate, originalCertificate);
  assert.equal((await request(true, '/api/library', { cookie: restartCookie })).status, 401, 'Ephemeral local session requires a fresh QR after restart');
  const renewed = await request(false, '/api/connect/pairing', { method: 'POST', body: {} });
  assert.equal(renewed.status, 200); assert.equal(renewed.data.security.pin, originalPin);
  assert.equal((await request(true, '/api/connect/claim', { method: 'POST', body: { code: renewed.data.code } })).status, 200);
  await stop();
  // Replacing this fixture's entire identity simulates another PC at the remembered address.
  await fs.rename(identityDirectory, path.join(dataDirectory, 'original-identity-fixture'));
  await start();
  assert.notEqual(trustedPin, originalPin);
  await assert.rejects(request(true, '/api/connect/config', { pin: originalPin }), error => error.code === 'ACERVO_PIN_MISMATCH');
  assert.equal((await request(true, '/api/connect/config')).status, 200, 'The replacement is valid TLS, but rejected by the old PC pin');
  assert.equal(await fs.readFile(path.join(dataDirectory, 'library.json'), 'utf8'), libraryText);
  await stop();
  assert.equal(outputs.some(value => value.includes('TLS_UNEXPECTED_EXTERNAL_FETCH')), false);
  console.log('TLS HTTP passed: isolated PC QR pairing, trusted pin, untrusted/wrong/changed certificate rejection, TLS session cookies, encrypted SSE and Range audio, bidirectional playback handoff, CSRF and identity spoof rejection, revocation, LAN HTTP replay rejection, persistent identity and renewed pairing after restart. User library unchanged.');
} finally {
  await stop();
  const relative = path.relative(os.tmpdir(), directory);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(directory).startsWith('acervo-tls-http-'));
  await fs.rm(directory, { recursive: true, force: true });
}
