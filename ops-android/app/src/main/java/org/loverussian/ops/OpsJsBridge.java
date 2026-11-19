package org.loverussian.ops;

import android.content.Context;
import android.webkit.JavascriptInterface;

/**
 * Native bridge for OPS WebView.
 * Token is NEVER baked into the APK — operator enters it in Settings once
 * (stored in WebView localStorage on the OPS origin only).
 */
public class OpsJsBridge {
    private final String baseUrl;

    public OpsJsBridge(Context context) {
        // API host (console token talks to main site /api)
        this.baseUrl = "https://loverussian.duckdns.org";
    }

    @JavascriptInterface
    public String getBootstrapToken() {
        return "";
    }

    @JavascriptInterface
    public String getBaseUrl() {
        return baseUrl;
    }

    @JavascriptInterface
    public boolean hasBootstrap() {
        return false;
    }
}
