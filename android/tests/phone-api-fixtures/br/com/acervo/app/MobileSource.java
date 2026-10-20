package br.com.acervo.app;
import java.util.*;
import java.io.IOException;
public final class MobileSource {
    static int searches, resolves;
    static final String ID = "fixtureA001";
    public static final class Song {
        public final String id,title,artist,thumbnail,url,extension,mime; public final long duration;
        public Song(String id,String title,String artist,String thumbnail,String url,long duration,String extension,String mime) { this.id=id;this.title=title;this.artist=artist;this.thumbnail=thumbnail;this.url=url;this.duration=duration;this.extension=extension;this.mime=mime; }
    }
    public static List<Song> search(String query) throws Exception { searches++; if(query == null || query.trim().isEmpty()) throw new IOException("Digite uma música."); return Collections.singletonList(new Song(ID,"Título", "Artista", "", "", 180, "mp3", "audio/mpeg")); }
    public static List<Song> related(String id) { return Collections.singletonList(new Song(ID,"Título", "Artista", "", "", 180, "mp3", "audio/mpeg")); }
    public static Song resolve(String id) throws Exception { resolves++; throw new IOException("Fonte indisponível na fixture"); }
    public static String videoId(String text) { if(text==null)return null; if(text.matches("[A-Za-z0-9_-]{11}"))return text; return text.startsWith("https://www.youtube.com/watch?v=") ? videoId(text.substring(32)) : null; }
}
