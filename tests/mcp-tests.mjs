import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMessage, callTool, TOOLS } from '../mcp/acervo-mcp.mjs';

function mockClient(routes = {}) {
  const calls = [];
  return {
    calls,
    async get(path) {
      calls.push(['GET', path]);
      if (routes.get) return routes.get(path);
      if (path === '/api/library') return { tracks: [{ id: 'abc', title: 'Something About Us', artist: 'Daft Punk', duration: 229 }] };
      if (path.startsWith('/api/search')) return { results: [{ videoId: 'vid1', title: 'Daft Punk - Something About Us', channel: 'Daft Punk', duration: 229 }] };
      if (path === '/api/connect/info') return { playback: { playing: false, queue: [] }, devices: [] };
      if (path === '/api/playlists') return { playlists: [] };
      if (path === '/api/mcp/status') return { pending: 0 };
      if (path.startsWith('/api/jobs/')) return { id: path.split('/').pop(), state: 'done' };
      throw new Error('GET inesperado: ' + path);
    },
    async post(path, body) {
      calls.push(['POST', path, body]);
      if (path === '/api/mcp/command') return { command: { id: 'cmd-1', ...body } };
      if (path === '/api/playlists') return { playlist: { id: 'p1', name: body.name, entries: body.entries } };
      if (path === '/api/import') return { jobId: 'job-1' };
      throw new Error('POST inesperado: ' + path);
    }
  };
}

test('MCP initialize responde protocolo e capabilities', async () => {
  const response = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, mockClient());
  assert.equal(response.result.protocolVersion, '2025-06-18');
  assert.equal(response.result.serverInfo.name, 'acervo');
  assert.equal(response.result.capabilities.tools.listChanged, false);
});

test('MCP tools/list expõe as ferramentas de controle', async () => {
  const response = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, mockClient());
  const names = response.result.tools.map((tool) => tool.name);
  for (const name of ['acervo_search', 'acervo_play', 'acervo_control', 'acervo_create_playlist', 'acervo_play_playlist']) assert.ok(names.includes(name));
  assert.equal(TOOLS.length, names.length);
});

test('MCP search traduz a API do Acervo', async () => {
  const response = await handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'acervo_search', arguments: { query: 'daft punk', limit: 2 } } }, mockClient());
  assert.equal(response.result.isError, undefined);
  assert.match(response.result.content[0].text, /Daft Punk/);
});

test('MCP play envia um comando para a ponte Web', async () => {
  const client = mockClient();
  const result = await callTool('acervo_play', { query: 'something about us' }, client);
  assert.equal(result.isError, undefined);
  const call = client.calls.find((entry) => entry[1] === '/api/mcp/command');
  assert.deepEqual(call[2].trackId, 'abc');
  assert.deepEqual(call[2].queue, ['abc']);
});

test('MCP create playlist envia nome e entradas', async () => {
  const client = mockClient();
  const result = await callTool('acervo_create_playlist', { name: 'French House', entries: [{ videoId: 'vid1', title: 'Something About Us', artist: 'Daft Punk' }] }, client);
  assert.equal(result.isError, undefined);
  const call = client.calls.find((entry) => entry[1] === '/api/playlists');
  assert.equal(call[2].name, 'French House');
  assert.equal(call[2].entries[0].videoId, 'vid1');
});

test('MCP ferramenta desconhecida retorna erro de ferramenta', async () => {
  const result = await callTool('nao_existe', {}, mockClient());
  assert.equal(result.isError, true);
});

test('MCP método desconhecido retorna JSON-RPC -32601', async () => {
  const response = await handleMessage({ jsonrpc: '2.0', id: 9, method: 'resources/list' }, mockClient());
  assert.equal(response.error.code, -32601);
});
