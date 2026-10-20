package br.com.acervo.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/** Serves the exact web-mobile assets and phone APIs in-process, without opening a TCP server. */
public final class PhoneWebClient implements WebTransport {
    public static final String ORIGIN = PhoneWebPolicy.ORIGIN;
    private static final String CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data: blob:; media-src 'self' blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'; worker-src 'none'";
    private final WebView view;
    private final Context context;
    private final PhoneApi api;
    private final MobileLibrary library;
    private final String bootstrap;
    private final ThreadPoolExecutor workers = new ThreadPoolExecutor(4, 4, 30, TimeUnit.SECONDS, new ArrayBlockingQueue<>(16));
    private final ConcurrentHashMap<Integer, Job> jobs = new ConcurrentHashMap<>();
    private final Set<InputStream> resources = ConcurrentHashMap.newKeySet();
    private final Set<HttpURLConnection> connections = ConcurrentHashMap.newKeySet();
    private volatile String documentKey;
    private volatile boolean disposed;
    private volatile String lastFailure;

    public PhoneWebClient(WebView browser, Context host) throws Exception {
        view = browser;
        context = host.getApplicationContext();
        library = new MobileLibrary(context);
        api = PhoneApi.instance(context);
        try (InputStream input = context.getAssets().open("native-transport.js")) {
            bootstrap = new String(MobileLibrary.readLimited(input, 128 * 1024), StandardCharsets.UTF_8);
        }
        documentKey = randomKey();
    }

    @Override public void attach() { view.addJavascriptInterface(new Bridge(), "AcervoSecure"); }
    @Override public void newDocument() { documentKey = randomKey(); lastFailure = null; cancelAll(); }
    @Override public String getFailureMessage() { return lastFailure; }
    @Override public boolean isActiveDocument(String key) { return active(key); }
    @Override public void dispose() {
        disposed = true;
        documentKey = randomKey();
        cancelAll();
        workers.shutdownNow();
        api.close();
        view.removeJavascriptInterface("AcervoSecure");
    }

    @Override public WebResourceResponse intercept(WebResourceRequest request) {
        if (disposed) return text(410, "Esta tela já foi encerrada.");
        String target = request.getUrl().toString();
        if (PhoneWebPolicy.target(target) == null) {
            // Only HTTPS images/fonts allowed by the document CSP reach the platform.
            if (!request.isForMainFrame() && "https".equalsIgnoreCase(request.getUrl().getScheme())
                    && !PhoneWebPolicy.isVirtualHost(target) && request.getUrl().getUserInfo() == null) return null;
            return text(403, "Endereço bloqueado.");
        }
        if (disposed || !("GET".equals(request.getMethod()) || "HEAD".equals(request.getMethod()))) return text(405, "Método não permitido.");
        if (request.isForMainFrame()) newDocument();
        String key = documentKey;
        try { return tracked(response(target, request.getMethod(), request.getRequestHeaders(), "", key), key); }
        catch (Exception failure) { lastFailure = safeMessage(failure); return text(500, lastFailure); }
    }

    private WebResourceResponse response(String target, String method, Map<String, String> headers, String body, String key) throws Exception {
        if (!active(key)) return text(410, "Esta tela já foi encerrada.");
        URI uri = PhoneWebPolicy.target(target);
        if (uri == null) return text(403, "Endereço bloqueado.");
        String path = uri.getRawPath();
        if (path.startsWith("/api/stream/") || path.startsWith("/api/audio/")) {
            WebResourceResponse local = LocalAudio.intercept(context, target, method, headers);
            return local == null ? text(404, "Música não está salva neste celular.") : local;
        }
        if (path.matches("/api/cover/[A-Za-z0-9_-]{11}")) {
            if (!("GET".equals(method) || "HEAD".equals(method))) return text(405, "Método não permitido.");
            return cover(path.substring(path.lastIndexOf('/') + 1), method);
        }
        String asset = PhoneWebPolicy.asset(path);
        if (asset != null && ("GET".equals(method) || "HEAD".equals(method))) {
            byte[] bytes;
            try (InputStream input = context.getAssets().open("web/" + asset)) {
                bytes = MobileLibrary.readLimited(input, 2 * 1024 * 1024);
            }
            if ("index.html".equals(asset)) {
                String html = new String(bytes, StandardCharsets.UTF_8);
                String script = "<script>window.__ACERVO_PHONE__=true;" + bootstrap.replace("__ACERVO_DOCUMENT_NONCE__", key) + "</script>";
                int head = html.toLowerCase(Locale.US).indexOf("<head");
                int end = head < 0 ? -1 : html.indexOf('>', head);
                html = end < 0 ? script + html : html.substring(0, end + 1) + script + html.substring(end + 1);
                bytes = html.getBytes(StandardCharsets.UTF_8);
            }
            return bytes(200, PhoneWebPolicy.mime(asset), bytes, method, "index.html".equals(asset));
        }
        if (!path.startsWith("/api/")) return text(404, "Página não encontrada.");
        String query = uri.getRawQuery();
        PhoneApi.Response result = api.handle("HEAD".equals(method) ? "GET" : method, path + (query == null ? "" : "?" + query), body);
        return bytes(result.status, result.mime, result.body, method, false);
    }

