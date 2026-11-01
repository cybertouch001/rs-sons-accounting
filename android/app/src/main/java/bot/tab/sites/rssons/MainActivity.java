package bot.tab.sites.rssons;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.KeyguardManager;
import android.content.SharedPreferences;
import android.graphics.Canvas;
import android.graphics.pdf.PdfDocument;
import android.os.CancellationSignal;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * R&S Sons Accounting for Android: opens straight on the login of the hosted server (one login, the same data as the
 * Windows app and every other phone). The screens are the server's own web app; this shell adds what a phone app needs:
 * staying logged in, the back button, saving / sharing Excel and backup files, printing / "Save as PDF", and a clear
 * "no internet" / "server waking up" state instead of a blank or frozen screen.
 */
public class MainActivity extends Activity {
    static final String SERVER = BuildConfig.SERVER;
    static final String START = SERVER + "/app/";
    private WebView web;
    private LinearLayout overlay;
    private TextView status, sub;
    private ProgressBar spinner;
    private LinearLayout buttons;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private volatile String pageUrl = "";
    private boolean loaded = false, failed = false;
    private long lastBack = 0;
    private ValueCallback<Uri[]> fileCb;
    private WebView printView;
    private ConnectivityManager.NetworkCallback netCb;
    // optional app lock (phone fingerprint / PIN / pattern): asked when the app opens and after 60 s in the background
    private SharedPreferences prefs;
    private View lockView;
    private boolean unlocked = false, authing = false;
    private long pausedAt = 0;
    private final Runnable slowHint = () -> { if (!loaded && !failed) setStatus("Server jag raha hai…", "Pehli baar 10-30 sec lag sakte hain · Server is waking up, please wait"); };
    private final Runnable showRetryLate = () -> { if (!loaded && !failed) buttons.setVisibility(View.VISIBLE); };

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0b2545"));
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(buildOverlay(), new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(buildLock(), new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        prefs = getSharedPreferences("rs", MODE_PRIVATE);
        setupWeb();
        watchNetwork();
        if (state != null && web.restoreState(state) != null) { loaded = true; overlay.setVisibility(View.GONE); }
        else load();
    }

    private View buildOverlay() {
        overlay = new LinearLayout(this);
        overlay.setOrientation(LinearLayout.VERTICAL);
        overlay.setGravity(Gravity.CENTER);
        overlay.setBackgroundColor(Color.parseColor("#0b2545"));
        overlay.setPadding(dp(32), dp(32), dp(32), dp(32));
        overlay.setClickable(true);
        ImageView logo = new ImageView(this);
        logo.setImageResource(R.mipmap.ic_launcher);
        overlay.addView(logo, new LinearLayout.LayoutParams(dp(88), dp(88)));
        TextView title = new TextView(this);
        title.setText("R&S Sons Accounting");
        title.setTextColor(Color.WHITE); title.setTextSize(22); title.setTypeface(Typeface.DEFAULT_BOLD); title.setGravity(Gravity.CENTER);
        title.setPadding(0, dp(14), 0, dp(4));
        overlay.addView(title);
        TextView tag = new TextView(this);
        tag.setText("Ek baar login, data har jagah · Login once, data everywhere");
        tag.setTextColor(Color.parseColor("#a9bcd6")); tag.setTextSize(13); tag.setGravity(Gravity.CENTER);
        overlay.addView(tag);
        spinner = new ProgressBar(this);
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(dp(40), dp(40)); sp.topMargin = dp(28);
        overlay.addView(spinner, sp);
        status = new TextView(this);
        status.setTextColor(Color.WHITE); status.setTextSize(16); status.setGravity(Gravity.CENTER); status.setPadding(0, dp(14), 0, dp(4));
        overlay.addView(status);
        sub = new TextView(this);
        sub.setTextColor(Color.parseColor("#c7d4e6")); sub.setTextSize(13); sub.setGravity(Gravity.CENTER);
        overlay.addView(sub);
        buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL); buttons.setGravity(Gravity.CENTER); buttons.setPadding(0, dp(20), 0, 0);
        Button retry = new Button(this);
        retry.setText("↻  Retry");
        retry.setOnClickListener(v -> load());
        buttons.addView(retry);
        buttons.setVisibility(View.GONE);
        overlay.addView(buttons);
        setStatus("Connecting…", "जुड़ रहा है");
        return overlay;
    }

