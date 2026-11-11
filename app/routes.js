'use strict';

//  RUTAS GUARDADAS
// ============================================================
let routesTab = 'done';
function setRoutesTab(tab) {
    routesTab = tab;
    document.querySelectorAll('[data-routes-tab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.routesTab === tab)));
    $('routes-import-box').hidden = tab !== 'pending';
    $('routes-tab-hint').textContent = tab === 'done'
        ? 'Solo las rutas que has grabado tú. Usa 🏷️ para cambiar la actividad y ✏️ para el nombre.'
        : 'Tracks importados y guardados. Cuando los sigas y grabes tu salida, esta quedará en «Realizadas».';
    renderSavedRoutes();
}
document.querySelectorAll('[data-routes-tab]').forEach(b => b.addEventListener('click', () => setRoutesTab(b.dataset.routesTab)));

function routeCreatorName(route) {
    const creator = String(route.createdBy || Cloud.email || '').trim();
    const atIndex = creator.indexOf('@');
    return (atIndex > 0 ? creator.slice(0, atIndex) : creator) || 'Usuario local';
}

function renderSavedRoutes() {
    const c = $('saved-routes-list');
    c.textContent = '';
    const pendingTab = routesTab === 'pending';
    const tabRoutes = savedRoutes.filter(r => (r.kind === 'imported') === pendingTab);
    const userFilter = $('route-user-filter');
    const selectedUser = userFilter.value;
    const users = [...new Set(tabRoutes.map(routeCreatorName))].sort((a, b) => a.localeCompare(b, 'es'));
    userFilter.replaceChildren(new Option('Todos los usuarios', ''));
    users.forEach(user => userFilter.add(new Option(user, user)));
    userFilter.value = users.includes(selectedUser) ? selectedUser : '';
    if (tabRoutes.length === 0) {
        const e = document.createElement('div');
        e.style.cssText = 'text-align:center; padding:15px; color:var(--text-secondary); font-size:0.85rem;';
        e.textContent = pendingTab
            ? 'No hay tracks guardados. Importa un GPX, KML o GeoJSON para tenerlo listo.'
            : 'No hay rutas realizadas todavía. Graba una salida para verla aquí.';
        c.appendChild(e);
        return;
    }
    const filter = $('route-activity-filter').value;
    const user = userFilter.value;
    const visibleRoutes = tabRoutes.filter(route => {
        if (user && routeCreatorName(route) !== user) return false;
        if (filter === 'all') return true;
        const activityType = activityTypeForRoute(route);
        const groupKey = activityType || 'other';
        return groupKey === filter;
    });
    if (!visibleRoutes.length) {
        const empty = document.createElement('div');
        empty.style.cssText = 'text-align:center; padding:15px; color:var(--text-secondary); font-size:0.85rem;';
        empty.textContent = 'No hay rutas con estos filtros.';
        c.appendChild(empty);
        return;
    }
    const groups = new Map();
    visibleRoutes.forEach(r => {
        const activityType = activityTypeForRoute(r);
        const groupKey = activityType || 'other';
        if (!groups.has(groupKey)) groups.set(groupKey, []);
        groups.get(groupKey).push(r);
    });
    const groupOrder = [...Object.keys(ACTIVITY_TYPES), 'other'];
    groupOrder.forEach(groupKey => {
        const routes = groups.get(groupKey);
        if (!routes || !routes.length) return;
        const title = document.createElement('h3');
        title.className = 'route-group-title';
        title.textContent = groupKey === 'other'
            ? `📍 Sin clasificar (${routes.length})`
            : `${ACTIVITY_TYPES[groupKey].icon} ${ACTIVITY_TYPES[groupKey].label} (${routes.length})`;
        c.appendChild(title);
        routes.forEach(r => {
        const div = document.createElement('div');
        div.className = 'route-item';
        div.dataset.id = r.id;

        const info = document.createElement('div');
        info.className = 'route-info';
        const h = document.createElement('button');
        h.type = 'button';
        h.className = 'route-detail-trigger';
        h.textContent = r.name;
        h.addEventListener('click', () => openSavedRouteDetail(r));
        div.addEventListener('click', event => {
            if (event.target.closest('button')) return;
            openSavedRouteDetail(r);
        });
        const p = document.createElement('p');
        const parts = [`📅 ${fmtDate(r.startedAt)}`, `📏 ${r.distanceKm.toFixed(2)} km`];
        if (r.movingTimeSec) parts.push(`⏱️ ${fmtDur(r.movingTimeSec)}`);
        if (r.elevationGain) parts.push(`⛰️ +${r.elevationGain} m`);
        if (r.hrAvg) parts.push(`❤️ ${r.hrAvg}`);
        if (r.kind === 'imported') parts.push('📥 almacenado');
        if (r.followedImportedRoute) parts.push(`🧭 grabada siguiendo «${r.followedImportedRoute}»`);
        p.textContent = parts.join('  •  ');
        info.append(h, p);

        const actions = document.createElement('div');
        actions.className = 'route-actions';
        const routeActions = [
            ['follow', 'Seguir', ''],
            ['activity', '🏷️ Actividad', 'secondary'],
            ['rename', '✏️', 'secondary'],
            ['gpx', '⬇️ GPX', 'secondary'],
            ['del', '🗑️', 'danger']
        ];
        if (r.kind !== 'community' && !r.communityRouteId) {
            routeActions.splice(1, 0, ['community', '🌍 Publicar', 'secondary']);
        }
        routeActions.forEach(([act, label, cls]) => {
            const b = document.createElement('button');
            b.className = 'btn-small ' + cls;
            b.dataset.act = act;
            b.textContent = label;
            actions.appendChild(b);
        });

        div.append(info, actions);
        c.appendChild(div);
        });
    });
}

function openSavedRouteDetail(route) {
    const lines = communityRawSegments(route.points);
    if (!lines.length) {
        toast('Esta ruta no contiene un trazado que se pueda mostrar.');
        return;
    }
    const creator = routeCreatorName(route);
    const activity = ACTIVITY_TYPES[activityTypeForRoute(route)]?.label || 'No disponible';
    const values = [
        ['Distancia', `${(Number(route.distanceKm) || 0).toFixed(1)} km`],
        ['Desnivel', `+${Math.round(Number(route.elevationGain) || 0)} m`],
        ['Tiempo en movimiento', route.movingTimeSec > 0 ? fmtDur(route.movingTimeSec) : 'No disponible'],
        ['Actividad', activity],
        [route.kind === 'imported' ? 'Importada por' : 'Realizada por', creator],
        ['Fecha', route.startedAt ? fmtDate(route.startedAt) : 'No disponible']
    ];
    openCommunityDetail({ title: route.name }, lines, {
        backLabel: 'Volver a mis rutas',
        pois: Array.isArray(route.pois) ? route.pois : [],
        onBack: closeCommunityDialog,
        onFollow: () => {
            closeCommunityDialog();
            followRoute(route);
        },
        values
    });
}

$('route-activity-filter').addEventListener('change', renderSavedRoutes);
$('route-user-filter').addEventListener('change', renderSavedRoutes);

$('btn-import-route').addEventListener('click', async () => {
    const input = $('route-file-input');
    const file = input.files[0];
    if (!file) { toast('Elige primero un archivo GPX, KML o GeoJSON.'); return; }
    const maxFileSize = 10 * 1024 * 1024;
    if (file.size > maxFileSize) {
        toast('El archivo supera el límite de importación de 10 MB.', 6000);
        return;
    }
    let route;
    try {
        const parsed = parseTrack(await file.text(), file.name);
        const activityType = await openActivityPicker(preferredActivityType, false, 'import');
        if (!activityType) return;
        const base = (parsed.name || file.name.replace(/\.[^.]+$/, '') || 'Track importado').trim();
        route = buildImportedRoute(parsed, `${routeActivityPrefix(activityType)}${base}`);
        route.activityType = activityType;
    } catch (e) {
        console.warn('No se pudo importar el track:', e);
        toast(`No se pudo importar el track: ${e.message || e}`);
        return;
    }
    if (await saveRoute(route)) {
        input.value = '';
        toast('Track importado y almacenado.');
    }
});

$('saved-routes-list').addEventListener('click', async e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = Number(btn.closest('.route-item').dataset.id);
    const r = savedRoutes.find(x => x.id === id);
    if (!r) return;

    if (btn.dataset.act === 'follow') {
        followRoute(r);
    } else if (btn.dataset.act === 'activity') {
        let name = routeNameWithoutActivity(r).trim();
        if (!name) {
            name = await promptRequiredRouteName('');
            if (name === null) return;
        }
        const activityType = await openActivityPicker(activityTypeForRoute(r) || preferredActivityType, false, 'classification');
        if (!activityType) return;
        r.activityType = activityType;
        r.name = `${routeActivityPrefix(activityType)}${name}`;
        if (r.remoteId) r.dirty = true;
        try { await DB.put(r); }
        catch (err) { toast('No se pudo guardar la actividad de la ruta'); return; }
        renderSavedRoutes();
        syncRoutes();
    } else if (btn.dataset.act === 'rename') {
        const name = await promptRequiredRouteName(routeNameWithoutActivity(r));
        if (name === null) return;
        const activityType = activityTypeForRoute(r);
        if (activityType) r.activityType = activityType;
        r.name = (activityType ? routeActivityPrefix(activityType) : '') + name;
        if (r.remoteId) r.dirty = true;
        try { await DB.put(r); } catch (err) { toast('No se pudo guardar el cambio'); }
        renderSavedRoutes();
        syncRoutes();
    } else if (btn.dataset.act === 'gpx') {
        const safe = r.name.replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]+/g, '_').trim() || 'ruta';
        download(`${safe}.gpx`, routeToGpx(r), 'application/gpx+xml');
    } else if (btn.dataset.act === 'community') {
        openCommunityPublish(r);
    } else if (btn.dataset.act === 'del') {
        const ok = await modal({ message: `¿Eliminar «${r.name}»? No se puede deshacer.`, ok: 'Eliminar' });
        if (!ok) return;
        try { await DB.del(id); } catch (err) { toast('No se pudo eliminar del dispositivo'); }
        if (r.remoteId) await queueRemoteDelete(r.remoteId);
        savedRoutes = savedRoutes.filter(x => x.id !== id);
        if (followedRoute && followedRoute.id === id) unfollowRoute();
        renderSavedRoutes();
        refreshStats();
            syncRoutes();
    }
});

// ============================================================
