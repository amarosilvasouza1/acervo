import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

// Deterministic browser contexts; no real server, browser, audio, network, or library writes.
const sources = {};
for (const name of ['app', 'connect', 'radio', 'views']) sources[name] = await readFile(new URL(`../public/${name}.js`, import.meta.url), 'utf8');
const indexHtml = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const shippedScriptOrder = [...indexHtml.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
  .map(match => new URL(match[1], 'http://acervo.test').pathname.match(/\/([^/]+)\.js$/)?.[1])
  .filter(name => name in sources);
const tracks = [
  { id: 'one', videoId: 'video-one', title: 'One', artist: 'Artist', duration: 240, plays: 0 },
  { id: 'two', videoId: 'video-two', title: 'Two', artist: 'Artist', duration: 180, plays: 0 }
];
const flush = async () => { for (let i = 0; i < 70; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const plain = value => JSON.parse(JSON.stringify(value));

function element() {
  const listeners = new Map(); const attributes = new Map(); const classes = new Set();
  return {
    value: '', textContent: '', innerHTML: '', hidden: false, dataset: {}, style: {}, children: [], tagName: 'DIV',
    classList: { toggle(name, force) { if (force ?? !classes.has(name)) classes.add(name); else classes.delete(name); }, add(name) { classes.add(name); }, remove(name) { classes.delete(name); }, contains(name) { return classes.has(name); } },
    addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(callback); },
    removeEventListener(name, callback) { listeners.set(name, (listeners.get(name) || []).filter(fn => fn !== callback)); },
    emit(name, data = {}) { for (const callback of listeners.get(name) || []) callback(data); },
    setAttribute(name, value) { attributes.set(name, String(value)); }, getAttribute(name) { return attributes.get(name) ?? null; }, removeAttribute(name) { attributes.delete(name); },
    querySelectorAll() { return []; }, querySelector() { return null; }, focus() {}, insertAdjacentHTML() {}, appendChild() {}, remove() {},
    getBoundingClientRect() { return { width: 100, left: 0 }; }
  };
}

function browser({ deviceId = 'pc', mobile = false, hash = '', stored = {}, backend, boot = false, readyState = 'loading', scriptOrder = ['app', 'connect', 'radio', 'views'] } = {}) {
  let now = Date.parse('2026-10-18T18:00:00Z'); let nextTimer = 0; let currentPlayError = null;
  const timers = new Map(); const nodes = new Map(); const streams = []; const calls = []; const storageWrites = [];
  const getNode = id => nodes.get(id) || (nodes.set(id, element()), nodes.get(id));
  const documentEvents = element();
  const location = { origin: 'http://192.168.0.10:4310', protocol: 'http:', host: '192.168.0.10:4310', hostname: '192.168.0.10', port: '4310', pathname: '/', search: '', hash };
  location.href = location.origin + location.pathname + location.hash;
  const historyCalls = [];
  const history = { replaceState(...args) { historyCalls.push(args); const url = new URL(args[2], location.origin); location.href = url.href; location.pathname = url.pathname; location.search = url.search; location.hash = url.hash; } };
  const document = {
    readyState, getElementById: getNode, querySelector: () => null, querySelectorAll: () => [],
    addEventListener: (...args) => documentEvents.addEventListener(...args), removeEventListener: (...args) => documentEvents.removeEventListener(...args),
    body: element(), activeElement: { tagName: 'BODY' }, createElement: element, visibilityState: 'visible'
  };
  const makeStorage = (type, initial = {}) => {
    const data = new Map(Object.entries(initial));
    return { getItem: key => data.get(key) ?? null, setItem(key, value) { data.set(key, String(value)); storageWrites.push({ type, key, value: String(value) }); }, removeItem(key) { data.delete(key); }, data };
  };
  const localStorage = makeStorage('local', stored); const sessionStorage = makeStorage('session');
  class FakeDate extends Date { static now() { return now; } }
  class EventSource {
    constructor(url) { this.url = url; this.events = new Map(); this.closed = false; streams.push(this); backend?.open?.(this, deviceId); }
    addEventListener(name, fn) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(fn); }
    emit(name, data) { if (this.closed) return; const event = { data: JSON.stringify(data) }; for (const fn of this.events.get(name) || []) fn(event); if (name === 'message') this.onmessage?.(event); }
    close() { this.closed = true; }
  }
  const audio = getNode('audio'); const audioCalls = [];
  Object.assign(audio, { paused: true, ended: false, src: '', currentTime: 0, duration: 240, readyState: 4, volume: .85, muted: false,
    play() {
      audioCalls.push({ type: 'play', src: audio.src, position: audio.currentTime });
      if (currentPlayError) return Promise.reject(currentPlayError);
      audio.paused = false; audio.ended = false; audio.emit('play'); return Promise.resolve();
    },
    pause() { audioCalls.push({ type: 'pause', src: audio.src, position: audio.currentTime }); const changed = !audio.paused; audio.paused = true; if (changed) audio.emit('pause'); },
    load() { audio.emit('loadedmetadata'); }
  });
  const globalEvents = element();
  const window = { location, history, innerWidth: mobile ? 390 : 1280,
    addEventListener: (...args) => globalEvents.addEventListener(...args), removeEventListener: (...args) => globalEvents.removeEventListener(...args),
    matchMedia: () => ({ matches: mobile, addEventListener() {}, addListener() {} }) };
  const context = vm.createContext({
    window, document, location, history, navigator: { userAgent: mobile ? 'Mozilla/5.0 iPhone Mobile' : 'Mozilla/5.0 Windows', platform: mobile ? 'iPhone' : 'Win32' },
    console, URL, URLSearchParams, Headers, AbortController, TextDecoder, TextEncoder, EventSource, Date: FakeDate, Set, Map, localStorage, sessionStorage,
    crypto: { randomUUID: () => deviceId },
    fetch: async (url, options = {}) => {
      const call = { url, options, body: options.body ? JSON.parse(options.body) : null, deviceId }; calls.push(call);
      const response = await backend?.fetch?.(call);
      return response ?? { ok: true, status: 200, json: async () => url === '/api/library' ? { tracks: plain(tracks), stats: { tracks: tracks.length, duration: 420 } } : {} };
    },
    setTimeout(callback, delay = 0) { const id = ++nextTimer; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(callback, interval) { const id = ++nextTimer; timers.set(id, { callback, at: now + interval, interval }); return id; },
    clearInterval(id) { timers.delete(id); },
    requestAnimationFrame(callback) { callback(); return 1; }, cancelAnimationFrame() {}
  });
  window.EventSource = EventSource; window.localStorage = localStorage; window.sessionStorage = sessionStorage;
  for (const name of scriptOrder) vm.runInContext(sources[name], context, { filename: `public/${name}.js` });
  const AC = window.AC; AC.toast = () => {};
  if (!boot) { AC.state.tracks = plain(tracks); AC.state.stats = { tracks: tracks.length, duration: 420 }; }
  return {
    AC, context, calls, streams, audio, audioCalls, storageWrites, localStorage, sessionStorage, location, historyCalls, nodes, getNode,
    boot() { documentEvents.emit('DOMContentLoaded'); },
    emit(name, data) { streams.at(-1)?.emit(name, data); },
    failPlay(message = 'User interaction required') { currentPlayError = new Error(message); },
    allowPlay() { currentPlayError = null; },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) {
        if (timer.interval) timer.at = now + timer.interval; else timers.delete(id);
        timer.callback();
      }
    }
  };
}

