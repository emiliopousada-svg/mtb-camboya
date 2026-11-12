'use strict';

//  GPS
// ============================================================
const GPS_LOW_POWER_OPTIONS = { enableHighAccuracy: false, maximumAge: 10000, timeout: 20000 };
const GPS_ACTIVE_OPTIONS = { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 };
const GPS_FOLLOW_OPTIONS = { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 };
const GPS_RECENTER_ACCURACY_M = 100;
let gpsWatchId = null, gpsRetryTimer = null, gpsRetryDelay = 2000;
let gpsHighAccuracyMode = null;
let gpsPermissionDenied = false, gpsPermissionNoticeShown = false;
let gpsOneShotPending = false, gpsResumeCheckPending = false;
let gpsRecenterPending = true;
let lastGpsSpeedFix = null;

function gpsSpeedFromFix(position, timestamp, accuracy) {
    if (!Number.isFinite(timestamp) || !Number.isFinite(accuracy) || accuracy > MAX_ACC_M) return null;
    const previous = lastGpsSpeedFix;
    if (!previous || timestamp <= previous.timestamp || timestamp - previous.timestamp > 10000) {
        lastGpsSpeedFix = { position, timestamp };
        return 0;
    }

    const distance = dist(previous.position, position);
    const elapsedSeconds = (timestamp - previous.timestamp) / 1000;
    if (distance < MIN_STEP_M) return 0; // conserva el origen para acumular desplazamiento sin ruido

    lastGpsSpeedFix = { position, timestamp };
    const speedMs = distance / elapsedSeconds;
    return Number.isFinite(speedMs) && speedMs <= MAX_SPEED_MS ? speedMs * 3.6 : 0;
}

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
    if (!navigator.geolocation || gpsOneShotPending || bgActive) return;
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
    if (bgActive) {
        clearGpsWatch();
        return;
    }
    if (gpsPermissionDenied && !force) return;
    const highAccuracy = !!followedRoute || (isRecording && (!isPaused || autoPaused));
    if (!force && gpsWatchId !== null && gpsHighAccuracyMode === highAccuracy) return;
    if (force) gpsPermissionDenied = false;
    clearTimeout(gpsRetryTimer);
    gpsRetryTimer = null;
    clearGpsWatch();
    gpsHighAccuracyMode = highAccuracy;
    const options = isRecording && (!isPaused || autoPaused)
        ? GPS_ACTIVE_OPTIONS
        : followedRoute ? GPS_FOLLOW_OPTIONS : GPS_LOW_POWER_OPTIONS;
    gpsWatchId = navigator.geolocation.watchPosition(pos => {
        gpsRetryDelay = 2000;
        gpsPermissionDenied = false;
        if (!bgActive) onPos(pos);
    }, handleGpsError, options);
    if (force || !firstFix || gpsRecenterPending) requestCurrentGpsFix();
}

function refreshGpsMode() {
    if (document.visibilityState === 'hidden') {
        if (bgActive || !isRecording) clearGpsWatch();
        return;
    }
    startGps();
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
    if (document.visibilityState === 'hidden') {
        gpsRecenterPending = true;
        if (bgActive || !isRecording) clearGpsWatch();
    }
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

function gpsPositionIcon() {
    const avatarUrl = typeof getAccountAvatarUrl === 'function' ? getAccountAvatarUrl() : '';
    const image = avatarUrl
        ? `<img src="${avatarUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" alt="">`
        : '<span class="gps-position-dot"></span>';
    return L.divIcon({
        className: 'gps-position-icon',
        html: `<span class="gps-position-avatar">${image}</span>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18]
    });
}

function updateGpsAvatarMarkers() {
    const avatar = typeof getAccountAvatarUrl === 'function' ? getAccountAvatarUrl() : '';
    const centerImage = $('gps-center-avatar');
    const centerIndicator = $('gps-center-indicator');
    if (centerImage && centerIndicator) {
        if (avatar) {
            centerImage.src = avatar;
            centerImage.hidden = false;
            centerIndicator.classList.add('has-avatar');
        } else {
            centerImage.removeAttribute('src');
            centerImage.hidden = true;
            centerIndicator.classList.remove('has-avatar');
        }
    }
    if (userMarker && typeof userMarker.setIcon === 'function') {
        userMarker.setIcon(gpsPositionIcon());
    }
}

function onPos(pos) {
    if (!pos || !pos.coords || !Number.isFinite(pos.coords.latitude) || !Number.isFinite(pos.coords.longitude)) return;
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
            userMarker = L.marker(ll, { icon: gpsPositionIcon(), interactive: false, keyboard: false }).addTo(map);
        } else {
            userMarker.setLatLng(ll);
        }
        const point = map.latLngToContainerPoint(ll);
        const mapSize = map.getSize();
        const outsideCenterZone = Math.abs(point.x - mapSize.x / 2) > mapSize.x * 0.22
            || Math.abs(point.y - mapSize.y / 2) > mapSize.y * 0.22;
        const shouldRecenter = !firstFix || outsideCenterZone || gpsRecenterPending;
        if (outsideCenterZone || gpsRecenterPending) following = true;
        if (!firstFix) firstFix = true;
        if (shouldRecenter) {
            map.setView(ll, Math.max(map.getZoom(), 16));
            gpsRecenterPending = false;
        }
        updateCenterBtn();
        if (following && (typeof currentPage === 'undefined' || currentPage === 0)) {
            const mapIsRotating = mapRotationEnabled ||
                (typeof map.getBearing === 'function' && Math.abs(map.getBearing()) > 0.1);
            map.panTo(ll, { animate: !mapIsRotating, duration: 0.35 });
        }
    }

    // Velocidad (siempre visible; 0 en pausa o casi parado)
    const now = Date.now();
    const bleSpeedFresh = currentBleSpeed !== null && now - currentBleSpeedAt <= 5000;
    if (currentCadence !== null && now - sensorStates.cadence.lastReadingAt > 5000) updateCadence(null);
    const gpsTimestamp = Number.isFinite(pos.timestamp) ? pos.timestamp : now;
    const calculatedGpsSpeed = gpsSpeedFromFix(ll, gpsTimestamp, accuracy);
    const gpsSpeed = speed != null && Number.isFinite(speed) && speed >= 0
        ? speed * 3.6
        : calculatedGpsSpeed;
    let kmh = bleSpeedFresh ? currentBleSpeed : (gpsSpeed ?? 0);
    if (isPaused || kmh < 0.5) kmh = 0;
    $('m-speed').textContent = kmh.toFixed(1);

    if (isRecording && accuracy <= AUTO_PAUSE_MAX_ACCURACY_M) {
        if (isPaused && autoPaused && autoPauseAnchor) {
            updateAutoPauseResume(ll, accuracy);
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
    if (brk) elev.reset();
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

    if (map) {
        const segment = segments[segments.length - 1];
        if (brk || !routePolyline || routePolylinePointCount >= MAX_ROUTE_RENDER_POINTS) {
            const startsChunk = !brk && routePolyline && routePolylinePointCount >= MAX_ROUTE_RENDER_POINTS;
            const chunkPoints = startsChunk && segment.length > 1 ? [segment[segment.length - 2], ll] : [ll];
            routePolyline = L.polyline(chunkPoints, { color: '#ff9800', weight: 5 }).addTo(map);
            routePolylines.push(routePolyline);
            routePolylinePointCount = chunkPoints.length;
        } else {
            routePolyline.addLatLng(ll);
            routePolylinePointCount++;
        }
    }
    $('m-dist').textContent = totalDistance.toFixed(2);
    $('m-elevation').textContent = Math.round(elev.gain);


}

// ============================================================
