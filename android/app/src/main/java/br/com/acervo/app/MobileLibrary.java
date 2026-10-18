package br.com.acervo.app;

import android.content.Context;
import android.util.AtomicFile;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** This device's private, offline library. No PC address or remote pairing is needed. */
public final class MobileLibrary {
    private static final long MAX_DOWNLOAD = 250L * 1024 * 1024;
    private static final long FREE_RESERVE = 32L * 1024 * 1024;
    private static final Map<String, Store> STORES = new HashMap<>();
    private final Store store;
    private final File audioFolder;
    private final AtomicFile metadata;
    private final List<Track> tracks;

    /** All activities and sync jobs share one state and write lock per app directory. */
    private static final class Store {
        final File audioFolder;
        final AtomicFile metadata;
        final List<Track> tracks = new ArrayList<>();
        Store(File files) {
            audioFolder = new File(files, "mobile-audio");
            metadata = new AtomicFile(new File(files, "mobile-library.json"));
        }
    }

    public interface Progress { void update(long received, long total); }

    public static final class Track {
        public final String id, title, artist, thumbnail, filename;
        public final long duration, savedAt, playedAt, plays;

        private Track(String id, String title, String artist, String thumbnail, String filename,
                long duration, long savedAt, long playedAt, long plays) {
            this.id = id;
            this.title = title;
            this.artist = artist;
            this.thumbnail = thumbnail;
            this.filename = filename;
            this.duration = duration;
            this.savedAt = savedAt;
            this.playedAt = playedAt;
            this.plays = plays;
        }

        private JSONObject json() throws Exception {
            JSONObject value = new JSONObject();
            value.put("id", id).put("title", title).put("artist", artist).put("thumbnail", thumbnail)
                    .put("filename", filename).put("duration", duration).put("savedAt", savedAt)
                    .put("playedAt", playedAt).put("plays", plays);
            return value;
        }
    }

    public MobileLibrary(Context context) throws IOException {
        String key = context.getFilesDir().getCanonicalPath();
        synchronized (STORES) {
            Store found = STORES.get(key);
            if (found == null) {
                found = new Store(new File(key));
                load(found);
                STORES.put(key, found);
            }
            store = found;
            audioFolder = found.audioFolder;
            metadata = found.metadata;
            tracks = found.tracks;
        }
    }

    private static void load(Store store) throws IOException {
        File audioFolder = store.audioFolder;
        AtomicFile metadata = store.metadata;
        if (!audioFolder.isDirectory() && !audioFolder.mkdirs()) throw new IOException("Não foi possível abrir a biblioteca do celular.");
        if (!metadata.getBaseFile().exists() && !new File(metadata.getBaseFile() + ".bak").exists()) return;
        try (InputStream input = metadata.openRead()) {
            JSONArray data = new JSONObject(new String(readLimited(input, 8 * 1024 * 1024), StandardCharsets.UTF_8)).getJSONArray("tracks");
            Set<String> seen = new HashSet<>();
            for (int i = 0; i < data.length(); i++) {
                JSONObject value = data.getJSONObject(i);
                String id = value.getString("id");
                String filename = value.getString("filename");
                if (!validId(id) || !filename.matches(java.util.regex.Pattern.quote(id) + "\\.[a-z0-9]{2,5}")) continue;
                File file = new File(audioFolder, filename);
                if (!file.isFile() || file.length() == 0 || !seen.add(id)) continue;
                store.tracks.add(new Track(id, value.optString("title", "Música"), value.optString("artist", ""),
                        value.optString("thumbnail", ""), filename, value.optLong("duration", 0),
                        value.optLong("savedAt", 0), value.optLong("playedAt", 0), value.optLong("plays", 0)));
            }
        } catch (Exception failure) {
            throw new IOException("Não foi possível ler a biblioteca salva. Os arquivos de áudio foram preservados.", failure);
        }
    }

    public List<Track> all() {
        synchronized (store) {
            List<Track> result = new ArrayList<>(tracks);
            Collections.sort(result, (a, b) -> Long.compare(b.savedAt, a.savedAt));
            return result;
        }
    }

    public Track get(String id) {
        synchronized (store) {
            for (Track track : tracks) if (track.id.equals(id)) return track;
            return null;
        }
    }

    public Track recent() {
        synchronized (store) {
            Track recent = null;
            for (Track track : tracks) {
                if (recent == null || track.playedAt > recent.playedAt
                        || (track.playedAt == recent.playedAt && track.savedAt > recent.savedAt)) recent = track;
            }
            return recent;
        }
    }

    public File file(Track track) { return new File(audioFolder, track.filename); }

    public void recordPlayed(String id) throws IOException {
        synchronized (store) {
            Track old = get(id);
            if (old == null) return;
            int index = tracks.indexOf(old);
            tracks.set(index, new Track(old.id, old.title, old.artist, old.thumbnail, old.filename,
                    old.duration, old.savedAt, System.currentTimeMillis(), old.plays + 1));
            try { persist(); } catch (IOException failure) { tracks.set(index, old); throw failure; }
        }
    }

    public void remove(String id) throws IOException {
        synchronized (store) {
            Track track = get(id);
            if (track == null) return;
            int index = tracks.indexOf(track);
            tracks.remove(index);
            try { persist(); } catch (IOException failure) { tracks.add(index, track); throw failure; }
            File audio = file(track);
            if (audio.exists() && !audio.delete()) throw new IOException("A música saiu da biblioteca, mas o arquivo não pôde ser removido.");
        }
    }

