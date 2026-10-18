package br.com.acervo.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.Application;
import android.app.ProgressDialog;
import android.content.DialogInterface;
import android.os.Bundle;
import android.webkit.CookieManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

/** Manual, additive catalog synchronization. Neither device deletes the other's music. */
public final class DeviceSync {
    private static final int MAX_JSON_BYTES = 16 * 1024 * 1024;
    private static final AtomicBoolean BUSY = new AtomicBoolean(false);

    private DeviceSync() { }

    public static void sync(Activity activity, String origin) {
        if (!alive(activity)) return;
        final String trustedOrigin;
        try { trustedOrigin = PairingLink.parse(origin).origin; }
        catch (Exception invalid) {
            message(activity, "Sincronizar bibliotecas", "Conecte e pareie este celular com um computador ou servidor Acervo antes de sincronizar.");
            return;
        }
        if (!BUSY.compareAndSet(false, true)) {
            message(activity, "Sincronizar bibliotecas", "Uma sincronizacao ainda esta em andamento. Aguarde ou cancele a operacao atual.");
            return;
        }
        new Operation(activity, trustedOrigin).prepare();
    }

    private static final class Operation implements Application.ActivityLifecycleCallbacks {
        final Activity activity;
        final String origin;
        final AtomicBoolean cancelled = new AtomicBoolean(false);
        final AtomicBoolean finished = new AtomicBoolean(false);
        volatile Thread worker;
        volatile HttpURLConnection connection;
        volatile boolean transferring;
        ProgressDialog dialog;
        MobileLibrary library;
        final Map<String, JSONObject> pull = new LinkedHashMap<>();
        final Map<String, String> push = new LinkedHashMap<>();
        final List<String> errors = new ArrayList<>();
        int incompatible;
        int pulled;
        int alreadyPresent;
        int queued;
        int pullFailed;
        int pushFailed;
        long lastProgressAt;

        Operation(Activity host, String trustedOrigin) {
            activity = host;
            origin = trustedOrigin;
            host.getApplication().registerActivityLifecycleCallbacks(this);
        }

        void prepare() {
            showProgress("Comparando as bibliotecas do celular e do computador...");
            worker = new Thread(() -> {
                try {
                    ensureRunning();
                    JSONObject remote = request("GET", "/api/library", null);
                    JSONArray tracks = remote.getJSONArray("tracks");
                    library = new MobileLibrary(activity);
                    Set<String> localIds = new LinkedHashSet<>();
                    List<MobileLibrary.Track> local = library.all();
                    for (MobileLibrary.Track track : local) if (validId(track.id)) localIds.add(track.id);
                    Set<String> remoteIds = new LinkedHashSet<>();
                    for (int i = 0; i < tracks.length(); i++) {
                        JSONObject track = tracks.optJSONObject(i);
                        String id = track == null ? "" : track.optString("videoId");
                        if (!validId(id)) { incompatible++; continue; }
                        if (remoteIds.add(id) && !localIds.contains(id)) {
                            pull.put(id, track);
                        }
                    }
                    for (MobileLibrary.Track track : local) {
                        if (validId(track.id) && !remoteIds.contains(track.id)) push.put(track.id, title(track.title, track.id));
                    }
                    ensureRunning();
                    activity.runOnUiThread(() -> {
                        if (!alive(activity) || cancelled.get()) { finish(false); return; }
                        dismissProgress();
                        if (pull.isEmpty() && push.isEmpty()) {
                            finish(false);
                            message(activity, "Bibliotecas conferidas", "As duas bibliotecas ja tem as mesmas musicas compativeis."
                                    + (incompatible > 0 ? "\n\n" + incompatible + " faixas do computador nao possuem um identificador compativel e foram ignoradas." : ""));
                            return;
                        }
                        String description = "Copiar do PC para o celular: " + pull.size() + " musicas.\nEnviar para baixar no computador/servidor: " + push.size() + " musicas."
                                + "\n\nAs musicas que ja estao no PC sao copiadas direto, sem baixar do YouTube de novo. O computador recebe pedidos apenas das musicas que so existem no celular. Nenhuma musica sera apagada."
                                + "\n\nA sincronizacao precisa desta conexao ativa; depois, as copias salvas no celular tocam com o PC desligado."
                                + (incompatible > 0 ? "\n\n" + incompatible + " faixas sem identificador compativel serao ignoradas." : "");
                        try {
                            new AlertDialog.Builder(activity).setTitle("Sincronizar bibliotecas?")
                                    .setMessage(description).setNegativeButton("Agora nao", (ignored, which) -> finish(false))
                                    .setPositiveButton("Sincronizar", (ignored, which) -> execute())
                                    .setOnCancelListener(ignored -> finish(false)).show();
                        } catch (RuntimeException failure) { cancel(); finish(false); }
                    });
                } catch (Exception failure) {
                    finish(false);
                    if (!cancelled.get()) message(activity, "Nao foi possivel comparar", friendly(failure));
                }
            }, "Acervo-sync-compare");
            worker.start();
        }

