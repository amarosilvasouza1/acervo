package br.com.acervo.app;

import java.io.IOException;
import java.util.List;

public final class PhonePlaylistTest {
    private static int checks;
    private static void check(boolean condition, String label) { checks++; if (!condition) throw new AssertionError(label); }
    private static void invalid(String value) throws Exception { checks++; try { PhonePlaylistCsv.parse(value); throw new AssertionError("CSV inválido aceito"); } catch (IOException expected) { } }
    public static void main(String[] args) throws Exception {
        List<List<String>> rows = PhonePlaylistCsv.parse("\ufeffTrack Name,Artist Name(s),Duration (ms)\r\n\"Um, dois\",\"Artista \"\"A\"\"\",180000\r\n");
        check(rows.size() == 2, "records"); check(rows.get(1).get(0).equals("Um, dois"), "quoted delimiter"); check(rows.get(1).get(1).equals("Artista \"A\""), "escaped quotes");
        check(PhonePlaylistCsv.parse("Título;Artista\nMúsica;Autor").get(1).get(1).equals("Autor"), "semicolon");
        check(PhonePlaylistCsv.parse("Title,Artist\n\"Line\none\",A").get(1).get(0).equals("Line\none"), "quoted linebreak");
        check(PhonePlaylistCsv.parse("Title,Artist\n\nMusic,A\n").size() == 2, "blank rows");
        invalid("Title,Artist\n\"unfinished"); invalid("Title,Artist\n\"closed\"oops,A"); invalid("Title,Artist\n" + "a".repeat(8193));
        invalid("T,A\n" + "M,A\n".repeat(1001)); invalid("x".repeat(1500001));
        check(PhonePlaylistMatch.score("Água", "Ana", 180, "Ana - Agua (Official Audio)", "AnaVEVO", 181) > .9, "accent title artist match");
        check(PhonePlaylistMatch.score("Agua", "Ana", 180, "Ana - Agua (Live)", "AnaVEVO", 181) == 0, "reject unrequested live");
        check(PhonePlaylistMatch.score("Agua", "Ana", 180, "Agua", "Outro", 181) == 0, "reject wrong artist");
        check(PhonePlaylistMatch.score("Agua", "Ana", 180, "Ana - Agua", "Ana", 300) == 0, "reject wrong duration");
        check(PhonePlaylistMatch.score("Agua ao vivo", "Ana", 180, "Ana - Agua ao vivo", "Ana", 180) > .9, "requested live allowed");
        check(PhonePlaylistMatch.score("Amor de longe", "Ana", 180, "Ana - Amor", "Ana", 180) == 0, "reject mismatched song");
        check(PhonePlaylistMatch.score("Agua", "Ana", 0, "Agua", "Banana", 180) == 0, "artist word boundaries");
        check(PhonePlaylistMatch.score("Agua", "Ana", 0, "Agua", "AnaVEVO", 180) > .9, "VEVO channel");
        System.out.println(checks + " playlist CSV/matching checks passed");
    }
}
