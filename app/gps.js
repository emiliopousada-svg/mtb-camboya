'use strict';

//  GPS
// ============================================================
const GPS_OPTIONS = { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 };
const GPS_RECENTER_ACCURACY_M = 100;
let gpsWatchId = null, gpsRetryTimer = null, gpsRetryDelay = 2000;
let gpsPermissionDenied = false, gpsPermissionNoticeShown = false;
let gpsOneShotPending = false, gpsResumeCheckPending = false;
let gpsRecenterPending = true;

function clearGpsWatch() {
    if (gpsWatchId === null || !navigator.geolocation) return;
    try { navigator.geolocation.clearWatch(gpsWatchId); } catch (e) {}
    gpsWatchId = null;
}

function scheduleGpsRetry() {
    if (gpsRetryTimer || gpsPermissionDenied) return;
    const delay = gpsRetryDelay;
    gpsRetryDelay = Math.min(15000, Math.round(gpsRetryDelay * 1.7));
    gpsRetryTimer = setTimeout(() => {
        gpsRetryTimer = null;
        startGps(true);
    }, delay);
}

function handleGpsError(error) {
    console.warn('GPS error:', error);
    if (error.code === 1) {
        gpsPermissionDenied = true;
        if (!gpsPermissionNoticeShown) {
            gpsPermissionNoticeShown = true;
            toast('Permiso de ubicación denegado: actívalo en los ajustes y pulsa centrar para reintentar.', 7000);
        }
        return;
    }
    // POSITION_UNAVAILABLE y TIMEOUT: sustituir la vigilancia para que Android vuelva a solicitar una posición.
    scheduleGpsRetry();
}

function requestCurrentGpsFix() {
    if (!navigator.geolocation || gpsOneShotPending) return;
    gpsOneShotPending = true;
    navigator.geolocation.getCurrentPosition(pos => {
        gpsOneShotPending = false;
        gpsRetryDelay = 2000;
        if (!bgActive) onPos(pos);
    }, error => {
        gpsOneShotPending = false;
        handleGpsError(error);
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 });
}

function startGps(force = false) {
    if (!navigator.geolocation) { toast('Este dispositivo no tiene geolocalización'); return; }
    if (gpsPermissionDenied && !force) return;
    if (force) gpsPermissionDenied = false;
    clearTimeout(gpsRetryTimer);
    gpsRetryTimer = null;
    clearGpsWatch();
    gpsWatchId = navigator.geolocation.watchPosition(pos => {
        gpsRetryDelay = 2000;
        gpsPermissionDenied = false;
        if (!bgActive) onPos(pos);
    }, handleGpsError, GPS_OPTIONS);
    if (force || !firstFix || gpsRecenterPending) requestCurrentGpsFix();
}

async function resumeGpsAfterForeground() {
    if (document.visibilityState === 'hidden' || gpsResumeCheckPending) return;
    gpsResumeCheckPending = true;
    gpsRecenterPending = true;
    try {
        if (navigator.permissions && navigator.permissions.query) {
            const permission = await navigator.permissions.query({ name: 'geolocation' });
            if (permission.state === 'denied') {
                gpsPermissionDenied = true;
                return;
            }
        } else if (gpsPermissionDenied) {
            return;
        }
        gpsPermissionDenied = false;
        gpsPermissionNoticeShown = false;
        startGps(true);
    } catch (error) {
        if (!gpsPermissionDenied) startGps(true);
    } finally {
        gpsResumeCheckPending = false;
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') gpsRecenterPending = true;
    else resumeGpsAfterForeground();
});
window.addEventListener('focus', resumeGpsAfterForeground);

