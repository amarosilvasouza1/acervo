package android.util;
import java.io.*;
import java.nio.file.*;
public final class AtomicFile {
    private final File file;
    public AtomicFile(File value) { file = value; }
    public File getBaseFile() { return file; }
    public FileInputStream openRead() throws IOException { return new FileInputStream(file); }
    public byte[] readFully() throws IOException { return Files.readAllBytes(file.toPath()); }
    public FileOutputStream startWrite() throws IOException { return new FileOutputStream(file + ".part"); }
    public void finishWrite(FileOutputStream output) throws IOException { output.close(); Files.move(Path.of(file + ".part"), file.toPath(), StandardCopyOption.REPLACE_EXISTING); }
    public void failWrite(FileOutputStream output) { try { output.close(); } catch (IOException ignored) { } new File(file + ".part").delete(); }
}
