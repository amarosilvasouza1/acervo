import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './library.js';
import { playlistText, spotifyPlaylistUrl } from './spotify-playlist.js';
import { validVideoId, safeThumbnailUrl } from './input-policy.js';

const FILE = path.join(DATA_DIR, 'playlists.json');
let cache = null;
let writing = Promise.resolve();

async function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(FILE, 'utf8'));
  } catch (e) {
    cache = { version: 1, playlists: [] };
  }
  if (!Array.isArray(cache.playlists)) cache.playlists = [];
  return cache;
}

async function save() {
  writing = writing.catch(() => {}).then(async function () {
    await mkdir(DATA_DIR, { recursive: true });
    const tmp = FILE + '.tmp';
    await writeFile(tmp, JSON.stringify(cache, null, 2), 'utf8');
    await rename(tmp, FILE);
  });
  return writing;
}

export async function all() {
  const data = await load();
  return data.playlists.slice();
}

export async function get(id) {
  const data = await load();
  return data.playlists.find(function (item) { return item.id === id; }) || null;
}

export async function create(input) {
  const data = await load();
  if (!Array.isArray(input.entries) || input.entries.length > 1000) throw new Error('Use uma playlist com até 1000 entradas.');
  const entries = (Array.isArray(input.entries) ? input.entries : []).filter(function (entry) {
    return entry && (validVideoId(entry.videoId) || (input.provider === 'spotify' && entry.source === 'spotify'));
  }).map(function (entry) {
    return {
      id: crypto.randomUUID(),
      videoId: validVideoId(entry.videoId) ? entry.videoId : null,
      title: playlistText(entry.title) || 'Sem título',
      artist: playlistText(entry.artist, 256),
      album: playlistText(entry.album),
      duration: Number(entry.duration) || 0,
      thumbnail: safeThumbnailUrl(entry.thumbnail) || '',
      source: input.provider === 'spotify' ? 'spotify' : 'youtube',
      sourceId: /^[A-Za-z0-9]{22}$/.test(entry.sourceId || '') ? entry.sourceId : '',
      sourceUrl: /^[A-Za-z0-9]{22}$/.test(entry.sourceId || '') ? 'https://open.spotify.com/track/' + entry.sourceId : '',
      status: entry.status === 'error' ? 'error' : 'pending',
      errorCode: entry.status === 'error' ? 'unsupported' : null,
      error: entry.status === 'error' ? playlistText(entry.error, 400) : null,
      trackId: null, jobId: null
    };
  });
  const playlist = {
    id: crypto.randomUUID(),
    name: playlistText(input.name, 160) || 'Playlist importada',
    provider: input.provider === 'spotify' ? 'spotify' : 'youtube',
    sourceUrl: spotifyPlaylistUrl(input.sourceUrl) || (typeof input.sourceUrl === 'string' && /^https:\/\/(?:www\.)?youtube\.com\/playlist\?list=[A-Za-z0-9_-]+$/.test(input.sourceUrl) ? input.sourceUrl : ''),
    sourceTotal: Number.isSafeInteger(input.total) ? input.total : entries.length,
    countVerified: input.countVerified !== false,
    truncated: !!input.truncated,
    warnings: (Array.isArray(input.warnings) ? input.warnings : []).map(value => playlistText(value, 600)).filter(Boolean).slice(0, 5),
    createdAt: new Date().toISOString(),
    entries: entries
  };
  data.playlists.unshift(playlist);
  data.playlists = data.playlists.slice(0, 200);
  await save();
  return playlist;
}

export async function updateEntry(playlistId, entryId, patch) {
  const playlist = await get(playlistId);
  const entry = playlist?.entries.find(item => item.id === entryId);
  if (!entry) return null;
  const allowed = ['status', 'errorCode', 'error', 'videoId', 'thumbnail', 'jobId', 'trackId', 'stage', 'progress'];
  for (const key of allowed) if (Object.hasOwn(patch, key)) entry[key] = patch[key];
  playlist.updatedAt = new Date().toISOString();
  await save();
  return entry;
}

export async function remove(id) {
  const data = await load();
  const before = data.playlists.length;
  data.playlists = data.playlists.filter(function (item) { return item.id !== id; });
  if (data.playlists.length !== before) { await save(); return true; }
  return false;
}
