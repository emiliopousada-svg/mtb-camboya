// Grupos globales para MTB Camboya. Cada ruta es autocontenida para PocketBase JSVM.
routerAdd("POST", "/api/mtb/groups/create", (e) => {
    let group = null;
    try {
        const body = new DynamicModel({ name: "", nickname: "" });
        e.bindBody(body);
        const user = $app.findRecordById("users", e.auth.id);
        const name = String(body.name || "").trim().slice(0, 40);
        if (!name) return e.json(400, { message: "Escribe un nombre para el grupo." });

        group = new Record($app.findCollectionByNameOrId("mtb_groups"));
        group.set("name", name);
        group.set("owner", user.id);
        group.set("inviteCode", $security.randomString(12).toUpperCase());
        $app.save(group);

        const memberships = $app.findRecordsByFilter("mtb_group_members", 'group = "' + group.id + '" && user = "' + user.id + '"', "", 1, 0);
        if (!memberships.length) {
            const membership = new Record($app.findCollectionByNameOrId("mtb_group_members"));
            membership.set("group", group.id);
            membership.set("user", user.id);
            membership.set("nickname", String(body.nickname || "").trim().slice(0, 32));
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
        if (!/^[A-Z0-9]{12}$/.test(code)) return e.json(400, { message: "El código de invitación no es válido." });
        const group = $app.findFirstRecordByFilter("mtb_groups", 'inviteCode = "' + code + '"');
        const user = $app.findRecordById("users", e.auth.id);
        const memberships = $app.findRecordsByFilter("mtb_group_members", 'group = "' + group.id + '" && user = "' + user.id + '"', "", 1, 0);
        if (memberships.length) {
            const nickname = String(body.nickname || "").trim().slice(0, 32);
            if (nickname) { memberships[0].set("nickname", nickname); $app.save(memberships[0]); }
        } else {
            const membership = new Record($app.findCollectionByNameOrId("mtb_group_members"));
            membership.set("group", group.id);
            membership.set("user", user.id);
            membership.set("nickname", String(body.nickname || "").trim().slice(0, 32));
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
        const body = new DynamicModel({ groupId: "" });
        e.bindBody(body);
        const user = $app.findRecordById("users", e.auth.id);
        const groupId = String(body.groupId || "");
        if (!groupId) return e.json(403, { message: "Ya no tienes autorización para entrar en este grupo." });
        const memberships = $app.findRecordsByFilter("mtb_group_members", 'group = "' + groupId + '" && user = "' + user.id + '"', "", 1, 0);
        if (!memberships.length) return e.json(403, { message: "Ya no tienes autorización para entrar en este grupo." });
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
        const memberships = $app.findRecordsByFilter("mtb_group_members", 'user = "' + user.id + '"', "", 200, 0);
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
        const group = $app.findRecordById("mtb_groups", groupId);
        if (group.getString("owner") !== user.id) return e.json(403, { message: "Solo el administrador puede ver y gestionar los miembros." });
        const memberships = $app.findRecordsByFilter("mtb_group_members", 'group = "' + groupId + '"', "", 200, 0);
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
        const user = $app.findRecordById("users", e.auth.id);
        const groupId = user.getString("groupCode");
        if (!groupId) return e.json(404, { message: "No hay un grupo activo." });
        const group = $app.findRecordById("mtb_groups", groupId);
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
        const group = $app.findRecordById("mtb_groups", groupId);
        if (group.getString("owner") !== user.id) return e.json(403, { message: "Solo el administrador puede revocar miembros." });
        const targetId = String(body.userId || "");
        if (!targetId || targetId === user.id) return e.json(400, { message: "El administrador no puede revocarse a sí mismo." });
        const memberships = $app.findRecordsByFilter("mtb_group_members", 'group = "' + groupId + '" && user = "' + targetId + '"', "", 1, 0);
        if (!memberships.length) return e.json(404, { message: "Ese miembro ya no pertenece al grupo." });
        const target = $app.findRecordById("users", targetId);
        if (target.getString("groupCode") === groupId) { target.set("groupCode", ""); $app.save(target); }
        const locations = $app.findRecordsByFilter("live_locations", 'owner = "' + targetId + '" && groupCode = "' + groupId + '"', "", 500, 0);
        for (const location of locations) $app.delete(location);
        $app.delete(memberships[0]);
        return e.json(200, { ok: true });
    } catch (err) {
        return e.json(400, { message: err.message || "No se pudo revocar el acceso." });
    }
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/mtb/groups/leave", (e) => {
    try {
        const user = $app.findRecordById("users", e.auth.id);
        const groupId = user.getString("groupCode");
        if (!groupId) return e.json(200, { ok: true });
        const locations = $app.findRecordsByFilter("live_locations", 'owner = "' + user.id + '" && groupCode = "' + groupId + '"', "", 500, 0);
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
        const group = $app.findRecordById("mtb_groups", groupId);
        if (group.getString("owner") !== user.id) return e.json(403, { message: "Solo el administrador puede eliminar el grupo." });
        const memberships = $app.findRecordsByFilter("mtb_group_members", 'group = "' + groupId + '"', "", 500, 0);
        for (const membership of memberships) {
            const memberId = membership.getString("user");
            try {
                const member = $app.findRecordById("users", memberId);
                if (member.getString("groupCode") === groupId) { member.set("groupCode", ""); $app.save(member); }
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
