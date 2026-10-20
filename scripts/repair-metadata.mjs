import { copyFile, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { publicVideoMetadata } from '../lib/yt.js';
import { resolveTrackMetadata, metadataRepairPatch } from '../lib/track-metadata.js';
import { validVideoId } from '../lib/input-policy.js';

// Stop the server first. Refuse to overwrite changes made during provider requests.
const directory = path.resolve(process.env.ACERVO_DATA_DIR || path.join(process.cwd(), 'data'));
const file = path.join(directory, 'library.json');
const initial = await readFile(file, 'utf8');
const library = JSON.parse(initial);
const signature = value => crypto.createHash('sha256').update(value).digest('hex');
if (!Array.isArray(library.tracks)) throw new Error('Biblioteca inválida.');
let repaired = 0, failed = 0;
for (const track of library.tracks) {
  if (!validVideoId(track.videoId || track.id)) continue;
  const missing = metadataRepairPatch(track, { title: 'probe', artist: 'probe', sourceTitle: 'probe', channel: 'probe' });
  if (!missing.title && !missing.artist) continue;
  try {
    const metadata = resolveTrackMetadata(await publicVideoMetadata(track.videoId || track.id));
    const patch = metadataRepairPatch(track, metadata);
    if (Object.keys(patch).length) { Object.assign(track, patch); repaired++; }
  } catch { failed++; }
}
if (repaired) {
  if (signature(await readFile(file, 'utf8')) !== signature(initial)) throw new Error('A biblioteca mudou. Pare o servidor e repita o reparo.');
  const info = await stat(file);
  const backup = file + '.metadata-backup-' + Date.now();
  await copyFile(file, backup);
  const temporary = file + '.repair-' + crypto.randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(library, null, 2), { flag: 'wx', mode: info.mode & 0o777 });
  await rename(temporary, file);
}
console.log(JSON.stringify({ repaired, unavailable: failed, total: library.tracks.length,
  message: 'Somente rótulos ausentes foram preenchidos. Áudio e histórico foram preservados.' }));
