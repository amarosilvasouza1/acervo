import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Execute the real Java interception/bridge code with minimal Android boundary
// fixtures. SecureTransport's fixture counts opens and never accesses a network.
const stubs = {
  'android/content/Context.java': `package android.content;
    import java.io.File; import android.content.res.AssetManager;
    public class Context { private final File files; public Context(File value) { files=value; }
      public Context getApplicationContext(){return this;} public File getFilesDir(){return files;}
      public AssetManager getAssets(){return new AssetManager();} }`,
  'android/content/res/AssetManager.java': `package android.content.res;
    import java.io.*; import java.nio.charset.StandardCharsets;
    public class AssetManager { public InputStream open(String name) throws IOException {
      return new ByteArrayInputStream("window.fixture='__ACERVO_DOCUMENT_NONCE__';".getBytes(StandardCharsets.UTF_8)); } }`,
  'android/net/Uri.java': `package android.net;
    import java.net.URI; public class Uri { private final URI uri; private Uri(String value){uri=URI.create(value);}
      public static Uri parse(String value){return new Uri(value);} public String getScheme(){return uri.getScheme();}
      @Override public String toString(){return uri.toString();} }`,
  'android/util/Base64.java': `package android.util;
    public class Base64 { public static final int DEFAULT=0, NO_WRAP=2, URL_SAFE=8, NO_PADDING=1;
      public static String encodeToString(byte[] value,int flags){return encodeToString(value,0,value.length,flags);}
      public static String encodeToString(byte[] value,int offset,int count,int flags){
        java.util.Base64.Encoder encoder=(flags&URL_SAFE)!=0?java.util.Base64.getUrlEncoder():java.util.Base64.getEncoder();
        if((flags&NO_PADDING)!=0)encoder=encoder.withoutPadding();return encoder.encodeToString(java.util.Arrays.copyOfRange(value,offset,offset+count));}
      public static byte[] decode(String value,int flags){return java.util.Base64.getDecoder().decode(value);} }`,
  'android/webkit/JavascriptInterface.java': `package android.webkit; public @interface JavascriptInterface {}`,
  'android/webkit/WebResourceRequest.java': `package android.webkit;
    import android.net.Uri; import java.util.Map;
    public interface WebResourceRequest { Uri getUrl(); String getMethod(); Map<String,String> getRequestHeaders(); boolean isForMainFrame(); }`,
  'android/webkit/WebResourceResponse.java': `package android.webkit;
    import java.io.InputStream;import java.util.Map;
    public class WebResourceResponse { private final String mime,encoding,reason;private final int status;private final Map<String,String> headers;private InputStream body;
      public WebResourceResponse(String m,String e,int s,String r,Map<String,String> h,InputStream b){mime=m;encoding=e;status=s;reason=r;headers=h;body=b;}
      public InputStream getData(){return body;}public void setData(InputStream b){body=b;}public int getStatusCode(){return status;}
      public String getMimeType(){return mime;}public String getReasonPhrase(){return reason;}public Map<String,String> getResponseHeaders(){return headers;} }`,
  'android/webkit/WebView.java': `package android.webkit;
    import java.util.*; public class WebView { public Object bridge;public final List<String> events=Collections.synchronizedList(new ArrayList<>());
      public void addJavascriptInterface(Object value,String name){bridge=value;} public void removeJavascriptInterface(String name){bridge=null;}
      public boolean post(Runnable action){action.run();return true;}public void evaluateJavascript(String js,Object callback){events.add(js);} }`,
  'android/webkit/CookieManager.java': `package android.webkit;
    import java.util.function.Consumer; public class CookieManager { private static final CookieManager INSTANCE=new CookieManager();
      public static CookieManager getInstance(){return INSTANCE;}public String getCookie(String origin){return null;}
      public void setCookie(String origin,String cookie,Consumer<Boolean> done){done.accept(true);}public void flush(){} }`,
  'org/json/JSONException.java': `package org.json;public class JSONException extends Exception{public JSONException(String value){super(value);}}`,
  'org/json/JSONObject.java': `package org.json;
    import java.util.*;public class JSONObject{private final Map<String,Object> values=new LinkedHashMap<>();
      public JSONObject(){}public JSONObject(String json)throws JSONException{if(!"{}".equals(json))throw new JSONException("Fixture only accepts empty request headers");}
      public JSONObject(Map<?,?> map){map.forEach((key,value)->values.put(String.valueOf(key),value));}
      public JSONObject put(String key,Object value)throws JSONException{values.put(key,value);return this;}
      public Iterator<String> keys(){return values.keySet().iterator();}public String getString(String key)throws JSONException{if(!values.containsKey(key))throw new JSONException("missing");return String.valueOf(values.get(key));}
      private static String json(Object value){if(value==null)return "null";if(value instanceof Number||value instanceof Boolean||value instanceof JSONObject)return value.toString();
        String quote=String.valueOf((char)34);return quote+String.valueOf(value).replace("\\\\","\\\\\\\\").replace(quote,"\\\\"+quote)+quote;}
      @Override public String toString(){StringJoiner join=new StringJoiner(",","{","}");values.forEach((key,value)->join.add(json(key)+":"+json(value)));return join.toString();}}`,
  'br/com/acervo/app/MobileLibrary.java': `package br.com.acervo.app;
    import android.content.Context;import java.io.*;import java.util.concurrent.ConcurrentHashMap;
    public class MobileLibrary{public static final ConcurrentHashMap<String,Track> tracks=new ConcurrentHashMap<>();
      public static class Track{public final String filename;public Track(String value){filename=value;}}
      public MobileLibrary(Context context)throws IOException{}public Track get(String id){return tracks.get(id);} }`,
  'br/com/acervo/app/SecureTransport.java': `package br.com.acervo.app;
    import android.content.Context;import java.net.*;import java.io.*;import java.util.*;import java.util.concurrent.atomic.AtomicInteger;
    public class SecureTransport{public static final AtomicInteger opens=new AtomicInteger();
      public static HttpURLConnection open(Context context,String target,String origin)throws IOException{opens.incrementAndGet();return new HttpURLConnection(new URL(target)){
        public void connect(){}public void disconnect(){}public boolean usingProxy(){return false;}public int getResponseCode(){return 200;}public String getResponseMessage(){return "OK";}
        public String getContentType(){return "text/html";}public long getContentLengthLong(){return 26;}public Map<String,List<String>> getHeaderFields(){return Collections.emptyMap();}
        public InputStream getInputStream(){return new ByteArrayInputStream("<html><head></head></html>".getBytes(java.nio.charset.StandardCharsets.UTF_8));}};} }`,
};

