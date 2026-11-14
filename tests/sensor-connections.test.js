'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createSensorContext(ble = {}) {
    const elements = new Map();
    const calls = { connect: 0, disconnect: 0, pick: 0, toasts: [] };
    const context = {
        window: {
            Capacitor: { isNativePlatform: () => true },
            MtbBle: {
                async init() {},
                async isEnabled() { return true; },
                async pick() { calls.pick++; return { deviceId: 'sensor-1', name: 'Sensor' }; },
                async connect() { calls.connect++; },
                async disconnect() { calls.disconnect++; },
                ...ble
            }
        },
        navigator: {},
        localStorage: { getItem: () => null, setItem() {} },
        currentHr: null,
        console: { warn() {} },
        toast: message => calls.toasts.push(message),
        $: id => {
            if (!elements.has(id)) elements.set(id, { checked: false, disabled: false, style: {}, textContent: '', value: '' });
            return elements.get(id);
        }
    };
    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'app', 'sensors.js'), 'utf8'),
        context
    );
    return { context, elements, calls };
}

test('unchecking the heart-rate sensor while selecting a device cancels the pending connection', async () => {
    let finishPick;
    const { context, elements, calls } = createSensorContext({
        pick: () => {
            calls.pick++;
            return new Promise(resolve => { finishPick = resolve; });
        }
    });
    elements.get('sensor-hr-enabled').checked = true;
    const connection = vm.runInContext('nativeHrToggle(true)', context);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.pick, 1);

    elements.get('sensor-hr-enabled').checked = false;
    await vm.runInContext('nativeHrToggle(false)', context);
    finishPick({ deviceId: 'sensor-1', name: 'Sensor' });
    await connection;

    assert.equal(calls.connect, 0);
    assert.equal(elements.get('sensor-hr-enabled').checked, false);
});

test('heart-rate reconnection stops when the user unchecks the sensor', async () => {
    const timers = [];
    const { context, elements, calls } = createSensorContext();
    context.setTimeout = callback => { timers.push(callback); return timers.length; };
    elements.get('sensor-hr-enabled').checked = true;
    vm.runInContext('nativeHrId = "sensor-1"; nativeHrManual = false; nativeHrGeneration = 1', context);
    vm.runInContext('onNativeHrDisconnected("sensor-1", nativeHrGeneration)', context);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(timers.length, 1);
    assert.equal(elements.get('sensor-hr-enabled').checked, true);

    elements.get('sensor-hr-enabled').checked = false;
    await vm.runInContext('nativeHrToggle(false)', context);
    timers[0]();
    await vm.runInContext('nativeHrReconnectTask', context);

    assert.equal(calls.connect, 0);
    assert.equal(elements.get('sensor-hr-enabled').checked, false);
});

test('native heart-rate reconnection makes at most five attempts', async () => {
    const { context, elements, calls } = createSensorContext({
        async connect() {
            calls.connect++;
            throw new Error('Sensor fuera de alcance');
        }
    });
    context.setTimeout = callback => { queueMicrotask(callback); return 1; };
    elements.get('sensor-hr-enabled').checked = true;
    vm.runInContext('nativeHrId = "sensor-1"; nativeHrManual = false; nativeHrGeneration = 1', context);

    await vm.runInContext('nativeHrReconnect("sensor-1", nativeHrGeneration)', context);

    assert.equal(calls.connect, 5);
    assert.equal(elements.get('sensor-hr-enabled').checked, false);
});

test('unchecking the web heart-rate sensor while selecting a device cancels the connection', async () => {
    let finishPick;
    let connectCalls = 0;
    const device = {
        name: 'Sensor',
        addEventListener() {},
        gatt: {
            connected: false,
            async connect() { connectCalls++; }
        }
    };
    const { context, elements } = createSensorContext();
    context.window.Capacitor.isNativePlatform = () => false;
    context.navigator.bluetooth = {
        requestDevice: () => new Promise(resolve => { finishPick = resolve; })
    };
    elements.get('sensor-hr-enabled').checked = true;
    const connection = vm.runInContext('toggleWebHr(true)', context);
    await new Promise(resolve => setImmediate(resolve));

    elements.get('sensor-hr-enabled').checked = false;
    await vm.runInContext('toggleWebHr(false)', context);
    finishPick(device);
    await connection;

    assert.equal(connectCalls, 0);
    assert.equal(elements.get('sensor-hr-enabled').checked, false);
});

test('web heart-rate reconnection makes at most five attempts', async () => {
    let connectCalls = 0;
    const device = {
        gatt: {
            connected: false,
            async connect() { connectCalls++; throw new Error('Sensor fuera de alcance'); }
        }
    };
    const { context, elements } = createSensorContext();
    context.setTimeout = callback => { queueMicrotask(callback); return 1; };
    elements.get('sensor-hr-enabled').checked = true;
    context.device = device;
    vm.runInContext('bleDevice = device; bleManual = false; webHrGeneration = 1', context);

    await vm.runInContext('reconnectHr(device, webHrGeneration)', context);

    assert.equal(connectCalls, 5);
    assert.equal(elements.get('sensor-hr-enabled').checked, false);
});
