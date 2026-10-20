package br.com.acervo.app;

import java.io.FileInputStream;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import javax.net.ssl.X509ExtendedKeyManager;

/** Runs the origin and alias policy without emulating Android Keystore hardware. */
public final class PhoneIdentityPolicyTest {
    private static int checks;
    private static void check(boolean value, String message) { checks++; if (!value) throw new AssertionError(message); }
    public static void main(String[] args) throws Exception {
        String alias = PhoneIdentity.aliasFor("a".repeat(64));
        check(PhoneIdentity.canonicalOrigin("https://Example.com:443").equals(PhoneIdentity.canonicalOrigin("https://example.com/")), "Origin mappings use canonical HTTPS addresses");
        check(alias.equals(PhoneIdentity.aliasFor("a".repeat(64))), "The same PC pin reuses one identity across LAN and public addresses");
        check(!alias.equals(PhoneIdentity.aliasFor("b".repeat(64))), "Another PC public key receives another phone identity");
        check(alias.matches("acervo_device_v1_[a-f0-9]{64}"), "Aliases contain a digest instead of the server address");
        boolean rejected = false;
        try { PhoneIdentity.canonicalOrigin("http://192.168.1.2:4313"); } catch (java.security.GeneralSecurityException expected) { rejected = true; }
        check(rejected, "Cleartext cannot own a device identity");
        rejected = false;
        try { PhoneIdentity.aliasFor("not-a-pc-pin"); } catch (java.security.GeneralSecurityException expected) { rejected = true; }
        check(rejected, "An invalid PC pin cannot select a key alias");
        rejected = false;
        try {
            SecureTransport.trust(null, PairingLink.parse("https://192.168.1.10:4314/#pair=" + "a".repeat(32) + "&spki=" + "a".repeat(64)));
        } catch (java.io.IOException expected) { rejected = expected.getMessage().contains("QR code é antigo"); }
        check(rejected, "A fresh legacy pinned QR is rejected before any Android identity can be generated");
        KeyStore fixture = KeyStore.getInstance("PKCS12");
        try (FileInputStream input = new FileInputStream(args[0])) { fixture.load(input, "fixture-only".toCharArray()); }
        PrivateKey key = (PrivateKey) fixture.getKey("fixture", "fixture-only".toCharArray());
        X509Certificate certificate = (X509Certificate) fixture.getCertificate("fixture");
        X509Certificate[] originalChain = new X509Certificate[] { certificate };
        X509ExtendedKeyManager manager = PhoneIdentity.manager(alias, key, originalChain);
        originalChain[0] = null;
        check(alias.equals(manager.chooseClientAlias(new String[] { "RSA", "EC" }, null, null)), "Only the PC-bound EC alias is selected");
        check(alias.equals(manager.chooseEngineClientAlias(new String[] { "EC" }, null, null)), "Engine TLS uses the same narrow alias");
        check(manager.chooseClientAlias(new String[] { "RSA" }, null, null) == null, "RSA-only requests cannot select the identity");
        check(manager.chooseClientAlias(null, null, null) == null, "Missing key type cannot select the identity");
        check(manager.getClientAliases("EC", null).length == 1, "Exactly one alias can be disclosed");
        check(manager.getClientAliases("RSA", null) == null, "Unrelated client algorithms have no alias");
        check(manager.getPrivateKey(alias) == key && manager.getPrivateKey("unrelated_android_key") == null, "An unrelated Android alias cannot retrieve a key");
        check(manager.getCertificateChain(alias)[0] == certificate && manager.getCertificateChain("other") == null, "Only the bound certificate chain is exposed");
        X509Certificate[] returnedChain = manager.getCertificateChain(alias);
        returnedChain[0] = null;
        check(manager.getCertificateChain(alias)[0] == certificate, "Certificate arrays cannot mutate the key manager");
        check(manager.chooseServerAlias("EC", null, null) == null && manager.chooseEngineServerAlias("EC", null, null) == null
                && manager.getServerAliases("EC", null) == null, "The phone identity can never act as a server identity");
        System.out.println("Phone identity policy: " + checks + " checks passed. Android Keystore generation still requires an Android device.");
    }
}
