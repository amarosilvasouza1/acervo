import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const launcher = path.join(root, 'scripts', 'internet.ps1');
const windows = process.platform === 'win32';
const secureLocal = { cloud: false, security: { type: 'mtls-pinned', mutual: true } };

function run(action, port) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcher,
      '-Action', action, '-NoBrowser'], { cwd: root, windowsHide: true, env: { ...process.env, PORT: String(port) } });
    let output = '';
    const deadline = setTimeout(() => { child.kill(); reject(new Error('Launcher did not finish against the fake loopback API.')); }, 15000);
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    child.once('error', error => { clearTimeout(deadline); reject(error); });
    child.once('close', code => { clearTimeout(deadline); resolve({ code, output }); });
  });
}

async function fixture(t, { configuration = secureLocal, status = 200, relay = { state: 'online', publicEndpoint: 'https://example.test' } } = {}) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const part of request) body += part;
    requests.push({ method: request.method, url: request.url, origin: request.headers.origin, body });
    const config = request.url === '/api/connect/config';
    response.writeHead(config ? 200 : status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(config ? configuration : status >= 400 ? { error: 'O encaminhamento deste Acervo esta indisponivel.' } : {
      relay, snapshot: { pairing: { url: 'https://example.test/#pair=NEVER_PRINT_THIS_INVITE' } },
    }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { requests, port: server.address().port };
}

test('Internet launcher enables only the local managed relay and never prints an invite', { skip: !windows }, async t => {
  const f = await fixture(t);
  const result = await run('Enable', f.port);
  assert.equal(result.code, 0, result.output);
  assert.deepEqual(f.requests.map(({ method, url }) => ({ method, url })), [
    { method: 'GET', url: '/api/connect/config' }, { method: 'POST', url: '/api/connect/internet/enable' },
  ]);
  assert.equal(f.requests[1].body, '{}');
  assert.equal(f.requests[1].origin, 'http://127.0.0.1:' + f.port);
  assert.doesNotMatch(result.output, /NEVER_PRINT_THIS_INVITE|#pair=/);
});

test('Internet launcher disables only this Acervo relay through the local API', { skip: !windows }, async t => {
  const f = await fixture(t, { relay: { state: 'offline' } });
  const result = await run('Disable', f.port);
  assert.equal(result.code, 0, result.output);
  assert.deepEqual(f.requests.map(request => request.url), ['/api/connect/config', '/api/connect/internet/disable']);
  assert.equal(f.requests[1].body, '{}');
  assert.doesNotMatch(result.output, /NEVER_PRINT_THIS_INVITE/);
});

test('Internet launcher rejects cloud and legacy modes without an enable request', { skip: !windows }, async t => {
  for (const configuration of [{ cloud: true }, { cloud: false, security: { type: 'tls-pinned' } }, { cloud: false }]) {
    const f = await fixture(t, { configuration });
    const result = await run('Enable', f.port);
    assert.equal(result.code, 1, result.output);
    assert.deepEqual(f.requests.map(request => request.url), ['/api/connect/config']);
  }
});

test('Internet launcher reports API failure and never reports an unconfirmed relay as online', { skip: !windows }, async t => {
  const rejected = await fixture(t, { status: 409 });
  const rejection = await run('Enable', rejected.port);
  assert.equal(rejection.code, 1, rejection.output);
  assert.match(rejection.output, /encaminhamento deste Acervo esta indisponivel/);
  const unconfirmed = await fixture(t, { relay: { state: 'starting' } });
  const waiting = await run('Enable', unconfirmed.port);
  assert.equal(waiting.code, 1, waiting.output);
  assert.match(waiting.output, /nao confirmou/);
});

test('Internet launcher rejects an invalid PORT before using the network', { skip: !windows }, async () => {
  const result = await run('Enable', '4310&anything');
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /PORT precisa/);
});