function response(data, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => plain(data) }; }
const playback = overrides => ({ activeDeviceId: 'pc', trackId: 'one', queue: ['one', 'two'], qi: 0, playing: false, position: 37, volume: .85, shuffle: false, repeat: 'off', updatedAt: '2026-10-18T18:00:00Z', revision: 1, ...overrides });
const device = (id, local = id === 'pc') => ({ id, name: id === 'pc' ? 'Meu computador' : 'Meu celular', kind: local ? 'desktop' : 'mobile', local, online: true, lastSeenAt: '2026-10-18T18:00:00Z' });
const snapshot = (id = 'pc', state = {}) => ({ local: id === 'pc', deviceId: id, devices: [device('pc'), device('phone', false)], playback: playback(state) });

function sharedBackend(initial = {}) {
  const state = playback(initial); const streams = new Map(); const calls = []; const commands = []; const paired = new Set();
  let commandId = 0;
  const broadcast = (event, data, ids = null) => {
    for (const [id, stream] of streams) if (!ids || ids.includes(id)) stream.emit(event, data);
  };
  const snap = id => snapshot(id, state);
  return {
    state, calls, commands, paired, broadcast,
    open(stream, id) { streams.set(id, stream); },
    snapshot: snap,
    async fetch(call) {
      calls.push(call);
      if (calls.length > 200) throw new Error('Possible Connect echo loop');
      const { url, body, deviceId } = call;
      if (url === '/api/connect/config') return response({ cloud: false });
      if (url === '/api/connect/info') return response(deviceId === 'pc' || paired.has(deviceId) ? snap(deviceId) : { error: 'Leia o QR Code para conectar.' }, deviceId === 'pc' || paired.has(deviceId) ? 200 : 401);
      if (url === '/api/connect/register') return response(snap(deviceId));
      if (url === '/api/connect/claim') { paired.add(deviceId); return response(snap(deviceId)); }
      if (url === '/api/connect/state') {
        if (deviceId !== state.activeDeviceId) return response({ error: 'Outro dispositivo está reproduzindo.' }, 409);
        Object.assign(state, body, { activeDeviceId: deviceId, revision: state.revision + 1 }); broadcast('state', plain(state));
        return response({ ok: true, playback: state });
      }
      if (url === '/api/connect/command') {
        const previousId = state.activeDeviceId;
        if (body.type === 'transfer') {
          state.activeDeviceId = body.args.targetDeviceId; state.revision++;
          broadcast('state', plain(state));
        }
        const command = { id: `command-${++commandId}`, type: body.type, args: body.args || {}, fromDeviceId: deviceId, targetDeviceId: state.activeDeviceId, ...(body.type === 'transfer' ? { playback: plain(state) } : {}) };
        commands.push(command);
        broadcast('command', command, body.type === 'transfer' ? [previousId, state.activeDeviceId] : [state.activeDeviceId]);
        return response({ ok: true, command, playback: state });
      }
      if (url.startsWith('/api/connect/pairing')) return response({ code: 'test-pairing-code', expiresAt: Date.now() + 300000, url: 'http://192.168.0.10:4310/#connect=test-pairing-code', qrDataUrl: 'data:image/svg+xml;base64,PHN2Zy8+', candidates: [] });
      if (url === '/api/health') return response({ tracks: tracks.length });
      if (url === '/api/library') return response({ tracks, stats: { tracks: tracks.length, duration: 420 } });
      return response({ ok: true });
    }
  };
}

