package br.com.acervo.app;

import java.io.IOException;
import java.net.InetAddress;
import java.net.Socket;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.List;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.KeyManager;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;
import javax.net.ssl.HostnameVerifier;

/** Per-connection TLS; the exact public key comes from the QR, never from the network. */
public final class PinnedTls {
    private PinnedTls() { }

    public static boolean validPin(String value) { return value != null && value.matches("[a-f0-9]{64}"); }

    public static String fingerprint(X509Certificate certificate) throws GeneralSecurityException {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(certificate.getPublicKey().getEncoded());
        StringBuilder value = new StringBuilder(64);
        for (byte part : digest) value.append(String.format(java.util.Locale.US, "%02x", part & 255));
        return value.toString();
    }

    static boolean matches(String expected, X509Certificate certificate) throws GeneralSecurityException {
        if (!validPin(expected) || certificate == null) return false;
        byte[] wanted = new byte[32];
        for (int i = 0; i < wanted.length; i++) wanted[i] = (byte) Integer.parseInt(expected.substring(i * 2, i * 2 + 2), 16);
        return MessageDigest.isEqual(wanted, MessageDigest.getInstance("SHA-256").digest(certificate.getPublicKey().getEncoded()));
    }

    public static void configure(HttpsURLConnection connection, String host, String pin) throws GeneralSecurityException {
        configure(connection, host, pin, null);
    }

    /** The client identity proves possession of the paired phone's private key during TLS. */
    public static void configure(HttpsURLConnection connection, String host, String pin, KeyManager[] clientIdentity) throws GeneralSecurityException {
        createSession(host, pin, clientIdentity).configure(connection);
    }

    public static Session createSession(String host, String pin, KeyManager[] clientIdentity) throws GeneralSecurityException {
        if (!validPin(pin) || host == null || host.isEmpty()) throw new GeneralSecurityException("Identidade TLS inválida.");
        X509TrustManager trust = new X509TrustManager() {
            public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
            public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException { throw new CertificateException("Client certificates unsupported."); }
            public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
                if (chain == null || chain.length == 0 || authType == null) throw new CertificateException("Certificado ausente.");
                chain[0].checkValidity();
                try { if (!matches(pin, chain[0])) throw new CertificateException("A identidade do computador mudou. Remova o pareamento antigo e confira um novo QR code."); }
                catch (GeneralSecurityException failure) { throw new CertificateException("Não foi possível verificar a identidade do computador.", failure); }
            }
        };
        SSLContext context = SSLContext.getInstance("TLS");
        context.init(clientIdentity, new TrustManager[] { trust }, null);
        HostnameVerifier verifier = (requested, session) -> {
            if (!host.equalsIgnoreCase(requested)) return false;
            try {
                X509Certificate certificate = (X509Certificate) session.getPeerCertificates()[0];
                certificate.checkValidity();
                return matches(pin, certificate);
            } catch (Exception failure) { return false; }
        };
        return new Session(host, context, new ModernSocketFactory(context.getSocketFactory()), verifier);
    }

    public static final class Session {
        private final String host;
        private final SSLContext context;
        private final SSLSocketFactory factory;
        private final HostnameVerifier verifier;
        private boolean invalidated;
        private Session(String serverHost, SSLContext tls, SSLSocketFactory sockets, HostnameVerifier hostname) {
            host = serverHost; context = tls; factory = sockets; verifier = hostname;
        }
        public synchronized void configure(HttpsURLConnection connection) throws GeneralSecurityException {
            if (invalidated || !host.equalsIgnoreCase(connection.getURL().getHost()) || !"https".equalsIgnoreCase(connection.getURL().getProtocol())) throw new GeneralSecurityException("Identidade TLS inválida.");
            connection.setSSLSocketFactory(factory);
            connection.setHostnameVerifier(verifier);
        }
        public synchronized void invalidate() {
            invalidated = true;
            java.util.Enumeration<byte[]> identifiers = context.getClientSessionContext().getIds();
            while (identifiers.hasMoreElements()) {
                javax.net.ssl.SSLSession session = context.getClientSessionContext().getSession(identifiers.nextElement());
                if (session != null) session.invalidate();
            }
        }
    }

    /** Explicitly suppresses TLS 1.0/1.1 without changing process-wide SSL defaults. */
    static final class ModernSocketFactory extends SSLSocketFactory {
        private final SSLSocketFactory delegate;
        ModernSocketFactory(SSLSocketFactory factory) { delegate = factory; }
        private Socket modern(Socket socket) throws IOException {
            if (!(socket instanceof SSLSocket)) throw new IOException("Socket TLS obrigatório.");
            SSLSocket tls = (SSLSocket) socket;
            List<String> protocols = new ArrayList<>();
            for (String protocol : tls.getSupportedProtocols()) if ("TLSv1.3".equals(protocol) || "TLSv1.2".equals(protocol)) protocols.add(protocol);
            if (protocols.isEmpty()) throw new IOException("Este aparelho não oferece TLS 1.2.");
            tls.setEnabledProtocols(protocols.toArray(new String[0]));
            return tls;
        }
        public String[] getDefaultCipherSuites() { return delegate.getDefaultCipherSuites(); }
        public String[] getSupportedCipherSuites() { return delegate.getSupportedCipherSuites(); }
        public Socket createSocket() throws IOException { return modern(delegate.createSocket()); }
        public Socket createSocket(Socket socket, String host, int port, boolean close) throws IOException { return modern(delegate.createSocket(socket, host, port, close)); }
        public Socket createSocket(String host, int port) throws IOException { return modern(delegate.createSocket(host, port)); }
        public Socket createSocket(String host, int port, InetAddress local, int localPort) throws IOException { return modern(delegate.createSocket(host, port, local, localPort)); }
        public Socket createSocket(InetAddress host, int port) throws IOException { return modern(delegate.createSocket(host, port)); }
        public Socket createSocket(InetAddress host, int port, InetAddress local, int localPort) throws IOException { return modern(delegate.createSocket(host, port, local, localPort)); }
    }
}
