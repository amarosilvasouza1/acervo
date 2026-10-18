import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lanAddresses } from '../lib/connect.js';

const address = lanAddresses()[0]?.address;
assert.ok(address, 'a private LAN interface is available');
const port = 4312;
const localBase = 'http://127.0.0.1:' + port;
const lanBase = 'http://' + address + ':' + port;
const serverFile = fileURLToPath(new URL('../server.js', import.meta.url));
const child = spawn(process.execPath, [serverFile], { env: { ...process.env, PORT: String(port), ACERVO_HOST: '0.0.0.0' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => { output += chunk; });
const closed = new Promise(resolve => child.once('close', resolve));
const streams = [];
async function json(base, pathname, { method = 'GET', body, cookie, deviceId, origin = base, headers = {} } = {}) {
  const response = await fetch(base + pathname, { method, headers: { ...(method !== 'GET' ? { Origin: origin } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(deviceId ? { 'X-Acervo-Device': deviceId } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  return { response, data };
}
async function events(base, query = '', cookie) {
  const controller = new AbortController();
  const response = await fetch(base + '/api/connect/events' + query, { headers: cookie ? { Cookie: cookie } : {}, signal: controller.signal });
  assert.equal(response.status, 200);
  const seen = [];
  const reader = response.body.getReader();
  const done = (async () => {
    let pending = '';
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        const parts = pending.split('\n\n'); pending = parts.pop();
        for (const part of parts) {
          const type = part.match(/^event: (.+)$/m)?.[1];
          const data = part.match(/^data: (.+)$/m)?.[1];
          if (type && data) seen.push({ type, data: JSON.parse(data) });
        }
      }
    } catch (error) { if (!controller.signal.aborted) throw error; }
  })();
  const stream = { seen, controller, done };
  streams.push(stream);
  await until(() => seen.some(event => event.type === 'snapshot'));
  return stream;
}
async function until(predicate) {
  for (let index = 0; index < 100; index++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error('Expected event was not received');
}

try {
  let ready = false;
  for (let index = 0; index < 40; index++) {
    if (child.exitCode !== null) throw new Error(output);
    try { ready = (await fetch(localBase + '/api/health')).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, output || 'server starts');
  assert.equal((await fetch(lanBase + '/')).status, 200);
  assert.equal((await json(lanBase, '/api/library')).response.status, 401);
  const registration = await json(localBase, '/api/connect/register', { method: 'POST', body: { deviceId: 'connect-http-fixture', name: 'Test PC' } });
  assert.equal(registration.response.status, 200);
  const pcId = registration.data.deviceId;
  const pc = await events(localBase, '?deviceId=' + pcId);
  const pairing = await json(localBase, '/api/connect/pairing', { method: 'POST' });
  assert.equal(pairing.response.status, 200);
  assert.equal(pairing.data.candidates.some(item => item.address === address), true);
  const png = Buffer.from(pairing.data.qrDataUrl.split(',')[1], 'base64');
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const claim = await json(lanBase, '/api/connect/claim', { method: 'POST', body: { code: pairing.data.code, name: 'Test Phone', deviceId: pcId } });
  assert.equal(claim.response.status, 200);
  assert.equal(claim.data.local, false);
  assert.notEqual(claim.data.deviceId, pcId);
  const cookie = claim.response.headers.get('set-cookie').split(';')[0];
  assert.match(claim.response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.equal((await json(lanBase, '/api/library', { cookie })).response.status, 200);
  assert.equal((await json(lanBase, '/api/connect/info', { cookie, deviceId: pcId })).data.deviceId, claim.data.deviceId);
  assert.equal((await json(lanBase, '/api/connect/pairing', { method: 'POST', cookie })).response.status, 403);
  const phone = await events(lanBase, '', cookie);
  const transfer = await json(lanBase, '/api/connect/command', { method: 'POST', cookie, body: { type: 'transfer', args: { targetDeviceId: claim.data.deviceId } } });
  assert.equal(transfer.response.status, 200);
  assert.equal(transfer.data.playback.activeDeviceId, claim.data.deviceId);
  await until(() => pc.seen.some(event => event.type === 'command') && phone.seen.some(event => event.type === 'command'));
  assert.equal((await json(localBase, '/api/connect/state', { method: 'POST', deviceId: pcId, body: { position: 7 } })).response.status, 409);
  const telemetry = await json(lanBase, '/api/connect/state', { method: 'POST', cookie, body: { position: 8, playing: false } });
  assert.equal(telemetry.response.status, 200);
  await until(() => pc.seen.some(event => event.type === 'state' && event.data.position === 8));
  assert.equal((await json(lanBase, '/api/connect/state', { method: 'POST', cookie, body: { position: -1 } })).response.status, 400);
  assert.equal((await json(localBase, '/api/connect/register', { method: 'POST', body: {}, origin: 'http://evil.example' })).response.status, 403);
  assert.equal((await json(localBase, '/api/connect/register', { method: 'POST', body: {}, headers: { 'Sec-Fetch-Site': 'cross-site' } })).response.status, 403);
  assert.equal((await json(localBase, '/api/connect/devices/' + claim.data.deviceId, { method: 'DELETE', deviceId: pcId })).response.status, 200);
  await until(() => phone.seen.some(event => event.type === 'revoked'));
  assert.equal((await json(lanBase, '/api/library', { cookie })).response.status, 401);
  assert.equal((await json(lanBase, '/api/connect/claim', { method: 'POST', body: { code: pairing.data.code } })).response.status, 401);
  console.log('Connect HTTP passed: LAN auth, actual QR PNG, one-use claim, cookie identity, two SSE clients, player transfer and telemetry, CSRF, revocation. User library unchanged.');
} finally {
  for (const stream of streams) stream.controller.abort();
  await Promise.allSettled(streams.map(stream => stream.done));
  child.kill();
  await closed;
}
