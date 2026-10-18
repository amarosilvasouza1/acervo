package br.com.acervo.app;

import java.net.URI;
import java.util.Locale;

/** Explicit release source. Leave empty until the owner supplies the repository. */
public final class UpdateSource {
    public static final String GITHUB_REPOSITORY = "";

    private UpdateSource() { }

    public static boolean validRepository(String repository) {
        if (repository == null || repository.length() > 140) return false;
        String[] parts = repository.split("/", -1);
        if (parts.length != 2) return false;
        String owner = parts[0];
        String name = parts[1];
        return owner.matches("[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?")
                && !owner.contains("--") && name.matches("[A-Za-z0-9_.-]{1,100}")
                && !".".equals(name) && !"..".equals(name) && !name.toLowerCase(Locale.US).endsWith(".git");
    }

    public static boolean configured() { return validRepository(GITHUB_REPOSITORY); }

    public static String latestReleaseApi(String repository) {
        if (!validRepository(repository)) throw new IllegalArgumentException("Repositorio GitHub nao configurado.");
        return "https://api.github.com/repos/" + repository + "/releases/latest";
    }

    public static boolean releaseAssetUrl(URI uri, String repository) {
        if (!validRepository(repository) || !secure(uri) || !"github.com".equalsIgnoreCase(uri.getHost())) return false;
        String prefix = "/" + repository + "/releases/download/";
        String path = uri.getRawPath();
        if (path == null || !path.startsWith(prefix)) return false;
        String[] components = path.substring(prefix.length()).split("/", -1);
        return components.length == 2 && safeComponent(components[0]) && safeComponent(components[1]);
    }

    public static boolean allowedGitHubUri(URI uri, String repository) {
        if (!validRepository(repository) || !secure(uri)) return false;
        String host = uri.getHost().toLowerCase(Locale.US);
        if ("api.github.com".equals(host)) {
            return ("/repos/" + repository + "/releases/latest").equals(uri.getRawPath()) && uri.getRawQuery() == null;
        }
        if ("github.com".equals(host)) return releaseAssetUrl(uri, repository);
        // These hosts are accepted only after an explicitly configured GitHub release URL.
        return "objects.githubusercontent.com".equals(host) || "release-assets.githubusercontent.com".equals(host);
    }

    private static boolean secure(URI uri) {
        return uri != null && "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null
                && (uri.getPort() == -1 || uri.getPort() == 443)
                && uri.getRawUserInfo() == null && uri.getRawFragment() == null;
    }

    private static boolean safeComponent(String component) {
        return !component.isEmpty() && !".".equals(component) && !"..".equals(component)
                && component.matches("[A-Za-z0-9._-]+");
    }
}