const integration = `package br.com.acervo.app;
import android.content.Context;import android.net.Uri;import android.webkit.*;import java.io.*;import java.lang.reflect.*;import java.nio.charset.StandardCharsets;import java.nio.file.*;import java.util.*;
public final class SecureLocalAudioIntegrationTest {
  static final String ID="aBcDeF123_-", ORIGIN="https://pc.example:4311";static int checks;
  static void check(boolean value,String message){checks++;if(!value)throw new AssertionError(message);}
  static WebResourceRequest request(String target,String method,String range,boolean main){return new WebResourceRequest(){
    public Uri getUrl(){return Uri.parse(target);}public String getMethod(){return method;}public boolean isForMainFrame(){return main;}
    public Map<String,String> getRequestHeaders(){return range==null?Collections.emptyMap():Collections.singletonMap("Range",range);}};}
  static String key(SecureWebClient client)throws Exception{Field field=SecureWebClient.class.getDeclaredField("documentKey");field.setAccessible(true);return(String)field.get(client);}
  static void bridge(WebView view,String key,int id,String target)throws Exception{Method method=view.bridge.getClass().getDeclaredMethod("request",String.class,int.class,String.class,String.class,String.class,String.class,boolean.class);method.setAccessible(true);method.invoke(view.bridge,key,id,"GET",target,"{}","",true);}
  static String events(WebView view){synchronized(view.events){return String.join("\\n",view.events);}}
  static void awaitEnd(WebView view,int id)throws Exception{long end=System.nanoTime()+3000000000L;while(System.nanoTime()<end){String events=events(view);if(events.contains("\\\"id\\\":"+id+",\\\"type\\\":\\\"end\\\""))return;Thread.sleep(5);}throw new AssertionError("Native job failed to finish: "+events(view));}
  public static void main(String[] arguments)throws Exception{
    Path files=Files.createTempDirectory("acervo-secure-local-fixture-");Path folder=Files.createDirectory(files.resolve("mobile-audio"));byte[] audio=new byte[170123];for(int i=0;i<audio.length;i++)audio[i]=(byte)(i*17);
    Files.write(folder.resolve(ID+".m4a"),audio);MobileLibrary.tracks.put(ID,new MobileLibrary.Track(ID+".m4a"));
    WebView view=new WebView();SecureWebClient client=new SecureWebClient(view,new Context(files.toFile()),ORIGIN);client.attach();
    try{
      for(String range:new String[]{null,"bytes=0-","bytes=44000-"}){WebResourceResponse response=client.intercept(request(ORIGIN+"/api/stream/"+ID,"GET",range,false));
        try(InputStream input=response.getData()){check(SecureTransport.opens.get()==0,"Saved audio must open zero PC requests");check(response.getMimeType().equals("audio/mp4"),"Phone M4A is served with actual MIME");
          check(Arrays.equals(range!=null&&range.startsWith("bytes=44000")?Arrays.copyOfRange(audio,44000,audio.length):audio,input.readAllBytes()),"HTML media receives the full local file or exact seek suffix");}}
      WebResourceResponse head=client.intercept(request(ORIGIN+"/api/stream/"+ID,"HEAD",null,false));try(InputStream body=head.getData()){check(body.read()==-1&&head.getResponseHeaders().get("Content-Length").equals(String.valueOf(audio.length)),"HEAD is local and bodyless");}
      check(SecureTransport.opens.get()==0,"Range and HEAD never contact the server");
      check(client.intercept(request("https://outside.example/api/stream/"+ID,"GET",null,false))==null,"External origins do not receive private phone audio through the app transport");
      WebResourceResponse blocked=client.intercept(request("https://outside.example/api/stream/"+ID,"GET",null,true));try(InputStream body=blocked.getData()){check(blocked.getStatusCode()==502,"External main frame is blocked");}
      check(SecureTransport.opens.get()==0,"External and invalid requests do not cause a PC request");
      WebResourceResponse live=client.intercept(request(ORIGIN+"/api/stream/"+ID,"GET",null,false));client.newDocument();boolean closed=false;try{live.getData().read();}catch(IOException expected){closed=true;}check(closed,"Replacing the document closes outstanding local media descriptors");
      String capability=key(client);bridge(view,"wrong-document",1,ORIGIN+"/api/stream/"+ID);check(view.events.isEmpty(),"Wrong-document bridge capability cannot read phone audio");
      bridge(view,capability,2,ORIGIN+"/api/stream/"+ID);awaitEnd(view,2);check(SecureTransport.opens.get()==0,"Native fetch for saved audio also opens zero PC requests");
      check(events(view).contains("audio/mp4"),"Native fetch reports the local MIME");
      ByteArrayOutputStream received=new ByteArrayOutputStream();java.util.regex.Matcher chunks=java.util.regex.Pattern.compile("\\\"data\\\":\\\"([A-Za-z0-9+/=]+)\\\"").matcher(events(view));while(chunks.find())received.write(java.util.Base64.getDecoder().decode(chunks.group(1)));
      check(Arrays.equals(audio,received.toByteArray()),"Native bridge chunks reconstruct the complete local file");
      int previousEvents=view.events.size();client.newDocument();bridge(view,capability,3,ORIGIN+"/api/stream/"+ID);check(view.events.size()==previousEvents,"Rotating a document invalidates its previous capability");
      bridge(view,key(client),4,"https://outside.example/api/stream/"+ID);check(events(view).contains("\\\"type\\\":\\\"error\\\""),"Native bridge rejects other origins before audio lookup");check(SecureTransport.opens.get()==0,"Rejected origin never reaches PC transport");
      WebResourceResponse missing=client.intercept(request(ORIGIN+"/api/stream/ZyXwVu987_-","GET",null,false));try(InputStream body=missing.getData()){body.readAllBytes();}check(SecureTransport.opens.get()==1,"Only a track missing from the phone follows authenticated PC transport");
      MobileLibrary.tracks.put(ID,new MobileLibrary.Track("../outside.m4a"));WebResourceResponse unsafe=client.intercept(request(ORIGIN+"/api/stream/"+ID,"GET",null,false));try(InputStream body=unsafe.getData()){check(new String(body.readAllBytes(),StandardCharsets.UTF_8).startsWith("<html>"),"Unsafe metadata cannot expose a local file");}check(SecureTransport.opens.get()==2,"Rejected local metadata uses the normal server fallback");
      client.dispose();WebResourceResponse disposed=client.intercept(request(ORIGIN+"/api/stream/"+ID,"GET",null,false));try(InputStream body=disposed.getData()){check(disposed.getStatusCode()==502,"Disposed transport cannot serve private audio");}check(SecureTransport.opens.get()==2,"Disposed transport does not open new server requests");
      System.out.println("Secure local audio integration: "+checks+" checks passed.");
    }finally{client.dispose();try(java.util.stream.Stream<Path> paths=Files.walk(files)){paths.sorted(Comparator.reverseOrder()).forEach(path->{try{Files.delete(path);}catch(IOException error){throw new UncheckedIOException(error);}});}}
  }
}`;

