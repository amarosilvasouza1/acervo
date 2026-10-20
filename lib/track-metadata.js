const TITLE_LIMIT = 512;
const ARTIST_LIMIT = 256;
const TITLE_PLACEHOLDERS = new Set(['faixa sem titulo', 'musica sem titulo', 'sem titulo', 'untitled', 'no title', 'unknown title', 'unknown track']);
const ARTIST_PLACEHOLDERS = new Set(['artista desconhecido', 'artista desconhecida', 'unknown artist', 'unknown uploader', 'unknown channel', 'artista nao informado', 'sem artista']);

function record(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function text(value, limit) {
  return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit).trim() : '';
}
function normalized(value) { return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase(); }
function titleText(value) {
  const result = text(value, TITLE_LIMIT);
  return TITLE_PLACEHOLDERS.has(normalized(result)) ? '' : result;
}
function artistText(value) {
  const result = text(value, ARTIST_LIMIT).replace(/\s*-\s*Topic$/i, '').replace(/\s*VEVO$/i, '').trim();
  return ARTIST_PLACEHOLDERS.has(normalized(result)) ? '' : result;
}
function channelText(value) {
  const result = text(value, ARTIST_LIMIT);
  return ARTIST_PLACEHOLDERS.has(normalized(result)) ? '' : result;
}
function first(candidates, read) {
  for (const candidate of candidates) { const result = read(candidate); if (result) return result; }
  return '';
}
function duration(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()))) return 0;
  const result = Number(value);
  return Number.isFinite(result) && result > 0 && result <= 86400 ? result : 0;
}
function year(value) {
  const candidate = typeof value === 'number' && Number.isInteger(value) ? String(value) : text(value, 16);
  return /^(?:19|20)\d{2}$/.test(candidate) ? candidate : '';
}

export function cleanTitle(value) {
  let title = text(value, TITLE_LIMIT);
  title = title.replace(/\((?:official\s*(?:music\s*)?video|official\s*audio|official|lyric\s*video|lyrics|audio|video|visualizer|hd|hq|4k|explicit)\)/ig, ' ');
  title = title.replace(/\[(?:official\s*(?:music\s*)?video|official\s*audio|official|lyric\s*video|lyrics|audio|video|visualizer|hd|hq|4k|explicit)\]/ig, ' ');
  title = title.replace(/\s*[-|]\s*(?:official\s*(?:music\s*)?video|official\s*audio|video\s*oficial|audio\s*oficial).*$/i, ' ');
  return title.replace(/\s{2,}/g, ' ').replace(/[\s\-|]+$/g, '').trim();
}

export function splitArtistTitle(rawTitle) {
  const title = cleanTitle(rawTitle);
  const match = title.match(/^(.{2,60}?)\s+[-\u2013]\s+(.{2,140})$/);
  return match ? { artist: match[1].trim(), title: match[2].trim() } : { artist: '', title };
}

/** Prefer structured track metadata, then the exact selected result, before uploader labels. */
export function resolveTrackMetadata(info, meta) {
  const source = record(info);
  const selected = record(meta);
  const rawTitle = first([source.track, source.title, selected.track, selected.title], titleText);
  const parsed = splitArtistTitle(rawTitle);
  const knownArtist = first([source.artist, source.creator, selected.artist,
    source.channel, source.uploader, selected.channel], artistText);
  const parsedArtist = artistText(parsed.artist);
  const artist = knownArtist || parsedArtist;
  // A story, character or video-series prefix is not evidence of a musician's identity.
  // Remove that prefix only when it matches known metadata, or no other identity exists.
  const splitTitle = parsedArtist && (!knownArtist || normalized(parsedArtist) === normalized(knownArtist));
  const tags = Array.isArray(source.tags) ? source.tags : Array.isArray(selected.tags) ? selected.tags : [];
  const uploadDate = text(source.upload_date, 16);
  return {
    title: titleText(splitTitle ? parsed.title : cleanTitle(rawTitle)) || 'Faixa sem titulo',
    artist: artist || 'Artista desconhecido',
    sourceTitle: first([source.title, source.track, selected.title, selected.track], titleText) || 'Faixa sem titulo',
    channel: first([source.channel, source.uploader, selected.channel], channelText),
    duration: duration(source.duration) || duration(selected.duration),
    album: first([source.album, selected.album], value => text(value, 256)),
    genre: first([source.genre, selected.genre], value => text(value, 128)),
    year: first([source.release_year, source.year, selected.release_year, selected.year,
      /^\d{8}$/.test(uploadDate) ? uploadDate.slice(0, 4) : ''], year),
    tags: tags.map(value => text(value, 80)).filter(Boolean).slice(0, 8)
  };
}

/** Metadata repair never replaces confirmed labels or changes playback history/audio fields. */
export function metadataRepairPatch(existing, metadata) {
  const current = record(existing);
  const candidate = record(metadata);
  const patch = {};
  for (const [key, read] of [['title', titleText], ['artist', artistText], ['sourceTitle', titleText], ['channel', channelText]]) {
    const value = read(candidate[key]);
    if (!read(current[key]) && value) patch[key] = value;
  }
  return patch;
}
