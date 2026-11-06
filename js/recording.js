'use strict';

        // ============================================================
        //  CONTROL DE GRABACIÓN
        // ============================================================
        let wakeLock = null;
        async function acquireWake() {
            try {
                if ('wakeLock' in navigator) {
                    wakeLock = await navigator.wakeLock.request('screen');
                    wakeLock.addEventListener('release', () => { wakeLock = null; });
                }
            } catch (e) {}
        }
        function releaseWake() {
            if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
        }

        // ---- GPS en segundo plano (solo dentro del APK) ----
        let bgActive = false, bgWatcherId = null, bgToken = 0, bgDeniedShown = false;

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
        setInterval(pollMapBattery, 60000);

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
            bgActive = true; // desde ya, las posiciones llegan por el plugin y no por el GPS web
            try {
                await ensureNotifPermission();
                const id = await bg.addWatcher({
                    backgroundTitle: 'MTB CAMBOYA',
                    backgroundMessage: 'Grabando tu ruta…',
                    requestPermissions: true,
                    stale: false,
                    distanceFilter: 2
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
                return true;
            } catch (e) {
                console.warn('No se pudo iniciar el GPS en segundo plano:', e);
                if (my === bgToken) { bgActive = false; bgWatcherId = null; }
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
        }

        // Empieza a recibir posiciones: en segundo plano si se puede; si no, pantalla encendida
        async function beginTracking(showToast) {
            const ok = await startBgWatcher();
            if (ok) {
                if (showToast) toast('Grabando en segundo plano: puedes bloquear la pantalla.', 5000);
                return;
            }
            acquireWake();
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
            draftInterval = setInterval(saveDraft, 10000);
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
            lblStart.textContent = { idle: 'COMENZAR RUTA', recording: 'PAUSAR', paused: 'REANUDAR' }[s];
            icoStart.textContent = s === 'recording' ? '⏸️' : '▶️';
            btnStop.style.display = s === 'idle' ? 'none' : 'flex';
        }

        function resetRecordingState() {
            points = [];
            segments = [];
            totalDistance = 0;
            elev = makeElevTracker();
            lastAccepted = null;
            resumeBreak = false;
            movingMs = 0;
            segStart = null;
            startedAt = null;
        }

        function startRecording(activityType) {
            unlockOffRouteSound();
            resetRecordingState();
            batteryWarnings.clear();
            batteryPollAt = 0;
            $('ride-battery').textContent = '🔋 --';
            recordingActivityType = Object.prototype.hasOwnProperty.call(ACTIVITY_TYPES, activityType) ? activityType : 'mtb';
            isRecording = true;
            isPaused = false;
            startedAt = new Date().toISOString();
            segStart = Date.now();
            $('m-dist').textContent = '0.00';
            $('m-elevation').textContent = '0';
            if (routePolyline) routePolyline.setLatLngs([]);
            setBtnState('recording');
            startTimers();
            startRideAdvisories();
            following = true;
            updateCenterBtn();
            publishMyLocation(true);
            beginTracking(true);
        }

        function pauseRecording() {
            movingMs += Date.now() - segStart;
            segStart = null;
            isPaused = true;
            pauseTimers();
            stopRideAdvisories();
            releaseWake();
            stopBgWatcher();
            removeMyLiveLocation();
            setBtnState('paused');
            $('m-speed').textContent = '0.0';
            saveDraft();
        }

        function resumeRecording() {
            unlockOffRouteSound();
            isPaused = false;
            segStart = Date.now();
            resumeBreak = true; // el primer punto nuevo abre tramo y no suma el salto
            setBtnState('recording');
            startTimers();
            startRideAdvisories();
            publishMyLocation(true);
            beginTracking(false);
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
            let routeName = null;
            if (points.length > 1 && totalDistance >= 0.05) {
                routeName = await promptRequiredRouteName(fmtDate(startedAt));
                if (routeName === null) {
                    toast('La ruta no se ha guardado; puedes finalizarla cuando quieras.');
                    return;
                }
            }
            if (segStart) { movingMs += Date.now() - segStart; segStart = null; }
            const sec = Math.round(movingMs / 1000);
            isRecording = false;
            isPaused = false;
            stopTimers();
            stopRideAdvisories();
            releaseWake();
            stopBgWatcher();
            removeMyLiveLocation();
            setBtnState('idle');
            if (guide.active) guideStop(true);
            $('m-speed').textContent = '0.0';
            DB.kvDel('draft').catch(() => {});

            if (points.length > 1 && totalDistance >= 0.05) {
                const hrs = points.map(p => p[4]).filter(h => h != null);
                const route = {
                    id: Date.now(),
                    kind: 'recorded',
                    activityType: recordingActivityType,
                    name: `${routeActivityPrefix(recordingActivityType)}${routeName}`,
                    startedAt,
                    movingTimeSec: sec,
                    distanceKm: +totalDistance.toFixed(3),
                    elevationGain: Math.round(elev.gain),
                    hrAvg: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
                    followedImportedRoute: followedRoute && followedRoute.kind === 'imported' ? followedRoute.name : null,
                    points
                };
                if (!await saveRoute(route)) return;
                toast(`✅ Ruta guardada: ${route.distanceKm.toFixed(2)} km · ${fmtDur(sec)} · +${route.elevationGain} m`, 5000);
            } else {
                toast('La ruta es muy corta y no se ha guardado.');
            }
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
                toast('⚠️ No se pudo guardar en el dispositivo (¿almacenamiento lleno?). Exporta el GPX ahora desde Rutas.', 7000);
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
            startedAt = d.startedAt || new Date().toISOString();
            recordingActivityType = Object.prototype.hasOwnProperty.call(ACTIVITY_TYPES, d.activityType)
                ? d.activityType
                : activityTypeFromName(d.name) || 'mtb';
            movingMs = d.movingMs || 0;
            totalDistance = d.totalDistance || 0;
            points.forEach(p => elev.add(p[2]));
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
                routePolyline.setLatLngs(segments);
                const b = routePolyline.getBounds();
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

