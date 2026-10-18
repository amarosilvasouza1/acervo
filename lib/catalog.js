import crypto from 'node:crypto';
import { searchYouTube as defaultSearch } from './yt.js';
import { runRadio as defaultRadio, cleanRadioTitle, seedFromResult } from './radio.js';

const TTL = 10 * 60 * 1000;
const DAY = 86400000;
const RELEASE_WINDOW = 90 * DAY;
const MAX_ITEMS = 12;
const API = 'https://api.deezer.com';
const MUSICAL_DESCRIPTION = /\b(music(?:al|ian|ians)?|m[uú]sic[oa]s?|singer|songwriter|band|rapper|cantor(?:a|es|as)?|compositor(?:a|es|as)?|duo|dupla|banda|producer|produtor(?:a)?|disc jockey|dj|orchestra|orquestra|guitarist|pianist|vocalist)\b/iu;

function aborted() { return new DOMException('Consulta cancelada.', 'AbortError'); }
function checkSignal(signal) { if (signal?.aborted) throw aborted(); }
function inputError(message) { return Object.assign(new Error(message), { statusCode: 400 }); }
function normalized(value) { return String(value || '').normalize('NFC').toLocaleLowerCase('pt-BR').replace(/\s+/gu, ' ').trim(); }
function artistName(value) {
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 120 || /[\p{Cc}\p{Cf}]/u.test(value)) {
    throw inputError('Informe o nome do artista com 1 a 120 caracteres.');
  }
  return value.trim().replace(/\s+/gu, ' ');
}
function idOf(value) { const id = Number(value); return Number.isSafeInteger(id) && id > 0 ? id : null; }
function plain(value, maximum = 300) { return typeof value === 'string' ? value.replace(/<[^>]*>/g, '').replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, maximum) : ''; }
function unique(values) { return Array.from(new Set(values.filter(Boolean))); }
function cacheSignature(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function sameArtist(a, b) { return normalized(a) === normalized(b); }
function biographyMatchesCatalog(extract, name, titles) {
  const text = ' ' + titleKey(extract, '') + ' ';
  const ignored = new Set(['intro', 'outro', 'introduction', 'music', 'música', 'musica', 'album', 'collection', 'greatest hits', 'original', 'remix', 'single', 'untitled']);
  return titles.some(value => {
    const key = titleKey(value, name);
    return key.replace(/[^\p{L}]/gu, '').length >= 5 && key !== titleKey(name, '')
      && !ignored.has(key) && text.includes(' ' + key + ' ');
  });
}
function titleKey(value, name) {
  let title = cleanRadioTitle(value).normalize('NFC').toLocaleLowerCase('pt-BR');
  const prefix = normalized(name);
  for (const separator of [' - ', ' – ', ' — ', ' | ']) {
    if (title.startsWith(prefix + separator)) title = title.slice(prefix.length + separator.length);
  }
  return title.replace(/\s*[\[(][^\])]*[\])]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function safePicture(value, local = false) {
  if (local && /^\/api\/cover\/[A-Za-z0-9_-]{6,64}$/.test(value || '')) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return '';
    const host = url.hostname;
    if (host === 'api.deezer.com' || host === 'dzcdn.net' || host.endsWith('.dzcdn.net')
      || (local && ['i.ytimg.com', 'img.youtube.com', 'yt3.googleusercontent.com'].includes(host))) return url.href;
  } catch { /* Provider data is optional. */ }
  return '';
}
function picture(value) { return safePicture(value?.picture_xl || value?.picture_big || value?.picture_medium || value?.picture); }
function albumPicture(value) { return safePicture(value?.cover_xl || value?.cover_big || value?.cover_medium || value?.cover); }
function sourceUrl(type, id) { return idOf(id) ? 'https://www.deezer.com/' + type + '/' + idOf(id) : ''; }
function releaseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const at = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === value ? value : null;
}
function albumItem(value, name = '') {
  const id = idOf(value?.id);
  const title = plain(value?.title);
  const artist = plain(value?.artist?.name || name, 120);
  if (!id || !title || !artist) return null;
  return { id: 'deezer-album-' + id, title, artist, artistName: artist, thumbnail: albumPicture(value),
    releaseDate: releaseDate(value.release_date), sourceUrl: sourceUrl('album', id), kind: 'album' };
}
function trackItem(value, name = '') {
  const id = idOf(value?.id);
  const title = plain(value?.title);
  const artist = plain(value?.artist?.name || name, 120);
  if (!id || !title || !artist) return null;
  return { id: 'deezer-track-' + id, title, artist, artistName: artist, thumbnail: albumPicture(value.album),
    duration: Number.isFinite(Number(value.duration)) && Number(value.duration) >= 0 ? Number(value.duration) : 0,
    album: plain(value.album?.title), sourceUrl: sourceUrl('track', id), kind: 'track' };
}
function recentTracks(tracks, history) {
  const latest = new Map();
  for (const event of history) {
    const at = Date.parse(event?.playedAt);
    if (typeof event?.trackId === 'string' && Number.isFinite(at) && at > (latest.get(event.trackId) ?? -Infinity)) latest.set(event.trackId, at);
  }
  if (!history.length) for (const track of tracks) {
    const at = Date.parse(track.lastPlayedAt);
    if (Number.isFinite(at)) latest.set(track.id, at);
  }
  return tracks.filter(track => latest.has(track.id)).slice().sort((a, b) => latest.get(b.id) - latest.get(a.id));
}
function artistsFrom(tracks, maximum = 12) {
  const found = new Map();
  for (const track of tracks) {
    const name = plain(track.artist, 120);
    if (!name || found.has(normalized(name))) continue;
    const image = safePicture(track.thumbnail, true);
    found.set(normalized(name), { name, ...(image ? { picture: image } : {}) });
    if (found.size >= maximum) break;
  }
  return Array.from(found.values());
}
function clone(value) { return structuredClone(value); }

