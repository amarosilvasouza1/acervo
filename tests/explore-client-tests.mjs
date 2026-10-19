import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../public/explore.js', import.meta.url), 'utf8');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const element = attributes => ({ getAttribute: name => attributes[name] ?? null });
const song = overrides => ({ title: 'Uma canção', artist: 'Artista', thumbnail: 'https://images.example/cover.jpg', duration: 200, kind: 'track', ...overrides });

function setup({ onListen, onLibraryLoaded } = {}) {
  const nodes = new Map([['explore-content', { innerHTML: '' }], ['artist-content', { innerHTML: '' }]]);
  const requests = [], played = [], imports = [], searches = [];
  let api = async () => ({ items: [] });
  const AC = {
    state: { view: 'explore', exploreSection: 'recommended', tracks: [], authEpoch: 0 },
    esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'),
    icon: () => '<svg></svg>', fmtTime: seconds => `${Math.floor(seconds / 60)}:20`,
    coverHtml: track => `<img src="/api/cover/${track.id}" alt="">`, hydrateIcons() {},
    playerActions: {}, play: id => played.push(id), startImport: payload => imports.push(payload),
    searchCatalog: query => searches.push(query), toast() {}, go(view) { this.state.view = view; },
    api(path, options) { requests.push({ path, options }); return api(path, options); },
    onListen, onLibraryLoaded
  };
  const context = vm.createContext({ window: { AC }, document: { getElementById: id => nodes.get(id) }, URL, Intl, Date, AbortController, console });
  vm.runInContext(source, context, { filename: 'public/explore.js' });
  return { AC, nodes, requests, played, imports, searches, setApi(fn) { api = fn; }, feed: () => nodes.get('explore-content').innerHTML, artist: () => nodes.get('artist-content').innerHTML };
}

test('exploration starts with a skeleton, then paints actual catalog items without a full app render', async () => {
  const h = setup();
  assert.match(h.AC.exploreView('releases'), /Novos lançamentos/);
  assert.match(h.AC.exploreView('recommended'), /aria-busy="true"/);
  h.setApi(async () => ({ description: 'A partir das suas escutas', items: [song({ title: 'Descoberta real' })], artists: [{ name: 'Uma artista' }] }));
  await h.AC.mountExplore('recommended');
  assert.equal(h.requests[0].path, '/api/explore?section=recommended');
  assert.match(h.feed(), /Descoberta real/);
  assert.match(h.feed(), /A partir das suas escutas/);
  assert.match(h.feed(), /data-artist="Uma artista"/);
  assert.doesNotMatch(h.feed(), /aria-busy/);
});

test('a late feed cannot overwrite a newer section even if the API ignores abort', async () => {
  const h = setup(), old = deferred();
  h.setApi(path => path.includes('recommended') ? old.promise : Promise.resolve({ items: [song({ title: 'Lançamento novo' })] }));
  const first = h.AC.mountExplore('recommended');
  h.AC.state.exploreSection = 'releases';
  await h.AC.mountExplore('releases');
  assert.equal(h.requests[0].options.signal.aborted, true);
  old.resolve({ items: [song({ title: 'Resposta antiga' })] });
  await first;
  assert.match(h.feed(), /Lançamento novo/);
  assert.doesNotMatch(h.feed(), /Resposta antiga/);
});

test('leaving aborts a pending artist request and prevents it from returning to the page', async () => {
  const h = setup(), waiting = deferred();
  h.AC.state.view = 'artist'; h.AC.state.artistName = 'Artista';
  h.setApi(() => waiting.promise);
  const pending = h.AC.mountArtist('Artista');
  const before = h.artist();
  h.AC.leaveExplore(); h.AC.state.view = 'library';
  waiting.resolve({ name: 'Perfil antigo', topTracks: [song({})] });
  await pending;
  assert.equal(h.requests[0].options.signal.aborted, true);
  assert.equal(h.artist(), before);
});

test('revoked authorization invalidates both pending responses and cached artist data', async () => {
  const h = setup(), waiting = deferred();
  h.setApi(() => waiting.promise);
  const pending = h.AC.mountExplore('recommended');
  h.AC.state.authEpoch++;
  waiting.resolve({ items: [song({ title: 'Biblioteca privada' })] });
  await pending;
  assert.doesNotMatch(h.feed(), /Biblioteca privada/);
  h.setApi(async () => ({ items: [song({ title: 'Dados autorizados' })] }));
  await h.AC.mountExplore('recommended');
  assert.match(h.feed(), /Dados autorizados/);
  h.AC.state.authEpoch++;
  assert.doesNotMatch(h.AC.exploreView('recommended'), /Dados autorizados/);
});

