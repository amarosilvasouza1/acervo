package br.com.acervo.app;
import java.io.File;
import java.util.*;
public final class MobileArtistCatalog {
    public static final class Album { public String title,picture,date; }
    public static final class Profile { public String picture,source; public List<String> titles=new ArrayList<>(); public List<Album> albums=new ArrayList<>(); }
    public static Profile saved(File files,String name) { return null; }
    public static Profile fetch(File files,String name,List<MobileLibrary.Track> local) { return null; }
}
