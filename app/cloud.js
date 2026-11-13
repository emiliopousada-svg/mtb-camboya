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
    get nickname() { return localStorage.getItem('mtb_nickname') || ''; },
    get groupCode() { return localStorage.getItem('mtb_group_code') || ''; },
    loggedIn()   { return !!(this.server && this.token && this.uid); },
    setSession(token, rec) {
        localStorage.setItem('mtb_token', token);
        localStorage.setItem('mtb_uid', rec.id);
        localStorage.setItem('mtb_avatar_last_uid', rec.id);
        localStorage.setItem('mtb_email', rec.email || '');
        if (rec.nickname) localStorage.setItem('mtb_nickname', String(rec.nickname).trim().slice(0, ROUTE_NICKNAME_LIMIT));
        else localStorage.removeItem('mtb_nickname');
        localStorage.setItem('mtb_group_code', rec.groupCode || '');
        if (typeof renderAccountAvatar === 'function') renderAccountAvatar();
    },
    clearSession() {
        ['mtb_token', 'mtb_uid', 'mtb_email', 'mtb_nickname', 'mtb_group_code'].forEach(k => localStorage.removeItem(k));
        if (typeof resetAccountProfileCache === 'function') resetAccountProfileCache();
        if (typeof renderAccountAvatar === 'function') renderAccountAvatar();
    }
};

const CLOUD_TIMEOUT_MS = 10000;
const ROUTE_NICKNAME_LIMIT = 32;
const ROUTE_FULL_AUDIT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const ROUTE_SYNC_CURSOR_OVERLAP_MS = 5000;

function cloudSyncStorageKey(name) {
    return `mtb_${name}_${encodeURIComponent(Cloud.server)}_${Cloud.uid}`;
}

async function fetchRemoteRoutes(fullAudit, cursor) {
    const unsupportedKey = cloudSyncStorageKey('routes_incremental_unsupported');
    const fetchPages = async (sort, filter = '') => {
        const remote = [];
        for (let page = 1; ; page++) {
            const result = await cloudApi(`/api/collections/routes/records?page=${page}&perPage=200&sort=${sort}${filter}`);
            remote.push(...result.items);
            if (page >= result.totalPages) break;
        }
        return remote;
    };
    if (fullAudit || localStorage.getItem(unsupportedKey) === '1') {
        return { records: await fetchPages('clientId'), fullAudit: true };
    }
    let since = '';
    if (cursor) {
        const cursorMs = Date.parse(cursor);
        if (Number.isFinite(cursorMs)) since = new Date(Math.max(0, cursorMs - ROUTE_SYNC_CURSOR_OVERLAP_MS)).toISOString();
    }
    const filter = since ? `&filter=${encodeURIComponent(`updated >= "${since}"`)}` : '';
    try {
        return { records: await fetchPages('updated,clientId', filter), fullAudit: false };
    } catch (error) {
        if (error.status !== 400) throw error;
        // Algunas instalaciones antiguas no tienen el campo updated en routes.
        // Reconciliar todo mantiene la sincronización funcional sin cambiar el esquema del servidor.
        const remote = await fetchPages('clientId');
        localStorage.setItem(unsupportedKey, '1');
        console.warn('La colección routes no admite sincronización incremental; se usará reconciliación completa.', error);
        return { records: remote, fullAudit: true };
    }
}

function newestRemoteUpdate(records, fallbackMs) {
    const latest = records.reduce((value, record) => {
        const updated = Date.parse(record.updated || record.created || '');
        return Number.isFinite(updated) ? Math.max(value, updated) : value;
    }, 0);
    return new Date(Math.max(0, (latest || fallbackMs) - ROUTE_SYNC_CURSOR_OVERLAP_MS)).toISOString();
}

