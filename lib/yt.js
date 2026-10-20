import { execFile } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { validVideoId, parseYouTubeVideoId, validatedPlaylistUrl } from './input-policy.js';

const PYTHON = process.env.ACERVO_PYTHON || 'python';
const COOKIES = process.env.ACERVO_COOKIES_BROWSER ? ['--cookies-from-browser', process.env.ACERVO_COOKIES_BROWSER] : [];

function cleanError(stderr, code) {
  const lines = String(stderr || '').split(/\r?\n/).filter(Boolean);
  const err = lines.filter(function (l) { return /^ERROR:/i.test(l.trim()); }).pop();
  if (err) return err.replace(/^ERROR:\s*/i, '');
  return lines.slice(-2).join(' ').trim() || ('yt-dlp terminou com codigo ' + code);
}

function friendlyDownloadError(err) {
  const msg = String((err && err.message) || err || '');
  if (/bot|Sign in to confirm|confirm you/i.test(msg)) {
    return 'O YouTube pediu verificacao anti-bot para este video. Tente outro resultado ou configure ACERVO_COOKIES_BROWSER (ex.: chrome).';
  }
  if (/Requested format is not available/i.test(msg)) {
    return 'Este video nao oferece um formato de audio acessivel. Tente outro resultado.';
  }
  if (/unavailable|Private video|has been removed|not available/i.test(msg)) {
    return 'Este video nao esta disponivel no YouTube.';
  }
  return msg.slice(0, 320);
}

export function runYt(args, options) {
  const opts = options || {};
  return new Promise(function (resolve, reject) {
    const child = execFile(PYTHON, ['-m', 'yt_dlp'].concat(args), {
      maxBuffer: 128 * 1024 * 1024,
      timeout: opts.timeout || 180000,
      signal: opts.signal,
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', function (chunk) {
      const text = chunk.toString();
      stdout += text;
      if (opts.onLine) text.split(/\r?\n/).forEach(function (line) { if (line) opts.onLine(line); });
    });
    child.stderr.on('data', function (chunk) {
      const text = chunk.toString();
      stderr += text;
      if (opts.onLine) text.split(/\r?\n/).forEach(function (line) { if (line) opts.onLine(line); });
    });
    child.on('error', reject);
    child.on('close', function (code) {
      if (code === 0) resolve({ stdout: stdout, stderr: stderr });
      else reject(new Error(cleanError(stderr, code)));
    });
  });
}

export function parseVideoId(input) {
  return parseYouTubeVideoId(input);
}

export async function searchYouTube(query, limit, options = {}) {
  const n = Math.max(1, Math.min(24, limit || 12));
  const result = await runYt(['ytsearch' + n + ':' + query, '--flat-playlist', '--dump-single-json', '--no-warnings'], { timeout: options.timeout || 90000, signal: options.signal });
  let data;
  try { data = JSON.parse(result.stdout); } catch (e) { throw new Error('Resposta invalida do yt-dlp ao buscar.'); }
  const entries = Array.isArray(data.entries) ? data.entries : [];
  return entries.filter(function (e) { return e && /^[A-Za-z0-9_-]{11}$/.test(e.id); }).map(function (e) {
    return {
      videoId: e.id,
      title: e.title || 'Sem titulo',
      channel: e.channel || e.uploader || '',
      duration: Number(e.duration) || 0,
      views: Number(e.view_count) || 0,
      thumbnail: 'https://i.ytimg.com/vi/' + e.id + '/mqdefault.jpg',
      url: 'https://www.youtube.com/watch?v=' + e.id
    };
  });
}

