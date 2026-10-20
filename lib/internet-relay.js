import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Resolver } from 'node:dns/promises';
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const execute = promisify(execFile);
const PORTS = [443, 8443, 10000];
const failure = (message, statusCode = 503) => Object.assign(new Error(message), { statusCode });
const executable = process.platform === 'win32'
  ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe') : 'tailscale';

export function rawMapping(config, record) {
  const handler = config?.TCP?.[record.port];
  return !!(handler && handler.TCPForward === '127.0.0.1:' + record.localPort
    && !handler.HTTPS && !handler.HTTP && !handler.TerminateTLS && !handler.ProxyProtocol);
}

function publicIPv4(value) {
  const parts = String(value).split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a > 0 && a !== 10 && a !== 127 && a < 224 && !(a === 100 && b >= 64 && b <= 127)
    && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168);
}

async function resolvePublic(host) {
  const results = await Promise.allSettled(['1.1.1.1', '8.8.8.8'].map(async server => {
    const resolver = new Resolver({ timeout: 3000, tries: 1 });
    resolver.setServers([server]);
    return resolver.resolve4(host);
  }));
  const addresses = results.flatMap(result => result.status === 'fulfilled' ? result.value.filter(publicIPv4) : []);
  if (!addresses.length) throw Object.assign(failure('O endereço público do encaminhador ainda está sendo publicado.'), { code: 'ENOTFOUND' });
  return addresses[0];
}

export function verifyPcCertificate(raw, expectedPin, now = Date.now()) {
  if (!raw || !/^[a-f0-9]{64}$/.test(expectedPin || '')) throw failure('Identidade do computador não confirmada.');
  const certificate = new crypto.X509Certificate(raw);
  const actual = crypto.createHash('sha256').update(certificate.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
  const from = Date.parse(certificate.validFrom), until = Date.parse(certificate.validTo);
  if (!crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expectedPin))
      || !Number.isFinite(from) || !Number.isFinite(until) || from > now || until <= now) {
    throw failure('O encaminhador não preservou a identidade criptográfica deste PC.');
  }
}

/** Probe a public relay address, never the MagicDNS/private route back to this PC. */
export async function probePublicRelay(endpoint, pcPin) {
  const url = new URL(endpoint);
  const address = await resolvePublic(url.hostname);
  function get(route) {
    return new Promise((resolve, reject) => {
      const request = https.request({ hostname: url.hostname, port: url.port || 443, servername: url.hostname,
        path: route, method: 'GET', agent: false, minVersion: 'TLSv1.2', rejectUnauthorized: false,
        lookup: (_host, options, callback) => options.all ? callback(null, [{ address, family: 4 }]) : callback(null, address, 4) }, response => {
        try { verifyPcCertificate(response.socket.getPeerCertificate().raw, pcPin); }
        catch (error) { response.destroy(); reject(error); return; }
        const chunks = []; let size = 0;
        response.on('data', chunk => {
          size += chunk.length;
          if (size > 65536) { response.destroy(); reject(failure('Resposta inesperada do encaminhador.')); }
          else chunks.push(chunk);
        });
        response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
        response.on('error', reject);
      });
      request.setTimeout(10000, () => request.destroy(Object.assign(failure('O teste do endereço público demorou demais.'), { code: 'ETIMEDOUT' })));
      request.on('error', reject); request.end();
    });
  }
  const metadata = await get('/api/connect/config');
  let config;
  try { config = JSON.parse(metadata.body); } catch { throw failure('O endereço público não respondeu como Acervo.'); }
  if (metadata.status !== 200 || config.security?.type !== 'mtls-pinned'
      || config.security.mutual !== true || config.security.exclusive !== true) throw failure('O acesso público precisa da identidade dos dois aparelhos.');
  const library = await get('/api/library');
  if (library.status !== 401) throw failure('O servidor público não recusou um cliente sem a chave do celular.');
  return { verified: true };
}

