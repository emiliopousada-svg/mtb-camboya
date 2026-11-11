'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class TestFileReader {
    readAsDataURL(blob) {
        blob.arrayBuffer().then(buffer => {
            this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;
            this.onload();
        }, error => this.onerror(error));
    }
}

const context = vm.createContext({ Blob, URL, atob, FileReader: TestFileReader });
const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'route-photos.js'), 'utf8');
vm.runInContext(`${source}\nglobalThis.testApi = { routePoisForSync, routePoisFromSync, routePoiCoordinatesValid };`, context);

test('round-trips photo POIs through private route sync data', async () => {
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    const photo = new Blob([bytes], { type: 'image/jpeg' });
    const [serialized] = await context.testApi.routePoisForSync([{
        lat: 40.1,
        lng: -3.2,
        caption: 'Mirador',
        photo
    }]);

    assert.equal(serialized.lat, 40.1);
    assert.equal(serialized.lng, -3.2);
    assert.match(serialized.photoData, /^data:image\/jpeg;base64,/);

    const [restored] = context.testApi.routePoisFromSync([serialized]);
    assert.equal(restored.lat, 40.1);
    assert.equal(restored.lng, -3.2);
    assert.equal(restored.caption, 'Mirador');
    assert.equal(restored.photo.type, 'image/jpeg');
    assert.deepEqual(new Uint8Array(await restored.photo.arrayBuffer()), bytes);
});

test('ignores malformed POI coordinates and photos from sync data', async () => {
    const pois = await context.testApi.routePoisForSync([
        { lat: 91, lng: 0, photo: new Blob(['bad'], { type: 'image/jpeg' }) },
        { lat: 0, lng: 0, photoUrl: 'https://example.test/photo.jpg' }
    ]);
    assert.equal(pois.length, 0);

    const restored = context.testApi.routePoisFromSync([
        { lat: 91, lng: 0, photoData: 'data:image/jpeg;base64,Zm9v' },
        { lat: 0, lng: 0, photoData: 'data:image/png;base64,Zm9v' }
    ]);
    assert.equal(restored.length, 0);
    assert.equal(context.testApi.routePoiCoordinatesValid({ lat: 45, lng: 180 }), true);
});