export async function playlistInfo(url) {
  const target = validatedPlaylistUrl(url);
  if (!/^https?:\/\//i.test(target)) throw new Error('Informe um link completo do YouTube.');
  const result = await runYt(['--flat-playlist', '--dump-single-json', '--no-warnings'].concat(COOKIES, [target]), { timeout: 120000 });
  let data;
  try { data = JSON.parse(result.stdout); } catch (e) { throw new Error('Nao foi possivel ler a playlist.'); }
  const raw = Array.isArray(data.entries) ? data.entries : [];
  const entries = raw.filter(function (entry) {
    return entry && /^[A-Za-z0-9_-]{11}$/.test(String(entry.id || ''));
  }).map(function (entry) {
    const thumbs = Array.isArray(entry.thumbnails) ? entry.thumbnails : [];
    const thumb = (thumbs[thumbs.length - 1] && thumbs[thumbs.length - 1].url) || ('https://i.ytimg.com/vi/' + entry.id + '/mqdefault.jpg');
    return {
      videoId: entry.id,
      title: entry.title || 'Sem titulo',
      artist: entry.uploader || entry.channel || '',
      duration: Number(entry.duration) || 0,
      thumbnail: thumb
    };
  });
  if (!entries.length) throw new Error('Nenhuma musica encontrada nessa playlist.');
  return {
    title: data.title || data.playlist_title || 'Playlist do YouTube',
    entries: entries.slice(0, 100),
    total: entries.length,
    truncated: entries.length > 100
  };
}

export async function videoInfo(videoId) {
  if (!validVideoId(videoId)) throw new Error('Identificador de vídeo inválido.');
  try {
    const result = await runYt(['-J', '--no-warnings', '--no-playlist'].concat(COOKIES, ['https://www.youtube.com/watch?v=' + videoId]), { timeout: 90000 });
    const info = JSON.parse(result.stdout);
    if (info && typeof info.title === 'string' && info.title.trim()) return info;
  } catch {}
  return publicVideoMetadata(videoId);
}

// The official oEmbed response can preserve title/channel when extraction fails.
export async function publicVideoMetadata(videoId, options = {}) {
  if (!validVideoId(videoId)) throw new Error('Identificador de vídeo inválido.');
  const fetcher = options.fetch || fetch;
  const response = await fetcher('https://www.youtube.com/oembed?format=json&url='
    + encodeURIComponent('https://www.youtube.com/watch?v=' + videoId), { signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (!response.ok) { await response.body?.cancel(); throw new Error('Não foi possível consultar o título e o canal desta música.'); }
  const chunks = []; let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > 65536) throw new Error('Resposta de metadados inválida.');
    chunks.push(chunk);
  }
  const info = JSON.parse(Buffer.concat(chunks, length).toString('utf8'));
  if (!info || typeof info.title !== 'string' || !info.title.trim()
      || typeof info.author_name !== 'string' || !info.author_name.trim()) throw new Error('Resposta de metadados inválida.');
  return { id: videoId, title: info.title.slice(0, 512), channel: info.author_name.slice(0, 256),
    thumbnails: typeof info.thumbnail_url === 'string' ? [{ url: info.thumbnail_url }] : [] };
}

export async function downloadAudio(videoId, outDir, onProgress) {
  const attempts = [
    { extra: [], format: 'bestaudio/best' },
    { extra: ['--extractor-args', 'youtube:player_client=android'], format: 'bestaudio/best' },
    { extra: ['--extractor-args', 'youtube:player_client=web_embedded'], format: 'best' },
    { extra: ['--extractor-args', 'youtube:player_client=android_vr'], format: 'bestaudio/best' }
  ];
  let lastError = null;
  for (let i = 0; i < attempts.length; i++) {
    const dir = path.join(outDir, 'try' + i);
    await mkdir(dir, { recursive: true }).catch(function () {});
    const pattern = path.join(dir, videoId + '.%(ext)s');
    try {
      await runYt([
        '-f', attempts[i].format,
        '--no-playlist',
        '--no-warnings',
        '--newline',
        '--retries', '2',
        '--fragment-retries', '3',
        '--concurrent-fragments', '4',
        '-o', pattern
      ].concat(attempts[i].extra, COOKIES, ['https://www.youtube.com/watch?v=' + videoId]), {
        timeout: 240000,
        onLine: function (line) {
          const m = String(line).match(/\[download\]\s+([\d.]+)%/);
          if (m && onProgress) onProgress(Number(m[1]), i);
        }
      });
      const found = readdirSync(dir).filter(function (f) { return f.indexOf(videoId + '.') === 0; });
      if (found.length) return path.join(dir, found[0]);
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(friendlyDownloadError(lastError));
}
