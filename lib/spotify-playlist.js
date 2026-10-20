import { validVideoId } from './input-policy.js';

const MAX_FILE = 1500000;
export const MAX_PLAYLIST_ENTRIES = 1000;
const invalid = message => Object.assign(new Error(message), { statusCode: 422 });
export const playlistText = (value, limit = 220) => typeof value === 'string'
  ? value.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '';

function spotifyUrl(value, kind) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  const text = value.trim();
  const uri = text.match(new RegExp('^spotify:' + kind + ':([A-Za-z0-9]{22})$'));
  if (uri) return 'https://open.spotify.com/' + kind + '/' + uri[1];
  try {
    if (/[\\\x00-\x20]/.test(text)) return null;
    const url = new URL(text);
    const match = url.pathname.match(new RegExp('^\\/(?:intl-[a-zA-Z-]+\\/)?(?:embed\\/)?' + kind + '\\/([A-Za-z0-9]{22})\\/?$'));
    if (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com' || url.port || url.username || url.password || !match) return null;
    return 'https://open.spotify.com/' + kind + '/' + match[1];
  } catch { return null; }
}

export function spotifyPlaylistUrl(value) { return spotifyUrl(value, 'playlist'); }
export function spotifyTrackUrl(value) { return spotifyUrl(value, 'track'); }

function script(html, id) {
  return html.match(new RegExp('<script\\b[^>]*\\bid=["\']' + id + '["\'][^>]*>([\\s\\S]*?)<\\/script>', 'i'))?.[1];
}

