'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class MockRecord {
    constructor(collection) {
        this.collection = collection;
        this.values = {};
    }

    set(key, value) {
        this.values[key] = key === 'icon' && Array.isArray(value)
            ? String(value[0] && value[0].name || '')
            : value;
    }
    getString(key) { return String(this.values[key] || ''); }
    getFloat(key) { return Number(this.values[key] || 0); }
}

function createHookContext() {
    const users = [
        { id: 'user1', values: { groupCode: 'group1', nickname: 'Cuenta Uno' }, getString(key) { return this.values[key] || ''; }, set(key, value) { this.values[key] = value; } },
        { id: 'user2', values: { groupCode: 'group1', nickname: 'Cuenta Dos' }, getString(key) { return this.values[key] || ''; }, set(key, value) { this.values[key] = value; } }
    ];
    const user = users[0];
    const group = new MockRecord('mtb_groups');
    group.id = 'group1';
    group.values = { name: 'Camboya', owner: 'user1' };
    const memberships = [
        { values: { group: 'group1', user: 'user1', nickname: 'Ciclista 1' }, getString(key) { return this.values[key] || ''; }, set(key, value) { this.values[key] = value; } },
        { values: { group: 'group1', user: 'user2', nickname: 'Ciclista 2' }, getString(key) { return this.values[key] || ''; }, set(key, value) { this.values[key] = value; } }
    ];
    const entries = [];
    const handlers = new Map();
    const helpers = {
        requireSafeValue(value) { return String(value); },
        requireNickname(value) {
            const nickname = String(value || '').trim().slice(0, 32);
            if (!nickname) throw new Error('Añade un apodo a tu cuenta.');
            return nickname;
        },
        safeMembership(groupId, userId) {
            return memberships.filter(item => item.getString('group') === groupId && item.getString('user') === userId);
        },
        findAllRecordsByFilter(collection, filter) {
            const records = collection === 'mtb_group_members' ? memberships : entries;
            const groupMatch = filter.match(/group = "([^"]+)"/);
            const ownerMatch = filter.match(/owner = "([^"]+)"/);
            const clientIdMatch = filter.match(/clientId = (\d+)/);
            return records.filter(item =>
                (!groupMatch || item.getString('group') === groupMatch[1])
                && (!ownerMatch || item.getString('owner') === ownerMatch[1])
                && (!clientIdMatch || item.getFloat('clientId') === Number(clientIdMatch[1]))
            );
        }
    };
    const app = {
        findRecordById(collection, id) {
            if (collection === 'users') {
                const match = users.find(item => item.id === id);
                if (match) return match;
            }
            if (collection === 'mtb_groups' && id === group.id) return group;
            throw new Error(`Unexpected record lookup: ${collection}/${id}`);
        },
        findRecordsByFilter(collection, _filter, _sort, _limit, _offset, params) {
            return entries.filter(item => item.getString('group') === params.group
                && item.getString('owner') === params.owner
                && item.getFloat('clientId') === params.clientId);
        },
        findCollectionByNameOrId(name) { return name; },
        save(record) {
            if (!entries.includes(record)) entries.push(record);
        },
        delete(record) {
            const index = entries.indexOf(record);
            if (index >= 0) entries.splice(index, 1);
        }
    };
    const context = {
        __hooks: '/pb_hooks',
        $app: app,
        $apis: { requireAuth() { return () => {}; } },
        DynamicModel: class {
            constructor(defaults) { Object.assign(this, defaults); }
        },
        Record: MockRecord,
        require() { return helpers; },
        routerAdd(method, route, handler) { handlers.set(`${method} ${route}`, handler); }
    };
    const source = fs.readFileSync(path.join(__dirname, '..', 'pb_hooks', 'groups.pb.js'), 'utf8');
    vm.runInNewContext(source, context);

    const otherOwnerEntry = new MockRecord('mtb_group_ranking_entries');
    otherOwnerEntry.set('group', 'group1');
    otherOwnerEntry.set('owner', 'user2');
    otherOwnerEntry.set('clientId', 101);
    otherOwnerEntry.set('distanceKm', 50);
    otherOwnerEntry.set('movingTimeSec', 3000);
    otherOwnerEntry.set('maxSpeedKmh', 50);
    entries.push(otherOwnerEntry);
    return { entries, handlers, memberships };
}

function request(userId, body = {}, uploadedFiles = {}) {
    return {
        auth: { id: userId },
        bindBody(model) { Object.assign(model, body); },
        findUploadedFiles(field) { return uploadedFiles[field] || []; },
        json(status, data) { return { status, data }; }
    };
}

test('deleting an activity recalculates only its owner ranking from remaining activities', () => {
    const { entries, handlers } = createHookContext();
    const share = handlers.get('POST /api/mtb/groups/rankings/share');
    const remove = handlers.get('POST /api/mtb/groups/rankings/delete');
    const getRankings = handlers.get('GET /api/mtb/groups/rankings');

    assert.equal(share(request('user1', {
        clientId: 101, distanceKm: 20, movingTimeSec: 1200, maxSpeedKmh: 30
    })).status, 200);
    assert.equal(share(request('user1', {
        clientId: 102, distanceKm: 10, movingTimeSec: 1800, maxSpeedKmh: 40
    })).status, 200);
    assert.equal(share(request('user1', {
        clientId: 102, distanceKm: 12, movingTimeSec: 1900, maxSpeedKmh: 42
    })).status, 200);
    assert.equal(entries.length, 3);

    const deletion = remove(request('user1', { clientId: 101 }));
    assert.equal(deletion.status, 200);
    assert.equal(deletion.data.deleted, 1);
    assert.equal(entries.length, 2);

    const ranking = getRankings(request('user1'));
    assert.equal(ranking.status, 200);
    const firstOwner = ranking.data.members.find(member => member.userId === 'user1');
    assert.equal(firstOwner.maxDistanceKm, 12);
    assert.equal(firstOwner.distanceMovingTimeSec, 1900);
    assert.equal(firstOwner.bestMovingTimeSec, 1900);
    assert.equal(firstOwner.maxSpeedKmh, 42);

    const otherOwner = ranking.data.members.find(member => member.userId === 'user2');
    assert.equal(otherOwner.maxDistanceKm, 50);
    assert.equal(otherOwner.maxSpeedKmh, 50);
    assert.equal(firstOwner.nickname, 'Cuenta Uno');
    assert.equal(otherOwner.nickname, 'Cuenta Dos');
});

test('selecting a group uses the account nickname instead of a client-provided group alias', () => {
    const { handlers, memberships } = createHookContext();
    const select = handlers.get('POST /api/mtb/groups/select');
    const response = select(request('user1', { groupId: 'group1', nickname: 'Alias distinto' }));

    assert.equal(response.status, 200);
    assert.equal(memberships[0].getString('nickname'), 'Cuenta Uno');
});

test('only the group administrator can change its icon', () => {
    const { handlers } = createHookContext();
    const updateIcon = handlers.get('POST /api/mtb/groups/icon');
    const uploadedFiles = { icon: [{ name: 'new-logo.jpg' }] };

    const updated = updateIcon(request('user1', {}, uploadedFiles));
    assert.equal(updated.status, 200);
    assert.equal(updated.data.group.icon, 'new-logo.jpg');

    const denied = updateIcon(request('user2', {}, uploadedFiles));
    assert.equal(denied.status, 403);
});
