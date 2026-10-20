import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { byteRange, sendFile } from '../lib/file-response.js';

test('byte ranges support suffixes, clamp the end, reject malformed and unsafe ranges', () => {
  assert.equal(byteRange(undefined, 10), null);
  assert.deepEqual(byteRange('bytes=2-99', 10), { start: 2, end: 9 });
  assert.deepEqual(byteRange('bytes=2-', 10), { start: 2, end: 9 });
  assert.deepEqual(byteRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.deepEqual(byteRange('bytes=-99', 10), { start: 0, end: 9 });
  for (const value of ['bytes=-', 'bytes=10-', 'bytes=5-1', 'bytes=-0', 'bytes=0-1,3-4', 'oops bytes=0-1', 'bytes=0-9007199254740992']) {
    assert.equal(byteRange(value, 10), false, value);
  }
  assert.equal(byteRange('bytes=0-0', 0), false);
});

test('HTTP file responses use the safe descriptor, enforce ranges and reject outside files', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'acervo-file-response-'));
  const root = path.join(temp, 'public');
  await mkdir(root);
  const file = path.join(root, 'sample.mp3');
  await writeFile(file, '0123456789');
  const outside = path.join(temp, 'private.txt');
  await writeFile(outside, 'secret');
  const server = http.createServer(async (req, res) => {
    try { await sendFile(req, res, root, req.url === '/outside' ? outside : file, 'audio/mpeg'); }
    catch (error) { res.writeHead(error.statusCode || 500); res.end(); }
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    let response = await fetch(base);
    assert.equal(response.status, 200); assert.equal(await response.text(), '0123456789');
    response = await fetch(base, { headers: { Range: 'bytes=7-100' } });
    assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), 'bytes 7-9/10');
    assert.equal(await response.text(), '789');
    response = await fetch(base, { headers: { Range: 'bytes=-2' } });
    assert.equal(response.status, 206); assert.equal(await response.text(), '89');
    response = await fetch(base, { headers: { Range: 'bytes=100-' } });
    assert.equal(response.status, 416); assert.equal(response.headers.get('content-range'), 'bytes */10');
    response = await fetch(base + '/outside'); assert.equal(response.status, 403);
    assert.equal(await response.text(), '');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(temp, { recursive: true, force: true });
  }
});

test('an open-ended audio request streams beyond the former 1 MiB / 44-second cutoff', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'acervo-full-audio-'));
  const file = path.join(temp, 'full.mp3');
  const bytes = Buffer.alloc(3 * 1024 * 1024 + 173, 0x5a);
  bytes.write('tail-of-complete-track', bytes.length - 21);
  await writeFile(file, bytes);
  const server = http.createServer((req, res) => {
    sendFile(req, res, temp, file, 'audio/mpeg').catch(() => res.destroy());
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const response = await fetch('http://127.0.0.1:' + server.address().port, { headers: { Range: 'bytes=0-' } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-length'), String(bytes.length));
    assert.equal(response.headers.get('content-range'), 'bytes 0-' + (bytes.length - 1) + '/' + bytes.length);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(temp, { recursive: true, force: true });
  }
});
