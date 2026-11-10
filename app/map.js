'use strict';

//  MAPA
// ============================================================
function initMap() {
    if (typeof L === 'undefined') {
        $('map').innerHTML = '<div style="padding:90px 24px; text-align:center; color:#b0b0b0;">No se pudo cargar el mapa (sin conexión y sin copia guardada). Puedes seguir grabando; el track se guarda igualmente.</div>';
        return;
    }
    let center = [42.55, -8.15];
    try {
        const lp = JSON.parse(localStorage.getItem('mtb_last_pos'));
        if (Array.isArray(lp) && lp.length === 2) center = lp;
    } catch (e) {}

    const supportsRotation = typeof L.Map.prototype.setBearing === 'function';
    map = L.map('map', {
        zoomControl: false,
        minZoom: 5,
        maxZoom: MAP_MAX_ZOOM,
        rotate: supportsRotation,
        touchRotate: supportsRotation,
        rotateControl: false
    }).setView(center, 15);
    window.map = map;

    offlineTileLayer = createOfflineTileLayer();
    mapStyleLayers = createMapStyleLayers();
    applyMapStyle();

    savedRouteLayer = L.polyline([], { color: '#29b6f6', weight: 4, dashArray: '5, 5' }).addTo(map);

    // Al arrastrar el mapa se desactiva el seguimiento automático
    map.on('dragstart', () => { following = false; updateCenterBtn(); });
    map.on('rotatestart', () => { following = false; updateCenterBtn(); });
    map.getContainer().addEventListener('touchstart', event => {
        if (event.touches.length >= 2) {
            following = false;
            updateCenterBtn();
        }
    }, { passive: true });
    map.on('zoomend', updateMapZoomButtons);
    updateMapZoomButtons();
    setTimeout(() => map.invalidateSize(), 300);

    // WebView puede conservar un tamaño obsoleto al girar o volver de segundo plano.
    const refreshMapViewport = () => {
        if (!map || document.hidden) return;
        requestAnimationFrame(() => {
            if (map && !document.hidden) map.invalidateSize({ pan: false, debounceMoveend: true });
        });
    };
    window.addEventListener('resize', refreshMapViewport, { passive: true });
    window.addEventListener('orientationchange', () => setTimeout(refreshMapViewport, 250), { passive: true });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) setTimeout(refreshMapViewport, 150);
    });
}

function updateMapZoomButtons() {
    if (!map) return;
    $('btn-map-zoom-in').disabled = map.getZoom() >= map.getMaxZoom();
    $('btn-map-zoom-out').disabled = map.getZoom() <= map.getMinZoom();
}

function updateCenterBtn() {
    $('btn-center').classList.toggle('active', following);
    const hasGpsFix = lastLat !== null && lastLon !== null;
    const centerIndicator = $('gps-center-indicator');
    if (centerIndicator) centerIndicator.hidden = !(following && hasGpsFix);
    if (userMarker && userMarker.setStyle) {
        const visible = !(following && hasGpsFix);
        userMarker.setStyle({ opacity: visible ? 1 : 0, fillOpacity: visible ? 1 : 0 });
    }
}

$('btn-center').addEventListener('click', () => {
    if (lastLat === null) { startGps(true); toast('Buscando señal GPS...'); return; }
    following = true;
    updateCenterBtn();
    if (map) {
        map.setView([lastLat, lastLon], Math.max(map.getZoom(), 16));
        if (lastHeading !== null) applyMapHeading(lastHeading);
    }
});
$('btn-map-zoom-in').addEventListener('click', () => {
    if (!map) return;
    following = false;
    updateCenterBtn();
    map.zoomIn();
});
$('btn-map-zoom-out').addEventListener('click', () => {
    if (!map) return;
    following = false;
    updateCenterBtn();
    map.zoomOut();
});

// Alterna entre norte arriba y mapa girado según la dirección de la ruta.
function updateOrientBtn() {
    const btn = $('btn-map-north');
    btn.textContent = mapRotationEnabled ? '➤' : 'N';
    btn.classList.toggle('route', mapRotationEnabled);
    btn.setAttribute('aria-pressed', mapRotationEnabled ? 'true' : 'false');
    btn.title = mapRotationEnabled ? 'Mapa según la dirección de la ruta (pulsa para norte arriba)' : 'Norte arriba (pulsa para seguir la dirección de la ruta)';
}
function setMapRotationMode(enabled) {
    mapRotationEnabled = enabled;
    localStorage.setItem('mtb_map_rotation', enabled ? '1' : '0');
    const setting = $('setting-map-rotation');
    if (setting) setting.checked = enabled;
    updateOrientBtn();
    if (!map || typeof map.setHeading !== 'function') return;
    if (!enabled) map.setHeading(0, { ease: 0.2, deadzone: 1 });
    else if (lastHeading !== null) applyMapHeading(lastHeading);
}
$('btn-map-north').addEventListener('click', () => setMapRotationMode(!mapRotationEnabled));
updateOrientBtn();

// ============================================================
