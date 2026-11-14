'use strict';

//  PULSÓMETRO BLUETOOTH
// ============================================================
let bleDevice = null, bleManual = false, webHrGeneration = 0;
let webHrConnectingGeneration = null, webHrReconnecting = false;
const hrToggle = $('sensor-hr-enabled');

function onHrChange(e) {
    const v = e.target.value;
    const bpm = (v.getUint8(0) & 0x1) ? v.getUint16(1, true) : v.getUint8(1);
    currentHr = bpm;
    $('m-hr').textContent = bpm;
}

async function connectHr(device) {
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService('heart_rate');
    const ch = await service.getCharacteristic('heart_rate_measurement');
    ch.addEventListener('characteristicvaluechanged', onHrChange);
    await ch.startNotifications();
}

async function reconnectHr(device, generation) {
    for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 3000));
        if (bleManual || !hrToggle.checked || generation !== webHrGeneration || bleDevice !== device) return;
        try {
            await connectHr(device);
            if (bleManual || !hrToggle.checked || generation !== webHrGeneration) {
                device.gatt.disconnect();
                return;
            }
            setHrConnectionState(true, true);
            toast('❤️ Pulsómetro reconectado');
            return;
        } catch (e) {
            if (bleManual || !hrToggle.checked || generation !== webHrGeneration) {
                if (device.gatt.connected) device.gatt.disconnect();
                return;
            }
        }
    }
    if (bleManual || !hrToggle.checked || generation !== webHrGeneration || bleDevice !== device) return;
    bleManual = true;
    bleDevice = null;
    setHrConnected(false);
    toast('⚠️ Pulsómetro desconectado', 4000);
}

function onBleDisconnected(e) {
    if (bleDevice !== e.target) return;
    if (bleManual || !hrToggle.checked) {
        bleDevice = null;
        setHrConnected(false);
        return;
    }
    setHrConnectionState(false, true, 'Desconectado, reconectando…');
    toast('⚠️ Pulsómetro desconectado, reconectando…');
    if (webHrReconnecting) return;
    webHrReconnecting = true;
    const generation = webHrGeneration;
    reconnectHr(e.target, generation).finally(() => {
        webHrReconnecting = false;
        if (generation !== webHrGeneration && hrToggle.checked && !bleManual
            && !(bleDevice && bleDevice.gatt.connected)) toggleWebHr(true);
    });
}

// ---- Pulsómetro Bluetooth nativo (solo dentro del APK) ----
const isNativeApp = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const sleep = ms => new Promise(r => setTimeout(r, ms));
let nativeBleLoading = null, nativeHrId = null, nativeHrConnected = false, nativeHrManual = false;
let nativeHrGeneration = 0, nativeHrConnectingGeneration = null;
let nativeHrConnectingDeviceId = null, nativeHrName = '', nativeHrReconnectTask = null;
const sensorStates = {
    cadence: { connected: false, connecting: false, generation: 0, manual: false, deviceId: null, deviceName: '', lastReadingAt: 0, previous: null },
    power: { connected: false, connecting: false, generation: 0, manual: false, deviceId: null, deviceName: '', lastReadingAt: 0 },
    speed: { connected: false, connecting: false, generation: 0, manual: false, deviceId: null, deviceName: '', lastReadingAt: 0, previous: null }
};
const sensorConfigs = {
    cadence: { service: '00001816-0000-1000-8000-00805f9b34fb', characteristic: '00002a5b-0000-1000-8000-00805f9b34fb', name: 'Cadencia' },
    speed: { service: '00001816-0000-1000-8000-00805f9b34fb', characteristic: '00002a5b-0000-1000-8000-00805f9b34fb', name: 'Velocímetro' },
    power: { service: '00001818-0000-1000-8000-00805f9b34fb', characteristic: '00002a63-0000-1000-8000-00805f9b34fb', name: 'Potenciómetro' }
};

function setSensorStatus(type, connected, detail) {
    const state = sensorStates[type];
    state.connected = connected;
    $(`sensor-${type}-enabled`).checked = connected;
    $(`sensor-${type}-status`).textContent = detail || (connected ? 'Conectado' : 'Desconectado');
}

