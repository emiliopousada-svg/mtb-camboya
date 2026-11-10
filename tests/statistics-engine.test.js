'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const engine = require('../app/statistics-engine.js');

const timestamp = Date.UTC(2026, 0, 1);

function trackPoint(lat, lon, altitude, seconds, extras = []) {
    return [lat, lon, altitude, timestamp + seconds * 1000, ...extras];
}

test('calculates GPS distance with the Haversine formula', () => {
    const distance = engine.calculateDistanceMeters([0, 0], [0, 1]);
    assert.ok(Math.abs(distance - 111194.9) < 1);
    assert.ok(Number.isNaN(engine.calculateDistanceMeters([91, 0], [0, 0])));
});

test('filters impossible GPS jumps without connecting across the gap', () => {
    const route = {
        startedAt: new Date(timestamp).toISOString(),
        movingTimeSec: 10,
        distanceKm: 0,
        points: [
            trackPoint(0, 0, 100, 0),
            trackPoint(0, 1, 100, 1),
            trackPoint(0, 0.001, 100, 2)
        ]
    };
    const result = engine.analyzeRoute(route);
    assert.equal(result.rejectedGpsPoints, 1);
    assert.equal(result.distanceKm, 0);
    assert.deepEqual(result.mapSegments.map(segment => segment.length), [1, 1]);
});

test('does not count distance or elapsed time across recorded track breaks', () => {
    const route = {
        startedAt: new Date(timestamp).toISOString(),
        movingTimeSec: 30,
        points: [
            trackPoint(0, 0, 100, 0),
            trackPoint(0, 0.001, 100, 10),
            [0, 1, 100, timestamp + 20000, null, 1],
            trackPoint(0, 1.001, 100, 30)
        ]
    };
    const result = engine.analyzeRoute(route);
    assert.ok(result.distanceKm > 0.2 && result.distanceKm < 0.23);
    assert.equal(result.stoppedTimeSec, 0);
    assert.deepEqual(result.mapSegments.map(segment => segment.length), [2, 2]);
});

test('smooths altitude noise and calculates climb, descent, slope and VAM', () => {
    const points = [];
    for (let index = 0; index < 12; index++) {
        const noise = index % 2 ? 1.5 : -1.5;
        points.push(trackPoint(0, index * 0.0003, 100 + index * 2 + noise, index * 5, [null, 8]));
    }
    const result = engine.analyzeRoute({
        startedAt: new Date(timestamp).toISOString(),
        movingTimeSec: 55,
        points
    });
    assert.ok(result.ascentM > 10);
    assert.ok(result.climbDistanceKm > 0);
    assert.ok(result.climbTimeSec > 0);
    assert.ok(result.vam > 0);
    assert.ok(result.longestClimbDistanceKm > 0);
    assert.ok(result.longestClimbAscentM > 0);
    assert.ok(result.maxAltitude > result.minAltitude);
    const gradeDistance = Object.values(result.gradeDistributionKm).reduce((sum, distance) => sum + distance, 0);
    assert.ok(Math.abs(gradeDistance - result.gradeDistanceKm) < 1e-9);
});

test('classifies sustained descents and does not invent a VAM without climbing time', () => {
    const points = Array.from({ length: 12 }, (_, index) =>
        trackPoint(0, index * 0.0003, 200 - index * 2, index * 5));
    const result = engine.analyzeRoute({
        startedAt: new Date(timestamp).toISOString(),
        movingTimeSec: 55,
        points
    });
    assert.ok(result.descentM > 10);
    assert.ok(result.downhillDistanceKm > 0);
    assert.ok(result.downhillTimeSec > 0);
    assert.ok(result.gradeDistributionKm.downhill > 0);
    assert.equal(result.vam, null);
    assert.equal(result.longestClimbDistanceKm, null);
});

test('keeps continuous-climb records separate across recorded track breaks', () => {
    const points = [];
    for (let index = 0; index < 8; index++) {
        points.push(trackPoint(0, index * 0.0003, 100 + index * 2, index * 5));
    }
    points.push(trackPoint(0, 1, 100, 40, [null, 1]));
    for (let index = 1; index < 8; index++) {
        points.push(trackPoint(0, 1 + index * 0.0003, 100 + index * 2, 40 + index * 5));
    }
    const result = engine.analyzeRoute({
        startedAt: new Date(timestamp).toISOString(),
        movingTimeSec: 75,
        points
    });
    assert.ok(result.longestClimbDistanceKm > 0);
    assert.ok(result.climbDistanceKm > result.longestClimbDistanceKm);
});

