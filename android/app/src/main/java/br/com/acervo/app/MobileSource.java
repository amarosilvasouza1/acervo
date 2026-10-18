package br.com.acervo.app;

import org.schabi.newpipe.extractor.InfoItem;
import org.schabi.newpipe.extractor.NewPipe;
import org.schabi.newpipe.extractor.ServiceList;
import org.schabi.newpipe.extractor.MediaFormat;
import org.schabi.newpipe.extractor.downloader.Downloader;
import org.schabi.newpipe.extractor.downloader.Request;
import org.schabi.newpipe.extractor.downloader.Response;
import org.schabi.newpipe.extractor.search.SearchExtractor;
import org.schabi.newpipe.extractor.stream.AudioStream;
import org.schabi.newpipe.extractor.stream.DeliveryMethod;
import org.schabi.newpipe.extractor.stream.StreamInfo;
import org.schabi.newpipe.extractor.stream.StreamInfoItem;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Device-side source adapter. No Acervo server, account or proxy is involved. */
public final class MobileSource {
    private static boolean initialized;

    public static final class Song {
        public final String id, title, artist, thumbnail, url, extension, mime;
        public final long duration;
        public Song(String id, String title, String artist, String thumbnail, String url,
                    long duration, String extension, String mime) {
            this.id = id; this.title = title; this.artist = artist; this.thumbnail = thumbnail;
            this.url = url; this.duration = duration; this.extension = extension; this.mime = mime;
        }
    }

    private MobileSource() { }

    private static synchronized void initialize() {
        if (!initialized) { NewPipe.init(new NativeDownloader()); initialized = true; }
    }

    public static List<Song> search(String query) throws Exception {
        initialize();
        query = query == null ? "" : query.trim();
        if (query.isEmpty() || query.length() > 500) throw new IOException("Digite uma música ou artista (até 500 caracteres).");
        String id = query.startsWith("https://") || query.startsWith("http://") ? videoId(query) : null;
        if (id != null) return Collections.singletonList(resolve(id));
        SearchExtractor extractor = ServiceList.YouTube.getSearchExtractor(query);
        extractor.fetchPage();
        List<Song> result = new ArrayList<>();
        Set<String> used = new HashSet<>();
        for (InfoItem item : extractor.getInitialPage().getItems()) {
            if (!(item instanceof StreamInfoItem)) continue;
            StreamInfoItem stream = (StreamInfoItem) item;
            String video = videoId(stream.getUrl());
            if (video == null || !used.add(video) || stream.getDuration() <= 0) continue;
            result.add(new Song(video, stream.getName(), stream.getUploaderName(),
                    stream.getThumbnails().isEmpty() ? "" : stream.getThumbnails().get(0).getUrl(),
                    "", stream.getDuration(), "", ""));
            if (result.size() >= 24) break;
        }
        return result;
    }

    public static Song resolve(String videoId) throws Exception {
        initialize();
        if (videoId == null || !videoId.matches("[A-Za-z0-9_-]{11}")) throw new IOException("Identificador da música inválido.");
        StreamInfo info = StreamInfo.getInfo(ServiceList.YouTube, "https://www.youtube.com/watch?v=" + videoId);
        AudioStream selected = null;
        for (AudioStream stream : info.getAudioStreams()) {
            if (!stream.isUrl() || stream.getDeliveryMethod() != DeliveryMethod.PROGRESSIVE_HTTP
                    || !stream.getContent().startsWith("https://")) continue;
            if (stream.getFormat() != MediaFormat.M4A && stream.getFormat() != MediaFormat.WEBMA
                    && stream.getFormat() != MediaFormat.WEBMA_OPUS) continue;
            if (selected == null || (stream.getFormat() == MediaFormat.M4A && selected.getFormat() != MediaFormat.M4A)
                    || (stream.getFormat() == selected.getFormat() && stream.getAverageBitrate() > selected.getAverageBitrate())) selected = stream;
        }
        if (selected == null) throw new IOException("Esta música não oferece áudio para baixar no celular. Tente outro resultado.");
        boolean m4a = selected.getFormat() == MediaFormat.M4A;
        return new Song(videoId, info.getName(), info.getUploaderName(),
                info.getThumbnails().isEmpty() ? "" : info.getThumbnails().get(0).getUrl(),
                selected.getContent(), info.getDuration(), m4a ? "m4a" : "webm", m4a ? "audio/mp4" : "audio/webm");
    }

