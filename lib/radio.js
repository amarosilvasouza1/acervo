import { searchYouTube } from './yt.js';

const MAX_SEEDS = 3;
const MAX_QUERIES = 9;

function abortError() {
  return new DOMException('Busca cancelada.', 'AbortError');
}

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function cleanRadioTitle(value) {
  return String(value || '')
    .replace(/[([][^\])]*(?:official|oficial|lyrics?|letra|audio|video|visualizer|hd|hq|4k|remaster|single version|album version|radio edit)[^\])]*[\])]/ig, ' ')
    .replace(/\s*[-|]\s*(?:official|oficial|lyrics?|letra|audio|video|visualizer)\b.*$/i, '')
    .replace(/\s+/g, ' ').trim();
}

export function seedFromResult(result) {
  const cleaned = cleanRadioTitle(result.title);
  const split = cleaned.match(/^(.{2,80}?)\s+[-–—]\s+(.+)$/);
  const channel = String(result.channel || '').replace(/\s*-\s*Topic$/i, '').replace(/\s*(?:VEVO|Official(?:\s+Music)?)$/i, '').trim();
  const titleArtist = split ? split[1].trim() : '';
  const channelExtendsArtist = titleArtist && normalize(channel).startsWith(normalize(titleArtist) + ' ');
  return {
    id: result.videoId,
    videoId: result.videoId,
    title: split ? split[2].trim() : cleaned,
    artist: channelExtendsArtist ? channel : titleArtist || channel,
    thumbnail: result.thumbnail || ''
  };
}

function artistMatches(candidate, artist) {
  const expected = normalize(artist).replace(/\s+sz$/, '');
  const parsed = seedFromResult(candidate);
  const actual = normalize(parsed.artist).replace(/\s+sz$/, '');
  const channel = normalize(candidate.channel).replace(/\s+(?:topic|vevo|official|sz)$/, '');
  if (!expected) return true;
  return actual === expected || channel === expected || actual.split(/\s+(?:feat|ft|x|e|and)\s+/).includes(expected);
}

export function collaborationArtists(title) {
  return Array.from(new Set((String(title || '').match(/@[A-Za-z][\w.-]{2,40}/g) || []).map(function (handle) { return handle.slice(1).replace(/[.-]+$/, ''); }))).slice(0, 3);
}

export function songKey(track) {
  const parsed = track.videoId && !track.artist ? seedFromResult(track) : track;
  const artist = normalize(parsed.artist).replace(/\s+sz$/, '');
  const parts = cleanRadioTitle(parsed.title).split('|').map(function (part) { return part.trim(); }).filter(Boolean);
  const firstIsArtist = parts.length > 1 && normalize(parts[0]).replace(/\s+sz$/, '') === artist;
  const rawTitle = parts[firstIsArtist ? 1 : 0] || '';
  // Anime/character annotations belong to the display title, not song identity.
  const canonicalTitle = rawTitle.replace(/\s*[\[(].*[\])]\s*$/, '').trim() || rawTitle;
  let title = normalize(canonicalTitle);
  if (artist && title.startsWith(artist + ' ')) title = title.slice(artist.length + 1);
  return (artist + ' ' + title).trim();
}

export function recentRadioSeeds(tracks, history = [], now = Date.now()) {
  const byId = new Map(tracks.map(function (track) { return [track.id, track]; }));
  const events = history.length ? history : tracks.filter(function (track) { return track.lastPlayedAt; }).map(function (track) {
    return { trackId: track.id, playedAt: track.lastPlayedAt };
  });
  const ranked = new Map();
  for (const event of events.slice().sort(function (a, b) { return Date.parse(b.playedAt) - Date.parse(a.playedAt); }).slice(0, 40)) {
    const track = byId.get(event.trackId);
    const at = Date.parse(event.playedAt);
    if (!track || !Number.isFinite(at)) continue;
    const age = Math.max(0, now - at) / 86400000;
    // A recent listen matters more, while repeated listening can influence the mix.
    ranked.set(track.id, (ranked.get(track.id) || 0) + 1 / (1 + age));
  }
  const candidates = Array.from(ranked.entries()).sort(function (a, b) { return b[1] - a[1]; }).map(function (entry) { return byId.get(entry[0]); });
  const seeds = [];
  const artists = new Set();
  for (const track of candidates) {
    const artist = normalize(track.artist);
    if (artist && artists.has(artist)) continue;
    seeds.push(track);
    artists.add(artist);
    if (seeds.length === MAX_SEEDS) break;
  }
  return seeds;
}

