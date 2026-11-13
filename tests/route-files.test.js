'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const statistics = require('../app/statistics-engine.js');

function routeFilesApi() {
    const context = {
        Cloud: { email: 'rider@example.com' },
        dist: statistics.calculateDistanceMeters,
        makeElevTracker() {
            return statistics.createElevationTracker({ threshold: 3, smoothingWindow: 5 });
        }
    };
    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'app', 'route-files.js'), 'utf8'),
        context
    );
    return vm.runInContext('({ parseTrack, buildImportedRoute })', context);
}

function importRoute(coordinates) {
    const api = routeFilesApi();
    const parsed = api.parseTrack(JSON.stringify({
        type: 'LineString',
        coordinates
    }), 'imported.geojson');
    return api.buildImportedRoute(parsed, 'Ruta importada');
}

test('imported tracks calculate distance and elevation gain when altitude is present', () => {
    const coordinates = Array.from({ length: 12 }, (_, index) => [
        index * 0.001, 40, 100 + index * 5
    ]);
    const route = importRoute(coordinates);

    assert.ok(route.distanceKm > 0);
    assert.ok(route.elevationGain > 0);
});

test('imported tracks keep distance and mark elevation unavailable without altitude data', () => {
    const route = importRoute([
        [0, 40],
        [0.001, 40],
        [0.002, 40]
    ]);

    assert.ok(route.distanceKm > 0);
    assert.equal(route.elevationGain, null);
    assert.equal(route.startedAt, null);
});

test('imported tracks preserve their recorded date from GPS timestamps', () => {
    const api = routeFilesApi();
    const startedAt = Date.parse('2026-03-10T07:15:00.000Z');
    const route = api.buildImportedRoute({
        segs: [[
            [40, -3, null, startedAt],
            [40.001, -3, null, startedAt + 10000]
        ]]
    }, 'Ruta importada');

    assert.equal(route.startedAt, '2026-03-10T07:15:00.000Z');
});
