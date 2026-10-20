package br.com.acervo.app;

import java.util.Map;

/** The phone-to-PC import contract must retain a downloaded song's metadata. */
public final class DeviceSyncMetadataTest {
    private static int checks;
    private static void check(boolean condition, String message) { checks++; if (!condition) throw new AssertionError(message); }
    @SuppressWarnings("unchecked")
    public static void main(String[] args) {
        String id = "aBcDeF123_-";
        String title = "Canção \"Ao Vivo\" · 東京";
        String artist = "Artista & Convidado";
        String thumbnail = "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg";
        Map<String, Object> payload = DeviceSync.importPayload(id, title, artist, 237, thumbnail);
        Map<String, Object> meta = (Map<String, Object>) payload.get("meta");
        check(id.equals(payload.get("videoId")), "The PC queues the original source identifier");
        check(title.equals(meta.get("title")), "A source title keeps Unicode and punctuation");
        check(artist.equals(meta.get("artist")), "The downloaded artist survives phone-to-PC synchronization");
        check(artist.equals(meta.get("channel")), "Legacy PC metadata readers retain the same artist");
        check(Long.valueOf(237).equals(meta.get("duration")), "The source duration survives synchronization");
        check(thumbnail.equals(meta.get("thumbnail")), "The source artwork URL survives synchronization");
        check(payload.size() == 2 && meta.size() == 5, "Private offline filenames, paths and listening history are never sent");
        Map<String, Object> missing = (Map<String, Object>) DeviceSync.importPayload(id, "", null, 0, " ").get("meta");
        check(missing.isEmpty(), "Missing metadata stays absent so the PC can resolve it from the source");
        Map<String, Object> partial = (Map<String, Object>) DeviceSync.importPayload(id, "Known title", "  ", -1, null).get("meta");
        check(partial.size() == 1 && "Known title".equals(partial.get("title")), "A title-only download does not fabricate an unknown artist or duration");
        boolean rejected = false;
        try { DeviceSync.importPayload("../track", title, artist, 237, thumbnail); } catch (IllegalArgumentException expected) { rejected = true; }
        check(rejected, "An invalid local identifier cannot become an import request");
        System.out.println("Device sync metadata: " + checks + " checks passed.");
    }
}
