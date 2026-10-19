package br.com.acervo.app;

import android.content.Context;
import android.content.SharedPreferences;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.security.GeneralSecurityException;
import javax.net.ssl.HttpsURLConnection;

/** Origin-bound transport shared by the WebView, sync, artwork and app updater. */
public final class SecureTransport {
    private SecureTransport() { }
    private static SharedPreferences pins(Context context) { return context.getSharedPreferences("acervo_server_identities", Context.MODE_PRIVATE); }
    public static String getPin(Context context, String origin) { return pins(context).getString(PairingLink.parse(origin).origin, null); }
    public static boolean hasPin(Context context, String origin) { return PinnedTls.validPin(getPin(context, origin)); }
    public static void forget(Context context, String origin) { pins(context).edit().remove(PairingLink.parse(origin).origin).commit(); }

    /** Called only after the person scans/accepts a QR. Key changes need explicit removal first. */
    public static void trust(Context context, PairingLink link) throws IOException {
        if (!link.origin.startsWith("https://")) throw new IOException("Esta conexão antiga usa HTTP. Gere um novo QR code seguro no computador.");
        String host = URI.create(link.origin).getHost();
        if (link.spkiPin == null) {
            if (PairingLink.isPrivateIPv4(host) && !hasPin(context, link.origin)) throw new IOException("Escaneie o QR code seguro do computador para confirmar sua identidade.");
            return;
        }
        if (!PairingLink.isPrivateIPv4(host) || !PinnedTls.validPin(link.spkiPin)) throw new IOException("Identidade do QR code inválida.");
        synchronized (SecureTransport.class) {
            String old = getPin(context, link.origin);
            if (old != null && !old.equals(link.spkiPin)) throw new IOException("A identidade deste computador mudou. Confira o novo código no PC e remova o pareamento antigo antes de parear novamente.");
            if (!pins(context).edit().putString(link.origin, link.spkiPin).commit()) throw new IOException("Não foi possível guardar a identidade do computador.");
        }
    }

    public static HttpURLConnection open(Context context, URL target, String origin) throws IOException { return open(context, target.toString(), origin); }
    public static HttpURLConnection open(Context context, String target, String origin) throws IOException {
        if (origin == null || !PairingLink.isSameOrigin(target, origin) || !origin.startsWith("https://")) throw new IOException("Conexão insegura ou fora do servidor pareado bloqueada.");
        URL url = new URL(target);
        HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(45000);
        String pin = getPin(context, origin);
        if (PairingLink.isPrivateIPv4(url.getHost()) && !PinnedTls.validPin(pin)) {
            connection.disconnect();
            throw new IOException("Esta conexão precisa de um novo pareamento por QR code seguro.");
        }
        if (pin != null) {
            try { PinnedTls.configure(connection, url.getHost(), pin); }
            catch (GeneralSecurityException failure) { connection.disconnect(); throw new IOException("Não foi possível verificar a identidade do computador.", failure); }
        }
        return connection;
    }
}
