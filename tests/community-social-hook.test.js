'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class BadRequestError extends Error {}

function loadHook() {
    const handlers = [];
    const context = {
        BadRequestError,
        onRecordCreateRequest: (fn, ...collections) => handlers.push({ fn, collections, on: 'create' }),
        onRecordUpdateRequest: (fn, ...collections) => handlers.push({ fn, collections, on: 'update' })
    };
    const source = fs.readFileSync(path.join(__dirname, '../pb_hooks/community_social.pb.js'), 'utf8');
    vm.runInNewContext(source, context);
    return handlers;
}

function run(handler, fields, auth, superuser = false) {
    let passed = false;
    handler({
        auth,
        record: {
            getString: (key) => String(fields[key] ?? ''),
            set: (key, value) => { fields[key] = value; }
        },
        hasSuperuserAuth: () => superuser,
        next: () => { passed = true; }
    });
    return { passed, fields };
}

test('registers on create and update of route comments only', () => {
    const handlers = loadHook();
    assert.deepEqual(handlers.map(h => h.on).sort(), ['create', 'update']);
    handlers.forEach(h => assert.deepEqual(h.collections, ['community_route_comments']));
});

test('replaces a client-supplied alias with the stable account alias', () => {
    const { fn } = loadHook()[0];
    const { passed, fields } = run(fn, { owner: 'abc123xyz', alias: 'Otra Persona', comment: 'Buena ruta' }, { id: 'abc123xyz' });
    assert.equal(passed, true);
    assert.equal(fields.alias, 'Ciclista ABC123XYZ');
});

test('keeps the alias within the 32 character schema limit for 15 character ids', () => {
    const { fn } = loadHook()[0];
    const { fields } = run(fn, { owner: 'a1b2c3d4e5f6g7h' }, { id: 'a1b2c3d4e5f6g7h' });
    assert.ok(fields.alias.length <= 32);
});

test('rejects anonymous requests and owners that do not match the session', () => {
    const { fn } = loadHook()[0];
    assert.throws(() => run(fn, { owner: 'abc' }, null), BadRequestError);
    assert.throws(() => run(fn, { owner: 'abc' }, { id: 'other' }), BadRequestError);
});

test('does not touch records written by a superuser', () => {
    const { fn } = loadHook()[0];
    const { passed, fields } = run(fn, { owner: 'abc', alias: 'Moderación' }, null, true);
    assert.equal(passed, true);
    assert.equal(fields.alias, 'Moderación');
});
