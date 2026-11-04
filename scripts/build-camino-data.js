#!/usr/bin/env node
/*
 * Genera data/camino/<id>.json con el trazado completo de cada Camino.
 * GeometrÃ­a: OpenStreetMap (ODbL) vÃ­a api.openstreetmap.org.
 * Altitud: OpenTopoData (EU-DEM 25 m, Copernicus).
 * Nombres de etapa: Nominatim (OSM). Las respuestas se cachean en .tmp-osm/.
 *
 * Uso: node scripts/build-camino-data.js [id ...]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(ROOT, '.tmp-osm');
const OUT = path.join(ROOT, 'data', 'camino');
const UA = 'mtb-camboya-build/1.0 (https://github.com/emiliopousada-svg/mtb-camboya)';
const SANTIAGO = [42.8806, -8.5446];
const STAGE_TARGET_KM = 25;

const CAMINOS = {
    frances: { name: 'Camino FrancÃ©s', relations: [2163573], start: [43.1635, -1.2374] },
    portugues: { name: 'Camino PortuguÃ©s', relations: [7684546, 12786090, 12786089, 10308998], start: [38.7099, -9.1332] },
    'portugues-costa': { name: 'Camino PortuguÃ©s por la Costa', relations: [6100606, 8099566, 9044581, 9044119, 18173128, 18168169, 7684546], start: [41.1428, -8.6112] },
    primitivo: { name: 'Camino Primitivo', relations: [19298101, 2163573], start: [43.3614, -5.8493] },
    norte: { name: 'Camino del Norte', relations: [1116809, 360167, 2201058, 1554697, 2163573], start: [43.3390, -1.7890] },
    ingles: { name: 'Camino InglÃ©s', relations: [1102966], start: [43.4837, -8.2330] },
    fisterra: { name: 'Camino de Fisterra', relations: [385098], start: SANTIAGO, end: [42.9069, -9.2653], destination: 'Fisterra' },
    invierno: { name: 'Camino de Invierno', relations: [1868399, 7684546], start: [42.5466, -6.5946] },
    plata: { name: 'VÃ­a de la Plata (por SanabrÃ©s)', relations: [241329, 2164353, 2164354], start: [37.3860, -5.9926] }
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(url, cacheName, delay = 0) {
    const file = path.join(CACHE, cacheName);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    for (let attempt = 1; attempt <= 4; attempt++) {
        try {
            if (delay) await sleep(delay);
            const res = await fetch(url, { headers: { 'User-Agent': UA } });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            fs.writeFileSync(file, JSON.stringify(data));
            return data;
        } catch (e) {
            if (attempt === 4) throw new Error(`${url}: ${e.message}`);
            await sleep(2000 * attempt);
        }
    }
}

const SKIP_ROLE = /alternat|variant|excursion|approach|connection|spur|side_stream/i;

async function collectGraph(relationId, seen, g) {
    if (seen.has(relationId)) return;
    seen.add(relationId);
    const data = await getJson(
        `https://api.openstreetmap.org/api/0.6/relation/${relationId}/full.json`,
        `rel-${relationId}.json`, 500);
    const wayMap = new Map();
    let rel = null;
    for (const el of data.elements) {
        if (el.type === 'node') g.coords.set(el.id, [el.lat, el.lon]);
        else if (el.type === 'way') wayMap.set(el.id, el);
        else if (el.type === 'relation' && el.id === relationId) rel = el;
    }
    if (!rel) return;
    const link = (a, b) => {
        if (a === b) return;
        if (!g.adj.has(a)) g.adj.set(a, []);
        if (!g.adj.has(b)) g.adj.set(b, []);
        if (!g.adj.get(a).includes(b)) g.adj.get(a).push(b);
        if (!g.adj.get(b).includes(a)) g.adj.get(b).push(a);
    };
    for (const m of rel.members) {
        if (SKIP_ROLE.test(m.role || '')) continue;
        if (m.type === 'way' && wayMap.has(m.ref)) {
            const ids = wayMap.get(m.ref).nodes.filter(n => g.coords.has(n));
            for (let i = 1; i < ids.length; i++) link(ids[i - 1], ids[i]);
        } else if (m.type === 'relation') {
            await collectGraph(m.ref, seen, g);
        }
    }
}

function hav(a, b) {
    const R = 6371008.8, rad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    const s = Math.sin(dLat / 2) ** 2 +
        Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
}

// Camino mÃ¡s corto entre dos nodos del grafo (Dijkstra con montÃ­culo binario).
function shortestPath(g, startId, endId) {
    const distTo = new Map([[startId, 0]]);
    const prev = new Map();
    const heap = [[0, startId]];
    const push = item => {
        heap.push(item);
        let i = heap.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (heap[p][0] <= heap[i][0]) break;
            [heap[p], heap[i]] = [heap[i], heap[p]];
            i = p;
        }
    };
    const pop = () => {
        const top = heap[0], last = heap.pop();
        if (heap.length) {
            heap[0] = last;
            let i = 0;
            for (;;) {
                let l = 2 * i + 1, r = l + 1, m = i;
                if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
                if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
                if (m === i) break;
                [heap[m], heap[i]] = [heap[i], heap[m]];
                i = m;
            }
        }
        return top;
    };
    while (heap.length) {
        const [d, u] = pop();
        if (d > (distTo.get(u) ?? Infinity)) continue;
        if (u === endId) break;
        for (const v of g.adj.get(u) || []) {
            const nd = d + hav(g.coords.get(u), g.coords.get(v));
            if (nd < (distTo.get(v) ?? Infinity)) { distTo.set(v, nd); prev.set(v, u); push([nd, v]); }
        }
    }
    if (!distTo.has(endId)) return null;
    const ids = [];
    for (let n = endId; n !== undefined; n = prev.get(n)) ids.push(n);
    return ids.reverse().map(id => g.coords.get(id));
}

function nearestNode(g, point) {
    let best = null, bestD = Infinity;
    for (const [id, c] of g.coords) {
        const d = hav(point, c);
        if (d < bestD) { bestD = d; best = id; }
    }
    return { id: best, d: bestD };
}

// Une extremos sueltos con nodos cercanos de otras vÃ­as que no comparten nodo.
function joinNearby(g, radiusM) {
    const cell = 0.02;
    const grid = new Map();
    const key = c => `${Math.floor(c[0] / cell)},${Math.floor(c[1] / cell)}`;
    for (const [id, c] of g.coords) {
        const k = key(c);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(id);
    }
    for (const [id, c] of g.coords) {
        if (!g.adj.has(id) || g.adj.get(id).length > 1) continue;
        const cx = Math.floor(c[0] / cell), cy = Math.floor(c[1] / cell);
        let best = null, bestD = radiusM;
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
            for (const other of grid.get(`${cx + dx},${cy + dy}`) || []) {
                if (other === id || !g.adj.has(other) || g.adj.get(id).includes(other)) continue;
                const d = hav(c, g.coords.get(other));
                if (d < bestD) { bestD = d; best = other; }
            }
        }
        if (best !== null) { g.adj.get(id).push(best); g.adj.get(best).push(id); }
    }
}

function copyGraph(g) {
    return { coords: g.coords, adj: new Map([...g.adj].map(([k, v]) => [k, v.slice()])) };
}

function routeThroughGraph(g, start, end, label) {
    const a = nearestNode(g, start), b = nearestNode(g, end);
    console.log(`  inicio a ${Math.round(a.d)} m del dato, fin a ${Math.round(b.d)} m`);
    for (const radius of [40, 250, 1000, 3000]) {
        const work = copyGraph(g);
        joinNearby(work, radius);
        const path = shortestPath(work, a.id, b.id);
        if (path) { console.log(`  conectado con radio de uniÃ³n ${radius} m`); return path; }
    }
    throw new Error(`${label}: no hay camino entre inicio y fin`);
}

function simplify(pts, tolM) {
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const toXY = p => [p[1] * 111320 * Math.cos(p[0] * Math.PI / 180), p[0] * 110540];
    const xy = pts.map(toXY);
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
        const [s, e] = stack.pop();
        let max = 0, idx = -1;
        const [ax, ay] = xy[s], [bx, by] = xy[e];
        const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
        for (let i = s + 1; i < e; i++) {
            let t = len2 ? ((xy[i][0] - ax) * dx + (xy[i][1] - ay) * dy) / len2 : 0;
            t = Math.max(0, Math.min(1, t));
            const d = Math.hypot(xy[i][0] - ax - t * dx, xy[i][1] - ay - t * dy);
            if (d > max) { max = d; idx = i; }
        }
        if (max > tolM && idx > 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
    }
    return pts.filter((_, i) => keep[i]);
}

async function elevations(pts) {
    const out = [];
    for (let i = 0; i < pts.length; i += 100) {
        const chunk = pts.slice(i, i + 100);
        const locs = chunk.map(p => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join('|');
        const data = await getJson(
            `https://api.opentopodata.org/v1/eudem25m?locations=${locs}&interpolation=bilinear`,
            `ele-${hash(locs)}.json`, 1200);
        if (!Array.isArray(data.results) || data.results.length !== chunk.length) {
            throw new Error('Respuesta de altitud invÃ¡lida');
        }
        out.push(...data.results.map(r => (Number.isFinite(r.elevation) ? r.elevation : (out[out.length - 1] ?? 0))));
    }
    return out;
}

function hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36) + s.length;
}

function smooth(values, radius) {
    return values.map((_, i) => {
        let sum = 0, n = 0;
        for (let j = Math.max(0, i - radius); j <= Math.min(values.length - 1, i + radius); j++) { sum += values[j]; n++; }
        return sum / n;
    });
}

function gainLoss(ele, from, to) {
    let gain = 0, loss = 0, ref = ele[from];
    for (let i = from + 1; i <= to; i++) {
        const d = ele[i] - ref;
        if (d >= 5) { gain += d; ref = ele[i]; }
        else if (d <= -5) { loss -= d; ref = ele[i]; }
    }
    return [Math.round(gain), Math.round(loss)];
}

async function placeName(lat, lon) {
    try {
        const data = await getJson(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=es&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`,
            `nom-${lat.toFixed(4)}_${lon.toFixed(4)}.json`, 1100);
        const a = data.address || {};
        return a.village || a.town || a.city || a.hamlet || a.suburb || a.municipality || a.county || 'Punto del camino';
    } catch (e) {
        return 'Punto del camino';
    }
}

async function build(id) {
    const cfg = CAMINOS[id];
    console.log(`\n== ${cfg.name}`);
    const g = { coords: new Map(), adj: new Map() };
    const seen = new Set();
    for (const rel of cfg.relations) await collectGraph(rel, seen, g);
    if (!g.coords.size) throw new Error('Sin geometrÃ­a');
    let pts = routeThroughGraph(g, cfg.start, cfg.end || SANTIAGO, id);
    if (cfg.end) console.log(`  destino ${cfg.destination}`);
    pts = simplify(pts, 4);
    const rawEle = await elevations(pts);
    const ele = smooth(rawEle, 2);

    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + hav(pts[i - 1], pts[i]));
    const total = cum[cum.length - 1];

    const nStages = Math.max(1, Math.round(total / 1000 / STAGE_TARGET_KM));
    const cuts = [0];
    for (let s = 1; s < nStages; s++) {
        const target = total * s / nStages;
        let k = cuts[cuts.length - 1] + 1;
        while (k < pts.length - 1 && cum[k] < target) k++;
        cuts.push(k);
    }
    cuts.push(pts.length - 1);

    const names = [];
    for (const c of cuts) names.push(await placeName(pts[c][0], pts[c][1]));
    const stages = [];
    for (let s = 0; s < cuts.length - 1; s++) {
        const [gain, loss] = gainLoss(ele, cuts[s], cuts[s + 1]);
        stages.push({
            n: s + 1,
            name: `${names[s]} â†’ ${names[s + 1]}`,
            from: cuts[s],
            to: cuts[s + 1],
            km: +((cum[cuts[s + 1]] - cum[cuts[s]]) / 1000).toFixed(1),
            gain,
            loss
        });
    }
    const [gain, loss] = gainLoss(ele, 0, pts.length - 1);

    const out = {
        id,
        name: cfg.name,
        version: new Date().toISOString().slice(0, 10),
        destination: cfg.destination || 'Santiago de Compostela',
        km: +(total / 1000).toFixed(1),
        gain,
        loss,
        stagesNote: `Etapas sugeridas de unos ${STAGE_TARGET_KM} km calculadas sobre el trazado.`,
        attribution: 'Trazado Â© colaboradores de OpenStreetMap (ODbL); altitud EU-DEM (Copernicus) vÃ­a OpenTopoData.',
        points: pts.map((p, i) => [+p[0].toFixed(5), +p[1].toFixed(5), Math.round(ele[i])]),
        stages
    };
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify(out));
    console.log(`${out.km} km, +${gain}/-${loss} m, ${pts.length} puntos, ${stages.length} etapas`);
    return out;
}

(async () => {
    fs.mkdirSync(CACHE, { recursive: true });
    const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(CAMINOS);
    const manifest = {};
    for (const id of ids) {
        if (!CAMINOS[id]) { console.error(`Camino desconocido: ${id}`); continue; }
        try {
            const r = await build(id);
            manifest[id] = { version: r.version, km: r.km, stages: r.stages.length };
        } catch (e) {
            console.error(`FALLO ${id}: ${e.message}`);
        }
    }
    fs.mkdirSync(OUT, { recursive: true });
    const mfile = path.join(OUT, 'manifest.json');
    let prev = {};
    try { prev = JSON.parse(fs.readFileSync(mfile, 'utf8')).caminos || {}; } catch (e) {}
    fs.writeFileSync(mfile, JSON.stringify({ updated: new Date().toISOString().slice(0, 10), caminos: { ...prev, ...manifest } }, null, 1));
})();
