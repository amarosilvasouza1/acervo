package br.com.acervo.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.ProgressDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.webkit.CookieManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

/** Explicit, user-initiated updates. Android always handles the final installation. */
public final class AppUpdater {
    private static final String PACKAGE = "br.com.acervo.app";
    private static final long MAX_APK_BYTES = 100L * 1024L * 1024L;
    private static final AtomicBoolean BUSY = new AtomicBoolean(false);
    private static volatile File pendingApk;

    private AppUpdater() { }

    public static void check(final Activity activity, final String configuredOriginOrNull) {
        if (!alive(activity)) return;
        if (!BUSY.compareAndSet(false, true)) {
            message(activity, "Atualizacao", "Ja existe uma verificacao ou download em andamento.");
            return;
        }
        final AtomicBoolean cancelled = new AtomicBoolean(false);
        final ProgressDialog progress = progress(activity, "Procurando atualizacoes...", cancelled);
        new Thread(() -> {
            try {
                final PackageInfo installed = installedPackage(activity);
                File cached = pendingApk;
                if (cached != null && cached.isFile()) {
                    try {
                        verifyPackage(activity, cached, versionCode(installed));
                        if (!cancelled.get()) ui(activity, () -> install(activity, cached));
                        return;
                    } catch (Exception ex) {
                        // Cache may have been evicted or damaged; fetch metadata again.
                        pendingApk = null;
                        cached.delete();
                    }
                }
                final Update update;
                if (configuredOriginOrNull != null && !configuredOriginOrNull.trim().isEmpty()) {
                    String origin = PairingLink.parse(configuredOriginOrNull).origin;
                    JSONObject metadata = new JSONObject(readText(activity, new URL(origin + "/api/app/version"), origin, false, 2 * 1024 * 1024, cancelled));
                    update = serverUpdate(metadata, origin);
                } else {
                    if (!UpdateSource.configured()) {
                        message(activity, "Atualizacao", "Atualizações pelo GitHub serão ativadas quando o repositório for configurado. Você também pode atualizar pelo servidor Acervo conectado.");
                        return;
                    }
                    JSONObject metadata = new JSONObject(readText(activity, new URL(UpdateSource.latestReleaseApi(UpdateSource.GITHUB_REPOSITORY)), null, true, 2 * 1024 * 1024, cancelled));
                    update = githubUpdate(metadata);
                }
                if (update.versionCode > 0 && update.versionCode <= versionCode(installed)) {
                    message(activity, "Atualizacao", "Voce ja tem a versao mais recente disponivel nesta fonte (" + installed.versionName + ").");
                    return;
                }
                if (update.versionCode == 0 && sameOrOlderVersion(update.versionName, installed.versionName)) {
                    message(activity, "Atualizacao", "A ultima versao publicada nesta fonte e " + update.versionName + ". Sua versao instalada e " + installed.versionName + ".");
                    return;
                }
                if (cancelled.get()) return;
                ui(activity, () -> new AlertDialog.Builder(activity)
                        .setTitle("Atualizacao disponivel")
                        .setMessage("Versao " + update.versionName + ". Baixar e abrir o instalador do Android? Seus dados do Acervo serao mantidos.")
                        .setNegativeButton("Agora nao", null)
                        .setPositiveButton("Baixar", (dialog, which) -> download(activity, update))
                        .show());
            } catch (Exception ex) {
                if (!cancelled.get()) message(activity, "Nao foi possivel verificar", friendly(ex));
            } finally {
                BUSY.set(false);
                dismiss(activity, progress);
            }
        }, "Acervo-update-check").start();
    }

    private static Update serverUpdate(JSONObject metadata, String origin) throws Exception {
        long version = metadata.getLong("versionCode");
        String name = metadata.getString("versionName");
        String hash = metadata.getString("sha256").toLowerCase(Locale.US);
        URL apk = new URL(new URL(origin + "/"), metadata.getString("downloadUrl"));
        if (version < 1 || name.length() < 1 || name.length() > 80 || !validHash(hash) || !allowedUrl(apk.toURI(), origin, false)) {
            throw new IOException("O servidor informou uma atualizacao invalida.");
        }
        return new Update(version, name, apk, hash, null, origin, false);
    }

