import http from 'node:http';
import https from 'node:https';
import { writeFile, mkdir, unlink, rename, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

import { searchYouTube, downloadAudio, parseVideoId, playlistInfo, publicVideoMetadata } from './lib/yt.js';
import { probe, measureLoudness, normalizeTo, extractFeatures, loudnessOf } from './lib/audio.js';
import * as Library from './lib/library.js';
import * as Playlists from './lib/playlists.js';
import { runRadio, validateRadioInput } from './lib/radio.js';
import { createConnectManager } from './lib/connect.js';
import { createCatalogService } from './lib/catalog.js';
import { loadTlsIdentity } from './lib/tls.js';
import { openSafeFile } from './lib/safe-files.js';
import { sendFile } from './lib/file-response.js';
import { validVideoId, validateImportInput, safeThumbnailUrl } from './lib/input-policy.js';
import { resolveTrackMetadata } from './lib/track-metadata.js';
import { createInternetRelay } from './lib/internet-relay.js';
import { createBoreRelay } from './lib/bore-relay.js';
import { acquireServerInstance } from './lib/server-instance.js';
import { createPlaylistImports } from './lib/playlist-imports.js';
import { createCoverDisplay } from './lib/cover-crop.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA = Library.DATA_DIR;
const TRACKS = path.join(DATA, 'tracks');
const COVERS = path.join(DATA, 'covers');
const coverDisplay = createCoverDisplay({ covers: COVERS, cache: path.join(DATA, 'cover-display') });
const TMP = path.join(DATA, 'tmp');
const TRASH = path.join(DATA, 'trash');
const ANDROID_VERSION = { versionCode: 21, versionName: '1.6.0' };
const ANDROID_APK = path.join(ROOT, 'releases', 'acervo-' + ANDROID_VERSION.versionName + '.apk');
const PORT = Number(process.env.PORT) || 4310;
const HOST = process.env.ACERVO_HOST || '0.0.0.0';
const MODE = process.env.ACERVO_MODE || 'local';
const HTTP_HOST = process.env.ACERVO_HTTP_HOST || (MODE === 'local' ? '127.0.0.1' : HOST);
const HTTPS_HOST = process.env.ACERVO_HTTPS_HOST || HOST;
if (!['local', 'cloud'].includes(MODE)) throw new Error('ACERVO_MODE deve ser local ou cloud.');
const SECURE_PORT = Number(process.env.ACERVO_HTTPS_PORT || PORT + 1);
if (MODE === 'local' && (!Number.isInteger(SECURE_PORT) || SECURE_PORT < 1 || SECURE_PORT > 65535 || SECURE_PORT === PORT)) {
  throw new Error('ACERVO_HTTPS_PORT deve ser uma porta válida diferente da porta HTTP.');
}
const releaseInstance = acquireServerInstance({ directory: DATA, port: PORT });
process.once('exit', releaseInstance);
process.once('SIGINT', () => process.exit(0));
process.once('SIGTERM', () => process.exit(0));
const tlsIdentity = MODE === 'local' ? await loadTlsIdentity({ directory: path.join(DATA, 'identity') }) : null;
let internetRelay = null;
let boreRelay = null;
let internetOperation = false;
function relaySnapshot() {
  return (boreRelay?.isEnabled() ? boreRelay : internetRelay)?.snapshot()
    || { state: 'offline', verified: false };
}
const connect = createConnectManager({ port: PORT, getTrack: Library.get, mode: MODE,
  ...(tlsIdentity ? { secureTransport: { port: SECURE_PORT, pin: tlsIdentity.spkiPin, requireClientIdentity: true,
    deviceFile: path.join(DATA, 'paired-phone.json'), endpointFile: path.join(DATA, 'connect-network.json'), publicEndpoint: process.env.ACERVO_PUBLIC_ENDPOINT },
    internetRelayStatus: relaySnapshot } : {}),
  publicOrigin: process.env.ACERVO_PUBLIC_ORIGIN, adminPassword: process.env.ACERVO_ADMIN_PASSWORD,
  trustTailscale: process.env.ACERVO_TRUST_TAILSCALE === '1',
  stateFile: MODE === 'cloud' ? path.join(DATA, 'connect-sessions.json') : undefined });
if (tlsIdentity) internetRelay = createInternetRelay({ securePort: SECURE_PORT, stateFile: path.join(DATA, 'internet-relay.json') });
if (tlsIdentity) boreRelay = createBoreRelay({ securePort: SECURE_PORT, stateFile: path.join(DATA, 'bore-relay.json') });
const catalog = createCatalogService({ getTracks: Library.all, getHistory: Library.history });

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
const mcpPending = [];
let mcpPlayerState = null;
function mcpLocalRequest(req) {
  const raw = String(req.headers.host || '').toLowerCase();
  const host = raw.replace(/^\[|\]$/g, '').replace(/:\d+$/, '');
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}
function mcpString(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function mcpCommandFromInput(input) {
  const action = mcpString(input && input.action, 20);
  if (!['play', 'pause', 'resume', 'stop', 'next', 'previous', 'seek'].includes(action)) {
    const error = new Error('Ação MCP inválida.');
    error.statusCode = 400;
    throw error;
  }
  const command = { id: crypto.randomUUID(), action, createdAt: new Date().toISOString() };
  if (action === 'play') {
    const trackId = mcpString(input.trackId, 200);
    if (!trackId) { const error = new Error('Informe trackId para tocar.'); error.statusCode = 400; throw error; }
    const rawQueue = Array.isArray(input.queue) ? input.queue : [trackId];
    const queue = [];
    for (const value of rawQueue) {
      const id = mcpString(value, 200);
      if (id && !queue.includes(id)) queue.push(id);
      if (queue.length >= 100) break;
    }
    if (!queue.includes(trackId)) queue.unshift(trackId);
    command.trackId = trackId;
    command.queue = queue;
    command.qi = Math.max(0, Math.min(queue.length - 1, Number.isInteger(input.qi) ? input.qi : queue.indexOf(trackId)));
  }
  if (action === 'seek') {
    command.position = Math.max(0, Math.min(86400, Number(input.position) || 0));
  }
  return command;
}

const jobWaiters = new Map();
const queue = [];
const DOWNLOAD_CONCURRENCY = Math.max(1, Math.min(3, Math.floor(Number(process.env.ACERVO_DOWNLOAD_CONCURRENCY) || 2)));
let activeDownloads = 0;
const activeByVideo = new Map();
const searchCache = new Map();
const discoverCache = new Map();
const playlistImports = createPlaylistImports({ store: Playlists, youtubeInfo: playlistInfo, search: searchYouTube,
  enqueue: enqueueImport, waitForJob: waitForJob, getJob: id => jobs.get(id), getTracks: Library.all, concurrency: DOWNLOAD_CONCURRENCY });

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

function pickThumb(info) {
  const thumbs = Array.isArray(info.thumbnails) ? info.thumbnails.slice() : [];
  thumbs.sort(function (a, b) { return (b.width || 0) - (a.width || 0); });
  return thumbs.map(function (thumb) { return safeThumbnailUrl(thumb?.url); }).find(Boolean)
    || (validVideoId(info.id) ? 'https://i.ytimg.com/vi/' + info.id + '/hqdefault.jpg' : null);
}

async function fetchCover(videoId, url) {
  const target = safeThumbnailUrl(url);
  if (!validVideoId(videoId) || !target) return null;
  const out = path.join(COVERS, videoId + '.jpg');
  if (existsSync(out)) return out;
  try {
    const response = await fetch(target, { signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok || !/^image\//i.test(response.headers.get('content-type') || '')) {
      await response.body?.cancel(); return null;
    }
    const maxBytes = 5 * 1024 * 1024;
    if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); return null; }
    const chunks = [];
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > maxBytes) return null;
      chunks.push(chunk);
    }
    const buf = Buffer.concat(chunks, length);
    if (buf.length < 500) return null;
    await writeFile(out, buf, { flag: 'wx' });
    return out;
  } catch (e) {
    return null;
  }
}