function updateCadence(value) {
    currentCadence = Number.isFinite(value) && value >= 0 && value <= 250 ? Math.round(value) : null;
    $('m-cadence').textContent = currentCadence === null ? '--' : String(currentCadence);
    if (sensorStates.cadence.connected) {
        $('sensor-cadence-status').textContent = currentCadence === null
            ? `Conectado${sensorStates.cadence.deviceName ? ': ' + sensorStates.cadence.deviceName : ''}`
            : `${currentCadence} rpm`;
    }
}

function updatePower(value) {
    currentPower = Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;
    if (sensorStates.power.connected) {
        $('sensor-power-status').textContent = currentPower === null
            ? `Conectado${sensorStates.power.deviceName ? ': ' + sensorStates.power.deviceName : ''}`
            : `${currentPower} W`;
    }
}

function applyCscReading(type, reading) {
    const state = sensorStates[type];
    const now = Date.now();
    state.lastReadingAt = now;
    if (type === 'cadence' && Number.isInteger(reading.crankRevolutions) && Number.isInteger(reading.crankEventTime)) {
        if (state.previous && Number.isInteger(state.previous.crankRevolutions) && Number.isInteger(state.previous.crankEventTime)) {
            const revolutions = (reading.crankRevolutions - state.previous.crankRevolutions + 65536) % 65536;
            const ticks = (reading.crankEventTime - state.previous.crankEventTime + 65536) % 65536;
            if (ticks > 0) updateCadence(revolutions * 60 * 1024 / ticks);
        }
    }
    if (type === 'speed' && Number.isInteger(reading.wheelRevolutions) && Number.isInteger(reading.wheelEventTime)) {
        if (state.previous && Number.isInteger(state.previous.wheelRevolutions) && Number.isInteger(state.previous.wheelEventTime)) {
            const revolutions = (reading.wheelRevolutions - state.previous.wheelRevolutions) >>> 0;
            const ticks = (reading.wheelEventTime - state.previous.wheelEventTime + 65536) % 65536;
            const circumference = Number($('sensor-wheel-circumference').value);
            if (ticks > 0 && Number.isFinite(circumference) && circumference >= 500 && circumference <= 3000) {
                currentBleSpeed = revolutions * circumference * 1024 * 3.6 / (ticks * 1000);
                currentBleSpeedAt = now;
                $('sensor-speed-status').textContent = `${currentBleSpeed.toFixed(1)} km/h`;
            }
        }
    }
    state.previous = reading;
}

async function connectExtraSensor(type, savedDevice) {
    if (!isNativeApp()) {
        toast('La conexión de sensores está disponible en la app Android.', 5000);
        $(`sensor-${type}-enabled`).checked = false;
        return;
    }
    const state = sensorStates[type], config = sensorConfigs[type];
    if (state.connected || state.connecting) return;
    const generation = ++state.generation;
    state.connecting = true;
    $(`sensor-${type}-enabled`).disabled = true;
    state.manual = false;
    try {
        const ble = await loadNativeBle();
        await ble.init();
        if (!(await ble.isEnabled())) throw new Error('Activa el Bluetooth del móvil.');
        const device = savedDevice || await ble.pick([config.service]);
        if (generation !== state.generation) return;
        const deviceId = device.deviceId || device.id;
        state.deviceId = deviceId;
        const onDisconnected = () => {
            state.connected = false;
            state.deviceId = null;
            state.subscription = null;
            if (type === 'cadence') { updateCadence(null); state.previous = null; }
            if (type === 'power') updatePower(null);
            if (type === 'speed') { currentBleSpeed = null; currentBleSpeedAt = 0; state.previous = null; }
            if (state.manual) return;
            setSensorStatus(type, false, 'Desconectado');
            toast(`⚠️ ${config.name} desconectado.`);
        };
        const onValue = type === 'power'
            ? value => { state.lastReadingAt = Date.now(); updatePower(value); }
            : reading => applyCscReading(type, reading);
        const subscription = type === 'power'
            ? await ble.connectPower(deviceId, onValue, onDisconnected)
            : await ble.connectCsc(deviceId, onValue, onDisconnected);
        if (generation !== state.generation) {
            await ble.disconnectCharacteristic(deviceId, config.service, config.characteristic, subscription);
            return;
        }
        state.deviceId = deviceId;
        state.subscription = subscription;
        state.deviceName = device.name || config.name;
        state.lastReadingAt = Date.now();
        state.previous = null;
        setSensorStatus(type, true, `Conectado: ${state.deviceName}`);
        toast(`✅ ${config.name} conectado`);
    } catch (error) {
        if (generation !== state.generation) return;
        console.warn(`No se pudo conectar ${config.name}:`, error);
        setSensorStatus(type, false, 'Desconectado');
        if (!/cancel|no device|not found|notfound/i.test(String(error.message || error))) {
            toast(`No se pudo conectar ${config.name}: ${error.message || error}`, 6000);
        }
    } finally {
        state.connecting = false;
        $(`sensor-${type}-enabled`).disabled = false;
    }
}

