'use strict';

//  MAPAS OFFLINE (teselas IGN guardadas en IndexedDB)
// ============================================================
const OFFLINE_DB = 'mtb-camboya-mapas-v1';
const OFFLINE_STORE = 'tiles';
const ONLINE_TILE_STORE = 'online-tiles';
const MAX_CACHED_ONLINE_TILES = 10000;
const IGN_TILE_URL = 'https://tms-mapa-raster.ign.es/1.0.0/mapa-raster/{z}/{x}/{ty}.jpeg';
const MAP_STYLE_NAMES = {
    ign: 'Topográfico IGN',
    topographic: 'Topográfico OpenTopoMap'
};
const MAP_RETINA = window.devicePixelRatio >= 2;
const MAP_TILE_ZOOM_OFFSET = MAP_RETINA ? 1 : 0;
const MAP_TILE_SIZE = MAP_RETINA ? 128 : 256;
const MAP_MAX_ZOOM = 20;
let offlineDbPromise = null;
let stopOfflineDownload = false;
let offlineDownloadRunning = false;

function openOfflineDb() {
    if (offlineDbPromise) return offlineDbPromise;
    offlineDbPromise = new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) { reject(new Error('Este navegador no permite almacenamiento offline')); return; }
        const req = indexedDB.open(OFFLINE_DB, 3);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(OFFLINE_STORE)) db.createObjectStore(OFFLINE_STORE, { keyPath: 'id' });
            if (!db.objectStoreNames.contains(ONLINE_TILE_STORE)) {
                const store = db.createObjectStore(ONLINE_TILE_STORE, { keyPath: 'id' });
                store.createIndex('savedAt', 'savedAt');
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('No se pudo abrir el almacenamiento de mapas'));
    });
    offlineDbPromise = offlineDbPromise.catch(error => {
        offlineDbPromise = null;
        throw error;
    });
    return offlineDbPromise;
}

function tileKey(z, x, y) { return `${z}/${x}/${y}`; }
async function getOfflineTile(z, x, y) {
    const db = await openOfflineDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(OFFLINE_STORE, 'readonly');
        const req = tx.objectStore(OFFLINE_STORE).get(tileKey(z, x, y));
        req.onsuccess = () => resolve(req.result ? req.result.blob : null);
        req.onerror = () => reject(req.error);
    });
}
async function saveOfflineTile(z, x, y, blob) {
    const db = await openOfflineDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(OFFLINE_STORE, 'readwrite');
        tx.objectStore(OFFLINE_STORE).put({ id: tileKey(z, x, y), blob, savedAt: Date.now() });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('No se pudo guardar la tesela'));
    });
}
async function countOfflineTiles() {
    const db = await openOfflineDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(OFFLINE_STORE, 'readonly');
        const req = tx.objectStore(OFFLINE_STORE).count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => reject(req.error);
    });
}
function onlineTileKey(style, z, x, y) { return `${style}/${z}/${x}/${y}`; }
async function getCachedOnlineTile(style, z, x, y) {
    const db = await openOfflineDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(ONLINE_TILE_STORE, 'readonly');
        const req = tx.objectStore(ONLINE_TILE_STORE).get(onlineTileKey(style, z, x, y));
        req.onsuccess = () => resolve(req.result ? req.result.blob : null);
        req.onerror = () => reject(req.error || new Error('No se pudo leer la tesela online guardada'));
    });
}
async function saveCachedOnlineTile(style, z, x, y, blob) {
    const db = await openOfflineDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(ONLINE_TILE_STORE, 'readwrite');
        const store = tx.objectStore(ONLINE_TILE_STORE);
        store.put({ id: onlineTileKey(style, z, x, y), blob, savedAt: Date.now() });
        const count = store.count();
        count.onsuccess = () => {
            if (count.result <= MAX_CACHED_ONLINE_TILES) return;
            let remaining = count.result;
            const cursorRequest = store.index('savedAt').openCursor();
            cursorRequest.onsuccess = () => {
                const cursor = cursorRequest.result;
                if (!cursor || remaining <= MAX_CACHED_ONLINE_TILES) return;
                cursor.delete();
                remaining--;
                cursor.continue();
            };
        };
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('No se pudo guardar la tesela online'));
        tx.onabort = () => reject(tx.error || new Error('No se pudo guardar la tesela online'));
    });
}
async function countCachedOnlineTiles() {
    const db = await openOfflineDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(ONLINE_TILE_STORE, 'readonly');
        const req = tx.objectStore(ONLINE_TILE_STORE).count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => reject(req.error || new Error('No se pudo contar la caché online'));
    });
}
function ignTileUrl(z, x, y) { const tmsY = Math.pow(2, z) - 1 - y; return IGN_TILE_URL.replace('{z}', z).replace('{x}', x).replace('{ty}', tmsY); }
async function fetchAndStoreTile(z, x, y) {
    const cached = await getOfflineTile(z, x, y);
    if (cached) return cached;
    const response = await fetch(ignTileUrl(z, x, y), { mode: 'cors', cache: 'force-cache' });
    if (!response.ok) throw new Error(`IGN respondió ${response.status}`);
    const blob = await response.blob();
    if (!blob || !blob.size) throw new Error('Tesela vacía');
    await saveOfflineTile(z, x, y, blob);
    return blob;
}

