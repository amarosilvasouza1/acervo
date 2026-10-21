#!/usr/bin/env node
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';

const DEFAULT_URL = process.env.ACERVO_URL || 'http://127.0.0.1:4310';
const TOKEN = process.env.ACERVO_MCP_TOKEN || '';
const VERSION = '1.6.0';
const PROTOCOLS = new Set(['2024-11-05', '2025-03-26', '2025-06-18']);

export const TOOLS = [
  {
    name: 'acervo_status',
    description: 'Mostra o que está tocando, fila, aparelhos, tamanho da biblioteca e comandos MCP pendentes.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'acervo_search',
    description: 'Pesquisa músicas no YouTube para o Acervo (título, canal, duração, videoId e URL).',
    inputSchema: {
      type: 'object', properties: { query: { type: 'string', minLength: 1 }, limit: { type: 'integer', minimum: 1, maximum: 14 } },
      required: ['query'], additionalProperties: false
    }
  },
  {
    name: 'acervo_library',
    description: 'Lista ou filtra as músicas já baixadas no acervo.',
    inputSchema: {
      type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } },
      additionalProperties: false
    }
  },
  {
    name: 'acervo_play',
    description: 'Toca uma faixa do acervo (por trackId ou busca) e opcionalmente define a fila. Requer a aba Web do Acervo aberta.',
    inputSchema: {
      type: 'object', properties: {
        trackId: { type: 'string' }, query: { type: 'string' },
        queue: { type: 'array', items: { type: 'string' }, maxItems: 100 }
      }, additionalProperties: false
    }
  },
  {
    name: 'acervo_play_phone',
    description: 'Envia uma faixa ou playlist para tocar no aparelho ativo do Acervo, normalmente o celular conectado.',
    inputSchema: {
      type: 'object', properties: {
        playlistId: { type: 'string' }, trackId: { type: 'string' }, query: { type: 'string' }
      }, additionalProperties: false
    }
  },
  {
    name: 'acervo_phone_control',
    description: 'Controla o aparelho ativo (celular): pause, resume, toggle, next, previous ou seek.',
    inputSchema: {
      type: 'object', properties: {
        action: { type: 'string', enum: ['pause', 'resume', 'toggle', 'next', 'previous', 'seek'] },
        position: { type: 'number', minimum: 0, maximum: 86400 }
      }, required: ['action'], additionalProperties: false
    }
  },
  {
    name: 'acervo_control',
    description: 'Controla o player da aba Web: pause, resume, stop, next, previous ou seek.',
    inputSchema: {
      type: 'object', properties: {
        action: { type: 'string', enum: ['pause', 'resume', 'stop', 'next', 'previous', 'seek'] },
        position: { type: 'number', minimum: 0, maximum: 86400 }
      }, required: ['action'], additionalProperties: false
    }
  },
  {
    name: 'acervo_playlists',
    description: 'Lista as playlists salvas no Acervo, com contagem e status das faixas.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'acervo_play_playlist',
    description: 'Coloca uma playlist para tocar, usando as faixas já baixadas dela.',
    inputSchema: {
      type: 'object', properties: { playlistId: { type: 'string' } }, required: ['playlistId'], additionalProperties: false
    }
  },
  {
    name: 'acervo_create_playlist',
    description: 'Cria uma playlist com nome e faixas (use resultados de acervo_search ou IDs da biblioteca).',
    inputSchema: {
      type: 'object', properties: {
        name: { type: 'string', minLength: 1, maxLength: 160 },
        sourceUrl: { type: 'string' },
        entries: {
          type: 'array', maxItems: 100, items: {
            type: 'object', properties: {
              videoId: { type: 'string' }, title: { type: 'string' }, artist: { type: 'string' },
              duration: { type: 'number' }, thumbnail: { type: 'string' }, sourceUrl: { type: 'string' }
            }, required: ['title'], additionalProperties: true
          }
        }
      }, required: ['name'], additionalProperties: false
    }
  },
  {
    name: 'acervo_import_playlist',
    description: 'Importa uma playlist ou faixa do Spotify/YouTube para o Acervo e inicia o download.',
    inputSchema: {
      type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false
    }
  },
  {
    name: 'acervo_download',
    description: 'Baixa uma música do YouTube para o acervo. Retorna o jobId para acompanhar.',
    inputSchema: {
      type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false
    }
  },
  {
    name: 'acervo_job',
    description: 'Consulta o andamento de um download pelo jobId.',
    inputSchema: {
      type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'], additionalProperties: false
    }
  }
];

