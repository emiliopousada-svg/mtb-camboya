'use strict';

        // ============================================================
        //  GPS
        // ============================================================
        function startGps() {
            if (!navigator.geolocation) { toast('Este dispositivo no tiene geolocalización'); return; }
            navigator.geolocation.watchPosition(pos => { if (!bgActive) onPos(pos); }, err => {
                console.warn('GPS error:', err);
                if (err.code === 1) toast('Permiso de ubicación denegado: actívalo para grabar rutas', 6000);
            }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
        }

        function bearingBetween(from, to) {
            const rad = Math.PI / 180;
            const lat1 = from[0] * rad, lat2 = to[0] * rad;
            const dLon = (to[1] - from[1]) * rad;
            const y = Math.sin(dLon) * Math.cos(lat2);
            const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
            return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
        }

        function routeHeadingFromFollowedRoute(lat, lon) {
            if (!followedRoute || followedRoute.pts.length < 2) return null;
            let bestIndex = 0, bestDist = Infinity;
            for (let i = 0; i < followedRoute.pts.length; i++) {
                const d = dist([lat, lon], followedRoute.pts[i]);
                if (d < bestDist) { bestDist = d; bestIndex = i; }
            }
            const prevIndex = Math.max(0, bestIndex - 1);
            const nextIndex = Math.min(followedRoute.pts.length - 1, bestIndex + 1);
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
            if (followedRoute) updateMapRouteProfilePosition(lat, lon);
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
                const routeHeading = routeHeadingFromFollowedRoute(lat, lon);
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
                if (!firstFix) { firstFix = true; map.setView(ll, 16); }
            }

            // Velocidad (siempre visible; 0 en pausa o casi parado)
            const now = Date.now();
            const bleSpeedFresh = currentBleSpeed !== null && now - currentBleSpeedAt <= 5000;
            if (currentCadence !== null && now - sensorStates.cadence.lastReadingAt > 5000) updateCadence(null);
            let kmh = bleSpeedFresh ? currentBleSpeed : (speed != null && !isNaN(speed) ? speed * 3.6 : 0);
            if (isPaused || kmh < 0.5) kmh = 0;
            $('m-speed').textContent = kmh.toFixed(1);

            if (!isRecording || isPaused) return;

            if (followedRoute) checkOffRoute(lat, lon);
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

            if (map && following) map.panTo(ll, { animate: true });
        }

