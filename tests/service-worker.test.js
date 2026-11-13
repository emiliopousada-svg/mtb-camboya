'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function serviceWorkerPolicy() {
    const self = {
        registration: { scope: 'https://example.test/mtb/' },
        addEventListener() {}
    };
    const context = {
        self,
        URL,
        Headers,
        Response,
        fetch: async () => new Response('ok'),
        caches: {}
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'), context);
    return vm.runInContext('({ isAppRequest, isCacheableResponse })', context);
}

function request(overrides = {}) {
    return {
        method: 'GET',
        cache: 'default',
        mode: 'cors',
        headers: new Headers(),
        ...overrides
    };
}

test('service worker handles only app shell routes and safe navigations', () => {
    const policy = serviceWorkerPolicy();
    assert.equal(policy.isAppRequest(request(), new URL('https://example.test/mtb/app/gps.js')), true);
    assert.equal(policy.isAppRequest(request(), new URL('https://example.test/mtb/app/route-photos.js')), true);
    assert.equal(policy.isAppRequest(request(), new URL('https://example.test/mtb/lib/fit.js')), true);
    assert.equal(policy.isAppRequest(request(), new URL('https://example.test/mtb/data.json')), false);
    assert.equal(policy.isAppRequest(request(), new URL('https://example.test/mtb/index.html?token=secret')), false);
    assert.equal(policy.isAppRequest(request(), new URL('https://example.test/mtb/api/routes')), false);
    assert.equal(policy.isAppRequest(request(), new URL('https://example.test/mtb/auth/login')), false);
    assert.equal(policy.isAppRequest(request({ cache: 'no-store' }), new URL('https://example.test/mtb/index.html')), false);
    assert.equal(policy.isAppRequest(request({ mode: 'navigate' }), new URL('https://example.test/mtb/')), true);
    assert.equal(policy.isAppRequest(request({ mode: 'navigate' }), new URL('https://example.test/mtb/api/')), false);
});

test('service worker does not cache private, no-store, or vary-star responses', () => {
    const policy = serviceWorkerPolicy();
    assert.equal(policy.isCacheableResponse(new Response('ok')), true);
    assert.equal(policy.isCacheableResponse(new Response('private', {
        headers: { 'Cache-Control': 'private' }
    })), false);
    assert.equal(policy.isCacheableResponse(new Response('no store', {
        headers: { 'Cache-Control': 'no-store' }
    })), false);
    assert.equal(policy.isCacheableResponse(new Response('vary', {
        headers: { Vary: '*' }
    })), false);
});