test('switching artist rejects a stale profile and URL-encodes the selected name', async () => {
  const h = setup(), firstArtist = deferred();
  h.AC.openArtist('Primeiro');
  h.setApi(path => path.includes('Primeiro') ? firstArtist.promise : Promise.resolve({ name: 'Banda & Voz', topTracks: [song({ title: 'Faixa certa' })] }));
  const first = h.AC.mountArtist('Primeiro');
  h.AC.openArtist('Banda & Voz');
  await h.AC.mountArtist('Banda & Voz');
  firstArtist.resolve({ name: 'Perfil anterior' }); await first;
  assert.equal(h.requests[1].path, '/api/artist?name=Banda%20%26%20Voz');
  assert.match(h.artist(), /Banda &amp; Voz/);
  assert.match(h.artist(), /Faixa certa/);
  assert.doesNotMatch(h.artist(), /Perfil anterior/);
});

test('opening an artist from a track sheet closes the modal before navigating', () => {
  const h = setup(), actions = [];
  h.AC.closeModals = () => actions.push('close');
  h.AC.go = view => { actions.push(view); h.AC.state.view = view; };
  h.AC.playerActions['open-artist'](element({ 'data-artist': 'Artista do sheet' }));
  assert.deepEqual(actions, ['close', 'artist']);
  assert.equal(h.AC.state.artistName, 'Artista do sheet');
});

test('load failures show escaped feedback and retry performs a new request', async () => {
  const h = setup();
  h.setApi(async () => { throw new Error('Fonte <indisponível>'); });
  await h.AC.mountExplore('recommended');
  assert.match(h.feed(), /Fonte &lt;indisponível&gt;/);
  assert.match(h.feed(), /data-action="explore-retry"/);
  h.setApi(async () => ({ items: [song({ title: 'Fonte voltou' })] }));
  await h.AC.playerActions['explore-retry'](element({ 'data-kind': 'feed', 'data-key': 'recommended' }));
  assert.equal(h.requests.length, 2);
  assert.match(h.feed(), /Fonte voltou/);
});

test('saved catalog songs play their local ID and remote video songs use the existing import queue', async () => {
  const h = setup();
  h.AC.state.tracks = [{ id: 'local-id', videoId: 'dQw4w9WgXcQ', title: 'Salva' }];
  h.setApi(async () => ({ items: [song({ videoId: 'dQw4w9WgXcQ' }), song({ videoId: 'jNQXAC9IVRw', title: 'Nova' })] }));
  await h.AC.mountExplore('recommended');
  h.AC.playerActions['explore-play'](element({ 'data-explore-key': 'feed:recommended:0' }));
  assert.deepEqual(h.played, ['local-id']);
  h.AC.playerActions['explore-play'](element({ 'data-explore-key': 'feed:recommended:1' }));
  assert.equal(h.imports[0].videoId, 'jNQXAC9IVRw');
  assert.equal(h.AC.state.playAfterImport, 'jNQXAC9IVRw');
  assert.equal(h.imports[0].meta.title, 'Nova');
  h.AC.state.authEpoch++;
  h.AC.playerActions['explore-play'](element({ 'data-explore-key': 'feed:recommended:1' }));
  assert.equal(h.imports.length, 1);
});

test('catalog-only tracks and albums open an actual search instead of claiming they are playable', async () => {
  const h = setup();
  h.setApi(async () => ({ items: [song({ title: 'Faixa no catálogo' }), song({ title: 'Disco', kind: 'album', releaseDate: '2026-09-18' })] }));
  await h.AC.mountExplore('recommended');
  assert.match(h.feed(), /data-action="catalog-search"/);
  assert.match(h.feed(), /Buscar para ouvir Faixa no catálogo/);
  h.AC.playerActions['catalog-search'](element({ 'data-query': 'Artista Disco' }));
  assert.deepEqual(h.searches, ['Artista Disco']);
  assert.equal(h.imports.length, 0);
});

test('artist facts are escaped, sourced, and only present when supplied by the backend', async () => {
  const h = setup(); h.AC.openArtist('Artista');
  h.setApi(async () => ({ name: '<Artista>', biography: '<script>Biografia</script>', bioSourceUrl: 'https://source.example/bio', sourceUrl: 'javascript:alert(1)', picture: 'data:image/svg+xml,anything', topTracks: [song({ title: '<Popular>' })], albums: [song({ title: 'Disco real', releaseDate: '2025-02-30', kind: 'album' })], relatedArtists: [{ name: 'Outra <voz>', picture: 'https://images.example/artist.jpg' }] }));
  await h.AC.mountArtist('Artista');
  assert.match(h.artist(), /&lt;script&gt;Biografia&lt;\/script&gt;/);
  assert.match(h.artist(), /href="https:\/\/source.example\/bio"/);
  assert.match(h.artist(), /Fonte da biografia/);
  assert.match(h.artist(), /&lt;Popular&gt;/);
  assert.match(h.artist(), /Outra &lt;voz&gt;/);
  assert.doesNotMatch(h.artist(), /javascript:|data:image|2025-02-30|seguidores|verificado|ouvintes mensais/i);
});

