package br.com.acervo.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ImageFormat;
import android.graphics.Paint;
import android.graphics.RectF;
import android.hardware.Camera;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.Surface;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.DecodeHintType;
import com.google.zxing.MultiFormatReader;
import com.google.zxing.NotFoundException;
import com.google.zxing.PlanarYUVLuminanceSource;
import com.google.zxing.Result;
import com.google.zxing.common.HybridBinarizer;

import java.io.IOException;
import java.util.Arrays;
import java.util.Collections;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;

/** Camera frames are decoded on the phone; no camera image leaves this activity. */
@SuppressWarnings("deprecation")
public final class ScannerActivity extends Activity implements SurfaceHolder.Callback, Camera.PreviewCallback {
    private static final int CAMERA_PERMISSION = 30;
    private static final int GREEN = Color.rgb(30, 215, 96);
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService decoder = Executors.newSingleThreadExecutor();
    private final AtomicBoolean decoding = new AtomicBoolean(false);
    private final MultiFormatReader reader = new MultiFormatReader();
    private SurfaceView preview;
    private TextView status;
    private Camera camera;
    private int previewWidth;
    private int previewHeight;
    private boolean resumed;
    private boolean surfaceReady;
    private volatile boolean delivered;
    private long lastInvalidMessage;
    private Runnable focusTask;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setStatusBarColor(Color.rgb(18, 18, 18));
        getWindow().setNavigationBarColor(Color.rgb(18, 18, 18));
        Map<DecodeHintType, Object> hints = new EnumMap<>(DecodeHintType.class);
        hints.put(DecodeHintType.POSSIBLE_FORMATS, Collections.singletonList(BarcodeFormat.QR_CODE));
        hints.put(DecodeHintType.TRY_HARDER, Boolean.TRUE);
        hints.put(DecodeHintType.CHARACTER_SET, "UTF-8");
        reader.setHints(hints);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        preview = new SurfaceView(this);
        preview.getHolder().addCallback(this);
        root.addView(preview, new FrameLayout.LayoutParams(-1, -1));
        root.addView(new FinderView(), new FrameLayout.LayoutParams(-1, -1));

        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.VERTICAL);
        top.setPadding(dp(24), dp(24), dp(24), dp(20));
        top.setBackgroundColor(0xCC121212);
        TextView title = new TextView(this);
        title.setText("Escaneie o QR code");
        title.setTextSize(25);
        title.setTextColor(Color.WHITE);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        top.addView(title);
        TextView hint = new TextView(this);
        hint.setText("No computador, abra Acervo → Conectar dispositivos → Gerar QR code.");
        hint.setTextColor(Color.rgb(200, 200, 200));
        hint.setTextSize(14);
        hint.setPadding(0, dp(10), 0, 0);
        top.addView(hint);
        root.addView(top, new FrameLayout.LayoutParams(-1, -2, Gravity.TOP));

        LinearLayout bottom = new LinearLayout(this);
        bottom.setOrientation(LinearLayout.VERTICAL);
        bottom.setGravity(Gravity.CENTER_HORIZONTAL);
        bottom.setPadding(dp(22), dp(18), dp(22), dp(20));
        bottom.setBackgroundColor(0xE6121212);
        status = new TextView(this);
        status.setText("Aponte a câmera para o QR code do Acervo.");
        status.setTextColor(Color.WHITE);
        status.setTextSize(14);
        status.setGravity(Gravity.CENTER);
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        bottom.addView(status, new LinearLayout.LayoutParams(-1, -2));
        Button cancel = new Button(this);
        cancel.setText("Voltar e usar o link manual");
        cancel.setAllCaps(false);
        cancel.setTextColor(GREEN);
        cancel.setBackgroundColor(Color.TRANSPARENT);
        cancel.setOnClickListener(v -> finish());
        LinearLayout.LayoutParams cancelParams = new LinearLayout.LayoutParams(-1, dp(52));
        cancelParams.topMargin = dp(10);
        bottom.addView(cancel, cancelParams);
        root.addView(bottom, new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM));
        setContentView(root);
        ScreenInsets.apply(this, root);
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION);
        }
    }

    @Override public void surfaceCreated(SurfaceHolder holder) { surfaceReady = true; openCamera(); }
    @Override public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) {
        if (camera == null) openCamera();
    }
    @Override public void surfaceDestroyed(SurfaceHolder holder) { surfaceReady = false; releaseCamera(); }

    @Override protected void onResume() {
        super.onResume();
        resumed = true;
        openCamera();
    }

    @Override protected void onPause() {
        resumed = false;
        releaseCamera();
        super.onPause();
    }

    @Override protected void onDestroy() {
        releaseCamera();
        decoder.shutdownNow();
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != CAMERA_PERMISSION) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) openCamera();
        else status.setText("Sem acesso à câmera. Volte e cole o link de conexão; você também pode liberar a câmera nas configurações do Android.");
    }

    private void openCamera() {
        if (!resumed || !surfaceReady || camera != null || delivered
                || checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) return;
        try {
            int cameraId = backCamera();
            if (cameraId == -1) {
                status.setText("Este aparelho não tem câmera disponível. Volte e cole o link mostrado no computador.");
                return;
            }
            camera = Camera.open(cameraId);
            Camera.Parameters parameters = camera.getParameters();
            parameters.setPreviewFormat(ImageFormat.NV21);
            Camera.Size size = chooseSize(parameters.getSupportedPreviewSizes());
            if (size != null) parameters.setPreviewSize(size.width, size.height);
            List<String> focusModes = parameters.getSupportedFocusModes();
            if (focusModes != null && focusModes.contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE)) {
                parameters.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE);
            } else if (focusModes != null && focusModes.contains(Camera.Parameters.FOCUS_MODE_AUTO)) {
                parameters.setFocusMode(Camera.Parameters.FOCUS_MODE_AUTO);
            }
            camera.setParameters(parameters);
            Camera.Size actual = camera.getParameters().getPreviewSize();
            previewWidth = actual.width;
            previewHeight = actual.height;
            camera.setDisplayOrientation(previewRotation(cameraId));
            camera.setPreviewDisplay(preview.getHolder());
            camera.setPreviewCallback(this);
            camera.setErrorCallback((error, source) -> {
                releaseCamera();
                status.setText("A câmera foi interrompida. Volte e tente escanear novamente ou use o link manual.");
            });
            camera.startPreview();
            status.setText("Aponte a câmera para o QR code do Acervo.");
            if (Camera.Parameters.FOCUS_MODE_AUTO.equals(camera.getParameters().getFocusMode())) scheduleFocus();
        } catch (RuntimeException | IOException error) {
            releaseCamera();
            status.setText("Não foi possível abrir a câmera. Feche outros apps que a utilizam ou volte e cole o link de conexão.");
        }
    }

    private int backCamera() {
        Camera.CameraInfo info = new Camera.CameraInfo();
        int count = Camera.getNumberOfCameras();
        for (int i = 0; i < count; i++) {
            Camera.getCameraInfo(i, info);
            if (info.facing == Camera.CameraInfo.CAMERA_FACING_BACK) return i;
        }
        return count == 0 ? -1 : 0;
    }

    private Camera.Size chooseSize(List<Camera.Size> sizes) {
        if (sizes == null || sizes.isEmpty()) return null;
        Camera.Size best = sizes.get(0);
        double distance = Double.MAX_VALUE;
        for (Camera.Size size : sizes) {
            // A sharp QR at 720p is enough; cap work to keep older phones responsive.
            double current = Math.abs((double) size.width * size.height - 1280 * 720);
            if (Math.max(size.width, size.height) > 1920) current += 10000000;
            if (current < distance) { distance = current; best = size; }
        }
        return best;
    }

    private int previewRotation(int cameraId) {
        Camera.CameraInfo info = new Camera.CameraInfo();
        Camera.getCameraInfo(cameraId, info);
        int displayRotation = getWindowManager().getDefaultDisplay().getRotation();
        int degrees = displayRotation == Surface.ROTATION_90 ? 90 : displayRotation == Surface.ROTATION_180 ? 180
                : displayRotation == Surface.ROTATION_270 ? 270 : 0;
        if (info.facing == Camera.CameraInfo.CAMERA_FACING_FRONT) return (360 - (info.orientation + degrees) % 360) % 360;
        return (info.orientation - degrees + 360) % 360;
    }

    private void scheduleFocus() {
        focusTask = new Runnable() {
            @Override public void run() {
                if (camera == null || !resumed) return;
                try { camera.autoFocus((success, focusedCamera) -> { }); }
                catch (RuntimeException ignored) { }
                handler.postDelayed(this, 1800);
            }
        };
        handler.postDelayed(focusTask, 500);
    }

    private void releaseCamera() {
        if (focusTask != null) handler.removeCallbacks(focusTask);
        focusTask = null;
        if (camera == null) return;
        Camera released = camera;
        camera = null;
        try { released.setPreviewCallback(null); released.stopPreview(); }
        catch (RuntimeException ignored) { }
        finally { released.release(); }
    }

    @Override public void onPreviewFrame(byte[] bytes, Camera source) {
        if (!resumed || delivered || bytes == null || !decoding.compareAndSet(false, true)) return;
        final int width = previewWidth;
        final int height = previewHeight;
        if (bytes.length < width * height || width == 0 || height == 0) { decoding.set(false); return; }
        final byte[] luminance = Arrays.copyOf(bytes, width * height);
        try {
            decoder.execute(() -> {
                try {
                    PlanarYUVLuminanceSource image = new PlanarYUVLuminanceSource(luminance, width, height, 0, 0, width, height, false);
                    Result result = reader.decodeWithState(new BinaryBitmap(new HybridBinarizer(image)));
                    final PairingLink link;
                    try { link = PairingLink.parse(result.getText()); }
                    catch (IllegalArgumentException invalid) {
                        handler.post(() -> {
                            long now = android.os.SystemClock.elapsedRealtime();
                            if (now - lastInvalidMessage > 2500 && resumed && !delivered) {
                                status.setText("Este QR não é uma conexão local do Acervo. Gere um novo QR em Conectar dispositivos no computador.");
                                lastInvalidMessage = now;
                            }
                        });
                        return;
                    }
                    handler.post(() -> {
                        if (!resumed || delivered || isFinishing()) return;
                        delivered = true;
                        releaseCamera();
                        Intent connection = new Intent();
                        connection.putExtra("pairing_url", link.url);
                        setResult(RESULT_OK, connection);
                        finish();
                    });
                } catch (NotFoundException ignored) {
                    // No QR in this frame. Finder pattern detection handles all four orientations.
                } catch (RuntimeException ignored) {
                    // A transient frame must not close the scanner.
                } finally {
                    reader.reset();
                    decoding.set(false);
                }
            });
        } catch (RejectedExecutionException ignored) {
            decoding.set(false);
        }
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private final class FinderView extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        FinderView() { super(ScannerActivity.this); setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO); }
        @Override protected void onDraw(Canvas canvas) {
            float size = Math.min(getWidth() * 0.74f, getHeight() * 0.40f);
            float left = (getWidth() - size) / 2;
            float top = (getHeight() - size) / 2;
            paint.setColor(0x66000000);
            paint.setStyle(Paint.Style.FILL);
            canvas.drawRect(0, 0, getWidth(), top, paint);
            canvas.drawRect(0, top + size, getWidth(), getHeight(), paint);
            canvas.drawRect(0, top, left, top + size, paint);
            canvas.drawRect(left + size, top, getWidth(), top + size, paint);
            paint.setColor(GREEN);
            paint.setStrokeWidth(dp(3));
            paint.setStyle(Paint.Style.STROKE);
            canvas.drawRoundRect(new RectF(left, top, left + size, top + size), dp(18), dp(18), paint);
        }
    }
}