const mutualSecurity = { type: 'mtls-pinned', mutual: true, exclusive: true, pcPin: 'a'.repeat(64), phonePin: 'b'.repeat(64), pairedDeviceId: 'phone', publicEndpoint: 'https://public.example:4311' };
function mutualBackend({ paired = true, pairing = null, unauthorized = false } = {}) {
  const base = sharedBackend();
  return { ...base, async fetch(call) {
    if (call.url === '/api/connect/config') return response({ cloud: false, security: { type: 'mtls-pinned', mutual: true, exclusive: true } });
    if (call.url === '/api/connect/info' || call.url === '/api/connect/register') {
      if (unauthorized) return response({ error: 'Leia no APK' }, 401);
      return response({ ...snapshot('pc'), devices: paired ? [device('pc'), device('phone', false)] : [device('pc')],
        security: { ...mutualSecurity, phonePin: paired ? mutualSecurity.phonePin : null, pairedDeviceId: paired ? 'phone' : null } });
    }
    if (call.url === '/api/connect/pairing' && pairing) return pairing.promise;
    return base.fetch(call);
  } };
}

test('mutual verification shows both identities and paired phones suppress new invites', async () => {
  const h = browser({ backend: mutualBackend() });
  await h.AC.initConnect(); h.AC.openDevices(); await flush();
  assert.match(h.getNode('connect-verification').innerHTML, /AAAAAAAA AAAAAAAA/);
  assert.match(h.getNode('connect-verification').innerHTML, /BBBBBBBB BBBBBBBB/);
  assert.match(h.getNode('connect-verification').innerHTML, /https:\/\/public.example:4311/);
  assert.match(h.getNode('connect-pairing').innerHTML, /remova o celular autorizado/);
  await h.AC.playerActions['connect-create']();
  assert.equal(h.calls.filter(call => call.url === '/api/connect/pairing').length, 0);
});

test('concurrent QR generation is deduplicated and cannot resurrect an invite after pairing', async () => {
  const pending = deferred();
  const h = browser({ backend: mutualBackend({ paired: false, pairing: pending }) });
  await h.AC.initConnect(); h.AC.openDevices();
  h.AC.playerActions['connect-create'](); h.AC.openDevices();
  assert.equal(h.calls.filter(call => call.url === '/api/connect/pairing').length, 1);
  h.emit('devices', { ...snapshot('pc'), security: mutualSecurity });
  pending.resolve(response({ code: 'one-use', expiresAt: Date.parse('2026-10-18T18:05:00Z'), security: { type: 'mtls-pinned', pin: mutualSecurity.pcPin }, candidates: [] }));
  await flush();
  assert.equal(h.AC.connect.pairing, null);
  assert.match(h.getNode('connect-pairing').innerHTML, /remova o celular autorizado/);
});

