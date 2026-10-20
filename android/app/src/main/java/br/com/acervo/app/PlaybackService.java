package br.com.acervo.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.drawable.Icon;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

/** Keeps audio alive when the activity is minimized and exposes media controls in the notification shade. */
public final class PlaybackService extends Service {
    public interface Controls {
        void onToggle();
        void onNext();
        void onPrevious();
        void onClose();

        /** Activity that owns the current playback surface, used by the notification tap. */
        default Class<?> playerActivity() { return MainActivity.class; }
        default long positionMs() { return 0; }
        default long durationMs() { return 0; }
        default void onSeek(long positionMs) { }
    }

    static final String ACTION_UPDATE = "br.com.acervo.app.PLAYBACK_UPDATE";
    static final String ACTION_TOGGLE = "br.com.acervo.app.PLAYBACK_TOGGLE";
    static final String ACTION_NEXT = "br.com.acervo.app.PLAYBACK_NEXT";
    static final String ACTION_PREVIOUS = "br.com.acervo.app.PLAYBACK_PREVIOUS";
    static final String ACTION_STOP = "br.com.acervo.app.PLAYBACK_STOP";
    static final String EXTRA_OPEN_PLAYER = "br.com.acervo.app.OPEN_PLAYER";
    private static final String CHANNEL = "acervo-playback";
    private static final int NOTIFICATION_ID = 71;
    private static Controls controls;
    private static volatile PlaybackService instance;

