// Gestión de grupos y autorizaciones persistentes para MTB Camboya.
// Montar esta carpeta dentro de PocketBase como /pb_hooks.
function groupPayload(group, userId) {
    const isAdmin = group.getString("owner") === userId;
    const result = { id: group.id, name: group.getString("name"), isAdmin };
    if (isAdmin) result.inviteCode = group.getString("inviteCode");
    return result;
}

function authUser(e) {
    if (!e.auth) throw new Error("Inicia sesión para gestionar grupos.");
    return $app.findRecordById("users", e.auth.id);
}

function bodyModel(e, shape) {
    const body = new DynamicModel(shape);
    e.bindBody(body);
    return body;
}

function inviteCode() {
    return $security.randomString(12).toUpperCase();
}

function memberRecord(groupId, userId) {
    const records = $app.findRecordsByFilter(
        "mtb_group_members",
        'group = "' + groupId + '" && user = "' + userId + '"',
        "",
        1,
        0
    );
    return records.length ? records[0] : null;
}

function addMember(group, user, nickname) {
    if (memberRecord(group.id, user.id)) return;
    const member = new Record($app.findCollectionByNameOrId("mtb_group_members"));
    member.set("group", group.id);
    member.set("user", user.id);
    member.set("nickname", String(nickname || "").trim().slice(0, 32));
    $app.save(member);
}

function setActiveGroup(user, groupId) {
    user.set("groupCode", groupId || "");
    $app.save(user);
}

function removeUserLocation(userId, groupId) {
    const filter = 'owner = "' + userId + '" && groupCode = "' + groupId + '"';
    const locations = $app.findRecordsByFilter("live_locations", filter, "", 500, 0);
    for (const location of locations) $app.delete(location);
}

