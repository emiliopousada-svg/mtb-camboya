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

function xmlLocalName(element) {
    return String(element.localName || element.nodeName || '').split(':').pop().toLowerCase();
}

function xmlElementsByLocalName(root, name) {
    return Array.from(root.getElementsByTagName('*'))
        .filter(element => xmlLocalName(element) === name);
}

// Devuelve { name, segs: [ [ [lat, lon, alt|null, tMs|null], ... ], ... ] }
function parseTrack(text, fname) {
    let name = fname.replace(/\.[^.]+$/, '');
    const segs = [];
    const trimmed = text.trim();
    const extension = (fname.match(/\.([^.]+)$/) || [null, ''])[1].toLowerCase();
    let pointCount = 0;
    const addSegment = segment => {
        pointCount += segment.length;
        if (pointCount > MAX_IMPORTED_TRACK_POINTS) {
            throw new Error(`el track supera el límite de ${MAX_IMPORTED_TRACK_POINTS.toLocaleString('es-ES')} puntos`);
        }
        segs.push(segment);
    };

    const isGeoJson = extension === 'geojson' || extension === 'json'
        || (!extension && trimmed.startsWith('{'));
    if (isGeoJson) { // GeoJSON
        if (!trimmed.startsWith('{')) throw new Error('El archivo GeoJSON no contiene un objeto válido.');
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

        const expectedRoot = extension === 'gpx' ? 'gpx' : extension === 'kml' ? 'kml' : null;
        if (!expectedRoot) throw new Error('El XML debe ser un archivo GPX o KML.');
        const rootName = doc.documentElement ? xmlLocalName(doc.documentElement) : '';
        if (rootName !== expectedRoot) {
            throw new Error(`El archivo .${extension} debe tener una raíz <${expectedRoot}>.`);
        }

        if (expectedRoot === 'kml') { // KML
            const n = xmlElementsByLocalName(doc, 'name')[0];
            if (n && n.textContent.trim()) name = n.textContent.trim();
            xmlElementsByLocalName(doc, 'linestring').forEach(ls => {
                const co = xmlElementsByLocalName(ls, 'coordinates')[0];
                if (!co) return;
                const coordinates = [];
                for (const match of co.textContent.matchAll(/\S+/g)) {
                    if (pointCount + coordinates.length >= MAX_IMPORTED_TRACK_POINTS) {
                        throw new Error(`el track supera el límite de ${MAX_IMPORTED_TRACK_POINTS.toLocaleString('es-ES')} puntos`);
                    }
                    const values = match[0].split(',');
                    if (values.length < 2 || values.length > 3 || !values[0].trim() || !values[1].trim()) {
                        throw new Error('El archivo KML contiene una coordenada geográfica no válida.');
                    }
                    const lon = Number(values[0]), lat = Number(values[1]);
                    if (!Number.isFinite(lat) || !Number.isFinite(lon)
                        || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
                        throw new Error('El archivo KML contiene una coordenada geográfica no válida.');
                    }
                    const alt = values.length === 3 && values[2].trim() ? Number(values[2]) : null;
                    coordinates.push([lat, lon, Number.isFinite(alt) ? alt : null, null]);
                }
                addSegment(coordinates);
            });
        } else { // GPX
            const tracks = xmlElementsByLocalName(doc, 'trk');
            const n = tracks.length
                ? xmlElementsByLocalName(tracks[0], 'name')[0]
                : xmlElementsByLocalName(doc, 'name')[0];
            if (n && n.textContent.trim()) name = n.textContent.trim();
            const readPt = e => {
                const latText = e.getAttribute('lat');
                const lonText = e.getAttribute('lon');
                const lat = Number(latText), lon = Number(lonText);
                if (latText == null || !latText.trim() || lonText == null || !lonText.trim()
                    || !Number.isFinite(lat) || !Number.isFinite(lon)
                    || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
                    throw new Error('El archivo GPX contiene una coordenada geográfica no válida.');
                }
                const ele = xmlElementsByLocalName(e, 'ele')[0];
                const tm = xmlElementsByLocalName(e, 'time')[0];
                return [
                    lat, lon,
                    ele ? parseFloat(ele.textContent) : null,
                    tm ? Date.parse(tm.textContent) : null
                ];
            };
            const trksegs = xmlElementsByLocalName(doc, 'trkseg');
            const trackPointCount = xmlElementsByLocalName(doc, 'trkpt').length;
            const routePointCount = xmlElementsByLocalName(doc, 'rtept').length;
            const usedPointCount = trksegs.length ? trackPointCount : routePointCount;
            if (usedPointCount > MAX_IMPORTED_TRACK_POINTS) {
                throw new Error(`el track supera el límite de ${MAX_IMPORTED_TRACK_POINTS.toLocaleString('es-ES')} puntos`);
            }
            if (trksegs.length) {
                trksegs.forEach(s => addSegment(xmlElementsByLocalName(s, 'trkpt').map(readPt)));
            } else {
                xmlElementsByLocalName(doc, 'rte').forEach(r =>
                    addSegment(xmlElementsByLocalName(r, 'rtept').map(readPt)));
            }
        }
        if (pointCount === 0) throw new Error(`El archivo ${expectedRoot.toUpperCase()} no contiene puntos de ruta.`);
    }
    return { name, segs };
}

