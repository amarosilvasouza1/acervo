package br.com.acervo.app;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/** Bounded RFC 4180-style records; quoted line breaks and escaped quotes are retained. */
final class PhonePlaylistCsv {
    private PhonePlaylistCsv() { }
    static List<List<String>> parse(String text) throws IOException {
        if (text == null || text.length() > 1500000) throw new IOException("Use um arquivo de até 1,5 MB.");
        if (text.startsWith("\ufeff")) text = text.substring(1);
        char delimiter = delimiter(text);
        List<List<String>> rows = new ArrayList<>(); List<String> row = new ArrayList<>(); StringBuilder cell = new StringBuilder();
        boolean quoted = false, afterQuote = false;
        for (int i = 0; i < text.length(); i++) {
            char value = text.charAt(i);
            if (quoted) {
                if (value == '"') { if (i + 1 < text.length() && text.charAt(i + 1) == '"') { cell.append('"'); i++; } else { quoted = false; afterQuote = true; } }
                else cell.append(value);
            } else if (value == '"' && cell.length() == 0 && !afterQuote) quoted = true;
            else if (value == delimiter) { add(row, cell); afterQuote = false; }
            else if (value == '\r' || value == '\n') {
                if (value == '\r' && i + 1 < text.length() && text.charAt(i + 1) == '\n') i++;
                add(row, cell); append(rows, row); row = new ArrayList<>(); afterQuote = false;
            } else if (afterQuote && !Character.isWhitespace(value)) throw new IOException("CSV inválido depois de aspas.");
            else if (!afterQuote) cell.append(value);
            if (cell.length() > 8192 || row.size() > 128) throw new IOException("Uma linha do CSV é grande demais.");
        }
        if (quoted) throw new IOException("CSV com aspas sem fechamento.");
        if (cell.length() > 0 || !row.isEmpty() || afterQuote) { add(row, cell); append(rows, row); }
        return rows;
    }
    private static void add(List<String> row, StringBuilder cell) { row.add(cell.toString()); cell.setLength(0); }
    private static void append(List<List<String>> rows, List<String> row) throws IOException {
        boolean nonempty = false; for (String value : row) if (!value.trim().isEmpty()) { nonempty = true; break; }
        if (!nonempty) return;
        rows.add(row); if (rows.size() > 1001) throw new IOException("Use uma lista com até 1000 músicas.");
    }
    private static char delimiter(String text) {
        int commas = 0, semicolons = 0; boolean quoted = false;
        for (int i = 0; i < text.length(); i++) {
            char value = text.charAt(i); if (value == '"') quoted = !quoted;
            else if (!quoted) { if (value == '\r' || value == '\n') break; if (value == ',') commas++; if (value == ';') semicolons++; }
        }
        return semicolons > commas ? ';' : ',';
    }
}
