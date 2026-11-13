'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createGroupsContext(groupCode = 'group1') {
    const calls = [];
    const toasts = [];
    let modalCalls = 0;
    const context = {
        Cloud: {
            loggedIn: () => true,
            groupCode,
            uid: 'user1',
            server: 'https://pocketbase.example'
        },
        DB: { put: async () => {} },
        cloudApi: async (endpoint, method, body) => {
            calls.push({ endpoint, method, body });
            return { newDistanceRecord: true, newTimeRecord: false, newSpeedRecord: false };
        },
        document: { addEventListener() {}, visibilityState: 'visible' },
        window: { addEventListener() {} },
        navigator: { onLine: true },
        $: () => ({ addEventListener() {} }),
        statsAnalyzeRoute: () => ({
            distanceKm: 18.4,
            movingTimeSec: 3600,
            maxSpeed: 52.3
        }),
        fmtDur: seconds => `${seconds}s`,
        modal: async () => {
            modalCalls++;
            return true;
        },
        toast: message => toasts.push(message),
        console: { warn() {} },
        currentPage: 0
    };
    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'app', 'groups.js'), 'utf8'),
        context
    );
    return { context, calls, toasts, getModalCalls: () => modalCalls };
}

test('recorded route ranking is shared automatically once with the selected group', async () => {
    const { context, calls, toasts, getModalCalls } = createGroupsContext();
    vm.runInContext('groupInfo = { name: "Camboya" }', context);
    context.route = { id: 123, kind: 'recorded', distanceKm: 18.4, movingTimeSec: 3600 };

    const first = await vm.runInContext(
        'shareRouteToGroupRanking(route, null, { automatic: true })',
        context
    );
    const second = await vm.runInContext(
        'shareRouteToGroupRanking(route, null, { automatic: true })',
        context
    );

    assert.equal(first, true);
    assert.equal(second, true);
    assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), {
        endpoint: '/api/mtb/groups/rankings/share',
        method: 'POST',
        body: { clientId: 123, distanceKm: 18.4, movingTimeSec: 3600, maxSpeedKmh: 52.3 }
    });
    assert.equal(context.route.groupRankingGroupId, 'group1');
    assert.equal(context.route.groupRankingPending, false);
    assert.equal(getModalCalls(), 0);
    assert.match(toasts[0], /Camboya/);
});

test('automatic ranking sharing does nothing without an active group', async () => {
    const { context, calls, getModalCalls } = createGroupsContext('');
    context.route = { id: 123, kind: 'recorded', distanceKm: 18.4, movingTimeSec: 3600 };

    const result = await vm.runInContext(
        'shareRouteToGroupRanking(route, null, { automatic: true })',
        context
    );

    assert.equal(result, false);
    assert.equal(calls.length, 0);
    assert.equal(getModalCalls(), 0);
});

test('automatic ranking sharing excludes imported and community routes', async () => {
    const { context, calls, getModalCalls } = createGroupsContext();
    for (const kind of ['imported', 'community']) {
        context.route = { id: 123, kind, distanceKm: 18.4, movingTimeSec: 3600 };
        const result = await vm.runInContext(
            'shareRouteToGroupRanking(route, null, { automatic: true })',
            context
        );
        assert.equal(result, false);
    }

    assert.equal(calls.length, 0);
    assert.equal(getModalCalls(), 0);
});

test('failed automatic ranking sharing remains pending for retry', async () => {
    const { context } = createGroupsContext();
    context.route = { id: 123, kind: 'recorded', distanceKm: 18.4, movingTimeSec: 3600 };
    let attempts = 0;
    context.cloudApi = async () => {
        if (attempts++ === 0) throw new Error('servidor no disponible');
        return { newDistanceRecord: false, newTimeRecord: false, newSpeedRecord: false };
    };

    await assert.rejects(
        vm.runInContext('shareRouteToGroupRanking(route, null, { automatic: true })', context),
        /servidor no disponible/
    );
    assert.equal(context.route.groupRankingPending, true);

    const retried = await vm.runInContext(
        'shareRouteToGroupRanking(route, null, { automatic: true })',
        context
    );
    assert.equal(retried, true);
    assert.equal(context.route.groupRankingPending, false);
    assert.equal(context.route.groupRankingGroupId, 'group1');
});
