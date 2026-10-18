import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './library.js';

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
  writing = writing.then(async function () {
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
  const entries = (Array.isArray(input.entries) ? input.entries : []).filter(function (entry) {
    return entry && /^[A-Za-z0-9_-]{11}$/.test(String(entry.videoId || ''));
  }).map(function (entry) {
    return {
      videoId: entry.videoId,
      title: String(entry.title || 'Sem titulo').slice(0, 220),
      artist: String(entry.artist || '').slice(0, 160),
      duration: Number(entry.duration) || 0,
      thumbnail: String(entry.thumbnail || '')
    };
  });
  const playlist = {
    id: crypto.randomUUID(),
    name: String(input.name || 'Playlist do YouTube').slice(0, 160),
    sourceUrl: String(input.sourceUrl || ''),
    createdAt: new Date().toISOString(),
    entries: entries
  };
  data.playlists.unshift(playlist);
  data.playlists = data.playlists.slice(0, 200);
  await save();
  return playlist;
}

export async function remove(id) {
  const data = await load();
  const before = data.playlists.length;
  data.playlists = data.playlists.filter(function (item) { return item.id !== id; });
  if (data.playlists.length !== before) { await save(); return true; }
  return false;
}