function createOfflineTileLayer() {
    const Layer = L.GridLayer.extend({
        createTile: function(coords, done) {
            const img = document.createElement('img');
            img.alt = '';
            img.setAttribute('role', 'presentation');
            const tileSize = this.getTileSize().x;
            const sourceCoords = { ...coords, z: coords.z + MAP_TILE_ZOOM_OFFSET };
            img.style.width = `${tileSize}px`;
            img.style.height = `${tileSize}px`;
            let finished = false;
            const finish = err => { if (finished) return; finished = true; done(err, img); };
            (async () => {
                try {
                    const blob = await getOfflineTile(sourceCoords.z, sourceCoords.x, sourceCoords.y);
                    if (blob) {
                        const objectUrl = URL.createObjectURL(blob);
                        img.onload = () => { URL.revokeObjectURL(objectUrl); finish(null); };
                        img.onerror = () => { URL.revokeObjectURL(objectUrl); finish(new Error('Error mostrando mapa guardado')); };
                        img.src = objectUrl;
                        return;
                    }
                    const response = await fetch(ignTileUrl(sourceCoords.z, sourceCoords.x, sourceCoords.y), { mode: 'cors' });
                    if (!response.ok) throw new Error('Tesela no disponible');
                    const blobOnline = await response.blob();
                    // Guarda automáticamente las teselas que se van viendo, además de las descargadas manualmente.
                    saveOfflineTile(sourceCoords.z, sourceCoords.x, sourceCoords.y, blobOnline).catch(error => {
                        console.warn('No se pudo guardar la tesela IGN en caché:', error);
                    });
                    const objectUrl = URL.createObjectURL(blobOnline);
                    img.onload = () => { URL.revokeObjectURL(objectUrl); finish(null); };
                    img.onerror = () => { URL.revokeObjectURL(objectUrl); finish(new Error('Error mostrando mapa')); };
                    img.src = objectUrl;
                } catch (err) {
                    // Último intento directo: permite ver el mapa si el servidor admite la carga como imagen.
                    img.onload = () => finish(null);
                    img.onerror = () => finish(err);
                    img.src = ignTileUrl(sourceCoords.z, sourceCoords.x, sourceCoords.y);
                }
            })();
            return img;
        }
    });
    return new Layer({
        tileSize: MAP_TILE_SIZE,
        minZoom: 5,
        maxZoom: MAP_MAX_ZOOM,
        maxNativeZoom: 17 - MAP_TILE_ZOOM_OFFSET,
        attribution: 'Cartografía: © Instituto Geográfico Nacional (IGN), CC BY 4.0'
    });
}

