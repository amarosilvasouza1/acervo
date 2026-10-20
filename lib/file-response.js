import { openSafeFile } from './safe-files.js';

export function byteRange(value, total) {
  if (value === undefined) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(value));
  if (!match || (!match[1] && !match[2]) || total === 0) return false;
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : total - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= total) return false;
    end = Math.min(total - 1, end);
  }
  return { start, end };
}

// Open once, validate the descriptor, and stream that same file.
export async function sendFile(req, res, root, file, type, headers = {}) {
  const handle = await openSafeFile(root, file);
  let stream;
  try {
    const info = await handle.stat();
    const range = byteRange(req.headers.range, info.size);
    if (range === false) {
      res.writeHead(416, { 'Content-Range': 'bytes */' + info.size, 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    const responseHeaders = { 'Content-Type': type, 'Content-Length': range ? range.end - range.start + 1 : info.size,
      'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', ...headers };
    if (range) responseHeaders['Content-Range'] = 'bytes ' + range.start + '-' + range.end + '/' + info.size;
    stream = handle.createReadStream({ ...(range || {}), autoClose: true });
    stream.once('error', () => res.destroy());
    res.once('close', () => stream.destroy());
    res.writeHead(range ? 206 : 200, responseHeaders);
    stream.pipe(res);
  } finally {
    if (!stream) await handle.close();
  }
}