export function createInternetRelay({ securePort, stateFile, run, probe = probePublicRelay }) {
  const command = run || (async args => {
    try { return (await execute(executable, args, { windowsHide: true, timeout: 20000, maxBuffer: 512 * 1024 })).stdout; }
    catch { throw failure('Não foi possível usar o Tailscale Funnel deste PC. Confira se o Tailscale está instalado, conectado e com Funnel permitido.'); }
  });
  let record = null, verified = false, busy = false;
  try {
    const info = fs.lstatSync(stateFile);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) throw new Error();
    record = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    const url = new URL(record.publicEndpoint);
    if (record.version !== 1 || record.provider !== 'tailscale-funnel' || !PORTS.includes(record.port)
        || !Number.isInteger(record.localPort) || record.localPort < 1 || record.localPort > 65535
        || !/^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(url.hostname) || url.origin !== record.publicEndpoint
        || Number(url.port || 443) !== record.port || (record.previousEndpoint !== null && typeof record.previousEndpoint !== 'string')) throw new Error();
  } catch (error) { if (error.code !== 'ENOENT') throw failure('O registro do encaminhador está inválido; restaure uma cópia válida.'); }

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
      throw failure('Não foi possível salvar a configuração do encaminhador.');
    }
  }
  const config = async () => JSON.parse(await command(['funnel', 'status', '--json']) || '{}');
  const authority = value => new URL(value.publicEndpoint).hostname + ':' + value.port;
  function snapshot() {
    return { provider: 'tailscale-funnel', state: record ? verified ? 'online' : 'configured' : 'offline',
      ...(record ? { publicEndpoint: record.publicEndpoint } : {}), verified };
  }
  async function exclusive(action) {
    if (busy) throw failure('O encaminhador já está sendo atualizado. Aguarde.', 409);
    busy = true;
    try { return await action(); } finally { busy = false; }
  }
  async function enable({ pcPin, currentEndpoint, configure }) {
    return exclusive(async () => {
      const status = JSON.parse(await command(['status', '--json']));
      const hostname = String(status.Self?.DNSName || '').replace(/\.$/, '').toLowerCase();
      const capabilities = new Set([...(status.Self?.Capabilities || []), ...Object.keys(status.Self?.CapMap || {})]);
      if (status.BackendState !== 'Running' || !status.Self?.Online || !/^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(hostname)) {
        throw failure('Conecte o Tailscale no PC antes de ativar o encaminhador. O celular não precisa do Tailscale.', 409);
      }
      if (!capabilities.has('funnel') || !capabilities.has('https')) {
        throw Object.assign(failure('Permita o Funnel na conta Tailscale deste PC e tente novamente.', 409),
          { actionUrl: 'https://tailscale.com/s/no-funnel' });
      }
      const before = await config();
      if (record && before.TCP?.[record.port] && !rawMapping(before, record)) throw failure('A porta do encaminhador foi alterada por outro serviço. Nenhum serviço será substituído.', 409);
      const port = record?.port || PORTS.find(value => !before.TCP?.[value]
        && !Object.values(before.Foreground || {}).some(item => item.TCP?.[value]));
      if (!port) throw failure('As portas do Funnel já estão ocupadas por outros serviços.', 409);
      const endpoint = 'https://' + hostname + (port === 443 ? '' : ':' + port);
      const candidate = { version: 1, provider: 'tailscale-funnel', port, localPort: securePort, publicEndpoint: endpoint,
        previousEndpoint: record ? record.previousEndpoint : currentEndpoint ?? null };
      const oldRecord = record;
      const changedMapping = !rawMapping(before, candidate) || before.AllowFunnel?.[authority(candidate)] !== true;
      save(candidate); verified = false;
      try {
        await configure(endpoint);
        if (changedMapping) await command(['funnel', '--bg', '--yes', '--tcp=' + port, 'tcp://127.0.0.1:' + securePort]);
        const active = await config();
        if (!rawMapping(active, candidate) || active.AllowFunnel?.[authority(candidate)] !== true) throw failure('O encaminhador não confirmou TCP sem descriptografia.');
        await probe(endpoint, pcPin);
        verified = true;
        return snapshot();
      } catch (error) {
        // DNS publication can lag the accepted Funnel configuration. Keep the
        // verified raw mapping available, but never mark it publicly verified.
        if (['ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH'].includes(error.code)) {
          return { ...snapshot(), verificationMessage: 'Encaminhamento configurado. Aguarde a publicação do endereço e toque em Verificar conexão novamente.' };
        }
        try {
          const active = await config();
          if (changedMapping && rawMapping(active, candidate)) {
            if (oldRecord && rawMapping(before, oldRecord) && before.AllowFunnel?.[authority(oldRecord)] === true) {
              await command(['funnel', '--bg', '--yes', '--tcp=' + oldRecord.port, 'tcp://127.0.0.1:' + oldRecord.localPort]);
            } else {
              await command(['funnel', '--tcp=' + port, 'off']);
              if (oldRecord && rawMapping(before, oldRecord)) await command(['serve', '--bg', '--yes', '--tcp=' + oldRecord.port, 'tcp://127.0.0.1:' + oldRecord.localPort]);
            }
          }
          await configure(currentEndpoint || null);
          if (oldRecord) save(oldRecord);
          else { fs.unlinkSync(stateFile); record = null; }
        } catch { throw failure('A ativação falhou e precisa de revisão. Use Desativar acesso para encerrar somente o encaminhador do Acervo.'); }
        throw error;
      }
    });
  }
  async function disable({ currentEndpoint, configure }) {
    return exclusive(async () => {
      if (!record) return snapshot();
      const active = await config();
      if (active.TCP?.[record.port] && !rawMapping(active, record)) throw failure('A porta foi alterada por outro serviço. O Acervo não vai removê-la.', 409);
      if (rawMapping(active, record)) await command(['funnel', '--tcp=' + record.port, 'off']);
      if ((await config()).TCP?.[record.port]) throw failure('O encaminhador ainda não confirmou o encerramento.');
      if (currentEndpoint === record.publicEndpoint) await configure(record.previousEndpoint);
      fs.unlinkSync(stateFile); record = null; verified = false;
      return snapshot();
    });
  }
  return { enable, disable, snapshot, isBusy: () => busy };
}
