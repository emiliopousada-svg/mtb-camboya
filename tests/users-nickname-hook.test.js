'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class BadRequestError extends Error {}

function loadHook(existingNicknames = []) {
    const handlers = [];
    const queries = [];
    const context = {
        BadRequestError,
        $app: {
            findRecordsByFilter(collection, filter, sort, limit, offset, params) {
                queries.push({ collection, filter, params });
                // Imita nickname:lower de SQLite (solo ASCII) y la exclusión del propio registro.
                const lower = (v) => v.replace(/[A-Z]/g, (c) => c.toLowerCase());
                return existingNicknames
                    .filter(u => u.id !== params.id && lower(u.nickname) === params.nickname)
                    .map(u => ({ id: u.id }));
            }
        },
        onRecordCreateRequest: (fn, ...collections) => handlers.push({ fn, collections, on: 'create' }),
        onRecordUpdateRequest: (fn, ...collections) => handlers.push({ fn, collections, on: 'update' })
    };
    const source = fs.readFileSync(path.join(__dirname, '../pb_hooks/users_nickname.pb.js'), 'utf8');
    vm.runInNewContext(source, context);
    return { handler: handlers[0].fn, handlers, queries };
}

function run(handler, { id = 'u1', nickname = '', isNew = true, original = {}, superuser = false } = {}) {
    const fields = { nickname };
    let passed = false;
    handler({
        hasSuperuserAuth: () => superuser,
        record: {
            id,
            getString: (key) => String(fields[key] ?? ''),
            set: (key, value) => { fields[key] = value; },
            isNew: () => isNew,
            original: () => ({ getString: (key) => String(original[key] ?? '') })
        },
        next: () => { passed = true; }
    });
    return { passed, fields };
}

test('registers on create and update of users only', () => {
    const { handlers } = loadHook();
    assert.deepEqual(handlers.map(h => h.on).sort(), ['create', 'update']);
    handlers.forEach(h => assert.deepEqual(h.collections, ['users']));
});

test('accepts a free nickname and normalizes its spaces', () => {
    const { handler } = loadHook([{ id: 'u2', nickname: 'Pedro' }]);
    const { passed, fields } = run(handler, { nickname: '  Marta   MTB ' });
    assert.equal(passed, true);
    assert.equal(fields.nickname, 'Marta MTB');
});

test('rejects a nickname already used by another account, ignoring case', () => {
    const { handler } = loadHook([{ id: 'u2', nickname: 'Marta MTB' }]);
    assert.throws(() => run(handler, { nickname: 'marta mtb' }), /ya está en uso/);
    assert.throws(() => run(handler, { nickname: 'MARTA   MTB' }), BadRequestError);
});

test('allows accounts without a nickname so legacy accounts can keep working', () => {
    const { handler, queries } = loadHook([{ id: 'u2', nickname: 'Pedro' }]);
    const { passed } = run(handler, { nickname: '' });
    assert.equal(passed, true);
    assert.equal(queries.length, 0);
});

test('lets a legacy account without nickname choose one on update', () => {
    const { handler } = loadHook([{ id: 'u2', nickname: 'Pedro' }]);
    assert.equal(run(handler, { nickname: 'Lucía', isNew: false, original: { nickname: '' } }).passed, true);
    assert.throws(() => run(handler, { nickname: 'pedro', isNew: false, original: { nickname: '' } }), BadRequestError);
});

test('does not change or re-check a nickname when other profile fields are updated', () => {
    const { handler, queries } = loadHook([{ id: 'u2', nickname: 'Marta' }]);
    const { passed, fields } = run(handler, { id: 'u1', nickname: 'Marta', isNew: false, original: { nickname: 'Marta' } });
    assert.equal(passed, true);
    assert.equal(fields.nickname, 'Marta');
    assert.equal(queries.length, 0);
});

test('forbids changing a nickname once chosen', () => {
    const { handler } = loadHook();
    assert.throws(() => run(handler, { nickname: 'Nuevo', isNew: false, original: { nickname: 'Viejo' } }), /no se puede cambiar/);
    assert.throws(() => run(handler, { nickname: '', isNew: false, original: { nickname: 'Viejo' } }), BadRequestError);
});

test('does not touch records written by a superuser', () => {
    const { handler } = loadHook([{ id: 'u2', nickname: 'Marta' }]);
    assert.equal(run(handler, { nickname: 'marta', superuser: true }).passed, true);
});