test('mutual connection guidance requires the APK identity and hides browser manual claim', async () => {
  const h = browser({ backend: mutualBackend({ unauthorized: true }) });
  assert.equal(await h.AC.initConnect(), false);
  assert.match(h.getNode('modal-root').innerHTML, /APK atualizado/);
  assert.doesNotMatch(h.getNode('modal-root').innerHTML, /connect-claim-form/);
});

// Test cases below exercise the public Connect hooks once their implementation is present.

test('controller playback snapshots update visible state without playing local audio', () => {
  const h = browser();
  h.AC.applyRemotePlayback(playback({ trackId: 'two', qi: 1, playing: true, position: 41, volume: .4 }));
  assert.equal(h.AC.state.current.id, 'two'); assert.equal(h.AC.state.playing, true);
  assert.equal(h.audio.src, ''); assert.equal(h.audioCalls.length, 0);
  assert.equal(h.getNode('player-title').textContent, 'Two');
});

test('handoff restores the same track and position without counting another listen', async () => {
  const h = browser();
  await h.AC.restorePlayback(playback({ playing: true, position: 83.25 }));
  assert.equal(h.audio.src, '/api/stream/one'); assert.equal(h.audio.currentTime, 83.25);
  assert.equal(h.audio.paused, false); assert.equal(h.AC.state.playing, true);
  assert.equal(h.calls.filter(call => /\/play$/.test(call.url)).length, 0);
});

test('paused handoff preserves the pause and clamps positions to the track duration', async () => {
  const h = browser();
  await h.AC.restorePlayback(playback({ playing: false, position: 9999 }));
  assert.equal(h.audio.currentTime, 239.9); assert.equal(h.audio.paused, true);
  assert.equal(h.audioCalls.filter(call => call.type === 'play').length, 0);
  assert.equal(h.AC.state.playing, false);
});

test('autoplay rejection reports actual paused playback and invokes the blocked hook', async () => {
  const h = browser(); let blocked = 0; let telemetry;
  h.AC.onPlaybackBlocked = () => { blocked++; };
  h.AC.notifyPlayback = () => { telemetry = plain(h.AC.playbackSnapshot()); };
  h.failPlay(); await h.AC.restorePlayback(playback({ playing: true, position: 52 }));
  assert.equal(blocked, 1); assert.equal(h.AC.state.playing, false);
  assert.equal(h.audio.paused, true); assert.equal(telemetry.playing, false); assert.equal(telemetry.position, 52);
});

test('controller core controls route to commands without touching the local audio element', async () => {
  const h = browser(); const commands = [];
  h.AC.applyRemotePlayback(playback({ playing: true }));
  h.AC.syncCommand = (type, args) => { commands.push({ type, args: plain(args) }); return true; };
  h.AC.play('two'); h.AC.toggle(); h.AC.next(false); h.AC.prev(); h.AC.seekRatio(.5); h.AC.setVolume(.3);
  h.AC.playerActions.shuffle(); h.AC.playerActions.repeat();
  await flush();
  assert.deepEqual(commands.map(command => command.type), ['play', 'toggle', 'next', 'previous', 'seek', 'volume', 'shuffle', 'repeat']);
  assert.equal(commands[4].args.position, 120); assert.equal(h.audioCalls.length, 0);
  assert.equal(h.audio.src, '');
});

async function connectBrowser(h) {
  assert.equal(await h.AC.initConnect(), true);
  h.streams.at(-1)?.onopen?.(); await flush();
  return h;
}
async function connectedPair(initial = {}) {
  const backend = sharedBackend(initial);
  const pc = await connectBrowser(browser({ backend }));
  const phone = await connectBrowser(browser({ deviceId: 'phone', mobile: true, hash: '#pair=test-code', backend }));
  return { backend, pc, phone };
}

