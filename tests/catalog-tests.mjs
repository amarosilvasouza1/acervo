import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogService } from '../lib/catalog.js';

const START = Date.parse('2026-10-18T14:00:00Z');
const IMAGE = 'https://cdn-images.dzcdn.net/images/artist/fixture/500x500.jpg';
const COVER = 'https://cdn-images.dzcdn.net/images/cover/fixture/500x500.jpg';
const LOCAL = { id: 'local-one', videoId: 'abcdefghijk', title: 'Known Song', artist: 'Artist A', thumbnail: '/api/cover/abcdefghijk', addedAt: '2026-10-18', lastPlayedAt: '2026-10-18T12:00:00Z' };
const LOCAL_HISTORY = [{ trackId: LOCAL.id, playedAt: '2026-10-18T12:00:00Z' }];
const DEEZER_ARTIST = { id: 42, name: 'Artist A', nb_album: 3, nb_fan: 1234, picture_big: IMAGE, link: 'javascript:bad' };
const catalogTrack = (id = 101, title = 'Known Song', artistId = 42, artist = 'Artist A') => ({
  id, title, duration: 201, artist: { id: artistId, name: artist }, album: { id: 70, title: 'An album', cover_big: COVER }, link: 'http://evil.example/track'
});
const album = (id = 70, date = '2026-10-10', artist = 'Artist A') => ({
  id, title: 'Album ' + id, release_date: date, artist: { id: 42, name: artist }, cover_big: COVER, link: 'https://evil.example/album'
});
const wiki = (language, values = {}) => ({
  type: 'standard', title: 'Artist A', description: 'Brazilian singer and songwriter', extract: 'Artist A is a singer whose single Known Song appears in this catalog fixture.',
  content_urls: { desktop: { page: 'https://' + language + '.wikipedia.org/wiki/Artist_A' } }, ...values
});
function fixture(options = {}) {
  let time = START;
  let tracks = structuredClone(options.tracks ?? [LOCAL]);
  let history = structuredClone(options.history ?? LOCAL_HISTORY);
  const calls = [];
  const responses = options.responses || (() => undefined);
  const fetchImpl = async (value, request) => {
    const url = new URL(value);
    calls.push({ url, request });
    let response = await responses(url, request);
    if (response === undefined) {
      if (url.hostname.endsWith('.wikipedia.org')) response = { httpError: 404 };
      else if (url.pathname === '/search/artist') response = { data: [DEEZER_ARTIST] };
      else if (url.pathname === '/artist/42/top') response = { data: [catalogTrack(), catalogTrack(102, 'Another Song')] };
      else if (url.pathname === '/artist/42/albums') response = { data: [album()] };
      else if (url.pathname === '/artist/42/related') response = { data: [{ id: 43, name: 'Related Artist', picture_big: IMAGE, link: 'https://evil.example/profile' }] };
      else if (url.pathname === '/artist/42') response = DEEZER_ARTIST;
      else if (url.pathname === '/search') response = { data: [] };
      else throw new Error('Unexpected catalog fixture URL: ' + value);
    }
    if (response instanceof Error) throw response;
    if (response instanceof Response) return response;
    return { ok: !response.httpError, status: response.httpError || 200, json: async () => structuredClone(response) };
  };
  const service = createCatalogService({ getTracks: async () => tracks, getHistory: async () => history, fetchImpl, now: () => time,
    ...(options.radio ? { runRadio: options.radio } : {}), ...(options.search ? { searchYouTube: options.search } : {}) });
  return { service, calls, setTracks: value => { tracks = structuredClone(value); }, setHistory: value => { history = structuredClone(value); }, advance: amount => { time += amount; } };
}
const invalid = error => error.statusCode === 400;
const cancelled = error => error.name === 'AbortError';
const newVideo = { videoId: 'ZYXWVUTSRQP', title: 'Artist A - New Song (Official Audio)', channel: 'Artist A - Topic', duration: 205, thumbnail: 'https://i.ytimg.com/vi/ZYXWVUTSRQP/hqdefault.jpg' };

test('catalog validates section and artist input before querying providers', async () => {
  const { service, calls } = fixture();
  for (const section of ['', 'unknown', 'Recent', null, {}, 'recent'.repeat(100)]) await assert.rejects(service.explore(section), invalid);
  for (const name of ['', ' ', null, {}, 'a'.repeat(121), 'Artist\u0000A', 'Artist\u202eA']) await assert.rejects(service.artist(name), invalid);
  assert.equal(calls.length, 0);
});

