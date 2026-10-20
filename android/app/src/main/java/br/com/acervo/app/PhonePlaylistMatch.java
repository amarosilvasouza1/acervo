package br.com.acervo.app;

import java.text.Normalizer;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/** Conservative playlist matching. Ambiguous source results remain visible as failures. */
final class PhonePlaylistMatch {
    private PhonePlaylistMatch() { }
    static double score(String title, String artist, long duration, String foundTitle, String foundArtist, long foundDuration) {
        String wanted = fold(title), candidate = fold(foundTitle), author = fold(artist), channel = fold(foundArtist);
        if (wanted.isEmpty() || candidate.isEmpty()) return 0;
        for (String variant : new String[] { "live", "remix", "cover", "karaoke", "sped up", "slowed", "ao vivo", "instrumental" })
            if (!contains(wanted, variant) && contains(candidate, variant)) return 0;
        Set<String> tokens = new HashSet<>(Arrays.asList(wanted.split(" ")));
        Set<String> present = new HashSet<>(Arrays.asList(candidate.split(" ")));
        int matched = 0; for (String token : tokens) if (present.contains(token)) matched++;
        double titleScore = (double) matched / Math.max(1, tokens.size());
        if (titleScore < .8) return 0;
        boolean artistMatch = author.isEmpty();
        if (!author.isEmpty()) {
            for (String part : author.split("(?: feat | ft |,|;| & )")) if (!part.trim().isEmpty() && (contains(candidate, part) || contains(channel, part) || channel.equals(part + "vevo") || channel.equals(part + " topic"))) artistMatch = true;
        }
        if (!artistMatch) return 0;
        if (duration > 0 && foundDuration > 0 && Math.abs(duration - foundDuration) > Math.max(15, duration * .12)) return 0;
        return titleScore * .7 + (artistMatch ? .2 : 0) + (duration > 0 && foundDuration > 0 ? .1 : .08);
    }
    private static boolean contains(String full, String phrase) { return (" " + full + " ").contains(" " + phrase + " "); }
    private static String fold(String value) { return Normalizer.normalize(value == null ? "" : value, Normalizer.Form.NFD).replaceAll("\\p{M}", "").toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N},;&]+", " ").trim().replaceAll("\\s+", " "); }
}