function normalizeRemoteTrack(raw) {
    let value = raw;
    for (let depth = 0; depth < 3 && typeof value === 'string'; depth++) {
        try { value = JSON.parse(value); }
        catch (_) { return null; }
    }

    let geoJson = false;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (value.type === 'Feature') value = value.geometry;
        else if (value.type === 'FeatureCollection') {
            geoJson = true;
            value = (Array.isArray(value.features) ? value.features : [])
                .map(feature => feature && feature.geometry)
                .filter(geometry => geometry && ['LineString', 'MultiLineString'].includes(geometry.type))
                .map(geometry => geometry.coordinates);
        }
        if (value && !Array.isArray(value) && ['LineString', 'MultiLineString'].includes(value.type)) {
            geoJson = true;
            value = value.coordinates;
        } else if (value && !Array.isArray(value)) {
            value = value.points ?? value.trackPoints ?? value.routePoints ?? value.coords ??
                value.segments ?? value.lines ?? value.track ?? value.coordinates ?? value.data;
        }
    }

    const pointFrom = (item, reverseCoordinates) => {
        let point;
        if (Array.isArray(item) && item.length >= 2 && Number.isFinite(Number(item[0])) && Number.isFinite(Number(item[1]))) {
            point = reverseCoordinates
                ? [Number(item[1]), Number(item[0]), ...item.slice(2)]
                : [Number(item[0]), Number(item[1]), ...item.slice(2)];
        } else if (item && typeof item === 'object') {
            const lat = Number(item.lat ?? item.latitude);
            const lng = Number(item.lng ?? item.lon ?? item.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
            point = [lat, lng, item.altitude ?? item.alt ?? null, item.time ?? null, item.hr ?? null];
        } else return null;
        if (Math.abs(point[0]) > 90 || Math.abs(point[1]) > 180) return null;
        while (point.length < 6) point.push(null);
        return point;
    };

    const points = [];
    const appendSegment = (segment, reverseCoordinates, startsNewSegment = false) => {
        if (!Array.isArray(segment) || !segment.length) return false;
        const parsed = segment.map(item => pointFrom(item, reverseCoordinates));
        if (parsed.some(point => !point)) return false;
        if (startsNewSegment && points.length) parsed[0][5] = 1;
        points.push(...parsed);
        return true;
    };
    const visit = (items, reverseCoordinates = geoJson) => {
        if (!Array.isArray(items) || !items.length) return false;
        if (pointFrom(items[0], reverseCoordinates)) return appendSegment(items, reverseCoordinates, false);
        let added = false;
        for (const segment of items) {
            const before = points.length;
            if (Array.isArray(segment) && pointFrom(segment[0], reverseCoordinates)) {
                added = appendSegment(segment, reverseCoordinates, before > 0) || added;
            } else {
                added = visit(segment, reverseCoordinates) || added;
                if (points.length > before && before > 0) points[before][5] = 1;
            }
        }
        return added;
    };

    visit(value);
    return points.length >= 2 ? points : null;
}

function routeNicknameStorageKey() {
    return Cloud.uid ? `mtb_route_nickname_${Cloud.uid}` : '';
}

function getRouteNickname() {
    const key = routeNicknameStorageKey();
    return String(Cloud.nickname || (key && localStorage.getItem(key)) || '').trim().slice(0, ROUTE_NICKNAME_LIMIT);
}

async function ensureRouteNickname() {
    const current = getRouteNickname();
    if (current) return current;
    const value = await modal({
        message: 'Elige el apodo que aparecerá como autor de tus rutas sincronizadas:',
        input: String(Cloud.nickname || '').trim().slice(0, ROUTE_NICKNAME_LIMIT),
        ok: 'Guardar apodo'
    });
    if (value === null) return null;
    const nickname = String(value).trim().slice(0, ROUTE_NICKNAME_LIMIT);
    if (!nickname) {
        toast('Escribe un apodo para sincronizar tus rutas.');
        return null;
    }
    localStorage.setItem(routeNicknameStorageKey(), nickname);
    return nickname;
}