test('recent uses descending listening events, deduplicates and does not consult the network', async () => {
  const tracks = [{ ...LOCAL, id: 'a', title: 'Earlier', lastPlayedAt: '2030-01-01' }, { ...LOCAL, id: 'b', title: 'Latest', lastPlayedAt: '2000-01-01' },
    { ...LOCAL, id: 'unplayed', lastPlayedAt: '2030-01-01', addedAt: '2030-02-01' }];
  const { service, calls } = fixture({ tracks, history: [
    { trackId: 'a', playedAt: '2026-10-17' }, { trackId: 'b', playedAt: '2026-10-18' }, { trackId: 'a', playedAt: '2026-10-16' },
    { trackId: 'missing', playedAt: '2026-10-19' }, { trackId: 'a', playedAt: 'invalid' }
  ] });
  const response = await service.explore('recent');
  assert.deepEqual(response.items.map(item => item.id), ['b', 'a']);
  assert.equal(response.items[0].title, tracks[1].title);
  assert.equal(response.items[0].kind, 'track');
  assert.equal(response.items[0].lastPlayedAt, tracks[1].lastPlayedAt);
  assert.equal(calls.length, 0);
});

test('recent falls back to recorded lastPlayedAt only when no history exists, never to import date', async () => {
  const { service, calls } = fixture({ history: [], tracks: [
    { id: 'new', artist: 'New', title: 'Only imported', addedAt: '2030-01-01' },
    { ...LOCAL, id: 'old', lastPlayedAt: '2026-10-16' }, { ...LOCAL, id: 'recent', lastPlayedAt: '2026-10-18' }
  ] });
  assert.deepEqual((await service.explore('recent')).items.map(item => item.id), ['recent', 'old']);
  const empty = fixture({ tracks: [{ id: 'new', addedAt: '2030-01-01', plays: 50 }], history: [] });
  assert.equal((await empty.service.explore('recent')).items.length, 0);
  assert.ok((await empty.service.explore('recent')).emptyReason);
  assert.equal(calls.length, 0);
});

test('artist cards use stored covers and recover an image from later tracks by the same artist', async () => {
  const { service, calls } = fixture({ tracks: [
    { ...LOCAL, id: 'no-cover', thumbnail: '', hasCover: false },
    { ...LOCAL, id: 'with-cover', thumbnail: '', hasCover: true }
  ], history: [
    { trackId: 'no-cover', playedAt: '2026-10-18T13:00:00Z' },
    { trackId: 'with-cover', playedAt: '2026-10-18T12:00:00Z' }
  ] });
  const result = await service.explore('recent');
  assert.deepEqual(result.artists, [{ name: LOCAL.artist, picture: '/api/cover/with-cover' }]);
  assert.equal(calls.length, 0);
});

test('recommendation image cache changes when a stored cover becomes available', async () => {
  let runs = 0;
  const data = fixture({ tracks: [{ ...LOCAL, thumbnail: '', hasCover: false }], radio: async () => { runs++; return {}; } });
  assert.equal((await data.service.explore('recommended')).artists[0].picture, undefined);
  data.setTracks([{ ...LOCAL, thumbnail: '', hasCover: true }]);
  assert.equal((await data.service.explore('recommended')).artists[0].picture, '/api/cover/' + LOCAL.id);
  assert.equal(runs, 2);
});

test('recommendations preserve real partial results, sanitize tracks and cache without mutating the library', async () => {
  let searches = 0;
  const { service, calls } = fixture({ radio: async (input, dependencies) => {
    searches++;
    assert.equal(input.limit, 12);
    assert.equal(dependencies.timeoutMs, 25000);
    assert.deepEqual(dependencies.tracks, [LOCAL]);
    dependencies.onEvent('results', { items: [newVideo, newVideo, { ...newVideo, videoId: LOCAL.videoId }, { ...newVideo, videoId: 'invalid' }] });
    dependencies.onEvent('done', { warnings: ['Uma fonte falhou.'] });
    return { partial: true, warnings: ['Uma fonte falhou.'] };
  } });
  const result = await service.explore('recommended');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, 'New Song');
  assert.equal(result.items[0].artist, 'Artist A');
  assert.equal(result.items[0].kind, 'track');
  assert.equal(result.items[0].sourceUrl, 'https://www.youtube.com/watch?v=' + newVideo.videoId);
  assert.deepEqual(result.warnings, ['Uma fonte falhou.']);
  result.items[0].title = 'Mutated caller copy';
  assert.equal((await service.explore('recommended')).items[0].title, 'New Song');
  assert.equal(searches, 1);
  assert.equal(calls.length, 0);
});

