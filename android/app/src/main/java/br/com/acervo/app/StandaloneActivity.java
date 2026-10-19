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
import java.io.InputStream;
import java.io.File;
import java.io.FileOutputStream;
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
        header.setPadding(dp(20), dp(8), dp(12), dp(8));
        TextView title = text("acervo", 25, Color.WHITE, true);
        header.addView(title, new LinearLayout.LayoutParams(0, -2, 1));
        Button update = iconButton("update", "Atualizar aplicativo", false);
        update.setOnClickListener(v -> AppUpdater.check(this, getSharedPreferences("acervo_connection", MODE_PRIVATE).getString("server_origin", null)));
        header.addView(update);
        Button connect = iconButton("connect", "Conexões com o computador", false);
        connect.setOnClickListener(v -> finish());
        header.addView(connect);
        root.addView(header);
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
        pageScroll = new ScrollView(this);
        pageScroll.setFillViewport(true);
        pageScroll.setClipToPadding(false);
        content = column();
        content.setPadding(dp(20), dp(8), dp(20), dp(28));
        pageScroll.addView(content);
        root.addView(pageScroll, new LinearLayout.LayoutParams(-1, 0, 1));
        buildPlayer(root);
        buildNavigation(root);
        setContentView(root);
        ScreenInsets.apply(this, root);
    }

    private void buildNavigation(LinearLayout root) {
        LinearLayout tabs = row();
        tabs.setBackgroundColor(BG);
        tabs.setPadding(dp(4), dp(5), dp(4), dp(5));
        Mode[] modes = { Mode.HOME, Mode.SEARCH, Mode.LIBRARY, Mode.RADIO };
        String[] labels = { "Início", "Buscar", "Biblioteca", "Rádio" };
        String[] icons = { "home", "search", "library", "radio" };
        for (int i = 0; i < modes.length; i++) {
            final Mode target = modes[i];
            LinearLayout tab = column();
            tab.setGravity(Gravity.CENTER);
            tab.setBackground(rounded(BG, 8));
            tab.setContentDescription(labels[i]);
            tab.setFocusable(true);
            ImageView icon = new ImageView(this);
            icon.setImageDrawable(new AcervoIcon(icons[i], MUTED));
            tab.addView(icon, new LinearLayout.LayoutParams(dp(23), dp(23)));
            TextView label = text(labels[i], 10, MUTED, true);
            LinearLayout.LayoutParams labelParams = new LinearLayout.LayoutParams(-2, -2);
            labelParams.topMargin = dp(5);
            tab.addView(label, labelParams);
            tab.setOnClickListener(v -> {
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
        if (mode == Mode.HOME) renderHome();
        else if (mode == Mode.LIBRARY) renderLibrary();
        else if (mode == Mode.ARTIST) renderArtist();
        else renderResults();
    }

    private void renderHome() {
        List<MobileLibrary.Track> tracks = library.all();
        status.setText(online() ? "No seu celular · música em qualquer lugar" : "Você está offline · seus downloads continuam disponíveis");
        add(content, text("Feito para o seu ritmo", 29, Color.WHITE, true), 0);
        LinearLayout shortcuts = row();
        addShortcut(shortcuts, "library", "Seus downloads", tracks.size() + " músicas no celular", () -> select(Mode.LIBRARY));
        addShortcut(shortcuts, "radio", "Sua rádio", "A partir do que você ouve", () -> {
            select(Mode.RADIO);
            MobileLibrary.Track recent = library.recent();
            if (recent != null) startRadio(recent.title, recent.artist, recent.id);
        });
        add(content, shortcuts, 20);
        if (tracks.isEmpty()) {
            LinearLayout welcome = column();
            welcome.setPadding(dp(20), dp(24), dp(20), dp(24));
            welcome.setBackground(rounded(SURFACE, 8));
            add(welcome, text("Sua música, sempre com você", 24, Color.WHITE, true), 0);
            add(welcome, text("Encontre suas favoritas, salve no celular e ouça mesmo sem internet ou computador.", 15, MUTED, false), 12);
            Button discover = button("Encontrar músicas", true);
            discover.setOnClickListener(v -> { select(Mode.SEARCH); query.requestFocus(); });
            add(welcome, discover, 20);
            add(content, welcome, 24);
            return;
        }
        List<MobileLibrary.Track> recent = new ArrayList<>();
        for (MobileLibrary.Track track : tracks) if (track.playedAt > 0) recent.add(track);
        Collections.sort(recent, (a, b) -> Long.compare(b.playedAt, a.playedAt));
        if (!recent.isEmpty()) {
            section("Ouvidas recentemente", "Continue de onde seu gosto deixou.");
            addTrackRail(recent, 8);
        }
        section("Salvas no seu celular", "Prontas para tocar com ou sem conexão.");
        addTrackRail(tracks, 12);
        section("Seus artistas", "Quem está na sua biblioteca.");
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
            TextView avatar = artistAvatar(name, 78);
            card.addView(avatar, new LinearLayout.LayoutParams(dp(78), dp(78)));
            TextView label = text(name, 13, Color.WHITE, true);
            label.setGravity(Gravity.CENTER);
            label.setMaxLines(2);
            label.setEllipsize(android.text.TextUtils.TruncateAt.END);
            add(card, label, 10);
            card.setContentDescription("Ver artista " + name);
            card.setFocusable(true);
            card.setOnClickListener(v -> openArtist(name));
            artists.addView(card, new LinearLayout.LayoutParams(dp(112), -2));
        }
        scroll.addView(artists);
        add(content, scroll, 12);
    }

    private void section(String title, String description) {
        add(content, text(title, 22, Color.WHITE, true), 28);
        if (description != null && !description.isEmpty()) add(content, text(description, 12, MUTED, false), 6);
    }

    private void addShortcut(LinearLayout parent, String icon, String title, String subtitle, Runnable action) {
        LinearLayout card = column();
        card.setPadding(dp(12), dp(16), dp(10), dp(14));
        card.setBackground(rounded(CARD, 8));
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
            tile.setPadding(0, dp(4), dp(14), dp(8));
            ImageView cover = artwork(track.thumbnail, 140);
            tile.addView(cover, new LinearLayout.LayoutParams(dp(140), dp(140)));
            cover.setContentDescription("Ouvir " + track.title);
            cover.setOnClickListener(v -> playSaved(track));
            TextView name = text(track.title, 14, Color.WHITE, true);
            name.setMaxLines(2);
            name.setEllipsize(android.text.TextUtils.TruncateAt.END);
            name.setOnClickListener(v -> playSaved(track));
            add(tile, name, 10);
            TextView artist = artistLink(track.artist, 12);
            artist.setMaxLines(1);
            artist.setEllipsize(android.text.TextUtils.TruncateAt.END);
            add(tile, artist, 5);
            rail.addView(tile, new LinearLayout.LayoutParams(dp(154), -2));
        }
        scroll.addView(rail);
        add(content, scroll, 12);
    }

    private void renderLibrary() {
        List<MobileLibrary.Track> tracks = library.all();
        add(content, text("Sua biblioteca", 30, Color.WHITE, true), 0);
        status.setText(online() ? "Seus downloads · disponíveis offline" : "Modo offline · tudo salvo neste celular");
        long duration = 0;
        for (MobileLibrary.Track track : tracks) duration += track.duration;
        add(content, text(tracks.size() + (tracks.size() == 1 ? " música salva" : " músicas salvas")
                + (duration > 0 ? " · " + durationText(duration) : ""), 13, MUTED, false), 10);
        if (tracks.isEmpty()) {
            section("Vamos começar sua coleção", "Baixe uma música para ela aparecer aqui.");
            Button discover = button("Encontrar músicas", true);
            discover.setOnClickListener(v -> { select(Mode.SEARCH); query.requestFocus(); });
            add(content, discover, 22);
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
        for (MobileLibrary.Track track : tracks) add(content, savedRow(track), 8);
    }

    private LinearLayout savedRow(MobileLibrary.Track track) {
        LinearLayout line = row();
        line.setMinimumHeight(dp(76));
        ImageView cover = artwork(track.thumbnail, 52);
        line.addView(cover, new LinearLayout.LayoutParams(dp(52), dp(52)));
        cover.setContentDescription("Ouvir " + track.title);
        cover.setOnClickListener(v -> playSaved(track));
        LinearLayout info = column();
        info.setPadding(dp(12), dp(8), dp(4), dp(8));
        TextView title = text(track.title, 15, playingTrack != null && track.id.equals(playingTrack.id) ? GREEN : Color.WHITE, true);
        title.setMaxLines(2);
        title.setEllipsize(android.text.TextUtils.TruncateAt.END);
        title.setOnClickListener(v -> playSaved(track));
        info.addView(title);
        TextView artist = artistLink(track.artist, 12);
        add(info, artist, 5);
        TextView meta = text("Salva" + (track.duration > 0 ? " · " + time(track.duration) : ""), 10, MUTED, false);
        add(info, meta, 4);
        info.setOnClickListener(v -> playSaved(track));
        line.addView(info, new LinearLayout.LayoutParams(0, -2, 1));
        Button more = iconButton("more", "Opções de " + track.title, false);
        more.setOnClickListener(v -> showTrackOptions(track));
        line.addView(more);
        return line;
    }

    private void playSaved(MobileLibrary.Track track) {
        radioPlayback = false;
        radioQueue.clear();
        radioIndex = -1;
        localQueue = new ArrayList<>();
        for (MobileLibrary.Track candidate : library.all()) {
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
        LinearLayout hero = column();
        hero.setGravity(Gravity.CENTER_HORIZONTAL);
        hero.setPadding(dp(16), dp(12), dp(16), dp(24));
        TextView avatar = artistAvatar(artistName, 112);
        hero.addView(avatar, new LinearLayout.LayoutParams(dp(112), dp(112)));
        TextView name = text(artistName, 30, Color.WHITE, true);
        name.setGravity(Gravity.CENTER);
        add(hero, name, 18);
        TextView label = text("NA SUA BIBLIOTECA", 10, MUTED, true);
        label.setGravity(Gravity.CENTER);
        add(hero, label, 10);
        add(content, hero, 0);
        List<MobileLibrary.Track> tracks = new ArrayList<>();
        for (MobileLibrary.Track track : library.all()) if (track.artist != null && artistName.equalsIgnoreCase(track.artist.trim())) tracks.add(track);
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

    private TextView artistAvatar(String name, int size) {
        String[] words = name.trim().split("\\s+");
        String first = words.length == 0 || words[0].isEmpty() ? "♪" : words[0].substring(0, words[0].offsetByCodePoints(0, 1));
        String last = words.length > 1 ? words[words.length - 1].substring(0, words[words.length - 1].offsetByCodePoints(0, 1)) : "";
        TextView avatar = text((first + last).toUpperCase(java.util.Locale.ROOT), size / 3, Color.WHITE, true);
        avatar.setGravity(Gravity.CENTER);
        avatar.setBackground(rounded(CARD, size));
        avatar.setContentDescription("Artista " + name);
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
        add(content, text(mode == Mode.RADIO ? "Sua rádio, ao vivo" : "Encontre seu próximo som", 28, Color.WHITE, true), 0);
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
            return;
        }
        status.setText(results.size() + (online() ? " resultados · internet do celular" : " resultados anteriores · você está offline"));
        for (MobileSource.Song song : results) {
            LinearLayout card = songCard(song.title, song.artist, song.thumbnail, song.duration);
            LinearLayout actions = row();
            MobileLibrary.Track saved = library.get(song.id);
            if (saved != null) {
                Button play = button("Ouvir offline", true);
                play.setOnClickListener(v -> { if (mode == Mode.RADIO) playRadioSaved(song, saved); else playSaved(saved); });
                actions.addView(play);
            } else {
                Button save = button("Baixar", false);
                save.setOnClickListener(v -> download(song, false));
                actions.addView(save);
                Button listen = button("Baixar e ouvir", true);
                listen.setOnClickListener(v -> { if (mode == Mode.RADIO) listenRadio(song); else { radioPlayback = false; download(song, true); } });
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
        post(() -> { TextView label = downloadLabels.get(id); if (label != null) label.setText(value); });
    }

    private LinearLayout songCard(String title, String artist, String thumbnail, long duration) {
        LinearLayout card = column();
        card.setBackground(rounded(SURFACE, 8));
        card.setPadding(dp(14), dp(14), dp(14), dp(10));
        LinearLayout details = row();
        ImageView cover = artwork(thumbnail, 56);
        details.addView(cover, new LinearLayout.LayoutParams(dp(56), dp(56)));
        LinearLayout description = column();
        description.setPadding(dp(12), 0, 0, 0);
        TextView name = text(title, 16, Color.WHITE, true);
        name.setMaxLines(2);
        name.setEllipsize(android.text.TextUtils.TruncateAt.END);
        description.addView(name);
        TextView by = artistLink(artist, 12);
        by.setMaxLines(1);
        by.setEllipsize(android.text.TextUtils.TruncateAt.END);
        add(description, by, 5);
        if (duration > 0) add(description, text(time(duration), 10, MUTED, false), 2);
        details.addView(description, new LinearLayout.LayoutParams(0, -2, 1));
        card.addView(details);
        return card;
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
                        Bitmap image = BitmapFactory.decodeFile(cachedFile.getAbsolutePath());
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
                BitmapFactory.Options options = new BitmapFactory.Options();
                while (bounds.outWidth / Math.max(1, options.inSampleSize) > 256 || bounds.outHeight / Math.max(1, options.inSampleSize) > 256) {
                    options.inSampleSize = options.inSampleSize == 0 ? 2 : options.inSampleSize * 2;
                }
                Bitmap image = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
                if (image == null) return;
                coverCache.put(url, image);
                try {
                    File folder = cachedFile.getParentFile();
                    if (folder != null && (folder.isDirectory() || folder.mkdirs())) {
                        synchronized (coverCache) {
                            try (FileOutputStream output = new FileOutputStream(cachedFile)) {
                                image.compress(Bitmap.CompressFormat.JPEG, 85, output);
                            }
                        }
                    }
                } catch (Exception ignored) { /* A full artwork cache never prevents playback. */ }
                post(() -> { if (url.equals(target.getTag())) target.setImageBitmap(image); });
            } catch (Exception ignored) { /* An unavailable cover never hides a playable song. */ }
            finally { if (connection != null) connection.disconnect(); }
        });
    }

    private File artworkFile(String url) throws Exception {
        byte[] digest = java.security.MessageDigest.getInstance("SHA-256").digest(url.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        StringBuilder key = new StringBuilder();
        for (byte value : digest) key.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        return new File(new File(getFilesDir(), "mobile-artwork"), key + ".jpg");
    }

    private void buildPlayer(LinearLayout root) {
        playerPanel = column();
        playerPanel.setPadding(dp(8), dp(5), dp(8), 0);
        playerPanel.setVisibility(View.GONE);
        LinearLayout mini = row();
        mini.setBackground(rounded(CARD, 8));
        mini.setPadding(dp(8), dp(8), dp(4), dp(5));
        playerCover = artwork("", 42);
        mini.addView(playerCover, new LinearLayout.LayoutParams(dp(42), dp(42)));
        LinearLayout info = column();
        info.setPadding(dp(10), 0, dp(4), 0);
        playerTitle = text("", 13, Color.WHITE, true);
        playerTitle.setMaxLines(1);
        playerTitle.setEllipsize(android.text.TextUtils.TruncateAt.END);
        info.addView(playerTitle);
        playerArtist = text("", 11, MUTED, false);
        playerArtist.setMaxLines(1);
        playerArtist.setEllipsize(android.text.TextUtils.TruncateAt.END);
        add(info, playerArtist, 4);
        mini.addView(info, new LinearLayout.LayoutParams(0, -2, 1));
        playButton = iconButton("play", "Reproduzir", false);
        playButton.setOnClickListener(v -> togglePlayback());
        mini.addView(playButton, new LinearLayout.LayoutParams(dp(48), dp(48)));
        Button next = iconButton("next", "Próxima música", false);
        next.setOnClickListener(v -> skip(1));
        mini.addView(next, new LinearLayout.LayoutParams(dp(44), dp(48)));
        mini.setContentDescription("Abrir reprodutor");
        mini.setOnClickListener(v -> openPlayer());
        info.setOnClickListener(v -> openPlayer());
        playerCover.setOnClickListener(v -> openPlayer());
        playerPanel.addView(mini);
        miniProgress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        miniProgress.setMax(1000);
        miniProgress.setProgressTintList(android.content.res.ColorStateList.valueOf(Color.WHITE));
        miniProgress.setProgressBackgroundTintList(android.content.res.ColorStateList.valueOf(CARD));
        LinearLayout.LayoutParams bar = new LinearLayout.LayoutParams(-1, dp(2));
        bar.setMargins(dp(8), 0, dp(8), 0);
        playerPanel.addView(miniProgress, bar);
        root.addView(playerPanel);
    }

    private void openPlayer() {
        if (playingTrack == null || destroyed) return;
        if (expandedPlayer != null && expandedPlayer.isShowing()) return;
        Dialog dialog = new Dialog(this, android.R.style.Theme_Material_NoActionBar);
        expandedPlayer = dialog;
        LinearLayout page = column();
        page.setBackgroundColor(SURFACE);
        LinearLayout top = row();
        top.setPadding(dp(12), dp(12), dp(12), dp(12));
        Button collapse = iconButton("down", "Minimizar reprodutor", false);
        collapse.setOnClickListener(v -> dialog.dismiss());
        top.addView(collapse);
        TextView source = text("TOCANDO NESTE CELULAR", 10, MUTED, true);
        source.setGravity(Gravity.CENTER);
        top.addView(source, new LinearLayout.LayoutParams(0, -2, 1));
        Button more = iconButton("more", "Opções da música", false);
        more.setOnClickListener(v -> { if (playingTrack != null) showTrackOptions(playingTrack); });
        top.addView(more);
        page.addView(top);
        ScrollView scroll = new ScrollView(this);
        LinearLayout body = column();
        body.setPadding(dp(24), dp(8), dp(24), dp(24));
        int size = Math.min(420, Math.max(160, Math.round(getResources().getDisplayMetrics().widthPixels / getResources().getDisplayMetrics().density) - 48));
        expandedCover = artwork(playingTrack.thumbnail, size);
        LinearLayout.LayoutParams artParams = new LinearLayout.LayoutParams(dp(size), dp(size));
        artParams.gravity = Gravity.CENTER_HORIZONTAL;
        body.addView(expandedCover, artParams);
        expandedTitle = text(playingTrack.title, 25, Color.WHITE, true);
        expandedTitle.setMaxLines(3);
        expandedTitle.setEllipsize(android.text.TextUtils.TruncateAt.END);
        add(body, expandedTitle, 28);
        expandedArtist = artistLink(playingTrack.artist, 16);
        expandedArtist.setOnClickListener(v -> { if (playingTrack != null) openArtist(playingTrack.artist); });
        add(body, expandedArtist, 8);
        seek = new SeekBar(this);
        seek.setMax(1000);
        seek.setProgressTintList(android.content.res.ColorStateList.valueOf(GREEN));
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
        expandedPlay.setOnClickListener(v -> togglePlayback());
        LinearLayout.LayoutParams playParams = new LinearLayout.LayoutParams(dp(72), dp(72));
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
        add(body, text("Áudio salvo no celular · disponível offline", 12, MUTED, false), 12);
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
        if (expandedCover != null) {
            expandedCover.setImageResource(R.drawable.ic_acervo);
            loadCover(expandedCover, track.thumbnail);
        }
        PlaybackService.update(this, track.title, track.artist, false);
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
        view.setPadding(dp(12), dp(10), dp(12), dp(10));
    }
    private GradientDrawable rounded(int color, int radius) { GradientDrawable value = new GradientDrawable(); value.setColor(color); value.setCornerRadius(dp(radius)); return value; }
    private void add(LinearLayout parent, View child, int top) { LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.topMargin = dp(top); parent.addView(child, params); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void toast(String value) { Toast.makeText(this, value, Toast.LENGTH_LONG).show(); }
}
