package br.com.acervo.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;

/** Exposes only verified update APKs in private cache, through temporary read grants. */
public final class ApkProvider extends ContentProvider {
    static final String APK_MIME = "application/vnd.android.package-archive";

    static Uri uriFor(Context context, File file) throws IOException {
        File directory = new File(context.getCacheDir(), "updates").getCanonicalFile();
        File candidate = file.getCanonicalFile();
        if (!directory.equals(candidate.getParentFile()) || !validName(candidate.getName())) {
            throw new IOException("Arquivo de atualizacao invalido.");
        }
        return new Uri.Builder().scheme("content").authority(context.getPackageName() + ".updates")
                .appendPath(candidate.getName()).build();
    }

    private static boolean validName(String name) {
        return name != null && name.matches("acervo-update-[0-9]+-[a-f0-9]{16}\\.apk");
    }

    private File resolve(Uri uri) throws FileNotFoundException {
        if (getContext() == null || !"content".equals(uri.getScheme())
                || !(getContext().getPackageName() + ".updates").equals(uri.getAuthority())
                || uri.getQuery() != null || uri.getFragment() != null
                || uri.getPathSegments().size() != 1 || !validName(uri.getLastPathSegment())) {
            throw new FileNotFoundException("Atualizacao nao encontrada.");
        }
        try {
            File directory = new File(getContext().getCacheDir(), "updates").getCanonicalFile();
            File candidate = new File(directory, uri.getLastPathSegment()).getCanonicalFile();
            if (!directory.equals(candidate.getParentFile()) || !candidate.isFile()) {
                throw new FileNotFoundException("Atualizacao nao encontrada.");
            }
            return candidate;
        } catch (IOException ex) {
            throw new FileNotFoundException("Atualizacao nao encontrada.");
        }
    }

    @Override public boolean onCreate() { return true; }

    @Override public String getType(Uri uri) {
        try { resolve(uri); return APK_MIME; }
        catch (FileNotFoundException ex) { return null; }
    }

    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        File file;
        try { file = resolve(uri); }
        catch (FileNotFoundException ex) { return null; }
        String[] columns = projection == null
                ? new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE} : projection;
        MatrixCursor cursor = new MatrixCursor(columns, 1);
        Object[] row = new Object[columns.length];
        for (int i = 0; i < columns.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(columns[i])) row[i] = file.getName();
            else if (OpenableColumns.SIZE.equals(columns[i])) row[i] = file.length();
        }
        cursor.addRow(row);
        return cursor;
    }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new SecurityException("A atualizacao permite apenas leitura.");
        return ParcelFileDescriptor.open(resolve(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException(); }
}