export async function fetchRelatedArtists(artist, { signal, fetchImpl = fetch } = {}) {
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000);
  const response = await fetchImpl('https://api.deezer.com/search/artist?q=' + encodeURIComponent(artist) + '&limit=1', { signal: requestSignal });
  if (!response.ok) throw new Error('Catálogo de artistas indisponível.');
  const data = await response.json();
  const found = data && data.data && data.data[0];
  if (!found || !Number.isSafeInteger(Number(found.id)) || normalize(found.name) !== normalize(artist)) return [];
  const related = await fetchImpl('https://api.deezer.com/artist/' + found.id + '/related?limit=4', { signal: requestSignal });
  if (!related.ok) throw new Error('Artistas relacionados indisponíveis.');
  const relatedData = await related.json();
  if (relatedData.error) throw new Error('Artistas relacionados indisponíveis.');
  return (relatedData.data || []).map(function (item) { return item.name; }).filter(Boolean).slice(0, 4);
}

function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) {
    Promise.resolve(promise).catch(function () {});
    return Promise.reject(abortError());
  }
  return new Promise(function (resolve, reject) {
    const onAbort = function () { reject(abortError()); };
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(function () { signal.removeEventListener('abort', onAbort); });
  });
}

function createLimiter(concurrency, signal) {
  let active = 0;
  const waiting = [];
  function next() {
    while (active < concurrency && waiting.length) {
      const entry = waiting.shift();
      if (signal.aborted) { entry.reject(abortError()); continue; }
      active++;
      Promise.resolve().then(entry.task).then(entry.resolve, entry.reject).finally(function () { active--; next(); });
    }
  }
  return function (task) {
    return new Promise(function (resolve, reject) { waiting.push({ task, resolve, reject }); next(); });
  };
}

export function validateRadioInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('Envie as opções da rádio em um objeto JSON.'), { statusCode: 400 });
  const seedId = typeof input.seedId === 'string' ? input.seedId.trim() : '';
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  if (seedId.length > 100 || query.length > 240) throw Object.assign(new Error('A referência da rádio é muito longa.'), { statusCode: 400 });
  if (seedId && query) throw Object.assign(new Error('Escolha uma faixa ou uma busca como referência.'), { statusCode: 400 });
  const limit = Math.min(30, Math.max(1, Math.floor(Number(input.limit) || 18)));
  const excludeIds = Array.isArray(input.excludeIds) ? input.excludeIds.filter(function (id) { return typeof id === 'string'; }).slice(0, 500) : [];
  return { seedId, query, limit, excludeIds };
}

/**
 * Each invocation searches online again. Only metadata and related artists are used;
 * online candidates have not undergone the local audio-feature analysis.
 * Dependencies are injected so cancellation, partial failure and batching are testable.
 */
