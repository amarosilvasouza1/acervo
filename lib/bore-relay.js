import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createBoreClient } from './bore-client.js';
import { probePublicRelay } from './internet-relay.js';

const fail = (message, statusCode = 503) => Object.assign(new Error(message), { statusCode });
const transient = error => ['ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH'].includes(error?.code);
const endpointFor = port => 'https://bore.pub:' + port;
const validPort = port => Number.isInteger(port) && port >= 1024 && port <= 65535;

/** Owns only an outbound opaque TCP client. Identity verification remains with Acervo mTLS. */
export function createBoreRelay({ securePort, stateFile, probe = probePublicRelay, createClient = createBoreClient }) {
  if (!Number.isInteger(securePort) || securePort < 1 || securePort > 65535 || typeof stateFile !== 'string' || !stateFile.trim()) throw fail('Configuração do encaminhador inválida.', 500);
  let record = null, client = null, owner = null, verified = false, busy = false, generation = 0;
  let timer = null, retryDelay = 3000, message = null;
  try {
    const entry = fs.lstatSync(stateFile);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 4096) throw new Error();
    record = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (record.version !== 1 || record.provider !== 'bore' || !validPort(record.port)
        || record.publicEndpoint !== endpointFor(record.port) || (record.previousEndpoint !== null && typeof record.previousEndpoint !== 'string')) throw new Error();
    fs.chmodSync(stateFile, 0o600);
  } catch (error) { if (error.code !== 'ENOENT') throw fail('O registro do encaminhador está inválido; restaure uma cópia válida.'); }

  function save(value) {
    const temporary = stateFile + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    let descriptor;
    try {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true, mode: 0o700 });
      descriptor = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(descriptor, JSON.stringify(value) + '\n'); fs.fsyncSync(descriptor);
      fs.closeSync(descriptor); descriptor = undefined;
      fs.renameSync(temporary, stateFile); record = value;
    } catch {
      if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch {}
      try { fs.unlinkSync(temporary); } catch {}
      throw fail('Não foi possível salvar a configuração do encaminhador.');
    }
  }
  function removeRecord() {
    try { fs.unlinkSync(stateFile); } catch (error) { if (error.code !== 'ENOENT') throw fail('Não foi possível remover a configuração do encaminhador.'); }
    record = null;
  }
  function snapshot() {
    return { provider: 'bore', state: record ? verified ? 'online' : 'configured' : 'offline', verified,
      ...(record ? { publicEndpoint: record.publicEndpoint } : {}), ...(message ? { verificationMessage: message } : {}) };
  }
  function stopClient() {
    generation++; clearTimeout(timer); timer = null; verified = false;
    const previous = client; client = null; previous?.stop();
  }
  function reconnect() {
    if (timer || !record || !owner) return;
    const delay = retryDelay; retryDelay = Math.min(30000, retryDelay * 2);
    timer = setTimeout(async () => {
      timer = null;
      if (busy) return reconnect();
      try { await enable({ ...owner, currentEndpoint: record.publicEndpoint }); }
      catch { reconnect(); }
    }, delay);
    timer.unref?.();
  }
  async function exclusive(action) {
    if (busy) throw fail('O encaminhador já está sendo atualizado. Aguarde.', 409);
    busy = true;
    try { return await action(); } finally { busy = false; }
  }
  async function enable({ pcPin, currentEndpoint, configure }) {
    return exclusive(async () => {
      if (!/^[a-f0-9]{64}$/.test(pcPin || '') || typeof configure !== 'function') throw fail('A identidade do PC não está disponível.', 500);
      clearTimeout(timer); timer = null; message = null; verified = false;
      owner = { pcPin, configure };
      const before = record, previousEndpoint = before ? before.previousEndpoint : currentEndpoint ?? null;
      let configured = false, probing = false;
      try {
        if (!client) {
          const current = ++generation;
          const next = createClient({ localPort: securePort, requestedPort: before?.port || 0, onClose: () => {
            if (current !== generation || client !== next) return;
            client = null; verified = false;
            message = 'O intermediário desconectou. Tentando recuperar o mesmo endereço.';
            reconnect();
          } });
          client = next;
        }
        const active = client, current = generation;
        const result = await active.start();
        if (!validPort(result.port) || result.publicEndpoint !== endpointFor(result.port) || (before && result.port !== before.port)) throw fail('O intermediário não preservou a porta autorizada.', 409);
        if (client !== active || current !== generation) throw Object.assign(fail('A conexão foi interrompida.'), { code: 'ECONNRESET' });
        save({ version: 1, provider: 'bore', port: result.port, publicEndpoint: result.publicEndpoint, previousEndpoint });
        configured = true; await configure(record.publicEndpoint);
        probing = true; await probe(record.publicEndpoint, pcPin);
        if (client !== active || current !== generation) throw Object.assign(fail('A conexão foi interrompida.'), { code: 'ECONNRESET' });
        verified = true; retryDelay = 3000;
        return snapshot();
      } catch (error) {
        verified = false;
        if (record && (transient(error) || (!configured && before && !probing && error.statusCode !== 409))) {
          message = 'Endereço configurado, mas o acesso público ainda não foi confirmado. Tentando reconectar.';
          if (!client || !probing) stopClient();
          reconnect();
          return snapshot();
        }
        stopClient(); owner = null;
        if (configured || probing) {
          try { await configure(previousEndpoint); removeRecord(); }
          catch { throw fail('A ativação falhou e precisa de revisão. Desative o encaminhador do Acervo.'); }
        } else if (!before) record = null;
        throw error;
      }
    });
  }
  async function disable({ currentEndpoint, configure }) {
    return exclusive(async () => {
      stopClient(); owner = null; message = null;
      if (record) {
        if (currentEndpoint === record.publicEndpoint) await configure(record.previousEndpoint);
        removeRecord();
      }
      return snapshot();
    });
  }
  return { enable, disable, snapshot, isBusy: () => busy, isEnabled: () => record !== null,
    resume: options => record ? enable(options) : Promise.resolve(snapshot()) };
}