    private MediaSession session;
    private String title = "";
    private String artist = "";
    private boolean playing;
    private long position;
    private long duration;
    private PowerManager.WakeLock wake;
    private WifiManager.WifiLock wifi;
    private static Bitmap artwork;
    private final Handler ticker = new Handler(Looper.getMainLooper());
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (!playing || instance != PlaybackService.this) return;
            updatePlaybackState();
            ticker.postDelayed(this, 1000);
        }
    };

    static void attach(Controls value) { controls = value; }
    static void detach(Controls value) { if (controls == value) controls = null; }

    static void update(Context context, String title, String artist, boolean playing) {
        update(context, title, artist, playing, null, 0, 0);
    }

    static void update(Context context, String title, String artist, boolean playing, Bitmap art) {
        update(context, title, artist, playing, art, 0, 0);
    }

    static void update(Context context, String title, String artist, boolean playing, Bitmap art,
                       long positionMs, long durationMs) {
        artwork = art;
        Intent intent = new Intent(context, PlaybackService.class).setAction(ACTION_UPDATE)
                .putExtra("title", title == null ? "" : title)
                .putExtra("artist", artist == null ? "" : artist)
                .putExtra("playing", playing)
                .putExtra("position", Math.max(0, positionMs))
                .putExtra("duration", Math.max(0, durationMs));
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
        else context.startService(intent);
    }

    /** Updates the live timeline without rebuilding the notification on every tick. */
    static void progress(long positionMs, long durationMs) {
        PlaybackService service = instance;
        if (service == null) return;
        service.ticker.post(() -> {
            service.position = Math.max(0, positionMs);
            if (durationMs > 0) service.duration = durationMs;
            service.updatePlaybackState();
        });
    }

    static void hide(Context context) {
        if (controls != null && controls != context) return;
        context.stopService(new Intent(context, PlaybackService.class));
    }

    @Override public void onCreate() {
        super.onCreate();
        instance = this;
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Reprodução", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Controles do player do Acervo");
            channel.setShowBadge(false);
            channel.setSound(null, null);
            channel.enableVibration(false);
            manager.createNotificationChannel(channel);
        }
        session = new MediaSession(this, "Acervo");
        session.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { if (controls != null) controls.onToggle(); }
            @Override public void onPause() { if (controls != null) controls.onToggle(); }
            @Override public void onSkipToNext() { if (controls != null) controls.onNext(); }
            @Override public void onSkipToPrevious() { if (controls != null) controls.onPrevious(); }
            @Override public void onSeekTo(long positionMs) {
                position = Math.max(0, positionMs);
                if (controls != null) controls.onSeek(position);
                updatePlaybackState();
            }
            @Override public void onStop() { if (controls != null) controls.onClose(); }
        });
        session.setActive(true);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) { stopSelf(); return START_NOT_STICKY; }
        String action = intent.getAction();
        if (ACTION_STOP.equals(action)) {
            if (controls != null) controls.onClose();
            releaseLocks();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_UPDATE.equals(action)) {
            title = intent.getStringExtra("title");
            artist = intent.getStringExtra("artist");
            playing = intent.getBooleanExtra("playing", false);
            position = Math.max(0, intent.getLongExtra("position", 0));
            duration = Math.max(0, intent.getLongExtra("duration", 0));
            publish();
            return START_STICKY;
        }
        if (ACTION_TOGGLE.equals(action)) {
            playing = !playing;
            publish();
            if (controls != null) controls.onToggle();
            return START_STICKY;
        }
        if (ACTION_NEXT.equals(action)) {
            if (controls != null) controls.onNext();
            return START_STICKY;
        }
        if (ACTION_PREVIOUS.equals(action)) {
            if (controls != null) controls.onPrevious();
            return START_STICKY;
        }
        return START_STICKY;
    }

    private PendingIntent action(String action, int code) {
        Intent intent = new Intent(this, PlaybackService.class).setAction(action);
        return PendingIntent.getService(this, code, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private long currentDuration() {
        long value = controls != null ? controls.durationMs() : duration;
        if (value <= 0) value = duration;
        return Math.max(0, value);
    }

    private long currentPosition() {
        long value = controls != null ? controls.positionMs() : position;
        if (value < 0) value = 0;
        long total = currentDuration();
        return total > 0 ? Math.min(value, total) : value;
    }

    private void updatePlaybackState() {
        if (session == null) return;
        long total = currentDuration();
        long current = currentPosition();
        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
                | PlaybackState.ACTION_SEEK_TO
                | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_STOP;
        PlaybackState.Builder state = new PlaybackState.Builder().setActions(actions)
                .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                        current, playing ? 1f : 0f);
        if (total > 0) state.setBufferedPosition(total);
        session.setPlaybackState(state.build());
    }

    private void publish() {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager == null) return;
        if (title == null) title = "";
        if (artist == null) artist = "";
        position = currentPosition();
        duration = currentDuration();

        Class<?> target = controls != null ? controls.playerActivity() : MainActivity.class;
        if (target == null) target = MainActivity.class;
        Intent launch = new Intent(this, target).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra(EXTRA_OPEN_PLAYER, true);
        PendingIntent content = PendingIntent.getActivity(this, 1, launch,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Action previous = new Notification.Action.Builder(
                Icon.createWithResource(this, R.drawable.ic_prev_spot), "Anterior", action(ACTION_PREVIOUS, 2)).build();
        Notification.Action toggle = new Notification.Action.Builder(
                Icon.createWithResource(this, playing ? R.drawable.ic_pause_spot : R.drawable.ic_play_spot),
                playing ? "Pausar" : "Reproduzir", action(ACTION_TOGGLE, 3)).build();
        Notification.Action next = new Notification.Action.Builder(
                Icon.createWithResource(this, R.drawable.ic_next_spot), "Próxima", action(ACTION_NEXT, 4)).build();

        Notification.Builder builder = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title.isEmpty() ? "Acervo" : title)
                .setContentText(artist.isEmpty() ? "Tocando neste celular" : artist)
                .setContentIntent(content)
                .setDeleteIntent(action(ACTION_STOP, 9))
                .setSubText("Acervo")
                .setCategory(Notification.CATEGORY_TRANSPORT)
                .setOngoing(playing)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .addAction(previous)
                .addAction(toggle)
                .addAction(next)
                .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2));
        if (Build.VERSION.SDK_INT >= 31) builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        if (artwork != null) builder.setLargeIcon(artwork);
        else builder.setLargeIcon(Icon.createWithResource(this, R.mipmap.ic_launcher));

        startForeground(NOTIFICATION_ID, builder.build());
        if (playing) acquireLocks(); else releaseLocks();

        MediaMetadata.Builder metadata = new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, title.isEmpty() ? "Acervo" : title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, artist.isEmpty() ? "Tocando neste celular" : artist);
        if (artwork != null) metadata.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artwork);
        if (duration > 0) metadata.putLong(MediaMetadata.METADATA_KEY_DURATION, duration);
        session.setMetadata(metadata.build());
        updatePlaybackState();

        ticker.removeCallbacks(tick);
        if (playing) ticker.post(tick);
    }

    private void acquireLocks() {
        if (wake == null) {
            PowerManager manager = (PowerManager) getSystemService(POWER_SERVICE);
            wake = manager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "acervo:playback");
            wake.setReferenceCounted(false);
        }
        if (!wake.isHeld()) wake.acquire();
        if (wifi == null) {
            try {
                WifiManager manager = (WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE);
                if (manager != null) {
                    wifi = manager.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "acervo:wifi");
                    wifi.setReferenceCounted(false);
                }
            } catch (SecurityException ignored) { }
        }
        if (wifi != null) try { if (!wifi.isHeld()) wifi.acquire(); } catch (SecurityException ignored) { }
    }

    private void releaseLocks() {
        if (wake != null && wake.isHeld()) wake.release();
        if (wifi != null && wifi.isHeld()) wifi.release();
    }

    @Override public void onDestroy() {
        ticker.removeCallbacks(tick);
        if (instance == this) instance = null;
        releaseLocks();
        if (session != null) { session.setActive(false); session.release(); session = null; }
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
