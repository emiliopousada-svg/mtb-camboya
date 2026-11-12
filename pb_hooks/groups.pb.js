// Grupos globales para MTB Camboya. Cada ruta es autocontenida para PocketBase JSVM.
const SAFE_ID_RE = /^[A-Za-z0-9_-]+$/;
const SAFE_INVITE_RE = /^[A-Z0-9]{12}$/;

function requireSafeValue(value, label, pattern = SAFE_ID_RE) {
    const str = String(value ?? "").trim();
    if (!str || !pattern.test(str)) {
        throw new Error(`${label} inválido`);
    }
    return str;
}

function requireNickname(value) {
    const nickname = String(value || "").trim().slice(0, 32);
    if (!nickname) throw new Error("Escribe un apodo para que los miembros del grupo puedan identificarte.");
    return nickname;
}

function safeMembership(groupId, userId) {
    const safeGroupId = requireSafeValue(groupId, "groupId");
    const safeUserId = requireSafeValue(userId, "userId");
    return $app.findRecordsByFilter("mtb_group_members", 'group = "' + safeGroupId + '" && user = "' + safeUserId + '"', "", 1, 0);
}

routerAdd("POST", "/api/mtb/groups/create", (e) => {
    let group = null;
    try {
        const body = new DynamicModel({ name: "", nickname: "" });
        e.bindBody(body);
        const user = $app.findRecordById("users", e.auth.id);
        const name = String(body.name || "").trim().slice(0, 40);
        if (!name) return e.json(400, { message: "Escribe un nombre para el grupo." });
        const nickname = requireNickname(body.nickname);

        group = new Record($app.findCollectionByNameOrId("mtb_groups"));
        group.set("name", name);
        group.set("owner", user.id);
        group.set("inviteCode", $security.randomString(12).toUpperCase());
        $app.save(group);

        const memberships = safeMembership(group.id, user.id);
        if (!memberships.length) {
            const membership = new Record($app.findCollectionByNameOrId("mtb_group_members"));
            membership.set("group", requireSafeValue(group.id, "groupId"));
            membership.set("user", requireSafeValue(user.id, "userId"));
            membership.set("nickname", nickname);
            $app.save(membership);
        }
        user.set("groupCode", group.id);
        $app.save(user);

        return e.json(200, { group: { id: group.id, name: group.getString("name"), isAdmin: true, inviteCode: group.getString("inviteCode") } });
    } catch (err) {
        if (group) { try { $app.delete(group); } catch (_) {} }
        return e.json(400, { message: err.message || "No se pudo crear el grupo." });
    }
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/mtb/groups/join", (e) => {
    try {
        const body = new DynamicModel({ code: "", nickname: "" });
        e.bindBody(body);
        const code = String(body.code || "").trim().toUpperCase();
        if (!SAFE_INVITE_RE.test(code)) return e.json(400, { message: "El código de invitación no es válido." });
        const nickname = requireNickname(body.nickname);
        const group = $app.findFirstRecordByFilter("mtb_groups", 'inviteCode = "' + code + '"');
        const user = $app.findRecordById("users", e.auth.id);
        const memberships = safeMembership(group.id, user.id);
        if (memberships.length) {
            memberships[0].set("nickname", nickname);
            $app.save(memberships[0]);
        } else {
            const membership = new Record($app.findCollectionByNameOrId("mtb_group_members"));
            membership.set("group", requireSafeValue(group.id, "groupId"));
            membership.set("user", requireSafeValue(user.id, "userId"));
            membership.set("nickname", nickname);
            $app.save(membership);
        }
        user.set("groupCode", group.id);
        $app.save(user);
        const isAdmin = group.getString("owner") === user.id;
        const response = { id: group.id, name: group.getString("name"), isAdmin };
        if (isAdmin) response.inviteCode = group.getString("inviteCode");
        return e.json(200, { group: response });
    } catch (err) {
        return e.json(400, { message: err.message || "No se pudo encontrar el grupo." });
    }
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/mtb/groups/select", (e) => {
    try {
        const body = new DynamicModel({ groupId: "", nickname: "" });
        e.bindBody(body);
        const user = $app.findRecordById("users", e.auth.id);
        const groupId = requireSafeValue(body.groupId, "groupId");
        const nickname = requireNickname(body.nickname);
        const memberships = safeMembership(groupId, user.id);
        if (!memberships.length) return e.json(403, { message: "Ya no tienes autorización para entrar en este grupo." });
        memberships[0].set("nickname", nickname);
        $app.save(memberships[0]);
        const group = $app.findRecordById("mtb_groups", groupId);
        user.set("groupCode", groupId);
        $app.save(user);
        const isAdmin = group.getString("owner") === user.id;
        const response = { id: group.id, name: group.getString("name"), isAdmin };
        if (isAdmin) response.inviteCode = group.getString("inviteCode");
        return e.json(200, { group: response });
    } catch (err) {
        return e.json(400, { message: err.message || "No se pudo activar el grupo." });
    }
}, $apis.requireAuth("users"));