/** Only public metadata is fetched. The library and listening history are never modified. */
export function createCatalogService(dependencies = {}) {
  const getTracks = dependencies.getTracks || (async () => []);
  const getHistory = dependencies.getHistory || (async () => []);
  const search = dependencies.searchYouTube || defaultSearch;
  const radio = dependencies.runRadio || defaultRadio;
  const fetchImpl = dependencies.fetchImpl || fetch;
  const now = typeof dependencies.now === 'function' ? dependencies.now : () => dependencies.now ?? Date.now();
  const cache = new Map();

  function cached(key) {
    const entry = cache.get(key);
    if (!entry || now() - entry.at >= TTL) { cache.delete(key); return null; }
    return clone(entry.value);
  }
  function remember(key, value, signal) {
    checkSignal(signal);
    cache.set(key, { at: now(), value: clone(value) });
    while (cache.size > 100) cache.delete(cache.keys().next().value);
    return value;
  }
  async function within(task, externalSignal, milliseconds) {
    checkSignal(externalSignal);
    const controller = new AbortController();
    const signal = externalSignal ? AbortSignal.any([externalSignal, controller.signal]) : controller.signal;
    let timeout;
    let onAbort;
    const interrupted = new Promise((resolve, reject) => {
      onAbort = () => reject(externalSignal?.aborted ? aborted() : new Error('A fonte atingiu o tempo limite.'));
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
      timeout = setTimeout(() => controller.abort(), milliseconds);
    });
    try { return await Promise.race([Promise.resolve().then(() => task(signal)), interrupted]); }
    finally { clearTimeout(timeout); signal.removeEventListener('abort', onAbort); }
  }
  async function json(url, signal, milliseconds = 5000) {
    return within(async requestSignal => {
      const response = await fetchImpl(url, { signal: requestSignal, redirect: 'error', headers: { Accept: 'application/json', 'User-Agent': 'Acervo/1.3.6 (music catalog)' } });
      if (!response.ok) throw new Error('Catálogo indisponível.');
      let value;
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > 2 * 1024 * 1024) throw new Error('Resposta do catálogo muito grande.');
            chunks.push(part.value);
          }
          value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } finally { await reader.cancel().catch(() => {}); }
      } else value = await response.json();
      if (!value || typeof value !== 'object' || value.error) throw new Error('O catálogo não retornou dados válidos.');
      return value;
    }, signal, milliseconds);
  }
  async function providerList(endpoint, signal) {
    const value = await json(API + endpoint, signal);
    if (!Array.isArray(value.data)) throw new Error('Lista do catálogo indisponível.');
    return value.data;
  }
  async function wikiBiography(name, catalogTitles, signal) {
    const results = await Promise.allSettled(['pt', 'en'].map(async language => {
      const value = await json('https://' + language + '.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(name.replace(/ /g, '_')), signal, 4000);
      if (value.type !== 'standard' || !sameArtist(String(value.title || '').replace(/_/g, ' '), name)
        || !MUSICAL_DESCRIPTION.test(value.description || '') || !plain(value.extract, 1400)
        || !biographyMatchesCatalog(value.extract, name, catalogTitles)) return null;
      let link;
      try { link = new URL(value.content_urls?.desktop?.page); } catch { return null; }
      if (link.protocol !== 'https:' || link.hostname !== language + '.wikipedia.org' || link.username || link.password || link.port
        || !link.pathname.startsWith('/wiki/')) return null;
      let pageTitle;
      try { pageTitle = decodeURIComponent(link.pathname.slice(6)).replace(/_/g, ' '); } catch { return null; }
      if (!sameArtist(pageTitle, name)) return null;
      link.search = ''; link.hash = '';
      return { biography: plain(value.extract, 1400), bioSourceUrl: link.href, bioSourceName: 'Wikipédia · CC BY-SA' };
    }));
    checkSignal(signal);
    for (const result of results) if (result.status === 'fulfilled' && result.value) return result.value;
    return null;
  }

  async function identity(name, localTracks, signal, warnings) {
    let candidates;
    try {
      candidates = (await providerList('/search/artist?q=' + encodeURIComponent(name) + '&limit=10', signal))
        .filter(value => idOf(value?.id) && sameArtist(value.name, name));
      candidates = Array.from(new Map(candidates.map(value => [idOf(value.id), value])).values()).slice(0, 3);
    } catch {
      checkSignal(signal);
      warnings.push('Não foi possível consultar o catálogo de artistas agora.');
      return null;
    }
    if (!candidates.length) { warnings.push('Nenhum perfil com o mesmo nome foi confirmado no catálogo.'); return null; }
    if (!localTracks.length && candidates.length > 1) {
      const populated = candidates.filter(candidate => Number(candidate.nb_album) > 0);
      if (populated.length === 1) candidates = populated;
      else { warnings.push('Há mais de um artista com esse nome; nenhum perfil externo foi associado automaticamente.'); return null; }
    }
    const localTitles = new Set(localTracks.map(track => titleKey(track.title, name)).filter(Boolean));
    const matches = [];
    for (const candidate of candidates) {
      checkSignal(signal);
      const id = idOf(candidate.id);
      const settled = await Promise.allSettled([
        providerList('/artist/' + id + '/top?limit=50', signal),
        providerList('/artist/' + id + '/albums?limit=30', signal)
      ]);
      checkSignal(signal);
      const top = settled[0].status === 'fulfilled' ? settled[0].value : [];
      const albums = settled[1].status === 'fulfilled' ? settled[1].value : [];
      let confirmed = !localTracks.length || top.some(track => idOf(track.artist?.id) === id && localTitles.has(titleKey(track.title, name)));
      // A saved niche song may be absent from the top list; verify its title and artist ID.
      if (!confirmed) {
        for (const title of Array.from(localTitles).slice(0, 2)) {
          try {
            const q = 'artist:"' + name.replace(/"/g, '') + '" track:"' + title.replace(/"/g, '') + '"';
            const tracks = await providerList('/search?q=' + encodeURIComponent(q) + '&limit=10', signal);
            if (tracks.some(track => idOf(track.artist?.id) === id && sameArtist(track.artist?.name, name) && localTitles.has(titleKey(track.title, name)))) { confirmed = true; break; }
          } catch { checkSignal(signal); }
        }
      }
      if (!confirmed) continue;
      matches.push({ candidate, top, albums, topFailed: settled[0].status === 'rejected', albumsFailed: settled[1].status === 'rejected' });
    }
    if (matches.length !== 1) {
      warnings.push(matches.length > 1 ? 'Mais de um perfil corresponde às faixas locais; a identidade externa permanece ambígua.'
        : 'A identidade do catálogo não foi confirmada pelas músicas do seu acervo. As informações locais foram preservadas.');
      return null;
    }
    return matches[0];
  }

  async function artist(name, { signal } = {}) {
    name = artistName(name);
    checkSignal(signal);
    const tracks = await getTracks();
    const localTracks = tracks.filter(track => sameArtist(track.artist, name));
    const key = 'artist:' + normalized(name) + ':' + cacheSignature(localTracks);
    const hit = cached(key);
    if (hit) { checkSignal(signal); return hit; }
    const warnings = [];
    const result = { name, catalogMatched: false, localTracks: clone(localTracks), topTracks: [], albums: [], relatedArtists: [], warnings };
    const fallback = localTracks.map(track => safePicture(track.thumbnail, true)).find(Boolean);
    if (fallback) result.picture = fallback;
    const found = await identity(name, localTracks, signal, warnings);
    if (!found) {
      checkSignal(signal);
      return remember(key, result, signal);
    }
    const id = idOf(found.candidate.id);
    result.catalogMatched = true;
    result.sourceUrl = sourceUrl('artist', id);
    const supplemental = await Promise.allSettled([
      json(API + '/artist/' + id, signal),
      providerList('/artist/' + id + '/related?limit=8', signal),
      wikiBiography(name, found.top.map(track => track.title).concat(found.albums.map(album => album.title)), signal)
    ]);
    checkSignal(signal);
    const detail = supplemental[0].status === 'fulfilled' && idOf(supplemental[0].value.id) === id
      && sameArtist(supplemental[0].value.name, name) ? supplemental[0].value : found.candidate;
    const image = picture(detail);
    if (image) result.picture = image;
    if (Number.isSafeInteger(detail.nb_fan) && detail.nb_fan >= 0) {
      result.followers = detail.nb_fan;
      result.followersSource = 'Deezer';
      result.followersLabel = 'fãs no Deezer';
    }
    result.topTracks = found.top.filter(track => !track.artist?.id || idOf(track.artist.id) === id).map(track => trackItem(track, name)).filter(Boolean).slice(0, 10);
    result.albums = found.albums.map(album => albumItem(album, name)).filter(Boolean).slice(0, 24);
    if (supplemental[1].status === 'fulfilled') {
      result.relatedArtists = supplemental[1].value.filter(value => idOf(value?.id) && plain(value.name, 120)).map(value => ({
        name: plain(value.name, 120), picture: picture(value), sourceUrl: sourceUrl('artist', value.id)
      })).slice(0, 8);
    } else warnings.push('Os artistas relacionados não responderam nesta consulta.');
    if (supplemental[2].status === 'fulfilled' && supplemental[2].value) Object.assign(result, supplemental[2].value);
    if (found.topFailed) warnings.push('As faixas populares não responderam nesta consulta.');
    if (found.albumsFailed) warnings.push('A discografia não respondeu nesta consulta.');
    if (supplemental[0].status === 'rejected') warnings.push('Parte dos dados do perfil não respondeu nesta consulta.');
    result.warnings = unique(warnings);
    return remember(key, result, signal);
  }

  async function recommendations(tracks, history, signal) {
    const items = [];
    const warnings = [];
    const used = new Set(tracks.map(track => track.videoId || track.id));
    let accepting = true;
    const byArtist = artistsFrom(recentTracks(tracks, history).concat(tracks));
    if (!recentTracks(tracks, history).length) return { items, artists: byArtist, description: 'Sugestões baseadas nas músicas que você ouviu.', emptyReason: 'Ouça uma música do acervo para receber recomendações relacionadas.', warnings };
    const collect = (event, data) => {
      if (signal?.aborted || !accepting) return;
      if (event === 'results' && Array.isArray(data?.items)) {
        for (const candidate of data.items) {
          if (!/^[A-Za-z0-9_-]{11}$/.test(candidate?.videoId || '') || used.has(candidate.videoId) || items.length >= MAX_ITEMS) continue;
          const parsed = seedFromResult(candidate);
          if (!plain(parsed.title)) continue;
          used.add(candidate.videoId);
          items.push({ id: candidate.videoId, videoId: candidate.videoId, title: plain(parsed.title), artist: plain(candidate.artist || parsed.artist, 120),
            thumbnail: safePicture(candidate.thumbnail, true), duration: Math.max(0, Number(candidate.duration) || 0),
            url: 'https://www.youtube.com/watch?v=' + candidate.videoId, sourceUrl: 'https://www.youtube.com/watch?v=' + candidate.videoId, kind: 'track' });
        }
      }
      if (event === 'done' && Array.isArray(data?.warnings)) warnings.push(...data.warnings.filter(value => typeof value === 'string').map(value => plain(value)));
      if (event === 'error') warnings.push(plain(data?.message || 'Uma fonte de recomendações não respondeu.'));
    };
    try {
      const response = await within(requestSignal => radio({ limit: MAX_ITEMS }, {
        tracks, history, search, signal: requestSignal, timeoutMs: 25000, now: now(), onEvent: collect,
        relatedArtists: async (name, options) => {
          const local = tracks.filter(track => sameArtist(track.artist, name));
          const found = await identity(name, local, options?.signal, []);
          if (!found) return [];
          const values = await providerList('/artist/' + idOf(found.candidate.id) + '/related?limit=4', options?.signal);
          return values.map(value => plain(value.name, 120)).filter(Boolean).slice(0, 4);
        }
      }), signal, 25000);
      if (response?.warnings) warnings.push(...response.warnings.filter(value => typeof value === 'string').map(value => plain(value)));
    } catch {
      checkSignal(signal);
      warnings.push('A busca de recomendações não terminou. Os resultados já encontrados foram mantidos.');
    } finally { accepting = false; }
    checkSignal(signal);
    return { items, artists: byArtist, description: 'Descobertas buscadas a partir das suas músicas ouvidas recentemente.', warnings: unique(warnings),
      ...(!items.length ? { emptyReason: 'Nenhuma recomendação pôde ser confirmada agora. Tente novamente mais tarde.' } : {}) };
  }

  async function releases(tracks, history, signal) {
    const warnings = [];
    const items = [];
    const used = new Set();
    const today = Date.parse(new Date(now()).toISOString().slice(0, 10) + 'T00:00:00Z');
    const inWindow = item => item?.releaseDate && Date.parse(item.releaseDate + 'T00:00:00Z') <= today
      && Date.parse(item.releaseDate + 'T00:00:00Z') >= today - RELEASE_WINDOW;
    const add = item => { if (inWindow(item) && !used.has(item.id)) { used.add(item.id); items.push(item); } };
    const names = artistsFrom(recentTracks(tracks, history).concat(tracks), 4);
    const matched = await Promise.allSettled(names.map(async value => {
      const local = tracks.filter(track => sameArtist(track.artist, value.name));
      const found = await identity(value.name, local, signal, []);
      if (!found) return;
      for (const album of found.albums) add(albumItem(album, value.name));
    }));
    checkSignal(signal);
    if (matched.some(value => value.status === 'rejected')) warnings.push('Alguns artistas não responderam à consulta de lançamentos.');
    let editorial = false;
    if (!items.length) {
      editorial = true;
      try {
        let albums = await providerList('/editorial/0/releases?limit=12', signal);
        if (!albums.length) albums = await providerList('/editorial/0/selection?limit=12', signal);
        const candidates = albums.filter(album => idOf(album?.id)).slice(0, 12);
        const details = await Promise.allSettled(candidates.map(async album => {
          // Editorial lists can omit release_date: hydrate the real album record.
          if (!releaseDate(album.release_date) || !album.artist?.name) return json(API + '/album/' + idOf(album.id), signal);
          return album;
        }));
        for (const value of details) if (value.status === 'fulfilled') add(albumItem(value.value));
        if (details.some(value => value.status === 'rejected')) warnings.push('Parte das datas de lançamento não pôde ser verificada.');
      } catch { checkSignal(signal); warnings.push('O catálogo de lançamentos não respondeu agora.'); }
    }
    items.sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
    const limited = items.slice(0, MAX_ITEMS);
    return { items: limited, artists: limited.length ? artistsFrom(limited) : names,
      description: editorial ? 'Lançamentos do catálogo editorial Deezer nos últimos 90 dias; não são sugestões personalizadas.'
        : 'Lançamentos confirmados nos últimos 90 dias de artistas do seu acervo.',
      ...(!limited.length ? { emptyReason: 'Nenhum lançamento com data confirmada nos últimos 90 dias foi encontrado agora.' } : {}), warnings: unique(warnings) };
  }

  async function explore(section, { signal } = {}) {
    if (typeof section !== 'string' || !['recommended', 'releases', 'recent'].includes(section)) throw inputError('Escolha recommended, releases ou recent.');
    checkSignal(signal);
    const [tracks, history] = await Promise.all([getTracks(), getHistory()]);
    checkSignal(signal);
    if (section === 'recent') {
      const recent = recentTracks(tracks, history).slice(0, 36);
      return { section, updatedAt: new Date(now()).toISOString(), items: recent.map(track => ({ ...clone(track), kind: 'track', artistName: track.artist || '' })),
        artists: artistsFrom(recent), description: 'As músicas que você ouviu recentemente neste acervo.', warnings: [],
        ...(!recent.length ? { emptyReason: 'Seu histórico de reprodução ainda está vazio. Ouça uma música para começar.' } : {}) };
    }
    const signature = cacheSignature({ tracks: tracks.map(track => [track.id, track.videoId, track.artist, track.title, track.lastPlayedAt]), history,
      ...(section === 'releases' ? { day: new Date(now()).toISOString().slice(0, 10) } : {}) });
    const key = 'explore:' + section + ':' + signature;
    const hit = cached(key);
    if (hit) { checkSignal(signal); return hit; }
    const result = await (section === 'recommended' ? recommendations(tracks, history, signal) : releases(tracks, history, signal));
    checkSignal(signal);
    return remember(key, { section, updatedAt: new Date(now()).toISOString(), ...result }, signal);
  }

  return { explore, artist };
}
