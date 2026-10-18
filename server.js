import http from 'node:http';
import { readFile, writeFile, mkdir, stat, unlink, rename, readdir } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

import { searchYouTube, videoInfo, downloadAudio, parseVideoId } from './lib/yt.js';
import { probe, measureLoudness, normalizeTo, extractFeatures, loudnessOf } from './lib/audio.js';
import * as Library from './lib/library.js';
import { runRadio, validateRadioInput } from './lib/radio.js';
import { createConnectManager } from './lib/connect.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA = Library.DATA_DIR;
const TRACKS = path.join(DATA, 'tracks');
const COVERS = path.join(DATA, 'covers');
const TMP = path.join(DATA, 'tmp');
const TRASH = path.join(DATA, 'trash');
const ANDROID_VERSION = { versionCode: 6, versionName: '1.3.2' };
const ANDROID_APK = path.join(ROOT, 'releases', 'acervo-' + ANDROID_VERSION.versionName + '.apk');
const PORT = Number(process.env.PORT) || 4310;
const HOST = process.env.ACERVO_HOST || '0.0.0.0';
const MODE = process.env.ACERVO_MODE || 'local';
if (!['local', 'cloud'].includes(MODE)) throw new Error('ACERVO_MODE deve ser local ou cloud.');
const connect = createConnectManager({ port: PORT, getTrack: Library.get, mode: MODE,
  publicOrigin: process.env.ACERVO_PUBLIC_ORIGIN, adminPassword: process.env.ACERVO_ADMIN_PASSWORD,
  trustTailscale: process.env.ACERVO_TRUST_TAILSCALE === '1',
  stateFile: MODE === 'cloud' ? path.join(DATA, 'connect-sessions.json') : undefined });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2'
};

const jobs = new Map();
const queue = [];
let running = false;
const activeByVideo = new Map();
const searchCache = new Map();
const discoverCache = new Map();

for (const dir of [DATA, TRACKS, COVERS, TMP, TRASH]) {
  await mkdir(dir, { recursive: true }).catch(function () {});
}

function sendJson(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    let size = 0;
    const chunks = [];
    req.on('data', function (c) {
      size += c.length;
      if (size > 2 * 1024 * 1024) { reject(new Error('Corpo da requisicao muito grande.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('JSON invalido.')); }
    });
    req.on('error', reject);
  });
}

function cleanTitle(value) {
  let t = String(value || '').trim();
  t = t.replace(/\((?:official\s*(?:music\s*)?video|official\s*audio|official|lyric\s*video|lyrics|audio|video|visualizer|hd|hq|4k|explicit)\)/ig, ' ');
  t = t.replace(/\[(?:official\s*(?:music\s*)?video|official\s*audio|official|lyric\s*video|lyrics|audio|video|visualizer|hd|hq|4k|explicit)\]/ig, ' ');
  t = t.replace(/\s*[-|]\s*(?:official\s*(?:music\s*)?video|official\s*audio|video\s*oficial|audio\s*oficial).*$/i, ' ');
  return t.replace(/\s{2,}/g, ' ').replace(/[\s\-|]+$/g, '').trim();
}

function splitArtistTitle(rawTitle) {
  const t = cleanTitle(rawTitle);
  const m = t.match(/^(.{2,60}?)\s+[-\u2013]\s+(.{2,140})$/);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { artist: '', title: t };
}

function pickThumb(info) {
  const thumbs = Array.isArray(info.thumbnails) ? info.thumbnails.slice() : [];
  thumbs.sort(function (a, b) { return (b.width || 0) - (a.width || 0); });
  return (thumbs[0] && thumbs[0].url) || ('https://i.ytimg.com/vi/' + info.id + '/hqdefault.jpg');
}

async function fetchCover(videoId, url) {
  const out = path.join(COVERS, videoId + '.jpg');
  if (existsSync(out)) return out;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return null;
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length < 500) return null;
    await writeFile(out, buf);
    return out;
  } catch (e) {
    return null;
  }
}

