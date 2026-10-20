package br.com.acervo.app;

import android.util.AtomicFile;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;

/** Optional public catalog metadata. Saved artist pages remain available without the PC. */
public final class MobileArtistCatalog {
    public static final class Album {
        public final String title, picture, date;
        Album(JSONObject value) { title = value.optString("title"); picture = image(value.optString("cover_big")); date = value.optString("release_date"); }
    }
    public static final class Profile {
        public final String picture, source;
        public final List<String> titles = new ArrayList<>();
        public final List<Album> albums = new ArrayList<>();
        Profile(JSONObject value) {
            picture = image(value.optString("picture"));
            source = value.optString("source");
            JSONArray top = value.optJSONArray("titles"), list = value.optJSONArray("albums");
            if (top != null) for (int i = 0; i < Math.min(10, top.length()); i++) titles.add(top.optString(i));
            if (list != null) for (int i = 0; i < Math.min(12, list.length()); i++) { JSONObject album = list.optJSONObject(i); if (album != null) albums.add(new Album(album)); }
        }
    }
    private MobileArtistCatalog() { }
    private static String fold(String value) { return Normalizer.normalize(value == null ? "" : value, Normalizer.Form.NFKC).toLowerCase(java.util.Locale.ROOT).replaceAll("\\s+", " ").trim(); }
    private static String image(String value) {
        try {
            java.net.URI uri = new java.net.URI(value);
            return "https".equals(uri.getScheme()) && "cdn-images.dzcdn.net".equals(uri.getHost()) && uri.getUserInfo() == null
                    && uri.getPort() == -1 && uri.getPath().matches("/images/(artist|cover)/[a-fA-F0-9]{32}/.*") ? value : "";
        } catch (Exception ignored) { return ""; }
    }
    private static AtomicFile cache(File directory, String name) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(fold(name).getBytes(StandardCharsets.UTF_8));
        StringBuilder key = new StringBuilder(); for (byte part : digest) key.append(String.format(java.util.Locale.ROOT, "%02x", part & 255));
        File folder = new File(directory, "artist-catalog"); if (!folder.isDirectory()) folder.mkdirs();
        return new AtomicFile(new File(folder, key + ".json"));
    }
    public static Profile saved(File directory, String name) {
        try {
            AtomicFile file = cache(directory, name);
            if (file.getBaseFile().length() > 512 * 1024) return null;
            JSONObject value = new JSONObject(new String(file.readFully(), StandardCharsets.UTF_8));
            return fold(name).equals(value.optString("identity")) ? new Profile(value) : null;
        } catch (Exception ignored) { return null; }
    }
    private static JSONObject get(String path) throws Exception {
        HttpURLConnection connection = MobileLibrary.openHttps("https://api.deezer.com/" + path);
        try (InputStream input = connection.getInputStream()) {
            JSONObject result = new JSONObject(new String(MobileLibrary.readLimited(input, 512 * 1024), StandardCharsets.UTF_8));
            if (result.has("error")) throw new java.io.IOException("Catálogo indisponível.");
            return result;
        } finally { connection.disconnect(); }
    }
    public static Profile fetch(File directory, String name, List<MobileLibrary.Track> local) throws Exception {
        JSONArray found = get("search/artist?q=" + URLEncoder.encode(name, "UTF-8") + "&limit=8").optJSONArray("data");
        JSONObject artist = null;
        if (found != null) for (int i = 0; i < found.length(); i++) {
            JSONObject candidate = found.optJSONObject(i);
            if (candidate != null && fold(name).equals(fold(candidate.optString("name")))) {
                if (artist != null) return null;
                artist = candidate;
            }
        }
        if (artist == null || !artist.optString("id").matches("[0-9]{1,16}")) return null;
        String id = artist.optString("id");
        JSONArray top = get("artist/" + id + "/top?limit=10").optJSONArray("data");
        JSONArray titles = new JSONArray(); boolean evidence = local.isEmpty();
        if (top != null) for (int i = 0; i < top.length(); i++) {
            JSONObject track = top.optJSONObject(i); if (track == null) continue;
            String title = track.optString("title"); titles.put(title);
            for (MobileLibrary.Track own : local) if (fold(own.title).equals(fold(title))) evidence = true;
        }
        if (!evidence) return null;
        JSONArray albums = get("artist/" + id + "/albums?limit=12").optJSONArray("data");
        JSONObject value = new JSONObject().put("identity", fold(name)).put("picture", image(artist.optString("picture_big")))
                .put("source", "https://www.deezer.com/artist/" + id).put("titles", titles).put("albums", albums == null ? new JSONArray() : albums);
        AtomicFile file = cache(directory, name); FileOutputStream output = null;
        try { output = file.startWrite(); output.write(value.toString().getBytes(StandardCharsets.UTF_8)); file.finishWrite(output); }
        catch (Exception failure) { if (output != null) file.failWrite(output); }
        return new Profile(value);
    }
}
