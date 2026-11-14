'use strict';

// Group ranking display, publishing, and offline deletion sync.
let groupRankingDeletesSyncing = false;
let groupRankingMembers = [];
const GROUP_RANKING_MEDALS = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];

function renderGroupMetricRanking(containerId, key, format) {
    const container = $(containerId);
    container.replaceChildren();
    const entries = groupRankingMembers
        .filter(member => Number.isFinite(Number(member[key])) && Number(member[key]) > 0)
        .sort((a, b) => Number(b[key]) - Number(a[key]))
        .slice(0, GROUP_RANKING_MEDALS.length);
    GROUP_RANKING_MEDALS.forEach((medalSymbol, index) => {
        const member = entries[index] || null;
        const row = document.createElement('div');
        row.className = `group-ranking-item${member ? '' : ' is-empty'}`;
        const position = document.createElement('div');
        position.className = 'group-ranking-position';
        const medal = document.createElement('span');
        medal.className = 'group-ranking-medal';
        medal.setAttribute('role', 'img');
        medal.setAttribute('aria-label', `Puesto ${index + 1}`);
        medal.textContent = medalSymbol;
        const place = document.createElement('span');
        place.className = 'group-ranking-place';
        place.textContent = `${index + 1}.º`;
        position.append(medal, place);
        const name = document.createElement('span');
        name.className = 'group-ranking-name';
        name.textContent = member ? member.nickname || 'Ciclista' : '—';
        const value = document.createElement('strong');
        value.textContent = member ? format(member) : 'Sin marca';
        row.append(position, name, value);
        container.appendChild(row);
    });
}

async function loadGroupRankings() {
    const status = $('group-ranking-status');
    if (!Cloud.loggedIn() || !groupJoined) {
        groupRankingMembers = [];
        renderGroupMetricRanking('group-ranking-distance', 'maxDistanceKm', () => '');
        renderGroupMetricRanking('group-ranking-speed', 'maxSpeedKmh', () => '');
        renderGroupMetricRanking('group-ranking-time', 'bestMovingTimeSec', () => '');
        status.textContent = 'Inicia sesión y únete a un grupo para consultar sus marcas.';
        return;
    }
    status.classList.remove('error');
    status.textContent = 'Cargando marcas del grupo…';
    groupRankingMembers = [];
    renderGroupMetricRanking('group-ranking-distance', 'maxDistanceKm', () => '');
    renderGroupMetricRanking('group-ranking-speed', 'maxSpeedKmh', () => '');
    renderGroupMetricRanking('group-ranking-time', 'bestMovingTimeSec', () => '');
    const requestedGroupId = groupName();
    try {
        const result = await cloudApi('/api/mtb/groups/rankings');
        if (groupName() !== requestedGroupId) return;
        groupRankingMembers = Array.isArray(result.members) ? result.members : [];
        renderGroupMetricRanking('group-ranking-distance', 'maxDistanceKm', member => {
            const duration = Number(member.distanceMovingTimeSec);
            return `${Number(member.maxDistanceKm).toFixed(1)} km${duration > 0 ? ` · ${fmtDur(duration)}` : ''}`;
        });
        renderGroupMetricRanking('group-ranking-speed', 'maxSpeedKmh', member => `${Number(member.maxSpeedKmh).toFixed(1)} km/h`);
        renderGroupMetricRanking('group-ranking-time', 'bestMovingTimeSec', member => fmtDur(Number(member.bestMovingTimeSec)));
        status.textContent = `${result.group.name} · marcas de todos los tiempos`;
    } catch (error) {
        console.warn('No se pudo cargar el ranking del grupo:', error);
        status.textContent = error.status === 404
            ? 'Falta instalar mtb_group_ranking_entries.json y actualizar groups.pb.js en PocketBase.'
            : `No se pudo cargar el ranking: ${error.message || 'error de conexión'}`;
        status.classList.add('error');
    }
}

