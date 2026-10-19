package br.com.acervo.app;

import android.content.Context;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.HashMap;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicBoolean;

/** Native HTTPS interception plus a bounded, cancellable fetch stream for request bodies. */
public final class SecureWebClient {
    private static final String CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data: blob:; media-src 'self' blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'; worker-src 'none'";
    private final WebView view;
    private final Context context;
    private final String origin;
    private final String bootstrap;
    private final ThreadPoolExecutor workers = new ThreadPoolExecutor(4, 4, 30, TimeUnit.SECONDS, new ArrayBlockingQueue<>(16));
    private final ConcurrentHashMap<Integer, Job> jobs = new ConcurrentHashMap<>();
    private final Set<HttpURLConnection> resources = ConcurrentHashMap.newKeySet();
    private volatile String documentKey;
    private volatile boolean disposed;

    public SecureWebClient(WebView webView, Context host, String trustedOrigin) {
        view = webView;
        context = host.getApplicationContext();
        origin = PairingLink.parse(trustedOrigin).origin;
        if (!origin.startsWith("https://")) throw new IllegalArgumentException("A conexão do app precisa de HTTPS.");
        try (InputStream source = host.getAssets().open("native-transport.js")) {
            bootstrap = new String(readBounded(source, 128 * 1024), StandardCharsets.UTF_8);
        } catch (IOException failure) { throw new IllegalStateException("Transporte nativo ausente.", failure); }
        documentKey = randomKey();
    }

    public void attach() { view.addJavascriptInterface(new Bridge(), "AcervoSecure"); }
    /** Optional before an explicit loadUrl; interception also rotates for actual main-document requests. */
    public void newDocument() { documentKey = randomKey(); cancelAll(); }
    public void dispose() { disposed = true; documentKey = randomKey(); cancelAll(); workers.shutdownNow(); view.removeJavascriptInterface("AcervoSecure"); }