    private WebResourceResponse cover(String id, String method) throws Exception {
        MobileLibrary.Track track = library.get(id);
        if (track == null || track.thumbnail == null || track.thumbnail.isEmpty()) return text(404, "Capa indisponível.");
        File cached = MobileArtworkCache.fileFor(context.getFilesDir(), track.thumbnail);
        if (!cached.isFile() || cached.length() == 0) {
            URI source = new URI(track.thumbnail);
            // A PC artwork endpoint needs its paired identity; missing saved artwork must not leak that request.
            if (source.getPath() != null && source.getPath().startsWith("/api/")) return text(404, "Capa ainda não salva.");
            HttpURLConnection connection = MobileLibrary.openHttps(track.thumbnail);
            connections.add(connection);
            try (InputStream input = connection.getInputStream()) { cached = MobileArtworkCache.store(context.getFilesDir(), track.thumbnail, input); }
            finally { connections.remove(connection); connection.disconnect(); }
        }
        if (cached.length() > MobileArtworkCache.MAX_BYTES || !cached.getCanonicalFile().equals(cached.getAbsoluteFile())) return text(404, "Capa indisponível.");
        byte[] original;
        try (InputStream input = new FileInputStream(cached)) { original = MobileLibrary.readLimited(input, MobileArtworkCache.MAX_BYTES); }
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(original, 0, original.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return text(404, "Capa indisponível.");
        BitmapFactory.Options scaled = new BitmapFactory.Options();
        while (Math.max(bounds.outWidth, bounds.outHeight) / Math.max(1, scaled.inSampleSize) > 1600) scaled.inSampleSize = Math.max(1, scaled.inSampleSize) * 2;
        Bitmap bitmap = BitmapFactory.decodeByteArray(original, 0, original.length, scaled);
        if (bitmap == null) return text(404, "Capa indisponível.");
        Bitmap cropped = ArtworkCrop.trim(bitmap);
        byte[] result = original;
        if (cropped != bitmap) {
            try (ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                cropped.compress(Bitmap.CompressFormat.JPEG, 92, output);
                result = output.toByteArray();
            }
            cropped.recycle();
        }
        bitmap.recycle();
        return bytes(200, cropped == bitmap ? imageMime(original) : "image/jpeg", result, method, false);
    }

    private static String imageMime(byte[] bytes) {
        if (bytes.length >= 8 && (bytes[0] & 255) == 137 && bytes[1] == 80 && bytes[2] == 78 && bytes[3] == 71) return "image/png";
        if (bytes.length >= 12 && bytes[0] == 82 && bytes[1] == 73 && bytes[2] == 70 && bytes[3] == 70 && bytes[8] == 87 && bytes[9] == 69) return "image/webp";
        return "image/jpeg";
    }

    private static WebResourceResponse bytes(int status, String mime, byte[] body, String method, boolean html) {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("X-Content-Type-Options", "nosniff");
        headers.put("Content-Length", String.valueOf(body.length));
        if (html) headers.put("Content-Security-Policy", CSP);
        return new WebResourceResponse(mime, isText(mime) ? "UTF-8" : null, status, reason(status), headers,
                new ByteArrayInputStream("HEAD".equals(method) ? new byte[0] : body));
    }
    private static WebResourceResponse text(int status, String message) { return bytes(status, "text/plain", message.getBytes(StandardCharsets.UTF_8), "GET", false); }
    private static boolean isText(String mime) { return mime.startsWith("text/") || mime.contains("json") || mime.contains("javascript") || mime.contains("svg"); }
    private static String reason(int status) { return status == 200 ? "OK" : status == 201 ? "Created" : status == 202 ? "Accepted" : status == 204 ? "No Content" : status == 400 ? "Bad Request" : status == 404 ? "Not Found" : status == 405 ? "Method Not Allowed" : status == 409 ? "Conflict" : status == 503 ? "Service Unavailable" : "HTTP " + status; }
    private boolean active(String key) { return !disposed && key != null && key.equals(documentKey); }
    private void cancelAll() {
        for (Job job : jobs.values()) job.cancel();
        jobs.clear();
        for (InputStream input : resources) { try { input.close(); } catch (IOException ignored) { } }
        resources.clear();
        for (HttpURLConnection connection : connections) connection.disconnect();
        connections.clear();
    }
    /** Revocation closes private files immediately, even if WebView has not closed its response. */
    private WebResourceResponse tracked(WebResourceResponse response, String key) throws IOException {
        InputStream original = response.getData();
        if (original == null) return response;
        InputStream tracked = new FilterInputStream(original) {
            private final AtomicBoolean closed = new AtomicBoolean();
            private void check() throws IOException {
                if (closed.get() || !active(key)) { close(); throw new IOException("Tela encerrada."); }
            }
            @Override public int read() throws IOException { check(); return in.read(); }
            @Override public int read(byte[] buffer, int offset, int count) throws IOException { check(); return in.read(buffer, offset, count); }
            @Override public long skip(long count) throws IOException { check(); return in.skip(count); }
            @Override public void close() throws IOException {
                if (closed.compareAndSet(false, true)) {
                    try { super.close(); } finally { resources.remove(this); }
                }
            }
        };
        resources.add(tracked);
        response.setData(tracked);
        if (!active(key)) tracked.close();
        return response;
    }
    private static String randomKey() { byte[] bytes = new byte[32]; new SecureRandom().nextBytes(bytes); return Base64.encodeToString(bytes, Base64.NO_WRAP | Base64.URL_SAFE | Base64.NO_PADDING); }
    private static String safeMessage(Exception failure) { String message = failure.getMessage(); return message == null || message.length() > 500 ? "Não foi possível acessar a biblioteca do celular." : message; }

    private void event(Job job, String type, JSONObject values) {
        if (!active(job.key) || job.cancelled.get()) return;
        try {
            values.put("key", job.key).put("id", job.id).put("type", type);
            String js = "window.__acervoSecureReceive&&window.__acervoSecureReceive(" + values + ")";
            view.post(() -> { if (active(job.key) && !job.cancelled.get()) view.evaluateJavascript(js, null); });
        } catch (Exception ignored) { job.cancel(); }
    }

    private final class Bridge {
        @JavascriptInterface public void request(String key, int id, String method, String target, String jsonHeaders, String body64, boolean credentials) {
            if (!active(key) || id < 1 || jobs.containsKey(id)) return;
            Job job = new Job(key, id);
            if (jobs.size() >= 20) { event(job, "error", new JSONObject()); return; }
            jobs.put(id, job);
            try {
                if (PhoneWebPolicy.target(target) == null || method == null || !method.matches("GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS")
                        || jsonHeaders == null || jsonHeaders.length() > 32768 || body64 == null || body64.length() > 1398104) throw new IOException("Pedido inválido.");
                Map<String, String> headers = new HashMap<>();
                JSONObject object = new JSONObject(jsonHeaders);
                for (Iterator<String> names = object.keys(); names.hasNext();) {
                    String name = names.next(), value = object.getString(name);
                    if (name.length() > 128 || value.length() > 8192 || value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0) throw new IOException("Cabeçalho inválido.");
                    headers.put(name, value);
                }
                byte[] body = Base64.decode(body64, Base64.DEFAULT);
                if (body.length > 1048576 || (("GET".equals(method) || "HEAD".equals(method)) && body.length > 0)) throw new IOException("Corpo do pedido inválido.");
                job.future = workers.submit(() -> run(job, method, target, headers, new String(body, StandardCharsets.UTF_8)));
            } catch (Exception failure) { jobs.remove(id, job); event(job, "error", new JSONObject()); }
        }
        @JavascriptInterface public void cancel(String key, int id) {
            Job job = jobs.get(id);
            if (job != null && active(key) && key.equals(job.key)) { jobs.remove(id, job); job.cancel(); }
        }
    }

    private void run(Job job, String method, String target, Map<String, String> headers, String body) {
        try {
            if (!active(job.key) || job.cancelled.get()) return;
            WebResourceResponse result = tracked(response(target, method, headers, body, job.key), job.key);
            job.input = result.getData();
            try (InputStream input = result.getData()) {
                if (!active(job.key) || job.cancelled.get()) return;
                JSONObject responseHeaders = new JSONObject(result.getResponseHeaders());
                String mime = result.getMimeType();
                responseHeaders.put("Content-Type", mime + (isText(mime) ? "; charset=UTF-8" : ""));
                event(job, "headers", new JSONObject().put("status", result.getStatusCode()).put("statusText", result.getReasonPhrase()).put("headers", responseHeaders));
                long total = 0;
                byte[] buffer = new byte[32 * 1024];
                int count;
                while (!"HEAD".equals(method) && (count = input.read(buffer)) != -1) {
                    if (!active(job.key) || job.cancelled.get()) return;
                    total += count;
                    if (total > 32L * 1024 * 1024) throw new IOException("Resposta maior que o limite seguro.");
                    event(job, "chunk", new JSONObject().put("data", Base64.encodeToString(buffer, 0, count, Base64.NO_WRAP)));
                }
            }
            event(job, "end", new JSONObject());
        } catch (Exception failure) {
            lastFailure = safeMessage(failure);
            JSONObject details = new JSONObject();
            try { details.put("message", lastFailure); } catch (org.json.JSONException ignored) { }
            event(job, "error", details);
        } finally { jobs.remove(job.id, job); }
    }

    private static final class Job {
        final String key;
        final int id;
        final AtomicBoolean cancelled = new AtomicBoolean();
        volatile Future<?> future;
        volatile InputStream input;
        Job(String value, int identifier) { key = value; id = identifier; }
        void cancel() {
            cancelled.set(true);
            Future<?> current = future;
            if (current != null) current.cancel(true);
            InputStream open = input;
            if (open != null) { try { open.close(); } catch (IOException ignored) { } }
        }
    }
}
