package br.com.acervo.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.widget.ScrollView;
import android.widget.TextView;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

final class AppLicenses {
    static void show(Activity activity) {
        String installedVersion = "";
        try { installedVersion = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0).versionName; }
        catch (Exception ignored) { installedVersion = "(versão não informada)"; }
        String license = "";
        try (InputStream input = activity.getResources().openRawResource(R.raw.gpl3)) {
            license = new String(MobileLibrary.readLimited(input, 128 * 1024), StandardCharsets.UTF_8);
        } catch (Exception ignored) { license = "https://www.gnu.org/licenses/gpl-3.0.html"; }
        TextView text = new TextView(activity);
        int padding = (int) (20 * activity.getResources().getDisplayMetrics().density);
        text.setPadding(padding, padding, padding, padding);
        text.setTextIsSelectable(true);
        text.setText("Acervo Android " + installedVersion + "\n\nO código Android é distribuído sob GPL-3.0-ou-posterior. "
                + "Utiliza NewPipeExtractor v0.26.5, NanoJSON, Rhino, jsoup, Protobuf, desugar_jdk_libs e ZXing. "
                + "O Acervo é um aplicativo independente, sem vínculo ou endosso do Team NewPipe.\n\n"
                + "Fontes correspondentes: acervo-" + installedVersion + "-source.zip, entregue junto ao APK. "
                + "Projetos e avisos: android/THIRD-PARTY-NOTICES.md.\n\n" + license);
        ScrollView scroll = new ScrollView(activity);
        scroll.addView(text);
        new AlertDialog.Builder(activity).setTitle("Sobre e licenças").setView(scroll).setPositiveButton("Fechar", null).show();
    }
}
