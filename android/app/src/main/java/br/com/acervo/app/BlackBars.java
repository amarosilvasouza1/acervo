package br.com.acervo.app;

/** Conservative, pixel-based detection shared by every offline artwork surface. */
public final class BlackBars {
    private BlackBars() { }
    private static double colored(int[] pixels, int width, int y, int threshold) {
        int count = 0;
        for (int x = 0; x < width; x++) {
            int value = pixels[y * width + x];
            if (Math.max((value >> 16) & 255, Math.max((value >> 8) & 255, value & 255)) > threshold) count++;
        }
        return count / (double) width;
    }
    public static int[] detect(int[] pixels, int width, int height) {
        if (width < 16 || height < 16 || pixels == null || pixels.length != width * height) return null;
        int maximum = (int) (height * .24), top = 0, bottom = 0;
        while (top <= maximum && colored(pixels, width, top, 18) <= .02) top++;
        while (bottom <= maximum && colored(pixels, width, height - bottom - 1, 18) <= .02) bottom++;
        if (top < Math.max(2, height * .02) || bottom < Math.max(2, height * .02)
                || top > maximum || bottom > maximum || Math.abs(top - bottom) > height * .035) return null;
        if (colored(pixels, width, top, 30) < .15 || colored(pixels, width, height - bottom - 1, 30) < .15) return null;
        return new int[] { top, bottom };
    }
}