    public static List<Song> related(String videoId) throws Exception {
        initialize();
        if (videoId == null || !videoId.matches("[A-Za-z0-9_-]{11}")) throw new IOException("Escolha uma música para iniciar a rádio.");
        StreamInfo info = StreamInfo.getInfo(ServiceList.YouTube, "https://www.youtube.com/watch?v=" + videoId);
        List<Song> result = new ArrayList<>();
        Set<String> used = new HashSet<>();
        used.add(videoId);
        if (info.getRelatedItems() == null) return result;
        for (InfoItem item : info.getRelatedItems()) {
            if (!(item instanceof StreamInfoItem)) continue;
            StreamInfoItem stream = (StreamInfoItem) item;
            String id = videoId(stream.getUrl());
            if (id == null || !used.add(id) || stream.getDuration() <= 0) continue;
            result.add(new Song(id, stream.getName(), stream.getUploaderName(),
                    stream.getThumbnails().isEmpty() ? "" : stream.getThumbnails().get(0).getUrl(),
                    "", stream.getDuration(), "", ""));
            if (result.size() >= 24) break;
        }
        return result;
    }

    static String videoId(String value) {
        if (value.matches("[A-Za-z0-9_-]{11}")) return value;
        try {
            URI uri = new URI(value);
            if (!"https".equalsIgnoreCase(uri.getScheme()) && !"http".equalsIgnoreCase(uri.getScheme())) return null;
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(java.util.Locale.ROOT);
            String candidate = null;
            if (host.equals("youtu.be")) candidate = uri.getPath().substring(1);
            else if (host.equals("youtube.com") || host.endsWith(".youtube.com")) {
                String path = uri.getPath();
                if (path.startsWith("/shorts/") || path.startsWith("/embed/")) candidate = path.split("/")[2];
                else for (String param : String.valueOf(uri.getRawQuery()).split("&")) {
                    if (param.startsWith("v=")) candidate = URLDecoder.decode(param.substring(2), "UTF-8");
                }
            }
            return candidate != null && candidate.matches("[A-Za-z0-9_-]{11}") ? candidate : null;
        } catch (Exception ignored) { return null; }
    }

    private static final class NativeDownloader extends Downloader {
        @Override public Response execute(Request request) throws IOException {
            URL target = new URL(request.url());
            if (!"https".equals(target.getProtocol())) throw new IOException("A fonte precisa usar HTTPS.");
            HttpURLConnection connection = (HttpURLConnection) target.openConnection();
            connection.setConnectTimeout(20000); connection.setReadTimeout(30000);
            connection.setRequestMethod(request.httpMethod());
            connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0");
            for (Map.Entry<String, List<String>> header : request.headers().entrySet())
                connection.setRequestProperty(header.getKey(), String.join(", ", header.getValue()));
            byte[] body = request.dataToSend();
            if (body != null) {
                connection.setDoOutput(true); connection.setFixedLengthStreamingMode(body.length);
                try (java.io.OutputStream out = connection.getOutputStream()) { out.write(body); }
            }
            try {
                int status = connection.getResponseCode();
                if (status == 429) throw new IOException("O YouTube limitou as buscas. Aguarde um pouco e tente novamente.");
                InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                if (input != null) try (InputStream in = input) {
                    byte[] buffer = new byte[16384]; int length;
                    while ((length = in.read(buffer)) != -1) {
                        if (Thread.currentThread().isInterrupted()) throw new IOException("Busca cancelada.");
                        if (bytes.size() + length > 32 * 1024 * 1024) throw new IOException("Resposta da fonte muito grande.");
                        bytes.write(buffer, 0, length);
                    }
                }
                return new Response(status, connection.getResponseMessage(), connection.getHeaderFields(),
                        new String(bytes.toByteArray(), StandardCharsets.UTF_8), connection.getURL().toString());
            } finally { connection.disconnect(); }
        }
    }
}
