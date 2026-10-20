package br.com.acervo.app;

import android.content.Context;
import android.util.AtomicFile;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** Device-side API for the same web interface that is served by the PC. */
public final class PhoneApi {
    private static final Map<String, PhoneApi> INSTANCES = new HashMap<>();
    public static final class Response {
        public final int status;
        public final String mime;
        public final byte[] body;
        public Response(int status, String mime, byte[] body) { this.status = status; this.mime = mime; this.body = body; }
        public Response(int status, JSONObject value) { this(status, "application/json", value.toString().getBytes(StandardCharsets.UTF_8)); }
    }
    private final Context context;
    private final File files;
    private final MobileLibrary library;
    private final AtomicFile playlistFile;
    private JSONArray playlists = new JSONArray();
    private final Map<String, JSONObject> jobs = new LinkedHashMap<>();
    private final Map<String, JSONObject> previews = new LinkedHashMap<>();
    private final ThreadPoolExecutor downloads = new ThreadPoolExecutor(2, 2, 30, TimeUnit.SECONDS, new ArrayBlockingQueue<>(64));

    /** One owner of mutable playlists and jobs for the lifetime of this app process. */
    public static synchronized PhoneApi instance(Context host) throws IOException {
        String key = host.getFilesDir().getCanonicalPath();
        PhoneApi found = INSTANCES.get(key);
        if (found == null) { found = new PhoneApi(host); INSTANCES.put(key, found); }
        return found;
    }
    private PhoneApi(Context host) throws IOException {
        context = host.getApplicationContext();
        files = context.getFilesDir();
        library = new MobileLibrary(context);
        downloads.allowCoreThreadTimeOut(true);
        playlistFile = new AtomicFile(new File(files, "mobile-playlists.json"));
        if (playlistFile.getBaseFile().exists() || new File(playlistFile.getBaseFile() + ".bak").exists()) {
            try {
                byte[] saved;
                try (InputStream input = playlistFile.openRead()) { saved = MobileLibrary.readLimited(input, 8 * 1024 * 1024); }
                playlists = new JSONObject(new String(saved, StandardCharsets.UTF_8)).getJSONArray("playlists");
                // Work interrupted by process death becomes explicitly retryable.
                for (int p = 0; p < playlists.length(); p++) {
                    JSONArray entries = playlists.getJSONObject(p).getJSONArray("entries");
                    for (int i = 0; i < entries.length(); i++) {
                        JSONObject entry = entries.getJSONObject(i);
                        if ("queued".equals(entry.optString("status")) || "working".equals(entry.optString("status"))) {
                            entry.put("status", "error").put("error", "Download interrompido. Toque em Tentar pendentes.");
                        }
                    }
                }
            } catch (Exception failure) { throw new IOException("Não foi possível ler as playlists do celular. Os arquivos foram preservados.", failure); }
        }
    }

    public MobileLibrary library() { return library; }
    /** A screen detaches, while the application-owned download queue continues. */
    public void close() { }