    private static Update githubUpdate(JSONObject metadata) throws Exception {
        if (metadata.optBoolean("draft") || metadata.optBoolean("prerelease")) throw new IOException("Nao existe uma versao estavel publicada.");
        String name = metadata.getString("tag_name");
        if (name.startsWith("v")) name = name.substring(1);
        if (name.length() < 1 || name.length() > 80) throw new IOException("A versao publicada e invalida.");
        JSONArray assets = metadata.getJSONArray("assets");
        JSONObject apkAsset = null;
        for (int i = 0; i < assets.length(); i++) {
            JSONObject asset = assets.getJSONObject(i);
            String filename = asset.optString("name");
            if (filename.matches("acervo(?:-[A-Za-z0-9._-]+)?\\.apk")) {
                if (apkAsset != null) throw new IOException("A publicacao tem mais de um APK. Use a pagina oficial para escolher a versao.");
                apkAsset = asset;
            }
        }
        if (apkAsset == null) throw new IOException("Esta publicacao ainda nao tem um APK para instalar.");
        if (apkAsset.optLong("size") > MAX_APK_BYTES) throw new IOException("O APK publicado excede o limite de 100 MB.");
        URL apk = new URL(apkAsset.getString("browser_download_url"));
        if (!releaseAssetUrl(apk.toURI())) throw new IOException("O endereco do APK nao pertence ao repositorio do Acervo.");
        String hash = apkAsset.optString("digest", "");
        hash = hash.startsWith("sha256:") ? hash.substring(7).toLowerCase(Locale.US) : "";
        if (!hash.isEmpty() && !validHash(hash)) throw new IOException("O checksum publicado e invalido.");
        URL hashUrl = null;
        for (int i = 0; i < assets.length(); i++) {
            JSONObject asset = assets.getJSONObject(i);
            if ((apkAsset.getString("name") + ".sha256").equals(asset.optString("name"))) {
                hashUrl = new URL(asset.getString("browser_download_url"));
                if (!releaseAssetUrl(hashUrl.toURI())) throw new IOException("O endereco do checksum e invalido.");
                break;
            }
        }
        return new Update(0, name, apk, hash, hashUrl, null, true);
    }

