package com.emiliopousada.mtbcamboya;

import android.content.Intent;
import android.content.IntentFilter;
import android.os.BatteryManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BatteryInfo")
public class BatteryInfoPlugin extends Plugin {
    @PluginMethod
    public void getInfo(PluginCall call) {
        Intent status = getContext().registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (status == null) {
            call.reject("No se pudo consultar la batería del dispositivo.");
            return;
        }

        int level = status.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
        int scale = status.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
        if (level < 0 || scale <= 0) {
            call.reject("El dispositivo no ha proporcionado el nivel de batería.");
            return;
        }

        int state = status.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
        boolean charging = state == BatteryManager.BATTERY_STATUS_CHARGING
                || state == BatteryManager.BATTERY_STATUS_FULL;
        JSObject result = new JSObject();
        result.put("level", (double) level / scale);
        result.put("charging", charging);
        call.resolve(result);
    }
}
