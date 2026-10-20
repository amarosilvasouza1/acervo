package br.com.acervo.app;

import android.content.Context;
import android.content.SharedPreferences;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.security.GeneralSecurityException;
import java.security.cert.X509Certificate;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.net.ssl.X509KeyManager;
import javax.net.ssl.HttpsURLConnection;

/** Origin-bound transport shared by the WebView, sync, artwork and app updater. */
public final class SecureTransport {
    private SecureTransport() { }
    private static final LinkedHashMap<String, IdentitySession> sessions = new LinkedHashMap<>(8, 0.75f, true);
    private static final class IdentitySession {
        final String pin;
        final String phone;
        final X509Certificate certificate;
        final PinnedTls.Session tls;
        IdentitySession(String serverPin, String phonePin, X509Certificate identity, PinnedTls.Session transport) { pin = serverPin; phone = phonePin; certificate = identity; tls = transport; }
    }
    private static synchronized void invalidate(String origin) {
        IdentitySession previous = sessions.remove(origin);
        if (previous != null) previous.tls.invalidate();
    }
    private static synchronized void invalidateComputer(String pin) {
        java.util.Iterator<Map.Entry<String, IdentitySession>> iterator = sessions.entrySet().iterator();
        while (iterator.hasNext()) {
            IdentitySession identity = iterator.next().getValue();
            if (identity.pin.equals(pin)) { identity.tls.invalidate(); iterator.remove(); }
        }
    }
    private static synchronized PinnedTls.Session session(Context context, String origin, String pin) throws GeneralSecurityException, IOException {
        IdentitySession saved = sessions.get(origin);
        if (saved != null && saved.pin.equals(pin)) {
            saved.certificate.checkValidity();
            return saved.tls;
        }
        invalidate(origin);
        javax.net.ssl.KeyManager[] managers = PhoneIdentity.keyManagers(context, origin);
        X509Certificate certificate = null;
        for (javax.net.ssl.KeyManager manager : managers) if (manager instanceof X509KeyManager) {
            X509KeyManager identity = (X509KeyManager) manager;
            String[] aliases = identity.getClientAliases("EC", null);
            if (aliases != null && aliases.length == 1) {
                X509Certificate[] chain = identity.getCertificateChain(aliases[0]);
                if (chain != null && chain.length > 0) certificate = chain[0];
            }
        }
        if (certificate == null) throw new GeneralSecurityException("Identidade do telefone ausente.");
        certificate.checkValidity();
        String phone = PinnedTls.fingerprint(certificate);
        if (!PinnedTls.validPin(phone)) throw new GeneralSecurityException("Identidade do telefone ausente.");
        PinnedTls.Session transport = PinnedTls.createSession(URI.create(origin).getHost(), pin, managers);
        if (sessions.size() >= 8) {
            Map.Entry<String, IdentitySession> oldest = sessions.entrySet().iterator().next();
            invalidate(oldest.getKey());
        }
        sessions.put(origin, new IdentitySession(pin, phone, certificate, transport));
        return transport;
    }
    private static SharedPreferences pins(Context context) { return context.getSharedPreferences("acervo_server_identities", Context.MODE_PRIVATE); }
    public static String getPin(Context context, String origin) { return pins(context).getString(PairingLink.parse(origin).origin, null); }
    public static boolean hasPin(Context context, String origin) { return PinnedTls.validPin(getPin(context, origin)); }
    public static synchronized void forget(Context context, String origin) throws IOException {
        String canonical = PairingLink.parse(origin).origin;
        invalidate(canonical);
        PhoneIdentity.forget(context, canonical);
        if (!pins(context).edit().remove(canonical).commit()) throw new IOException("Não foi possível remover a identidade do computador.");
    }

    /** Called only after the person scans/accepts a QR. Key changes need explicit removal first. */
    public static void trust(Context context, PairingLink link) throws IOException {
        if (!link.origin.startsWith("https://")) throw new IOException("Esta conexão antiga usa HTTP. Gere um novo QR code seguro no computador.");
        if (link.spkiPin != null && link.pairToken != null && !link.requireClientIdentity) throw new IOException("Este QR code é antigo. Atualize o Acervo no PC e gere um novo QR com a identidade dos dois dispositivos.");
        String host = URI.create(link.origin).getHost();
        if (link.spkiPin == null) {
            if (hasPin(context, link.origin)) PhoneIdentity.keyManagers(context, link.origin);
            else if (PairingLink.isPrivateIPv4(host)) throw new IOException("Escaneie o QR code seguro do computador para confirmar sua identidade.");
            return;
        }
        if (!PinnedTls.validPin(link.spkiPin)) throw new IOException("Identidade do QR code inválida.");
        synchronized (SecureTransport.class) {
            String old = getPin(context, link.origin);
            if (old != null && !old.equals(link.spkiPin)) throw new IOException("A identidade deste computador mudou. Confira o novo código no PC e remova o pareamento antigo antes de parear novamente.");
            // An explicit new QR authorizes migration from the old SHA256-only key.
            PhoneIdentity.ensure(context, link.origin, link.spkiPin);
            invalidateComputer(link.spkiPin);
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
            try { session(context, PairingLink.parse(origin).origin, pin).configure(connection); }
            catch (GeneralSecurityException | IOException failure) { connection.disconnect(); throw new IOException("Não foi possível verificar a identidade dos aparelhos.", failure); }
        }
        return connection;
    }
}
