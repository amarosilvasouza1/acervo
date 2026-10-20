import crypto from 'node:crypto';
import { spotifyPlaylistInfo, spotifyPlaylistUrl, spotifyTrackInfo, spotifyTrackUrl, spotifyFileInfo, matchSpotifyTrack, playlistText } from './spotify-playlist.js';
import { validVideoId } from './input-policy.js';

const fail = (message, code = 422) => Object.assign(new Error(message), { statusCode: code });
const activeStates = new Set(['queued', 'matching', 'working']);

/** Durable per-entry outcomes; the existing audio queue still performs every download. */
export function createPlaylistImports({ store, youtubeInfo, search, enqueue, waitForJob, getJob, getTracks, spotifyInfo = spotifyPlaylistInfo, trackInfo = spotifyTrackInfo, now = Date.now }) {
  const previews = new Map();
  const starting = new Map();
  const pending = []; const scheduled = new Set(); let running = false;
  let recovery;
  async function recover() {
    if (!recovery) recovery = (async () => {
      for (const playlist of await store.all()) for (const entry of playlist.entries) {
        if (entry.id && activeStates.has(entry.status)) await store.updateEntry(playlist.id, entry.id, {
          status: 'error', errorCode: 'interrupted', error: 'A importação foi interrompida pelo reinício do Acervo. Use Tentar pendentes para continuar.', jobId: null, stage: 'Interrompida' });
      }
    })();
    return recovery;
  }
  function cleanPreviews() {
    for (const [id, item] of previews) if (now() - item.at > 300000) previews.delete(id);
    while (previews.size >= 8) previews.delete(previews.keys().next().value);
  }
  async function preview(input) {
    if (!input || typeof input !== 'object') throw fail('Informe uma playlist.');
    let info;
    if (input.fileText !== undefined) info = spotifyFileInfo(input.fileText, input);
    else if (spotifyPlaylistUrl(input.url)) info = await spotifyInfo(input.url);
    else if (spotifyTrackUrl(input.url)) info = await trackInfo(input.url);
    else {
      info = await youtubeInfo(input.url);
      info = { ...info, provider: 'youtube', sourceUrl: input.url, countVerified: true, warnings: info.truncated ? ['A playlist foi limitada às primeiras ' + info.entries.length + ' músicas.'] : [] };
    }
    if (info.choices) return info;
    if (!info.entries?.length) throw fail('Nenhuma música encontrada nesta playlist.');
    cleanPreviews();
    const previewId = crypto.randomUUID(); previews.set(previewId, { at: now(), info, imported: null });
    return { ...structuredClone(info), previewId };
  }
  async function importList(input) {
    await recover();
    let previewId = input.previewId;
    if (!previewId) {
      const result = await preview(input);
      if (result.choices) throw fail('Escolha uma playlist do arquivo antes de importar.');
      previewId = result.previewId;
    }
    const saved = previews.get(previewId);
    if (!saved || now() - saved.at > 300000) throw fail('A prévia expirou. Leia a playlist novamente.');
    if (saved.imported) return saved.imported;
    // Install the promise before yielding so retries cannot create a second playlist.
    saved.imported = (async () => {
      const info = saved.info;
      const playlist = await store.create({ ...info, name: input.name || info.title });
      const result = await start(playlist.id);
      return { ...result, playlist: structuredClone(playlist), total: playlist.entries.length, sourceTotal: info.total, truncated: info.truncated, warnings: info.warnings || [] };
    })();
    try { return await saved.imported; } catch (error) { saved.imported = null; throw error; }
  }
  async function start(id) {
    if (starting.has(id)) return starting.get(id);
    const operation = startEntries(id);
    starting.set(id, operation);
    try { return await operation; } finally { starting.delete(id); }
  }
  async function startEntries(id) {
    await recover();
    const playlist = await store.get(id);
    if (!playlist) throw fail('Playlist não encontrada.', 404);
    const tracks = await getTracks();
    let count = 0;
    for (let index = 0; index < playlist.entries.length; index++) {
      const entry = playlist.entries[index];
      if (!entry.id) entry.id = crypto.randomUUID();
      const key = id + ':' + entry.id;
      if (scheduled.has(key) || entry.errorCode === 'unsupported') continue;
      const exists = entry.videoId && tracks.some(track => track.videoId === entry.videoId || track.id === entry.trackId);
      if (exists) { await store.updateEntry(id, entry.id, { status: 'done', error: null, errorCode: null }); continue; }
      await store.updateEntry(id, entry.id, { status: 'queued', error: null, errorCode: null, stage: 'Na fila', progress: 0 });
      scheduled.add(key); pending.push({ playlistId: id, entryId: entry.id, key }); count++;
    }
    void pump();
    return { total: count };
  }
  async function process(item) {
    const playlist = await store.get(item.playlistId);
    const entry = playlist?.entries.find(value => value.id === item.entryId);
    if (!entry) return;
    const update = patch => store.updateEntry(item.playlistId, item.entryId, patch);
    try {
      let candidate = validVideoId(entry.videoId) ? { videoId: entry.videoId, thumbnail: entry.thumbnail } : null;
      if (!candidate) {
        await update({ status: 'matching', stage: 'Procurando versão', progress: 0 });
        const local = (await getTracks()).map(track => ({ ...track, videoId: track.videoId || track.id, channel: track.artist }));
        candidate = matchSpotifyTrack(entry, local);
        if (!candidate) candidate = matchSpotifyTrack(entry, await search((entry.title + ' ' + entry.artist).slice(0, 500), 8));
        if (!candidate) {
          await update({ status: 'error', errorCode: 'not_found', error: 'Não encontramos uma versão compatível com o título, artista e duração no YouTube.', stage: 'Não encontrada' });
          return;
        }
      }
      await update({ videoId: candidate.videoId, thumbnail: candidate.thumbnail || entry.thumbnail || '', status: 'working', stage: 'Preparando download' });
      const job = enqueue({ videoId: candidate.videoId, meta: { title: entry.title, artist: entry.artist, duration: entry.duration,
        thumbnail: candidate.thumbnail || entry.thumbnail || '' } }, playlist.provider === 'spotify' ? { catalogMetadata: { title: entry.title, artist: entry.artist, album: entry.album } } : undefined);
      await update({ jobId: job.id });
      const finished = await waitForJob(job);
      if (finished.status !== 'done') throw new Error(finished.error || 'Não foi possível baixar esta música.');
      await update({ status: 'done', progress: 100, stage: finished.stage || 'No acervo', trackId: finished.trackId, error: null, errorCode: null });
    } catch (error) {
      await update({ status: 'error', errorCode: 'download_failed', error: playlistText(error.message, 400) || 'Não foi possível baixar esta música.', stage: 'Falhou' });
    }
  }
  async function pump() {
    if (running) return;
    running = true;
    try {
      while (pending.length) {
        const item = pending.shift();
        try { await process(item); } catch (error) { console.warn('Não foi possível salvar o resultado de uma entrada da playlist.'); }
        finally { scheduled.delete(item.key); }
      }
    } finally { running = false; }
  }
  async function all() {
    await recover();
    const tracks = await getTracks();
    const byVideo = new Map(tracks.map(track => [track.videoId || track.id, track]));
    const byId = new Map(tracks.map(track => [track.id, track]));
    return (await store.all()).map(playlist => {
      const copy = structuredClone(playlist);
      for (const entry of copy.entries) {
        const track = entry.videoId && byVideo.get(entry.videoId) || entry.trackId && byId.get(entry.trackId);
        if (track) { entry.status = 'done'; entry.trackId = track.id; entry.error = null; entry.errorCode = null; }
        else if (entry.status === 'done') { entry.status = 'pending'; entry.stage = 'Arquivo não está mais no acervo'; }
        const job = entry.jobId && getJob(entry.jobId);
        if (activeStates.has(entry.status) && job) { entry.stage = job.stage; entry.progress = job.progress; }
      }
      copy.summary = { total: copy.entries.length, done: 0, failed: 0, active: 0, pending: 0 };
      for (const entry of copy.entries) {
        if (entry.status === 'done') copy.summary.done++;
        else if (entry.status === 'error') copy.summary.failed++;
        else if (activeStates.has(entry.status)) copy.summary.active++;
        else copy.summary.pending++;
      }
      return copy;
    });
  }
  async function report(id) {
    const playlist = (await all()).find(value => value.id === id);
    if (!playlist) throw fail('Playlist não encontrada.', 404);
    return { name: playlist.name, sourceUrl: playlist.sourceUrl, sourceTotal: playlist.sourceTotal, warnings: playlist.warnings || [], summary: playlist.summary,
      entries: playlist.entries.map((entry, index) => ({ position: index + 1, title: entry.title, artist: entry.artist, status: entry.status || 'pending', reason: entry.error || '', sourceUrl: entry.sourceUrl || '', videoId: entry.videoId || null })) };
  }
  return { preview, importList, start, all, report };
}
