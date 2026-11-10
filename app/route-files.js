'use strict';

//  EXPORTAR / IMPORTAR GPX, KML, GEOJSON
// ============================================================
const MAX_IMPORTED_TRACK_POINTS = 100000;

function routeToGpx(r) {
    const route = r && typeof r === 'object' ? r : {};
    const title = String(route.name ?? 'Ruta');
    const points = Array.isArray(route.points) ? route.points : [];
    const out = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gpx version="1.1" creator="MTB CAMBOYA" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">',
        `<metadata><name>${xmlEsc(title)}</name></metadata>`,
        `<trk><name>${xmlEsc(title)}</name>`
    ];
    points.forEach((p, i) => {
        if (i === 0 || p[5] === 1) {
            if (i > 0) out.push('</trkseg>');
            out.push('<trkseg>');
        }
        let s = `<trkpt lat="${p[0]}" lon="${p[1]}">`;
        if (p[2] != null) s += `<ele>${p[2]}</ele>`;
        if (Number.isFinite(p[3])) s += `<time>${new Date(p[3]).toISOString()}</time>`;
        if (p[4] != null) s += `<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${p[4]}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>`;
        out.push(s + '</trkpt>');
    });
    if (points.length) out.push('</trkseg>');
    out.push('</trk>', '</gpx>');
    return out.join('\n');
}

// Devuelve { name, segs: [ [ [lat, lon, alt|null, tMs|null], ... ], ... ] }
function parseTrack(text, fname) {
    let name = fname.replace(/\.[^.]+$/, '');
    const segs = [];
    const trimmed = text.trim();
    let pointCount = 0;
    const addSegment = segment => {
        pointCount += segment.length;
        if (pointCount > MAX_IMPORTED_TRACK_POINTS) {
            throw new Error(`el track supera el límite de ${MAX_IMPORTED_TRACK_POINTS.toLocaleString('es-ES')} puntos`);
        }
        segs.push(segment);
    };

    if (trimmed.startsWith('{')) { // GeoJSON
        const geoms = [];
        (function walk(o) {
            if (!o) return;
            if (o.type === 'FeatureCollection') o.features.forEach(walk);
            else if (o.type === 'Feature') {
                if (o.properties && o.properties.name && !geoms.length) name = String(o.properties.name);
                walk(o.geometry);
            } else if (o.type === 'GeometryCollection') o.geometries.forEach(walk);
            else geoms.push(o);
        })(JSON.parse(trimmed));
        const conv = line => {
            if (pointCount + line.length > MAX_IMPORTED_TRACK_POINTS) {
                throw new Error(`el track supera el límite de ${MAX_IMPORTED_TRACK_POINTS.toLocaleString('es-ES')} puntos`);
            }
            return line.map(c => [c[1], c[0], c.length > 2 ? c[2] : null, null]);
        };
        geoms.forEach(g => {
            if (g.type === 'LineString') addSegment(conv(g.coordinates));
            else if (g.type === 'MultiLineString') g.coordinates.forEach(l => addSegment(conv(l)));
        });
    } else {
        const doc = new DOMParser().parseFromString(trimmed, 'application/xml');
        if (doc.getElementsByTagName('parsererror').length) throw new Error('el archivo no es un XML válido');

        if (/<kml[\s>]/i.test(trimmed)) { // KML
            const n = doc.getElementsByTagName('name')[0];
            if (n && n.textContent.trim()) name = n.textContent.trim();
            Array.from(doc.getElementsByTagName('LineString')).forEach(ls => {
                const co = ls.getElementsByTagName('coordinates')[0];
                if (!co) return;
                const coordinates = [];
                for (const match of co.textContent.matchAll(/\S+/g)) {
                    if (pointCount + coordinates.length >= MAX_IMPORTED_TRACK_POINTS) {
                        throw new Error(`el track supera el límite de ${MAX_IMPORTED_TRACK_POINTS.toLocaleString('es-ES')} puntos`);
                    }
                    const s = match[0];
                    const [lon, lat, alt] = s.split(',').map(Number);
                    coordinates.push([lat, lon, Number.isFinite(alt) && alt !== 0 ? alt : null, null]);
                }
                addSegment(coordinates);
            });
        } else { // GPX
            const n = doc.getElementsByTagName('trk')[0]
                ? doc.getElementsByTagName('trk')[0].getElementsByTagName('name')[0]
                : doc.getElementsByTagName('name')[0];
            if (n && n.textContent.trim()) name = n.textContent.trim();
            const readPt = e => {
                const ele = e.getElementsByTagName('ele')[0];
                const tm = e.getElementsByTagName('time')[0];
                return [
                    parseFloat(e.getAttribute('lat')), parseFloat(e.getAttribute('lon')),
                    ele ? parseFloat(ele.textContent) : null,
                    tm ? Date.parse(tm.textContent) : null
                ];
            };
            const trksegs = Array.from(doc.getElementsByTagName('trkseg'));
            const trackPointCount = doc.getElementsByTagName('trkpt').length;
            const routePointCount = doc.getElementsByTagName('rtept').length;
            const usedPointCount = trksegs.length ? trackPointCount : routePointCount;
            if (usedPointCount > MAX_IMPORTED_TRACK_POINTS) {
                throw new Error(`el track supera el límite de ${MAX_IMPORTED_TRACK_POINTS.toLocaleString('es-ES')} puntos`);
            }
            if (trksegs.length) {
                trksegs.forEach(s => addSegment(Array.from(s.getElementsByTagName('trkpt')).map(readPt)));
            } else {
                Array.from(doc.getElementsByTagName('rte')).forEach(r =>
                    addSegment(Array.from(r.getElementsByTagName('rtept')).map(readPt)));
            }
        }
    }
    return { name, segs };
}

function buildImportedRoute(parsed, routeName) {
    const full = [];
    let km = 0;
    const el = makeElevTracker();
    parsed.segs.forEach(seg => {
        let first = true, prev = null;
        seg.forEach(c => {
            const [lat, lon, alt, t] = c;
            if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return;
            const p = [lat, lon, Number.isFinite(alt) ? alt : null, Number.isFinite(t) ? t : null, null];
            if (first && full.length > 0) p.push(1);
            if (prev) km += dist(prev, p) / 1000;
            el.add(p[2]);
            full.push(p);
            prev = p;
            first = false;
        });
    });
    if (full.length < 2) throw new Error('no contiene ningún track válido');

    let stored = full;
    if (full.length > 20000) { // evita guardar tracks gigantes
        const k = Math.ceil(full.length / 20000);
        stored = full.filter((p, i) => i % k === 0 || p[5] === 1 || i === full.length - 1);
    }
    return {
        id: Date.now(),
        kind: 'imported',
        name: routeName,
        createdBy: Cloud.email || 'Usuario local',
        startedAt: new Date().toISOString(),
        movingTimeSec: 0,
        distanceKm: +km.toFixed(3),
        elevationGain: Math.round(el.gain),
        hrAvg: null,
        points: stored
    };
}

// ============================================================