        void execute() {
            if (finished.get() || !alive(activity)) { finish(false); return; }
            transferring = true;
            showProgress("Iniciando a sincronizacao...");
            worker = new Thread(() -> {
                try {
                    int index = 0;
                    for (Map.Entry<String, JSONObject> song : pull.entrySet()) {
                        ensureRunning();
                        index++;
                        String label = title(song.getValue().optString("title"), song.getKey());
                        final String stage = "Copiando do PC (" + index + "/" + pull.size() + ")\n" + label;
                        updateProgress(stage);
                        try {
                            if (library.get(song.getKey()) != null) { alreadyPresent++; continue; }
                            copyFromPc(song.getKey(), song.getValue(), stage);
                            pulled++;
                        } catch (Exception failure) {
                            if (stopped()) throw new Cancelled();
                            pullFailed++;
                            recordError(label, failure);
                        }
                    }
                    index = 0;
                    for (Map.Entry<String, String> song : push.entrySet()) {
                        ensureRunning();
                        index++;
                        updateProgress("Enviando para o computador (" + index + "/" + push.size() + ")\n" + song.getValue());
                        try {
                            JSONObject result = request("POST", "/api/import", new JSONObject().put("videoId", song.getKey()));
                            if (result.optString("jobId").isEmpty()) throw new IOException("O computador nao confirmou a tarefa de download.");
                            queued++;
                        } catch (Exception failure) {
                            if (stopped()) throw new Cancelled();
                            pushFailed++;
                            recordError(song.getValue(), failure);
                            // Authentication and connectivity failures affect every following request.
                            if (failure instanceof Unavailable || failure instanceof java.net.ConnectException
                                    || failure instanceof java.net.UnknownHostException || failure instanceof java.net.SocketTimeoutException) break;
                        }
                    }
                } catch (Cancelled interrupted) {
                    cancelled.set(true);
                } catch (Exception failure) {
                    if (stopped()) cancelled.set(true);
                    else recordError("Sincronizacao", failure);
                } finally { finish(true); }
            }, "Acervo-sync-transfer");
            worker.start();
        }

        void copyFromPc(String id, JSONObject track, String stage) throws Exception {
            URL target = new URL(origin + "/api/stream/" + id);
            if (!PairingLink.isSameOrigin(target.toString(), origin)) throw new IOException("Endereco de audio invalido.");
            HttpURLConnection current = (HttpURLConnection) target.openConnection();
            connection = current;
            File temp = null;
            try {
                current.setInstanceFollowRedirects(false);
                current.setConnectTimeout(15000);
                current.setReadTimeout(120000);
                current.setRequestProperty("Accept", "audio/mpeg,audio/*");
                current.setRequestProperty("Accept-Encoding", "identity");
                current.setRequestProperty("Origin", origin);
                String cookies = CookieManager.getInstance().getCookie(origin + "/");
                if (cookies != null && !cookies.isEmpty()) current.setRequestProperty("Cookie", cookies);
                int status = current.getResponseCode();
                ensureRunning();
                if (status == 401 || status == 403) throw new Unavailable("O acesso ao Acervo foi recusado. Pareie o celular novamente pelo QR code.");
                if (status != 200) throw new IOException("O PC respondeu " + status + " ao copiar esta musica.");
                long total = current.getContentLengthLong();
                if (total > 250L * 1024 * 1024) throw new IOException("Esta musica ultrapassa o limite de 250 MB.");
                temp = File.createTempFile("acervo-pc-", ".mp3", activity.getCacheDir());
                long received = 0;
                try (InputStream input = current.getInputStream(); FileOutputStream output = new FileOutputStream(temp)) {
                    byte[] buffer = new byte[32 * 1024];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        ensureRunning();
                        output.write(buffer, 0, count);
                        received += count;
                        long now = System.currentTimeMillis();
                        if (now - lastProgressAt >= 300 || (total > 0 && received == total)) {
                            lastProgressAt = now;
                            updateProgress(stage + "\n" + size(received) + (total > 0 ? " de " + size(total) : ""));
                        }
                    }
                    output.getFD().sync();
                }
                library.importFile(id, title(track.optString("title"), id), track.optString("artist"), track.optLong("duration"), temp);
            } finally {
                connection = null;
                current.disconnect();
                if (temp != null) temp.delete();
            }
        }