async function shareRouteToGroupRanking(route, button, options = {}) {
    const automatic = options.automatic === true;
    const activeGroupId = Cloud.groupCode;
    if (!Cloud.loggedIn() || !activeGroupId || (!automatic && !groupJoined)) {
        if (!automatic) toast('Inicia sesión y selecciona un grupo para compartir marcas.');
        return false;
    }
    if (!navigator.onLine) {
        if (!automatic) toast('Necesitas conexión para compartir una marca con el grupo.');
        return false;
    }
    if (!route || route.kind !== 'recorded') {
        if (!automatic) toast('Solo se pueden compartir actividades grabadas.');
        return false;
    }
    if (automatic && route.groupRankingGroupId === activeGroupId
        && route.groupRankingServer === Cloud.server && !route.groupRankingPending) {
        return true;
    }
    const analysis = typeof statsAnalyzeRoute === 'function' ? statsAnalyzeRoute(route) : null;
    const distanceKm = analysis && Number.isFinite(analysis.distanceKm)
        ? analysis.distanceKm
        : Number(route.distanceKm) || 0;
    const movingTimeSec = analysis && !analysis.movingTimeEstimated && Number.isFinite(analysis.movingTimeSec)
        ? analysis.movingTimeSec
        : Number(route.movingTimeSec) || 0;
    const maxSpeedKmh = analysis && Number.isFinite(analysis.maxSpeed) ? analysis.maxSpeed : 0;
    if (distanceKm <= 0 && maxSpeedKmh <= 0) {
        const error = new Error('Esta actividad no tiene marcas válidas para compartir.');
        if (automatic) throw error;
        toast(error.message);
        return false;
    }
    const details = [];
    if (distanceKm > 0) details.push(`Distancia: ${distanceKm.toFixed(1)} km`);
    if (movingTimeSec > 0) details.push(`Tiempo en movimiento: ${fmtDur(movingTimeSec)}`);
    if (maxSpeedKmh > 0) details.push(`Velocidad punta: ${maxSpeedKmh.toFixed(1)} km/h`);
    if (button) button.disabled = true;
    try {
        if (!automatic) {
            const confirmed = await modal({
                message: `Compartir con «${groupInfo && groupInfo.name ? groupInfo.name : 'el grupo'}» estas marcas de la actividad:\n\n${details.join('\n')}\n\nNo se enviarán el trazado GPS, el nombre, la fecha ni la ubicación.`,
                ok: 'Compartir marcas'
            });
            if (!confirmed) return false;
        }
        const clientId = Number(route.id);
        if (!Number.isSafeInteger(clientId) || clientId <= 0) {
            throw new Error('No se pudo identificar esta actividad para el ranking.');
        }
        const previousRankingOwnerId = route.groupRankingOwnerId;
        const previousRankingServer = route.groupRankingServer;
        const previousRankingPending = route.groupRankingPending;
        route.groupRankingOwnerId = Cloud.uid;
        route.groupRankingServer = Cloud.server;
        route.groupRankingPending = true;
        try {
            await DB.put(route);
        } catch (error) {
            if (previousRankingOwnerId === undefined) delete route.groupRankingOwnerId;
            else route.groupRankingOwnerId = previousRankingOwnerId;
            if (previousRankingServer === undefined) delete route.groupRankingServer;
            else route.groupRankingServer = previousRankingServer;
            if (previousRankingPending === undefined) delete route.groupRankingPending;
            else route.groupRankingPending = previousRankingPending;
            throw error;
        }
        const result = await cloudApi('/api/mtb/groups/rankings/share', 'POST', {
            clientId,
            distanceKm,
            movingTimeSec,
            maxSpeedKmh
        });
        const previousRankingGroupId = route.groupRankingGroupId;
        route.groupRankingGroupId = activeGroupId;
        route.groupRankingPending = false;
        try {
            await DB.put(route);
        } catch (error) {
            if (previousRankingGroupId === undefined) delete route.groupRankingGroupId;
            else route.groupRankingGroupId = previousRankingGroupId;
            route.groupRankingPending = true;
            throw error;
        }
        const records = [];
        if (result.newDistanceRecord) records.push('nueva actividad más larga');
        if (result.newTimeRecord) records.push('mayor tiempo en movimiento');
        if (result.newSpeedRecord) records.push('nueva velocidad punta');
        toast(automatic
            ? `Marcas añadidas automáticamente al ranking de ${groupInfo?.name || 'tu grupo'}.`
            : records.length ? `Marca compartida: ${records.join(' y ')}.` : 'Marcas compartidas; ya conservabas un mejor récord.');
        if (currentPage === 2) await loadGroupRankings();
        return true;
    } catch (error) {
        console.warn('No se pudieron compartir las marcas con el grupo:', error);
        if (automatic) throw error;
        toast(error.status === 404
            ? 'Falta instalar mtb_group_ranking_entries.json y actualizar groups.pb.js en PocketBase.'
            : `No se pudieron compartir las marcas: ${error.message || 'error de conexión'}`, 6000);
        return false;
    } finally {
        if (button) button.disabled = false;
    }
}

async function syncPendingGroupRankingDeletes() {
    if (!Cloud.loggedIn() || !navigator.onLine || groupRankingDeletesSyncing) return false;
    groupRankingDeletesSyncing = true;
    let pending;
    try {
        pending = await DB.kvGet('pendingGroupRankingDeletes') || [];
    } catch (error) {
        console.warn('No se pudo leer la cola de borrados del ranking:', error);
        groupRankingDeletesSyncing = false;
        return false;
    }
    if (!Array.isArray(pending)) {
        console.warn('La cola de borrados del ranking tiene un formato no válido.');
        groupRankingDeletesSyncing = false;
        return false;
    }

    const remaining = [];
    let failed = false;
    for (const item of pending) {
        if (!item || item.ownerId !== Cloud.uid || item.server !== Cloud.server) {
            remaining.push(item);
            continue;
        }
        try {
            await cloudApi('/api/mtb/groups/rankings/delete', 'POST', { clientId: item.clientId });
        } catch (error) {
            failed = true;
            remaining.push(item);
            console.warn(`No se pudo retirar del ranking la actividad ${item.clientId}:`, error);
        }
    }
    try {
        await DB.kvSet('pendingGroupRankingDeletes', remaining);
    } catch (error) {
        failed = true;
        console.warn('No se pudo guardar la cola de borrados del ranking:', error);
    } finally {
        groupRankingDeletesSyncing = false;
    }
    if (failed) toast('La ruta se borró, pero su marca del ranking sigue pendiente de sincronizar.', 6000);
    return !failed;
}
