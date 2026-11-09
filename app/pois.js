'use strict';

//  FUENTES DE AGUA Y PARADAS EN BARES
// ============================================================
let savedFountains = [];
try { savedFountains = JSON.parse(localStorage.getItem('mtb_saved_fountains') || '[]'); } catch (e) {}
// Elimina los puntos importados (archivo/OSM) de versiones anteriores; la función ya no existe.
if (savedFountains.some(p => p && p.type === 'imported')) {
    savedFountains = savedFountains.filter(p => !(p && p.type === 'imported'));
    try { localStorage.setItem('mtb_saved_fountains', JSON.stringify(savedFountains)); } catch (e) {}
}
let fountainMarkers = [];

function persistFountains() {
    try {
        localStorage.setItem('mtb_saved_fountains', JSON.stringify(savedFountains));
        return true;
    } catch (e) {
        toast('No se pudo guardar el punto en el dispositivo');
        return false;
    }
}

let poiSyncRunning = false, poiSyncRetryAfter = 0;
function newPoiClientId(id) {
    return `${id}-${Math.random().toString(36).slice(2, 10)}`;
}

const POI_TYPES = {
    fountain: { emoji: '🚰', defaultName: 'Fuente de Agua', ask: false, confirm: '¿Eliminar esta fuente guardada?' },
    bar:      { emoji: '🍺', defaultName: 'Bar', ask: true, prompt: 'Nombre del bar donde paras:', confirm: '¿Eliminar esta parada?' },
    food:     { emoji: '🍽️', defaultName: 'Sitio de comida', ask: true, prompt: 'Nombre del sitio de comida:', confirm: '¿Eliminar este sitio de comida?' }
};
const IMPORTED_POI_CATEGORIES = {
    point: { emoji: '📍', label: 'Punto de interés' },
    drinking_water: { emoji: '🚰', label: 'Agua potable' },
    fountain: { emoji: '⛲', label: 'Fuente' },
    toilets: { emoji: '🚻', label: 'Baños' },
    bicycle_repair_station: { emoji: '🔧', label: 'Reparación de bicicletas' },
    bicycle: { emoji: '🚲', label: 'Bicicletas' },
    cafe: { emoji: '☕', label: 'Cafetería' },
    restaurant: { emoji: '🍽️', label: 'Restaurante' },
    fast_food: { emoji: '🥪', label: 'Comida rápida' },
    bar: { emoji: '🍺', label: 'Bar' },
    shelter: { emoji: '🏠', label: 'Refugio' },
    parking: { emoji: '🅿️', label: 'Aparcamiento' },
    camp_site: { emoji: '⛺', label: 'Camping' },
    hostel: { emoji: '🛏️', label: 'Albergue' },
    convenience: { emoji: '🛒', label: 'Tienda' }
};
const poiType = f => (POI_TYPES[f.type] ? f.type : 'fountain'); // las fuentes antiguas no tienen tipo

