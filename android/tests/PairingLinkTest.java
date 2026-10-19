package br.com.acervo.app;

/** Standalone JVM regression tests for user supplied LAN/cloud QR trust boundaries. */
public final class PairingLinkTest {
    private static int assertions;
    private static final String TOKEN = "4O0jMsz_Bs9YD2xHhQ3rY8kEbP6NfvZWaLG7a-CuTqI";

    public static void main(String[] args) {
        PairingLink qr = PairingLink.parse("http://192.168.1.10:4313/#pair=" + TOKEN);
        equal("http://192.168.1.10:4313", qr.origin, "Saved address excludes the single-use QR token");
        equal("http://192.168.1.10:4313/#pair=" + TOKEN, qr.url, "Server QR fragment reaches the frontend intact");
        equal("http://10.0.0.2:4310/", PairingLink.parse(" 10.0.0.2:4310 ").url, "Manual address without scheme");
        equal("http://172.16.0.2/", PairingLink.parse("HTTP://172.16.0.2:80").url, "Default HTTP port normalization");
        equal("http://172.31.255.254:65535", PairingLink.parse("http://172.31.255.254:65535/").origin, "Maximum valid port");
        equal("http://192.168.0.2/#pair=" + "a".repeat(16), PairingLink.parse("http://192.168.0.2/#pair=" + "a".repeat(16)).url, "Minimum token boundary");
        equal("http://192.168.0.2/#pair=" + "_".repeat(256), PairingLink.parse("http://192.168.0.2/#pair=" + "_".repeat(256)).url, "Maximum token boundary");
        PairingLink cloud = PairingLink.parse("https://music.example.com/#pair=" + TOKEN);
        equal("https://music.example.com", cloud.origin, "Cloud origin saved without QR secret");
        equal("https://music.example.com/#pair=" + TOKEN, cloud.url, "HTTPS pairing token survives scanner boundary");
        equal("https://music.example.com/", PairingLink.parse("HTTPS://MUSIC.EXAMPLE.COM:443/").url, "HTTPS default port and case normalization");
        equal("https://music.example.com:8443/", PairingLink.parse("https://music.example.com:8443").url, "Custom HTTPS server port");
        equal("https://8.8.8.8/", PairingLink.parse("https://8.8.8.8/").url, "HTTPS public IPv4 literal");
        equal("https://[2001:4860:4860::8888]/", PairingLink.parse("https://[2001:4860:4860::8888]:443/").url, "HTTPS public IPv6 literal");
        equal("https://xn--bcher-kva.example/", PairingLink.parse("https://xn--bcher-kva.example/").url, "Explicit ASCII internationalized domain");
        equal("https://192.168.1.10:4313/", PairingLink.parse("https://192.168.1.10:4313/").url, "HTTPS also supported on a private address");
        String pin = "a1".repeat(32);
        PairingLink pinned = PairingLink.parse("https://192.168.1.10:4314/#pair=" + TOKEN + "&spki=" + pin);
        equal(pin, pinned.spkiPin, "QR carries the exact SPKI SHA256 identity");
        equal(TOKEN, pinned.pairToken, "One-time token is independent of public pin");
        equal(pinned.url, PairingLink.parse("https://192.168.1.10:4314/#spki=" + pin.toUpperCase() + "&pair=" + TOKEN).url, "Canonical pin and fragment ordering");
        for (String fragment : new String[] { "spki=" + pin, "pair=" + TOKEN + "&spki=" + "a".repeat(63), "pair=" + TOKEN + "&spki=" + "g".repeat(64), "pair=" + TOKEN + "&pair=" + TOKEN, "pair=" + TOKEN + "&spki=" + pin + "&spki=" + pin, "pair=" + TOKEN + "&spki=" + pin + "&next=evil", "pair=" + TOKEN + "&spki=" + pin + "%00" }) reject("https://192.168.1.10:4314/#" + fragment);
        reject("http://192.168.1.10:4314/#pair=" + TOKEN + "&spki=" + pin);
        reject("https://music.example.com/#pair=" + TOKEN + "&spki=" + pin);

        // All edges of the RFC1918 172.16/12 range, without consulting DNS.
        for (int second = 0; second <= 255; second++) {
            check(PairingLink.isPrivateIPv4("172." + second + ".0.1") == (second >= 16 && second <= 31), "RFC1918 range boundary: 172." + second);
        }
        for (String host : new String[] { "10.0.0.1", "10.255.255.254", "192.168.0.1", "192.168.255.254" }) {
            check(PairingLink.isPrivateIPv4(host), "Private host: " + host);
        }
        for (String host : new String[] { "8.8.8.8", "127.0.0.1", "0.0.0.0", "100.64.0.1", "169.254.1.1", "192.167.1.1", "192.169.1.1", "224.0.0.1", "255.255.255.255", "10.0.0.256", "10.0.0.-1", "010.0.0.1", "10.00.0.1", "0x0a.0.0.1", "167772161", "10.1", "localhost", "acervo.local", "::1", "fd00::1", "::ffff:192.168.1.1", null }) {
            check(!PairingLink.isPrivateIPv4(host), "Not an unambiguous private IPv4 literal: " + host);
        }

        for (String rejected : new String[] {
            null, "", "ftp://192.168.1.10/", "file:///192.168.1.10/", "javascript:alert(1)",
            "http://example.com/", "http://localhost/", "http://127.0.0.1/", "http://8.8.8.8/", "http://[::1]/", "http://[fd00::1]/",
            "http://192.168.1.10.evil.example/", "http://192.168.1.10@evil.example/", "http://evil.example@192.168.1.10/", "http://user:password@192.168.1.10/",
            "http://%31%39%32.168.1.10/", "http://192.168.1.10%2f.evil.example/", "http://192.168.1.10\\@evil.example/", "http://192.168.1.10\n.evil.example/",
            "http://192.168.1.10:/", "http://192.168.1.10:0/", "http://192.168.1.10:65536/", "http://192.168.1.10:-1/", "http://192.168.1.10:04313/", "http://192.168.1.10:+4313/",
            "http://192.168.1.10//evil.example", "http://192.168.1.10/api/connect/claim", "http://192.168.1.10/%2f", "http://192.168.1.10/../",
            "http://192.168.1.10/?pair=" + TOKEN, "http://192.168.1.10/?", "http://192.168.1.10/#", "http://192.168.1.10/#other=" + TOKEN,
            "http://192.168.1.10/#pair=short", "http://192.168.1.10/#pair=" + "a".repeat(15), "http://192.168.1.10/#pair=" + "a".repeat(257),
            "http://192.168.1.10/#pair=" + TOKEN + "&next=https://evil.example", "http://192.168.1.10/#pair=" + TOKEN + "%0a", "http://192.168.1.10/#pair=" + TOKEN + "#other", "a".repeat(2049)
        }) reject(rejected);

        for (String rejected : new String[] {
            "https://localhost/", "https://acervo/", "https://music.example.com./", "https://music..example.com/",
            "https://-music.example.com/", "https://music-.example.com/", "https://music_1.example.com/",
            "https://" + "a".repeat(64) + ".example.com/", "https://bücher.example/", "https://%6dic.example.com/",
            "https://music.example.com@evil.example/", "https://user:password@music.example.com/",
            "https://music.example.com:/", "https://music.example.com:0443/", "https://music.example.com:+443/",
            "https://music.example.com:0/", "https://music.example.com:65536/", "https://music.example.com:-1/",
            "https://music.example.com/?", "https://music.example.com/?pair=" + TOKEN,
            "https://music.example.com/api/", "https://music.example.com//", "https://music.example.com/%2f",
            "https://music.example.com/#pair=short", "https://music.example.com/#pair=" + TOKEN + "&next=elsewhere",
            "https://music.example.com\\@evil.example/", "https://music.example.com\n.evil.example/",
            "https://[fe80::1%25wlan0]/", "https://[not:ipv6]/", "https://2130706433/", "https://127.1/",
            "https://0177.0.0.1/", "https://0x7f.0.0.1/", "https://10.0.0.256/", "music.example.com/"
        }) reject(rejected);

        for (String same : new String[] { "http://192.168.1.10:4313/", "http://192.168.1.10:4313/api/tracks", "http://192.168.1.10:4313/#pair=" + TOKEN, "http://192.168.1.10:4313/api/stream/track?q=x" }) {
            check(PairingLink.isSameOrigin(same, qr.origin), "Navigation inside paired server: " + same);
        }
        for (String other : new String[] { null, "", "/api/tracks", "https://192.168.1.10:4313/", "http://192.168.1.10:4310/", "http://192.168.1.11:4313/", "http://192.168.1.10:4313.evil.example/", "http://evil.example/", "http://user@192.168.1.10:4313/", "javascript:alert(1)", "file:///android_asset/index.html", "intent://192.168.1.10:4313/", "http://192.168.1.10:4313\\@evil.example/" }) {
            check(!PairingLink.isSameOrigin(other, qr.origin), "Block navigation outside paired server: " + other);
        }
        check(PairingLink.isSameOrigin("http://192.168.1.10/", "http://192.168.1.10:80"), "HTTP default ports are equivalent");
        check(!PairingLink.isSameOrigin("http://192.168.1.10/", null), "Missing trusted origin");
        for (String same : new String[] {
            "https://music.example.com/", "https://MUSIC.EXAMPLE.COM:443/api/tracks",
            "https://music.example.com/api/stream/track?offset=5", "https://music.example.com/#pair=" + TOKEN
        }) check(PairingLink.isSameOrigin(same, cloud.origin), "HTTPS navigation inside paired server: " + same);
        for (String other : new String[] {
            "http://music.example.com/", "http://music.example.com:443/", "https://music.example.com:80/",
            "https://music.example.com:8443/", "https://music.example.com.evil.example/",
            "https://evil.example/", "https://user@music.example.com/", "https://music.example.com:/",
            "https://music.example.com:0443/", "https://music.example.com\\@evil.example/"
        }) check(!PairingLink.isSameOrigin(other, cloud.origin), "Block different or ambiguous HTTPS origin: " + other);
        check(!PairingLink.isSameOrigin("https://music.example.com/", "http://music.example.com/"), "Trusted HTTP origin cannot become HTTPS implicitly");
        check(PairingLink.isSameOrigin("https://[2001:4860:4860::8888]/api/tracks", "https://[2001:4860:4860::8888]:443"), "HTTPS IPv6 default ports equivalent");
        System.out.println("PairingLink: " + assertions + " assertions passed.");
    }

    private static void reject(String text) {
        boolean rejected = false;
        try { PairingLink.parse(text); } catch (IllegalArgumentException expected) { rejected = true; }
        check(rejected, "Unsafe or malformed pairing input rejected: " + text);
    }

    private static void equal(String expected, String actual, String message) {
        check(expected.equals(actual), message + " (expected " + expected + ", got " + actual + ")");
    }

    private static void check(boolean condition, String message) {
        assertions++;
        if (!condition) throw new AssertionError(message);
    }
}