test('recommendation cache expires after ten minutes and is invalidated by listening changes', async () => {
  let runs = 0;
  const data = fixture({ radio: async (input, dependencies) => { runs++; dependencies.onEvent('results', { items: [newVideo] }); return {}; } });
  await data.service.explore('recommended');
  await data.service.explore('recommended');
  assert.equal(runs, 1);
  data.setHistory([...LOCAL_HISTORY, { trackId: LOCAL.id, playedAt: '2026-10-18T13:00:00Z' }]);
  await data.service.explore('recommended');
  assert.equal(runs, 2);
  data.advance(600001);
  await data.service.explore('recommended');
  assert.equal(runs, 3);
});

test('aborted recommendation work is not cached and can be retried', async () => {
  let attempts = 0;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const data = fixture({ radio: async (input, dependencies) => {
    attempts++;
    if (attempts === 1) {
      dependencies.onEvent('results', { items: [newVideo] });
      started();
      await new Promise(resolve => dependencies.signal.addEventListener('abort', resolve, { once: true }));
      return { cancelled: true };
    }
    dependencies.onEvent('results', { items: [newVideo] });
    return {};
  } });
  const controller = new AbortController();
  const first = data.service.explore('recommended', { signal: controller.signal });
  const rejection = assert.rejects(first, cancelled);
  await ready;
  controller.abort();
  await rejection;
  assert.equal((await data.service.explore('recommended')).items.length, 1);
  assert.equal(attempts, 2);
});

test('unplayed libraries return an honest recommendation empty state without network fallback', async () => {
  let radioCalls = 0;
  const { service, calls } = fixture({ tracks: [{ ...LOCAL, lastPlayedAt: undefined }], history: [], radio: async () => { radioCalls++; } });
  const result = await service.explore('recommended');
  assert.deepEqual(result.items, []);
  assert.ok(result.emptyReason);
  assert.equal(radioCalls, 0);
  assert.equal(calls.length, 0);
});

test('artist identity preserves _sz and refuses alias or unrelated name matches', async () => {
  const local = { ...LOCAL, artist: 'Shooter_sz', title: 'Vínculos' };
  const { service, calls } = fixture({ tracks: [local], responses: url => url.pathname === '/search/artist' ? { data: [{ id: 99, name: 'Shooter', nb_fan: 999999, picture_big: IMAGE }] } : undefined });
  const result = await service.artist('Shooter_sz');
  assert.equal(result.catalogMatched, false);
  assert.deepEqual(result.localTracks, [local]);
  assert.equal(result.picture, local.thumbnail);
  assert.equal(result.followers, undefined);
  assert.equal(result.biography, undefined);
  assert.equal(result.sourceUrl, undefined);
  assert.equal(calls.length, 1);
});

test('artist identity does not fold Cyrillic homoglyphs into Latin names', async () => {
  const { service, calls } = fixture({ tracks: [{ ...LOCAL, artist: 'Adele' }], responses: url => url.pathname === '/search/artist'
    ? { data: [{ id: 99, name: '\u0410dele', nb_fan: 999999, picture_big: IMAGE }] } : undefined });
  const result = await service.artist('Adele');
  assert.equal(result.catalogMatched, false);
  assert.equal(result.followers, undefined);
  assert.equal(calls.length, 1);
});

