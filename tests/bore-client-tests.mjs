import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import { createBoreClient } from '../lib/bore-client.js';

const encode = value => Buffer.from(JSON.stringify(value) + '\0');
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function until(predicate) {
  for (let index = 0; index < 150; index++) { if (predicate()) return; await wait(10); }
  assert.fail('Expected isolated relay event was not received');
}

async function fixture(t, { initial, targetData } = {}) {
  const sockets = new Set(); const pending = new Map(); const controls = []; const commands = []; const targets = []; const destinations = [];
  function track(socket) { sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket)); return socket; }
  async function listen(server) { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); return server.address().port; }
  const target = net.createServer(socket => { track(socket); targets.push(socket); socket.on('data', chunk => targetData ? targetData(socket, chunk) : socket.write(chunk)); });
  const targetPort = await listen(target);
  const publicServer = net.createServer(socket => {
    track(socket); const id = crypto.randomUUID(); pending.set(id, socket);
    controls[0]?.write(encode({ Connection: id }));
    socket.once('close', () => pending.delete(id));
  });
  const publicPort = await listen(publicServer);
  const controlServer = net.createServer(socket => {
    track(socket); let bytes = Buffer.alloc(0);
    function receive(chunk) {
      bytes = Buffer.concat([bytes, chunk]); const index = bytes.indexOf(0);
      if (index < 0) return;
      socket.removeListener('data', receive);
      const message = JSON.parse(bytes.subarray(0, index).toString('utf8')); commands.push(message);
      if (Object.hasOwn(message, 'Hello')) {
        controls.push(socket);
        if (initial) initial(socket, publicPort);
        else socket.write(Buffer.concat([encode({ Hello: publicPort }), encode('Heartbeat')]));
      } else if (Object.hasOwn(message, 'Accept')) {
        const incoming = pending.get(message.Accept); pending.delete(message.Accept);
        if (!incoming) return socket.destroy();
        const buffered = bytes.subarray(index + 1); if (buffered.length) incoming.write(buffered);
        socket.pipe(incoming); incoming.pipe(socket);
        incoming.once('close', () => socket.destroy()); socket.once('close', () => incoming.destroy());
      }
    }
    socket.on('data', receive);
  });
  const controlPort = await listen(controlServer);
  const clients = [];
  t.after(async () => {
    for (const client of clients) client.stop();
    for (const socket of sockets) socket.destroy();
    await Promise.all([controlServer, publicServer, target].map(server => new Promise(resolve => server.close(resolve))));
  });
  function client(options = {}) {
    const value = createBoreClient({ localPort: targetPort, connectSocket: destination => {
      destinations.push(destination);
      if (destination.host === 'bore.pub') {
        assert.equal(destination.port, 7835); return track(net.createConnection({ host: '127.0.0.1', port: controlPort }));
      }
      assert.deepEqual(destination, { host: '127.0.0.1', port: targetPort }); return track(net.createConnection(destination));
    }, ...options });
    clients.push(value); return value;
  }
  return { client, controls, commands, targets, destinations, publicPort, track };
}

test('bore starts with a bounded NUL-delimited Hello and forwards opaque binary bytes only to fixed loopback', async t => {
  const f = await fixture(t); const client = f.client({ requestedPort: 12345 });
  const state = await client.start();
  assert.deepEqual(state, { status: 'online', publicEndpoint: 'https://bore.pub:' + f.publicPort, port: f.publicPort });
  assert.deepEqual(f.commands[0], { Hello: 12345 });
  const input = Buffer.concat([Buffer.from([0x16, 0x03, 0x03, 0, 0, 0xff, 0]), crypto.randomBytes(8192)]);
  const incoming = f.track(net.createConnection({ host: '127.0.0.1', port: f.publicPort }));
  const result = new Promise((resolve, reject) => {
    const chunks = []; let length = 0;
    incoming.on('error', reject); incoming.on('data', chunk => {
      chunks.push(chunk); length += chunk.length;
      if (length >= input.length) resolve(Buffer.concat(chunks));
    });
  });
  await new Promise(resolve => incoming.once('connect', resolve)); incoming.write(input);
  assert.deepEqual(await result, input);
  assert.equal(f.commands.length, 2); assert.match(f.commands[1].Accept, /^[a-f0-9-]{36}$/);
  assert.equal(f.destinations.filter(value => value.host === '127.0.0.1').length, 1);
  assert.deepEqual(await client.start(), state);
  client.stop(); assert.equal(client.snapshot().status, 'offline');
});

test('control parser handles fragmented JSON and coalesced heartbeat frames', async t => {
  const f = await fixture(t, { initial(socket, port) {
    const bytes = Buffer.concat([encode({ Hello: port }), encode('Heartbeat'), encode('Heartbeat')]);
    socket.write(bytes.subarray(0, 5)); setTimeout(() => socket.write(bytes.subarray(5)), 10);
  } });
  const client = f.client(); assert.equal((await client.start()).port, f.publicPort);
  assert.deepEqual(f.commands[0], { Hello: 0 });
  assert.equal(client.snapshot().status, 'online');
});

