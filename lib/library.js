import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'library.json');

let cache = null;
let loading = null;
let writing = Promise.resolve();

async function ensure() {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(path.join(DATA_DIR, 'tracks'), { recursive: true });
  await mkdir(path.join(DATA_DIR, 'covers'), { recursive: true });
  await mkdir(path.join(DATA_DIR, 'tmp'), { recursive: true });
  await mkdir(path.join(DATA_DIR, 'trash'), { recursive: true });
}

export async function load() {
  if (cache) return cache;
  if (loading) return loading;
  loading = readLibrary();
  try { return await loading; }
  finally { loading = null; }
}

async function readLibrary() {
  await ensure();
  try {
    const raw = await readFile(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    cache = Object.assign({}, parsed, {
      version: 1,
      tracks: Array.isArray(parsed.tracks) ? parsed.tracks : [],
      listeningHistory: Array.isArray(parsed.listeningHistory) ? parsed.listeningHistory : []
    });
  } catch (e) {
    cache = { version: 1, tracks: [], listeningHistory: [] };
  }
  return cache;
}

export async function save() {
  if (!cache) return;
  const snapshot = JSON.stringify(cache, null, 2);
  writing = writing.catch(function () {}).then(async function () {
    const tmp = FILE + '.tmp';
    await writeFile(tmp, snapshot, 'utf8');
    await rename(tmp, FILE);
  });
  return writing;
}

export async function all() {
  const lib = await load();
  return lib.tracks;
}

export async function get(id) {
  const lib = await load();
  return lib.tracks.find(function (t) { return t.id === id; }) || null;
}

export async function findByVideo(videoId) {
  const lib = await load();
  return lib.tracks.find(function (t) { return t.videoId === videoId; }) || null;
}

export async function add(track) {
  const lib = await load();
  const index = lib.tracks.findIndex(function (t) { return t.id === track.id; });
  if (index >= 0) lib.tracks[index] = Object.assign({}, lib.tracks[index], track);
  else lib.tracks.unshift(track);
  await save();
  return track;
}

export async function remove(id) {
  const lib = await load();
  const before = lib.tracks.length;
  lib.tracks = lib.tracks.filter(function (t) { return t.id !== id; });
  if (lib.tracks.length !== before) { await save(); return true; }
  return false;
}

export async function patch(id, changes) {
  const lib = await load();
  const track = lib.tracks.find(function (t) { return t.id === id; });
  if (!track) return null;
  Object.assign(track, changes);
  await save();
  return track;
}

export async function history() {
  const lib = await load();
  return lib.listeningHistory.slice();
}

export async function recordPlay(id, playedAt = new Date().toISOString()) {
  const lib = await load();
  const track = lib.tracks.find(function (t) { return t.id === id; });
  if (!track) return null;
  track.plays = (Number(track.plays) || 0) + 1;
  track.lastPlayedAt = playedAt;
  lib.listeningHistory.unshift({ trackId: id, playedAt: playedAt });
  lib.listeningHistory = lib.listeningHistory.slice(0, 200);
  await save();
  return track;
}

export async function stats() {
  const tracks = await all();
  const artists = new Set(tracks.map(function (t) { return (t.artist || '').toLowerCase(); }));
  const duration = tracks.reduce(function (sum, t) { return sum + (t.duration || 0); }, 0);
  const plays = tracks.reduce(function (sum, t) { return sum + (t.plays || 0); }, 0);
  const loud = tracks.filter(function (t) { return t.loudness && isFinite(t.loudness.i); });
  const avgLufs = loud.length ? loud.reduce(function (s, t) { return s + t.loudness.i; }, 0) / loud.length : null;
  return {
    tracks: tracks.length,
    artists: artists.size,
    duration: Math.round(duration),
    plays: plays,
    avgLufs: avgLufs === null ? null : Math.round(avgLufs * 10) / 10
  };
}

export { DATA_DIR };
