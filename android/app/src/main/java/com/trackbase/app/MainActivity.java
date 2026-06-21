package com.trackbase.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.trackbase.app.plugins.audiorecorder.NativeAudioRecorderPlugin;
import com.trackbase.app.plugins.systembars.SystemBarsPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before super.onCreate().
        registerPlugin(NativeAudioRecorderPlugin.class);
        registerPlugin(SystemBarsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