test('real SecureWebClient uses phone bytes with zero PC audio requests and preserves origin/document boundaries', async t => {
  let javaHome = process.env.ACERVO_JAVA_HOME || process.env.JAVA_HOME;
  if (!javaHome) {
    const toolchain = join(process.env.USERPROFILE || homedir(), 'AppData/Local/Temp/acervo-android-toolchain/toolchain.json');
    if (existsSync(toolchain)) javaHome = JSON.parse(await readFile(toolchain, 'utf8')).javaHome;
  }
  const suffix = process.platform === 'win32' ? '.exe' : '';
  if (!javaHome || !existsSync(join(javaHome, `bin/javac${suffix}`))) { t.skip('Set ACERVO_JAVA_HOME to JDK 21 to run native interception integration'); return; }
  const temporary = await mkdtemp(join(tmpdir(), 'acervo-secure-local-test-'));
  try {
    const fixtures = { ...stubs, 'br/com/acervo/app/SecureLocalAudioIntegrationTest.java': integration };
    const inputs = [];
    for (const [name, source] of Object.entries(fixtures)) {
      const target = join(temporary, name); await mkdir(dirname(target), { recursive: true }); await writeFile(target, source); inputs.push(target);
    }
    const production = resolve(dirname(fileURLToPath(import.meta.url)), '../app/src/main/java/br/com/acervo/app');
    for (const name of ['WebTransport', 'SecureWebClient', 'LocalAudio', 'LocalAudioResponse', 'PairingLink', 'TransportFailure']) inputs.push(join(production, `${name}.java`));
    const compiled = spawnSync(join(javaHome, `bin/javac${suffix}`), ['--release', '11', '-encoding', 'UTF-8', '-d', temporary, ...inputs], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    const result = spawnSync(join(javaHome, `bin/java${suffix}`), ['-cp', temporary, 'br.com.acervo.app.SecureLocalAudioIntegrationTest'], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /integration: \d+ checks passed/);
    t.diagnostic(result.stdout.trim());
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
