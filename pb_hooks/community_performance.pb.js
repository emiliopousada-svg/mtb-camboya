// Normaliza la identidad pública de las marcas y rechaza tiempos fuera de rango.
// El tiempo sigue siendo una declaración del cliente: no se recibe el track privado.
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

    let distanceKm = 0;
    if (e.collection.name === "community_route_efforts") {
        const route = $app.findRecordById("community_routes", e.record.getString("route"));
        if (!route.getBool("published")) throw new BadRequestError("La ruta no está publicada.");
        distanceKm = Number(route.get("distanceKm"));
    } else {
        const segment = $app.findRecordById("community_segments", e.record.getString("segment"));
        const route = $app.findRecordById("community_routes", segment.getString("route"));
        if (!route.getBool("published")) throw new BadRequestError("La ruta no está publicada.");
        distanceKm = Number(segment.get("distanceKm"));
    }

    // Evita marcas físicamente imposibles según la distancia declarada.
    const minimumSeconds = Math.max(1, Math.ceil(distanceKm * 1000 / 25));
    if (!Number.isFinite(distanceKm) || distanceKm <= 0 || elapsedSeconds < minimumSeconds) {
        throw new BadRequestError("El tiempo es demasiado corto para la distancia del recorrido.");
    }

    // No acepta el apodo enviado por el cliente; se usa un alias estable de la cuenta.
    e.record.set("alias", "Ciclista " + ownerId.toUpperCase());
    e.next();
}

onRecordCreateRequest(validateCommunityEffort, "community_route_efforts", "community_segment_efforts");
onRecordUpdateRequest(validateCommunityEffort, "community_route_efforts", "community_segment_efforts");