    /** This is only called after the WebView has checked its private origin and document key. */
    public Response handle(String method, String target, String text) {
        try {
            URI uri = new URI(target);
            if (uri.isAbsolute() && (!"https".equals(uri.getScheme()) || !"app.acervo.local".equals(uri.getHost())
                    || uri.getRawUserInfo() != null || uri.getPort() != -1)) return error(403, "Origem local inválida.");
            if (uri.getRawFragment() != null) return error(400, "Pedido inválido.");
            String path = uri.getPath();
            if (path == null || path.contains("..")) return error(400, "Pedido inválido.");
            if (text != null && text.length() > 1500000) return error(413, "Use um arquivo de até 1,5 MB.");
            JSONObject input = text == null || text.trim().isEmpty() ? new JSONObject() : new JSONObject(text);
            Map<String, String> query = query(uri.getRawQuery());
            if ("GET".equals(method)) {
                if ("/api/library".equals(path)) return json(200, new JSONObject().put("tracks", tracks(library.all())).put("stats", stats()));
                if ("/api/stats".equals(path)) return json(200, stats());
                if ("/api/health".equals(path)) return json(200, new JSONObject().put("ok", true).put("tracks", library.all().size()).put("local", true));
                if ("/api/search".equals(path)) {
                    String q = bounded(query.get("q"), 500);
                    if (q.isEmpty()) return error(422, "Digite uma música ou artista.");
                    return json(200, new JSONObject().put("query", q).put("results", songs(MobileSource.search(q))));
                }
                if ("/api/history".equals(path)) return json(200, new JSONObject().put("items", tracks(recentTracks())));
                if ("/api/playlists".equals(path)) { synchronized (this) { refreshEntries(); return json(200, new JSONObject().put("playlists", copy(playlists))); } }
                if (path.startsWith("/api/jobs/")) { synchronized (this) { JSONObject job = jobs.get(path.substring(10)); return job == null ? error(404, "Tarefa não encontrada.") : json(200, new JSONObject(job.toString())); } }
                if (path.matches("/api/track/[A-Za-z0-9_-]{11}")) {
                    MobileLibrary.Track track = library.get(path.substring(11));
                    return track == null ? error(404, "Faixa não encontrada.") : json(200, track(track));
                }
                if (path.matches("/api/recommend/[A-Za-z0-9_-]{11}")) return recommendations(path.substring(15));
                if (path.matches("/api/discover/[A-Za-z0-9_-]{11}")) return json(200, new JSONObject().put("seed", path.substring(14)).put("items", songs(MobileSource.related(path.substring(14)))));
                if ("/api/artist".equals(path)) return json(200, artist(bounded(query.get("name"), 256)));
                if ("/api/explore".equals(path)) return json(200, explore(query.get("section")));
                if (path.matches("/api/playlists/[A-Za-z0-9-]+/report")) return playlistReport(path.split("/")[3]);
            }
            if ("POST".equals(method)) {
                if ("/api/import".equals(path) || "/api/download".equals(path)) return enqueue(input);
                if ("/api/radio".equals(path)) return radio(input);
                if (path.matches("/api/track/[A-Za-z0-9_-]{11}/play")) {
                    String id = path.split("/")[3];
                    if (library.get(id) == null) return error(404, "Faixa não encontrada.");
                    library.recordPlayed(id);
                    return json(200, new JSONObject().put("ok", true).put("plays", library.get(id).plays).put("lastPlayedAt", iso(library.get(id).playedAt)));
                }
                if ("/api/playlist/resolve".equals(path)) return json(200, preview(input));
                if ("/api/playlists".equals(path)) return createPlaylist(input, false);
                if ("/api/playlists/import".equals(path)) {
                    JSONObject preview;
                    synchronized (this) { preview = previews.get(input.optString("previewId")); }
                    if (preview == null) preview = preview(input);
                    return createPlaylist(preview, true);
                }
                if (path.matches("/api/playlists/[A-Za-z0-9-]+/import")) {
                    JSONObject playlist;
                    synchronized (this) { playlist = playlist(path.split("/")[3]); }
                    if (playlist == null) return error(404, "Playlist não encontrada.");
                    int total = startPlaylist(playlist);
                    return json(202, new JSONObject().put("playlist", new JSONObject(playlist.toString())).put("total", total));
                }
            }
            if ("DELETE".equals(method)) {
                if (path.matches("/api/track/[A-Za-z0-9_-]{11}")) {
                    String id = path.substring(11);
                    if (library.get(id) == null) return error(404, "Faixa não encontrada.");
                    library.remove(id);
                    return json(200, new JSONObject().put("ok", true));
                }
                if (path.matches("/api/playlists/[A-Za-z0-9-]+")) {
                    synchronized (this) {
                        String id = path.split("/")[3]; JSONArray replacement = new JSONArray(); boolean removed = false;
                        for (int i = 0; i < playlists.length(); i++) { JSONObject p = playlists.getJSONObject(i); if (id.equals(p.optString("id"))) removed = true; else replacement.put(p); }
                        if (removed) { JSONArray old = playlists; playlists = replacement; try { persistPlaylists(); } catch (Exception failure) { playlists = old; throw failure; } }
                        return json(removed ? 200 : 404, new JSONObject().put("removed", removed));
                    }
                }
            }
            return error(404, "Este recurso não está disponível no modo do celular.");
        } catch (Exception failure) { return error(422, message(failure)); }
    }

