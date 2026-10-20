import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanTitle, splitArtistTitle, resolveTrackMetadata, metadataRepairPatch } from '../lib/track-metadata.js';

test('existing title cleanup and artist-title splitting keep music names intact', () => {
  assert.equal(cleanTitle('  Band - Song [Official Audio]  '), 'Band - Song');
  assert.equal(cleanTitle('Song (Official Music Video) | Official Audio'), 'Song');
  assert.deepEqual(splitArtistTitle('Artista – Música [Lyrics]'), { artist: 'Artista', title: 'Música' });
  assert.deepEqual(splitArtistTitle('Just a Song (Live)'), { artist: '', title: 'Just a Song (Live)' });
  assert.equal(cleanTitle({ title: 'Do not stringify this' }), '');
});

test('structured artist and creator outrank selected-result artist and uploader', () => {
  const selected = { title: 'Wrong title', artist: 'Selected artist', channel: 'Selected channel' };
  assert.equal(resolveTrackMetadata({ track: 'Real Song', artist: 'Artist Name - Topic', creator: 'Creator', uploader: 'Upload farm' }, selected).artist, 'Artist Name');
  assert.equal(resolveTrackMetadata({ title: 'Song', creator: 'Real Creator', uploader: 'Upload farm' }, selected).artist, 'Real Creator');
});

test('selected artist beats channel labels and video-title prefixes cannot override the channel', () => {
  assert.equal(resolveTrackMetadata({ title: 'Title artist - Song', uploader: 'Compilation channel' }, { artist: 'Selected real artist' }).artist, 'Selected real artist');
  const parsed = resolveTrackMetadata({ title: 'Title artist - Song (Official Audio)', uploader: 'Compilation channel', channel: 'Mirror channel' });
  assert.equal(parsed.artist, 'Mirror channel');
  assert.equal(parsed.title, 'Title artist - Song');
  assert.equal(parsed.sourceTitle, 'Title artist - Song (Official Audio)');
  assert.equal(parsed.channel, 'Mirror channel');
  assert.equal(resolveTrackMetadata({ title: 'Title artist - Song (Official Audio)' }).artist, 'Title artist');
  assert.equal(resolveTrackMetadata({ title: 'Title artist - Song (Official Audio)' }).title, 'Song');
  assert.equal(resolveTrackMetadata({ title: 'VMZ - Amor (Animes) Feat. Grupo Halel', channel: 'VMZ' }).title, 'Amor (Animes) Feat. Grupo Halel');
  const story = resolveTrackMetadata({ title: 'Kunigami, Shidou & Barou (Blue Lock) | Carta Coringa - Coliado', channel: 'Coliado' });
  assert.equal(story.artist, 'Coliado');
  assert.equal(story.title, 'Kunigami, Shidou & Barou (Blue Lock) | Carta Coringa - Coliado');
});

test('channel-only metadata from a failed lookup still preserves the selected song', () => {
  const selected = { title: 'Selected song', channel: 'Selected musician - Topic', duration: 338.4 };
  const metadata = resolveTrackMetadata(null, selected);
  assert.equal(metadata.title, 'Selected song');
  assert.equal(metadata.artist, 'Selected musician');
  assert.equal(metadata.channel, 'Selected musician - Topic');
  assert.equal(metadata.duration, 338.4);
  assert.equal(resolveTrackMetadata({ title: 'Song', channel: 'Only source channel' }, null).artist, 'Only source channel');
  assert.equal(resolveTrackMetadata(null, { title: 'Song', artist: 'Actual selected artist' }).artist, 'Actual selected artist');
});

test('placeholder provider labels do not hide real fallback metadata', () => {
  const metadata = resolveTrackMetadata({ title: 'Faixa sem título', artist: 'Artista desconhecido', uploader: 'Unknown artist', duration: 0 },
    { title: 'Known song', artist: 'Known artist', duration: 246 });
  assert.equal(metadata.title, 'Known song');
  assert.equal(metadata.sourceTitle, 'Known song');
  assert.equal(metadata.artist, 'Known artist');
  assert.equal(metadata.duration, 246);
});

test('radio reference names never become song artist metadata', () => {
  const metadata = resolveTrackMetadata({}, { title: 'Song', sourceArtist: 'Seed artist', because: 'Similar to Seed artist' });
  assert.equal(metadata.artist, 'Artista desconhecido');
  assert.equal(metadata.channel, '');
});

test('metadata values are bounded text and malformed objects cannot become labels or durations', () => {
  const metadata = resolveTrackMetadata({ artist: { name: 'Object' }, creator: ['Array'], title: { text: 'Object' }, duration: true,
    album: {}, genre: [], release_year: {}, tags: [null, {}, ' Tag\nOne ', ...Array.from({ length: 12 }, (_, index) => 't'.repeat(90) + index)] },
    { title: 'T'.repeat(900), artist: 'A'.repeat(400), duration: '300.5', album: 'B'.repeat(400), genre: 'G'.repeat(200), release_year: 2025 });
  assert.equal(metadata.title.length, 512);
  assert.equal(metadata.artist.length, 256);
  assert.equal(metadata.album.length, 256);
  assert.equal(metadata.genre.length, 128);
  assert.equal(metadata.duration, 300.5);
  assert.equal(metadata.year, '2025');
  assert.equal(metadata.tags.length, 8);
  assert.equal(metadata.tags[0], 'Tag One');
  assert.ok(metadata.tags.every(value => value.length <= 80));
  assert.equal(resolveTrackMetadata({ duration: Infinity }, { duration: -1 }).duration, 0);
  assert.equal(resolveTrackMetadata({ upload_date: '20241017' }).year, '2024');
});

test('empty metadata retains explicit placeholders and never returns object text', () => {
  assert.deepEqual(resolveTrackMetadata(null, []), { title: 'Faixa sem titulo', artist: 'Artista desconhecido', sourceTitle: 'Faixa sem titulo', channel: '', duration: 0, album: '', genre: '', year: '', tags: [] });
});

test('repair fills only placeholder labels and does not mutate audio or listening history', () => {
  const existing = { id: 'abcdefghijk', title: 'Faixa sem título', artist: 'Artista desconhecido', sourceTitle: 'Faixa sem titulo', channel: '', duration: 338.384,
    plays: 12, lastPlayedAt: '2026-10-19T23:50:00Z', addedAt: '2026-10-18T12:00:00Z', loudness: { i: -14 }, features: { energy: 0.7 } };
  const before = structuredClone(existing);
  const metadata = resolveTrackMetadata({ title: 'Artist - Real Song (Official Audio)', artist: 'Artist', channel: 'Actual channel', duration: 123 });
  assert.deepEqual(metadataRepairPatch(existing, metadata), { title: 'Real Song', artist: 'Artist', sourceTitle: 'Artist - Real Song (Official Audio)', channel: 'Actual channel' });
  assert.deepEqual(existing, before);
});

test('repair preserves confirmed metadata and ignores unknown candidates', () => {
  const known = { title: 'My title', artist: 'My artist', sourceTitle: 'My source', channel: 'My channel' };
  const different = resolveTrackMetadata({ title: 'Different title', artist: 'Different artist', channel: 'Different channel' });
  assert.deepEqual(metadataRepairPatch(known, different), {});
  assert.deepEqual(metadataRepairPatch({ title: '', artist: 'Artista desconhecido', sourceTitle: null, channel: undefined }, resolveTrackMetadata(null, null)), {});
  assert.deepEqual(metadataRepairPatch({ title: 'My title', artist: '', sourceTitle: 'My source', channel: 'My channel' }, different), { artist: 'Different artist' });
});