    public WebResourceResponse intercept(WebResourceRequest request) {
        String target = request.getUrl().toString();
        if (!PairingLink.isSameOrigin(target, origin)) {
            // Third-party image/font resources use the platform's normal CA validation.
            if (request.isForMainFrame() || "http".equalsIgnoreCase(request.getUrl().getScheme())) return failure();
            return null;
        }
        if (disposed || !("GET".equals(request.getMethod()) || "HEAD".equals(request.getMethod()))) return failure();
        if (request.isForMainFrame()) newDocument();
        HttpURLConnection connection = null;
        try {
            connection = SecureTransport.open(context, target, origin);
            resources.add(connection);
            connection.setRequestMethod(request.getMethod());
            configure(connection, request.getRequestHeaders(), true);
            int status = connection.getResponseCode();
            String statusText = reason(connection, status);
            rememberCookies(connection);
            if (status >= 300 && status <= 399) { resources.remove(connection); connection.disconnect(); return failure(); }
            Map<String, String> headers = responseHeaders(connection);
            String contentType = connection.getContentType();
            String mime = contentType == null ? "application/octet-stream" : contentType.split(";", 2)[0].trim();
            String encoding = mime.startsWith("text/") || mime.contains("json") || mime.contains("javascript") ? "UTF-8" : null;
            InputStream input = responseStream(connection, status);
            if (request.isForMainFrame() && "text/html".equalsIgnoreCase(mime)) {
                String key = documentKey;
                String html;
                try (InputStream source = input) { html = new String(readBounded(source, 2 * 1024 * 1024), StandardCharsets.UTF_8); }
                connection.disconnect();
                resources.remove(connection);
                String script = "<script>" + bootstrap.replace("__ACERVO_DOCUMENT_NONCE__", key) + "</script>";
                int head = html.toLowerCase(Locale.US).indexOf("<head");
                int end = head < 0 ? -1 : html.indexOf('>', head);
                html = end < 0 ? script + html : html.substring(0, end + 1) + script + html.substring(end + 1);
                headers.put("Content-Security-Policy", CSP);
                headers.entrySet().removeIf(entry -> entry.getKey().equalsIgnoreCase("Content-Length"));
                return new WebResourceResponse(mime, "UTF-8", validStatus(status), statusText, headers,
                        new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)));
            }
            final HttpURLConnection opened = connection;
            return new WebResourceResponse(mime, encoding, validStatus(status), statusText, headers, new FilterInputStream(input) {
                @Override public void close() throws IOException { try { super.close(); } finally { resources.remove(opened); opened.disconnect(); } }
            });
        } catch (Exception failure) { if (connection != null) { resources.remove(connection); connection.disconnect(); } return failure(); }
    }

    private boolean active(String key) { return !disposed && key != null && key.equals(documentKey); }
    private void cancelAll() { for (Job job : jobs.values()) job.cancel(); jobs.clear(); for (HttpURLConnection connection : resources) connection.disconnect(); resources.clear(); }
    private static String randomKey() { byte[] bytes = new byte[32]; new SecureRandom().nextBytes(bytes); return Base64.encodeToString(bytes, Base64.NO_WRAP | Base64.URL_SAFE | Base64.NO_PADDING); }
    private static int validStatus(int status) { return status >= 100 && status <= 599 ? status : 502; }
    private static String reason(HttpURLConnection connection, int status) { try { String value = connection.getResponseMessage(); return value == null || value.trim().isEmpty() ? "HTTP " + status : value; } catch (IOException ignored) { return "HTTP " + status; } }
    private static WebResourceResponse failure() { return new WebResourceResponse("text/plain", "UTF-8", 502, "Secure connection failed", new HashMap<>(), new ByteArrayInputStream("Conexão segura não verificada. Confira o computador e pareie novamente pelo QR code seguro.".getBytes(StandardCharsets.UTF_8))); }
    private static InputStream responseStream(HttpURLConnection connection, int status) throws IOException { InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream(); return stream == null ? new ByteArrayInputStream(new byte[0]) : stream; }
    private static byte[] readBounded(InputStream stream, int limit) throws IOException { try (ByteArrayOutputStream output = new ByteArrayOutputStream()) { byte[] bytes = new byte[8192]; int count; while ((count = stream.read(bytes)) != -1) { if (output.size() + count > limit) throw new IOException("Resposta grande demais."); output.write(bytes, 0, count); } return output.toByteArray(); } }
    private void configure(HttpURLConnection connection, Map<String, String> headers, boolean credentials) {
        connection.setRequestProperty("Accept-Encoding", "identity");
        connection.setRequestProperty("Origin", origin);
        connection.setRequestProperty("User-Agent", "AcervoAndroid secure transport");
        for (Map.Entry<String, String> entry : headers.entrySet()) {
            String name = entry.getKey().toLowerCase(Locale.US), value = entry.getValue();
            if (value == null || value.length() > 8192 || value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0) continue;
            if (name.equals("accept") || name.equals("content-type") || name.equals("range") || name.equals("if-range")) connection.setRequestProperty(entry.getKey(), value);
        }
        String cookies = CookieManager.getInstance().getCookie(origin + "/");
        if (credentials && cookies != null && !cookies.isEmpty()) connection.setRequestProperty("Cookie", cookies);
    }
    private void rememberCookies(HttpURLConnection connection) throws IOException {
        List<String> values = new ArrayList<>();
        for (Map.Entry<String, List<String>> entry : connection.getHeaderFields().entrySet()) {
            if (entry.getKey() != null && entry.getKey().equalsIgnoreCase("Set-Cookie") && entry.getValue() != null) values.addAll(entry.getValue());
        }
        if (values.isEmpty()) return;
        CountDownLatch saved = new CountDownLatch(values.size());
        AtomicBoolean failed = new AtomicBoolean();
        if (!view.post(() -> {
            for (String cookie : values) {
                if (disposed) { failed.set(true); saved.countDown(); continue; }
                try { CookieManager.getInstance().setCookie(origin + "/", cookie, accepted -> { if (!accepted) failed.set(true); saved.countDown(); }); }
                catch (RuntimeException invalid) { failed.set(true); saved.countDown(); }
            }
        })) throw new IOException("A conexão segura foi encerrada.");
        try {
            if (!saved.await(5, TimeUnit.SECONDS) || failed.get() || disposed) throw new IOException("Não foi possível guardar a sessão segura. Pareie novamente.");
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IOException("Pareamento cancelado.", interrupted);
        }
        CookieManager.getInstance().flush();
    }
    private static Map<String, String> responseHeaders(HttpURLConnection connection) {
        Map<String, String> headers = new LinkedHashMap<>();
        for (Map.Entry<String, List<String>> entry : connection.getHeaderFields().entrySet()) {
            String name = entry.getKey();
            if (name == null || entry.getValue() == null || name.equalsIgnoreCase("Set-Cookie") || name.equalsIgnoreCase("Transfer-Encoding") || name.equalsIgnoreCase("Connection") || name.equalsIgnoreCase("Content-Encoding") || name.equalsIgnoreCase("Content-Security-Policy")) continue;
            headers.put(name, String.join(", ", entry.getValue()));
        }
        headers.put("Cache-Control", "no-store");
        return headers;
    }
    private void event(Job job, String type, JSONObject values) {
        if (!active(job.key) || job.cancelled.get()) return;
        try {
            values.put("key", job.key).put("id", job.id).put("type", type);
            String js = "window.__acervoSecureReceive&&window.__acervoSecureReceive(" + values.toString() + ")";
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
                if (!PairingLink.isSameOrigin(target, origin) || target.length() > 8192 || URI.create(target).getRawFragment() != null
                        || !method.matches("GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS") || jsonHeaders.length() > 32768 || body64.length() > 1398104) throw new IOException("Pedido inválido.");
                Map<String, String> headers = new HashMap<>();
                JSONObject object = new JSONObject(jsonHeaders);
                for (Iterator<String> names = object.keys(); names.hasNext();) { String name = names.next(); headers.put(name, object.getString(name)); }
                byte[] body = Base64.decode(body64, Base64.DEFAULT);
                if (body.length > 1048576 || (("GET".equals(method) || "HEAD".equals(method)) && body.length > 0)) throw new IOException("Corpo do pedido inválido.");
                workers.execute(() -> run(job, method, target, headers, body, credentials));
            } catch (Exception failure) { jobs.remove(id, job); event(job, "error", new JSONObject()); }
        }
        @JavascriptInterface public void cancel(String key, int id) { Job job = jobs.get(id); if (job != null && active(key) && key.equals(job.key)) { jobs.remove(id, job); job.cancel(); } }
    }

    private void run(Job job, String method, String target, Map<String, String> headers, byte[] body, boolean credentials) {
        HttpURLConnection connection = null;
        try {
            if (!active(job.key) || job.cancelled.get()) return;
            connection = SecureTransport.open(context, target, origin);
            job.connection = connection;
            if (job.cancelled.get()) return;
            configure(connection, headers, credentials);
            connection.setRequestMethod(method);
            if (body.length > 0) {
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(body.length);
                try (java.io.OutputStream output = connection.getOutputStream()) { output.write(body); }
            }
            int status = connection.getResponseCode();
            if (status >= 300 && status <= 399) throw new IOException("Redirecionamento bloqueado na conexão pareada.");
            rememberCookies(connection);
            event(job, "headers", new JSONObject().put("status", status).put("statusText", reason(connection, status)).put("headers", new JSONObject(responseHeaders(connection))));
            long total = 0, started = System.nanoTime();
            if (!"HEAD".equals(method)) try (InputStream input = responseStream(connection, status)) {
                byte[] buffer = new byte[32 * 1024]; int count;
                while ((count = input.read(buffer)) != -1) {
                    if (!active(job.key) || job.cancelled.get()) return;
                    total += count;
                    if (total > 32L * 1024 * 1024 || System.nanoTime() - started > 120000000000L) throw new IOException("Resposta excedeu o limite seguro.");
                    event(job, "chunk", new JSONObject().put("data", Base64.encodeToString(buffer, 0, count, Base64.NO_WRAP)));
                }
            }
            event(job, "end", new JSONObject());
        } catch (Exception failure) { event(job, "error", new JSONObject()); }
        finally { if (connection != null) connection.disconnect(); jobs.remove(job.id, job); }
    }
    private static final class Job {
        final String key; final int id; final AtomicBoolean cancelled = new AtomicBoolean(); volatile HttpURLConnection connection;
        Job(String nonce, int identifier) { key = nonce; id = identifier; }
        void cancel() { cancelled.set(true); HttpURLConnection open = connection; if (open != null) open.disconnect(); }
    }
}
