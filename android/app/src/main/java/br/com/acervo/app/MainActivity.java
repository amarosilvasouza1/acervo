package br.com.acervo.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
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
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

/** A local companion: the existing Acervo server owns the library and pairing. */
public final class MainActivity extends Activity {
    private static final int SCAN_REQUEST = 20;
    private static final int BG = Color.rgb(18, 18, 18);
    private static final int CARD = Color.rgb(36, 36, 36);
    private static final int GREEN = Color.rgb(30, 215, 96);
    private static final int MUTED = Color.rgb(179, 179, 179);
    private final Handler handler = new Handler(Looper.getMainLooper());
    private SharedPreferences preferences;
    private WebView webView;
    private FrameLayout page;
    private View loading;
    private View connectionError;
    private String selectedOrigin;
    private String retryUrl;
    private boolean failed;
    private Runnable loadTimeout;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        preferences = getSharedPreferences("acervo_connection", MODE_PRIVATE);
        showHome(null);
    }

    private void showHome(String message) {
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
        TextView title = text("acervo mobile", 36, Color.WHITE, true);
        add(body, title, 8);
        TextView intro = text("Sua biblioteca e seus controles, agora no celular.", 17, MUTED, false);
        intro.setLineSpacing(dp(4), 1);
        add(body, intro, 12);

        Button scan = button("Escanear QR code", true);
        scan.setOnClickListener(v -> startActivityForResult(new Intent(this, ScannerActivity.class), SCAN_REQUEST));
        add(body, scan, 30);

        String remembered = preferences.getString("server_origin", null);
        if (remembered != null) {
            try {
                final PairingLink previous = PairingLink.parse(remembered);
                Button reconnect = button("Reconectar ao computador", false);
                reconnect.setOnClickListener(v -> connect(previous));
                add(body, reconnect, 10);
                TextView address = text(previous.origin, 12, MUTED, false);
                address.setGravity(Gravity.CENTER);
                add(body, address, 7);
            } catch (IllegalArgumentException ignored) {
                preferences.edit().remove("server_origin").apply();
            }
        }
        if (message != null) {
            TextView notice = text(message, 14, Color.rgb(255, 186, 150), false);
            notice.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
            add(body, notice, 18);
        }

        add(body, text("OU COLE O LINK DO COMPUTADOR", 10, MUTED, true), 30);
        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setTextSize(14);
        input.setTextColor(Color.WHITE);
        input.setHintTextColor(MUTED);
        input.setHint("http://192.168.1.10:4310/#pair=…");
        input.setContentDescription("Link do Acervo mostrado no computador");
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
        add(steps, text("1  Abra o Acervo no computador.\n2  Entre em Conectar dispositivos.\n3  Gere o QR code e escaneie aqui.", 14, MUTED, false), 12);
        add(body, steps, 28);
        TextView note = text("Use a mesma rede Wi-Fi e mantenha o Acervo aberto no computador. A biblioteca, a fila e os controles são compartilhados. Para tocar neste celular, escolha este aparelho em Dispositivos.", 12, MUTED, false);
        note.setLineSpacing(dp(3), 1);
        add(body, note, 20);
        body.setFocusableInTouchMode(true);
        body.requestFocus();
        setContentView(scroll);
        ScreenInsets.apply(this, scroll);
    }

    private void connect(PairingLink link) {
        selectedOrigin = link.origin;
        retryUrl = link.url;
        // Only the server address is remembered; the one-time QR token is not.
        preferences.edit().putString("server_origin", link.origin).apply();
        createBrowser();
        navigate(link.url);
    }

    private void createBrowser() {
        disposeWebView();
        LinearLayout root = column();
        root.setBackgroundColor(BG);
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(12), 0, dp(8), 0);
        toolbar.setBackgroundColor(BG);
        ImageView mark = new ImageView(this);
        mark.setImageResource(R.drawable.ic_acervo);
        toolbar.addView(mark, new LinearLayout.LayoutParams(dp(34), dp(34)));
        TextView name = text("acervo", 18, Color.WHITE, true);
        toolbar.addView(name, new LinearLayout.LayoutParams(0, -2, 1));
        Button reload = compactButton("Atualizar");
        reload.setOnClickListener(v -> navigate(selectedOrigin + "/"));
        toolbar.addView(reload);
        Button home = compactButton("Conexão");
        home.setOnClickListener(v -> showHome(null));
        toolbar.addView(home);
        root.addView(toolbar, new LinearLayout.LayoutParams(-1, dp(52)));
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
        settings.setUserAgentString(settings.getUserAgentString() + " AcervoAndroid/1.0 Mobile");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        webView.setWebChromeClient(new WebChromeClient());
        webView.setDownloadListener((url, agent, disposition, mimeType, size) -> {
            if (!PairingLink.isSameOrigin(url, selectedOrigin)) return;
            try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
            catch (ActivityNotFoundException ignored) { toast("Nenhum navegador disponível para baixar o arquivo."); }
        });
        webView.setWebViewClient(new WebViewClient() {
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
                    // connect.js consumes and removes #pair; future retries use the cookie.
                    retryUrl = selectedOrigin + "/";
                }
                CookieManager.getInstance().flush();
            }

            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showConnectionError();
            }

            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && response.getStatusCode() >= 400) showConnectionError();
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
        if (PairingLink.isSameOrigin(url, selectedOrigin)) return false;
        Uri target = Uri.parse(url);
        // External links require a user tap and are handed to the user's browser.
        if (userGesture && "https".equalsIgnoreCase(target.getScheme()) && target.getHost() != null
                && target.getUserInfo() == null) {
            try { startActivity(new Intent(Intent.ACTION_VIEW, target)); }
            catch (ActivityNotFoundException ignored) { toast("Nenhum navegador disponível para abrir o link."); }
        } else toast("Abra apenas a conexão do Acervo dentro do app.");
        return true;
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
        add(panel, text("Não foi possível acessar o Acervo no computador. Verifique se ele está ligado, com o Acervo aberto, e se os dois aparelhos usam a mesma rede Wi-Fi.", 16, MUTED, false), 16);
        add(panel, text(selectedOrigin, 12, MUTED, false), 12);
        Button retry = button("Tentar novamente", true);
        retry.setOnClickListener(v -> navigate(retryUrl == null ? selectedOrigin + "/" : retryUrl));
        add(panel, retry, 26);
        Button change = button("Trocar conexão", false);
        change.setOnClickListener(v -> showHome(null));
        add(panel, change, 10);
        connectionError = panel;
        page.addView(panel, new FrameLayout.LayoutParams(-1, -1));
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != SCAN_REQUEST || resultCode != RESULT_OK || data == null) return;
        try { connect(PairingLink.parse(data.getStringExtra("pairing_url"))); }
        catch (IllegalArgumentException error) { showHome(error.getMessage()); }
    }

    @Override public void onBackPressed() {
        if (webView != null && connectionError == null && webView.canGoBack()) webView.goBack();
        else if (selectedOrigin != null) showHome(null);
        else super.onBackPressed();
    }

    @Override protected void onPause() {
        if (webView != null) webView.onPause();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override protected void onDestroy() {
        cancelTimeout();
        disposeWebView();
        super.onDestroy();
    }

    private void disposeWebView() {
        loading = null;
        if (webView == null) return;
        webView.stopLoading();
        if (webView.getParent() instanceof ViewGroup) ((ViewGroup) webView.getParent()).removeView(webView);
        webView.setWebChromeClient(null);
        webView.setWebViewClient(new WebViewClient());
        webView.destroy();
        webView = null;
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

    private Button compactButton(String label) {
        Button view = button(label, false);
        view.setTextSize(11);
        view.setMinWidth(0);
        view.setMinimumWidth(0);
        view.setMinHeight(dp(44));
        view.setMinimumHeight(dp(44));
        view.setPadding(dp(10), 0, dp(10), 0);
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