test('confirmed artists expose factual source-linked catalog metadata and attributed plain biography', async () => {
  const { service, calls } = fixture({ responses: url => url.hostname.endsWith('.wikipedia.org') ? wiki(url.hostname.split('.')[0], {
    extract: '<b>Artist A</b> is a musician who released Known Song. ' + 'A factual fixture sentence. '.repeat(100)
  }) : undefined });
  const result = await service.artist('Artist A');
  assert.equal(result.catalogMatched, true);
  assert.equal(result.picture, IMAGE);
  assert.equal(result.followers, 1234);
  assert.equal(result.followersSource, 'Deezer');
  assert.equal(result.followersLabel, 'fãs no Deezer');
  assert.equal(result.monthlyListeners, undefined);
  assert.equal(result.banner, undefined);
  assert.equal(result.sourceUrl, 'https://www.deezer.com/artist/42');
  assert.equal(result.topTracks[0].sourceUrl, 'https://www.deezer.com/track/101');
  assert.equal(result.albums[0].sourceUrl, 'https://www.deezer.com/album/70');
  assert.equal(result.relatedArtists[0].sourceUrl, 'https://www.deezer.com/artist/43');
  assert.equal(result.bioSourceUrl, 'https://pt.wikipedia.org/wiki/Artist_A');
  assert.equal(result.bioSourceName, 'Wikipédia · CC BY-SA');
  assert.ok(result.biography.length <= 1400);
  assert.ok(!result.biography.includes('<b>'));
  assert.ok(calls.every(call => call.request.redirect === 'error' && call.request.signal));
});

test('same-name catalog artists require local song evidence before merging metadata', async () => {
  const local = { ...LOCAL, artist: 'Ark King', title: 'PREGUIÇA' };
  const { service, calls } = fixture({ tracks: [local], responses: url => {
    if (url.pathname === '/search/artist') return { data: [{ ...DEEZER_ARTIST, name: 'Ark King' }] };
    if (url.pathname === '/artist/42/top') return { data: [catalogTrack(101, 'No Love', 42, 'Ark King')] };
    if (url.pathname === '/search') return { data: [catalogTrack(102, 'PREGUIÇA', 999, 'Ark King')] };
    return undefined;
  } });
  const result = await service.artist('Ark King');
  assert.equal(result.catalogMatched, false);
  assert.equal(result.followers, undefined);
  assert.equal(result.sourceUrl, undefined);
  assert.equal(result.biography, undefined);
  assert.deepEqual(result.topTracks, []);
  assert.deepEqual(result.localTracks, [local]);
  assert.match(result.warnings.join(' '), /identidade.*não foi confirmada/);
  assert.equal(calls.some(call => call.url.hostname.endsWith('.wikipedia.org')), false);
});

test('two same-name candidates with matching local songs remain explicitly ambiguous', async () => {
  const { service } = fixture({ responses: url => {
    if (url.pathname === '/search/artist') return { data: [DEEZER_ARTIST, { ...DEEZER_ARTIST, id: 43 }] };
    if (url.pathname === '/artist/43/top') return { data: [catalogTrack(201, 'Known Song', 43)] };
    if (url.pathname === '/artist/43/albums') return { data: [] };
    return undefined;
  } });
  const result = await service.artist('Artist A');
  assert.equal(result.catalogMatched, false);
  assert.equal(result.followers, undefined);
  assert.match(result.warnings.join(' '), /ambígua/);
});

test('niche songs absent from the top list can confirm exact artist ID through catalog track search', async () => {
  const { service } = fixture({ responses: url => {
    if (url.pathname === '/artist/42/top') return { data: [catalogTrack(102, 'Other Song')] };
    if (url.pathname === '/search') return { data: [catalogTrack(103, 'Known Song (Official Audio)')] };
    return undefined;
  } });
  assert.equal((await service.artist('Artist A')).catalogMatched, true);
});

test('artist provider failures preserve confirmed local tracks and whichever factual sections remain', async () => {
  const { service } = fixture({ responses: url => {
    if (url.pathname === '/artist/42/related') return new Error('Provider failure');
    if (url.pathname === '/artist/42') return new Error('Profile failure');
    return undefined;
  } });
  const result = await service.artist('Artist A');
  assert.equal(result.catalogMatched, true);
  assert.deepEqual(result.localTracks, [LOCAL]);
  assert.equal(result.topTracks.length, 2);
  assert.equal(result.albums.length, 1);
  assert.equal(result.followers, 1234, 'search response includes this actual fan count');
  assert.equal(result.biography, undefined);
  assert.deepEqual(result.relatedArtists, []);
  assert.ok(result.warnings.length >= 2);
});

