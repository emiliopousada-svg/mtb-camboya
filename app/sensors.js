'use strict';

//  PULSÓMETRO BLUETOOTH
// ============================================================
let bleDevice = null, bleManual = false;
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
    setHrConnected(true);
}

async function reconnectHr(device) {
    for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 3000));
        if (bleManual || bleDevice !== device) return;
        try { await connectHr(device); toast('❤️ Pulsómetro reconectado'); return; } catch (e) {}
    }
    toast('⚠️ Pulsómetro desconectado', 4000);
}

function onBleDisconnected(e) {
    setHrConnected(false);
    if (bleManual) { bleDevice = null; return; }
    toast('⚠️ Pulsómetro desconectado, reconectando…');
    reconnectHr(e.target);
}

// ---- Pulsómetro Bluetooth nativo (solo dentro del APK) ----
const isNativeApp = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const sleep = ms => new Promise(r => setTimeout(r, ms));
let nativeBleLoading = null, nativeHrId = null, nativeHrConnected = false, nativeHrManual = false;
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
        if (isNativeApp()) nativeHrToggle();
        else toggleWebHr();
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
    hrToggle.checked = on;
    $('sensor-hr-status').textContent = on ? 'Conectado' : 'Desconectado';
    if (!on) { $('m-hr').textContent = '--'; currentHr = null; }
}

async function nativeHrConnect(id, name) {
    const ble = await loadNativeBle();
    await ble.connect(id, bpm => { currentHr = bpm; $('m-hr').textContent = bpm; }, () => onNativeHrDisconnected(id));
    nativeHrId = id;
    nativeHrConnected = true;
    setHrConnected(true);
    if (name !== undefined) {
        try { localStorage.setItem('mtb_hr_device', JSON.stringify({ id, name: name || '' })); } catch (e) {}
    }
}

function onNativeHrDisconnected(id) {
    nativeHrConnected = false;
    setHrConnected(false);
    if (nativeHrManual || nativeHrId !== id) return;
    toast('⚠️ Pulsómetro desconectado, reconectando…');
    nativeHrReconnect(id);
}

async function nativeHrReconnect(id) {
    for (let i = 0; i < 8; i++) {
        await sleep(4000);
        if (nativeHrManual || nativeHrId !== id || nativeHrConnected) return;
        try { await nativeHrConnect(id); toast('❤️ Pulsómetro reconectado'); return; } catch (e) {}
    }
    toast('⚠️ No se pudo reconectar el pulsómetro. Pulsa 📶 para conectarlo de nuevo.', 6000);
}

async function nativeHrToggle() {
    if (nativeHrConnected) { // un segundo toque lo desconecta
        nativeHrManual = true;
        try { await (await loadNativeBle()).disconnect(nativeHrId); } catch (e) {}
        nativeHrConnected = false;
        nativeHrId = null;
        setHrConnected(false);
        toast('Pulsómetro desconectado');
        return;
    }
    hrToggle.style.opacity = '0.5';
    nativeHrManual = false;
    try {
        const ble = await loadNativeBle();
        await ble.init(); // pide los permisos de Bluetooth la primera vez
        if (!(await ble.isEnabled())) { toast('Activa el Bluetooth del móvil', 5000); return; }

        // 1) intentar con el último pulsómetro usado
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem('mtb_hr_device')); } catch (e) {}
        if (saved && saved.id) {
            try {
                toast(`Conectando con ${saved.name || 'el último pulsómetro'}…`);
                await nativeHrConnect(saved.id, saved.name);
                toast('✅ Pulsómetro conectado');
                return;
            } catch (e) { console.warn('Último pulsómetro no disponible:', e); }
        }

        // 2) elegir de la lista de dispositivos cercanos
        const dev = await ble.pick();
        await nativeHrConnect(dev.deviceId, dev.name);
        toast(`✅ Conectado a: ${dev.name || 'Pulsómetro'}`);
    } catch (err) {
        console.warn('Bluetooth nativo:', err);
        const msg = String((err && (err.message || err)) || '');
        if (!/cancel|no device|not found|notfound/i.test(msg)) toast('No se pudo conectar el pulsómetro: ' + msg, 6000);
    } finally {
        hrToggle.style.opacity = '1';
        if (!nativeHrConnected) setHrConnected(false);
    }
}

async function toggleWebHr() {
    if (!navigator.bluetooth) {
        toast('Aquí no hay Web Bluetooth. Para usar el pulsómetro abre la app web en Chrome (Android).', 6000);
        setHrConnected(false);
        return;
    }
    if (bleDevice && bleDevice.gatt.connected) { // un segundo toque lo desconecta
        bleManual = true;
        bleDevice.gatt.disconnect();
        return;
    }
    try {
        hrToggle.style.opacity = '0.5';
        bleManual = false;
        const device = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
        bleDevice = device;
        device.addEventListener('gattserverdisconnected', onBleDisconnected);
        await connectHr(device);
        toast(`✅ Conectado a: ${device.name || 'Pulsómetro'}`);
    } catch (err) {
        console.warn('Error BLE:', err);
        if (err.name !== 'NotFoundError') toast('No se pudo conectar el pulsómetro', 4000);
    } finally {
        hrToggle.style.opacity = '1';
        setHrConnected(Boolean(bleDevice && bleDevice.gatt.connected));
    }
}

// ============================================================
