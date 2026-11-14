'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function storageContext() {
    const state = { request: null, messages: [] };
    const context = {
        window: { indexedDB: {} },
        indexedDB: {
            open(name, version) {
                state.request = { name, version };
                return state.request;
            }
        },
        Blob,
        console: { warn() {} },
        toast: message => state.messages.push(message)
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app', 'storage.js'), 'utf8'), context);
    vm.runInContext('globalThis.testDB = DB', context);
    return { context, state };
}

test('IndexedDB closes its connection when another tab requests a version upgrade', async () => {
    const { context, state } = storageContext();
    let closed = false;
    const db = { close() { closed = true; } };
    const opening = context.testDB.open();
    state.request.result = db;
    state.request.onsuccess();
    await opening;

    db.onversionchange();

    assert.equal(closed, true);
    assert.equal(context.testDB.db, null);
});

test('IndexedDB explains when an old tab blocks the schema upgrade', () => {
    const { context, state } = storageContext();
    context.testDB.open();

    state.request.onblocked();

    assert.match(state.messages[0], /Cierra las otras pesta/);
});
