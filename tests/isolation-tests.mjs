import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { openSafeFile, safeFile } from '../lib/safe-files.js';

let directory;
let publicRoot;
let privateRoot;
before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'acervo-file-boundary-'));
  publicRoot = path.join(directory, 'public');
  privateRoot = path.join(directory, 'public-private');
  await fs.mkdir(path.join(publicRoot, 'assets'), { recursive: true });
  await fs.mkdir(privateRoot);
  await fs.writeFile(path.join(publicRoot, 'assets', 'test.txt'), 'Public fixture');
  await fs.writeFile(path.join(privateRoot, 'private.txt'), 'Private fixture must never be served');
});
after(async () => {
  // Only this fixture's mkdtemp directory is removed, never the project or user data.
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});

function rejectsWithoutPath(promise, status = 403) {
  return assert.rejects(promise, error => {
    assert.equal(error.statusCode, status);
    assert.equal(error.code, status === 404 ? 'ENOENT' : 'EACCES');
    assert.equal(error.message.includes(directory), false);
    return true;
  });
}

test('regular nested file opens through an owned descriptor', async () => {
  const target = path.join(publicRoot, 'assets', 'test.txt');
  assert.equal(await safeFile(publicRoot, target), await fs.realpath(target));
  const handle = await openSafeFile(publicRoot, target);
  try {
    assert.equal((await handle.stat()).isFile(), true);
    assert.equal(await handle.readFile('utf8'), 'Public fixture');
  } finally {
    await handle.close();
  }
});

test('shared directory prefix cannot grant access to a private sibling', async () => {
  const target = path.join(privateRoot, 'private.txt');
  await rejectsWithoutPath(safeFile(publicRoot, target));
  await rejectsWithoutPath(openSafeFile(publicRoot, target));
});

test('decoded traversal cannot escape through a sibling with the same prefix', async () => {
  const relative = decodeURIComponent('/%2e%2e%2fpublic-private/private.txt');
  const target = path.join(publicRoot, relative);
  await rejectsWithoutPath(safeFile(publicRoot, target));
});

test('absolute directories and relative paths are refused as media files', async () => {
  for (const target of [publicRoot, path.join(publicRoot, 'assets'), 'assets/test.txt', path.join(publicRoot, 'bad\0name')]) {
    await rejectsWithoutPath(openSafeFile(publicRoot, target));
  }
  await rejectsWithoutPath(safeFile('public', path.join(publicRoot, 'assets', 'test.txt')));
});

test('missing files produce a generic 404 without filesystem details', async () => {
  await rejectsWithoutPath(safeFile(publicRoot, path.join(publicRoot, 'missing.txt')), 404);
  await rejectsWithoutPath(openSafeFile(publicRoot, path.join(publicRoot, 'missing.txt')), 404);
});

test('a directory junction or symlink cannot expose another folder', async () => {
  const link = path.join(publicRoot, 'linked-folder');
  await fs.symlink(privateRoot, link, process.platform === 'win32' ? 'junction' : 'dir');
  await rejectsWithoutPath(safeFile(publicRoot, path.join(link, 'private.txt')));
  await rejectsWithoutPath(openSafeFile(publicRoot, path.join(link, 'private.txt')));
});

test('a linked root is not accepted as a new trusted boundary', async () => {
  const link = path.join(directory, 'linked-root');
  await fs.symlink(publicRoot, link, process.platform === 'win32' ? 'junction' : 'dir');
  await rejectsWithoutPath(safeFile(link, path.join(link, 'assets', 'test.txt')));
});

test('file symlinks are refused even if they point to an allowed file', async context => {
  const link = path.join(publicRoot, 'linked-file.txt');
  try {
    await fs.symlink(path.join(publicRoot, 'assets', 'test.txt'), link, 'file');
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      context.skip('Windows requires Developer Mode or symlink privilege for file symlinks. Directory junctions are tested separately.');
      return;
    }
    throw error;
  }
  await rejectsWithoutPath(safeFile(publicRoot, link));
  await rejectsWithoutPath(openSafeFile(publicRoot, link));
});
