// Limita la creación de puntos compartidos en instalaciones PocketBase.
// Las reglas y límites de campos siguen definidos en map_pois.json.
onRecordCreateRequest((e) => {
    const MAX_SHARED_POIS_PER_USER = 500;
    if (e.hasSuperuserAuth()) return e.next();
    if (!e.auth) throw new BadRequestError("Inicia sesión para compartir puntos del mapa.");

    const ownerId = e.auth.id;
    if (e.record.getString("owner") !== ownerId) {
        throw new BadRequestError("El propietario del punto no coincide con la sesión.");
    }

    const name = e.record.getString("name").trim();
    const lat = Number(e.record.get("lat"));
    const lng = Number(e.record.get("lng"));
    if (!name || name.length > 100 || !Number.isFinite(lat) || lat < -90 || lat > 90
        || !Number.isFinite(lng) || lng < -180 || lng > 180) {
        throw new BadRequestError("El nombre o las coordenadas del punto no son válidos.");
    }

    const count = $app.countRecords("map_pois", 'owner = "' + ownerId + '"');
    if (count >= MAX_SHARED_POIS_PER_USER) {
        throw new BadRequestError("Has alcanzado el máximo de 500 puntos compartidos.");
    }

    e.next();
}, "map_pois");
