import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../app/src/main/assets/native-transport.js', import.meta.url), 'utf8').replaceAll('__ACERVO_DOCUMENT_NONCE__', 'fixture-document-key');
function fixture(options = {}) {
  const calls = [], cancelled = [], external = [], listeners = {}, reloads = [], confirmed = [];
  class BrowserRequest extends Request {
    constructor(input, init) { super(typeof input === 'string' ? new URL(input, 'https://192.168.1.8:4314/').href : input, init); }
  }
  const win = {
    fetch: (...args) => { external.push(args); return Promise.resolve(new Response('external')); },
    AcervoSecure: { request: (...args) => calls.push(args), cancel: (...args) => cancelled.push(args) },
    AcervoAndroid: { connectedConfirmed: (...args) => confirmed.push(args) },
    addEventListener: (type, callback) => { listeners[type] = callback; }
  };
  win.top = options.frame ? {} : win;
  const context = vm.createContext({ window: win, location: { origin: 'https://192.168.1.8:4314', reload: () => reloads.push(true) }, Request: BrowserRequest, Response, ReadableStream, URL, Map, Uint8Array, JSON, Promise, DOMException, TypeError, atob, btoa });
  vm.runInContext(source, context);
  return {
    win, calls, cancelled, external, listeners, reloads, confirmed,
    event(id, type, values = {}) { win.__acervoSecureReceive({ key: 'fixture-document-key', id, type, ...values }); }
  };
}
async function request(f, ...args) {
  const result = f.win.fetch(...args);
  for (let n = 0; n < 10 && !f.calls.length; n++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.length, 1);
  return { result, id: f.calls[0][1] };
}
const encoded = value => Buffer.from(value).toString('base64');

