package com.lavidhawa.pos;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.OutputStream;
import java.nio.charset.Charset;

/**
 * A single full-screen WebView hosting the offline billing system that ships
 * inside the APK under assets/www.
 *
 * The wrapper only exists to give the web app the three things a plain WebView
 * cannot do on its own:
 *
 *   1. print a bill through Android's print service,
 *   2. save a backup or CSV through the system file picker,
 *   3. pick a backup file to restore.
 *
 * Everything else — the billing, the data, the storage — is the web app's, and
 * every byte of it stays in this app's private storage on this tablet.
 */
public class MainActivity extends Activity {

    private static final String INDEX_URL = "file:///android_asset/www/index.html";
    private static final int REQ_SAVE_FILE = 4101;
    private static final int REQ_PICK_FILE = 4102;
    private static final long EXIT_WINDOW_MS = 2200L;

    private WebView web;

    /** Held while Android's print service works through the document. */
    private WebView printView;

    /** Set between asking for a save location and being handed one. */
    private String pendingContent;

    /** Set between the web app opening a file picker and the pick coming back. */
    private ValueCallback<Uri[]> pendingFilePick;

    private long lastBackPress;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // A billing counter should never dim mid-order.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        web.setBackgroundColor(0xFFF4F6FA);
        setContentView(web);

        configure(web.getSettings());
        web.setWebViewClient(new AppWebViewClient());
        web.setWebChromeClient(new AppChromeClient());
        web.addJavascriptInterface(new Bridge(), "LaviNative");
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setLongClickable(false);

        if (savedInstanceState == null) {
            web.loadUrl(INDEX_URL);
        } else {
            web.restoreState(savedInstanceState);
        }
    }

    private void configure(WebSettings s) {
        s.setJavaScriptEnabled(true);

        // The two settings the local database depends on.
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);

        // Reading the app's own assets, and nothing beyond them.
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);

        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(false);
        s.setTextZoom(100);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSupportMultipleWindows(false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1) {
            s.setAllowFileAccessFromFileURLs(true);
            s.setAllowUniversalAccessFromFileURLs(true);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    /* ------------------------------------------------------ navigation */

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web != null) {
            if (web.canGoBack()) {
                web.goBack();
                return true;
            }
            long now = System.currentTimeMillis();
            if (now - lastBackPress < EXIT_WINDOW_MS) {
                finish();
                return true;
            }
            lastBackPress = now;
            toast(getString(R.string.exit_hint));
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    private class AppWebViewClient extends WebViewClient {
        // Anything that is not the packaged app is handed to Android.
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return openExternally(request.getUrl());
        }

        @Override
        @SuppressWarnings("deprecation")
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return openExternally(Uri.parse(url));
        }
    }

    private boolean openExternally(Uri uri) {
        if (uri == null) return false;
        String scheme = uri.getScheme();
        if (scheme == null || "file".equals(scheme)) return false;   // our own pages
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ignored) {
            // Nothing on the tablet handles it; staying put is the right answer.
        }
        return true;
    }

    private class AppChromeClient extends WebChromeClient {
        // Restoring a backup opens a file input in the web app.
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                         FileChooserParams params) {
            if (pendingFilePick != null) pendingFilePick.onReceiveValue(null);
            pendingFilePick = callback;
            try {
                startActivityForResult(params.createIntent(), REQ_PICK_FILE);
                return true;
            } catch (Exception e) {
                pendingFilePick = null;
                toast(getString(R.string.no_saver));
                return false;
            }
        }

        @Override
        public boolean onConsoleMessage(ConsoleMessage message) {
            return true;   // keep the app's own console quiet in logcat
        }
    }

    /* ------------------------------------------------- the JS bridge */

    /**
     * Exposed to the web app as {@code window.LaviNative}. Every method is
     * called from the WebView's JavaScript thread, so each one hops back to the
     * UI thread before touching anything.
     */
    public class Bridge {

        @JavascriptInterface
        public String platform() {
            return "android";
        }

        @JavascriptInterface
        public void printHtml(final String title, final String html) {
            runOnUiThread(new Runnable() {
                @Override public void run() { print(title, html); }
            });
        }

        @JavascriptInterface
        public void saveFile(final String filename, final String mime, final String content) {
            runOnUiThread(new Runnable() {
                @Override public void run() { askWhereToSave(filename, mime, content); }
            });
        }

        @JavascriptInterface
        public void toastMessage(final String message) {
            runOnUiThread(new Runnable() {
                @Override public void run() { toast(message); }
            });
        }
    }

    /* ---------------------------------------------------------- print */

    /**
     * Renders the bill HTML in a throwaway WebView and hands it to the system
     * print service, which covers Bluetooth, USB and Wi-Fi printers as well as
     * "save as PDF".
     */
    private void print(final String title, String html) {
        final String jobName = getString(R.string.app_name) + " — " + (title == null ? "Bill" : title);

        final WebView renderer = new WebView(this);
        renderer.getSettings().setJavaScriptEnabled(false);
        renderer.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                PrintManager manager = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                if (manager == null) {
                    toast("Printing is not available on this tablet");
                    return;
                }
                PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(jobName);
                manager.print(jobName, adapter, new PrintAttributes.Builder().build());
            }
        });

        // The adapter keeps working after this method returns, so hold the
        // renderer until the next print replaces it.
        printView = renderer;
        renderer.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
    }

    /* ----------------------------------------------------- saving files */

    private void askWhereToSave(String filename, String mime, String content) {
        pendingContent = content;

        String type = (mime == null || mime.isEmpty()) ? "*/*" : mime.split(";")[0].trim();
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType(type)
                .putExtra(Intent.EXTRA_TITLE, filename == null ? "lavi-export" : filename);
        try {
            startActivityForResult(intent, REQ_SAVE_FILE);
        } catch (ActivityNotFoundException e) {
            pendingContent = null;
            toast(getString(R.string.no_saver));
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == REQ_PICK_FILE) {
            deliverPickedFile(resultCode, data);
        } else if (requestCode == REQ_SAVE_FILE) {
            writePendingContent(resultCode, data);
        }
    }

    private void deliverPickedFile(int resultCode, Intent data) {
        if (pendingFilePick == null) return;
        Uri[] picked = null;

        if (resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int count = data.getClipData().getItemCount();
                picked = new Uri[count];
                for (int i = 0; i < count; i++) {
                    picked[i] = data.getClipData().getItemAt(i).getUri();
                }
            } else if (data.getData() != null) {
                picked = new Uri[]{ data.getData() };
            }
        }

        pendingFilePick.onReceiveValue(picked);
        pendingFilePick = null;
    }

    private void writePendingContent(int resultCode, Intent data) {
        String content = pendingContent;
        pendingContent = null;

        if (resultCode != RESULT_OK || data == null || data.getData() == null || content == null) {
            return;   // the user backed out
        }

        OutputStream out = null;
        try {
            out = getContentResolver().openOutputStream(data.getData());
            if (out == null) throw new IllegalStateException("no stream");
            out.write(content.getBytes(Charset.forName("UTF-8")));
            out.flush();
            toast(getString(R.string.saved));
        } catch (Exception e) {
            toast(getString(R.string.save_failed));
        } finally {
            if (out != null) {
                try { out.close(); } catch (Exception ignored) { }
            }
        }
    }

    /* --------------------------------------------------------- helpers */

    private void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    @Override
    protected void onDestroy() {
        if (printView != null) {
            printView.destroy();
            printView = null;
        }
        if (web != null) {
            web.removeJavascriptInterface("LaviNative");
        }
        super.onDestroy();
    }
}
