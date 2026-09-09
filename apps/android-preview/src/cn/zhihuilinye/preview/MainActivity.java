package cn.zhihuilinye.preview;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.content.ActivityNotFoundException;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.RenderProcessGoneDetail;
import android.widget.FrameLayout;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Locale;
import java.util.HashMap;
import java.util.Map;

public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String ORIGIN = "https://" + HOST;
    private static final String TAG = "ForestPreview";
    private static final int PICK_IMAGE = 21;
    private static final int EXPORT_CSV = 22;
    private WebView web;
    private ValueCallback<Uri[]> imageCallback;
    private Uri cameraUri;
    private File cameraFile;
    private volatile String captureProject = "";
    private String pendingCsv;
    private BaiduDirect baidu;
    private TaxonomyHttp taxonomy;
    private FileExport fileExport;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout frame = new FrameLayout(this);
        frame.setBackgroundColor(Color.rgb(245, 246, 247));
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(245, 246, 247));
        frame.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(frame);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            frame.setOnApplyWindowInsetsListener((view, insets) -> {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
                return WindowInsets.CONSUMED;
            });
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) controller.setSystemBarsAppearance(
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
            frame.requestApplyInsets();
        } else {
            frame.setFitsSystemWindows(true);
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        }

        WebSettings settings = web.getSettings();
        web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setTextZoom(Math.round(getResources().getConfiguration().fontScale * 100));
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        web.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        cleanOldCaptures();
        fileExport = new FileExport(this, web);
        baidu = new BaiduDirect(this, web);
        taxonomy = new TaxonomyHttp(this, web);
        web.addJavascriptInterface(new CsvBridge(), "ForestAndroidPreview");
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!isLocal(uri) || !"GET".equals(request.getMethod())) return blocked();
                String path = uri.getPath();
                if (path == null || path.equals("/")) path = "/index.html";
                if (path.contains("..") || path.contains("\\") || path.indexOf('\0') >= 0) return blocked();
                if (path.startsWith("/__capture/")) {
                    String name = path.substring("/__capture/".length());
                    if (!name.matches("plant_[A-Za-z0-9_-]+\\.jpg") || !name.equals(getSharedPreferences("capture-pending",0).getString("name",""))) return blocked();
                    try { return new WebResourceResponse("image/jpeg", null, new java.io.FileInputStream(new File(new File(getCacheDir(),"captures"),name))); }
                    catch(Exception missing) { return blocked(); }
                }
                try {
                    InputStream input = getAssets().open("www" + path);
                    String mime = mime(path);
                    boolean text = mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json") || mime.contains("svg");
                    Map<String,String> headers = new HashMap<>();
                    headers.put("Cache-Control", "no-cache");
                    headers.put("Content-Security-Policy", "frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
                    headers.put("X-Content-Type-Options", "nosniff");
                    return new WebResourceResponse(mime, text ? "UTF-8" : null, 200, "OK", headers, input);
                } catch (Exception missing) {
                    Log.w(TAG, "Missing bundled resource: " + path);
                    return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
                }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !isLocal(request.getUrl());
            }
            @Override public void onPageFinished(WebView view, String url) {
                Log.i(TAG, "Bundled UI loaded");
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                Log.w(TAG, "Recreating WebView after renderer loss");
                imageCallback = null;
                ((FrameLayout)view.getParent()).removeView(view);
                view.destroy();
                web = null;
                recreate();
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(ConsoleMessage message) {
                if (message.messageLevel() == ConsoleMessage.MessageLevel.ERROR) Log.e(TAG, "UI: " + message.message());
                return true;
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (imageCallback != null) imageCallback.onReceiveValue(null);
                imageCallback = callback;
                if (getSharedPreferences("capture-pending",0).getBoolean("ready",false)) {
                    imageCallback.onReceiveValue(null);
                    imageCallback = null;
                    Toast.makeText(MainActivity.this, "请先保存上一张照片后重试", Toast.LENGTH_LONG).show();
                    return true;
                }
                String project = captureProject;
                releaseCapture();
                captureProject = project;
                try {
                    Intent intent;
                    if (params.isCaptureEnabled()) {
                        File directory = new File(getCacheDir(), "captures");
                        if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("camera directory");
                        cameraFile = File.createTempFile("plant_", ".jpg", directory);
                        cameraUri = Uri.parse("content://" + CaptureProvider.AUTHORITY + "/" + cameraFile.getName());
                        if (!getSharedPreferences("capture-pending",0).edit().putString("name",cameraFile.getName()).putString("project",captureProject).putBoolean("ready",false).commit()) throw new IllegalStateException("capture state");
                        intent = captureIntent();
                        intent.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
                        intent.setClipData(ClipData.newRawUri("植物照片", cameraUri));
                        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                    } else {
                        intent = new Intent(Intent.ACTION_GET_CONTENT);
                        intent.addCategory(Intent.CATEGORY_OPENABLE);
                        intent.setType("image/*");
                        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    }
                    startActivityForResult(intent, PICK_IMAGE);
                } catch (Exception error) {
                    imageCallback.onReceiveValue(null);
                    imageCallback = null;
                    releaseCapture();
                    String message = error instanceof ActivityNotFoundException ? "没有可用的相机，请安装相机或从相册选择" : "无法打开拍摄或选图，请重试";
                    Log.w(TAG, "Photo chooser failed: " + error.getClass().getSimpleName());
                    Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show();
                }
                return true;
            }
        });
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(0, this::navigateBack);
        String captureName = getSharedPreferences("capture-pending",0).getString("name", "");
        captureProject = getSharedPreferences("capture-pending",0).getString("project", "");
        if (captureName.matches("plant_[A-Za-z0-9_-]+\\.jpg") && captureProject.matches("[A-Za-z0-9_-]{1,100}")) {
            cameraFile = new File(new File(getCacheDir(),"captures"), captureName);
            cameraUri = Uri.parse("content://" + CaptureProvider.AUTHORITY + "/" + captureName);
            web.loadUrl(ORIGIN + "/index.html#/pages/capture/index?projectId=" + Uri.encode(captureProject));
        } else web.loadUrl(ORIGIN + "/index.html");
    }

    private Intent captureIntent() {
        Intent capture = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        if (capture.resolveActivity(getPackageManager()) != null) return capture;
        // Android 11+ filters implicit capture intents to system cameras. A user-installed
        // camera can still return a full photo when explicitly addressed by package.
        Intent camera = new Intent(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA);
        for (ResolveInfo app : getPackageManager().queryIntentActivities(camera, PackageManager.MATCH_DEFAULT_ONLY)) {
            Intent explicit = new Intent(capture).setPackage(app.activityInfo.packageName);
            if (explicit.resolveActivity(getPackageManager()) != null) return explicit;
        }
        throw new ActivityNotFoundException("No capture handler");
    }
    private void cleanOldCaptures() {
        File[] files = new File(getCacheDir(), "captures").listFiles();
        if (files == null) return;
        String pending = getSharedPreferences("capture-pending",0).getString("name", "");
        for (File file : files) if (!file.getName().equals(pending) && file.getName().matches("plant_[A-Za-z0-9_-]+\\.jpg") && System.currentTimeMillis() - file.lastModified() > 86400000L) file.delete();
    }
    private void releaseCapture() {
        if (cameraUri != null) revokeUriPermission(cameraUri, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        if (cameraFile != null) cameraFile.delete();
        cameraFile = null; cameraUri = null;
        captureProject = "";
        getSharedPreferences("capture-pending",0).edit().clear().commit();
    }

    private static boolean isLocal(Uri uri) {
        return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost()) && uri.getPort() == -1;
    }
    private static WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }
    private static String mime(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".html")) return "text/html";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "application/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".ttf")) return "font/ttf";
        return "application/octet-stream";
    }
    private void navigateBack() {
        if (web != null && web.canGoBack()) web.goBack(); else finish();
    }
    @Override public void onBackPressed() { navigateBack(); }

    public final class CsvBridge {
        @JavascriptInterface public void openRepository() {
            // Fixed destination only. External pages never receive the app bridge.
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) return;
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/Vickylines/Smart_Forestry"));
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                try { startActivity(intent); }
                catch (ActivityNotFoundException | SecurityException error) {
                    Toast.makeText(MainActivity.this, "无法打开链接，请安装或启用浏览器后重试", Toast.LENGTH_LONG).show();
                }
            });
        }
        @JavascriptInterface public void setCaptureProject(String id) {
            if (id != null && id.matches("[A-Za-z0-9_-]{1,100}")) captureProject = id;
        }
        @JavascriptInterface public String pendingCapture() {
            android.content.SharedPreferences prefs = getSharedPreferences("capture-pending",0);
            String name = prefs.getString("name", "");
            if (!prefs.getBoolean("ready",false) || !name.matches("plant_[A-Za-z0-9_-]+\\.jpg")) return "";
            File photo = new File(new File(getCacheDir(),"captures"),name);
            if (!photo.isFile() || photo.length()==0) return "";
            try { return new org.json.JSONObject().put("uri",ORIGIN+"/__capture/"+name).put("name",name).put("bytes",photo.length()).put("projectId",prefs.getString("project","")).toString(); }
            catch(Exception error) { return ""; }
        }
        @JavascriptInterface public void releaseCapture(String uri) {
            // A late acknowledgement must never delete a newer capture.
            runOnUiThread(() -> {
                String name = getSharedPreferences("capture-pending",0).getString("name", "");
                if (!name.isEmpty() && (ORIGIN + "/__capture/" + name).equals(uri)) MainActivity.this.releaseCapture();
            });
        }
        @JavascriptInterface public boolean saveBaidu(String key,String secret){return baidu.save(key,secret);}
        @JavascriptInterface public boolean baiduConfigured(){return baidu.configured();}
        @JavascriptInterface public void requestBaidu(String id,String image){baidu.request(id,image);}
        @JavascriptInterface public void requestTaxonomy(String id,String operation,String query){taxonomy.request(id,operation,query);}
        @JavascriptInterface public boolean beginFile(String name,String type){return fileExport.begin(name,type);}
        @JavascriptInterface public boolean appendFile(String data){return fileExport.append(data);}
        @JavascriptInterface public void finishFile(){fileExport.finish();}
        @JavascriptInterface public void cancelFile(){fileExport.cancel();}
        @JavascriptInterface public void saveCsv(String content, String filename) {
            if (content == null || content.length() > 10 * 1024 * 1024) return;
            runOnUiThread(() -> {
                if (pendingCsv != null || isFinishing()) return;
                pendingCsv = content;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("text/csv");
                intent.putExtra(Intent.EXTRA_TITLE, "植物调查-" + new java.text.SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(new java.util.Date()) + ".csv");
                try { startActivityForResult(intent, EXPORT_CSV); }
                catch (Exception error) { pendingCsv = null; Toast.makeText(MainActivity.this, "无法打开文件保存", Toast.LENGTH_SHORT).show(); }
            });
        }
    }
    private boolean allowedPhoto(Uri uri) {
        if (uri == null || !"content".equals(uri.getScheme()) || CaptureProvider.AUTHORITY.equals(uri.getAuthority())) return false;
        try {
            String type = getContentResolver().getType(uri);
            return type != null && type.startsWith("image/");
        } catch (Exception denied) { return false; }
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if(request==FileExport.REQUEST){fileExport.handle(result,data);return;}
        if (request == PICK_IMAGE) {
            ArrayList<Uri> selected = new ArrayList<>();
            if (result == RESULT_OK) {
                if (cameraUri != null && cameraFile != null && cameraFile.length() > 0) selected.add(cameraUri);
                else if (data != null) {
                    ClipData clip = data.getClipData();
                    if (clip != null) {
                        for (int i = 0; i < Math.min(clip.getItemCount(), 9); i++) {
                            Uri uri = clip.getItemAt(i).getUri();
                            if (allowedPhoto(uri) && !selected.contains(uri)) selected.add(uri);
                        }
                    } else if (allowedPhoto(data.getData())) selected.add(data.getData());
                }
            }
            if (!selected.isEmpty() && cameraFile != null) getSharedPreferences("capture-pending",0).edit().putBoolean("ready",true).commit();
            if (imageCallback != null) {
                imageCallback.onReceiveValue(selected.isEmpty() ? null : selected.toArray(new Uri[0]));
            }
            else if (web != null && !selected.isEmpty()) web.evaluateJavascript("window.dispatchEvent(new Event('forest-capture-ready'))",null);
            imageCallback = null;
            if (selected.isEmpty()) releaseCapture();
        } else if (request == EXPORT_CSV) {
            final String csv = pendingCsv;
            pendingCsv = null;
            if (result != RESULT_OK || data == null || data.getData() == null || csv == null) return;
            Uri destination = data.getData();
            if (!"content".equals(destination.getScheme()) || CaptureProvider.AUTHORITY.equals(destination.getAuthority())) return;
            new Thread(() -> {
                String message;
                try (OutputStream output = getContentResolver().openOutputStream(destination, "wt")) {
                    if (output == null) throw new IllegalStateException("no output");
                    output.write(csv.getBytes(StandardCharsets.UTF_8));
                    message = "CSV已保存";
                } catch (Exception error) { message = "保存失败，请重试"; }
                final String resultMessage = message;
                runOnUiThread(() -> Toast.makeText(MainActivity.this, resultMessage, Toast.LENGTH_SHORT).show());
            }, "forest-export").start();
        }
    }
    @Override protected void onDestroy() {
        if (baidu != null) baidu.close();
        if (taxonomy != null) taxonomy.close();
        if (fileExport != null) fileExport.cancel();
        if (imageCallback != null) imageCallback.onReceiveValue(null);
        if (web != null) { web.removeJavascriptInterface("ForestAndroidPreview"); web.destroy(); }
        super.onDestroy();
    }
}
