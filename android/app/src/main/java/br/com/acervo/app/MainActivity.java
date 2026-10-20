package br.com.acervo.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.pm.PackageManager;
import android.content.Intent;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.PopupMenu;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.net.HttpURLConnection;
import java.net.URL;

/** Connects to a paired Acervo server, hosted locally or over HTTPS. */
public final class MainActivity extends Activity implements PlaybackService.Controls {
    public static final String EXTRA_SHOW_CONNECTIONS = "br.com.acervo.app.SHOW_CONNECTIONS";
    private static final int SCAN_REQUEST = 20;
    private static final int PLAYLIST_FILE_REQUEST = 21;
    private String playlistDocumentKey;
    private static final int BG = Color.BLACK;
    private static final int CARD = Color.rgb(31, 31, 31);
    private static final int GREEN = Color.rgb(30, 215, 96);
    private static final int MUTED = Color.rgb(179, 179, 179);
    private final Handler handler = new Handler(Looper.getMainLooper());
    private SharedPreferences preferences;
    private WebView webView;
    private SecureWebClient secureClient;
    private FrameLayout page;
    private View loading;
    private View connectionError;
    private volatile String selectedOrigin;
    private String retryUrl;
    private boolean failed;
    private boolean showingConnections;
    private boolean askedNotifications;
    private boolean offlineOpened;
    private long playbackPositionMs;
    private long playbackDurationMs;
    private long playbackPositionAt;
    private boolean playbackPlaying;
    private Bitmap lastCover;
    private String lastCoverUrl;
    private String coverRequest;
    private Runnable loadTimeout;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        preferences = getSharedPreferences("acervo_connection", MODE_PRIVATE);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 91);
        }
        if (getIntent().getBooleanExtra(EXTRA_SHOW_CONNECTIONS, false)) showConnections(null);
        else openPreferred();
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent.getBooleanExtra(EXTRA_SHOW_CONNECTIONS, false)) showConnections(null);
    }

    public static void rememberPhoneMode(Context context) {
        context.getSharedPreferences("acervo_connection", MODE_PRIVATE).edit()
                .putString("entry_mode", AppEntryPolicy.MODE_PHONE).apply();
    }

    private void openPhone(boolean remember) {
        if (remember) rememberPhoneMode(this);
        startActivity(new Intent(this, StandaloneActivity.class));
        finish();
    }

    private void openPreferred() {
        String remembered = preferences.getString("server_origin", null);
        AppEntryPolicy.Destination destination = AppEntryPolicy.destination(
                preferences.getString("entry_mode", null), remembered != null, false);
        if (destination == AppEntryPolicy.Destination.SERVER) {
            try {
                PairingLink link = PairingLink.parse(remembered);
                if (!link.url.equals(link.origin + "/")) throw new IllegalArgumentException("Endereço salvo inválido.");
                connect(link);
                return;
            } catch (IllegalArgumentException ignored) {
                preferences.edit().remove("server_origin").remove("entry_mode").apply();
            }
        }
        openPhone(false);
    }

    private void showConnections(String message) {
        showingConnections = true;
        cancelTimeout();
        disposeWebView();
        selectedOrigin = null;
        retryUrl = null;
        connectionError = null;
        page = null;
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(BG);
        LinearLayout body = column();
        body.setPadding(dp(28), dp(32), dp(28), dp(28));
        scroll.addView(body, new ScrollView.LayoutParams(-1, -2));

        ImageView mark = new ImageView(this);
        mark.setImageResource(R.drawable.ic_acervo);
        mark.setContentDescription("Acervo");
        LinearLayout.LayoutParams markParams = new LinearLayout.LayoutParams(dp(100), dp(100));
        markParams.bottomMargin = dp(24);
        body.addView(mark, markParams);
        body.addView(text("SUA MÚSICA, EM QUALQUER TELA", 10, GREEN, true));
        TextView title = text("Suas conexões", 36, Color.WHITE, true);
        add(body, title, 8);
        TextView intro = text("Busque, baixe e ouça suas músicas direto no celular.", 17, MUTED, false);
        intro.setLineSpacing(dp(4), 1);
        add(body, intro, 12);

        Button back = button("Voltar ao início", false);
        back.setOnClickListener(v -> openPreferred());
        add(body, back, 22);

        Button independent = button("Usar neste celular", true);
        independent.setOnClickListener(v -> openPhone(true));
        add(body, independent, 12);
        add(body, text("Funciona com a internet do celular, mesmo com o computador desligado. Downloads ficam disponíveis sem conexão.", 13, MUTED, false), 10);

        Button update = button("Atualizar aplicativo", false);
        update.setOnClickListener(v -> AppUpdater.check(this, preferences.getString("server_origin", null)));
        add(body, update, 14);

        Button licenses = button("Sobre e licenças", false);
        licenses.setOnClickListener(v -> AppLicenses.show(this));
        add(body, licenses, 8);

        add(body, text("CONECTAR A OUTRO ACERVO", 10, MUTED, true), 30);
        Button scan = button("Escanear QR code", false);
        scan.setOnClickListener(v -> startActivityForResult(new Intent(this, ScannerActivity.class), SCAN_REQUEST));
        add(body, scan, 12);

        String remembered = preferences.getString("server_origin", null);
        if (remembered != null) {
            try {
                final PairingLink previous = PairingLink.parse(remembered);
                Button reconnect = button("Reconectar ao Acervo", false);
                reconnect.setOnClickListener(v -> connect(previous));
                add(body, reconnect, 10);
                TextView address = text(previous.origin, 12, MUTED, false);
                address.setGravity(Gravity.CENTER);
                add(body, address, 7);
                Button protection = button("Verificar conexão", false);
                protection.setOnClickListener(v -> showSecurity(previous.origin));
                add(body, protection, 10);
            } catch (IllegalArgumentException ignored) {
                preferences.edit().remove("server_origin").apply();
            }
        }
        if (message != null) {
            TextView notice = text(message, 14, Color.rgb(255, 186, 150), false);
            notice.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
            add(body, notice, 18);
        }

        add(body, text("OU COLE O LINK DO SEU ACERVO", 10, MUTED, true), 30);
        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setTextSize(14);
        input.setTextColor(Color.WHITE);
        input.setHintTextColor(MUTED);
        input.setHint("https://seu-acervo.exemplo.com/#pair=…");
        input.setContentDescription("Link HTTPS do Acervo ou QR code com a identidade do computador");
        input.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        input.setBackground(rounded(CARD, 12));
        input.setPadding(dp(16), dp(15), dp(16), dp(15));
        input.setSaveEnabled(false); // Never persist a short-lived pairing code in view state.
        add(body, input, 12);
        Button manual = button("Conectar pelo link", false);
        manual.setOnClickListener(v -> {
            try {
                PairingLink link = PairingLink.parse(input.getText().toString());
                InputMethodManager keyboard = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
                if (keyboard != null) keyboard.hideSoftInputFromWindow(input.getWindowToken(), 0);
                connect(link);
            } catch (IllegalArgumentException error) {
                input.setError(error.getMessage());
            }
        });
        add(body, manual, 10);

        LinearLayout steps = column();
        steps.setPadding(dp(18), dp(18), dp(18), dp(18));
        steps.setBackground(rounded(Color.rgb(27, 27, 27), 16));
        steps.addView(text("Conecte em poucos segundos", 16, Color.WHITE, true));
        add(steps, text("1  Abra seu Acervo no navegador.\n2  Entre em Conectar dispositivos.\n3  Gere o QR code e escaneie aqui.", 14, MUTED, false), 12);
        add(body, steps, 28);
        TextView note = text("O QR code confirma a identidade do computador e o celular cria sua própria chave privada no Android Keystore. O pareamento autoriza apenas este telefone no Acervo do PC. Para sincronizar em outra rede, o PC precisa estar ligado e ter um endereço acessível pela internet. As músicas salvas neste celular continuam independentes.", 12, MUTED, false);
        note.setLineSpacing(dp(3), 1);
        add(body, note, 20);
        body.setFocusableInTouchMode(true);
        body.requestFocus();
        setContentView(scroll);
        ScreenInsets.apply(this, scroll);
    }

    private void connect(PairingLink link) {
        try {
            if (!link.origin.startsWith("https://")) throw new IllegalArgumentException("Esta versão exige uma conexão criptografada. Atualize o Acervo no PC e escaneie o novo QR code HTTPS.");
            SecureTransport.trust(this, link);
        } catch (Exception failure) {
            showConnections(failure.getMessage());
            return;
        }
        selectedOrigin = link.origin;
        retryUrl = link.url;
        showingConnections = false;
        createBrowser();
        navigate(link.url);
    }

    private void showSecurity(String origin) {
        if (origin == null || isFinishing()) return;
        String pin = SecureTransport.getPin(this, origin);
        LinearLayout body = column();
        body.setPadding(dp(24), dp(12), dp(24), dp(8));
        add(body, text(origin, 12, MUTED, false), 4);
        String description = pin == null || pin.isEmpty()
                ? "Esta conexão HTTPS verifica o certificado do servidor pelo sistema Android."
                : "O QR confirmou a chave do computador. Este celular possui outra chave privada, protegida no Android Keystore. Após o pareamento, o Acervo do PC exige a identidade deste telefone para liberar o acesso. Confira os dois códigos em Conectar dispositivos no PC.";
        add(body, text(description, 14, Color.WHITE, false), 14);
        if (pin != null && !pin.isEmpty()) {
            add(body, text("COMPUTADOR · SHA-256 DA CHAVE PÚBLICA", 10, MUTED, true), 18);
            TextView code = text(pin.toUpperCase(java.util.Locale.ROOT).replaceAll("(.{8})(?!$)", "$1 "), 14, GREEN, false);
            code.setTypeface(Typeface.MONOSPACE);
            code.setTextIsSelectable(true);
            add(body, code, 8);
            add(body, text("ESTE TELEFONE · SHA-256 DA CHAVE PÚBLICA", 10, MUTED, true), 18);
            try {
                String phonePin = PhoneIdentity.getFingerprint(this, origin);
                if (phonePin == null) add(body, text("Identidade do telefone ausente. Atualize o PC, remova esta conexão e escaneie um novo QR code.", 13, MUTED, false), 8);
                else {
                    TextView phone = text(phonePin.toUpperCase(java.util.Locale.ROOT).replaceAll("(.{8})(?!$)", "$1 "), 14, GREEN, false);
                    phone.setTypeface(Typeface.MONOSPACE);
                    phone.setTextIsSelectable(true);
                    add(body, phone, 8);
                }
            } catch (IOException failure) {
                add(body, text("A identidade do telefone não está disponível. Remova esta conexão e faça um novo pareamento.", 13, MUTED, false), 8);
            }
        }
        add(body, text("A proteção usa TLS entre este celular e o Acervo conectado. Não é o protocolo de mensagens do WhatsApp. As músicas offline continuam na área privada deste aplicativo.", 12, MUTED, false), 18);
        ScrollView details = new ScrollView(this);
        details.addView(body);
        new AlertDialog.Builder(this).setTitle("Proteção da conexão").setView(details)
                .setPositiveButton("Conferido", null)
                .setNeutralButton("Desparear", (dialog, which) -> new AlertDialog.Builder(this)
                        .setTitle("Remover esta conexão?")
                        .setMessage("O endereço e o vínculo de identidade serão removidos. A chave privada é apagada quando nenhum outro endereço deste mesmo PC a utiliza. Suas músicas offline continuam salvas. Para revogar o acesso também no PC, remova este celular em Dispositivos.")
                        .setNegativeButton("Cancelar", null)
                        .setPositiveButton("Desparear", (confirm, ignored) -> {
                            try { SecureTransport.forget(this, origin); }
                            catch (IOException failure) { toast("Não foi possível remover a identidade com segurança. Tente novamente."); return; }
                            CookieManager.getInstance().setCookie(origin + "/", "acervo_connect=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict");
                            CookieManager.getInstance().flush();
                            preferences.edit().remove("server_origin").putString("entry_mode", AppEntryPolicy.MODE_PHONE).apply();
                            showConnections("Conexão removida. Escaneie um novo QR code para parear novamente.");
                        }).show()).show();
    }

    private void createBrowser() {
        disposeWebView();
        PlaybackService.attach(this);
        LinearLayout root = column();
        root.setBackgroundColor(BG);
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(16), dp(8), dp(8), dp(8));
        toolbar.setBackgroundColor(BG);
        ImageView mark = new ImageView(this);
        mark.setImageResource(R.drawable.ic_acervo);
        toolbar.addView(mark, new LinearLayout.LayoutParams(dp(28), dp(28)));
        TextView name = text("acervo", 23, Color.WHITE, true);
        name.setPadding(dp(8), 0, 0, 0);
        toolbar.addView(name, new LinearLayout.LayoutParams(0, -2, 1));
        Button update = toolbarButton("update", "Atualizar aplicativo");
        update.setOnClickListener(v -> AppUpdater.check(this, selectedOrigin));
        toolbar.addView(update);
        Button home = toolbarButton("connect", "Conexões com o computador");
        home.setOnClickListener(v -> showConnections(null));
        toolbar.addView(home);
        Button more = toolbarButton("more", "Mais opções do Acervo");
        more.setOnClickListener(v -> showBrowserOptions(more));
        toolbar.addView(more);
        root.addView(toolbar, new LinearLayout.LayoutParams(-1, -2));
        page = new FrameLayout(this);
        root.addView(page, new LinearLayout.LayoutParams(-1, 0, 1));
        webView = new WebView(this);
        webView.setBackgroundColor(BG);
        webView.setSaveEnabled(false);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUserAgentString(settings.getUserAgentString() + " AcervoAndroid/1.5.9 Mobile");
        webView.addJavascriptInterface(new Bridge(), "AcervoAndroid");
        secureClient = new SecureWebClient(webView, this, selectedOrigin);
        final SecureWebClient transport = secureClient;
        transport.attach();
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        webView.setWebChromeClient(new WebChromeClient());
        webView.setDownloadListener((url, agent, disposition, mimeType, size) -> {
            if (!PairingLink.isSameOrigin(url, selectedOrigin)) return;
            if ("/downloads/acervo.apk".equals(Uri.parse(url).getPath())) AppUpdater.check(this, selectedOrigin);
            else toast("Use Salvar no celular para guardar uma música na biblioteca offline.");
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return transport.intercept(request);
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // A cross-origin iframe cannot become an app navigation target.
                if (!request.isForMainFrame()) return !PairingLink.isSameOrigin(request.getUrl().toString(), selectedOrigin);
                return handleNavigation(request.getUrl().toString(), request.hasGesture());
            }

            @SuppressWarnings("deprecation")
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleNavigation(url, true);
            }

            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                if (PairingLink.isSameOrigin(url, selectedOrigin)) beginLoading();
            }

            @Override public void onPageFinished(WebView view, String url) {
                if (view != webView || !PairingLink.isSameOrigin(url, selectedOrigin)) return;
                cancelTimeout();
                if (!failed) {
                    removeLoading();
                }
                CookieManager.getInstance().flush();
            }

            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showConnectionError();
            }

            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && response.getStatusCode() >= 400) showConnectionError();
            }

            @Override public void onReceivedSslError(WebView view, android.webkit.SslErrorHandler handler, android.net.http.SslError error) {
                handler.cancel();
                showConnectionError();
            }

            @Override public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                if (view == webView) {
                    page.removeView(view);
                    webView = null;
                    view.destroy();
                    showConnectionError();
                }
                return true;
            }
        });
        page.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        ScreenInsets.apply(this, root);
    }

    private boolean handleNavigation(String url, boolean userGesture) {
        if (PairingLink.isSameOrigin(url, selectedOrigin)) {
            return false;
        }
        Uri target = Uri.parse(url);
        // External links require a user tap and are handed to the user's browser.
        if (userGesture && "https".equalsIgnoreCase(target.getScheme()) && target.getHost() != null
                && target.getUserInfo() == null) {
            try { startActivity(new Intent(Intent.ACTION_VIEW, target)); }
            catch (ActivityNotFoundException ignored) { toast("Nenhum navegador disponível para abrir o link."); }
        } else toast("Abra apenas a conexão do Acervo dentro do app.");
        return true;
    }

    private void showBrowserOptions(View anchor) {
        PopupMenu menu = new PopupMenu(this, anchor);
        menu.getMenu().add(0, 1, 0, "Recarregar Acervo");
        menu.getMenu().add(0, 2, 1, "Sincronizar músicas com o celular");
        menu.getMenu().add(0, 3, 2, "Verificar proteção da conexão");
        menu.getMenu().add(0, 4, 3, "Ouvir músicas neste celular");
        menu.setOnMenuItemClickListener(item -> {
            if (selectedOrigin == null) return false;
            switch (item.getItemId()) {
                case 1: navigate(selectedOrigin + "/"); break;
                case 2: DeviceSync.sync(this, selectedOrigin); break;
                case 3: showSecurity(selectedOrigin); break;
                case 4: openPhone(true); break;
                default: return false;
            }
            return true;
        });
        menu.show();
    }

    private void navigate(String url) {
        if (selectedOrigin == null) return;
        if (webView == null) createBrowser();
        if (connectionError != null) {
            page.removeView(connectionError);
            connectionError = null;
        }
        retryUrl = url;
        failed = false;
        webView.setVisibility(View.VISIBLE);
        beginLoading();
        if (secureClient != null) secureClient.newDocument();
        webView.loadUrl(url);
    }

    private void beginLoading() {
        cancelTimeout();
        failed = false;
        if (loading == null && page != null) {
            LinearLayout overlay = column();
            overlay.setGravity(Gravity.CENTER);
            overlay.setBackgroundColor(BG);
            ProgressBar spinner = new ProgressBar(this);
            spinner.setIndeterminateTintList(android.content.res.ColorStateList.valueOf(GREEN));
            overlay.addView(spinner, new LinearLayout.LayoutParams(dp(36), dp(36)));
            add(overlay, text("Conectando ao seu Acervo…", 16, Color.WHITE, false), 20);
            loading = overlay;
            page.addView(loading, new FrameLayout.LayoutParams(-1, -1));
        }
        loadTimeout = () -> { if (webView != null) webView.stopLoading(); showConnectionError(); };
        handler.postDelayed(loadTimeout, 18000);
    }

    private void removeLoading() {
        if (loading != null && page != null) page.removeView(loading);
        loading = null;
    }

    private void showConnectionError() {
        if (page == null || selectedOrigin == null || isFinishing()) return;
        failed = true;
        cancelTimeout();
        removeLoading();
        if (webView != null) webView.setVisibility(View.GONE);
        if (connectionError != null) return;
        LinearLayout panel = column();
        panel.setGravity(Gravity.CENTER_VERTICAL);
        panel.setPadding(dp(28), dp(24), dp(28), dp(24));
        panel.setBackgroundColor(BG);
        panel.addView(text("Vamos reconectar", 30, Color.WHITE, true));
        String detail = secureClient == null ? null : secureClient.getFailureMessage();
        String help = detail != null ? detail : SecureTransport.hasPin(this, selectedOrigin)
                ? "Confira se o PC está ligado com o Acervo aberto e se a conexão pela internet está verificada em Dispositivos. Gere um novo QR e escaneie pelo APK atualizado."
                : selectedOrigin.startsWith("https://")
                ? "Não foi possível acessar seu Acervo. Confira a internet do celular, o endereço e se o servidor está disponível. Se este for um endereço da nuvem, o computador pode ficar desligado."
                : "Não foi possível acessar o Acervo na rede local. Confira se o computador está ligado, com o Acervo aberto, e se os aparelhos usam a mesma rede. Para usar de outras redes com o computador desligado, conecte a uma instalação do Acervo na nuvem por HTTPS.";
        add(panel, text(help, 16, MUTED, false), 16);
        add(panel, text(selectedOrigin, 12, MUTED, false), 12);
        Button retry = button("Tentar novamente", true);
        retry.setOnClickListener(v -> navigate(retryUrl == null ? selectedOrigin + "/" : retryUrl));
        add(panel, retry, 26);
        Button change = button("Trocar conexão", false);
        change.setOnClickListener(v -> showConnections(null));
        add(panel, change, 10);
        Button offline = button("Ouvir músicas salvas no celular", true);
        offline.setOnClickListener(v -> openPhone(true));
        add(panel, offline, 10);
        connectionError = panel;
        page.addView(panel, new FrameLayout.LayoutParams(-1, -1));
        if (!offlineOpened && preferences.getBoolean("offline_fallback", false)) {
            offlineOpened = true;
            toast("Conexão indisponível. Abrindo as músicas salvas no celular.");
            openPhone(false);
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PLAYLIST_FILE_REQUEST) {
            final String key = playlistDocumentKey;
            playlistDocumentKey = null;
            final Uri uri = data == null ? null : data.getData();
            if (resultCode != RESULT_OK || uri == null || !"content".equals(uri.getScheme())) {
                deliverPlaylistFile(key, null, "Seleção de arquivo cancelada."); return;
            }
            new Thread(() -> {
                try (InputStream input = getContentResolver().openInputStream(uri)) {
                    if (input == null) throw new IOException("Não foi possível abrir o arquivo.");
                    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                    byte[] buffer = new byte[16384]; int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (bytes.size() + count > 1500000) throw new IOException("Use um arquivo de até 1,5 MB.");
                        bytes.write(buffer, 0, count);
                    }
                    deliverPlaylistFile(key, new String(bytes.toByteArray(), StandardCharsets.UTF_8), null);
                } catch (Exception failure) { deliverPlaylistFile(key, null, "Não foi possível ler o arquivo. Use CSV/JSON de até 1,5 MB."); }
            }, "AcervoPlaylistFile").start();
            return;
        }
        if (requestCode != SCAN_REQUEST || resultCode != RESULT_OK || data == null) return;
        try { connect(PairingLink.parse(data.getStringExtra("pairing_url"))); }
        catch (IllegalArgumentException error) { showConnections(error.getMessage()); }
    }

    @Override public void onBackPressed() {
        if (webView != null && connectionError == null && webView.canGoBack()) {
            webView.goBack();
        }
        else if (showingConnections) openPreferred();
        else super.onBackPressed();
    }

    @Override protected void onPause() {
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override protected void onResume() {
        super.onResume();
        if (!isFinishing() && webView != null) PlaybackService.attach(this);
        if (webView != null) webView.onResume();
    }

    @Override protected void onDestroy() {
        PlaybackService.detach(this);
        PlaybackService.hide(this);
        cancelTimeout();
        disposeWebView();
        super.onDestroy();
    }

    @Override public void onToggle() { js("AC.toggle()"); }
    @Override public void onNext() { js("AC.next(false)"); }
    @Override public void onPrevious() { js("AC.prev()"); }
    @Override public void onClose() { js("if (AC.state.playing) AC.toggle();"); }
    @Override public Class<?> playerActivity() { return MainActivity.class; }
    @Override public long positionMs() {
        long value = playbackPositionMs;
        if (playbackPlaying) value += Math.max(0, SystemClock.elapsedRealtime() - playbackPositionAt);
        return playbackDurationMs > 0 ? Math.min(value, playbackDurationMs) : value;
    }
    @Override public long durationMs() { return playbackDurationMs; }
    @Override public void onSeek(long position) {
        double ratio = playbackDurationMs > 0 ? (double) Math.max(0, Math.min(position, playbackDurationMs)) / playbackDurationMs : 0;
        js("AC.seekRatio(" + ratio + ")");
    }

    private Bitmap fetchCover(String path) {
        try {
            String target = path.startsWith("http") ? path : selectedOrigin + path;
            String cookie = CookieManager.getInstance().getCookie(selectedOrigin);
            HttpURLConnection connection = SecureTransport.open(this, target, selectedOrigin);
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(15000);
            if (cookie != null && !cookie.isEmpty()) connection.setRequestProperty("Cookie", cookie);
            if (connection.getResponseCode() != 200) return null;
            try (InputStream input = connection.getInputStream()) {
                return ArtworkCrop.trim(BitmapFactory.decodeStream(input));
            } finally {
                connection.disconnect();
            }
        } catch (Exception ignored) {
            return null;
        }
    }

    private boolean saveOne(String origin, String id, String title, String artist, int duration) throws Exception {
        if (id == null || id.isEmpty()) return false;
        MobileLibrary library = new MobileLibrary(this);
        if (library.get(id) != null) return false;
        if (origin == null) throw new IOException("Conecte-se ao Acervo antes de salvar.");
        String cookie = CookieManager.getInstance().getCookie(origin);
        HttpURLConnection connection = SecureTransport.open(this, origin + "/api/stream/" + id, origin);
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(120000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Accept", "audio/mpeg,audio/*");
        if (cookie != null && !cookie.isEmpty()) connection.setRequestProperty("Cookie", cookie);
        int status = connection.getResponseCode();
        if (status != 200) throw new IOException("O servidor respondeu " + status + ". Reabra a conexão e tente novamente.");
        long expected = connection.getContentLengthLong();
        if (expected > 250L * 1024 * 1024) throw new IOException("Arquivo maior que o limite de 250 MB.");
        File temp = File.createTempFile("acervo-offline-", ".mp3", getCacheDir());
        try {
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(temp)) {
                byte[] buffer = new byte[32 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                output.getFD().sync();
            }
            String artworkUrl = origin + "/api/cover/" + id;
            library.importFile(id, title, artist, duration, artworkUrl, temp);
            saveArtwork(origin, artworkUrl, cookie);
            return true;
        } finally {
            connection.disconnect();
            temp.delete();
        }
    }

    private void saveArtwork(String origin, String url, String cookie) {
        HttpURLConnection connection = null;
        try {
            connection = SecureTransport.open(this, url, origin);
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(15000);
            if (cookie != null && !cookie.isEmpty()) connection.setRequestProperty("Cookie", cookie);
            if (connection.getResponseCode() != 200) return;
            try (InputStream input = connection.getInputStream()) {
                MobileArtworkCache.store(getFilesDir(), url, input);
            }
        } catch (IOException ignored) {
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void toastUi(String message) {
        runOnUiThread(() -> Toast.makeText(this, message, Toast.LENGTH_LONG).show());
    }

    private void js(String code) {
        runOnUiThread(() -> {
            if (webView != null) webView.evaluateJavascript(code, null);
        });
    }

    private final class Bridge {
        @JavascriptInterface public void choosePlaylistFile(final String documentKey) {
            runOnUiThread(() -> {
                if (webView == null || secureClient == null || !secureClient.isActiveDocument(documentKey)
                        || !PairingLink.isSameOrigin(webView.getUrl(), selectedOrigin)) return;
                if (playlistDocumentKey != null) { deliverPlaylistFile(documentKey, null, "Já há uma seleção de arquivo aberta."); return; }
                playlistDocumentKey = documentKey;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE)
                        .putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "text/csv", "text/comma-separated-values", "application/json", "text/plain", "application/octet-stream" })
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try { startActivityForResult(intent, PLAYLIST_FILE_REQUEST); }
                catch (ActivityNotFoundException failure) { playlistDocumentKey = null; deliverPlaylistFile(documentKey, null, "Nenhum seletor de arquivos disponível."); }
            });
        }
        @JavascriptInterface public void connectedConfirmed(final String origin, final String documentKey) {
            runOnUiThread(() -> {
                if (webView == null || secureClient == null || !secureClient.isActiveDocument(documentKey)
                        || selectedOrigin == null || !selectedOrigin.equals(origin)
                        || !PairingLink.isSameOrigin(webView.getUrl(), selectedOrigin)) return;
                preferences.edit().putString("server_origin", selectedOrigin)
                        .putString("entry_mode", AppEntryPolicy.MODE_SERVER).apply();
                retryUrl = selectedOrigin + "/";
            });
        }

        @JavascriptInterface public void saveOffline(final String id, final String title, final String artist, final int duration) {
            final String origin = selectedOrigin;
            new Thread(() -> {
                try {
                    boolean saved = saveOne(origin, id, title, artist, duration);
                    if (saved) toastUi("Salva no celular. Abra Ouvir offline para tocar sem o PC.");
                } catch (Exception failure) {
                    toastUi("Não foi possível salvar: " + failure.getMessage());
                }
            }).start();
        }

        @JavascriptInterface public void saveAllOffline(final String json) {
            final String origin = selectedOrigin;
            new Thread(() -> {
                int saved = 0;
                try {
                    JSONArray list = new JSONArray(json);
                    for (int i = 0; i < list.length(); i++) {
                        JSONObject item = list.getJSONObject(i);
                        if (saveOne(origin, item.optString("id"), item.optString("title"), item.optString("artist"), item.optInt("duration"))) saved++;
                    }
                    toastUi(saved > 0 ? saved + " música(s) salva(s) no celular." : "As músicas já estavam salvas.");
                } catch (Exception failure) {
                    toastUi("Não foi possível salvar: " + failure.getMessage());
                }
            }).start();
        }

        @JavascriptInterface public void openOffline() {
            runOnUiThread(() -> openPhone(true));
        }

        @JavascriptInterface public void setOfflineFallback(boolean value) {
            preferences.edit().putBoolean("offline_fallback", value).apply();
        }

        @JavascriptInterface public void nowPlaying(String title, String artist, boolean playing) {
            nowPlaying(title, artist, playing, null);
        }

        @JavascriptInterface public void playbackProgress(int positionMs, int durationMs, boolean playing) {
            playbackPositionMs = Math.max(0, positionMs);
            playbackDurationMs = Math.max(0, durationMs);
            playbackPlaying = playing;
            playbackPositionAt = SystemClock.elapsedRealtime();
            PlaybackService.progress(playbackPositionMs, playbackDurationMs);
        }

        @JavascriptInterface public void nowPlaying(final String title, final String artist, final boolean playing, final String coverUrl) {
            runOnUiThread(() -> {
                if (playing && !askedNotifications && Build.VERSION.SDK_INT >= 33
                        && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    askedNotifications = true;
                    requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 91);
                }
                if (coverUrl == null || coverUrl.isEmpty()) {
                    PlaybackService.update(MainActivity.this, title, artist, playing, null, positionMs(), durationMs());
                    return;
                }
                if (coverUrl.equals(lastCoverUrl) && lastCover != null) {
                    PlaybackService.update(MainActivity.this, title, artist, playing, lastCover, positionMs(), durationMs());
                    return;
                }
                PlaybackService.update(MainActivity.this, title, artist, playing, lastCover, positionMs(), durationMs());
                coverRequest = coverUrl;
                new Thread(() -> {
                    Bitmap loaded = fetchCover(coverUrl);
                    runOnUiThread(() -> {
                        if (!coverUrl.equals(coverRequest)) return;
                        lastCoverUrl = coverUrl;
                        lastCover = loaded;
                        PlaybackService.update(MainActivity.this, title, artist, playing, loaded, positionMs(), durationMs());
                    });
                }).start();
            });
        }
    }

    private void disposeWebView() {
        loading = null;
        playlistDocumentKey = null;
        if (secureClient != null) { secureClient.dispose(); secureClient = null; }
        if (webView == null) return;
        webView.stopLoading();
        if (webView.getParent() instanceof ViewGroup) ((ViewGroup) webView.getParent()).removeView(webView);
        webView.setWebChromeClient(null);
        webView.setWebViewClient(new WebViewClient());
        webView.destroy();
        webView = null;
    }

    private void deliverPlaylistFile(String key, String text, String error) {
        runOnUiThread(() -> {
            if (webView == null || secureClient == null || !secureClient.isActiveDocument(key)
                    || !PairingLink.isSameOrigin(webView.getUrl(), selectedOrigin)) return;
            try {
                JSONObject result = new JSONObject().put("key", key);
                if (error != null) result.put("error", error); else result.put("text", text);
                webView.evaluateJavascript("window.__acervoPlaylistFile && window.__acervoPlaylistFile(" + result.toString() + ");", null);
            } catch (Exception ignored) { }
        });
    }

    private void cancelTimeout() {
        if (loadTimeout != null) handler.removeCallbacks(loadTimeout);
        loadTimeout = null;
    }

    private LinearLayout column() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        return layout;
    }

    private TextView text(String value, int size, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return view;
    }

    private Button button(String label, boolean primary) {
        Button view = new Button(this);
        view.setText(label);
        view.setTextColor(primary ? BG : Color.WHITE);
        view.setTextSize(15);
        view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        view.setAllCaps(false);
        view.setBackground(rounded(primary ? GREEN : CARD, 28));
        view.setPadding(dp(16), dp(12), dp(16), dp(12));
        view.setMinHeight(dp(54));
        return view;
    }

    private Button toolbarButton(String icon, String description) {
        Button view = button("", false);
        view.setContentDescription(description);
        view.setMinWidth(0);
        view.setMinimumWidth(0);
        view.setMinHeight(dp(44));
        view.setMinimumHeight(dp(44));
        view.setPadding(dp(12), dp(10), dp(12), dp(10));
        AcervoIcon drawable = new AcervoIcon(icon, Color.WHITE);
        drawable.setBounds(0, 0, dp(24), dp(24));
        view.setCompoundDrawables(drawable, null, null, null);
        view.setGravity(Gravity.CENTER);
        view.setBackgroundColor(Color.TRANSPARENT);
        return view;
    }

    private GradientDrawable rounded(int color, int radius) {
        GradientDrawable background = new GradientDrawable();
        background.setColor(color);
        background.setCornerRadius(dp(radius));
        return background;
    }

    private void add(LinearLayout parent, View child, int marginTop) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.topMargin = dp(marginTop);
        parent.addView(child, params);
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void toast(String message) { Toast.makeText(this, message, Toast.LENGTH_LONG).show(); }
}