    private JSONObject stats() throws Exception {
        long duration = 0; Set<String> artists = new HashSet<>(); List<MobileLibrary.Track> all = library.all();
        for (MobileLibrary.Track track : all) { duration += track.duration; artists.add(track.artist.toLowerCase(Locale.ROOT)); }
        return new JSONObject().put("tracks", all.size()).put("artists", artists.size()).put("duration", duration).put("avgLufs", JSONObject.NULL);
    }
    private JSONObject track(MobileLibrary.Track value) throws Exception {
        boolean cover = false;
        try { File cached = MobileArtworkCache.fileFor(files, value.thumbnail); cover = cached.isFile() && cached.length() > 0; } catch (Exception ignored) { }
        return new JSONObject().put("id", value.id).put("videoId", value.id).put("title", value.title).put("artist", value.artist)
                .put("duration", value.duration).put("thumbnail", value.thumbnail).put("hasCover", cover).put("local", true)
                .put("addedAt", iso(value.savedAt)).put("lastPlayedAt", value.playedAt > 0 ? iso(value.playedAt) : JSONObject.NULL)
                .put("plays", value.plays).put("tags", new JSONArray());
    }
    private JSONArray tracks(List<MobileLibrary.Track> all) throws Exception { JSONArray result = new JSONArray(); for (MobileLibrary.Track item : all) result.put(track(item)); return result; }
    private static JSONObject song(MobileSource.Song item) throws Exception {
        return new JSONObject().put("videoId", item.id).put("title", item.title).put("artist", item.artist).put("channel", item.artist)
                .put("thumbnail", item.thumbnail).put("duration", item.duration).put("url", "https://www.youtube.com/watch?v=" + item.id);
    }
    private static JSONArray songs(List<MobileSource.Song> all) throws Exception { JSONArray result = new JSONArray(); for (MobileSource.Song item : all) result.put(song(item)); return result; }
    private List<MobileLibrary.Track> recentTracks() {
        List<MobileLibrary.Track> values = library.all(); values.removeIf(track -> track.playedAt <= 0);
        values.sort((a, b) -> Long.compare(b.playedAt, a.playedAt)); return values;
    }
    private Response recommendations(String id) throws Exception {
        MobileLibrary.Track seed = library.get(id); if (seed == null) return error(404, "Faixa não encontrada.");
        List<MobileLibrary.Track> all = library.all(); all.removeIf(track -> track.id.equals(id));
        all.sort((a, b) -> Boolean.compare(b.artist.equalsIgnoreCase(seed.artist), a.artist.equalsIgnoreCase(seed.artist)));
        JSONArray items = new JSONArray();
        for (MobileLibrary.Track value : all.subList(0, Math.min(8, all.size()))) {
            String reason = value.artist.equalsIgnoreCase(seed.artist) ? "Mesmo artista no seu acervo" : "Na sua biblioteca do celular";
            items.put(new JSONObject().put("track", track(value)).put("because", reason).put("reasons", new JSONArray().put(reason)).put("score", value.artist.equalsIgnoreCase(seed.artist) ? 100 : 20));
        }
        return json(200, new JSONObject().put("seed", id).put("items", items));
    }