test('two devices share play state while only the selected output plays; duplicate commands apply once', async () => {
  const { backend, pc, phone } = await connectedPair();
  phone.AC.play('two'); await flush();
  assert.equal(backend.commands.length, 1); assert.equal(backend.commands[0].type, 'play');
  assert.equal(pc.AC.state.current.id, 'two'); assert.equal(pc.audio.paused, false);
  assert.equal(phone.AC.state.current.id, 'two'); assert.equal(phone.AC.state.playing, true);
  assert.equal(phone.audioCalls.filter(call => call.type === 'play').length, 0);
  const before = pc.audioCalls.filter(call => call.type === 'play').length;
  backend.broadcast('command', backend.commands[0]); await flush();
  assert.equal(pc.audioCalls.filter(call => call.type === 'play').length, before);
});

test('remote pause, seek and volume are applied on the output and synchronize back to the controller', async () => {
  const { backend, pc, phone } = await connectedPair();
  phone.AC.play('one'); await flush();
  phone.AC.seekRatio(.5); await flush();
  phone.AC.setVolume(.3); await flush();
  phone.AC.toggle(); await flush();
  assert.equal(pc.audio.currentTime, 120); assert.equal(pc.audio.volume, .3); assert.equal(pc.audio.paused, true);
  assert.equal(phone.AC.state.playing, false); assert.equal(phone.AC.state.volume, .3);
  assert.deepEqual(backend.commands.map(command => command.type), ['play', 'seek', 'volume', 'toggle']);
  assert.equal(phone.calls.filter(call => call.url === '/api/connect/state').length, 0);
});

test('state telemetry is consumed without echo loops or extra local play calls', async () => {
  const { backend, pc, phone } = await connectedPair();
  const before = backend.calls.filter(call => call.url === '/api/connect/state').length;
  const playCalls = pc.audioCalls.filter(call => call.type === 'play').length;
  backend.broadcast('state', playback({ playing: true, position: 90, revision: backend.state.revision + 1 }));
  await flush(); pc.advance(5000); phone.advance(5000); await flush();
  assert.equal(backend.calls.filter(call => call.url === '/api/connect/state').length, before);
  assert.equal(pc.audioCalls.filter(call => call.type === 'play').length, playCalls);
  assert.equal(phone.AC.state.playing, true); assert.equal(phone.AC.remotePosition(), 95);
});

test('transfer pauses the old output and resumes once at the same position on the new output', async () => {
  const { backend, pc, phone } = await connectedPair();
  phone.AC.play('one'); await flush();
  pc.audio.currentTime = 77; pc.AC.notifyPlayback(true); await flush();
  const historyBefore = backend.calls.filter(call => /\/play$/.test(call.url)).length;
  phone.AC.playerActions['connect-transfer']({ getAttribute: () => 'phone' }); await flush();
  assert.equal(backend.state.activeDeviceId, 'phone'); assert.equal(pc.audio.paused, true);
  assert.equal(phone.audio.paused, false); assert.equal(phone.audio.currentTime, 77);
  assert.equal(phone.audioCalls.filter(call => call.type === 'play').length, 1);
  assert.equal(backend.calls.filter(call => /\/play$/.test(call.url)).length, historyBefore);
  assert.equal(phone.AC.isRemotePlayback(), false); assert.equal(pc.AC.isRemotePlayback(), true);
});

test('blocked transfer publishes paused truth and offers a local user gesture to resume', async () => {
  const { backend, pc, phone } = await connectedPair();
  phone.AC.play('one'); await flush(); phone.failPlay();
  phone.AC.playerActions['connect-transfer']({ getAttribute: () => 'phone' }); await flush();
  assert.equal(pc.audio.paused, true); assert.equal(phone.audio.paused, true);
  assert.equal(backend.state.playing, false); assert.equal(pc.AC.state.playing, false);
  assert.equal(phone.AC.connect.needsGesture, true);
  phone.allowPlay(); phone.AC.toggle(); await flush();
  assert.equal(phone.audio.paused, false); assert.equal(phone.AC.connect.needsGesture, false);
});

test('remote boot claims the QR before loading the library, strips the fragment, and stores no pairing secret', async () => {
  const backend = sharedBackend();
  const h = browser({ deviceId: 'phone', mobile: true, hash: '#pair=private-code', backend, boot: true });
  h.boot(); await flush();
  const urls = h.calls.map(call => call.url);
  assert.ok(urls.indexOf('/api/connect/config') < urls.indexOf('/api/connect/claim'));
  assert.ok(urls.indexOf('/api/connect/claim') >= 0);
  assert.ok(urls.indexOf('/api/library') > urls.indexOf('/api/connect/claim'));
  assert.equal(h.location.hash, ''); assert.equal(h.historyCalls.length, 1);
  assert.equal(h.calls.find(call => call.url === '/api/connect/claim').body.code, 'private-code');
  assert.equal(h.storageWrites.some(write => /private-code|token|secret/i.test(write.value)), false);
  assert.equal(h.streams[0].url, '/api/connect/events');
});

