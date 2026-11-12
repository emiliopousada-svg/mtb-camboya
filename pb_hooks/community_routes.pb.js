// Calcula en PocketBase la caja geográfica que usa el catálogo para filtrar candidatos.
function indexCommunityRouteBounds(e) {
    if (e.hasSuperuserAuth()) return e.next();

    let lines;
    try { lines = JSON.parse(e.record.getString("trackJson")); }
    catch (error) { throw new BadRequestError("El trazado de la ruta no es JSON válido."); }
    if (!Array.isArray(lines)) throw new BadRequestError("El trazado de la ruta no es válido.");

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