async function syncSharedPois() {
    if (!Cloud.server || !navigator.onLine || poiSyncRunning || Date.now() < poiSyncRetryAfter) return false;
    poiSyncRunning = true;
    try {
        if (Cloud.loggedIn()) {
            let migrated = false;
            for (const f of savedFountains) {
                if (f.localOnly) continue;
                if (!f.remoteId && !f.pendingShare) {
                    f.clientId = f.clientId || newPoiClientId(f.id);
                    f.pendingShare = true;
                    migrated = true;
                }
            }
            if (migrated) persistFountains();

            for (const f of savedFountains.filter(x => !x.localOnly && x.pendingShare && !x.remoteId)) {
                const payload = {
                    owner: Cloud.uid,
                    clientId: String(f.clientId || newPoiClientId(f.id)),
                    type: poiType(f),
                    name: f.name || POI_TYPES[poiType(f)].defaultName,
                    lat: Number(f.lat),
                    lng: Number(f.lng)
                };
                f.clientId = payload.clientId;
                try {
                    const rec = await cloudApi('/api/collections/map_pois/records', 'POST', payload);
                    f.remoteId = rec.id;
                    f.owner = rec.owner || Cloud.uid;
                    f.pendingShare = false;
                    persistFountains();
                } catch (e) {
                    if (e.status === 400 || e.status === 409) {
                        const filter = encodeURIComponent(`owner = "${Cloud.uid}" && clientId = "${payload.clientId}"`);
                        const existing = await cloudApi(`/api/collections/map_pois/records?filter=${filter}&perPage=1`);
                        if (existing.items && existing.items[0]) {
                            f.remoteId = existing.items[0].id;
                            f.owner = existing.items[0].owner || Cloud.uid;
                            f.pendingShare = false;
                            persistFountains();
                            continue;
                        }
                    }
                    throw e;
                }
            }
        }

        const remote = [];
        for (let page = 1; ; page++) {
            const result = await cloudApi(`/api/collections/map_pois/records?page=${page}&perPage=200&sort=created`);
            remote.push(...result.items);
            if (page >= result.totalPages) break;
        }

        const remoteIds = new Set(remote.map(x => x.id));
        const localOnly = savedFountains.filter(f => !f.remoteId);
        const shared = remote
            .filter(f => Number.isFinite(Number(f.lat)) && Number.isFinite(Number(f.lng)))
            .map(f => ({
                id: f.id,
                remoteId: f.id,
                clientId: String(f.clientId || ''),
                owner: String(f.owner || ''),
                type: POI_TYPES[f.type] ? f.type : 'fountain',
                name: f.name || POI_TYPES[POI_TYPES[f.type] ? f.type : 'fountain'].defaultName,
                lat: Number(f.lat),
                lng: Number(f.lng),
                date: f.created ? new Date(f.created).toLocaleDateString('es-ES') : ''
            }));
        savedFountains = localOnly.concat(shared);
        persistFountains();
        loadSavedFountains();
        poiSyncRetryAfter = 0;
        return true;
    } catch (e) {
        console.warn('No se pudieron sincronizar las fuentes y bares:', e);
        poiSyncRetryAfter = Date.now() + (e.status === 404 ? 300000 : 30000);
        return false;
    } finally {
        poiSyncRunning = false;
    }
}

function poiIcon(type) {
    if (type === 'bar') {
        return L.divIcon({
            html: '<img src="estrella-galicia.svg" class="poi-bar-img" alt="">',
            className: 'poi-icon', iconSize: [40, 30], iconAnchor: [20, 15]
        });
    }
    if (type === 'food') {
        return L.divIcon({ html: '🍽️', className: 'poi-icon', iconSize: [30, 30], iconAnchor: [15, 15] });
    }
    return L.divIcon({ html: '🚰', className: 'poi-icon', iconSize: [30, 30], iconAnchor: [15, 15] });
}

function importedPoiIcon(category) {
    const meta = IMPORTED_POI_CATEGORIES[category] || IMPORTED_POI_CATEGORIES.point;
    return L.divIcon({ html: meta.emoji, className: 'poi-icon', iconSize: [30, 30], iconAnchor: [15, 15] });
}

