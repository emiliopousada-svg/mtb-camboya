// Grupos globales para MTB Camboya. Los helpers viven en groups_utils.js (cada handler se ejecuta aislado).

routerAdd("POST", "/api/mtb/groups/create", (e) => {
    const { SAFE_INVITE_RE, requireSafeValue, requireNickname, safeMembership } = require(`${__hooks}/groups_utils.js`);
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
    const { SAFE_INVITE_RE, requireSafeValue, requireNickname, safeMembership } = require(`${__hooks}/groups_utils.js`);
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
    const { SAFE_INVITE_RE, requireSafeValue, requireNickname, safeMembership } = require(`${__hooks}/groups_utils.js`);
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
    const { SAFE_INVITE_RE, requireSafeValue, requireNickname, safeMembership, findAllRecordsByFilter } = require(`${__hooks}/groups_utils.js`);
    try {
        const user = $app.findRecordById("users", e.auth.id);
        const safeUserId = requireSafeValue(user.id, "userId");
        const memberships = findAllRecordsByFilter("mtb_group_members", 'user = "' + safeUserId + '"', "");
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
    const { SAFE_INVITE_RE, requireSafeValue, requireNickname, safeMembership, findAllRecordsByFilter } = require(`${__hooks}/groups_utils.js`);
    try {
        const user = $app.findRecordById("users", e.auth.id);
        const groupId = user.getString("groupCode");
        if (!groupId) return e.json(404, { message: "No hay un grupo activo." });
        const safeGroupId = requireSafeValue(groupId, "groupId");
        const group = $app.findRecordById("mtb_groups", safeGroupId);
        if (group.getString("owner") !== user.id) return e.json(403, { message: "Solo el administrador puede ver y gestionar los miembros." });
        const memberships = findAllRecordsByFilter("mtb_group_members", 'group = "' + safeGroupId + '"', "");
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
    const { SAFE_INVITE_RE, requireSafeValue, requireNickname, safeMembership, findAllRecordsByFilter } = require(`${__hooks}/groups_utils.js`);
    try {
        const user = $app.findRecordById("users", e.auth.id);
        const groupId = user.getString("groupCode");
        if (!groupId) return e.json(404, { message: "No hay un grupo activo." });
        const safeGroupId = requireSafeValue(groupId, "groupId");
        if (!safeMembership(safeGroupId, user.id).length) {
            return e.json(403, { message: "Ya no tienes autorización para consultar este grupo." });
        }
        const locations = findAllRecordsByFilter("live_locations", 'groupCode = "' + safeGroupId + '"', "-updated");
        const items = locations.map((location) => {
            const owner = location.getString("owner");
            const item = {
                id: location.id,
                owner,
                groupCode: location.getString("groupCode"),
                name: location.getString("name"),
                nickname: "",
                lat: location.getFloat("lat"),
                lon: location.getFloat("lon"),
                accuracy: location.getFloat("accuracy"),
                updated: location.getString("updated")
            };
            try {
                const profile = $app.findRecordById("users", owner);
                item.nickname = profile.getString("nickname").trim();
                if (item.nickname) item.name = item.nickname;
            } catch (_) {}
            try { item.avatar = $app.findRecordById("users", owner).getString("avatar"); } catch (_) {}
            return item;
        });
        return e.json(200, { items });
    } catch (err) {
        return e.json(400, { message: err.message || "No se pudieron cargar las posiciones del grupo." });
    }
}, $apis.requireAuth("users"));

function groupRankingSummaryFromEntries(entries) {
    const rankings = {};
    entries.forEach((entry) => {
        const owner = entry.getString("owner");
        const ranking = rankings[owner] || {
            maxDistanceKm: 0,
            distanceMovingTimeSec: 0,
            bestMovingTimeSec: 0,
            maxSpeedKmh: 0
        };
        const distanceKm = entry.getFloat("distanceKm");
        const movingTimeSec = entry.getFloat("movingTimeSec");
        const maxSpeedKmh = entry.getFloat("maxSpeedKmh");
        if (distanceKm > ranking.maxDistanceKm) {
            ranking.maxDistanceKm = distanceKm;
            ranking.distanceMovingTimeSec = movingTimeSec;
        }
        if (movingTimeSec > ranking.bestMovingTimeSec) ranking.bestMovingTimeSec = movingTimeSec;
        if (maxSpeedKmh > ranking.maxSpeedKmh) ranking.maxSpeedKmh = maxSpeedKmh;
        rankings[owner] = ranking;
    });
    return rankings;
}

routerAdd("GET", "/api/mtb/groups/rankings", (e) => {
    const { requireSafeValue, safeMembership, findAllRecordsByFilter } = require(`${__hooks}/groups_utils.js`);
    try {
        const user = $app.findRecordById("users", e.auth.id);
        const groupId = user.getString("groupCode");
        if (!groupId) return e.json(404, { message: "No hay un grupo activo." });
        const safeGroupId = requireSafeValue(groupId, "groupId");
        if (!safeMembership(safeGroupId, user.id).length) {
            return e.json(403, { message: "Ya no tienes autorización para consultar este grupo." });
        }

        const memberships = findAllRecordsByFilter("mtb_group_members", 'group = "' + safeGroupId + '"', "");
        const entries = findAllRecordsByFilter("mtb_group_ranking_entries", 'group = "' + safeGroupId + '"', "");
        const rankingsByUser = groupRankingSummaryFromEntries(entries);
        const members = memberships.map((membership) => {
            const userId = membership.getString("user");
            const ranking = rankingsByUser[userId] || {};
            return {
                userId,
                nickname: membership.getString("nickname") || "Apodo pendiente",
                isMe: userId === user.id,
                maxDistanceKm: ranking.maxDistanceKm ?? null,
                distanceMovingTimeSec: ranking.distanceMovingTimeSec ?? null,
                bestMovingTimeSec: ranking.bestMovingTimeSec ?? null,
                maxSpeedKmh: ranking.maxSpeedKmh ?? null
            };
        });
        return e.json(200, {
            group: { id: safeGroupId, name: $app.findRecordById("mtb_groups", safeGroupId).getString("name") },
            members
        });
    } catch (err) {
        return e.json(400, { message: err.message || "No se pudo cargar el ranking del grupo." });
    }
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/mtb/groups/rankings/share", (e) => {
    const { requireSafeValue, safeMembership, findAllRecordsByFilter } = require(`${__hooks}/groups_utils.js`);
    try {
        const body = new DynamicModel({ clientId: 0, distanceKm: 0.1, movingTimeSec: 0.1, maxSpeedKmh: 0.1 });
        e.bindBody(body);
        const clientId = Number(body.clientId);
        const distanceKm = Number(body.distanceKm);
        const movingTimeSec = Number(body.movingTimeSec);
        const maxSpeedKmh = Number(body.maxSpeedKmh);
        if (!Number.isFinite(clientId) || clientId <= 0 || Math.floor(clientId) !== clientId || clientId > 9007199254740991
            || !Number.isFinite(distanceKm) || distanceKm < 0 || distanceKm > 1000
            || !Number.isFinite(movingTimeSec) || movingTimeSec < 0 || movingTimeSec > 604800
            || !Number.isFinite(maxSpeedKmh) || maxSpeedKmh < 0 || maxSpeedKmh > 150
            || (distanceKm === 0 && maxSpeedKmh === 0)) {
            return e.json(400, { message: "Las marcas de la actividad no son válidas." });
        }

        const user = $app.findRecordById("users", e.auth.id);
        const groupId = user.getString("groupCode");
        if (!groupId) return e.json(404, { message: "No hay un grupo activo." });
        const safeGroupId = requireSafeValue(groupId, "groupId");
        if (!safeMembership(safeGroupId, user.id).length) {
            return e.json(403, { message: "Ya no tienes autorización para compartir marcas en este grupo." });
        }

        const filter = 'group = "' + safeGroupId + '" && owner = "' + user.id + '"';
        const existingEntries = findAllRecordsByFilter("mtb_group_ranking_entries", filter, "");
        const previousRanking = groupRankingSummaryFromEntries(existingEntries)[user.id] || {
            maxDistanceKm: 0,
            bestMovingTimeSec: 0,
            maxSpeedKmh: 0
        };
        const existing = $app.findRecordsByFilter(
            "mtb_group_ranking_entries",
            "group = {:group} && owner = {:owner} && clientId = {:clientId}",
            "",
            1,
            0,
            { group: safeGroupId, owner: user.id, clientId }
        );
        const entry = existing.length ? existing[0] : new Record($app.findCollectionByNameOrId("mtb_group_ranking_entries"));
        entry.set("group", safeGroupId);
        entry.set("owner", user.id);
        entry.set("clientId", clientId);
        entry.set("distanceKm", distanceKm);
        entry.set("movingTimeSec", movingTimeSec);
        entry.set("maxSpeedKmh", maxSpeedKmh);
        $app.save(entry);

        const entriesAfter = existingEntries.filter(item => item.getFloat("clientId") !== clientId);
        entriesAfter.push(entry);
        const ranking = groupRankingSummaryFromEntries(entriesAfter)[user.id];
        return e.json(200, {
            maxDistanceKm: ranking.maxDistanceKm,
            distanceMovingTimeSec: ranking.distanceMovingTimeSec,
            bestMovingTimeSec: ranking.bestMovingTimeSec,
            maxSpeedKmh: ranking.maxSpeedKmh,
            newDistanceRecord: distanceKm > previousRanking.maxDistanceKm,
            newTimeRecord: movingTimeSec > previousRanking.bestMovingTimeSec,
            newSpeedRecord: maxSpeedKmh > previousRanking.maxSpeedKmh
        });
    } catch (err) {
        return e.json(400, { message: err.message || "No se pudieron compartir las marcas de la actividad." });
    }
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/mtb/groups/rankings/delete", (e) => {
    const { requireSafeValue, findAllRecordsByFilter } = require(`${__hooks}/groups_utils.js`);
    try {
        const body = new DynamicModel({ clientId: 0 });
        e.bindBody(body);
        const clientId = Number(body.clientId);
        if (!Number.isFinite(clientId) || clientId <= 0 || Math.floor(clientId) !== clientId || clientId > 9007199254740991) {
            return e.json(400, { message: "El identificador de la actividad no es válido." });
        }
        const userId = requireSafeValue(e.auth.id, "owner");
        const entries = findAllRecordsByFilter(
            "mtb_group_ranking_entries",
            'owner = "' + userId + '" && clientId = ' + clientId,
            ""
        );
        entries.forEach((entry) => $app.delete(entry));
        return e.json(200, { deleted: entries.length });
    } catch (err) {
        return e.json(400, { message: err.message || "No se pudo retirar la marca de la actividad." });
    }
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/mtb/groups/rotate-invite", (e) => {
    const { SAFE_INVITE_RE, requireSafeValue, requireNickname, safeMembership } = require(`${__hooks}/groups_utils.js`);
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
    const { SAFE_INVITE_RE, requireSafeValue, requireNickname, safeMembership, deleteAllRecordsByFilter } = require(`${__hooks}/groups_utils.js`);
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
        deleteAllRecordsByFilter("live_locations", 'owner = "' + targetId + '" && groupCode = "' + safeGroupId + '"');
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
    const { SAFE_INVITE_RE, requireSafeValue, requireNickname, safeMembership, deleteAllRecordsByFilter } = require(`${__hooks}/groups_utils.js`);
    try {
        const user = $app.findRecordById("users", e.auth.id);
        const groupId = user.getString("groupCode");
        if (!groupId) return e.json(200, { ok: true });
        const safeGroupId = requireSafeValue(groupId, "groupId");
        deleteAllRecordsByFilter("live_locations", 'owner = "' + user.id + '" && groupCode = "' + safeGroupId + '"');
        user.set("groupCode", "");
        $app.save(user);
        return e.json(200, { ok: true, retained: true });
    } catch (err) {
        return e.json(400, { message: err.message || "No se pudo salir del grupo." });
    }
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/mtb/groups/delete", (e) => {
    const { SAFE_INVITE_RE, requireSafeValue, requireNickname, safeMembership, deleteAllRecordsByFilter } = require(`${__hooks}/groups_utils.js`);
    try {
        const user = $app.findRecordById("users", e.auth.id);
        const groupId = user.getString("groupCode");
        if (!groupId) return e.json(404, { message: "No hay un grupo activo." });
        const safeGroupId = requireSafeValue(groupId, "groupId");
        const group = $app.findRecordById("mtb_groups", safeGroupId);
        if (group.getString("owner") !== user.id) return e.json(403, { message: "Solo el administrador puede eliminar el grupo." });
        while (true) {
            const memberships = $app.findRecordsByFilter("mtb_group_members", 'group = "' + safeGroupId + '"', "", 200, 0);
            if (!memberships.length) break;
            for (const membership of memberships) {
                const member = $app.findRecordById("users", membership.getString("user"));
                if (member.getString("groupCode") === safeGroupId) { member.set("groupCode", ""); $app.save(member); }
                $app.delete(membership);
            }
        }
        deleteAllRecordsByFilter("live_locations", 'groupCode = "' + safeGroupId + '"');
        $app.delete(group);
        return e.json(200, { ok: true });
    } catch (err) {
        return e.json(400, { message: err.message || "No se pudo eliminar el grupo." });
    }
}, $apis.requireAuth("users"));
