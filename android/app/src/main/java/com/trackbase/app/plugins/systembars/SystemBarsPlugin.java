package com.trackbase.app.plugins.systembars;

import android.graphics.Color;
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
 * Local plugin for theming the Android navigation bar (bottom). The status bar
 * is handled by the official @capacitor/status-bar plugin on the JS side; there
 * is no official Capacitor plugin for the navigation bar, hence this one.
 */
@CapacitorPlugin(name = "SystemBars")
public class SystemBarsPlugin extends Plugin {

    @PluginMethod
    public void setNavigationBar(PluginCall call) {
        String colorStr = call.getString("color", "#000000");
        final boolean darkButtons = Boolean.TRUE.equals(call.getBoolean("darkButtons", false));

        final int colorInt;
        try {
            colorInt = Color.parseColor(colorStr);
        } catch (IllegalArgumentException e) {
            call.reject("Invalid color: " + colorStr);
            return;
        }

        final Window window = getActivity() != null ? getActivity().getWindow() : null;
        if (window == null) {
            call.reject("No window available");
            return;
        }

        getActivity().runOnUiThread(() -> {
            // Keep content inside the system bars so the bar colors are visible
            // rather than being drawn over by edge-to-edge web content.
            WindowCompat.setDecorFitsSystemWindows(window, true);

            window.setNavigationBarColor(colorInt);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                // Don't let the system add its own contrast scrim over our color.
                window.setNavigationBarContrastEnforced(false);
            }

            View decorView = window.getDecorView();
            WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(window, decorView);
            // darkButtons = true → dark icons (for a light background).
            controller.setAppearanceLightNavigationBars(darkButtons);

            call.resolve();
        });
    }
}
