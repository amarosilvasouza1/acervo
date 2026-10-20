package br.com.acervo.app;

import android.content.Context;
import android.webkit.WebResourceResponse;
import java.io.IOException;
import java.util.Map;

/** Serves an existing private library copy before any PC audio request is opened. */
public final class LocalAudio {
    private LocalAudio() { }

    /** Call only after checking the request belongs to a trusted app document's origin. */
    public static WebResourceResponse intercept(Context context, String target, String method, Map<String, String> headers) throws IOException {
        LocalAudioResponse response = open(context, target, method, headers);
        return response == null ? null : new WebResourceResponse(response.mime, null, response.status, response.reason, response.headers, response.body);
    }

    static LocalAudioResponse open(Context context, String target, String method, Map<String, String> headers) throws IOException {
        String id = LocalAudioResponse.trackId(target);
        if (id == null || !("GET".equals(method) || "HEAD".equals(method))) return null;
        MobileLibrary library = new MobileLibrary(context);
        MobileLibrary.Track track = library.get(id);
        return track == null ? null : LocalAudioResponse.open(context.getFilesDir(), id, track.filename, method, headers);
    }
}
