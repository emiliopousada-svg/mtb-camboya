'use strict';

//  CAMINO GUIADO: seguimiento, descargas y actualización
// ============================================================
const GUIDE_ACTIVE_KEY = 'mtb_camino_guide';
const GUIDE_PAUSED_KEY = 'mtb_camino_guide_paused';
const guide = { id: null, data: null, cum: null, track: null, done: null, arrow: null, active: false, idx: null, off: false, lastDoneAt: 0 };
const guideSelected = new Set();
let guideView = null; // { id, data, downloaded, meta } del Camino mostrado en la pestaña
let guideDownloadRunning = false, guideCancel = false;

const guideTrackKey = id => `camino-full:${id}`;
const guidePoisKey = id => `camino-pois:${id}`;
const guideMetaKey = id => `camino-dl:${id}`;

function guideValidData(data) {
    return data && Array.isArray(data.points) && data.points.length > 1 && Array.isArray(data.stages) &&
        data.points.every(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
}

// Etapas de ~25 km a pie; en bici (MTB/carretera) se unen de dos en dos (~50 km).
function guideApplyStages(raw) {
    const base = raw.stages;
    const perStage = ['mtb', 'road'].includes(preferredActivityType) ? 2 : 1;
    const stages = [];
    for (let i = 0; i < base.length; i += perStage) {
        const group = base.slice(i, i + perStage);
        const first = group[0], last = group[group.length - 1];
        stages.push({
            n: stages.length + 1,
            name: group.length === 1 ? first.name : `${first.name.split(' → ')[0]} → ${last.name.split(' → ').pop()}`,
            from: first.from,
            to: last.to,
            km: +group.reduce((sum, s) => sum + s.km, 0).toFixed(1),
            gain: group.reduce((sum, s) => sum + s.gain, 0),
            loss: group.reduce((sum, s) => sum + s.loss, 0),
            parts: group.map(s => s.n)
        });
    }
    return { ...raw, baseStages: base, stages };
}

async function guideLoad(id) {
    let stored = null;
    try { stored = await DB.kvGet(guideTrackKey(id)); } catch (e) {}
    let meta = null;
    try { meta = await DB.kvGet(guideMetaKey(id)); } catch (e) {}
    if (guideValidData(stored)) return { id, data: guideApplyStages(stored), downloaded: true, meta: meta || { stages: [], poiStages: [] } };
    const response = await fetch(`data/camino/${id}.json`);
    if (!response.ok) throw new Error(`No hay datos del trazado completo de este Camino (${response.status}).`);
    const data = await response.json();
    if (!guideValidData(data)) throw new Error('El archivo del trazado no es válido.');
    return { id, data: guideApplyStages(data), downloaded: false, meta: { stages: [], poiStages: [] } };
}

function guideCumulative(points) {
    const cum = new Float64Array(points.length);
    for (let i = 1; i < points.length; i++) cum[i] = cum[i - 1] + dist(points[i - 1], points[i]);
    return cum;
}

// Proyecta p sobre el segmento a-b; devuelve distancia (m) y fracción t.
function guideSegProj(p, a, b) {
    const k = Math.cos(p[0] * Math.PI / 180) * 111320, m = 110540;
    const ax = (a[1] - p[1]) * k, ay = (a[0] - p[0]) * m;
    const bx = (b[1] - p[1]) * k, by = (b[0] - p[0]) * m;
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    return { d: Math.hypot(ax + t * dx, ay + t * dy), t };
}

function guideProject(points, cum, lat, lon, hint) {
    const p = [lat, lon];
    const scan = (from, to) => {
        let best = { d: Infinity, i: from, t: 0 };
        for (let i = from; i < to; i++) {
            const r = guideSegProj(p, points[i], points[i + 1]);
            if (r.d < best.d) best = { d: r.d, i, t: r.t };
        }
        return best;
    };
    const last = points.length - 1;
    let best = null;
    if (hint != null) best = scan(Math.max(0, hint - 150), Math.min(last, hint + 600));
    if (!best || best.d > 250) {
        const all = scan(0, last);
        if (!best || all.d < best.d) best = all;
    }
    const s = cum[best.i] + best.t * (cum[best.i + 1] - cum[best.i]);
    return { ...best, s };
}

function guideStageIndex(stages, i) {
    for (let k = 0; k < stages.length; k++) if (i < stages[k].to) return k;
    return stages.length - 1;
}

function guideFmtKm(m) { return (m / 1000).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }

function guideRenderProfile() {
    const pts = guide.data.points;
    const total = guide.cum[pts.length - 1];
    const elevs = pts.map(p => Number(p[2])).filter(Number.isFinite);
    const panel = $('map-route-profile');
    $('map-route-name').textContent = guide.data.name;
    if (elevs.length < 2) {
        $('map-route-alt').textContent = 'Sin datos de altitud';
        $('map-route-area').setAttribute('d', '');
        $('map-route-line').setAttribute('d', '');
        panel.classList.add('show');
        return;
    }
    const min = Math.min(...elevs), max = Math.max(...elevs), range = Math.max(max - min, 1);
    const step = Math.max(1, Math.floor(pts.length / 400));
    let line = '';
    for (let i = 0; i < pts.length; i += step) {
        const x = guide.cum[i] / total * 320, y = 53 - ((Number(pts[i][2]) - min) / range) * 42;
        line += `${line ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    }
    const lastX = 320, lastY = 53 - ((Number(pts[pts.length - 1][2]) - min) / range) * 42;
    line += `L${lastX},${lastY.toFixed(1)}`;
    guide.profile = { min, range };
    $('map-route-line').setAttribute('d', line);
    $('map-route-area').setAttribute('d', `${line} L320,60 L0,60 Z`);
    $('map-route-alt').textContent = `${Math.round(min)}–${Math.round(max)} m · +${guide.data.gain || 0} m`;
    panel.classList.add('show');
}

function guideUpdateHud(r, lat, lon) {
    const data = guide.data, pts = data.points, total = guide.cum[pts.length - 1];
    const hud = $('camino-hud');
    hud.hidden = false;
    const si = guideStageIndex(data.stages, r.i);
    const stage = data.stages[si];
    const remaining = total - r.s;
    const pct = Math.max(0, Math.min(100, r.s / total * 100));
    const stageRemaining = Math.max(0, guide.cum[stage.to] - r.s);
    const far = r.d > 2000;
    hud.classList.toggle('off', r.d > OFFROUTE_M);
    $('camino-hud-main').hidden = far;
    $('camino-hud-stage').hidden = far;
    $('camino-hud-main').textContent = far
        ? ''
        : `${guideFmtKm(remaining)} km a ${data.destination} · ${pct.toFixed(0)}% completado${r.d > OFFROUTE_M ? ` · ⚠ fuera (${Math.round(r.d)} m)` : ''}`;
    $('camino-hud-stage').textContent = `Etapa ${stage.n}/${data.stages.length}: ${stage.name} · quedan ${guideFmtKm(stageRemaining)} km`;

    const ele = Number(pts[r.i][2]) + (Number(pts[r.i + 1][2]) - Number(pts[r.i][2])) * r.t;
    const x = r.s / total * 320;
    if (!isRecording) $('m-elevation').textContent = Math.round(guide.gainCum[r.i] || 0);
    if (guide.profile && Number.isFinite(ele)) {
        const y = 53 - ((ele - guide.profile.min) / guide.profile.range) * 42;
        const lineEl = $('map-route-cursor-line'), dot = $('map-route-cursor');
        lineEl.setAttribute('x1', x.toFixed(1)); lineEl.setAttribute('x2', x.toFixed(1));
        dot.setAttribute('cx', x.toFixed(1)); dot.setAttribute('cy', y.toFixed(1));
        lineEl.style.display = 'block'; dot.style.display = 'block';
        $('map-route-alt').textContent = `${Math.round(ele)} m aquí · ${Math.round(guide.profile.min)}–${Math.round(guide.profile.min + guide.profile.range)} m`;
    }
}

function guideOnPos(lat, lon) {
    if (!guide.active || !guide.data || !map) return;
    const pts = guide.data.points;
    const r = guideProject(pts, guide.cum, lat, lon, guide.idx);
    guide.idx = r.i;
    guideUpdateHud(r, lat, lon);

    const ahead = pts[Math.min(r.i + 1, pts.length - 1)];
    const bearing = bearingBetween(pts[r.i], ahead);
    guide.heading = r.d <= OFFROUTE_M ? bearing : null;
    const mapBearing = typeof map.getBearing === 'function' ? map.getBearing() : 0;
    const html = `<span style="transform:rotate(${(bearing - mapBearing - 90).toFixed(0)}deg)">➤</span>`;
    if (!guide.arrow) {
        guide.arrow = L.marker([lat, lon], {
            icon: L.divIcon({ className: 'guide-arrow', html, iconSize: [30, 30], iconAnchor: [15, 15] }),
            interactive: false, keyboard: false, zIndexOffset: 1000
        }).addTo(map);
    } else {
        guide.arrow.setLatLng([lat, lon]);
        guide.arrow.setIcon(L.divIcon({ className: 'guide-arrow', html, iconSize: [30, 30], iconAnchor: [15, 15] }));
    }

    if (guide.done && Date.now() - guide.lastDoneAt > 5000) {
        guide.lastDoneAt = Date.now();
        guide.done.setLatLngs(r.d > 2000 ? [] : pts.slice(0, r.i + 1).map(p => [p[0], p[1]]).concat([[lat, lon]]));
    }

    if (!guide.off && r.d > OFFROUTE_M) {
        guide.off = true;
        toast(`⚠️ Te has desviado del Camino (${Math.round(r.d)} m)`, 5000);
        playOffRouteSound();
        if (navigator.vibrate && localStorage.getItem('mtb_route_vibration') !== '0') navigator.vibrate([200, 100, 200]);
    } else if (guide.off && r.d < BACKONROUTE_M) {
        guide.off = false;
        toast('✅ De nuevo en el Camino');
        playBackOnRouteSound();
    }
}

async function guideShowStoredPois(id) {
    let stored = null;
    try { stored = await DB.kvGet(guidePoisKey(id)); } catch (e) {}
    if (!stored || !stored.stages) return false;
    const services = Object.values(stored.stages).flat();
    if (!services.length) return false;
    clearCaminoServicePois();
    showCaminoServicePois(services, caminoServicePoiRequest);
    $('camino-poi-status').textContent = `${services.length} servicios guardados en el móvil (OpenStreetMap). Disponibles sin conexión.`;
    return true;
}

async function guideStart() {
    const id = $('camino-select').value;
    if (!id || !CAMINO_ROUTES[id]) { toast('Elige primero un Camino'); return; }
    if (!GUIDE_IDS.has(id)) { toast('Este Camino todavía no tiene el trazado completo incluido'); return; }
    if (!map || !window.L) { toast('El mapa no está disponible'); return; }
    const button = $('btn-guide-start');
    button.disabled = true;
    try {
        const view = await guideLoad(id);
        guideStop(true);
        if (typeof unfollowRoute === 'function' && followedRoute) unfollowRoute();
        unlockOffRouteSound();
        guide.id = id; guide.data = view.data; guide.cum = guideCumulative(view.data.points); guide.gainCum = gainCumulative(view.data.points);
        guide.idx = null; guide.off = false; guide.active = true;
        document.body.classList.add('guide-on');
        $('camino-hud-main').hidden = false; $('camino-hud-stage').hidden = false;
        const latlngs = view.data.points.map(p => [p[0], p[1]]);
        guide.casing = L.polyline(latlngs, { color: '#fff', weight: 10, opacity: 0.9, interactive: false }).addTo(map);
        guide.track = L.polyline(latlngs, { color: '#ff6d00', weight: 6, opacity: 1, interactive: false }).addTo(map);
        guide.done = L.polyline([], { color: '#8d8d8d', weight: 6, opacity: 0.95, interactive: false }).addTo(map);
        guideRenderProfile();
        try { localStorage.setItem(GUIDE_ACTIVE_KEY, id); } catch (e) {}
        try { localStorage.removeItem(GUIDE_PAUSED_KEY); } catch (e) {}
        guideUpdateButtons();
        await loadCaminoAlbergues(id, false);
        await guideShowStoredPois(id);
        goToPage(0);
        if (lastLat !== null && lastLon !== null) {
            guideOnPos(lastLat, lastLon);
            map.setView([lastLat, lastLon], 14);
        } else {
            $('camino-hud').hidden = false;
            $('camino-hud-main').textContent = 'Esperando señal GPS…';
            $('camino-hud-stage').textContent = view.data.name;
            map.fitBounds(guide.track.getBounds(), { padding: [30, 30] });
        }
        toast(`Siguiendo ${view.data.name}. Te aviso si te desvías.`, 4500);
    } catch (e) {
        console.warn('No se pudo iniciar el Camino guiado:', e);
        guide.active = false;
        toast(e.message || 'No se pudo iniciar el Camino guiado', 5000);
    } finally {
        button.disabled = false;
        guideUpdateButtons();
    }
}

function guideStop(silent = false) {
    [guide.casing, guide.track, guide.done, guide.arrow].forEach(layer => { if (layer && map) map.removeLayer(layer); });
    guide.casing = guide.track = guide.done = guide.arrow = null;
    guide.active = false; guide.data = null; guide.cum = null; guide.idx = null; guide.off = false; guide.heading = null; guide.profile = null;
    $('camino-hud').hidden = true;
    document.body.classList.remove('guide-on');
    if (!isRecording) $('m-elevation').textContent = '0';
    applyCaminoAlbergueFilter();
    if (!followedRoute) {
        $('map-route-profile').classList.remove('show');
        $('map-route-cursor-line').style.display = 'none';
        $('map-route-cursor').style.display = 'none';
    }
    try { localStorage.removeItem(GUIDE_ACTIVE_KEY); } catch (e) {}
    guideUpdateButtons();
    if (!silent) toast('Seguimiento del Camino terminado');
}

function guideUpdateButtons() {
    updateFollowCaminoBtn();
    const start = $('btn-guide-start');
    if (guide.active) {
        start.textContent = '▶ Siguiendo…';
        start.disabled = true;
    } else {
        start.textContent = '▶ Seguir camino';
        start.disabled = false;
    }
}

function guidePause() {
    const id = guide.id;
    guideStop(true);
    if (id) { try { localStorage.setItem(GUIDE_PAUSED_KEY, id); } catch (e) {} }
    toast('Camino en pausa. Pulsa «Seguir camino» para continuar.');
}

function guideAskResume(id) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:20px;';
        const box = document.createElement('div');
        box.style.cssText = 'background:#fff;color:#222;border-radius:14px;padding:18px;max-width:340px;width:100%;text-align:center;';
        const title = document.createElement('h3');
        title.textContent = 'Camino de Santiago';
        const text = document.createElement('p');
        text.textContent = `¿Quieres continuar ${(CAMINO_ROUTES[id] && CAMINO_ROUTES[id].name) || 'el Camino'} o cancelarlo?`;
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;margin-top:12px;';
        const finish = value => { overlay.remove(); resolve(value); };
        [['▶ Continuar', true, 'btn'], ['✕ Cancelar', false, 'btn secondary']].forEach(([label, value, cls]) => {
            const b = document.createElement('button');
            b.type = 'button'; b.className = cls; b.style.flex = '1'; b.textContent = label;
            b.addEventListener('click', () => finish(value));
            row.appendChild(b);
        });
        box.append(title, text, row);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
    });
}

async function guideRender() {
    const id = $('camino-select').value;
    const summary = $('camino-route-subtitle'), list = $('guide-stage-list');
    list.textContent = '';
    if (!id || !CAMINO_ROUTES[id]) {
        $('guide-offline-state').textContent = '';
        guideView = null;
        return;
    }
    if (!GUIDE_IDS.has(id)) {
        summary.textContent = 'Este Camino todavía no tiene el trazado completo incluido en la app.';
        $('guide-offline-state').textContent = '';
        guideView = null;
        return;
    }
    summary.textContent = 'Cargando datos…';
    try {
        guideView = await guideLoad(id);
    } catch (e) {
        guideView = null;
        summary.textContent = e.message || 'No se pudieron cargar los datos.';
        return;
    }
    if ($('camino-select').value !== id) return;
    const { data, meta, downloaded } = guideView;
    summary.textContent = `${data.km.toLocaleString('es-ES')} km · +${data.gain} m / −${data.loss} m · ${data.stages.length} etapas · destino ${data.destination}.`;
    $('guide-offline-state').textContent = downloaded
        ? `Guardado en el móvil · datos del ${data.version} · ${meta.stages.length}/${data.baseStages.length} tramos de 25 km con mapa y servicios.`
        : 'Todavía no está descargado: el track funciona, pero el mapa y los servicios necesitan conexión.';
    $('guide-attribution').textContent = `Etapas sugeridas de unos ${data.baseStages === data.stages || data.stages.length === data.baseStages.length ? 25 : 50} km según tu actividad (${ACTIVITY_TYPES[preferredActivityType].label}), calculadas sobre el trazado. ${data.attribution}`;
    data.stages.forEach(stage => {
        const row = document.createElement('label');
        const isDone = stage.parts.every(n => meta.stages.includes(n));
        row.className = `guide-stage${isDone ? ' done' : ''}`;
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = guideSelected.has(stage.n);
        box.addEventListener('change', () => { if (box.checked) guideSelected.add(stage.n); else guideSelected.delete(stage.n); });
        const copy = document.createElement('span');
        copy.textContent = `${stage.n}. ${stage.name}${isDone ? ' ✓' : ''}`;
        const small = document.createElement('small');
        small.textContent = `${stage.km.toLocaleString('es-ES')} km · +${stage.gain} m / −${stage.loss} m`;
        copy.append(small);
        row.append(box, copy);
        list.append(row);
    });
}

function guideProgress(done, total, text) {
    $('guide-progress-fill').style.width = `${total ? Math.round(done / total * 100) : 0}%`;
    $('guide-progress-text').textContent = text;
}

// Teselas del corredor de CAMINO_TILE_CORRIDOR_M alrededor del tramo, sin duplicados.
function guideTilesForStage(points, from, to, tiles) {
    const lat2y = (lat, z) => (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z);
    const lon2x = (lon, z) => (lon + 180) / 360 * Math.pow(2, z);
    let acc = 0, prev = points[from];
    const samples = [prev];
    for (let i = from + 1; i <= to; i++) {
        acc += dist(prev, points[i]);
        prev = points[i];
        if (acc >= 1000 || i === to) { samples.push(points[i]); acc = 0; }
    }
    const dLat = CAMINO_TILE_CORRIDOR_M / 110540;
    for (const p of samples) {
        const dLon = CAMINO_TILE_CORRIDOR_M / (111320 * Math.cos(p[0] * Math.PI / 180));
        for (let z = CAMINO_TILE_MIN_ZOOM; z <= CAMINO_TILE_MAX_ZOOM; z++) {
            const x1 = Math.floor(lon2x(p[1] - dLon, z)), x2 = Math.floor(lon2x(p[1] + dLon, z));
            const y1 = Math.floor(lat2y(p[0] + dLat, z)), y2 = Math.floor(lat2y(p[0] - dLat, z));
            for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) tiles.add(`${z}/${x}/${y}`);
        }
    }
}

async function guideFetchPois(points, stage) {
    const lines = [points.slice(stage.from, stage.to + 1).map(p => [p[0], p[1]])];
    const { points: sample } = sampleCaminoPoiCoordinates(lines);
    const around = `(around:900,${sample.map(([lat, lon]) => `${lat.toFixed(5)},${lon.toFixed(5)}`).join(',')})`;
    const query = `[out:json][timeout:60];(` + CAMINO_POI_QUERY_FILTERS(around) + `);out center tags;`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 65000);
    try {
        const response = await fetch('https://overpass-api.de/api/interpreter', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body: `data=${encodeURIComponent(query)}`,
            signal: controller.signal
        });
        if (!response.ok) throw new Error(`OpenStreetMap respondió ${response.status}`);
        const keep = ['name', 'name:es', 'operator', 'opening_hours', 'phone', 'contact:phone', 'website', 'contact:website',
            'addr:street', 'addr:housenumber', 'addr:postcode', 'addr:city', 'addr:place'];
        return parseCaminoServiceElements(await response.json()).map(s => {
            const tags = {};
            keep.forEach(k => { if (s.element.tags && s.element.tags[k]) tags[k] = s.element.tags[k]; });
            return { element: { tags }, category: s.category, lat: s.lat, lon: s.lon };
        });
    } finally { clearTimeout(timer); }
}

async function guideDownload() {
    if (guideDownloadRunning || offlineDownloadRunning) { toast('Ya hay una descarga en curso'); return; }
    if (!guideView) { toast('Elige primero un Camino'); return; }
    const stageNums = [...guideSelected].sort((a, b) => a - b);
    if (!stageNums.length) { toast('Marca al menos una etapa'); return; }
    if (!navigator.onLine) { toast('Necesitas conexión para descargar'); return; }
    const { id, data } = guideView;
    const baseNums = data.stages.filter(s => stageNums.includes(s.n)).flatMap(s => s.parts);
    const stages = data.baseStages.filter(s => baseNums.includes(s.n));
    const tiles = new Set();
    stages.forEach(s => guideTilesForStage(data.points, s.from, s.to, tiles));
    const mb = Math.round(tiles.size * 0.03);
    const ok = await modal({ message: `Se descargarán ${stages.length} etapas: unas ${tiles.size.toLocaleString('es-ES')} teselas de mapa (≈ ${mb} MB), servicios y albergues. Usa Wi‑Fi y mantén la app abierta.`, ok: 'Descargar' });
    if (!ok) return;

    guideDownloadRunning = true; guideCancel = false;
    $('btn-guide-download').disabled = true; $('btn-guide-cancel').style.display = 'block';
    const tileList = [...tiles].map(k => k.split('/').map(Number));
    const total = stages.length + tileList.length;
    let done = 0, errors = 0;
    try {
        await DB.kvSet(guideTrackKey(id), (({ baseStages, ...raw }) => ({ ...raw, stages: baseStages }))(data));
        const meta = (await DB.kvGet(guideMetaKey(id))) || { stages: [], poiStages: [] };
        const poiStore = (await DB.kvGet(guidePoisKey(id))) || { stages: {} };
        meta.version = data.version;
        for (const stage of stages) {
            if (guideCancel) break;
            guideProgress(done, total, `Servicios de la etapa ${stage.n}…`);
            try {
                poiStore.stages[stage.n] = await guideFetchPois(data.points, stage);
                if (!meta.poiStages.includes(stage.n)) meta.poiStages.push(stage.n);
                await DB.kvSet(guidePoisKey(id), poiStore);
            } catch (e) {
                errors++;
                console.warn('No se pudieron descargar los servicios de la etapa', stage.n, e);
            }
            done++;
            await new Promise(r => setTimeout(r, 1200));
        }
        await openOfflineDb();
        let cursor = 0, tileErrors = 0;
        const workers = Array.from({ length: 3 }, async () => {
            while (!guideCancel) {
                const i = cursor++;
                if (i >= tileList.length) break;
                const [z, x, y] = tileList[i];
                try { await fetchAndStoreTile(z, x, y); } catch (e) { tileErrors++; }
                done++;
                if (done % 10 === 0) guideProgress(done, total, `Mapa: ${(done - stages.length).toLocaleString('es-ES')} / ${tileList.length.toLocaleString('es-ES')} teselas`);
            }
        });
        await Promise.all(workers);
        errors += tileErrors;
        if (guideCancel) {
            guideProgress(done, total, 'Descarga cancelada. Lo ya guardado se conserva.');
        } else {
            stages.forEach(s => { if (!meta.stages.includes(s.n)) meta.stages.push(s.n); });
            meta.at = new Date().toISOString();
            await DB.kvSet(guideMetaKey(id), meta);
            guideProgress(total, total, errors ? `Descarga terminada con ${errors} elementos pendientes. Vuelve a descargar para reintentar.` : 'Descarga completa. Ya puedes usar el Camino sin conexión.');
        }
        if (guide.active && guide.id === id) await guideShowStoredPois(id);
    } catch (e) {
        console.warn('Error en la descarga del Camino:', e);
        guideProgress(done, total, `No se pudo completar la descarga: ${e.message || e}`);
    } finally {
        guideDownloadRunning = false;
        $('btn-guide-download').disabled = false; $('btn-guide-cancel').style.display = 'none';
        guideRender();
    }
}

async function guideUpdate() {
    if (!guideView) { toast('Elige primero un Camino'); return; }
    if (!navigator.onLine) { toast('Necesitas conexión para actualizar'); return; }
    const { id } = guideView;
    $('btn-guide-update').disabled = true;
    try {
        const response = await fetch(`${CAMINO_DATA_REMOTE}${id}.json`, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`El servidor respondió ${response.status}`);
        const data = await response.json();
        if (!guideValidData(data)) throw new Error('Los datos recibidos no son válidos');
        const current = guideView.data;
        if (String(data.version) <= String(current.version) && data.points.length === current.points.length) {
            toast('Ya tienes la última versión');
        } else {
            await DB.kvSet(guideTrackKey(id), data);
            const meta = (await DB.kvGet(guideMetaKey(id))) || { stages: [], poiStages: [] };
            meta.stages = []; meta.poiStages = []; meta.version = data.version;
            await DB.kvSet(guideMetaKey(id), meta);
            await DB.kvDel(guidePoisKey(id));
            toast('Datos actualizados. Vuelve a descargar las etapas para refrescar el mapa y los servicios.', 6000);
        }
    } catch (e) {
        toast(`No se pudo actualizar: ${e.message || e}`, 5000);
    } finally {
        $('btn-guide-update').disabled = false;
        guideRender();
    }
}

async function guideDelete() {
    if (!guideView) return;
    const ok = await modal({ message: `¿Borrar el track y los servicios guardados de ${CAMINO_ROUTES[guideView.id].name}? Las teselas del mapa se conservan (se borran desde Ajustes).`, ok: 'Borrar' });
    if (!ok) return;
    const id = guideView.id;
    try {
        await DB.kvDel(guideTrackKey(id));
        await DB.kvDel(guidePoisKey(id));
        await DB.kvDel(guideMetaKey(id));
    } catch (e) { console.warn(e); }
    toast('Descarga borrada');
    guideRender();
}

function updateFollowCaminoBtn() {
    const button = $('btn-follow-camino');
    const id = guide.active ? guide.id : $('camino-select').value;
    const available = GUIDE_IDS.has(id);
    button.hidden = !available;
    button.disabled = guide.active;
    button.textContent = guide.active ? '🧭 SIGUIENDO CAMINO' : '🧭 SEGUIR CAMINO';
    button.setAttribute('aria-label', guide.active ? 'Siguiendo Camino' : 'Seguir Camino');
    button.setAttribute('aria-pressed', String(guide.active));
}

$('btn-follow-camino').addEventListener('click', async () => {
    if (!isRecording) {
        const activityType = await openActivityPicker();
        if (!activityType) return;
        startRecording(activityType);
    } else if (isPaused) {
        resumeRecording();
    }
    await guideStart();
});
$('camino-select').addEventListener('change', updateFollowCaminoBtn);
updateFollowCaminoBtn();

$('btn-guide-start').addEventListener('click', guideStart);
$('btn-guide-download').addEventListener('click', guideDownload);
$('btn-guide-update').addEventListener('click', guideUpdate);
$('btn-guide-delete').addEventListener('click', guideDelete);
$('btn-guide-cancel').addEventListener('click', () => { guideCancel = true; });
$('btn-guide-all').addEventListener('click', () => {
    if (!guideView) return;
    const all = guideView.data.stages.map(s => s.n);
    if (all.every(n => guideSelected.has(n))) guideSelected.clear(); else all.forEach(n => guideSelected.add(n));
    guideRender();
});
$('camino-select').addEventListener('change', () => { guideSelected.clear(); });
renderCaminoFilterChips();

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

    routePolyline = L.polyline([], { color: '#ff9800', weight: 5 }).addTo(map);
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
}

$('btn-center').addEventListener('click', () => {
    if (lastLat === null) { toast('Buscando señal GPS...'); return; }
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
