import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInternetRelay, rawMapping, verifyPcCertificate } from '../lib/internet-relay.js';
import { loadTlsIdentity } from '../lib/tls.js';

const HOST = 'pc.tail123.ts.net';
const ENDPOINT = 'https://' + HOST;
const PIN = 'a'.repeat(64);
const clone = value => JSON.parse(JSON.stringify(value));
const status = code => error => error.statusCode === code;

function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'acervo-internet-relay-tests-'));
  t.after(() => {
    const relative = path.relative(os.tmpdir(), directory);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(directory).startsWith('acervo-internet-relay-tests-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const stateFile = path.join(directory, 'relay.json');
  const calls = [], configured = [], probes = [];
  const initial = {
    TCP: { 10000: { HTTPS: true }, 8443: { HTTPS: true } },
    Web: { [HOST + ':10000']: { Handlers: { '/': { Proxy: 'http://127.0.0.1:4310' } } },
      [HOST + ':8443']: { Handlers: { '/': { Proxy: 'http://127.0.0.1:3080' } } } },
    AllowFunnel: { [HOST + ':8443']: true },
  };
  let config = clone(options.config || initial);
  const daemon = { BackendState: 'Running', Self: { DNSName: HOST + '.', Online: true, Capabilities: ['funnel', 'https'] }, ...options.daemon };
  async function run(args) {
    calls.push(args.slice());
    if (args.join(' ') === 'status --json') return JSON.stringify(daemon);
    if (args.join(' ') === 'funnel status --json') return JSON.stringify(config);
    const port = Number(args.find(part => part.startsWith('--tcp='))?.slice(6));
    assert.ok([443, 8443, 10000].includes(port), 'Only an allowed Funnel TCP port may be changed');
    assert.equal(args[0], 'funnel', 'These cases never require a global reset or unrelated serve configuration');
    if (args.at(-1) === 'off') {
      assert.deepEqual(args, ['funnel', '--tcp=' + port, 'off']);
      delete config.TCP[port];
      delete config.AllowFunnel[HOST + ':' + port];
    } else {
      assert.deepEqual(args, ['funnel', '--bg', '--yes', '--tcp=' + port, 'tcp://127.0.0.1:4314']);
      config.TCP[port] = { TCPForward: '127.0.0.1:4314' };
      config.AllowFunnel[HOST + ':' + port] = true;
    }
    return '';
  }
  async function configure(endpoint) { configured.push(endpoint); }
  async function probe(endpoint, pin) {
    probes.push([endpoint, pin]);
    assert.equal(pin, PIN, 'The probe receives the public PC pin, never a private key');
    if (options.probeError) throw options.probeError;
    return { verified: true };
  }
  const create = () => createInternetRelay({ securePort: 4314, stateFile, run, probe });
  return { create, stateFile, initial, calls, configured, probes, configure,
    get config() { return config; }, set config(value) { config = clone(value); } };
}

test('Managed relay uses a free raw TCP port and preserves existing HTTPS services', async t => {
  const f = fixture(t), relay = f.create();
  assert.deepEqual(relay.snapshot(), { provider: 'tailscale-funnel', state: 'offline', verified: false });
  const result = await relay.enable({ pcPin: PIN, currentEndpoint: null, configure: f.configure });
  assert.deepEqual(result, { provider: 'tailscale-funnel', state: 'online', publicEndpoint: ENDPOINT, verified: true });
  assert.deepEqual(f.probes, [[ENDPOINT, PIN]]);
  assert.deepEqual(f.configured, [ENDPOINT]);
  assert.equal(rawMapping(f.config, { port: 443, localPort: 4314 }), true);
  for (const port of [8443, 10000]) assert.deepEqual(f.config.TCP[port], f.initial.TCP[port]);
  assert.deepEqual(f.config.Web, f.initial.Web);
  assert.equal(f.config.AllowFunnel[HOST + ':8443'], true);
  assert.ok(f.calls.some(args => args.join(' ') === 'funnel --bg --yes --tcp=443 tcp://127.0.0.1:4314'));
  assert.ok(!f.calls.some(args => args.some(part => /reset|tls-terminated|--https|https\+insecure/.test(part))));
  const persisted = JSON.parse(fs.readFileSync(f.stateFile, 'utf8'));
  assert.deepEqual(Object.keys(persisted).sort(), ['localPort', 'port', 'previousEndpoint', 'provider', 'publicEndpoint', 'version']);
  assert.equal(persisted.previousEndpoint, null);
});

test('Disabling removes only the owned TCP mapping and restores the previous endpoint', async t => {
  const f = fixture(t), relay = f.create();
  await relay.enable({ pcPin: PIN, currentEndpoint: 'https://direct.example.test', configure: f.configure });
  f.calls.length = 0;
  assert.equal((await relay.disable({ currentEndpoint: ENDPOINT, configure: f.configure })).state, 'offline');
  assert.deepEqual(f.config, f.initial);
  assert.deepEqual(f.configured, [ENDPOINT, 'https://direct.example.test']);
  assert.equal(fs.existsSync(f.stateFile), false);
  assert.deepEqual(f.calls.filter(args => args.at(-1) === 'off'), [['funnel', '--tcp=443', 'off']]);
  assert.ok(!f.calls.some(args => args.includes('reset')));
});

test('Restart stays unverified until probing and re-enable preserves an originally absent endpoint', async t => {
  const f = fixture(t);
  await f.create().enable({ pcPin: PIN, currentEndpoint: null, configure: f.configure });
  f.calls.length = 0;
  const restarted = f.create();
  assert.deepEqual(restarted.snapshot(), { provider: 'tailscale-funnel', state: 'configured', publicEndpoint: ENDPOINT, verified: false });
  await restarted.enable({ pcPin: PIN, currentEndpoint: ENDPOINT, configure: f.configure });
  assert.equal(restarted.snapshot().state, 'online');
  assert.ok(!f.calls.some(args => args.includes('--bg')), 'An already correct mapping is reused');
  assert.equal(JSON.parse(fs.readFileSync(f.stateFile, 'utf8')).previousEndpoint, null);
  await restarted.disable({ currentEndpoint: ENDPOINT, configure: f.configure });
  assert.equal(f.configured.at(-1), null, 'Disabling must not restore its own disconnected relay URL');
});

test('A failed public probe rolls back only the new relay and does not leave an invitation endpoint', async t => {
  const problem = new Error('Probe rejected a replaced PC identity');
  const f = fixture(t, { probeError: problem }), relay = f.create();
  await assert.rejects(relay.enable({ pcPin: PIN, currentEndpoint: 'https://direct.example.test', configure: f.configure }), error => error === problem);
  assert.deepEqual(f.config, f.initial);
  assert.deepEqual(f.configured, [ENDPOINT, 'https://direct.example.test']);
  assert.equal(relay.snapshot().state, 'offline');
  assert.equal(fs.existsSync(f.stateFile), false);
  assert.ok(!f.calls.some(args => args.includes('reset')));
});

test('Temporary public DNS failure stays explicitly unverified and can be retried or disabled safely', async t => {
  const controls = { probeError: Object.assign(new Error('Public DNS is still propagating'), { code: 'ENOTFOUND' }) };
  const f = fixture(t, controls), relay = f.create();
  const waiting = await relay.enable({ pcPin: PIN, currentEndpoint: null, configure: f.configure });
  assert.equal(waiting.state, 'configured');
  assert.equal(waiting.verified, false);
  assert.equal(relay.snapshot().state, 'configured');
  assert.equal(rawMapping(f.config, { port: 443, localPort: 4314 }), true);
  assert.equal(fs.existsSync(f.stateFile), true);
  assert.ok(!f.calls.some(args => args.at(-1) === 'off'), 'The DNS propagation window does not remove the relay');
  controls.probeError = null;
  const confirmed = await relay.enable({ pcPin: PIN, currentEndpoint: ENDPOINT, configure: f.configure });
  assert.equal(confirmed.state, 'online');
  assert.equal(confirmed.verified, true);
  assert.equal(JSON.parse(fs.readFileSync(f.stateFile, 'utf8')).previousEndpoint, null);
  await relay.disable({ currentEndpoint: ENDPOINT, configure: f.configure });
  assert.deepEqual(f.config, f.initial);
  assert.equal(f.configured.at(-1), null);
});

test('Occupied Funnel ports and missing permissions are rejected before changing services', async t => {
  const occupied = fixture(t, { config: { TCP: { 443: { HTTPS: true }, 8443: { HTTPS: true }, 10000: { HTTPS: true } }, AllowFunnel: {} } });
  await assert.rejects(occupied.create().enable({ pcPin: PIN, currentEndpoint: null, configure: occupied.configure }), status(409));
  assert.equal(occupied.configured.length, 0);
  assert.equal(occupied.probes.length, 0);
  assert.ok(!occupied.calls.some(args => args.some(part => part.startsWith('--tcp='))));
  const permission = fixture(t, { daemon: { BackendState: 'Running', Self: { DNSName: HOST, Online: true, Capabilities: ['https'] } } });
  await assert.rejects(permission.create().enable({ pcPin: PIN, currentEndpoint: null, configure: permission.configure }), error => error.statusCode === 409 && error.actionUrl === 'https://tailscale.com/s/no-funnel');
  assert.equal(permission.configured.length, 0);
  assert.deepEqual(permission.calls, [['status', '--json']]);
});

test('An owned port changed by another service is never replaced or disabled', async t => {
  const f = fixture(t), relay = f.create();
  await relay.enable({ pcPin: PIN, currentEndpoint: null, configure: f.configure });
  const foreign = clone(f.config);
  foreign.TCP[443] = { HTTPS: true };
  f.config = foreign;
  f.calls.length = 0;
  await assert.rejects(relay.disable({ currentEndpoint: ENDPOINT, configure: f.configure }), status(409));
  await assert.rejects(relay.enable({ pcPin: PIN, currentEndpoint: ENDPOINT, configure: f.configure }), status(409));
  assert.deepEqual(f.config, foreign);
  assert.ok(f.calls.every(args => args.includes('status')));
  assert.equal(fs.existsSync(f.stateFile), true);
});

test('Busy relay operations cannot race into a second tunnel mutation', async t => {
  const f = fixture(t);
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const relay = createInternetRelay({ securePort: 4314, stateFile: f.stateFile,
    run: async () => { await waiting; throw new Error('Stopped fixture'); }, probe: async () => ({ verified: true }) });
  const enabling = relay.enable({ pcPin: PIN, currentEndpoint: null, configure: f.configure });
  assert.equal(relay.isBusy(), true);
  await assert.rejects(relay.disable({ currentEndpoint: null, configure: f.configure }), status(409));
  release();
  await assert.rejects(enabling, /Stopped fixture/);
  assert.equal(relay.isBusy(), false);
});

test('Public relay certificate verification accepts only the original valid PC key', async t => {
  const f = fixture(t);
  const identity = await loadTlsIdentity({ directory: path.join(path.dirname(f.stateFile), 'test-identity') });
  const certificate = new crypto.X509Certificate(identity.cert);
  assert.doesNotThrow(() => verifyPcCertificate(certificate.raw, identity.spkiPin));
  assert.throws(() => verifyPcCertificate(certificate.raw, '0'.repeat(64)), /identidade criptográfica/);
  assert.throws(() => verifyPcCertificate(certificate.raw, identity.spkiPin, Date.parse(certificate.validTo) + 1000), /identidade criptográfica/);
  assert.throws(() => verifyPcCertificate(certificate.raw, identity.spkiPin, Date.parse(certificate.validFrom) - 1000), /identidade criptográfica/);
  assert.throws(() => verifyPcCertificate(certificate.raw, 'not-a-pin'), /Identidade/);
  assert.throws(() => verifyPcCertificate(Buffer.from('not-a-certificate'), identity.spkiPin));
});
