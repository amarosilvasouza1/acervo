package br.com.acervo.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.Dialog;
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
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.util.LruCache;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import android.widget.FrameLayout;
import java.io.InputStream;
import java.io.File;
import java.net.HttpURLConnection;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
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
    private static final int MINI = Color.rgb(40, 45, 42);
    private static final MobileUiModel.TrackInfo<MobileLibrary.Track> TRACK_INFO = new MobileUiModel.TrackInfo<MobileLibrary.Track>() {
        public String id(MobileLibrary.Track track) { return track.id; }
        public String title(MobileLibrary.Track track) { return track.title; }
        public String artist(MobileLibrary.Track track) { return track.artist; }
        public long savedAt(MobileLibrary.Track track) { return track.savedAt; }
        public long playedAt(MobileLibrary.Track track) { return track.playedAt; }
        public long plays(MobileLibrary.Track track) { return track.plays; }
    };
    private enum Mode { HOME, SEARCH, LIBRARY, RADIO, ARTIST }
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
    private final Map<Mode, LinearLayout> navigation = new LinkedHashMap<>();
    private final Map<Mode, ImageView> navigationIcons = new LinkedHashMap<>();
    private final Map<Mode, TextView> navigationLabels = new LinkedHashMap<>();
    private ScrollView pageScroll;
    private ImageView playerCover;
    private ProgressBar miniProgress;
    private Dialog expandedPlayer;
    private TextView expandedTitle, expandedArtist;
    private ImageView expandedCover;
    private Button expandedPlay;
    private LinearLayout expandedContext;
    private final Map<String, MobileArtistCatalog.Profile> artistProfiles = new LinkedHashMap<>();
    private final Set<String> artistLookups = new java.util.HashSet<>();
    private TextView status, playerTitle, playerArtist, elapsed, remaining;
    private EditText query;
    private Button searchButton, playButton;
    private SeekBar seek;
    private MediaPlayer player;
    private MobileLibrary.Track playingTrack;
    private AudioManager audio;
    private AudioFocusRequest audioFocus;
    private Mode mode = Mode.HOME;
    private Mode artistOrigin = Mode.HOME;
    private MobileUiModel.HomeFilter homeFilter = MobileUiModel.HomeFilter.ALL;
    private String libraryQuery = "";
    private String artistName = "";
    private int playRequest;
    private boolean destroyed, preparing, seeking, foreground, playRecorded, askedNotifications;
    private List<MobileSource.Song> results = new ArrayList<>();
    private List<MobileSource.Song> searchResults = new ArrayList<>();
    private List<MobileSource.Song> radioResults = new ArrayList<>();
    private List<MobileSource.Song> radioQueue = new ArrayList<>();
    private List<MobileLibrary.Track> localQueue = new ArrayList<>();
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
        select(Mode.HOME);
        main.post(ticker);
    }

    private void buildScreen() {
        LinearLayout root = column();
        root.setBackgroundColor(BG);
        LinearLayout header = row();
        header.setPadding(dp(16), dp(8), dp(8), dp(8));
        ImageView brand = new ImageView(this);
        brand.setImageResource(R.drawable.ic_acervo);
        header.addView(brand, new LinearLayout.LayoutParams(dp(28), dp(28)));
        TextView title = text("acervo", 23, Color.WHITE, true);
        title.setPadding(dp(8), 0, 0, 0);
        header.addView(title, new LinearLayout.LayoutParams(0, -2, 1));
        Button update = iconButton("update", "Atualizar aplicativo", false);
        update.setOnClickListener(v -> AppUpdater.check(this, getSharedPreferences("acervo_connection", MODE_PRIVATE).getString("server_origin", null)));
        header.addView(update);
        Button connect = iconButton("connect", "Conexões com o computador", false);
        connect.setOnClickListener(v -> showConnections());
        header.addView(connect);
        root.addView(header);
        searchRow = row();
        searchRow.setPadding(dp(16), dp(4), dp(16), dp(12));
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
        status.setPadding(dp(16), 0, dp(16), dp(8));
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        root.addView(status);
        pageScroll = new ScrollView(this);
        pageScroll.setBackgroundColor(SURFACE);
        pageScroll.setFillViewport(true);
        pageScroll.setClipToPadding(false);
        content = column();
        content.setPadding(dp(16), dp(8), dp(16), dp(28));
        pageScroll.addView(content);
        root.addView(pageScroll, new LinearLayout.LayoutParams(-1, 0, 1));
        buildPlayer(root);
        buildNavigation(root);
        setContentView(root);
        ScreenInsets.apply(this, root);
    }

    private void showConnections() {
        startActivity(new Intent(this, MainActivity.class).putExtra(MainActivity.EXTRA_SHOW_CONNECTIONS, true)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP));
        finish();
    }

    private void buildNavigation(LinearLayout root) {
        LinearLayout tabs = row();
        tabs.setBackgroundColor(Color.rgb(17, 17, 17));
        tabs.setPadding(dp(8), dp(4), dp(8), dp(4));
        Mode[] modes = { Mode.HOME, Mode.SEARCH, Mode.LIBRARY, Mode.RADIO };
        String[] labels = { "Início", "Buscar", "Biblioteca", "Rádio" };
        String[] icons = { "home", "search", "library", "radio" };
        for (int i = 0; i < modes.length; i++) {
            final Mode target = modes[i];
            LinearLayout tab = column();
            tab.setGravity(Gravity.CENTER);
            tab.setBackground(rounded(Color.TRANSPARENT, 8));
            tab.setContentDescription(labels[i]);
            tab.setFocusable(true);
            ImageView icon = new ImageView(this);
            icon.setImageDrawable(new AcervoIcon(icons[i], MUTED));
            tab.addView(icon, new LinearLayout.LayoutParams(dp(24), dp(24)));
            TextView label = text(labels[i], 10, MUTED, false);
            LinearLayout.LayoutParams labelParams = new LinearLayout.LayoutParams(-2, -2);
            labelParams.topMargin = dp(5);
            tab.addView(label, labelParams);
            tab.setOnClickListener(v -> {
                if (target == Mode.HOME) homeFilter = MobileUiModel.HomeFilter.ALL;
                select(target);
                if (target == Mode.RADIO && radioSeed.isEmpty()) {
                    MobileLibrary.Track recent = library.recent();
                    if (recent != null) startRadio(recent.title, recent.artist, recent.id);
                }
            });
            tabs.addView(tab, new LinearLayout.LayoutParams(0, dp(57), 1));
            navigation.put(target, tab);
            navigationIcons.put(target, icon);
            navigationLabels.put(target, label);
        }
        root.addView(tabs);
    }

    private void select(Mode nextMode) {
        if (mode != nextMode) {
            searches.incrementAndGet();
            searchButton.setEnabled(true);
            pageScroll.smoothScrollTo(0, 0);
        }
        mode = nextMode;
        results = mode == Mode.RADIO ? radioResults : searchResults;
        Mode selected = mode == Mode.ARTIST ? artistOrigin : mode;
        String[] icons = { "home", "search", "library", "radio" };
        int i = 0;
        for (Mode key : navigation.keySet()) {
            boolean active = key == selected;
            navigation.get(key).setSelected(active);
            navigationIcons.get(key).setImageDrawable(new AcervoIcon(icons[i++], active ? Color.WHITE : MUTED));
            navigationLabels.get(key).setTextColor(active ? Color.WHITE : MUTED);
        }
        searchRow.setVisibility(mode == Mode.SEARCH || mode == Mode.RADIO ? View.VISIBLE : View.GONE);
        query.setHint(mode == Mode.RADIO ? "Música ou artista para a rádio" : "O que você quer ouvir?");
        searchButton.setText(mode == Mode.RADIO ? "Gerar" : "Buscar");
        render();
    }

    private void render() {
        content.removeAllViews();
        downloadLabels.clear();
        status.setVisibility(View.VISIBLE);
        if (mode == Mode.HOME) renderHome();
        else if (mode == Mode.LIBRARY) renderLibrary();
        else if (mode == Mode.ARTIST) renderArtist();
        else renderResults();
    }

    private void renderHome() {
        MobileUiModel.Home<MobileLibrary.Track> home = MobileUiModel.home(library.all(), TRACK_INFO);
        setStatus(online() ? "" : "Você está offline · suas músicas salvas continuam disponíveis");
        addHomeFilters();
        String title = homeFilter == MobileUiModel.HomeFilter.ALL
                ? MobileUiModel.greeting(java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY))
                : homeFilter == MobileUiModel.HomeFilter.RECOMMENDED ? "Feitas para você"
                : homeFilter == MobileUiModel.HomeFilter.RECENT ? "Ouvidas recentemente" : "Músicas salvas";
        add(content, text(title, 26, Color.WHITE, true), 20);
        if (homeFilter != MobileUiModel.HomeFilter.ALL) {
            add(content, text(homeFilter == MobileUiModel.HomeFilter.RECOMMENDED
                    ? "Suas favoritas e músicas salvas para ouvir de novo."
                    : homeFilter == MobileUiModel.HomeFilter.RECENT ? "O que você ouviu neste celular."
                    : "Disponíveis neste celular, mesmo sem internet.", 13, MUTED, false), 8);
            List<MobileLibrary.Track> selection = home.selected(homeFilter);
            if (selection.isEmpty()) {
                addEmptyHome(homeFilter == MobileUiModel.HomeFilter.RECENT
                        ? "Suas músicas recentes aparecem aqui" : "Sua próxima música favorita começa aqui",
                        homeFilter == MobileUiModel.HomeFilter.RECENT
                                ? "Dê play em uma música da sua biblioteca para continuar de onde parou."
                                : "Busque uma música para começar seu acervo ou descubra novos sons na rádio.");
            } else for (MobileLibrary.Track track : selection) add(content, savedRow(track), 2);
            return;
        }
        if (home.saved.isEmpty()) {
            addEmptyHome("Sua próxima música favorita começa aqui",
                    "Busque uma música para começar seu acervo ou descubra novos sons na rádio.");
        } else {
            addQuickShortcuts(home.picks);
            if (!home.recent.isEmpty()) {
                sectionAction("Ouvidas recentemente", () -> selectHomeFilter(MobileUiModel.HomeFilter.RECENT));
                addTrackRail(home.recent, 8);
            }
            sectionAction("Adicionadas recentemente", () -> select(Mode.LIBRARY));
            addTrackRail(home.saved, 8);
        }
        section("Descubra algo novo", "");
        LinearLayout discovery = row();
        addShortcut(discovery, "library", "Feitas para você", "Suas favoritas no celular", () -> selectHomeFilter(MobileUiModel.HomeFilter.RECOMMENDED));
        addShortcut(discovery, "radio", "Sua próxima descoberta", "Uma rádio a partir do seu som", this::openRadio);
        add(content, discovery, 14);
        if (!home.saved.isEmpty()) addArtistRail(home.saved);
    }

    private void setStatus(String value) {
        status.setText(value);
        status.setVisibility(value.isEmpty() ? View.GONE : View.VISIBLE);
    }

    private void selectHomeFilter(MobileUiModel.HomeFilter filter) {
        homeFilter = filter;
        select(Mode.HOME);
        pageScroll.smoothScrollTo(0, 0);
    }

    private void addHomeFilters() {
        HorizontalScrollView scroll = new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        LinearLayout chips = row();
        MobileUiModel.HomeFilter[] filters = MobileUiModel.HomeFilter.values();
        String[] labels = { "Tudo", "Recomendadas", "Recentes", "Salvas" };
        for (int index = 0; index < filters.length; index++) {
            MobileUiModel.HomeFilter filter = filters[index];
            boolean selected = homeFilter == filter;
            Button chip = button(labels[index], selected);
            chip.setTextSize(12);
            chip.setTypeface(Typeface.DEFAULT, Typeface.NORMAL);
            chip.setSelected(selected);
            chip.setOnClickListener(view -> selectHomeFilter(filter));
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-2, dp(40));
            if (index > 0) params.leftMargin = dp(8);
            chips.addView(chip, params);
        }
        scroll.addView(chips);
        add(content, scroll, 0);
    }

    private void addEmptyHome(String title, String description) {
        LinearLayout empty = column();
        empty.setGravity(Gravity.CENTER_HORIZONTAL);
        empty.setPadding(dp(12), dp(32), dp(12), dp(28));
        ImageView icon = new ImageView(this);
        icon.setImageDrawable(new AcervoIcon("radio", GREEN));
        empty.addView(icon, new LinearLayout.LayoutParams(dp(40), dp(40)));
        TextView heading = text(title, 23, Color.WHITE, true);
        heading.setGravity(Gravity.CENTER);
        add(empty, heading, 20);
        TextView body = text(description, 14, MUTED, false);
        body.setGravity(Gravity.CENTER);
        add(empty, body, 10);
        Button search = button("Buscar músicas", true);
        search.setOnClickListener(view -> { select(Mode.SEARCH); query.requestFocus(); });
        add(empty, search, 22);
        Button radio = button("Explorar a rádio", false);
        radio.setOnClickListener(view -> openRadio());
        add(empty, radio, 10);
        add(content, empty, 0);
    }

    private void addQuickShortcuts(List<MobileLibrary.Track> tracks) {
        for (int index = 0; index < tracks.size(); index += 2) {
            LinearLayout shortcuts = row();
            for (int column = 0; column < 2; column++) {
                LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(56), 1);
                if (column > 0) params.leftMargin = dp(8);
                if (index + column >= tracks.size()) {
                    shortcuts.addView(new View(this), params);
                    continue;
                }
                MobileLibrary.Track track = tracks.get(index + column);
                LinearLayout shortcut = row();
                shortcut.setBackground(rounded(Color.rgb(41, 41, 41), 5));
                shortcut.setClipToOutline(true);
                ImageView cover = artwork(track.thumbnail, 56);
                shortcut.addView(cover, new LinearLayout.LayoutParams(dp(56), dp(56)));
                TextView label = text(track.title, 11, Color.WHITE, true);
                label.setMaxLines(2);
                label.setEllipsize(android.text.TextUtils.TruncateAt.END);
                label.setPadding(dp(8), 0, dp(8), 0);
                shortcut.addView(label, new LinearLayout.LayoutParams(0, -2, 1));
                shortcut.setFocusable(true);
                shortcut.setContentDescription("Tocar " + track.title);
                shortcut.setOnClickListener(view -> playSaved(track));
                shortcuts.addView(shortcut, params);
            }
            add(content, shortcuts, index == 0 ? 16 : 8);
        }
    }

    private void openRadio() {
        select(Mode.RADIO);
        MobileLibrary.Track recent = library.recent();
        if (radioSeed.isEmpty() && recent != null) startRadio(recent.title, recent.artist, recent.id);
    }

    private void addArtistRail(List<MobileLibrary.Track> tracks) {
        section("Seus artistas", "");
        HorizontalScrollView scroll = new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        LinearLayout artists = row();
        Map<String, String> names = new LinkedHashMap<>();
        for (MobileLibrary.Track track : tracks) {
            if (track.artist != null && !track.artist.trim().isEmpty()) names.putIfAbsent(track.artist.trim().toLowerCase(java.util.Locale.ROOT), track.artist.trim());
        }
        int count = 0;
        for (String name : names.values()) {
            if (count++ >= 12) break;
            LinearLayout card = column();
            card.setGravity(Gravity.CENTER_HORIZONTAL);
            card.setPadding(dp(4), dp(8), dp(12), dp(8));
            View avatar = artistAvatar(name, 112);
            card.addView(avatar, new LinearLayout.LayoutParams(dp(112), dp(112)));
            TextView label = text(name, 13, Color.WHITE, true);
            label.setGravity(Gravity.CENTER);
            label.setMaxLines(2);
            label.setEllipsize(android.text.TextUtils.TruncateAt.END);
            add(card, label, 10);
            card.setContentDescription("Ver artista " + name);
            card.setFocusable(true);
            card.setOnClickListener(v -> openArtist(name));
            artists.addView(card, new LinearLayout.LayoutParams(dp(148), -2));
        }
        scroll.addView(artists);
        add(content, scroll, 12);
    }

    private void section(String title, String description) {
        add(content, text(title, 21, Color.WHITE, true), 28);
        if (description != null && !description.isEmpty()) add(content, text(description, 12, MUTED, false), 6);
    }

    private void sectionAction(String title, Runnable action) {
        LinearLayout heading = row();
        heading.addView(text(title, 21, Color.WHITE, true), new LinearLayout.LayoutParams(0, -2, 1));
        TextView all = text("Mostrar tudo", 11, MUTED, true);
        all.setGravity(Gravity.RIGHT | Gravity.CENTER_VERTICAL);
        all.setPadding(dp(10), dp(12), 0, dp(12));
        all.setMinHeight(dp(44));
        all.setOnClickListener(view -> action.run());
        heading.addView(all);
        add(content, heading, 24);
    }

    private void addShortcut(LinearLayout parent, String icon, String title, String subtitle, Runnable action) {
        LinearLayout card = column();
        card.setPadding(dp(16), dp(16), dp(16), dp(16));
        card.setBackground(rounded(CARD, 8));
        card.setMinimumHeight(dp(140));
        ImageView image = new ImageView(this);
        image.setImageDrawable(new AcervoIcon(icon, Color.WHITE));
        card.addView(image, new LinearLayout.LayoutParams(dp(24), dp(24)));
        add(card, text(title, 14, Color.WHITE, true), 12);
        add(card, text(subtitle, 11, MUTED, false), 4);
        card.setFocusable(true);
        card.setContentDescription(title + ". " + subtitle);
        card.setOnClickListener(v -> action.run());
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, -1, 1);
        if (parent.getChildCount() > 0) params.leftMargin = dp(10);
        parent.addView(card, params);
    }

    private void addTrackRail(List<MobileLibrary.Track> tracks, int limit) {
        HorizontalScrollView scroll = new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        LinearLayout rail = row();
        rail.setGravity(Gravity.TOP);
        for (int i = 0; i < Math.min(limit, tracks.size()); i++) {
            MobileLibrary.Track track = tracks.get(i);
            LinearLayout tile = column();
            tile.setPadding(0, dp(4), 0, dp(8));
            FrameLayout art = new FrameLayout(this);
            ImageView cover = artwork(track.thumbnail, 148);
            art.addView(cover, new FrameLayout.LayoutParams(-1, -1));
            Button play = iconButton("play", "Tocar " + track.title, true);
            play.setPadding(dp(7), dp(7), dp(7), dp(7));
            play.setOnClickListener(view -> playSaved(track));
            FrameLayout.LayoutParams playParams = new FrameLayout.LayoutParams(dp(38), dp(38), Gravity.RIGHT | Gravity.BOTTOM);
            playParams.setMargins(0, 0, dp(8), dp(8));
            art.addView(play, playParams);
            tile.addView(art, new LinearLayout.LayoutParams(dp(148), dp(148)));
            cover.setContentDescription("Ouvir " + track.title);
            cover.setOnClickListener(v -> playSaved(track));
            TextView name = text(track.title, 13, Color.WHITE, true);
            name.setMaxLines(2);
            name.setEllipsize(android.text.TextUtils.TruncateAt.END);
            name.setOnClickListener(v -> playSaved(track));
            LinearLayout heading = row();
            heading.addView(name, new LinearLayout.LayoutParams(0, -2, 1));
            Button more = iconButton("more", "Opções de " + track.title, false);
            more.setPadding(dp(6), dp(6), dp(6), dp(6));
            more.setOnClickListener(view -> showTrackOptions(track));
            heading.addView(more, new LinearLayout.LayoutParams(dp(36), dp(36)));
            add(tile, heading, 4);
            TextView artist = artistLink(track.artist, 12);
            artist.setMaxLines(1);
            artist.setEllipsize(android.text.TextUtils.TruncateAt.END);
            add(tile, artist, 5);
            LinearLayout.LayoutParams tileParams = new LinearLayout.LayoutParams(dp(148), -2);
            if (i > 0) tileParams.leftMargin = dp(16);
            rail.addView(tile, tileParams);
        }
        scroll.addView(rail);
        add(content, scroll, 12);
    }

    private void renderLibrary() {
        List<MobileLibrary.Track> tracks = library.all();
        add(content, text("Sua biblioteca", 26, Color.WHITE, true), 0);
        setStatus(online() ? "" : "Você está offline · suas músicas salvas continuam disponíveis");
        long duration = 0;
        for (MobileLibrary.Track track : tracks) duration += track.duration;
        add(content, text(tracks.size() + (tracks.size() == 1 ? " música salva" : " músicas salvas")
                + (duration > 0 ? " · " + durationText(duration) : ""), 13, MUTED, false), 10);
        if (tracks.isEmpty()) {
            addEmptyHome("Vamos começar sua coleção", "Baixe uma música para ela aparecer aqui.");
            return;
        }
        Button play = button("Reproduzir", true);
        play.setOnClickListener(v -> playSaved(tracks.get(0)));
        LinearLayout actions = row();
        actions.addView(play);
        TextView order = text("Mais recentes primeiro", 12, MUTED, false);
        order.setPadding(dp(16), 0, 0, 0);
        actions.addView(order);
        add(content, actions, 20);
        EditText filter = new EditText(this);
        filter.setSingleLine(true);
        filter.setTextColor(Color.WHITE);
        filter.setHintTextColor(MUTED);
        filter.setTextSize(14);
        filter.setHint("Buscar na biblioteca");
        filter.setContentDescription("Buscar na biblioteca");
        filter.setBackground(rounded(CARD, 6));
        filter.setPadding(dp(14), dp(10), dp(14), dp(10));
        filter.setText(libraryQuery);
        add(content, filter, 16);
        LinearLayout rows = column();
        add(content, rows, 16);
        renderLibraryRows(rows, tracks);
        filter.addTextChangedListener(new android.text.TextWatcher() {
            @Override public void beforeTextChanged(CharSequence value, int start, int count, int after) { }
            @Override public void onTextChanged(CharSequence value, int start, int before, int count) {
                libraryQuery = value.toString();
                renderLibraryRows(rows, tracks);
            }
            @Override public void afterTextChanged(android.text.Editable value) { }
        });
        play.setOnClickListener(view -> {
            List<MobileLibrary.Track> visible = MobileUiModel.filter(tracks, TRACK_INFO, libraryQuery);
            if (!visible.isEmpty()) playSaved(visible.get(0));
        });
    }

    private void renderLibraryRows(LinearLayout rows, List<MobileLibrary.Track> tracks) {
        rows.removeAllViews();
        List<MobileLibrary.Track> visible = MobileUiModel.filter(tracks, TRACK_INFO, libraryQuery);
        if (visible.isEmpty()) add(rows, text("Nenhuma música encontrada na sua biblioteca.", 14, MUTED, false), 18);
        else for (MobileLibrary.Track track : visible) add(rows, savedRow(track), 2);
    }

    private LinearLayout savedRow(MobileLibrary.Track track) {
        LinearLayout line = row();
        line.setMinimumHeight(dp(64));
        ImageView cover = artwork(track.thumbnail, 44);
        line.addView(cover, new LinearLayout.LayoutParams(dp(44), dp(44)));
        cover.setContentDescription("Ouvir " + track.title);
        cover.setOnClickListener(v -> playSaved(track));
        LinearLayout info = column();
        info.setPadding(dp(10), dp(8), dp(4), dp(8));
        TextView title = text(track.title, 13, playingTrack != null && track.id.equals(playingTrack.id) ? GREEN : Color.WHITE, false);
        title.setMaxLines(1);
        title.setEllipsize(android.text.TextUtils.TruncateAt.END);
        title.setOnClickListener(v -> playSaved(track));
        info.addView(title);
        TextView artist = artistLink(track.artist, 11);
        artist.setMaxLines(1);
        artist.setEllipsize(android.text.TextUtils.TruncateAt.END);
        add(info, artist, 2);
        info.setOnClickListener(v -> playSaved(track));
        line.addView(info, new LinearLayout.LayoutParams(0, -2, 1));
        Button more = iconButton("more", "Opções de " + track.title, false);
        more.setOnClickListener(v -> showTrackOptions(track));
        line.addView(more, new LinearLayout.LayoutParams(dp(44), dp(44)));
        line.setOnClickListener(view -> playSaved(track));
        return line;
    }

    private void playSaved(MobileLibrary.Track track) {
        radioPlayback = false;
        radioQueue.clear();
        radioIndex = -1;
        MobileUiModel.Home<MobileLibrary.Track> home = MobileUiModel.home(library.all(), TRACK_INFO);
        List<MobileLibrary.Track> selection = mode == Mode.HOME ? home.selected(homeFilter) : home.saved;
        if (mode == Mode.LIBRARY) selection = MobileUiModel.filter(selection, TRACK_INFO, libraryQuery);
        localQueue = new ArrayList<>();
        for (MobileLibrary.Track candidate : selection) {
            if (mode != Mode.ARTIST || (candidate.artist != null && artistName.equalsIgnoreCase(candidate.artist.trim()))) localQueue.add(candidate);
        }
        playRequest++;
        playTrack(track);
    }

    private void showTrackOptions(MobileLibrary.Track track) {
        new AlertDialog.Builder(this).setTitle(track.title)
                .setItems(new String[] { "Reproduzir", "Ver artista", "Iniciar rádio", "Excluir download deste celular" }, (dialog, choice) -> {
                    if (choice == 0) playSaved(track);
                    else if (choice == 1) openArtist(track.artist);
                    else if (choice == 2) startRadio(track.title, track.artist, track.id);
                    else confirmRemove(track);
                }).show();
    }

    private void openArtist(String name) {
        if (name == null || name.trim().isEmpty()) return;
        if (expandedPlayer != null) expandedPlayer.dismiss();
        if (mode != Mode.ARTIST) artistOrigin = mode;
        artistName = name.trim();
        select(Mode.ARTIST);
    }

    private void renderArtist() {
        status.setText("Artista · sua biblioteca neste celular");
        Button back = iconButton("back", "Voltar", false);
        back.setOnClickListener(v -> select(artistOrigin));
        content.addView(back, new LinearLayout.LayoutParams(dp(48), dp(48)));
        final String requestedArtist = artistName;
        List<MobileLibrary.Track> tracks = new ArrayList<>();
        for (MobileLibrary.Track track : library.all()) if (track.artist != null && artistName.equalsIgnoreCase(track.artist.trim())) tracks.add(track);
        if (!artistProfiles.containsKey(artistName)) artistProfiles.put(artistName, MobileArtistCatalog.saved(getFilesDir(), artistName));
        MobileArtistCatalog.Profile profile = artistProfiles.get(artistName);
        FrameLayout banner = new FrameLayout(this);
        banner.setBackground(rounded(Color.rgb(36, 53, 43), 8)); banner.setClipToOutline(true);
        ImageView heroImage = new ImageView(this); heroImage.setScaleType(ImageView.ScaleType.CENTER_CROP);
        banner.addView(heroImage, new FrameLayout.LayoutParams(-1, -1));
        if (profile != null && !profile.picture.isEmpty()) loadCover(heroImage, profile.picture);
        else if (!tracks.isEmpty()) loadCover(heroImage, tracks.get(0).thumbnail);
        View shade = new View(this);
        shade.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[] { 0x18000000, 0xf509110c }));
        banner.addView(shade, new FrameLayout.LayoutParams(-1, -1));
        LinearLayout hero = column();
        hero.setPadding(dp(22), dp(24), dp(22), dp(24));
        TextView category = text("ARTISTA", 11, Color.WHITE, true); add(hero, category, 0);
        TextView name = text(artistName, 38, Color.WHITE, true);
        add(hero, name, 18);
        add(hero, text(tracks.size() + " músicas no seu celular", 13, Color.WHITE, false), 10);
        banner.addView(hero, new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM));
        add(content, banner, 8); banner.getLayoutParams().height = dp(320);
        long duration = 0;
        for (MobileLibrary.Track track : tracks) duration += track.duration;
        add(content, text(tracks.size() + (tracks.size() == 1 ? " música salva" : " músicas salvas")
                + (duration > 0 ? " · " + durationText(duration) : ""), 13, MUTED, false), 0);
        LinearLayout actions = row();
        if (!tracks.isEmpty()) {
            Button play = button("Reproduzir", true);
            play.setOnClickListener(v -> playSaved(tracks.get(0)));
            actions.addView(play);
        }
        Button find = button("Buscar músicas", false);
        find.setOnClickListener(v -> { String value = artistName; select(Mode.SEARCH); query.setText(value); search(value, false); });
        LinearLayout.LayoutParams findParams = new LinearLayout.LayoutParams(-2, -2);
        findParams.leftMargin = tracks.isEmpty() ? 0 : dp(8);
        actions.addView(find, findParams);
        add(content, actions, 18);
        LinearLayout catalog = column(); add(content, catalog, 22);
        renderArtistCatalog(catalog, requestedArtist, profile);
        if (online() && artistLookups.add(requestedArtist)) work.execute(() -> {
            MobileArtistCatalog.Profile fetched = null;
            try { fetched = MobileArtistCatalog.fetch(getFilesDir(), requestedArtist, tracks); } catch (Exception ignored) { }
            final MobileArtistCatalog.Profile result = fetched;
            post(() -> {
                if (result != null) artistProfiles.put(requestedArtist, result);
                if (mode != Mode.ARTIST || !requestedArtist.equals(artistName)) return;
                if (result != null && !result.picture.isEmpty()) loadCover(heroImage, result.picture);
                renderArtistCatalog(catalog, requestedArtist, result != null ? result : artistProfiles.get(requestedArtist));
            });
        });
        if (!tracks.isEmpty()) {
            section("Músicas no seu celular", "Disponíveis para ouvir offline.");
            for (MobileLibrary.Track track : tracks) add(content, savedRow(track), 8);
            List<MobileLibrary.Track> mostPlayed = new ArrayList<>();
            for (MobileLibrary.Track track : tracks) if (track.plays > 0) mostPlayed.add(track);
            Collections.sort(mostPlayed, (a, b) -> Long.compare(b.plays, a.plays));
            if (!mostPlayed.isEmpty()) {
                section("As que você mais ouve", "Com base nas reproduções neste celular.");
                addTrackRail(mostPlayed, 6);
            }
        } else {
            section("Sua coleção começa aqui", "Nenhuma música desse artista foi salva neste celular ainda.");
        }
        section("Sobre esta página", "");
        add(content, text("Aqui estão as músicas identificadas como “" + artistName + "” no seu acervo. "
                + "As informações vêm dos arquivos salvos neste celular. O perfil continua disponível offline.", 14, MUTED, false), 12);
    }

    private void renderArtistCatalog(LinearLayout target, String name, MobileArtistCatalog.Profile profile) {
        target.removeAllViews();
        if (profile == null) {
            add(target, text("Discografia", 23, Color.WHITE, true), 0);
            add(target, text(!online() ? "Conecte à internet para consultar os álbuns deste artista. Sua coleção continua disponível." : artistLookups.contains(name) ? "Não encontramos uma discografia confirmada para este nome. Explore as músicas salvas abaixo ou use Buscar músicas." : "Consultando um perfil compatível no catálogo. As músicas salvas aparecem abaixo.", 13, MUTED, false), 12);
            return;
        }
        if (profile.source.matches("https://www\\.deezer\\.com/artist/[0-9]+")) {
            Button source = button("Ver artista no Deezer ↗", false);
            source.setOnClickListener(view -> {
                try { startActivity(new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(profile.source))); }
                catch (android.content.ActivityNotFoundException ignored) { toast("Nenhum navegador disponível."); }
            });
            add(target, source, 0);
        }
        if (!profile.titles.isEmpty()) {
            add(target, text("Populares no catálogo", 23, Color.WHITE, true), 20);
            add(target, text("Toque no nome para buscar uma versão para ouvir.", 12, MUTED, false), 8);
            for (int i = 0; i < Math.min(5, profile.titles.size()); i++) {
                final String title = profile.titles.get(i);
                LinearLayout line = row(); line.setPadding(0, dp(12), 0, dp(12));
                TextView number = text(String.valueOf(i + 1), 13, MUTED, false); line.addView(number, new LinearLayout.LayoutParams(dp(28), -2));
                TextView label = text(title, 14, Color.WHITE, true); line.addView(label, new LinearLayout.LayoutParams(0, -2, 1));
                Button search = iconButton("search", "Buscar " + title, false); line.addView(search);
                View.OnClickListener find = view -> { select(Mode.SEARCH); query.setText(title + " " + name); search(title + " " + name, false); };
                line.setOnClickListener(find); search.setOnClickListener(find); add(target, line, 6);
            }
        }
        add(target, text("Discografia", 23, Color.WHITE, true), 24);
        if (profile.albums.isEmpty()) { add(target, text("Este catálogo ainda não disponibilizou os álbuns.", 13, MUTED, false), 12); return; }
        HorizontalScrollView scroll = new HorizontalScrollView(this); scroll.setHorizontalScrollBarEnabled(false);
        LinearLayout rail = row(); rail.setGravity(Gravity.TOP);
        for (MobileArtistCatalog.Album album : profile.albums) {
            LinearLayout tile = column(); tile.addView(artwork(album.picture, 144));
            TextView title = text(album.title, 13, Color.WHITE, true); title.setMaxLines(2); add(tile, title, 10);
            add(tile, text(album.date.length() >= 4 ? album.date.substring(0, 4) + " · Álbum" : "Álbum", 11, MUTED, false), 5);
            tile.setOnClickListener(view -> { select(Mode.SEARCH); query.setText(name + " " + album.title); search(name + " " + album.title, false); });
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(144), -2); params.rightMargin = dp(16); rail.addView(tile, params);
        }
        scroll.addView(rail); add(target, scroll, 16);
        add(target, text("Informações do catálogo Deezer · disponíveis também na próxima visita offline.", 11, MUTED, false), 12);
    }

    private View artistAvatar(String name, int size) {
        String[] words = name.trim().split("\\s+");
        String first = words.length == 0 || words[0].isEmpty() ? "♪" : words[0].substring(0, words[0].offsetByCodePoints(0, 1));
        String last = words.length > 1 ? words[words.length - 1].substring(0, words[words.length - 1].offsetByCodePoints(0, 1)) : "";
        FrameLayout avatar = new FrameLayout(this);
        avatar.setBackground(rounded(CARD, size));
        avatar.setClipToOutline(true);
        avatar.setContentDescription("Artista " + name);
        TextView initials = text((first + last).toUpperCase(java.util.Locale.ROOT), size / 3, Color.WHITE, true);
        initials.setGravity(Gravity.CENTER);
        avatar.addView(initials, new FrameLayout.LayoutParams(-1, -1));
        MobileArtistCatalog.Profile profile = artistProfiles.get(name);
        if (!artistProfiles.containsKey(name)) { profile = MobileArtistCatalog.saved(getFilesDir(), name); artistProfiles.put(name, profile); }
        String thumbnail = profile != null && !profile.picture.isEmpty() ? profile.picture : null;
        for (MobileLibrary.Track track : library.all()) {
            if (track.artist != null && name.equalsIgnoreCase(track.artist.trim())
                    && track.thumbnail != null && track.thumbnail.startsWith("https://")) {
                if (thumbnail == null) thumbnail = track.thumbnail;
                if (profile != null && !profile.picture.isEmpty()) break;
                try {
                    if (artworkFile(track.thumbnail).isFile()) { thumbnail = track.thumbnail; break; }
                } catch (Exception ignored) { }
            }
        }
        if (thumbnail != null) {
            ImageView cover = new ImageView(this);
            cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
            avatar.addView(cover, new FrameLayout.LayoutParams(-1, -1));
            loadCover(cover, thumbnail);
        }
        return avatar;
    }

    private TextView artistLink(String artist, int size) {
        String name = artist == null ? "" : artist.trim();
        TextView view = text(name.isEmpty() ? "Artista desconhecido" : name, size, MUTED, false);
        if (!name.isEmpty()) {
            view.setContentDescription("Ver artista " + name);
            view.setPadding(0, dp(3), 0, dp(3));
            view.setFocusable(true);
            view.setOnClickListener(v -> openArtist(name));
        }
        return view;
    }

    private void renderResults() {
        add(content, text(mode == Mode.RADIO ? "Sua rádio" : "Buscar", 26, Color.WHITE, true), 0);
        if (mode == Mode.RADIO) {
            add(content, text(radioSeed.isEmpty() ? "Escolha uma música ou use o que ouviu recentemente." : "A partir de " + radioSeed, 14, MUTED, false), 8);
            MobileLibrary.Track recent = library.recent();
            if (recent != null) {
                Button latest = button(recent.playedAt > 0 ? "Usar música recente" : "Usar último download", false);
                latest.setOnClickListener(v -> startRadio(recent.title, recent.artist, recent.id));
                add(content, latest, 12);
            }
        }
        if (results.isEmpty()) {
            status.setText(!online() ? "Sem internet · ouça seus downloads na Biblioteca."
                    : mode == Mode.RADIO ? "Novas sugestões são buscadas pela internet do celular." : "Busca e downloads usam a internet deste celular.");
            add(content, text(mode == Mode.RADIO ? "Defina o ponto de partida acima para buscar músicas semelhantes." : "Digite um artista, uma música ou cole um link do YouTube.", 15, MUTED, false), 28);
            if (mode == Mode.SEARCH) {
                section("O que você quer ouvir?", "");
                LinearLayout browse = row();
                addShortcut(browse, "library", "Sua biblioteca", "Suas músicas salvas", () -> select(Mode.LIBRARY));
                addShortcut(browse, "radio", "Descobrir na rádio", "A partir do seu som", this::openRadio);
                add(content, browse, 14);
            }
            return;
        }
        status.setText(results.size() + (online() ? " resultados · internet do celular" : " resultados anteriores · você está offline"));
        for (MobileSource.Song song : results) {
            MobileLibrary.Track saved = library.get(song.id);
            LinearLayout line = row();
            line.setMinimumHeight(dp(64));
            ImageView cover = artwork(song.thumbnail, 44);
            cover.setContentDescription("Tocar " + song.title);
            cover.setOnClickListener(view -> listenSong(song));
            line.addView(cover, new LinearLayout.LayoutParams(dp(44), dp(44)));
            LinearLayout description = column();
            description.setPadding(dp(10), dp(8), dp(4), dp(8));
            TextView title = text(song.title, 13, Color.WHITE, false);
            title.setMaxLines(2);
            title.setEllipsize(android.text.TextUtils.TruncateAt.END);
            title.setOnClickListener(view -> listenSong(song));
            description.addView(title);
            TextView artist = artistLink(song.artist, 11);
            artist.setMaxLines(1);
            artist.setEllipsize(android.text.TextUtils.TruncateAt.END);
            add(description, artist, 2);
            TextView downloadStatus = text(progress.getOrDefault(song.id, ""), 10, MUTED, false);
            downloadStatus.setVisibility(downloadStatus.length() == 0 ? View.GONE : View.VISIBLE);
            downloadStatus.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
            downloadLabels.put(song.id, downloadStatus);
            add(description, downloadStatus, 2);
            description.setOnClickListener(view -> listenSong(song));
            line.addView(description, new LinearLayout.LayoutParams(0, -2, 1));
            Button save = iconButton(saved == null ? "download" : "play", saved == null ? "Baixar " + song.title : "Tocar " + song.title, false);
            if (saved != null) setIcon(save, "play", GREEN);
            save.setOnClickListener(view -> { if (saved == null) download(song, false); else listenSong(song); });
            line.addView(save, new LinearLayout.LayoutParams(dp(44), dp(44)));
            Button more = iconButton("more", "Opções de " + song.title, false);
            more.setOnClickListener(view -> showSongOptions(song));
            line.addView(more, new LinearLayout.LayoutParams(dp(44), dp(44)));
            line.setOnClickListener(view -> listenSong(song));
            add(content, line, 2);
        }
    }

    private void listenSong(MobileSource.Song song) {
        MobileLibrary.Track saved = library.get(song.id);
        if (saved != null) {
            if (mode == Mode.RADIO) playRadioSaved(song, saved);
            else playSaved(saved);
        } else if (mode == Mode.RADIO) listenRadio(song);
        else { radioPlayback = false; download(song, true); }
    }

    private void showSongOptions(MobileSource.Song song) {
        MobileLibrary.Track saved = library.get(song.id);
        if (saved != null) { showTrackOptions(saved); return; }
        new AlertDialog.Builder(this).setTitle(song.title)
                .setItems(new String[] { "Baixar e ouvir", "Baixar", "Ver artista", "Iniciar rádio" }, (dialog, choice) -> {
                    if (choice == 0) listenSong(song);
                    else if (choice == 1) download(song, false);
                    else if (choice == 2) openArtist(song.artist);
                    else startRadio(song.title, song.artist, song.id);
                }).show();
    }

    private void runInput() {
        String value = query.getText().toString().trim();
        if (value.isEmpty()) { query.setError("Digite uma música ou artista."); return; }
        InputMethodManager keyboard = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        if (keyboard != null) keyboard.hideSoftInputFromWindow(query.getWindowToken(), 0);
        if (mode == Mode.RADIO) { radioSeed = value; excludedId = ""; search(value + " músicas semelhantes", true); }
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
        select(Mode.RADIO);
        query.setText(title);
        search((artist == null || artist.isEmpty() ? title : artist) + " " + title + " músicas parecidas", true);
    }

    private void search(String value, boolean radio) {
        if (!online()) {
            searchButton.setEnabled(true);
            status.setText("Sem internet. Seus downloads continuam disponíveis na Biblioteca.");
            return;
        }
        int generation = searches.incrementAndGet();
        Mode requestedMode = mode;
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
        if (saved != null) {
            if (listen) { if (!radioPlayback) localQueue = library.all(); playTrack(saved); }
            return;
        }
        if (!online()) {
            playAfterDownload.remove(song.id);
            setProgress(song.id, "Conecte à internet para baixar.");
            if (!quiet) toast("Conecte à internet para baixar. As músicas salvas continuam disponíveis.");
            return;
        }
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
                    if (requested != null && requested == playRequest) {
                        if (!radioPlayback) localQueue = library.all();
                        playTrack(track);
                    }
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
        post(() -> {
            TextView label = downloadLabels.get(id);
            if (label != null) { label.setText(value); label.setVisibility(value.isEmpty() ? View.GONE : View.VISIBLE); }
        });
    }

    private ImageView artwork(String url, int size) {
        ImageView cover = new ImageView(this);
        cover.setImageResource(R.drawable.ic_acervo);
        cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
        cover.setBackground(rounded(CARD, 6));
        cover.setClipToOutline(true);
        loadCover(cover, url);
        return cover;
    }

    private void loadCover(ImageView target, String url) {
        target.setTag(url);
        if (url == null || !url.startsWith("https://")) return;
        Bitmap cached = coverCache.get(url);
        if (cached != null) { target.setImageBitmap(cached); return; }
        covers.execute(() -> {
            if (destroyed) return;
            HttpURLConnection connection = null;
            try {
                File cachedFile = artworkFile(url);
                synchronized (coverCache) {
                    if (cachedFile.isFile()) {
                        BitmapFactory.Options bounds = new BitmapFactory.Options();
                        bounds.inJustDecodeBounds = true;
                        BitmapFactory.decodeFile(cachedFile.getAbsolutePath(), bounds);
                        BitmapFactory.Options options = coverOptions(bounds.outWidth, bounds.outHeight);
                        Bitmap image = ArtworkCrop.trim(BitmapFactory.decodeFile(cachedFile.getAbsolutePath(), options));
                        if (image != null) {
                            coverCache.put(url, image);
                            post(() -> { if (url.equals(target.getTag())) target.setImageBitmap(image); });
                            return;
                        }
                    }
                }
                if (!online()) return;
                connection = MobileLibrary.openHttps(url);
                byte[] bytes;
                try (InputStream input = connection.getInputStream()) { bytes = MobileLibrary.readLimited(input, 2 * 1024 * 1024); }
                BitmapFactory.Options bounds = new BitmapFactory.Options();
                bounds.inJustDecodeBounds = true;
                BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
                if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return;
                BitmapFactory.Options options = coverOptions(bounds.outWidth, bounds.outHeight);
                Bitmap image = ArtworkCrop.trim(BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options));
                if (image == null) return;
                coverCache.put(url, image);
                try {
                    MobileArtworkCache.store(getFilesDir(), url, new java.io.ByteArrayInputStream(bytes));
                } catch (Exception ignored) { /* A full artwork cache never prevents playback. */ }
                post(() -> { if (url.equals(target.getTag())) target.setImageBitmap(image); });
            } catch (Exception ignored) { /* An unavailable cover never hides a playable song. */ }
            finally { if (connection != null) connection.disconnect(); }
        });
    }

    private File artworkFile(String url) throws Exception {
        return MobileArtworkCache.fileFor(getFilesDir(), url);
    }

    private BitmapFactory.Options coverOptions(int width, int height) {
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = 1;
        while (width / options.inSampleSize > 512 || height / options.inSampleSize > 512) options.inSampleSize *= 2;
        return options;
    }

    private void buildPlayer(LinearLayout root) {
        playerPanel = column();
        playerPanel.setBackground(rounded(MINI, 8));
        playerPanel.setPadding(0, 0, 0, 0);
        playerPanel.setVisibility(View.GONE);
        LinearLayout mini = row();
        mini.setPadding(dp(8), dp(6), dp(4), dp(4));
        playerCover = artwork("", 44);
        mini.addView(playerCover, new LinearLayout.LayoutParams(dp(44), dp(44)));
        LinearLayout info = column();
        info.setPadding(dp(10), 0, dp(4), 0);
        playerTitle = text("", 12, Color.WHITE, true);
        playerTitle.setMaxLines(1);
        playerTitle.setEllipsize(android.text.TextUtils.TruncateAt.END);
        info.addView(playerTitle);
        playerArtist = text("", 11, MUTED, false);
        playerArtist.setMaxLines(1);
        playerArtist.setEllipsize(android.text.TextUtils.TruncateAt.END);
        add(info, playerArtist, 4);
        mini.addView(info, new LinearLayout.LayoutParams(0, -2, 1));
        Button connection = iconButton("connect", "Conexões e dispositivos", false);
        connection.setOnClickListener(view -> showConnections());
        mini.addView(connection, new LinearLayout.LayoutParams(dp(44), dp(44)));
        playButton = iconButton("play", "Reproduzir", false);
        playButton.setOnClickListener(v -> togglePlayback());
        mini.addView(playButton, new LinearLayout.LayoutParams(dp(44), dp(44)));
        mini.setContentDescription("Abrir reprodutor");
        mini.setOnClickListener(v -> openPlayer());
        info.setOnClickListener(v -> openPlayer());
        playerCover.setOnClickListener(v -> openPlayer());
        playerPanel.addView(mini);
        miniProgress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        miniProgress.setMax(1000);
        miniProgress.setProgressTintList(android.content.res.ColorStateList.valueOf(Color.WHITE));
        miniProgress.setProgressBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.rgb(84, 88, 85)));
        LinearLayout.LayoutParams bar = new LinearLayout.LayoutParams(-1, dp(2));
        bar.setMargins(dp(8), 0, dp(8), 0);
        playerPanel.addView(miniProgress, bar);
        LinearLayout.LayoutParams playerParams = new LinearLayout.LayoutParams(-1, -2);
        playerParams.setMargins(dp(8), dp(6), dp(8), dp(8));
        root.addView(playerPanel, playerParams);
    }

    private void openPlayer() {
        if (playingTrack == null || destroyed) return;
        if (expandedPlayer != null && expandedPlayer.isShowing()) return;
        Dialog dialog = new Dialog(this, android.R.style.Theme_Material_NoActionBar);
        expandedPlayer = dialog;
        LinearLayout page = column();
        GradientDrawable playerBackground = new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                new int[] { Color.rgb(36, 50, 42), SURFACE });
        page.setBackground(playerBackground);
        LinearLayout top = row();
        top.setPadding(dp(12), dp(12), dp(12), dp(12));
        Button collapse = iconButton("down", "Minimizar reprodutor", false);
        collapse.setOnClickListener(v -> dialog.dismiss());
        top.addView(collapse);
        TextView source = text("TOCANDO AGORA", 10, MUTED, true);
        source.setGravity(Gravity.CENTER);
        top.addView(source, new LinearLayout.LayoutParams(0, -2, 1));
        Button more = iconButton("more", "Opções da música", false);
        more.setOnClickListener(v -> { if (playingTrack != null) showTrackOptions(playingTrack); });
        top.addView(more);
        page.addView(top);
        ScrollView scroll = new ScrollView(this);
        LinearLayout body = column();
        body.setPadding(dp(24), dp(8), dp(24), dp(24));
        float density = getResources().getDisplayMetrics().density;
        int viewportWidth = Math.round(getResources().getDisplayMetrics().widthPixels / density);
        int viewportHeight = Math.round(getResources().getDisplayMetrics().heightPixels / density);
        int size = Math.min(380, Math.min(Math.max(160, viewportWidth - 48), Math.max(200, viewportHeight - 410)));
        expandedCover = artwork(playingTrack.thumbnail, size);
        LinearLayout.LayoutParams artParams = new LinearLayout.LayoutParams(dp(size), dp(size));
        artParams.gravity = Gravity.CENTER_HORIZONTAL;
        body.addView(expandedCover, artParams);
        expandedTitle = text(playingTrack.title, 26, Color.WHITE, true);
        expandedTitle.setMaxLines(3);
        expandedTitle.setEllipsize(android.text.TextUtils.TruncateAt.END);
        add(body, expandedTitle, 28);
        expandedArtist = artistLink(playingTrack.artist, 16);
        expandedArtist.setOnClickListener(v -> { if (playingTrack != null) openArtist(playingTrack.artist); });
        add(body, expandedArtist, 8);
        seek = new SeekBar(this);
        seek.setMax(1000);
        seek.setProgressTintList(android.content.res.ColorStateList.valueOf(Color.WHITE));
        seek.setProgressBackgroundTintList(android.content.res.ColorStateList.valueOf(CARD));
        seek.setThumbTintList(android.content.res.ColorStateList.valueOf(Color.WHITE));
        seek.setContentDescription("Posição da música");
        seek.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onStartTrackingTouch(SeekBar bar) { seeking = true; }
            @Override public void onStopTrackingTouch(SeekBar bar) {
                if (player != null && !preparing) try { player.seekTo((int) ((long) player.getDuration() * bar.getProgress() / 1000)); } catch (IllegalStateException ignored) { }
                seeking = false;
            }
            @Override public void onProgressChanged(SeekBar bar, int value, boolean user) { }
        });
        add(body, seek, 24);
        LinearLayout times = row();
        elapsed = text("0:00", 11, MUTED, false);
        remaining = text("0:00", 11, MUTED, false);
        times.addView(elapsed, new LinearLayout.LayoutParams(0, -2, 1));
        times.addView(remaining);
        body.addView(times);
        LinearLayout controls = row();
        controls.setGravity(Gravity.CENTER);
        Button previous = iconButton("previous", "Música anterior", false);
        previous.setOnClickListener(v -> skip(-1));
        controls.addView(previous, new LinearLayout.LayoutParams(dp(64), dp(64)));
        expandedPlay = iconButton("play", "Reproduzir", true);
        expandedPlay.setBackground(rounded(Color.WHITE, 48));
        expandedPlay.setOnClickListener(v -> togglePlayback());
        LinearLayout.LayoutParams playParams = new LinearLayout.LayoutParams(dp(64), dp(64));
        playParams.setMargins(dp(20), 0, dp(20), 0);
        controls.addView(expandedPlay, playParams);
        Button next = iconButton("next", "Próxima música", false);
        next.setOnClickListener(v -> skip(1));
        controls.addView(next, new LinearLayout.LayoutParams(dp(64), dp(64)));
        add(body, controls, 22);
        Button radio = button("Iniciar rádio desta música", false);
        radio.setOnClickListener(v -> {
            if (playingTrack == null) return;
            dialog.dismiss();
            startRadio(playingTrack.title, playingTrack.artist, playingTrack.id);
        });
        add(body, radio, 28);
        add(body, text("Este celular · música salva para ouvir offline", 12, GREEN, false), 12);
        expandedContext = column(); add(body, expandedContext, 28);
        renderExpandedContext();
        scroll.addView(body);
        page.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        dialog.setContentView(page);
        Window window = dialog.getWindow();
        if (window != null) {
            window.setStatusBarColor(SURFACE);
            window.setNavigationBarColor(SURFACE);
            window.setLayout(-1, -1);
        }
        dialog.setOnDismissListener(value -> {
            if (expandedPlayer == dialog) {
                expandedPlayer = null;
                expandedPlay = null;
                expandedCover = null;
                expandedTitle = null;
                expandedArtist = null;
                expandedContext = null;
                seek = null;
                elapsed = null;
                remaining = null;
                seeking = false;
            }
        });
        dialog.show();
        if (window != null) window.setLayout(-1, -1);
        applyPlayerInsets(page, window);
        updatePlayer();
    }

    private void renderExpandedContext() {
        if (expandedContext == null || playingTrack == null) return;
        expandedContext.removeAllViews();
        LinearLayout artistCard = column(); artistCard.setPadding(dp(20), dp(20), dp(20), dp(20)); artistCard.setBackground(rounded(CARD, 8));
        add(artistCard, text("SOBRE O ARTISTA", 10, MUTED, true), 0);
        LinearLayout heading = row(); heading.addView(artistAvatar(playingTrack.artist, 64), new LinearLayout.LayoutParams(dp(64), dp(64)));
        TextView name = text(playingTrack.artist, 22, Color.WHITE, true); name.setPadding(dp(16), 0, 0, 0); heading.addView(name, new LinearLayout.LayoutParams(0, -2, 1)); add(artistCard, heading, 16);
        List<MobileLibrary.Track> artistTracks = new ArrayList<>(); for (MobileLibrary.Track item : library.all()) if (item.artist.equalsIgnoreCase(playingTrack.artist)) artistTracks.add(item);
        add(artistCard, text(artistTracks.size() + " músicas na sua coleção. Explore os destaques e as músicas deste artista.", 13, MUTED, false), 16);
        Button profile = button("Abrir perfil do artista", false); profile.setOnClickListener(view -> { if (playingTrack != null) openArtist(playingTrack.artist); }); add(artistCard, profile, 16);
        add(expandedContext, artistCard, 0);
        add(expandedContext, text("A seguir", 22, Color.WHITE, true), 28);
        if (radioPlayback) {
            for (int i = radioIndex + 1; i < radioQueue.size() && i <= radioIndex + 3; i++) {
                final MobileSource.Song song = radioQueue.get(i);
                LinearLayout line = row(); line.addView(artwork(song.thumbnail, 44));
                LinearLayout labels = column(); labels.setPadding(dp(12), dp(8), 0, dp(8));
                add(labels, text(song.title, 13, Color.WHITE, true), 0); add(labels, text(song.artist, 11, MUTED, false), 6);
                line.addView(labels, new LinearLayout.LayoutParams(0, -2, 1));
                line.setOnClickListener(view -> { if (expandedPlayer != null) expandedPlayer.dismiss(); listenSong(song); }); add(expandedContext, line, 12);
            }
            if (radioIndex + 1 >= radioQueue.size()) add(expandedContext, text("A rádio está preparando a próxima música.", 13, MUTED, false), 12);
            return;
        }
        List<MobileLibrary.Track> next = localQueue.isEmpty() ? library.all() : localQueue;
        int index = -1; for (int i = 0; i < next.size(); i++) if (next.get(i).id.equals(playingTrack.id)) { index = i; break; }
        int added = 0;
        for (int i = index + 1; i < next.size() && added < 3; i++) { if (next.get(i).id.equals(playingTrack.id)) continue; add(expandedContext, savedRow(next.get(i)), 12); added++; }
        if (added == 0) add(expandedContext, text(radioPlayback ? "A rádio está preparando a próxima música." : "Você chegou ao fim da fila. Inicie uma rádio para continuar descobrindo.", 13, MUTED, false), 12);
    }

    @SuppressWarnings("deprecation")
    private void applyPlayerInsets(View page, Window window) {
        if (window != null && Build.VERSION.SDK_INT >= 30) window.setDecorFitsSystemWindows(false);
        else if (window != null) window.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        page.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets safe = insets.getInsets(android.view.WindowInsets.Type.systemBars()
                        | android.view.WindowInsets.Type.displayCutout());
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            } else view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        page.requestApplyInsets();
    }

    private void togglePlayback() {
        if (player == null || preparing) return;
        try { if (player.isPlaying()) pause(); else startPrepared(); }
        catch (IllegalStateException failure) { toast("Escolha a música novamente para tocar."); }
    }

    private void playTrack(MobileLibrary.Track track) {
        releasePlayer();
        playingTrack = track;
        playerPanel.setVisibility(View.VISIBLE);
        playerTitle.setText(track.title);
        playerArtist.setText(track.artist);
        playerCover.setImageResource(R.drawable.ic_acervo);
        loadCover(playerCover, track.thumbnail);
        if (expandedTitle != null) expandedTitle.setText(track.title);
        if (expandedArtist != null) expandedArtist.setText(track.artist);
        renderExpandedContext();
        if (expandedCover != null) {
            expandedCover.setImageResource(R.drawable.ic_acervo);
            loadCover(expandedCover, track.thumbnail);
        }
        PlaybackService.update(this, track.title, track.artist, false, null, 0, Math.max(0, track.duration * 1000L));
        setIcon(playButton, "play", Color.WHITE);
        playButton.setEnabled(false);
        if (expandedPlay != null) expandedPlay.setEnabled(false);
        preparing = true;
        playRecorded = false;
        MediaPlayer candidate = new MediaPlayer();
        player = candidate;
        candidate.setAudioAttributes(audioAttributes());
        candidate.setWakeMode(getApplicationContext(), PowerManager.PARTIAL_WAKE_LOCK);
        candidate.setOnPreparedListener(ready -> {
            if (ready != player) return;
            preparing = false;
            playButton.setEnabled(true);
            if (expandedPlay != null) expandedPlay.setEnabled(true);
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
        List<MobileLibrary.Track> queue = new ArrayList<>();
        for (MobileLibrary.Track track : localQueue) {
            MobileLibrary.Track current = library.get(track.id);
            if (current != null) queue.add(current);
        }
        if (queue.isEmpty()) queue = library.all();
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
        if (player == null || preparing) return;
        try {
            int duration = player.getDuration();
            int position = player.getCurrentPosition();
            int progress = duration > 0 ? (int) ((long) position * 1000 / duration) : 0;
            if (!seeking && seek != null) seek.setProgress(progress);
            if (miniProgress != null) miniProgress.setProgress(progress);
            if (elapsed != null) elapsed.setText(time(position / 1000));
            if (remaining != null) remaining.setText(time(duration / 1000));
            boolean playing = player.isPlaying();
            setIcon(playButton, playing ? "pause" : "play", Color.WHITE);
            playButton.setContentDescription(playing ? "Pausar" : "Reproduzir");
            if (expandedPlay != null) {
                setIcon(expandedPlay, playing ? "pause" : "play", BG);
                expandedPlay.setContentDescription(playing ? "Pausar" : "Reproduzir");
            }
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
        if (!askedNotifications && Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            askedNotifications = true;
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 91);
        }
        PlaybackService.update(this, playingTrack == null ? "Acervo" : playingTrack.title,
                playingTrack == null ? "" : playingTrack.artist, true, null, positionMs(), durationMs());
        prefetchNextRadio();
        updatePlayer();
    }
    private static AudioAttributes audioAttributes() { return new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build(); }
    private void pause() {
        if (player != null && !preparing) try { player.pause(); updatePlayer(); } catch (IllegalStateException ignored) { }
        if (audio != null && audioFocus != null) audio.abandonAudioFocusRequest(audioFocus);
        if (playingTrack != null && player != null) PlaybackService.update(this, playingTrack.title, playingTrack.artist, false, null, positionMs(), durationMs());
    }
    private void releasePlayer() {
        if (player != null) { player.setOnCompletionListener(null); player.release(); player = null; }
        preparing = false;
        if (audio != null && audioFocus != null) audio.abandonAudioFocusRequest(audioFocus);
        if (playButton != null) { setIcon(playButton, "play", Color.WHITE); playButton.setEnabled(true); }
        if (expandedPlay != null) { setIcon(expandedPlay, "play", BG); expandedPlay.setEnabled(true); }
        PlaybackService.hide(this);
    }

    private void confirmRemove(MobileLibrary.Track track) {
        new AlertDialog.Builder(this).setTitle("Excluir download?")
                .setMessage("A música será removida apenas da biblioteca deste celular: " + track.title)
                .setNegativeButton("Cancelar", null).setPositiveButton("Excluir", (dialog, which) -> {
                    if (playingTrack != null && playingTrack.id.equals(track.id)) {
                        releasePlayer(); playingTrack = null; playerPanel.setVisibility(View.GONE);
                        if (expandedPlayer != null) expandedPlayer.dismiss();
                    }
                    work.execute(() -> {
                        try { library.remove(track.id); post(this::render); }
                        catch (Exception failure) { post(() -> toast(message(failure))); }
                    });
                }).show();
    }

    @Override protected void onResume() { super.onResume(); foreground = true; if (content != null) render(); }
    @Override protected void onStop() { foreground = false; super.onStop(); }
    @Override protected void onDestroy() {
        PlaybackService.detach(this);
        destroyed = true;
        searches.incrementAndGet();
        main.removeCallbacksAndMessages(null);
        if (expandedPlayer != null) expandedPlayer.dismiss();
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
            if (expandedPlayer != null) expandedPlayer.dismiss();
        });
    }

    @Override public Class<?> playerActivity() { return StandaloneActivity.class; }
    @Override public long positionMs() {
        try { return player == null || preparing ? 0 : Math.max(0, player.getCurrentPosition()); }
        catch (IllegalStateException ignored) { return 0; }
    }
    @Override public long durationMs() {
        try { return player == null || preparing ? 0 : Math.max(0, player.getDuration()); }
        catch (IllegalStateException ignored) { return 0; }
    }
    @Override public void onSeek(long position) {
        runOnUiThread(() -> {
            if (player == null || preparing) return;
            try { player.seekTo((int) Math.max(0, position)); } catch (IllegalStateException ignored) { }
        });
    }

    private void post(Runnable task) { main.post(() -> { if (!destroyed && !isFinishing()) task.run(); }); }
    private static String message(Exception failure) {
        String value = failure.getMessage();
        if (value == null || value.isEmpty()) return "Verifique sua conexão e tente novamente.";
        return value.length() > 220 ? value.substring(0, 220) + "…" : value;
    }
    private static String time(long seconds) { return String.format(java.util.Locale.getDefault(), "%d:%02d", Math.max(0, seconds) / 60, Math.max(0, seconds) % 60); }
    private static String durationText(long seconds) {
        long minutes = Math.max(0, seconds) / 60;
        return minutes >= 60 ? (minutes / 60) + " h " + (minutes % 60) + " min" : Math.max(1, minutes) + " min";
    }
    private boolean online() {
        try {
            ConnectivityManager manager = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            if (manager == null) return true;
            NetworkCapabilities capabilities = manager.getNetworkCapabilities(manager.getActiveNetwork());
            return capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        } catch (SecurityException ignored) { return true; }
    }

    @Override public void onBackPressed() {
        if (mode == Mode.ARTIST) select(artistOrigin);
        else if (mode != Mode.HOME) select(Mode.HOME);
        else if (homeFilter != MobileUiModel.HomeFilter.ALL) selectHomeFilter(MobileUiModel.HomeFilter.ALL);
        else moveTaskToBack(true);
    }
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
    private Button iconButton(String icon, String description, boolean primary) {
        Button view = button("", primary);
        view.setMinWidth(dp(44));
        view.setMinimumWidth(dp(44));
        view.setContentDescription(description);
        if (!primary) view.setBackground(rounded(Color.TRANSPARENT, 32));
        else view.setBackground(rounded(GREEN, 48));
        setIcon(view, icon, primary ? BG : Color.WHITE);
        return view;
    }
    private void setIcon(Button view, String icon, int color) {
        AcervoIcon drawable = new AcervoIcon(icon, color);
        drawable.setBounds(0, 0, dp(24), dp(24));
        view.setText("");
        view.setGravity(Gravity.CENTER);
        view.setCompoundDrawables(drawable, null, null, null);
        view.setPadding(dp(10), dp(10), dp(10), dp(10));
    }
    private GradientDrawable rounded(int color, int radius) { GradientDrawable value = new GradientDrawable(); value.setColor(color); value.setCornerRadius(dp(radius)); return value; }
    private void add(LinearLayout parent, View child, int top) { LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.topMargin = dp(top); parent.addView(child, params); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void toast(String value) { Toast.makeText(this, value, Toast.LENGTH_LONG).show(); }
}
