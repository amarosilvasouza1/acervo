import test from 'node:test';
import assert from 'node:assert/strict';
import { publicVideoMetadata } from '../lib/yt.js';

const id = 'abcdefghijk';
test('official metadata fallback uses only the fixed YouTube endpoint and preserves actual title/channel', async () => {
  const calls = [];
  const metadata = await publicVideoMetadata(id, { fetch: async (url, options) => {
    calls.push({ url, options });
    return Response.json({ title: 'Música inteira', author_name: 'Artista - Topic', thumbnail_url: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' });
  } });
  assert.equal(metadata.title, 'Música inteira'); assert.equal(metadata.channel, 'Artista - Topic');
  assert.equal(metadata.id, id); assert.equal(metadata.artist, undefined);
  assert.equal(new URL(calls[0].url).origin, 'https://www.youtube.com');
  assert.equal(new URL(calls[0].url).searchParams.get('url'), 'https://www.youtube.com/watch?v=' + id);
  assert.equal(calls[0].options.redirect, 'error');
});
test('fallback rejects malformed IDs before fetch and invalid/oversized/provider error responses', async () => {
  await assert.rejects(publicVideoMetadata('../outside', { fetch: () => { throw new Error('must not fetch'); } }), /Identificador/);
  for (const response of [Response.json({ title: '', author_name: 'Artist' }), Response.json({ title: {}, author_name: 'Artist' }),
    Response.json({ title: 'Song' }), new Response('unavailable', { status: 404 }), new Response('x'.repeat(65537))]) {
    await assert.rejects(publicVideoMetadata(id, { fetch: async () => response }));
  }
});
