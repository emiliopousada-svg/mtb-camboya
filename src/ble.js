// Sensores Bluetooth LE estándar para el APK.
// Se empaqueta con esbuild (scripts/prepare-web.js) en www/lib/ble.js y expone window.MtbBle.
import { BleClient } from '@capacitor-community/bluetooth-le';

const HR_SERVICE = '0000180d-0000-1000-8000-00805f9b34fb';
const HR_CHAR = '00002a37-0000-1000-8000-00805f9b34fb';
const CSC_SERVICE = '00001816-0000-1000-8000-00805f9b34fb';
const CSC_CHAR = '00002a5b-0000-1000-8000-00805f9b34fb';
const CYCLING_POWER_SERVICE = '00001818-0000-1000-8000-00805f9b34fb';
const CYCLING_POWER_CHAR = '00002a63-0000-1000-8000-00805f9b34fb';

// Formato estándar "Heart Rate Measurement": el bit 0 de las flags indica si el valor es de 8 o 16 bits
function parseHr(value) {
  const flags = value.getUint8(0);
  return (flags & 0x01) ? value.getUint16(1, true) : value.getUint8(1);
}

function parseCsc(value) {
  const flags = value.getUint8(0);
  let offset = 1;
  const reading = {};
  if (flags & 0x01) {
    reading.wheelRevolutions = value.getUint32(offset, true);
    reading.wheelEventTime = value.getUint16(offset + 4, true);
    offset += 6;
  }
  if (flags & 0x02) {
    reading.crankRevolutions = value.getUint16(offset, true);
    reading.crankEventTime = value.getUint16(offset + 2, true);
  }
  return reading;
}

function parsePower(value) {
  return value.getInt16(2, true);
}

window.MtbBle = {
  services: {
    heartRate: HR_SERVICE,
    cyclingSpeedCadence: CSC_SERVICE,
    cyclingPower: CYCLING_POWER_SERVICE
  },

  // Pide los permisos de Bluetooth/ubicación la primera vez
  async init() {
    await BleClient.initialize();
  },

  isEnabled() {
    return BleClient.isEnabled();
  },

  // Muestra el selector nativo con los pulsómetros cercanos
  pick(services = [HR_SERVICE]) {
    return BleClient.requestDevice({ services });
  },

  async connectCharacteristic(deviceId, service, characteristic, onValue, onDisconnect) {
    await BleClient.connect(deviceId, id => onDisconnect && onDisconnect(id), { timeout: 8000 });
    try {
      await BleClient.startNotifications(deviceId, service, characteristic, onValue);
    } catch (e) {
      try { await BleClient.disconnect(deviceId); } catch (e2) {}
      throw e;
    }
  },

  connect(deviceId, onHr, onDisconnect) {
    return this.connectCharacteristic(deviceId, HR_SERVICE, HR_CHAR, v => onHr(parseHr(v)), onDisconnect);
  },

  connectCsc(deviceId, onReading, onDisconnect) {
    return this.connectCharacteristic(deviceId, CSC_SERVICE, CSC_CHAR, v => onReading(parseCsc(v)), onDisconnect);
  },

  connectPower(deviceId, onPower, onDisconnect) {
    return this.connectCharacteristic(deviceId, CYCLING_POWER_SERVICE, CYCLING_POWER_CHAR, v => onPower(parsePower(v)), onDisconnect);
  },

  async disconnect(deviceId) {
    try { await BleClient.stopNotifications(deviceId, HR_SERVICE, HR_CHAR); } catch (e) {}
    await BleClient.disconnect(deviceId);
  },

  async disconnectCharacteristic(deviceId, service, characteristic) {
    try { await BleClient.stopNotifications(deviceId, service, characteristic); } catch (e) {}
    await BleClient.disconnect(deviceId);
  }
};