    private static void download(final Activity activity, final Update update) {
        if (!alive(activity) || !BUSY.compareAndSet(false, true)) return;
        final AtomicBoolean cancelled = new AtomicBoolean(false);
        final ProgressDialog progress = progress(activity, "Baixando atualizacao...", cancelled);
        new Thread(() -> {
            File partial = null;
            File complete = null;
            try {
                String expectedHash = update.sha256;
                if (expectedHash.isEmpty() && update.hashUrl != null) {
                    String checksum = readText(activity, update.hashUrl, update.origin, update.github, 16384, cancelled).trim();
                    expectedHash = checksum.split("\\s+", 2)[0].toLowerCase(Locale.US);
                    if (!validHash(expectedHash)) throw new IOException("O arquivo de checksum e invalido.");
                }
                File directory = new File(activity.getCacheDir(), "updates");
                if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Sem espaco para baixar a atualizacao.");
                partial = File.createTempFile("download-", ".part", directory);
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                HttpURLConnection connection = open(activity, update.apkUrl, update.origin, update.github);
                try {
                    long length = connection.getContentLengthLong();
                    if (length > MAX_APK_BYTES) throw new IOException("O APK excede o limite de 100 MB.");
                    long received = 0;
                    long started = System.nanoTime();
                    try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(partial)) {
                        byte[] bytes = new byte[32768];
                        int count;
                        while ((count = input.read(bytes)) != -1) {
                            if (cancelled.get() || !alive(activity)) throw new IOException("Download cancelado.");
                            received += count;
                            if (received > MAX_APK_BYTES || (System.nanoTime() - started) > 600000000000L) throw new IOException("O download excedeu o limite permitido.");
                            output.write(bytes, 0, count);
                            digest.update(bytes, 0, count);
                        }
                        output.getFD().sync();
                    }
                    if (received == 0 || (length >= 0 && received != length)) throw new IOException("O download foi interrompido. Tente novamente.");
                } finally { connection.disconnect(); }
                if (!expectedHash.isEmpty() && !expectedHash.equals(hex(digest.digest()))) throw new IOException("O checksum nao confere. O arquivo foi descartado.");
                if (cancelled.get() || !alive(activity)) throw new IOException("Download cancelado.");
                PackageInfo archive = verifyPackage(activity, partial, versionCode(installedPackage(activity)));
                if (update.versionCode > 0 && versionCode(archive) != update.versionCode) throw new IOException("A versao do APK difere da informada pelo servidor.");
                complete = new File(directory, "acervo-update-" + versionCode(archive) + "-" + UUID.randomUUID().toString().replace("-", "").substring(0, 16) + ".apk");
                if (!partial.renameTo(complete)) throw new IOException("Nao foi possivel salvar a atualizacao.");
                partial = null;
                pendingApk = complete;
                final File ready = complete;
                if (!cancelled.get()) ui(activity, () -> install(activity, ready));
            } catch (Exception ex) {
                if (complete != null) complete.delete();
                if (!cancelled.get()) message(activity, "Nao foi possivel atualizar", friendly(ex));
            } finally {
                if (partial != null) partial.delete();
                BUSY.set(false);
                dismiss(activity, progress);
            }
        }, "Acervo-update-download").start();
    }

    @SuppressWarnings("deprecation")
    private static PackageInfo installedPackage(Activity activity) throws PackageManager.NameNotFoundException {
        return activity.getPackageManager().getPackageInfo(PACKAGE,
                Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES);
    }

    @SuppressWarnings("deprecation")
    private static PackageInfo verifyPackage(Activity activity, File apk, long installedVersion) throws Exception {
        PackageInfo archive = activity.getPackageManager().getPackageArchiveInfo(apk.getAbsolutePath(),
                Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES);
        if (archive == null || !PACKAGE.equals(archive.packageName)) throw new IOException("O arquivo baixado nao e um APK valido do Acervo.");
        if (versionCode(archive) <= installedVersion) throw new IOException("Esse APK nao e mais recente que o Acervo instalado.");
        Signature[] current = signers(installedPackage(activity));
        Signature[] incoming = signers(archive);
        if (current == null || incoming == null || current.length == 0 || current.length != incoming.length) {
            throw new IOException("Nao foi possivel verificar a assinatura do APK.");
        }
        String[] a = new String[current.length];
        String[] b = new String[incoming.length];
        for (int i = 0; i < current.length; i++) a[i] = hex(MessageDigest.getInstance("SHA-256").digest(current[i].toByteArray()));
        for (int i = 0; i < incoming.length; i++) b[i] = hex(MessageDigest.getInstance("SHA-256").digest(incoming[i].toByteArray()));
        Arrays.sort(a);
        Arrays.sort(b);
        if (!Arrays.equals(a, b)) throw new IOException("A assinatura nao pertence ao Acervo instalado. O arquivo foi descartado.");
        return archive;
    }

    @SuppressWarnings("deprecation")
    private static Signature[] signers(PackageInfo info) {
        if (Build.VERSION.SDK_INT >= 28) return info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners();
        return info.signatures;
    }

    @SuppressWarnings("deprecation")
    private static long versionCode(PackageInfo info) { return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode; }

    private static void install(Activity activity, File apk) {
        if (!alive(activity)) return;
        try {
            if (!activity.getPackageManager().canRequestPackageInstalls()) {
                new AlertDialog.Builder(activity).setTitle("Permitir atualizacao")
                        .setMessage("Ative a permissao para o Acervo instalar atualizacoes. Depois, volte e toque em Atualizar novamente para abrir o instalador.")
                        .setNegativeButton("Agora nao", null)
                        .setPositiveButton("Abrir configuracao", (dialog, which) -> {
                            try { activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + PACKAGE))); }
                            catch (RuntimeException ex) { message(activity, "Atualizacao", "Abra as configuracoes do Android e permita instalar apps por esta fonte para o Acervo."); }
                        }).show();
                return;
            }
            Uri uri = ApkProvider.uriFor(activity, apk);
            Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, ApkProvider.APK_MIME)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.setClipData(ClipData.newRawUri("Atualizacao Acervo", uri));
            activity.startActivity(intent);
        } catch (ActivityNotFoundException ex) {
            message(activity, "Atualizacao", "Este aparelho nao disponibilizou um instalador de APKs.");
        } catch (Exception ex) {
            message(activity, "Atualizacao", "Nao foi possivel abrir o instalador. Toque em Atualizar para tentar novamente.");
        }
    }

    private static String readText(Activity activity, URL url, String origin, boolean github, int limit, AtomicBoolean cancelled) throws Exception {
        HttpURLConnection connection = open(activity, url, origin, github);
        try {
            if (connection.getContentLengthLong() > limit) throw new IOException("Resposta de atualizacao muito grande.");
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] bytes = new byte[8192];
                long started = System.nanoTime();
                int count;
                while ((count = input.read(bytes)) != -1) {
                    if (cancelled.get()) throw new IOException("Verificacao cancelada.");
                    if (System.nanoTime() - started > 60000000000L) throw new IOException("A verificacao demorou demais. Tente novamente.");
                    if (output.size() + count > limit) throw new IOException("Resposta de atualizacao muito grande.");
                    output.write(bytes, 0, count);
                }
                return new String(output.toByteArray(), StandardCharsets.UTF_8);
            }
        } finally { connection.disconnect(); }
    }

    private static HttpURLConnection open(Activity activity, URL initial, String origin, boolean github) throws Exception {
        URL url = initial;
        for (int redirect = 0; redirect <= 5; redirect++) {
            if (!allowedUrl(url.toURI(), origin, github)) throw new IOException("O endereco da atualizacao nao e permitido.");
            HttpURLConnection connection = github ? (HttpURLConnection) url.openConnection() : SecureTransport.open(activity, url, origin);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(20000);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("User-Agent", "AcervoAndroid updater");
            connection.setRequestProperty("Accept", github && "api.github.com".equalsIgnoreCase(url.getHost()) ? "application/vnd.github+json" : "*/*");
            connection.setRequestProperty("Accept-Encoding", "identity");
            if (!github && origin != null) {
                String cookies = CookieManager.getInstance().getCookie(origin + "/");
                if (cookies != null) connection.setRequestProperty("Cookie", cookies);
            }
            int status;
            try { status = connection.getResponseCode(); }
            catch (Exception ex) { connection.disconnect(); throw ex; }
            if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (!github || location == null || redirect == 5) throw new IOException("Redirecionamento de atualizacao invalido.");
                url = new URL(url, location);
                continue;
            }
            if (status < 200 || status >= 300) {
                connection.disconnect();
                if (status == 404) throw new IOException("Ainda nao ha uma atualizacao publicada nesta fonte. Nao foi possivel confirmar a versao mais recente.");
                if (status == 401 || status == 403) throw new IOException("A fonte de atualizacoes recusou o acesso. Conecte-se ao Acervo ou tente novamente mais tarde.");
                throw new IOException("A fonte de atualizacoes respondeu com erro " + status + ". Tente novamente mais tarde.");
            }
            return connection;
        }
        throw new IOException("Muitos redirecionamentos na atualizacao.");
    }

    static boolean allowedUrl(URI uri, String origin, boolean github) {
        return allowedUrl(uri, origin, github, UpdateSource.GITHUB_REPOSITORY);
    }

    static boolean allowedUrl(URI uri, String origin, boolean github, String repository) {
        if (uri == null || uri.getHost() == null || uri.getRawUserInfo() != null || uri.getRawFragment() != null) return false;
        if (!github) return "https".equalsIgnoreCase(uri.getScheme()) && origin != null && PairingLink.isSameOrigin(uri.toString(), origin);
        return UpdateSource.allowedGitHubUri(uri, repository);
    }

    private static boolean releaseAssetUrl(URI uri) {
        return UpdateSource.releaseAssetUrl(uri, UpdateSource.GITHUB_REPOSITORY);
    }

    static boolean validHash(String hash) { return hash != null && hash.matches("[a-f0-9]{64}"); }

    static boolean sameOrOlderVersion(String published, String installed) {
        if (published == null || installed == null || !published.matches("[0-9]+(?:\\.[0-9]+){1,3}") || !installed.matches("[0-9]+(?:\\.[0-9]+){1,3}")) return false;
        String[] a = published.split("\\.");
        String[] b = installed.split("\\.");
        try {
            for (int i = 0; i < Math.max(a.length, b.length); i++) {
                long left = i < a.length ? Long.parseLong(a[i]) : 0;
                long right = i < b.length ? Long.parseLong(b[i]) : 0;
                if (left != right) return left < right;
            }
            return true;
        } catch (NumberFormatException ex) { return false; }
    }

    private static String hex(byte[] bytes) {
        StringBuilder value = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) value.append(String.format(Locale.US, "%02x", b & 255));
        return value.toString();
    }

    private static boolean alive(Activity activity) { return activity != null && !activity.isFinishing() && !activity.isDestroyed(); }

    private static void ui(Activity activity, Runnable action) {
        activity.runOnUiThread(() -> { if (alive(activity)) { try { action.run(); } catch (RuntimeException ignored) { } } });
    }

    @SuppressWarnings("deprecation")
    private static ProgressDialog progress(Activity activity, String text, AtomicBoolean cancelled) {
        ProgressDialog dialog = new ProgressDialog(activity);
        dialog.setTitle("Atualizar Acervo");
        dialog.setMessage(text);
        dialog.setIndeterminate(true);
        dialog.setCancelable(true);
        dialog.setOnCancelListener(ignored -> cancelled.set(true));
        try { dialog.show(); } catch (RuntimeException ignored) { cancelled.set(true); }
        return dialog;
    }

    private static void dismiss(Activity activity, ProgressDialog dialog) {
        ui(activity, () -> { if (dialog.isShowing()) dialog.dismiss(); });
    }

    private static void message(Activity activity, String title, String text) {
        ui(activity, () -> new AlertDialog.Builder(activity).setTitle(title).setMessage(text).setPositiveButton("OK", null).show());
    }

    private static String friendly(Exception error) {
        if (error instanceof java.net.SocketTimeoutException) return "A verificacao demorou demais. Confira sua internet e tente novamente.";
        if (error instanceof java.net.UnknownHostException) return "Nao foi possivel encontrar o servidor. Confira sua internet e o endereco configurado.";
        if (error instanceof javax.net.ssl.SSLException) return "A conexao segura com a fonte de atualizacoes falhou. Confira o endereco e o certificado do servidor.";
        String text = error.getMessage();
        return error instanceof IOException && text != null && text.length() <= 300 ? text : "Nao foi possivel acessar uma atualizacao valida. Tente novamente mais tarde.";
    }

    private static final class Update {
        final long versionCode;
        final String versionName;
        final URL apkUrl;
        final String sha256;
        final URL hashUrl;
        final String origin;
        final boolean github;
        Update(long code, String name, URL apk, String hash, URL checksum, String serverOrigin, boolean fromGithub) {
            versionCode = code; versionName = name; apkUrl = apk; sha256 = hash; hashUrl = checksum; origin = serverOrigin; github = fromGithub;
        }
    }
}