test('an established quiet control connection survives ten seconds and accepts a later phone connection', async t => {
  const f = await fixture(t, { initial: (socket, port) => socket.write(encode({ Hello: port })) });
  let closed = 0;
  const client = f.client({ onClose: () => { closed++; } }); await client.start();
  await wait(10300);
  assert.equal(client.snapshot().status, 'online', 'Silence is not a Bore protocol disconnect');
  assert.equal(closed, 0);
  const incoming = f.track(net.createConnection({ host: '127.0.0.1', port: f.publicPort }));
  const input = Buffer.from('phone-connects-after-idle');
  const response = new Promise((resolve, reject) => { incoming.once('data', resolve); incoming.once('error', reject); });
  await new Promise(resolve => incoming.once('connect', resolve)); incoming.write(input);
  assert.deepEqual(await response, input);
  assert.equal(f.commands.filter(command => Object.hasOwn(command, 'Hello')).length, 1, 'The same invitation address stays connected');
});

test('an unresponsive initial handshake still fails within its bounded connection deadline', { timeout: 8000 }, async t => {
  const f = await fixture(t, { initial() {} }); const client = f.client();
  await assert.rejects(client.start(), error => error.statusCode === 503 && /não respondeu a tempo/.test(error.message));
  assert.equal(client.snapshot().status, 'offline');
  assert.equal(f.targets.length, 0);
});

test('malformed, oversized, authenticated-only or invalid-port control greetings fail closed', async t => {
  const replies = [encode({ Hello: 0 }), encode({ Hello: 65536 }), encode({ Hello: '12345' }), encode({ Hello: 12345, Connection: crypto.randomUUID() }),
    encode({ Challenge: crypto.randomUUID() }), encode({ Error: 'denied' }), Buffer.from('broken\0'), Buffer.alloc(257, 65)];
  for (const reply of replies) {
    const f = await fixture(t, { initial: socket => socket.write(reply) }); const client = f.client();
    await assert.rejects(client.start(), error => error.statusCode === 503);
    assert.equal(client.snapshot().status, 'offline'); assert.equal(f.targets.length, 0);
  }
});

test('a requested port conflict is reported without requesting another port', async t => {
  const f = await fixture(t, { initial: socket => socket.write(encode({ Error: 'port already in use' })) }); const client = f.client({ requestedPort: 12345 });
  await assert.rejects(client.start(), error => error.statusCode === 503);
  assert.deepEqual(f.commands, [{ Hello: 12345 }]);
});

test('relay channel requests are UUID-checked, deduplicated and bound the active plus queued burst', async t => {
  const f = await fixture(t); let closed = 0; const client = f.client({ onClose: () => { closed++; } }); await client.start();
  const ids = Array.from({ length: 96 }, () => crypto.randomUUID());
  f.controls[0].write(Buffer.concat([...ids.map(Connection => encode({ Connection })), encode({ Connection: ids[0] })]));
  await until(() => f.destinations.filter(value => value.host === 'bore.pub').length === 65);
  await wait(50);
  assert.equal(f.destinations.filter(value => value.host === 'bore.pub').length, 65, 'One control, 32 active and at most 32 queued data sockets');
  f.controls[0].write(encode({ Connection: '127.0.0.1:22' }));
  await until(() => closed === 1);
  assert.equal(client.snapshot().status, 'offline');
  assert.equal(f.destinations.some(value => value.port === 22), false);
});

test('a burst of page and API connections leaves room for audio and drains queued connections as sockets close', async t => {
  const f = await fixture(t); const client = f.client(); await client.start();
  const responses = new Set();
  const incoming = Array.from({ length: 36 }, (_, index) => {
    const socket = f.track(net.createConnection({ host: '127.0.0.1', port: f.publicPort }));
    socket.once('connect', () => socket.write(Buffer.from('stream-' + index)));
    socket.once('data', chunk => { assert.equal(chunk.toString(), 'stream-' + index); responses.add(index); });
    return socket;
  });
  await until(() => responses.size === 32);
  assert.equal(f.targets.length, 32);
  assert.equal(f.destinations.filter(value => value.host === 'bore.pub').length, 33);
  const completed = Array.from(responses);
  for (const index of completed.slice(0, 4)) incoming[index].destroy();
  await until(() => responses.size === 36);
  assert.equal(f.targets.length, 36);
  const active = completed.slice(4).map(index => incoming[index]);
  assert.equal(active.every(socket => !socket.destroyed), true, 'Existing audio and event streams survive the queued burst');
});

test('stop closes active data sockets without onClose, while unexpected control disconnect reports once', async t => {
  const f = await fixture(t); let reported = 0; const client = f.client({ onClose: () => { reported++; } }); await client.start();
  const incoming = f.track(net.createConnection({ host: '127.0.0.1', port: f.publicPort }));
  await until(() => f.targets.length === 1);
  const done = new Promise(resolve => incoming.once('close', resolve));
  client.stop(); client.stop(); await done;
  assert.equal(reported, 0); assert.equal(client.snapshot().status, 'offline');
  await client.start();
  f.controls.at(-1).destroy();
  await until(() => reported === 1);
  client.stop(); assert.equal(reported, 1);
});

test('invalid local or requested ports are refused before any connection attempt', () => {
  for (const localPort of [0, 65536, -1, 3.4, '4314']) assert.throws(() => createBoreClient({ localPort }), error => error.statusCode === 500);
  for (const requestedPort of [1, 1023, 65536, -1, '12345']) assert.throws(() => createBoreClient({ requestedPort }), error => error.statusCode === 500);
  const client = createBoreClient({ connectSocket: () => { throw new Error('No socket'); } });
  return assert.rejects(client.start(), error => error.statusCode === 503);
});
