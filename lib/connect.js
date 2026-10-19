import crypto from 'node:crypto';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const COOKIE = 'acervo_connect';
const PAIR_TTL = 5 * 60 * 1000;
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const ID = /^[A-Za-z0-9_-]{1,128}$/;

function fail(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('Envie um objeto JSON válido.');
  return value;
}

export function isPrivateIPv4(address) {
  const value = String(address || '').replace(/^::ffff:/i, '');
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return false;
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
}

export function isLoopback(address) {
  const value = String(address || '').replace(/^::ffff:/i, '');
  return value === '::1' || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(value);
}

export function lanAddresses(interfaces = os.networkInterfaces()) {
  const result = [];
  const used = new Set();
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      if (entry.internal || !isPrivateIPv4(entry.address) || used.has(entry.address)) continue;
      used.add(entry.address);
      result.push({ address: entry.address, name });
    }
  }
  return result.sort((a, b) => Number(/virtual|vethernet|docker|vpn|wsl/i.test(a.name)) - Number(/virtual|vethernet|docker|vpn|wsl/i.test(b.name)));
}

export function assertSameOrigin(req, expectedOrigin) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return;
  if (req.headers['sec-fetch-site'] === 'cross-site') throw fail('Esta ação precisa partir do próprio Acervo.', 403);
  const origin = req.headers.origin;
  if (!origin) return;
  let parsed;
  try { parsed = new URL(origin); } catch { throw fail('Origem da requisição inválida.', 403); }
  const expected = expectedOrigin || (req.socket && req.socket.encrypted === true ? 'https://' : 'http://') + String(req.headers.host || '').toLowerCase();
  if (parsed.origin !== expected || parsed.origin !== origin) throw fail('Esta ação precisa partir do próprio Acervo.', 403);
}

function cloudOrigin(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\?#]/.test(value)) throw fail('Configure um endereço HTTPS público válido para o Acervo.', 500);
  let parsed;
  try { parsed = new URL(value); } catch { throw fail('Configure um endereço HTTPS público válido para o Acervo.', 500); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw fail('Configure um endereço HTTPS público sem caminho, usuário ou senha.', 500);
  return parsed;
}

function safeId(value, label = 'Faixa') {
  if (typeof value !== 'string' || !ID.test(value)) throw fail(label + ' inválida.');
  return value;
}

function finite(value, min, max, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw fail(label + ' inválido.');
  return value;
}

function boolean(value, label) {
  if (typeof value !== 'boolean') throw fail(label + ' inválido.');
  return value;
}

function repeat(value) {
  if (!['off', 'all', 'one'].includes(value)) throw fail('Modo de repetição inválido.');
  return value;
}

function queue(value) {
  if (!Array.isArray(value) || value.length > 1000) throw fail('Fila inválida.');
  return value.map(id => safeId(id));
}

export function validatePlaybackPatch(raw, current) {
  const value = object(raw);
  const patch = {};
  if ('trackId' in value) patch.trackId = value.trackId === null ? null : safeId(value.trackId);
  if ('queue' in value) patch.queue = queue(value.queue);
  if ('qi' in value) {
    const list = patch.queue || current.queue;
    if (!Number.isInteger(value.qi) || value.qi < -1 || (list.length ? value.qi >= list.length : value.qi > 0)) throw fail('Posição na fila inválida.');
    patch.qi = list.length ? value.qi : -1;
  }
  if ('playing' in value) patch.playing = boolean(value.playing, 'Estado de reprodução');
  if ('position' in value) patch.position = finite(value.position, 0, 86400, 'Tempo da faixa');
  if ('volume' in value) patch.volume = finite(value.volume, 0, 1, 'Volume');
  if ('shuffle' in value) patch.shuffle = boolean(value.shuffle, 'Modo aleatório');
  if ('repeat' in value) patch.repeat = repeat(value.repeat);
  const merged = Object.assign({}, current, patch);
  if (merged.qi >= merged.queue.length) patch.qi = merged.queue.indexOf(merged.trackId);
  if (merged.trackId === null && merged.playing) throw fail('Escolha uma faixa antes de reproduzir.');
  return patch;
}

export function validateCommand(raw) {
  const value = object(raw);
  const args = value.args === undefined ? {} : object(value.args);
  switch (value.type) {
    case 'play': {
      const out = {};
      if (args.trackId !== undefined) out.trackId = safeId(args.trackId);
      if (args.queue !== undefined) out.queue = queue(args.queue);
      if (args.qi !== undefined) {
        if (!Number.isInteger(args.qi) || args.qi < 0 || (out.queue && args.qi >= out.queue.length)) throw fail('Posição na fila inválida.');
        out.qi = args.qi;
      }
      return { type: value.type, args: out };
    }
    case 'pause': case 'toggle': case 'next': case 'previous': return { type: value.type, args: {} };
    case 'seek': return { type: value.type, args: { position: finite(args.position, 0, 86400, 'Tempo da faixa') } };
    case 'volume': return { type: value.type, args: { volume: finite(args.volume, 0, 1, 'Volume') } };
    case 'shuffle': return { type: value.type, args: { shuffle: boolean(args.shuffle, 'Modo aleatório') } };
    case 'repeat': return { type: value.type, args: { repeat: repeat(args.repeat) } };
    case 'transfer': return { type: value.type, args: { targetDeviceId: safeId(args.targetDeviceId, 'Saída') } };
    default: throw fail('Comando de reprodução desconhecido.');
  }
}

function tokenHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function cookieToken(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const split = part.trim().indexOf('=');
    if (split < 0) continue;
    const name = part.trim().slice(0, split);
    if (name === COOKIE) return part.trim().slice(split + 1);
  }
  return '';
}

