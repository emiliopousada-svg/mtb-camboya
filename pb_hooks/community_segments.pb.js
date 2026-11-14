// Valida los segmentos comunitarios: cualquier cuenta puede crear segmentos sobre una ruta
// publicada, pero el tramo debe ser un trozo continuo del trazado real de esa ruta y el
// servidor recalcula la distancia. Una vez creado, el trazado no se puede modificar porque
// las marcas de community_segment_efforts dependen de él.
// El handler es autosuficiente (sin helpers externos) porque PocketBase ejecuta cada handler
// en un runtime aislado.
const validateCommunitySegment = (e) => {
    if (e.hasSuperuserAuth()) return e.next();
    if (!e.auth) throw new BadRequestError("Inicia sesión para publicar un segmento.");
    if (e.record.getString("owner") !== e.auth.id) {
        throw new BadRequestError("El propietario del segmento no coincide con la sesión.");
    }

    const MIN_SEGMENT_METERS = 100;
    const MATCH_TOLERANCE_DEG = 0.00001; // ≈1 m; absorbe el redondeo de coordenadas
    const radians = Math.PI / 180;
    const distance = (a, b) => {
        const dLat = (b[0] - a[0]) * radians;
        const dLng = (b[1] - a[1]) * radians;
        const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(a[0] * radians) * Math.cos(b[0] * radians) * Math.sin(dLng / 2) ** 2;
        return 6371008.8 * 2 * Math.atan2(Math.sqrt(Math.min(1, h)), Math.sqrt(Math.max(0, 1 - h)));
    };
    const parseLines = (raw, label) => {
        let lines;
        try { lines = JSON.parse(raw); }
        catch (error) { throw new BadRequestError(label + " no es JSON válido."); }
        if (!Array.isArray(lines)) throw new BadRequestError(label + " no es válido.");
        return lines.map((line) => {
            if (!Array.isArray(line)) throw new BadRequestError(label + " no es válido.");
            return line.map((point) => {
                const lat = Array.isArray(point) ? Number(point[0]) : NaN;
                const lng = Array.isArray(point) ? Number(point[1]) : NaN;
                if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
                    throw new BadRequestError(label + " contiene una coordenada no válida.");
                }
                return [lat, lng];
            });
        });
    };
    const samePoint = (a, b) =>
        Math.abs(a[0] - b[0]) <= MATCH_TOLERANCE_DEG && Math.abs(a[1] - b[1]) <= MATCH_TOLERANCE_DEG;
    const isSlice = (segment, line) => {
        for (let start = 0; start + segment.length <= line.length; start++) {
            let match = true;
            for (let i = 0; i < segment.length && match; i++) match = samePoint(segment[i], line[start + i]);
            if (match) return true;
        }
        return false;
    };

    const isUpdate = !e.record.isNew();
    if (isUpdate) {
        // En actualizaciones solo se permite cambiar el título.
        const original = e.record.original();
        if (e.record.getString("trackJson") !== original.getString("trackJson") ||
            Number(e.record.get("distanceKm")) !== Number(original.get("distanceKm"))) {
            throw new BadRequestError("El trazado de un segmento no se puede modificar; crea uno nuevo.");
        }
        return e.next();
    }

    let route;
    try { route = $app.findRecordById("community_routes", e.record.getString("route")); }
    catch (error) { throw new BadRequestError("La ruta del segmento no existe."); }
    if (!route.getBool("published")) throw new BadRequestError("La ruta no está publicada.");

    const routeLines = parseLines(route.getString("trackJson"), "El trazado de la ruta");
    const segmentLines = parseLines(e.record.getString("trackJson"), "El trazado del segmento");
    if (segmentLines.length !== 1 || segmentLines[0].length < 2) {
        throw new BadRequestError("El segmento debe ser un único tramo continuo con al menos dos puntos.");
    }
    const segment = segmentLines[0];
    const reversed = segment.slice().reverse();
    const onRoute = routeLines.some((line) => isSlice(segment, line) || isSlice(reversed, line));
    if (!onRoute) {
        throw new BadRequestError("El segmento debe ser un tramo continuo del trazado de la ruta.");
    }

    let meters = 0;
    for (let i = 1; i < segment.length; i++) meters += distance(segment[i - 1], segment[i]);
    if (!Number.isFinite(meters) || meters < MIN_SEGMENT_METERS) {
        throw new BadRequestError("El segmento debe medir al menos 100 metros.");
    }
    e.record.set("distanceKm", Math.round(meters) / 1000);
    e.next();
};

onRecordCreateRequest(validateCommunitySegment, "community_segments");
onRecordUpdateRequest(validateCommunitySegment, "community_segments");