function createCachedOnlineTileLayer(style, urlTemplate, options) {
    const Layer = L.GridLayer.extend({
        createTile: function(coords, done) {
            const tile = document.createElement('div');
            const img = document.createElement('img');
            img.alt = '';
            img.setAttribute('role', 'presentation');
            const tileSize = this.getTileSize().x;
            const sourceCoords = { ...coords, z: coords.z + MAP_TILE_ZOOM_OFFSET };
            tile.style.width = `${tileSize}px`;
            tile.style.height = `${tileSize}px`;
            tile.style.position = 'absolute';
            tile.style.overflow = 'hidden';
            img.style.position = 'absolute';
            tile.appendChild(img);
            let finished = false;
            const finish = err => {
                if (finished) return;
                finished = true;
                done(err, tile);
            };
            const showBlob = (blob, sourceZoom = sourceCoords.z, sourceX = sourceCoords.x, sourceY = sourceCoords.y) => {
                const scale = Math.pow(2, Math.max(0, sourceCoords.z - sourceZoom));
                const sourceTileSize = tileSize * scale;
                img.style.width = `${sourceTileSize}px`;
                img.style.height = `${sourceTileSize}px`;
                img.style.left = `${-(sourceCoords.x % scale) * tileSize}px`;
                img.style.top = `${-(sourceCoords.y % scale) * tileSize}px`;
                const objectUrl = URL.createObjectURL(blob);
                img.onload = () => { URL.revokeObjectURL(objectUrl); finish(null); };
                img.onerror = () => { URL.revokeObjectURL(objectUrl); finish(new Error('Error mostrando tesela guardada')); };
                img.src = objectUrl;
            };
            const tileUrl = L.Util.template(urlTemplate, {
                ...sourceCoords,
                s: options.subdomains[(sourceCoords.x + sourceCoords.y) % options.subdomains.length]
            });
            const findCachedAncestor = async (readTile, minZoom = 5, includeExact = false) => {
                for (let zoom = sourceCoords.z - (includeExact ? 0 : 1); zoom >= minZoom; zoom--) {
                    const scale = Math.pow(2, sourceCoords.z - zoom);
                    const x = Math.floor(sourceCoords.x / scale);
                    const y = Math.floor(sourceCoords.y / scale);
                    const blob = await readTile(zoom, x, y);
                    if (blob) return { blob, zoom, x, y };
                }
                return null;
            };
            const fallbackToCachedStyle = async () => {
                try {
                    const ancestor = await findCachedAncestor((zoom, x, y) =>
                        getCachedOnlineTile(style, zoom, x, y)
                    );
                    if (ancestor) {
                        showBlob(ancestor.blob, ancestor.zoom, ancestor.x, ancestor.y);
                        return true;
                    }
                } catch (error) {
                    console.warn(`No se pudo leer una tesela anterior de ${style}:`, error);
                }
                return false;
            };
            const fallbackToIgn = async () => {
                try {
                    const ancestor = await findCachedAncestor(
                        (zoom, x, y) => zoom <= 17 ? getOfflineTile(zoom, x, y) : Promise.resolve(null),
                        5,
                        true
                    );
                    if (ancestor) {
                        showBlob(ancestor.blob, ancestor.zoom, ancestor.x, ancestor.y);
                        return;
                    }
                    if (navigator.onLine) {
                        // El servidor del estilo falla: se muestra el IGN en directo en lugar de dejar el mapa vacío.
                        const igZoom = Math.min(sourceCoords.z, 17);
                        const scale = Math.pow(2, sourceCoords.z - igZoom);
                        const igX = Math.floor(sourceCoords.x / scale), igY = Math.floor(sourceCoords.y / scale);
                        const blob = await fetchAndStoreTile(igZoom, igX, igY);
                        showBlob(blob, igZoom, igX, igY);
                        return;
                    }
                    finish(new Error('No hay tesela online ni mapa IGN guardado para esta zona.'));
                } catch (error) {
                    console.warn('No se pudo leer el mapa IGN de respaldo:', error);
                    finish(error);
                }
            };
            const fetchAndCache = async () => {
                const response = await fetch(tileUrl, { mode: 'cors' });
                if (!response.ok) throw new Error(`El servidor de mapas respondió ${response.status}`);
                const blob = await response.blob();
                if (!blob.size) throw new Error('El servidor de mapas devolvió una tesela vacía');
                await saveCachedOnlineTile(style, sourceCoords.z, sourceCoords.x, sourceCoords.y, blob).catch(error => {
                    console.warn(`No se pudo guardar la tesela ${style} en caché:`, error);
                });
                return blob;
            };
            (async () => {
                let cached = null;
                try {
                    cached = await getCachedOnlineTile(style, sourceCoords.z, sourceCoords.x, sourceCoords.y);
                } catch (error) {
                    console.warn(`No se pudo leer la caché ${style}:`, error);
                }
                if (cached) {
                    showBlob(cached);
                    if (navigator.onLine) fetchAndCache().catch(() => {});
                    return;
                }
                if (!navigator.onLine) {
                    if (await fallbackToCachedStyle()) return;
                    await fallbackToIgn();
                    return;
                }
                try {
                    showBlob(await fetchAndCache());
                } catch (error) {
                    img.style.width = `${tileSize}px`;
                    img.style.height = `${tileSize}px`;
                    img.style.left = '0';
                    img.style.top = '0';
                    img.onload = () => finish(null);
                    img.onerror = async () => {
                        if (await fallbackToCachedStyle()) return;
                        await fallbackToIgn();
                    };
                    img.src = tileUrl;
                }
            })();
            return tile;
        }
    });
    const sourceMaxZoom = options.maxNativeZoom;
    return new Layer({
        tileSize: MAP_TILE_SIZE,
        ...options,
        maxZoom: MAP_MAX_ZOOM,
        maxNativeZoom: sourceMaxZoom - MAP_TILE_ZOOM_OFFSET,
        attribution: `${options.attribution} | Teselas offline de respaldo: © Instituto Geográfico Nacional (IGN), CC BY 4.0`
    });
}