export function createClient(baseUrl = DEFAULT_URL, fetchImpl = fetch, token = TOKEN) {
  const root = String(baseUrl).replace(/\/+$/, '');
  async function request(path, options = {}) {
    const headers = { Accept: 'application/json', Origin: root };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (options.body) headers['Content-Type'] = 'application/json';
    const response = await fetchImpl(root + path, {
      ...options, headers: { ...headers, ...(options.headers || {}) },
      signal: options.signal || AbortSignal.timeout(60000)
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) {
      const message = data && typeof data === 'object' && data.error ? data.error : 'HTTP ' + response.status;
      throw new Error(message);
    }
    return data;
  }
  return {
    root,
    get(path) { return request(path); },
    post(path, body) { return request(path, { method: 'POST', body: JSON.stringify(body || {}) }); }
  };
}

function textResult(value) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

function failResult(message) {
  return { content: [{ type: 'text', text: 'Erro: ' + message }], isError: true };
}

function norm(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

async function resolveTrack(client, args) {
  const library = ((await client.get('/api/library')).tracks || []);
  if (args.trackId) {
    const found = library.find((track) => track.id === String(args.trackId));
    if (!found) throw new Error('Faixa não encontrada no acervo. Use acervo_search para procurar.');
    return found;
  }
  const query = String(args.query || '').trim();
  if (!query) throw new Error('Informe trackId ou query.');
  const needle = norm(query);
  let found = library.find((track) => norm(track.title).includes(needle) || norm(track.artist || '').includes(needle));
  if (found) return found;
  const search = await client.get('/api/search?q=' + encodeURIComponent(query));
  const results = search.results || [];
  if (!results.length) throw new Error('Nenhum resultado encontrado no YouTube.');
  return { searchOnly: true, results };
}

export async function callTool(name, args, client = createClient()) {
  try {
    if (name === 'acervo_status') {
      const [info, library, playlists, mcp] = await Promise.all([
        client.get('/api/connect/info'), client.get('/api/library'), client.get('/api/playlists'), client.get('/api/mcp/status')
      ]);
      const playback = mcp.player || info.playback || {};
      return textResult({
        playing: !!playback.playing,
        trackId: playback.trackId || null,
        queue: Array.isArray(playback.queue) ? playback.queue.length : Number(playback.queue) || 0,
        position: playback.position || 0,
        devices: (info.devices || []).map((device) => ({ name: device.name, online: !!device.online, kind: device.kind })),
        library: (library.tracks || []).length,
        playlists: (playlists.playlists || []).length,
        pendingCommands: mcp.pending || 0,
        device: {
          name: ((info.devices || []).find((device) => device.id === (info.playback || {}).activeDeviceId) || {}).name || null,
          activeDeviceId: (info.playback || {}).activeDeviceId || null,
          playing: !!((info.playback || {}).playing),
          trackId: (info.playback || {}).trackId || null,
          position: (info.playback || {}).position || 0,
          queue: Array.isArray((info.playback || {}).queue) ? info.playback.queue.length : 0
        },
        source: mcp.player ? 'web' : 'connect',
        updatedAt: playback.updatedAt || null,
        hint: 'Para tocar, mantenha a aba Web do Acervo aberta em http://127.0.0.1:4310.'
      });
    }

    if (name === 'acervo_search') {
      const query = String(args.query || '').trim();
      if (!query) throw new Error('Informe uma busca.');
      const search = await client.get('/api/search?q=' + encodeURIComponent(query));
      const limit = Math.max(1, Math.min(14, Number(args.limit) || 8));
      return textResult({ query, results: (search.results || []).slice(0, limit) });
    }

    if (name === 'acervo_library') {
      const tracks = (await client.get('/api/library')).tracks || [];
      const query = norm(args.query);
      const limit = Math.max(1, Math.min(100, Number(args.limit) || 50));
      const filtered = (query ? tracks.filter((track) => norm(track.title).includes(query) || norm(track.artist || '').includes(query)) : tracks)
        .slice(0, limit)
        .map((track) => ({ id: track.id, title: track.title, artist: track.artist, duration: track.duration }));
      return textResult({ total: tracks.length, tracks: filtered });
    }

    if (name === 'acervo_play') {
      const track = await resolveTrack(client, args);
      if (track.searchOnly) {
        return textResult({
          message: 'Essa faixa ainda não está no acervo. Baixe uma versão e depois toque pelo trackId.',
          candidates: track.results.slice(0, 6),
          next: 'Use acervo_download com a URL escolhida e acompanhe com acervo_job.'
        });
      }
      const queue = Array.from(new Set((Array.isArray(args.queue) && args.queue.length ? args.queue : [track.id]).filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())));
      if (!queue.includes(track.id)) queue.unshift(track.id);
      const command = await client.post('/api/mcp/command', { action: 'play', trackId: track.id, queue, qi: queue.indexOf(track.id) });
      return textResult({ message: 'Comando de reprodução enviado para a aba Web.', track: { id: track.id, title: track.title, artist: track.artist }, command: command.command });
    }

    if (name === 'acervo_play_phone') {
      let ids = [];
      let label = '';
      if (args.playlistId) {
        const playlist = ((await client.get('/api/playlists')).playlists || []).find((item) => item.id === args.playlistId);
        if (!playlist) throw new Error('Playlist não encontrada.');
        ids = playlist.entries.map((entry) => entry.trackId || entry.videoId).filter(Boolean);
        label = playlist.name;
      } else {
        const track = await resolveTrack(client, args);
        if (track.searchOnly) throw new Error('A faixa ainda não está no acervo. Baixe primeiro.');
        ids = [track.id];
        label = track.title;
      }
      if (!ids.length) throw new Error('Nenhuma faixa disponível para tocar no celular.');
      const result = await client.post('/api/mcp/device', { type: 'play', args: { trackId: ids[0], queue: ids, qi: 0 } });
      return textResult({ message: 'Play enviado ao aparelho ativo.', target: label, tracks: ids.length, command: result.command });
    }

    if (name === 'acervo_phone_control') {
      const action = String(args.action || '');
      const info = await client.get('/api/connect/info');
      const playing = !!(info.playback && info.playback.playing);
      let type = action;
      if (action === 'resume') {
        if (playing) return textResult({ message: 'O celular já está tocando.', action });
        type = 'toggle';
      } else if (action === 'pause') {
        if (!playing) return textResult({ message: 'O celular já está pausado.', action });
        type = 'toggle';
      }
      if (!['pause', 'resume', 'toggle', 'next', 'previous', 'seek'].includes(action)) throw new Error('Ação inválida.');
      const body = { type, args: {} };
      if (type === 'seek') body.args.position = Math.max(0, Math.min(86400, Number(args.position) || 0));
      const result = await client.post('/api/mcp/device', body);
      return textResult({ message: 'Comando enviado ao celular.', action, result });
    }

    if (name === 'acervo_control') {
      const action = String(args.action || '');
      if (!['pause', 'resume', 'stop', 'next', 'previous', 'seek'].includes(action)) throw new Error('Ação inválida.');
      const body = { action };
      if (action === 'seek') {
        body.position = Math.max(0, Math.min(86400, Number(args.position) || 0));
      }
      const command = await client.post('/api/mcp/command', body);
      return textResult({ message: 'Comando enviado para a aba Web.', command: command.command });
    }

    if (name === 'acervo_playlists') {
      const playlists = (await client.get('/api/playlists')).playlists || [];
      return textResult(playlists.map((playlist) => ({
        id: playlist.id, name: playlist.name, total: playlist.entries.length,
        done: playlist.entries.filter((entry) => !!entry.trackId).length,
        source: playlist.provider || 'local'
      })));
    }

    if (name === 'acervo_play_playlist') {
      const playlist = ((await client.get('/api/playlists')).playlists || []).find((item) => item.id === args.playlistId);
      if (!playlist) throw new Error('Playlist não encontrada.');
      const ids = playlist.entries.map((entry) => entry.trackId || entry.videoId).filter(Boolean);
      if (!ids.length) throw new Error('Essa playlist ainda não tem músicas baixadas.');
      const command = await client.post('/api/mcp/command', { action: 'play', trackId: ids[0], queue: ids, qi: 0 });
      return textResult({ message: 'Playlist enviada para a aba Web.', playlist: playlist.name, tracks: ids.length, command: command.command });
    }

    if (name === 'acervo_create_playlist') {
      const name = String(args.name || '').trim();
      if (!name) throw new Error('Informe o nome da playlist.');
      const entries = (Array.isArray(args.entries) ? args.entries : []).slice(0, 100).map((entry) => ({
        videoId: entry.videoId || null, title: String(entry.title || '').slice(0, 300),
        artist: String(entry.artist || '').slice(0, 300), duration: Number(entry.duration) || 0,
        thumbnail: entry.thumbnail || '', sourceUrl: entry.sourceUrl || (entry.videoId ? 'https://www.youtube.com/watch?v=' + entry.videoId : '')
      })).filter((entry) => entry.title);
      const result = await client.post('/api/playlists', { name, entries, sourceUrl: args.sourceUrl || '' });
      return textResult(result.playlist || result);
    }

    if (name === 'acervo_import_playlist') {
      const url = String(args.url || '').trim();
      if (!url) throw new Error('Informe a URL da playlist.');
      return textResult(await client.post('/api/playlists/import', { url }));
    }

    if (name === 'acervo_download') {
      const url = String(args.url || '').trim();
      if (!url) throw new Error('Informe a URL do YouTube.');
      return textResult(await client.post('/api/import', { url }));
    }

    if (name === 'acervo_job') {
      const jobId = String(args.jobId || '').trim();
      if (!jobId) throw new Error('Informe jobId.');
      return textResult(await client.get('/api/jobs/' + encodeURIComponent(jobId)));
    }

    return failResult('Ferramenta desconhecida: ' + name);
  } catch (error) {
    return failResult(error && error.message ? error.message : String(error));
  }
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } };
}

