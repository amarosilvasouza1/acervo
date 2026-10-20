package br.com.acervo.app;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

public final class LocalAudioResponseTest {
    private static final String ID = "aBcDeF123_-";
    private static int checks;
    private static void check(boolean condition, String message) {
        checks++;
        if (!condition) throw new AssertionError(message);
    }
    private static Map<String, String> range(String value) { return Collections.singletonMap("rAnGe", value); }
    private static LocalAudioResponse open(File files, String name, String method, Map<String, String> headers) throws IOException {
        return LocalAudioResponse.open(files, ID, name, method, headers);
    }

    public static void main(String[] args) throws Exception {
        Path temporary = Files.createTempDirectory("acervo-local-audio-");
        File files = temporary.toFile();
        Path folder = Files.createDirectory(temporary.resolve("mobile-audio"));
        byte[] audio = new byte[190123];
        for (int i = 0; i < audio.length; i++) audio[i] = (byte) (i * 31);
        Path source = folder.resolve(ID + ".m4a");
        Files.write(source, audio);
        try {
            for (String prefix : new String[]{"/api/stream/", "/api/audio/"}) {
                check(ID.equals(LocalAudioResponse.trackId("https://pc.example:4311" + prefix + ID)), "Known media route resolves the exact saved identifier");
                check(ID.equals(LocalAudioResponse.trackId("https://pc.example:4311" + prefix + ID + "?offset=3")), "Query parameters cannot change the local file identity");
            }
            for (String invalid : new String[]{null, "", "https://u:p@pc.example/api/stream/" + ID, "https://pc.example/api/stream/" + ID + "#token",
                    "/api/stream/../" + ID, "/api/stream/%61BcDeF123_-", "/api/stream/" + ID + "/extra", "/api/cover/" + ID, "/api/stream/short"}) {
                check(LocalAudioResponse.trackId(invalid) == null, "Non-media, encoded or ambiguous paths cannot read local files");
            }
            int remoteRequests = 0;
            LocalAudioResponse cached = open(files, ID + ".m4a", "GET", Collections.emptyMap());
            if (cached == null) remoteRequests++;
            try (LocalAudioResponse response = cached) {
                check(response != null && remoteRequests == 0, "A saved phone track is resolved without a PC request");
                check(response.status == 200 && response.mime.equals("audio/mp4"), "Independent M4A files retain the real MIME type instead of PC MP3 metadata");
                check(response.headers.get("Content-Length").equals(Integer.toString(audio.length)), "Full response advertises the actual local file size");
                check(response.headers.get("Accept-Ranges").equals("bytes"), "The decoder can seek through the local copy");
                check(Arrays.equals(audio, response.body.readAllBytes()), "The full file is read past the first media buffer without truncating");
            }
            for (String value : new String[]{"bytes=0-", "bytes=0-99999999", "bytes=-99999999"}) {
                try (LocalAudioResponse response = open(files, ID + ".m4a", "GET", range(value))) {
                    check(response.status == 206 && response.headers.get("Content-Range").equals("bytes 0-" + (audio.length - 1) + "/" + audio.length), "Open, oversized end and oversized suffix ranges reach the file end");
                    check(Arrays.equals(audio, response.body.readAllBytes()), "A starting range does not stop after the initial buffer");
                }
            }
            for (String value : new String[]{"bytes=42000-44000", "bytes=42000-", "bytes=-2000", "bytes=" + (audio.length - 1) + "-"}) {
                long start, end;
                if (value.equals("bytes=42000-44000")) { start = 42000; end = 44000; }
                else if (value.equals("bytes=42000-")) { start = 42000; end = audio.length - 1; }
                else if (value.equals("bytes=-2000")) { start = audio.length - 2000; end = audio.length - 1; }
                else { start = end = audio.length - 1; }
                try (LocalAudioResponse response = open(files, ID + ".m4a", "GET", range(value))) {
                    check(response.status == 206 && response.headers.get("Content-Length").equals(Long.toString(end - start + 1)), "Seek response has the exact requested length");
                    check(Arrays.equals(Arrays.copyOfRange(audio, (int) start, (int) end + 1), response.body.readAllBytes()), "Seek and suffix responses contain only the requested local bytes");
                    check(response.body.read() == -1, "A bounded response does not leak bytes beyond its requested end");
                }
            }
            for (String value : new String[]{"bytes=-0", "bytes=-", "bytes=2-1", "bytes=99999999-", "bytes=1-2,3-4", "bytes=9223372036854775808-", "items=0-4", "bytes=x-4"}) {
                try (LocalAudioResponse response = open(files, ID + ".m4a", "GET", range(value))) {
                    check(response.status == 416 && response.headers.get("Content-Range").equals("bytes */" + audio.length) && response.body.read() == -1,
                            "Malformed, multiple and unsatisfiable ranges return a bodyless 416");
                }
            }
            String etag;
            try (LocalAudioResponse response = open(files, ID + ".m4a", "HEAD", Collections.emptyMap())) {
                etag = response.headers.get("ETag");
                check(response.status == 200 && response.headers.get("Content-Length").equals(Integer.toString(audio.length)) && response.body.read() == -1, "HEAD advertises actual bytes without reading the audio");
            }
            Map<String, String> conditional = new HashMap<>(range("bytes=12-19"));
            conditional.put("If-Range", "\"pc-different-file\"");
            try (LocalAudioResponse response = open(files, ID + ".m4a", "GET", conditional)) {
                check(response.status == 200 && Arrays.equals(audio, response.body.readAllBytes()), "A different PC validator cannot select a range from a different phone encoding");
            }
            conditional.put("If-Range", etag);
            try (LocalAudioResponse response = open(files, ID + ".m4a", "GET", conditional)) {
                check(response.status == 206 && Arrays.equals(Arrays.copyOfRange(audio, 12, 20), response.body.readAllBytes()), "A matching local validator permits seek");
            }
            try (LocalAudioResponse response = open(files, ID + ".m4a", "GET", range("bytes=12-19"))) {
                check(response.body.skip(3) == 3 && response.body.read() == (audio[15] & 255), "Skipping stays inside the response boundaries");
                check(response.body.skip(999) == 4 && response.body.read() == -1, "Oversized skips cannot expose the remainder of the file");
            }
            for (String name : new String[]{"../" + ID + ".m4a", "wrong-id.m4a", ID + ".part", ID + ".exe", ID + ".m4a/extra"}) {
                check(open(files, name, "GET", Collections.emptyMap()) == null, "Metadata cannot point outside the expected local audio filename");
            }
            check(open(files, ID + ".m4a", "POST", Collections.emptyMap()) == null, "Only GET and HEAD may read a local song");
            check(open(files, ID + ".mp3", "GET", Collections.emptyMap()) == null, "An absent local file is eligible for the normal authenticated server fallback");
            Files.write(folder.resolve(ID + ".mp3"), new byte[0]);
            check(open(files, ID + ".mp3", "GET", Collections.emptyMap()) == null, "An empty local file is not falsely reported as playable");
            for (String[] encoding : new String[][]{{"m4a", "audio/mp4"}, {"mp4", "audio/mp4"}, {"webm", "audio/webm"}, {"ogg", "audio/ogg"}, {"opus", "audio/ogg"}, {"mp3", "audio/mpeg"}, {"aac", "audio/aac"}}) {
                check(LocalAudioResponse.mime(ID + "." + encoding[0]).equals(encoding[1]), "Every supported local encoding has its correct media MIME type");
            }
            Files.delete(source);
            check(open(files, ID + ".m4a", "GET", Collections.emptyMap()) == null, "Deleting a saved file permits remote fallback and all prior streams are closed");
            try {
                Files.createSymbolicLink(source, temporary.resolve("outside.m4a"));
                Files.write(temporary.resolve("outside.m4a"), audio);
                check(open(files, ID + ".m4a", "GET", Collections.emptyMap()) == null, "A symlink inside the audio folder cannot expose another private file");
                Files.delete(source);
            } catch (java.nio.file.FileSystemException | UnsupportedOperationException unavailable) {
                System.out.println("Local audio: symlink check skipped because link creation is unavailable.");
            }
            System.out.println("Local audio: " + checks + " checks passed.");
        } finally {
            try (java.util.stream.Stream<Path> paths = Files.walk(temporary)) {
                paths.sorted(java.util.Comparator.reverseOrder()).forEach(path -> {
                    try { Files.delete(path); } catch (IOException failure) { throw new java.io.UncheckedIOException(failure); }
                });
            }
        }
    }
}
