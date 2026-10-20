package br.com.acervo.app;

import android.graphics.Bitmap;

public final class ArtworkCrop {
    private ArtworkCrop() { }
    public static Bitmap trim(Bitmap original) {
        if (original == null || original.getWidth() < 32 || original.getHeight() < 32) return original;
        Bitmap sample = Bitmap.createScaledBitmap(original, 96, 96, true);
        int[] pixels = new int[96 * 96]; sample.getPixels(pixels, 0, 96, 0, 0, 96, 96);
        int[] bands = BlackBars.detect(pixels, 96, 96);
        if (sample != original) sample.recycle();
        if (bands == null) return original;
        int top = Math.round(original.getHeight() * bands[0] / 96f);
        int bottom = Math.round(original.getHeight() * bands[1] / 96f);
        if (top + bottom >= original.getHeight()) return original;
        return Bitmap.createBitmap(original, 0, top, original.getWidth(), original.getHeight() - top - bottom);
    }
}
