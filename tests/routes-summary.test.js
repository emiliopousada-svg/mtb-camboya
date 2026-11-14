'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class MockElement {
    constructor() {
        this.textContent = '';
    }

    addEventListener() {}
}

function createRoutesContext() {
    const elements = new Map();
    const context = {
        document: { querySelectorAll: () => [] },
        $: id => {
            if (!elements.has(id)) elements.set(id, new MockElement());
            return elements.get(id);
        },
        console
    };
    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'app', 'routes.js'), 'utf8'),
        context
    );
    return { context, elements };
}

test('route counters include community publications and downloads without duplicates', () => {
    const { context, elements } = createRoutesContext();
    context.savedRoutes = [
        { id: 1, kind: 'recorded', communityRouteId: 'community-1' },
        { id: 2, kind: 'recorded' },
        { id: 3, kind: 'imported' },
        { id: 4, kind: 'imported', communityRouteId: 'community-1' },
        { id: 5, kind: 'imported', communityRouteId: 'community-2' },
        { id: 6, kind: 'community', communityRouteId: 'not-saved' },
        { id: 7 }
    ];

    vm.runInContext('updateRouteSummaryCounts()', context);

    assert.equal(elements.get('routes-count-done').textContent, '3');
    assert.equal(elements.get('routes-count-pending').textContent, '3');
});

test('saved and completed tabs only include their respective route kinds', () => {
    const { context } = createRoutesContext();

    assert.equal(vm.runInContext('routeBelongsInRoutesTab({kind: "imported"}, "pending")', context), true);
    assert.equal(vm.runInContext('routeBelongsInRoutesTab({kind: "recorded"}, "pending")', context), false);
    assert.equal(vm.runInContext('routeBelongsInRoutesTab({kind: "recorded"}, "done")', context), true);
    assert.equal(vm.runInContext('routeBelongsInRoutesTab({}, "done")', context), true);
    assert.equal(vm.runInContext('routeBelongsInRoutesTab({kind: "community"}, "done")', context), false);
    assert.equal(vm.runInContext('routeCanPublishCommunity({})', context), true);
    assert.equal(vm.runInContext('routeCanPublishCommunity({kind: "recorded", communityRouteId: "already-published"})', context), true);
    assert.equal(vm.runInContext('routeCanPublishCommunity({kind: "imported", communityRouteId: "downloaded"})', context), false);
});

test('route sorting uses import order, performance date, and route metrics', () => {
    const { context } = createRoutesContext();
    context.pending = [
        { id: 1710000000000, name: 'Importación antigua', kind: 'imported', startedAt: '2026-03-10T12:00:00Z', distanceKm: 30, movingTimeSec: 7200, elevationGain: 800 },
        { id: 1720000000000, name: 'Importación reciente', kind: 'imported', startedAt: '2025-03-10T12:00:00Z', distanceKm: 10, movingTimeSec: 1800, elevationGain: 200 }
    ];
    context.completed = [
        { id: 3, name: 'Salida antigua', kind: 'recorded', startedAt: '2025-03-10T12:00:00Z', distanceKm: 30, movingTimeSec: 7200, elevationGain: 800 },
        { id: 4, name: 'Salida reciente', kind: 'recorded', startedAt: '2026-03-10T12:00:00Z', distanceKm: 10, movingTimeSec: 1800, elevationGain: 200 }
    ];

    const sortedNames = order => Array.from(
        vm.runInContext(`sortRoutesForList(pending, "${order}", "pending")`, context),
        route => route.name
    );
    assert.deepEqual(sortedNames('recent'), ['Importación reciente', 'Importación antigua']);
    assert.deepEqual(sortedNames('distance-desc'), ['Importación antigua', 'Importación reciente']);
    assert.deepEqual(sortedNames('time-asc'), ['Importación reciente', 'Importación antigua']);
    assert.deepEqual(
        Array.from(vm.runInContext('sortRoutesForList(pending, "elevation-desc", "pending")', context), route => route.name),
        ['Importación antigua', 'Importación reciente']
    );

    assert.deepEqual(
        Array.from(vm.runInContext('sortRoutesForList(completed, "recent", "done")', context), route => route.name),
        ['Salida reciente', 'Salida antigua']
    );
});