function bearingBetween(from, to) {
    const rad = Math.PI / 180;
    const lat1 = from[0] * rad, lat2 = to[0] * rad;
    const dLon = (to[1] - from[1]) * rad;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function routeHeadingFromFollowedRoute(routeIndex) {
    if (!followedRoute || followedRoute.pts.length < 2 || !Number.isInteger(routeIndex)) return null;
    const prevIndex = Math.max(0, routeIndex);
    const nextIndex = Math.min(followedRoute.pts.length - 1, routeIndex + 1);
    if (prevIndex === nextIndex) return null;
    return bearingBetween(followedRoute.pts[prevIndex], followedRoute.pts[nextIndex]);
}

function applyMapHeading(heading) {
    if (mapRotationEnabled && map && following && typeof map.setHeading === 'function') {
        map.setHeading(heading, { ease: 0.2, deadzone: 1 });
    }
}

function onPos(pos) {
    const { latitude: lat, longitude: lon, accuracy, altitude, speed } = pos.coords;
    const ll = [lat, lon];
    lastLat = lat;
    lastLon = lon;
    lastAccuracy = accuracy;
    if (isRecording && !isPaused) {
        refreshBatteryStatus();
    }
    const followedMatch = followedRoute ? findFollowedRouteMatch(lat, lon) : null;
    if (followedMatch) updateMapRouteProfilePosition(followedMatch);
    if (guide.active) guideOnPos(lat, lon);

    // El GPS nativo puede no incluir rumbo: en ese caso lo calculamos
    // con el desplazamiento entre posiciones fiables mientras avanzamos.
    const hasSpeed = speed != null && Number.isFinite(speed);
    const movingSpeed = hasSpeed ? speed : 0;
    const gpsHeading = pos.coords.heading;
    let heading = null;
    if (movingSpeed >= 1.2) {
        if (gpsHeading != null && Number.isFinite(gpsHeading) && gpsHeading >= 0) {
            heading = gpsHeading;
        } else if (accuracy <= MAX_ACC_M && lastCourseFix && dist(lastCourseFix, ll) >= 4) {
            heading = bearingBetween(lastCourseFix, ll);
        }
        if (accuracy <= MAX_ACC_M) lastCourseFix = ll;
    } else if (accuracy <= MAX_ACC_M) {
        if (lastCourseFix && dist(lastCourseFix, ll) >= 8) {
            heading = bearingBetween(lastCourseFix, ll);
            lastCourseFix = ll;
        } else if (!lastCourseFix) {
            lastCourseFix = ll;
        }
    }
    if (followedRoute && map && typeof map.setHeading === 'function') {
        const routeHeading = routeHeadingFromFollowedRoute(followedMatch && followedMatch.index);
        if (routeHeading != null) {
            lastHeading = routeHeading;
            applyMapHeading(routeHeading);
        }
    } else if (guide.active && guide.heading != null) {
        lastHeading = guide.heading;
        applyMapHeading(guide.heading);
    } else if (heading != null && Number.isFinite(heading)) {
        lastHeading = heading;
        applyMapHeading(heading);
    }

    if (Date.now() - lastPosSave > 15000) {
        lastPosSave = Date.now();
        try { localStorage.setItem('mtb_last_pos', JSON.stringify(ll)); } catch (e) {}
    }

    if (map) {
        if (!userMarker) {
            userMarker = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 2, fillColor: '#29b6f6', fillOpacity: 1 }).addTo(map);
        } else {
            userMarker.setLatLng(ll);
        }
        const shouldRecenter = !firstFix ||
            (gpsRecenterPending && Number.isFinite(accuracy) && accuracy <= GPS_RECENTER_ACCURACY_M);
        if (!firstFix) firstFix = true;
        if (shouldRecenter) {
            map.setView(ll, Math.max(map.getZoom(), 16));
            if (Number.isFinite(accuracy) && accuracy <= GPS_RECENTER_ACCURACY_M) gpsRecenterPending = false;
        }
        if (following && (typeof currentPage === 'undefined' || currentPage === 0)) {
            map.panTo(ll, { animate: true, duration: 0.35 });
        }
    }

    // Velocidad (siempre visible; 0 en pausa o casi parado)
    const now = Date.now();
    const bleSpeedFresh = currentBleSpeed !== null && now - currentBleSpeedAt <= 5000;
    if (currentCadence !== null && now - sensorStates.cadence.lastReadingAt > 5000) updateCadence(null);
    let kmh = bleSpeedFresh ? currentBleSpeed : (speed != null && !isNaN(speed) ? speed * 3.6 : 0);
    if (isPaused || kmh < 0.5) kmh = 0;
    $('m-speed').textContent = kmh.toFixed(1);

    if (isRecording && accuracy <= AUTO_PAUSE_MAX_ACCURACY_M) {
        if (isPaused && autoPaused && autoPauseAnchor) {
            if (dist(autoPauseAnchor, ll) >= autoPauseMovementThreshold(accuracy)) {
                resumeRecording(true, ll);
            }
        } else if (!isPaused) {
            updateAutoPauseMovement(ll, accuracy);
        }
    }

    if (!isRecording || isPaused) return;

    if (followedMatch) checkOffRoute(lat, lon, followedMatch);
    if (accuracy > MAX_ACC_M) return; // señal pobre: no se graba
    publishMyLocation();

    const t = pos.timestamp;
    let add = 0, brk = false;

    if (!lastAccepted || resumeBreak) {
        brk = points.length > 0; // primer punto tras una pausa: nuevo tramo, sin sumar distancia
    } else {
        const d = dist(lastAccepted.ll, ll);
        if (d < MIN_STEP_M) return; // parado o ruido
        const dt = Math.max((t - lastAccepted.t) / 1000, 0.001);
        if (d / dt > MAX_SPEED_MS) return; // salto imposible
        add = d / 1000;
    }
    resumeBreak = false;

    totalDistance += add;
    elev.add(altitude);

    const pt = [
        +lat.toFixed(6), +lon.toFixed(6),
        (altitude != null && !isNaN(altitude)) ? Math.round(altitude * 10) / 10 : null,
        t, currentHr, brk ? 1 : null, kmh,
        currentCadence !== null && now - sensorStates.cadence.lastReadingAt <= 5000 ? currentCadence : null,
        currentPower !== null && now - sensorStates.power.lastReadingAt <= 5000 ? currentPower : null
    ];
    points.push(pt);

    if (brk || segments.length === 0) segments.push([]);
    segments[segments.length - 1].push(ll);
    lastAccepted = { ll, t };

    if (routePolyline) routePolyline.setLatLngs(segments);
    $('m-dist').textContent = totalDistance.toFixed(2);
    $('m-elevation').textContent = Math.round(elev.gain);


}

// ============================================================
