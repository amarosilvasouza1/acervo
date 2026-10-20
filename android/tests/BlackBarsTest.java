package br.com.acervo.app;

public final class BlackBarsTest {
    private static int[] image(int top, int bottom, int shade) {
        int[] pixels = new int[96 * 96];
        java.util.Arrays.fill(pixels, 0xff000000 | shade << 16 | shade << 8 | shade);
        for (int y = top; y < 96 - bottom; y++) for (int x = 0; x < 96; x++) pixels[y * 96 + x] = 0xff5078b0;
        return pixels;
    }
    public static void main(String[] args) {
        for (int shade : new int[] { 0, 14 }) {
            int[] result = BlackBars.detect(image(12, 12, shade), 96, 96);
            if (result == null || result[0] != 12 || result[1] != 12) throw new AssertionError("Missed bars");
        }
        for (int[] pixels : new int[][] { image(0, 0, 0), image(12, 0, 0), image(12, 20, 0), image(30, 30, 0), new int[96 * 96] }) {
            if (BlackBars.detect(pixels, 96, 96) != null) throw new AssertionError("Cropped genuine image content");
        }
        if (BlackBars.detect(null, 96, 96) != null) throw new AssertionError("Invalid image accepted");
        System.out.println("Artwork black bars: detection, compression tolerance, dark covers, asymmetry and invalid images passed.");
    }
}
