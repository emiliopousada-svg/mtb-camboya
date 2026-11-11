'use strict';

//  CUENTA Y SINCRONIZACIÓN (servidor PocketBase propio)
// ============================================================
const Cloud = {
    get server() { return DEFAULT_CLOUD_SERVER; },
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
        if (typeof renderAccountProfile === 'function') renderAccountProfile(rec);
        if (typeof statsApplyAccountProfile === 'function') {
            statsApplyAccountProfile(rec.weightKg, rec.age);
        }
        if (typeof updateGpsAvatarMarkers === 'function') updateGpsAvatarMarkers();
    },
    clearSession() {
        ['mtb_token', 'mtb_uid', 'mtb_email', 'mtb_group_code'].forEach(k => localStorage.removeItem(k));
        accountProfileRecord = null;
        accountProfileEditing = false;
        accountAvatarFile = null;
        accountAvatarProcessing = false;
        if (accountAvatarObjectUrl) URL.revokeObjectURL(accountAvatarObjectUrl);
        accountAvatarObjectUrl = null;
        if (typeof updateGpsAvatarMarkers === 'function') updateGpsAvatarMarkers();
    }
};

const ACCOUNT_AVATAR_MAX_INPUT_BYTES = 10 * 1024 * 1024;
const ACCOUNT_AVATAR_MAX_OUTPUT_BYTES = 256 * 1024;
let accountProfileRecord = null;
let accountProfileEditing = false;
let accountAvatarFile = null;
let accountAvatarObjectUrl = null;
let accountAvatarProcessing = false;

function getAccountAvatarUrl(record = accountProfileRecord) {
    if (accountAvatarFile && accountAvatarObjectUrl) return accountAvatarObjectUrl;
    if (!record || typeof record.avatar !== 'string' || !record.avatar) return '';
    const recordId = encodeURIComponent(record.id || Cloud.uid);
    return `${Cloud.server}/api/files/users/${recordId}/${encodeURIComponent(record.avatar)}?thumb=256x256`;
}

// body: objeto (JSON), FormData (archivos) o null
async function cloudApi(path, method = 'GET', body = null) {
    const headers = {};
    if (Cloud.token) headers.Authorization = Cloud.token;
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const url = new URL(Cloud.server + path);
    if (url.protocol !== 'https:' || url.username || url.password) {
        throw new Error('El servidor debe usar una dirección HTTPS válida.');
    }
    const res = await fetch(url.href, { method, headers, body: payload });
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
    const serverLabel = $('acc-server');
    if (serverLabel) serverLabel.textContent = Cloud.server;
    const on = Cloud.loggedIn();
    $('acc-form').style.display = on ? 'none' : 'block';
    $('acc-logged').style.display = on ? 'block' : 'none';
    const last = localStorage.getItem('mtb_lastsync');
    const syncFailures = Number(localStorage.getItem('mtb_sync_failures') || 0);
    $('acc-status').textContent = on
        ? `Conectado como ${Cloud.email}` + (Cloud.groupCode ? ' · grupo asignado' : ' · sin grupo asignado') + (last ? ` · última sincronización: ${new Date(Number(last)).toLocaleString('es-ES')}` : '') + (syncFailures ? ` · sincronización parcial: ${syncFailures} elemento(s) pendiente(s)` : '')
        : 'Sin sesión: tus rutas se guardan solo en este móvil.';
}

