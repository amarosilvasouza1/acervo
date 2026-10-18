import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

// Browser logic regression coverage with no server writes or music imports.
const radioSource = await readFile(new URL('../public/radio.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const viewsSource = await readFile(new URL('../public/views.js', import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function node() {
  const listeners = new Map();
  const attributes = new Map();
  return {
    value: '', textContent: '', innerHTML: '', hidden: false, dataset: {}, style: {}, children: [],
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    addEventListener(name, callback) { (listeners.get(name) || listeners.set(name, []).get(name)).push(callback); },
    emit(name, data = {}) { for (const callback of listeners.get(name) || []) callback(data); },
    setAttribute(name, value) { attributes.set(name, value); }, getAttribute(name) { return attributes.get(name); },
    querySelectorAll() { return []; }, focus() {}, insertAdjacentHTML() {}
  };
}
function setup({ app = false, views = false, volume = null } = {}) {
  let now = 1_800_000_000_000;
  let nextTimer = 0;
  const timers = new Map();
  const nodes = new Map();
  const getNode = id => nodes.get(id) || (nodes.set(id, node()), nodes.get(id));
  const document = { readyState: 'loading', getElementById: getNode, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: node(), activeElement: { tagName: 'BODY' } };
  const calls = [];
  const fetch = async (...args) => { calls.push(args); return { ok: true, json: async () => ({}) }; };
  class FakeDate extends Date { static now() { return now; } }
  const context = vm.createContext({
    document, navigator: {}, window: {}, console, Set, AbortController, TextDecoder, Date: FakeDate,
    localStorage: { getItem: () => volume, setItem() {} }, fetch,
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(callback, interval) { const id = ++nextTimer; timers.set(id, { callback, at: now + interval, interval }); return id; }
  });
  const audio = getNode('audio');
  Object.assign(audio, { paused: true, src: '', currentTime: 0, duration: 200, volume: .85,
    play() { audio.paused = false; return Promise.resolve(); }, pause() { audio.paused = true; audio.emit('pause'); } });
  if (app) vm.runInContext(appSource, context, { filename: 'public/app.js' });
  else context.window.AC = {
    state: { view: 'radio', tracks: [], jobs: {} }, esc: String, icon: () => '', coverHtml: () => '',
    fmtTime: String, hydrateIcons() {}, jobMarkup: () => 'Download', trackById(id) { return this.state.tracks.find(t => t.id === id); },
    render() {}, closeModals() {}, toast() {}
  };
  const AC = context.window.AC;
  AC.toast = () => {};
  vm.runInContext(radioSource, context, { filename: 'public/radio.js' });
  if (views) vm.runInContext(viewsSource, context, { filename: 'public/views.js' });
  return {
    AC, context, calls, nodes, getNode, audio,
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) {
        if (timer.interval) timer.at = now + timer.interval; else timers.delete(id);
        timer.callback();
      }
    },
    setFetch(fn) { context.fetch = (...args) => { calls.push(args); return fn(...args); }; }
  };
}
function stream(events, chunks = 11, crlf = false) {
  let body = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
  if (crlf) body = body.replace(/\n/g, '\r\n');
  const bytes = new TextEncoder().encode(body);
  let offset = 0;
  return { ok: true, body: { getReader: () => ({ read: async () => {
    if (offset === bytes.length) return { done: true };
    const value = bytes.slice(offset, offset + chunks); offset += value.length;
    return { done: false, value };
  } }) } };
}
const done = ['done', { warnings: [] }];

test('SSE streams across arbitrary UTF-8 chunks and deduplicates repeated batches', async () => {
  const h = setup();
  h.setFetch(() => stream([
    ['start', { seeds: [{ id: 'seed', title: 'Referência', artist: 'Artista' }] }],
    ['results', { items: [{ videoId: 'one', title: 'Canção' }] }],
    ['results', { items: [{ videoId: 'one', title: 'Canção' }, { videoId: 'two', title: 'São Paulo' }] }], done
  ], 3));
  await h.AC.searchRadio();
  assert.deepEqual(Array.from(h.AC.radioState.results, r => r.title), ['Canção', 'São Paulo']);
  assert.equal(h.AC.radioState.seeds[0].title, 'Referência');
  assert.equal(h.AC.radioState.loading, false);
  assert.equal(h.AC.radioState.error, '');
});

test('CRLF framing still parses when carriage return and newline arrive in separate chunks', async () => {
  const h = setup(); h.setFetch(() => stream([['results', { items: [{ videoId: 'one' }] }], done], 1, true));
  await h.AC.searchRadio();
  assert.equal(h.AC.radioState.results.length, 1); assert.equal(h.AC.radioState.error, '');
});