    private Response enqueue(JSONObject input) throws Exception {
        String id = input.optString("videoId");
        if (id.isEmpty()) id = MobileSource.videoId(input.optString("url"));
        String query = bounded(input.optString("query"), 500);
        if ((id == null || !id.matches("[A-Za-z0-9_-]{11}")) && query.isEmpty()) return error(422, "Pesquise uma música e escolha a versão para baixar.");
        JSONObject job;
        synchronized (this) {
            for (JSONObject previous : jobs.values()) if (((id != null && id.equals(previous.optString("videoId"))) || (!query.isEmpty() && query.equals(previous.optString("query")))) &&
                    ("queued".equals(previous.optString("status")) || "working".equals(previous.optString("status")) ||
                    ("done".equals(previous.optString("status")) && library.get(previous.optString("videoId")) != null)))
                return json(202, new JSONObject().put("jobId", previous.getString("id")).put("status", previous.optString("status")));
            trimJobs();
            String jobId = UUID.randomUUID().toString();
            job = new JSONObject().put("id", jobId).put("videoId", id == null ? JSONObject.NULL : id).put("query", query).put("status", "queued").put("progress", 0).put("stage", "Na fila");
            jobs.put(jobId, job);
        }
        final String videoId = id; final JSONObject metadata = input.optJSONObject("meta");
        try { downloads.execute(() -> {
            try {
                String resolvedId = videoId; JSONObject selectedMetadata = metadata;
                if (resolvedId == null || !resolvedId.matches("[A-Za-z0-9_-]{11}")) {
                    synchronized (PhoneApi.this) { job.put("status", "working").put("stage", "Buscando música"); }
                    List<MobileSource.Song> matches = MobileSource.search(query);
                    if (matches.isEmpty()) throw new IOException("Nenhuma música encontrada para esta busca.");
                    MobileSource.Song first = matches.get(0); resolvedId = first.id;
                    synchronized (PhoneApi.this) { job.put("videoId", resolvedId); }
                    if (selectedMetadata == null) selectedMetadata = song(first);
                }
                download(job, resolvedId, selectedMetadata);
            } catch (Exception failure) {
                synchronized (PhoneApi.this) { try { job.put("status", "error").put("error", message(failure)).put("stage", "Não baixada"); updatePlaylistJobs(); } catch (Exception ignored) { } }
            }
        }); }
        catch (java.util.concurrent.RejectedExecutionException full) { synchronized (this) { jobs.remove(job.optString("id")); } return error(429, "A fila está cheia. Aguarde alguns downloads."); }
        return json(202, new JSONObject().put("jobId", job.getString("id")).put("status", "queued"));
    }
    private synchronized void trimJobs() throws IOException {
        if (jobs.size() < 128) return;
        java.util.Iterator<Map.Entry<String, JSONObject>> iterator = jobs.entrySet().iterator();
        while (iterator.hasNext() && jobs.size() >= 128) { String status = iterator.next().getValue().optString("status"); if ("done".equals(status) || "error".equals(status)) iterator.remove(); }
        if (jobs.size() >= 128) throw new IOException("A fila de downloads está cheia.");
    }
    private void download(JSONObject job, String id, JSONObject meta) {
        try {
            MobileLibrary.Track saved = library.get(id);
            if (saved == null) {
                synchronized (this) { job.put("status", "working").put("stage", "Preparando áudio").put("progress", 2); }
                MobileSource.Song resolved = MobileSource.resolve(id);
                String title = meta == null ? resolved.title : bounded(meta.optString("title", resolved.title), 512);
                String artist = meta == null ? resolved.artist : bounded(meta.optString("artist", meta.optString("channel", resolved.artist)), 256);
                if (title.isEmpty()) title = resolved.title;
                if (artist.isEmpty()) artist = resolved.artist;
                MobileSource.Song selected = new MobileSource.Song(resolved.id, title, artist, resolved.thumbnail, resolved.url, resolved.duration, resolved.extension, resolved.mime);
                saved = library.download(selected, (received, total) -> {
                    synchronized (PhoneApi.this) { try { job.put("stage", "Baixando no celular").put("progress", total > 0 ? Math.min(99, received * 100 / total) : 10); } catch (Exception ignored) { } }
                });
                cacheCover(saved.thumbnail);
            }
            synchronized (this) { job.put("status", "done").put("stage", "No celular").put("progress", 100).put("trackId", saved.id).put("track", track(saved)); updatePlaylistJobs(); }
        } catch (Exception failure) {
            synchronized (this) { try { job.put("status", "error").put("error", message(failure)).put("stage", "Não baixada"); updatePlaylistJobs(); } catch (Exception ignored) { } }
        }
    }
    private void cacheCover(String thumbnail) {
        if (thumbnail == null || thumbnail.isEmpty()) return;
        HttpURLConnection connection = null;
        try {
            File cached = MobileArtworkCache.fileFor(files, thumbnail); if (cached.isFile() && cached.length() > 0) return;
            connection = MobileLibrary.openHttps(thumbnail);
            String type = connection.getContentType(); if (type == null || !type.toLowerCase(Locale.ROOT).startsWith("image/")) return;
            try (InputStream input = connection.getInputStream()) { MobileArtworkCache.store(files, thumbnail, input); }
        } catch (Exception ignored) { } finally { if (connection != null) connection.disconnect(); }
    }