test('cookie reconnect requires no stored code and ignores older playback revisions', async () => {
  const backend = sharedBackend(); backend.paired.add('phone');
  const h = await connectBrowser(browser({ deviceId: 'phone', mobile: true, backend }));
  assert.equal(h.calls.some(call => call.url === '/api/connect/claim'), false);
  assert.equal(h.storageWrites.length, 0);
  h.emit('state', playback({ trackId: 'two', revision: 100 }));
  h.emit('state', playback({ trackId: 'one', revision: 99 }));
  assert.equal(h.AC.state.current.id, 'two');
  h.streams[0].onerror(); assert.equal(h.AC.connect.connected, false);
  const before = backend.commands.length; h.AC.play('one'); await flush(); assert.equal(backend.commands.length, before);
  h.streams[0].onopen(); await flush(); assert.equal(h.AC.connect.connected, true);
});

test('library changes refresh connected clients and new plays refresh recent radio on a controller', async () => {
  const { backend, phone } = await connectedPair();
  phone.AC.state.view = 'radio'; phone.AC.radioState.mode = 'recent'; let searches = 0;
  phone.AC.searchRadio = () => { searches++; };
  const before = phone.calls.filter(call => call.url === '/api/library').length;
  backend.broadcast('library-changed', { reason: 'played', trackId: 'one' }); await flush();
  assert.equal(phone.calls.filter(call => call.url === '/api/library').length, before + 1);
  assert.equal(searches, 1);
});

test('rapid play then pause commands execute in server order even when play awaits track lookup', async () => {
  const { backend, pc } = await connectedPair();
  backend.broadcast('command', { id: 'rapid-play', type: 'play', args: { trackId: 'two' }, targetDeviceId: 'pc' });
  backend.broadcast('command', { id: 'rapid-pause', type: 'pause', args: {}, targetDeviceId: 'pc' });
  await flush();
  assert.equal(pc.AC.state.current.id, 'two');
  assert.equal(pc.audio.paused, true); assert.equal(backend.state.playing, false);
});

test('shipped deferred script order initializes Connect before library boot at interactive readyState', async () => {
  assert.ok(shippedScriptOrder.includes('app') && shippedScriptOrder.includes('connect') && shippedScriptOrder.includes('views'));
  const backend = sharedBackend();
  const h = browser({ backend, boot: true, readyState: 'interactive', scriptOrder: shippedScriptOrder });
  // Deferred scripts run after parsing, so views must boot immediately without DOMContentLoaded.
  await flush();
  const urls = h.calls.map(call => call.url);
  const registerAt = urls.indexOf('/api/connect/register'); const libraryAt = urls.indexOf('/api/library');
  assert.ok(registerAt >= 0, 'the shipped page must register its output device during immediate boot');
  assert.ok(libraryAt > registerAt, 'Connect registration must finish before protected library loading');
  assert.equal(h.AC.connect.ready, true); assert.equal(h.streams.length, 1);
});

test('a revoked remote session stops audio, closes its event stream and clears protected library state', async () => {
  const { pc, phone } = await connectedPair();
  phone.AC.playerActions['connect-transfer']({ getAttribute: () => 'phone' }); await flush();
  phone.AC.play('one'); await flush(); assert.equal(phone.audio.paused, false);
  phone.emit('revoked', { reason: 'disconnected' }); await flush();
  assert.equal(phone.audio.paused, true); assert.equal(phone.AC.state.playing, false);
  assert.equal(phone.AC.connect.ready, false); assert.equal(phone.AC.connect.connected, false);
  assert.equal(phone.streams.at(-1).closed, true); assert.equal(phone.AC.state.tracks.length, 0);
  assert.equal(phone.AC.state.current, null); assert.equal(phone.AC.state.queue.length, 0);
  assert.equal(phone.AC.connect.dialog, 'pair');
});

test('a library response already in flight cannot repopulate a revoked remote session', async () => {
  const { backend, phone } = await connectedPair();
  const pending = deferred(); const previousFetch = backend.fetch;
  backend.fetch = call => call.deviceId === 'phone' && call.url === '/api/library' ? pending.promise : previousFetch(call);
  phone.emit('library-changed', { reason: 'imported', trackId: 'two' }); await flush();
  phone.emit('revoked', {}); await flush();
  pending.resolve(response({ tracks, stats: { tracks: tracks.length } })); await flush();
  assert.equal(phone.AC.state.tracks.length, 0); assert.equal(phone.AC.state.current, null);
  assert.equal(phone.AC.connect.dialog, 'pair');
});

