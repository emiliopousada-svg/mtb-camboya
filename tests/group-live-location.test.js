'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createLiveLocationContext({
    online,
    sendLocation,
    values = new Map(),
    now = 1000000,
    lat = 40,
    lon = -3
}) {
    const state = {
        now,
        online,
        values,
        calls: [],
        nextTimerId: 1
    };
    const element = { textContent: '', addEventListener() {} };
    class TestDate extends Date {
        static now() { return state.now; }
    }
    const context = {
        Cloud: {
            loggedIn: () => true,
            nickname: 'Rider',
            groupCode: 'group1',
            uid: 'user1',
            server: 'https://pocketbase.example'
        },
        DB: {
            async kvGet(key) { return state.values.get(key); },
            async kvSet(key, value) { state.values.set(key, { ...value }); },
            async kvDel(key) { state.values.delete(key); }
        },
        cloudApi: async (endpoint, method, body) => {
            state.calls.push({ endpoint, method, body });
            if (sendLocation) return sendLocation(state, endpoint, method, body);
            if (endpoint.startsWith('/api/collections/live_locations/records?')) return { items: [] };
            if (method === 'POST') return { id: 'live-1' };
            return {};
        },
        document: { addEventListener() {}, visibilityState: 'visible' },
        window: { addEventListener() {} },
        navigator: { get onLine() { return state.online; } },
        $: () => element,
        MAX_ACC_M: 30,
        isRecording: true,
        isPaused: false,
        lastLat: lat,
        lastLon: lon,
        lastAccuracy: 5,
        lastPositionAt: state.now,
        Date: TestDate,
        setTimeout() { return state.nextTimerId++; },
        clearTimeout() {},
        console: { warn() {} },
        currentPage: 0
    };
    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'app', 'groups.js'), 'utf8'),
        context
    );
    vm.runInContext(
        'groupJoined = true; refreshFriends = async () => {}; renderFriends = () => {}; renderFriendsGroupStatus = () => {};',
        context
    );
    return { context, state };
}

test('offline live location persistence replaces the previous fix', async () => {
    const { context, state } = createLiveLocationContext({ online: false });

    await vm.runInContext('publishMyLocation()', context);
    context.lastLat = 40.01;
    context.lastLon = -3.01;
    context.lastPositionAt = state.now;
    await vm.runInContext('publishMyLocation()', context);

    const pending = state.values.get('pendingLiveLocation');
    assert.equal(state.values.size, 1);
    assert.equal(pending.lat, 40.01);
    assert.equal(pending.lon, -3.01);
    assert.equal(state.calls.length, 0);

    await vm.runInContext('removeMyLiveLocation()', context);
    assert.equal(state.values.has('pendingLiveLocation'), false);
});

test('failed live location publication retries after backoff using the newest fix', async () => {
    let fail = true;
    let { context, state } = createLiveLocationContext({
        online: true,
        sendLocation: async (current, endpoint, method, body) => {
            if (endpoint.startsWith('/api/collections/live_locations/records?')) return { items: [] };
            if (method === 'POST' && fail) throw new Error('network unavailable');
            if (method === 'POST') return { id: 'live-1' };
            return {};
        }
    });

    await vm.runInContext('publishMyLocation(true)', context);
    const firstPending = state.values.get('pendingLiveLocation');
    assert.equal(firstPending.retryAttempt, 1);
    assert.equal(firstPending.retryAt, state.now + 5000);

    ({ context, state } = createLiveLocationContext({
        online: true,
        sendLocation: async (current, endpoint, method, body) => {
            if (endpoint.startsWith('/api/collections/live_locations/records?')) return { items: [] };
            if (method === 'POST' && fail) throw new Error('network unavailable');
            if (method === 'POST') return { id: 'live-1' };
            return {};
        },
        values: state.values,
        now: state.now + 1000,
        lat: 40.02,
        lon: -3.02
    }));
    await vm.runInContext('publishMyLocation(true)', context);
    assert.equal(state.calls.length, 0);
    assert.equal(state.values.get('pendingLiveLocation').lat, 40.02);

    fail = false;
    state.now = firstPending.retryAt;
    await vm.runInContext('publishMyLocation(true)', context);

    const latestPost = state.calls.filter(call => call.method === 'POST').at(-1);
    assert.equal(latestPost.body.lat, 40.02);
    assert.equal(latestPost.body.lon, -3.02);
    assert.equal(state.values.has('pendingLiveLocation'), false);
});