function bumpJob(job, patch) {
  Object.assign(job, patch, { updatedAt: Date.now() });
  if (job.status === 'done' || job.status === 'error') {
    for (const resolve of jobWaiters.get(job.id) || []) resolve(job);
    jobWaiters.delete(job.id);
  }
}

function waitForJob(job) {
  if (job.status === 'done' || job.status === 'error') return Promise.resolve(job);
  return new Promise(resolve => {
    if (!jobWaiters.has(job.id)) jobWaiters.set(job.id, []);
    jobWaiters.get(job.id).push(resolve);
  });
}

function enqueueImport(input, options = {}) {
  validateImportInput(input);
  const knownId = input.videoId || parseVideoId(input.url || '');
  if (knownId) {
    const active = jobs.get(activeByVideo.get(knownId));
    if (active && ['queued', 'working'].includes(active.status)) return active;
  }
  const job = {
    id: crypto.randomUUID(),
    status: 'queued',
    stage: 'Na fila',
    progress: 0,
    message: 'Aguardando na fila',
    input: input,
    catalogMetadata: options.catalogMetadata || null,
    videoId: input.videoId || null,
    trackId: null,
    error: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  jobs.set(job.id, job);
  if (knownId) { job.videoId = knownId; activeByVideo.set(knownId, job.id); }
  queue.push(job);
  pump();
  return job;
}

async function pump() {
  while (activeDownloads < DOWNLOAD_CONCURRENCY && queue.length) {
    const job = queue.shift();
    activeDownloads++;
    processImport(job).catch(err => {
      bumpJob(job, { status: 'error', stage: 'Falhou', error: String(err.message || err), message: 'Nao foi possivel concluir' });
    }).finally(() => {
      activeDownloads--;
      if (job.videoId && activeByVideo.get(job.videoId) === job.id) activeByVideo.delete(job.videoId);
      pump();
    });
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
  if (!validVideoId(videoId)) throw new Error('Identificador de vídeo inválido.');
  job.videoId = videoId;

  const existing = await Library.findByVideo(videoId);
  if (existing) {
    bumpJob(job, { status: 'done', stage: 'No acervo', progress: 100, trackId: existing.id, message: 'Essa faixa ja esta no acervo' });
    return;
  }
  if (activeByVideo.has(videoId) && activeByVideo.get(videoId) !== job.id) {
    const shared = jobs.get(activeByVideo.get(videoId));
    if (shared && ['queued', 'working'].includes(shared.status)) {
      // A search can resolve to the same video as another already running job.
      if (shared.status === 'queued') {
        const index = queue.indexOf(shared); if (index >= 0) queue.splice(index, 1);
        bumpJob(shared, { status: 'working', stage: 'Compartilhando download', message: 'A mesma música já está sendo preparada' });
        job.catalogMetadata ||= shared.catalogMetadata;
        meta = shared.input.meta || meta;
        waitForJob(job).then(completed => bumpJob(shared, { status: completed.status, stage: completed.stage,
          progress: completed.progress, trackId: completed.trackId, track: completed.track, error: completed.error, message: completed.message }));
      } else {
        const completed = await waitForJob(shared);
        if (completed.status === 'error') throw new Error(completed.error);
        bumpJob(job, { status: 'done', stage: 'No acervo', progress: 100, trackId: completed.trackId, track: completed.track, message: 'Faixa adicionada ao acervo' });
        return;
      }
    }
  }
  activeByVideo.set(videoId, job.id);

  const workDir = path.join(TMP, videoId + '-' + Date.now());
  await mkdir(workDir, { recursive: true });
  bumpJob(job, { stage: 'Baixando', progress: 12, message: 'Baixando o áudio e seus metadados' });
  const downloaded = await downloadAudio(videoId, workDir, function (pct) {
    const p = Math.max(0, Math.min(100, pct));
    bumpJob(job, { stage: 'Baixando', progress: Math.round(12 + p * 0.5), message: 'Baixando áudio: ' + Math.round(p) + '%' });
  });
  let info = downloaded.info;
  if (!info && !meta?.title) try { info = await publicVideoMetadata(videoId); } catch {}
  const metadata = resolveTrackMetadata(info, meta);
  if (job.catalogMetadata) {
    metadata.title = job.catalogMetadata.title;
    metadata.artist = job.catalogMetadata.artist;
    if (job.catalogMetadata.album) metadata.album = job.catalogMetadata.album;
  }
  const { title, artist, duration, genre, album, year, tags } = metadata;
  const thumb = pickThumb({ id: videoId, thumbnails: [
    ...(Array.isArray(info?.thumbnails) ? info.thumbnails : []),
    ...(Array.isArray(meta?.thumbnails) ? meta.thumbnails : []),
    ...(meta?.thumbnail ? [{ url: meta.thumbnail }] : [])
  ] });

  bumpJob(job, { stage: 'Normalizando', progress: 65, message: 'Medindo e normalizando em -14 LUFS' });
  const measured = await measureLoudness(downloaded.file);
  const outFile = path.join(TRACKS, videoId + '.mp3');
  const finalLoudness = await normalizeTo(downloaded.file, outFile, measured, -14);

  bumpJob(job, { stage: 'Analisando', progress: 84, message: 'Extraindo andamento, energia e brilho' });
  const [features, probed, coverPath] = await Promise.all([extractFeatures(outFile), probe(outFile), fetchCover(videoId, thumb)]);

  bumpJob(job, { stage: 'Capa', progress: 93, message: 'Salvando capa' });

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
    sourceTitle: metadata.sourceTitle,
    channel: metadata.channel,
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

function fileId(pathname, prefix) {
  const id = pathname.slice(prefix.length);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw Object.assign(new Error('Identificador inválido.'), { statusCode: 400 });
  return id;
}

async function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname); }
  catch { throw Object.assign(new Error('Caminho inválido.'), { statusCode: 400 }); }
  if (/[\x00-\x1f\\:]/.test(rel) || rel.split('/').includes('..')) {
    throw Object.assign(new Error('Acesso ao arquivo recusado.'), { statusCode: 403 });
  }
  const target = path.join(PUBLIC, rel);
  const ext = path.extname(target).toLowerCase();
  return sendFile(req, res, PUBLIC, target, MIME[ext] || 'application/octet-stream', {
    'Cache-Control': ext === '.html' || ext === '.js' || ext === '.css' ? 'no-cache' : 'public, max-age=3600'
  });
}

