'use strict';

        // ============================================================
        //  EXPORTAR / IMPORTAR GPX, KML, GEOJSON
        // ============================================================
        function routeToGpx(r) {
            const out = [
                '<?xml version="1.0" encoding="UTF-8"?>',
                '<gpx version="1.1" creator="MTB CAMBOYA" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">',
                `<metadata><name>${xmlEsc(r.name)}</name></metadata>`,
                `<trk><name>${xmlEsc(r.name)}</name>`
            ];
            r.points.forEach((p, i) => {
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
            if (r.points.length) out.push('</trkseg>');
            out.push('</trk>', '</gpx>');
            return out.join('\n');
        }

        // Devuelve { name, segs: [ [ [lat, lon, alt|null, tMs|null], ... ], ... ] }
        function parseTrack(text, fname) {
            let name = fname.replace(/\.[^.]+$/, '');
            const segs = [];
            const trimmed = text.trim();

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
                const conv = line => line.map(c => [c[1], c[0], c.length > 2 ? c[2] : null, null]);
                geoms.forEach(g => {
                    if (g.type === 'LineString') segs.push(conv(g.coordinates));
                    else if (g.type === 'MultiLineString') g.coordinates.forEach(l => segs.push(conv(l)));
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
                        segs.push(co.textContent.trim().split(/\s+/).map(s => {
                            const [lon, lat, alt] = s.split(',').map(Number);
                            return [lat, lon, Number.isFinite(alt) && alt !== 0 ? alt : null, null];
                        }));
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
                    if (trksegs.length) {
                        trksegs.forEach(s => segs.push(Array.from(s.getElementsByTagName('trkpt')).map(readPt)));
                    } else {
                        Array.from(doc.getElementsByTagName('rte')).forEach(r =>
                            segs.push(Array.from(r.getElementsByTagName('rtept')).map(readPt)));
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
                    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
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
                startedAt: new Date().toISOString(),
                movingTimeSec: 0,
                distanceKm: +km.toFixed(3),
                elevationGain: Math.round(el.gain),
                hrAvg: null,
                points: stored
            };
        }