async function disconnectExtraSensor(type) {
    const state = sensorStates[type];
    state.generation++;
    state.manual = true;
    const deviceId = state.deviceId;
    const subscription = state.subscription;
    state.deviceId = null;
    state.subscription = null;
    state.previous = null;
    if (type === 'cadence') updateCadence(null);
    if (type === 'power') updatePower(null);
    if (type === 'speed') {
        currentBleSpeed = null;
        currentBleSpeedAt = 0;
        $('sensor-speed-status').textContent = 'Desconectado';
    }
    setSensorStatus(type, false, 'Desconectado');
    // Si aún está conectando, connectExtraSensor hará la limpieza cuando termine.
    if (!deviceId || !subscription) return;
    try {
        const ble = await loadNativeBle();
        await ble.disconnectCharacteristic(deviceId, sensorConfigs[type].service, sensorConfigs[type].characteristic, subscription);
    } catch (error) {
        console.warn(`No se pudo desconectar ${sensorConfigs[type].name}:`, error);
        toast(`No se pudo desconectar ${sensorConfigs[type].name}.`, 5000);
    }
}

function initSensorConnections() {
    const circumference = $('sensor-wheel-circumference');
    const savedCircumference = Number(localStorage.getItem('mtb_wheel_circumference'));
    if (savedCircumference >= 500 && savedCircumference <= 3000) circumference.value = String(savedCircumference);
    circumference.addEventListener('change', () => {
        const value = Number(circumference.value);
        if (!Number.isFinite(value) || value < 500 || value > 3000) {
            circumference.value = '2100';
            toast('La circunferencia debe estar entre 500 y 3000 mm.');
            return;
        }
        localStorage.setItem('mtb_wheel_circumference', String(value));
    });
    $('sensor-hr-enabled').addEventListener('change', () => {
        if (isNativeApp()) nativeHrToggle(hrToggle.checked);
        else toggleWebHr(hrToggle.checked);
    });
    for (const type of Object.keys(sensorConfigs)) {
        $(`sensor-${type}-enabled`).addEventListener('change', event => {
            if (event.target.checked) connectExtraSensor(type);
            else disconnectExtraSensor(type);
        });
    }
}

function loadNativeBle() {
    if (window.MtbBle) return Promise.resolve(window.MtbBle);
    if (!nativeBleLoading) {
        nativeBleLoading = new Promise((res, rej) => {
            const sc = document.createElement('script');
            sc.src = 'lib/ble.js';
            sc.onload = () => window.MtbBle ? res(window.MtbBle) : rej(new Error('Falta el módulo Bluetooth'));
            sc.onerror = () => { nativeBleLoading = null; rej(new Error('No se pudo cargar el módulo Bluetooth')); };
            document.head.appendChild(sc);
        });
    }
    return nativeBleLoading;
}

function setHrConnected(on) {
    setHrConnectionState(on, on);
}

function setHrConnectionState(connected, desiredConnected, detail = '') {
    hrToggle.checked = desiredConnected;
    $('sensor-hr-status').textContent = detail || (connected ? 'Conectado' : 'Desconectado');
    if (!connected) { $('m-hr').textContent = '--'; currentHr = null; }
}

