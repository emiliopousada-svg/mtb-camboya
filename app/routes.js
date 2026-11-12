'use strict';

//  RUTAS GUARDADAS
// ============================================================
let routesTab = 'done';
let routesShowAll = false;
let routeCardImageUrls = [];
let routeCardMaps = [];
let routeCardMapObserver = null;

function updateRouteSummaryCounts() {
    $('routes-count-done').textContent = String(savedRoutes.filter(route => route.kind !== 'imported').length);
    $('routes-count-pending').textContent = String(savedRoutes.filter(route => route.kind === 'imported').length);
    $('routes-count-community').textContent = String(savedRoutes.filter(route => route.communityRouteId).length);
}

function routeCoverPhoto(route) {
    const poi = Array.isArray(route.pois) && route.pois.find(item =>
        item && (item.photo instanceof Blob || (typeof item.photoUrl === 'string' && /^https:\/\//i.test(item.photoUrl)))
    );
    if (!poi) return '';
    if (poi.photo instanceof Blob) {
        const url = URL.createObjectURL(poi.photo);
        routeCardImageUrls.push(url);
        return url;
    }
    return poi.photoUrl;
}

function createRouteCardMap(route) {
    const points = Array.isArray(route.points) ? route.points : [];
    const segments = [];
    let segment = [];
    const finishSegment = () => {
        if (segment.length) segments.push(segment);
        segment = [];
    };

    points.forEach(point => {
        if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])
            || Math.abs(point[0]) > 90 || Math.abs(point[1]) > 180) {
            finishSegment();
            return;
        }
        if (point[5] === 1) finishSegment();
        segment.push([point[0], point[1]]);
    });
    finishSegment();

    const routePoints = segments.reduce((count, item) => count + item.length, 0);
    if (!routePoints) return null;

    const segmentLimit = 250;
    const segmentStep = Math.max(1, Math.ceil(segments.length / segmentLimit));
    const visibleSegments = segments.filter((_, index) =>
        index % segmentStep === 0 || index === segments.length - 1
    );
    const samplingStep = Math.max(1, Math.ceil(routePoints / 500));
    const sampledSegments = visibleSegments.map(item => {
        const step = samplingStep;
        const sampled = item.filter((_, index) => index % step === 0 || index === item.length - 1);
        return sampled;
    }).filter(item => item.length);
    const allPoints = sampledSegments.flat();
    const referenceLatitude = allPoints.reduce((sum, point) => sum + point[0], 0) / allPoints.length;
    const longitudeScale = Math.max(0.01, Math.cos(referenceLatitude * Math.PI / 180));
    const projected = allPoints.map(([latitude, longitude]) => [longitude * longitudeScale, latitude]);
    const bounds = projected.reduce((result, point) => ({
        minX: Math.min(result.minX, point[0]),
        maxX: Math.max(result.maxX, point[0]),
        minY: Math.min(result.minY, point[1]),
        maxY: Math.max(result.maxY, point[1])
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    const { minX, maxX, minY, maxY } = bounds;
    const width = 640;
    const height = 300;
    const padding = 36;
    const scale = Math.min(
        (width - padding * 2) / Math.max(maxX - minX, 0.00001),
        (height - padding * 2) / Math.max(maxY - minY, 0.00001)
    );
    const project = ([latitude, longitude]) => [
        (longitude * longitudeScale - minX) * scale + (width - (maxX - minX) * scale) / 2,
        height - ((latitude - minY) * scale + (height - (maxY - minY) * scale) / 2)
    ];
    const container = document.createElement('div');
    container.className = 'route-card-map';
    container.setAttribute('role', 'img');
    container.setAttribute('aria-label', `Mapa con el recorrido de ${route.name || 'la ruta'}`);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.classList.add('route-card-map-fallback');

    sampledSegments.forEach(pointsInSegment => {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const coordinates = pointsInSegment.map(project);
        path.setAttribute('d', coordinates.map(([x, y], index) =>
            `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
        ).join(' '));
        const halo = path.cloneNode();
        halo.classList.add('route-card-map-halo');
        svg.appendChild(halo);
        path.classList.add('route-card-map-line');
        svg.appendChild(path);
    });

    [allPoints[0], allPoints[allPoints.length - 1]].forEach((point, index) => {
        const [cx, cy] = project(point);
        const marker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        marker.setAttribute('cx', cx.toFixed(1));
        marker.setAttribute('cy', cy.toFixed(1));
        marker.setAttribute('r', index ? '8' : '9');
        marker.classList.add(index ? 'route-card-map-end' : 'route-card-map-start');
        svg.appendChild(marker);
    });
    container.appendChild(svg);
    return container;
}

function showRouteCardMap(container, route) {
    if (typeof L === 'undefined' || typeof communityRawSegments !== 'function') return;
    const lines = communityRawSegments(route.points);
    if (!lines.length) return;
    let previewMap = null;
    try {
        previewMap = L.map(container, {
            scrollWheelZoom: false,
            dragging: false,
            doubleClickZoom: false,
            touchZoom: false,
            boxZoom: false,
            keyboard: false,
            zoomControl: false
        });
        const style = selectedMapStyle();
        const baseLayer = !navigator.onLine || style === 'ign'
            ? createOfflineTileLayer()
            : createMapStyleLayer(style);
        baseLayer.addTo(previewMap);
        const routeLine = L.polyline(lines, {
            color: '#16883d',
            weight: 4,
            opacity: 0.95
        }).addTo(previewMap);
        L.circleMarker(lines[0][0], {
            radius: 4,
            color: '#16883d',
            weight: 2,
            fillColor: '#fff',
            fillOpacity: 1
        }).addTo(previewMap);
        const lastLine = lines[lines.length - 1];
        L.circleMarker(lastLine[lastLine.length - 1], {
            radius: 4,
            color: '#fff',
            weight: 2,
            fillColor: '#16883d',
            fillOpacity: 1
        }).addTo(previewMap);
        previewMap.fitBounds(routeLine.getBounds(), { padding: [22, 22], maxZoom: 14, animate: false });
        previewMap.invalidateSize({ pan: false });
        container.removeAttribute('role');
        container.removeAttribute('aria-label');
        routeCardMaps.push(previewMap);
    } catch (error) {
        if (previewMap) previewMap.remove();
        console.warn('No se pudo cargar el mapa de vista previa de la ruta:', error);
    }
}

function observeRouteCardMap(container, route) {
    if (typeof IntersectionObserver === 'undefined') {
        showRouteCardMap(container, route);
        return;
    }
    if (!routeCardMapObserver) {
        routeCardMapObserver = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                routeCardMapObserver.unobserve(entry.target);
                showRouteCardMap(entry.target, entry.target.routePreviewData);
                delete entry.target.routePreviewData;
            });
        });
    }
    container.routePreviewData = route;
    routeCardMapObserver.observe(container);
}

function clearRouteCardMaps() {
    if (routeCardMapObserver) routeCardMapObserver.disconnect();
    routeCardMapObserver = null;
    routeCardMaps.forEach(previewMap => previewMap.remove());
    routeCardMaps = [];
}

function routeTimeSummary(seconds) {
    const minutes = Math.floor((Number(seconds) || 0) / 60);
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return hours
        ? `${hours}:${String(remainingMinutes).padStart(2, '0')}`
        : `${minutes} min`;
}

function routeAverageSpeed(route) {
    const analysis = typeof statsAnalyzeRoute === 'function' ? statsAnalyzeRoute(route) : null;
    if (analysis && Number.isFinite(analysis.averageSpeed)) return analysis.averageSpeed;
    const movingTimeSec = Number(route.movingTimeSec) || 0;
    return movingTimeSec > 0 ? (Number(route.distanceKm) || 0) / (movingTimeSec / 3600) : null;
}

function routeMovingTime(route) {
    const analysis = typeof statsAnalyzeRoute === 'function' ? statsAnalyzeRoute(route) : null;
    return analysis && Number.isFinite(analysis.movingTimeSec)
        ? analysis.movingTimeSec
        : Number(route.movingTimeSec) || 0;
}

function routeSaveEditedMetadata(route) {
    if (route.remoteId) route.dirty = true;
    return DB.put(route).then(() => {
        renderSavedRoutes();
        syncRoutes();
    }).catch(error => {
        console.warn('No se pudieron guardar los detalles de la ruta:', error);
        toast('No se pudieron guardar los detalles de la ruta.');
    });
}

async function editRouteDetails(route) {
    const description = await modal({
        message: 'Descripción de la actividad (opcional):',
        input: route.description || '',
        ok: 'Continuar'
    });
    if (description === null) return;
    const folder = await modal({
        message: 'Carpeta para organizar esta ruta (opcional):',
        input: route.folder || '',
        ok: 'Guardar'
    });
    if (folder === null) return;
    route.description = String(description).trim().slice(0, 500);
    route.folder = String(folder).trim().slice(0, 60);
    await routeSaveEditedMetadata(route);
}

async function shareSavedRoute(route) {
    const summary = [
        route.name,
        route.startedAt ? fmtDate(route.startedAt) : '',
        `${(Number(route.distanceKm) || 0).toFixed(1)} km`,
        `+${Math.round(Number(route.elevationGain) || 0)} m`,
        route.movingTimeSec > 0 ? fmtDur(route.movingTimeSec) : '',
        routeAverageSpeed(route) ? `${routeAverageSpeed(route).toFixed(1)} km/h` : ''
    ].filter(Boolean).join(' · ');
    const cap = window.Capacitor;
    try {
        if (cap && cap.isNativePlatform && cap.isNativePlatform() && cap.Plugins?.Share) {
            await cap.Plugins.Share.share({ title: route.name, text: summary, dialogTitle: 'Compartir actividad' });
        } else if (navigator.share) {
            await navigator.share({ title: route.name, text: summary });
        } else if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(summary);
            toast('Resumen de la actividad copiado.');
        } else {
            await download(`${String(route.name || 'ruta').replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]+/g, '_')}.gpx`,
                routeToGpx(route), 'application/gpx+xml');
        }
    } catch (error) {
        if (error && (error.name === 'AbortError' || /cancel/i.test(String(error.message || error)))) return;
        console.warn('No se pudo compartir la actividad:', error);
        toast('No se pudo compartir la actividad.');
    }
}

function routeComparisonValues(route) {
    const analysis = typeof statsAnalyzeRoute === 'function' ? statsAnalyzeRoute(route) : null;
    const speed = routeAverageSpeed(route);
    const altitudes = (Array.isArray(route.points) ? route.points : [])
        .map(point => point && point[2]).filter(Number.isFinite);
    const altitudeRange = altitudes.reduce((range, altitude) => [
        Math.min(range[0], altitude), Math.max(range[1], altitude)
    ], [Infinity, -Infinity]);
    return [
        ['Distancia', `${(Number(route.distanceKm) || 0).toFixed(1)} km`],
        ['Desnivel positivo', `+${Math.round(Number(route.elevationGain) || 0)} m`],
        ['Tiempo en movimiento', Number(route.movingTimeSec) > 0 ? fmtDur(Number(route.movingTimeSec)) : '—'],
        ['Velocidad media', Number.isFinite(speed) ? `${speed.toFixed(1)} km/h` : '—'],
        ['Velocidad máxima', analysis && Number.isFinite(analysis.maxSpeed) ? `${analysis.maxSpeed.toFixed(1)} km/h` : '—'],
        ['Frecuencia cardiaca media', analysis && Number.isFinite(analysis.averageHr)
            ? `${Math.round(analysis.averageHr)} bpm`
            : Number(route.hrAvg) > 0 ? `${Math.round(Number(route.hrAvg))} bpm` : '—'],
        ['Altitud mínima / máxima', altitudes.length
            ? `${Math.round(altitudeRange[0])} / ${Math.round(altitudeRange[1])} m` : '—']
    ];
}

function renderRouteComparison() {
    const select = $('route-compare-select');
    const current = savedRoutes.find(route => String(route.id) === select.value);
    const container = $('route-compare-results');
    container.replaceChildren();
    if (!current || !routeComparisonSource) return;
    const table = document.createElement('table');
    table.className = 'route-compare-table';
    const header = document.createElement('tr');
    ['', routeComparisonSource.name, current.name].forEach(text => {
        const cell = document.createElement('th');
        cell.textContent = text;
        header.appendChild(cell);
    });
    table.appendChild(header);
    const left = routeComparisonValues(routeComparisonSource);
    const right = routeComparisonValues(current);
    left.forEach(([label, value], index) => {
        const row = document.createElement('tr');
        [label, value, right[index][1]].forEach(text => {
            const cell = document.createElement('td');
            cell.textContent = text;
            row.appendChild(cell);
        });
        table.appendChild(row);
    });
    container.appendChild(table);
}

let routeComparisonSource = null;

function setRoutesTab(tab) {
    routesTab = tab;
    routesShowAll = tab === 'pending';
    const communityTab = tab === 'community';
    document.querySelectorAll('[data-routes-tab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.routesTab === tab)));
    $('routes-import-box').hidden = tab !== 'pending';
    $('routes-latest-section').hidden = tab !== 'done';
    $('routes-show-all').hidden = tab !== 'done';
    $('community-tab').hidden = !communityTab;
    $('routes-tab-hint').textContent = tab === 'done'
        ? 'Solo las rutas que has grabado tú. Usa 🏷️ para cambiar la actividad y ✏️ para el nombre.'
        : 'Tracks importados y guardados. Cuando los sigas y grabes tu salida, esta quedará en «Realizadas».';
    renderSavedRoutes();
    if (communityTab && typeof loadCommunityRoutes === 'function') loadCommunityRoutes();
}
document.querySelectorAll('[data-routes-tab]').forEach(b => b.addEventListener('click', () => setRoutesTab(b.dataset.routesTab)));

function routeCreatorName(route) {
    const creator = String(route.createdBy || Cloud.email || '').trim();
    const atIndex = creator.indexOf('@');
    return (atIndex > 0 ? creator.slice(0, atIndex) : creator) || 'Usuario local';
}

function renderSavedRoutes() {
    const c = $('saved-routes-list');
    clearRouteCardMaps();
    c.textContent = '';
    routeCardImageUrls.forEach(url => URL.revokeObjectURL(url));
    routeCardImageUrls = [];
    const pendingTab = routesTab === 'pending';
    const communityTab = routesTab === 'community';
    const tabRoutes = savedRoutes.filter(r => (r.kind === 'imported') === pendingTab);
    updateRouteSummaryCounts();
    $('route-list-controls').hidden = communityTab || (!routesShowAll && !pendingTab);
    c.hidden = communityTab;
    $('routes-show-all').innerHTML = routesShowAll ? 'Ver menos <span aria-hidden="true">↑</span>' : 'Ver todas <span aria-hidden="true">→</span>';
    const userFilter = $('route-user-filter');
    const selectedUser = userFilter.value;
    const users = [...new Set(tabRoutes.map(routeCreatorName))].sort((a, b) => a.localeCompare(b, 'es'));
    userFilter.replaceChildren(new Option('Todos los usuarios', ''));
    users.forEach(user => userFilter.add(new Option(user, user)));
    userFilter.value = users.includes(selectedUser) ? selectedUser : '';
    const folderFilter = $('route-folder-filter');
    const selectedFolder = folderFilter.value;
    const folders = [...new Set(tabRoutes.map(route => String(route.folder || '').trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'es'));
    folderFilter.replaceChildren(new Option('Todas las carpetas', ''));
    folders.forEach(folder => folderFilter.add(new Option(folder, folder)));
    folderFilter.value = folders.includes(selectedFolder) ? selectedFolder : '';
    if (tabRoutes.length === 0) {
        const e = document.createElement('div');
        e.className = 'routes-empty';
        e.textContent = pendingTab
            ? 'No hay tracks guardados. Importa un GPX, KML o GeoJSON para tenerlo listo.'
            : 'No hay rutas realizadas todavía. Graba una salida para verla aquí.';
        c.appendChild(e);
        return;
    }
    const filter = routesShowAll || pendingTab ? $('route-activity-filter').value : 'all';
    const user = routesShowAll || pendingTab ? userFilter.value : '';
    const folder = routesShowAll || pendingTab ? folderFilter.value : '';
    const visibleRoutes = tabRoutes.filter(route => {
        if (user && routeCreatorName(route) !== user) return false;
        if (folder && String(route.folder || '').trim() !== folder) return false;
        if (filter === 'all') return true;
        const activityType = activityTypeForRoute(route);
        const groupKey = activityType || 'other';
        return groupKey === filter;
    });
    if (!visibleRoutes.length) {
        const empty = document.createElement('div');
        empty.className = 'routes-empty';
        empty.textContent = 'No hay rutas con estos filtros.';
        c.appendChild(empty);
        return;
    }
    const sortedRoutes = visibleRoutes.slice().sort((a, b) =>
        (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0)
    );
    const routesToRender = !routesShowAll && !pendingTab ? sortedRoutes.slice(0, 3) : sortedRoutes;
    if (!routesShowAll && !pendingTab) {
        routesToRender.forEach(route => c.appendChild(createRouteCard(route)));
        return;
    }
    const groups = new Map();
    routesToRender.forEach(r => {
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
            c.appendChild(createRouteCard(r));
        });
    });
}

function createRouteCard(route) {
    const card = document.createElement('article');
    card.className = 'route-item route-activity-card';
    card.dataset.id = route.id;

    const cover = document.createElement('div');
    cover.className = 'route-card-cover';
    const activityType = activityTypeForRoute(route);
    const activity = ACTIVITY_TYPES[activityType] || null;
    cover.dataset.activity = activityType || 'other';
    const mapPreview = createRouteCardMap(route);
    if (mapPreview) {
        cover.appendChild(mapPreview);
        observeRouteCardMap(mapPreview, route);
    } else {
        const photoUrl = routeCoverPhoto(route);
        if (photoUrl) {
            const photo = document.createElement('img');
            photo.src = photoUrl;
            photo.alt = `Foto de ${route.name}`;
            photo.loading = 'lazy';
            cover.appendChild(photo);
        } else {
            const coverIcon = document.createElement('span');
            coverIcon.className = 'route-cover-icon';
            coverIcon.setAttribute('aria-hidden', 'true');
            coverIcon.textContent = activity ? activity.icon : '📍';
            cover.appendChild(coverIcon);
        }
    }

    const body = document.createElement('div');
    body.className = 'route-card-body';
    const title = document.createElement('button');
    title.type = 'button';
    title.className = 'route-detail-trigger';
    title.textContent = route.name;
    title.addEventListener('click', () => openSavedRouteDetail(route));
    const subtitle = document.createElement('p');
    subtitle.className = 'route-card-subtitle';
    subtitle.textContent = [activity?.label || 'Ruta', route.startedAt ? fmtDate(route.startedAt) : ''].filter(Boolean).join(' · ');
    const description = document.createElement('p');
    description.className = 'route-card-description';
    description.textContent = String(route.description || '');
    description.hidden = !description.textContent;
    const metrics = document.createElement('div');
    metrics.className = 'route-card-metrics';
    [
        [new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Number(route.distanceKm) || 0), 'km'],
        [String(Math.round(Number(route.elevationGain) || 0)), 'Desnivel (m)'],
        [routeMovingTime(route) > 0 ? routeTimeSummary(routeMovingTime(route)) : '—', 'Tiempo'],
        [Number.isFinite(routeAverageSpeed(route)) ? `${routeAverageSpeed(route).toFixed(1)}` : '—', 'km/h media']
    ].forEach(([value, label]) => {
        const metric = document.createElement('div');
        const strong = document.createElement('strong');
        strong.textContent = value;
        const caption = document.createElement('span');
        caption.textContent = label;
        metric.append(strong, caption);
        metrics.appendChild(metric);
    });

    const viewButton = document.createElement('button');
    viewButton.type = 'button';
    viewButton.className = 'route-view-button';
    viewButton.textContent = 'Ver recorrido';
    viewButton.dataset.act = 'view';
    body.append(title, subtitle, description, metrics, viewButton);
    card.append(cover, body);

    const showFullActions = routesShowAll || routesTab === 'pending';
    const canPublishCommunity = route.kind !== 'community' && !route.communityRouteId;
    const canShareGroupRanking = route.kind === 'recorded';
    if (showFullActions || (routesTab === 'done' && (canPublishCommunity || canShareGroupRanking))) {
        const actions = document.createElement('div');
        actions.className = 'route-actions';
        const routeActions = showFullActions ? [
            ['follow', 'Seguir', ''],
            ['edit-details', 'Descripción/carpeta', 'secondary'],
            ['compare', 'Comparar', 'secondary'],
            ['share', 'Compartir', 'secondary'],
            ['activity', '🏷️ Actividad', 'secondary'],
            ['rename', '✏️', 'secondary'],
            ['gpx', '⬇️ GPX', 'secondary'],
            ['del', '🗑️', 'danger']
        ] : [];
        if (canPublishCommunity) routeActions.splice(showFullActions ? 1 : 0, 0, ['community', '🌍 Publicar', 'secondary']);
        if (canShareGroupRanking) routeActions.push(['group-ranking', '🏆 Grupo', 'secondary']);
        routeActions.forEach(([action, label, className]) => {
            const button = document.createElement('button');
            button.className = `btn-small ${className}`;
            button.dataset.act = action;
            button.textContent = label;
            actions.appendChild(button);
        });
        card.appendChild(actions);
    }
    return card;
}

$('btn-routes-add').addEventListener('click', () => {
    goToPage(0);
    setTimeout(() => btnStart.click(), 220);
});

$('routes-show-all').addEventListener('click', () => {
    routesShowAll = !routesShowAll;
    renderSavedRoutes();
});

async function openSavedRouteDetail(route) {
    const returnRoutesTab = routesTab;
    try { await DB.loadRoutePhotos(route); }
    catch (error) { console.warn('No se pudieron cargar las fotos de la ruta:', error); }
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
        ['Tiempo en movimiento', routeMovingTime(route) > 0 ? fmtDur(routeMovingTime(route)) : 'No disponible'],
        ['Velocidad media', Number.isFinite(routeAverageSpeed(route)) ? `${routeAverageSpeed(route).toFixed(1)} km/h` : 'No disponible'],
        ['Velocidad máxima', typeof statsAnalyzeRoute === 'function' && Number.isFinite(statsAnalyzeRoute(route).maxSpeed)
            ? `${statsAnalyzeRoute(route).maxSpeed.toFixed(1)} km/h` : 'No disponible'],
        ['Actividad', activity],
        ['Frecuencia cardiaca media', typeof statsAnalyzeRoute === 'function' && Number.isFinite(statsAnalyzeRoute(route).averageHr)
            ? `${Math.round(statsAnalyzeRoute(route).averageHr)} bpm`
            : Number(route.hrAvg) > 0 ? `${Math.round(Number(route.hrAvg))} bpm` : 'No disponible'],
        [route.kind === 'imported' ? 'Importada por' : 'Realizada por', creator],
        ['Fecha', route.startedAt ? fmtDate(route.startedAt) : 'No disponible'],
        ['Carpeta', route.folder || 'Sin carpeta']
    ];
    if (route.description) values.push(['Descripción', route.description]);
    routeComparisonSource = route;
    const compareSection = $('route-comparison');
    const compareSelect = $('route-compare-select');
    compareSelect.replaceChildren(new Option('Selecciona una actividad', ''));
    savedRoutes.filter(other => other.id !== route.id && other.kind !== 'imported')
        .sort((a, b) => (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0))
        .forEach(other => compareSelect.add(new Option(
            `${other.name} · ${other.startedAt ? fmtDate(other.startedAt) : 'sin fecha'}`,
            String(other.id)
        )));
    compareSection.hidden = true;
    $('route-compare-results').replaceChildren();
    openCommunityDetail({ title: route.name }, lines, {
        backLabel: 'Volver a mis rutas',
        onBack: () => {
            closeCommunityDialog();
            if (currentPage !== 3) goToPage(3);
            setRoutesTab(returnRoutesTab);
        },
        pois: Array.isArray(route.pois) ? route.pois : [],
        onFollow: () => {
            closeCommunityDialog();
            followRoute(route);
        },
        values,
        actions: [
            ['Comparar', () => { compareSection.hidden = !compareSection.hidden; }],
            ['Compartir', () => shareSavedRoute(route)],
            ['Exportar GPX', () => download(`${String(route.name || 'ruta').replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]+/g, '_')}.gpx`,
                routeToGpx(route), 'application/gpx+xml')]
        ]
    });
}

$('route-activity-filter').addEventListener('change', renderSavedRoutes);
$('route-user-filter').addEventListener('change', renderSavedRoutes);
$('route-folder-filter').addEventListener('change', renderSavedRoutes);
$('route-compare-select').addEventListener('change', renderRouteComparison);

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
        const parsed = /\.fit$/i.test(file.name)
            ? await parseFitTrack(await file.arrayBuffer())
            : parseTrack(await file.text(), file.name);
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

    if (btn.dataset.act === 'view') {
        await openSavedRouteDetail(r);
    } else if (btn.dataset.act === 'follow') {
        try { await DB.loadRoutePhotos(r); }
        catch (error) { console.warn('No se pudieron cargar las fotos de la ruta:', error); }
        followRoute(r);
    } else if (btn.dataset.act === 'edit-details') {
        await editRouteDetails(r);
    } else if (btn.dataset.act === 'compare') {
        await openSavedRouteDetail(r);
        setTimeout(() => {
            $('route-comparison').hidden = false;
            $('route-compare-select').focus();
        }, 0);
    } else if (btn.dataset.act === 'share') {
        await shareSavedRoute(r);
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
        try { await DB.loadRoutePhotos(r); }
        catch (error) { console.warn('No se pudieron cargar las fotos de la ruta:', error); }
        openCommunityPublish(r);
    } else if (btn.dataset.act === 'group-ranking') {
        await shareRouteToGroupRanking(r, btn);
    } else if (btn.dataset.act === 'del') {
        const ok = await modal({ message: `¿Eliminar «${r.name}»? No se puede deshacer.`, ok: 'Eliminar' });
        if (!ok) return;
        try { await DB.deleteRoute(id, r.remoteId); }
        catch (err) { toast('No se pudo eliminar la ruta ni programar su borrado'); return; }
        savedRoutes = savedRoutes.filter(x => x.id !== id);
        if (followedRoute && followedRoute.id === id) unfollowRoute();
        renderSavedRoutes();
        refreshStats();
        syncRoutes();
    }
});

// ============================================================
