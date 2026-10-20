const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be']);

function invalid(message) { return Object.assign(new Error(message), { statusCode: 400 }); }
function youtubeUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\x00-\x20\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || !YOUTUBE_HOSTS.has(url.hostname) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) return null;
    return url;
  } catch { return null; }
}

export function validVideoId(value) { return typeof value === 'string' && VIDEO_ID.test(value); }
export function parseYouTubeVideoId(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (validVideoId(text)) return text;
  const url = youtubeUrl(text);
  if (!url) return null;
  const id = /^(?:www\.)?youtu\.be$/.test(url.hostname) ? url.pathname.slice(1).split('/')[0]
    : url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|embed|live)\//.test(url.pathname) ? url.pathname.split('/')[2] : null;
  return validVideoId(id) ? id : null;
}

export function validateImportInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('Informe uma música ou uma busca.');
  if (input.videoId !== undefined && !validVideoId(input.videoId)) throw invalid('Identificador de vídeo inválido.');
  if (input.url !== undefined && !parseYouTubeVideoId(input.url)) throw invalid('Use um link de vídeo válido do YouTube.');
  if (input.query !== undefined && (typeof input.query !== 'string' || input.query.trim().length > 512 || /[\x00-\x1f]/.test(input.query))) throw invalid('Busca inválida.');
  if (!input.videoId && !input.url && !input.query?.trim()) throw invalid('Informe um link ou uma busca.');
  if (input.meta !== undefined && (!input.meta || typeof input.meta !== 'object' || Array.isArray(input.meta))) throw invalid('Metadados inválidos.');
  return input;
}

export function validatedPlaylistUrl(value) {
  const url = youtubeUrl(typeof value === 'string' ? value.trim() : value);
  const list = url?.searchParams.get('list');
  if (!url || !['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(url.hostname)
      || !['/playlist', '/watch'].includes(url.pathname) || !/^[A-Za-z0-9_-]{10,128}$/.test(list || '')) throw invalid('Use um link de playlist válido do YouTube.');
  return 'https://www.youtube.com/playlist?list=' + encodeURIComponent(list);
}

export function safeThumbnailUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
        || !['i.ytimg.com', 'img.youtube.com'].includes(url.hostname) || !/^\/(?:vi|vi_webp)\/[A-Za-z0-9_-]{11}\/[a-zA-Z0-9_.-]+$/.test(url.pathname)) return null;
    url.search = ''; url.hash = '';
    return url.href;
  } catch { return null; }
}