function createMapStyleLayers() {
    const osmAttribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
    return {
        ign: offlineTileLayer,
        topographic: createCachedOnlineTileLayer('topographic', 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
            maxNativeZoom: 17, subdomains: ['a', 'b', 'c'],
            attribution: `${osmAttribution}, SRTM | style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)`
        })
    };
}

function applyMapStyle() {
    if (!map || !mapStyleLayers.ign) return;
    const style = navigator.onLine ? 'topographic' : 'ign';
    if (activeMapStyle !== style) {
        if (activeMapStyle && mapStyleLayers[activeMapStyle]) map.removeLayer(mapStyleLayers[activeMapStyle]);
        mapStyleLayers[style].addTo(map);
        activeMapStyle = style;
    }
    const status = $('map-style-status');
    if (!status) return;
    const retinaText = MAP_RETINA ? ' En pantallas de alta densidad se cargan teselas un nivel más detalladas.' : '';
    status.textContent = style === 'ign'
        ? `Sin conexión: ${MAP_STYLE_NAMES.ign} y teselas guardadas. Cartografía nativa hasta zoom 17; por encima se amplía la imagen.${retinaText}`
        : `${MAP_STYLE_NAMES.topographic} guarda automáticamente las zonas visitadas (hasta 10.000 teselas). Sin conexión se usa ${MAP_STYLE_NAMES.ign} y las teselas guardadas.${retinaText}`;
}

