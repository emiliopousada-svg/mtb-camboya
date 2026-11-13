'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const statistics = require('../app/statistics-engine.js');

function importRoute(coordinates) {
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
    const api = vm.runInContext('({ parseTrack, buildImportedRoute })', context);
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
});