test('cancelled older request cannot replace a newer result or reset its state', async () => {
  const h = setup(); const old = deferred();
  h.setFetch(() => h.calls.length === 1 ? old.promise : stream([['results', { items: [{ videoId: 'new' }] }], done], 1024));
  const first = h.AC.searchRadio();
  const firstSignal = h.calls[0][1].signal;
  await h.AC.searchRadio();
  assert.equal(firstSignal.aborted, true);
  old.resolve(stream([['results', { items: [{ videoId: 'old' }] }], done], 1024));
  await first;
  assert.deepEqual(Array.from(h.AC.radioState.results, r => r.videoId), ['new']);
  assert.equal(h.AC.radioState.loading, false);
});

test('search is debounced and only sends the latest query; short queries cancel work', async () => {
  const h = setup(); const R = h.AC.radioState; R.mode = 'query';
  h.setFetch(() => stream([done], 1024));
  h.AC.bindRadio();
  const query = h.getNode('radio-query');
  query.value = 'Sa'; query.emit('input');
  h.advance(400); query.value = 'Sade'; query.emit('input');
  h.advance(699); assert.equal(h.calls.length, 0);
  h.advance(1); await flush();
  assert.equal(h.calls.length, 1); assert.equal(JSON.parse(h.calls[0][1].body).query, 'Sade');
  query.value = 'S'; query.emit('input'); h.advance(1000); await flush();
  assert.equal(h.calls.length, 1); assert.equal(R.results.length, 0);
});

test('a stream that ends before done reports its interruption while retaining received results', async () => {
  const h = setup(); h.setFetch(() => stream([['results', { items: [{ videoId: 'partial' }] }]], 1024));
  await h.AC.searchRadio();
  assert.equal(h.AC.radioState.results.length, 1);
  assert.match(h.AC.radioState.error, /interrompida/);
  assert.equal(h.AC.radioState.loading, false);
});

test('recent listening refreshes recent mode and does not replace an explicit reference', () => {
  const h = setup(); let searches = 0; h.AC.searchRadio = () => { searches++; };
  h.AC.onListen(); assert.equal(searches, 1);
  h.AC.radioState.mode = 'seed'; h.AC.onListen(); assert.equal(searches, 1);
  h.AC.radioState.mode = 'recent'; h.AC.state.view = 'home'; h.AC.onListen(); assert.equal(searches, 1);
});

test('periodic live refresh runs after 90 seconds and only in recent radio mode', async () => {
  const h = setup(); h.setFetch(() => stream([done], 1024)); await h.AC.searchRadio();
  h.advance(89000); await flush(); assert.equal(h.calls.length, 1);
  h.advance(15000); await flush(); assert.equal(h.calls.length, 2);
  h.AC.state.view = 'home'; h.advance(90000); await flush(); assert.equal(h.calls.length, 2);
  h.AC.state.view = 'radio'; h.AC.radioState.mode = 'query'; h.advance(90000); await flush(); assert.equal(h.calls.length, 2);
});

test('listen discovery reuses an existing import and clears failed new intent', async () => {
  const h = setup(); const S = h.AC.state; const R = h.AC.radioState;
  R.results = [{ videoId: 'one', title: 'One' }, { videoId: 'two', title: 'Two' }];
  S.jobs.one = { status: 'queued' }; let imported = 0;
  h.AC.startImport = async () => { imported++; return null; };
  await h.AC.listenDiscovery('one'); assert.equal(imported, 0); assert.equal(S.playAfterImport, 'one');
  await h.AC.listenDiscovery('two'); assert.equal(imported, 1); assert.equal(S.playAfterImport, null);
});

test('job completion refreshes the library and plays the requested imported track', async () => {
  const h = setup({ app: true, volume: '.85' }); const S = h.AC.state;
  const imported = { id: 'new', videoId: 'video', title: 'New', artist: 'Artist' };
  S.playAfterImport = 'video'; S.view = 'radio';
  h.setFetch((url) => ({ ok: true, json: async () => url === '/api/library' ? { tracks: [imported] } : {} }));
  h.AC.api = async url => url.startsWith('/api/jobs/') ? { status: 'done', videoId: 'video', trackId: 'new', track: imported } : { tracks: [imported] };
  h.AC.pollJob('job', 'video'); await flush();
  assert.equal(S.current?.id, 'new'); assert.equal(S.playAfterImport, null);
  assert.ok(S.queue.includes('new')); assert.equal(h.audio.src, '/api/stream/new');
});

