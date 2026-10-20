import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { blackBands, createCoverDisplay } from '../lib/cover-crop.js';

function image(top = 12, bottom = 12, shade = 0) {
  const rgb = Buffer.alloc(96 * 96 * 3, shade);
  for (let y = top; y < 96 - bottom; y++) for (let x = 0; x < 96; x++) {
    const at = (y * 96 + x) * 3; rgb[at] = 60 + x; rgb[at + 1] = 80 + y; rgb[at + 2] = 120;
  }
  return rgb;
}

test('horizontal black bands are detected without treating dark, asymmetric or unbordered artwork as letterboxed', () => {
  assert.deepEqual(blackBands(image()), { top: 12, bottom: 12, height: 96 });
  assert.deepEqual(blackBands(image(12, 12, 14)), { top: 12, bottom: 12, height: 96 });
  assert.equal(blackBands(image(0, 0)), null);
  assert.equal(blackBands(image(12, 0)), null);
  assert.equal(blackBands(image(12, 20)), null);
  assert.equal(blackBands(image(30, 30)), null);
  assert.equal(blackBands(Buffer.alloc(96 * 96 * 3)), null);
  assert.equal(blackBands(Buffer.alloc(96 * 96 * 3, 20)), null);
});

test('cover display coalesces requests, preserves original bytes and reuses a derived file after restart', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'acervo-cover-crop-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const covers = path.join(root, 'covers'), cache = path.join(root, 'display'); await fs.mkdir(covers);
  const source = path.join(covers, 'abcdefghijk.jpg'); await fs.writeFile(source, 'original-image');
  let calls = 0;
  const display = createCoverDisplay({ covers, cache, processImage: async (_bytes, _filter, raw) => { calls++; return raw ? image() : Buffer.from('cropped-image'); } });
  const [first, second] = await Promise.all([display('abcdefghijk'), display('abcdefghijk')]);
  assert.equal(calls, 2); assert.equal(first.file, second.file); assert.equal(first.cropped, true);
  assert.equal(await fs.readFile(first.file, 'utf8'), 'cropped-image');
  assert.equal(await fs.readFile(source, 'utf8'), 'original-image');
  const restarted = createCoverDisplay({ covers, cache, processImage: () => { throw new Error('should not decode'); } });
  assert.equal((await restarted('abcdefghijk')).file, first.file);
  await fs.writeFile(source, 'new-image'); await display('abcdefghijk'); assert.equal(calls, 4);
});

test('unchanged covers and decoder failures safely use their own original and unsafe identifiers are refused', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'acervo-cover-crop-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const covers = path.join(root, 'covers'), cache = path.join(root, 'display'); await fs.mkdir(covers);
  await fs.writeFile(path.join(covers, 'abcdefghijk.jpg'), 'same-image');
  await fs.writeFile(path.join(covers, 'lmnopqrstuv.jpg'), 'same-image');
  const display = createCoverDisplay({ covers, cache, processImage: async () => image(0, 0) });
  assert.equal((await display('abcdefghijk')).cropped, false);
  assert.equal((await display('lmnopqrstuv')).file, path.join(covers, 'lmnopqrstuv.jpg'));
  const broken = createCoverDisplay({ covers, cache: path.join(root, 'new-cache'), processImage: async () => { throw new Error('decoder unavailable'); } });
  assert.equal((await broken('abcdefghijk')).file, path.join(covers, 'abcdefghijk.jpg'));
  await assert.rejects(display('../private'), /inválida/);
});
