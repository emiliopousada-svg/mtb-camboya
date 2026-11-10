'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { matchActivity } = require('../app/community-performance.js');

const route = [
    [40, -3],
    [40, -2.998],
    [40, -2.996],
    [40, -2.994],
    [40, -2.992],
    [40, -2.990]
];

function activityFor(points, startMs = 1_800_000_000_000) {
    const recorded = [];
    points.slice(1).forEach((to, segmentIndex) => {
        const from = points[segmentIndex];
        const length = Math.hypot((to[0] - from[0]) * 111_000, (to[1] - from[1]) * 85_000);
        const steps = Math.ceil(length / 30);
        for (let step = 0; step < steps; step++) {
            const ratio = step / steps;
            recorded.push([
                from[0] + (to[0] - from[0]) * ratio,
                from[1] + (to[1] - from[1]) * ratio
            ]);
        }
    });
    recorded.push(points[points.length - 1]);
    return { points: recorded.map(([lat, lon], index) => [
        lat, lon, 100, startMs + index * 10_000, null, null
    ]) };
}

test('matches a complete route from timestamped GPS points', () => {
    const effort = matchActivity(activityFor(route), [route]);
    assert.equal(effort.elapsedSeconds, 300);
    assert.equal(effort.startPointIndex, 0);
    assert.equal(effort.direction, 'forward');
});

test('matches a route ridden in the opposite direction', () => {
    const effort = matchActivity(activityFor(route.slice().reverse()), [route]);
    assert.equal(effort.elapsedSeconds, 300);
    assert.equal(effort.direction, 'reverse');
});

test('matches a personal segment within a longer recorded activity', () => {
    const effort = matchActivity(activityFor(route), [route.slice(1, 5)]);
    assert.equal(effort.elapsedSeconds, 180);
});

test('rejects a partial track that does not cover the full route', () => {
    assert.equal(matchActivity(activityFor(route.slice(1, -1)), [route]), null);
});

test('rejects untimed GPS tracks instead of estimating an effort', () => {
    const activity = { points: route.map(([lat, lon]) => [lat, lon, 100, null, null, null]) };
    assert.equal(matchActivity(activity, [route]), null);
});

test('rejects tracks too far from the published route', () => {
    const displaced = route.map(([lat, lon]) => [lat + 0.01, lon]);
    assert.equal(matchActivity(activityFor(displaced), [route]), null);
});

test('rejects non-monotonic timestamps', () => {
    const activity = activityFor(route);
    activity.points[3][3] = activity.points[2][3] - 1000;
    assert.equal(matchActivity(activity, [route]), null);
});

test('rejects impossible GPS jumps', () => {
    const activity = activityFor(route);
    activity.points[3][0] += 0.02;
    assert.equal(matchActivity(activity, [route]), null);
});

test('does not match across a recorded GPS segment break', () => {
    const activity = activityFor(route);
    activity.points[20][5] = 1;
    assert.equal(matchActivity(activity, [route]), null);
});