test('play history is recorded only after successful playback, and resume does not double count', async () => {
  const h = setup({ app: true, volume: '.85' }); const S = h.AC.state;
  S.tracks = [{ id: 'one', title: 'One', artist: 'Artist', plays: 0 }]; S.view = 'home';
  h.AC.play('one'); await flush();
  assert.equal(h.calls.filter(c => c[0].endsWith('/play')).length, 1);
  assert.equal(S.tracks[0].plays, 1);
  h.AC.toggle(); h.AC.toggle(); await flush();
  assert.equal(h.calls.filter(c => c[0].endsWith('/play')).length, 1);
  S.current = null; h.audio.play = () => Promise.reject(new Error('blocked'));
  h.AC.play('one'); await flush();
  assert.equal(h.calls.filter(c => c[0].endsWith('/play')).length, 1);
});

test('manual stop is respected by the periodic refresh timer', async () => {
  const h = setup(); h.setFetch(() => stream([done], 1024)); await h.AC.searchRadio();
  h.AC.stopRadioSearch(); h.advance(100000); await flush();
  assert.equal(h.calls.length, 1);
});

test('manual stop is respected by listening changes until the next explicit search', async () => {
  const h = setup(); h.setFetch(() => stream([done], 1024)); await h.AC.searchRadio();
  h.AC.stopRadioSearch(); h.AC.onListen(); await flush(); assert.equal(h.calls.length, 1);
  await h.AC.searchRadio(); h.AC.onListen(); await flush(); assert.equal(h.calls.length, 3);
});

test('reopening recent radio resumes a search cancelled by leaving', async () => {
  const h = setup(); const pending = deferred();
  h.setFetch(() => h.calls.length === 1 ? pending.promise : stream([done], 1024));
  const first = h.AC.searchRadio(); h.AC.leaveRadio();
  h.AC.state.view = 'home'; h.AC.state.view = 'radio'; h.AC.bindRadio(); await flush();
  assert.equal(h.calls.length, 2);
  pending.resolve(stream([done], 1024)); await first;
});

test('first-use volume retains the audible .85 default when storage is absent', () => {
  const h = setup({ app: true }); assert.equal(h.audio.volume, .85);
});

test('starting radio without a track uses recent listening even after an explicit query', async () => {
  const h = setup(); const R = h.AC.radioState; R.mode = 'query'; R.query = 'old reference';
  h.setFetch(() => stream([done], 1024)); h.AC.startLiveRadio(); await flush();
  assert.equal(R.mode, 'recent'); assert.equal(JSON.parse(h.calls[0][1].body).query, undefined);
});

test('repeat-one starts a new listened play and records it without counting pause/resume again', async () => {
  const h = setup({ app: true, volume: '.85' }); const S = h.AC.state;
  S.tracks = [{ id: 'one', title: 'One', artist: 'Artist', plays: 0 }]; S.view = 'home';
  h.AC.play('one'); await flush(); S.repeat = 'one'; h.audio.paused = true; h.audio.emit('ended'); await flush();
  assert.equal(h.calls.filter(c => c[0].endsWith('/play')).length, 2);
  h.AC.toggle(); h.AC.toggle(); await flush();
  assert.equal(h.calls.filter(c => c[0].endsWith('/play')).length, 2);
});

test('repeat-all with one source records its next playback after ended', async () => {
  const h = setup({ app: true, volume: '.85' }); const S = h.AC.state;
  S.tracks = [{ id: 'one', title: 'One', artist: 'Artist', plays: 0 }]; S.view = 'home';
  h.AC.play('one'); await flush(); S.repeat = 'all'; h.audio.paused = true; h.audio.emit('ended'); await flush();
  assert.equal(h.calls.filter(c => c[0].endsWith('/play')).length, 2);
});

test('submitting the global search aborts the hidden live radio work', async () => {
  const h = setup({ app: true, views: true, volume: '.85' }); const pending = deferred();
  h.setFetch(url => url === '/api/radio' ? pending.promise : { ok: true, json: async () => ({ results: [] }) });
  h.AC.go('radio'); const signal = h.calls[0][1].signal;
  h.AC.handleAction('search-chip', { getAttribute: () => 'artist' }); await flush();
  assert.equal(h.AC.state.view, 'search'); assert.equal(signal.aborted, true);
  pending.resolve(stream([done], 1024)); await flush();
});
