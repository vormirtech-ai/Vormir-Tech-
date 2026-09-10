package com.lavidhawa.lavi_billing;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.view.WindowManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.annotation.NonNull;

import java.io.OutputStream;
import java.nio.charset.Charset;

import io.flutter.embedding.android.FlutterActivity;
import io.flutter.embedding.engine.FlutterEngine;
import io.flutter.plugin.common.MethodCall;
import io.flutter.plugin.common.MethodChannel;

/**
 * The Android half of the Flutter shell.
 *
 * Everything the billing system cannot do from inside a WebView arrives here
 * over a single method channel:
 *
 *   printHtml  — render a bill and hand it to Android's print service
 *   saveFile   — write a backup or CSV wherever the user chooses
 *   pickFile   — choose a backup file to restore
 *
 * The activity also keeps the screen awake, because a billing counter should
 * never dim mid-order.
 */
public class MainActivity extends FlutterActivity {

    private static final String CHANNEL = "lavi.dhawa/native";
    private static final int REQ_SAVE_FILE = 5101;
    private static final int REQ_PICK_FILE = 5102;

    /** Held while Android's print service works through the document. */
    private WebView printView;

    /** Set between asking for a save location and being handed one. */
    private String pendingContent;

    /** Set between asking for a file and the pick coming back. */
    private MethodChannel.Result pendingPick;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    @Override
    public void configureFlutterEngine(@NonNull FlutterEngine flutterEngine) {
        super.configureFlutterEngine(flutterEngine);

        new MethodChannel(flutterEngine.getDartExecutor().getBinaryMessenger(), CHANNEL)
                .setMethodCallHandler(new MethodChannel.MethodCallHandler() {
                    @Override
                    public void onMethodCall(@NonNull MethodCall call, @NonNull MethodChannel.Result result) {
                        dispatch(call, result);
                    }
                });
    }

    private void dispatch(MethodCall call, MethodChannel.Result result) {
        final String method = call.method;

        if ("printHtml".equals(method)) {
            String title = argument(call, "title", "Bill");
            String html = argument(call, "html", "");
            print(title, html);
            result.success(null);

        } else if ("saveFile".equals(method)) {
            String name = argument(call, "name", "lavi-export");
            String mime = argument(call, "mime", "text/plain");
            String content = argument(call, "content", "");
            askWhereToSave(name, mime, content, result);

        } else if ("pickFile".equals(method)) {
            String mime = argument(call, "mime", "*/*");
            askForFile(mime, result);

        } else {
            result.notImplemented();
        }
    }

    private String argument(MethodCall call, String key, String fallback) {
        Object value = call.argument(key);
        return value instanceof String ? (String) value : fallback;
    }

    /* ---------------------------------------------------------- printing */

    private void print(String title, String html) {
        final String jobName = "Lavi Billing — " + title;

        final WebView renderer = new WebView(this);
        renderer.getSettings().setJavaScriptEnabled(false);
        renderer.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                PrintManager manager = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                if (manager == null) return;
                PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(jobName);
                manager.print(jobName, adapter, new PrintAttributes.Builder().build());
            }
        });

        // The print adapter keeps using this WebView after the method returns,
        // so it is held until the next print replaces it.
        printView = renderer;
        renderer.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
    }

    /* ------------------------------------------------------ saving files */

    private void askWhereToSave(String filename, String mime, String content,
                                MethodChannel.Result result) {
        pendingContent = content;

        String type = mime.isEmpty() ? "*/*" : mime.split(";")[0].trim();
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType(type)
                .putExtra(Intent.EXTRA_TITLE, filename);
        try {
            startActivityForResult(intent, REQ_SAVE_FILE);
            result.success(null);
        } catch (ActivityNotFoundException e) {
            pendingContent = null;
            result.error("no_picker", "No app on this tablet can save files.", null);
        }
    }

    private void askForFile(String mime, MethodChannel.Result result) {
        if (pendingPick != null) {
            pendingPick.success(null);
            pendingPick = null;
        }

        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType(mime.isEmpty() ? "*/*" : mime);
        try {
            pendingPick = result;
            startActivityForResult(intent, REQ_PICK_FILE);
        } catch (ActivityNotFoundException e) {
            pendingPick = null;
            result.error("no_picker", "No app on this tablet can open files.", null);
        }
    }

    @Override
    public void onActivityResult(int requestCode, int resultCode, Intent data) {
        // Plugins get their turn first; the two codes below are ours alone.
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == REQ_SAVE_FILE) {
            writePendingContent(resultCode, data);
        } else if (requestCode == REQ_PICK_FILE) {
            deliverPickedFile(resultCode, data);
        }
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
        } catch (Exception ignored) {
            // Reported to the user by the picker itself; nothing to add here.
        } finally {
            if (out != null) {
                try { out.close(); } catch (Exception ignored) { }
            }
        }
    }

    private void deliverPickedFile(int resultCode, Intent data) {
        MethodChannel.Result result = pendingPick;
        pendingPick = null;
        if (result == null) return;

        if (resultCode == RESULT_OK && data != null && data.getData() != null) {
            result.success(data.getData().toString());
        } else {
            result.success(null);
        }
    }

    @Override
    public void onDestroy() {
        if (printView != null) {
            printView.destroy();
            printView = null;
        }
        super.onDestroy();
    }
}
