package br.com.acervo.app;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.channels.Channels;
import java.nio.channels.SeekableByteChannel;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.StandardOpenOption;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/** Byte-accurate local media responses, independent of Android and the PC transport. */
public final class LocalAudioResponse implements AutoCloseable {
    public final String mime;
    public final int status;
    public final String reason;
    public final Map<String, String> headers;
    public final InputStream body;

    private LocalAudioResponse(String type, int code, String text, Map<String, String> values, InputStream stream) {
        mime = type; status = code; reason = text; headers = values; body = stream;
    }

    /** Only exact app media routes identify a local track; never accept filesystem paths. */
    public static String trackId(String target) {
        if (target == null) return null;
        try {
            URI uri = URI.create(target);
            if (uri.getRawUserInfo() != null || uri.getRawFragment() != null) return null;
            String path = uri.getRawPath();
            if (path == null || !path.matches("/api/(?:stream|audio)/[A-Za-z0-9_-]{11}")) return null;
            return path.substring(path.lastIndexOf('/') + 1);
        } catch (IllegalArgumentException invalid) { return null; }
    }

    /** The caller supplies a metadata-listed filename inside this app's private mobile-audio folder. */
    public static LocalAudioResponse open(File files, String id, String filename, String method,
            Map<String, String> requestHeaders) throws IOException {
        if (!("GET".equals(method) || "HEAD".equals(method)) || id == null || !id.matches("[A-Za-z0-9_-]{11}")
                || filename == null || !filename.matches(java.util.regex.Pattern.quote(id) + "\\.(?:m4a|webm|ogg|opus|mp3|aac|mp4)")) return null;
        File root = files.getCanonicalFile();
        File folder = new File(root, "mobile-audio");
        File source = new File(folder, filename);
        if (!folder.getCanonicalFile().equals(folder) || !source.getCanonicalFile().equals(source)
                || !Files.isRegularFile(source.toPath(), LinkOption.NOFOLLOW_LINKS)) return null;
        SeekableByteChannel channel;
        try { channel = Files.newByteChannel(source.toPath(), StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS); }
        catch (java.nio.file.NoSuchFileException missing) { return null; }
        boolean owned = true;
        try {
            long total = channel.size();
            if (total == 0) return null;
            String etag = "\"local-" + total + "-" + Files.getLastModifiedTime(source.toPath(), LinkOption.NOFOLLOW_LINKS).toMillis() + "\"";
            Map<String, String> values = new LinkedHashMap<>();
            values.put("Accept-Ranges", "bytes");
            values.put("Content-Type", mime(filename));
            values.put("Cache-Control", "private, no-store");
            values.put("X-Content-Type-Options", "nosniff");
            values.put("ETag", etag);
            String range = header(requestHeaders, "Range"), condition = header(requestHeaders, "If-Range");
            if (condition != null && !condition.equals(etag)) range = null;
            long start = 0, end = total - 1;
            int status = 200;
            if (range != null) {
                long[] bounds = range(range, total);
                if (bounds == null) {
                    values.put("Content-Range", "bytes */" + total);
                    values.put("Content-Length", "0");
                    return new LocalAudioResponse(mime(filename), 416, "Range Not Satisfiable", values, new ByteArrayInputStream(new byte[0]));
                }
                start = bounds[0]; end = bounds[1]; status = 206;
                values.put("Content-Range", "bytes " + start + "-" + end + "/" + total);
            }
            long length = end - start + 1;
            values.put("Content-Length", Long.toString(length));
            if ("HEAD".equals(method)) return new LocalAudioResponse(mime(filename), status,
                    status == 206 ? "Partial Content" : "OK", values, new ByteArrayInputStream(new byte[0]));
            channel.position(start);
            InputStream input = new LimitedInputStream(Channels.newInputStream(channel), length);
            owned = false;
            return new LocalAudioResponse(mime(filename), status, status == 206 ? "Partial Content" : "OK", values, input);
        } finally { if (owned) channel.close(); }
    }

    private static String header(Map<String, String> headers, String name) {
        if (headers != null) for (Map.Entry<String, String> header : headers.entrySet())
            if (name.equalsIgnoreCase(header.getKey())) return header.getValue();
        return null;
    }

    private static long[] range(String range, long total) {
        if (range.length() > 64 || !range.matches("bytes=[0-9]*-[0-9]*")) return null;
        String[] parts = range.substring(6).split("-", -1);
        if (parts[0].isEmpty() && parts[1].isEmpty()) return null;
        try {
            if (parts[0].isEmpty()) {
                long suffix = Long.parseLong(parts[1]);
                return suffix == 0 ? null : new long[]{ Math.max(0, total - suffix), total - 1 };
            }
            long start = Long.parseLong(parts[0]);
            long end = parts[1].isEmpty() ? total - 1 : Math.min(Long.parseLong(parts[1]), total - 1);
            return start >= total || start > end ? null : new long[]{ start, end };
        } catch (NumberFormatException invalid) { return null; }
    }

    public static String mime(String filename) {
        String extension = filename.substring(filename.lastIndexOf('.') + 1).toLowerCase(Locale.US);
        switch (extension) {
            case "mp3": return "audio/mpeg";
            case "m4a": case "mp4": return "audio/mp4";
            case "webm": return "audio/webm";
            case "ogg": case "opus": return "audio/ogg";
            case "aac": return "audio/aac";
            default: return "application/octet-stream";
        }
    }

    @Override public void close() throws IOException { body.close(); }

    private static final class LimitedInputStream extends FilterInputStream {
        private long remaining;
        LimitedInputStream(InputStream input, long length) { super(input); remaining = length; }
        @Override public int read() throws IOException {
            if (remaining == 0) return -1;
            int value = in.read(); if (value < 0) throw new IOException("Áudio local incompleto.");
            remaining--; return value;
        }
        @Override public int read(byte[] bytes, int offset, int count) throws IOException {
            if (count == 0) return 0;
            if (remaining == 0) return -1;
            int read = in.read(bytes, offset, (int) Math.min(count, remaining));
            if (read < 0) throw new IOException("Áudio local incompleto.");
            remaining -= read; return read;
        }
        @Override public long skip(long count) throws IOException {
            long skipped = in.skip(Math.min(Math.max(0, count), remaining)); remaining -= skipped; return skipped;
        }
        @Override public int available() throws IOException { return (int) Math.min(in.available(), remaining); }
    }
}
