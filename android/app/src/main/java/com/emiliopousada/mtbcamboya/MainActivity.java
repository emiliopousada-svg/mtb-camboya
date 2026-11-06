package com.emiliopousada.mtbcamboya;

import android.app.AlertDialog;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Process;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.splashscreen.SplashScreen;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final long SPLASH_DURATION_MS = 4000;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        registerPlugin(BatteryInfoPlugin.class);
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        showFullScreenSplash();
    }

    @Override
    public void onBackPressed() {
        int padding = (int) (24 * getResources().getDisplayMetrics().density);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(padding, padding, padding, 0);

        TextView message = new TextView(this);
        message.setText("¿Quieres salir de MTB CAMBOYA?");
        message.setTextSize(18);
        message.setGravity(Gravity.CENTER);
        content.addView(message, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        LinearLayout actions = new LinearLayout(this);
        actions.setGravity(Gravity.CENTER);
        actions.setPadding(0, padding, 0, 0);

        Button exitButton = new Button(this);
        exitButton.setText("✅\nSí, salir");
        exitButton.setContentDescription("Sí, salir de la aplicación");
        actions.addView(exitButton, new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        Button cancelButton = new Button(this);
        cancelButton.setText("❌\nNo, cancelar");
        cancelButton.setContentDescription("No, cancelar y volver a la aplicación");
        actions.addView(cancelButton, new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        content.addView(actions, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setView(content)
                .create();
        exitButton.setOnClickListener(view -> {
            dialog.dismiss();
            finishAndRemoveTask();
        });
        cancelButton.setOnClickListener(view -> dialog.dismiss());
        dialog.show();
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        // Al salir se mata el proceso para que el siguiente arranque sea limpio (splash y WebView nuevos).
        if (isFinishing()) {
            Process.killProcess(Process.myPid());
        }
    }

    private void showFullScreenSplash() {
        ViewGroup content = findViewById(android.R.id.content);
        FrameLayout splash = new FrameLayout(this);
        splash.setBackgroundColor(0xFF000000);

        ImageView artwork = new ImageView(this);
        artwork.setImageResource(R.drawable.splash);
        artwork.setScaleType(ImageView.ScaleType.FIT_CENTER);
        FrameLayout.LayoutParams artworkParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
                Gravity.CENTER);
        int horizontalInset = (int) (24 * getResources().getDisplayMetrics().density);
        int verticalInset = (int) (48 * getResources().getDisplayMetrics().density);
        artworkParams.setMargins(horizontalInset, verticalInset, horizontalInset, verticalInset);
        splash.addView(artwork, artworkParams);
        content.addView(splash, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (splash.getParent() == content) {
                splash.animate()
                        .alpha(0f)
                        .setDuration(250)
                        .withEndAction(() -> content.removeView(splash))
                        .start();
            }
        }, SPLASH_DURATION_MS);
    }
}