routerAdd("GET", "/api/mtb/groups/my", (e) => {
    try {
        const user = $app.findRecordById("users", e.auth.id);
        const safeUserId = requireSafeValue(user.id, "userId");
        const memberships = $app.findRecordsByFilter("mtb_group_members", 'user = "' + safeUserId + '"', "", 200, 0);
        const groups = [];
        for (const membership of memberships) {
            try {
                const group = $app.findRecordById("mtb_groups", membership.getString("group"));
                const isAdmin = group.getString("owner") === user.id;
                const item = { id: group.id, name: group.getString("name"), isAdmin, nickname: membership.getString("nickname") };
                if (isAdmin) item.inviteCode = group.getString("inviteCode");
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
        const user = $app.findRecordById("users", e.auth.id);
        const groupId = user.getString("groupCode");
        if (!groupId) return e.json(404, { message: "No hay un grupo activo." });
        const safeGroupId = requireSafeValue(groupId, "groupId");
        const group = $app.findRecordById("mtb_groups", safeGroupId);
        if (group.getString("owner") !== user.id) return e.json(403, { message: "Solo el administrador puede ver y gestionar los miembros." });
        const memberships = $app.findRecordsByFilter("mtb_group_members", 'group = "' + safeGroupId + '"', "", 200, 0);
        const members = memberships.map((membership) => ({
            userId: membership.getString("user"),
            nickname: membership.getString("nickname") || "Apodo pendiente",
            isAdmin: membership.getString("user") === user.id
        }));
        return e.json(200, { members });
    } catch (err) {
        return e.json(400, { message: err.message || "No se pudieron cargar los miembros." });
    }
}, $apis.requireAuth("users"));

routerAdd("GET", "/api/mtb/groups/live", (e) => {
    try {
        const user = $app.findRecordById("users", e.auth.id);
        const groupId = user.getString("groupCode");
        if (!groupId) return e.json(404, { message: "No hay un grupo activo." });
        const safeGroupId = requireSafeValue(groupId, "groupId");
        if (!safeMembership(safeGroupId, user.id).length) {
            return e.json(403, { message: "Ya no tienes autorización para consultar este grupo." });
        }
        const locations = $app.findRecordsByFilter("live_locations", 'groupCode = "' + safeGroupId + '"', "-updated", 200, 0);
        const items = locations.map((location) => {
            const owner = location.getString("owner");
            const item = {
                id: location.id,
                owner,
                groupCode: location.getString("groupCode"),
                name: location.getString("name"),
                lat: location.getFloat("lat"),
                lon: location.getFloat("lon"),
                accuracy: location.getFloat("accuracy"),
                updated: location.getString("updated")
            };
            try { item.avatar = $app.findRecordById("users", owner).getString("avatar"); } catch (_) {}
            return item;
        });
        return e.json(200, { items });
    } catch (err) {
        return e.json(400, { message: err.message || "No se pudieron cargar las posiciones del grupo." });
    }
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/mtb/groups/rotate-invite", (e) => {
    try {
        const user = $app.findRecordById("users", e.auth.id);
        const groupId = user.getString("groupCode");
        if (!groupId) return e.json(404, { message: "No hay un grupo activo." });
        const safeGroupId = requireSafeValue(groupId, "groupId");
        const group = $app.findRecordById("mtb_groups", safeGroupId);
        if (group.getString("owner") !== user.id) return e.json(403, { message: "Solo el administrador puede renovar la invitación." });
        group.set("inviteCode", $security.randomString(12).toUpperCase());
        $app.save(group);
        return e.json(200, { group: { id: group.id, name: group.getString("name"), isAdmin: true, inviteCode: group.getString("inviteCode") } });
    } catch (err) {
        return e.json(400, { message: err.message || "No se pudo renovar la invitación." });
    }
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/mtb/groups/revoke", (e) => {
    try {
        const body = new DynamicModel({ userId: "" });
        e.bindBody(body);
        const user = $app.findRecordById("users", e.auth.id);
        const groupId = user.getString("groupCode");
        if (!groupId) return e.json(404, { message: "No hay un grupo activo." });
        const safeGroupId = requireSafeValue(groupId, "groupId");
        const group = $app.findRecordById("mtb_groups", safeGroupId);
        if (group.getString("owner") !== user.id) return e.json(403, { message: "Solo el administrador puede revocar miembros." });
        const targetId = requireSafeValue(body.userId, "userId");
        if (targetId === user.id) return e.json(400, { message: "El administrador no puede revocarse a sí mismo." });
        const memberships = safeMembership(safeGroupId, targetId);
        if (!memberships.length) return e.json(404, { message: "Ese miembro ya no pertenece al grupo." });
        const target = $app.findRecordById("users", targetId);
        if (target.getString("groupCode") === safeGroupId) { target.set("groupCode", ""); $app.save(target); }
        const locations = $app.findRecordsByFilter("live_locations", 'owner = "' + targetId + '" && groupCode = "' + safeGroupId + '"', "", 500, 0);
        for (const location of locations) $app.delete(location);
        $app.delete(memberships[0]);
        const newInviteCode = $security.randomString(12).toUpperCase();
        group.set("inviteCode", newInviteCode);
        $app.save(group);
        return e.json(200, { ok: true, inviteCode: newInviteCode });
    } catch (err) {
        return e.json(400, { message: err.message || "No se pudo revocar el acceso." });
    }
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/mtb/groups/leave", (e) => {
    try {
        const user = $app.findRecordById("users", e.auth.id);
        const groupId = user.getString("groupCode");
        if (!groupId) return e.json(200, { ok: true });
        const safeGroupId = requireSafeValue(groupId, "groupId");
        const locations = $app.findRecordsByFilter("live_locations", 'owner = "' + user.id + '" && groupCode = "' + safeGroupId + '"', "", 500, 0);
        for (const location of locations) $app.delete(location);
        user.set("groupCode", "");
        $app.save(user);
        return e.json(200, { ok: true, retained: true });
    } catch (err) {
        return e.json(400, { message: err.message || "No se pudo salir del grupo." });
    }
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/mtb/groups/delete", (e) => {
    try {
        const user = $app.findRecordById("users", e.auth.id);
        const groupId = user.getString("groupCode");
        if (!groupId) return e.json(404, { message: "No hay un grupo activo." });
        const safeGroupId = requireSafeValue(groupId, "groupId");
        const group = $app.findRecordById("mtb_groups", safeGroupId);
        if (group.getString("owner") !== user.id) return e.json(403, { message: "Solo el administrador puede eliminar el grupo." });
        const memberships = $app.findRecordsByFilter("mtb_group_members", 'group = "' + safeGroupId + '"', "", 500, 0);
        for (const membership of memberships) {
            const memberId = membership.getString("user");
            try {
                const member = $app.findRecordById("users", memberId);
                if (member.getString("groupCode") === safeGroupId) { member.set("groupCode", ""); $app.save(member); }
            } catch (_) {}
            $app.delete(membership);
        }
        const locations = $app.findRecordsByFilter("live_locations", 'groupCode = "' + safeGroupId + '"', "", 500, 0);
        for (const location of locations) $app.delete(location);
        $app.delete(group);
        return e.json(200, { ok: true });
    } catch (err) {
        return e.json(400, { message: err.message || "No se pudo eliminar el grupo." });
    }
}, $apis.requireAuth("users"));
