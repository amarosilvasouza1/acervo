package br.com.acervo.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyProperties;
import java.io.IOException;
import java.math.BigInteger;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.Key;
import java.security.KeyFactory;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.Principal;
import java.security.PrivateKey;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.security.spec.ECGenParameterSpec;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import javax.net.ssl.KeyManager;
import javax.net.ssl.SSLEngine;
import javax.net.ssl.X509ExtendedKeyManager;
import javax.security.auth.x500.X500Principal;

/** Each pinned PC receives a distinct, non-exportable Android Keystore identity, shared by its addresses. */
public final class PhoneIdentity {
    private static final String STORE = "AndroidKeyStore";
    private static final String PREFIX = "acervo_device_v1_";
    private static final String TLS_PREFIX = "acervo_device_v2_";
    private static final String UPGRADE = "A identidade antiga deste telefone precisa ser atualizada. Gere e escaneie um novo QR code no PC. Se o PC já mostra um celular vinculado, remova esse vínculo no PC antes de parear novamente.";
    private PhoneIdentity() { }

    static String canonicalOrigin(String origin) throws GeneralSecurityException {
        String canonical = PairingLink.parse(origin).origin;
        if (!canonical.startsWith("https://")) throw new GeneralSecurityException("Identidade exige HTTPS.");
        return canonical;
    }

    static String aliasFor(String serverPin) throws GeneralSecurityException {
        if (!PinnedTls.validPin(serverPin)) throw new GeneralSecurityException("Identidade do computador inválida.");
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(serverPin.getBytes(StandardCharsets.US_ASCII));
        StringBuilder alias = new StringBuilder(PREFIX);
        for (byte value : digest) alias.append(String.format(Locale.US, "%02x", value & 255));
        return alias.toString();
    }

    static String tlsAliasFor(String serverPin) throws GeneralSecurityException {
        return TLS_PREFIX + aliasFor(serverPin).substring(PREFIX.length());
    }

    static String[] tlsDigests() { return new String[] { KeyProperties.DIGEST_NONE, KeyProperties.DIGEST_SHA256 }; }

    static boolean supportsTlsDigest(String[] digests) {
        if (digests != null) for (String digest : digests) if (KeyProperties.DIGEST_NONE.equals(digest)) return true;
        return false;
    }

    private static String selectionKey(String pin) { return "identity_alias:" + pin; }

    private static String activeAlias(SharedPreferences preferences, String pin) throws GeneralSecurityException {
        String alias = preferences.getString(selectionKey(pin), null);
        if (alias == null) return aliasFor(pin); // Existing installations used v1 before alias selection was recorded.
        if (!alias.equals(aliasFor(pin)) && !alias.equals(tlsAliasFor(pin))) throw new GeneralSecurityException("Identidade selecionada inválida.");
        return alias;
    }

    /** This policy is used only after an explicit QR scan; ordinary reconnect never creates a key. */
    static String aliasForQr(String pin, String selected, boolean legacyExists, boolean legacyTls,
            boolean currentExists, boolean currentTls, boolean knownMapping) throws GeneralSecurityException {
        String legacy = aliasFor(pin), current = tlsAliasFor(pin);
        if (selected != null && !selected.equals(legacy) && !selected.equals(current)) throw new GeneralSecurityException("Identidade selecionada inválida.");
        if (current.equals(selected)) {
            if (!currentExists || !currentTls) throw new GeneralSecurityException("A chave pareada está ausente ou indisponível.");
            return current;
        }
        if (legacyExists && legacyTls) return legacy;
        if (currentExists) {
            if (!currentTls) throw new GeneralSecurityException("A chave TLS existente está indisponível.");
            return current;
        }
        if (knownMapping && !legacyExists) throw new GeneralSecurityException("A chave pareada foi removida do Android Keystore.");
        return current; // A fresh installation or an incompatible v1 identity gets a separate v2 key.
    }