function bumpJob(job, patch) {
  Object.assign(job, patch, { updatedAt: Date.now() });
}

function enqueueImport(input) {
  const job = {
    id: crypto.randomUUID(),
    status: 'queued',
    stage: 'Na fila',
    progress: 0,
    message: 'Aguardando na fila',
    input: input,
    videoId: input.videoId || null,
    trackId: null,
    error: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  jobs.set(job.id, job);
  queue.push(job);
  pump();
  return job;
}

async function pump() {
  if (running) return;
  const job = queue.shift();
  if (!job) return;
  running = true;
  try {
    await processImport(job);
  } catch (err) {
    bumpJob(job, { status: 'error', stage: 'Falhou', error: String(err.message || err), message: 'Nao foi possivel concluir' });
  } finally {
    running = false;
    if (job.videoId) activeByVideo.delete(job.videoId);
    pump();
  }
}

async function processImport(job) {
  bumpJob(job, { status: 'working', stage: 'Identificando', progress: 3, message: 'Lendo o video' });
  let videoId = job.input.videoId || parseVideoId(job.input.url || job.input.query || '');
  let meta = job.input.meta || null;
  if (!videoId) {
    const query = String(job.input.query || '').trim();
    if (!query) throw new Error('Informe um link ou uma busca.');
    const found = await searchYouTube(query, 1);
    if (!found.length) throw new Error('Nenhum video encontrado para essa busca.');
    videoId = found[0].videoId;
    meta = found[0];
  }
  job.videoId = videoId;

  const existing = await Library.findByVideo(videoId);
  if (existing) {
    bumpJob(job, { status: 'done', stage: 'No acervo', progress: 100, trackId: existing.id, message: 'Essa faixa ja esta no acervo' });
    return;
  }
  if (activeByVideo.has(videoId) && activeByVideo.get(videoId) !== job.id) {
    throw new Error('Essa faixa ja esta sendo baixada.');
  }
  activeByVideo.set(videoId, job.id);

  bumpJob(job, { stage: 'Metadados', progress: 8, message: 'Lendo titulo, artista e capa' });
  let info = null;
  try { info = await videoInfo(videoId); } catch (e) { info = null; }
  const source = info || meta || {};
  const rawTitle = source.track || source.title || (meta && meta.title) || 'Faixa sem titulo';
  const parsed = splitArtistTitle(rawTitle);
  let artist = source.artist || source.creator || source.uploader || (meta && meta.channel) || '';
  artist = String(artist).replace(/\s*-\s*Topic$/i, '').replace(/\s*VEVO$/i, '').trim();
  let title = parsed.title;
  if (!artist && parsed.artist) artist = parsed.artist;
  if (!artist) artist = 'Artista desconhecido';
  if (!title) title = rawTitle;
  const duration = Number(source.duration) || (meta && meta.duration) || 0;
  const genre = source.genre || '';
  const album = source.album || '';
  const year = source.release_year || (source.upload_date ? String(source.upload_date).slice(0, 4) : '');
  const tags = Array.isArray(source.tags) ? source.tags.slice(0, 8) : [];
  const thumb = pickThumb(Object.assign({ id: videoId }, source));

  const workDir = path.join(TMP, videoId + '-' + Date.now());
  await mkdir(workDir, { recursive: true });
  bumpJob(job, { stage: 'Baixando', progress: 12, message: 'Baixando o audio do YouTube' });
  const downloaded = await downloadAudio(videoId, workDir, function (pct) {
    const p = Math.max(0, Math.min(100, pct));
    bumpJob(job, { stage: 'Baixando', progress: Math.round(12 + p * 0.5), message: 'Baixando audio: ' + Math.round(p) + '%' });
  });

  bumpJob(job, { stage: 'Normalizando', progress: 65, message: 'Medindo e normalizando em -14 LUFS' });
  const measured = await measureLoudness(downloaded);
  const outFile = path.join(TRACKS, videoId + '.mp3');
  const finalLoudness = await normalizeTo(downloaded, outFile, measured, -14);

  bumpJob(job, { stage: 'Analisando', progress: 84, message: 'Extraindo andamento, energia e brilho' });
  const features = await extractFeatures(outFile);
  const probed = await probe(outFile);

  bumpJob(job, { stage: 'Capa', progress: 93, message: 'Salvando capa' });
  const coverPath = await fetchCover(videoId, thumb);

  const track = {
    id: videoId,
    videoId: videoId,
    title: title,
    artist: artist,
    album: album,
    genre: genre,
    year: year,
    tags: tags,
    duration: probed.duration || duration,
    sourceUrl: 'https://www.youtube.com/watch?v=' + videoId,
    sourceTitle: rawTitle,
    channel: (meta && meta.channel) || source.uploader || '',
    thumbnail: coverPath ? '/api/cover/' + videoId : thumb,
    hasCover: Boolean(coverPath),
    loudness: {
      i: isFinite(finalLoudness.i) ? Math.round(finalLoudness.i * 10) / 10 : -14,
      tp: isFinite(finalLoudness.tp) ? Math.round(finalLoudness.tp * 10) / 10 : -1,
      lra: isFinite(finalLoudness.lra) ? Math.round(finalLoudness.lra * 10) / 10 : null,
      target: -14,
      measured: isFinite(measured.input_i) ? Math.round(measured.input_i * 10) / 10 : null
    },
    features: features,
    bitrate: probed.bitrate || 0,
    plays: 0,
    addedAt: new Date().toISOString()
  };
  await Library.add(track);
  connect.publishLibraryChange('imported', track.id);
  await removeDir(workDir).catch(function () {});
  bumpJob(job, { status: 'done', stage: 'No acervo', progress: 100, trackId: track.id, message: 'Faixa adicionada ao acervo', track: track });
}

async function removeDir(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(function () { return []; });
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) await removeDir(p);
    else await unlink(p).catch(function () {});
  }
  await import('node:fs/promises').then(function (fs) { return fs.rmdir(dir); }).catch(function () {});
}

