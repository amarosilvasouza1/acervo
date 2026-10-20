package br.com.acervo.app;

import android.content.Context;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;

/** Runs the real phone API and disk library with deterministic source/Android test adapters. */
public final class PhoneApiTest {
    private static int checks;
    private static void check(boolean condition,String label) { checks++; if(!condition) throw new AssertionError(label); }
    private static JSONObject json(PhoneApi.Response response) throws Exception { return new JSONObject(new String(response.body, StandardCharsets.UTF_8)); }
    private static PhoneApi.Response call(PhoneApi api,String method,String path,JSONObject value) { return api.handle(method,path,value==null ? "" : value.toString()); }
    private static JSONObject awaitJob(PhoneApi api,String jobId) throws Exception {
        long end = System.nanoTime() + 3000000000L;
        while(System.nanoTime() < end) { JSONObject job=json(call(api,"GET","/api/jobs/"+jobId,null)); if("done".equals(job.optString("status")) || "error".equals(job.optString("status")))return job; Thread.sleep(5); }
        throw new AssertionError("job não terminou");
    }
    public static void main(String[] args) throws Exception {
        try { run(); System.out.println(checks+" phone API/runtime checks passed"); System.exit(0); }
        catch(Throwable failure) { failure.printStackTrace(); System.exit(1); }
    }
    private static void run() throws Exception {
        File files=Files.createTempDirectory("acervo-phone-api-test-").toFile(); Context context=new Context(files);
        PhoneApi api=PhoneApi.instance(context);
        check(api==PhoneApi.instance(new Context(new File(files,"."))),"single store for screens");
        check(json(call(api,"GET","/api/library",null)).getJSONArray("tracks").length()==0,"empty disk library");
        check(call(api,"GET","https://outside.example/api/library",null).status==403,"reject foreign origin");
        check(call(api,"GET","/api/library#fragment",null).status==400,"reject fragment");
        int searches=MobileSource.searches;
        check(call(api,"GET","/api/search?q=",null).status==422 && MobileSource.searches==searches,"empty search stays offline");
        File audio=new File(files,"import.mp3"); Files.write(audio.toPath(),new byte[]{1,2,3,4});
        api.library().importFile(MobileSource.ID,"Título","Artista",180,audio);
        JSONObject library=json(call(api,"GET","/api/library",null)); JSONObject track=library.getJSONArray("tracks").getJSONObject(0);
        check(track.optString("id").equals(MobileSource.ID) && track.optString("videoId").equals(MobileSource.ID),"web track IDs");
        check(track.optString("addedAt").contains("T") && track.optLong("duration")==180,"web duration and dates");
        check(library.optJSONObject("stats").optLong("duration")==180,"web stats");
        JSONObject imported=json(call(api,"POST","/api/import",new JSONObject().put("videoId",MobileSource.ID)));
        String existingJob=imported.getString("jobId");
        check(awaitJob(api,existingJob).optString("status").equals("done") && MobileSource.resolves==0,"already saved skips extraction/network audio");
        check(existingJob.equals(json(call(api,"POST","/api/import",new JSONObject().put("videoId",MobileSource.ID))).optString("jobId")),"reuses saved download job");
        JSONObject queryJob=json(call(api,"POST","/api/import",new JSONObject().put("query","Título Artista")));
        check(awaitJob(api,queryJob.getString("jobId")).optString("trackId").equals(MobileSource.ID) && MobileSource.searches==searches+1 && MobileSource.resolves==0,"query import resolves search then reuses local audio");
        api.close(); check(api==PhoneApi.instance(context),"screen close retains application queue");
        check(call(api,"POST","/api/import",new JSONObject().put("videoId","../bad")).status==422,"reject invalid download ID");
        check(json(call(api,"POST","/api/track/"+MobileSource.ID+"/play",new JSONObject())).optLong("plays")==1,"play increments real disk history");
        check(json(call(api,"GET","/api/history",null)).getJSONArray("items").length()==1,"history shape");
        api.library().importFile("fixtureB002","Segunda","Artista",210,audio);
        JSONObject recommendation=json(call(api,"GET","/api/recommend/"+MobileSource.ID,null)).getJSONArray("items").getJSONObject(0);
        check(recommendation.optLong("score")==100 && recommendation.getJSONArray("reasons").length()==1 && recommendation.optJSONObject("track")!=null,"recommendation contract");
        check(json(call(api,"GET","/api/artist?name=Artista",null)).getJSONArray("localTracks").length()==2,"artist page retains offline tracks");
        check(json(call(api,"GET","/api/explore?section=recent",null)).getJSONArray("items").length()==1,"recent feed uses listens");
        PhoneApi.Response radio=call(api,"POST","/api/radio",new JSONObject().put("seedId",MobileSource.ID)); String frames=new String(radio.body,StandardCharsets.UTF_8);
        check(radio.mime.equals("text/event-stream") && frames.contains("event: start\n") && frames.contains("event: results\n") && frames.contains("event: done\n"),"radio frames compatible with web parser");
        String csv="Track Name,Artist Name(s),Video ID\nSegunda,Artista,fixtureB002";
        JSONObject preview=json(call(api,"POST","/api/playlist/resolve",new JSONObject().put("fileText",csv)));
        check(preview.getJSONArray("entries").length()==1 && !preview.optString("previewId").isEmpty(),"CSV preview contract");
        JSONObject created=json(call(api,"POST","/api/playlists/import",new JSONObject().put("previewId",preview.getString("previewId"))));
        String playlistId=created.optJSONObject("playlist").getString("id");
        check(created.optLong("total")==0 && created.optJSONObject("playlist").getJSONArray("entries").getJSONObject(0).optString("status").equals("done"),"playlist uses saved audio without download");
        check(new File(files,"mobile-playlists.json").isFile(),"playlist persisted privately");
        check(json(call(api,"GET","/api/playlists/"+playlistId+"/report",null)).optJSONObject("summary").optLong("done")==1,"playlist report success");
        check(call(api,"DELETE","/api/playlists/"+playlistId,null).status==200 && json(call(api,"GET","/api/playlists",null)).getJSONArray("playlists").length()==0,"playlist deletion persistence");
        JSONArray playlistSet=new JSONArray().put(new JSONObject().put("name","Primeira").put("items",new JSONArray())).put(new JSONObject().put("name","Segunda").put("items",new JSONArray()));
        JSONObject choice=json(call(api,"POST","/api/playlist/resolve",new JSONObject().put("fileText",new JSONObject().put("playlists",playlistSet).toString())));
        check(choice.getJSONArray("choices").length()==2,"multiple JSON playlists require selection");
        check(call(api,"DELETE","/api/track/"+MobileSource.ID,null).status==200,"remove saved track");
        String newJob=json(call(api,"POST","/api/import",new JSONObject().put("videoId",MobileSource.ID))).getString("jobId");
        check(!newJob.equals(existingJob) && awaitJob(api,newJob).optString("status").equals("error"),"deleted audio does not reuse obsolete success");
        check(MobileSource.resolves==1,"only missing audio reaches source extraction");
        check(json(call(api,"GET","/api/jobs/"+newJob,null)).optString("error").contains("indisponível"),"download failure visible in UI");
        check(call(api,"GET","/api/library",null).status==200,"library remains available after source failure");
    }
}
