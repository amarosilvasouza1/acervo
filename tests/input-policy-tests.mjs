import test from 'node:test';
import assert from 'node:assert/strict';
import { validVideoId, parseYouTubeVideoId, validateImportInput, validatedPlaylistUrl, safeThumbnailUrl } from '../lib/input-policy.js';

const VIDEO = 'dQw4w9WgXcQ';
const LIST = 'PL1234567890_abc-XYZ';
const invalid = error => error.statusCode === 400;

test('video IDs accept exactly the YouTube alphabet and length without filesystem or URL syntax', () => {
  assert.equal(validVideoId(VIDEO), true);
  assert.equal(validVideoId('_-ABCdef012'), true);
  for (const value of [null, undefined, 123, [], {}, '', 'x'.repeat(10), 'x'.repeat(12), '../secret00', 'a/bcdefghij',
    'a\\bcdefghij', 'a:bcdefghij', ' abcdefghij', 'abcdefghij\n', 'abcdefghij.', 'ébcdefghijk', '%2e%2e%2f00']) {
    assert.equal(validVideoId(value), false, JSON.stringify(value));
  }
});

test('video links resolve only approved YouTube hosts and return a canonical ID', () => {
  for (const value of [VIDEO, ' ' + VIDEO + ' ', 'https://youtube.com/watch?v=' + VIDEO,
    'https://www.youtube.com/watch?v=' + VIDEO + '&list=' + LIST + '&t=4', 'https://m.youtube.com/watch?v=' + VIDEO,
    'https://music.youtube.com/watch?v=' + VIDEO, 'https://youtu.be/' + VIDEO + '?t=10',
    'https://www.youtu.be/' + VIDEO, 'https://www.youtube.com/shorts/' + VIDEO,
    'https://www.youtube.com/embed/' + VIDEO, 'https://www.youtube.com/live/' + VIDEO,
    'http://www.youtube.com/watch?v=' + VIDEO, 'https://WWW.YouTube.Com/watch?v=' + VIDEO]) {
    assert.equal(parseYouTubeVideoId(value), VIDEO, value);
  }
});

test('video links reject arbitrary protocols, credentials, host tricks, nonstandard ports and encoded IDs', () => {
  for (const value of [null, {}, [], 'https://127.0.0.1/watch?v=' + VIDEO, 'http://169.254.169.254/latest/meta-data',
    'file:///C:/Users/private.txt', 'data:text/plain,' + VIDEO, 'ftp://www.youtube.com/watch?v=' + VIDEO,
    '//www.youtube.com/watch?v=' + VIDEO, 'https://youtube.com.evil.example/watch?v=' + VIDEO,
    'https://evil-youtube.com/watch?v=' + VIDEO, 'https://youtube.com@evil.example/watch?v=' + VIDEO,
    'https://evil.example@youtube.com/watch?v=' + VIDEO, 'https://www.youtube.com:8443/watch?v=' + VIDEO,
    'https://www.youtube.com\\@evil.example/watch?v=' + VIDEO, 'https://www.you\ntube.com/watch?v=' + VIDEO,
    'https://www.youtube.com/watch?v=../../private', 'https://youtu.be/%2e%2e%2fprivate',
    'https://www.youtube.com/playlist?list=' + LIST, 'https://www.youtube.com/watch?v=' + VIDEO + 'x',
    'https://www.youtube.com/watch?v=' + VIDEO + '&padding=' + 'a'.repeat(2048)]) {
    assert.equal(parseYouTubeVideoId(value), null, String(value));
  }
});

test('import validation requires a supported selector and rejects malformed optional metadata', () => {
  for (const value of [{ videoId: VIDEO }, { url: 'https://youtu.be/' + VIDEO }, { query: 'artista e música' },
    { videoId: VIDEO, meta: { title: 'Música', artist: 'Artista' } }, { query: 'x'.repeat(512) }]) {
    assert.equal(validateImportInput(value), value);
  }
  for (const value of [null, [], 'text', {}, { query: '   ' }, { videoId: '../private' }, { videoId: VIDEO, url: 'file:///private' },
    { url: 'http://localhost/private' }, { query: 12 }, { query: 'x'.repeat(513) }, { query: 'bad\0query' }, { query: 'bad\nquery' },
    { videoId: VIDEO, meta: null }, { videoId: VIDEO, meta: [] }, { videoId: VIDEO, meta: 'metadata' }]) {
    assert.throws(() => validateImportInput(value), invalid, JSON.stringify(value));
  }
});

test('playlist URLs are reduced to an approved HTTPS endpoint and bounded playlist identifier', () => {
  for (const value of ['https://youtube.com/playlist?list=' + LIST, 'http://m.youtube.com/watch?v=' + VIDEO + '&list=' + LIST,
    'https://music.youtube.com/playlist?list=' + LIST + '&redirect=http://localhost/private',
    ' https://www.youtube.com/playlist?list=' + LIST + '#extra ']) {
    assert.equal(validatedPlaylistUrl(value), 'https://www.youtube.com/playlist?list=' + LIST);
  }
  for (const value of [null, {}, [], 'file:///private?list=' + LIST, 'https://localhost/playlist?list=' + LIST,
    'https://youtube.com.evil.example/playlist?list=' + LIST, 'https://user:pass@youtube.com/playlist?list=' + LIST,
    'https://youtu.be/' + VIDEO + '?list=' + LIST, 'https://youtube.com/channel/any?list=' + LIST,
    'https://youtube.com/playlist?list=short', 'https://youtube.com/playlist?list=' + 'x'.repeat(129),
    'https://youtube.com/playlist?list=../../private', 'https://youtube.com:8080/playlist?list=' + LIST,
    'https://youtube.com/play\nlist?list=' + LIST]) {
    assert.throws(() => validatedPlaylistUrl(value), invalid, String(value));
  }
});

test('thumbnail URLs allow only canonical HTTPS YouTube CDN image paths and remove query/fragment', () => {
  for (const value of ['https://i.ytimg.com/vi/' + VIDEO + '/hqdefault.jpg',
    'https://img.youtube.com/vi/' + VIDEO + '/maxresdefault.jpg', 'https://i.ytimg.com/vi_webp/' + VIDEO + '/hqdefault.webp']) {
    assert.equal(safeThumbnailUrl(value + '?redirect=http://localhost/private#fragment'), value);
  }
  assert.equal(safeThumbnailUrl('https://i.ytimg.com:443/vi/' + VIDEO + '/0.jpg'), 'https://i.ytimg.com/vi/' + VIDEO + '/0.jpg');
  for (const value of [null, undefined, {}, 'http://i.ytimg.com/vi/' + VIDEO + '/hqdefault.jpg',
    'file:///private', 'https://localhost/vi/' + VIDEO + '/hqdefault.jpg', 'https://127.0.0.1/vi/' + VIDEO + '/hqdefault.jpg',
    'https://169.254.169.254/vi/' + VIDEO + '/hqdefault.jpg', 'https://i.ytimg.com.evil.example/vi/' + VIDEO + '/hqdefault.jpg',
    'https://user:pass@i.ytimg.com/vi/' + VIDEO + '/hqdefault.jpg', 'https://i.ytimg.com:8443/vi/' + VIDEO + '/hqdefault.jpg',
    'https://i.ytimg.com/vi/../../private', 'https://i.ytimg.com/vi/' + VIDEO + '/%2e%2e/private',
    'https://i.ytimg.com/vi/' + VIDEO + '/hqdefault.jpg/another', 'https://i.ytimg.com/private.png']) {
    assert.equal(safeThumbnailUrl(value), null, String(value));
  }
});