async function handleRequest(req, res) {
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    let url;
    try { url = new URL(req.url, 'http://127.0.0.1'); }
    catch { return sendJson(res, 400, { error: 'Endereço inválido.' }); }
    const pathname = url.pathname;
    if (req.method === 'GET' && pathname === '/healthz') return sendJson(res, 200, { ok: true });
    const connection = connect.authorize(req, pathname);
    connect.trackResponse(req, res, connection);
    if (pathname === '/api/connect/endpoint' && (internetOperation || internetRelay?.isBusy() || boreRelay?.isBusy())) {
      return sendJson(res, 409, { error: 'O encaminhador está sendo atualizado. Aguarde antes de mudar o endereço.' });
    }
    if (pathname.startsWith('/api/connect/internet/')) {
      if (!connection.local || !internetRelay) return sendJson(res, 403, { error: 'Configure o acesso pela internet no próprio PC que hospeda o Acervo.' });
      if (req.method === 'GET' && pathname === '/api/connect/internet/status') {
        return sendJson(res, 200, { snapshot: connect.snapshot(connection), relay: relaySnapshot() });
      }
      if (req.method === 'POST' && ['/api/connect/internet/enable', '/api/connect/internet/disable'].includes(pathname)) {
        if (internetOperation || internetRelay.isBusy() || boreRelay.isBusy()) return sendJson(res, 409, { error: 'A conexão pela internet já está sendo atualizada. Aguarde.' });
        const body = await readBody(req);
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) {
          return sendJson(res, 400, { error: 'Esta ação não recebe endereços nem comandos externos.' });
        }
        const security = connect.snapshot(connection).security;
        if (pathname.endsWith('/enable') && !security.publicEndpointEditable) {
          return sendJson(res, 409, { error: 'O endereço público está definido por ACERVO_PUBLIC_ENDPOINT. Remova essa variável e reinicie para usar o encaminhador gerenciado.' });
        }
        internetOperation = true;
        try {
          const configure = endpoint => security.publicEndpointEditable
            && connect.snapshot(connection).security.publicEndpoint !== endpoint
            ? connect.updateEndpoint(connection, { publicEndpoint: endpoint }) : undefined;
          const options = () => ({ pcPin: tlsIdentity.spkiPin,
            currentEndpoint: connect.snapshot(connection).security.publicEndpoint, configure });
          let relay;
          if (pathname.endsWith('/enable')) {
            if (boreRelay.isEnabled()) relay = await boreRelay.enable(options());
            else {
              try { relay = await internetRelay.enable(options()); }
              catch { relay = null; }
              if (!relay || relay.state !== 'online' || relay.verified !== true) {
                // Preserve end-to-end mTLS when the first relay cannot publish DNS.
                await internetRelay.disable(options());
                relay = await boreRelay.enable(options());
              }
            }
          } else {
            await boreRelay.disable(options());
            await internetRelay.disable(options());
            relay = relaySnapshot();
          }
          return sendJson(res, 200, { snapshot: connect.snapshot(connection), relay });
        } catch (error) {
          return sendJson(res, error.statusCode || 503, { error: error.message,
            ...(error.actionUrl === 'https://tailscale.com/s/no-funnel' ? { actionUrl: error.actionUrl } : {}) });
        } finally { internetOperation = false; }
      }
      return sendJson(res, 405, { error: 'Método não permitido.' });
    }
    if (await connect.handle(req, res, pathname, connection, readBody, sendJson)) return;
    if (req.method === 'GET' && (pathname === '/api/explore' || pathname === '/api/artist')) {
      const controller = new AbortController();
      const cancel = function () { if (!res.writableEnded) controller.abort(); };
      req.once('aborted', cancel);
      res.once('close', cancel);
      try {
        const data = pathname === '/api/artist'
          ? await catalog.artist(url.searchParams.get('name') || '', { signal: controller.signal })
          : await catalog.explore(url.searchParams.get('section') || 'recommended', { signal: controller.signal });
        connect.authorize(req, pathname);
        if (!res.destroyed) sendJson(res, 200, data);
      } finally {
        req.removeListener('aborted', cancel);
        res.removeListener('close', cancel);
      }
      return;
    }
    if (req.method === 'GET' && pathname === '/api/app/version') {
      let apk;
      let handle;
      try {
        handle = await openSafeFile(path.join(ROOT, 'releases'), ANDROID_APK);
        apk = await handle.readFile();
      } catch { apk = null; }
      finally { if (handle) await handle.close(); }
      if (!apk) return sendJson(res, 404, { error: 'Nenhuma atualização Android disponível neste servidor.' });
      return sendJson(res, 200, { ...ANDROID_VERSION, downloadUrl: '/downloads/acervo.apk', sha256: crypto.createHash('sha256').update(apk).digest('hex') });
    }
    if (req.method === 'GET' && pathname === '/downloads/acervo.apk') {
      return await sendFile(req, res, path.join(ROOT, 'releases'), ANDROID_APK, 'application/vnd.android.package-archive', {
        'Content-Disposition': 'attachment; filename="acervo-' + ANDROID_VERSION.versionName + '.apk"',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
    }
    if (pathname.startsWith('/api/mcp/')) {
      if (!mcpLocalRequest(req)) return sendJson(res, 403, { error: 'MCP disponível apenas no host local.' });
      if (req.method === 'GET' && pathname === '/api/mcp/status') {
        return sendJson(res, 200, { pending: mcpPending.length, first: mcpPending[0] ? mcpPending[0].action : null, player: mcpPlayerState });
      }
      if (req.method === 'POST' && pathname === '/api/mcp/state') {
        try {
          const input = await readBody(req);
          mcpPlayerState = {
            playing: !!input.playing,
            trackId: mcpString(input.trackId, 200) || null,
            position: Math.max(0, Math.min(86400, Number(input.position) || 0)),
            duration: Math.max(0, Math.min(86400, Number(input.duration) || 0)),
            queue: Math.max(0, Math.min(100, Number(input.queue) || 0)),
            qi: Math.max(-1, Math.min(100, Number(input.qi) || 0)),
            updatedAt: new Date().toISOString()
          };
          return sendJson(res, 200, { ok: true });
        } catch (error) {
          return sendJson(res, 400, { error: String(error.message || error) });
        }
      }
      if (req.method === 'GET' && pathname === '/api/mcp/command') {
        return sendJson(res, 200, { command: mcpPending[0] || null, pending: mcpPending.length });
      }
      if (req.method === 'POST' && pathname === '/api/mcp/command') {
        try {
          const input = await readBody(req);
          if (mcpPending.length >= 25) return sendJson(res, 429, { error: 'Muitos comandos MCP pendentes. Abra a aba Web do Acervo.' });
          const command = mcpCommandFromInput(input);
          mcpPending.push(command);
          return sendJson(res, 202, { command, pending: mcpPending.length });
        } catch (error) {
          return sendJson(res, error.statusCode || 400, { error: String(error.message || error) });
        }
      }
      if (req.method === 'POST' && pathname === '/api/mcp/ack') {
        try {
          const input = await readBody(req);
          const id = mcpString(input && input.id, 100);
          const index = mcpPending.findIndex((command) => command.id === id);
          if (index >= 0) mcpPending.splice(index, 1);
          return sendJson(res, 200, { ok: true, removed: index >= 0, pending: mcpPending.length });
        } catch (error) {
          return sendJson(res, 400, { error: String(error.message || error) });
        }
      }
      return sendJson(res, 404, { error: 'Rota MCP não encontrada.' });
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
      const job = enqueueImport(body);
      return sendJson(res, 202, { jobId: job.id, status: job.status });
    }
    if (req.method === 'POST' && pathname === '/api/playlist/resolve') {
      const body = await readBody(req);
      try {
        return sendJson(res, 200, await playlistImports.preview(body));
      } catch (error) {
        return sendJson(res, 422, { error: String(error.message || error) });
      }
    }
    if (req.method === 'POST' && pathname === '/api/playlists') {
      const body = await readBody(req);
      try {
        const playlist = await Playlists.create({ name: body.name, sourceUrl: body.sourceUrl, entries: body.entries });
        return sendJson(res, 201, { playlist: playlist });
      } catch (error) {
        return sendJson(res, 422, { error: String(error.message || error) });
      }
    }
    if (req.method === 'POST' && pathname === '/api/playlists/import') {
      const body = await readBody(req);
      try {
        return sendJson(res, 202, await playlistImports.importList(body));
      } catch (error) {
        return sendJson(res, 422, { error: String(error.message || error) });
      }
    }
    if (req.method === 'POST' && pathname.startsWith('/api/playlists/') && pathname.endsWith('/import')) {
      try { return sendJson(res, 202, await playlistImports.start(pathname.split('/')[3])); }
      catch (error) { return sendJson(res, error.statusCode || 422, { error: String(error.message || error) }); }
    }
    if (req.method === 'GET' && /^\/api\/playlists\/[^/]+\/report$/.test(pathname)) {
      try { return sendJson(res, 200, await playlistImports.report(pathname.split('/')[3])); }
      catch (error) { return sendJson(res, error.statusCode || 422, { error: String(error.message || error) }); }
    }
    if (req.method === 'GET' && pathname === '/api/playlists') {
      return sendJson(res, 200, { playlists: await playlistImports.all() });
    }
    if (req.method === 'DELETE' && pathname.startsWith('/api/playlists/')) {
      const id = pathname.split('/').pop();
      const removed = await Playlists.remove(id);
      return sendJson(res, removed ? 200 : 404, { removed: removed });
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
      const id = fileId(pathname, '/api/track/');
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
      const id = fileId(pathname, '/api/stream/');
      const file = path.join(TRACKS, id + '.mp3');
      return await sendFile(req, res, TRACKS, file, 'audio/mpeg');
    }
    if (req.method === 'GET' && pathname.startsWith('/api/cover/')) {
      const id = fileId(pathname, '/api/cover/');
      const display = await coverDisplay(id);
      return await sendFile(req, res, display.root, display.file, 'image/jpeg');
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
      if (pathname === '/' && /AcervoAndroid/i.test(ua)) return await serveStatic(req, res, '/index.html');
      if (pathname === '/' || pathname === '/escolher' || pathname === '/escolher/') return await serveStatic(req, res, '/escolher.html');
      if (pathname === '/pc' || pathname === '/pc/') return await serveStatic(req, res, '/index.html');
      if (pathname === '/web' || pathname === '/web/') return await serveStatic(req, res, '/index.html');
      if (pathname === '/web.html') { res.writeHead(302, { Location: '/web' + url.search, 'Cache-Control': 'no-store' }); return res.end(); }
      return await serveStatic(req, res, pathname);
    }
    sendJson(res, 405, { error: 'Metodo nao permitido.' });
  } catch (err) {
    if (res.headersSent) return res.end();
    sendJson(res, err.statusCode || 500, { error: String(err.message || err) });
  }
}

