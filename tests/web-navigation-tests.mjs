import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Exercise shipped routing and view behavior without network, media downloads or user data.
const sources = {};
for (const name of ['app', 'views']) sources[name] = await readFile(new URL('../public/' + name + '.js', import.meta.url), 'utf8');
const page = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const tracks = [
  { id: 'local-alpha', videoId: 'video-alpha', title: 'Alpha', artist: 'First artist', duration: 240, plays: 0, sourceUrl: 'https://youtube.com/watch?v=video-alpha' },
  { id: 'local-beta', videoId: 'video-beta', title: 'Beta', artist: 'Second artist', duration: 180, plays: 0, sourceUrl: 'https://youtube.com/watch?v=video-beta' }
];
const plain = value => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let index = 0; index < 90; index++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

function browser({ backend, bridge } = {}) {
  const calls = []; const nodes = new Map(); const storage = new Map(); const notifications = [];
  const allNodes = []; const timers = new Map(); let timerId = 0; let document;
  function element(tagName = 'DIV', initial = {}) {
    const attrs = new Map(Object.entries(initial)); const listeners = new Map(); const classes = new Set();
    let html = '';
    const node = {
      tagName, value: '', checked: false, disabled: false, dataset: {}, style: {}, textContent: '', hidden: false, parentElement: null, children: [],
      classList: { toggle(name, force) { if (force ?? !classes.has(name)) classes.add(name); else classes.delete(name); }, add(name) { classes.add(name); }, remove(name) { classes.delete(name); }, contains(name) { return classes.has(name); } },
      addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(callback); },
      removeEventListener(name, callback) { listeners.set(name, (listeners.get(name) || []).filter(item => item !== callback)); },
      emit(name, event = {}) { for (const callback of listeners.get(name) || []) callback(event); },
      getAttribute(name) { return attrs.get(name) ?? null; }, setAttribute(name, value) { attrs.set(name, String(value)); }, removeAttribute(name) { attrs.delete(name); }, hasAttribute(name) { return attrs.has(name); },
      closest(selector) { if (selector === '[data-action]' && attrs.has('data-action')) return node; if (selector === '.sidebar' && classes.has('sidebar')) return node; return node.parentElement?.closest(selector) || null; },
      querySelectorAll() { return []; }, querySelector() { return null; }, appendChild() {}, remove() {}, insertAdjacentHTML() {},
      focus() { document.activeElement = node; }, click() { dispatch('click', node); },
      getBoundingClientRect() { return { width: 100, left: 0 }; }, setPointerCapture() {}, releasePointerCapture() {}
    };
    Object.defineProperty(node, 'innerHTML', { get: () => html, set(value) { html = String(value); node.children = html ? [{}] : []; } });
    allNodes.push(node); return node;
  }
  const getNode = id => nodes.get(id) || (nodes.set(id, element()), nodes.get(id));
  function fromTag(tag) {
    const attrs = Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
    return element(tag.match(/^<([\w-]+)/)[1].toUpperCase(), attrs);
  }
  const navigation = [...page.matchAll(/<button\b[^>]*data-view="[^"]+"[^>]*>/g)].map(match => fromTag(match[0]));
  const events = element();
  document = { readyState: 'loading', activeElement: null, visibilityState: 'visible', getElementById: getNode,
    querySelector: selector => selector === '.main' ? getNode('view') : null,
    querySelectorAll: selector => selector === '.nav-item, .home-button, .mobile-nav [data-view]' ? navigation : [],
    addEventListener: (...args) => events.addEventListener(...args), removeEventListener: (...args) => events.removeEventListener(...args), createElement: element, body: element('BODY') };
  document.activeElement = document.body;
  const audio = getNode('audio'); const audioCalls = [];
  Object.assign(audio, { src: '', currentTime: 0, duration: 240, readyState: 4, paused: true, ended: false, volume: .85, muted: false,
    play() { audioCalls.push('play'); audio.paused = false; audio.emit('play'); return Promise.resolve(); },
    pause() { audioCalls.push('pause'); const changed = !audio.paused; audio.paused = true; if (changed) audio.emit('pause'); }, load() {} });
  const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
  const window = { innerWidth: 1280, AcervoAndroid: bridge, addEventListener() {}, removeEventListener() {}, location: { href: 'http://localhost:4310/' } };
  const context = vm.createContext({ window, document, localStorage, navigator: {}, console, URL, URLSearchParams, AbortController, Date, Set, Map,
    fetch: async (url, options = {}) => {
      const call = { url, options, body: options.body ? JSON.parse(options.body) : undefined }; calls.push(call);
      const result = await backend?.(call);
      const data = result === undefined ? url === '/api/library' ? { tracks, stats: { tracks: tracks.length } } : url === '/api/playlists' ? { playlists: [] } : url.startsWith('/api/recommend/') ? { items: [] } : { ok: true } : result;
      return { ok: true, status: 200, json: async () => plain(data) };
    },
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; }, clearTimeout: id => timers.delete(id),
    setInterval(callback) { const id = ++timerId; timers.set(id, callback); return id; }, clearInterval: id => timers.delete(id),
    requestAnimationFrame(callback) { callback(); return 1; }, cancelAnimationFrame() {} });
  for (const name of ['app', 'views']) vm.runInContext(sources[name], context, { filename: 'public/' + name + '.js' });
  const AC = window.AC; AC.toast = (...args) => notifications.push(args); AC.state.tracks = plain(tracks); AC.state.stats.tracks = tracks.length;
  AC.leaveRadio = () => {}; AC.radioView = () => '<div>Sua rádio</div>'; AC.bindRadio = () => {};
  function dispatch(type, target, extra = {}) {
    const event = { target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
    events.emit(type, event); return event;
  }
  function action(name, attrs = {}, tag = 'BUTTON') { return element(tag, { 'data-action': name, ...attrs }); }
  function control(name, html = getNode('view').innerHTML) {
    const tag = [...html.matchAll(/<[a-z][^>]*\bdata-action="[^"]+"[^>]*>/gi)].map(match => match[0]).find(tag => tag.includes('data-action="' + name + '"'));
    assert.ok(tag, 'Rendered action exists: ' + name); return fromTag(tag);
  }
  return { AC, calls, nodes, getNode, document, audio, audioCalls, navigation, storage, notifications, action, control, dispatch,
    click: node => dispatch('click', node), key(node, key = ' ', code = 'Space') { document.activeElement = node; return dispatch('keydown', node, { key, code }); },
    async boot() { events.emit('DOMContentLoaded'); await flush(); } };
}

test('desktop navigation reaches home, library, playlists and settings through delegated buttons', () => {
  const h = browser();
  for (const [view, heading] of [['home', 'Alpha'], ['library', 'Seu acervo'], ['playlists', 'Playlists'], ['settings', 'Configurações']]) {
    const button = h.navigation.find(node => node.getAttribute('data-view') === view);
    assert.ok(button, 'The shipped page offers ' + view);
    assert.equal(h.click(button).defaultPrevented, true); assert.equal(h.AC.state.view, view);
    assert.ok(h.getNode('view').innerHTML.includes(heading), view + ' content is rendered');
    const active = h.navigation.filter(node => node.getAttribute('aria-current') === 'page');
    assert.ok(active.length > 0); assert.ok(active.every(node => node.getAttribute('data-view') === view));
  }
});

test('successful playlist import opens the populated playlist instead of throwing after the request', async () => {
  const playlist = { id: 'playlist-fixture', name: 'Imported fixture', entries: [{ videoId: 'video-alpha', title: 'Alpha', thumbnail: '' }] };
  const h = browser({ backend: call => call.url === '/api/playlists/import' ? { playlist, total: 1 } : call.url === '/api/playlists' ? { playlists: [playlist] } : undefined });
  const result = await h.AC.importPlaylist('https://youtube.com/playlist?list=fixture');
  assert.equal(result.playlist.id, playlist.id); assert.equal(h.AC.state.playlistId, playlist.id); assert.equal(h.AC.state.view, 'playlist');
  assert.match(h.getNode('view').innerHTML, /Imported fixture/); assert.match(h.getNode('view').innerHTML, /1 de 1 já no acervo/);
  assert.equal(h.notifications.some(([, type]) => type === 'error'), false);
  assert.deepEqual(h.calls.find(call => call.url === '/api/playlists/import').body, { url: 'https://youtube.com/playlist?list=fixture' });
});

test('discovery shortcuts route through the shared exploration view and mount the selected tab', () => {
  const h = browser(); const mounted = []; let left = 0;
  h.AC.exploreView = section => '<h1>Explore ' + section + '</h1>';
  h.AC.mountExplore = section => mounted.push(section);
  h.AC.leaveExplore = () => { left++; };
  for (const section of ['recommended', 'releases', 'recent']) {
    h.click(h.action('nav', { 'data-view': section }));
    assert.equal(h.AC.state.view, 'explore');
    assert.equal(h.AC.state.exploreSection, section);
    assert.match(h.getNode('view').innerHTML, new RegExp('Explore ' + section));
    assert.equal(mounted.at(-1), section);
    assert.equal(h.navigation.find(node => node.getAttribute('data-view') === 'recommended').getAttribute('aria-current'), 'page');
  }
  h.AC.go('library');
  assert.equal(left, 1, 'Leaving exploration cancels its active request');
});

test('Space leaves native controls and editable fields to browser activation, and still toggles playback on the page', () => {
  const h = browser(); let toggles = 0; h.AC.toggle = () => { toggles++; };
  for (const tag of ['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT']) {
    const node = h.action('nav', { 'data-view': 'settings' }, tag);
    assert.equal(h.key(node).defaultPrevented, false, tag + ' keeps its native Space behavior');
  }
  const editor = h.action('none', {}, 'DIV'); editor.isContentEditable = true;
  assert.equal(h.key(editor).defaultPrevented, false);
  assert.equal(toggles, 0);
  h.getNode('progress').setAttribute('role', 'slider');
  const before = toggles;
  assert.equal(h.key(h.getNode('progress')).defaultPrevented, false); assert.equal(toggles, before);
  assert.equal(h.key(h.document.body).defaultPrevented, true); assert.equal(toggles, before + 1);
});

test('Enter and Space activate role-button track controls once while nested native play stays independent', async () => {
  const h = browser(); h.AC.go('library');
  const trackControl = h.action('play-track', { 'data-id': 'local-alpha', role: 'button', tabindex: '0' }, 'ARTICLE');
  assert.equal(h.key(trackControl, 'Enter', 'Enter').defaultPrevented, true); await flush();
  assert.equal(h.AC.state.current.id, 'local-alpha'); assert.equal(h.audioCalls.filter(call => call === 'play').length, 1);
  h.AC.toggle(); await flush();
  assert.equal(h.key(trackControl).defaultPrevented, true); await flush();
  assert.equal(h.audioCalls.filter(call => call === 'play').length, 2);
  const nested = h.action('play-track', { 'data-id': 'local-beta' }); nested.parentElement = trackControl;
  h.click(nested); await flush();
  assert.equal(h.AC.state.current.id, 'local-beta'); assert.equal(h.audioCalls.filter(call => call === 'play').length, 3);
  assert.equal(h.AC.state.panelId, null);
});

test('rendered library rows open details by keyboard while their play button starts audio once', async () => {
  const h = browser(); h.AC.go('library');
  const row = h.control('open-track');
  assert.equal(row.getAttribute('role'), 'button'); assert.equal(row.getAttribute('tabindex'), '0');
  assert.equal(h.key(row, 'Enter', 'Enter').defaultPrevented, true); await flush();
  assert.equal(h.AC.state.panelId, 'local-alpha'); assert.match(h.getNode('modal-root').innerHTML, /Alpha/);
  assert.equal(h.audioCalls.length, 0);
  h.AC.closeModals();
  const play = h.control('play-track'); play.parentElement = row;
  h.click(play); await flush();
  assert.equal(h.AC.state.current.id, 'local-alpha'); assert.equal(h.audioCalls.filter(call => call === 'play').length, 1);
  assert.equal(h.AC.state.panelId, null);
});

test('settings preserve native checkbox activation and save the changed value once', async () => {
  const h = browser(); await h.boot(); h.AC.go('settings');
  const checkbox = h.control('toggle-setting'); checkbox.checked = true;
  const click = h.click(checkbox);
  assert.equal(click.defaultPrevented, false, 'The browser must be allowed to finish the checkbox toggle');
  h.dispatch('change', checkbox);
  assert.equal(h.AC.getSettings().autoSave, true);
  assert.equal(JSON.parse(h.storage.get('acervo:settings')).autoSave, true);
});

test('library filtering updates count and duration and reproduces the visible sorted queue', async () => {
  const h = browser();
  h.AC.state.tracks = [
    { id: 'night-b', title: 'Night B', artist: 'Zulu', duration: 120 },
    { id: 'day-excluded', title: 'Day', artist: 'First', duration: 600 },
    { id: 'night-a', title: 'Night A', artist: 'Alpha', duration: 180 }
  ];
  h.AC.state.sort = 'artist'; h.AC.go('library');
  h.getNode('lib-filter').value = 'Night'; h.getNode('lib-filter').emit('input');
  assert.equal(h.AC.state.filter, 'Night'); assert.equal(h.getNode('lib-count').textContent, '2');
  assert.equal(h.getNode('lib-duration').textContent, '5 min');
  assert.match(h.getNode('lib-grid').innerHTML, /Night A/); assert.doesNotMatch(h.getNode('lib-grid').innerHTML, /day-excluded/);
  h.AC.state.shuffle = true;
  h.AC.state.shuffleOrder = ['day-excluded', 'night-b', 'night-a'];
  h.AC.state.queue = h.AC.state.shuffleOrder.slice();
  h.click(h.control('play-library')); await flush();
  assert.equal(h.AC.state.shuffle, false);
  assert.deepEqual(plain(h.AC.state.queue), ['night-a', 'night-b']); assert.equal(h.AC.state.current.id, 'night-a');
  h.AC.next(false); await flush(); assert.equal(h.AC.state.current.id, 'night-b');
  h.AC.next(false); await flush(); assert.equal(h.audio.paused, true); assert.equal(h.AC.state.current.id, 'night-b');
});

test('search results already in the library play their actual track identity', async () => {
  const result = { videoId: 'video-alpha', title: 'Alpha', channel: 'First artist', duration: 240, thumbnail: '' };
  const h = browser({ backend: call => call.url.startsWith('/api/search?') ? { results: [result] } : undefined });
  h.click(h.action('search-chip', { 'data-q': 'Alpha' })); await flush();
  assert.equal(h.AC.state.view, 'search'); assert.equal(h.AC.state.search.q, 'Alpha');
  const play = h.control('play-track'); h.click(play); await flush();
  assert.equal(h.AC.state.current?.id, 'local-alpha'); assert.equal(h.audio.src, '/api/stream/local-alpha');
});

test('a new search result can be saved and played after its completed import refreshes the library', async () => {
  const result = { videoId: 'video-new', title: 'New music', channel: 'New artist', duration: 210, thumbnail: '' };
  const imported = { id: 'imported-local-id', videoId: result.videoId, title: result.title, artist: result.channel, duration: result.duration };
  const h = browser({ backend: call => call.url.startsWith('/api/search?') ? { results: [result] } : call.url === '/api/import' ? { jobId: 'job-new' } : call.url === '/api/jobs/job-new' ? { id: 'job-new', status: 'done', videoId: result.videoId, trackId: imported.id } : call.url === '/api/library' ? { tracks: [...tracks, imported], stats: { tracks: 3 } } : undefined });
  h.click(h.action('search-chip', { 'data-q': 'New music' })); await flush();
  h.click(h.control('download')); await flush();
  assert.deepEqual(h.calls.find(call => call.url === '/api/import').body, { videoId: result.videoId, meta: { title: result.title, channel: result.channel, duration: result.duration, thumbnail: result.thumbnail } });
  assert.ok(h.AC.trackById(imported.id)); assert.equal(h.AC.state.jobs[result.videoId].status, 'done');
  h.click(h.control('play-track', h.AC.jobMarkup(result.videoId))); await flush();
  assert.equal(h.AC.state.current.id, imported.id); assert.equal(h.audio.paused, false);
  assert.equal(h.getNode('player-artist').textContent, result.channel);
});

test('download buttons retain radio and discovery metadata without using the seed as artist', async () => {
  const h = browser({ backend: call => call.url === '/api/import' ? { jobId: 'metadata-job' } : undefined });
  h.AC.pollJob = () => {};
  h.AC.radioState = { results: [{ videoId: 'radio-video', title: 'Real radio title', channel: 'Actual uploader', sourceArtist: 'Different seed artist', because: 'Similar to a seed', duration: 234 }] };
  h.AC.state.discover = [{ videoId: 'discover-video', title: 'Discovery title', channel: 'Discovery uploader', thumbnail: 'https://i.ytimg.com/vi/fixture/hqdefault.jpg' }];
  h.click(h.action('download', { 'data-video-id': 'radio-video' })); await flush();
  h.click(h.action('download', { 'data-video-id': 'discover-video' })); await flush();
  const imports = h.calls.filter(call => call.url === '/api/import').map(call => call.body);
  assert.deepEqual(imports[0], { videoId: 'radio-video', meta: { title: 'Real radio title', channel: 'Actual uploader', duration: 234 } });
  assert.deepEqual(imports[1], { videoId: 'discover-video', meta: { title: 'Discovery title', channel: 'Discovery uploader', thumbnail: 'https://i.ytimg.com/vi/fixture/hqdefault.jpg' } });
});

test('explicit import metadata wins and unknown IDs never borrow another result identity', async () => {
  const h = browser({ backend: call => call.url === '/api/import' ? { jobId: 'metadata-job' } : undefined });
  h.AC.pollJob = () => {};
  h.AC.state.search.results = [{ videoId: 'selected-video', title: 'Search title', channel: 'Search uploader' }];
  await h.AC.startImport({ videoId: 'selected-video', meta: { title: 'Explicit title', artist: 'Confirmed artist' } });
  await h.AC.startImport({ videoId: 'other-video' });
  const imports = h.calls.filter(call => call.url === '/api/import').map(call => call.body);
  assert.deepEqual(imports[0], { videoId: 'selected-video', meta: { title: 'Explicit title', channel: 'Search uploader', artist: 'Confirmed artist' } });
  assert.deepEqual(imports[1], { videoId: 'other-video' });
  assert.equal(h.AC.state.search.results[0].title, 'Search title');
});

test('the latest search remains visible when an older request finishes after it', async () => {
  const older = deferred(); const newer = deferred();
  const h = browser({ backend: call => call.url === '/api/search?q=older' ? older.promise : call.url === '/api/search?q=newer' ? newer.promise : undefined });
  h.click(h.action('search-chip', { 'data-q': 'older' }));
  h.click(h.action('search-chip', { 'data-q': 'newer' }));
  newer.resolve({ results: [{ videoId: 'new-result', title: 'Newer result' }] }); await flush();
  older.resolve({ results: [{ videoId: 'old-result', title: 'Older result' }] }); await flush();
  assert.equal(h.AC.state.search.q, 'newer'); assert.equal(h.AC.state.search.results[0].videoId, 'new-result');
  assert.match(h.getNode('view').innerHTML, /Newer result/); assert.doesNotMatch(h.getNode('view').innerHTML, /Older result/);
});

test('the web route serves the real responsive application and the legacy URL redirects without an iframe shell', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'acervo-web-route-'));
  const probe = net.createServer(); let child; let closed; let output = '';
  try {
    await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
    const port = probe.address().port;
    await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
    const get = pathname => new Promise((resolve, reject) => {
      const req = http.get({ hostname: '127.0.0.1', port, path: pathname, agent: false }, res => {
        const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.once('error', reject);
        res.once('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.setTimeout(3000, () => req.destroy(new Error('Isolated web route request timed out'))); req.once('error', reject);
    });
    child = spawn(process.execPath, [fileURLToPath(new URL('../server.js', import.meta.url))], { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {
      ...process.env, PORT: String(port), ACERVO_HOST: '127.0.0.1', ACERVO_MODE: 'local', ACERVO_DATA_DIR: path.join(directory, 'data')
    } });
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
    closed = new Promise(resolve => child.once('close', resolve));
    let ready = false; let readinessError = '';
    for (let index = 0; index < 50; index++) {
      if (child.exitCode !== null) throw new Error(output || 'The isolated web route server exited');
      try { ready = (await get('/healthz')).status === 200; } catch (error) { readinessError = error.message; }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(ready, true, (output || 'Isolated web route server starts') + readinessError);
    const web = await get('/web'); const desktop = await get('/pc');
    assert.equal(web.status, 200); assert.equal(web.body, desktop.body, 'Web and desktop share one responsive application');
    for (const required of ['id="view"', 'id="player"', 'id="search-form"', 'data-view="playlists"', 'data-view="settings"']) assert.ok(web.body.includes(required), 'The full application provides ' + required);
    assert.doesNotMatch(web.body, /<iframe\b|embed=web|class="phone"/i);
    const legacy = await get('/web.html?from=old-bookmark');
    assert.equal(legacy.status, 302); assert.equal(legacy.headers.location, '/web?from=old-bookmark');
    assert.doesNotMatch(await readFile(new URL('../public/web.html', import.meta.url), 'utf8'), /<iframe\b|class="phone"/i);
  } finally {
    if (probe.listening) await new Promise(resolve => probe.close(resolve));
    if (child) { child.kill(); await closed; }
    const relative = path.relative(os.tmpdir(), directory);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(directory).startsWith('acervo-web-route-'));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