test('a musical Wikipedia homonym without distinctive catalog title evidence is not merged', async () => {
  const local = { ...LOCAL, artist: 'Shiny', title: 'Distinctive Saved Song' };
  const { service } = fixture({ tracks: [local], responses: url => {
    if (url.pathname === '/search/artist') return { data: [{ ...DEEZER_ARTIST, name: 'Shiny' }] };
    if (url.pathname === '/artist/42/top') return { data: [catalogTrack(101, local.title, 42, 'Shiny')] };
    if (url.pathname === '/artist/42') return { ...DEEZER_ARTIST, name: 'Shiny' };
    if (url.hostname.endsWith('.wikipedia.org')) return wiki(url.hostname.split('.')[0], {
      title: 'Shiny', description: 'Indian singer', extract: 'Shiny is a singer who released an unrelated film soundtrack.',
      content_urls: { desktop: { page: 'https://' + url.hostname + '/wiki/Shiny' } }
    });
    return undefined;
  } });
  const result = await service.artist('Shiny');
  assert.equal(result.catalogMatched, true);
  assert.equal(result.biography, undefined);
  assert.equal(result.bioSourceUrl, undefined);
});

test('generic or self-titled catalog words do not establish Wikipedia musical identity', async () => {
  const { service } = fixture({ tracks: [], history: [], responses: url => {
    if (url.pathname === '/artist/42/top') return { data: [catalogTrack(101, 'Intro'), catalogTrack(102, 'Music'), catalogTrack(103, 'Artist A')] };
    if (url.pathname === '/artist/42/albums') return { data: [] };
    if (url.hostname.endsWith('.wikipedia.org')) return wiki(url.hostname.split('.')[0], { extract: 'Artist A is a singer. Music is central to Artist A, whose intro became popular.' });
    return undefined;
  } });
  assert.equal((await service.artist('Artist A')).biography, undefined);
});

test('Wikipedia non-musical, disambiguation, redirected-name and foreign-link responses are not biographies', async t => {
  for (const [label, override] of [
    ['non-musical', { description: 'American businessperson' }],
    ['disambiguation', { type: 'disambiguation' }],
    ['different title', { title: 'Artist A (politician)' }],
    ['foreign source URL', { content_urls: { desktop: { page: 'https://evil.example/wiki/Artist_A' } } }],
    ['different source title', { content_urls: { desktop: { page: 'https://pt.wikipedia.org/wiki/Other_Artist' } } }]
  ]) {
    await t.test(label, async () => {
      const { service } = fixture({ responses: url => url.hostname.endsWith('.wikipedia.org') ? wiki(url.hostname.split('.')[0], override) : undefined });
      const result = await service.artist('Artist A');
      assert.equal(result.biography, undefined);
      assert.equal(result.bioSourceUrl, undefined);
      assert.equal(result.catalogMatched, true);
    });
  }
});

test('image and source URLs cannot be replaced by arbitrary provider links or credentials', async () => {
  const { service } = fixture({ responses: url => {
    if (url.pathname === '/artist/42') return { ...DEEZER_ARTIST, nb_fan: '5000000', picture_big: 'https://cdn-images.dzcdn.net.evil.example/fake.jpg', picture: undefined };
    if (url.pathname === '/artist/42/related') return { data: [{ id: 43, name: 'Related Artist', picture_big: 'https://user:pass@cdn-images.dzcdn.net/fake.jpg' }] };
    return undefined;
  } });
  const result = await service.artist('Artist A');
  assert.equal(result.picture, LOCAL.thumbnail);
  assert.equal(result.followers, undefined);
  assert.equal(result.relatedArtists[0].picture, '');
  assert.equal(result.relatedArtists[0].sourceUrl, 'https://www.deezer.com/artist/43');
});

test('missing Deezer image hashes preserve the available local artist cover', async () => {
  const { service } = fixture({ tracks: [{ ...LOCAL, thumbnail: '', hasCover: true }], responses: url => {
    if (url.pathname === '/artist/42') return { ...DEEZER_ARTIST,
      picture_xl: 'https://cdn-images.dzcdn.net/images/artist//1000x1000-000000-80-0-0.jpg',
      picture_big: 'https://cdn-images.dzcdn.net/images/artist//500x500-000000-80-0-0.jpg',
      picture: 'https://api.deezer.com/artist/42/image' };
    return undefined;
  } });
  const result = await service.artist(LOCAL.artist);
  assert.equal(result.catalogMatched, true);
  assert.equal(result.picture, '/api/cover/' + LOCAL.id);
  assert.equal(result.sourceUrl, 'https://www.deezer.com/artist/42');
});

