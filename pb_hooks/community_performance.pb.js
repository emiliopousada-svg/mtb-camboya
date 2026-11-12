// Normaliza la identidad pública de las marcas y rechaza tiempos fuera de rango.
// El tiempo sigue siendo una declaración del cliente: no se recibe el track privado.
function communityTrackDistanceKm(trackJson) {
    let lines;
    try { lines = JSON.parse(trackJson); }
    catch (error) { throw new BadRequestError("El trazado del recorrido no es JSON válido."); }
    if (!Array.isArray(lines)) throw new BadRequestError("El trazado del recorrido no es válido.");

    const radians = Math.PI / 180;
    let distanceMeters = 0;
    let pointCount = 0;
    for (const line of lines) {
        if (!Array.isArray(line)) throw new BadRequestError("El trazado del recorrido no es válido.");
        let previous = null;
        for (const point of line) {
            if (!Array.isArray(point) || point.length < 2) {
                throw new BadRequestError("El trazado contiene una coordenada no válida.");
            }
            const lat = Number(point[0]);
            const lng = Number(point[1]);
            if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
                throw new BadRequestError("El trazado contiene una coordenada fuera de rango.");
            }
            if (previous) {
                const lat1 = previous[0] * radians;
                const lat2 = lat * radians;
                const deltaLat = (lat - previous[0]) * radians;
                const deltaLng = (lng - previous[1]) * radians;
                const h = Math.sin(deltaLat / 2) ** 2 +
                    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
                distanceMeters += 6371008.8 * 2 * Math.atan2(Math.sqrt(Math.min(1, h)), Math.sqrt(Math.max(0, 1 - h)));
            }
            previous = [lat, lng];
            pointCount++;
        }
    }

    if (pointCount < 2 || !Number.isFinite(distanceMeters) || distanceMeters <= 0) {
        throw new BadRequestError("El trazado debe contener al menos dos puntos distintos.");
    }
    return distanceMeters / 1000;
}

function validateCommunityEffort(e) {
    if (e.hasSuperuserAuth()) return e.next();
    if (!e.auth) throw new BadRequestError("Inicia sesión para publicar una marca.");

    const ownerId = e.auth.id;
    if (e.record.getString("owner") !== ownerId) {
        throw new BadRequestError("El propietario de la marca no coincide con la sesión.");
    }

    const elapsedSeconds = Number(e.record.get("elapsedSeconds"));
    if (!Number.isInteger(elapsedSeconds) || elapsedSeconds < 1 || elapsedSeconds > 86400) {
        throw new BadRequestError("El tiempo debe estar entre 1 segundo y 24 horas.");
    }

    let trackJson = "";
    if (e.collection.name === "community_route_efforts") {
        const route = $app.findRecordById("community_routes", e.record.getString("route"));
        if (!route.getBool("published")) throw new BadRequestError("La ruta no está publicada.");
        trackJson = route.getString("trackJson");
    } else {
        const segment = $app.findRecordById("community_segments", e.record.getString("segment"));
        const route = $app.findRecordById("community_routes", segment.getString("route"));
        if (!route.getBool("published")) throw new BadRequestError("La ruta no está publicada.");
        trackJson = segment.getString("trackJson");
    }

    const distanceKm = communityTrackDistanceKm(trackJson);
    const minimumSeconds = Math.max(1, Math.ceil(distanceKm * 1000 / 25));
    if (elapsedSeconds < minimumSeconds) {
        throw new BadRequestError("El tiempo es demasiado corto para la distancia del recorrido.");
    }

    // No acepta el apodo enviado por el cliente; se usa un alias estable de la cuenta.
    e.record.set("alias", "Ciclista " + ownerId.toUpperCase());
    e.next();
}

onRecordCreateRequest(validateCommunityEffort, "community_route_efforts", "community_segment_efforts");
onRecordUpdateRequest(validateCommunityEffort, "community_route_efforts", "community_segment_efforts");