async function nativeHrConnect(id, name, generation) {
    const ble = await loadNativeBle();
    if (generation !== nativeHrGeneration || nativeHrManual || !hrToggle.checked) return false;
    nativeHrConnectingDeviceId = id;
    nativeHrId = id;
    await ble.connect(id, bpm => { currentHr = bpm; $('m-hr').textContent = bpm; }, () => onNativeHrDisconnected(id, generation));
    if (generation !== nativeHrGeneration || nativeHrManual || !hrToggle.checked) {
        await ble.disconnect(id);
        if (nativeHrId === id) nativeHrId = null;
        return false;
    }
    nativeHrId = id;
    nativeHrConnectingDeviceId = null;
    nativeHrName = name || nativeHrName;
    nativeHrConnected = true;
    setHrConnectionState(true, true);
    if (name !== undefined) {
        try { localStorage.setItem('mtb_hr_device', JSON.stringify({ id, name: name || '' })); } catch (e) {}
    }
    return true;
}

function onNativeHrDisconnected(id, generation) {
    if (generation !== nativeHrGeneration || nativeHrId !== id) return;
    nativeHrConnected = false;
    if (nativeHrManual || !hrToggle.checked) {
        setHrConnected(false);
        return;
    }
    setHrConnectionState(false, true, 'Desconectado, reconectando…');
    toast('⚠️ Pulsómetro desconectado, reconectando…');
    if (nativeHrReconnectTask) return;
    nativeHrReconnectTask = nativeHrReconnect(id, generation).finally(() => {
        nativeHrReconnectTask = null;
        if (hrToggle.checked && !nativeHrManual && !nativeHrConnected) nativeHrToggle(true);
    });
}

async function nativeHrReconnect(id, generation) {
    for (let i = 0; i < 5; i++) {
        await sleep(4000);
        if (generation !== nativeHrGeneration || nativeHrManual || !hrToggle.checked
            || nativeHrId !== id || nativeHrConnected) return;
        try {
            if (await nativeHrConnect(id, nativeHrName, generation)) {
                toast('❤️ Pulsómetro reconectado');
                return;
            }
        } catch (e) {}
    }
    if (generation !== nativeHrGeneration || nativeHrManual || !hrToggle.checked || nativeHrId !== id) return;
    nativeHrManual = true;
    nativeHrId = null;
    nativeHrConnectingDeviceId = null;
    setHrConnected(false);
    toast('⚠️ No se pudo reconectar el pulsómetro. Pulsa 📶 para conectarlo de nuevo.', 6000);
}

