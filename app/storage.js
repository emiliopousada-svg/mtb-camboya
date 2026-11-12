'use strict';

//  ALMACENAMIENTO (IndexedDB)
// ============================================================
const ROUTE_PREVIEW_MAX_POINTS = 600;

function routePreviewPoints(points) {
    if (!Array.isArray(points) || !points.length) return [];
    const stride = Math.max(1, Math.ceil(points.length / ROUTE_PREVIEW_MAX_POINTS));
    const preview = [];
    points.forEach((point, index) => {
        if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return;
        if (index !== 0 && index !== points.length - 1 && index % stride !== 0 && point[5] !== 1) return;
        preview.push([point[0], point[1], null, null, null, point[5] === 1 ? 1 : null]);
    });
    return preview;
}

const DB = {
    db: null,
    open() {
        return new Promise((res, rej) => {
            if (!window.indexedDB) return rej(new Error('no-idb'));
            const r = indexedDB.open('mtb_app', 4);
            r.onupgradeneeded = event => {
                const d = r.result;
                if (!d.objectStoreNames.contains('routes')) d.createObjectStore('routes', { keyPath: 'id' });
                if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
                const routeTracks = d.objectStoreNames.contains('routeTracks')
                    ? event.target.transaction.objectStore('routeTracks')
                    : d.createObjectStore('routeTracks', { keyPath: 'routeId' });
                if (!d.objectStoreNames.contains('draftPoints')) d.createObjectStore('draftPoints', { keyPath: 'startIndex' });
                const photos = d.objectStoreNames.contains('routePhotos')
                    ? event.target.transaction.objectStore('routePhotos')
                    : d.createObjectStore('routePhotos', { keyPath: 'routeId' });

                // Move long tracks and photo blobs out of route summaries during migration.
                if (event.oldVersion > 0 && event.oldVersion < 4) {
                    const routes = event.target.transaction.objectStore('routes');
                    const cursorRequest = routes.openCursor();
                    cursorRequest.onsuccess = cursorEvent => {
                        const cursor = cursorEvent.target.result;
                        if (!cursor) return;
                        const route = cursor.value;
                        if (event.oldVersion < 2 && Array.isArray(route.pois)) {
                            const savedPhotos = [];
                            route.pois = route.pois.map((poi, index) => {
                                if (!poi || !(poi.photo instanceof Blob)) return poi;
                                savedPhotos.push({ index, photo: poi.photo });
                                const { photo, ...metadata } = poi;
                                return metadata;
                            });
                            if (savedPhotos.length) photos.put({ routeId: route.id, photos: savedPhotos });
                        }
                        if (Array.isArray(route.points)) {
                            routeTracks.put({ routeId: route.id, points: route.points });
                            route.pointCount = route.points.length;
                            route.previewPoints = routePreviewPoints(route.points);
                            delete route.points;
                        }
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
    async loadRoutePoints(route) {
        if (!route || Array.isArray(route.points)) return route;
        const track = await this.run('routeTracks', 'readonly', store => store.get(route.id));
        route.points = track && Array.isArray(track.points) ? track.points : [];
        if (typeof statsAnalysisCache !== 'undefined') statsAnalysisCache.delete(route);
        return route;
    },
    loadRoutePointsFor(routes) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject(new Error('no-db'));
            const byId = new Map((Array.isArray(routes) ? routes : [])
                .filter(route => route && !Array.isArray(route.points))
                .map(route => [route.id, route]));
            if (!byId.size) { resolve(); return; }
            try {
                const tx = this.db.transaction('routeTracks', 'readonly');
                const request = tx.objectStore('routeTracks').openCursor();
                request.onsuccess = event => {
                    const cursor = event.target.result;
                    if (!cursor) return;
                    const route = byId.get(cursor.value.routeId);
                    if (route) {
                        route.points = Array.isArray(cursor.value.points) ? cursor.value.points : [];
                        if (typeof statsAnalysisCache !== 'undefined') statsAnalysisCache.delete(route);
                        byId.delete(cursor.value.routeId);
                    }
                    cursor.continue();
                };
                tx.oncomplete = () => {
                    byId.forEach(route => {
                        route.points = [];
                        if (typeof statsAnalysisCache !== 'undefined') statsAnalysisCache.delete(route);
                    });
                    resolve();
                };
                tx.onerror = () => reject(tx.error || new Error('track-load-failed'));
                tx.onabort = () => reject(tx.error || new Error('track-load-aborted'));
            } catch (error) { reject(error); }
        });
    },
    put(route)  {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject(new Error('no-db'));
            try {
                const tx = this.db.transaction(['routes', 'routeTracks', 'routePhotos'], 'readwrite');
                const record = { ...route };
                const photos = [];
                if (Array.isArray(route.points)) {
                    record.pointCount = route.points.length;
                    record.previewPoints = routePreviewPoints(route.points);
                    tx.objectStore('routeTracks').put({ routeId: route.id, points: route.points });
                }
                delete record.points;
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
                tx.oncomplete = () => resolve(record);
                tx.onerror = () => reject(tx.error || new Error('save-failed'));
                tx.onabort = () => reject(tx.error || new Error('save-aborted'));
            } catch (e) { reject(e); }
        });
    },
    putMetadata(route) {
        const metadata = { ...route };
        delete metadata.points;
        if (Array.isArray(metadata.pois)) {
            metadata.pois = metadata.pois.map(poi => {
                if (!poi || !(poi.photo instanceof Blob)) return poi;
                const { photo, ...withoutPhoto } = poi;
                return withoutPhoto;
            });
        }
        return this.put(metadata);
    },
    del(id) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject(new Error('no-db'));
            try {
                const tx = this.db.transaction(['routes', 'routeTracks', 'routePhotos'], 'readwrite');
                tx.objectStore('routes').delete(id);
                tx.objectStore('routeTracks').delete(id);
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
                const tx = this.db.transaction(['routes', 'routeTracks', 'kv', 'routePhotos'], 'readwrite');
                tx.objectStore('routes').delete(id);
                tx.objectStore('routeTracks').delete(id);
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
    kvKeys()    { return this.run('kv', 'readonly',  s => s.getAllKeys()); },
    saveDraft(meta, pointBatch, startIndex, photos) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject(new Error('no-db'));
            try {
                const tx = this.db.transaction(['kv', 'draftPoints', 'routePhotos'], 'readwrite');
                if (pointBatch.length) tx.objectStore('draftPoints').put({ startIndex, points: pointBatch });
                tx.objectStore('kv').put({ ...meta, chunked: true, savedPointCount: startIndex + pointBatch.length }, 'draft');
                if (photos !== null) {
                    const photoStore = tx.objectStore('routePhotos');
                    if (photos.length) photoStore.put({ routeId: 'active-draft', photos });
                    else photoStore.delete('active-draft');
                }
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error || new Error('draft-save-failed'));
                tx.onabort = () => reject(tx.error || new Error('draft-save-aborted'));
            } catch (error) { reject(error); }
        });
    },
    loadDraft() {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject(new Error('no-db'));
            try {
                const tx = this.db.transaction(['kv', 'draftPoints', 'routePhotos'], 'readonly');
                const metaRequest = tx.objectStore('kv').get('draft');
                const batchesRequest = tx.objectStore('draftPoints').getAll();
                const photosRequest = tx.objectStore('routePhotos').get('active-draft');
                tx.oncomplete = () => {
                    const draft = metaRequest.result;
                    if (!draft) { resolve(null); return; }
                    if (!draft.chunked) { resolve({ ...draft, legacyDraft: true }); return; }
                    const points = [];
                    batchesRequest.result
                        .sort((a, b) => a.startIndex - b.startIndex)
                        .forEach(batch => points.push(...batch.points));
                    const pois = Array.isArray(draft.pois) ? draft.pois.slice() : [];
                    const storedPhotos = photosRequest.result;
                    if (storedPhotos && Array.isArray(storedPhotos.photos)) {
                        storedPhotos.photos.forEach(item => {
                            if (Number.isInteger(item.index) && item.index >= 0 && item.photo instanceof Blob) {
                                pois[item.index] = { ...(pois[item.index] || {}), photo: item.photo };
                            }
                        });
                    }
                    resolve({ ...draft, points, pois, legacyDraft: false });
                };
                tx.onerror = () => reject(tx.error || new Error('draft-load-failed'));
                tx.onabort = () => reject(tx.error || new Error('draft-load-aborted'));
            } catch (error) { reject(error); }
        });
    },
    clearDraft() {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject(new Error('no-db'));
            try {
                const tx = this.db.transaction(['kv', 'draftPoints', 'routePhotos'], 'readwrite');
                tx.objectStore('kv').delete('draft');
                tx.objectStore('draftPoints').clear();
                tx.objectStore('routePhotos').delete('active-draft');
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error || new Error('draft-clear-failed'));
                tx.onabort = () => reject(tx.error || new Error('draft-clear-aborted'));
            } catch (error) { reject(error); }
        });
    }
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
