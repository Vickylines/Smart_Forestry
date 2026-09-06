package cn.zhihuilinye.preview;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import android.webkit.WebView;
import java.io.*;

/** Streams a bounded file to cache, then saves it to a location chosen by the user. */
final class FileExport {
    static final int REQUEST = 23;
    private final Activity activity;
    private final WebView web;
    private File file;
    private OutputStream stream;
    private String name, mime;
    private boolean choosing;
    private long size;
    FileExport(Activity activity, WebView web) { this.activity=activity; this.web=web; }
    synchronized boolean begin(String filename, String type) {
        if(file!=null || filename==null || !(filename.endsWith(".zip") || filename.endsWith(".csv")))return false;
        try {
            file=File.createTempFile("forest_export_",".tmp",activity.getCacheDir());
            stream=new FileOutputStream(file);size=0;
            name=filename.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]","_");
            if(name.length()>100)name="植物调查"+(filename.endsWith(".zip")?".zip":".csv");
            mime=filename.endsWith(".zip")?"application/zip":"text/csv";
            return true;
        }catch(Exception e){cancel();return false;}
    }
    synchronized boolean append(String data) {
        if(stream==null || choosing || data==null || data.length()>300000)return false;
        try {
            byte[] bytes=Base64.decode(data,Base64.NO_WRAP);
            if(size+bytes.length>210L*1024*1024){cancel();return false;}
            stream.write(bytes);size+=bytes.length;return true;
        }catch(Exception e){cancel();return false;}
    }
    synchronized void finish() {
        if(stream==null || choosing){result("failed");return;}
        try{stream.close();stream=null;}catch(Exception e){cancel();result("failed");return;}
        choosing=true;
        activity.runOnUiThread(()->{
            Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType(mime);intent.putExtra(Intent.EXTRA_TITLE,name);
            try{activity.startActivityForResult(intent,REQUEST);}catch(Exception e){cancel();result("failed");}
        });
    }
    void handle(int code, Intent data) {
        if(code!=Activity.RESULT_OK || data==null || data.getData()==null){cancel();result("cancelled");return;}
        final Uri destination=data.getData();
        if(!"content".equals(destination.getScheme()) || CaptureProvider.AUTHORITY.equals(destination.getAuthority())){cancel();result("failed");return;}
        new Thread(()->{
            String status="failed";
            synchronized(this) {
                try(InputStream input=new FileInputStream(file); OutputStream output=activity.getContentResolver().openOutputStream(destination,"wt")) {
                    if(output==null)throw new IOException("No destination");
                    byte[] buffer=new byte[65536];int count;
                    while((count=input.read(buffer))!=-1)output.write(buffer,0,count);
                    output.flush();status="saved";
                }catch(Exception e){}finally{cancel();}
            }
            result(status);
        },"forest-file-export").start();
    }
    synchronized void cancel() {
        if(stream!=null)try{stream.close();}catch(Exception ignored){}
        stream=null;if(file!=null)file.delete();file=null;choosing=false;size=0;
    }
    private void result(String status) {
        activity.runOnUiThread(()->{
            if(!activity.isFinishing())web.evaluateJavascript("window.dispatchEvent(new CustomEvent('forest-file-result',{detail:'"+status+"'}))",null);
        });
    }
}
