package br.com.acervo.app;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

/** Keeps old shortcuts and notifications opening the shared web-mobile interface. */
public final class StandaloneActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        startActivity(new Intent(this, MainActivity.class)
                .putExtra(MainActivity.EXTRA_PHONE, true)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP));
        finish();
    }
}