routerAdd("POST", "/api/mtb/groups/create", (e) => {
    try {
        const body = bodyModel(e, { name: "", nickname: "" });
        const user = authUser(e);
        const name = String(body.name || "").trim().slice(0, 40);
        if (!name) return e.json(400, { message: "Escribe un nombre para el grupo." });

        const group = new Record($app.findCollectionByNameOrId("mtb_groups"));
        group.set("name", name);
        group.set("owner", user.id);
        group.set("inviteCode", inviteCode());
        $app.save(group);
        try {
            addMember(group, user, body.nickname);
            setActiveGroup(user, group.id);
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
        const body = bodyModel(e, { code: "", nickname: "" });
        const code = String(body.code || "").trim().toUpperCase();
        if (!/^[A-Z0-9]{12}$/.test(code)) return e.json(400, { message: "El código de invitación no es válido." });
        const escapedCode = code.replace(/"/g, "\\\"");
        const group = $app.findFirstRecordByFilter("mtb_groups", 'inviteCode = "' + escapedCode + '"');
        const user = authUser(e);
        // Si ya estaba autorizado, puede volver aunque el administrador haya rotado el código.
        addMember(group, user, body.nickname);
        setActiveGroup(user, group.id);
        return e.json(200, { group: groupPayload(group, user.id) });
    } catch (err) {
        return e.json(400, { message: err.message || "No se pudo encontrar el grupo." });
    }
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/mtb/groups/select", (e) => {
    try {
        const body = bodyModel(e, { groupId: "" });
        const user = authUser(e);
        const groupId = String(body.groupId || "");
        if (!groupId || !memberRecord(groupId, user.id)) return e.json(403, { message: "Ya no tienes autorización para entrar en este grupo." });
        const group = $app.findRecordById("mtb_groups", groupId);
        setActiveGroup(user, groupId);
        return e.json(200, { group: groupPayload(group, user.id) });
    } catch (err) {
        return e.json(400, { message: err.message || "No se pudo activar el grupo." });
    }
}, $apis.requireAuth("users"));

routerAdd("GET", "/api/mtb/groups/my", (e) => {
    try {
        const user = authUser(e);
        const memberships = $app.findRecordsByFilter(
            "mtb_group_members",
            'user = "' + user.id + '"',
            "",
            200,
            0
        );
        const groups = [];
        for (const membership of memberships) {
            try {
                const group = $app.findRecordById("mtb_groups", membership.getString("group"));
                const item = groupPayload(group, user.id);
                item.nickname = membership.getString("nickname");
                groups.push(item);
            } catch (_) {}
        }
        return e.json(200, { groups, activeGroupId: user.getString("groupCode") });
    } catch (err) {
        return e.json(401, { message: err.message || "Inicia sesión." });
    }
}, $apis.requireAuth("users"));

routerAdd("GET", "/api/mtb/groups/members", (e) => {
    try {
        const user = authUser(e);
        const groupId = user.getString("groupCode");
        if (!groupId) return e.json(404, { message: "No hay un grupo activo." });
        const group = $app.findRecordById("mtb_groups", groupId);
        if (group.getString("owner") !== user.id) return e.json(403, { message: "Solo el administrador puede ver y gestionar los miembros." });
        const memberships = $app.findRecordsByFilter(
            "mtb_group_members",
            'group = "' + groupId + '"',
            "",
            200
        );
        const members = memberships.map((membership) => ({
            userId: membership.getString("user"),
            nickname: membership.getString("nickname") || "Miembro",
            isAdmin: membership.getString("user") === user.id
        }));
        return e.json(200, { members });
    } catch (err) {
        return e.json(400, { message: err.message || "No se pudieron cargar los miembros." });
    }
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/mtb/groups/rotate-invite", (e) => {
    try {
        const user = authUser(e);
        const groupId = user.getString("groupCode");
        if (!groupId) return e.json(404, { message: "No hay un grupo activo." });
        const group = $app.findRecordById("mtb_groups", groupId);
        if (group.getString("owner") !== user.id) return e.json(403, { message: "Solo el administrador puede renovar la invitación." });
        group.set("inviteCode", inviteCode());
        $app.save(group);
        return e.json(200, { group: groupPayload(group, user.id) });
    } catch (err) {
        return e.json(400, { message: err.message || "No se pudo renovar la invitación." });
    }
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/mtb/groups/revoke", (e) => {
    try {
        const body = bodyModel(e, { userId: "" });
        const user = authUser(e);
        const groupId = user.getString("groupCode");
        if (!groupId) return e.json(404, { message: "No hay un grupo activo." });
        const group = $app.findRecordById("mtb_groups", groupId);
        if (group.getString("owner") !== user.id) return e.json(403, { message: "Solo el administrador puede revocar miembros." });
        const targetId = String(body.userId || "");
        if (!targetId || targetId === user.id) return e.json(400, { message: "El administrador no puede revocarse a sí mismo." });
        const membership = memberRecord(groupId, targetId);
        if (!membership) return e.json(404, { message: "Ese miembro ya no pertenece al grupo." });
        const target = $app.findRecordById("users", targetId);
        if (target.getString("groupCode") === groupId) setActiveGroup(target, "");
        removeUserLocation(targetId, groupId);
        $app.delete(membership);
        return e.json(200, { ok: true });
    } catch (err) {
        return e.json(400, { message: err.message || "No se pudo revocar el acceso." });
    }
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/mtb/groups/leave", (e) => {
    try {
        const user = authUser(e);
        const groupId = user.getString("groupCode");
        if (!groupId) return e.json(200, { ok: true });
        // Salir solo desactiva el grupo en esta cuenta; la autorización se conserva.
        removeUserLocation(user.id, groupId);
        setActiveGroup(user, "");
        return e.json(200, { ok: true, retained: true });
    } catch (err) {
        return e.json(400, { message: err.message || "No se pudo salir del grupo." });
    }
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/mtb/groups/delete", (e) => {
    try {
        const user = authUser(e);
        const groupId = user.getString("groupCode");
        if (!groupId) return e.json(404, { message: "No hay un grupo activo." });
        const group = $app.findRecordById("mtb_groups", groupId);
        if (group.getString("owner") !== user.id) return e.json(403, { message: "Solo el administrador puede eliminar el grupo." });

        const memberships = $app.findRecordsByFilter("mtb_group_members", 'group = "' + groupId + '"', "", 500, 0);
        for (const membership of memberships) {
            const memberId = membership.getString("user");
            try {
                const member = $app.findRecordById("users", memberId);
                if (member.getString("groupCode") === groupId) setActiveGroup(member, "");
            } catch (_) {}
            $app.delete(membership);
        }
        const locations = $app.findRecordsByFilter("live_locations", 'groupCode = "' + groupId + '"', "", 500, 0);
        for (const location of locations) $app.delete(location);
        $app.delete(group);
        return e.json(200, { ok: true });
    } catch (err) {
        return e.json(400, { message: err.message || "No se pudo eliminar el grupo." });
    }
}, $apis.requireAuth("users"));
