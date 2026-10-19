package br.com.acervo.app;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/** Parses QR boundaries without DNS. Legacy HTTP links are parsed only for a migration message. */
public final class PairingLink {
    public final String origin;
    public final String url;
    public final String spkiPin;
    public final String pairToken;

    private PairingLink(String origin, String url, String token, String pin) {
        this.origin = origin;
        this.url = url;
        this.pairToken = token;
        this.spkiPin = pin;
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
            String origin = originOf(uri);
            if (origin == null || uri.getRawQuery() != null) throw invalid();
            String path = uri.getRawPath();
            if (path != null && !path.isEmpty() && !"/".equals(path)) throw invalid();
            String fragment = uri.getRawFragment();
            String token = null, pin = null;
            if (fragment != null) {
                String[] fields = fragment.split("&", -1);
                if (fields.length > 2) throw invalid();
                for (String field : fields) {
                    if (field.matches("pair=[A-Za-z0-9_-]{16,256}") && token == null) token = field.substring(5);
                    else if (field.matches("spki=[a-fA-F0-9]{64}") && pin == null) pin = field.substring(5).toLowerCase(Locale.US);
                    else throw invalid();
                }
                if (token == null) throw invalid();
                if (pin != null && (!origin.startsWith("https://") || !isPrivateIPv4(uri.getHost()))) throw invalid();
            }
            String normalized = token == null ? "" : "#pair=" + token + (pin == null ? "" : "&spki=" + pin);
            return new PairingLink(origin, origin + "/" + normalized, token, pin);
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
            String candidate = originOf(new URI(url));
            String trusted = originOf(new URI(trustedOrigin));
            return candidate != null && candidate.equals(trusted);
        } catch (URISyntaxException ex) {
            return false;
        }
    }

    private static String originOf(URI uri) {
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (scheme == null || host == null || uri.getRawUserInfo() != null) return null;
        scheme = scheme.toLowerCase(Locale.US);
        host = host.toLowerCase(Locale.US);
        if (!("https".equals(scheme) && isHttpsHost(host))
                && !("http".equals(scheme) && isPrivateIPv4(host))) return null;
        int port = uri.getPort();
        if (port == 0 || port > 65535 || port < -1) return null;
        // Reject empty, signed, padded or otherwise ambiguous port syntax.
        String authority = host + (port == -1 ? "" : ":" + port);
        if (!authority.equalsIgnoreCase(uri.getRawAuthority())) return null;
        int defaultPort = "https".equals(scheme) ? 443 : 80;
        return scheme + "://" + host + (port == -1 || port == defaultPort ? "" : ":" + port);
    }

    private static boolean isHttpsHost(String host) {
        // java.net.URI checks IPv6 syntax. Exclude scoped literals, which are local
        // interface references and interpreted differently across URL parsers.
        if (host.startsWith("[") && host.endsWith("]")) return host.indexOf('%') < 0;
        if (host.length() > 253 || !host.matches("[a-z0-9.-]+")) return false;
        if (host.matches("[0-9.]+")) {
            String[] parts = host.split("\\.", -1);
            if (parts.length != 4) return false;
            for (String part : parts) {
                if (part.isEmpty() || part.length() > 3 || (part.length() > 1 && part.charAt(0) == '0')
                        || Integer.parseInt(part) > 255) return false;
            }
            return true;
        }
        // Unicode names must be supplied in their explicit ASCII (punycode) form.
        // Disallow single-label and all-numeric final labels to avoid browsers'
        // legacy numeric-IP interpretation.
        String[] labels = host.split("\\.", -1);
        if (labels.length < 2 || labels[labels.length - 1].matches("[0-9]+")) return false;
        for (String label : labels) {
            if (label.length() < 1 || label.length() > 63 || label.startsWith("-") || label.endsWith("-")) return false;
        }
        return true;
    }

    private static IllegalArgumentException invalid() {
        return new IllegalArgumentException("Use o novo QR code seguro do Acervo ou o endereço HTTPS do seu servidor. O QR local deve conter a identidade criptográfica do computador.");
    }
}
