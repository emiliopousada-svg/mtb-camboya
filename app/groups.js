'use strict';

//  POSICIONES DEL GRUPO (PocketBase)
// ============================================================
let groupJoined = false, groupSyncAvailable = false, friendsTimer = null, restoreGroupPending = false;
let friendsRefreshPending = false, lastLivePush = 0, livePushPending = false;
let myLiveRecordId = null;
const friendMarkers = new Map();
const LIVE_INTERVAL_MS = 10000, FRIEND_STALE_MS = 120000;

let groupInfo = null, groupChoices = [], liveFriendCount = 0;

function groupName() { return Cloud.groupCode || ''; }

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
        const row = document.createElement('div');
        row.className = 'friend-row';
        const info = document.createElement('div');
        info.className = 'friend-main';
        const title = document.createElement('div');
        title.className = 'friend-name';
        title.textContent = group.name + (group.isAdmin ? ' · Administrador' : '');
        const status = document.createElement('div');
        status.className = 'friend-updated';
        status.textContent = 'Autorización guardada';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn-small friend-locate';
        button.textContent = (group.nickname || '').trim() ? 'Volver a entrar' : 'Elegir apodo';
        button.addEventListener('click', () => selectGroup(group.id));
        info.append(title, status);
        row.append(info, button);
        box.appendChild(row);
    }
    $('group-choices').style.display = !groupJoined && groupChoices.length ? 'block' : 'none';
}

function renderGroupState(connected) {
    $('group-setup').style.display = connected ? 'none' : 'block';
    $('group-connected').style.display = connected ? 'block' : 'none';
    $('group-admin-panel').style.display = connected && groupInfo && groupInfo.isAdmin ? 'block' : 'none';
    $('group-invite-code').textContent = groupInfo && groupInfo.isAdmin ? groupInfo.inviteCode : '';
    $('group-connected-label').textContent = connected && groupInfo ? (groupInfo.name + (groupInfo.isAdmin ? ' · Administrador' : ' · Miembro')) : 'Grupo activo';
    $('group-choices').style.display = !connected && groupChoices.length ? 'block' : 'none';
    renderFriendsGroupStatus();
    renderGroupChoices(groupInfo ? groupInfo.id : '');
    $('group-status').textContent = connected
        ? !groupSyncAvailable ? 'Grupo guardado en este dispositivo. Se sincronizará al recuperar conexión.'
            : (isRecording && !isPaused ? 'Grupo activo: compartiendo tu posición.' : 'Tu posición se compartirá cuando grabes.')
        : groupChoices.some(group => group.id === localStorage.getItem('mtb_group_code') && !(group.nickname || '').trim())
            ? 'Antes de entrar, indica un apodo obligatorio para que el grupo pueda identificarte.'
            : 'Puedes volver a entrar en tus grupos autorizados. El administrador puede revocar el acceso.';
    if (connected && groupInfo && groupInfo.isAdmin) loadAdminMembers();
}

function stopGroup() {
    groupJoined = false;
    groupSyncAvailable = false;
    groupInfo = null;
    localStorage.removeItem('mtb_group_joined');
    if (friendsTimer) { clearInterval(friendsTimer); friendsTimer = null; }
    removeMyLiveLocation().catch(error =>
        console.warn('No se pudo limpiar la ubicación del grupo:', error)
    );
    renderGroupState(false);
    renderFriends();
}

function startFriendsTimer() {
    if (friendsTimer) clearInterval(friendsTimer);
    friendsTimer = setInterval(refreshFriends, LIVE_INTERVAL_MS);
}

