package br.com.acervo.app;

import java.net.URI;

/** JVM checks for update URL boundaries and version/hash parsing. */
public final class AppUpdaterPolicyTest {
    private static int checks;
    private static void check(boolean actual, boolean expected, String label) {
        checks++;
        if (actual != expected) throw new AssertionError(label);
    }
    private static void url(String candidate, String origin, boolean github, boolean expected) throws Exception {
        check(AppUpdater.allowedUrl(new URI(candidate), origin, github), expected, candidate);
    }
    public static void main(String[] args) throws Exception {
        url("https://music.example/downloads/acervo.apk", "https://music.example", false, true);
        url("https://music.example:443/downloads/acervo.apk", "https://music.example", false, true);
        url("https://other.example/acervo.apk", "https://music.example", false, false);
        url("http://music.example/acervo.apk", "https://music.example", false, false);
        url("http://192.168.1.8:4310/downloads/acervo.apk", "http://192.168.1.8:4310", false, true);
        url("http://192.168.1.8:4311/downloads/acervo.apk", "http://192.168.1.8:4310", false, false);
        url("http://8.8.8.8/acervo.apk", "http://8.8.8.8", false, false);
        url("https://person:secret@music.example/acervo.apk", "https://music.example", false, false);
        url("https://music.example/acervo.apk#fragment", "https://music.example", false, false);
        url("https://api.github.com/repos/amarosilvasouza1/acervo/releases/latest", null, true, true);
        url("https://api.github.com/repos/other/acervo/releases/latest", null, true, false);
        url("https://api.github.com/repos/amarosilvasouza1/acervo/releases/latest?other=1", null, true, false);
        url("https://github.com/amarosilvasouza1/acervo/releases/download/v1.2.0/acervo-1.2.0.apk", null, true, true);
        url("https://github.com/other/acervo/releases/download/v1.2.0/acervo.apk", null, true, false);
        url("https://github.com/amarosilvasouza1/acervo/issues/1", null, true, false);
        url("https://release-assets.githubusercontent.com/signed-asset?token=fixture", null, true, true);
        url("https://objects.githubusercontent.com/github-production-release-asset/fixture", null, true, true);
        url("https://release-assets.githubusercontent.com.evil.example/fixture", null, true, false);
        url("http://release-assets.githubusercontent.com/fixture", null, true, false);
        url("https://release-assets.githubusercontent.com:8443/fixture", null, true, false);
        url("file:///tmp/acervo.apk", null, true, false);
        check(AppUpdater.validHash("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), true, "SHA256");
        check(AppUpdater.validHash("abc"), false, "short hash");
        check(AppUpdater.validHash(null), false, "missing hash");
        check(AppUpdater.sameOrOlderVersion("1.2.0", "1.2.0"), true, "same version");
        check(AppUpdater.sameOrOlderVersion("1.2", "1.2.0"), true, "same padded version");
        check(AppUpdater.sameOrOlderVersion("1.1.99", "1.2.0"), true, "old version");
        check(AppUpdater.sameOrOlderVersion("1.10.0", "1.2.0"), false, "numeric comparison");
        check(AppUpdater.sameOrOlderVersion("2.0.0", "1.2.0"), false, "major update");
        check(AppUpdater.sameOrOlderVersion("1.2.0-beta", "1.2.0"), false, "unknown version");
        check(AppUpdater.sameOrOlderVersion("999999999999999999999.0", "1.2.0"), false, "version overflow");
        System.out.println("Updater policy: " + checks + " checks passed.");
    }
}
