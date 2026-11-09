'use strict';

//  CUENTA Y SINCRONIZACIÓN (servidor PocketBase propio)
// ============================================================
const Cloud = {
    get server() {
        const stored = localStorage.getItem('mtb_server');
        return normalizeServer(stored || DEFAULT_CLOUD_SERVER);
    },
    setServer(nextServer) {
        const normalized = normalizeServer(nextServer || DEFAULT_CLOUD_SERVER);
        const current = this.server;
        localStorage.setItem('mtb_server', normalized);
        if (this.loggedIn() && current && current !== normalized) {
            this.clearSession();
        }
        return normalized;
    },
    get token()  { return localStorage.getItem('mtb_token') || ''; },
    get uid()    { return localStorage.getItem('mtb_uid') || ''; },
    get email()  { return localStorage.getItem('mtb_email') || ''; },
    get groupCode() { return localStorage.getItem('mtb_group_code') || ''; },
    loggedIn()   { return !!(this.server && this.token && this.uid); },
    setSession(token, rec) {
        localStorage.setItem('mtb_token', token);
        localStorage.setItem('mtb_uid', rec.id);
        localStorage.setItem('mtb_email', rec.email || '');
        localStorage.setItem('mtb_group_code', rec.groupCode || '');
    },
    clearSession() {
        ['mtb_token', 'mtb_uid', 'mtb_email', 'mtb_group_code'].forEach(k => localStorage.removeItem(k));
    }
};

// body: objeto (JSON), FormData (archivos) o null
async function cloudApi(path, method = 'GET', body = null) {
    const headers = {};
    if (Cloud.token) headers.Authorization = Cloud.token;
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(Cloud.server + path, { method, headers, body: payload });
    if (!res.ok) {
        let msg = '';
        try {
            const j = await res.json();
            msg = j.message || '';
            const f = j.data ? Object.entries(j.data).map(([k, v]) => `${k}: ${v.message}`).join('; ') : '';
            if (f) msg += ` (${f})`;
        } catch (e) {}
        const err = new Error(msg || ('Error ' + res.status));
        err.status = res.status; // sin status = no se pudo conectar
        throw err;
    }
    return res.status === 204 ? null : res.json();
}

