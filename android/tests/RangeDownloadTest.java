package br.com.acervo.app;

import com.sun.net.httpserver.HttpServer;
import java.io.File;
import java.net.InetSocketAddress;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

public final class RangeDownloadTest {
    public static void main(String[] args) throws Exception {
        byte[] audio = new byte[5 * 1024 * 1024 + 17];
        for (int i = 0; i < audio.length; i++) audio[i] = (byte) (i * 71);
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        java.util.concurrent.ExecutorService workers = Executors.newFixedThreadPool(4); server.setExecutor(workers);
        AtomicInteger active = new AtomicInteger(), maximum = new AtomicInteger(), count = new AtomicInteger();
        server.createContext("/", exchange -> {
            int concurrent = active.incrementAndGet(); maximum.accumulateAndGet(concurrent, Math::max);
            try {
                String path = exchange.getRequestURI().getPath();
                String header = exchange.getRequestHeaders().getFirst("Range");
                String[] interval = header.substring(6).split("-");
                int start = Integer.parseInt(interval[0]), end = Integer.parseInt(interval[1]);
                count.incrementAndGet();
                if (path.equals("/ignore")) { exchange.sendResponseHeaders(200, 0); return; }
                exchange.getResponseHeaders().set("Content-Range", "bytes " + (path.equals("/wrong") ? start + 1 : start) + "-" + end + "/" + audio.length);
                exchange.getResponseHeaders().set("ETag", path.equals("/changed") && start > 0 ? "\"changed\"" : "\"fixed\"");
                exchange.getResponseHeaders().set("Content-Type", "audio/mp4");
                exchange.sendResponseHeaders(206, end - start + 1);
                try { Thread.sleep(25); } catch (InterruptedException ignored) { }
                int length = end - start + 1;
                if (path.equals("/short")) length -= 10;
                exchange.getResponseBody().write(audio, start, length);
            } catch (Exception ignored) { }
            finally { exchange.close(); active.decrementAndGet(); }
        });
        server.start();
        File target = Files.createTempFile("acervo-range-test-", ".part").toFile();
        try {
            java.util.function.Function<String, RangeDownload.Opener> opener = path -> (start, end, validator) -> {
                HttpURLConnection connection = (HttpURLConnection) new URL("http://127.0.0.1:" + server.getAddress().getPort() + path).openConnection();
                connection.setConnectTimeout(2000); connection.setReadTimeout(2000);
                connection.setRequestProperty("Range", "bytes=" + start + "-" + end);
                if (validator != null) connection.setRequestProperty("If-Range", validator);
                return connection;
            };
            long[] last = { 0 };
            if (!RangeDownload.copy(target, audio.length, opener.apply("/good"), (received, total) -> {
                if (received < last[0] || received > total) throw new AssertionError("Invalid progress"); last[0] = received;
            })) throw new AssertionError("Range download not selected");
            if (!MessageDigest.isEqual(MessageDigest.getInstance("SHA-256").digest(audio), MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(target.toPath())))) throw new AssertionError("Corrupt audio");
            if (maximum.get() != 2 || last[0] != audio.length) throw new AssertionError("Concurrency or progress");
            if (RangeDownload.copy(target, audio.length, opener.apply("/ignore"), null)) throw new AssertionError("Ignored range accepted");
            for (String route : new String[] { "/wrong", "/short", "/changed" }) {
                boolean failed = false;
                try { RangeDownload.copy(target, audio.length, opener.apply(route), null); } catch (Exception expected) { failed = true; }
                if (!failed) throw new AssertionError("Invalid response accepted: " + route);
            }
            int before = count.get();
            if (RangeDownload.copy(target, 100, opener.apply("/good"), null) || count.get() != before) throw new AssertionError("Small file fetched in parallel");
            System.out.println("Range download: exact bytes, two readers, monotonic progress, ignored ranges, truncation, wrong offsets, changed identity and small-file fallback passed.");
        } finally { server.stop(0); workers.shutdownNow(); target.delete(); }
    }
}
