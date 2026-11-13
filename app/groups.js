'use strict';

//  POSICIONES DEL GRUPO (PocketBase)
// ============================================================
let groupJoined = false, groupSyncAvailable = false, friendsTimer = null, restoreGroupPending = false;
let friendsRefreshPending = false, lastLivePush = 0, lastFriendsRefreshAt = 0, livePushPending = false;
let groupRankingDeletesSyncing = false;
let myLiveRecordId = null;
let groupLiveEndpointUnsupportedFor = '';
const friendMarkers = new Map();
const LIVE_INTERVAL_MS = 30000, FRIEND_STALE_MS = 120000;
const FRIENDS_IDLE_REFRESH_MS = 30000;

let groupInfo = null, groupChoices = [], liveFriendCount = 0;
let groupRankingMembers = [];

function groupName() { return Cloud.groupCode || ''; }

function renderGroupMetricRanking(containerId, key, format) {
    const container = $(containerId);
    container.replaceChildren();
    const entries = groupRankingMembers
        .filter(member => Number.isFinite(Number(member[key])) && Number(member[key]) > 0)
        .sort((a, b) => Number(b[key]) - Number(a[key]));
    if (!entries.length) {
        const empty = document.createElement('p');
        empty.className = 'community-empty';
        empty.textContent = 'Aún no hay marcas compartidas.';
        container.appendChild(empty);
        return;
    }
    entries.forEach((member, index) => {
        const row = document.createElement('div');
        row.className = 'group-ranking-item';
        const name = document.createElement('span');
        name.textContent = `${index + 1}. ${member.nickname}`;
        const value = document.createElement('strong');
        value.textContent = format(member);
        row.append(name, value);
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

async function shareRouteToGroupRanking(route, button) {
    if (!Cloud.loggedIn() || !groupJoined) {
        toast('Inicia sesión y únete a un grupo para compartir marcas.');
        return;
    }
    if (!navigator.onLine) {
        toast('Necesitas conexión para compartir una marca con el grupo.');
        return;
    }
    if (!route || route.kind !== 'recorded') {
        toast('Solo se pueden compartir actividades grabadas.');
        return;
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
        toast('Esta actividad no tiene marcas válidas para compartir.');
        return;
    }
    const details = [];
    if (distanceKm > 0) details.push(`Distancia: ${distanceKm.toFixed(1)} km`);
    if (movingTimeSec > 0) details.push(`Tiempo en movimiento: ${fmtDur(movingTimeSec)}`);
    if (maxSpeedKmh > 0) details.push(`Velocidad punta: ${maxSpeedKmh.toFixed(1)} km/h`);
    if (button) button.disabled = true;
    try {
        const confirmed = await modal({
            message: `Compartir con «${groupInfo && groupInfo.name ? groupInfo.name : 'el grupo'}» estas marcas de la actividad:\n\n${details.join('\n')}\n\nNo se enviarán el trazado GPS, el nombre, la fecha ni la ubicación.`,
            ok: 'Compartir marcas'
        });
        if (!confirmed) return;
        const clientId = Number(route.id);
        if (!Number.isSafeInteger(clientId) || clientId <= 0) {
            toast('No se pudo identificar esta actividad para el ranking.');
            return;
        }
        const previousRankingOwnerId = route.groupRankingOwnerId;
        const previousRankingServer = route.groupRankingServer;
        route.groupRankingOwnerId = Cloud.uid;
        route.groupRankingServer = Cloud.server;
        try {
            await DB.put(route);
        } catch (error) {
            if (previousRankingOwnerId === undefined) delete route.groupRankingOwnerId;
            else route.groupRankingOwnerId = previousRankingOwnerId;
            if (previousRankingServer === undefined) delete route.groupRankingServer;
            else route.groupRankingServer = previousRankingServer;
            throw error;
        }
        const result = await cloudApi('/api/mtb/groups/rankings/share', 'POST', {
            clientId,
            distanceKm,
            movingTimeSec,
            maxSpeedKmh
        });
        const records = [];
        if (result.newDistanceRecord) records.push('nueva actividad más larga');
        if (result.newTimeRecord) records.push('mayor tiempo en movimiento');
        if (result.newSpeedRecord) records.push('nueva velocidad punta');
        toast(records.length ? `Marca compartida: ${records.join(' y ')}.` : 'Marcas compartidas; ya conservabas un mejor récord.');
        if (currentPage === 2) await loadGroupRankings();
    } catch (error) {
        console.warn('No se pudieron compartir las marcas con el grupo:', error);
        toast(error.status === 404
            ? 'Falta instalar mtb_group_ranking_entries.json y actualizar groups.pb.js en PocketBase.'
            : `No se pudieron compartir las marcas: ${error.message || 'error de conexión'}`, 6000);
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

function pendingGroupLeaveKey() {
    return Cloud.uid ? `mtb_pending_group_leave_${encodeURIComponent(Cloud.server)}_${Cloud.uid}` : '';
}
function hasPendingGroupLeave() {
    const key = pendingGroupLeaveKey();
    return Boolean(key && localStorage.getItem(key));
}
function clearPendingGroupLeave(groupId) {
    const key = pendingGroupLeaveKey();
    if (!key) return;
    try {
        const pending = JSON.parse(localStorage.getItem(key) || 'null');
        if (pending && pending.groupId === groupId) localStorage.removeItem(key);
    } catch (_) { localStorage.removeItem(key); }
}

async function syncPendingGroupLeave() {
    const key = pendingGroupLeaveKey();
    if (!key || !Cloud.loggedIn() || !navigator.onLine) return false;
    let pending;
    try { pending = JSON.parse(localStorage.getItem(key) || 'null'); }
    catch (_) { pending = null; }
    if (!pending || !pending.groupId) {
        localStorage.removeItem(key);
        return true;
    }

    const auth = await cloudApi('/api/collections/users/auth-refresh', 'POST');
    Cloud.setSession(auth.token, auth.record);
    if (auth.record.groupCode === pending.groupId) {
        await cloudApi('/api/mtb/groups/leave', 'POST');
    }
    const fresh = await cloudApi('/api/collections/users/auth-refresh', 'POST');
    Cloud.setSession(fresh.token, fresh.record);
    localStorage.removeItem(key);
    groupJoined = false;
    groupSyncAvailable = false;
    myLiveRecordId = null;
    localStorage.removeItem('mtb_group_joined');
    await loadMyGroup();
    renderFriends();
    renderAccount();
    return true;
}

function renderFriendsGroupStatus() {
    const status = $('friends-group-status');
    const connected = groupJoined && groupSyncAvailable;
    status.classList.toggle('connected', connected);
    status.textContent = connected
        ? `🟢 Conectado al grupo${groupInfo && groupInfo.name ? ' «' + groupInfo.name + '»' : ''} · ${liveFriendCount} ${liveFriendCount === 1 ? 'compañero' : 'compañeros'} en vivo`
        : groupJoined ? '🟡 Grupo guardado · esperando conexión' : 'Sin conexión a un grupo';
}

function renderGroupChoices(activeId = '') {
    const box = $('group-list');
    box.textContent = '';
    for (const group of groupChoices) {
        const active = group.id === activeId;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `group-shortcut${active ? ' is-active' : ''}`;
        button.disabled = active;
        button.setAttribute('aria-pressed', String(active));
        button.title = active ? `${group.name} (grupo activo)` : `Entrar en ${group.name}`;

        const icon = document.createElement('span');
        icon.className = 'group-shortcut-icon';
        icon.setAttribute('aria-hidden', 'true');
        const words = String(group.name || '').trim().split(/\s+/).filter(Boolean);
        const initials = document.createElement('span');
        initials.className = 'group-shortcut-initials';
        initials.textContent = words.length > 1
            ? `${words[0].slice(0, 1)}${words[1].slice(0, 1)}`.toUpperCase()
            : (words[0] || 'GR').slice(0, 2).toUpperCase();
        icon.appendChild(initials);

        if (group.icon) {
            const image = document.createElement('img');
            image.alt = '';
            image.referrerPolicy = 'no-referrer';
            image.addEventListener('load', () => icon.classList.add('has-image'), { once: true });
            image.addEventListener('error', () => image.remove(), { once: true });
            image.src = `${Cloud.server}/api/files/mtb_groups/${encodeURIComponent(group.id)}/${encodeURIComponent(group.icon)}?thumb=96x96`;
            icon.appendChild(image);
        }

        const name = document.createElement('span');
        name.className = 'group-shortcut-name';
        name.textContent = group.name;
        button.append(icon, name);
        if (active) {
            const state = document.createElement('span');
            state.className = 'group-shortcut-state';
            state.textContent = 'Activo';
            button.appendChild(state);
        } else {
            button.addEventListener('click', () => selectGroup(group.id));
        }
        box.appendChild(button);
    }
    $('group-choices').style.display = groupChoices.length ? 'block' : 'none';
}

function renderGroupState(connected) {
    $('group-setup').style.display = connected ? 'none' : 'block';
    $('group-connected').style.display = connected ? 'block' : 'none';
    $('group-admin-panel').style.display = connected && groupInfo && groupInfo.isAdmin ? 'block' : 'none';
    $('group-invite-code').textContent = groupInfo && groupInfo.isAdmin ? groupInfo.inviteCode : '';
    $('group-connected-label').textContent = connected && groupInfo ? (groupInfo.name + (groupInfo.isAdmin ? ' · Administrador' : ' · Miembro')) : 'Grupo activo';
    $('group-choices').style.display = groupChoices.length ? 'block' : 'none';
    renderFriendsGroupStatus();
    renderGroupChoices(groupInfo ? groupInfo.id : '');
    $('group-status').textContent = connected
        ? !groupSyncAvailable ? 'Grupo guardado en este dispositivo. Se sincronizará al recuperar conexión.'
            : !Cloud.nickname ? 'Añade un apodo a tu cuenta para identificarte en el grupo.'
                : (isRecording && !isPaused ? 'Grupo activo: compartiendo tu posición.' : 'Tu posición se compartirá cuando grabes.')
        : !Cloud.nickname ? 'Añade un apodo a tu cuenta antes de entrar en un grupo.'
            : 'Puedes volver a entrar en tus grupos autorizados. El administrador puede revocar el acceso.';
    if (connected && groupInfo && groupInfo.isAdmin) loadAdminMembers();
}

async function stopGroup() {
    groupJoined = false;
    groupSyncAvailable = false;
    groupInfo = null;
    localStorage.removeItem('mtb_group_joined');
    if (friendsTimer) { clearInterval(friendsTimer); friendsTimer = null; }
    await removeMyLiveLocation();
    renderGroupState(false);
    renderFriends();
    if (currentPage === 2) await loadGroupRankings();
}

function startFriendsTimer() {
    if (friendsTimer) clearInterval(friendsTimer);
    friendsTimer = setInterval(() => {
        if (document.visibilityState !== 'visible' || !navigator.onLine) return;
        // Durante la grabación, las publicaciones de posición ya refrescan la lista de amigos.
        const minimumInterval = isRecording && !isPaused ? LIVE_INTERVAL_MS : FRIENDS_IDLE_REFRESH_MS;
        if (Date.now() - lastFriendsRefreshAt < minimumInterval) return;
        refreshFriends();
    }, FRIENDS_IDLE_REFRESH_MS);
}

async function loadMyGroup() {
    const result = await cloudApi('/api/mtb/groups/my');
    groupChoices = Array.isArray(result.groups) ? result.groups : [];
    const activeId = result.activeGroupId || '';
    groupInfo = groupChoices.find(group => group.id === activeId) || null;
    // PocketBase es la fuente de verdad. La marca local solo era una caché y
    // puede desaparecer al actualizar/reinstalar la app aunque siga la membresía.
    groupJoined = Boolean(groupInfo);
    if (groupJoined) localStorage.setItem('mtb_group_joined', activeId);
    groupSyncAvailable = true;
    if (activeId) localStorage.setItem('mtb_group_code', activeId);
    else localStorage.removeItem('mtb_group_code');
    if (!groupJoined) localStorage.removeItem('mtb_group_joined');
    renderGroupState(groupJoined);
    if (currentPage === 2) await loadGroupRankings();
    return groupInfo;
}

async function loadAdminMembers() {
    try {
        const result = await cloudApi('/api/mtb/groups/members');
        const box = $('group-members-list');
        box.textContent = '';
        for (const member of result.members || []) {
            const row = document.createElement('div');
            row.className = 'friend-row';
            const label = document.createElement('div');
            label.className = 'friend-name';
            label.textContent = member.nickname + (member.isAdmin ? ' · Tú' : '');
            row.appendChild(label);
            if (!member.isAdmin) {
                const revoke = document.createElement('button');
                revoke.type = 'button';
                revoke.className = 'btn-small danger friend-locate';
                revoke.textContent = 'Revocar';
                revoke.addEventListener('click', async () => {
                    if (!confirm('Esta persona perderá el acceso y necesitará una nueva invitación para volver. ¿Revocar?')) return;
                    try {
                        const res = await cloudApi('/api/mtb/groups/revoke', 'POST', { userId: member.userId });
                        if (res && res.inviteCode && groupInfo) {
                            groupInfo.inviteCode = res.inviteCode;
                            $('group-invite-code').textContent = res.inviteCode;
                        }
                        await loadAdminMembers();
                        toast('Acceso revocado y código de invitación renovado.');
                    } catch (e) { toast('No se pudo revocar el acceso: ' + e.message, 6000); }
                });
                row.appendChild(revoke);
            }
            box.appendChild(row);
        }
        if (!(result.members || []).length) box.textContent = 'Todavía no hay miembros.';
    } catch (e) {
        $('group-members-list').textContent = 'No se pudo cargar la lista de miembros.';
        console.warn('Miembros del grupo:', e);
    }
}

async function selectGroup(groupId) {
    if (!Cloud.loggedIn()) { toast('Inicia sesión para entrar en el grupo.'); return; }
    if (!Cloud.nickname) { toast('Añade un apodo a tu cuenta antes de entrar en un grupo.'); return; }
    try {
        const switchingActiveGroup = groupJoined && groupName() !== groupId;
        if (switchingActiveGroup) {
            if (friendsTimer) { clearInterval(friendsTimer); friendsTimer = null; }
            await removeMyLiveLocation();
        }
        await cloudApi('/api/mtb/groups/select', 'POST', { groupId });
        const auth = await cloudApi('/api/collections/users/auth-refresh', 'POST');
        Cloud.setSession(auth.token, auth.record);
        clearPendingGroupLeave(groupId);
        localStorage.setItem('mtb_group_joined', groupId);
        groupJoined = true;
        groupSyncAvailable = true;
        await loadMyGroup();
        await refreshFriends();
        startFriendsTimer();
        if (isRecording && !isPaused) publishMyLocation(true);
        toast('Has vuelto a entrar en el grupo.');
    } catch (e) {
        toast('No se pudo entrar en el grupo: ' + e.message, 6000);
        await restoreGroup();
    }
}

async function restoreGroup() {
    if (!Cloud.loggedIn() || restoreGroupPending) return;
    restoreGroupPending = true;
    try {
        if (hasPendingGroupLeave()) {
            groupJoined = false;
            groupSyncAvailable = false;
            localStorage.removeItem('mtb_group_joined');
            localStorage.removeItem('mtb_group_code');
            if (friendsTimer) { clearInterval(friendsTimer); friendsTimer = null; }
            renderGroupState(false);
            renderFriends();
            if (navigator.onLine) {
                try {
                    await syncPendingGroupLeave();
                    await syncPendingGroupRankingDeletes();
                }
                catch (e) {
                    localStorage.removeItem('mtb_group_code');
                    $('group-status').textContent = 'Has salido en este dispositivo; se completará la salida del servidor al recuperar conexión.';
                    console.warn('Salida del grupo pendiente:', e);
                }
            } else {
                $('group-status').textContent = 'Has salido en este dispositivo; la salida del servidor está pendiente de conexión.';
            }
            return;
        }
        const savedGroupId = localStorage.getItem('mtb_group_joined');
        if (!groupJoined && savedGroupId && savedGroupId === groupName()) {
            groupJoined = true;
            groupSyncAvailable = false;
            groupInfo = groupInfo || { id: savedGroupId };
            renderGroupState(true);
            renderFriends();
            startFriendsTimer();
        }
        try {
            const auth = await cloudApi('/api/collections/users/auth-refresh', 'POST');
            Cloud.setSession(auth.token, auth.record);
            await syncPendingGroupRankingDeletes();
            await loadMyGroup();
            if (!groupJoined) {
                if (friendsTimer) { clearInterval(friendsTimer); friendsTimer = null; }
                renderFriends();
                return;
            }
            await refreshFriends();
            startFriendsTimer();
            if (isRecording && !isPaused) publishMyLocation(true);
        } catch (e) {
            groupSyncAvailable = false;
            if (groupJoined) renderGroupState(true);
            console.warn('No se pudo restaurar el grupo:', e);
            $('group-status').textContent = e.status === 404
                ? 'PocketBase no tiene instaladas las rutas de gestión de grupos (groups.pb.js).'
                : e.status !== undefined
                    ? `No se pudo restaurar el grupo desde PocketBase: ${e.message}`
                    : 'Sin conexión con PocketBase; se reintentará restaurar tus grupos al recuperar la red.';
        }
    } finally { restoreGroupPending = false; }
}

function renderFriends(items = []) {
    const box = $('friends-list');
    box.textContent = '';
    const now = Date.now();
    const live = items.filter(x => x.owner !== Cloud.uid && Number.isFinite(Number(x.lat)) && Number.isFinite(Number(x.lon)) && now - Date.parse(x.updated) < FRIEND_STALE_MS);
    liveFriendCount = live.length;
    renderFriendsGroupStatus();
    const ids = new Set(live.map(x => x.id));
    for (const [id, marker] of friendMarkers) {
        if (!ids.has(id)) { if (map) map.removeLayer(marker); friendMarkers.delete(id); }
    }
    if (!live.length) {
        const p = document.createElement('p');
        p.className = 'hint'; p.style.textAlign = 'center';
        p.textContent = groupJoined ? 'No hay compañeros compartiendo ubicación ahora.' : 'Únete o crea un grupo para consultar las posiciones activas.';
        box.appendChild(p);
        return;
    }
    live.forEach(rec => {
        const name = String(rec.nickname || rec.name || 'Compañero').trim();
        const ll = [Number(rec.lat), Number(rec.lon)];
        let marker = friendMarkers.get(rec.id);
        if (map) {
            const avatarName = String(rec.avatar || '').trim();
            const avatarUrl = avatarName && rec.owner
                ? `${Cloud.server}/api/files/users/${encodeURIComponent(rec.owner)}/${encodeURIComponent(avatarName)}?thumb=96x96`
                : '';
            const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toLocaleUpperCase('es-ES') || '•';
            const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
            const icon = L.divIcon({
                className: 'friend-map-avatar-icon',
                html: avatarUrl
                    ? `<img class="friend-map-avatar" src="${escapeHtml(avatarUrl)}" alt="" referrerpolicy="no-referrer"><span class="friend-map-initials" aria-hidden="true">${escapeHtml(initials)}</span>`
                    : `<span class="friend-map-initials">${escapeHtml(initials)}</span>`,
                iconSize: [42, 42], iconAnchor: [21, 21]
            });
            if (!marker) {
                marker = L.marker(ll, { icon, title: name, alt: name, keyboard: true }).addTo(map);
                friendMarkers.set(rec.id, marker);
            } else {
                marker.setLatLng(ll);
                marker.setIcon(icon);
                marker.options.title = name;
            }
            const popup = document.createElement('div');
            popup.className = 'friend-map-popup';
            const popupName = document.createElement('strong');
            popupName.className = 'friend-map-popup-name';
            popupName.textContent = name;
            const popupTime = document.createElement('div');
            popupTime.className = 'friend-map-popup-time';
            popupTime.textContent = `Actualizado ${new Date(rec.updated).toLocaleTimeString('es-ES')}`;
            popup.append(popupName, popupTime);
            marker.bindPopup(popup);
        }
        const row = document.createElement('div');
        row.className = 'friend-row';
        const main = document.createElement('div');
        main.className = 'friend-main';
        const title = document.createElement('div');
        title.className = 'friend-name';
        title.textContent = '🚴 ' + name;
        const time = document.createElement('div');
        time.className = 'friend-updated';
        time.textContent = 'Actualizado ' + new Date(rec.updated).toLocaleTimeString('es-ES');
        const locate = document.createElement('button');
        locate.type = 'button';
        locate.className = 'btn-small friend-locate';
        locate.textContent = 'Ver mapa';
        locate.addEventListener('click', () => {
            goToPage(0);
            if (map) map.setView(ll, Math.max(map.getZoom(), 16));
            const currentMarker = friendMarkers.get(rec.id);
            if (currentMarker) currentMarker.openPopup();
        });
        main.append(title, time);
        row.append(main, locate);
        box.appendChild(row);
    });
}

async function refreshFriends(retryAuth = true, ownsPending = false) {
    if (!groupJoined || !Cloud.loggedIn() || !navigator.onLine || document.visibilityState !== 'visible'
        || (friendsRefreshPending && !ownsPending)) return;
    if (!ownsPending) friendsRefreshPending = true;
    lastFriendsRefreshAt = Date.now();
    const wasSyncAvailable = groupSyncAvailable;
    try {
        const expectedGroup = groupName();
        const auth = await cloudApi('/api/collections/users/auth-refresh', 'POST');
        const stillAuthorized = auth.record.groupCode === expectedGroup && Boolean(expectedGroup);
        Cloud.setSession(auth.token, auth.record);
        if (!stillAuthorized) {
            groupJoined = false;
            localStorage.removeItem('mtb_group_joined');
            await removeMyLiveLocation();
            await loadMyGroup();
            renderFriends();
            toast('El administrador ha revocado tu acceso a este grupo.');
            return;
        }
        const f = encodeURIComponent('groupCode = "' + expectedGroup + '"');
        let res;
        if (groupLiveEndpointUnsupportedFor !== Cloud.server) {
            try {
                res = await cloudApi('/api/mtb/groups/live');
                groupLiveEndpointUnsupportedFor = '';
            } catch (e) {
                if (e.status !== 404) throw e;
                groupLiveEndpointUnsupportedFor = Cloud.server;
            }
        }
        if (!res) res = await cloudApi('/api/collections/live_locations/records?filter=' + f + '&perPage=200&sort=-updated');
        groupSyncAvailable = true;
        const own = res.items.find(x => x.owner === Cloud.uid);
        myLiveRecordId = own ? own.id : null;
        renderFriends(res.items);
        if (!wasSyncAvailable && isRecording && !isPaused) publishMyLocation(true);
    } catch (e) {
        groupSyncAvailable = false;
        renderFriendsGroupStatus();
        console.warn('Posiciones del grupo:', e);
        if ((e.status === 401 || e.status === 403) && retryAuth) {
            try {
                const auth = await cloudApi('/api/collections/users/auth-refresh', 'POST');
                Cloud.setSession(auth.token, auth.record);
                await refreshFriends(false, true);
            } catch (refreshError) {
                console.warn('No se pudo renovar la sesión del grupo:', refreshError);
                $('group-status').textContent = 'Conexión pendiente: no se pudo verificar el grupo.';
            }
        } else if (e.status !== undefined && e.status !== 404) {
            $('group-status').textContent = 'No se pudieron cargar posiciones. Revisa la conexión y PocketBase.';
        }
    } finally {
        if (!ownsPending) friendsRefreshPending = false;
    }
}
async function publishMyLocation(force = false) {
    if (!groupJoined || !Cloud.loggedIn() || !isRecording || isPaused || lastLat === null || lastLon === null || livePushPending) return;
    const nickname = String(Cloud.nickname || '').trim();
    if (!nickname) {
        $('group-status').textContent = 'Añade un apodo a tu cuenta antes de compartir tu posición.';
        return;
    }
    if (!force && Date.now() - lastLivePush < LIVE_INTERVAL_MS) return;
    livePushPending = true;
    try {
        const payload = { owner: Cloud.uid, groupCode: groupName(), name: nickname, lat: lastLat, lon: lastLon, accuracy: Number.isFinite(lastAccuracy) ? lastAccuracy : 0 };
        if (!myLiveRecordId) {
            const f = encodeURIComponent(`owner = "${Cloud.uid}"`);
            const own = await cloudApi(`/api/collections/live_locations/records?filter=${f}&perPage=1`);
            myLiveRecordId = own.items[0] ? own.items[0].id : null;
        }
        if (myLiveRecordId) await cloudApi(`/api/collections/live_locations/records/${myLiveRecordId}`, 'PATCH', payload);
        else {
            const rec = await cloudApi('/api/collections/live_locations/records', 'POST', payload);
            myLiveRecordId = rec.id;
        }
        if (!groupJoined || !isRecording || isPaused) { await removeMyLiveLocation(); return; }
        lastLivePush = Date.now();
        refreshFriends();
    } catch (e) {
        console.warn('No se pudo compartir la posición:', e);
        groupSyncAvailable = false;
        renderFriendsGroupStatus();
        if (e.status === 404) myLiveRecordId = null;
        if (e.status !== undefined) $('group-status').textContent = `Error al compartir posición: ${e.message}`;
    } finally { livePushPending = false; }
}

async function removeMyLiveLocation() {
    const id = myLiveRecordId;
    myLiveRecordId = null;
    if (id && Cloud.loggedIn()) {
        try { await cloudApi(`/api/collections/live_locations/records/${id}`, 'DELETE'); }
        catch (e) { console.warn('No se pudo retirar la posición:', e); }
    }
    renderFriends();
}

async function connectGroup(action) {
    if (!Cloud.loggedIn()) { toast('Inicia sesión para usar los grupos.'); return; }
    try {
        const auth = await cloudApi('/api/collections/users/auth-refresh', 'POST');
        Cloud.setSession(auth.token, auth.record);
        if (!Cloud.nickname) { toast('Añade un apodo a tu cuenta antes de usar grupos.'); return; }
        let result;
        if (action === 'create') {
            const name = $('group-name').value.trim();
            const iconFile = $('group-icon').files[0];
            if (iconFile) {
                const iconBlob = await accountAvatarToJpeg(iconFile);
                const form = new FormData();
                form.append('name', name);
                form.append('icon', iconBlob, 'group-icon.jpg');
                result = await cloudApi('/api/mtb/groups/create', 'POST', form);
            } else {
                result = await cloudApi('/api/mtb/groups/create', 'POST', { name });
            }
        } else {
            const code = $('group-code').value.trim().toUpperCase();
            if (!/^[A-Z0-9]{12}$/.test(code)) { toast('Introduce un código de invitación de 12 caracteres.'); return; }
            result = await cloudApi('/api/mtb/groups/join', 'POST', { code });
        }
        const fresh = await cloudApi('/api/collections/users/auth-refresh', 'POST');
        Cloud.setSession(fresh.token, fresh.record);
        clearPendingGroupLeave(result.group.id);
        await loadMyGroup();
        await refreshFriends();
        startFriendsTimer();
        if (isRecording && !isPaused) publishMyLocation(true);
        toast(action === 'create' ? 'Grupo creado: ya eres el administrador.' : 'Te has unido al grupo.');
    } catch (e) {
        console.warn('No se pudo acceder al grupo:', e);
        toast('No se pudo acceder al grupo: ' + e.message, 6000);
    }
}

$('btn-create-group').addEventListener('click', () => connectGroup('create'));
$('btn-join').addEventListener('click', () => connectGroup('join'));
$('group-rankings-refresh').addEventListener('click', () => {
    loadGroupRankings();
});
$('btn-update-group-icon').addEventListener('click', async () => {
    if (!groupInfo || !groupInfo.isAdmin) return;
    const file = $('group-admin-icon').files[0];
    if (!file) {
        toast('Selecciona una imagen para el logo del grupo.');
        return;
    }
    const button = $('btn-update-group-icon');
    const status = $('group-icon-update-status');
    button.disabled = true;
    status.textContent = 'Guardando logo…';
    try {
        const iconBlob = await accountAvatarToJpeg(file);
        const form = new FormData();
        form.append('icon', iconBlob, 'group-icon.jpg');
        const result = await cloudApi('/api/mtb/groups/icon', 'POST', form);
        groupInfo.icon = result.group.icon;
        const choice = groupChoices.find(group => group.id === groupInfo.id);
        if (choice) choice.icon = result.group.icon;
        $('group-admin-icon').value = '';
        renderGroupChoices(groupInfo.id);
        status.textContent = 'Logo actualizado.';
        toast('Logo del grupo actualizado.');
    } catch (error) {
        console.warn('No se pudo actualizar el logo del grupo:', error);
        status.textContent = `No se pudo actualizar el logo: ${error.message || 'error de conexión'}`;
    } finally {
        button.disabled = false;
    }
});
$('btn-copy-invite').addEventListener('click', async () => {
    if (!groupInfo || !groupInfo.isAdmin) return;
    try {
        await navigator.clipboard.writeText(groupInfo.inviteCode);
        toast('Código de invitación copiado.');
    } catch (e) { toast('Código de invitación: ' + groupInfo.inviteCode, 6000); }
});
$('btn-rotate-invite').addEventListener('click', async () => {
    if (!groupInfo || !groupInfo.isAdmin || !confirm('El código anterior dejará de servir para nuevas invitaciones. ¿Renovar?')) return;
    try {
        const result = await cloudApi('/api/mtb/groups/rotate-invite', 'POST');
        groupInfo = result.group;
        renderGroupState(true);
        toast('Código renovado. Los miembros actuales conservan el acceso.');
    } catch (e) { toast('No se pudo renovar el código: ' + e.message, 6000); }
});
$('btn-delete-group').addEventListener('click', async () => {
    if (!groupInfo || !groupInfo.isAdmin || !confirm('Se retirará el acceso a todos los miembros y se borrarán sus posiciones en vivo. ¿Eliminar el grupo?')) return;
    try {
        await cloudApi('/api/mtb/groups/delete', 'POST');
        await stopGroup();
        const auth = await cloudApi('/api/collections/users/auth-refresh', 'POST');
        Cloud.setSession(auth.token, auth.record);
        await loadMyGroup();
        renderAccount();
        toast('Grupo eliminado; se han revocado las autorizaciones.');
    } catch (e) { toast('No se pudo eliminar el grupo: ' + e.message, 6000); }
});
async function leaveGroupLocally() {
    const groupId = groupName() || localStorage.getItem('mtb_group_joined') || '';
    const key = pendingGroupLeaveKey();
    if (!groupId || !key) { toast('No hay un grupo activo que cerrar.'); return; }
    localStorage.setItem(key, JSON.stringify({ groupId, uid: Cloud.uid, queuedAt: Date.now() }));
    if (groupInfo && !groupChoices.some(group => group.id === groupId)) groupChoices.push(groupInfo);
    groupJoined = false;
    groupSyncAvailable = false;
    groupInfo = null;
    myLiveRecordId = null;
    localStorage.removeItem('mtb_group_joined');
    localStorage.removeItem('mtb_group_code');
    if (friendsTimer) { clearInterval(friendsTimer); friendsTimer = null; }
    renderGroupState(false);
    renderFriends();
    if (currentPage === 2) loadGroupRankings();
    renderAccount();
    if (!navigator.onLine) {
        $('group-status').textContent = 'Has salido en este dispositivo; la salida del servidor está pendiente de conexión.';
        toast('Has salido en este dispositivo. La salida del servidor se completará al recuperar conexión.', 6000);
        return;
    }
    try {
        await syncPendingGroupLeave();
        toast('Has salido del grupo. Conservas el acceso para volver a entrar.');
    } catch (e) {
        localStorage.removeItem('mtb_group_code');
        renderAccount();
        $('group-status').textContent = 'Has salido en este dispositivo; se completará la salida del servidor al recuperar conexión.';
        console.warn('No se pudo confirmar la salida del grupo:', e);
        toast('Has salido en este dispositivo; la salida del servidor queda pendiente de conexión.', 6000);
    }
}
$('btn-leave').addEventListener('click', leaveGroupLocally);

// ============================================================

// ============================================================

window.addEventListener('online', restoreGroup);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !navigator.onLine) return;
    if (hasPendingGroupLeave()) restoreGroup();
    else if (groupJoined) refreshFriends();
});
