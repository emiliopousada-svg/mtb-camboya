'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createGpsContext() {
    const state = { now: 10000, timers: [], frames: [], rendered: [] };
    class TestDate extends Date {
        static now() { return state.now; }
    }
    const context = {
        Date: TestDate,
        setTimeout(callback, delay) {
            const timer = { id: state.timers.length + 1, callback, delay, cancelled: false };
            state.timers.push(timer);
            return timer.id;
        },
        clearTimeout(id) {
            const timer = state.timers.find(item => item.id === id);
            if (timer) timer.cancelled = true;
        },
        requestAnimationFrame(callback) {
            state.frames.push(callback);
            return state.frames.length;
        },
        document: { addEventListener() {} },
        window: { addEventListener() {} },
        console: { warn() {} },
        toast() {},
        rendered: state.rendered
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app', 'gps.js'), 'utf8'), context);
    vm.runInContext('renderGpsVisualUpdate = state => rendered.push(state)', context);
    return { context, state };
}

function runNextTimer(state) {
    const timer = state.timers.find(item => !item.cancelled && !item.ran);
    assert.ok(timer);
    timer.ran = true;
    timer.callback();
    return timer;
}

function runNextFrame(state) {
    const callback = state.frames.shift();
    assert.ok(callback);
    callback();
}

test('GPS visual updates are throttled to one per second and coalesce to the latest fix', () => {
    const { context, state } = createGpsContext();
    vm.runInContext('scheduleGpsVisualUpdate({ fix: 1 }); scheduleGpsVisualUpdate({ fix: 2 }); scheduleGpsVisualUpdate({ fix: 3 });', context);

    assert.equal(state.timers.filter(timer => !timer.cancelled).length, 1);
    runNextTimer(state);
    vm.runInContext('scheduleGpsVisualUpdate({ fix: 4 });', context);
    runNextFrame(state);
    assert.deepEqual(JSON.parse(JSON.stringify(state.rendered)), [{ fix: 4 }]);

    state.now += 200;
    vm.runInContext('scheduleGpsVisualUpdate({ fix: 5 });', context);
    const nextTimer = runNextTimer(state);
    assert.equal(nextTimer.delay, 800);
    runNextFrame(state);
    assert.deepEqual(JSON.parse(JSON.stringify(state.rendered)), [{ fix: 4 }, { fix: 5 }]);
});

test('batched route rendering preserves points and keeps each polyline within its chunk limit', () => {
    const { context } = createGpsContext();
    const layers = [];
    context.map = null;
    context.MAX_ROUTE_RENDER_POINTS = 250;
    context.routePolyline = null;
    context.routePolylines = [];
    context.routePolylinePointCount = 0;
    context.routePolylinePoints = [];
    context.routePolylineLastPoint = null;
    context.L = {
        polyline(points) {
            const layer = {
                points: points.slice(),
                setLatLngs(latlngs) {
                    this.points = latlngs.slice();
                    this.setCount = (this.setCount || 0) + 1;
                },
                addTo() {
                    layers.push(this);
                    return this;
                }
            };
            return layer;
        }
    };
    context.routePoints = Array.from({ length: 251 }, (_, index) => [40 + index / 10000, -3]);
    vm.runInContext(
        'pendingRouteRenderPoints = routePoints.map((ll, index) => ({ ll, break: index === 0 })); renderPendingRoutePoints();',
        context
    );
    assert.equal(vm.runInContext('pendingRouteRenderPoints.length', context), 251);

    context.map = {};
    vm.runInContext('renderPendingRoutePoints()', context);
    assert.equal(layers.length, 2);
    assert.equal(layers[0].points.length, 250);
    assert.equal(layers[0].setCount, 1);
    assert.deepEqual(
        JSON.parse(JSON.stringify(layers[1].points)),
        [context.routePoints[249], context.routePoints[250]]
    );
    assert.equal(vm.runInContext('pendingRouteRenderPoints.length', context), 0);
});

test('permission denial cancels and invalidates a pending GPS retry', () => {
    const { context, state } = createGpsContext();
    let watchCalls = 0;
    context.navigator = {
        geolocation: {
            watchPosition() { watchCalls++; return 1; },
            clearWatch() {}
        }
    };
    vm.runInContext('scheduleGpsRetry()', context);
    const retry = state.timers[0];

    vm.runInContext('handleGpsError({ code: 1 })', context);

    assert.equal(retry.cancelled, true);
    assert.equal(vm.runInContext('gpsRetryTimer', context), null);
    retry.callback();
    assert.equal(watchCalls, 0);
});
