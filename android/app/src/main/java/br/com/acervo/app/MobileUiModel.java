package br.com.acervo.app;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

final class MobileUiModel {
    enum HomeFilter { ALL, RECOMMENDED, RECENT, SAVED }

    interface TrackInfo<T> {
        String id(T track);
        String title(T track);
        String artist(T track);
        long savedAt(T track);
        long playedAt(T track);
        long plays(T track);
    }

    static final class Home<T> {
        final List<T> saved, recent, picks, recommended;
        Home(List<T> saved, List<T> recent, List<T> picks, List<T> recommended) {
            this.saved = saved;
            this.recent = recent;
            this.picks = picks;
            this.recommended = recommended;
        }
        List<T> selected(HomeFilter filter) {
            if (filter == HomeFilter.RECENT) return new ArrayList<>(recent);
            if (filter == HomeFilter.RECOMMENDED) return new ArrayList<>(recommended);
            return new ArrayList<>(saved);
        }
    }

    static <T> Home<T> home(List<T> source, TrackInfo<T> info) {
        List<T> saved = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (T track : source) {
            if (track != null && info.id(track) != null && seen.add(info.id(track))) saved.add(track);
        }
        saved.sort((first, second) -> Long.compare(info.savedAt(second), info.savedAt(first)));
        List<T> recent = new ArrayList<>();
        for (T track : saved) if (info.playedAt(track) > 0) recent.add(track);
        recent.sort((first, second) -> Long.compare(info.playedAt(second), info.playedAt(first)));
        List<T> picks = new ArrayList<>(recent);
        for (T track : saved) if (info.playedAt(track) <= 0) picks.add(track);
        if (picks.size() > 8) picks = new ArrayList<>(picks.subList(0, 8));
        List<T> recommended = new ArrayList<>(saved);
        recommended.sort(Comparator.<T>comparingLong(info::plays).reversed()
                .thenComparing(Comparator.<T>comparingLong(info::playedAt).reversed())
                .thenComparing(Comparator.<T>comparingLong(info::savedAt).reversed()));
        return new Home<>(saved, recent, picks, recommended);
    }

    static <T> List<T> filter(List<T> source, TrackInfo<T> info, String query) {
        String value = query == null ? "" : query.trim().toLowerCase(Locale.ROOT);
        List<T> result = new ArrayList<>();
        for (T track : source) {
            String title = info.title(track) == null ? "" : info.title(track);
            String artist = info.artist(track) == null ? "" : info.artist(track);
            if (value.isEmpty() || title.toLowerCase(Locale.ROOT).contains(value)
                    || artist.toLowerCase(Locale.ROOT).contains(value)) result.add(track);
        }
        return result;
    }

    static String greeting(int hour) {
        return hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
    }

    private MobileUiModel() { }
}