test('native fetch preserves POST JSON, headers, cookies policy and streamed SSE chunks', async () => {
  const f = fixture();
  const { result, id } = await request(f, '/api/radio', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: '{"seed":"fixture"}' });
  assert.equal(f.calls[0][0], 'fixture-document-key');
  assert.equal(f.calls[0][2], 'POST');
  assert.equal(f.calls[0][3], 'https://192.168.1.8:4314/api/radio');
  assert.equal(Buffer.from(f.calls[0][5], 'base64').toString(), '{"seed":"fixture"}');
  assert.equal(JSON.parse(f.calls[0][4]).accept, 'text/event-stream');
  assert.equal(f.calls[0][6], true);
  f.event(id, 'headers', { status: 200, statusText: 'OK', headers: { 'Content-Type': 'text/event-stream' } });
  const response = await result;
  assert.equal(response.url, f.calls[0][3]);
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  const reader = response.body.getReader();
  f.event(id, 'chunk', { data: encoded('data: {"title":"A') });
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: {"title":"A');
  f.event(id, 'chunk', { data: encoded('ção"}\n\n') });
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'ção"}\n\n');
  f.event(id, 'end');
  assert.equal((await reader.read()).done, true);
  assert.equal(f.cancelled.length, 0);
});
test('AbortSignal aborts native socket while a radio stream is open', async () => {
  const f = fixture(), signal = new AbortController();
  const { result, id } = await request(f, '/api/radio', { method: 'POST', body: '{}', signal: signal.signal });
  f.event(id, 'headers', { status: 200, headers: {} });
  const reader = (await result).body.getReader(), reading = reader.read();
  signal.abort();
  await assert.rejects(reading, error => error.name === 'AbortError');
  assert.equal(f.cancelled.length, 1);
  assert.equal(f.cancelled[0][1], id);
  f.event(id, 'chunk', { data: encoded('late') });
});
test('abort before response headers rejects fetch and cancels native work', async () => {
  const f = fixture(), signal = new AbortController();
  const { result } = await request(f, '/api/library', { signal: signal.signal });
  signal.abort();
  await assert.rejects(result, error => error.name === 'AbortError');
  assert.equal(f.cancelled.length, 1);
});
test('JSON errors keep real HTTP status; 204 remains bodyless', async () => {
  const f = fixture();
  const { result, id } = await request(f, '/api/import', { method: 'POST', body: '{}' });
  f.event(id, 'headers', { status: 401, headers: { 'Content-Type': 'application/json' } });
  f.event(id, 'chunk', { data: encoded('{"error":"Pareie novamente"}') });
  f.event(id, 'end');
  const response = await result;
  assert.equal(response.status, 401); assert.equal(response.ok, false);
  assert.deepEqual(await response.json(), { error: 'Pareie novamente' });
  const empty = fixture(), next = await request(empty, '/api/track/fixture', { method: 'DELETE' });
  empty.event(next.id, 'headers', { status: 204, headers: {} });
  empty.event(next.id, 'end');
  assert.equal((await next.result).body, null);
});
test('stream cancellation disconnects native transport and wrong-document events are ignored', async () => {
  const f = fixture();
  const { result, id } = await request(f, '/api/library');
  f.win.__acervoSecureReceive({ key: 'wrong-document', id, type: 'headers', status: 500 });
  f.event(id, 'headers', { status: 200, headers: {} });
  const response = await result;
  assert.equal(response.status, 200);
  await response.body.cancel();
  assert.equal(f.cancelled.length, 1);
});
test('TLS/network failures fail the fetch and pagehide cancels outstanding work', async () => {
  const f = fixture();
  const { result, id } = await request(f, '/api/library');
  f.event(id, 'error', { message: 'AC-TLS: Não foi possível autenticar os aparelhos.' });
  await assert.rejects(result, /AC-TLS: Não foi possível autenticar/);
  const page = fixture(), waiting = await request(page, '/api/radio', { method: 'POST' });
  page.listeners.pagehide();
  await assert.rejects(waiting.result, error => error.name === 'AbortError');
  assert.equal(page.cancelled.length, 1);
});
test('external origins use normal fetch, credentials omit is honored and iframes get no bridge wrapper', async () => {
  const f = fixture();
  await f.win.fetch('https://outside.example/song');
  assert.equal(f.external.length, 1); assert.equal(f.calls.length, 0);
  const local = await request(f, '/api/library', { credentials: 'omit' });
  assert.equal(f.calls[0][6], false);
  f.event(local.id, 'headers', { status: 204, headers: {} }); f.event(local.id, 'end');
  await local.result;
  const frame = fixture({ frame: true });
  await frame.win.fetch('/api/library');
  assert.equal(frame.calls.length, 0); assert.equal(frame.external.length, 1);
});
test('oversized bodies and pre-aborted signals never reach native bridge', async () => {
  const f = fixture(), signal = new AbortController(); signal.abort();
  await assert.rejects(f.win.fetch('/api/import', { method: 'POST', body: 'x'.repeat(1048577) }), /1 MB/);
  await assert.rejects(f.win.fetch('/api/library', { signal: signal.signal }), error => error.name === 'AbortError');
  assert.equal(f.calls.length, 0);
});
test('a restored document reloads to receive its current native identity capability', () => {
  const f = fixture();
  f.listeners.pageshow({ persisted: false }); assert.equal(f.reloads.length, 0);
  f.listeners.pageshow({ persisted: true }); assert.equal(f.reloads.length, 1);
});

test('connection confirmation carries this document capability and the trusted origin only from its top frame', () => {
  const f = fixture();
  assert.equal(f.confirmed.length, 0);
  f.win.__acervoConnectionReady();
  assert.deepEqual(f.confirmed, [['https://192.168.1.8:4314', 'fixture-document-key']]);
  f.win.top = {};
  f.win.__acervoConnectionReady();
  assert.equal(f.confirmed.length, 1);
  const frame = fixture({ frame: true });
  assert.equal(frame.win.__acervoConnectionReady, undefined);
  assert.equal(frame.confirmed.length, 0);
});

test('web clients without the confirmation interface keep working', () => {
  const f = fixture();
  delete f.win.AcervoAndroid.connectedConfirmed;
  assert.doesNotThrow(() => f.win.__acervoConnectionReady());
  assert.equal(f.confirmed.length, 0);
});