function accountProfileNumber(value, min, max) {
    const number = Number(value);
    return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function setAccountAvatar(record) {
    const image = $('acc-avatar-image');
    const placeholder = $('acc-avatar-placeholder');
    if (!image || !placeholder) return;
    if (accountAvatarObjectUrl) {
        URL.revokeObjectURL(accountAvatarObjectUrl);
        accountAvatarObjectUrl = null;
    }

    let imageUrl = '';
    if (accountAvatarFile) {
        accountAvatarObjectUrl = URL.createObjectURL(accountAvatarFile);
    }
    imageUrl = getAccountAvatarUrl(record);

    image.hidden = !imageUrl;
    placeholder.hidden = Boolean(imageUrl);
    if (!imageUrl) {
        image.removeAttribute('src');
        if (typeof updateGpsAvatarMarkers === 'function') updateGpsAvatarMarkers();
        return;
    }
    image.onerror = () => {
        image.hidden = true;
        placeholder.hidden = false;
    };
    image.src = imageUrl;
    if (typeof updateGpsAvatarMarkers === 'function') updateGpsAvatarMarkers();
}

function renderAccountProfile(record, force = false) {
    const weightInput = $('acc-profile-weight');
    const ageInput = $('acc-profile-age');
    const editor = $('acc-profile-editor');
    if (!weightInput || !ageInput || !editor) return;
    if (record) accountProfileRecord = record;
    const profile = accountProfileRecord || {};
    const weight = accountProfileNumber(profile.weightKg, 25, 250);
    const age = accountProfileNumber(profile.age, 10, 100);
    if (force || editor.dataset.profileLoaded !== '1') {
        weightInput.value = weight ?? '';
        ageInput.value = age ?? '';
    }
    weightInput.dataset.profileLoaded = '1';
    const complete = weight !== null && age !== null;
    if (!complete) accountProfileEditing = true;
    $('acc-logged').querySelector('.account-profile').classList.toggle('is-editing', accountProfileEditing);
    $('acc-profile-summary').textContent = complete ? `${weight} kg · ${age} años` : '';
    $('acc-profile-summary').hidden = !complete;
    editor.hidden = complete && !accountProfileEditing;
    $('acc-profile-edit').hidden = !complete || accountProfileEditing;
    $('acc-profile-cancel').hidden = !complete || !accountProfileEditing;
    setAccountAvatar(profile);
}

function canvasToJpeg(canvas, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => blob
            ? resolve(blob)
            : reject(new Error('No se pudo comprimir la imagen.')), 'image/jpeg', quality);
    });
}

async function decodeAvatarImage(file) {
    if (typeof createImageBitmap === 'function') {
        return createImageBitmap(file);
    }
    const url = URL.createObjectURL(file);
    try {
        const image = new Image();
        image.src = url;
        await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = () => reject(new Error('No se pudo abrir la imagen seleccionada.'));
        });
        return {
            width: image.naturalWidth,
            height: image.naturalHeight,
            image,
            close: () => URL.revokeObjectURL(url)
        };
    } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
    }
}

async function compressAccountAvatar(file) {
    if (!(file instanceof Blob) || !file.type.startsWith('image/')) {
        throw new Error('Elige un archivo de imagen válido.');
    }
    if (file.size > ACCOUNT_AVATAR_MAX_INPUT_BYTES) {
        throw new Error('La imagen original no puede superar los 10 MB.');
    }
    const source = await decodeAvatarImage(file);
    try {
        if (!source.width || !source.height) throw new Error('La imagen no tiene dimensiones válidas.');
        const canvas = document.createElement('canvas');
        const sizes = [512, 448, 384, 320, 256];
        const qualities = [0.86, 0.78, 0.68, 0.58];
        for (const size of sizes) {
            const ratio = Math.min(1, size / Math.max(source.width, source.height));
            canvas.width = Math.max(1, Math.round(source.width * ratio));
            canvas.height = Math.max(1, Math.round(source.height * ratio));
            const context = canvas.getContext('2d');
            if (!context) throw new Error('No se pudo preparar la imagen en este dispositivo.');
            context.clearRect(0, 0, canvas.width, canvas.height);
            if (typeof source.draw === 'function') source.draw(canvas);
            else context.drawImage(source, 0, 0, canvas.width, canvas.height);
            for (const quality of qualities) {
                const blob = await canvasToJpeg(canvas, quality);
                if (blob.size <= ACCOUNT_AVATAR_MAX_OUTPUT_BYTES) {
                    return new File([blob], 'avatar.jpg', { type: 'image/jpeg', lastModified: Date.now() });
                }
            }
        }
    } finally {
        if (typeof source.close === 'function') source.close();
    }
    throw new Error('No se pudo reducir la imagen a 256 KB; prueba con otra foto.');
}

