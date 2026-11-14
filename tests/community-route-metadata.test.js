'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class MockElement {
    constructor() {
        this.value = '';
        this.children = [];
        this.dataset = {};
        this.classList = { toggle() {} };
    }

    add() {}
    addEventListener() {}
    append(...items) { this.children.push(...items); }
    appendChild(item) { this.children.push(item); }
    focus() {}
    replaceChildren(...items) { this.children = items; }
}

class MockFormData {
    constructor() {
        this.entries = [];
    }

    append(...entry) { this.entries.push(entry); }
}

function createCommunityContext() {
    const elements = new Map();
    const calls = { formData: null, savedRoute: null, rendered: 0 };
    const context = {
        document: { addEventListener() {}, createElement: () => new MockElement() },
        $: id => {
            if (!elements.has(id)) elements.set(id, new MockElement());
            return elements.get(id);
        },
        Option: class Option {
            constructor(label, value) { this.label = label; this.value = value; }
        },
        FormData: MockFormData,
        navigator: { onLine: true },
        Cloud: { uid: 'user-1', server: 'https://example.invalid', loggedIn: () => true },
        DB: { put: async route => { calls.savedRoute = { ...route }; } },
        ACTIVITY_TYPES: { mtb: { icon: '🚵', label: 'MTB' } },
        activityTypeForRoute: () => 'mtb',
        cloudApi: async (_url, _method, formData) => {
            calls.formData = formData;
            return { id: 'community-route-1' };
        },
        communityPublicPoiData: () => ({ json: '[]', count: 0, skipped: 0 }),
        communityPublicTrack: () => [[[40, -3], [40.01, -3]]],
        communitySetStatus() {},
        renderSavedRoutes: () => { calls.rendered++; },
        closeCommunityDialog() {},
        toast() {},
        console,
        setTimeout() {}
    };
    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'app', 'community-routes.js'), 'utf8'),
        context
    );
    context.communityPublicPoiData = () => ({ json: '[]', count: 0, skipped: 0 });
    context.communityPublicTrack = () => [[[40, -3], [40.01, -3]]];
    return { context, elements, calls };
}

test('publishing a route records its date and updates its local community counter metadata', async () => {
    const { context, calls } = createCommunityContext();
    const route = {
        id: 8,
        kind: 'recorded',
        name: 'Ruta publicada',
        startedAt: '2026-03-10T12:00:00.000Z',
        distanceKm: 24,
        elevationGain: 620,
        points: []
    };
    context.$('community-share-province').value = 'Girona';
    context.$('community-share-consent').checked = true;
    context.route = route;
    vm.runInContext('communityShareRoute = route', context);

    await vm.runInContext('submitCommunityRoute()', context);

    const submitted = new Map(calls.formData.entries.map(([key, value]) => [key, value]));
    assert.equal(submitted.get('performedAt'), '2026-03-10');
    assert.equal(route.communityRouteId, 'community-route-1');
    assert.equal(route.province, 'Girona');
    assert.deepEqual(calls.savedRoute, { ...route });
    assert.equal(calls.rendered, 1);
});

test('publishing an already linked route updates its community record instead of duplicating it', async () => {
    const { context, calls } = createCommunityContext();
    const requests = [];
    context.cloudApi = async (url, method) => {
        requests.push({ url, method });
        return { id: 'existing-community-route' };
    };
    const route = {
        id: 9,
        kind: 'recorded',
        communityRouteId: 'existing-community-route',
        name: 'Ruta ya publicada',
        points: []
    };
    context.$('community-share-province').value = 'Girona';
    context.$('community-share-consent').checked = true;
    context.route = route;
    vm.runInContext('communityShareRoute = route', context);

    await vm.runInContext('submitCommunityRoute()', context);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/collections/community_routes/records/existing-community-route');
    assert.equal(requests[0].method, 'PATCH');
    assert.equal(route.communityRouteId, 'existing-community-route');
    assert.equal(calls.rendered, 1);
});

test('publishing recreates the community record when its stored server record was deleted', async () => {
    const { context, calls } = createCommunityContext();
    const requests = [];
    context.cloudApi = async (url, method) => {
        requests.push({ url, method });
        if (method === 'PATCH') {
            const error = new Error('not found');
            error.status = 404;
            throw error;
        }
        return { id: 'replacement-community-route' };
    };
    const route = {
        id: 10,
        kind: 'recorded',
        communityRouteId: 'deleted-community-route',
        name: 'Ruta recuperada',
        points: []
    };
    context.$('community-share-province').value = 'Girona';
    context.$('community-share-consent').checked = true;
    context.route = route;
    vm.runInContext('communityShareRoute = route', context);

    await vm.runInContext('submitCommunityRoute()', context);

    assert.equal(requests.length, 2);
    assert.equal(requests[0].method, 'PATCH');
    assert.equal(requests[1].method, 'POST');
    assert.equal(route.communityRouteId, 'replacement-community-route');
    assert.equal(calls.rendered, 1);
});

test('saving a community route keeps its province, performance date and route metrics', async () => {
    const { context, calls } = createCommunityContext();
    context.savedRoutes = [];
    context.record = {
        id: 'community-route-1',
        title: 'Ruta descargada',
        province: 'Girona',
        performedAt: '2026-03-10',
        distanceKm: 24,
        elevationGain: 620,
        poisJson: '[]'
    };
    context.lines = [[[40, -3], [40.01, -3]]];

    await vm.runInContext('saveCommunityOffline(record, lines)', context);

    assert.equal(context.savedRoutes[0].kind, 'imported');
    assert.equal(context.savedRoutes[0].communityRouteId, 'community-route-1');
    assert.equal(context.savedRoutes[0].province, 'Girona');
    assert.equal(context.savedRoutes[0].startedAt, '2026-03-10T12:00:00');
    assert.equal(context.savedRoutes[0].distanceKm, 24);
    assert.equal(context.savedRoutes[0].elevationGain, 620);
    assert.equal(calls.rendered, 1);
});

test('community counter matches visible search results and resets when the list is empty', () => {
    const { context } = createCommunityContext();
    context.records = [
        {
            id: 'farther',
            title: 'Ruta más lejana',
            trackJson: '[[[40,-3],[40.01,-3]]]',
            poisJson: '[]',
            distanceKm: 24,
            elevationGain: 620,
            proximityKm: 9,
            owner: 'another-user'
        },
        {
            id: 'nearer',
            title: 'Ruta más cercana',
            trackJson: '[[[40,-3],[40.01,-3]]]',
            poisJson: '[]',
            distanceKm: 18,
            elevationGain: 300,
            proximityKm: 2,
            owner: 'another-user'
        },
        { id: 'invalid', title: 'Ruta inválida', trackJson: '[]', poisJson: '[]' }
    ];

    vm.runInContext('renderCommunityRoutes(records)', context);

    assert.equal(context.$('routes-count-community').textContent, '2');
    assert.equal(context.$('community-route-list').children.length, 2);
    assert.equal(context.$('community-route-list').children[0].children[0].textContent, 'Ruta más cercana');

    vm.runInContext('renderCommunityRoutes([])', context);

    assert.equal(context.$('routes-count-community').textContent, '0');
});
