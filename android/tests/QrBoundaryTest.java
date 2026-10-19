package br.com.acervo.app;

import java.awt.image.BufferedImage;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Collections;
import java.util.EnumMap;
import java.util.Map;
import javax.imageio.ImageIO;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.DecodeHintType;
import com.google.zxing.MultiFormatReader;
import com.google.zxing.PlanarYUVLuminanceSource;
import com.google.zxing.common.HybridBinarizer;

/** Decode a QR made by the real Node server through the scanner's ZXing path. */
public final class QrBoundaryTest {
    public static void main(String[] args) throws Exception {
        if (args.length != 2) throw new IllegalArgumentException("Pass server-pairing.png server-pairing.url");
        String expected = new String(Files.readAllBytes(new File(args[1]).toPath()), StandardCharsets.UTF_8).trim();
        BufferedImage image = ImageIO.read(new File(args[0]));
        if (image == null) throw new AssertionError("Unreadable server QR PNG");
        int width = image.getWidth();
        int height = image.getHeight();
        byte[] luminance = new byte[width * height];
        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                int color = image.getRGB(x, y);
                int red = (color >> 16) & 255;
                int green = (color >> 8) & 255;
                int blue = color & 255;
                luminance[y * width + x] = (byte) ((red + green + green + blue) / 4);
            }
        }
        Map<DecodeHintType, Object> hints = new EnumMap<>(DecodeHintType.class);
        hints.put(DecodeHintType.POSSIBLE_FORMATS, Collections.singletonList(BarcodeFormat.QR_CODE));
        hints.put(DecodeHintType.TRY_HARDER, Boolean.TRUE);
        MultiFormatReader reader = new MultiFormatReader();
        reader.setHints(hints);
        for (int rotation = 0; rotation < 4; rotation++) {
            PlanarYUVLuminanceSource source = new PlanarYUVLuminanceSource(luminance, width, height, 0, 0, width, height, false);
            String decoded = reader.decodeWithState(new BinaryBitmap(new HybridBinarizer(source))).getText();
            reader.reset();
            if (!expected.equals(decoded)) throw new AssertionError("QR changed across Node/Java boundary at rotation " + rotation);
            PairingLink link = PairingLink.parse(decoded);
            if (!link.origin.startsWith("https://") || link.spkiPin == null || link.spkiPin.length() != 64) throw new AssertionError("Secure QR lost the PC identity");
            if (!decoded.equals(link.url)) throw new AssertionError("Scanner rejected or changed real QR fragment");
            if (link.origin.contains("pair=") || link.origin.contains("#")) throw new AssertionError("One-use code leaked into saved origin");
            byte[] rotated = new byte[luminance.length];
            for (int y = 0; y < height; y++) for (int x = 0; x < width; x++) rotated[x * height + (height - y - 1)] = luminance[y * width + x];
            luminance = rotated;
            int previousWidth = width;
            width = height;
            height = previousWidth;
        }
        System.out.println("QR boundary: real server PNG decoded and accepted at 0, 90, 180 and 270 degrees; saved origin excludes token.");
    }
}