    private Response radio(JSONObject input) throws Exception {
        List<MobileSource.Song> found; JSONArray seeds = new JSONArray();
        String seedId = input.optString("seedId"), query = bounded(input.optString("query"), 160);
        if (!query.isEmpty()) found = MobileSource.search(query);
        else {
            MobileLibrary.Track seed = library.get(seedId); if (seed == null) seed = library.recent();
            if (seed == null) return error(422, "Escolha uma música ou digite um artista para iniciar a rádio.");
            seeds.put(track(seed)); found = MobileSource.related(seed.id);
        }
        Set<String> excluded = new HashSet<>(); JSONArray values = input.optJSONArray("excludeIds");
        if (values != null) for (int i = 0; i < Math.min(1000, values.length()); i++) excluded.add(values.optString(i));
        JSONArray items = new JSONArray(); int limit = Math.max(1, Math.min(24, input.optInt("limit", 18)));
        for (MobileSource.Song item : found) if (!excluded.contains(item.id)) { items.put(song(item).put("because", query.isEmpty() ? "Relacionada à sua referência" : "A partir da sua busca")); if (items.length() >= limit) break; }
        String frames = frame("start", new JSONObject().put("seeds", seeds)) + frame("results", new JSONObject().put("items", items)) + frame("done", new JSONObject().put("warnings", new JSONArray()));
        return new Response(200, "text/event-stream", frames.getBytes(StandardCharsets.UTF_8));
    }
    private static String frame(String event, JSONObject value) { return "event: " + event + "\ndata: " + value + "\n\n"; }

