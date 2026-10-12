package com.kickz.shoesstore;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.Toast;

/**
 * WebView wrapper around the Shoes Store web app (frontend + CRUD API,
 * both served from the same base URL).
 *
 * The server URL is configurable at runtime via the action-bar menu
 * ("Server URL") and persisted in SharedPreferences, so the APK keeps
 * working when the backend moves (tunnel URL -> permanent host).
 */
public class MainActivity extends Activity {

    /** Default backend. Update after deploying to permanent hosting. */
    private static final String DEFAULT_URL =
            "https://examination-dos-berlin-felt.trycloudflare.com";

    private static final String PREFS = "kickz_prefs";
    private static final String KEY_URL = "server_url";

    private static final int MENU_SERVER_URL = 1;
    private static final int MENU_RELOAD = 2;

    private WebView webView;
    private ProgressBar progressBar;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);

        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setBuiltInZoomControls(false);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String scheme = request.getUrl().getScheme();
                if ("http".equals(scheme) || "https".equals(scheme)) {
                    return false; // stay inside the app
                }
                try {
                    startActivity(new android.content.Intent(
                            android.content.Intent.ACTION_VIEW, request.getUrl()));
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this,
                            "Cannot open link: " + request.getUrl(), Toast.LENGTH_SHORT).show();
                }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                                        WebResourceError error) {
                if (request.isForMainFrame()) {
                    Toast.makeText(MainActivity.this,
                            "Cannot reach server. Check Server URL in the menu.",
                            Toast.LENGTH_LONG).show();
                }
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int progress) {
                progressBar.setProgress(progress);
                progressBar.setVisibility(progress == 100 ? View.GONE : View.VISIBLE);
            }
        });

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(getServerUrl());
        }

        android.widget.FrameLayout root = new android.widget.FrameLayout(this);
        root.addView(webView, new android.widget.FrameLayout.LayoutParams(
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT));
        android.widget.FrameLayout.LayoutParams barParams =
                new android.widget.FrameLayout.LayoutParams(
                        android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                        android.widget.FrameLayout.LayoutParams.WRAP_CONTENT);
        root.addView(progressBar, barParams);
        setContentView(root);
        if (getActionBar() != null) getActionBar().setTitle("Kickz Shoes Store");
    }

    private String getServerUrl() {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String url = prefs.getString(KEY_URL, DEFAULT_URL);
        return normalizeUrl(url);
    }

    private static String normalizeUrl(String url) {
        if (url == null || url.trim().isEmpty()) return DEFAULT_URL;
        url = url.trim();
        if (!url.matches("(?i)^https?://.*")) url = "https://" + url;
        if (url.endsWith("/")) url = url.substring(0, url.length() - 1);
        return url;
    }

    private void showServerUrlDialog() {
        final EditText input = new EditText(this);
        input.setText(getServerUrl());
        input.setHint("https://your-server.com");
        input.setSingleLine(true);
        int pad = (int) (16 * getResources().getDisplayMetrics().density);
        input.setPadding(pad, pad, pad, pad);
        new AlertDialog.Builder(this)
                .setTitle("Server URL")
                .setMessage("Backend hosting the store (frontend + /api).")
                .setView(input)
                .setPositiveButton("Save & Reload", (dialog, which) -> {
                    String url = normalizeUrl(input.getText().toString());
                    try {
                        Uri.parse(url);
                    } catch (Exception e) {
                        Toast.makeText(this, "Invalid URL", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    getSharedPreferences(PREFS, MODE_PRIVATE)
                            .edit().putString(KEY_URL, url).apply();
                    webView.loadUrl(url);
                    Toast.makeText(this, "Server: " + url, Toast.LENGTH_SHORT).show();
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        menu.add(0, MENU_SERVER_URL, 0, "Server URL");
        menu.add(0, MENU_RELOAD, 1, "Reload");
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        int id = item.getItemId();
        if (id == MENU_SERVER_URL) {
            showServerUrlDialog();
            return true;
        } else if (id == MENU_RELOAD) {
            webView.reload();
            return true;
        }
        return super.onOptionsItemSelected(item);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