async function nativeHrToggle(shouldConnect = hrToggle.checked) {
    if (!shouldConnect) {
        nativeHrGeneration++;
        nativeHrManual = true;
        const deviceId = nativeHrId || nativeHrConnectingDeviceId;
        nativeHrConnected = false;
        nativeHrId = null;
        nativeHrConnectingDeviceId = null;
        setHrConnected(false);
        if (deviceId) {
            try { await (await loadNativeBle()).disconnect(deviceId); }
            catch (error) {
                console.warn('No se pudo desconectar el pulsómetro:', error);
                toast('No se pudo desconectar el pulsómetro.', 5000);
            }
        }
        return;
    }
    if (nativeHrConnectingGeneration !== null || nativeHrReconnectTask) {
        nativeHrManual = false;
        nativeHrGeneration++;
        return;
    }
    if (nativeHrConnected) return;
    const generation = ++nativeHrGeneration;
    nativeHrConnectingGeneration = generation;
    hrToggle.style.opacity = '0.5';
    nativeHrManual = false;
    try {
        const ble = await loadNativeBle();
        if (generation !== nativeHrGeneration || nativeHrManual || !hrToggle.checked) return;
        await ble.init(); // pide los permisos de Bluetooth la primera vez
        if (generation !== nativeHrGeneration || nativeHrManual || !hrToggle.checked) return;
        if (!(await ble.isEnabled())) { toast('Activa el Bluetooth del móvil', 5000); return; }
        if (generation !== nativeHrGeneration || nativeHrManual || !hrToggle.checked) return;

        // 1) intentar con el último pulsómetro usado
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem('mtb_hr_device')); } catch (e) {}
        if (saved && saved.id) {
            try {
                toast(`Conectando con ${saved.name || 'el último pulsómetro'}…`);
                if (await nativeHrConnect(saved.id, saved.name, generation)) {
                    toast('✅ Pulsómetro conectado');
                    return;
                }
            } catch (e) {
                if (generation !== nativeHrGeneration || nativeHrManual || !hrToggle.checked) return;
                console.warn('Último pulsómetro no disponible:', e);
            }
        }

        // 2) elegir de la lista de dispositivos cercanos
        if (generation !== nativeHrGeneration || nativeHrManual || !hrToggle.checked) return;
        const dev = await ble.pick();
        if (generation !== nativeHrGeneration || nativeHrManual || !hrToggle.checked) return;
        if (await nativeHrConnect(dev.deviceId, dev.name, generation)) {
            toast(`✅ Conectado a: ${dev.name || 'Pulsómetro'}`);
        }
    } catch (err) {
        if (generation !== nativeHrGeneration || nativeHrManual) return;
        console.warn('Bluetooth nativo:', err);
        const msg = String((err && (err.message || err)) || '');
        if (!/cancel|no device|not found|notfound/i.test(msg)) toast('No se pudo conectar el pulsómetro: ' + msg, 6000);
    } finally {
        if (nativeHrConnectingGeneration === generation) {
            nativeHrConnectingGeneration = null;
            nativeHrConnectingDeviceId = null;
            hrToggle.style.opacity = '1';
            if (!nativeHrConnected && generation === nativeHrGeneration) setHrConnected(false);
            if (generation !== nativeHrGeneration && hrToggle.checked && !nativeHrManual) nativeHrToggle(true);
        }
    }
}

async function toggleWebHr(shouldConnect = hrToggle.checked) {
    if (!shouldConnect) {
        webHrGeneration++;
        bleManual = true;
        const device = bleDevice;
        bleDevice = null;
        if (device && device.gatt.connected) device.gatt.disconnect();
        setHrConnected(false);
        return;
    }
    if (webHrConnectingGeneration !== null || webHrReconnecting) {
        bleManual = false;
        webHrGeneration++;
        return;
    }
    if (!navigator.bluetooth) {
        toast('Aquí no hay Web Bluetooth. Para usar el pulsómetro abre la app web en Chrome (Android).', 6000);
        setHrConnected(false);
        return;
    }
    if (bleDevice && bleDevice.gatt.connected) {
        setHrConnectionState(true, true);
        return;
    }
    const generation = ++webHrGeneration;
    webHrConnectingGeneration = generation;
    let device = null;
    try {
        hrToggle.style.opacity = '0.5';
        bleManual = false;
        device = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
        if (generation !== webHrGeneration || !hrToggle.checked) return;
        bleDevice = device;
        device.addEventListener('gattserverdisconnected', onBleDisconnected);
        await connectHr(device);
        if (generation !== webHrGeneration || !hrToggle.checked) {
            device.gatt.disconnect();
            return;
        }
        setHrConnectionState(true, true);
        toast(`✅ Conectado a: ${device.name || 'Pulsómetro'}`);
    } catch (err) {
        if (generation !== webHrGeneration || bleManual) {
            if (device && device.gatt.connected) device.gatt.disconnect();
            if (bleDevice === device) bleDevice = null;
            return;
        }
        console.warn('Error BLE:', err);
        if (bleDevice && bleDevice.gatt.connected) bleDevice.gatt.disconnect();
        bleDevice = null;
        setHrConnected(false);
        if (err.name !== 'NotFoundError') toast('No se pudo conectar el pulsómetro', 4000);
    } finally {
        if (webHrConnectingGeneration === generation) {
            webHrConnectingGeneration = null;
            hrToggle.style.opacity = '1';
            if (generation !== webHrGeneration && hrToggle.checked && !bleManual) toggleWebHr(true);
        }
    }
}

// ============================================================