export async function runRadio(rawInput, dependencies = {}) {
  const input = validateRadioInput(rawInput);
  const tracks = dependencies.tracks || [];
  const history = dependencies.history || [];
  const emit = dependencies.onEvent || function () {};
  const search = dependencies.search || searchYouTube;
  const relatedArtists = dependencies.relatedArtists || fetchRelatedArtists;
  const controller = new AbortController();
  const externalSignal = dependencies.signal;
  const signal = externalSignal ? AbortSignal.any([externalSignal, controller.signal]) : controller.signal;
  const sessionTimeout = setTimeout(function () { controller.abort(new Error('Tempo limite da busca.')); }, dependencies.timeoutMs || 70000);
  let total = 0;
  let completed = 0;
  let planned = 0;
  let capped = false;
  const warnings = [];
  const mode = input.query ? 'query' : input.seedId ? 'seed' : 'recent';
  let seeds = input.seedId ? tracks.filter(function (track) { return track.id === input.seedId; }) : input.query ? [] : recentRadioSeeds(tracks, history, dependencies.now || Date.now());
  const notify = function (event, data) { if (!externalSignal || !externalSignal.aborted) emit(event, data); };
  const status = function (message, extra = {}) { notify('status', Object.assign({ message, completed, total: planned }, extra)); };

  try {
    notify('start', { mode, query: input.query, seeds: seeds.map(function (seed) { return { id: seed.id, title: seed.title, artist: seed.artist, thumbnail: seed.thumbnail }; }) });
    if (input.seedId && !seeds.length) throw new Error('Essa faixa não está mais no acervo. Escolha outra referência.');
    if (input.query) {
      status('Procurando a música de referência…');
      const found = await abortable(search(input.query, 5, { signal, timeout: 25000 }), signal);
      if (!found.length) throw new Error('Nenhuma música encontrada para essa referência. Tente o artista e o nome da faixa.');
      seeds = [seedFromResult(found[0])];
      status('Referência encontrada. Procurando músicas…', { seeds });
    }
    if (!seeds.length) throw new Error('Ouça uma faixa do acervo ou escolha uma música para começar sua rádio.');

    const usedIds = new Set(input.excludeIds.concat(tracks.map(function (track) { return track.videoId || track.id; }), seeds.map(function (seed) { return seed.videoId || seed.id; })));
    const usedSongs = new Set(tracks.concat(seeds).map(songKey));
    const usedQueries = new Set();
    const limitSearch = createLimiter(3, signal);
    const searches = [];

    function schedule(query, seed, artist, relationship) {
      const key = normalize(query);
      if (!key || usedQueries.has(key) || planned >= MAX_QUERIES || signal.aborted) return;
      usedQueries.add(key);
      planned++;
      const task = limitSearch(async function () {
        status('Buscando ' + (artist || seed.title) + '…');
        try {
          const candidates = await abortable(search(query, 8, { signal, timeout: 30000 }), signal);
          const items = [];
          for (const candidate of candidates) {
            if (total >= input.limit) break;
            if (!candidate || !candidate.videoId || usedIds.has(candidate.videoId)) continue;
            if (artist && !artistMatches(candidate, artist)) continue;
            if ((candidate.duration && candidate.duration < 45) || candidate.duration > 900) continue;
            if (/\b(full album|playlist|greatest hits|best of|compilation|non.?stop|\d+\s*(?:hours?|horas?))\b/i.test(candidate.title)) continue;
            const song = songKey(candidate);
            if (usedSongs.has(song)) continue;
            usedIds.add(candidate.videoId);
            usedSongs.add(song);
            total++;
            items.push(Object.assign({}, candidate, {
              because: relationship === 'collaboration' ? artist + ' · participa com ' + seed.artist : relationship ? artist + ' · artista relacionado a ' + seed.artist : 'Mais de ' + (artist || seed.title),
              sourceArtist: artist || '',
              seedId: seed.id || seed.videoId || null,
              recommendationType: relationship === 'collaboration' ? 'collaboration' : relationship ? 'related-artist' : 'artist'
            }));
            if (!relationship) {
              for (const collaborator of collaborationArtists(candidate.title).slice(0, 2)) {
                if (normalize(collaborator) !== normalize(seed.artist)) schedule(collaborator + ' official audio music', seed, collaborator, 'collaboration');
              }
            }
          }
          if (items.length) notify('results', { items, total });
          if (total >= input.limit) { capped = true; controller.abort(); }
        } catch (error) {
          if (!signal.aborted) {
            warnings.push('Não foi possível concluir a busca de ' + (artist || seed.title) + '.');
            status('Uma fonte não respondeu; continuando as outras buscas.');
          }
        } finally {
          completed++;
          if (!signal.aborted) status('Buscas concluídas: ' + completed + ' de ' + planned + '.');
        }
      }).catch(function (error) {
        if (!signal.aborted) throw error;
      });
      searches.push(task);
    }

    const relatedLookups = [];
    for (const seed of seeds) {
      schedule((seed.artist || seed.title) + ' official audio music', seed, seed.artist, false);
      if (!seed.artist) continue;
      relatedLookups.push((async function () {
        try {
          const names = await abortable(relatedArtists(seed.artist, { signal }), signal);
          for (const name of names.slice(0, 3)) schedule(name + ' official audio music', seed, name, true);
        } catch (error) {
          if (!signal.aborted) warnings.push('Artistas relacionados a ' + seed.artist + ' indisponíveis nesta busca.');
        }
      })());
    }
    await Promise.all(relatedLookups);
    // Primary searches can uncover explicit collaborators and schedule another batch.
    for (let index = 0; index < searches.length; index++) await searches[index];
    if (signal.aborted && !capped && !(externalSignal && externalSignal.aborted)) warnings.push('A busca atingiu o tempo limite. Os resultados já encontrados foram mantidos.');
    if (!total && !warnings.length && !signal.aborted) status('Nenhuma novidade encontrada. Tente outra referência ou uma nova busca.');
    notify('done', { total, partial: warnings.length > 0, warnings });
    return { total, partial: warnings.length > 0, warnings };
  } catch (error) {
    if (externalSignal && externalSignal.aborted) return { total, cancelled: true };
    const message = signal.aborted ? 'A busca demorou demais. Tente novamente.' : String(error.message || error);
    notify('error', { message });
    notify('done', { total, partial: true, warnings: [message] });
    return { total, partial: true, warnings: [message] };
  } finally {
    clearTimeout(sessionTimeout);
  }
}
