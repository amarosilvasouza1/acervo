import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { acquireServerInstance } from '../lib/server-instance.js';

const moduleUrl = new URL('../lib/server-instance.js', import.meta.url).href;
const rejected = error => error.statusCode === 503;
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'acervo-instance-tests-'));
  const children = [];
  t.after(async () => {
    for (const child of children) if (child.exitCode === null && child.connected) child.send({ action: 'release' });
    await Promise.all(children.map(child => child.closed));
    const relative = path.relative(os.tmpdir(), directory);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(directory).startsWith('acervo-instance-tests-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  async function start(port) {
    const code = `import {acquireServerInstance} from ${JSON.stringify(moduleUrl)};
let release;
try { release=acquireServerInstance({directory:process.env.ACERVO_INSTANCE_FIXTURE,port:Number(process.env.ACERVO_INSTANCE_PORT)});process.send({ok:true,pid:process.pid}); }
catch(error) {process.send({ok:false,message:error.message,statusCode:error.statusCode});process.disconnect();}
process.on('message',message=>{if(message.action==='release')release?.();if(process.connected)process.disconnect();process.exit(0);});`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true,
      env: { ...process.env, ACERVO_INSTANCE_FIXTURE: directory, ACERVO_INSTANCE_PORT: String(port) } });
    child.closed = new Promise(resolve => child.once('close', resolve)); children.push(child);
    const result = await new Promise((resolve, reject) => { child.once('message', resolve); child.once('error', reject); });
    if (!result.ok) await child.closed;
    return { child, result };
  }
  return { directory, file: path.join(directory, '.acervo-server.lock'), start };
}

test('one real data directory has one owner even when another process requests a different HTTP port', async t => {
  const f = await fixture(t); const first = await f.start(4313); assert.equal(first.result.ok, true);
  const second = await f.start(4310);
  assert.equal(second.result.ok, false); assert.equal(second.result.statusCode, 503);
  assert.match(second.result.message, /http:\/\/127\.0\.0\.1:4313\/web/);
  const record = JSON.parse(await fs.readFile(f.file, 'utf8'));
  assert.equal(record.pid, first.result.pid); assert.equal(record.port, 4313); assert.match(record.nonce, /^[a-f0-9]{64}$/);
  first.child.send({ action: 'release' }); await first.child.closed;
  const next = await f.start(4310); assert.equal(next.result.ok, true);
});

test('an unexpected process exit leaves a recoverable stale lock without killing another process', async t => {
  const f = await fixture(t); const crashed = await f.start(4310);
  const before = JSON.parse(await fs.readFile(f.file, 'utf8'));
  crashed.child.send({ action: 'exit-without-release' }); await crashed.child.closed;
  assert.equal(JSON.parse(await fs.readFile(f.file, 'utf8')).nonce, before.nonce);
  const release = acquireServerInstance({ directory: f.directory, port: 4313 });
  const after = JSON.parse(await fs.readFile(f.file, 'utf8'));
  assert.equal(after.pid, process.pid); assert.equal(after.port, 4313); assert.notEqual(after.nonce, before.nonce);
  assert.equal(release(), true); assert.equal(release(), false);
  await assert.rejects(fs.access(f.file));
});

test('release never removes a replacement identity, even when its inode was preserved', async t => {
  const f = await fixture(t); const release = acquireServerInstance({ directory: f.directory, port: 4310 });
  const replacement = { version: 1, pid: process.pid, port: 4313, nonce: crypto.randomBytes(32).toString('hex') };
  await fs.writeFile(f.file, JSON.stringify(replacement));
  assert.equal(release(), false);
  assert.deepEqual(JSON.parse(await fs.readFile(f.file, 'utf8')), replacement);
});

test('invalid, zero-length, oversized or nonregular locks fail closed and remain untouched', async t => {
  const f = await fixture(t);
  for (const text of ['', '{broken', JSON.stringify({ version: 1, pid: process.pid, port: 4310, nonce: 'bad' }),
    JSON.stringify({ version: 2, pid: process.pid, port: 4310, nonce: 'a'.repeat(64) }), 'x'.repeat(4097)]) {
    await fs.writeFile(f.file, text);
    assert.throws(() => acquireServerInstance({ directory: f.directory, port: 4313 }), error => rejected(error) && /bloqueio.*inválido/.test(error.message));
    assert.equal(await fs.readFile(f.file, 'utf8'), text);
  }
  await fs.unlink(f.file); await fs.mkdir(f.file);
  assert.throws(() => acquireServerInstance({ directory: f.directory, port: 4310 }), rejected);
});

test('permission-denied process checks are treated as active and cannot replace an owner record', async t => {
  const f = await fixture(t); const value = { version: 1, pid: 987654321, port: 4313, nonce: 'a'.repeat(64) };
  await fs.writeFile(f.file, JSON.stringify(value));
  const original = process.kill;
  process.kill = (pid, signal) => {
    assert.equal(pid, value.pid); assert.equal(signal, 0);
    throw Object.assign(new Error('Permission denied'), { code: 'EPERM' });
  };
  try { assert.throws(() => acquireServerInstance({ directory: f.directory, port: 4310 }), error => rejected(error) && /4313/.test(error.message)); }
  finally { process.kill = original; }
  assert.deepEqual(JSON.parse(await fs.readFile(f.file, 'utf8')), value);
});

test('concurrent stale recovery leaves exactly one process holding the directory lease', async t => {
  const f = await fixture(t); const crashed = await f.start(4310);
  crashed.child.send({ action: 'exit-without-release' }); await crashed.child.closed;
  const contenders = await Promise.all([4311, 4312, 4313, 4314].map(f.start));
  const owners = contenders.filter(value => value.result.ok);
  assert.equal(owners.length, 1);
  assert.equal(JSON.parse(await fs.readFile(f.file, 'utf8')).pid, owners[0].result.pid);
  for (const contender of contenders.filter(value => !value.result.ok)) assert.equal(contender.result.statusCode, 503);
});

test('symbolic lock files do not expose or replace their target', async t => {
  const f = await fixture(t); const target = path.join(f.directory, 'original.json');
  const content = JSON.stringify({ version: 1, pid: process.pid, port: 4313, nonce: 'a'.repeat(64) });
  await fs.writeFile(target, content);
  try { await fs.symlink(target, f.file, 'file'); }
  catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) { t.skip('Windows file symlinks require Developer Mode or symlink privilege.'); return; }
    throw error;
  }
  assert.throws(() => acquireServerInstance({ directory: f.directory, port: 4310 }), rejected);
  assert.equal(await fs.readFile(target, 'utf8'), content);
});

test('a linked data root is refused and successful lock permissions are private', async t => {
  const f = await fixture(t); const real = path.join(f.directory, 'real'); const linked = path.join(f.directory, 'linked');
  await fs.mkdir(real); await fs.symlink(real, linked, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => acquireServerInstance({ directory: linked, port: 4310 }), rejected);
  const release = acquireServerInstance({ directory: real, port: 4310 });
  if (process.platform !== 'win32') assert.equal((await fs.stat(path.join(real, '.acervo-server.lock'))).mode & 0o777, 0o600);
  assert.equal(release(), true);
});
