package br.com.acervo.app;

import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

/** A document-scoped transport for the shared Acervo web interface. */
public interface WebTransport {
    void attach();
    void newDocument();
    String getFailureMessage();
    boolean isActiveDocument(String key);
    void dispose();
    WebResourceResponse intercept(WebResourceRequest request);
}