        JSONObject request(String method, String endpoint, JSONObject body) throws Exception {
            ensureRunning();
            if (!"/api/library".equals(endpoint) && !"/api/import".equals(endpoint)) throw new IOException("Operacao de sincronizacao invalida.");
            URL target = new URL(origin + endpoint);
            if (!PairingLink.isSameOrigin(target.toString(), origin)) throw new IOException("Endereco de sincronizacao invalido.");
            HttpURLConnection current = (HttpURLConnection) target.openConnection();
            connection = current;
            try {
                current.setInstanceFollowRedirects(false);
                current.setConnectTimeout(15000);
                current.setReadTimeout(20000);
                current.setRequestMethod(method);
                current.setRequestProperty("Accept", "application/json");
                current.setRequestProperty("Accept-Encoding", "identity");
                current.setRequestProperty("Origin", origin);
                String cookies = CookieManager.getInstance().getCookie(origin + "/");
                if (cookies != null && !cookies.isEmpty()) current.setRequestProperty("Cookie", cookies);
                if (body != null) {
                    byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
                    current.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                    current.setDoOutput(true);
                    current.setFixedLengthStreamingMode(payload.length);
                    try (OutputStream output = current.getOutputStream()) { output.write(payload); }
                }
                int status = current.getResponseCode();
                ensureRunning();
                if (status == 401 || status == 403) throw new Unavailable("O acesso ao Acervo foi recusado. Pareie o celular novamente pelo QR code e tente sincronizar.");
                if (status >= 300 && status < 400) throw new Unavailable("O servidor mudou de endereco. Confira a conexao e pareie novamente; nenhum redirecionamento foi seguido.");
                if (("GET".equals(method) && status != 200) || ("POST".equals(method) && status != 202)) {
                    throw new IOException("O computador respondeu com erro " + status + ". Esta musica nao foi confirmada.");
                }
                if (current.getContentLengthLong() > MAX_JSON_BYTES) throw new IOException("A biblioteca do computador ultrapassa o limite de 16 MB.");
                long started = System.nanoTime();
                try (InputStream input = current.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    byte[] bytes = new byte[8192];
                    int length;
                    while ((length = input.read(bytes)) != -1) {
                        ensureRunning();
                        if (System.nanoTime() - started > 60000000000L) throw new IOException("A leitura da biblioteca demorou demais. Tente novamente.");
                        if (output.size() + length > MAX_JSON_BYTES) throw new IOException("A biblioteca do computador ultrapassa o limite de 16 MB.");
                        output.write(bytes, 0, length);
                    }
                    return new JSONObject(new String(output.toByteArray(), StandardCharsets.UTF_8));
                }
            } finally {
                connection = null;
                current.disconnect();
            }
        }

        boolean stopped() { return cancelled.get() || Thread.currentThread().isInterrupted() || !alive(activity); }

        void ensureRunning() { if (stopped()) throw new Cancelled(); }

        void cancel() {
            cancelled.set(true);
            Thread thread = worker;
            if (thread != null) thread.interrupt();
            HttpURLConnection active = connection;
            if (active != null) active.disconnect();
        }

        @SuppressWarnings("deprecation")
        void showProgress(String text) {
            if (!alive(activity)) { cancel(); finish(false); return; }
            dialog = new ProgressDialog(activity);
            dialog.setTitle("Sincronizar bibliotecas");
            dialog.setMessage(text);
            dialog.setIndeterminate(true);
            dialog.setCancelable(true);
            dialog.setCanceledOnTouchOutside(false);
            dialog.setOnCancelListener(ignored -> cancel());
            dialog.setButton(DialogInterface.BUTTON_NEGATIVE, "Cancelar", (ignored, which) -> cancel());
            try { dialog.show(); } catch (RuntimeException failure) { cancel(); finish(false); }
        }

        void updateProgress(String text) {
            activity.runOnUiThread(() -> {
                if (alive(activity) && dialog != null && dialog.isShowing()) dialog.setMessage(text);
            });
        }

