'use strict';

//  CONTROL DE GRABACIÓN
// ============================================================
let wakeLock = null;
let recordingPois = [];
let routePhotoCapturePosition = null;
let routePhotoProcessing = null;

function clearRoutePolylines() {
    routePolylines.forEach(polyline => { if (map) map.removeLayer(polyline); });
    routePolylines = [];
    routePolyline = null;
    routePolylinePointCount = 0;
}

function renderRecordingSegments(routeSegments) {
    clearRoutePolylines();
    if (!map) return;
    routeSegments.forEach(segment => {
        if (!segment.length) return;
        let start = 0;
        while (start < segment.length) {
            const end = Math.min(start + MAX_ROUTE_RENDER_POINTS, segment.length);
            const polyline = L.polyline(segment.slice(start, end), { color: '#ff9800', weight: 5 }).addTo(map);
            routePolylines.push(polyline);
            routePolyline = polyline;
            routePolylinePointCount = end - start;
            if (end === segment.length) break;
            start = end - 1;
        }
    });
}

async function acquireWake() {
    if (typeof screenEnsureAwake === 'function') {
        await screenEnsureAwake();
        return;
    }
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => { wakeLock = null; });
        }
    } catch (e) {}
}
function releaseWake() {
    if (typeof screenEnsureAwake === 'function') return;
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

// ---- GPS en segundo plano (solo dentro del APK) ----
let bgWatcherId = null, bgToken = 0, bgDeniedShown = false;

function bgPlugin() {
    const cap = window.Capacitor;
    if (!(cap && cap.isNativePlatform && cap.isNativePlatform())) return null;
    return (cap.Plugins && cap.Plugins.BackgroundGeolocation) || null;
}

async function ensureNotifPermission() { // Android 13+: para mostrar el aviso "Grabando tu ruta"
    try {
        const cap = window.Capacitor;
        const ln = cap && cap.Plugins && cap.Plugins.LocalNotifications;
        if (!ln) return;
        const st = await ln.checkPermissions();
        if (st.display !== 'granted') await ln.requestPermissions();
    } catch (e) { console.warn('Permiso de notificaciones:', e); }
}

function setMapBattery(battery) {
    const box = $('map-battery');
    if (!battery || !Number.isFinite(battery.level)) { box.hidden = true; return; }
    const pct = Math.max(0, Math.min(100, Math.round(battery.level * 100)));
    box.hidden = false;
    box.classList.toggle('charging', !!battery.charging);
    box.classList.toggle('low', pct <= 20 && !battery.charging);
    box.classList.toggle('mid', pct > 20 && pct <= 40 && !battery.charging);
    $('map-battery-text').textContent = `${pct}%`;
    document.querySelector('#map-battery-icon i').style.width = `${Math.max(8, pct)}%`;
}

let idleBattery = null;
async function pollMapBattery() {
    if (rideBattery || nativeBatteryInfo) { setMapBattery(rideBattery || nativeBatteryInfo); }
    try {
        const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.BatteryInfo;
        if (plugin) { setMapBattery(await plugin.getInfo()); return; }
        if (typeof navigator.getBattery === 'function') {
            if (!idleBattery) {
                idleBattery = await navigator.getBattery();
                idleBattery.addEventListener('levelchange', () => setMapBattery(idleBattery));
                idleBattery.addEventListener('chargingchange', () => setMapBattery(idleBattery));
            }
            setMapBattery(idleBattery);
        }
    } catch (e) { console.warn('Batería no disponible:', e); }
}
pollMapBattery();
setInterval(pollMapBattery, 300000);

function updateBatteryStatus() {
    const label = $('ride-battery');
    const battery = rideBattery || nativeBatteryInfo;
    setMapBattery(battery);
    if (!battery || !Number.isFinite(battery.level)) {
        label.textContent = '🔋 No disponible';
        return;
    }
    const percentage = Math.round(battery.level * 100);
    label.textContent = `${battery.charging ? '🔌' : '🔋'} ${percentage}%`;
    if (battery.charging) return;

    if (percentage <= 10 && !batteryWarnings.has(10)) {
        batteryWarnings.add(20);
        batteryWarnings.add(10);
        notifyBatteryWarning('Batería crítica: queda un 10% o menos.');
    } else if (percentage <= 20 && !batteryWarnings.has(20)) {
        batteryWarnings.add(20);
        notifyBatteryWarning('Batería baja: queda un 20% o menos.');
    }
}

async function refreshBatteryStatus() {
    if (!isRecording || isPaused) return;
    if (rideBattery) { updateBatteryStatus(); return; }
    const cap = window.Capacitor;
    const plugin = cap && cap.Plugins && cap.Plugins.BatteryInfo;
    if (!plugin || Date.now() - batteryPollAt < 55000) {
        updateBatteryStatus();
        return;
    }
    batteryPollAt = Date.now();
    try {
        nativeBatteryInfo = await plugin.getInfo();
        if (isRecording && !isPaused) updateBatteryStatus();
    } catch (error) {
        console.warn('No se pudo consultar la batería del dispositivo:', error);
        $('ride-battery').textContent = '🔋 No disponible';
    }
}

function notifyBatteryWarning(message) {
    toast(`⚠️ ${message}`, 7000);
    if (document.visibilityState !== 'hidden') return;
    const cap = window.Capacitor;
    const ln = cap && cap.Plugins && cap.Plugins.LocalNotifications;
    if (!ln) return;
    ln.checkPermissions().then(permission => {
        if (permission.display !== 'granted') return;
        return ln.schedule({
            notifications: [{
                id: (Date.now() % 2147483647) + 1,
                title: 'MTB CAMBOYA · Batería',
                body: message,
                schedule: { at: new Date(Date.now() + 1000) }
            }]
        });
    }).catch(error => console.warn('No se pudo mostrar el aviso de batería:', error));
}

function startRideAdvisories() {
    const token = ++rideAdvisoryToken;
    batteryPollAt = 0;
    $('ride-status').classList.add('show');
    if (!rideBattery) $('ride-battery').textContent = '🔋 --';
    refreshBatteryStatus();
    const getBattery = navigator.getBattery;
    if (typeof getBattery !== 'function') {
        updateBatteryStatus();
    } else {
        getBattery.call(navigator).then(battery => {
            if (token !== rideAdvisoryToken || !isRecording || isPaused) return;
            if (rideBattery) {
                rideBattery.removeEventListener('levelchange', updateBatteryStatus);
                rideBattery.removeEventListener('chargingchange', updateBatteryStatus);
            }
            rideBattery = battery;
            nativeBatteryInfo = null;
            rideBattery.addEventListener('levelchange', updateBatteryStatus);
            rideBattery.addEventListener('chargingchange', updateBatteryStatus);
            updateBatteryStatus();
        }).catch(error => {
            console.warn('No se pudo consultar la batería del dispositivo:', error);
            $('ride-battery').textContent = '🔋 No disponible';
        });
    }
    batteryCheckInterval = setInterval(refreshBatteryStatus, 60000);
}

function stopRideAdvisories() {
    rideAdvisoryToken++;
    clearInterval(batteryCheckInterval);
    batteryCheckInterval = null;
    if (rideBattery) {
        rideBattery.removeEventListener('levelchange', updateBatteryStatus);
        rideBattery.removeEventListener('chargingchange', updateBatteryStatus);
        rideBattery = null;
    }
    nativeBatteryInfo = null;
    $('ride-status').classList.remove('show');
}

async function onBgDenied(bg) {
    if (bgDeniedShown) return;
    bgDeniedShown = true;
    const ok = await modal({
        message: 'Para grabar con la pantalla bloqueada la app necesita el permiso de ubicación. ¿Abrir los ajustes?',
        ok: 'Abrir ajustes', cancel: 'Ahora no'
    });
    if (ok) bg.openSettings();
    bgDeniedShown = false;
}

async function startBgWatcher() {
    const bg = bgPlugin();
    if (!bg || bgActive) return false;
    const my = ++bgToken;
    try {
        await ensureNotifPermission();
        const id = await bg.addWatcher({
            backgroundTitle: 'MTB CAMBOYA',
            backgroundMessage: 'Grabando tu ruta…',
            requestPermissions: true,
            stale: false,
            distanceFilter: MIN_STEP_M
        }, (loc, err) => {
            if (my !== bgToken) return;
            if (err) {
                console.warn('GPS en segundo plano:', err);
                if (err.code === 'NOT_AUTHORIZED') onBgDenied(bg);
                return;
            }
            if (!loc) return;
            onPos({
                coords: {
                    latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy,
                    altitude: loc.altitude, speed: loc.speed, heading: loc.heading ?? loc.bearing
                },
                timestamp: loc.time
            });
        });
        if (my !== bgToken) { // se pausó o terminó mientras se activaba
            try { await bg.removeWatcher({ id }); } catch (e) {}
            return false;
        }
        bgWatcherId = id;
        bgActive = true; // solo ahora el plugin ha confirmado el watcher
        clearGpsWatch();
        return true;
    } catch (e) {
        console.warn('No se pudo iniciar el GPS en segundo plano:', e);
        if (my === bgToken) bgWatcherId = null;
        return false;
    }
}

function stopBgWatcher() {
    const bg = bgPlugin();
    const id = bgWatcherId;
    bgToken++;
    bgActive = false;
    bgWatcherId = null;
    if (bg && id != null) bg.removeWatcher({ id }).catch(() => {});
    if (document.visibilityState === 'visible') startGps();
}

// Empieza a recibir posiciones: en segundo plano si se puede; si no, pantalla encendida
async function beginTracking(showToast) {
    acquireWake();
    const ok = await startBgWatcher();
    if (ok) {
        if (showToast) toast('Grabando en segundo plano: puedes bloquear la pantalla.', 5000);
        return;
    }
    if (showToast) {
        toast('wakeLock' in navigator
            ? 'Grabando. Mantén la app abierta en primer plano.'
            : 'Grabando. Tu navegador no mantiene la pantalla encendida: no la bloquees o se perderá el track.', 5000);
    }
}

function elapsedSec() {
    return Math.floor((movingMs + (segStart ? Date.now() - segStart : 0)) / 1000);
}
function totalSec() {
    const start = Date.parse(startedAt);
    return Number.isFinite(start) ? Math.max(0, Math.floor((Date.now() - start) / 1000)) : 0;
}
function updateTimerDisplay() {
    $('m-moving').textContent = fmtClock(elapsedSec());
    $('m-time').textContent = fmtClock(totalSec());
}
function startTimers() {
    clearInterval(timerInterval);
    clearInterval(draftInterval);
    updateTimerDisplay();
    timerInterval = setInterval(updateTimerDisplay, 1000);
    draftInterval = setInterval(saveDraft, 30000);
}
// En pausa el tiempo total sigue corriendo; solo se detiene el borrador.
function pauseTimers() {
    clearInterval(draftInterval);
    draftInterval = null;
    updateTimerDisplay();
}
function stopTimers() {
    clearInterval(timerInterval);
    clearInterval(draftInterval);
    timerInterval = draftInterval = null;
}

function setBtnState(s) {
    btnStart.classList.toggle('recording', s !== 'idle');
    lblStart.textContent = { idle: 'COMENZAR RUTA', recording: 'PAUSAR', paused: 'REANUDAR', 'auto-paused': 'PAUSA AUTOMÁTICA' }[s];
    icoStart.textContent = s === 'recording' ? '⏸️' : '▶️';
    btnStop.style.display = s === 'idle' ? 'none' : 'flex';
    $('btn-route-photo').hidden = s === 'idle';
}

function autoPauseMovementThreshold(accuracy) {
    return Math.max(12, Math.min(30, accuracy * 1.5));
}

function autoResumeMovementThreshold(accuracy) {
    return Math.max(20, Math.min(35, accuracy * 1.5));
}

function updateAutoPauseMovement(position, accuracy) {
    const now = Date.now();
    if (!autoPauseAnchor) {
        autoPauseAnchor = position;
        autoPauseLastMovementAt = now;
    } else if (dist(autoPauseAnchor, position) >= autoPauseMovementThreshold(accuracy)) {
        autoPauseAnchor = position;
        autoPauseLastMovementAt = now;
    }
    autoPauseLastPosition = position;
}

function updateAutoPauseResume(position, accuracy) {
    const now = Date.now();
    const fromPauseAnchor = autoPauseAnchor ? dist(autoPauseAnchor, position) : 0;
    if (!autoPauseResumeCandidate) {
        if (fromPauseAnchor >= autoResumeMovementThreshold(accuracy)) {
            autoPauseResumeCandidate = { distance: fromPauseAnchor, startedAt: now };
        }
        return;
    }

    const confirmedTravel = Math.max(6, Math.min(10, accuracy * 0.4));
    const confirmed = now - autoPauseResumeCandidate.startedAt >= AUTO_RESUME_CONFIRM_MS &&
        fromPauseAnchor >= autoResumeMovementThreshold(accuracy) &&
        fromPauseAnchor >= autoPauseResumeCandidate.distance + confirmedTravel;
    if (confirmed) {
        resumeRecording(true, position);
    } else if (now - autoPauseResumeCandidate.startedAt >= AUTO_RESUME_CONFIRM_MS * 6) {
        autoPauseResumeCandidate = null;
    }
}

function startAutoPauseMonitor() {
    clearInterval(autoPauseInterval);
    autoPauseInterval = setInterval(() => {
        if (isRecording && !isPaused && autoPauseLastMovementAt !== null
            && Date.now() - autoPauseLastMovementAt >= AUTO_PAUSE_AFTER_MS) {
            pauseRecording(true);
        }
    }, 1000);
}

function stopAutoPauseMonitor() {
    clearInterval(autoPauseInterval);
    autoPauseInterval = null;
}

function resetAutoPauseState() {
    stopAutoPauseMonitor();
    autoPaused = false;
    autoPauseAnchor = null;
    autoPauseLastPosition = null;
    autoPauseLastMovementAt = null;
    autoPauseResumeCandidate = null;
}

function resetRecordingState() {
    resetAutoPauseState();
    points = [];
    segments = [];
    totalDistance = 0;
    elev = makeElevTracker();
    lastAccepted = null;
    resumeBreak = false;
    movingMs = 0;
    segStart = null;
    startedAt = null;
    recordingPois = [];
    showRoutePoisOnMap(followedRoute ? followedRoute.pois : []);
}

function addRoutePhoto() {
    if (!isRecording) { toast('Empieza una ruta antes de añadir una foto.'); return; }
    if (recordingPois.length >= ROUTE_POI_MAX_PHOTOS) {
        toast(`Cada ruta puede tener hasta ${ROUTE_POI_MAX_PHOTOS} fotos.`);
        return;
    }
    if (lastLat === null || lastLon === null || !Number.isFinite(lastAccuracy) || lastAccuracy > MAX_ACC_M) {
        toast('Espera a tener una posición GPS precisa antes de añadir la foto.');
        return;
    }
    routePhotoCapturePosition = { lat: lastLat, lng: lastLon };
    const input = $('route-photo-input');
    input.value = '';
    input.click();
}

$('btn-route-photo').addEventListener('click', addRoutePhoto);
$('route-photo-input').addEventListener('change', async event => {
    const file = event.target.files && event.target.files[0];
    const position = routePhotoCapturePosition;
    routePhotoCapturePosition = null;
    if (!file || !position) return;
    if (!isRecording) { toast('La ruta ya no está grabándose; no se añadió la foto.'); return; }
    const processing = prepareRoutePoiPhoto(file);
    routePhotoProcessing = processing;
    try {
        const photo = await processing;
        if (!isRecording) { toast('La ruta ya no está grabándose; no se añadió la foto.'); return; }
        if (recordingPois.length >= ROUTE_POI_MAX_PHOTOS) {
            toast(`Cada ruta puede tener hasta ${ROUTE_POI_MAX_PHOTOS} fotos.`);
            return;
        }
        const capturedAt = new Date();
        let savedCopyPath = '';
        let copyFailed = false;
        try {
            savedCopyPath = await saveRoutePhotoToPhone(file, startedAt, capturedAt) || '';
        } catch (error) {
            console.warn('No se pudo guardar una copia de la foto en Documentos:', error);
            copyFailed = true;
        }
        recordingPois.push({
            lat: position.lat,
            lng: position.lng,
            caption: 'Foto de ruta',
            photo,
            createdAt: capturedAt.toISOString(),
            savedCopyPath
        });
        showRoutePoisOnMap([...(followedRoute ? followedRoute.pois : []), ...recordingPois]);
        saveDraft();
        toast(savedCopyPath
            ? 'Foto añadida y guardada en Documentos/MTB CAMBOYA/Rutas.'
            : copyFailed
                ? 'Foto añadida a la ruta, pero no se pudo copiar a Documentos.'
                : 'Foto añadida como punto de interés de la ruta.');
    } catch (error) {
        console.warn('No se pudo añadir la foto a la ruta:', error);
        toast(`No se pudo añadir la foto: ${error.message || 'error al procesarla'}`);
    } finally {
        if (routePhotoProcessing === processing) routePhotoProcessing = null;
        event.target.value = '';
    }
});

function startRecording(activityType) {
    unlockOffRouteSound();
    resetRecordingState();
    batteryWarnings.clear();
    batteryPollAt = 0;
    $('ride-battery').textContent = '🔋 --';
    recordingActivityType = Object.prototype.hasOwnProperty.call(ACTIVITY_TYPES, activityType) ? activityType : 'mtb';
    isRecording = true;
    isPaused = false;
    refreshGpsMode();
    startedAt = new Date().toISOString();
    segStart = Date.now();
    $('m-dist').textContent = '0.00';
    $('m-elevation').textContent = '0';
    clearRoutePolylines();
    setBtnState('recording');
    startTimers();
    startAutoPauseMonitor();
    startRideAdvisories();
    following = true;
    updateCenterBtn();
    publishMyLocation(true);
    beginTracking(true);
}

function pauseRecording(automatic = false) {
    const pauseAt = automatic && autoPauseLastMovementAt !== null
        ? autoPauseLastMovementAt
        : Date.now();
    movingMs += pauseAt - segStart;
    segStart = null;
    isPaused = true;
    autoPaused = automatic;
    refreshGpsMode();
    stopAutoPauseMonitor();
    pauseTimers();
    stopRideAdvisories();
    releaseWake();
    if (!automatic) {
        stopBgWatcher();
    } else if (autoPauseLastPosition) {
        autoPauseAnchor = autoPauseLastPosition;
        autoPauseResumeCandidate = null;
    }
    removeMyLiveLocation();
    setBtnState(automatic ? 'auto-paused' : 'paused');
    $('m-speed').textContent = '0.0';
    saveDraft();
    if (automatic) toast(`Pausa automática: sin movimiento durante ${AUTO_PAUSE_AFTER_MS / 1000} segundos.`);
}

function resumeRecording(automatic = false, position = null) {
    unlockOffRouteSound();
    isPaused = false;
    autoPaused = false;
    refreshGpsMode();
    segStart = Date.now();
    resumeBreak = !automatic; // la pausa automática mantiene el track unido; la manual inicia otro tramo
    autoPauseAnchor = position;
    autoPauseLastPosition = position;
    autoPauseLastMovementAt = position ? Date.now() : null;
    autoPauseResumeCandidate = null;
    setBtnState('recording');
    startTimers();
    startAutoPauseMonitor();
    startRideAdvisories();
    publishMyLocation(true);
    beginTracking(false);
    if (automatic) toast('Grabación reanudada automáticamente.');
}

btnStart.addEventListener('click', async () => {
    if (!isRecording) {
        const activityType = await openActivityPicker();
        if (activityType) startRecording(activityType);
    }
    else if (!isPaused) pauseRecording();
    else resumeRecording();
});

btnStop.addEventListener('click', async () => {
    const ok = await modal({ message: '¿Finalizar y guardar esta ruta?', ok: 'Guardar', cancel: 'Seguir grabando' });
    if (ok) await finishRecording();
});

async function finishRecording() {
    const hasRoute = points.length > 1 && totalDistance >= 0.05;
    let routeName = null;
    if (hasRoute) {
        routeName = await promptRequiredRouteName(fmtDate(startedAt));
        if (routeName === null) {
            toast('La ruta no se ha guardado; puedes finalizarla cuando quieras.');
            return;
        }
        if (routePhotoProcessing) await routePhotoProcessing;
    }
    if (segStart) { movingMs += Date.now() - segStart; segStart = null; }
    const sec = Math.round(movingMs / 1000);
    if (hasRoute) {
        isPaused = true;
        resetAutoPauseState();
        stopTimers();
        stopRideAdvisories();
        releaseWake();
        stopBgWatcher();
        removeMyLiveLocation();
        setBtnState('paused');
        $('m-speed').textContent = '0.0';
    }
    if (hasRoute) {
        const hrs = points.map(p => p[4]).filter(h => Number.isFinite(h) && h > 0);
        const route = {
            id: Date.now(),
            kind: 'recorded',
            activityType: recordingActivityType,
            name: `${routeActivityPrefix(recordingActivityType)}${routeName}`,
            createdBy: (typeof getRouteNickname === 'function' && getRouteNickname()) || 'Usuario local',
            startedAt,
            movingTimeSec: sec,
            distanceKm: +totalDistance.toFixed(3),
            elevationGain: Math.round(elev.gain),
            hrAvg: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
            followedImportedRoute: followedRoute && followedRoute.kind === 'imported' ? followedRoute.name : null,
            pois: recordingPois.slice(),
            points
        };
        if (!await saveRoute(route)) {
            saveDraft();
            toast('La ruta sigue en pausa. Libera espacio y vuelve a intentar guardarla; también puedes exportarla como GPX.');
            return;
        }
        toast(`✅ Ruta guardada: ${route.distanceKm.toFixed(2)} km · ${fmtDur(sec)} · +${route.elevationGain} m`, 5000);
    } else {
        toast('La ruta es muy corta y no se ha guardado.');
    }
    isRecording = false;
    isPaused = false;
    refreshGpsMode();
    resetAutoPauseState();
    stopTimers();
    stopRideAdvisories();
    releaseWake();
    stopBgWatcher();
    removeMyLiveLocation();
    setBtnState('idle');
    $('m-speed').textContent = '0.0';
    DB.kvDel('draft').catch(() => {});
}

async function saveRoute(r) {
    if (!routeNameWithoutActivity(r).trim()) {
        toast('Escribe un nombre antes de guardar la ruta.');
        return false;
    }
    try {
        await DB.put(r);
    } catch (e) {
        console.warn('Error guardando:', e);
        toast('⚠️ No se pudo guardar la ruta en el dispositivo (¿almacenamiento lleno?). Se intentará exportar como GPX.', 7000);
        try {
            const safe = String(r.name || 'ruta').replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]+/g, '_').trim() || 'ruta';
            await download(`${safe}.gpx`, routeToGpx(r), 'application/gpx+xml');
        } catch (exportError) {
            console.warn('No se pudo exportar la ruta como GPX:', exportError);
            toast('No se pudo exportar la ruta. Sigue en pausa mientras la app permanezca abierta.', 7000);
        }
        return false;
    }
    savedRoutes.unshift(r);
    renderSavedRoutes();
    refreshStats();
    syncRoutes();
    return true;
}