async function publicHtml(url, fetcher, signal) {
  const response = await fetcher(url, { redirect: 'error', signal: signal || AbortSignal.timeout(20000),
    headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 AcervoPlaylistImport/1.0' } });
  if (!response.ok) { await response.body?.cancel(); throw invalid(response.status === 429
    ? 'O Spotify limitou a leitura. Aguarde um pouco e tente novamente.' : 'Não foi possível ler a playlist. Confira se ela é pública e se o link está correto.'); }
  if (Number(response.headers.get('content-length')) > 3 * 1024 * 1024) { await response.body?.cancel(); throw invalid('Resposta da playlist muito grande.'); }
  let size = 0; const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 3 * 1024 * 1024) throw invalid('Resposta da playlist muito grande.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size).toString('utf8');
}

function sourceEntry(track, index) {
  const uri = typeof track.uri === 'string' ? track.uri : '';
  const id = uri.match(/^spotify:track:([A-Za-z0-9]{22})$/)?.[1]
    || (typeof track.id === 'string' && /^[A-Za-z0-9]{22}$/.test(track.id) ? track.id : '');
  const title = playlistText(track.title || track.trackName || track.name);
  const artist = playlistText(track.subtitle || track.artistName || track.artist
    || (Array.isArray(track.artists) ? track.artists.map(item => item?.name).filter(Boolean).join(', ') : ''), 256);
  const duration = Number(track.duration ?? track.duration_ms);
  const album = playlistText(track.albumName || track.album?.name);
  const unavailable = track.unsupported || (uri && !id) || !title || !artist;
  return { source: 'spotify', sourceId: id, sourceUrl: id ? 'https://open.spotify.com/track/' + id : '',
    title: title || 'Faixa indisponível ' + (index + 1), artist, album,
    duration: Number.isFinite(duration) && duration > 0 && duration <= 86400000 ? duration / 1000 : 0,
    thumbnail: '', ...(unavailable ? { status: 'error', errorCode: 'unsupported', error: 'Esta entrada não contém uma música identificável (pode ser um podcast, arquivo local ou faixa removida).' } : {}) };
}

export function parseSpotifyEmbed(html, sourceUrl) {
  const canonical = spotifyPlaylistUrl(sourceUrl);
  if (!canonical) throw invalid('Use o link de uma playlist do Spotify.');
  let entity;
  try { entity = JSON.parse(script(html, '__NEXT_DATA__')).props.pageProps.state.data.entity; } catch {}
  if (!entity || entity.type !== 'playlist' || entity.id !== canonical.split('/').pop() || !Array.isArray(entity.trackList) || !entity.trackList.length) {
    throw invalid('O Spotify não disponibilizou as músicas desta playlist. Torne a lista pública ou importe um arquivo CSV/JSON.');
  }
  const entries = entity.trackList.slice(0, MAX_PLAYLIST_ENTRIES).map(sourceEntry);
  return { provider: 'spotify', sourceUrl: canonical, title: playlistText(entity.title || entity.name, 160) || 'Playlist do Spotify',
    entries, total: null, truncated: false, countVerified: false, warnings: [] };
}

export function parseSpotifyTrack(html, sourceUrl) {
  const canonical = spotifyTrackUrl(sourceUrl);
  if (!canonical) throw invalid('Use o link de uma música do Spotify.');
  const id = canonical.split('/').pop();
  let entity;
  try { entity = JSON.parse(script(html, '__NEXT_DATA__')).props.pageProps.state.data.entity; } catch {}
  if (!entity || (entity.type && entity.type !== 'track') || (entity.id && entity.id !== id)) {
    throw invalid('O Spotify não disponibilizou os dados desta música. Confira se o link é público e tente novamente.');
  }
  const entry = sourceEntry({ ...entity, uri: entity.uri || 'spotify:track:' + id }, 0);
  if (entry.status === 'error') throw invalid('Esta faixa não contém uma música identificável.');
  return { provider: 'spotify', sourceUrl: canonical, title: entry.title + ' — ' + entry.artist,
    entries: [entry], total: 1, truncated: false, countVerified: true, warnings: [] };
}

export async function spotifyTrackInfo(value, options = {}) {
  const sourceUrl = spotifyTrackUrl(value);
  if (!sourceUrl) throw invalid('Use um link de música do Spotify no formato open.spotify.com/track/…');
  const fetcher = options.fetch || fetch;
  const embedUrl = sourceUrl.replace('/track/', '/embed/track/');
  const [embed, page] = await Promise.allSettled([
    publicHtml(embedUrl, fetcher, options.signal),
    publicHtml(sourceUrl, fetcher, options.signal)
  ]);
  const candidates = [embed, page].filter(item => item.status === 'fulfilled').map(item => item.value);
  let lastError;
  for (const html of candidates) {
    try { return parseSpotifyTrack(html, sourceUrl); } catch (error) { lastError = error; }
  }
  if (lastError) throw lastError;
  throw invalid('Não foi possível ler esta música do Spotify.');
}

export async function spotifyPlaylistInfo(value, options = {}) {
  const sourceUrl = spotifyPlaylistUrl(value);
  if (!sourceUrl) throw invalid('Use um link de playlist do Spotify no formato open.spotify.com/playlist/…');
  const fetcher = options.fetch || fetch;
  const [embed, page] = await Promise.allSettled([
    publicHtml(sourceUrl.replace('/playlist/', '/embed/playlist/'), fetcher, options.signal),
    publicHtml(sourceUrl, fetcher, options.signal)
  ]);
  if (embed.status !== 'fulfilled') throw embed.reason;
  const info = parseSpotifyEmbed(embed.value, sourceUrl);
  if (page.status === 'fulfilled') {
    try {
      const initial = JSON.parse(Buffer.from(script(page.value, 'initialState'), 'base64').toString('utf8'));
      const total = initial.entities.items['spotify:playlist:' + sourceUrl.split('/').pop()].content.totalCount;
      if (Number.isSafeInteger(total) && total >= info.entries.length) { info.total = total; info.countVerified = true; }
    } catch {}
  }
  info.truncated = info.total !== null ? info.total > info.entries.length : true;
  info.unread = info.total === null ? null : info.total - info.entries.length;
  if (info.unread > 0) info.warnings.push('A playlist tem ' + info.total + ' músicas, mas o link público expõe ' + info.entries.length + '. As outras ' + info.unread + ' não foram lidas. Para trazer a lista completa, importe um arquivo CSV/JSON.');
  else if (!info.countVerified) info.warnings.push('Não foi possível confirmar o tamanho completo da playlist. Foram lidas ' + info.entries.length + ' entradas; o Spotify pode limitar a lista pública. Use CSV/JSON para importar uma lista completa.');
  return info;
}

function csvRows(text) {
  const first = text.split(/\r?\n/, 1)[0];
  const delimiter = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else if (!quoted && field) throw invalid('CSV inválido: confira as aspas e as colunas.');
      else quoted = !quoted;
    } else if (!quoted && (char === delimiter || char === '\n' || char === '\r')) {
      row.push(field); field = '';
      if (char !== delimiter) {
        if (row.some(value => value.trim())) rows.push(row);
        row = []; if (char === '\r' && text[i + 1] === '\n') i++;
      }
    } else field += char;
    if (rows.length > MAX_PLAYLIST_ENTRIES + 1) throw invalid('Importe até ' + MAX_PLAYLIST_ENTRIES + ' músicas por arquivo. Divida a playlist em arquivos menores.');
  }
  if (quoted) throw invalid('CSV inválido: uma coluna ficou com aspas abertas.');
  row.push(field); if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

function normalized(value) { return playlistText(value, 1000).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }

export function spotifyFileInfo(text, options = {}) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_FILE) throw invalid('Use um arquivo CSV/JSON de até 1,5 MB.');
  text = text.replace(/^\uFEFF/, '').trim();
  let title = playlistText(options.name, 160) || 'Playlist importada';
  let tracks;
  if (/^[\[{]/.test(text)) {
    let data;
    try { data = JSON.parse(text); } catch { throw invalid('Arquivo JSON inválido.'); }
    const lists = Array.isArray(data.playlists) ? data.playlists : [data];
    if (lists.length > 200) throw invalid('Use um arquivo com até 200 playlists.');
    if (lists.length > 1 && options.playlistIndex === undefined) return { choices: lists.map((item, index) => ({ index, name: playlistText(item?.name, 160) || 'Playlist ' + (index + 1), count: Array.isArray(item?.items) ? item.items.length : 0 })) };
    const index = options.playlistIndex ?? 0;
    if (!Number.isInteger(index) || index < 0 || index >= lists.length) throw invalid('Escolha uma playlist válida do arquivo.');
    const list = lists[index];
    title = playlistText(list.name, 160) || title;
    if (!Array.isArray(list?.items)) throw invalid('Use o JSON de playlists exportado dos seus dados do Spotify.');
    tracks = list.items.map(item => ({ ...(item?.track || {}), uri: item?.track?.trackUri || '', unsupported: !item?.track }));
  } else {
    const rows = csvRows(text);
    if (rows.length < 2) throw invalid('O CSV precisa ter cabeçalho e pelo menos uma música.');
    const headers = rows.shift().map(normalized);
    const column = aliases => headers.findIndex(header => aliases.includes(header));
    const titleColumn = column(['track name', 'track title', 'title', 'titulo', 'name', 'musica', 'nome da musica', 'nome da faixa']);
    const artistColumn = column(['artist name s', 'artist name', 'artists', 'artist', 'artista', 'artistas']);
    const uriColumn = column(['track uri', 'spotify uri', 'uri', 'track url', 'spotify url']);
    const msColumn = column(['duration ms', 'duration milliseconds']);
    const secondsColumn = column(['duration s', 'duration seconds', 'duration']);
    const albumColumn = column(['album name', 'album']);
    if (titleColumn < 0 || artistColumn < 0) throw invalid('O CSV precisa das colunas Track Name e Artist Name(s), ou Título e Artista.');
    tracks = rows.map(row => {
      const uri = row[uriColumn]?.trim() || '';
      const id = uri.match(/^(?:spotify:track:|https:\/\/open\.spotify\.com\/track\/)([A-Za-z0-9]{22})(?:\?.*)?$/)?.[1];
      return { title: row[titleColumn], artist: row[artistColumn], albumName: row[albumColumn], uri: id ? 'spotify:track:' + id : '',
        duration: msColumn >= 0 ? Number(row[msColumn]) : secondsColumn >= 0 ? Number(row[secondsColumn]) * 1000 : 0 };
    });
  }
  if (!tracks.length || tracks.length > MAX_PLAYLIST_ENTRIES) throw invalid('Use um arquivo com 1 a ' + MAX_PLAYLIST_ENTRIES + ' músicas.');
  const entries = tracks.map(sourceEntry);
  return { provider: 'spotify', sourceUrl: '', title, entries, total: entries.length, truncated: false, countVerified: true, unread: 0, warnings: [] };
}

const VERSIONS = ['live', 'ao vivo', 'cover', 'karaoke', 'instrumental', 'remix', 'acoustic', 'acustico', 'slowed', 'sped up', 'nightcore', '8d'];
function contains(haystack, needle) { return (' ' + haystack + ' ').includes(' ' + needle + ' '); }

/** Conservative matching: title, primary artist, version and duration must agree. */
export function matchSpotifyTrack(entry, candidates) {
  const title = normalized(entry.title), artist = normalized(String(entry.artist || '').split(/[,;]| feat\.? | & /i)[0]);
  if (!title || !artist) return null;
  const titleWords = title.split(' ');
  const found = [];
  for (const item of candidates || []) {
    if (!validVideoId(item.videoId)) continue;
    const candidateTitle = normalized(item.title), channel = normalized(item.channel || item.artist);
    if (!contains(channel, artist) && !contains(candidateTitle, artist)) continue;
    if (VERSIONS.some(version => contains(candidateTitle + ' ' + channel, version) !== contains(title + ' ' + artist, version))) continue;
    const words = new Set(candidateTitle.split(' '));
    const hits = titleWords.filter(word => words.has(word)).length;
    if (hits / titleWords.length < 0.9 || (titleWords.length < 3 && !contains(candidateTitle, title))) continue;
    const expected = Number(entry.duration), actual = Number(item.duration);
    if (!(actual > 0) || actual > 3600) continue;
    const difference = expected > 0 ? Math.abs(actual - expected) : 0;
    if (expected > 0 && difference > Math.max(15, expected * 0.12)) continue;
    const score = hits / titleWords.length * 10 + (contains(channel, artist) ? 3 : 0)
      + (contains(candidateTitle, title) ? 2 : 0) - difference / Math.max(1, expected) - Math.max(0, words.size - titleWords.length) * 0.02;
    found.push({ item, score });
  }
  found.sort((a, b) => b.score - a.score);
  return found[0]?.item || null;
}
