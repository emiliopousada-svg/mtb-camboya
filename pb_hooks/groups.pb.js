// Grupos globales para compartir posiciones entre usuarios autenticados.
// PocketBase 0.36.2: montar esta carpeta como /pb_hooks.
function groupPayload(record, userId) {
    return {
        id: record.id,
        name: record.getString("name"),
        inviteCode: record.getString("inviteCode"),
        isAdmin: record.getString("owner") === userId
    };
}

function getAuthUser(e) {
    if (!e.auth) throw new Error("Inicia sesión para gestionar grupos.");
    return $app.findRecordById("users", e.auth.id);
}

function readBody(e, shape) {
    const body = new DynamicModel(shape);
    e.bindBody(body);
    return body;
}

function newInviteCode() {
    return $security.randomString(12).toUpperCase();
}

routerAdd("POST", "/api/mtb/groups/create", (e) => {
    try {
        const body = readBody(e, { name: "" });
        const user = getAuthUser(e);
        if (user.getString("groupCode")) return e.json(409, { message: "Ya perteneces a un grupo. Sal de él antes de crear otro." });

        const name = String(body.name || "").trim().slice(0, 40);
        if (!name) return e.json(400, { message: "Escribe un nombre para el grupo." });

        const collection = $app.findCollectionByNameOrId("mtb_groups");
        const group = new Record(collection);
        group.set("name", name);
        group.set("owner", user.id);
        group.set("inviteCode", newInviteCode());
        $app.save(group);

        try {
            user.set("groupCode", group.id);
            $app.save(user);
        } catch (err) {
            $app.delete(group);
            throw err;
        }
        return e.json(200, { group: groupPayload(group, user.id) });
    } catch (err) {
        return e.json(400, { message: err.message || "No se pudo crear el grupo." });
    }
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/mtb/groups/join", (e) => {
    try {
        const body = readBody(e, { code: "" });
        const code = String(body.code || "").trim().toUpperCase();
        if (!/^[A-Z0-9]{12}$/.test(code)) return e.json(400, { message: "El código de invitación no es válido." });

        const user = getAuthUser(e);
        if (user.getString("groupCode")) return e.json(409, { message: "Ya perteneces a un grupo. Sal de él antes de unirte a otro." });

        const escaped = code.replace(/"/g, "\\"");
        const group = $app.findFirstRecordByFilter("mtb_groups", 'inviteCode = "' + escaped + '"');
        user.set("groupCode", group.id);
        $app.save(user);
        return e.json(200, { group: groupPayload(group, user.id) });
    } catch (err) {
        return e.json(400, { message: err.message || "No se pudo encontrar el grupo." });
    }
}, $apis.requireAuth("users"));

routerAdd("GET", "/api/mtb/groups/my", (e) => {
    try {
        const user = getAuthUser(e);
        const groupId = user.getString("groupCode");
        if (!groupId) return e.json(200, { group: null });
        try {
            const group = $app.findRecordById("mtb_groups", groupId);
            return e.json(200, { group: groupPayload(group, user.id) });
        } catch (_) {
            // Un código asignado antes de esta función todavía no pertenece a un grupo gestionable.
            return e.json(200, { group: null, legacy: true });
        }
    } catch (err) {
        return e.json(401, { message: err.message || "Inicia sesión." });
    }
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/mtb/groups/rotate-invite", (e) => {
    try {
        const user = getAuthUser(e);
        const groupId = user.getString("groupCode");
        if (!groupId) return e.json(404, { message: "No perteneces a un grupo." });
        const group = $app.findRecordById("mtb_groups", groupId);
        if (group.getString("owner") !== user.id) return e.json(403, { message: "Solo el administrador puede renovar la invitación." });
        group.set("inviteCode", newInviteCode());
        $app.save(group);
        return e.json(200, { group: groupPayload(group, user.id) });
    } catch (err) {
        return e.json(400, { message: err.message || "No se pudo renovar la invitación." });
    }
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/mtb/groups/leave", (e) => {
    try {
        const user = getAuthUser(e);
        const groupId = user.getString("groupCode");
        if (!groupId) return e.json(200, { ok: true });
        const group = $app.findRecordById("mtb_groups", groupId);
        if (group.getString("owner") === user.id) return e.json(403, { message: "El administrador debe eliminar el grupo para cerrarlo." });

        const ownLocations = $app.findRecordsByFilter("live_locations", 'owner = "' + user.id + '"', "", 200);
        for (const location of ownLocations) $app.delete(location);
        user.set("groupCode", "");
        $app.save(user);
        return e.json(200, { ok: true });
    } catch (err) {
        return e.json(400, { message: err.message || "No se pudo salir del grupo." });
    }
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/mtb/groups/delete", (e) => {
    try {
        const user = getAuthUser(e);
        const groupId = user.getString("groupCode");
        if (!groupId) return e.json(404, { message: "No perteneces a un grupo." });
        const group = $app.findRecordById("mtb_groups", groupId);
        if (group.getString("owner") !== user.id) return e.json(403, { message: "Solo el administrador puede eliminar el grupo." });

        const members = $app.findRecordsByFilter("users", 'groupCode = "' + groupId + '"', "", 500);
        for (const member of members) {
            member.set("groupCode", "");
            $app.save(member);
        }
        const locations = $app.findRecordsByFilter("live_locations", 'groupCode = "' + groupId + '"', "", 500);
        for (const location of locations) $app.delete(location);
        $app.delete(group);
        return e.json(200, { ok: true });
    } catch (err) {
        return e.json(400, { message: err.message || "No se pudo eliminar el grupo." });
    }
}, $apis.requireAuth("users"));
