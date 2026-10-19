package br.com.acervo.app;

import com.sun.net.httpserver.HttpsConfigurator;
import com.sun.net.httpserver.HttpsServer;
import java.io.FileInputStream;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.cert.X509Certificate;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.HostnameVerifier;

/** Real loopback TLS: fixed QR identity succeeds; substituted and expired identities fail. */
public final class PinnedTlsTest {
    private static int checks;
    private static void check(boolean value, String label) { checks++; if (!value) throw new AssertionError(label); }
    public static void main(String[] args) throws Exception {
        KeyStore trusted = read(args[0]), substituted = read(args[1]), expired = read(args[2]);
        X509Certificate good = (X509Certificate) trusted.getCertificate("fixture");
        X509Certificate other = (X509Certificate) substituted.getCertificate("fixture");
        String pin = PinnedTls.fingerprint(good);
        check(pin.matches("[a-f0-9]{64}"), "SPKI SHA256 has canonical format");
        check(PinnedTls.matches(pin, good), "Exact QR key matches");
        check(!PinnedTls.matches(pin, other), "A different certificate key fails");
        check(!PinnedTls.validPin("a".repeat(63)) && !PinnedTls.validPin("g".repeat(64)), "Malformed pin fails");
        SSLSocketFactory defaultFactory = HttpsURLConnection.getDefaultSSLSocketFactory();
        HostnameVerifier defaultVerifier = HttpsURLConnection.getDefaultHostnameVerifier();
        HttpsServer server = serve(trusted);
        try {
            URL url = new URL("https://127.0.0.1:" + server.getAddress().getPort() + "/api/library");
            HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
            PinnedTls.configure(connection, "127.0.0.1", pin);
            connection.setConnectTimeout(3000); connection.setReadTimeout(3000);
            try (InputStream input = connection.getInputStream()) { check("encrypted-fixture".equals(new String(input.readAllBytes(), StandardCharsets.UTF_8)), "Authenticated TLS response arrives"); }
            finally { connection.disconnect(); }
            rejects(url, PinnedTls.fingerprint(other), "Substituted certificate cannot reuse a pairing");
            boolean mismatch = false;
            try { PinnedTls.configure((HttpsURLConnection) url.openConnection(), "192.168.1.99", pin); }
            catch (java.security.GeneralSecurityException expected) { mismatch = true; }
            check(mismatch, "Pinned origin cannot be changed by hostname verifier");
        } finally { server.stop(0); }
        HttpsServer stale = serve(expired);
        try { rejects(new URL("https://127.0.0.1:" + stale.getAddress().getPort() + "/"), PinnedTls.fingerprint((X509Certificate) expired.getCertificate("fixture")), "Even a pinned expired certificate fails"); }
        finally { stale.stop(0); }
        check(defaultFactory == HttpsURLConnection.getDefaultSSLSocketFactory(), "No global SSL trust override");
        check(defaultVerifier == HttpsURLConnection.getDefaultHostnameVerifier(), "No global hostname verifier override");
        System.out.println("Pinned TLS: " + checks + " checks passed.");
    }
    private static void rejects(URL url, String pin, String label) throws Exception {
        HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
        connection.setConnectTimeout(3000); connection.setReadTimeout(3000);
        PinnedTls.configure(connection, url.getHost(), pin);
        boolean denied = false;
        try { connection.getInputStream().close(); } catch (javax.net.ssl.SSLException expected) { denied = true; }
        finally { connection.disconnect(); }
        check(denied, label);
    }
    private static KeyStore read(String path) throws Exception {
        KeyStore store = KeyStore.getInstance("PKCS12");
        try (FileInputStream input = new FileInputStream(path)) { store.load(input, "fixture-only".toCharArray()); }
        return store;
    }
    private static HttpsServer serve(KeyStore store) throws Exception {
        KeyManagerFactory keys = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        keys.init(store, "fixture-only".toCharArray());
        SSLContext tls = SSLContext.getInstance("TLS"); tls.init(keys.getKeyManagers(), null, null);
        HttpsServer server = HttpsServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.setHttpsConfigurator(new HttpsConfigurator(tls));
        server.createContext("/", exchange -> {
            byte[] body = "encrypted-fixture".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length);
            try (java.io.OutputStream output = exchange.getResponseBody()) { output.write(body); }
        });
        server.start(); return server;
    }
}