function loadSavedFountains() {
    if (!map) return;
    fountainMarkers.forEach(m => map.removeLayer(m));
    fountainMarkers = [];

    savedFountains.forEach(f => {
        if (f.localOnly) {
            const category = IMPORTED_POI_CATEGORIES[f.category] ? f.category : 'point';
            const wrap = document.createElement('div');
            wrap.style.cssText = 'text-align:center; color:#121212;';
            const strong = document.createElement('strong');
            strong.textContent = `${IMPORTED_POI_CATEGORIES[category].emoji} ${f.name || IMPORTED_POI_CATEGORIES[category].label}`;
            wrap.append(strong);
            if (f.description) {
                const description = document.createElement('p');
                description.textContent = f.description;
                wrap.append(description);
            }
            const source = document.createElement('small');
            source.textContent = f.source === 'osm'
                ? 'OpenStreetMap · © OpenStreetMap contributors (ODbL)'
                : 'Importado en este dispositivo';
            wrap.append(document.createElement('br'), source);
            const btn = document.createElement('button');
            btn.textContent = 'Eliminar';
            btn.style.cssText = 'background:#d32f2f; color:white; border:none; padding:4px 8px; border-radius:4px; margin-top:5px; cursor:pointer; font-size:0.75rem;';
            btn.addEventListener('click', () => removeFountain(f.id));
            wrap.append(document.createElement('br'), btn);
            fountainMarkers.push(L.marker([f.lat, f.lng], { icon: importedPoiIcon(category) }).addTo(map).bindPopup(wrap));
            return;
        }
        const type = poiType(f);
        const meta = POI_TYPES[type];
        const wrap = document.createElement('div');
        wrap.style.cssText = 'text-align:center; color:#121212;';
        const strong = document.createElement('strong');
        strong.textContent = meta.emoji + ' ' + (f.name || meta.defaultName);
        const small = document.createElement('small');
        small.textContent = 'Guardada: ' + f.date;
        wrap.append(strong, document.createElement('br'), small);
        if (!f.remoteId || (Cloud.loggedIn() && f.owner === Cloud.uid)) {
            const btn = document.createElement('button');
            btn.textContent = 'Eliminar';
            btn.style.cssText = 'background:#d32f2f; color:white; border:none; padding:4px 8px; border-radius:4px; margin-top:5px; cursor:pointer; font-size:0.75rem;';
            btn.addEventListener('click', () => removeFountain(f.id));
            wrap.append(document.createElement('br'), btn);
        }

        fountainMarkers.push(L.marker([f.lat, f.lng], { icon: poiIcon(type) }).addTo(map).bindPopup(wrap));
    });
}

async function removeFountain(id) {
    const f = savedFountains.find(x => x.id === id);
    if (!f) return;
    const message = f.localOnly ? `¿Eliminar «${f.name || 'este punto'}» del mapa?` : POI_TYPES[poiType(f)].confirm;
    const ok = await modal({ message, ok: 'Eliminar' });
    if (!ok) return;
    if (f.remoteId) {
        if (!Cloud.loggedIn() || f.owner !== Cloud.uid) {
            toast('Solo quien añadió este punto puede eliminarlo.');
            return;
        }
        if (!navigator.onLine) {
            toast('Conéctate a internet para eliminar un punto compartido.');
            return;
        }
        try {
            await cloudApi(`/api/collections/map_pois/records/${encodeURIComponent(f.remoteId)}`, 'DELETE');
        } catch (e) {
            console.warn('No se pudo eliminar el punto compartido:', e);
            toast('No se pudo eliminar del mapa compartido.');
            return;
        }
    }
    savedFountains = savedFountains.filter(x => x.id !== id);
    persistFountains();
    loadSavedFountains();
}

let lastPoiAt = 0;
async function addPoi(type) {
    const meta = POI_TYPES[type];
    if (lastLat === null || lastLon === null) { toast('Buscando señal GPS para marcar tu ubicación exacta...'); return; }
    if (Date.now() - lastPoiAt < 1500) return; // evita duplicados por doble toque
    lastPoiAt = Date.now();
    const lat = lastLat, lng = lastLon; // la posición del momento del toque

    let name = meta.defaultName;
    if (meta.ask) { // el bar pide nombre; la fuente se guarda al instante
        const n = await modal({ message: meta.prompt, input: meta.defaultName, ok: 'Guardar' });
        if (n === null) return;
        name = n.trim() || meta.defaultName;
    }

    const id = Date.now();
    const point = {
        id, clientId: newPoiClientId(id), type, name, lat, lng,
        date: new Date().toLocaleDateString('es-ES'), pendingShare: true
    };
    savedFountains.push(point);
    persistFountains();
    loadSavedFountains();
    const shared = await syncSharedPois();
    if (navigator.vibrate) navigator.vibrate(60);
    if (currentPage !== 0) { goToPage(0); if (map) map.setView([lat, lng], 17); }
    toast(point.remoteId
        ? `${meta.emoji} «${name}» compartido en el mapa para todos.`
        : `${meta.emoji} «${name}» guardado en este móvil; se compartirá al iniciar sesión y conectar con el servidor.`);
}

$('btn-poi-fountain').addEventListener('click', () => addPoi('fountain'));
$('btn-poi-bar').addEventListener('click', () => addPoi('bar'));
$('btn-poi-food').addEventListener('click', () => addPoi('food'));
window.addEventListener('online', syncSharedPois);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncSharedPois();
});

