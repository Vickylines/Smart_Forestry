package cn.zhihuilinye.preview;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.webkit.WebView;
import org.json.*;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import javax.net.ssl.HttpsURLConnection;
import java.security.KeyStore;
import java.net.URL;
import java.net.URLEncoder;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.atomic.AtomicBoolean;

final class BaiduDirect {
 private final Context context; private final WebView web;
 private final ExecutorService worker=Executors.newSingleThreadExecutor();
 private final AtomicBoolean busy=new AtomicBoolean(false);
 private static final String ALIAS="forest-baidu-credentials";
 private String token="";private long expires=0,nextCall=0;
 BaiduDirect(Context c,WebView w){context=c;web=w;}
 private SecretKey encryptionKey() throws Exception {
  KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);
  if(!ks.containsAlias(ALIAS)){
   KeyGenerator g=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
   g.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());g.generateKey();
  }
  return (SecretKey)ks.getKey(ALIAS,null);
 }
 synchronized boolean save(String key,String secret){
  if(busy.get()||key==null||secret==null)return false;key=key.trim();secret=secret.trim();
  if(key.length()>4096||secret.length()>1024||key.matches(".*\\s.*")||secret.matches(".*\\s.*"))return false;
  if(!key.isEmpty()&&!key.startsWith("bce-v3/")&&secret.isEmpty())return false;
  if(key.isEmpty()&&!secret.isEmpty())return false;
  try{
   if(key.isEmpty()){
    if(!context.getSharedPreferences("baidu-private",0).edit().clear().commit())return false;
    token="";expires=0;
    KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);ks.deleteEntry(ALIAS);
    return true;
   }
   JSONObject data=new JSONObject().put("key",key).put("secret",secret);
   Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,encryptionKey());
   byte[] encrypted=cipher.doFinal(data.toString().getBytes(StandardCharsets.UTF_8));
   boolean ok=context.getSharedPreferences("baidu-private",0).edit().putString("iv",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)).putString("data",Base64.encodeToString(encrypted,Base64.NO_WRAP)).commit();
   token="";expires=0;return ok;
  }catch(Exception e){return false;}
 }
 private synchronized JSONObject credentials() throws Exception {
  SharedPreferences prefs=context.getSharedPreferences("baidu-private",0);String raw=prefs.getString("data","");if(raw.isEmpty())return new JSONObject();
  Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,encryptionKey(),new GCMParameterSpec(128,Base64.decode(prefs.getString("iv",""),Base64.NO_WRAP)));
  return new JSONObject(new String(cipher.doFinal(Base64.decode(raw,Base64.NO_WRAP)),StandardCharsets.UTF_8));
 }
 synchronized boolean configured(){try{return !credentials().optString("key").isEmpty();}catch(Exception e){return false;}}
 private JSONObject post(String address,String body,String bearer) throws Exception {
  HttpsURLConnection conn=(HttpsURLConnection)new URL(address).openConnection();
  conn.setInstanceFollowRedirects(false);conn.setConnectTimeout(15000);conn.setReadTimeout(25000);conn.setRequestMethod("POST");conn.setDoOutput(true);
  conn.setRequestProperty("Content-Type","application/x-www-form-urlencoded");
  if(bearer!=null)conn.setRequestProperty("Authorization","Bearer "+bearer);
  try{
   byte[] bytes=body.getBytes(StandardCharsets.UTF_8);conn.setFixedLengthStreamingMode(bytes.length);
   try(OutputStream out=conn.getOutputStream()){out.write(bytes);}
   int status=conn.getResponseCode();InputStream source=status<400?conn.getInputStream():conn.getErrorStream();
   if(source==null)throw new IOException("百度未返回响应");
   ByteArrayOutputStream out=new ByteArrayOutputStream();try(InputStream in=source){byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1){if(out.size()+n>1024*1024)throw new IOException("百度响应过大");out.write(b,0,n);}}
   JSONObject data=new JSONObject(out.toString("UTF-8"));
   if(data.has("error"))throw new IOException("unknown client id".equals(data.optString("error_description"))?"百度未接受 API Key，请检查填写内容":"百度鉴权失败，请检查 API Key 和 Secret Key");
   int code=data.optInt("error_code",0);
   if(code!=0){if(code==110||code==111){token="";expires=0;}throw new IOException(code==18||code==17||code==19||code==4?"百度额度不足或调用过快，请稍后重试":"百度识别失败，错误码 "+code);}
   if(status!=200)throw new IOException("百度服务暂不可用（"+status+"）");return data;
  }finally{conn.disconnect();}
 }
 private String accessToken(JSONObject c,boolean verify) throws Exception {
  if(!verify&&!token.isEmpty()&&expires>System.currentTimeMillis())return token;
  // Explicit validation must contact Baidu, including after a prior success.
  // A cached token cannot establish that a saved key is still valid.
  token="";expires=0;
  String query="grant_type=client_credentials&client_id="+URLEncoder.encode(c.optString("key"),"UTF-8")+"&client_secret="+URLEncoder.encode(c.optString("secret"),"UTF-8");
  JSONObject data=post("https://aip.baidubce.com/oauth/2.0/token",query,null);
  token=data.getString("access_token");expires=System.currentTimeMillis()+Math.max(0,data.optLong("expires_in")-120)*1000;return token;
 }
 synchronized void request(String requestId,String image){
  if(requestId==null||!requestId.matches("[A-Za-z0-9_-]{1,100}"))return;
  if(!busy.compareAndSet(false,true)){reply(requestId,null,"请等待当前识别请求完成");return;}
  worker.execute(()->{
   JSONObject response=null;String failure=null;
   try{
    JSONObject c=credentials();String key=c.optString("key");if(key.isEmpty())throw new IOException("请先填写百度识别密钥");
    boolean bearer=key.startsWith("bce-v3/");String access=bearer?"":accessToken(c,image==null||image.isEmpty());
    if(image==null||image.isEmpty()){
     // Bearer credentials require a business request; never upload a photo automatically.
     response=bearer?new JSONObject().put("authenticated",false).put("needsPhoto",true):new JSONObject().put("authenticated",true);
    }else{
     if(image.length()>4*1024*1024||!image.matches("[A-Za-z0-9+/]+={0,2}"))throw new IOException("照片编码无效或过大");
     long wait=nextCall-System.currentTimeMillis();if(wait>0)Thread.sleep(wait);nextCall=System.currentTimeMillis()+600;
     String endpoint="https://aip.baidubce.com/rest/2.0/image-classify/v1/plant"+(bearer?"":"?access_token="+URLEncoder.encode(access,"UTF-8"));
     JSONObject data=post(endpoint,"image="+URLEncoder.encode(image,"UTF-8")+"&baike_num=5",bearer?key:null);
     JSONArray raw=data.getJSONArray("result"),candidates=new JSONArray();
     for(int i=0;i<Math.min(5,raw.length());i++){
      JSONObject r=raw.getJSONObject(i);double score=r.getDouble("score");
      if(score<0||score>1||!Double.isFinite(score))throw new IOException("百度返回评分异常");
      JSONObject candidate=new JSONObject().put("name",r.getString("name")).put("scientificName","").put("score",score);
      JSONObject info=r.optJSONObject("baike_info");
      if(info!=null){
       String description=info.optString("description",""),source=info.optString("baike_url","");
       candidate.put("baikeInfo",new JSONObject().put("description",description.substring(0,Math.min(2000,description.length()))).put("baike_url",source.substring(0,Math.min(1000,source.length()))));
      }
      candidates.put(candidate);
     }
     response=new JSONObject().put("provider","baidu-plant").put("candidates",candidates);
    }
   }catch(Exception e){failure=e instanceof IOException?e.getMessage():"识别连接失败，请检查网络后重试";if(failure==null||failure.contains("https:")||failure.length()>100)failure="识别连接失败或超时，请稍后重试";}
   finally{busy.set(false);}
   // Release the single-request lock before JS starts the next photo or saves keys.
   reply(requestId,response,failure);
  });
 }
 private void reply(String id,JSONObject result,String error){
  try{JSONObject data=new JSONObject().put("id",id).put("result",result==null?JSONObject.NULL:result).put("error",error==null?JSONObject.NULL:error);
   web.post(()->web.evaluateJavascript("window.dispatchEvent(new CustomEvent('forest-baidu-result',{detail:"+data.toString()+"}))",null));
  }catch(Exception ignored){}
 }
 void close(){worker.shutdownNow();}
}