function similarity(a, b) {
  const fa = a.features || {};
  const fb = b.features || {};
  const reasons = [];
  let bpmD = 0.5, energyD = 0.5, centroidD = 0.5, zcrD = 0.5;
  if (fa.bpm && fb.bpm) {
    bpmD = Math.min(1, Math.abs(fa.bpm - fb.bpm) / 55);
    if (bpmD < 0.12) reasons.push('andamento parecido');
  }
  if (isFinite(fa.energy) && isFinite(fb.energy)) {
    energyD = Math.min(1, Math.abs(fa.energy - fb.energy) / 0.45);
    if (energyD < 0.2) reasons.push('energia parecida');
  }
  if (isFinite(fa.centroid) && isFinite(fb.centroid)) {
    centroidD = Math.min(1, Math.abs(fa.centroid - fb.centroid) / 0.5);
  }
  if (isFinite(fa.zcr) && isFinite(fb.zcr)) {
    zcrD = Math.min(1, Math.abs(fa.zcr - fb.zcr) / 0.6);
  }
  let score = 1 - (0.34 * bpmD + 0.31 * energyD + 0.2 * centroidD + 0.15 * zcrD);
  if ((a.artist || '').toLowerCase() === (b.artist || '').toLowerCase()) {
    score += 0.1;
    reasons.push('mesmo artista');
  }
  if (a.genre && b.genre && a.genre.toLowerCase() === b.genre.toLowerCase()) {
    score += 0.05;
    reasons.push('mesmo genero');
  }
  return {
    score: Math.max(35, Math.min(99, Math.round(score * 100))),
    reasons: reasons.slice(0, 3)
  };
}