function cloudBackend({ authenticated = false, admin = true } = {}) {
  const base = sharedBackend({ activeDeviceId: 'phone' });
  let signedIn = authenticated;
  const cloudSnapshot = () => ({ ...base.snapshot('phone'), local: false, admin, cloud: true });
  const fetch = base.fetch;
  base.fetch = async call => {
    if (call.url === '/api/connect/config') return response({ cloud: true });
    if (call.url === '/api/connect/info') return response(signedIn ? cloudSnapshot() : { error: 'Entre no seu Acervo.' }, signedIn ? 200 : 401);
    if (call.url === '/api/connect/login') {
      if (call.body.password !== ' cloud owner password ') return response({ error: 'Senha incorreta.' }, 401);
      signedIn = true; return response(cloudSnapshot());
    }
    if (call.url === '/api/connect/claim') { signedIn = true; return response({ ...cloudSnapshot(), admin: false }); }
    if (call.url === '/api/connect/logout') { signedIn = false; return response({ ok: true }); }
    if (call.url === '/api/connect/pairing') return response({ code: 'cloud-single-use-code', expiresAt: Date.parse('2026-10-18T18:05:00Z'), url: 'https://music.example.com/#pair=cloud-single-use-code', qrDataUrl: 'data:image/png;base64,aGVsbG8=', candidates: [] });
    return fetch(call);
  };
  return base;
}

test('cloud login sends the password only in its POST and creates a cookie-based output without local registration', async () => {
  const h = browser({ deviceId: 'phone', mobile: true, backend: cloudBackend() });
  assert.equal(await h.AC.initConnect(), false);
  assert.deepEqual(h.calls.map(call => call.url), ['/api/connect/config', '/api/connect/info']);
  const html = h.getNode('modal-root').innerHTML;
  assert.match(html, /type="password"[^>]*id="connect-password"[^>]*autocomplete="current-password"/);
  assert.match(html, /connect-claim-form/);
  assert.doesNotMatch(html, /computador|mesmo Wi/);
  h.getNode('connect-password').value = ' cloud owner password ';
  h.getNode('connect-login-form').emit('submit', { preventDefault() {} });
  assert.equal(h.getNode('connect-password').value, '');
  await flush();
  assert.equal(h.AC.connect.ready, true); assert.equal(h.AC.connect.admin, true); assert.equal(h.AC.connect.local, false);
  const login = h.calls.find(call => call.url === '/api/connect/login');
  assert.equal(login.options.method, 'POST'); assert.equal(login.body.password, ' cloud owner password ');
  assert.equal(login.body.kind, 'mobile'); assert.equal(login.options.credentials, 'same-origin');
  assert.equal(h.calls.some(call => call.url === '/api/connect/register'), false);
  assert.equal(h.calls.some(call => 'X-Acervo-Device' in call.options.headers), false);
  assert.equal(h.streams.at(-1).url, '/api/connect/events');
  assert.equal(h.storageWrites.length, 0);
  assert.ok(h.calls.some(call => call.url === '/api/library'));
  assert.equal(h.getNode('modal-root').innerHTML, '');
});

test('a rejected cloud password keeps the login dialog and never loads protected library data', async () => {
  const h = browser({ deviceId: 'phone', mobile: true, backend: cloudBackend() });
  await h.AC.initConnect();
  h.getNode('connect-password').value = 'wrong';
  h.getNode('connect-login-form').emit('submit', { preventDefault() {} });
  await flush();
  assert.equal(h.AC.connect.ready, false); assert.equal(h.AC.connect.admin, false);
  assert.equal(h.getNode('connect-error').textContent, 'Senha incorreta.');
  assert.equal(h.getNode('connect-password').value, ''); assert.equal(h.streams.length, 0);
  assert.equal(h.calls.some(call => call.url === '/api/library'), false);
  assert.equal(h.storageWrites.length, 0);
});

