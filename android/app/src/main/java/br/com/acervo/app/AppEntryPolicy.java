package br.com.acervo.app;

public final class AppEntryPolicy {
    public static final String MODE_PHONE = "phone";
    public static final String MODE_SERVER = "server";
    public enum Destination { PHONE, SERVER, CONNECTIONS }

    private AppEntryPolicy() {}

    public static Destination destination(String mode, boolean hasServer, boolean showConnections) {
        if (showConnections) return Destination.CONNECTIONS;
        if (MODE_PHONE.equals(mode)) return Destination.PHONE;
        if (hasServer && (mode == null || MODE_SERVER.equals(mode))) return Destination.SERVER;
        return Destination.PHONE;
    }
}
