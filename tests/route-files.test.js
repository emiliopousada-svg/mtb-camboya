'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const statistics = require('../app/statistics-engine.js');

function makeXmlNode(nodeName, attributes = {}) {
    const node = {
        nodeName,
        localName: nodeName.split(':').pop(),
        attributes,
        children: [],
        text: '',
        get textContent() {
            return this.text + this.children.map(child => child.textContent).join('');
        },
        getAttribute(name) {
            return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
        },
        getElementsByTagName(name) {
            const matches = [];
            const visit = parent => parent.children.forEach(child => {
                if (name === '*' || child.nodeName === name || child.localName === name) matches.push(child);
                visit(child);
            });
            visit(this);
            return matches;
        }
    };
    return node;
}

function parseTestXml(source) {
    const document = makeXmlNode('#document');
    const stack = [document];
    for (const match of source.matchAll(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/?[^>]+>|[^<]+/g)) {
        const token = match[0];
        if (token.startsWith('<?') || token.startsWith('<!--')) continue;
        if (token.startsWith('</')) {
            if (stack.length === 1 || stack[stack.length - 1].nodeName !== token.slice(2, -1).trim()) {
                return { documentElement: null, getElementsByTagName: name => name === 'parsererror' ? [{}] : [] };
            }
            stack.pop();
        } else if (token.startsWith('<')) {
            const tag = token.match(/^<([^\s/>]+)([^>]*)>/);
            if (!tag) continue;
            const attributes = {};
            for (const attribute of tag[2].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
                attributes[attribute[1]] = attribute[2] ?? attribute[3];
            }
            const child = makeXmlNode(tag[1], attributes);
            stack[stack.length - 1].children.push(child);
            if (!/\/\s*>$/.test(token)) stack.push(child);
        } else {
            stack[stack.length - 1].text += token;
        }
    }
    if (stack.length !== 1 || document.children.length !== 1) {
        return { documentElement: null, getElementsByTagName: name => name === 'parsererror' ? [{}] : [] };
    }
    document.documentElement = document.children[0];
    document.getElementsByTagName = name => [
        ...(name === '*' || document.documentElement.nodeName === name || document.documentElement.localName === name
            ? [document.documentElement] : []),
        ...document.documentElement.getElementsByTagName(name)
    ];
    return document;
}

function routeFilesApi() {
    const context = {
        Cloud: { email: 'rider@example.com' },
        DOMParser: class {
            parseFromString(xml) {
                return parseTestXml(xml);
            }
        },
        dist: statistics.calculateDistanceMeters,
        makeElevTracker() {
            return statistics.createElevationTracker({ threshold: 3, smoothingWindow: 5 });
        }
    };
    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'app', 'route-files.js'), 'utf8'),
        context
    );
    return vm.runInContext('({ parseTrack, buildImportedRoute })', context);
}

function importRoute(coordinates) {
    const api = routeFilesApi();
    const parsed = api.parseTrack(JSON.stringify({
        type: 'LineString',
        coordinates
    }), 'imported.geojson');
    return api.buildImportedRoute(parsed, 'Ruta importada');
}

test('imported tracks calculate distance and elevation gain when altitude is present', () => {
    const coordinates = Array.from({ length: 12 }, (_, index) => [
        index * 0.001, 40, 100 + index * 5
    ]);
    const route = importRoute(coordinates);

    assert.ok(route.distanceKm > 0);
    assert.ok(route.elevationGain > 0);
});

test('imported tracks keep distance and mark elevation unavailable without altitude data', () => {
    const route = importRoute([
        [0, 40],
        [0.001, 40],
        [0.002, 40]
    ]);

    assert.ok(route.distanceKm > 0);
    assert.equal(route.elevationGain, null);
    assert.equal(route.startedAt, null);
});

test('imported tracks preserve their recorded date from GPS timestamps', () => {
    const api = routeFilesApi();
    const startedAt = Date.parse('2026-03-10T07:15:00.000Z');
    const route = api.buildImportedRoute({
        segs: [[
            [40, -3, null, startedAt],
            [40.001, -3, null, startedAt + 10000]
        ]]
    }, 'Ruta importada');

    assert.equal(route.startedAt, '2026-03-10T07:15:00.000Z');
});

test('GPX import requires a matching root and at least one route point', () => {
    const api = routeFilesApi();
    assert.throws(
        () => api.parseTrack('<root/>', 'track.gpx'),
        /debe tener una raíz <gpx>/
    );
    assert.throws(
        () => api.parseTrack('<gpx><trk><trkseg/></trk></gpx>', 'track.gpx'),
        /no contiene puntos de ruta/
    );
    assert.throws(
        () => api.parseTrack('<kml/>', 'empty.kml'),
        /no contiene puntos de ruta/
    );
    const parsed = api.parseTrack(
        '<gpx:gpx><gpx:trk><gpx:trkseg><gpx:trkpt lat="40" lon="-3"/><gpx:trkpt lat="40.001" lon="-3"/></gpx:trkseg></gpx:trk></gpx:gpx>',
        'track.gpx'
    );
    assert.equal(parsed.segs[0].length, 2);
});

test('GPX and KML imports reject coordinates outside geographic ranges', () => {
    const api = routeFilesApi();
    assert.throws(
        () => api.parseTrack('<gpx><trk><trkseg><trkpt lat="91" lon="-3"/></trkseg></trk></gpx>', 'track.gpx'),
        /coordenada geográfica no válida/
    );
    assert.throws(
        () => api.parseTrack(
            '<kml><Placemark><LineString><coordinates>-3,40 181,40</coordinates></LineString></Placemark></kml>',
            'track.kml'
        ),
        /coordenada geográfica no válida/
    );
    assert.throws(
        () => api.parseTrack('<gpx/>', 'track.kml'),
        /debe tener una raíz <kml>/
    );
});