test('cloud owners can pair and revoke devices while keeping remote-only identity handling', async () => {
  const h = await connectBrowser(browser({ deviceId: 'phone', mobile: true, backend: cloudBackend({ authenticated: true }) }));
  h.AC.openDevices(); await flush();
  assert.match(h.getNode('modal-root').innerHTML, /connect-pairing/);
  assert.match(h.getNode('modal-root').innerHTML, /connect-logout/);
  assert.match(h.getNode('connect-device-list').innerHTML, /connect-revoke/);
  assert.match(h.getNode('connect-pairing').innerHTML, /https:\/\/music.example.com\/#pair=cloud-single-use-code/);
  assert.doesNotMatch(h.getNode('connect-pairing').innerHTML, /computador|mesma rede/);
  assert.equal(h.calls.filter(call => call.url === '/api/connect/pairing').length, 1);
  h.AC.playerActions['connect-revoke']({ getAttribute: () => 'pc' }); await flush();
  assert.equal(h.calls.find(call => call.url === '/api/connect/devices/pc').options.method, 'DELETE');
  assert.equal(h.calls.some(call => 'X-Acervo-Device' in call.options.headers), false);
  assert.equal(h.storageWrites.length, 0);
});

test('cloud QR claims work before library boot and paired devices do not receive owner controls', async () => {
  const h = browser({ deviceId: 'phone', mobile: true, hash: '#pair=cloud-qr-code', backend: cloudBackend(), boot: true });
  h.boot(); await flush();
  const urls = h.calls.map(call => call.url);
  assert.ok(urls.indexOf('/api/connect/config') < urls.indexOf('/api/connect/claim'));
  assert.ok(urls.indexOf('/api/connect/claim') < urls.indexOf('/api/library'));
  assert.equal(h.location.hash, ''); assert.equal(h.storageWrites.length, 0);
  assert.equal(h.AC.connect.cloud, true); assert.equal(h.AC.connect.local, false); assert.equal(h.AC.connect.admin, false);
  h.AC.openDevices(); await flush();
  assert.doesNotMatch(h.getNode('modal-root').innerHTML, /id="connect-pairing"/);
  assert.doesNotMatch(h.getNode('connect-device-list').innerHTML, /connect-revoke/);
  assert.equal(h.calls.some(call => call.url === '/api/connect/pairing'), false);
  assert.equal(h.streams[0].url, '/api/connect/events');
});

test('cloud logout stops playback, clears protected state and permits a fresh login', async () => {
  const h = await connectBrowser(browser({ deviceId: 'phone', mobile: true, backend: cloudBackend({ authenticated: true }) }));
  h.AC.play('one'); await flush(); assert.equal(h.audio.paused, false);
  const previousStream = h.streams.at(-1);
  await h.AC.playerActions['connect-logout'](); await flush();
  assert.equal(h.calls.find(call => call.url === '/api/connect/logout').options.method, 'POST');
  assert.equal(previousStream.closed, true); assert.equal(h.audio.paused, true);
  assert.equal(h.AC.connect.ready, false); assert.equal(h.AC.connect.admin, false); assert.equal(h.AC.connect.deviceId, null);
  assert.equal(h.AC.state.tracks.length, 0); assert.equal(h.AC.state.current, null); assert.equal(h.AC.state.queue.length, 0);
  assert.match(h.getNode('modal-root').innerHTML, /Você saiu deste dispositivo/);
  assert.doesNotMatch(h.getNode('modal-root').innerHTML, /computador|mesmo Wi/);
  h.getNode('connect-password').value = ' cloud owner password ';
  h.getNode('connect-login-form').emit('submit', { preventDefault() {} }); await flush();
  assert.equal(h.AC.connect.ready, true); assert.equal(h.AC.connect.admin, true);
  assert.notEqual(h.streams.at(-1), previousStream); assert.equal(h.streams.at(-1).closed, false);
});

test('unavailable public connection config fails closed and can be retried before protected requests', async () => {
  let unavailable = true;
  const backend = cloudBackend({ authenticated: true }); const fetch = backend.fetch;
  backend.fetch = call => call.url === '/api/connect/config' && unavailable ? response({ error: 'Unavailable' }, 503) : fetch(call);
  const h = browser({ deviceId: 'phone', mobile: true, backend });
  assert.equal(await h.AC.initConnect(), false);
  assert.deepEqual(h.calls.map(call => call.url), ['/api/connect/config']);
  assert.match(h.getNode('modal-root').innerHTML, /connect-retry/);
  assert.doesNotMatch(h.getNode('modal-root').innerHTML, /connect-login-form|connect-claim-form/);
  unavailable = false; await h.AC.playerActions['connect-retry'](); await flush();
  assert.equal(h.AC.connect.ready, true); assert.equal(h.AC.connect.cloud, true);
  assert.ok(h.calls.some(call => call.url === '/api/library'));
});