export async function handleMessage(message, client = createClient()) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return rpcError(message && message.id, -32600, 'Requisição JSON-RPC inválida.');
  }
  if (!Object.prototype.hasOwnProperty.call(message, 'id')) return null;
  const id = message.id;
  if (message.method === 'initialize') {
    const requested = message.params && message.params.protocolVersion;
    return {
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: PROTOCOLS.has(requested) ? requested : '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'acervo', version: VERSION },
        instructions: 'Controle o Acervo pela aba Web aberta. Use acervo_search/acervo_library antes de tocar; acervo_play e acervo_control enviam comandos para a página.'
      }
    };
  }
  if (message.method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  if (message.method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  if (message.method === 'tools/call') {
    const params = message.params || {};
    if (!params.name || typeof params.name !== 'string') return rpcError(id, -32602, 'Nome da ferramenta ausente.');
    const result = await callTool(params.name, params.arguments || {}, client);
    return { jsonrpc: '2.0', id, result };
  }
  return rpcError(id, -32601, 'Método não encontrado: ' + message.method);
}

export function startServer() {
  const client = createClient();
  let pending = 0;
  let closed = false;
  const lines = readline.createInterface({ input: process.stdin, terminal: false });
  function finish() {
    pending -= 1;
    if (closed && pending === 0) setTimeout(() => process.exit(0), 50);
  }
  lines.on('line', async (line) => {
    const text = line.trim();
    if (!text) return;
    pending += 1;
    let message;
    try { message = JSON.parse(text); } catch {
      process.stdout.write(JSON.stringify(rpcError(null, -32700, 'JSON inválido.')) + '\n');
      finish();
      return;
    }
    try {
      const response = await handleMessage(message, client);
      if (response) process.stdout.write(JSON.stringify(response) + '\n');
    } catch (error) {
      if (message && Object.prototype.hasOwnProperty.call(message, 'id')) {
        process.stdout.write(JSON.stringify(rpcError(message.id, -32603, error.message || String(error))) + '\n');
      }
    } finally {
      finish();
    }
  });
  lines.on('close', () => {
    closed = true;
    if (pending === 0) setTimeout(() => process.exit(0), 50);
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) startServer();
