package br.com.acervo.app;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;

public final class MobileArtworkCacheTest {
    private static int checks;

    private static void check(boolean condition, String message) {
        checks++;
        if (!condition) throw new AssertionError(message);
    }

    private static void rejected(ThrowingAction action, String message) throws Exception {
        boolean failed = false;
        try { action.run(); } catch (IOException expected) { failed = true; }
        check(failed, message);
    }

    public static void main(String[] args) throws Exception {
        Path temporary = Files.createTempDirectory("acervo-mobile-artwork-");
        File files = temporary.toFile();
        String url = "https://pc.example:4311/api/cover/aBcDeF123_-";
        try {
            File expected = MobileArtworkCache.fileFor(files, url);
            check(expected.getParentFile().equals(new File(files, "mobile-artwork")), "Artwork stays in the application's private folder");
            check(expected.getName().equals("6d462ebbff71a400e8bd20ef77571653aa997a813427dea87477eac6316fdd23.jpg"), "The existing exact URL hash contract stays stable");
            check(!expected.equals(MobileArtworkCache.fileFor(files, "https://PC.example:4311/api/cover/aBcDeF123_-")), "Cache keys preserve the exact URL without normalizing old entries");
            byte[] first = {1, 2, 3, 4};
            File stored = MobileArtworkCache.store(files, url, new ByteArrayInputStream(first));
            check(stored.equals(expected) && Arrays.equals(first, Files.readAllBytes(expected.toPath())), "A completed cover is available to the offline artwork reader");
            byte[] limit = new byte[MobileArtworkCache.MAX_BYTES];
            Arrays.fill(limit, (byte) 7);
            MobileArtworkCache.store(files, url, new ByteArrayInputStream(limit));
            check(Arrays.equals(limit, Files.readAllBytes(expected.toPath())), "A cover exactly at the size limit replaces the previous cover");
            rejected(() -> MobileArtworkCache.store(files, url, new ByteArrayInputStream(new byte[MobileArtworkCache.MAX_BYTES + 1])), "An oversized response is bounded even without Content-Length");
            check(Arrays.equals(limit, Files.readAllBytes(expected.toPath())), "An oversized response preserves the existing cover");
            rejected(() -> MobileArtworkCache.store(files, url, new ByteArrayInputStream(new byte[0])), "An empty response cannot erase the previous cover");
            check(Arrays.equals(limit, Files.readAllBytes(expected.toPath())), "An empty response preserves the existing cover");
            InputStream broken = new InputStream() {
                int reads;
                @Override public int read() throws IOException {
                    if (reads++ < 20) return 4;
                    throw new IOException("Disconnected");
                }
            };
            rejected(() -> MobileArtworkCache.store(files, url, broken), "A disconnected response is rejected");
            check(Arrays.equals(limit, Files.readAllBytes(expected.toPath())), "A disconnected response preserves the existing cover");
            final boolean[] closed = {false};
            InputStream owned = new ByteArrayInputStream(first) {
                @Override public void close() { closed[0] = true; }
            };
            MobileArtworkCache.store(files, url, owned);
            check(!closed[0], "The caller retains ownership of the transport stream");
            Thread.currentThread().interrupt();
            try {
                rejected(() -> MobileArtworkCache.store(files, url, new ByteArrayInputStream(limit)), "Cancellation stops the artwork transfer");
            } finally { Thread.interrupted(); }
            check(Arrays.equals(first, Files.readAllBytes(expected.toPath())), "Cancellation preserves the existing cover");
            File[] entries = expected.getParentFile().listFiles();
            check(entries != null && entries.length == 1 && entries[0].equals(expected), "Failed and completed writes leave no partial files");
            for (String invalid : new String[]{"http://pc.example/cover", "https://user:secret@pc.example/cover", "https:///cover", "file:///private/cover", "https://pc.example/cover#token", "https://pc.example:0/cover", "https://pc.example:65536/cover", "https://pc.example/with space"}) {
                rejected(() -> MobileArtworkCache.fileFor(files, invalid), "An invalid or credential-bearing artwork key is rejected");
            }
            rejected(() -> MobileArtworkCache.store(files, url, null), "A missing response stream is rejected");
            System.out.println("Mobile artwork cache: " + checks + " checks passed.");
        } finally {
            try (java.util.stream.Stream<Path> paths = Files.walk(temporary)) {
                paths.sorted(java.util.Comparator.reverseOrder()).forEach(path -> {
                    try { Files.delete(path); } catch (IOException failure) { throw new java.io.UncheckedIOException(failure); }
                });
            }
        }
    }

    private interface ThrowingAction { void run() throws Exception; }
}
