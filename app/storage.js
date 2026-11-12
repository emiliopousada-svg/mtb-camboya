'use strict';

//  ALMACENAMIENTO (IndexedDB)
// ============================================================
const DB = {
    db: null,
    open() {
        return new Promise((res, rej) => {
            if (!window.indexedDB) return rej(new Error('no-idb'));
            const r = indexedDB.open('mtb_app', 2);
            r.onupgradeneeded = event => {
                const d = r.result;
                if (!d.objectStoreNames.contains('routes')) d.createObjectStore('routes', { keyPath: 'id' });
                if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
                const photos = d.objectStoreNames.contains('routePhotos')
                    ? event.target.transaction.objectStore('routePhotos')
                    : d.createObjectStore('routePhotos', { keyPath: 'routeId' });

                // Move photo blobs out of route records so startup doesn't retain every image in RAM.
                if (event.oldVersion > 0 && event.oldVersion < 2) {
                    const routes = event.target.transaction.objectStore('routes');
                    const cursorRequest = routes.openCursor();
                    cursorRequest.onsuccess = cursorEvent => {
                        const cursor = cursorEvent.target.result;
                        if (!cursor) return;
                        const route = cursor.value;
                        const savedPhotos = [];
                        if (Array.isArray(route.pois)) {
                            route.pois = route.pois.map((poi, index) => {
                                if (!poi || !(poi.photo instanceof Blob)) return poi;
                                savedPhotos.push({ index, photo: poi.photo });
                                const { photo, ...metadata } = poi;
                                return metadata;
                            });
                        }
                        if (savedPhotos.length) photos.put({ routeId: route.id, photos: savedPhotos });
                        cursor.update(route);
                        cursor.continue();
                    };
                }
            };
            r.onsuccess = () => { this.db = r.result; res(); };
            r.onerror = () => rej(r.error);
        });
    },
    run(store, mode, fn) {
        return new Promise((res, rej) => {
            if (!this.db) return rej(new Error('no-db'));
            try {
                const t = this.db.transaction(store, mode);
                const req = fn(t.objectStore(store));
                t.oncomplete = () => res(req ? req.result : undefined);
                t.onerror = () => rej(t.error);
                t.onabort = () => rej(t.error || new Error('abort'));
            } catch (e) { rej(e); }
        });
    },
    all()       { return this.run('routes', 'readonly',  s => s.getAll()); },
    put(route)  {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject(new Error('no-db'));
            try {
                const tx = this.db.transaction(['routes', 'routePhotos'], 'readwrite');
                const record = { ...route };
                const photos = [];
                if (Array.isArray(route.pois)) {
                    record.pois = route.pois.map((poi, index) => {
                        if (!poi || !(poi.photo instanceof Blob)) return poi;
                        photos.push({ index, photo: poi.photo });
                        const { photo, ...metadata } = poi;
                        return metadata;
                    });
                }
                tx.objectStore('routes').put(record);
                if (photos.length) tx.objectStore('routePhotos').put({ routeId: route.id, photos });
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error || new Error('save-failed'));
                tx.onabort = () => reject(tx.error || new Error('save-aborted'));
            } catch (e) { reject(e); }
        });
    },
    del(id) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject(new Error('no-db'));
            try {
                const tx = this.db.transaction(['routes', 'routePhotos'], 'readwrite');
                tx.objectStore('routes').delete(id);
                tx.objectStore('routePhotos').delete(id);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error || new Error('delete-failed'));
                tx.onabort = () => reject(tx.error || new Error('delete-aborted'));
            } catch (e) { reject(e); }
        });
    },
    async loadRoutePhotos(route) {
        if (!route || !Array.isArray(route.pois)) return route;
        const stored = await this.run('routePhotos', 'readonly', store => store.get(route.id));
        if (!stored || !Array.isArray(stored.photos)) return route;
        const pois = route.pois.slice();
        stored.photos.forEach(item => {
            if (!Number.isInteger(item.index) || item.index < 0 || !(item.photo instanceof Blob)) return;
            pois[item.index] = { ...(pois[item.index] || {}), photo: item.photo };
        });
        route.pois = pois;
        return route;
    },
    deleteRoute(id, remoteId) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject(new Error('no-db'));
            try {
                const tx = this.db.transaction(['routes', 'kv', 'routePhotos'], 'readwrite');
                tx.objectStore('routes').delete(id);
                tx.objectStore('routePhotos').delete(id);
                if (remoteId) {
                    const kv = tx.objectStore('kv');
                    const req = kv.get('pendingDeletes');
                    req.onsuccess = () => {
                        const pending = Array.isArray(req.result) ? req.result : [];
                        if (!pending.includes(remoteId)) pending.push(remoteId);
                        kv.put(pending, 'pendingDeletes');
                    };
                    req.onerror = () => { try { tx.abort(); } catch (e) {} };
                }
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error || new Error('delete-failed'));
                tx.onabort = () => reject(tx.error || new Error('delete-aborted'));
            } catch (e) { reject(e); }
        });
    },
    kvGet(k)    { return this.run('kv', 'readonly',  s => s.get(k)); },
    kvSet(k, v) { return this.run('kv', 'readwrite', s => s.put(v, k)); },
    kvDel(k)    { return this.run('kv', 'readwrite', s => s.delete(k)); },
    kvKeys()    { return this.run('kv', 'readonly',  s => s.getAllKeys()); }
};

/*
 Modelo de ruta:
 { id, kind: 'recorded' | 'imported', activityType?, name, startedAt (ISO), movingTimeSec,
   distanceKm (número), elevationGain (m), hrAvg,
   points: [ [lat, lon, alt|null, tiempoMs|null, bpm|null, (1 = inicio de tramo nuevo), speedKmh?, cadenceRpm?, powerWatts?] ] }
*/

// ============================================================
//  DESNIVEL SUAVIZADO
// ============================================================
function makeElevTracker() {
    return MTBStatisticsEngine.createElevationTracker({ threshold: ELEV_STEP, smoothingWindow: 5 });
}

// Desnivel positivo acumulado en cada punto de un track con altitud en p[2].
function gainCumulative(points) {
    const tracker = makeElevTracker();
    const out = new Float64Array(points.length);
    points.forEach((p, i) => {
        if (i > 0 && p[5] === 1) tracker.reset();
        tracker.add(p[2] == null ? null : Number(p[2]));
        out[i] = tracker.gain;
    });
    return out;
}

// ============================================================
