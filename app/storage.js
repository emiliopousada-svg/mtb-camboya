'use strict';

//  ALMACENAMIENTO (IndexedDB)
// ============================================================
const DB = {
    db: null,
    open() {
        return new Promise((res, rej) => {
            if (!window.indexedDB) return rej(new Error('no-idb'));
            const r = indexedDB.open('mtb_app', 1);
            r.onupgradeneeded = () => {
                const d = r.result;
                d.createObjectStore('routes', { keyPath: 'id' });
                d.createObjectStore('kv');
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
    put(r)      { return this.run('routes', 'readwrite', s => s.put(r)); },
    del(id)     { return this.run('routes', 'readwrite', s => s.delete(id)); },
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
    const buf = [];
    let ref = null, gain = 0;
    return {
        add(alt) {
            if (alt == null || isNaN(alt)) return;
            buf.push(alt);
            if (buf.length > 5) buf.shift();
            const s = buf.reduce((x, y) => x + y, 0) / buf.length; // media móvil
            if (ref === null) { ref = s; return; }
            if (s - ref >= ELEV_STEP) { gain += s - ref; ref = s; }
            else if (ref - s >= ELEV_STEP) { ref = s; }
        },
        get gain() { return gain; }
    };
}

// Desnivel positivo acumulado en cada punto de un track con altitud en p[2].
function gainCumulative(points) {
    const tracker = makeElevTracker();
    const out = new Float64Array(points.length);
    points.forEach((p, i) => { tracker.add(p[2] == null ? null : Number(p[2])); out[i] = tracker.gain; });
    return out;
}

// ============================================================
