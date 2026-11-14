'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class BadRequestError extends Error {}

const track = [[40, -3], [40, -2.99]]; // ≈850 m

function loadHook(users) {
    let handler;
    const read = (data) => ({
        getString: (key) => String(data[key] ?? ''),
        getBool: (key) => Boolean(data[key])
    });
    const records = {
        users,
        community_routes: { r1: { published: true, trackJson: JSON.stringify([track]) } }
    };
    const context = {
        BadRequestError,
        $app: {
            findRecordById(collection, id) {
                const data = records[collection] && records[collection][id];
                if (!data) throw new Error('not found');
                return read(data);
            }
        },
        onRecordCreateRequest: (fn) => { handler = fn; },
        onRecordUpdateRequest: () => {}
    };
    vm.runInNewContext(
        fs.readFileSync(path.join(__dirname, '../pb_hooks/community_performance.pb.js'), 'utf8'),
        context
    );
    return handler;
}

function run(handler, fields, auth = { id: 'u1' }) {
    let passed = false;
    handler({
        auth,
        collection: { name: 'community_route_efforts' },
        record: {
            getString: (key) => String(fields[key] ?? ''),
            get: (key) => fields[key],
            set: (key, value) => { fields[key] = value; }
        },
        hasSuperuserAuth: () => false,
        next: () => { passed = true; }
    });
    return { passed, fields };
}

const effort = (extra = {}) => ({ owner: 'u1', route: 'r1', alias: 'Suplantado', elapsedSeconds: 600, ...extra });

test('publishes an effort under the account nickname, not the client alias', () => {
    const handler = loadHook({ u1: { nickname: 'Marta MTB' } });
    const { passed, fields } = run(handler, effort());
    assert.equal(passed, true);
    assert.equal(fields.alias, 'Marta MTB');
});

test('rejects efforts from accounts without a nickname', () => {
    const handler = loadHook({ u1: { nickname: '' } });
    assert.throws(() => run(handler, effort()), /apodo/);
});

test('still rejects impossible times for the route distance', () => {
    const handler = loadHook({ u1: { nickname: 'Marta MTB' } });
    assert.throws(() => run(handler, effort({ elapsedSeconds: 5 })), BadRequestError);
});