export function createConnectManager(options = {}) {
  if (options.mode !== undefined && !['local', 'cloud'].includes(options.mode)) throw fail('Modo do Acervo Connect inválido.', 500);
  const cloud = options.mode === 'cloud';
  let secureTransport = null;
  if (options.secureTransport !== undefined) {
    const transport = options.secureTransport;
    if (cloud || !transport || typeof transport !== 'object' || Array.isArray(transport)
        || !Number.isInteger(transport.port) || transport.port < 1 || transport.port > 65535
        || typeof transport.pin !== 'string' || !/^[a-f0-9]{64}$/i.test(transport.pin)) throw fail('Configuração da conexão segura inválida.', 500);
    secureTransport = { port: transport.port, pin: transport.pin.toLowerCase() };
  }
  const trustTailscale = options.trustTailscale === true;
  const origin = cloud ? cloudOrigin(options.publicOrigin) : null;
  if (cloud && (typeof options.adminPassword !== 'string' || options.adminPassword.length < 16 || options.adminPassword.length > 1024)) throw fail('A senha do Acervo na nuvem precisa ter de 16 a 1024 caracteres.', 500);
  const passwordHash = cloud ? crypto.createHash('sha256').update(options.adminPassword).digest() : null;
  if (cloud && options.stateFile !== undefined && (typeof options.stateFile !== 'string' || !options.stateFile.trim())) throw fail('Arquivo de conexões inválido.', 500);
  const stateFile = cloud && options.stateFile ? path.resolve(options.stateFile) : null;
  const now = options.now || Date.now;
  const networkInterfaces = options.networkInterfaces || os.networkInterfaces;
  const randomToken = options.randomToken || (() => crypto.randomBytes(32).toString('base64url'));
  const qrCode = options.qrCode || (async url => (await import('qrcode')).default.toDataURL(url, { width: 320, margin: 2, errorCorrectionLevel: 'M' }));
  const getTrack = options.getTrack || (async () => true);
  const port = options.port || 4310;
  const devices = new Map();
  const sessions = new Map();
  const pairings = new Map();
  const attempts = new Map();
  const subscribers = new Set();
  let credentialSalt = cloud ? crypto.randomBytes(16).toString('hex') : null;
  let credentialStamp = cloud ? stamp(credentialSalt) : null;
  let persistenceError = false;
  let playback = { activeDeviceId: null, trackId: null, queue: [], qi: -1, playing: false, position: 0, volume: 0.8, shuffle: false, repeat: 'off', updatedAt: new Date(now()).toISOString(), revision: 0 };
  loadState();

  function stamp(salt) { return crypto.scryptSync(options.adminPassword, salt, 32).toString('hex'); }

  function persistedDevice(device) {
    return { id: device.id, name: device.name, kind: device.kind, local: false, admin: device.admin === true, lastSeenAt: device.lastSeenAt };
  }

  function persist() {
    if (!stateFile) return;
    const output = JSON.stringify({ version: 1, credentialSalt, credentialStamp, devices: Array.from(devices.values()).filter(device => !device.local).map(persistedDevice), sessions: Array.from(sessions, ([hash, session]) => ({ hash, ...session })) });
    const temporary = stateFile + '.' + process.pid + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    let descriptor;
    try {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true, mode: 0o700 });
      descriptor = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(descriptor, output);
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor); descriptor = undefined;
      fs.renameSync(temporary, stateFile);
    } catch {
      if (descriptor !== undefined) { try { fs.closeSync(descriptor); } catch {} }
      try { fs.unlinkSync(temporary); } catch {}
      persistenceError = true;
      throw fail('Não foi possível salvar as conexões do Acervo. Confira o armazenamento do servidor.', 503);
    }
  }

  function loadState() {
    if (!stateFile || !fs.existsSync(stateFile)) return;
    let value;
    try {
      if (fs.statSync(stateFile).size > 128 * 1024) throw new Error();
      value = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (!value || value.version !== 1 || !/^[a-f0-9]{32}$/.test(value.credentialSalt) || !/^[a-f0-9]{64}$/.test(value.credentialStamp) || !Array.isArray(value.devices) || !Array.isArray(value.sessions) || value.devices.length > 30 || value.sessions.length > 30) throw new Error();
      const ids = new Set(); const hashes = new Set(); const sessionDevices = new Set();
      for (const device of value.devices) {
        if (!device || typeof device.id !== 'string' || !ID.test(device.id) || ids.has(device.id) || device.local !== false || typeof device.admin !== 'boolean' || !['mobile', 'desktop'].includes(device.kind) || typeof device.name !== 'string' || !device.name.trim() || device.name.length > 64 || /[\x00-\x1f]/.test(device.name) || typeof device.lastSeenAt !== 'string' || !Number.isFinite(Date.parse(device.lastSeenAt))) throw new Error();
        ids.add(device.id);
      }
      for (const session of value.sessions) {
        if (!session || typeof session.hash !== 'string' || !/^[a-f0-9]{64}$/.test(session.hash) || hashes.has(session.hash) || !ids.has(session.deviceId) || sessionDevices.has(session.deviceId) || !Number.isSafeInteger(session.expiresAt) || session.expiresAt <= 0) throw new Error();
        hashes.add(session.hash); sessionDevices.add(session.deviceId);
      }
      if (ids.size !== sessionDevices.size) throw new Error();
    } catch { throw fail('O arquivo de conexões está inválido. Restaure uma cópia válida antes de iniciar o Acervo.', 500); }
    credentialSalt = value.credentialSalt;
    credentialStamp = stamp(credentialSalt);
    if (!crypto.timingSafeEqual(Buffer.from(value.credentialStamp, 'hex'), Buffer.from(credentialStamp, 'hex'))) { persist(); return; }
    for (const session of value.sessions) if (session.expiresAt > now()) {
      const saved = value.devices.find(device => device.id === session.deviceId);
      const device = { ...persistedDevice(saved), online: false, streams: new Set() };
      devices.set(device.id, device);
      sessions.set(session.hash, { deviceId: device.id, expiresAt: session.expiresAt });
    }
  }

  function isAdmin(context) { return !!(context.device && devices.get(context.device.id) === context.device && context.device.admin === true); }

  function assertCloudSession(context) {
    if (!cloud && (!secureTransport || context.local)) return;
    const session = context.sessionHash && sessions.get(context.sessionHash);
    if (!context.device || devices.get(context.device.id) !== context.device || !session || session.deviceId !== context.device.id || session.expiresAt <= now()) throw fail('Sua sessão foi encerrada. Entre novamente no seu Acervo.', 401);
  }

  function publicDevice(device) {
    return { id: device.id, name: device.name, kind: device.kind, local: device.local, online: device.online, lastSeenAt: device.lastSeenAt };
  }

  function snapshot(context = {}) {
    return { local: !cloud && !!context.local, admin: cloud ? isAdmin(context) : !!context.local, cloud, deviceId: context.device ? context.device.id : null, devices: Array.from(devices.values()).map(publicDevice), playback: structuredClone(playback) };
  }

  function send(subscriber, event, data) {
    if (subscriber.res.destroyed || subscriber.res.writableEnded) return;
    subscriber.res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
  }

  function broadcast(event, data, targetIds) {
    for (const subscriber of subscribers) {
      if (!targetIds || targetIds.includes(subscriber.device.id)) send(subscriber, event, data);
    }
  }

  function publishDevices() {
    for (const subscriber of subscribers) send(subscriber, 'devices', snapshot({ local: subscriber.device.local, device: subscriber.device }));
  }

  function changeState(patch) {
    playback = Object.assign({}, playback, patch, { updatedAt: new Date(now()).toISOString(), revision: playback.revision + 1 });
    broadcast('state', playback);
  }

  function touch(device) {
    if (!device) return;
    const wasOffline = !device.online;
    device.lastSeenAt = new Date(now()).toISOString();
    device.online = true;
    if (wasOffline) publishDevices();
  }

  function disconnectDevice(device, reason = 'Acesso removido neste dispositivo.') {
    for (const subscriber of Array.from(subscribers)) {
      if (subscriber.device.id !== device.id) continue;
      send(subscriber, 'revoked', { message: reason });
      subscriber.res.end();
    }
  }

  function prune() {
    const time = now();
    for (const [hash, pairing] of pairings) if (pairing.expiresAt <= time) pairings.delete(hash);
    for (const [key, attempt] of attempts) if (attempt.until <= time) attempts.delete(key);
    for (const [hash, session] of sessions) {
      if (session.expiresAt > time) continue;
      sessions.delete(hash);
      const device = devices.get(session.deviceId);
      if (device) {
        disconnectDevice(device, 'A conexão expirou. Leia um novo QR code.');
        devices.delete(device.id);
        if (playback.activeDeviceId === device.id) changeState({ activeDeviceId: null, playing: false });
      }
    }
    let presenceChanged = false;
    for (const device of devices.values()) {
      if (device.online && !device.streams.size && time - Date.parse(device.lastSeenAt) > 45000) { device.online = false; presenceChanged = true; }
    }
    if (presenceChanged) publishDevices();
  }

  function authorize(req, pathname) {
    if (persistenceError) throw fail('As conexões do Acervo estão indisponíveis até o armazenamento ser corrigido.', 503);
    prune();
    const address = String(req.socket.remoteAddress || '').replace(/^::ffff:/i, '');
    const secure = req.socket.encrypted === true;
    if (!cloud && !isLoopback(address) && !isPrivateIPv4(address)) throw fail('O Acervo Connect funciona somente na rede local.', 403);
    const insecureRemote = !cloud && secureTransport && !secure && !isLoopback(address);
    const publicMetadata = req.method === 'GET' && ['/api/connect/config', '/api/app/version'].includes(pathname);
    if (insecureRemote && pathname.startsWith('/api/') && !publicMetadata) throw fail('Esta conexão precisa de criptografia. Escaneie o novo QR code HTTPS no aplicativo Acervo.', 426);
    let host;
    try {
      host = new URL((secure ? 'https://' : 'http://') + req.headers.host);
      if (host.username || host.password || host.pathname !== '/' || host.search || host.hash) throw new Error();
    } catch { throw fail('Endereço de acesso inválido.', 403); }
    if (cloud) {
      if (String(req.headers.host || '').toLowerCase() !== origin.host) throw fail('Use o endereço HTTPS configurado para seu Acervo.', 403);
    } else {
      const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', ...lanAddresses(networkInterfaces()).map(item => item.address)]);
      const expectedPort = secureTransport && secure ? secureTransport.port : port;
      if (!allowedHosts.has(host.hostname.toLowerCase()) || Number(host.port || (secure ? 443 : 80)) !== expectedPort) throw fail('Use o endereço local exibido pelo Acervo.', 403);
    }
    assertSameOrigin(req, cloud ? origin.origin : undefined);
    const local = !cloud && !secure && isLoopback(address);
    let device = null;
    let sessionHash = null;
    if (local) {
      const requested = req.headers['x-acervo-device'] || (pathname === '/api/connect/events' ? new URL(req.url, 'http://localhost').searchParams.get('deviceId') : null);
      const found = requested && devices.get(requested);
      if (found && found.local) device = found;
    } else if (!insecureRemote) {
      sessionHash = tokenHash(cookieToken(req));
      const session = sessions.get(sessionHash);
      if (session) device = devices.get(session.deviceId) || null;
      const login = cloud && trustTailscale && isLoopback(address) ? String(req.headers['tailscale-user-login'] || '').trim() : '';
      if (!device && login && host.hostname === origin.hostname) {
        const id = 'ts-' + crypto.createHash('sha256').update(login).digest('hex').slice(0, 20);
        let trusted = devices.get(id);
        if (!trusted) {
          trusted = { id: id, local: false, admin: true, name: 'Acesso Tailscale', kind: 'desktop', online: true, lastSeenAt: new Date(now()).toISOString(), streams: new Set() };
          devices.set(id, trusted);
          publishDevices();
        }
        device = trusted;
        sessionHash = crypto.createHash('sha256').update('tailscale-session:' + login).digest('hex');
        sessions.set(sessionHash, { deviceId: id, expiresAt: now() + SESSION_TTL });
      }
    }
    const anonymous = (req.method === 'GET' && ['/api/connect/config', '/api/app/version'].includes(pathname)) || (req.method === 'POST' && pathname === '/api/connect/claim') || (cloud && req.method === 'POST' && pathname === '/api/connect/login');
    if (pathname.startsWith('/api/') && !local && !device && !anonymous) throw fail(cloud ? 'Entre no seu Acervo ou use um QR code para conectar este aparelho.' : 'Leia o QR code no computador para conectar este aparelho.', 401);
    touch(device);
    if (cloud && device && !playback.activeDeviceId) changeState({ activeDeviceId: device.id });
    return { local, device, sessionHash, address, secure };
  }

  function register(context, input) {
    if (cloud || !context.local) throw fail('Esta ação está disponível no computador que hospeda o acervo.', 403);
    const value = object(input);
    let device = typeof value.deviceId === 'string' ? devices.get(value.deviceId) : null;
    if (device && !device.local) device = null;
    if (!device) {
      if (devices.size >= 30) throw fail('Remova um aparelho antes de adicionar outro.', 409);
      const id = typeof value.deviceId === 'string' && ID.test(value.deviceId) && !devices.has(value.deviceId) ? value.deviceId : crypto.randomUUID();
      device = { id, local: true, streams: new Set() };
      devices.set(id, device);
    }
    device.name = String(value.name || device.name || 'Este computador').replace(/[\x00-\x1f]/g, '').trim().slice(0, 64) || 'Este computador';
    device.kind = ['phone', 'mobile', 'tablet'].includes(value.kind) ? 'mobile' : 'desktop';
    touch(device);
    if (!playback.activeDeviceId) changeState({ activeDeviceId: device.id });
    publishDevices();
    return snapshot({ local: true, device });
  }

  async function createPairing(context) {
    if (cloud ? !isAdmin(context) : !context.local) throw fail(cloud ? 'Entre com a senha do Acervo para conectar outro dispositivo.' : 'Crie o QR code no computador que hospeda o acervo.', 403);
    assertCloudSession(context);
    const addresses = cloud ? [{ address: origin.host, name: 'Internet' }] : lanAddresses(networkInterfaces());
    if (!addresses.length) throw fail('Nenhum endereço Wi-Fi ou Ethernet privado foi encontrado. Conecte o computador à rede local.', 409);
    const code = randomToken();
    const expiresAt = now() + PAIR_TTL;
    const candidates = await Promise.all(addresses.map(async item => {
      const url = (cloud ? origin.origin : secureTransport ? 'https://' + item.address + ':' + secureTransport.port : 'http://' + item.address + ':' + port)
        + '/#pair=' + encodeURIComponent(code) + (secureTransport ? '&spki=' + secureTransport.pin : '');
      return { address: item.address, name: item.name, url, qrDataUrl: await qrCode(url) };
    }));
    assertCloudSession(context);
    pairings.clear();
    pairings.set(tokenHash(code), { expiresAt });
    return { code, expiresAt, candidates, url: candidates[0].url, qrDataUrl: candidates[0].qrDataUrl,
      ...(secureTransport ? { security: { type: 'tls-pinned', pin: secureTransport.pin } } : {}) };
  }

  function claim(context, input, address) {
    if (!cloud && context.local) throw fail('Abra o link pelo celular conectado à mesma rede Wi-Fi.', 400);
    if (secureTransport && context.secure !== true) throw fail('Pareie usando o QR code HTTPS do Acervo.', 426);
    const value = object(input);
    prune();
    const key = String(address || context.address || 'unknown').replace(/^::ffff:/i, '');
    if (!cloud && !isPrivateIPv4(key) && !(secureTransport && context.secure === true && isLoopback(key))) throw fail('Conecte este aparelho à mesma rede Wi-Fi do computador.', 403);
    attempt(key);
    const code = typeof value.code === 'string' && value.code.length <= 128 ? value.code : '';
    const pairingHash = tokenHash(code);
    const pairing = pairings.get(pairingHash);
    if (!pairing || pairing.expiresAt <= now()) throw fail(cloud ? 'Este QR code expirou ou já foi usado. Gere outro em um dispositivo conectado.' : 'Este QR code expirou ou já foi usado. Gere outro no computador.', 401);
    if (devices.size >= 30) throw fail('Remova um aparelho antes de adicionar outro.', 409);
    pairings.delete(pairingHash);
    return createSession(value, false);
  }

  function attempt(address) {
    const key = String(address || 'unknown').replace(/^::ffff:/i, '').slice(0, 256);
    let entry = attempts.get(key);
    if (!entry) {
      if (attempts.size >= 1000) attempts.delete(attempts.keys().next().value);
      entry = { count: 0, until: now() + 60000 };
      attempts.set(key, entry);
    }
    if (++entry.count > 10) throw fail('Muitas tentativas. Aguarde um minuto e tente novamente.', 429);
  }

  function sessionCookie(token, maxAge = Math.floor(SESSION_TTL / 1000)) {
    return COOKIE + '=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + maxAge + (cloud || secureTransport ? '; Secure' : '');
  }

  function createSession(value, admin) {
    if (devices.size >= 30) throw fail('Remova um aparelho antes de adicionar outro.', 409);
    const id = crypto.randomUUID();
    const device = { id, local: false, admin: !!admin, name: String(value.name || 'Meu dispositivo').replace(/[\x00-\x1f]/g, '').trim().slice(0, 64) || 'Meu dispositivo', kind: ['computer', 'desktop'].includes(value.kind) ? 'desktop' : 'mobile', online: true, lastSeenAt: new Date(now()).toISOString(), streams: new Set() };
    const token = randomToken();
    devices.set(id, device);
    sessions.set(tokenHash(token), { deviceId: id, expiresAt: now() + SESSION_TTL });
    persist();
    if (cloud && !playback.activeDeviceId) changeState({ activeDeviceId: id });
    publishDevices();
    return { snapshot: snapshot({ local: false, device }), cookie: sessionCookie(token) };
  }

  function login(context, input, address) {
    if (!cloud) throw fail('A entrada por senha está disponível no modo nuvem.', 403);
    prune();
    attempt(address || context.address);
    const value = object(input);
    const password = typeof value.password === 'string' && value.password.length <= 1024 ? value.password : '';
    const supplied = crypto.createHash('sha256').update(password).digest();
    if (!crypto.timingSafeEqual(passwordHash, supplied)) throw fail('Senha incorreta.', 401);
    return createSession(value, true);
  }

  function logout(context) {
    if (!cloud || !context.device) throw fail('Entre no seu Acervo antes de sair.', 401);
    assertCloudSession(context);
    removeDevice(context.device, 'Você saiu deste dispositivo.');
    persist();
    publishDevices();
    return { ok: true, cookie: sessionCookie('', 0) };
  }

  async function assertTracks(value) {
    const ids = Array.from(new Set([value.trackId, ...(value.queue || [])].filter(Boolean)));
    for (const id of ids) if (!await getTrack(id)) throw fail('Uma faixa não está mais no acervo. Atualize a biblioteca.', 404);
  }

  async function updateState(context, input) {
    assertCloudSession(context);
    if (!context.device || context.device.id !== playback.activeDeviceId) throw fail('Somente o aparelho que está reproduzindo pode atualizar o player.', 409);
    const patch = validatePlaybackPatch(input, playback);
    await assertTracks(patch);
    assertCloudSession(context);
    if (context.device.id !== playback.activeDeviceId) throw fail('A reprodução foi transferida para outro aparelho.', 409);
    changeState(patch);
    return { ok: true, playback: structuredClone(playback) };
  }

  async function command(context, input) {
    assertCloudSession(context);
    if (!context.device) throw fail('Registre este aparelho antes de controlar a reprodução.', 409);
    const value = validateCommand(input);
    await assertTracks(value.args);
    assertCloudSession(context);
    let active = devices.get(playback.activeDeviceId);
    const previousId = playback.activeDeviceId;
    if (value.type === 'transfer') {
      const target = devices.get(value.args.targetDeviceId);
      if (!target || !target.online) throw fail('Abra o Acervo no aparelho de destino antes de transferir.', 409);
      const trackId = playback.trackId;
      const track = trackId && playback.playing ? await getTrack(trackId) : null;
      assertCloudSession(context);
      if (!devices.has(target.id) || !target.online) throw fail('O aparelho de destino desconectou. Tente novamente.', 409);
      const elapsed = playback.playing ? Math.max(0, now() - Date.parse(playback.updatedAt)) / 1000 : 0;
      const duration = playback.trackId === trackId && Number(track && track.duration) > 0 ? Number(track.duration) : 86400;
      changeState({ activeDeviceId: target.id, position: Math.min(duration, playback.position + elapsed) });
      active = target;
    } else if (!active || !active.online) throw fail('O aparelho de reprodução está desconectado. Escolha outra saída.', 409);
    const payload = Object.assign({ id: crypto.randomUUID(), fromDeviceId: context.device.id, targetDeviceId: active.id }, value);
    if (value.type === 'transfer') payload.playback = structuredClone(playback);
    broadcast('command', payload, value.type === 'transfer' ? [previousId, active.id] : [active.id]);
    return { ok: true, command: payload, playback: structuredClone(playback) };
  }

  function revoke(context, id) {
    if (cloud ? !isAdmin(context) : !context.local) throw fail(cloud ? 'Entre com a senha do Acervo para remover conexões.' : 'Remova conexões pelo computador que hospeda o acervo.', 403);
    assertCloudSession(context);
    const device = devices.get(id);
    if (!device) throw fail('Aparelho não encontrado.', 404);
    removeDevice(device);
    persist();
    publishDevices();
    return { ok: true };
  }

  function removeDevice(device, reason) {
    for (const [hash, session] of sessions) if (session.deviceId === device.id) sessions.delete(hash);
    devices.delete(device.id);
    disconnectDevice(device, reason);
    if (playback.activeDeviceId === device.id) changeState({ activeDeviceId: null, playing: false });
  }

  function events(req, res, context) {
    assertCloudSession(context);
    if (!context.device) throw fail('Registre este aparelho antes de conectar.', 409);
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    const subscriber = { device: context.device, res };
    subscribers.add(subscriber);
    context.device.streams.add(subscriber);
    touch(context.device);
    send(subscriber, 'snapshot', snapshot(context));
    publishDevices();
    const heartbeat = setInterval(function () {
      if (context.sessionHash && !sessions.has(context.sessionHash)) { res.end(); return; }
      prune();
      if (context.sessionHash && !sessions.has(context.sessionHash)) { res.end(); return; }
      touch(context.device);
      if (!res.destroyed && !res.writableEnded) res.write(': conectado\n\n');
    }, 15000);
    res.once('close', function () {
      clearInterval(heartbeat);
      subscribers.delete(subscriber);
      context.device.streams.delete(subscriber);
      if (!context.device.streams.size) context.device.online = false;
      publishDevices();
    });
  }

  async function handle(req, res, pathname, context, readBody, sendJson) {
    if (req.method === 'GET' && pathname === '/api/connect/config') { sendJson(res, 200, { cloud,
      ...(secureTransport ? { security: { type: 'tls-pinned', required: true, port: secureTransport.port } } : {}) }); return true; }
    if (req.method === 'GET' && pathname === '/api/connect/info') { sendJson(res, 200, snapshot(context)); return true; }
    if (req.method === 'POST' && pathname === '/api/connect/register') { sendJson(res, 200, register(context, await readBody(req))); return true; }
    if (req.method === 'POST' && pathname === '/api/connect/pairing') { sendJson(res, 200, await createPairing(context)); return true; }
    if (req.method === 'POST' && pathname === '/api/connect/claim') {
      const result = claim(context, await readBody(req), req.socket.remoteAddress);
      res.setHeader('Set-Cookie', result.cookie);
      sendJson(res, 200, result.snapshot);
      return true;
    }
    if (req.method === 'POST' && pathname === '/api/connect/login') {
      const result = login(context, await readBody(req), req.socket.remoteAddress);
      res.setHeader('Set-Cookie', result.cookie);
      sendJson(res, 200, result.snapshot);
      return true;
    }
    if (req.method === 'POST' && pathname === '/api/connect/logout') {
      const result = logout(context);
      res.setHeader('Set-Cookie', result.cookie);
      sendJson(res, 200, { ok: result.ok });
      return true;
    }
    if (req.method === 'GET' && pathname === '/api/connect/events') { events(req, res, context); return true; }
    if (req.method === 'POST' && pathname === '/api/connect/state') { sendJson(res, 200, await updateState(context, await readBody(req))); return true; }
    if (req.method === 'POST' && pathname === '/api/connect/command') { sendJson(res, 200, await command(context, await readBody(req))); return true; }
    if (req.method === 'DELETE' && pathname.startsWith('/api/connect/devices/')) { sendJson(res, 200, revoke(context, decodeURIComponent(pathname.split('/')[4] || ''))); return true; }
    return false;
  }

  return { authorize, handle, snapshot, register, createPairing, claim, login, logout, updateState, command, revoke, events, publishLibraryChange: (reason, trackId) => broadcast('library-changed', { reason, trackId, updatedAt: new Date(now()).toISOString() }) };
}
