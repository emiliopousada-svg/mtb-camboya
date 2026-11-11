'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('keeps parsed FIT positions, altitude, time and heart rate', async () => {
    const { fitRecordsToSegments } = await import('../src/fit-parser.mjs');
    const lat = 40;
    const lon = -3;
    const timestamp = new Date('2026-01-01T00:00:00Z');
    const segments = fitRecordsToSegments([
        { position_lat: lat, position_long: lon, altitude: 650, timestamp, heart_rate: 120 },
        { position_lat: lat + 0.001, position_long: lon + 0.001, altitude: 655, timestamp: new Date(timestamp.getTime() + 10000), heart_rate: 130 }
    ]);

    assert.equal(segments.length, 1);
    assert.ok(Math.abs(segments[0][0][0] - 40) < 0.0001);
    assert.ok(Math.abs(segments[0][0][1] + 3) < 0.0001);
    assert.equal(segments[0][0][2], 650);
    assert.equal(segments[0][0][3], timestamp.getTime());
    assert.equal(segments[0][0][4], 120);
});

test('splits FIT tracks across long recording gaps and rejects invalid points', async () => {
    const { fitRecordsToSegments } = await import('../src/fit-parser.mjs');
    const start = new Date('2026-01-01T00:00:00Z');
    const points = [
        { position_lat: 1, position_long: 1, timestamp: start },
        { position_lat: 2, position_long: 2, timestamp: new Date(start.getTime() + 1000) },
        { position_lat: 3, position_long: 3, timestamp: new Date(start.getTime() + 6 * 60 * 1000) }
    ];

    const segments = fitRecordsToSegments(points);
    assert.equal(segments.length, 2);
    assert.deepEqual(segments.map(segment => segment.length), [2, 1]);
    assert.throws(() => fitRecordsToSegments([{ positionLat: 1, positionLong: 1 }]), /suficientes puntos/);
});

test('reports malformed FIT data as a readable error', async () => {
    const { parseFitFile } = await import('../src/fit-parser.mjs');
    await assert.rejects(
        parseFitFile(new ArrayBuffer(16)),
        /no se pudo leer el archivo FIT: Incorrect header size/
    );
});
