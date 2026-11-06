'use strict';

        // ============================================================
        //  UTILIDADES
        // ============================================================
        const $ = id => document.getElementById(id);

        function dist(a, b) { // metros entre [lat, lon] y [lat, lon]
            const R = 6371000, r = Math.PI / 180;
            const dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
            const s = Math.sin(dLat / 2) ** 2 +
                      Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
            return 2 * R * Math.asin(Math.sqrt(s));
        }

        function activityTypeFromName(name) {
            const value = String(name || '');
            for (const [type, activity] of Object.entries(ACTIVITY_TYPES)) {
                if (value.startsWith(`${activity.icon} ${activity.label} · `)) return type;
            }
            return null;
        }

        function activityTypeForRoute(route) {
            return Object.prototype.hasOwnProperty.call(ACTIVITY_TYPES, route.activityType)
                ? route.activityType
                : activityTypeFromName(route.name);
        }

        function routeActivityPrefix(type) {
            const activity = ACTIVITY_TYPES[type];
            return `${activity.icon} ${activity.label} · `;
        }

        function routeNameWithoutActivity(route) {
            const type = activityTypeForRoute(route);
            const prefix = type ? routeActivityPrefix(type) : '';
            return prefix && route.name.startsWith(prefix) ? route.name.slice(prefix.length) : route.name;
        }

        async function promptRequiredRouteName(suggestion) {
            while (true) {
                const value = await modal({
                    message: 'Escribe un nombre para esta ruta (obligatorio):',
                    input: suggestion || '',
                    ok: 'Guardar'
                });
                if (value === null) return null;
                const name = value.trim().slice(0, 80);
                if (name) return name;
                toast('El nombre de la ruta no puede estar vacío.');
            }
        }

        function fmtClock(sec) {
            const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
            const p = n => String(n).padStart(2, '0');
            return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
        }
        function fmtDur(sec) {
            return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
        }
        function fmtDate(iso) {
            return new Date(iso).toLocaleDateString('es-ES');
        }
        function xmlEsc(s) {
            return String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
        }

        let toastTimer = null;
        function toast(msg, ms = 3500) {
            const t = $('toast');
            t.textContent = msg;
            t.classList.add('show');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => t.classList.remove('show'), ms);
        }

        // Diálogo propio (sustituye a confirm/prompt). Con `input` devuelve texto o null.
        function modal({ message, input = null, ok = 'Aceptar', cancel = 'Cancelar' }) {
            return new Promise(resolve => {
                const m = $('modal'), inp = $('modal-input'), bOk = $('modal-ok'), bCancel = $('modal-cancel');
                $('modal-msg').textContent = message;
                inp.style.display = input !== null ? 'block' : 'none';
                if (input !== null) inp.value = input;
                bOk.textContent = ok;
                bCancel.textContent = cancel;
                m.classList.add('show');
                if (input !== null) setTimeout(() => { inp.focus(); inp.select(); }, 50);

                const done = v => {
                    m.classList.remove('show');
                    bOk.onclick = bCancel.onclick = inp.onkeydown = null;
                    resolve(v);
                };
                bOk.onclick = () => done(input !== null ? inp.value : true);
                bCancel.onclick = () => done(input !== null ? null : false);
                inp.onkeydown = e => { if (e.key === 'Enter') bOk.click(); };
            });
        }

        async function download(name, text, mime) {
            // Dentro del APK (Capacitor) las descargas por enlace no funcionan: se comparte el archivo
            const cap = window.Capacitor;
            if (cap && cap.isNativePlatform && cap.isNativePlatform() && cap.Plugins && cap.Plugins.Filesystem && cap.Plugins.Share) {
                try {
                    const res = await cap.Plugins.Filesystem.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
                    await cap.Plugins.Share.share({ title: name, url: res.uri, dialogTitle: 'Guardar o compartir' });
                    return;
                } catch (e) {
                    if (e && /cancel/i.test(String(e.message || e))) return;
                    console.warn('Compartir falló, probando descarga normal:', e);
                }
            }
            const url = URL.createObjectURL(new Blob([text], { type: mime }));
            const a = document.createElement('a');
            a.href = url;
            a.download = name;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
        }

        // ============================================================
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
            kvDel(k)    { return this.run('kv', 'readwrite', s => s.delete(k)); }
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

