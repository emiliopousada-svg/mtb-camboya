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

test('imported route detail shows account nickname and omits heart rate', async () => {
    const { context, getDetailOptions } = createRouteDetailsContext();
    context.route = {
        kind: 'imported',
        name: 'Ruta importada',
        createdBy: 'ciclista@example.com',
        points: [[40, -3], [40.001, -3]],
        distanceKm: 2,
        elevationGain: null,
        movingTimeSec: 0,
        hrAvg: 160
    };

    await vm.runInContext('openSavedRouteDetail(route)', context);

    const values = JSON.parse(JSON.stringify(getDetailOptions().values));
    assert.deepEqual(values.find(([label]) => label === 'Importada por'), ['Importada por', 'Ciclista']);
    assert.equal(values.some(([label]) => label.includes('cardíaca')), false);
});
