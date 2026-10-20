import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBoreRelay } from '../lib/bore-relay.js';

const PIN = 'a'.repeat(64);
const PORT = 22345;
const ENDPOINT = 'https://bore.pub:' + PORT;
const status = expected => error => error.statusCode === expected;

function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'acervo-bore-relay-tests-'));
  const stateFile = path.join(directory, 'relay.json');
  const clients = [], requests = [], configured = [], probes = [], relays = [];
  function createClient(args) {
    requests.push(args);
    const value = {
      starts: 0, stops: 0, active: false,
      async start() {
        this.starts++;
        if (options.startError) throw options.startError;
        this.active = true;
        const port = options.assignedPort || args.requestedPort || PORT;
        return { status: 'online', port, publicEndpoint: options.assignedEndpoint || 'https://bore.pub:' + port };
      },
      stop() { this.stops++; this.active = false; },
      close() { this.active = false; args.onClose(new Error('Fixture control closed')); },
    };
    clients.push(value); return value;
  }
  async function probe(endpoint, pin) {
    probes.push([endpoint, pin]);
    if (options.probeWait) await options.probeWait;
    if (options.probeError) throw options.probeError;
    return { verified: true };
  }
  const configure = async endpoint => { configured.push(endpoint); };
  function create() {
    const relay = createBoreRelay({ securePort: 4314, stateFile, createClient, probe });
    relays.push(relay); return relay;
  }
  t.after(async () => {
    for (const relay of relays) try { await relay.disable({ currentEndpoint: null, configure: async () => {} }); } catch {}
    const relative = path.relative(os.tmpdir(), directory);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(directory).startsWith('acervo-bore-relay-tests-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { create, directory, stateFile, clients, requests, configured, probes, configure };
}

test('Bore wrapper remains offline without outbound activity until explicitly enabled', async t => {
  const f = fixture(t), relay = f.create();
  assert.deepEqual(relay.snapshot(), { provider: 'bore', state: 'offline', verified: false });
  assert.equal(relay.isEnabled(), false);
  await relay.resume({ pcPin: PIN, currentEndpoint: null, configure: f.configure });
  assert.equal(f.clients.length, 0);
  const result = await relay.enable({ pcPin: PIN, currentEndpoint: null, configure: f.configure });
  assert.equal(result.state, 'online'); assert.equal(result.verified, true);
  assert.equal(result.publicEndpoint, ENDPOINT);
  assert.deepEqual(f.probes, [[ENDPOINT, PIN]]);
  assert.deepEqual(f.configured, [ENDPOINT]);
  assert.equal(f.requests[0].localPort, 4314);
  assert.equal(f.requests[0].requestedPort, 0);
  assert.equal(relay.isEnabled(), true);
  const record = JSON.parse(fs.readFileSync(f.stateFile, 'utf8'));
  assert.deepEqual(record, { version: 1, provider: 'bore', port: PORT, publicEndpoint: ENDPOINT, previousEndpoint: null });
  if (process.platform !== 'win32') assert.equal(fs.statSync(f.stateFile).mode & 0o777, 0o600);
});

test('Bore disable stops only its owned client and restores a prior address when still selected', async t => {
  const f = fixture(t), relay = f.create();
  await relay.enable({ pcPin: PIN, currentEndpoint: 'https://direct.example.test', configure: f.configure });
  await relay.disable({ currentEndpoint: ENDPOINT, configure: f.configure });
  assert.equal(f.clients[0].stops, 1);
  assert.deepEqual(f.configured, [ENDPOINT, 'https://direct.example.test']);
  assert.equal(fs.existsSync(f.stateFile), false);
  assert.equal(relay.snapshot().state, 'offline');
  assert.equal(relay.isEnabled(), false);
  await relay.enable({ pcPin: PIN, currentEndpoint: null, configure: f.configure });
  const count = f.configured.length;
  await relay.disable({ currentEndpoint: 'https://another.example.test', configure: f.configure });
  assert.equal(f.configured.length, count, 'A later manually chosen address is not overwritten');
});

test('A persisted Bore endpoint resumes explicitly on the same public port with null restoration intact', async t => {
  const f = fixture(t);
  fs.writeFileSync(f.stateFile, JSON.stringify({ version: 1, provider: 'bore', port: PORT, publicEndpoint: ENDPOINT, previousEndpoint: null }));
  const relay = f.create();
  assert.equal(f.clients.length, 0);
  assert.deepEqual(relay.snapshot(), { provider: 'bore', state: 'configured', verified: false, publicEndpoint: ENDPOINT });
  await relay.resume({ pcPin: PIN, currentEndpoint: ENDPOINT, configure: f.configure });
  assert.equal(f.requests[0].requestedPort, PORT);
  await relay.enable({ pcPin: PIN, currentEndpoint: ENDPOINT, configure: f.configure });
  assert.equal(f.clients.length, 1, 'Reverification reuses the established client');
  assert.equal(JSON.parse(fs.readFileSync(f.stateFile, 'utf8')).previousEndpoint, null);
  await relay.disable({ currentEndpoint: ENDPOINT, configure: f.configure });
  assert.equal(f.configured.at(-1), null);
});

test('Wrong PC identity or exposed private API fails closed and removes the owned relay address', async t => {
  for (const reason of ['PC key substituted', 'Anonymous library was not rejected']) {
    const controls = { probeError: new Error(reason) }, f = fixture(t, controls), relay = f.create();
    await assert.rejects(relay.enable({ pcPin: PIN, currentEndpoint: 'https://direct.example.test', configure: f.configure }), new RegExp(reason));
    assert.equal(f.clients[0].active, false);
    assert.deepEqual(f.configured, [ENDPOINT, 'https://direct.example.test']);
    assert.equal(fs.existsSync(f.stateFile), false);
    assert.equal(relay.snapshot().state, 'offline');
    assert.equal(relay.isEnabled(), false);
  }
});

test('A transient public probe failure remains unverified and can recover without changing the address', async t => {
  const controls = { probeError: Object.assign(new Error('Public network still unavailable'), { code: 'ETIMEDOUT' }) };
  const f = fixture(t, controls), relay = f.create();
  const waiting = await relay.enable({ pcPin: PIN, currentEndpoint: null, configure: f.configure });
  assert.equal(waiting.state, 'configured'); assert.equal(waiting.verified, false);
  assert.equal(f.clients[0].active, true);
  assert.equal(f.clients[0].stops, 0);
  controls.probeError = null;
  const online = await relay.enable({ pcPin: PIN, currentEndpoint: ENDPOINT, configure: f.configure });
  assert.equal(online.state, 'online'); assert.equal(f.clients.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(f.stateFile, 'utf8')).previousEndpoint, null);
});

test('Unexpected control closure reconnects on the same port and repeats PC identity verification', async t => {
  const f = fixture(t), relay = f.create();
  await relay.enable({ pcPin: PIN, currentEndpoint: null, configure: f.configure });
  f.clients[0].close();
  assert.equal(relay.snapshot().state, 'configured');
  const deadline = Date.now() + 4500;
  while ((f.clients.length < 2 || !relay.snapshot().verified) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(f.clients.length, 2);
  assert.equal(f.requests[1].requestedPort, PORT);
  assert.equal(relay.snapshot().state, 'online');
  assert.equal(f.probes.length, 2);
  assert.deepEqual(f.probes[1], [ENDPOINT, PIN]);
});

test('A replacement public port is rejected instead of silently changing an existing QR address', async t => {
  const controls = { assignedPort: PORT + 1 }, f = fixture(t, controls);
  fs.writeFileSync(f.stateFile, JSON.stringify({ version: 1, provider: 'bore', port: PORT, publicEndpoint: ENDPOINT, previousEndpoint: null }));
  const relay = f.create();
  await assert.rejects(relay.enable({ pcPin: PIN, currentEndpoint: ENDPOINT, configure: f.configure }), status(409));
  assert.equal(f.clients[0].active, false);
  assert.equal(f.configured.length, 0);
  assert.equal(relay.snapshot().publicEndpoint, ENDPOINT);
  assert.equal(relay.snapshot().state, 'configured');
});

test('Concurrent enable and disable cannot race the owned outbound client', async t => {
  let release;
  const controls = { probeWait: new Promise(resolve => { release = resolve; }) };
  const f = fixture(t, controls), relay = f.create();
  const enabling = relay.enable({ pcPin: PIN, currentEndpoint: null, configure: f.configure });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(relay.isBusy(), true);
  await assert.rejects(relay.disable({ currentEndpoint: ENDPOINT, configure: f.configure }), status(409));
  release(); await enabling;
  assert.equal(relay.isBusy(), false);
  assert.equal(f.clients.length, 1);
});

test('Corrupt persisted addresses cannot redirect the Bore client to another relay host', t => {
  const f = fixture(t);
  fs.writeFileSync(f.stateFile, JSON.stringify({ version: 1, provider: 'bore', port: PORT, publicEndpoint: 'https://other.example.test:' + PORT, previousEndpoint: null }));
  assert.throws(f.create, /registro.*inválido/);
  assert.equal(f.clients.length, 0);
});