test('excludes ascent without valid climbing time from VAM aggregation', () => {
    const makeClimb = secondsPerPoint => Array.from({ length: 12 }, (_, index) =>
        trackPoint(0, index * 0.0003, 100 + index * 2, index * secondsPerPoint));
    const timed = engine.analyzeRoute({
        startedAt: new Date(timestamp).toISOString(),
        movingTimeSec: 55,
        points: makeClimb(5)
    });
    const untimed = engine.analyzeRoute({
        startedAt: new Date(timestamp).toISOString(),
        movingTimeSec: 500,
        points: makeClimb(40)
    });
    const summary = engine.aggregate([timed, untimed]);
    assert.ok(untimed.climbAscentM > 0);
    assert.equal(untimed.climbTimeSec, 0);
    assert.equal(untimed.vam, null);
    assert.equal(summary.vam, timed.vam);
    assert.ok(summary.climbAscentM > summary.vamAscentM);
});

test('uses stored metrics when legacy activity tracks lack usable GPS or altitude', () => {
    const result = engine.analyzeRoute({
        distanceKm: 12.5,
        elevationGain: 320,
        movingTimeSec: 3600,
        points: [[null, null, null, null]]
    });
    assert.equal(result.distanceKm, 12.5);
    assert.equal(result.ascentM, 320);
    assert.equal(result.ascentAvailable, true);
    assert.equal(result.descentAvailable, false);
    assert.equal(result.averageSpeed, 12.5);
    assert.equal(result.descentM, 0);
});

test('estimates missing moving time from valid timed GPS intervals', () => {
    const result = engine.analyzeRoute({
        startedAt: new Date(timestamp).toISOString(),
        distanceKm: 0.22,
        points: [
            trackPoint(0, 0, 100, 0),
            trackPoint(0, 0.001, 100, 10),
            trackPoint(0, 0.002, 100, 20)
        ]
    });
    assert.equal(result.movingTimeEstimated, true);
    assert.ok(result.movingTimeSec > 0);
});

test('aggregates elapsed, climbing, sensor and heart-rate zone statistics', () => {
    const route = {
        startedAt: new Date(timestamp).toISOString(),
        movingTimeSec: 20,
        points: [
            trackPoint(0, 0, 100, 0, [120, null, 10, 80, 70]),
            trackPoint(0, 0.001, 110, 30, [140, null, 10, 90, 100])
        ]
    };
    const analysis = engine.analyzeRoute(route, { heartRateMax: 200 });
    const summary = engine.aggregate([analysis]);
    assert.equal(summary.rideCount, 1);
    assert.equal(summary.maxHr, 140);
    assert.equal(summary.maxCadence, 90);
    assert.equal(summary.maxPower, 100);
    assert.equal(summary.zoneMeasuredSeconds, 30);
    assert.equal(summary.elapsedTimeSec, 30);
    assert.equal(summary.stoppedTimeSec, 10);
    assert.equal(summary.averageAscent, analysis.ascentM);
    assert.ok(summary.vam > 0);
    assert.ok(summary.gradeDistributionKm);
});

test('calculates and aggregates Coggan power-zone time only from valid sensor intervals', () => {
    const route = {
        startedAt: new Date(timestamp).toISOString(),
        movingTimeSec: 60,
        points: [
            trackPoint(0, 0, 100, 0, [null, null, null, null, 100]),
            trackPoint(0, 0.0001, 100, 30, [null, null, null, null, 200]),
            trackPoint(0, 0.0002, 100, 60, [null, null, null, null, 300])
        ]
    };
    const analysis = engine.analyzeRoute(route, { ftpWatts: 200 });
    const summary = engine.aggregate([analysis, analysis]);
    assert.equal(analysis.powerZoneMeasuredSeconds, 60);
    assert.equal(analysis.powerZoneSeconds[2], 30);
    assert.equal(analysis.powerZoneSeconds[5], 30);
    assert.equal(summary.powerZoneMeasuredSeconds, 120);
    assert.equal(summary.powerZoneSeconds[2], 60);
    assert.equal(summary.powerZoneSeconds[5], 60);

    const withoutFtp = engine.analyzeRoute(route);
    assert.equal(withoutFtp.powerZoneMeasuredSeconds, 60);
    assert.equal(withoutFtp.powerZoneSeconds.reduce((total, seconds) => total + seconds, 0), 0);

    const longGap = engine.analyzeRoute({
        ...route,
        points: [
            trackPoint(0, 0, 100, 0, [null, null, null, null, 100]),
            trackPoint(0, 0.0001, 100, 31, [null, null, null, null, 100])
        ]
    }, { ftpWatts: 200 });
    assert.equal(longGap.powerZoneMeasuredSeconds, 0);
});

test('rejects invalid activity input explicitly', () => {
    assert.throws(() => engine.analyzeRoute(null), TypeError);
});