    public Track download(MobileSource.Song song, Progress progress) throws Exception {
        if (song == null || !validId(song.id)) throw new IOException("Música inválida para baixar.");
        Track existing = get(song.id);
        if (existing != null) return existing;
        String extension = song.extension == null ? "m4a" : song.extension.toLowerCase(java.util.Locale.US);
        if (!extension.matches("m4a|webm|ogg|opus|mp3|aac|mp4")) extension = "m4a";
        File destination = new File(audioFolder, song.id + "." + extension);
        File partial = File.createTempFile(song.id + "-", ".part", audioFolder);
        HttpURLConnection connection = null;
        boolean committed = false;
        try {
            connection = openHttps(song.url);
            String contentType = connection.getContentType();
            if (contentType != null) contentType = contentType.toLowerCase(java.util.Locale.US);
            if (contentType != null && (contentType.startsWith("text/") || contentType.contains("json"))) {
                throw new IOException("O serviço não retornou um arquivo de áudio. Tente novamente.");
            }
            long expected = connection.getContentLengthLong();
            if (expected > MAX_DOWNLOAD) throw new IOException("Este áudio ultrapassa o limite de 250 MB.");
            if (audioFolder.getUsableSpace() < FREE_RESERVE + Math.max(0, expected)) throw new IOException("Não há espaço suficiente no celular para baixar esta música.");
            long received = 0;
            long lastProgress = 0;
            long lastSpaceCheck = 0;
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(partial)) {
                byte[] buffer = new byte[32 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (Thread.currentThread().isInterrupted()) throw new IOException("Download interrompido.");
                    received += count;
                    if (received > MAX_DOWNLOAD) throw new IOException("Este áudio ultrapassa o limite de 250 MB.");
                    if (received - lastSpaceCheck >= 1024 * 1024) {
                        lastSpaceCheck = received;
                        if (audioFolder.getUsableSpace() < FREE_RESERVE) throw new IOException("O espaço livre do celular acabou durante o download.");
                    }
                    output.write(buffer, 0, count);
                    if (progress != null && (received - lastProgress >= 128 * 1024 || received == expected)) {
                        lastProgress = received;
                        progress.update(received, expected);
                    }
                }
                output.getFD().sync();
            }
            if (received == 0 || (expected >= 0 && received != expected)) throw new IOException("O download ficou incompleto. Tente novamente.");
            synchronized (store) {
                existing = get(song.id);
                if (existing != null) return existing;
                if (!partial.renameTo(destination)) throw new IOException("Não foi possível salvar o áudio no celular.");
                Track track = new Track(song.id, safe(song.title, "Música"), safe(song.artist, ""),
                        safe(song.thumbnail, ""), destination.getName(), song.duration, System.currentTimeMillis(), 0, 0);
                tracks.add(track);
                try { persist(); } catch (IOException failure) { tracks.remove(track); destination.delete(); throw failure; }
                committed = true;
                return track;
            }
        } finally {
            if (connection != null) connection.disconnect();
            if (!committed && partial.exists()) partial.delete();
        }
    }

    /** Every redirect is validated; an HTTPS audio or cover request cannot downgrade to HTTP. */
    static HttpURLConnection openHttps(String value) throws Exception {
        String current = value;
        for (int redirects = 0; redirects <= 5; redirects++) {
            URI uri = new URI(current);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getRawUserInfo() != null) {
                throw new IOException("O serviço retornou um endereço sem HTTPS válido.");
            }
            HttpURLConnection connection = (HttpURLConnection) new URL(current).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(20000);
            connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 13) AcervoAndroid/1.2");
            connection.setRequestProperty("Accept-Encoding", "identity");
            int status;
            try { status = connection.getResponseCode(); }
            catch (IOException failure) { connection.disconnect(); throw failure; }
            if (status == 200) return connection;
            if (status >= 300 && status <= 399) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null || redirects == 5) break;
                current = uri.resolve(location).toString();
                continue;
            }
            connection.disconnect();
            throw new IOException("O serviço de áudio respondeu " + status + ". Pesquise novamente e tente baixar de novo.");
        }
        throw new IOException("O serviço de áudio redirecionou a conexão muitas vezes.");
    }

    static byte[] readLimited(InputStream input, int maximum) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) != -1) {
            if (output.size() + count > maximum) throw new IOException("Arquivo maior do que o permitido.");
            output.write(buffer, 0, count);
        }
        return output.toByteArray();
    }

    private void persist() throws IOException {
        FileOutputStream output = null;
        try {
            JSONArray list = new JSONArray();
            for (Track track : tracks) list.put(track.json());
            JSONObject root = new JSONObject().put("version", 1).put("tracks", list);
            output = metadata.startWrite();
            output.write(root.toString().getBytes(StandardCharsets.UTF_8));
            metadata.finishWrite(output);
        } catch (Exception failure) {
            if (output != null) metadata.failWrite(output);
            throw new IOException("Não foi possível salvar os dados da biblioteca.", failure);
        }
    }

    private static boolean validId(String id) { return id != null && id.matches("[A-Za-z0-9_-]{11}"); }
    private static String safe(String text, String fallback) { return text == null || text.isEmpty() ? fallback : text; }
}