function normalizeServer(v) {
    v = v.trim().replace(/\/+$/, '');
    if (v && !/^https?:\/\//i.test(v)) v = 'https://' + v;
    return v;
}

function renderAccount() {
    const serverInput = $('acc-server');
    if (serverInput) {
        serverInput.value = Cloud.server;
    }
    const on = Cloud.loggedIn();
    $('acc-form').style.display = on ? 'none' : 'block';
    $('acc-logged').style.display = on ? 'block' : 'none';
    const last = localStorage.getItem('mtb_lastsync');
    $('acc-status').textContent = on
        ? `Conectado como ${Cloud.email}` + (Cloud.groupCode ? ' · grupo asignado' : ' · sin grupo asignado') + (last ? ` · última sincronización: ${new Date(Number(last)).toLocaleString('es-ES')}` : '')
        : 'Sin sesión: tus rutas se guardan solo en este móvil.';
}

async function accAuth(register) {
    const server = Cloud.server;
    const email = $('acc-email').value.trim();
    const pass = $('acc-pass').value;
    if (!email || !pass) { toast('Rellena correo y contraseña'); return; }
    if (register && pass.length < 8) { toast('La contraseña debe tener al menos 8 caracteres'); return; }
    localStorage.setItem('mtb_server', server);
    Cloud.clearSession();
    try {
        if (register) await cloudApi('/api/collections/users/records', 'POST', { email, password: pass, passwordConfirm: pass });
        const r = await cloudApi('/api/collections/users/auth-with-password', 'POST', { identity: email, password: pass });
        Cloud.setSession(r.token, r.record);
        $('acc-pass').value = '';
        renderAccount();
        await restoreGroup();
        toast(register ? '✅ Cuenta creada' : '✅ Sesión iniciada');
        syncRoutes(true);
        syncSharedPois();
    } catch (e) {
        console.warn('Auth:', e);
        toast(e.status === undefined
            ? 'No se pudo conectar con el servidor. Revisa la dirección.'
            : 'No se pudo entrar: ' + e.message, 6000);
    }
}

async function putLocal(r) { try { await DB.put(r); } catch (e) { console.warn('put local:', e); } }

async function queueRemoteDelete(remoteId) {
    try {
        const p = (await DB.kvGet('pendingDeletes')) || [];
        p.push(remoteId);
        await DB.kvSet('pendingDeletes', p);
    } catch (e) {}
}

function routeForm(r) {
    const route = r && typeof r === 'object' ? r : {};
    const fd = new FormData();
    fd.append('owner', Cloud.uid);
    fd.append('clientId', String(route.id ?? Date.now()));
    fd.append('name', String(route.name ?? 'Ruta sin nombre'));
    fd.append('kind', route.kind || 'recorded');
    fd.append('startedAt', route.startedAt || new Date().toISOString());
    fd.append('movingTimeSec', String(route.movingTimeSec || 0));
    fd.append('distanceKm', String(route.distanceKm || 0));
    fd.append('elevationGain', String(route.elevationGain || 0));
    fd.append('hrAvg', String(route.hrAvg ?? 0));
    fd.append('track', new Blob([JSON.stringify(Array.isArray(route.points) ? route.points : [])], { type: 'application/json' }), 'track.json');
    return fd;
}

let syncing = false;
async function syncRoutes(manual = false) {
    if (!Cloud.loggedIn() || syncing) return;
    if (!navigator.onLine) { if (manual) toast('Sin conexión: se sincronizará cuando vuelva internet'); return; }
    syncing = true;
    $('acc-status').textContent = 'Sincronizando…';
    let pushed = 0, pulled = 0;
    try {
        // 0) renovar la sesión (si ha caducado, se cierra)
        try {
            const ar = await cloudApi('/api/collections/users/auth-refresh', 'POST');
            Cloud.setSession(ar.token, ar.record);
        } catch (e) {
            if (e.status !== undefined) {
                Cloud.clearSession();
                toast('La sesión ha caducado. Vuelve a entrar.', 5000);
                return;
            }
            throw e;
        }

        // 1) rutas que ya hay en el servidor
        const remote = [];
        for (let page = 1; ; page++) {
            const r = await cloudApi(`/api/collections/routes/records?page=${page}&perPage=200&sort=clientId`);
            remote.push(...r.items);
            if (page >= r.totalPages) break;
        }

        // 2) borrados pendientes
        let pend = [];
        try { pend = (await DB.kvGet('pendingDeletes')) || []; } catch (e) {}
        const rest = [];
        for (const rid of pend) {
            try { await cloudApi(`/api/collections/routes/records/${rid}`, 'DELETE'); }
            catch (e) { if (e.status !== 404) rest.push(rid); }
        }
        try { await DB.kvSet('pendingDeletes', rest); } catch (e) {}
        const skip = new Set(pend);

        // 3) subir lo nuevo y los cambios de nombre
        const byClient = new Map(remote.map(x => [Number(x.clientId), x]));
        for (const r of savedRoutes) {
            const found = byClient.get(r.id);
            if (!r.remoteId && found && !skip.has(found.id)) { r.remoteId = found.id; r.dirty = false; await putLocal(r); }
            if (r.remoteId && !r.dirty) continue;
            try {
                let rec;
                if (r.remoteId) rec = await cloudApi(`/api/collections/routes/records/${r.remoteId}`, 'PATCH', { name: r.name });
                else rec = await cloudApi('/api/collections/routes/records', 'POST', routeForm(r));
                r.remoteId = rec.id;
                r.dirty = false;
                await putLocal(r);
                pushed++;
            } catch (e) {
                if (e.status === 404 && r.remoteId) { r.remoteId = null; await putLocal(r); } // desaparecida del servidor: se subirá de nuevo
                else throw e;
            }
        }

        // 4) bajar las que faltan en este móvil
        const localIds = new Set(savedRoutes.map(r => r.id));
        const missing = remote.filter(x => !skip.has(x.id) && x.track && !localIds.has(Number(x.clientId)));
        if (missing.length) {
            const ft = (await cloudApi('/api/files/token', 'POST')).token;
            for (const rec of missing) {
                const res = await fetch(`${Cloud.server}/api/files/routes/${rec.id}/${encodeURIComponent(rec.track)}?token=${encodeURIComponent(ft)}`);
                if (!res.ok) continue;
                const points = await res.json();
                if (!Array.isArray(points) || points.length < 2) continue;
                const r = {
                    id: Number(rec.clientId), remoteId: rec.id, dirty: false,
                    kind: rec.kind || 'recorded', name: rec.name, startedAt: rec.startedAt,
                    activityType: Object.prototype.hasOwnProperty.call(ACTIVITY_TYPES, rec.activityType)
                        ? rec.activityType
                        : activityTypeFromName(rec.name),
                    movingTimeSec: rec.movingTimeSec || 0, distanceKm: rec.distanceKm || 0,
                    elevationGain: rec.elevationGain || 0, hrAvg: rec.hrAvg || null, points
                };
                await putLocal(r);
                savedRoutes.push(r);
                pulled++;
            }
            savedRoutes.sort((a, b) => b.id - a.id);
        }

        localStorage.setItem('mtb_lastsync', String(Date.now()));
        renderSavedRoutes();
        refreshStats();
        if (manual) toast(`✅ Sincronizado: ${pushed} subidas, ${pulled} descargadas`);
    } catch (e) {
        console.warn('Sync:', e);
        if (manual || e.status !== undefined) {
            toast(e.status === undefined ? 'No se pudo conectar con el servidor' : 'Error al sincronizar: ' + e.message, 6000);
        }
    } finally {
        syncing = false;
        renderAccount();
    }
}

function initSettings() {
    const sound = $('setting-route-sound');
    const vibration = $('setting-route-vibration');
    const mapRotation = $('setting-map-rotation');
    sound.checked = localStorage.getItem('mtb_route_sound') !== '0';
    vibration.checked = localStorage.getItem('mtb_route_vibration') !== '0';
    mapRotationEnabled = localStorage.getItem('mtb_map_rotation') !== '0';
    mapRotation.checked = mapRotationEnabled;
    updateOrientBtn();
    window.addEventListener('online', applyMapStyle);
    window.addEventListener('offline', applyMapStyle);
    sound.addEventListener('change', () => localStorage.setItem('mtb_route_sound', sound.checked ? '1' : '0'));
    vibration.addEventListener('change', () => localStorage.setItem('mtb_route_vibration', vibration.checked ? '1' : '0'));
    mapRotation.addEventListener('change', () => setMapRotationMode(mapRotation.checked));
    initSensorConnections();
    $('app-version').textContent = 'v' + APP_VERSION;
}

function initAccount() {
    const savedServer = localStorage.getItem('mtb_server');
    if (!savedServer) {
        localStorage.setItem('mtb_server', DEFAULT_CLOUD_SERVER);
    } else {
        localStorage.setItem('mtb_server', normalizeServer(savedServer));
    }

    const serverInput = $('acc-server');
    if (serverInput) {
        serverInput.value = Cloud.server;
        serverInput.addEventListener('change', () => {
            const nextServer = Cloud.setServer(serverInput.value);
            serverInput.value = nextServer;
            if (Cloud.loggedIn()) {
                Cloud.clearSession();
                toast('Servidor cambiado: vuelve a iniciar sesión.', 4000);
            }
            renderAccount();
        });
    }

    $('acc-login').addEventListener('click', () => accAuth(false));
    $('acc-register').addEventListener('click', () => accAuth(true));
    $('acc-sync').addEventListener('click', () => syncRoutes(true));
    $('acc-logout').addEventListener('click', async () => {
        await stopGroup();
        Cloud.clearSession();
        renderFriends();
        renderAccount();
        toast('Sesión cerrada. Tus rutas siguen en este móvil.');
    });
    window.addEventListener('online', () => { syncRoutes(); syncSharedPois(); });
    renderAccount();
}

async function migrateOldRoutes() {
    let old;
    try { old = JSON.parse(localStorage.getItem('mtb_saved_routes') || 'null'); } catch (e) { return; }
    if (!Array.isArray(old) || old.length === 0) return;
    const migrated = old.map(r => ({
        id: r.id || Date.now(),
        kind: 'recorded',
        name: r.name || 'Ruta MTB',
        startedAt: new Date(r.id || Date.now()).toISOString(),
        movingTimeSec: 0,
        distanceKm: parseFloat(String(r.distance || '0').replace(' km', '')) || 0,
        elevationGain: 0,
        hrAvg: null,
        points: (r.coords || []).map(c => [c[0], c[1], null, null, null])
    }));
    try {
        for (const r of migrated) await DB.put(r);
        savedRoutes = savedRoutes.concat(migrated).sort((a, b) => b.id - a.id);
        localStorage.removeItem('mtb_saved_routes'); // solo se borra si todo se copió bien
    } catch (e) { console.warn('Migración incompleta', e); }
}

// Limpieza única de lo que dejó la antigua pestaña Camino (ya eliminada).
// Los tracks que el usuario importó allí (camino-tracks:*) no se tocan.
async function purgeLegacyCaminoData() {
    if (localStorage.getItem('mtb_camino_purged') === '1') return;
    try {
        ['mtb_camino_guide', 'mtb_camino_guide_paused', 'mtb_camino_active', 'mtb_camino_track',
         'mtb_camino_saved_track', 'mtb_camino_filters', 'mtb_camino_favorites', 'mtb_albergue_favorites']
            .forEach(key => localStorage.removeItem(key));
        const keys = await DB.kvKeys();
        for (const key of keys) {
            if (/^camino-(full|pois|dl):/.test(String(key))) await DB.kvDel(key);
        }
        localStorage.setItem('mtb_camino_purged', '1');
    } catch (e) { console.warn('No se pudo limpiar los datos del antiguo Camino:', e); }
}

async function init() {
    initMap();
    initCharts();
    initMetricPanel();
    setBtnState('idle');
    updateCenterBtn();
    loadSavedFountains();

    try {
        await DB.open();
        savedRoutes = (await DB.all()).sort((a, b) => b.id - a.id);
        await migrateOldRoutes();
    } catch (e) {
        console.warn('Sin IndexedDB:', e);
        toast('⚠️ Sin almacenamiento persistente: las rutas se perderán al cerrar la app.', 6000);
    }
    purgeLegacyCaminoData();

    renderSavedRoutes();
    refreshStats();
    initAccount();
    syncRoutes();
    initSettings();
    await syncSharedPois();
    setInterval(syncSharedPois, 60000);
    await restoreGroup();
    startGps();
    await maybeRestoreDraft();
}

init();

// Service Worker: abre la app sin conexión y guarda las teselas ya vistas
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
}