// body: objeto (JSON), FormData (archivos) o null
async function cloudApi(path, method = 'GET', body = null, options = {}) {
    const timeoutMs = typeof options === 'number' ? options : (options?.timeoutMs || CLOUD_TIMEOUT_MS);
    const headers = {};
    if (Cloud.token) headers.Authorization = Cloud.token;
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const url = new URL(Cloud.server + path);
    if (url.protocol !== 'https:' || url.username || url.password) {
        throw new Error('El servidor debe usar una dirección HTTPS válida.');
    }

    const controller = new AbortController();
    if (options?.signal) {
        if (options.signal.aborted) controller.abort(options.signal.reason);
        else options.signal.addEventListener('abort', () => controller.abort(options.signal.reason), { once: true });
    }
    const timer = setTimeout(() => {
        const timeoutErr = new Error('Tiempo de espera agotado al conectar con el servidor');
        timeoutErr.name = 'TimeoutError';
        controller.abort(timeoutErr);
    }, timeoutMs);

    try {
        const res = await fetch(url.href, { method, headers, body: payload, signal: controller.signal });
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
        return res.status === 204 ? null : await res.json();
    } catch (e) {
        if (e.name === 'AbortError' || e.name === 'TimeoutError') {
            const timeoutErr = new Error('Tiempo de espera agotado al conectar con el servidor');
            throw timeoutErr;
        }
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

function normalizeServer(v) {
    v = String(v || '').trim().replace(/\/+$/, '');
    if (!v) return '';
    if (/^http:\/\//i.test(v)) v = v.replace(/^http:/i, 'https:');
    else if (/^[a-z][a-z\d+.-]*:\/\//i.test(v) && !/^https:\/\//i.test(v)) {
        throw new Error('El servidor debe usar HTTPS.');
    } else if (!/^https:\/\//i.test(v)) v = 'https://' + v;

    let url;
    try { url = new URL(v); }
    catch (error) { throw new Error('La dirección del servidor no es válida.'); }
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash) {
        throw new Error('El servidor debe usar una dirección HTTPS válida.');
    }
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

function renderAccount() {
    renderAccountServer();
    const on = Cloud.loggedIn();
    $('acc-form').style.display = on ? 'none' : 'block';
    $('acc-logged').style.display = on ? 'block' : 'none';
    const hasNickname = Boolean(Cloud.nickname);
    $('acc-nickname-setup').hidden = !on || hasNickname;
    $('acc-ready').hidden = !on || !hasNickname;
    if (hasNickname) {
        $('acc-account-nickname').value = Cloud.nickname;
        $('acc-nickname-summary').textContent = `Apodo: ${Cloud.nickname}`;
    }
    const last = localStorage.getItem('mtb_lastsync');
    const syncFailures = Number(localStorage.getItem('mtb_sync_failures') || 0);
    $('acc-status').textContent = on
        ? `Conectado como ${Cloud.email}` + (Cloud.groupCode ? ' · grupo asignado' : ' · sin grupo asignado') + (last ? ` · última sincronización: ${new Date(Number(last)).toLocaleString('es-ES')}` : '') + (syncFailures ? ` · sincronización parcial: ${syncFailures} elemento(s) pendiente(s)` : '')
        : 'Sin sesión: tus rutas se guardan solo en este móvil.';
}

function renderAccountServer() {
    const serverInput = $('acc-server');
    if (serverInput) {
        try { serverInput.textContent = Cloud.server || DEFAULT_CLOUD_SERVER; }
        catch (error) { serverInput.textContent = DEFAULT_CLOUD_SERVER; }
    }
}

async function accAuth(register) {
    const server = Cloud.server;
    const nickname = $('acc-nickname').value.trim().slice(0, ROUTE_NICKNAME_LIMIT);
    const email = $('acc-email').value.trim();
    const pass = $('acc-pass').value;
    if (!email || !pass) { toast('Rellena correo y contraseña'); return; }
    if (register && !nickname) { toast('Escribe un apodo para crear la cuenta.'); $('acc-nickname').focus(); return; }
    if (register && pass.length < 8) { toast('La contraseña debe tener al menos 8 caracteres'); return; }
    const weightKg = $('acc-weight').value.trim();
    const age = $('acc-age').value.trim();
    if (weightKg && (!Number.isFinite(Number(weightKg)) || Number(weightKg) < 25 || Number(weightKg) > 250)) { toast('El peso debe estar entre 25 y 250 kg.'); return; }
    if (age && (!Number.isInteger(Number(age)) || Number(age) < 10 || Number(age) > 100)) { toast('La edad debe estar entre 10 y 100 años.'); return; }
    localStorage.setItem('mtb_server', server);
    Cloud.clearSession();
    try {
        if (register) {
            const profile = { email, password: pass, passwordConfirm: pass, nickname };
            if (weightKg) profile.weightKg = Number(weightKg);
            if (age) profile.age = Number(age);
            await cloudApi('/api/collections/users/records', 'POST', profile);
        }
        const r = await cloudApi('/api/collections/users/auth-with-password', 'POST', { identity: email, password: pass });
        Cloud.setSession(r.token, r.record);
        renderAccountProfile(r.record);
        if ((weightKg || age) && typeof statsApplyAccountProfile === 'function') {
            statsApplyAccountProfile(r.record.weightKg ?? (weightKg ? Number(weightKg) : undefined),
                r.record.age ?? (age ? Number(age) : undefined));
        }
        try { await syncPendingAccountAvatar(r.record); }
        catch (avatarError) { console.warn('No se pudo sincronizar el avatar pendiente:', avatarError); }
        $('acc-pass').value = '';
        $('acc-weight').value = '';
        $('acc-age').value = '';
        renderAccount();
        if (!Cloud.nickname && nickname) $('acc-account-nickname').value = nickname;
        await restoreGroup();
        toast(register ? '✅ Cuenta creada' : '✅ Sesión iniciada');
        if (Cloud.nickname) syncRoutes(true);
        syncSharedPois();
    } catch (e) {
        console.warn('Auth:', e);
        toast(e.status === undefined
            ? 'No se pudo conectar con el servidor. Revisa la dirección.'
            : 'No se pudo entrar: ' + e.message, 6000);
    }
}

async function saveAccountNickname() {
    const nickname = $('acc-account-nickname').value.trim().slice(0, ROUTE_NICKNAME_LIMIT);
    if (!nickname) { toast('Escribe un apodo para completar tu cuenta.'); $('acc-account-nickname').focus(); return; }
    const button = $('acc-nickname-save');
    button.disabled = true;
    try {
        const updated = await cloudApi(`/api/collections/users/records/${encodeURIComponent(Cloud.uid)}`, 'PATCH', { nickname });
        Cloud.setSession(Cloud.token, updated);
        renderAccount();
        toast('Apodo guardado en tu cuenta.');
    } catch (error) {
        console.warn('No se pudo guardar el apodo de la cuenta:', error);
        toast('No se pudo guardar el apodo: ' + error.message, 6000);
    } finally { button.disabled = false; }
}

async function logoutCloudAccount() {
    await stopGroup();
    Cloud.clearSession();
    renderFriends();
    renderAccount();
    toast('Sesión cerrada. Tus rutas siguen en este móvil.');
}

async function putLocal(r) { await DB.put(r); }

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
    if (route.createdBy) fd.append('createdBy', String(route.createdBy).slice(0, ROUTE_NICKNAME_LIMIT));
    fd.append('kind', route.kind || 'recorded');
    fd.append('startedAt', route.startedAt || new Date().toISOString());
    fd.append('movingTimeSec', String(route.movingTimeSec || 0));
    fd.append('distanceKm', String(route.distanceKm || 0));
    fd.append('elevationGain', String(route.elevationGain || 0));
    fd.append('hrAvg', String(route.hrAvg ?? 0));
    fd.append('track', new Blob([JSON.stringify(Array.isArray(route.points) ? route.points : [])], { type: 'application/json' }), 'track.json');
    return fd;
}

let syncing = false, syncRetryQueued = false;
async function syncRoutes(manual = false) {
    if (!Cloud.loggedIn() || syncing) return;
    if (!Cloud.nickname) {
        if (manual) toast('Completa el apodo de tu cuenta antes de sincronizar rutas.');
        return;
    }
    if (!navigator.onLine) { if (manual) toast('Sin conexión: se sincronizará cuando vuelva internet'); return; }
    syncing = true;
    $('acc-status').textContent = 'Sincronizando…';
    let pushed = 0, pulled = 0, syncFailures = 0;
    const syncFailureDetails = [];
    const noteSyncFailure = message => {
        syncFailures++;
        if (syncFailureDetails.length < 3 && message) syncFailureDetails.push(String(message).slice(0, 150));
    };
    const cursorKey = cloudSyncStorageKey('routes_sync_cursor');
    const auditKey = cloudSyncStorageKey('routes_full_audit_at');
    let cursor = '', lastFullAudit = 0;
    try {
        cursor = localStorage.getItem(cursorKey) || '';
        lastFullAudit = Number(localStorage.getItem(auditKey) || 0);
    } catch (e) { console.warn('No se pudo leer el estado incremental de rutas; se hará una reconciliación completa:', e); }
    let fullAudit = manual || !cursor || !lastFullAudit || Date.now() - lastFullAudit >= ROUTE_FULL_AUDIT_INTERVAL_MS;
    const syncStartedAt = Date.now();
    try {
        // 0) renovar la sesión (si ha caducado, se cierra)
        try {
            const ar = await cloudApi('/api/collections/users/auth-refresh', 'POST');
            Cloud.setSession(ar.token, ar.record);
            renderAccountProfile(ar.record);
            try { await syncPendingAccountAvatar(ar.record); }
            catch (avatarError) { console.warn('No se pudo sincronizar el avatar pendiente:', avatarError); }
        } catch (e) {
            if (e.status !== undefined) {
                Cloud.clearSession();
                toast('La sesión ha caducado. Vuelve a entrar.', 5000);
                return;
            }
            throw e;
        }

        // 1) rutas que ya hay en el servidor
        const routeInventory = await fetchRemoteRoutes(fullAudit, cursor);
        const remote = routeInventory.records;
        fullAudit = routeInventory.fullAudit;
        const pendingRemoteByClient = new Map();
        if (!fullAudit) {
            const pendingClientIds = savedRoutes.filter(route => !route.remoteId)
                .map(route => Number(route.id)).filter(Number.isSafeInteger);
            for (let offset = 0; offset < pendingClientIds.length; offset += 50) {
                const ids = pendingClientIds.slice(offset, offset + 50);
                const filter = encodeURIComponent(`(${ids.map(id => `clientId = ${id}`).join(' || ')})`);
                try {
                    const result = await cloudApi(`/api/collections/routes/records?filter=${filter}&perPage=200`);
                    (result.items || []).forEach(record => pendingRemoteByClient.set(Number(record.clientId), record));
                } catch (error) {
                    // No impide subir rutas nuevas; el índice único owner/clientId protege frente a duplicados.
                    console.warn('No se pudieron buscar rutas locales pendientes por clientId:', error);
                }
            }
        }

        const hasRecordedRoutes = savedRoutes.some(route => route.kind !== 'imported');
        const nickname = hasRecordedRoutes ? await ensureRouteNickname() : '';
        if (hasRecordedRoutes && !nickname) {
            toast('Sin apodo, las rutas quedan guardadas en este móvil y pendientes de sincronizar.');
        }

        // 2) borrados pendientes
        let pend = [];
        let pendingDeletesAvailable = true;
        try { pend = (await DB.kvGet('pendingDeletes')) || []; }
        catch (e) { pendingDeletesAvailable = false; noteSyncFailure(`No se pudo leer la cola de borrados: ${e.message}`); console.warn('No se pudo leer la cola de borrados:', e); }
        const rest = [];
        for (const rid of pend) {
            try { await cloudApi(`/api/collections/routes/records/${rid}`, 'DELETE'); }
            catch (e) {
                if (e.status !== 404) {
                    rest.push(rid);
                    noteSyncFailure(`No se pudo borrar una ruta del servidor: ${e.message}`);
                    console.warn(`No se pudo borrar la ruta remota ${rid}:`, e);
                }
            }
        }
        if (pendingDeletesAvailable) {
            try { await DB.kvSet('pendingDeletes', rest); }
            catch (e) { noteSyncFailure(`No se pudo guardar la cola de borrados: ${e.message}`); console.warn('No se pudo guardar la cola de borrados:', e); }
        }
        const skip = new Set(pend);

        // 3) reconciliar lo remoto y subir cambios locales sin bloquear otras rutas
        const byClient = new Map(remote.map(x => [Number(x.clientId), x]));
        const byRemoteId = new Map(remote.map(x => [x.id, x]));
        const blockedIds = new Set();
        for (const r of [...savedRoutes]) {
            if (r.kind !== 'imported' && !nickname) {
                noteSyncFailure(`Ruta «${r.name || 'sin nombre'}» pendiente: falta elegir el apodo del autor.`);
                continue;
            }
            const previousCreator = r.createdBy || '';
            if (r.kind !== 'imported' && nickname) r.createdBy = nickname;
            const found = byClient.get(r.id);
            const remoteRecord = r.remoteId && !skip.has(r.remoteId) ? byRemoteId.get(r.remoteId) : null;
            const matched = remoteRecord || (found && !skip.has(found.id) ? found : null)
                || (!fullAudit ? pendingRemoteByClient.get(Number(r.id)) : null);

            // Una ruta borrada desde otro dispositivo ya no existe en el inventario remoto.
            if (r.remoteId && (skip.has(r.remoteId) || (fullAudit && !matched))) {
                try {
                    const ownerId = r.kind === 'recorded' ? (r.groupRankingOwnerId || Cloud.uid) : '';
                    const rankingServer = r.groupRankingServer || Cloud.server;
                    const clientId = Number(r.id);
                    const rankingDelete = ownerId && rankingServer && Number.isSafeInteger(clientId) && clientId > 0
                        ? { ownerId, server: rankingServer, clientId }
                        : null;
                    await DB.deleteRoute(r.id, null, rankingDelete);
                    savedRoutes = savedRoutes.filter(x => x.id !== r.id);
                    if (rankingDelete) await syncPendingGroupRankingDeletes();
                } catch (e) {
                    blockedIds.add(r.id);
                    noteSyncFailure(`No se pudo aplicar el cambio remoto a «${r.name || 'ruta'}»: ${e.message}`);
                    console.warn(`No se pudo aplicar el borrado remoto de la ruta ${r.id}:`, e);
                }
                continue;
            }

            if (matched && !r.dirty) {
                const remoteIdChanged = r.remoteId !== matched.id;
                r.remoteId = matched.id;
                const remoteName = matched.name || r.name;
                const remoteActivity = activityTypeFromName(remoteName) || r.activityType || 'mtb';
                const remoteCreator = r.kind !== 'imported' && nickname ? nickname : (r.createdBy || matched.createdBy || '');
                if (remoteCreator && matched.createdBy !== remoteCreator) {
                    try {
                        await cloudApi(`/api/collections/routes/records/${r.remoteId}`, 'PATCH', { createdBy: remoteCreator });
                        matched.createdBy = remoteCreator;
                    } catch (e) {
                        noteSyncFailure(`No se pudo actualizar el apodo de «${r.name || 'ruta'}»: ${e.message}`);
                        console.warn(`No se pudo actualizar el apodo de la ruta ${r.id}:`, e);
                    }
                }
                const changed = remoteIdChanged || r.name !== remoteName || r.activityType !== remoteActivity || previousCreator !== remoteCreator;
                r.name = remoteName;
                r.activityType = remoteActivity;
                if (remoteCreator) r.createdBy = remoteCreator;
                r.dirty = false;
                if (changed) {
                    try { await putLocal(r); }
                    catch (e) { blockedIds.add(r.id); noteSyncFailure(`No se pudo guardar «${r.name || 'ruta'}» en este teléfono: ${e.message}`); console.warn(`No se pudo actualizar localmente la ruta ${r.id}:`, e); }
                }
                continue;
            }
            if (blockedIds.has(r.id)) continue;
            if (matched) r.remoteId = matched.id;
            if (r.remoteId && !r.dirty) continue;
            try {
                let rec;
                if (r.remoteId) rec = await cloudApi(`/api/collections/routes/records/${r.remoteId}`, 'PATCH', {
                    name: r.name,
                    ...(r.createdBy ? { createdBy: String(r.createdBy).slice(0, ROUTE_NICKNAME_LIMIT) } : {})
                });
                else rec = await cloudApi('/api/collections/routes/records', 'POST', routeForm(r));
                r.remoteId = rec.id;
                r.dirty = false;
                await putLocal(r);
                pushed++;
            } catch (e) {
                noteSyncFailure(`No se pudo sincronizar «${r.name || 'ruta'}»: ${e.message}`);
                console.warn(`No se pudo sincronizar la ruta ${r.id}:`, e);
                if (e.status === 404 && r.remoteId) {
                    r.remoteId = null;
                    try { await putLocal(r); }
                    catch (localError) { console.warn(`No se pudo actualizar la ruta local ${r.id}:`, localError); }
                }
            }
        }

        // 4) bajar las que faltan en este móvil
        const localIds = new Set(savedRoutes.map(r => r.id));
        const missing = remote.filter(x => !skip.has(x.id) && x.track && !localIds.has(Number(x.clientId)));
        if (missing.length) {
            const ft = (await cloudApi('/api/files/token', 'POST')).token;
            for (const rec of missing) {
                try {
                    const dlController = new AbortController();
                    const dlTimer = setTimeout(() => dlController.abort(), 15000);
                    let res;
                    try {
                        res = await fetch(`${Cloud.server}/api/files/routes/${rec.id}/${encodeURIComponent(rec.track)}?token=${encodeURIComponent(ft)}`, { signal: dlController.signal });
                    } finally {
                        clearTimeout(dlTimer);
                    }
                    if (!res.ok) throw new Error(`El servidor respondió ${res.status}`);
                    let trackData;
                    try { trackData = JSON.parse(await res.text()); }
                    catch (_) { throw new Error('El archivo del track no contiene JSON válido'); }
                    const points = normalizeRemoteTrack(trackData);
                    if (!points) {
                        const shape = Array.isArray(trackData) ? `array (${trackData.length} elementos)`
                            : trackData && typeof trackData === 'object'
                                ? `objeto (${Object.keys(trackData).slice(0, 6).join(', ') || 'sin campos'})`
                                : typeof trackData;
                        throw new Error(`El formato del track no es compatible: ${shape}`);
                    }
                    const id = Number(rec.clientId);
                    if (!Number.isSafeInteger(id) || id < 0) throw new Error('El identificador de ruta no es válido');
                    const r = {
                        id, remoteId: rec.id, dirty: false,
                        kind: rec.kind || 'recorded', name: rec.name, startedAt: rec.startedAt,
                        createdBy: rec.createdBy || 'Usuario local',
                        activityType: Object.prototype.hasOwnProperty.call(ACTIVITY_TYPES, rec.activityType)
                            ? rec.activityType
                            : activityTypeFromName(rec.name),
                        movingTimeSec: rec.movingTimeSec || 0, distanceKm: rec.distanceKm || 0,
                        elevationGain: rec.elevationGain || 0, hrAvg: rec.hrAvg || null, points
                    };
                    await putLocal(r);
                    savedRoutes.push(r);
                    pulled++;
                } catch (e) {
                    noteSyncFailure(`No se pudo descargar «${rec.name || 'una ruta'}»: ${e.message}`);
                    console.warn(`No se pudo descargar la ruta remota ${rec.id}:`, e);
                }
            }
            savedRoutes.sort((a, b) => b.id - a.id);
        }

        localStorage.setItem('mtb_lastsync', String(Date.now()));
        localStorage.setItem('mtb_sync_failures', String(syncFailures));
        if (syncFailures === 0) {
            try {
                if (remote.length || fullAudit) {
                    localStorage.setItem(cursorKey, newestRemoteUpdate(remote, remote.length ? syncStartedAt : 0));
                }
                if (fullAudit) localStorage.setItem(auditKey, String(Date.now()));
            } catch (e) { console.warn('No se pudo guardar el cursor de sincronización de rutas:', e); }
        }
        renderSavedRoutes();
        refreshStats();
        if (manual) toast(syncFailures
            ? `⚠️ Sincronización parcial: ${pushed} subidas, ${pulled} descargadas y ${syncFailures} pendiente(s). ${syncFailureDetails.join(' · ')}`
            : `✅ Sincronizado: ${pushed} subidas, ${pulled} descargadas`, syncFailures ? 10000 : 3500);
    } catch (e) {
        console.warn('Sync:', e);
        if (manual || e.status !== undefined) {
            toast(e.status === undefined ? 'No se pudo conectar con el servidor' : 'Error al sincronizar: ' + e.message, 6000);
        }
    } finally {
        const retryQueued = syncRetryQueued;
        syncRetryQueued = false;
        syncing = false;
        renderAccount();
        if (retryQueued && navigator.onLine && Cloud.loggedIn()) setTimeout(() => syncRoutes(), 250);
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
    initAccountAvatar();
    const savedServer = localStorage.getItem('mtb_server');
    try {
        localStorage.setItem('mtb_server', normalizeServer(savedServer || DEFAULT_CLOUD_SERVER));
    } catch (error) {
        console.warn('La dirección de servidor guardada no es válida:', error);
        localStorage.setItem('mtb_server', DEFAULT_CLOUD_SERVER);
        Cloud.clearSession();
        toast('La dirección de servidor guardada no era válida; se ha restaurado el servidor predeterminado.', 6000);
    }

    const serverInput = $('acc-server');
    if (serverInput) {
        serverInput.value = Cloud.server;
        serverInput.addEventListener('change', () => {
            let nextServer;
            try { nextServer = Cloud.setServer(serverInput.value); }
            catch (error) {
                console.warn('Dirección de servidor no válida:', error);
                toast(error.message, 6000);
                serverInput.value = Cloud.server;
                return;
            }
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
    $('acc-nickname-save').addEventListener('click', saveAccountNickname);
    $('acc-sync').addEventListener('click', async () => {
        await syncRoutes(true);
        await restoreGroup();
    });
    $('acc-logout').addEventListener('click', logoutCloudAccount);
    $('acc-logout-incomplete').addEventListener('click', logoutCloudAccount);
    const syncWhenOnline = () => {
        if (syncing) syncRetryQueued = true;
        else syncRoutes();
        syncSharedPois();
    };
    window.addEventListener('online', syncWhenOnline);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && navigator.onLine) syncWhenOnline();
    });
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
    renderAccountServer();
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
    initSettings();

    // 1) Arrancar GPS y recuperar borrador de inmediato (offline-first, no depende de la red)
    startGps();
    await maybeRestoreDraft();

    // 2) Sincronizaciones con la nube en segundo plano (no bloquean el inicio de la app ni el GPS)
    syncRoutes();
    syncSharedPois();
    restoreGroup();
}

init();

// Service Worker: abre la app sin conexión y guarda las teselas ya vistas
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
}