        void dismissProgress() {
            if (dialog != null) { try { if (dialog.isShowing()) dialog.dismiss(); } catch (RuntimeException ignored) { } }
            dialog = null;
        }

        void recordError(String song, Exception failure) {
            if (errors.size() < 5) errors.add(song + ": " + friendly(failure));
        }

        void finish(boolean report) {
            if (!finished.compareAndSet(false, true)) return;
            activity.getApplication().unregisterActivityLifecycleCallbacks(this);
            BUSY.set(false);
            activity.runOnUiThread(() -> {
                dismissProgress();
                if (!alive(activity) || !report) return;
                int remaining = pull.size() + push.size() - pulled - alreadyPresent - queued - pullFailed - pushFailed;
                String result = "Baixadas no celular: " + pulled + " de " + pull.size() + "."
                        + "\nEnviadas para baixar no computador/servidor: " + queued + " de " + push.size() + "."
                        + (alreadyPresent > 0 ? "\nJa estavam salvas no celular: " + alreadyPresent + "." : "")
                        + (pullFailed + pushFailed > 0 ? "\nFalhas: " + (pullFailed + pushFailed) + "." : "")
                        + (remaining > 0 ? "\nNao processadas: " + remaining + "." : "")
                        + (incompatible > 0 ? "\nFaixas sem identificador compativel ignoradas: " + incompatible + "." : "");
                if (!errors.isEmpty()) result += "\n\n" + join(errors);
                result += "\n\nOs pedidos enviados ao computador ainda dependem dos downloads terminarem la. A sincronizacao acontece quando voce a solicita; nao continua em tempo real com os dispositivos desconectados.";
                message(activity, cancelled.get() ? "Sincronizacao cancelada" : "Resultado da sincronizacao", result);
            });
        }

        @Override public void onActivityDestroyed(Activity host) {
            if (host != activity) return;
            cancel();
            // Keep the transfer lock until an active download has cleaned up its partial file.
            if (!transferring) finish(false);
        }
        @Override public void onActivityCreated(Activity host, Bundle state) { }
        @Override public void onActivityStarted(Activity host) { }
        @Override public void onActivityResumed(Activity host) { }
        @Override public void onActivityPaused(Activity host) { }
        @Override public void onActivityStopped(Activity host) { }
        @Override public void onActivitySaveInstanceState(Activity host, Bundle state) { }
    }

    private static boolean validId(String id) { return id != null && id.matches("[A-Za-z0-9_-]{11}"); }

    private static String title(String value, String fallback) {
        if (value == null || value.trim().isEmpty()) return fallback;
        value = value.replaceAll("[\\r\\n\\t]+", " ").trim();
        return value.length() <= 100 ? value : value.substring(0, 97) + "...";
    }

    private static String size(long bytes) { return String.format(java.util.Locale.US, "%.1f MB", bytes / (1024.0 * 1024.0)); }

    private static String join(List<String> values) {
        StringBuilder result = new StringBuilder();
        for (String value : values) { if (result.length() > 0) result.append('\n'); result.append(value); }
        return result.toString();
    }

    private static String friendly(Exception failure) {
        if (failure instanceof java.net.SocketTimeoutException) return "A conexao demorou demais. Confira se o computador continua ligado e acessivel.";
        if (failure instanceof java.net.UnknownHostException || failure instanceof java.net.ConnectException) return "Nao foi possivel acessar o computador/servidor. Confira a conexao e o endereco.";
        if (failure instanceof javax.net.ssl.SSLException) return "Nao foi possivel validar a conexao HTTPS do servidor.";
        String text = failure.getMessage();
        if (failure instanceof IOException && text != null) {
            text = text.replaceAll("https?://\\S+", "[endereco]").replaceAll("[\\r\\n\\t]+", " ");
            if (text.length() <= 240) return text;
        }
        return "Nao foi possivel concluir esta operacao. Tente novamente; as musicas ja salvas foram preservadas.";
    }

    private static boolean alive(Activity activity) { return activity != null && !activity.isFinishing() && !activity.isDestroyed(); }

    private static void message(Activity activity, String heading, String text) {
        activity.runOnUiThread(() -> {
            if (!alive(activity)) return;
            try { new AlertDialog.Builder(activity).setTitle(heading).setMessage(text).setPositiveButton("OK", null).show(); }
            catch (RuntimeException ignored) { }
        });
    }

    private static final class Cancelled extends RuntimeException { }
    private static final class Unavailable extends IOException { Unavailable(String message) { super(message); } }
}
