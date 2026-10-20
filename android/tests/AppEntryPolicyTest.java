package br.com.acervo.app;

public final class AppEntryPolicyTest {
    private static int checks;

    private static void check(String mode, boolean hasServer, boolean showConnections, AppEntryPolicy.Destination expected) {
        AppEntryPolicy.Destination actual = AppEntryPolicy.destination(mode, hasServer, showConnections);
        if (actual != expected) throw new AssertionError("Expected " + expected + ", received " + actual);
        checks++;
    }

    public static void main(String[] args) {
        check(null, false, false, AppEntryPolicy.Destination.PHONE);
        check(null, true, false, AppEntryPolicy.Destination.SERVER);
        check(AppEntryPolicy.MODE_SERVER, true, false, AppEntryPolicy.Destination.SERVER);
        check(AppEntryPolicy.MODE_SERVER, false, false, AppEntryPolicy.Destination.PHONE);
        check(AppEntryPolicy.MODE_PHONE, true, false, AppEntryPolicy.Destination.PHONE);
        check(AppEntryPolicy.MODE_PHONE, false, false, AppEntryPolicy.Destination.PHONE);
        check("invalid", true, false, AppEntryPolicy.Destination.PHONE);
        check(null, false, true, AppEntryPolicy.Destination.CONNECTIONS);
        check(AppEntryPolicy.MODE_SERVER, true, true, AppEntryPolicy.Destination.CONNECTIONS);
        check(AppEntryPolicy.MODE_PHONE, true, true, AppEntryPolicy.Destination.CONNECTIONS);
        System.out.println("App entry: " + checks + " checks passed for first launch, remembered modes and explicit connections.");
    }
}