async function saveAccountProfile() {
    if (!Cloud.loggedIn()) { toast('Inicia sesión para guardar tu perfil.'); return; }
    if (accountAvatarProcessing) {
        toast('Espera a que termine de prepararse la imagen.');
        return;
    }
    const weight = accountProfileNumber($('acc-profile-weight').value, 25, 250);
    const age = accountProfileNumber($('acc-profile-age').value, 10, 100);
    if (weight === null || age === null) {
        toast('Introduce un peso entre 25 y 250 kg y una edad entre 10 y 100 años.');
        return;
    }
    const saveButton = $('acc-profile-save');
    saveButton.disabled = true;
    let profileSaved = false;
    try {
        const record = await cloudApi(`/api/collections/users/records/${encodeURIComponent(Cloud.uid)}`, 'PATCH', {
            weightKg: weight,
            age
        });
        profileSaved = true;
        accountProfileRecord = record;
        if (accountAvatarFile) {
            const form = new FormData();
            form.append('avatar', accountAvatarFile, 'avatar.jpg');
            const avatarRecord = await cloudApi(
                `/api/collections/users/records/${encodeURIComponent(Cloud.uid)}`,
                'PATCH',
                form
            );
            accountProfileRecord = avatarRecord;
            accountAvatarFile = null;
            if (accountAvatarObjectUrl) URL.revokeObjectURL(accountAvatarObjectUrl);
            accountAvatarObjectUrl = null;
        }
        accountProfileEditing = false;
        renderAccountProfile(accountProfileRecord, true);
        toast('✅ Perfil guardado en tu cuenta.');
        try {
            if (typeof statsApplyAccountProfile === 'function') {
                statsApplyAccountProfile(weight, age);
            }
        } catch (error) {
            console.warn('No se pudieron actualizar las estadísticas con el perfil guardado:', error);
            toast('Perfil guardado, pero no se pudieron actualizar las estadísticas.', 6000);
        }
    } catch (error) {
        console.warn('No se pudo guardar el perfil de la cuenta:', error);
        if (profileSaved && accountProfileRecord && accountProfileNumber(accountProfileRecord.weightKg, 25, 250) === weight
            && accountProfileNumber(accountProfileRecord.age, 10, 100) === age && accountAvatarFile) {
            renderAccountProfile(accountProfileRecord, true);
            toast(`Peso y edad guardados; no se pudo guardar el avatar: ${error.message}`, 7000);
        } else {
            toast('No se pudo guardar el perfil: ' + error.message, 6000);
        }
    } finally {
        saveButton.disabled = false;
    }
}

async function syncStatsProfileToAccount() {
    if (!Cloud.loggedIn()) return;
    const weight = accountProfileNumber($('stats-weight').value, 25, 250);
    const age = accountProfileNumber($('stats-age').value, 10, 100);
    if (weight === null || age === null) return;
    $('acc-profile-weight').value = String(weight);
    $('acc-profile-age').value = String(age);
    accountProfileEditing = true;
    renderAccountProfile(accountProfileRecord);
    await saveAccountProfile();
}

function cancelAccountProfileEdit() {
    accountAvatarFile = null;
    accountProfileEditing = false;
    $('acc-avatar-file').value = '';
    renderAccountProfile(accountProfileRecord, true);
}

async function handleAccountAvatarSelection() {
    const input = $('acc-avatar-file');
    const file = input.files[0];
    if (!file) return;
    const saveButton = $('acc-profile-save');
    saveButton.disabled = true;
    accountAvatarProcessing = true;
    let prepared = false;
    try {
        accountAvatarFile = await compressAccountAvatar(file);
        setAccountAvatar(accountProfileRecord);
        prepared = true;
        toast(`Imagen preparada (${Math.ceil(accountAvatarFile.size / 1024)} KB). Guarda el perfil para subirla.`);
    } catch (error) {
        console.warn('No se pudo preparar el avatar:', error);
        toast(`No se pudo usar la imagen: ${error.message}`, 6000);
    } finally {
        accountAvatarProcessing = false;
        saveButton.disabled = false;
        if (!prepared) input.value = '';
    }
}