function parseFitTrack(buffer) {
    if (typeof MTBFit === 'undefined' || typeof MTBFit.parseFitFile !== 'function') {
        throw new Error('no está disponible el lector de archivos FIT');
    }
    return MTBFit.parseFitFile(buffer);
}

function buildImportedRoute(parsed, routeName) {
    const full = [];
    let km = 0;
    let hasElevationData = false;
    const el = makeElevTracker();
    parsed.segs.forEach(seg => {
        let first = true, prev = null;
        let segmentAltitudeCount = 0;
        seg.forEach(c => {
            const [lat, lon, alt, t] = c;
            if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return;
            const heartRate = Number.isFinite(c[4]) ? c[4] : null;
            const p = [lat, lon, Number.isFinite(alt) ? alt : null, Number.isFinite(t) ? t : null, heartRate];
            if (first && full.length > 0) p.push(1);
            if (prev) km += dist(prev, p) / 1000;
            if (p[5] === 1) {
                el.reset();
                segmentAltitudeCount = 0;
            }
            if (p[2] !== null) segmentAltitudeCount++;
            el.add(p[2]);
            full.push(p);
            prev = p;
            first = false;
        });
        if (segmentAltitudeCount >= 2) hasElevationData = true;
    });
    if (full.length < 2) throw new Error('no contiene ningún track válido');

    let stored = full;
    if (full.length > 20000) { // evita guardar tracks gigantes
        const k = Math.ceil(full.length / 20000);
        stored = full.filter((p, i) => i % k === 0 || p[5] === 1 || i === full.length - 1);
    }
    const heartRates = full.map(point => point[4]).filter(value => Number.isFinite(value) && value > 0);
    const trackStartedAt = full.reduce((earliest, point) => {
        const timestamp = point[3];
        if (timestamp == null || !Number.isFinite(timestamp) || timestamp <= 0
            || !Number.isFinite(new Date(timestamp).getTime())) return earliest;
        return earliest === null || timestamp < earliest ? timestamp : earliest;
    }, null);
    return {
        id: Date.now(),
        kind: 'imported',
        name: routeName,
        createdBy: Cloud.email || 'Usuario local',
        startedAt: trackStartedAt === null ? null : new Date(trackStartedAt).toISOString(),
        movingTimeSec: 0,
        distanceKm: +km.toFixed(3),
        elevationGain: hasElevationData ? Math.round(el.gain) : null,
        hrAvg: heartRates.length
            ? Math.round(heartRates.reduce((sum, value) => sum + value, 0) / heartRates.length)
            : null,
        description: String(parsed.description || ''),
        points: stored
    };
}

// ============================================================
