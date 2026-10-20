import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function fail(message, statusCode) { return Object.assign(new Error(message), { statusCode }); }

export function publicEndpointOrigin(value, statusCode = 400) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\?#]/.test(value) || !/^https:\/\/[^/]+\/?$/i.test(value)) throw fail('Use um endereço HTTPS sem caminho, usuário, senha, consulta ou fragmento.', statusCode);
  let parsed;
  try { parsed = new URL(value); } catch { throw fail('Informe um endereço HTTPS válido.', statusCode); }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw fail('Use um endereço HTTPS sem caminho, usuário, senha, consulta ou fragmento.', statusCode);
  }
  return parsed;
}

/** Stores only the public routing address. Cryptographic identities live elsewhere. */
export function createConnectNetwork({ file, publicEndpoint } = {}) {
  if (file !== undefined && (typeof file !== 'string' || !file.trim() || !path.isAbsolute(file))) throw fail('Configure um arquivo absoluto para a conexão pela internet.', 500);
  const target = file ? path.resolve(file) : null;
  const environment = publicEndpoint !== undefined && publicEndpoint !== null && publicEndpoint !== '';
  let endpoint = null;
  let source = null;
  if (target) {
    try {
      const entry = fs.lstatSync(target);
      if (!entry.isFile() || entry.isSymbolicLink() || entry.size < 1 || entry.size > 4096) throw new Error();
      const record = JSON.parse(fs.readFileSync(target, 'utf8'));
      if (!record || record.version !== 1 || !Object.hasOwn(record, 'publicEndpoint') || record.publicEndpoint === '') throw new Error();
      endpoint = publicEndpointOrigin(record.publicEndpoint, 500);
      source = endpoint ? 'saved' : null;
      fs.chmodSync(target, 0o600);
    } catch (error) {
      if (error.code !== 'ENOENT') throw fail('O arquivo da conexão pela internet está inválido. Restaure uma cópia válida; ele não será substituído automaticamente.', 500);
    }
  }
  if (environment) { endpoint = publicEndpointOrigin(publicEndpoint, 500); source = 'environment'; }

  function snapshot() { return { publicEndpoint: endpoint?.origin || null, publicEndpointSource: source, publicEndpointEditable: !!target && !environment }; }

  function update(value) {
    if (environment) throw fail('O endereço está definido na configuração de inicialização do Acervo e não pode ser alterado pelo aplicativo.', 409);
    if (!target) throw fail('O armazenamento da conexão pela internet não foi configurado neste computador.', 409);
    const next = publicEndpointOrigin(value);
    const temporary = target + '.' + process.pid + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    let descriptor;
    try {
      try {
        const entry = fs.lstatSync(target);
        if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Invalid settings file');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      descriptor = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(descriptor, JSON.stringify({ version: 1, publicEndpoint: next?.origin || null }) + '\n');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor); descriptor = undefined;
      fs.renameSync(temporary, target);
    } catch {
      if (descriptor !== undefined) { try { fs.closeSync(descriptor); } catch {} }
      try { fs.unlinkSync(temporary); } catch {}
      throw fail('Não foi possível salvar o endereço da conexão. O endereço anterior foi mantido.', 503);
    }
    endpoint = next;
    source = endpoint ? 'saved' : null;
    return snapshot();
  }

  return { snapshot, update, get endpoint() { return endpoint; } };
}
