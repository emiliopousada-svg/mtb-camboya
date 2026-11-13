package com.emiliopousada.mtbcamboya;

import android.view.Window;
import android.view.WindowManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ScreenControl")
public class ScreenControlPlugin extends Plugin {
    @PluginMethod
    public void dim(PluginCall call) {
        setScreenBrightness(call, 0.03f);
    }

    @PluginMethod
    public void wake(PluginCall call) {
        setScreenBrightness(call, WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE);
    }

    private void setScreenBrightness(PluginCall call, float brightness) {
        if (getActivity() == null) {
            call.reject("La actividad de la aplicación no está disponible.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            Window window = getActivity() == null ? null : getActivity().getWindow();
            if (window == null) {
                call.reject("No se pudo acceder a la ventana de la aplicación.");
                return;
            }
            WindowManager.LayoutParams attributes = window.getAttributes();
            attributes.screenBrightness = brightness;
            window.setAttributes(attributes);
            call.resolve();
        });
    }
}