async function accAuth(register) {
    const server = Cloud.server;
    const email = $('acc-email').value.trim();
    const pass = $('acc-pass').value;
    const enteredWeight = $('acc-weight').value === '' ? null : accountProfileNumber($('acc-weight').value, 25, 250);
    const enteredAge = $('acc-age').value === '' ? null : accountProfileNumber($('acc-age').value, 10, 100);
    if (!email || !pass) { toast('Rellena correo y contraseña'); return; }
    if (register && pass.length < 8) { toast('La contraseña debe tener al menos 8 caracteres'); return; }
    if ((register || $('acc-weight').value !== '') && enteredWeight === null) {
        toast('Introduce un peso entre 25 y 250 kg.');
        return;
    }
    if ((register || $('acc-age').value !== '') && enteredAge === null) {
        toast('Introduce una edad entre 10 y 100 años.');
        return;
    }
    if (register && (enteredWeight === null || enteredAge === null)) {
        toast('Introduce tu peso y edad para crear la cuenta.');
        return;
    }
    localStorage.setItem('mtb_server', server);
    Cloud.clearSession();
    try {
        if (register) {
            await cloudApi('/api/collections/users/records', 'POST', {
                email,
                password: pass,
                passwordConfirm: pass,
                weightKg: enteredWeight,
                age: enteredAge
            });
        }
        const r = await cloudApi('/api/collections/users/auth-with-password', 'POST', { identity: email, password: pass });
        Cloud.setSession(r.token, r.record);
        $('acc-pass').value = '';
        $('acc-weight').value = '';
        $('acc-age').value = '';
        renderAccountProfile(r.record, true);
        let weight = accountProfileNumber(r.record.weightKg, 25, 250) ?? enteredWeight;
        let age = accountProfileNumber(r.record.age, 10, 100) ?? enteredAge;
        if (weight !== null) $('acc-profile-weight').value = String(weight);
        if (age !== null) $('acc-profile-age').value = String(age);
        let profileComplete = weight !== null && age !== null;
        if (profileComplete && (
            accountProfileNumber(r.record.weightKg, 25, 250) === null ||
            accountProfileNumber(r.record.age, 10, 100) === null
        )) {
            try {
                const record = await cloudApi(`/api/collections/users/records/${encodeURIComponent(Cloud.uid)}`, 'PATCH', {
                    weightKg: weight,
                    age
                });
                Cloud.setSession(Cloud.token, record);
                renderAccountProfile(record, true);
            } catch (error) {
                console.warn('No se pudo guardar el perfil durante el inicio de sesión:', error);
                profileComplete = false;
            }
        }
        if (profileComplete && typeof statsApplyAccountProfile === 'function') {
            statsApplyAccountProfile(weight, age);
        }
        renderAccount();
        await restoreGroup();
        toast(profileComplete
            ? (register ? '✅ Cuenta creada' : '✅ Sesión iniciada')
            : 'Sesión iniciada. Completa peso y edad en el perfil de Cuenta y sincronización.', 6000);
        syncRoutes(true);
        syncSharedPois();
    } catch (e) {
        console.warn('Auth:', e);
        toast(e.status === undefined
            ? 'No se pudo conectar con el servidor. Revisa la dirección.'
            : 'No se pudo entrar: ' + e.message, 6000);
    }
}

async function putLocal(r) { await DB.put(r); }

async function queueRemoteDelete(remoteId) {
    try {
        const p = (await DB.kvGet('pendingDeletes')) || [];
        p.push(remoteId);
        await DB.kvSet('pendingDeletes', p);
    } catch (e) {}
}

async function routeForm(r) {
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
    const points = Array.isArray(route.points) ? route.points : [];
    const pois = await routePoisForSync(route.pois);
    const description = String(route.description || '').trim().slice(0, 500);
    const folder = String(route.folder || '').trim().slice(0, 60);
    const track = pois.length || description || folder
        ? { version: 3, points, pois, description, folder }
        : points;
    fd.append('track', new Blob([JSON.stringify(track)], { type: 'application/json' }), 'track.json');
    return fd;
}

