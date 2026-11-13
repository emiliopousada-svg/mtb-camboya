// Utilidades de grupos. Se cargan con require() desde dentro de cada handler de groups.pb.js.
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
    if (!nickname) throw new Error("Añade un apodo a tu cuenta para que los miembros del grupo puedan identificarte.");
    return nickname;
}

function safeMembership(groupId, userId) {
    const safeGroupId = requireSafeValue(groupId, "groupId");
    const safeUserId = requireSafeValue(userId, "userId");
    return $app.findRecordsByFilter("mtb_group_members", "group = {:group} && user = {:user}", "", 1, 0, { group: safeGroupId, user: safeUserId });
}

function findAllRecordsByFilter(collection, filter, sort) {
    const records = [];
    const pageSize = 200;
    let offset = 0;
    while (true) {
        const page = $app.findRecordsByFilter(collection, filter, sort, pageSize, offset);
        records.push(...page);
        if (page.length < pageSize) return records;
        offset += page.length;
    }
}

function deleteAllRecordsByFilter(collection, filter) {
    const batchSize = 200;
    let deleted = 0;
    while (true) {
        const batch = $app.findRecordsByFilter(collection, filter, "", batchSize, 0);
        if (!batch.length) return deleted;
        for (const record of batch) {
            $app.delete(record);
            deleted++;
        }
    }
}

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

module.exports = {
    SAFE_ID_RE,
    SAFE_INVITE_RE,
    requireSafeValue,
    requireNickname,
    safeMembership,
    findAllRecordsByFilter,
    deleteAllRecordsByFilter,
    groupRankingSummaryFromEntries
};