const server = http.createServer(handleRequest);
if (tlsIdentity) {
  // Private client identities are pinned by Connect after a one-time QR claim.
  // TLS validates possession; Connect validates the exact enrolled certificate.
  const secureServer = https.createServer({ key: tlsIdentity.key, cert: tlsIdentity.cert, minVersion: 'TLSv1.2', requestCert: true, rejectUnauthorized: false }, handleRequest);
  await new Promise((resolve, reject) => {
    secureServer.once('error', reject);
    secureServer.listen(SECURE_PORT, HTTPS_HOST, resolve);
  });
  console.log('Conexão criptografada do APK disponível na porta ' + SECURE_PORT + '. Pareie pelo QR code no computador.');
}

server.listen(PORT, HTTP_HOST, function () {
  console.log(MODE === 'cloud' ? 'Acervo na nuvem: ' + process.env.ACERVO_PUBLIC_ORIGIN : 'Acervo rodando em http://127.0.0.1:' + PORT);
  if (boreRelay?.isEnabled()) {
    const owner = { local: true };
    const security = connect.snapshot(owner).security;
    if (security.publicEndpointEditable && security.publicEndpoint === boreRelay.snapshot().publicEndpoint) {
      internetOperation = true;
      boreRelay.resume({ pcPin: tlsIdentity.spkiPin, currentEndpoint: security.publicEndpoint,
        configure: endpoint => connect.snapshot(owner).security.publicEndpoint !== endpoint
          ? connect.updateEndpoint(owner, { publicEndpoint: endpoint }) : undefined })
        .catch(() => console.warn('O acesso pela internet ainda não foi confirmado. Confira Dispositivos no PC.'))
        .finally(() => { internetOperation = false; });
    }
  }
});
