import crypto from 'node:crypto';
import os from 'node:os';

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

export function assertSameOrigin(req) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return;
  if (req.headers['sec-fetch-site'] === 'cross-site') throw fail('Esta ação precisa partir do próprio Acervo.', 403);
  const origin = req.headers.origin;
  if (!origin) return;
  let parsed;
  try { parsed = new URL(origin); } catch { throw fail('Origem da requisição inválida.', 403); }
  if (parsed.protocol !== 'http:' || parsed.host.toLowerCase() !== String(req.headers.host || '').toLowerCase() || parsed.origin !== origin) throw fail('Esta ação precisa partir do próprio Acervo.', 403);
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
  let playback = { activeDeviceId: null, trackId: null, queue: [], qi: -1, playing: false, position: 0, volume: 0.8, shuffle: false, repeat: 'off', updatedAt: new Date(now()).toISOString(), revision: 0 };

  function publicDevice(device) {
    return { id: device.id, name: device.name, kind: device.kind, local: device.local, online: device.online, lastSeenAt: device.lastSeenAt };
  }

  function snapshot(context = {}) {
    return { local: !!context.local, deviceId: context.device ? context.device.id : null, devices: Array.from(devices.values()).map(publicDevice), playback: structuredClone(playback) };
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

  function disconnectDevice(device, reason = 'Acesso removido neste computador.') {
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
    prune();
    const address = String(req.socket.remoteAddress || '').replace(/^::ffff:/i, '');
    if (!isLoopback(address) && !isPrivateIPv4(address)) throw fail('O Acervo Connect funciona somente na rede local.', 403);
    let host;
    try {
      host = new URL('http://' + req.headers.host);
      if (host.username || host.password || host.pathname !== '/' || host.search || host.hash) throw new Error();
    } catch { throw fail('Endereço de acesso inválido.', 403); }
    const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', ...lanAddresses(networkInterfaces()).map(item => item.address)]);
    if (!allowedHosts.has(host.hostname.toLowerCase()) || Number(host.port || 80) !== port) throw fail('Use o endereço local exibido pelo Acervo.', 403);
    assertSameOrigin(req);
    const local = isLoopback(address);
    let device = null;
    let sessionHash = null;
    if (local) {
      const requested = req.headers['x-acervo-device'] || (pathname === '/api/connect/events' ? new URL(req.url, 'http://localhost').searchParams.get('deviceId') : null);
      const found = requested && devices.get(requested);
      if (found && found.local) device = found;
    } else {
      sessionHash = tokenHash(cookieToken(req));
      const session = sessions.get(sessionHash);
      if (session) device = devices.get(session.deviceId) || null;
    }
    if (pathname.startsWith('/api/') && !local && !device && !(req.method === 'POST' && pathname === '/api/connect/claim')) throw fail('Leia o QR code no computador para conectar este aparelho.', 401);
    touch(device);
    return { local, device, sessionHash };
  }

  function register(context, input) {
    if (!context.local) throw fail('Esta ação está disponível no computador que hospeda o acervo.', 403);
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
    if (!context.local) throw fail('Crie o QR code no computador que hospeda o acervo.', 403);
    const addresses = lanAddresses(networkInterfaces());
    if (!addresses.length) throw fail('Nenhum endereço Wi-Fi ou Ethernet privado foi encontrado. Conecte o computador à rede local.', 409);
    const code = randomToken();
    const expiresAt = now() + PAIR_TTL;
    const candidates = await Promise.all(addresses.map(async item => {
      const url = 'http://' + item.address + ':' + port + '/#pair=' + encodeURIComponent(code);
      return { address: item.address, name: item.name, url, qrDataUrl: await qrCode(url) };
    }));
    pairings.clear();
    pairings.set(tokenHash(code), { expiresAt });
    return { code, expiresAt, candidates, url: candidates[0].url, qrDataUrl: candidates[0].qrDataUrl };
  }

  function claim(context, input, address) {
    if (context.local) throw fail('Abra o link pelo celular conectado à mesma rede Wi-Fi.', 400);
    const value = object(input);
    prune();
    const key = String(address || 'unknown').replace(/^::ffff:/i, '');
    if (!isPrivateIPv4(key)) throw fail('Conecte este aparelho à mesma rede Wi-Fi do computador.', 403);
    let attempt = attempts.get(key);
    if (!attempt) {
      if (attempts.size >= 1000) attempts.delete(attempts.keys().next().value);
      attempt = { count: 0, until: now() + 60000 };
      attempts.set(key, attempt);
    }
    if (++attempt.count > 10) throw fail('Muitas tentativas. Aguarde um minuto e leia o QR code novamente.', 429);
    const code = typeof value.code === 'string' && value.code.length <= 128 ? value.code : '';
    const pairingHash = tokenHash(code);
    const pairing = pairings.get(pairingHash);
    if (!pairing || pairing.expiresAt <= now()) throw fail('Este QR code expirou ou já foi usado. Gere outro no computador.', 401);
    if (devices.size >= 30) throw fail('Remova um aparelho antes de adicionar outro.', 409);
    pairings.delete(pairingHash);
    const id = crypto.randomUUID();
    const device = { id, local: false, name: String(value.name || 'Celular').replace(/[\x00-\x1f]/g, '').trim().slice(0, 64) || 'Celular', kind: ['computer', 'desktop'].includes(value.kind) ? 'desktop' : 'mobile', online: true, lastSeenAt: new Date(now()).toISOString(), streams: new Set() };
    devices.set(id, device);
    const token = randomToken();
    sessions.set(tokenHash(token), { deviceId: id, expiresAt: now() + SESSION_TTL });
    publishDevices();
    return { snapshot: snapshot({ local: false, device }), cookie: COOKIE + '=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + Math.floor(SESSION_TTL / 1000) };
  }

  async function assertTracks(value) {
    const ids = Array.from(new Set([value.trackId, ...(value.queue || [])].filter(Boolean)));
    for (const id of ids) if (!await getTrack(id)) throw fail('Uma faixa não está mais no acervo. Atualize a biblioteca.', 404);
  }

  async function updateState(context, input) {
    if (!context.device || context.device.id !== playback.activeDeviceId) throw fail('Somente o aparelho que está reproduzindo pode atualizar o player.', 409);
    const patch = validatePlaybackPatch(input, playback);
    await assertTracks(patch);
    if (context.device.id !== playback.activeDeviceId) throw fail('A reprodução foi transferida para outro aparelho.', 409);
    changeState(patch);
    return { ok: true, playback: structuredClone(playback) };
  }

  async function command(context, input) {
    if (!context.device) throw fail('Registre este aparelho antes de controlar a reprodução.', 409);
    const value = validateCommand(input);
    await assertTracks(value.args);
    let active = devices.get(playback.activeDeviceId);
    const previousId = playback.activeDeviceId;
    if (value.type === 'transfer') {
      const target = devices.get(value.args.targetDeviceId);
      if (!target || !target.online) throw fail('Abra o Acervo no aparelho de destino antes de transferir.', 409);
      const trackId = playback.trackId;
      const track = trackId && playback.playing ? await getTrack(trackId) : null;
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
    if (!context.local) throw fail('Remova conexões pelo computador que hospeda o acervo.', 403);
    const device = devices.get(id);
    if (!device) throw fail('Aparelho não encontrado.', 404);
    for (const [hash, session] of sessions) if (session.deviceId === id) sessions.delete(hash);
    devices.delete(id);
    disconnectDevice(device);
    if (playback.activeDeviceId === id) changeState({ activeDeviceId: null, playing: false });
    publishDevices();
    return { ok: true };
  }

  function events(req, res, context) {
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
    if (req.method === 'GET' && pathname === '/api/connect/info') { sendJson(res, 200, snapshot(context)); return true; }
    if (req.method === 'POST' && pathname === '/api/connect/register') { sendJson(res, 200, register(context, await readBody(req))); return true; }
    if (req.method === 'POST' && pathname === '/api/connect/pairing') { sendJson(res, 200, await createPairing(context)); return true; }
    if (req.method === 'POST' && pathname === '/api/connect/claim') {
      const result = claim(context, await readBody(req), req.socket.remoteAddress);
      res.setHeader('Set-Cookie', result.cookie);
      sendJson(res, 200, result.snapshot);
      return true;
    }
    if (req.method === 'GET' && pathname === '/api/connect/events') { events(req, res, context); return true; }
    if (req.method === 'POST' && pathname === '/api/connect/state') { sendJson(res, 200, await updateState(context, await readBody(req))); return true; }
    if (req.method === 'POST' && pathname === '/api/connect/command') { sendJson(res, 200, await command(context, await readBody(req))); return true; }
    if (req.method === 'DELETE' && pathname.startsWith('/api/connect/devices/')) { sendJson(res, 200, revoke(context, decodeURIComponent(pathname.split('/')[4] || ''))); return true; }
    return false;
  }

  return { authorize, handle, snapshot, register, createPairing, claim, updateState, command, revoke, events, publishLibraryChange: (reason, trackId) => broadcast('library-changed', { reason, trackId, updatedAt: new Date(now()).toISOString() }) };
}
