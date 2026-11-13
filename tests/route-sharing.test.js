'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createRouteShareContext(options = {}) {
    const calls = { shared: null, downloaded: null };
    class TestFile {
        constructor(parts, name, fileOptions) {
            this.parts = parts;
            this.name = name;
            this.type = fileOptions.type;
        }
    }
    const context = {
        document: { querySelectorAll: () => [] },
        $: () => ({ addEventListener() {} }),
        window: { Capacitor: null },
        navigator: {
            canShare: options.canShare || (() => true),
            share: async payload => { calls.shared = payload; }
        },
        File: TestFile,
        routeToGpx: () => '<gpx>track</gpx>',
        download: async (...args) => { calls.downloaded = args; },
        console,
        toast() {}
    };
    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'app', 'routes.js'), 'utf8'),
        context
    );
    return { context, calls };
}

test('sharing a saved route shares a GPX file', async () => {
    const { context, calls } = createRouteShareContext();
    context.route = { name: 'Ruta de prueba' };

    await vm.runInContext('shareSavedRoute(route)', context);

    const [file] = calls.shared.files;
    assert.equal(file.name, 'Ruta de prueba.gpx');
    assert.equal(file.type, 'application/gpx+xml');
    assert.equal(file.parts.join(''), '<gpx>track</gpx>');
    assert.equal(calls.downloaded, null);
});

test('sharing a saved route downloads GPX when file sharing is unavailable', async () => {
    const { context, calls } = createRouteShareContext({ canShare: () => false });
    context.route = { name: 'Ruta de prueba' };

    await vm.runInContext('shareSavedRoute(route)', context);

    assert.equal(calls.shared, null);
    assert.deepEqual(calls.downloaded, [
        'Ruta de prueba.gpx',
        '<gpx>track</gpx>',
        'application/gpx+xml'
    ]);
});

test('sharing a saved route uses the native file share flow', async () => {
    const { context, calls } = createRouteShareContext();
    context.window.Capacitor = {
        isNativePlatform: () => true,
        Plugins: { Share: {} }
    };
    context.route = { name: 'Ruta de prueba' };

    await vm.runInContext('shareSavedRoute(route)', context);

    assert.deepEqual(calls.downloaded, [
        'Ruta de prueba.gpx',
        '<gpx>track</gpx>',
        'application/gpx+xml'
    ]);
    assert.equal(calls.shared, null);
});
