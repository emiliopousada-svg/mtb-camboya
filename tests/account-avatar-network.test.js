'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('remote avatar fetch has a deadline and marks the timeout retryable', async () => {
    const timers = [];
    const storage = new Map();
    const context = {
        Cloud: { uid: 'user-1', server: 'https://example.test' },
        localStorage: {
            getItem(key) { return storage.get(key) || null; },
            setItem(key, value) { storage.set(key, String(value)); }
        },
        AbortController,
        fetch: (_url, { signal }) => new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
                const error = new Error('aborted');
                error.name = 'AbortError';
                reject(error);
            }, { once: true });
        }),
        setTimeout(callback, delay) {
            const timer = { callback, delay, cleared: false };
            timers.push(timer);
            return timer;
        },
        clearTimeout(timer) { timer.cleared = true; },
        renderAccountAvatar() {},
        console: { warn() {} }
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app', 'account-avatar.js'), 'utf8'), context);

    const pending = context.cacheRemoteAccountAvatar({ avatar: 'avatar.jpg' });
    assert.equal(timers[0].delay, 10000);
    timers[0].callback();

    await assert.rejects(pending, error => error.retryable === true);
    assert.equal(timers[0].cleared, true);
});
