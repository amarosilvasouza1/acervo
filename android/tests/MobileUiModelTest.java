package br.com.acervo.app;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

public final class MobileUiModelTest {
    private static int checks;
    private static final class Track {
        final String id, title, artist;
        final long savedAt, playedAt, plays;
        Track(String id, String title, String artist, long savedAt, long playedAt, long plays) {
            this.id = id;
            this.title = title;
            this.artist = artist;
            this.savedAt = savedAt;
            this.playedAt = playedAt;
            this.plays = plays;
        }
    }
    private static final MobileUiModel.TrackInfo<Track> INFO = new MobileUiModel.TrackInfo<Track>() {
        public String id(Track track) { return track.id; }
        public String title(Track track) { return track.title; }
        public String artist(Track track) { return track.artist; }
        public long savedAt(Track track) { return track.savedAt; }
        public long playedAt(Track track) { return track.playedAt; }
        public long plays(Track track) { return track.plays; }
    };
    private static void check(boolean condition, String description) {
        checks++;
        if (!condition) throw new AssertionError(description);
    }
    private static String ids(List<Track> tracks) {
        return tracks.stream().map(track -> track.id).collect(Collectors.joining(","));
    }

    public static void main(String[] args) {
        Track newest = new Track("new", "Uma música", "Artista A", 400, 0, 0);
        Track favorite = new Track("favorite", "Minha favorita", "Artista B", 100, 500, 12);
        Track latest = new Track("latest", "Outra música", "Artista A", 300, 800, 1);
        Track unknown = new Track("unknown", null, null, 200, -1, 0);
        List<Track> source = Arrays.asList(newest, favorite, latest, unknown, favorite, null);
        MobileUiModel.Home<Track> home = MobileUiModel.home(source, INFO);
        check(ids(home.saved).equals("new,latest,unknown,favorite"), "Saved songs use download dates and remove duplicate IDs");
        check(ids(home.recent).equals("latest,favorite"), "Recent songs use actual play dates and exclude unplayed downloads");
        check(ids(home.picks).equals("latest,favorite,new,unknown"), "Shortcuts resume recent listening before new saved songs without duplicates");
        check(ids(home.recommended).equals("favorite,latest,new,unknown"), "Local recommendations favor listening history without inventing tracks");
        check(source.get(0) == newest && source.size() == 6, "Preparing the screen preserves the caller's source list");
        check(ids(home.selected(MobileUiModel.HomeFilter.RECENT)).equals("latest,favorite"), "The Recent filter preserves the displayed playback order");
        check(ids(home.selected(MobileUiModel.HomeFilter.RECOMMENDED)).equals("favorite,latest,new,unknown"), "The Recommended filter exposes the actual saved recommendation order");
        check(ids(home.selected(MobileUiModel.HomeFilter.SAVED)).equals(ids(home.saved)), "The Saved filter contains all downloads");
        home.selected(MobileUiModel.HomeFilter.RECENT).clear();
        check(home.recent.size() == 2, "Selecting a playback queue cannot clear the recent rail");
        check(ids(MobileUiModel.filter(home.saved, INFO, " ARTISTA a ")).equals("new,latest"), "Library search matches artist names case-insensitively and trims spaces");
        check(ids(MobileUiModel.filter(home.saved, INFO, "favorita")).equals("favorite"), "Library search also matches music titles");
        check(MobileUiModel.filter(home.saved, INFO, "missing").isEmpty(), "Library search never adds unrelated songs");
        check(MobileUiModel.filter(home.saved, INFO, "").size() == 4, "Clearing library search restores every saved track");
        check(MobileUiModel.filter(home.saved, INFO, null).size() == 4, "A missing query behaves like an empty search");
        List<Track> downloads = new ArrayList<>();
        for (int index = 0; index < 12; index++) downloads.add(new Track("song" + index, "Song", "Artist", index, 0, 0));
        MobileUiModel.Home<Track> withoutHistory = MobileUiModel.home(downloads, INFO);
        check(withoutHistory.recent.isEmpty(), "New installs do not show downloads as listening history");
        check(withoutHistory.picks.size() == 8 && withoutHistory.picks.get(0).id.equals("song11"), "Shortcut grid has at most four rows and starts with latest downloads");
        check(ids(withoutHistory.recommended).equals(ids(withoutHistory.saved)), "Without listening history recommendations fall back to saved songs");
        MobileUiModel.Home<Track> empty = MobileUiModel.home(new ArrayList<>(), INFO);
        check(empty.saved.isEmpty() && empty.recent.isEmpty() && empty.picks.isEmpty() && empty.recommended.isEmpty(), "An empty library produces honest empty states");
        check(MobileUiModel.greeting(0).equals("Bom dia") && MobileUiModel.greeting(11).equals("Bom dia"), "Morning greeting follows the connected home");
        check(MobileUiModel.greeting(12).equals("Boa tarde") && MobileUiModel.greeting(17).equals("Boa tarde"), "Afternoon greeting follows local time");
        check(MobileUiModel.greeting(18).equals("Boa noite") && MobileUiModel.greeting(23).equals("Boa noite"), "Evening greeting follows local time");
        System.out.println("Mobile home and library: " + checks + " checks passed.");
    }
}
