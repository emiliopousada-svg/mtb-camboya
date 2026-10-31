// Bluetooth LE nativo para el APK (pulsómetros con el servicio estándar de ritmo cardíaco).
// Se empaqueta con esbuild (scripts/prepare-web.js) en www/lib/ble.js y expone window.MtbBle.
import { BleClient } from '@capacitor-community/bluetooth-le';

const HR_SERVICE = '0000180d-0000-1000-8000-00805f9b34fb';
const HR_CHAR = '00002a37-0000-1000-8000-00805f9b34fb';

// Formato estándar "Heart Rate Measurement": el bit 0 de las flags indica si el valor es de 8 o 16 bits
function parseHr(value) {
  const flags = value.getUint8(0);
  return (flags & 0x01) ? value.getUint16(1, true) : value.getUint8(1);
}

window.MtbBle = {
  // Pide los permisos de Bluetooth/ubicación la primera vez
  async init() {
    await BleClient.initialize();
  },

  isEnabled() {
    return BleClient.isEnabled();
  },

  // Muestra el selector nativo con los pulsómetros cercanos
  pick() {
    return BleClient.requestDevice({ services: [HR_SERVICE] });
  },

  async connect(deviceId, onHr, onDisconnect) {
    await BleClient.connect(deviceId, id => onDisconnect && onDisconnect(id), { timeout: 8000 });
    try {
      await BleClient.startNotifications(deviceId, HR_SERVICE, HR_CHAR, v => onHr(parseHr(v)));
    } catch (e) {
      try { await BleClient.disconnect(deviceId); } catch (e2) {}
      throw e;
    }
  },

  async disconnect(deviceId) {
    try { await BleClient.stopNotifications(deviceId, HR_SERVICE, HR_CHAR); } catch (e) {}
    await BleClient.disconnect(deviceId);
  }
};