    private static SharedPreferences identities(Context context) {
        return context.getSharedPreferences("acervo_phone_identities", Context.MODE_PRIVATE);
    }

    private static String mappedPin(Context context, String origin) throws GeneralSecurityException {
        String pin = identities(context).getString(canonicalOrigin(origin), null);
        if (!PinnedTls.validPin(pin)) throw new GeneralSecurityException("Identidade pareada deste telefone ausente.");
        return pin;
    }

    private static KeyStore store() throws GeneralSecurityException, IOException {
        KeyStore store = KeyStore.getInstance(STORE);
        store.load(null);
        return store;
    }

    /** Only the explicit QR trust path calls this; reconnect never silently replaces a key. */
    public static synchronized void ensure(Context context, String origin) throws IOException {
        ensure(context, origin, SecureTransport.getPin(context, origin));
    }

    public static synchronized void ensure(Context context, String origin, String serverPin) throws IOException {
        try {
            String canonical = canonicalOrigin(origin);
            SharedPreferences preferences = identities(context);
            String oldPin = preferences.getString(canonical, null);
            if (oldPin != null && !oldPin.equals(serverPin)) throw new GeneralSecurityException("A identidade do computador mudou.");
            KeyStore store = store();
            String legacy = aliasFor(serverPin), current = tlsAliasFor(serverPin);
            String alias = aliasForQr(serverPin, preferences.getString(selectionKey(serverPin), null),
                    store.containsAlias(legacy), tlsCapable(store, legacy), store.containsAlias(current), tlsCapable(store, current),
                    preferences.getAll().containsValue(serverPin));
            if (!store.containsAlias(alias)) {
                Calendar end = Calendar.getInstance();
                end.add(Calendar.YEAR, 10);
                KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, STORE);
                generator.initialize(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
                        .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
                        // Conscrypt pre-hashes the TLS transcript, then signs using NONEwithECDSA.
                        .setDigests(tlsDigests())
                        .setUserAuthenticationRequired(false)
                        .setCertificateSubject(new X500Principal("CN=Acervo device"))
                        .setCertificateSerialNumber(new BigInteger(127, new SecureRandom()).add(BigInteger.ONE))
                        .setCertificateNotBefore(new Date(System.currentTimeMillis() - 24L * 60 * 60 * 1000))
                        .setCertificateNotAfter(end.getTime())
                        .build());
                generator.generateKeyPair();
                store = store();
            }
            loadManager(store, alias);
            if (!preferences.edit().putString(canonical, serverPin).putString(selectionKey(serverPin), alias).commit()) throw new IOException("Não foi possível guardar o vínculo da identidade deste telefone.");
        } catch (GeneralSecurityException | IllegalArgumentException failure) {
            throw new IOException("Não foi possível proteger a identidade deste telefone no Android Keystore.", failure);
        }
    }

    public static synchronized KeyManager[] keyManagers(Context context, String origin) throws IOException {
        try {
            String pin = mappedPin(context, origin);
            return new KeyManager[] { loadManager(store(), activeAlias(identities(context), pin)) };
        }
        catch (GeneralSecurityException | IllegalArgumentException failure) {
            throw new IOException(failure instanceof TlsUpgradeRequired ? UPGRADE : "A identidade deste telefone não está disponível. Remova o pareamento e escaneie um novo QR code.", failure);
        }
    }

    public static synchronized String getFingerprint(Context context, String origin) throws IOException {
        try {
            KeyStore store = store();
            String pin = identities(context).getString(canonicalOrigin(origin), null);
            if (pin == null) return null;
            String alias = activeAlias(identities(context), pin);
            return PinnedTls.fingerprint(loadManager(store, alias).getCertificateChain(alias)[0]);
        } catch (GeneralSecurityException | IllegalArgumentException failure) {
            throw new IOException("Não foi possível conferir a identidade deste telefone.", failure);
        }
    }

    public static synchronized void forget(Context context, String origin) throws IOException {
        try {
            String canonical = canonicalOrigin(origin);
            SharedPreferences preferences = identities(context);
            String pin = preferences.getString(canonical, null);
            if (pin == null) return;
            boolean shared = false;
            for (java.util.Map.Entry<String, ?> mapping : preferences.getAll().entrySet()) {
                if (!canonical.equals(mapping.getKey()) && pin.equals(mapping.getValue())) { shared = true; break; }
            }
            SharedPreferences.Editor editor = preferences.edit().remove(canonical);
            if (!shared) {
                KeyStore store = store();
                store.deleteEntry(aliasFor(pin));
                store.deleteEntry(tlsAliasFor(pin));
                editor.remove(selectionKey(pin));
            }
            if (!editor.commit()) throw new IOException("Não foi possível remover o vínculo da identidade deste telefone.");
        }
        catch (GeneralSecurityException | IllegalArgumentException failure) {
            throw new IOException("Não foi possível remover a identidade deste telefone.", failure);
        }
    }

    private static final class TlsUpgradeRequired extends GeneralSecurityException { TlsUpgradeRequired() { super(UPGRADE); } }

    private static boolean tlsCapable(KeyStore store, String alias) throws GeneralSecurityException {
        if (!store.containsAlias(alias)) return false;
        Key key = store.getKey(alias, null);
        if (!(key instanceof PrivateKey) || !"EC".equalsIgnoreCase(key.getAlgorithm()) || key.getEncoded() != null) return false;
        KeyInfo info = KeyFactory.getInstance(KeyProperties.KEY_ALGORITHM_EC, STORE).getKeySpec(key, KeyInfo.class);
        return (info.getPurposes() & KeyProperties.PURPOSE_SIGN) != 0 && supportsTlsDigest(info.getDigests());
    }

    private static X509ExtendedKeyManager loadManager(KeyStore store, String alias) throws GeneralSecurityException {
        Key key = store.getKey(alias, null);
        java.security.cert.Certificate certificate = store.getCertificate(alias);
        if (!(key instanceof PrivateKey) || !(certificate instanceof X509Certificate)
                || !"EC".equalsIgnoreCase(key.getAlgorithm()) || key.getEncoded() != null) {
            throw new GeneralSecurityException("Chave privada não exportável do telefone ausente.");
        }
        if (!tlsCapable(store, alias)) throw new TlsUpgradeRequired();
        X509Certificate leaf = (X509Certificate) certificate;
        leaf.checkValidity();
        return manager(alias, (PrivateKey) key, new X509Certificate[] { leaf });
    }

    /** Narrow key manager: no unrelated Android aliases, no server identity, no private-key serialization. */
    static X509ExtendedKeyManager manager(String alias, PrivateKey key, X509Certificate[] chain) {
        final X509Certificate[] certificates = chain.clone();
        return new X509ExtendedKeyManager() {
            private boolean accepts(String type) { return "EC".equals(type) || (type != null && type.startsWith("EC_")); }
            private String choose(String[] types) {
                if (types != null) for (String type : types) if (accepts(type)) return alias;
                return null;
            }
            public String[] getClientAliases(String type, Principal[] issuers) { return accepts(type) ? new String[] { alias } : null; }
            public String chooseClientAlias(String[] types, Principal[] issuers, Socket socket) { return choose(types); }
            public String chooseEngineClientAlias(String[] types, Principal[] issuers, SSLEngine engine) { return choose(types); }
            public String[] getServerAliases(String type, Principal[] issuers) { return null; }
            public String chooseServerAlias(String type, Principal[] issuers, Socket socket) { return null; }
            public String chooseEngineServerAlias(String type, Principal[] issuers, SSLEngine engine) { return null; }
            public X509Certificate[] getCertificateChain(String requested) { return alias.equals(requested) ? certificates.clone() : null; }
            public PrivateKey getPrivateKey(String requested) { return alias.equals(requested) ? key : null; }
        };
    }
}
