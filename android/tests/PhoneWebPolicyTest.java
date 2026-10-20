package br.com.acervo.app;

public final class PhoneWebPolicyTest {
    private static int checks;
    private static void check(boolean value, String message) {
        checks++;
        if (!value) throw new AssertionError(message);
    }
    public static void main(String[] args) {
        String origin = PhoneWebPolicy.ORIGIN;
        check(PhoneWebPolicy.target(origin + "/web") != null, "Shared web entry accepted");
        check(PhoneWebPolicy.target(origin + "/api/search?q=Racionais%20MCs") != null, "Encoded search preserved");
        check(PhoneWebPolicy.target(origin + "/api/artist?name=Seu%20Jorge") != null, "Artist query preserved");
        check(PhoneWebPolicy.target("https://app.acervo.local:443/api/library") != null, "Canonical HTTPS port accepted");
        check(PhoneWebPolicy.target("https://app.acervo.local:444/api/library") == null, "Other port blocked");
        check(PhoneWebPolicy.target("http://app.acervo.local/web") == null, "Cleartext blocked");
        check(PhoneWebPolicy.target("https://outside.example/api/library") == null, "Foreign origin blocked");
        check(PhoneWebPolicy.target("https://user@app.acervo.local/web") == null, "Userinfo blocked");
        check(PhoneWebPolicy.target(origin + "/web#executable") == null, "Request fragment blocked");
        check(PhoneWebPolicy.target(origin + "/%2e%2e/app.js") == null, "Encoded asset traversal blocked");
        check(PhoneWebPolicy.target(origin + "/web\\foo") == null, "Backslash blocked");
        check(PhoneWebPolicy.target(origin + "/" + new String(new char[8200]).replace('\0', 'a')) == null, "Large target blocked");
        check(PhoneWebPolicy.isVirtualHost("https://app.acervo.local:444/app.js"), "Virtual host never sent to DNS on other port");
        check(PhoneWebPolicy.isVirtualHost("http://APP.ACERVO.LOCAL/app.js"), "Virtual host never sent to DNS over HTTP");
        check("index.html".equals(PhoneWebPolicy.asset("/web")), "Mobile route uses shared index");
        check("index.html".equals(PhoneWebPolicy.asset("/")), "Root uses shared index");
        check("app.js".equals(PhoneWebPolicy.asset("/app.js")), "Shared script accepted");
        check("mobile.css".equals(PhoneWebPolicy.asset("/mobile.css")), "Shared mobile stylesheet accepted");
        check(PhoneWebPolicy.asset("/native-transport.js") == null, "Private bootstrap not available as asset");
        check(PhoneWebPolicy.asset("/../mobile-library.json") == null, "Private metadata blocked");
        check(PhoneWebPolicy.asset("/web/app.js") == null, "Only exact bundled paths accepted");
        check("text/css".equals(PhoneWebPolicy.mime("mobile.css")), "Stylesheet MIME correct");
        check("application/javascript".equals(PhoneWebPolicy.mime("app.js")), "Script MIME correct");
        System.out.println(checks + " phone web policy checks passed");
    }
}