// Rectángulos aproximados para descargar una comunidad cada vez.
function regionTiles(region, maxZoom) {
    const bounds = {
        portugal: [{ west: -9.55, east: -6.15, south: 36.90, north: 42.20 }],
        andalucia: [{ west: -7.55, east: -1.60, south: 35.90, north: 38.75 }],
        aragon: [{ west: -1.80, east: 0.80, south: 39.80, north: 42.95 }],
        asturias: [{ west: -7.20, east: -4.50, south: 43.10, north: 43.70 }],
        cantabria: [{ west: -4.90, east: -3.10, south: 43.00, north: 43.65 }],
        'castilla-la-mancha': [{ west: -5.40, east: -1.30, south: 38.00, north: 41.35 }],
        'castilla-y-leon': [{ west: -7.10, east: -1.75, south: 40.00, north: 43.30 }],
        cataluna: [{ west: 0.15, east: 3.35, south: 40.50, north: 42.90 }],
        'comunidad-valenciana': [{ west: -1.55, east: 0.55, south: 37.80, north: 40.80 }],
        extremadura: [{ west: -7.55, east: -4.50, south: 37.90, north: 40.50 }],
        galicia: [{ west: -9.30, east: -6.70, south: 41.80, north: 43.85 }],
        madrid: [{ west: -4.60, east: -3.00, south: 39.90, north: 41.20 }],
        murcia: [{ west: -2.40, east: -0.50, south: 37.35, north: 38.80 }],
        navarra: [{ west: -2.60, east: -0.70, south: 41.90, north: 43.30 }],
        'pais-vasco': [{ west: -3.50, east: -1.70, south: 42.40, north: 43.50 }],
        'la-rioja': [{ west: -3.20, east: -1.60, south: 41.90, north: 42.70 }]
    };
    const areas = bounds[region];
    if (!areas) throw new Error('La comunidad seleccionada no tiene un área de descarga definida.');
    const out = new Map();
    const xt = (lon, z) => Math.floor((lon + 180) / 360 * Math.pow(2, z));
    const yt = (lat, z) => Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z));
    for (let z = 7; z <= maxZoom; z++) {
        for (const { west, east, south, north } of areas) {
            const x1 = xt(west, z), x2 = xt(east, z), y1 = yt(north, z), y2 = yt(south, z);
            for (let x = x1; x <= x2; x++) {
                for (let y = y1; y <= y2; y++) out.set(`${z}/${x}/${y}`, { z, x, y });
            }
        }
    }
    return [...out.values()];
}
function setOfflineProgress(done, total, errors) {
    const pct = total ? Math.round(done / total * 100) : 0;
    $('offline-progress-fill').style.width = pct + '%';
    $('offline-progress-text').textContent = `${done.toLocaleString('es-ES')} / ${total.toLocaleString('es-ES')} teselas (${pct}%)${errors ? ` · ${errors} errores` : ''}`;
}
async function downloadRegionOffline() {
    if (offlineDownloadRunning) return;
    const regionSelect = $('offline-region');
    const region = regionSelect.value;
    const regionName = regionSelect.options[regionSelect.selectedIndex].text;
    const maxZoom = Number($('offline-detail').value) || 13;
    const tiles = regionTiles(region, maxZoom);
    const detailName = maxZoom === 14 ? 'alto (zoom 7–14)' : 'estándar (zoom 7–13)';
    const confirmed = await modal({
        message: `Se descargarán aproximadamente ${tiles.length.toLocaleString('es-ES')} teselas IGN para ${regionName} con detalle ${detailName}. Usa Wi-Fi y mantén la aplicación abierta. Las teselas ya guardadas se omiten.`,
        ok: 'Descargar'
    });
    if (!confirmed) return;
    offlineDownloadRunning = true; stopOfflineDownload = false;
    let done = 0, errors = 0, cursor = 0;
    $('btn-download-region').disabled = true;
    $('offline-storage-note').textContent = `Descargando ${regionName}. Mantén la app abierta y conectada a Wi-Fi. Si la paras, selecciona la misma comunidad y detalle para reanudar; las teselas ya guardadas se conservan.`;
    setOfflineProgress(0, tiles.length, 0);
    try {
        await openOfflineDb();
        const workers = Array.from({ length: 3 }, async () => {
            while (!stopOfflineDownload) {
                const i = cursor++;
                if (i >= tiles.length) break;
                const t = tiles[i];
                try { await fetchAndStoreTile(t.z, t.x, t.y); }
                catch (e) { errors++; console.warn('No se pudo descargar tesela', t, e); }
                done++;
                if (done % 10 === 0 || done === tiles.length) setOfflineProgress(done, tiles.length, errors);
            }
        });
        await Promise.all(workers);
        const stored = await countOfflineTiles();
        if (stopOfflineDownload) {
            $('offline-progress-text').textContent += ' · Pausado';
            toast('Descarga pausada. Puedes reanudarla más tarde.');
        } else {
            setOfflineProgress(done, tiles.length, errors);
            $('offline-storage-note').textContent = `Proceso terminado. Teselas guardadas en este móvil: ${stored.toLocaleString('es-ES')}. Los errores se pueden reintentar volviendo a pulsar descargar.`;
            toast(errors ? `Mapa descargado con ${errors} teselas pendientes` : `Mapa de ${regionName} guardado para usar sin conexión`, 5000);
        }
    } catch (e) {
        console.error(e);
        $('offline-storage-note').textContent = 'No se pudo iniciar el almacenamiento offline: ' + (e.message || e);
        toast('No se pudo iniciar la descarga de mapas', 5000);
    } finally {
        offlineDownloadRunning = false;
        $('btn-download-region').disabled = false;
    }
}
async function openOfflineMaps() {
    // Actualiza el espacio local al entrar en Ajustes.
    try {
        const [count, onlineCount] = await Promise.all([countOfflineTiles(), countCachedOnlineTiles()]);
        let usado = '';
        try {
            if (navigator.storage && navigator.storage.estimate) {
                const est = await navigator.storage.estimate();
                usado = ` Espacio usado por la app: ${Math.round((est.usage || 0) / 1048576)} MB.`;
            }
        } catch (e) {}
        $('offline-storage-note').textContent = `${count.toLocaleString('es-ES')} teselas IGN descargadas y ${onlineCount.toLocaleString('es-ES')} teselas online en caché.${usado} La caché online conserva hasta ${MAX_CACHED_ONLINE_TILES.toLocaleString('es-ES')} teselas recientes. Puedes reanudar una descarga incompleta.`;
    } catch (e) {
        console.warn('No se pudieron cargar los mapas offline:', e);
        $('offline-storage-note').textContent = 'El almacenamiento local aún no está inicializado.';
    }
}
$('btn-download-region').addEventListener('click', downloadRegionOffline);
$('btn-cancel-download').addEventListener('click', () => { stopOfflineDownload = true; $('offline-storage-note').textContent = 'Parando la descarga…'; });

async function clearOfflineTiles() {
    if (offlineDownloadRunning) { toast('Para antes la descarga'); return; }
    const ok = await modal({ message: '¿Borrar los mapas IGN descargados y la caché online de este móvil? Tus rutas no se borran.', ok: 'Borrar' });
    if (!ok) return;
    try {
        const db = await openOfflineDb();
        await new Promise((res, rej) => {
            const tx = db.transaction([OFFLINE_STORE, ONLINE_TILE_STORE], 'readwrite');
            tx.objectStore(OFFLINE_STORE).clear();
            tx.objectStore(ONLINE_TILE_STORE).clear();
            tx.oncomplete = res;
            tx.onerror = () => rej(tx.error);
            tx.onabort = () => rej(tx.error || new Error('abort'));
        });
        setOfflineProgress(0, 0, 0);
        $('offline-progress-text').textContent = 'Preparado para descargar';
        $('offline-storage-note').textContent = 'Mapas descargados y caché online borrados.';
        toast('Mapas borrados');
    } catch (e) {
        console.warn(e);
        toast('No se pudieron borrar los mapas');
    }
}
$('btn-clear-offline').addEventListener('click', clearOfflineTiles);


// ============================================================