    private JSONObject artist(String name) throws Exception {
        if (name.isEmpty()) throw new IOException("Escolha um artista.");
        List<MobileLibrary.Track> local = new ArrayList<>(); for (MobileLibrary.Track track : library.all()) if (name.equalsIgnoreCase(track.artist)) local.add(track);
        MobileArtistCatalog.Profile profile = MobileArtistCatalog.saved(files, name);
        if (profile == null) try { profile = MobileArtistCatalog.fetch(files, name, local); } catch (Exception ignored) { }
        JSONArray top = new JSONArray(), albums = new JSONArray();
        if (profile != null) {
            for (String title : profile.titles) top.put(new JSONObject().put("title", title).put("artist", name));
            for (MobileArtistCatalog.Album album : profile.albums) albums.put(new JSONObject().put("title", album.title).put("artist", name).put("thumbnail", album.picture).put("releaseDate", album.date));
        }
        return new JSONObject().put("name", name).put("localTracks", tracks(local)).put("catalogMatched", profile != null)
                .put("picture", profile == null ? "" : profile.picture).put("sourceUrl", profile == null ? "" : profile.source)
                .put("topTracks", top).put("albums", albums).put("relatedArtists", new JSONArray()).put("warnings", new JSONArray());
    }
    private JSONObject explore(String section) throws Exception {
        JSONArray items = new JSONArray(); String description = ""; JSONArray warnings = new JSONArray();
        if ("recent".equals(section)) { items = tracks(recentTracks()); description = "As músicas que você ouviu neste celular."; }
        else if ("releases".equals(section)) {
            long cutoff = System.currentTimeMillis() - TimeUnit.DAYS.toMillis(90); Set<String> known = new HashSet<>();
            for (MobileLibrary.Track value : library.all()) if (known.size() < 12 && known.add(value.artist.toLowerCase(Locale.ROOT))) {
                MobileArtistCatalog.Profile profile = MobileArtistCatalog.saved(files, value.artist);
                if (profile == null) continue;
                for (MobileArtistCatalog.Album album : profile.albums) {
                    try { long date = java.time.LocalDate.parse(album.date).atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toEpochMilli();
                        if (date >= cutoff && date <= System.currentTimeMillis()) items.put(new JSONObject().put("title", album.title).put("artist", value.artist).put("thumbnail", album.picture).put("releaseDate", album.date).put("kind", "album"));
                    } catch (Exception ignored) { }
                }
            }
            description = "Lançamentos confirmados nos perfis já consultados neste celular.";
        } else {
            MobileLibrary.Track seed = library.recent();
            if (seed != null) {
                try { items = songs(MobileSource.related(seed.id)); description = "Descobertas a partir de " + seed.title + "."; }
                catch (Exception failure) { items = tracks(library.all()); description = "Sua coleção salva neste celular."; warnings.put("Sem conexão com a fonte. Você pode ouvir as músicas salvas."); }
            }
        }
        return new JSONObject().put("items", items).put("description", description).put("warnings", warnings).put("artists", new JSONArray())
                .put("emptyReason", "Busque e salve músicas, ou abra um artista para conhecer sua discografia.");
    }