test('valid release dates and catalog follower counts keep their actual meaning', async () => {
  const h = setup(); h.AC.openArtist('Artista');
  h.setApi(async () => ({ name: 'Artista', followers: 12345, albums: [song({ title: 'Disco', releaseDate: '2024-02-29' })] }));
  await h.AC.mountArtist('Artista');
  assert.match(h.artist(), /12\.345 seguidores no catálogo/);
  assert.match(h.artist(), /29.*2024/);
  assert.doesNotMatch(h.artist(), /ouvintes mensais/);
});

test('repeat renders reuse a current cache and restore working item actions after mounting', async () => {
  const h = setup();
  h.AC.state.tracks = [{ id: 'same-id', title: 'Salva' }];
  h.setApi(async () => ({ items: [song({ id: 'same-id' })] }));
  await h.AC.mountExplore('recommended');
  h.AC.leaveExplore();
  assert.match(h.AC.exploreView('recommended'), /Uma canção/);
  await h.AC.mountExplore('recommended');
  assert.equal(h.requests.length, 1);
  h.AC.playerActions['explore-play'](element({ 'data-explore-key': 'feed:recommended:0' }));
  assert.deepEqual(h.played, ['same-id']);
});

test('new listening invalidates the recent feed immediately and bounded section names reject inherited properties', async () => {
  const h = setup();
  assert.match(h.AC.exploreView('__proto__'), /Recomendadas/);
  h.AC.state.exploreSection = 'recent';
  h.setApi(async () => ({ items: [song({ title: h.requests.length === 1 ? 'Anterior' : 'Escuta nova' })] }));
  await h.AC.mountExplore('recent');
  assert.match(h.feed(), /Anterior/);
  await h.AC.invalidateExplore('recent');
  assert.equal(h.requests.length, 2);
  assert.match(h.feed(), /Escuta nova/);
  assert.doesNotMatch(h.feed(), /Anterior/);
});

test('listening refreshes recommendations while preserving the previous listening callback', async () => {
  const previousCalls = [];
  const h = setup({ onListen: track => previousCalls.push(track) });
  h.setApi(async () => ({ items: [song({ title: `Seleção ${h.requests.length}` })] }));
  await h.AC.mountExplore('recommended');
  const listened = { id: 'new-listen', title: 'Ouvida agora' };
  h.AC.onListen(listened);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.deepEqual(previousCalls, [listened]);
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].path, '/api/explore?section=recommended');
  assert.match(h.feed(), /Seleção 2/);
});

test('library updates preserve the previous callback and refresh only when the catalog changes', async () => {
  let previousCalls = 0;
  const h = setup({ onLibraryLoaded: () => previousCalls++ });
  h.setApi(async () => ({ items: [song({ title: `Catálogo ${h.requests.length}` })] }));
  await h.AC.mountExplore('recommended');
  h.AC.state.tracks = [{ id: 'one', title: 'Primeira', artist: 'Artista', hasCover: true }];
  h.AC.onLibraryLoaded();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(h.requests.length, 2);
  h.AC.onLibraryLoaded();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(h.requests.length, 2, 'unchanged library reload must not create another catalog request');
  h.AC.state.tracks[0].title = 'Título atualizado';
  h.AC.onLibraryLoaded();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(h.requests.length, 3);
  assert.equal(previousCalls, 3);
  assert.match(h.feed(), /Catálogo 3/);
});

test('listening changes received through library refresh invalidate recent and recommended feeds', async () => {
  const h = setup();
  h.AC.state.tracks = [{ id: 'one', title: 'Uma faixa', artist: 'Artista', lastPlayedAt: '2026-10-18T10:00:00Z', plays: 1 }];
  h.AC.onLibraryLoaded();
  h.setApi(async () => ({ items: [song({ title: `Seleção ${h.requests.length}` })] }));
  h.AC.state.exploreSection = 'recent';
  await h.AC.mountExplore('recent');
  h.AC.state.exploreSection = 'recommended';
  await h.AC.mountExplore('recommended');
  assert.equal(h.requests.length, 2);

  // Another device changes only listening metadata; no local onListen callback runs.
  h.AC.state.tracks[0].lastPlayedAt = '2026-10-18T11:00:00Z';
  h.AC.state.tracks[0].plays = 2;
  h.AC.onLibraryLoaded();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(h.requests.length, 3);
  assert.equal(h.requests[2].path, '/api/explore?section=recommended');
  assert.match(h.feed(), /Seleção 3/);

  h.AC.state.exploreSection = 'recent';
  await h.AC.mountExplore('recent');
  assert.equal(h.requests.length, 4, 'the cached recent feed was also invalidated');
  assert.equal(h.requests[3].path, '/api/explore?section=recent');
  assert.match(h.feed(), /Seleção 4/);

  h.AC.onLibraryLoaded();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(h.requests.length, 4, 'unchanged listening metadata keeps the current cache');
});
