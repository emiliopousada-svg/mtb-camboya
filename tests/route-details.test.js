'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createRouteDetailsContext() {
    let detailOptions;
    const context = {
        document: { querySelectorAll: () => [] },
        $: () => ({ addEventListener() {} }),
        Cloud: { nickname: 'Ciclista', email: 'ciclista@example.com' },
        DB: { loadRoutePhotos: async () => {} },
        lastLat: 40,
        lastLon: -3,
        communityDistanceToRoute: () => 4200,
        fmtDate: value => new Date(value).toISOString().slice(0, 10),
        communityRawSegments: () => [[ [40, -3], [40.001, -3] ]],
        openCommunityDetail: (_route, _lines, options) => { detailOptions = options; },
        ACTIVITY_TYPES: {},
        activityTypeForRoute: () => 'cycling',
        currentPage: 3,
        console,
        toast() {},
        closeCommunityDialog() {},
        goToPage() {},
        setRoutesTab() {}
    };
    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'app', 'routes.js'), 'utf8'),
        context
    );
    return {
        context,
        getDetailOptions: () => detailOptions
    };
}

test('downloaded community route detail shows its location, date and province without heart rate', async () => {
    const { context, getDetailOptions } = createRouteDetailsContext();
    context.route = {
        kind: 'imported',
        name: 'Ruta importada',
        createdBy: 'ciclista@example.com',
        points: [[40, -3], [40.001, -3]],
        distanceKm: 2,
        elevationGain: 86,
        movingTimeSec: 0,
        hrAvg: 160,
        province: 'Girona',
        startedAt: '2026-03-10T12:00:00.000Z',
        performedAt: '2026-03-10',
        communityRouteId: 'community-route-id'
    };

    await vm.runInContext('openSavedRouteDetail(route)', context);

    const values = JSON.parse(JSON.stringify(getDetailOptions().values));
    assert.deepEqual(values.find(([label]) => label === 'Importada por'), ['Importada por', 'Ciclista']);
    assert.deepEqual(values.find(([label]) => label === 'Distancia desde tu posición'), ['Distancia desde tu posición', '4.2 km']);
    assert.deepEqual(values.find(([label]) => label === 'Provincia'), ['Provincia', 'Girona']);
    assert.deepEqual(values.find(([label]) => label === 'Distancia'), ['Distancia', '2.0 km']);
    assert.deepEqual(values.find(([label]) => label === 'Desnivel'), ['Desnivel', '+86 m']);
    assert.deepEqual(values.find(([label]) => label === 'Fecha de realización'), ['Fecha de realización', '2026-03-10']);
    assert.equal(values.some(([label]) => label.includes('cardíaca')), false);
});