async function loadMyGroup() {
    const result = await cloudApi('/api/mtb/groups/my');
    groupChoices = Array.isArray(result.groups) ? result.groups : [];
    const activeId = result.activeGroupId || '';
    groupInfo = groupChoices.find(group => group.id === activeId) || null;
    if (groupInfo && groupInfo.nickname && groupInfo.nickname.trim()) {
        localStorage.setItem('mtb_group_name', groupInfo.nickname);
        $('group-display-name').value = groupInfo.nickname;
    }
    groupJoined = Boolean(groupInfo && groupInfo.nickname && groupInfo.nickname.trim() &&
        localStorage.getItem('mtb_group_joined') === activeId);
    groupSyncAvailable = true;
    if (activeId) localStorage.setItem('mtb_group_code', activeId);
    else localStorage.removeItem('mtb_group_code');
    if (!groupJoined) localStorage.removeItem('mtb_group_joined');
    renderGroupState(groupJoined);
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
                    const ok = await modal({
                        message: 'Esta persona perderá el acceso y necesitará una nueva invitación para volver. ¿Revocar?',
                        ok: 'Revocar',
                        cancel: 'Cancelar'
                    });
                    if (!ok) return;
                    try {
                        await cloudApi('/api/mtb/groups/revoke', 'POST', { userId: member.userId });
                        await loadAdminMembers();
                        toast('Acceso revocado.');
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
    const group = groupChoices.find(item => item.id === groupId);
    let nickname = $('group-display-name').value.trim().slice(0, 32) ||
        (group && group.nickname ? group.nickname.trim().slice(0, 32) : '');
    if (!nickname) {
        nickname = await modal({ message: 'Elige un apodo obligatorio para el grupo:', input: '', ok: 'Continuar' });
        if (nickname === null) return;
        nickname = nickname.trim().slice(0, 32);
    }
    if (!nickname) { toast('Escribe un apodo para entrar en el grupo.'); return; }
    $('group-display-name').value = nickname;
    localStorage.setItem('mtb_group_name', nickname);
    try {
        await cloudApi('/api/mtb/groups/select', 'POST', { groupId, nickname });
        const auth = await cloudApi('/api/collections/users/auth-refresh', 'POST');
        Cloud.setSession(auth.token, auth.record);
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
    const savedGroupId = localStorage.getItem('mtb_group_joined');
    const savedNickname = localStorage.getItem('mtb_group_name');
    if (!groupJoined && savedGroupId && savedGroupId === groupName() && savedNickname && savedNickname.trim()) {
        groupJoined = true;
        groupSyncAvailable = false;
        groupInfo = groupInfo || { id: savedGroupId, nickname: savedNickname };
        renderGroupState(true);
        renderFriends();
        startFriendsTimer();
    }
    try {
        const auth = await cloudApi('/api/collections/users/auth-refresh', 'POST');
        Cloud.setSession(auth.token, auth.record);
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
            ? 'Falta configurar la gestión global de grupos en PocketBase.'
            : 'Esperando conexión para cargar tu grupo…';
    } finally {
        restoreGroupPending = false;
    }
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
        const name = rec.name || 'Compañero';
        const ll = [Number(rec.lat), Number(rec.lon)];
        let marker = friendMarkers.get(rec.id);
        if (map) {
            if (!marker) {
                marker = L.circleMarker(ll, { radius: 9, color: '#fff', weight: 2, fillColor: '#ab47bc', fillOpacity: 1 }).addTo(map);
                friendMarkers.set(rec.id, marker);
            } else marker.setLatLng(ll);
            const popup = document.createElement('div');
            const popupName = document.createElement('strong');
            popupName.textContent = name;
            const popupTime = document.createElement('div');
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
    if (!groupJoined || !Cloud.loggedIn() || (friendsRefreshPending && !ownsPending)) return;
    if (!ownsPending) friendsRefreshPending = true;
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
        const res = await cloudApi('/api/collections/live_locations/records?filter=' + f + '&perPage=200&sort=-updated');
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
    const nickname = localStorage.getItem('mtb_group_name')?.trim();
    if (!nickname) {
        $('group-status').textContent = 'Añade un apodo antes de compartir tu posición.';
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

$('group-display-name').value = localStorage.getItem('mtb_group_name') || '';
$('group-display-name').addEventListener('change', () => {
    const name = $('group-display-name').value.trim().slice(0, 32);
    if (name) localStorage.setItem('mtb_group_name', name);
    else localStorage.removeItem('mtb_group_name');
});

async function connectGroup(action) {
    if (!Cloud.loggedIn()) { toast('Inicia sesión para usar los grupos.'); return; }
    const displayName = $('group-display-name').value.trim().slice(0, 32);
    if (!displayName) { toast('Escribe un apodo para que los miembros del grupo puedan identificarte.'); $('group-display-name').focus(); return; }
    localStorage.setItem('mtb_group_name', displayName);
    try {
        const auth = await cloudApi('/api/collections/users/auth-refresh', 'POST');
        Cloud.setSession(auth.token, auth.record);
        let result;
        if (action === 'create') {
            const name = $('group-name').value.trim();
            result = await cloudApi('/api/mtb/groups/create', 'POST', { name, nickname: displayName });
        } else {
            const code = $('group-code').value.trim().toUpperCase();
            if (!/^[A-Z0-9]{12}$/.test(code)) { toast('Introduce un código de invitación de 12 caracteres.'); return; }
            result = await cloudApi('/api/mtb/groups/join', 'POST', { code, nickname: displayName });
        }
        const fresh = await cloudApi('/api/collections/users/auth-refresh', 'POST');
        Cloud.setSession(fresh.token, fresh.record);
        groupInfo = result.group;
        groupJoined = true;
        groupSyncAvailable = true;
        localStorage.setItem('mtb_group_joined', result.group.id);
        renderGroupState(true);
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
$('btn-copy-invite').addEventListener('click', async () => {
    if (!groupInfo || !groupInfo.isAdmin) return;
    try {
        await navigator.clipboard.writeText(groupInfo.inviteCode);
        toast('Código de invitación copiado.');
    } catch (e) { toast('Código de invitación: ' + groupInfo.inviteCode, 6000); }
});
$('btn-rotate-invite').addEventListener('click', async () => {
    if (!groupInfo || !groupInfo.isAdmin) return;
    const ok = await modal({
        message: 'El código anterior dejará de servir para nuevas invitaciones. ¿Renovar?',
        ok: 'Renovar',
        cancel: 'Cancelar'
    });
    if (!ok) return;
    try {
        const result = await cloudApi('/api/mtb/groups/rotate-invite', 'POST');
        groupInfo = result.group;
        renderGroupState(true);
        toast('Código renovado. Los miembros actuales conservan el acceso.');
    } catch (e) { toast('No se pudo renovar el código: ' + e.message, 6000); }
});
$('btn-delete-group').addEventListener('click', async () => {
    if (!groupInfo || !groupInfo.isAdmin) return;
    const ok = await modal({
        message: 'Se retirará el acceso a todos los miembros y se borrarán sus posiciones en vivo. ¿Eliminar el grupo?',
        ok: 'Eliminar',
        cancel: 'Cancelar'
    });
    if (!ok) return;
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
$('btn-leave').addEventListener('click', async () => {
    try {
        await cloudApi('/api/mtb/groups/leave', 'POST');
        const auth = await cloudApi('/api/collections/users/auth-refresh', 'POST');
        Cloud.setSession(auth.token, auth.record);
        myLiveRecordId = null;
        groupJoined = false;
        localStorage.removeItem('mtb_group_joined');
        await loadMyGroup();
        renderFriends();
        renderAccount();
        toast('Has salido del grupo. Conservas el acceso para volver a entrar.');
    } catch (e) { toast('No se pudo salir del grupo: ' + e.message, 6000); }
});

// ============================================================

// ============================================================

window.addEventListener('online', restoreGroup);
