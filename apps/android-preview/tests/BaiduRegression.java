package cn.zhihuilinye.preview;

import android.app.Instrumentation;
import android.os.Bundle;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.cert.Certificate;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

/** Included only in the isolated inspection APK; never sends a network request. */
public final class BaiduRegression extends Instrumentation {
    private static volatile int tokenCalls;
    private static volatile boolean rejectCredentials;
    private static volatile boolean queryLeaked;
    private final LinkedBlockingQueue<String> replies = new LinkedBlockingQueue<>();
    private BaiduDirect direct;
    private WebView web;

    @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); start(); }
    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            URL.setURLStreamHandlerFactory(protocol -> "https".equals(protocol) ? new URLStreamHandler() {
                @Override protected URLConnection openConnection(URL url) { return new FakeConnection(url); }
            } : null);
            runOnMainSync(() -> {
                web = new WebView(getTargetContext()) {
                    @Override public boolean post(Runnable action) { return new android.os.Handler(android.os.Looper.getMainLooper()).post(action); }
                    @Override public void evaluateJavascript(String script, ValueCallback<String> callback) { replies.add(script); }
                };
                direct = new BaiduDirect(getTargetContext(), web);
            });
            require(direct.save("QA-ONLY-API-KEY", "QA-ONLY-SECRET"), "Cannot set QA credentials");
            JSONObject first = request("first", "");
            require(first.getJSONObject("result").getBoolean("authenticated"), "Initial validation failed");
            require(tokenCalls == 1, "Initial validation did not authenticate");
            rejectCredentials = true;
            JSONObject revoked = request("revoked", "");
            require(!revoked.isNull("error"), "Validation incorrectly trusted the cached token");
            require(tokenCalls == 2, "Explicit validation did not contact OAuth again");
            rejectCredentials = false;
            require(request("retry", "").isNull("error"), "Failed validation prevented retry");
            require(tokenCalls == 3, "Retry did not refresh authentication");
            require(request("photo", "YWJj").getJSONObject("result").getJSONArray("candidates").length() == 1, "Photo result unavailable");
            require(tokenCalls == 3, "Normal photos should reuse a valid token");
            require(!queryLeaked, "OAuth credentials appeared in the URL query");
            require(direct.save("", ""), "Request lock was not released after response");
            require(!direct.configured(), "Credentials were not removed");
            result.putString("stream", "PASS: fresh verification, revoked-key rejection, retry, recognition token cache, POST credentials, removal. Mock HTTPS only.\n");
            finish(-1, result);
        } catch (Throwable error) {
            result.putString("stream", "FAIL: " + error.getMessage() + "\n");
            finish(0, result);
        } finally {
            if (direct != null) { direct.save("", ""); direct.close(); }
            if (web != null) runOnMainSync(() -> web.destroy());
        }
    }
    private JSONObject request(String id, String image) throws Exception {
        direct.request(id, image);
        String script = replies.poll(10, TimeUnit.SECONDS);
        require(script != null, "No native reply");
        int start = script.indexOf("{detail:") + "{detail:".length();
        JSONObject response = new JSONObject(script.substring(start, script.lastIndexOf("}))")));
        require(id.equals(response.getString("id")), "Unexpected request response");
        return response;
    }
    private static void require(boolean condition, String message) { if (!condition) throw new AssertionError(message); }
    private static final class FakeConnection extends HttpsURLConnection {
        private final boolean oauth;
        FakeConnection(URL url) { super(url); oauth = url.getPath().contains("/oauth/"); }
        @Override public OutputStream getOutputStream() { return new ByteArrayOutputStream(); }
        @Override public int getResponseCode() { return 200; }
        @Override public InputStream getInputStream() {
            String body;
            if (oauth) {
                tokenCalls++;
                queryLeaked |= url.getQuery() != null;
                body = rejectCredentials ? "{\"error\":\"invalid_client\",\"error_description\":\"unknown client id\"}" : "{\"access_token\":\"QA-ONLY-TOKEN\",\"expires_in\":3600}";
            } else body = "{\"result\":[{\"name\":\"测试植物\",\"score\":0.8}]}";
            return new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8));
        }
        @Override public void connect() {}
        @Override public void disconnect() {}
        @Override public boolean usingProxy() { return false; }
        @Override public String getCipherSuite() { return "QA"; }
        @Override public Certificate[] getLocalCertificates() { return null; }
        @Override public Certificate[] getServerCertificates() { return new Certificate[0]; }
    }
}
