package cn.zhihuilinye.preview;

import android.app.Activity;
import android.webkit.WebView;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

/** Public name lookups only: fixed HTTPS hosts/paths, no photos or credentials. */
final class TaxonomyHttp {
    private final Activity activity;
    private final WebView web;
    private volatile boolean closed;
    private volatile HttpsURLConnection active;
    private long nextRequest;
    private final ThreadPoolExecutor worker = new ThreadPoolExecutor(1,1,0,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<Runnable>(8));
    TaxonomyHttp(Activity activity, WebView web) { this.activity=activity; this.web=web; }
    static String endpoint(String operation,String query) throws Exception {
        int limit="inat-taxa".equals(operation) || "wiki-entities".equals(operation) ? 400 : 180;
        if (query==null || query.isEmpty() || query.length()>limit) throw new Exception("分类查询名称不正确");
        String q=URLEncoder.encode(query,"UTF-8");
        switch(operation) {
            case "inat-search": return "https://api.inaturalist.org/v1/taxa/autocomplete?q="+q+"&taxon_id=47126&locale=zh-CN&per_page=30";
            case "inat-taxa":
                if(!query.matches("\\d+(,\\d+){0,29}")) throw new Exception("分类编号不正确");
                return "https://api.inaturalist.org/v1/taxa/"+query+"?locale=zh-CN";
            case "gbif-match": return "https://api.gbif.org/v2/species/match?scientificName="+q+"&kingdom=Plantae&checklistKey=7ddf754f-d193-4cc9-b351-99906754a03b";
            case "wiki-search": return "https://www.wikidata.org/w/api.php?action=wbsearchentities&search="+q+"&language=zh&format=json&limit=10&origin=*&maxlag=5";
            case "wiki-entities":
                if(!query.matches("Q\\d+(\\|Q\\d+){0,9}")) throw new Exception("分类编号不正确");
                return "https://www.wikidata.org/w/api.php?action=wbgetentities&ids="+q+"&props=claims%7Caliases%7Clabels&languages=zh%7Czh-cn%7Czh-hans%7Czh-tw%7Cen&format=json&origin=*&maxlag=5";
            default: throw new Exception("不支持的分类查询");
        }
    }
    void request(String id,String operation,String query) {
        if(closed || id==null || !id.matches("tax-[A-Za-z0-9-]{1,100}")) return;
        try {
            final String url=endpoint(operation,query);
            worker.execute(() -> {
                JSONObject data=new JSONObject();
                try {
                    long delay=nextRequest-System.currentTimeMillis();
                    if(delay>0) Thread.sleep(delay);
                    nextRequest=System.currentTimeMillis()+1050;
                    data.put("result",get(url));
                } catch(Exception error) {
                    if ((activity.getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0)
                        android.util.Log.w("ForestTaxonomy",operation+": "+error.getClass().getSimpleName()+" "+error.getMessage());
                    try { data.put("error",error.getMessage()!=null && error.getMessage().equals("429") ? "429 分类库繁忙，请稍后重试" : "分类库暂不可用，请稍后重试"); } catch(Exception ignored) {}
                }
                send(id,data);
            });
        } catch(Exception error) { try { send(id,new JSONObject().put("error","无法开始分类查询")); } catch(Exception ignored) {} }
    }
    private JSONObject get(String url) throws Exception {
        HttpsURLConnection connection=(HttpsURLConnection)new URL(url).openConnection(); active=connection;
        try {
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(7000); connection.setReadTimeout(12000);
            connection.setRequestProperty("Accept","application/json");
            connection.setRequestProperty("User-Agent","Smart-Forestry/0.3 (+https://github.com/Vickylines/Smart_Forestry)");
            int status=connection.getResponseCode();
            if(status!=200) throw new Exception(String.valueOf(status));
            long deadline=System.currentTimeMillis()+16000;
            try(InputStream stream=connection.getInputStream(); ByteArrayOutputStream bytes=new ByteArrayOutputStream()) {
                byte[] buffer=new byte[8192]; int count;
                while((count=stream.read(buffer))!=-1) {
                    if(closed || bytes.size()+count>2*1024*1024 || System.currentTimeMillis()>deadline) throw new Exception("response limit");
                    bytes.write(buffer,0,count);
                }
                return new JSONObject(new String(bytes.toByteArray(),StandardCharsets.UTF_8));
            }
        } finally { active=null; connection.disconnect(); }
    }
    private void send(String id,JSONObject data) {
        if(closed) return;
        try {
            data.put("id",id);
            String json=JSONObject.quote(data.toString());
            activity.runOnUiThread(() -> { if(!closed) web.evaluateJavascript("window.dispatchEvent(new CustomEvent('forest-taxonomy-result',{detail:JSON.parse("+json+")}))",null); });
        } catch(Exception ignored) {}
    }
    void close() { closed=true; worker.shutdownNow(); HttpsURLConnection connection=active; if(connection!=null) connection.disconnect(); }
}