async function recommendFor(id, limit) {
  const all = await Library.all();
  const seed = all.find(function (t) { return t.id === id; });
  if (!seed) return null;
  return all
    .filter(function (t) { return t.id !== id; })
    .map(function (t) {
      const sim = similarity(seed, t);
      return { track: t, score: sim.score, reasons: sim.reasons };
    })
    .sort(function (a, b) { return b.score - a.score; })
    .slice(0, limit || 8);
}

async function relatedArtists(artist) {
  const search = await fetch('https://api.deezer.com/search/artist?q=' + encodeURIComponent(artist) + '&limit=1', { signal: AbortSignal.timeout(8000) });
  const data = await search.json();
  const found = data && data.data && data.data[0];
  if (!found) return [];
  const rel = await fetch('https://api.deezer.com/artist/' + found.id + '/related?limit=8', { signal: AbortSignal.timeout(8000) });
  const relData = await rel.json();
  return (relData.data || []).map(function (a) { return a.name; });
}

async function discoverFor(id) {
  const all = await Library.all();
  const seed = all.find(function (t) { return t.id === id; });
  if (!seed) return null;
  const cacheKey = id;
  const cached = discoverCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.data;
  let names = [];
  try { names = await relatedArtists(seed.artist); } catch (e) { names = []; }
  if (!names.length) names = [seed.artist + ' mix', seed.artist + ' radio'];
  const inLibrary = new Set(all.map(function (t) { return t.videoId; }));
  const out = [];
  const used = new Set();
  for (const name of names.slice(0, 4)) {
    let results = [];
    try { results = await searchYouTube(name + ' music', 3); } catch (e) { continue; }
    for (const r of results) {
      if (used.has(r.videoId) || inLibrary.has(r.videoId)) continue;
      used.add(r.videoId);
      out.push(Object.assign({}, r, { because: name }));
      if (out.length >= 8) break;
    }
    if (out.length >= 8) break;
  }
  discoverCache.set(cacheKey, { at: Date.now(), data: out });
  return out;
}

function streamFile(req, res, file, type) {
  stat(file).then(function (info) {
    const total = info.size;
    const range = req.headers.range;
    if (range) {
      const m = String(range).match(/bytes=(\d*)-(\d*)/);
      if (m) {
        const start = m[1] ? parseInt(m[1], 10) : 0;
        const end = m[2] ? parseInt(m[2], 10) : Math.min(total - 1, start + 1024 * 1024);
        if (start >= total) {
          res.writeHead(416, { 'Content-Range': 'bytes */' + total });
          return res.end();
        }
        res.writeHead(206, {
          'Content-Type': type,
          'Content-Length': end - start + 1,
          'Content-Range': 'bytes ' + start + '-' + end + '/' + total,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, no-store'
        });
        createReadStream(file, { start: start, end: end }).pipe(res);
        return;
      }
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': total,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store'
    });
    createReadStream(file).pipe(res);
  }).catch(function () {
    sendJson(res, 404, { error: 'Arquivo nao encontrado.' });
  });
}

async function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  rel = decodeURIComponent(rel);
  const target = path.normalize(path.join(PUBLIC, rel));
  if (!target.startsWith(PUBLIC)) { res.writeHead(403); return res.end('Forbidden'); }
  try {
    const info = await stat(target);
    if (info.isDirectory()) throw new Error('dir');
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': ext === '.html' || ext === '.js' || ext === '.css' ? 'no-cache' : 'public, max-age=3600'
    });
    createReadStream(target).pipe(res);
  } catch (e) {
    if (req.method === 'GET' && (req.headers.accept || '').includes('text/html')) {
      const index = path.join(PUBLIC, 'index.html');
      const info = await stat(index).catch(function () { return null; });
      if (info) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': info.size });
        return createReadStream(index).pipe(res);
      }
    }
    sendJson(res, 404, { error: 'Nao encontrado.' });
  }
}