    private void setStatus(String s, String detail) { status.setText(s); sub.setText(detail == null ? "" : detail); }
    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    private void setupWeb() {
        if (BuildConfig.WEB_DEBUG) WebView.setWebContentsDebuggingEnabled(true);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setUserAgentString(s.getUserAgentString() + " RSSonsAndroid/" + BuildConfig.VERSION_NAME);
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, false);
        web.addJavascriptInterface(new Bridge(), "RSAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) { return handleUrl(req.getUrl()); }
            @SuppressWarnings("deprecation") @Override public boolean shouldOverrideUrlLoading(WebView v, String url) { return handleUrl(Uri.parse(url)); }
            @Override public void onPageStarted(WebView v, String url, Bitmap fav) { pageUrl = url == null ? "" : url; }
            @Override public void onPageFinished(WebView v, String url) {
                pageUrl = url == null ? "" : url;
                if (!failed && url != null && url.startsWith(SERVER)) {
                    loaded = true; overlay.setVisibility(View.GONE);
                    ui.removeCallbacks(slowHint); ui.removeCallbacks(showRetryLate);
                    CookieManager.getInstance().flush();
                }
            }
            @Override public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) showOffline(err.getErrorCode(), String.valueOf(err.getDescription()));
            }
            @Override public boolean onRenderProcessGone(WebView v, android.webkit.RenderProcessGoneDetail d) {
                // the page's process ended (low memory): start the page again instead of closing the app
                ViewGroup p = (ViewGroup) web.getParent(); p.removeView(web); web.destroy();
                web = new WebView(MainActivity.this); p.addView(web, 0, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                setupWeb(); load(); return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try { startActivityForResult(Intent.createChooser(i, "File chuno · Choose file"), 41); }
                catch (ActivityNotFoundException e) { fileCb = null; return false; }
                return true;
            }
        });
        web.setDownloadListener((url, ua, cd, mime, len) -> openExternal(Uri.parse(url)));
    }

    private boolean handleUrl(Uri u) {
        String s = u.toString();
        if (s.startsWith(SERVER + "/app") || s.startsWith(SERVER + "/api/") || s.startsWith(SERVER + "/assets/") || s.startsWith(SERVER + "/core/")) return false;
        openExternal(u); // website pages, WhatsApp, mail, phone: in the right app
        return true;
    }

    private void openExternal(Uri u) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, u);
            if ("mailto".equals(u.getScheme())) i = new Intent(Intent.ACTION_SENDTO, u);
            startActivity(i);
        } catch (Exception e) { Toast.makeText(this, "Is link ko kholne wala app nahi mila", Toast.LENGTH_SHORT).show(); }
    }

    private void load() {
        loaded = false; failed = false;
        overlay.setVisibility(View.VISIBLE); spinner.setVisibility(View.VISIBLE); buttons.setVisibility(View.GONE);
        setStatus("Connecting…", "जुड़ रहा है");
        ui.removeCallbacks(slowHint); ui.removeCallbacks(showRetryLate);
        ui.postDelayed(slowHint, 6000); ui.postDelayed(showRetryLate, 20000);
        if (!online()) { showOffline(-2, "no network"); return; }
        web.loadUrl(START);
    }

    private void showOffline(int code, String desc) {
        failed = true; loaded = false;
        ui.removeCallbacks(slowHint); ui.removeCallbacks(showRetryLate);
        overlay.setVisibility(View.VISIBLE); spinner.setVisibility(View.GONE); buttons.setVisibility(View.VISIBLE);
        if (!online()) setStatus("📴 Internet nahi hai", "No internet connection. Internet chalu karo — app apne aap connect ho jayegi.\nAapka data server pe safe hai.");
        else setStatus("⚠ Server tak nahi pahunch paaye", "Could not reach the server (" + desc + "). Thodi der baad Retry karo.\nAapka data server pe safe hai.");
        web.loadUrl("about:blank");
    }

    private boolean online() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return true;
        // test builds only: the emulator test rig reaches the internet through a proxy with no Android network
        if (BuildConfig.WEB_DEBUG && android.provider.Settings.Global.getString(getContentResolver(), "http_proxy") != null) return true;
        Network n = cm.getActiveNetwork(); if (n == null) return false;
        NetworkCapabilities c = cm.getNetworkCapabilities(n);
        return c != null && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    private void watchNetwork() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return;
        netCb = new ConnectivityManager.NetworkCallback() {
            @Override public void onAvailable(Network n) { ui.postDelayed(() -> { if (failed) load(); }, 800); }
        };
        try { cm.registerDefaultNetworkCallback(netCb); } catch (Exception ignored) { }
    }

    @Override
    public void onBackPressed() {
        if (!loaded) { super.onBackPressed(); return; }
        web.evaluateJavascript("(function(){try{return window.rsBack&&window.rsBack()?1:0}catch(e){return 0}})()", r -> {
            if ("1".equals(r)) return;
            long now = System.currentTimeMillis();
            if (now - lastBack < 2000) { finish(); return; }
            lastBack = now;
            Toast.makeText(this, "Band karne ke liye dobara Back dabao", Toast.LENGTH_SHORT).show();
        });
    }

    @Override protected void onActivityResult(int req, int res, Intent data) {
        if (req == 42) { authing = false; AuthDone cb = pendingAuth; pendingAuth = null; if (cb != null) cb.done(res == RESULT_OK); return; }
        if (req == 41 && fileCb != null) {
            Uri[] r = null;
            if (res == RESULT_OK && data != null && data.getData() != null) r = new Uri[]{ data.getData() };
            fileCb.onReceiveValue(r); fileCb = null; return;
        }
        super.onActivityResult(req, res, data);
    }

    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); if (loaded) web.saveState(out); }
    @Override protected void onPause() { super.onPause(); pausedAt = System.currentTimeMillis(); CookieManager.getInstance().flush(); }
    @Override protected void onDestroy() {
        try { ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE); if (cm != null && netCb != null) cm.unregisterNetworkCallback(netCb); } catch (Exception ignored) { }
        super.onDestroy();
    }


    // ---------------- app lock ----------------
    private View buildLock() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL); l.setGravity(Gravity.CENTER); l.setClickable(true);
        l.setBackgroundColor(Color.parseColor("#0b2545"));
        ImageView logo = new ImageView(this); logo.setImageResource(R.mipmap.ic_launcher);
        l.addView(logo, new LinearLayout.LayoutParams(dp(80), dp(80)));
        TextView t = new TextView(this); t.setText("🔒 App locked"); t.setTextColor(Color.WHITE); t.setTextSize(20); t.setGravity(Gravity.CENTER); t.setPadding(0, dp(16), 0, dp(6));
        l.addView(t);
        TextView s = new TextView(this); s.setText("Fingerprint / phone PIN se kholo"); s.setTextColor(Color.parseColor("#c7d4e6")); s.setGravity(Gravity.CENTER);
        l.addView(s);
        Button b = new Button(this); b.setText("Unlock"); b.setOnClickListener(v -> askUnlock());
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT); bp.topMargin = dp(22);
        l.addView(b, bp);
        l.setVisibility(View.GONE);
        lockView = l; return l;
    }
    private boolean lockOn() { return prefs != null && prefs.getBoolean("lock", false); }
    private boolean deviceSecure() { KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE); return km != null && km.isDeviceSecure(); }
    private void askUnlock() { authenticate("R&S Sons Accounting", "Unlock karo · fingerprint / PIN", ok -> { if (ok) { unlocked = true; lockView.setVisibility(View.GONE); } }); }
    interface AuthDone { void done(boolean ok); }
    private AuthDone pendingAuth;
    @SuppressWarnings("deprecation")
    private void authenticate(String title, String sub, AuthDone cb) {
        if (authing) return;
        if (!deviceSecure()) { cb.done(true); return; }   // the phone has no lock any more: nothing to check against
        authing = true;
        if (Build.VERSION.SDK_INT >= 29) {
            android.hardware.biometrics.BiometricPrompt.Builder b = new android.hardware.biometrics.BiometricPrompt.Builder(this).setTitle(title).setSubtitle(sub);
            if (Build.VERSION.SDK_INT >= 30) b.setAllowedAuthenticators(android.hardware.biometrics.BiometricManager.Authenticators.BIOMETRIC_WEAK | android.hardware.biometrics.BiometricManager.Authenticators.DEVICE_CREDENTIAL);
            else b.setDeviceCredentialAllowed(true);
            b.build().authenticate(new CancellationSignal(), getMainExecutor(), new android.hardware.biometrics.BiometricPrompt.AuthenticationCallback() {
                @Override public void onAuthenticationSucceeded(android.hardware.biometrics.BiometricPrompt.AuthenticationResult r) { authing = false; cb.done(true); }
                @Override public void onAuthenticationError(int code, CharSequence msg) { authing = false; cb.done(false); }
            });
        } else {
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            Intent i = km.createConfirmDeviceCredentialIntent(title, sub);
            if (i == null) { authing = false; cb.done(true); return; }
            pendingAuth = cb; startActivityForResult(i, 42);
        }
    }
    private void maybeLock() {
        if (!lockOn()) { lockView.setVisibility(View.GONE); return; }
        if (unlocked && (pausedAt == 0 || System.currentTimeMillis() - pausedAt < 60000)) return;
        unlocked = false; lockView.setVisibility(View.VISIBLE); askUnlock();
    }
    @Override protected void onResume() { super.onResume(); maybeLock(); }
    private void jsLockState() {
        String js = "window.rsLockChanged&&window.rsLockChanged(" + lockOn() + ")";
        if (web != null) web.evaluateJavascript(js, null);
    }

    private boolean trusted() { String u = pageUrl; return u != null && u.startsWith(SERVER + "/"); }

    /** What the web app may ask of the phone. Only the server's own pages get answers. */
    class Bridge {
        @JavascriptInterface public String version() { return BuildConfig.VERSION_NAME; }

        @JavascriptInterface public String saveFile(String name, String mime, String b64) {
            JSONObject out = new JSONObject();
            try {
                if (!trusted()) throw new Exception("not allowed");
                String safe = name == null ? "file" : name.replaceAll("[\\\\/:*?\"<>|]+", "-").trim();
                if (safe.isEmpty()) safe = "file";
                byte[] bytes = Base64.decode(b64 == null ? "" : b64, Base64.DEFAULT);
                Uri shareUri; String where;
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.Downloads.DISPLAY_NAME, safe);
                    cv.put(MediaStore.Downloads.MIME_TYPE, mime);
                    cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/RS Sons Accounting");
                    Uri u = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    if (u == null) throw new Exception("Downloads folder not available");
                    try (OutputStream os = getContentResolver().openOutputStream(u)) { os.write(bytes); }
                    shareUri = u; where = "Downloads/RS Sons Accounting";
                } else {
                    File dir = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "RS Sons Accounting");
                    if (!dir.exists() && !dir.mkdirs()) throw new Exception("cannot create folder");
                    File f = new File(dir, safe);
                    try (FileOutputStream os = new FileOutputStream(f)) { os.write(bytes); }
                    shareUri = ExportProvider.uriFor(f); where = "Android/data/" + getPackageName() + "/files/Download/RS Sons Accounting";
                }
                final Uri su = shareUri; final String fn = safe, w = where, mt = mime;
                ui.post(() -> fileSaved(su, fn, mt, w));
                out.put("file", safe); out.put("where", where);
            } catch (Exception e) {
                try { out.put("error", e.getMessage() == null ? e.toString() : e.getMessage()); } catch (Exception ignored) { }
            }
            return out.toString();
        }

        @JavascriptInterface public String lockState() {
            try { return new JSONObject().put("available", true).put("secure", deviceSecure()).put("on", lockOn()).toString(); } catch (Exception e) { return "{}"; }
        }
        @JavascriptInterface public void setLock(boolean on) {
            if (!trusted()) return;
            ui.post(() -> {
                if (on && !deviceSecure()) {
                    new AlertDialog.Builder(MainActivity.this).setTitle("Pehle phone lock lagao")
                        .setMessage("App lock ke liye phone me screen lock (PIN / pattern / fingerprint) hona chahiye. Settings → Security → Screen lock.")
                        .setPositiveButton("OK", null).show();
                    return;
                }
                authenticate(on ? "App lock ON karo" : "App lock OFF karo", "Fingerprint / phone PIN", ok -> {
                    if (ok) { prefs.edit().putBoolean("lock", on).apply(); unlocked = true; Toast.makeText(MainActivity.this, on ? "App lock ON 🔒" : "App lock OFF", Toast.LENGTH_SHORT).show(); }
                    jsLockState();
                });
            });
        }
        @JavascriptInterface public void sharePdf(String html, String name, String text) {
            if (!trusted()) return;
            final String h = html == null ? "" : html, n = name == null || name.isEmpty() ? "Document" : name, t = text == null ? "" : text;
            ui.post(() -> makePdf(h, n, t));
        }

        @JavascriptInterface public void printHtml(String html, String title) {
            if (!trusted()) return;
            final String h = html == null ? "" : html, t = title == null || title.isEmpty() ? "Document" : title;
            ui.post(() -> printDoc(h, t));
        }
    }

    private void fileSaved(Uri uri, String name, String mime, String where) {
        new AlertDialog.Builder(this)
            .setTitle("File save ho gayi ✓")
            .setMessage(name + "\n\n" + where)
            .setPositiveButton("Share", (d, w) -> {
                Intent s = new Intent(Intent.ACTION_SEND);
                s.setType(mime == null ? "application/octet-stream" : mime);
                s.putExtra(Intent.EXTRA_STREAM, uri);
                s.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try { startActivity(Intent.createChooser(s, "Share " + name)); } catch (Exception e) { Toast.makeText(this, "Share nahi ho paya", Toast.LENGTH_SHORT).show(); }
            })
            .setNeutralButton("Open", (d, w) -> {
                Intent v = new Intent(Intent.ACTION_VIEW);
                v.setDataAndType(uri, mime == null ? "application/octet-stream" : mime);
                v.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try { startActivity(v); } catch (Exception e) { Toast.makeText(this, "Is file ko kholne wala app nahi mila (Excel / Sheets install karo)", Toast.LENGTH_LONG).show(); }
            })
            .setNegativeButton("OK", null)
            .show();
    }


    // invoice / report → a real PDF file on the phone → share sheet (WhatsApp, mail, Drive…)
    private WebView pdfView;
    private void makePdf(String html, String name, String text) {
        Toast.makeText(this, "PDF ban raha hai…", Toast.LENGTH_SHORT).show();
        final int w = dp(794) ; final int pageH = Math.round(w * 842f / 595f);
        final FrameLayout root = (FrameLayout) overlay.getParent();
        if (pdfView != null) { root.removeView(pdfView); pdfView.destroy(); }
        pdfView = new WebView(this);
        pdfView.getSettings().setJavaScriptEnabled(false);
        pdfView.setLayerType(View.LAYER_TYPE_SOFTWARE, null);
        pdfView.setVerticalScrollBarEnabled(false);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(w, pageH); lp.leftMargin = -w * 2;   // laid out, but off screen
        root.addView(pdfView, 0, lp);
        pdfView.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView v, String url) { ui.postDelayed(() -> renderPdf(v, w, pageH, name, text), 700); }
        });
        pdfView.loadDataWithBaseURL(SERVER + "/app/", html, "text/html", "utf-8", null);
    }
    private void renderPdf(WebView v, int w, int pageH, String name, String text) {
        try {
            int total = Math.max(pageH, Math.round(v.getContentHeight() * getResources().getDisplayMetrics().density));
            int pages = Math.min(40, (int) Math.ceil(total / (double) pageH));
            PdfDocument doc = new PdfDocument();
            float scale = 595f / w;
            drawPage(v, doc, 0, pages, pageH, scale, () -> {
                try {
                    String safe = name.replaceAll("[\\\\/:*?\"<>|]+", "-").trim() + ".pdf";
                    File dir = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "RS Sons Accounting");
                    dir.mkdirs(); File f = new File(dir, safe);
                    try (FileOutputStream os = new FileOutputStream(f)) { doc.writeTo(os); }
                    doc.close();
                    Intent s = new Intent(Intent.ACTION_SEND);
                    s.setType("application/pdf");
                    s.putExtra(Intent.EXTRA_STREAM, ExportProvider.uriFor(f));
                    if (!text.isEmpty()) s.putExtra(Intent.EXTRA_TEXT, text);
                    s.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(Intent.createChooser(s, "Share PDF · WhatsApp"));
                } catch (Exception e) { Toast.makeText(this, "PDF nahi bana: " + e.getMessage(), Toast.LENGTH_LONG).show(); }
            });
        } catch (Exception e) { Toast.makeText(this, "PDF nahi bana: " + e.getMessage(), Toast.LENGTH_LONG).show(); }
    }
    private void drawPage(WebView v, PdfDocument doc, int i, int pages, int pageH, float scale, Runnable done) {
        if (i >= pages) { done.run(); return; }
        v.scrollTo(0, i * pageH);
        ui.postDelayed(() -> {
            PdfDocument.Page p = doc.startPage(new PdfDocument.PageInfo.Builder(595, 842, i + 1).create());
            Canvas c = p.getCanvas(); c.scale(scale, scale); c.translate(0, -i * pageH);
            v.draw(c);
            doc.finishPage(p);
            drawPage(v, doc, i + 1, pages, pageH, scale, done);
        }, 250);
    }

    private void printDoc(String html, String title) {
        printView = new WebView(this);
        printView.getSettings().setJavaScriptEnabled(false);
        printView.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView v, String url) {
                PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                if (pm == null) return;
                pm.print(title, v.createPrintDocumentAdapter(title), new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build());
            }
        });
        printView.loadDataWithBaseURL(SERVER + "/app/", html, "text/html", "utf-8", null);
    }
}
