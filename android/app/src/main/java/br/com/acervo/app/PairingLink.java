package br.com.acervo.app;

import java.net.URI;
import java.net.URISyntaxException;

/** Restricts a connection to a literal private IPv4 address; never resolves DNS. */
public final class PairingLink {
    public final String origin;
    public final String url;

    private PairingLink(String origin, String url) {
        this.origin = origin;
        this.url = url;
    }

    public static PairingLink parse(String text) {
        if (text == null || text.length() > 2048) throw invalid();
        String value = text.trim();
        for (int i = 0; i < value.length(); i++) {
            if (value.charAt(i) <= 32 || value.charAt(i) == '\\') throw invalid();
        }
        if (!value.contains("://")) value = "http://" + value;
        try {
            URI uri = new URI(value);
            String host = uri.getHost();
            if (!"http".equalsIgnoreCase(uri.getScheme()) || uri.getRawUserInfo() != null
                    || !isPrivateIPv4(host) || uri.getRawQuery() != null) throw invalid();
            int port = uri.getPort();
            if (port == 0 || port > 65535 || port < -1) throw invalid();
            // Reject malformed, empty and ambiguous port syntax instead of normalizing it.
            String authority = host + (port == -1 ? "" : ":" + port);
            if (!authority.equals(uri.getRawAuthority())) throw invalid();
            String path = uri.getRawPath();
            if (path != null && !path.isEmpty() && !"/".equals(path)) throw invalid();
            String fragment = uri.getRawFragment();
            if (fragment != null && !fragment.matches("pair=[A-Za-z0-9_-]{16,256}")) throw invalid();
            String origin = "http://" + host + (port == -1 || port == 80 ? "" : ":" + port);
            return new PairingLink(origin, origin + "/" + (fragment == null ? "" : "#" + fragment));
        } catch (URISyntaxException ex) {
            throw invalid();
        }
    }

    public static boolean isPrivateIPv4(String host) {
        if (host == null || !host.matches("[0-9]{1,3}(\\.[0-9]{1,3}){3}")) return false;
        String[] parts = host.split("\\.");
        int[] values = new int[4];
        for (int i = 0; i < 4; i++) {
            if (parts[i].length() > 1 && parts[i].charAt(0) == '0') return false;
            values[i] = Integer.parseInt(parts[i]);
            if (values[i] > 255) return false;
        }
        return values[0] == 10 || (values[0] == 172 && values[1] >= 16 && values[1] <= 31)
                || (values[0] == 192 && values[1] == 168);
    }

    public static boolean isSameOrigin(String url, String trustedOrigin) {
        if (url == null || trustedOrigin == null) return false;
        try {
            URI candidate = new URI(url);
            URI trusted = new URI(trustedOrigin);
            int candidatePort = candidate.getPort() == -1 ? 80 : candidate.getPort();
            int trustedPort = trusted.getPort() == -1 ? 80 : trusted.getPort();
            return "http".equalsIgnoreCase(candidate.getScheme()) && candidate.getRawUserInfo() == null
                    && candidate.getHost() != null && candidate.getHost().equals(trusted.getHost())
                    && candidatePort == trustedPort;
        } catch (URISyntaxException ex) {
            return false;
        }
    }

    private static IllegalArgumentException invalid() {
        return new IllegalArgumentException("Use o link do QR code do Acervo ou um endereço local como http://192.168.1.10:4310. Celular e computador precisam estar na mesma rede Wi-Fi.");
    }
}
