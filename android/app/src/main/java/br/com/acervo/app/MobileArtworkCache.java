package br.com.acervo.app;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;

public final class MobileArtworkCache {
    public static final int MAX_BYTES = 2 * 1024 * 1024;

    private MobileArtworkCache() { }

    public static File fileFor(File files, String httpsKey) throws IOException {
        if (files == null || httpsKey == null) throw new IOException("Endereço de capa inválido.");
        try {
            URI uri = new URI(httpsKey);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null
                    || uri.getRawUserInfo() != null || uri.getRawFragment() != null
                    || uri.getPort() == 0 || uri.getPort() > 65535) {
                throw new IOException("Endereço de capa inválido.");
            }
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(httpsKey.getBytes(StandardCharsets.UTF_8));
            StringBuilder key = new StringBuilder(64);
            for (byte value : digest) key.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
            return new File(new File(files, "mobile-artwork"), key + ".jpg");
        } catch (java.net.URISyntaxException | java.security.NoSuchAlgorithmException failure) {
            throw new IOException("Endereço de capa inválido.", failure);
        }
    }

    public static synchronized File store(File files, String httpsKey, InputStream input) throws IOException {
        File destination = fileFor(files, httpsKey);
        if (input == null) throw new IOException("Capa indisponível.");
        File folder = destination.getParentFile();
        if (!folder.isDirectory() && !folder.mkdirs()) throw new IOException("Não foi possível guardar a capa no celular.");
        File partial = File.createTempFile("cover-", ".part", folder);
        try {
            int received = 0;
            try (FileOutputStream output = new FileOutputStream(partial)) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (Thread.currentThread().isInterrupted()) throw new IOException("Download da capa interrompido.");
                    if (count > MAX_BYTES - received) throw new IOException("A capa ultrapassa o limite de 2 MB.");
                    output.write(buffer, 0, count);
                    received += count;
                }
                if (received == 0) throw new IOException("A capa está vazia.");
                output.getFD().sync();
            }
            Files.move(partial.toPath(), destination.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            return destination;
        } finally {
            if (partial.exists()) partial.delete();
        }
    }
}
