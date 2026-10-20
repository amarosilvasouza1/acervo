import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const FILE = '.acervo-server.lock';
const LIMIT = 4096;
const INVALID = 'O bloqueio da instância do Acervo está inválido. Confira se não há outro Acervo aberto e restaure ou remova somente o arquivo .acervo-server.lock antes de reiniciar.';
const fail = message => Object.assign(new Error(message), { statusCode: 503 });

function record(value) {
  if (!value || value.version !== 1 || !Number.isSafeInteger(value.pid) || value.pid < 1
      || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535 || typeof value.nonce !== 'string'
      || !/^[a-f0-9]{64}$/.test(value.nonce)) throw fail(INVALID);
  return value;
}

function sameFile(left, right) { return left.dev === right.dev && left.ino === right.ino; }

function inspect(file) {
  let handle;
  try {
    const before = fs.lstatSync(file);
    if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > LIMIT) throw fail(INVALID);
    handle = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = fs.fstatSync(handle);
    if (!opened.isFile() || !sameFile(before, opened) || opened.size < 1 || opened.size > LIMIT) throw fail(INVALID);
    const text = fs.readFileSync(handle, 'utf8');
    const parsed = record(JSON.parse(text));
    const after = fs.lstatSync(file);
    if (!sameFile(opened, after) || after.isSymbolicLink()) throw fail(INVALID);
    return { value: parsed, info: opened, text };
  } catch (error) {
    if (error.code === 'ENOENT') throw error;
    throw fail(INVALID);
  } finally { if (handle !== undefined) fs.closeSync(handle); }
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error.code === 'ESRCH') return false;
    // Permission denied and any uncertain result must not grant another server ownership.
    return true;
  }
}

/** Acquires one process lease per real Acervo data directory, independent of HTTP port. */
export function acquireServerInstance({ directory, port } = {}) {
  if (typeof directory !== 'string' || !directory.trim() || !path.isAbsolute(directory)
      || !Number.isInteger(port) || port < 1 || port > 65535) throw fail('Informe a pasta de dados e a porta válidas para iniciar o Acervo.');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const rootInfo = fs.lstatSync(directory);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw fail('A pasta de dados do Acervo precisa ser uma pasta real.');
  const file = path.join(fs.realpathSync(directory), FILE);
  const owner = { version: 1, pid: process.pid, port, nonce: crypto.randomBytes(32).toString('hex') };
  const text = JSON.stringify(owner) + '\n';
  let claimed = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    let handle;
    try {
      handle = fs.openSync(file, 'wx', 0o600);
      fs.writeFileSync(handle, text);
      fs.fsyncSync(handle);
      claimed = fs.fstatSync(handle);
      fs.closeSync(handle); handle = undefined;
      break;
    } catch (error) {
      if (handle !== undefined) fs.closeSync(handle);
      if (error.code !== 'EEXIST') throw fail('Não foi possível salvar o bloqueio da instância. Confira as permissões da pasta de dados do Acervo.');
    }
    let existing;
    try { existing = inspect(file); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (processAlive(existing.value.pid)) throw fail('O Acervo já está aberto usando esta pasta de dados na porta ' + existing.value.port
      + '. Abra http://127.0.0.1:' + existing.value.port + '/web ou encerre essa instância antes de iniciar outra.');
    // Serialize stale recovery: two contenders must never unlink each other's newly created lease.
    const recovering = file + '.recovering';
    try { fs.mkdirSync(recovering, { mode: 0o700 }); }
    catch { throw fail('Outra instância está recuperando o bloqueio do Acervo. Aguarde; se a recuperação foi interrompida, confira os processos antes de remover .acervo-server.lock.recovering.'); }
    try {
      let current;
      try { current = inspect(file); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (!sameFile(existing.info, current.info) || existing.value.nonce !== current.value.nonce || existing.text !== current.text) continue;
      if (processAlive(current.value.pid)) continue;
      try { fs.unlinkSync(file); }
      catch (error) { if (error.code !== 'ENOENT') throw fail('Não foi possível recuperar o bloqueio de uma instância encerrada do Acervo.'); }
    } finally {
      try { fs.rmdirSync(recovering); } catch {}
    }
  }
  if (!claimed) throw fail('Outra instância está iniciando o Acervo. Aguarde e abra a janela que já está em execução.');
  let released = false;
  return function release() {
    if (released) return false;
    let current;
    try { current = inspect(file); }
    catch { return false; }
    if (!sameFile(claimed, current.info) || current.value.pid !== owner.pid || current.value.nonce !== owner.nonce) return false;
    try { fs.unlinkSync(file); released = true; return true; }
    catch { return false; }
  };
}
