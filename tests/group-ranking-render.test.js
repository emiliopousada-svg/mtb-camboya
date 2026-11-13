'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class MockElement {
    constructor() {
        this.children = [];
        this.attributes = {};
        this.classList = { add() {}, remove() {} };
    }

    addEventListener() {}
    append(...items) { this.children.push(...items); }
    appendChild(item) { this.children.push(item); }
    replaceChildren(...items) { this.children = items; }
    setAttribute(name, value) { this.attributes[name] = value; }
}

function createRankingRenderContext() {
    const elements = new Map([['group-ranking-distance', new MockElement()]]);
    const context = {
        document: {
            addEventListener() {},
            createElement() { return new MockElement(); },
            visibilityState: 'visible'
        },
        window: { addEventListener() {} },
        navigator: { onLine: true },
        $: id => elements.get(id) || new MockElement(),
        console: { warn() {} }
    };
    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'app', 'groups.js'), 'utf8'),
        context
    );
    return { context, ranking: elements.get('group-ranking-distance') };
}

test('group ranking renders only the top three places with medals', () => {
    const { context, ranking } = createRankingRenderContext();
    context.members = [
        { nickname: 'Ana', maxDistanceKm: 12 },
        { nickname: 'Beto', maxDistanceKm: 38 },
        { nickname: 'Cris', maxDistanceKm: 25 },
        { nickname: 'Dani', maxDistanceKm: 80 }
    ];

    vm.runInContext(
        'groupRankingMembers = members; renderGroupMetricRanking("group-ranking-distance", "maxDistanceKm", member => `${member.maxDistanceKm} km`)',
        context
    );

    assert.equal(ranking.children.length, 3);
    assert.deepEqual(ranking.children.map(row => row.children[0].children[0].textContent), ['🥇', '🥈', '🥉']);
    assert.deepEqual(ranking.children.map(row => row.children[0].children[0].attributes['aria-label']), [
        'Puesto 1', 'Puesto 2', 'Puesto 3'
    ]);
    assert.deepEqual(ranking.children.map(row => row.children[0].children[1].textContent), ['1.º', '2.º', '3.º']);
    assert.deepEqual(ranking.children.map(row => row.children[1].textContent), ['Dani', 'Beto', 'Cris']);
    assert.deepEqual(ranking.children.map(row => row.children[2].textContent), ['80 km', '38 km', '25 km']);
});

test('group ranking keeps three medal fields when fewer than three members have a mark', () => {
    const { context, ranking } = createRankingRenderContext();
    context.members = [{ nickname: 'Ana', maxDistanceKm: 12 }];

    vm.runInContext(
        'groupRankingMembers = members; renderGroupMetricRanking("group-ranking-distance", "maxDistanceKm", member => `${member.maxDistanceKm} km`)',
        context
    );

    assert.equal(ranking.children.length, 3);
    assert.deepEqual(ranking.children.map(row => row.children[0].children[0].textContent), ['🥇', '🥈', '🥉']);
    assert.deepEqual(ranking.children.map(row => row.children[1].textContent), ['Ana', '—', '—']);
    assert.deepEqual(ranking.children.map(row => row.children[2].textContent), ['12 km', 'Sin marca', 'Sin marca']);
});
