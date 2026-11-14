'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createCloudContext(fetchImpl = async () => { throw new TypeError('Network unavailable'); }) {
    const storage = new Map([
        ['mtb_server', 'https://example.test'],
        ['mtb_token', 'token'],
        ['mtb_uid', 'user-1'],
        ['mtb_email', 'rider@example.test'],
        ['mtb_nickname', 'Rider']
    ]);
    const timers = [];
    let nextTimerId = 0;
    const context = {
        localStorage: {
            getItem(key) { return storage.has(key) ? storage.get(key) : null; },
            setItem(key, value) { storage.set(key, String(value)); },
            removeItem(key) { storage.delete(key); }
        },
        navigator: { onLine: true },
        URL,
        FormData,
        Blob,
        AbortController,
        fetch: fetchImpl,
        setTimeout(callback, delay) {
            const timer = { id: ++nextTimerId, callback, delay, cancelled: false, ran: false };
            timers.push(timer);
            return timer.id;
        },
        clearTimeout(id) {
            const timer = timers.find(item => item.id === id);
            if (timer) timer.cancelled = true;
        },
        console: { warn() {} },
        $: () => ({ style: {}, hidden: false, value: '', textContent: '' }),
        renderAccount() {},
        toast() {},
        syncSharedPois() {}
    };
    vm.createContext(context);
    let source = fs.readFileSync(path.join(__dirname, '..', 'app', 'cloud.js'), 'utf8');
    const bootstrapMarker = /\r?\ninit\(\);\r?\n\r?\n\/\/ Service Worker:/;
    assert.ok(bootstrapMarker.test(source));
    source = source.slice(0, source.search(bootstrapMarker));
    vm.runInContext(source, context);
    vm.runInContext('globalThis.testCloud = Cloud; globalThis.testSetSyncRetryQueued = () => { syncRetryQueued = true; }', context);
    return { context, storage, timers };
}

function makeHttpResponse(status, message) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() { return { message }; }
    };
}

test('cloudApi marks network and server errors retryable but not permanent client errors', async () => {
    const network = createCloudContext(async () => { throw new TypeError('Network unavailable'); });
    await assert.rejects(network.context.cloudApi('/api/test'), error => error.retryable === true);

    const unavailable = createCloudContext(async () => makeHttpResponse(503, 'Unavailable'));
    await assert.rejects(unavailable.context.cloudApi('/api/test'), error =>
        error.status === 503 && error.retryable === true);

    const limited = createCloudContext(async () => makeHttpResponse(429, 'Too many requests'));
    await assert.rejects(limited.context.cloudApi('/api/test'), error =>
        error.status === 429 && error.retryable === true);

    const validation = createCloudContext(async () => makeHttpResponse(400, 'Invalid data'));
    await assert.rejects(validation.context.cloudApi('/api/test'), error =>
        error.status === 400 && error.retryable === false);

    const unauthorized = createCloudContext(async () => makeHttpResponse(401, 'Unauthorized'));
    await assert.rejects(unauthorized.context.cloudApi('/api/test'), error =>
        error.status === 401 && error.retryable === false);
});

test('sync retries transient failures with backoff and cancels the retry on logout', async () => {
    const { context, timers } = createCloudContext();
    let attempts = 0;
    context.cloudApi = async () => {
        attempts++;
        const error = new Error('Network unavailable');
        error.retryable = true;
        throw error;
    };

    await context.syncRoutes();
    const firstTimer = timers.find(timer => !timer.cancelled && !timer.ran);
    assert.ok(firstTimer);
    assert.equal(firstTimer.delay, 5000);

    firstTimer.ran = true;
    firstTimer.callback();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(attempts, 2);
    const secondTimer = timers.find(timer => !timer.cancelled && !timer.ran);
    assert.ok(secondTimer);
    assert.equal(secondTimer.delay, 10000);

    context.testCloud.clearSession();
    assert.equal(secondTimer.cancelled, true);
    assert.equal(context.testCloud.loggedIn(), false);
});

test('permanent HTTP sync errors do not schedule automatic retries', async () => {
    const { context, timers } = createCloudContext();
    context.cloudApi = async () => {
        const error = new Error('Invalid request');
        error.status = 400;
        error.retryable = false;
        throw error;
    };

    context.testSetSyncRetryQueued();
    await context.syncRoutes();
    assert.equal(timers.filter(timer => !timer.cancelled).length, 0);
    assert.equal(context.testCloud.loggedIn(), true);
});

test('an expired session is cleared without scheduling another retry', async () => {
    const { context, timers } = createCloudContext();
    context.cloudApi = async () => {
        const error = new Error('Unauthorized');
        error.status = 401;
        error.retryable = false;
        throw error;
    };

    await context.syncRoutes();
    assert.equal(context.testCloud.loggedIn(), false);
    assert.equal(timers.filter(timer => !timer.cancelled).length, 0);
});

test('a recording kept locally while offline uploads after connectivity returns', async () => {
    const { context } = createCloudContext();
    const calls = [];
    const route = {
        id: 123,
        kind: 'recorded',
        name: 'Ruta guardada sin red',
        startedAt: '2026-11-14T10:00:00.000Z',
        movingTimeSec: 900,
        distanceKm: 8.5,
        elevationGain: 240,
        points: [[40, -3], [40.01, -3]]
    };
    context.savedRoutes = [route];
    context.DB = {
        async kvGet() { return []; },
        async kvSet() {},
        async put() {}
    };
    context.fetchRemoteRoutes = async () => ({ records: [], fullAudit: true });
    context.ensureRouteNickname = async () => 'Rider';
    context.syncPendingAccountAvatar = async () => {};
    context.renderAccountProfile = () => {};
    context.renderSavedRoutes = () => {};
    context.refreshStats = () => {};
    context.cloudApi = async (endpoint, method) => {
        calls.push({ endpoint, method });
        if (endpoint.endsWith('/auth-refresh')) {
            return { token: 'renewed', record: { id: 'user-1', email: 'rider@example.test', nickname: 'Rider' } };
        }
        if (endpoint === '/api/collections/routes/records' && method === 'POST') return { id: 'remote-route-1' };
        throw new Error(`Unexpected request: ${method} ${endpoint}`);
    };

    context.navigator.onLine = false;
    await context.syncRoutes();
    assert.equal(calls.length, 0);
    assert.equal(route.remoteId, undefined);

    context.navigator.onLine = true;
    await context.syncWhenOnline();
    assert.ok(calls.some(call => call.endpoint === '/api/collections/routes/records' && call.method === 'POST'));
    assert.equal(route.remoteId, 'remote-route-1');
});

test('saving the account nickname resumes queued route synchronization', async () => {
    const { context } = createCloudContext();
    const elements = {
        'acc-account-nickname': { value: 'Rider' },
        'acc-nickname-save': { disabled: false }
    };
    context.$ = id => elements[id] || { style: {}, hidden: false, value: '', textContent: '' };
    context.cloudApi = async () => ({ id: 'user-1', email: 'rider@example.test', nickname: 'Rider' });
    let routeSyncs = 0, poiSyncs = 0;
    context.syncRoutes = () => { routeSyncs++; };
    context.syncSharedPois = () => { poiSyncs++; };

    await context.saveAccountNickname();

    assert.equal(context.testCloud.nickname, 'Rider');
    assert.equal(routeSyncs, 1);
    assert.equal(poiSyncs, 1);
});
