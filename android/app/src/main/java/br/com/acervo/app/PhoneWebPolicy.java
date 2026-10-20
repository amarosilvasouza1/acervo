package br.com.acervo.app;

import java.net.URI;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/** The offline origin is virtual: it must never be resolved or opened over the network. */
public final class PhoneWebPolicy {
    public static final String ORIGIN = "https://app.acervo.local";
    private static final Set<String> ASSETS = new HashSet<>(Arrays.asList(
            "index.html", "styles.css", "mobile.css", "app.js", "radio.js", "connect.js",
            "explore.js", "views.js", "icon.svg", "manifest.webmanifest"));

    private PhoneWebPolicy() { }

    public static boolean isVirtualHost(String target) {
        try { return "app.acervo.local".equalsIgnoreCase(new URI(target).getHost()); }
        catch (Exception invalid) { return false; }
    }

    public static URI target(String target) {
        if (target == null || target.length() > 8192 || target.indexOf('\\') >= 0) return null;
        try {
            URI uri = new URI(target);
            if (!PairingLink.isSameOrigin(target, ORIGIN) || uri.getRawFragment() != null) return null;
            String path = uri.getRawPath();
            if (path == null || !path.startsWith("/") || (path.indexOf('%') >= 0 && !path.startsWith("/api/"))) return null;
            return uri;
        } catch (Exception invalid) { return null; }
    }

    public static String asset(String path) {
        if ("/".equals(path) || "/web".equals(path) || "/web/".equals(path)) return "index.html";
        if (path == null || !path.startsWith("/")) return null;
        String name = path.substring(1);
        return ASSETS.contains(name) ? name : null;
    }

    public static String mime(String asset) {
        if (asset.endsWith(".html")) return "text/html";
        if (asset.endsWith(".css")) return "text/css";
        if (asset.endsWith(".js")) return "application/javascript";
        if (asset.endsWith(".svg")) return "image/svg+xml";
        if (asset.endsWith(".webmanifest")) return "application/manifest+json";
        return "application/octet-stream";
    }
}