// --- Borrador: recuperar una ruta si la app se cierra durante la grabación ---
function saveDraft() {
    if (!isRecording) return;
    DB.kvSet('draft', {
        startedAt,
        activityType: recordingActivityType,
        movingMs: movingMs + (segStart ? Date.now() - segStart : 0),
        totalDistance,
        points,
        pois: recordingPois,
        savedAt: Date.now()
    }).catch(() => {});
}

function buildSegments(pts) {
    const segs = [];
    pts.forEach((p, i) => {
        if (i === 0 || p[5] === 1) segs.push([]);
        segs[segs.length - 1].push([p[0], p[1]]);
    });
    return segs;
}

function restoreDraft(d) {
    resetRecordingState();
    points = d.points;
    recordingPois = Array.isArray(d.pois) ? d.pois.filter(routePoiCoordinatesValid) : [];
    showRoutePoisOnMap([...(followedRoute ? followedRoute.pois : []), ...recordingPois]);
    startedAt = d.startedAt || new Date().toISOString();
    recordingActivityType = Object.prototype.hasOwnProperty.call(ACTIVITY_TYPES, d.activityType)
        ? d.activityType
        : activityTypeFromName(d.name) || 'mtb';
    movingMs = d.movingMs || 0;
    totalDistance = d.totalDistance || 0;
    points.forEach((p, index) => {
        if (index > 0 && p[5] === 1) elev.reset();
        elev.add(p[2]);
    });
    segments = buildSegments(points);
    isRecording = true;
    isPaused = true;
    resumeBreak = true;
    setBtnState('paused');
    $('m-dist').textContent = totalDistance.toFixed(2);
    $('m-elevation').textContent = Math.round(elev.gain);
    $('m-moving').textContent = fmtClock(Math.floor(movingMs / 1000));
    $('m-time').textContent = fmtClock(totalSec());
    if (map) {
        renderRecordingSegments(segments);
        const b = L.latLngBounds([]);
        routePolylines.forEach(polyline => b.extend(polyline.getBounds()));
        if (b.isValid()) map.fitBounds(b, { padding: [30, 30] });
        following = false;
        updateCenterBtn();
    }
    toast('Ruta recuperada y en pausa. Pulsa REANUDAR para continuar.', 6000);
}

async function maybeRestoreDraft() {
    let d = null;
    try { d = await DB.kvGet('draft'); } catch (e) {}
    if (!d) return;
    const recoverable = d && Array.isArray(d.points) && d.points.length > 0
        && d.points.every(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (recoverable) {
        const saved = d.savedAt ? ` · guardada ${new Date(d.savedAt).toLocaleString('es-ES')}` : '';
        const ok = await modal({
            message: `Hay una grabación interrumpida (${(d.totalDistance || 0).toFixed(2)} km${saved}). ¿Quieres recuperarla?`,
            ok: 'Recuperar', cancel: 'Descartar'
        });
        if (ok) { restoreDraft(d); return; }
    }
    DB.kvDel('draft').catch(() => {});
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        if (isRecording) saveDraft();
    } else if (isRecording && !isPaused) {
        updateTimerDisplay();
        acquireWake(); // el wake lock se pierde al ocultar la página
    }
});
window.addEventListener('pagehide', () => { if (isRecording) saveDraft(); });

// ============================================================
