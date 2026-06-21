package com.trackbase.app.plugins.systembars;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.view.View;
import android.view.Window;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Local plugin for theming both Android system bars (status bar on top,
 * navigation bar on bottom). There is no official Capacitor plugin for the
 * navigation bar, and on Android 15+ (edge-to-edge enforced) the legacy
 * setStatusBarColor / setNavigationBarColor APIs are ignored — so we also paint
 * the window background with the same color, which shows through the now
 * transparent bars.
 */
@CapacitorPlugin(name = "SystemBars")
public class SystemBarsPlugin extends Plugin {

    @PluginMethod
    public void apply(PluginCall call) {
        final String colorStr = call.getString("color", "#000000");
        // darkIcons = true → dark bar icons (for a light background).
        final boolean darkIcons = Boolean.TRUE.equals(call.getBoolean("darkIcons", false));

        final int colorInt;
        try {
            colorInt = Color.parseColor(colorStr);
        } catch (IllegalArgumentException e) {
            call.reject("Invalid color: " + colorStr);
            return;
        }

        if (getActivity() == null) {
            call.reject("No activity available");
            return;
        }

        getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();
            if (window == null) {
                call.reject("No window available");
                return;
            }

            View decorView = window.getDecorView();

            // Keep web content within the system bars so the bar regions reveal
            // our background color rather than being covered by the WebView.
            WindowCompat.setDecorFitsSystemWindows(window, true);

            // Pre-Android 15: these color the bars directly.
            window.setStatusBarColor(colorInt);
            window.setNavigationBarColor(colorInt);

            // Android 15+: bar colors are ignored (the bars are transparent and
            // edge-to-edge is enforced). Painting the window background the same
            // color makes the transparent bars match the app background.
            window.setBackgroundDrawable(new ColorDrawable(colorInt));
            decorView.setBackgroundColor(colorInt);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                // Don't let the system add its own contrast scrim over our color.
                window.setNavigationBarContrastEnforced(false);
            }

            WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(window, decorView);
            controller.setAppearanceLightStatusBars(darkIcons);
            controller.setAppearanceLightNavigationBars(darkIcons);

            call.resolve();
        });
    }
}
