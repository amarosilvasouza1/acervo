package br.com.acervo.app;

import com.sun.net.httpserver.HttpsConfigurator;
import com.sun.net.httpserver.HttpsParameters;
import com.sun.net.httpserver.HttpsServer;
import java.io.FileInputStream;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.cert.X509Certificate;
import java.security.cert.CertificateException;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.KeyManager;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

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
        if (args.length >= 5) mutualTls(trusted, read(args[3]), read(args[4]));
        check(defaultFactory == HttpsURLConnection.getDefaultSSLSocketFactory(), "No global SSL trust override");
        check(defaultVerifier == HttpsURLConnection.getDefaultHostnameVerifier(), "No global hostname verifier override");
        System.out.println("Pinned TLS: " + checks + " checks passed.");
    }
    private static KeyManager[] managers(KeyStore store) throws Exception {
        KeyManagerFactory keys = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        keys.init(store, "fixture-only".toCharArray());
        return keys.getKeyManagers();
    }
    private static void mutualTls(KeyStore serverKeys, KeyStore pairedPhone, KeyStore stranger) throws Exception {
        String serverPin = PinnedTls.fingerprint((X509Certificate) serverKeys.getCertificate("fixture"));
        String phonePin = PinnedTls.fingerprint((X509Certificate) pairedPhone.getCertificate("fixture"));
        X509TrustManager onlyPhone = new X509TrustManager() {
            public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
            public void checkServerTrusted(X509Certificate[] chain, String type) throws CertificateException { throw new CertificateException("Server role blocked"); }
            public void checkClientTrusted(X509Certificate[] chain, String type) throws CertificateException {
                try {
                    if (chain == null || chain.length == 0 || !PinnedTls.matches(phonePin, chain[0])) throw new CertificateException("Unpaired phone");
                    chain[0].checkValidity();
                } catch (java.security.GeneralSecurityException failure) { throw new CertificateException("Unpaired phone", failure); }
            }
        };
        SSLContext tls = SSLContext.getInstance("TLS");
        tls.init(managers(serverKeys), new TrustManager[] { onlyPhone }, null);
        HttpsServer server = HttpsServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        java.util.List<Integer> acceptedPorts = new java.util.concurrent.CopyOnWriteArrayList<>();
        server.setHttpsConfigurator(new HttpsConfigurator(tls) {
            @Override public void configure(HttpsParameters parameters) {
                SSLParameters secure = getSSLContext().getDefaultSSLParameters();
                secure.setNeedClientAuth(true);
                parameters.setSSLParameters(secure);
            }
        });
        server.createContext("/", exchange -> {
            acceptedPorts.add(exchange.getRemoteAddress().getPort());
            byte[] body = "only-paired-phone".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length);
            try (java.io.OutputStream output = exchange.getResponseBody()) { output.write(body); }
        });
        server.start();
        try {
            URL url = new URL("https://127.0.0.1:" + server.getAddress().getPort() + "/api/library");
            HttpsURLConnection authorized = (HttpsURLConnection) url.openConnection();
            PinnedTls.Session session = PinnedTls.createSession(url.getHost(), serverPin, managers(pairedPhone));
            session.configure(authorized);
            authorized.setConnectTimeout(3000); authorized.setReadTimeout(3000);
            try (InputStream input = authorized.getInputStream()) {
                check("only-paired-phone".equals(new String(input.readAllBytes(), StandardCharsets.UTF_8)), "Paired phone proves possession of its private key");
            }
            HttpsURLConnection repeated = (HttpsURLConnection) url.openConnection();
            session.configure(repeated);
            repeated.setConnectTimeout(3000); repeated.setReadTimeout(3000);
            check(authorized.getSSLSocketFactory() == repeated.getSSLSocketFactory(), "The paired identity keeps one TLS factory across requests");
            try (InputStream input = repeated.getInputStream()) {
                check("only-paired-phone".equals(new String(input.readAllBytes(), StandardCharsets.UTF_8)), "The reused connection still authenticates the paired phone");
            }
            check(acceptedPorts.size() == 2 && acceptedPorts.get(0).equals(acceptedPorts.get(1)), "A completed response reuses the existing mutually authenticated TCP connection");
            session.invalidate();
            boolean invalidated = false;
            try { session.configure((HttpsURLConnection) url.openConnection()); }
            catch (java.security.GeneralSecurityException expected) { invalidated = true; }
            check(invalidated, "Removing a cached identity prevents new requests from using its TLS session");
            repeated.disconnect(); authorized.disconnect();
            rejectsClient(url, serverPin, null, "A copied cookie without the phone key cannot complete mutual TLS");
            rejectsClient(url, serverPin, managers(stranger), "Another phone key cannot complete mutual TLS");
            javax.net.ssl.X509ExtendedKeyManager publicOnly = new javax.net.ssl.X509ExtendedKeyManager() {
                public String[] getClientAliases(String type, java.security.Principal[] issuers) { return "EC".equals(type) ? new String[] { "public-only" } : null; }
                public String chooseClientAlias(String[] types, java.security.Principal[] issuers, java.net.Socket socket) { return "public-only"; }
                public String chooseEngineClientAlias(String[] types, java.security.Principal[] issuers, javax.net.ssl.SSLEngine engine) { return "public-only"; }
                public String[] getServerAliases(String type, java.security.Principal[] issuers) { return null; }
                public String chooseServerAlias(String type, java.security.Principal[] issuers, java.net.Socket socket) { return null; }
                public java.security.PrivateKey getPrivateKey(String alias) { return null; }
                public X509Certificate[] getCertificateChain(String alias) { try { return new X509Certificate[] { (X509Certificate) pairedPhone.getCertificate("fixture") }; } catch (Exception failure) { throw new AssertionError(failure); } }
            };
            rejectsClient(url, serverPin, new KeyManager[] { publicOnly }, "Copying the public certificate cannot prove possession of the private key");
        } finally { server.stop(0); }
    }
    private static void rejectsClient(URL url, String pin, KeyManager[] identity, String label) throws Exception {
        HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
        connection.setConnectTimeout(3000); connection.setReadTimeout(3000);
        connection.setRequestProperty("Cookie", "acervo_session=copied-fixture");
        PinnedTls.configure(connection, url.getHost(), pin, identity);
        boolean denied = false;
        try { connection.getInputStream().close(); } catch (java.io.IOException expected) { denied = true; }
        finally { connection.disconnect(); }
        check(denied, label);
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