const server = http.createServer(async function (req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const pathname = url.pathname;
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (req.method === 'GET' && pathname === '/healthz') return sendJson(res, 200, { ok: true });
    const connection = connect.authorize(req, pathname);
    if (await connect.handle(req, res, pathname, connection, readBody, sendJson)) return;
    if (req.method === 'GET' && pathname === '/api/app/version') {
      const apk = await readFile(ANDROID_APK).catch(function () { return null; });
      if (!apk) return sendJson(res, 404, { error: 'Nenhuma atualização Android disponível neste servidor.' });
      return sendJson(res, 200, { ...ANDROID_VERSION, downloadUrl: '/downloads/acervo.apk', sha256: crypto.createHash('sha256').update(apk).digest('hex') });
    }
    if (req.method === 'GET' && pathname === '/downloads/acervo.apk') {
      const info = await stat(ANDROID_APK).catch(function () { return null; });
      if (!info || !info.isFile()) return sendJson(res, 404, { error: 'O APK ainda não foi compilado neste computador.' });
      res.writeHead(200, {
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Disposition': 'attachment; filename="acervo-' + ANDROID_VERSION.versionName + '.apk"',
        'Content-Length': info.size,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      createReadStream(ANDROID_APK).pipe(res);
      return;
    }
    if (req.method === 'GET' && pathname === '/api/health') {
      const all = await Library.all();
      return sendJson(res, 200, { ok: true, tracks: all.length, port: PORT, version: '1.0.0' });
    }
    if (req.method === 'GET' && pathname === '/api/search') {
      const q = String(url.searchParams.get('q') || '').trim();
      if (!q) return sendJson(res, 400, { error: 'Busca vazia.' });
      const cached = searchCache.get(q.toLowerCase());
      if (cached && Date.now() - cached.at < 5 * 60 * 1000) {
        return sendJson(res, 200, { query: q, results: cached.results, cached: true });
      }
      const results = await searchYouTube(q, 14);
      searchCache.set(q.toLowerCase(), { at: Date.now(), results: results });
      return sendJson(res, 200, { query: q, results: results });
    }
    if (req.method === 'POST' && pathname === '/api/radio') {
      const input = validateRadioInput(await readBody(req));
      const tracks = await Library.all();
      const history = await Library.history();
      const controller = new AbortController();
      const disconnect = function () { controller.abort(); };
      req.once('aborted', disconnect);
      res.once('close', disconnect);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.flushHeaders();
      const heartbeat = setInterval(function () { if (!res.destroyed) res.write(': buscando\n\n'); }, 15000);
      try {
        await runRadio(input, {
          tracks, history, signal: controller.signal,
          onEvent: function (event, data) {
            if (!res.destroyed && !res.writableEnded) res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
          }
        });
      } finally {
        clearInterval(heartbeat);
        req.removeListener('aborted', disconnect);
        res.removeListener('close', disconnect);
        if (!res.destroyed) res.end();
      }
      return;
    }
    if (req.method === 'POST' && pathname === '/api/import') {
      const body = await readBody(req);
      if (!body.videoId && !body.url && !body.query) return sendJson(res, 400, { error: 'Informe um link ou uma busca.' });
      const job = enqueueImport(body);
      return sendJson(res, 202, { jobId: job.id, status: job.status });
    }
    if (req.method === 'GET' && pathname.startsWith('/api/jobs/')) {
      const id = pathname.split('/').pop();
      const job = jobs.get(id);
      if (!job) return sendJson(res, 404, { error: 'Tarefa nao encontrada.' });
      return sendJson(res, 200, job);
    }
    if (req.method === 'GET' && pathname === '/api/library') {
      const tracks = (await Library.all()).slice().sort(function (a, b) {
        return new Date(b.addedAt || 0) - new Date(a.addedAt || 0);
      });
      return sendJson(res, 200, { tracks: tracks, stats: await Library.stats() });
    }
    if (req.method === 'GET' && pathname === '/api/stats') {
      return sendJson(res, 200, await Library.stats());
    }
    if (req.method === 'GET' && pathname.startsWith('/api/track/')) {
      const id = pathname.split('/')[3];
      const track = await Library.get(id);
      if (!track) return sendJson(res, 404, { error: 'Faixa nao encontrada.' });
      return sendJson(res, 200, track);
    }
    if (req.method === 'DELETE' && pathname.startsWith('/api/track/')) {
      const id = pathname.split('/')[3];
      const track = await Library.get(id);
      if (!track) return sendJson(res, 404, { error: 'Faixa nao encontrada.' });
      const dest = path.join(TRASH, id + '-' + Date.now());
      await mkdir(dest, { recursive: true }).catch(function () {});
      await rename(path.join(TRACKS, id + '.mp3'), path.join(dest, id + '.mp3')).catch(function () {});
      await rename(path.join(COVERS, id + '.jpg'), path.join(dest, id + '.jpg')).catch(function () {});
      await writeFile(path.join(dest, 'track.json'), JSON.stringify(track, null, 2), 'utf8').catch(function () {});
      await Library.remove(id);
      connect.publishLibraryChange('removed', id);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'POST' && pathname.startsWith('/api/track/') && pathname.endsWith('/play')) {
      const id = pathname.split('/')[3];
      const track = await Library.recordPlay(id);
      if (!track) return sendJson(res, 404, { error: 'Faixa nao encontrada.' });
      connect.publishLibraryChange('play', id);
      return sendJson(res, 200, { ok: true, plays: track.plays || 0, lastPlayedAt: track.lastPlayedAt });
    }
    if (req.method === 'GET' && pathname.startsWith('/api/stream/')) {
      const id = pathname.split('/')[3];
      const file = path.join(TRACKS, id + '.mp3');
      return streamFile(req, res, file, 'audio/mpeg');
    }
    if (req.method === 'GET' && pathname.startsWith('/api/cover/')) {
      const id = pathname.split('/')[3];
      const file = path.join(COVERS, id + '.jpg');
      if (!existsSync(file)) return sendJson(res, 404, { error: 'Sem capa.' });
      return streamFile(req, res, file, 'image/jpeg');
    }
    if (req.method === 'GET' && pathname.startsWith('/api/recommend/')) {
      const id = pathname.split('/')[3];
      const list = await recommendFor(id, Number(url.searchParams.get('limit')) || 8);
      if (!list) return sendJson(res, 404, { error: 'Faixa nao encontrada.' });
      return sendJson(res, 200, { seed: id, items: list });
    }
    if (req.method === 'GET' && pathname.startsWith('/api/discover/')) {
      const id = pathname.split('/')[3];
      const list = await discoverFor(id);
      if (!list) return sendJson(res, 404, { error: 'Faixa nao encontrada.' });
      return sendJson(res, 200, { seed: id, items: list });
    }
    if (req.method === 'GET') {
      const ua = String(req.headers['user-agent'] || '');
      if (pathname === '/' && /AcervoAndroid/i.test(ua)) return serveStatic(req, res, '/index.html');
      if (pathname === '/' || pathname === '/escolher' || pathname === '/escolher/') return serveStatic(req, res, '/escolher.html');
      if (pathname === '/pc' || pathname === '/pc/') return serveStatic(req, res, '/index.html');
      if (pathname === '/web' || pathname === '/web/') return serveStatic(req, res, '/web.html');
      return serveStatic(req, res, pathname);
    }
    sendJson(res, 405, { error: 'Metodo nao permitido.' });
  } catch (err) {
    if (res.headersSent) return res.end();
    sendJson(res, err.statusCode || 500, { error: String(err.message || err) });
  }
});

server.listen(PORT, HOST, function () {
  console.log(MODE === 'cloud' ? 'Acervo na nuvem: ' + process.env.ACERVO_PUBLIC_ORIGIN : 'Acervo rodando em http://127.0.0.1:' + PORT);
});
