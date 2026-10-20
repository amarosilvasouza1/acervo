package br.com.acervo.app;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/** Two bounded range readers, with exact response validation before committing audio. */
public final class RangeDownload {
    private static final int CHUNK = 1024 * 1024;
    public interface Opener { HttpURLConnection open(long start, long end, String validator) throws Exception; }
    public interface Progress { void update(long received, long total) throws Exception; }
    private RangeDownload() { }

    public static boolean copy(File target, long total, Opener opener, Progress progress) throws Exception {
        if (total < 2L * CHUNK || total > 250L * CHUNK) return false;
        HttpURLConnection first = opener.open(0, CHUNK - 1, null);
        try { if (first.getResponseCode() != 206) { first.disconnect(); return false; } }
        catch (Exception failure) { first.disconnect(); throw failure; }
        final String etag = first.getHeaderField("ETag");
        final String validator = etag != null && !etag.startsWith("W/") ? etag : null;
        final Set<HttpURLConnection> active = ConcurrentHashMap.newKeySet();
        final AtomicBoolean cancelled = new AtomicBoolean();
        final AtomicLong received = new AtomicLong(), next = new AtomicLong(CHUNK);
        final Object reporting = new Object();
        class Reader {
            void chunk(HttpURLConnection connection, long start, long end) throws Exception {
                active.add(connection);
                try {
                    if (cancelled.get() || Thread.currentThread().isInterrupted()) throw new IOException("Download interrompido.");
                    long size = end - start + 1;
                    String range = "bytes " + start + "-" + end + "/" + total;
                    String type = connection.getContentType();
                    String encoding = connection.getHeaderField("Content-Encoding");
                    if (connection.getResponseCode() != 206 || !range.equals(connection.getHeaderField("Content-Range"))
                            || (connection.getContentLengthLong() >= 0 && connection.getContentLengthLong() != size)
                            || (encoding != null && !"identity".equalsIgnoreCase(encoding))
                            || (type != null && (type.startsWith("text/") || type.contains("json")))
                            || (validator != null && !validator.equals(connection.getHeaderField("ETag")))) {
                        throw new IOException("A fonte retornou uma parte de áudio inválida. Tente baixar novamente.");
                    }
                    long copied = 0;
                    try (InputStream input = connection.getInputStream(); RandomAccessFile output = new RandomAccessFile(target, "rw")) {
                        output.seek(start);
                        byte[] buffer = new byte[128 * 1024]; int count;
                        while ((count = input.read(buffer)) != -1) {
                            if (cancelled.get() || Thread.currentThread().isInterrupted()) throw new IOException("Download interrompido.");
                            copied += count;
                            if (copied > size) throw new IOException("A fonte retornou áudio maior do que o esperado.");
                            output.write(buffer, 0, count);
                            synchronized (reporting) {
                                long done = received.addAndGet(count);
                                if (progress != null) progress.update(done, total);
                            }
                        }
                        if (copied != size) throw new IOException("O download ficou incompleto. Tente novamente.");
                    }
                } finally { active.remove(connection); connection.disconnect(); }
            }
            void remaining() throws Exception {
                for (long start; !cancelled.get() && (start = next.getAndAdd(CHUNK)) < total;) {
                    chunk(opener.open(start, Math.min(total - 1, start + CHUNK - 1), validator), start, Math.min(total - 1, start + CHUNK - 1));
                }
            }
        }
        Reader reader = new Reader();
        try { reader.chunk(first, 0, CHUNK - 1); }
        catch (Exception failure) { first.disconnect(); throw failure; }
        ExecutorService workers = Executors.newFixedThreadPool(2);
        java.util.concurrent.Callable<Void> task = () -> {
            try { reader.remaining(); return null; }
            catch (Exception failure) {
                cancelled.set(true);
                for (HttpURLConnection connection : active) connection.disconnect();
                throw failure;
            }
        };
        Future<Void> a = workers.submit(task), b = workers.submit(task);
        try {
            a.get(); b.get();
            if (received.get() != total || target.length() != total) throw new IOException("O download ficou incompleto. Tente novamente.");
            try (RandomAccessFile output = new RandomAccessFile(target, "rw")) { output.getFD().sync(); }
            return true;
        } catch (java.util.concurrent.ExecutionException failure) {
            Throwable cause = failure.getCause();
            if (cause instanceof Exception) throw (Exception) cause;
            throw new IOException("Não foi possível baixar o áudio.", cause);
        } finally {
            cancelled.set(true); a.cancel(true); b.cancel(true);
            for (HttpURLConnection connection : active) connection.disconnect();
            workers.shutdownNow();
            boolean interrupted = false;
            while (!workers.isTerminated()) try { workers.awaitTermination(1, TimeUnit.SECONDS); }
            catch (InterruptedException failure) { interrupted = true; }
            if (interrupted) Thread.currentThread().interrupt();
        }
    }
}