let syncing = false;
let manualSyncRequested = false;
async function syncRoutes(manual = false) {
    if (!Cloud.loggedIn()) {
        if (manual) toast('Inicia sesión para sincronizar tus rutas.');
        return;
    }
    if (syncing) {
        if (manual) {
            manualSyncRequested = true;
            toast('La sincronización en curso terminará y después se volverá a intentar.', 5000);
        }
        return;
    }
    if (!navigator.onLine) { if (manual) toast('Sin conexión: se sincronizará cuando vuelva internet'); return; }
    syncing = true;
    $('acc-status').textContent = 'Sincronizando…';
    let pushed = 0, pulled = 0, syncFailures = 0;
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
            catch (e) {
                if (e.status !== 404) {
                    rest.push(rid);
                    syncFailures++;
                    console.warn(`No se pudo borrar la ruta remota ${rid}:`, e);
                }
            }
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
                if (r.remoteId) rec = await cloudApi(`/api/collections/routes/records/${r.remoteId}`, 'PATCH', await routeForm(r));
                else rec = await cloudApi('/api/collections/routes/records', 'POST', await routeForm(r));
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
                try {
                    const res = await fetch(`${Cloud.server}/api/files/routes/${rec.id}/${encodeURIComponent(rec.track)}?token=${encodeURIComponent(ft)}`);
                    if (!res.ok) throw new Error(`El servidor respondió ${res.status}`);
                    const track = await res.json();
                    const points = Array.isArray(track) ? track : track && track.points;
                    if (!Array.isArray(points) || points.length < 2 ||
                        !points.every(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))) {
                        throw new Error('El track recibido no tiene un formato válido');
                    }
                    const id = Number(rec.clientId);
                    if (!Number.isSafeInteger(id) || id < 0) throw new Error('El identificador de ruta no es válido');
                    const r = {
                        id, remoteId: rec.id, dirty: false,
                        kind: rec.kind || 'recorded', name: rec.name, startedAt: rec.startedAt,
                        activityType: Object.prototype.hasOwnProperty.call(ACTIVITY_TYPES, rec.activityType)
                            ? rec.activityType
                            : activityTypeFromName(rec.name),
                        movingTimeSec: rec.movingTimeSec || 0, distanceKm: rec.distanceKm || 0,
                        elevationGain: rec.elevationGain || 0, hrAvg: rec.hrAvg || null,
                        points, pois: routePoisFromSync(track && track.pois),
                        description: String(track && track.description || '').slice(0, 500),
                        folder: String(track && track.folder || '').slice(0, 60)
                    };
                    await putLocal(r);
                    savedRoutes.push(r);
                    pulled++;
                } catch (e) {
                    syncFailures++;
                    console.warn(`No se pudo descargar la ruta remota ${rec.id}:`, e);
                }
            }
            savedRoutes.sort((a, b) => b.id - a.id);
        }

        localStorage.setItem('mtb_lastsync', String(Date.now()));
        localStorage.setItem('mtb_sync_failures', String(syncFailures));
        renderSavedRoutes();
        refreshStats();
        if (manual) toast(syncFailures
            ? `⚠️ Sincronización parcial: ${pushed} subidas, ${pulled} descargadas y ${syncFailures} pendiente(s).`
            : `✅ Sincronizado: ${pushed} subidas, ${pulled} descargadas`);
    } catch (e) {
        console.warn('Sync:', e);
        if (manual || e.status !== undefined) {
            toast(e.status === undefined
                ? `No se pudo conectar con el servidor: ${e.message || 'error de red'}`
                : 'Error al sincronizar: ' + e.message, 6000);
        }
    } finally {
        syncing = false;
        renderAccount();
        if (manualSyncRequested) {
            manualSyncRequested = false;
            if (Cloud.loggedIn()) setTimeout(() => syncRoutes(true), 0);
        }
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
    const versionLabel = $('app-version');
    const [major, minor, patch] = APP_VERSION.split('.').map(Number);
    versionLabel.textContent = `v${APP_VERSION} (${major * 1000000 + minor * 1000 + patch})`;
    const capacitor = window.Capacitor;
    if (capacitor && capacitor.isNativePlatform && capacitor.isNativePlatform()
        && window.MTBNativeApp && typeof window.MTBNativeApp.getAppInfo === 'function') {
        window.MTBNativeApp.getAppInfo().then(info => {
            if (!info || !info.version || !/^\d+$/.test(info.build)) {
                console.warn('La información de versión instalada no es válida:', info);
                return;
            }
            versionLabel.textContent = `v${info.version} (${info.build})`;
        }).catch(error => {
            console.warn('No se pudo leer el código de versión instalado:', error);
        });
    }
}

function initAccount() {
    const savedServer = localStorage.getItem('mtb_server');
    let serverChanged = false;
    if (savedServer) {
        try {
            serverChanged = normalizeServer(savedServer) !== DEFAULT_CLOUD_SERVER;
        } catch (error) {
            console.warn('La dirección de servidor guardada no es válida:', error);
            serverChanged = true;
        }
    }
    localStorage.setItem('mtb_server', DEFAULT_CLOUD_SERVER);
    if (serverChanged) {
        Cloud.clearSession();
        toast('El servidor de sincronización se ha fijado en vamp69.ddns.net. Inicia sesión de nuevo.', 6000);
    }

    $('acc-login').addEventListener('click', () => accAuth(false));
    $('acc-register').addEventListener('click', () => accAuth(true));
    $('acc-profile-save').addEventListener('click', saveAccountProfile);
    $('acc-profile-edit').addEventListener('click', () => {
        accountProfileEditing = true;
        renderAccountProfile(accountProfileRecord);
    });
    $('acc-profile-cancel').addEventListener('click', cancelAccountProfileEdit);
    $('acc-avatar-file').addEventListener('change', handleAccountAvatarSelection);
    $('acc-sync').addEventListener('click', () => syncRoutes(true));
    $('acc-logout').addEventListener('click', async event => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
            await stopGroup();
            Cloud.clearSession();
            renderFriends();
            renderAccount();
            toast('Sesión cerrada. Tus rutas siguen en este móvil.');
        } catch (error) {
            console.warn('No se pudo cerrar completamente la sesión:', error);
            Cloud.clearSession();
            renderAccount();
            toast('Sesión cerrada en este dispositivo; no se pudo actualizar el estado del grupo.', 6000);
        } finally {
            button.disabled = false;
        }
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
