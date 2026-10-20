package br.com.acervo.app;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.IOException;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Imports local track lists without sending the user's file to any server. */
final class PhonePlaylistParser {
    private PhonePlaylistParser() { }
    static JSONArray parse(String text, int playlistIndex) throws Exception {
        if (text == null || text.length() > 1500000) throw new IOException("Use um arquivo de até 1,5 MB.");
        String value = text.trim(); if (value.startsWith("\ufeff")) value = value.substring(1).trim();
        if (value.startsWith("[")) return sanitize(new JSONArray(value));
        if (value.startsWith("{")) {
            JSONObject object = new JSONObject(value);
            JSONArray playlists = object.optJSONArray("playlists");
            if (playlists != null) {
                if (playlistIndex < 0 || playlistIndex >= playlists.length()) throw new IOException("Escolha uma playlist válida do arquivo.");
                object = playlists.getJSONObject(playlistIndex);
            }
            JSONArray entries = object.optJSONArray("entries"); if (entries == null) entries = object.optJSONArray("items"); if (entries == null) entries = object.optJSONArray("tracks");
            if (entries == null) throw new IOException("O JSON precisa conter uma lista tracks, entries ou items.");
            return sanitize(entries);
        }
        List<List<String>> rows = PhonePlaylistCsv.parse(text); if (rows.size() < 2) throw new IOException("O CSV precisa de cabeçalho e pelo menos uma música.");
        List<String> header = rows.get(0); int title = column(header, "track name", "title", "titulo", "nome da musica", "name");
        int artist = column(header, "artist name(s)", "artist name", "artist", "artists", "artista");
        int id = column(header, "videoid", "video id", "youtube id", "url", "youtube url");
        int duration = column(header, "duration", "duration (ms)", "duration ms", "duration_ms", "duracao");
        if (title < 0 && id < 0) throw new IOException("CSV sem coluna de título ou identificador do YouTube.");
        JSONArray result = new JSONArray();
        for (int i = 1; i < rows.size(); i++) {
            List<String> row = rows.get(i); JSONObject item = new JSONObject().put("title", cell(row, title)).put("artist", cell(row, artist)).put("videoId", cell(row, id));
            try { double seconds = Double.parseDouble(cell(row, duration)); if (duration >= 0 && fold(header.get(duration)).contains("ms")) seconds /= 1000; item.put("duration", Math.round(seconds)); } catch (NumberFormatException ignored) { }
            result.put(item);
        }
        return sanitize(result);
    }
    static JSONArray sanitize(JSONArray values) throws Exception {
        if (values == null) throw new IOException("A playlist precisa conter uma lista de músicas.");
        if (values.length() > 1000) throw new IOException("Use uma lista com até 1000 músicas.");
        JSONArray result = new JSONArray();
        for (int i = 0; i < values.length(); i++) {
            JSONObject item = values.optJSONObject(i); if (item == null) continue;
            JSONObject track = item.optJSONObject("track"); if (track != null) item = track;
            String title = text(item.optString("title", item.optString("trackName", item.optString("name"))), 512);
            String artist = text(item.optString("artist", item.optString("artistName")), 256);
            JSONArray artists = item.optJSONArray("artists");
            if (artist.isEmpty() && artists != null) {
                List<String> names = new ArrayList<>(); for (int a = 0; a < Math.min(12, artists.length()); a++) { JSONObject named = artists.optJSONObject(a); String name = named == null ? artists.optString(a) : named.optString("name"); if (!name.isEmpty()) names.add(name); }
                artist = text(String.join(", ", names), 256);
            }
            String id = MobileSource.videoId(item.optString("videoId", item.optString("url"))); if (id == null) id = "";
            if (title.isEmpty() && id.isEmpty()) continue;
            String thumbnail = item.optString("thumbnail");
            try { java.net.URI uri = new java.net.URI(thumbnail); if (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null) thumbnail = ""; } catch (Exception ignored) { thumbnail = ""; }
            long seconds = item.optLong("duration", item.optLong("duration_ms") / 1000);
            result.put(new JSONObject().put("title", title.isEmpty() ? "Música do YouTube" : title).put("artist", artist).put("videoId", id)
                    .put("duration", Math.max(0, Math.min(86400, seconds))).put("thumbnail", thumbnail));
        }
        return result;
    }
    private static int column(List<String> header, String... options) { for (int i = 0; i < header.size(); i++) for (String option : options) if (fold(header.get(i)).equals(fold(option))) return i; return -1; }
    private static String cell(List<String> row, int index) { return index < 0 || index >= row.size() ? "" : row.get(index); }
    private static String fold(String value) { return Normalizer.normalize(value, Normalizer.Form.NFD).replaceAll("\\p{M}", "").trim().toLowerCase(Locale.ROOT); }
    private static String text(String value, int maximum) { value = value.replaceAll("[\\p{Cntrl}&&[^\\n\\t]]", "").trim(); return value.substring(0, Math.min(maximum, value.length())); }
}