test('artist pictures fall back to a valid smaller provider image', async () => {
  const { service } = fixture({ responses: url => url.pathname === '/artist/42' ? { ...DEEZER_ARTIST,
    picture_xl: 'https://cdn-images.dzcdn.net/images/artist//1000x1000.jpg', picture_big: IMAGE } : undefined });
  assert.equal((await service.artist(LOCAL.artist)).picture, IMAGE);
});

test('new releases require real calendar release dates within the last 90 days, never import or upload dates', async () => {
  const { service, calls } = fixture({ responses: url => url.pathname === '/artist/42/albums' ? { data: [
    album(1, '2026-10-18'), album(2, '2026-07-20'), album(3, '2026-07-19'), album(4, '2026-10-19'),
    album(5, '2026-02-30'), { ...album(6, undefined), release_date: undefined, addedAt: '2026-10-18', upload_date: '20261018' }, album(7, '1999-01-01')
  ] } : undefined });
  const result = await service.explore('releases');
  assert.deepEqual(result.items.map(item => item.id), ['deezer-album-1', 'deezer-album-2']);
  assert.deepEqual(result.items.map(item => item.releaseDate), ['2026-10-18', '2026-07-20']);
  assert.ok(result.items.every(item => item.kind === 'album'));
  assert.match(result.description, /artistas do seu acervo/);
  assert.equal(calls.some(call => call.url.pathname.startsWith('/editorial/')), false);
});

test('editorial release fallback hydrates missing dates and clearly labels its broader source', async () => {
  const { service, calls } = fixture({ tracks: [], history: [], responses: url => {
    if (url.pathname === '/editorial/0/releases') return { data: [] };
    if (url.pathname === '/editorial/0/selection') return { data: [{ id: 70 }, { id: 71 }, { id: 72 }] };
    if (url.pathname === '/album/70') return album(70, '2026-10-17', 'Editorial Artist');
    if (url.pathname === '/album/71') return album(71, '2026-10-20', 'Editorial Artist');
    if (url.pathname === '/album/72') return { ...album(72), release_date: undefined };
    return undefined;
  } });
  const result = await service.explore('releases');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].releaseDate, '2026-10-17');
  assert.equal(result.items[0].artist, 'Editorial Artist');
  assert.match(result.description, /editorial Deezer/);
  assert.match(result.description, /não são sugestões personalizadas/);
  assert.equal(calls.filter(call => call.url.pathname.startsWith('/album/')).length, 3);
});

test('unavailable release providers return a factual empty state without synthetic albums', async () => {
  const { service } = fixture({ tracks: [], history: [], responses: () => new Error('Offline') });
  const result = await service.explore('releases');
  assert.deepEqual(result.items, []);
  assert.ok(result.emptyReason);
  assert.ok(result.warnings.length);
});

test('artist cache uses the local catalog signature and returns independent caller copies', async () => {
  const data = fixture();
  const first = await data.service.artist('Artist A');
  const calls = data.calls.length;
  first.localTracks[0].title = 'Changed by caller';
  assert.equal((await data.service.artist('Artist A')).localTracks[0].title, LOCAL.title);
  assert.equal(data.calls.length, calls);
  data.setTracks([{ ...LOCAL, title: 'Different song' }]);
  assert.equal((await data.service.artist('Artist A')).catalogMatched, false);
  assert.ok(data.calls.length > calls);
});

test('aborted artist reads never become a cached empty profile', async () => {
  let first = true;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const data = fixture({ responses: async (url, request) => {
    if (first && url.pathname === '/search/artist') {
      first = false;
      started();
      await new Promise(resolve => request.signal.addEventListener('abort', resolve, { once: true }));
      throw new Error('Cancelled source');
    }
    return undefined;
  } });
  const controller = new AbortController();
  const pending = data.service.artist('Artist A', { signal: controller.signal });
  const rejection = assert.rejects(pending, cancelled);
  await ready;
  controller.abort();
  await rejection;
  assert.equal((await data.service.artist('Artist A')).catalogMatched, true);
});

test('provider error payloads do not become invented artist data', async () => {
  const { service } = fixture({ responses: () => ({ error: { code: 4, message: 'Quota limit' } }) });
  const result = await service.artist('Artist A');
  assert.equal(result.catalogMatched, false);
  assert.deepEqual(result.localTracks, [LOCAL]);
  assert.equal(result.followers, undefined);
  assert.equal(result.biography, undefined);
  assert.ok(result.warnings.length);
});
