import { execFile } from 'node:child_process';
import { mkdir, writeFile, lstat, realpath } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { openSafeFile } from './safe-files.js';

const SIZE = 96;
const FFMPEG = process.env.ACERVO_FFMPEG || 'ffmpeg';

/** Only balanced, uniform horizontal bars with a visible boundary are removable. */
export function blackBands(rgb, width = SIZE, height = SIZE) {
  if (!rgb || rgb.length !== width * height * 3 || width < 16 || height < 16) return null;
  function colored(y, threshold) {
    let count = 0;
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 3;
      if (Math.max(rgb[at], rgb[at + 1], rgb[at + 2]) > threshold) count++;
    }
    return count / width;
  }
  const maximum = Math.floor(height * 0.24);
  let top = 0, bottom = 0;
  while (top <= maximum && colored(top, 18) <= 0.02) top++;
  while (bottom <= maximum && colored(height - bottom - 1, 18) <= 0.02) bottom++;
  if (top < Math.max(2, height * 0.02) || bottom < Math.max(2, height * 0.02)
      || top > maximum || bottom > maximum || Math.abs(top - bottom) > height * 0.035) return null;
  if (colored(top, 30) < 0.15 || colored(height - bottom - 1, 30) < 0.15) return null;
  return { top, bottom, height };
}

function imageProcess(bytes, filter, raw = false) {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-loglevel', 'error', '-max_alloc', '67108864', '-threads', '1',
      '-protocol_whitelist', 'pipe', '-f', 'image2pipe', '-i', 'pipe:0', '-frames:v', '1', '-vf', filter,
      ...(raw ? ['-pix_fmt', 'rgb24', '-f', 'rawvideo'] : ['-q:v', '2', '-f', 'image2pipe', '-c:v', 'mjpeg']), 'pipe:1'];
    const child = execFile(FFMPEG, args, { encoding: 'buffer', maxBuffer: 5 * 1024 * 1024, timeout: 8000, windowsHide: true },
      (error, stdout) => error ? reject(new Error('Capa indisponível para ajuste.')) : resolve(stdout));
    child.stdin.on('error', () => {});
    child.stdin.end(bytes);
  });
}

/** Originals are never changed. Derived files are keyed by content and algorithm version. */
export function createCoverDisplay({ covers, cache, processImage = imageProcess }) {
  const pending = new Map(), results = new Map(), waiting = [];
  let active = 0;
  async function limit(task) {
    if (active >= 2) await new Promise(resolve => waiting.push(resolve));
    else active++;
    try { return await task(); }
    finally { const next = waiting.shift(); if (next) next(); else active--; }
  }
  return async function display(id) {
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(id || '')) throw Object.assign(new Error('Capa inválida.'), { statusCode: 400 });
    if (pending.has(id)) return pending.get(id);
    const original = { root: covers, file: path.join(covers, id + '.jpg'), cropped: false };
    const promise = limit(async () => {
      let handle;
      try {
        handle = await openSafeFile(covers, original.file);
        const info = await handle.stat();
        if (info.size > 5 * 1024 * 1024) return original;
        const bytes = await handle.readFile();
        const key = crypto.createHash('sha256').update('horizontal-bars-v1\0').update(bytes).digest('hex');
        if (results.has(key)) { const cached = results.get(key); return cached.cropped ? cached : original; }
        await mkdir(cache, { recursive: true, mode: 0o700 });
        const folder = await lstat(cache);
        if (!folder.isDirectory() || folder.isSymbolicLink() || path.resolve(await realpath(cache)) !== path.resolve(cache)) return original;
        const file = path.join(cache, key + '.jpg'), marker = path.join(cache, key + '.original');
        try {
          const entry = await lstat(file);
          if (entry.isFile() && !entry.isSymbolicLink()) return { root: cache, file, cropped: true };
        } catch {}
        try { if ((await lstat(marker)).isFile()) return original; } catch {}
        const sample = await processImage(bytes, 'scale=96:96', true);
        const bands = blackBands(sample);
        let result = original;
        if (bands) {
          const top = (bands.top / bands.height).toFixed(8), content = (1 - (bands.top + bands.bottom) / bands.height).toFixed(8);
          const output = await processImage(bytes, 'crop=iw:floor(ih*' + content + '/2)*2:0:floor(ih*' + top + '/2)*2,scale=min(1200\\,iw):-2');
          if (!output.length || output.length > 5 * 1024 * 1024) return original;
          await writeFile(file, output, { flag: 'wx', mode: 0o600 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
          result = { root: cache, file, cropped: true };
        } else await writeFile(marker, '', { flag: 'wx', mode: 0o600 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
        if (results.size >= 256) results.delete(results.keys().next().value);
        results.set(key, result);
        return result;
      } catch { return original; }
      finally { await handle?.close(); }
    });
    pending.set(id, promise);
    try { return await promise; } finally { pending.delete(id); }
  };
}
