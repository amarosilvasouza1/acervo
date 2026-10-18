package br.com.acervo.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.util.LruCache;
import android.view.Gravity;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.TextView;
import android.widget.Toast;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/** A self-contained library, search, radio and player using only this phone's internet. */
public final class StandaloneActivity extends Activity implements PlaybackService.Controls {
    private static final int BG = Color.BLACK;
    private static final int SURFACE = Color.rgb(18, 18, 18);
    private static final int CARD = Color.rgb(31, 31, 31);
    private static final int GREEN = Color.rgb(30, 215, 96);
    private static final int MUTED = Color.rgb(179, 179, 179);
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService work = Executors.newFixedThreadPool(3);
    private final ExecutorService covers = Executors.newFixedThreadPool(2);
    private final AtomicInteger searches = new AtomicInteger();
    private final Set<String> downloading = ConcurrentHashMap.newKeySet();
    private final Map<String, String> progress = new ConcurrentHashMap<>();
    private final Map<String, TextView> downloadLabels = new ConcurrentHashMap<>();
    private final Map<String, Integer> playAfterDownload = new ConcurrentHashMap<>();
    private final LruCache<String, Bitmap> coverCache = new LruCache<String, Bitmap>(4 * 1024 * 1024) {
        @Override protected int sizeOf(String key, Bitmap value) { return value.getByteCount(); }
    };
    private MobileLibrary library;
    private LinearLayout content, searchRow, playerPanel;
    private TextView status, playerTitle, playerArtist, elapsed, remaining;
    private EditText query;
    private Button searchButton, libraryTab, searchTab, radioTab, playButton;
    private SeekBar seek;
    private MediaPlayer player;
    private MobileLibrary.Track playingTrack;
    private AudioManager audio;
    private AudioFocusRequest audioFocus;
    private int mode, playRequest;
    private boolean destroyed, preparing, seeking, foreground, playRecorded;
    private List<MobileSource.Song> results = new ArrayList<>();
    private List<MobileSource.Song> searchResults = new ArrayList<>();
    private List<MobileSource.Song> radioResults = new ArrayList<>();
    private List<MobileSource.Song> radioQueue = new ArrayList<>();
    private int radioIndex = -1;
    private boolean radioPlayback, radioAutoPlay;
    private String radioSeed = "";
    private String excludedId = "";
    private final BroadcastReceiver noisy = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) { pause(); }
    };
    private final Runnable ticker = new Runnable() {
        @Override public void run() { updatePlayer(); if (!destroyed) main.postDelayed(this, 500); }
    };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        try { library = new MobileLibrary(this); }
        catch (Exception failure) {
            new AlertDialog.Builder(this).setTitle("Biblioteca indisponível").setMessage(message(failure))
                    .setPositiveButton("Voltar", (dialog, which) -> finish()).setOnCancelListener(dialog -> finish()).show();
            return;
        }
        audio = (AudioManager) getSystemService(AUDIO_SERVICE);
        audioFocus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(audioAttributes()).setWillPauseWhenDucked(true)
                .setOnAudioFocusChangeListener(change -> { if (change < 0) main.post(this::pause); }).build();
        PlaybackService.attach(this);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 91);
        }
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY));
        buildScreen();
        select(0);
        main.post(ticker);
    }

    private void buildScreen() {
        LinearLayout root = column();
        root.setBackgroundColor(BG);
        LinearLayout header = row();
        header.setPadding(dp(20), dp(16), dp(12), dp(8));
        TextView title = text("acervo", 28, Color.WHITE, true);
        header.addView(title, new LinearLayout.LayoutParams(0, -2, 1));
        Button update = button("Atualizar", false);
        update.setContentDescription("Atualizar aplicativo");
        update.setOnClickListener(v -> AppUpdater.check(this, null));
        header.addView(update);
        Button connect = button("Conexões", false);
        connect.setOnClickListener(v -> finish());
        header.addView(connect);
        root.addView(header);
        TextView independent = text("NO SEU CELULAR · SEM PRECISAR DO PC", 10, GREEN, true);
        independent.setPadding(dp(20), 0, dp(20), dp(18));
        root.addView(independent);
        LinearLayout tabs = row();
        tabs.setPadding(dp(16), 0, dp(16), dp(12));
        libraryTab = button("Biblioteca", false);
        searchTab = button("Buscar", false);
        radioTab = button("Rádio", false);
        libraryTab.setOnClickListener(v -> select(0));
        searchTab.setOnClickListener(v -> select(1));
        radioTab.setOnClickListener(v -> {
            select(2);
            if (results.isEmpty() || radioSeed.isEmpty()) {
                MobileLibrary.Track recent = library.recent();
                if (recent != null) startRadio(recent.title, recent.artist, recent.id);
            }
        });
        for (Button tab : new Button[] { libraryTab, searchTab, radioTab }) {
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(46), 1);
            params.setMargins(dp(3), 0, dp(3), 0);
            tabs.addView(tab, params);
        }
        root.addView(tabs);
        searchRow = row();
        searchRow.setPadding(dp(20), dp(4), dp(20), dp(12));
        query = new EditText(this);
        query.setTextColor(Color.WHITE);
        query.setHintTextColor(MUTED);
        query.setTextSize(14);
        query.setSingleLine(true);
        query.setImeOptions(EditorInfo.IME_ACTION_SEARCH);
        query.setBackground(rounded(CARD, 24));
        query.setPadding(dp(16), dp(10), dp(12), dp(10));
        query.setContentDescription("Música, artista ou link do YouTube");
        query.setOnEditorActionListener((view, action, event) -> {
            if (action == EditorInfo.IME_ACTION_SEARCH) { runInput(); return true; }
            return false;
        });
        searchRow.addView(query, new LinearLayout.LayoutParams(0, dp(48), 1));
        searchButton = button("Buscar", true);
        searchButton.setOnClickListener(v -> runInput());
        LinearLayout.LayoutParams searchParams = new LinearLayout.LayoutParams(-2, dp(48));
        searchParams.leftMargin = dp(8);
        searchRow.addView(searchButton, searchParams);
        root.addView(searchRow);
        status = text("", 12, MUTED, false);
        status.setPadding(dp(20), 0, dp(20), dp(8));
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        root.addView(status);
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        content = column();
        content.setPadding(dp(20), dp(8), dp(20), dp(24));
        scroll.addView(content);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        buildPlayer(root);
        setContentView(root);
        ScreenInsets.apply(this, root);
    }

    private void select(int nextMode) {
        if (mode != nextMode) {
            searches.incrementAndGet();
            searchButton.setEnabled(true);
        }
        mode = nextMode;
        results = mode == 2 ? radioResults : searchResults;
        libraryTab.setBackground(rounded(mode == 0 ? GREEN : CARD, 24));
        searchTab.setBackground(rounded(mode == 1 ? GREEN : CARD, 24));
        radioTab.setBackground(rounded(mode == 2 ? GREEN : CARD, 24));
        libraryTab.setTextColor(mode == 0 ? BG : Color.WHITE);
        searchTab.setTextColor(mode == 1 ? BG : Color.WHITE);
        radioTab.setTextColor(mode == 2 ? BG : Color.WHITE);
        searchRow.setVisibility(mode == 0 ? View.GONE : View.VISIBLE);
        query.setHint(mode == 2 ? "Música ou artista para a rádio" : "O que você quer ouvir?");
        searchButton.setText(mode == 2 ? "Gerar" : "Buscar");
        render();
    }

    private void render() {
        content.removeAllViews();
        downloadLabels.clear();
        if (mode == 0) renderLibrary();
        else renderResults();
    }

    private void renderLibrary() {
        List<MobileLibrary.Track> tracks = library.all();
        add(content, text("Sua biblioteca", 30, Color.WHITE, true), 0);
        status.setText(tracks.size() + (tracks.size() == 1 ? " música salva neste celular" : " músicas salvas neste celular"));
        add(content, text("Baixe pela sua internet e ouça mesmo sem conexão.", 14, MUTED, false), 8);
        if (tracks.isEmpty()) {
            add(content, text("Seu próximo favorito está por aí.", 22, Color.WHITE, true), 38);
            add(content, text("Busque uma música ou artista. Os downloads ficam nesta biblioteca, disponíveis com o computador desligado.", 15, MUTED, false), 12);
            Button discover = button("Encontrar músicas", true);
            discover.setOnClickListener(v -> { select(1); query.requestFocus(); });
            add(content, discover, 22);
        }
        for (MobileLibrary.Track track : tracks) {
            LinearLayout card = songCard(track.title, track.artist, track.thumbnail, track.duration);
            LinearLayout actions = row();
            Button play = button("Ouvir", true);
            play.setOnClickListener(v -> { radioPlayback = false; radioQueue.clear(); radioIndex = -1; playRequest++; playTrack(track); });
            actions.addView(play);
            Button radio = button("Rádio", false);
            radio.setOnClickListener(v -> startRadio(track.title, track.artist, track.id));
            actions.addView(radio);
            Button remove = button("•••", false);
            remove.setContentDescription("Opções de " + track.title);
            remove.setOnClickListener(v -> new AlertDialog.Builder(this).setTitle(track.title)
                    .setItems(new String[] { "Excluir download deste celular" }, (dialog, choice) -> confirmRemove(track)).show());
            actions.addView(remove);
            add(card, actions, 12);
            add(content, card, 14);
        }
    }

    private void renderResults() {
        add(content, text(mode == 2 ? "Sua rádio, ao vivo" : "Encontre seu próximo som", 28, Color.WHITE, true), 0);
        if (mode == 2) {
            add(content, text(radioSeed.isEmpty() ? "Escolha uma música ou use o que ouviu recentemente." : "A partir de " + radioSeed, 14, MUTED, false), 8);
            MobileLibrary.Track recent = library.recent();
            if (recent != null) {
                Button latest = button("Usar música recente", false);
                latest.setOnClickListener(v -> startRadio(recent.title, recent.artist, recent.id));
                add(content, latest, 12);
            }
        }
        if (results.isEmpty()) {
            status.setText(mode == 2 ? "Novas sugestões são buscadas pela internet do celular." : "Busca e downloads usam a internet deste celular.");
            add(content, text(mode == 2 ? "Defina o ponto de partida acima para buscar músicas semelhantes." : "Digite um artista, uma música ou cole um link do YouTube.", 15, MUTED, false), 28);
            return;
        }
        status.setText(results.size() + " resultados · internet do celular");
        for (MobileSource.Song song : results) {
            LinearLayout card = songCard(song.title, song.artist, song.thumbnail, song.duration);
            LinearLayout actions = row();
            MobileLibrary.Track saved = library.get(song.id);
            if (saved != null) {
                Button play = button("Ouvir offline", true);
                play.setOnClickListener(v -> { if (mode == 2) playRadioSaved(song, saved); else { radioPlayback = false; playRequest++; playTrack(saved); } });
                actions.addView(play);
            } else {
                Button save = button("Baixar", false);
                save.setOnClickListener(v -> download(song, false));
                actions.addView(save);
                Button listen = button("Baixar e ouvir", true);
                listen.setOnClickListener(v -> { if (mode == 2) listenRadio(song); else { radioPlayback = false; download(song, true); } });
                actions.addView(listen);
            }
            Button radio = button("Rádio", false);
            radio.setOnClickListener(v -> startRadio(song.title, song.artist, song.id));
            actions.addView(radio);
            add(card, actions, 12);
            TextView downloadStatus = text(saved != null ? "Salva neste celular" : progress.getOrDefault(song.id, ""), 12, saved != null ? GREEN : MUTED, false);
            downloadStatus.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
            downloadLabels.put(song.id, downloadStatus);
            add(card, downloadStatus, 6);
            add(content, card, 14);
        }
    }

    private void runInput() {
        String value = query.getText().toString().trim();
        if (value.isEmpty()) { query.setError("Digite uma música ou artista."); return; }
        InputMethodManager keyboard = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        if (keyboard != null) keyboard.hideSoftInputFromWindow(query.getWindowToken(), 0);
        if (mode == 2) { radioSeed = value; excludedId = ""; search(value + " músicas semelhantes", true); }
        else search(value, false);
    }

    private void startRadio(String title, String artist, String id) { startRadio(title, artist, id, false); }

    private void startRadio(String title, String artist, String id, boolean autoplay) {
        radioPlayback = false;
        radioQueue.clear();
        radioIndex = -1;
        radioAutoPlay = autoplay;
        radioSeed = title + (artist == null || artist.isEmpty() ? "" : " · " + artist);
        excludedId = id;
        radioResults = new ArrayList<>();
        select(2);
        query.setText(title);
        search((artist == null || artist.isEmpty() ? title : artist) + " " + title + " músicas parecidas", true);
    }

    private void search(String value, boolean radio) {
        int generation = searches.incrementAndGet();
        int requestedMode = mode;
        String exclude = excludedId;
        searchButton.setEnabled(false);
        status.setText(radio ? "Buscando sugestões em tempo real…" : "Pesquisando pela internet do celular…");
        work.execute(() -> {
            try {
                List<MobileSource.Song> found = new ArrayList<>();
                if (radio && !exclude.isEmpty()) {
                    try { found = MobileSource.related(exclude); }
                    catch (Exception ignored) { /* Search is a fresh fallback if related items are unavailable. */ }
                }
                List<MobileSource.Song> filtered = filter(found, radio, exclude);
                if (filtered.isEmpty()) filtered = filter(MobileSource.search(value), radio, exclude);
                final List<MobileSource.Song> visible = filtered;
                post(() -> {
                    if (generation != searches.get() || mode != requestedMode) return;
                    results = visible;
                    if (radio) {
                        radioResults = visible;
                        if (radioAutoPlay) {
                            radioAutoPlay = false;
                            if (!visible.isEmpty()) {
                                radioPlayback = true;
                                radioQueue = new ArrayList<>(visible);
                                radioIndex = 0;
                                download(visible.get(0), true);
                            }
                        }
                    } else searchResults = visible;
                    searchButton.setEnabled(true);
                    render();
                    if (results.isEmpty()) status.setText("Nenhum resultado encontrado. Tente outro nome.");
                });
            } catch (Exception failure) {
                post(() -> {
                    if (generation != searches.get() || mode != requestedMode) return;
                    searchButton.setEnabled(true);
                    status.setText("Não foi possível pesquisar. " + message(failure));
                });
            }
        });
    }

    private List<MobileSource.Song> filter(List<MobileSource.Song> found, boolean radio, String excluded) {
        List<MobileSource.Song> filtered = new ArrayList<>();
        Set<String> seen = new java.util.HashSet<>();
        for (MobileSource.Song song : found) {
            if (song != null && song.id != null && seen.add(song.id)
                    && (!radio || (!song.id.equals(excluded) && library.get(song.id) == null))) filtered.add(song);
            if (filtered.size() >= 30) break;
        }
        return filtered;
    }

    private void download(MobileSource.Song song, boolean listen) { download(song, listen, false); }

    private void download(MobileSource.Song song, boolean listen, boolean quiet) {
        if (listen) playAfterDownload.put(song.id, ++playRequest);
        MobileLibrary.Track saved = library.get(song.id);
        if (saved != null) { if (listen) playTrack(saved); return; }
        if (!downloading.add(song.id)) { if (!quiet) toast("Esta música já está sendo baixada."); return; }
        setProgress(song.id, quiet ? "Preparando a próxima…" : "Preparando download…");
        work.execute(() -> {
            try {
                MobileSource.Song resolved = MobileSource.resolve(song.id);
                MobileLibrary.Track track = library.download(resolved, (received, total) -> {
                    String amount = String.format(java.util.Locale.getDefault(), "%.1f MB", received / 1048576.0);
                    setProgress(song.id, total > 0 ? "Baixando " + (received * 100 / total) + "% · " + amount : "Baixando " + amount);
                });
                progress.remove(song.id);
                downloading.remove(song.id);
                Integer requested = playAfterDownload.remove(song.id);
                post(() -> {
                    render();
                    if (!quiet) toast("Música salva neste celular.");
                    if (requested != null && requested == playRequest) playTrack(track);
                });
            } catch (Exception failure) {
                downloading.remove(song.id);
                playAfterDownload.remove(song.id);
                setProgress(song.id, "Falhou: " + message(failure));
                if (!quiet) post(() -> toast("Não foi possível baixar: " + message(failure)));
            }
        });
    }

    private void setProgress(String id, String value) {
        progress.put(id, value);
        post(() -> { TextView label = downloadLabels.get(id); if (label != null) label.setText(value); });
    }

    private LinearLayout songCard(String title, String artist, String thumbnail, long duration) {
        LinearLayout card = column();
        card.setBackground(rounded(SURFACE, 12));
        card.setPadding(dp(14), dp(14), dp(14), dp(10));
        LinearLayout details = row();
        ImageView cover = new ImageView(this);
        cover.setImageResource(R.drawable.ic_acervo);
        cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
        cover.setBackground(rounded(CARD, 6));
        details.addView(cover, new LinearLayout.LayoutParams(dp(56), dp(56)));
        loadCover(cover, thumbnail);
        LinearLayout description = column();
        description.setPadding(dp(12), 0, 0, 0);
        TextView name = text(title, 16, Color.WHITE, true);
        name.setMaxLines(2);
        name.setEllipsize(android.text.TextUtils.TruncateAt.END);
        description.addView(name);
        TextView by = text((artist == null ? "" : artist) + (duration > 0 ? " · " + time(duration) : ""), 12, MUTED, false);
        by.setMaxLines(1);
        by.setEllipsize(android.text.TextUtils.TruncateAt.END);
        add(description, by, 5);
        details.addView(description, new LinearLayout.LayoutParams(0, -2, 1));
        card.addView(details);
        return card;
    }

    private void loadCover(ImageView target, String url) {
        if (url == null || !url.startsWith("https://")) return;
        target.setTag(url);
        Bitmap cached = coverCache.get(url);
        if (cached != null) { target.setImageBitmap(cached); return; }
        covers.execute(() -> {
            if (destroyed) return;
            HttpURLConnection connection = null;
            try {
                connection = MobileLibrary.openHttps(url);
                byte[] bytes;
                try (InputStream input = connection.getInputStream()) { bytes = MobileLibrary.readLimited(input, 2 * 1024 * 1024); }
                BitmapFactory.Options bounds = new BitmapFactory.Options();
                bounds.inJustDecodeBounds = true;
                BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
                if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return;
                BitmapFactory.Options options = new BitmapFactory.Options();
                while (bounds.outWidth / Math.max(1, options.inSampleSize) > 256 || bounds.outHeight / Math.max(1, options.inSampleSize) > 256) {
                    options.inSampleSize = options.inSampleSize == 0 ? 2 : options.inSampleSize * 2;
                }
                Bitmap image = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
                if (image == null) return;
                coverCache.put(url, image);
                post(() -> { if (url.equals(target.getTag())) target.setImageBitmap(image); });
            } catch (Exception ignored) { /* An unavailable cover never hides a playable song. */ }
            finally { if (connection != null) connection.disconnect(); }
        });
    }

    private void buildPlayer(LinearLayout root) {
        playerPanel = column();
        playerPanel.setPadding(dp(20), dp(12), dp(20), dp(10));
        playerPanel.setBackgroundColor(CARD);
        playerPanel.setVisibility(View.GONE);
        playerTitle = text("", 15, Color.WHITE, true);
        playerTitle.setMaxLines(1);
        playerTitle.setEllipsize(android.text.TextUtils.TruncateAt.END);
        playerPanel.addView(playerTitle);
        playerArtist = text("", 12, MUTED, false);
        add(playerPanel, playerArtist, 4);
        seek = new SeekBar(this);
        seek.setMax(1000);
        seek.setProgressTintList(android.content.res.ColorStateList.valueOf(GREEN));
        seek.setThumbTintList(android.content.res.ColorStateList.valueOf(Color.WHITE));
        seek.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onStartTrackingTouch(SeekBar bar) { seeking = true; }
            @Override public void onStopTrackingTouch(SeekBar bar) {
                if (player != null && !preparing) try { player.seekTo((int) ((long) player.getDuration() * bar.getProgress() / 1000)); } catch (IllegalStateException ignored) { }
                seeking = false;
            }
            @Override public void onProgressChanged(SeekBar bar, int value, boolean user) { }
        });
        add(playerPanel, seek, 6);
        LinearLayout times = row();
        elapsed = text("0:00", 10, MUTED, false);
        remaining = text("0:00", 10, MUTED, false);
        times.addView(elapsed, new LinearLayout.LayoutParams(0, -2, 1));
        times.addView(remaining);
        playerPanel.addView(times);
        LinearLayout controls = row();
        controls.setGravity(Gravity.CENTER);
        Button previous = button("⏮", false);
        previous.setContentDescription("Música anterior");
        previous.setOnClickListener(v -> skip(-1));
        playButton = button("▶", true);
        playButton.setContentDescription("Reproduzir ou pausar");
        playButton.setOnClickListener(v -> {
            if (player == null || preparing) return;
            try { if (player.isPlaying()) pause(); else startPrepared(); }
            catch (IllegalStateException failure) { toast("Escolha a música novamente para tocar."); }
        });
        Button next = button("⏭", false);
        next.setContentDescription("Próxima música");
        next.setOnClickListener(v -> skip(1));
        controls.addView(previous);
        controls.addView(playButton);
        controls.addView(next);
        add(playerPanel, controls, 3);
        root.addView(playerPanel);
    }

    private void playTrack(MobileLibrary.Track track) {
        releasePlayer();
        playingTrack = track;
        playerPanel.setVisibility(View.VISIBLE);
        playerTitle.setText(track.title);
        playerArtist.setText(track.artist + " · salvo neste celular");
        PlaybackService.update(this, track.title, track.artist, false);
        playButton.setText("…");
        preparing = true;
        playRecorded = false;
        MediaPlayer candidate = new MediaPlayer();
        player = candidate;
        candidate.setAudioAttributes(audioAttributes());
        candidate.setWakeMode(getApplicationContext(), PowerManager.PARTIAL_WAKE_LOCK);
        candidate.setOnPreparedListener(ready -> {
            if (ready != player) return;
            preparing = false;
            startPrepared();
            updatePlayer();
        });
        candidate.setOnCompletionListener(ended -> {
            if (ended != player) return;
            if (radioPlayback) nextRadio(); else skip(1);
        });
        candidate.setOnErrorListener((failed, what, extra) -> {
            if (failed == player) { releasePlayer(); toast("Este áudio não pôde ser reproduzido. Exclua o download e baixe novamente."); }
            return true;
        });
        try {
            candidate.setDataSource(library.file(track).getAbsolutePath());
            candidate.prepareAsync();
        } catch (Exception failure) { releasePlayer(); toast("Não foi possível abrir o áudio: " + message(failure)); }
    }

    private void skip(int direction) {
        if (radioPlayback) { if (direction > 0) nextRadio(); else previousRadio(); return; }
        List<MobileLibrary.Track> queue = library.all();
        if (queue.isEmpty()) return;
        int index = -1;
        if (playingTrack != null) for (int i = 0; i < queue.size(); i++) if (queue.get(i).id.equals(playingTrack.id)) { index = i; break; }
        if (direction < 0 && player != null && !preparing) try { if (player.getCurrentPosition() > 3000) { player.seekTo(0); return; } } catch (IllegalStateException ignored) { }
        int target = index + direction;
        if (target < 0) target = 0;
        if (target >= queue.size()) { pause(); if (player != null && !preparing) player.seekTo(0); return; }
        playRequest++;
        playTrack(queue.get(target));
    }

    private int radioIndexOf(String id) {
        for (int i = 0; i < radioQueue.size(); i++) if (radioQueue.get(i) != null && radioQueue.get(i).id.equals(id)) return i;
        return -1;
    }

    private void listenRadio(MobileSource.Song song) {
        radioPlayback = true;
        radioQueue = new ArrayList<>(radioResults);
        radioIndex = radioIndexOf(song.id);
        if (radioIndex < 0) { radioQueue.add(song); radioIndex = radioQueue.size() - 1; }
        download(song, true);
    }

    private void playRadioSaved(MobileSource.Song song, MobileLibrary.Track saved) {
        radioPlayback = true;
        radioQueue = new ArrayList<>(radioResults);
        radioIndex = radioIndexOf(song.id);
        if (radioIndex < 0) { radioQueue.add(song); radioIndex = radioQueue.size() - 1; }
        playRequest++;
        playTrack(saved);
    }

    /** Downloads the next radio suggestion while the current song is still playing. */
    private void prefetchNextRadio() {
        if (!radioPlayback || radioIndex < 0) return;
        int next = radioIndex + 1;
        if (next >= radioQueue.size()) return;
        MobileSource.Song song = radioQueue.get(next);
        if (song == null || song.id == null) return;
        if (playingTrack != null && song.id.equals(playingTrack.id)) return;
        if (library.get(song.id) != null || downloading.contains(song.id)) return;
        download(song, false, true);
    }

    private void nextRadio() {
        int next = radioIndex + 1;
        if (next >= 0 && next < radioQueue.size()) {
            radioIndex = next;
            MobileSource.Song song = radioQueue.get(next);
            if (song != null) {
                MobileLibrary.Track saved = library.get(song.id);
                if (saved != null) { playRequest++; playTrack(saved); }
                else download(song, true);
                return;
            }
        }
        String title = playingTrack != null ? playingTrack.title : radioSeed;
        String artist = playingTrack != null ? playingTrack.artist : "";
        String id = playingTrack != null ? playingTrack.id : excludedId;
        if (title == null || title.isEmpty()) { pause(); return; }
        startRadio(title, artist, id, true);
    }

    private void previousRadio() {
        if (player != null && !preparing) try { if (player.getCurrentPosition() > 3000) { player.seekTo(0); return; } } catch (IllegalStateException ignored) { }
        if (radioIndex <= 0) return;
        radioIndex--;
        MobileSource.Song song = radioQueue.get(radioIndex);
        if (song == null) return;
        MobileLibrary.Track saved = library.get(song.id);
        if (saved != null) { playRequest++; playTrack(saved); }
        else download(song, true);
    }

    private void updatePlayer() {
        if (player == null || preparing || seek == null) return;
        try {
            int duration = player.getDuration();
            int position = player.getCurrentPosition();
            if (!seeking) seek.setProgress(duration > 0 ? (int) ((long) position * 1000 / duration) : 0);
            elapsed.setText(time(position / 1000));
            remaining.setText(time(duration / 1000));
            playButton.setText(player.isPlaying() ? "Ⅱ" : "▶");
        } catch (IllegalStateException ignored) { }
    }

    private boolean requestFocus() { return audio != null && audio.requestAudioFocus(audioFocus) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED; }
    private void startPrepared() {
        if (player == null || preparing || !requestFocus()) return;
        player.start();
        if (!playRecorded && playingTrack != null) {
            playRecorded = true;
            String id = playingTrack.id;
            work.execute(() -> { try { library.recordPlayed(id); } catch (Exception failure) { post(() -> toast(message(failure))); } });
        }
        PlaybackService.update(this, playingTrack == null ? "Acervo" : playingTrack.title,
                playingTrack == null ? "" : playingTrack.artist, true);
        prefetchNextRadio();
        updatePlayer();
    }
    private static AudioAttributes audioAttributes() { return new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build(); }
    private void pause() {
        if (player != null && !preparing) try { player.pause(); updatePlayer(); } catch (IllegalStateException ignored) { }
        if (audio != null && audioFocus != null) audio.abandonAudioFocusRequest(audioFocus);
        if (playingTrack != null && player != null) PlaybackService.update(this, playingTrack.title, playingTrack.artist, false);
    }
    private void releasePlayer() {
        if (player != null) { player.setOnCompletionListener(null); player.release(); player = null; }
        preparing = false;
        if (audio != null && audioFocus != null) audio.abandonAudioFocusRequest(audioFocus);
        if (playButton != null) playButton.setText("▶");
        PlaybackService.hide(this);
    }

    private void confirmRemove(MobileLibrary.Track track) {
        new AlertDialog.Builder(this).setTitle("Excluir download?")
                .setMessage("A música será removida apenas da biblioteca deste celular: " + track.title)
                .setNegativeButton("Cancelar", null).setPositiveButton("Excluir", (dialog, which) -> {
                    if (playingTrack != null && playingTrack.id.equals(track.id)) { releasePlayer(); playingTrack = null; playerPanel.setVisibility(View.GONE); }
                    work.execute(() -> {
                        try { library.remove(track.id); post(this::render); }
                        catch (Exception failure) { post(() -> toast(message(failure))); }
                    });
                }).show();
    }

    @Override protected void onResume() { super.onResume(); foreground = true; }
    @Override protected void onStop() { foreground = false; super.onStop(); }
    @Override protected void onDestroy() {
        PlaybackService.detach(this);
        destroyed = true;
        searches.incrementAndGet();
        main.removeCallbacksAndMessages(null);
        releasePlayer();
        work.shutdownNow();
        covers.shutdownNow();
        try { unregisterReceiver(noisy); } catch (IllegalArgumentException ignored) { }
        super.onDestroy();
    }

    @Override public void onToggle() {
        runOnUiThread(() -> {
            if (player == null || preparing) return;
            try { if (player.isPlaying()) pause(); else startPrepared(); }
            catch (IllegalStateException ignored) { }
        });
    }
    @Override public void onNext() { runOnUiThread(() -> skip(1)); }
    @Override public void onPrevious() { runOnUiThread(() -> skip(-1)); }
    @Override public void onClose() {
        runOnUiThread(() -> {
            releasePlayer();
            playingTrack = null;
            if (playerPanel != null) playerPanel.setVisibility(View.GONE);
        });
    }

    private void post(Runnable task) { main.post(() -> { if (!destroyed && !isFinishing()) task.run(); }); }
    private static String message(Exception failure) {
        String value = failure.getMessage();
        if (value == null || value.isEmpty()) return "Verifique sua conexão e tente novamente.";
        return value.length() > 220 ? value.substring(0, 220) + "…" : value;
    }
    private static String time(long seconds) { return String.format(java.util.Locale.getDefault(), "%d:%02d", Math.max(0, seconds) / 60, Math.max(0, seconds) % 60); }
    private LinearLayout column() { LinearLayout layout = new LinearLayout(this); layout.setOrientation(LinearLayout.VERTICAL); return layout; }
    private LinearLayout row() { LinearLayout layout = new LinearLayout(this); layout.setGravity(Gravity.CENTER_VERTICAL); return layout; }
    private TextView text(String value, int size, int color, boolean bold) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(size); view.setTextColor(color);
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return view;
    }
    private Button button(String label, boolean primary) {
        Button button = new Button(this); button.setText(label); button.setTextSize(12); button.setAllCaps(false);
        button.setTypeface(Typeface.DEFAULT, Typeface.BOLD); button.setTextColor(primary ? BG : Color.WHITE);
        button.setBackground(rounded(primary ? GREEN : CARD, 24)); button.setMinHeight(dp(44)); button.setMinimumHeight(dp(44));
        button.setMinWidth(dp(52)); button.setMinimumWidth(dp(52)); button.setPadding(dp(12), dp(8), dp(12), dp(8));
        return button;
    }
    private GradientDrawable rounded(int color, int radius) { GradientDrawable value = new GradientDrawable(); value.setColor(color); value.setCornerRadius(dp(radius)); return value; }
    private void add(LinearLayout parent, View child, int top) { LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.topMargin = dp(top); parent.addView(child, params); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void toast(String value) { Toast.makeText(this, value, Toast.LENGTH_LONG).show(); }
}