    private JSONObject preview(JSONObject input) throws Exception {
        JSONArray entries = input.optJSONArray("entries"); String title = bounded(input.optString("title", input.optString("name", "Playlist do celular")), 160);
        if (entries == null) {
            String text = input.optString("fileText");
            if (text.isEmpty()) throw new IOException("No modo do celular, importe uma lista CSV/JSON. Para links de playlists, conecte ao Acervo do PC.");
            String trimmed = text.trim(); if (trimmed.startsWith("\ufeff")) trimmed = trimmed.substring(1).trim();
            if (trimmed.startsWith("{")) {
                JSONArray lists = new JSONObject(trimmed).optJSONArray("playlists");
                if (lists != null && lists.length() > 1 && !input.has("playlistIndex")) {
                    JSONArray choices = new JSONArray();
                    for (int i = 0; i < Math.min(200, lists.length()); i++) {
                        JSONObject list = lists.optJSONObject(i); if (list == null) continue;
                        JSONArray songs = list.optJSONArray("items"); if (songs == null) songs = list.optJSONArray("tracks"); if (songs == null) songs = list.optJSONArray("entries");
                        choices.put(new JSONObject().put("index", i).put("name", bounded(list.optString("name", "Playlist " + (i + 1)), 160)).put("count", songs == null ? 0 : songs.length()));
                    }
                    return new JSONObject().put("choices", choices);
                }
                if (lists != null && input.optInt("playlistIndex", 0) >= 0 && input.optInt("playlistIndex", 0) < lists.length())
                    title = bounded(lists.getJSONObject(input.optInt("playlistIndex", 0)).optString("name", title), 160);
            }
            entries = PhonePlaylistParser.parse(text, input.optInt("playlistIndex", 0));
        }
        JSONArray clean = PhonePlaylistParser.sanitize(entries);
        if (clean.length() == 0) throw new IOException("A lista não contém músicas com título e artista ou identificador do YouTube.");
        String id = UUID.randomUUID().toString();
        JSONObject value = new JSONObject().put("previewId", id).put("title", title).put("provider", "file").put("entries", clean).put("total", clean.length()).put("warnings", new JSONArray());
        synchronized (this) { if (previews.size() >= 8) previews.remove(previews.keySet().iterator().next()); previews.put(id, value); }
        return value;
    }
    private synchronized Response createPlaylist(JSONObject input, boolean start) throws Exception {
        JSONArray entries = PhonePlaylistParser.sanitize(input.optJSONArray("entries"));
        if (entries.length() == 0 || playlists.length() >= 200) return error(422, "Use uma lista com músicas e até 200 playlists no celular.");
        for (int i = 0; i < entries.length(); i++) entries.getJSONObject(i).put("id", UUID.randomUUID().toString()).put("status", "pending");
        JSONObject value = new JSONObject().put("id", UUID.randomUUID().toString()).put("name", bounded(input.optString("title", input.optString("name", "Playlist do celular")), 160))
                .put("provider", "file").put("sourceUrl", "").put("createdAt", iso(System.currentTimeMillis())).put("entries", entries).put("warnings", new JSONArray());
        playlists.put(value); try { persistPlaylists(); } catch (Exception failure) { playlists.remove(playlists.length() - 1); throw failure; }
        int total = start ? startPlaylist(value) : entries.length();
        return json(start ? 202 : 201, new JSONObject().put("playlist", new JSONObject(value.toString())).put("total", total));
    }
    private synchronized int startPlaylist(JSONObject playlist) throws Exception {
        JSONArray entries = playlist.getJSONArray("entries"); int total = 0;
        for (int i = 0; i < entries.length(); i++) {
            JSONObject entry = entries.getJSONObject(i); String id = entry.optString("videoId");
            if (!id.isEmpty() && library.get(id) != null) { entry.put("trackId", id).put("status", "done"); continue; }
            if ("queued".equals(entry.optString("status")) || "working".equals(entry.optString("status"))) continue;
            if (downloads.getQueue().remainingCapacity() == 0) { entry.put("status", "error").put("error", "Fila cheia. Tente pendentes depois dos downloads."); continue; }
            entry.put("status", "queued").put("error", ""); total++;
            try { downloads.execute(() -> {
                try {
                    String video; JSONObject metadata;
                    synchronized (PhoneApi.this) { video = entry.optString("videoId"); metadata = new JSONObject(entry.toString()); }
                    if (video.isEmpty()) {
                        synchronized (PhoneApi.this) { entry.put("status", "matching"); }
                        List<MobileSource.Song> matches = MobileSource.search(metadata.optString("title") + " " + metadata.optString("artist"));
                        MobileSource.Song best = null; double bestScore = 0;
                        for (MobileSource.Song candidate : matches) {
                            double score = PhonePlaylistMatch.score(metadata.optString("title"), metadata.optString("artist"), metadata.optLong("duration"), candidate.title, candidate.artist, candidate.duration);
                            if (score > bestScore) { best = candidate; bestScore = score; }
                        }
                        if (best == null || bestScore < .78) throw new IOException("Não foi encontrada uma versão compatível com o título e artista. Busque outra versão.");
                        video = best.id;
                        synchronized (PhoneApi.this) { entry.put("videoId", video); }
                    }
                    JSONObject job = new JSONObject().put("id", UUID.randomUUID().toString()).put("videoId", video).put("status", "working");
                    synchronized (PhoneApi.this) { trimJobs(); jobs.put(job.getString("id"), job); entry.put("jobId", job.getString("id")).put("status", "working"); persistPlaylists(); }
                    download(job, video, metadata);
                } catch (Exception failure) { synchronized (PhoneApi.this) { try { entry.put("status", "error").put("error", message(failure)); persistPlaylists(); } catch (Exception ignored) { } } }
            }); } catch (java.util.concurrent.RejectedExecutionException full) { total--; entry.put("status", "error").put("error", "Fila cheia. Tente pendentes depois dos downloads."); }
        }
        synchronized (this) { persistPlaylists(); }
        return total;
    }
    private synchronized void refreshEntries() throws Exception {
        for (int p = 0; p < playlists.length(); p++) {
            JSONArray entries = playlists.getJSONObject(p).getJSONArray("entries");
            for (int i = 0; i < entries.length(); i++) {
                JSONObject entry = entries.getJSONObject(i); String id = entry.optString("videoId");
                if (library.get(id) != null) entry.put("trackId", id).put("status", "done");
                else if ("done".equals(entry.optString("status"))) entry.put("status", "pending").remove("trackId");
            }
        }
    }
    private synchronized void updatePlaylistJobs() throws Exception {
        for (int p = 0; p < playlists.length(); p++) {
            JSONArray entries = playlists.getJSONObject(p).getJSONArray("entries");
            for (int i = 0; i < entries.length(); i++) {
                JSONObject entry = entries.getJSONObject(i), job = jobs.get(entry.optString("jobId"));
                if (job == null) continue;
                for (String key : new String[] { "status", "trackId", "progress", "stage", "error" }) if (job.has(key)) entry.put(key, job.get(key));
            }
        }
        persistPlaylists();
    }
    private synchronized JSONObject playlist(String id) throws Exception { for (int i = 0; i < playlists.length(); i++) if (id.equals(playlists.getJSONObject(i).optString("id"))) return playlists.getJSONObject(i); return null; }
    private synchronized Response playlistReport(String id) throws Exception {
        refreshEntries(); JSONObject playlist = playlist(id); if (playlist == null) return error(404, "Playlist não encontrada.");
        JSONArray source = playlist.getJSONArray("entries"), entries = new JSONArray(); int done = 0, failed = 0, active = 0;
        for (int i = 0; i < source.length(); i++) {
            JSONObject entry = source.getJSONObject(i); String status = entry.optString("status");
            if ("done".equals(status)) done++; else if ("error".equals(status)) failed++; else if (!"pending".equals(status)) active++;
            entries.put(new JSONObject().put("position", i + 1).put("title", entry.optString("title")).put("artist", entry.optString("artist")).put("status", status).put("reason", entry.optString("error")));
        }
        return json(200, new JSONObject().put("name", playlist.optString("name")).put("entries", entries).put("warnings", new JSONArray())
                .put("summary", new JSONObject().put("done", done).put("failed", failed).put("active", active)));
    }
    private synchronized void persistPlaylists() throws IOException {
        FileOutputStream output = null;
        try { output = playlistFile.startWrite(); output.write(new JSONObject().put("version", 1).put("playlists", playlists).toString().getBytes(StandardCharsets.UTF_8)); playlistFile.finishWrite(output); }
        catch (Exception failure) { if (output != null) playlistFile.failWrite(output); throw new IOException("Não foi possível guardar a playlist.", failure); }
    }
    private static Map<String, String> query(String text) throws Exception {
        Map<String, String> result = new HashMap<>(); if (text == null) return result;
        for (String part : text.split("&")) { String[] pair = part.split("=", 2); result.put(URLDecoder.decode(pair[0], "UTF-8"), pair.length == 2 ? URLDecoder.decode(pair[1], "UTF-8") : ""); }
        return result;
    }
    private static String bounded(String text, int maximum) { if (text == null) return ""; text = text.replaceAll("[\\p{Cntrl}&&[^\\n\\t]]", "").trim(); return text.substring(0, Math.min(maximum, text.length())); }
    private static String iso(long millis) { return java.time.Instant.ofEpochMilli(millis).toString(); }
    private static JSONArray copy(JSONArray array) throws Exception { return new JSONArray(array.toString()); }
    private static Response json(int status, JSONObject value) { return new Response(status, value); }
    private static Response error(int status, String message) { try { return json(status, new JSONObject().put("error", message)); } catch (Exception impossible) { return new Response(status, "application/json", "{\"error\":\"Falha no celular.\"}".getBytes(StandardCharsets.UTF_8)); } }
    private static String message(Exception failure) { String text = failure.getMessage(); return text == null || text.trim().isEmpty() ? "Não foi possível concluir. Confira a internet e tente novamente." : text; }
}
