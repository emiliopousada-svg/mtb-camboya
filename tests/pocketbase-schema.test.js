'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('deleting a user cascades to their community routes', () => {
    const collections = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'community_routes.json'), 'utf8'));
    const routes = collections.find(collection => collection.name === 'community_routes');
    const owner = routes?.fields.find(field => field.name === 'owner');

    assert.equal(owner?.type, 'relation');
    assert.equal(owner?.collectionId, '_pb_users_auth_');
    assert.equal(owner?.cascadeDelete, true);
});
