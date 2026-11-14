'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class BadRequestError extends Error {}

function loadHook(routes) {
    const handlers = {};
    const context = {
        BadRequestError,
        $app: {
            findRecordById(collection, id) {
                if (collection !== 'community_routes' || !routes[id]) throw new Error('not found');
                return routes[id];
            }
        },
        onRecordCreateRequest: (fn) => { handlers.create = fn; },
        onRecordUpdateRequest: (fn) => { handlers.update = fn; }
    };
    const source = fs.readFileSync(path.join(__dirname, '../pb_hooks/community_segments.pb.js'), 'utf8');
    vm.runInNewContext(source, context);
    return handlers;
}

function record(fields, { isNew = true, original = {} } = {}) {
    const read = (data) => ({
        getString: (key) => String(data[key] ?? ''),
        getBool: (key) => Boolean(data[key]),
        get: (key) => data[key]
    });
    const result = {
        ...read(fields),
        set: (key, value) => { fields[key] = value; },
        isNew: () => isNew,
        original: () => read(original)
    };
    return result;
}

const routeLine = [];
for (let i = 0; i < 10; i++) routeLine.push([40, -3 + i * 0.001]); // ≈85 m entre puntos
const route = record({ published: true, trackJson: JSON.stringify([routeLine]) });

function run(handlers, fields, auth = { id: 'user1' }, options) {
    let passed = false;
    const e = {
        auth,
        record: record(fields, options),
        hasSuperuserAuth: () => false,
        next: () => { passed = true; }
    };
    handlers[options && options.update ? 'update' : 'create'](e);
    return { passed, fields };
}

const base = (track) => ({ owner: 'user1', route: 'r1', title: 'Tramo', trackJson: JSON.stringify([track]), distanceKm: 99 });

test('accepts a continuous slice of the route and recalculates the distance', () => {
    const h = loadHook({ r1: route });
    const { passed, fields } = run(h, base(routeLine.slice(2, 6)));
    assert.equal(passed, true);
    assert.notEqual(fields.distanceKm, 99);
    assert.ok(fields.distanceKm > 0.2 && fields.distanceKm < 0.3);
});

test('accepts a slice ridden in the opposite direction', () => {
    const h = loadHook({ r1: route });
    assert.equal(run(h, base(routeLine.slice(2, 6).reverse())).passed, true);
});

test('rejects a track that is not part of the route', () => {
    const h = loadHook({ r1: route });
    const fake = [[41, -3], [41, -2.99], [41, -2.98]];
    assert.throws(() => run(h, base(fake)), BadRequestError);
});

test('rejects a non-contiguous selection of route points', () => {
    const h = loadHook({ r1: route });
    assert.throws(() => run(h, base([routeLine[0], routeLine[4], routeLine[8]])), BadRequestError);
});

test('rejects segments shorter than 100 m', () => {
    const h = loadHook({ r1: route });
    assert.throws(() => run(h, base(routeLine.slice(2, 3).concat([[40, -2.9975]]))), BadRequestError);
});

test('rejects unpublished or missing routes', () => {
    const h = loadHook({ r1: record({ published: false, trackJson: JSON.stringify([routeLine]) }) });
    assert.throws(() => run(h, base(routeLine.slice(2, 6))), BadRequestError);
    assert.throws(() => run(h, { ...base(routeLine.slice(2, 6)), route: 'missing' }), BadRequestError);
});

test('rejects an owner that does not match the session', () => {
    const h = loadHook({ r1: route });
    assert.throws(() => run(h, base(routeLine.slice(2, 6)), { id: 'other' }), BadRequestError);
});

test('allows renaming but not changing the track on update', () => {
    const h = loadHook({ r1: route });
    const original = base(routeLine.slice(2, 6));
    const renamed = { ...original, title: 'Otro nombre' };
    assert.equal(run(h, renamed, { id: 'user1' }, { isNew: false, original, update: true }).passed, true);
    const moved = { ...original, trackJson: JSON.stringify([routeLine.slice(1, 7)]) };
    assert.throws(() => run(h, moved, { id: 'user1' }, { isNew: false, original, update: true }), BadRequestError);
});
