// Calcula en PocketBase la caja geográfica que usa el catálogo para filtrar candidatos.
const COMMUNITY_ROUTE_TRIM_METERS = 150;

function communityRouteDistance(a, b) {
    const rad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * rad;
    const dLng = (b[1] - a[1]) * rad;
    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const h = sinLat * sinLat + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * sinLng * sinLng;
    return 12742000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function communityRouteTrimStart(lines, meters) {
    const result = lines.map(line => line.map(point => point.slice()));
    let remaining = meters;
    while (result.length && remaining > 0) {
        const line = result[0];
        if (line.length < 2) { result.shift(); continue; }
        let passed = 0;
        let index = 1;
        while (index < line.length) {
            const length = communityRouteDistance(line[index - 1], line[index]);
            if (passed + length >= remaining) break;
            passed += length;
            index++;
        }
        if (index >= line.length) {
            remaining -= passed;
            result.shift();
            continue;
        }
        const a = line[index - 1];
        const b = line[index];
        const length = communityRouteDistance(a, b) || 1;
        const fraction = Math.max(0, Math.min(1, (remaining - passed) / length));
        const cut = [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction];
        result[0] = [cut].concat(line.slice(index));
        remaining = 0;
    }
    return result.filter(line => line.length > 1);
}

function communityRouteTrimEnds(lines) {
    let result = communityRouteTrimStart(lines, COMMUNITY_ROUTE_TRIM_METERS);
    result = communityRouteTrimStart(
        result.slice().reverse().map(line => line.slice().reverse()),
        COMMUNITY_ROUTE_TRIM_METERS
    ).reverse().map(line => line.slice().reverse());
    return result;
}

function indexCommunityRouteBounds(e) {
    if (e.hasSuperuserAuth()) return e.next();

    let lines;
    try { lines = JSON.parse(e.record.getString("trackJson")); }
    catch (error) { throw new BadRequestError("El trazado de la ruta no es JSON válido."); }
    if (!Array.isArray(lines)) throw new BadRequestError("El trazado de la ruta no es válido.");

    let rawCount = 0;
    for (const line of lines) {
        if (!Array.isArray(line)) throw new BadRequestError("El trazado no es válido.");
        for (const point of line) {
            if (!Array.isArray(point) || point.length < 2) throw new BadRequestError("El trazado contiene una coordenada no válida.");
            const lat = Number(point[0]), lng = Number(point[1]);
            if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
                throw new BadRequestError("El trazado contiene una coordenada fuera de rango.");
            }
            point[0] = lat;
            point[1] = lng;
            rawCount++;
        }
    }
    if (rawCount < 2 || !lines.length || !lines[0].length || !lines[lines.length - 1].length) {
        throw new BadRequestError("El trazado debe tener al menos dos puntos.");
    }

    const firstPoint = lines[0][0];
    const lastLine = lines[lines.length - 1];
    const lastPoint = lastLine[lastLine.length - 1];
    let pois;
    try { pois = JSON.parse(e.record.getString("poisJson") || "[]"); }
    catch (error) { throw new BadRequestError("Los puntos de interés no son JSON válido."); }
    if (!Array.isArray(pois)) throw new BadRequestError("Los puntos de interés no son válidos.");
    for (const poi of pois) {
        const lat = Number(poi && poi.lat);
        const lng = Number(poi && poi.lng);
        if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
            throw new BadRequestError("Los puntos de interés contienen coordenadas no válidas.");
        }
        if (communityRouteDistance([lat, lng], firstPoint) <= COMMUNITY_ROUTE_TRIM_METERS
            || communityRouteDistance([lat, lng], lastPoint) <= COMMUNITY_ROUTE_TRIM_METERS) {
            throw new BadRequestError("Los puntos de interés deben quedar a más de 150 metros de los extremos originales.");
        }
    }

    lines = communityRouteTrimEnds(lines);
    if (!lines.length || lines.reduce((total, line) => total + line.length, 0) < 2) {
        throw new BadRequestError("La ruta es demasiado corta para publicarse después de ocultar sus extremos.");
    }
    e.record.set("trackJson", JSON.stringify(lines));

    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    let count = 0;
    for (const line of lines) {
        if (!Array.isArray(line)) throw new BadRequestError("El trazado de la ruta no es válido.");
        for (const point of line) {
            if (!Array.isArray(point) || point.length < 2) throw new BadRequestError("El trazado contiene una coordenada no válida.");
            const lat = Number(point[0]), lng = Number(point[1]);
            if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
                throw new BadRequestError("El trazado contiene una coordenada fuera de rango.");
            }
            minLat = Math.min(minLat, lat);
            maxLat = Math.max(maxLat, lat);
            minLng = Math.min(minLng, lng);
            maxLng = Math.max(maxLng, lng);
            count++;
        }
    }
    if (count < 2) throw new BadRequestError("El trazado debe tener al menos dos puntos.");

    e.record.set("minLat", minLat);
    e.record.set("maxLat", maxLat);
    e.record.set("minLng", minLng);
    e.record.set("maxLng", maxLng);
    e.next();
}

onRecordCreateRequest(indexCommunityRouteBounds, "community_routes");
onRecordUpdateRequest(indexCommunityRouteBounds, "community_routes");
