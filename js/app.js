'use strict';

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
            const previousServer = localStorage.getItem('mtb_server');
            if (previousServer && normalizeServer(previousServer) !== DEFAULT_CLOUD_SERVER) Cloud.clearSession();
            localStorage.setItem('mtb_server', DEFAULT_CLOUD_SERVER);
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
            try { await restoreCamino(); }
            catch (e) { console.warn('No se pudo restaurar el Camino del mapa:', e); }

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
            try {
                const activeGuide = localStorage.getItem(GUIDE_ACTIVE_KEY) || localStorage.getItem(GUIDE_PAUSED_KEY);
                if (activeGuide && GUIDE_IDS.has(activeGuide)) {
                    $('camino-select').value = activeGuide;
                    if (await guideAskResume(activeGuide)) {
                        await guideStart();
                        goToPage(0);
                    } else {
                        try { localStorage.removeItem(GUIDE_ACTIVE_KEY); localStorage.removeItem(GUIDE_PAUSED_KEY); } catch (e) {}
                        clearCamino();
                    }
                }
            } catch (e) { console.warn('No se pudo reanudar el Camino guiado:', e); }
        }

        init();

        // Service Worker: abre la app sin conexión y guarda las teselas ya vistas
        if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
            navigator.serviceWorker.register('sw.js').catch(() => {});
        }
