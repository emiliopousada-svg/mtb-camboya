'use strict';

//  RUTAS GUARDADAS
// ============================================================
let routesTab = 'done';
let routesShowAll = false;
const routeSortByTab = { done: 'recent', pending: 'recent' };
let routeCardImageUrls = [];
let routeCardMaps = [];
let routeCardMapObserver = null;

function updateRouteSummaryCounts() {
    $('routes-count-done').textContent = String(savedRoutes.filter(route => route.kind === 'recorded' || !route.kind).length);
    $('routes-count-pending').textContent = String(savedRoutes.filter(route => route.kind === 'imported').length);
}

function routeBelongsInRoutesTab(route, tab) {
    if (tab === 'pending') return route.kind === 'imported';
    if (tab === 'done') return route.kind === 'recorded' || !route.kind;
    return false;
}

function routeCanPublishCommunity(route) {
    return route.kind !== 'community' && (route.kind !== 'imported' || !route.communityRouteId);
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

function routeDistanceKm(route) {
    const stored = route.distanceKm == null ? null : Number(route.distanceKm);
    if (Number.isFinite(stored) && (stored > 0 || route.kind !== 'imported')) return stored;
    const points = Array.isArray(route.points) ? route.points : [];
    let distanceM = 0, pointCount = 0, previous = null;
    points.forEach(point => {
        if (!Array.isArray(point) || !Number.isFinite(Number(point[0])) || !Number.isFinite(Number(point[1]))
            || Math.abs(Number(point[0])) > 90 || Math.abs(Number(point[1])) > 180) {
            previous = null;
            return;
        }
        if (point[5] === 1) previous = null;
        if (previous) distanceM += dist(previous, point);
        previous = point;
        pointCount++;
    });
    return pointCount >= 2 ? distanceM / 1000 : Number.isFinite(stored) ? stored : null;
}

function routePerformedAt(route) {
    if (route.communityRouteId) {
        const date = String(route.performedAt || '').slice(0, 10);
        return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T12:00:00`))
            ? `${date}T12:00:00`
            : '';
    }
    if (route.kind === 'imported') {
        const startedAt = (Array.isArray(route.points) ? route.points : []).reduce((earliest, point) => {
            const timestamp = Array.isArray(point) ? point[3] : null;
            if (timestamp == null || !Number.isFinite(timestamp) || timestamp <= 0
                || !Number.isFinite(new Date(timestamp).getTime())) return earliest;
            return earliest === null || timestamp < earliest ? timestamp : earliest;
        }, null);
        return startedAt === null ? '' : new Date(startedAt).toISOString();
    }
    return route.startedAt || '';
}

function routeImportTimestamp(route) {
    const importedAt = Date.parse(route.importedAt || route.createdAt || '');
    if (Number.isFinite(importedAt)) return importedAt;
    const id = Number(route.id);
    if (Number.isSafeInteger(id) && id >= 100000000000) return id;
    return Date.parse(route.startedAt) || 0;
}

function sortRoutesForList(routes, order, tab) {
    const metricKey = order.startsWith('distance-') ? 'distance'
        : order.startsWith('time-') ? 'time'
            : order.startsWith('elevation-') ? 'elevation' : '';
    const values = new Map(routes.map(route => {
        let value = null;
        if (metricKey === 'distance') value = routeDistanceKm(route);
        if (metricKey === 'time') {
            const movingTime = routeMovingTime(route);
            value = movingTime > 0 ? movingTime : null;
        }
        if (metricKey === 'elevation') {
            const stored = route.elevationGain == null ? null : Number(route.elevationGain);
            if (Number.isFinite(stored)) value = stored;
            else {
                const analysis = typeof statsAnalyzeRoute === 'function' ? statsAnalyzeRoute(route) : null;
                value = analysis && analysis.ascentAvailable ? analysis.ascentM : null;
            }
        }
        if (!metricKey) value = tab === 'pending'
            ? routeImportTimestamp(route)
            : Date.parse(routePerformedAt(route)) || 0;
        return [route, value];
    }));
    return routes.slice().sort((a, b) => {
        const aValue = values.get(a), bValue = values.get(b);
        if (aValue == null || !Number.isFinite(aValue)) return bValue == null || !Number.isFinite(bValue) ? 0 : 1;
        if (bValue == null || !Number.isFinite(bValue)) return -1;
        const descending = !metricKey || order.endsWith('-desc');
        return (aValue - bValue) * (descending ? -1 : 1);
    });
}

function routeHasElevationData(route) {
    const stored = route.elevationGain == null ? null : Number(route.elevationGain);
    if (Number.isFinite(stored) && (stored > 0 || route.kind !== 'imported')) return true;
    const points = Array.isArray(route.points) ? route.points : [];
    let segmentAltitudeCount = 0;
    for (const point of points) {
        if (!Array.isArray(point) || point[5] === 1) segmentAltitudeCount = 0;
        if (Array.isArray(point) && point[2] != null && Number.isFinite(Number(point[2]))) {
            if (++segmentAltitudeCount >= 2) return true;
        }
    }
    return false;
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
        ok: 'Guardar'
    });
    if (description === null) return;
    route.description = String(description).trim().slice(0, 500);
    await routeSaveEditedMetadata(route);
}

async function shareSavedRoute(route) {
    const baseName = String(route.name || 'ruta')
        .replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]+/g, '_').trim().replace(/\.gpx$/i, '') || 'ruta';
    const filename = `${baseName}.gpx`;
    const gpx = routeToGpx(route);
    const cap = window.Capacitor;
    try {
        if (cap && cap.isNativePlatform && cap.isNativePlatform() && cap.Plugins?.Share) {
            await download(filename, gpx, 'application/gpx+xml');
        } else if (typeof File === 'function' && navigator.share && navigator.canShare) {
            const file = new File([gpx], filename, { type: 'application/gpx+xml' });
            if (navigator.canShare({ files: [file] })) {
                await navigator.share({ title: route.name || filename, files: [file] });
            } else {
                await download(filename, gpx, 'application/gpx+xml');
            }
        } else {
            await download(filename, gpx, 'application/gpx+xml');
        }
    } catch (error) {
        if (error && (error.name === 'AbortError' || /cancel/i.test(String(error.message || error)))) return;
        console.warn('No se pudo compartir la actividad:', error);
        toast('No se pudo compartir la actividad.');
    }
}

function setRoutesTab(tab) {
    routesTab = tab;
    routesShowAll = tab === 'pending';
    if (tab === 'done' || tab === 'pending') $('route-sort-filter').value = routeSortByTab[tab];
    const communityTab = tab === 'community';
    document.querySelectorAll('[data-routes-tab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.routesTab === tab)));
    $('routes-import-box').hidden = tab !== 'pending';
    $('routes-latest-section').hidden = tab !== 'done';
    $('routes-show-all').hidden = tab !== 'done';
    $('community-tab').hidden = !communityTab;
    $('routes-tab-hint').textContent = tab === 'done'
        ? 'Tus rutas, ordenadas por fecha de realización (más reciente primero). También puedes ordenarlas por distancia, tiempo o desnivel.'
        : tab === 'pending'
            ? 'Tracks importados y rutas de la comunidad guardadas en el móvil. Se ordenan por importación o por distancia, tiempo y desnivel.'
            : 'Explora rutas publicadas por la comunidad.';
    renderSavedRoutes();
    if (communityTab && typeof loadCommunityRoutes === 'function') loadCommunityRoutes();
}
document.querySelectorAll('[data-routes-tab]').forEach(b => b.addEventListener('click', () => setRoutesTab(b.dataset.routesTab)));

function routeCreatorName(route) {
    const creator = String(route.kind === 'imported'
        ? (Cloud.nickname || route.createdBy || Cloud.email)
        : (route.createdBy || Cloud.nickname || Cloud.email)).trim();
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
    const tabRoutes = savedRoutes.filter(route => routeBelongsInRoutesTab(route, routesTab));
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
    if (tabRoutes.length === 0) {
        const e = document.createElement('div');
        e.className = 'routes-empty';
        e.textContent = pendingTab
            ? 'No hay rutas guardadas. Importa un GPX, KML o GeoJSON, o descarga una ruta de la comunidad.'
            : 'No hay rutas realizadas todavía. Graba una salida para verla aquí.';
        c.appendChild(e);
        return;
    }
    const filter = routesShowAll || pendingTab ? $('route-activity-filter').value : 'all';
    const user = routesShowAll || pendingTab ? userFilter.value : '';
    const visibleRoutes = tabRoutes.filter(route => {
        if (user && routeCreatorName(route) !== user) return false;
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
    const sortedRoutes = sortRoutesForList(visibleRoutes, $('route-sort-filter').value || 'recent', routesTab);
    const routesToRender = !routesShowAll && !pendingTab ? sortedRoutes.slice(0, 3) : sortedRoutes;
    if (!routesShowAll && !pendingTab) {
        routesToRender.forEach(route => c.appendChild(createRouteCard(route)));
        return;
    }
    routesToRender.forEach(route => c.appendChild(createRouteCard(route)));
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
    const performedAt = routePerformedAt(route);
    subtitle.textContent = [activity?.label || 'Ruta', performedAt ? fmtDate(performedAt) : ''].filter(Boolean).join(' · ');
    const description = document.createElement('p');
    description.className = 'route-card-description';
    description.textContent = String(route.description || '');
    description.hidden = !description.textContent;
    const metrics = document.createElement('div');
    metrics.className = 'route-card-metrics';
    const distanceKm = routeDistanceKm(route);
    [
        [distanceKm != null
            ? new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(distanceKm)
            : '—', 'km'],
        [routeHasElevationData(route) ? String(Math.round(Number(route.elevationGain) || 0)) : '—', 'Desnivel (m)'],
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
    const canPublishCommunity = routeCanPublishCommunity(route);
    const canShareGroupRanking = route.kind === 'recorded';
    if (showFullActions || (routesTab === 'done' && (canPublishCommunity || canShareGroupRanking))) {
        const actions = document.createElement('div');
        actions.className = 'route-actions';
        const routeActions = showFullActions ? [
            ['follow', 'Seguir', ''],
            ['edit-details', 'Descripción', 'secondary'],
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
    const distanceKm = routeDistanceKm(route);
    const performedAt = routePerformedAt(route);
    const imported = route.kind === 'imported';
    const distanceFromPositionKm = imported
        && typeof lastLat === 'number' && Number.isFinite(lastLat)
        && typeof lastLon === 'number' && Number.isFinite(lastLon)
        && typeof communityDistanceToRoute === 'function'
        ? communityDistanceToRoute([lastLat, lastLon], lines) / 1000
        : null;
    const values = [
        ...(imported ? [
            ['Distancia desde tu posición', Number.isFinite(distanceFromPositionKm)
                ? `${distanceFromPositionKm.toFixed(1)} km` : 'No disponible'],
            ['Provincia', route.province || 'No disponible']
        ] : route.province ? [['Provincia', route.province]] : []),
        ['Distancia', distanceKm != null ? `${distanceKm.toFixed(1)} km` : 'No disponible'],
        ['Desnivel', routeHasElevationData(route) ? `+${Math.round(Number(route.elevationGain) || 0)} m` : 'No disponible'],
        ['Tiempo en movimiento', routeMovingTime(route) > 0 ? fmtDur(routeMovingTime(route)) : 'No disponible'],
        ['Velocidad media', Number.isFinite(routeAverageSpeed(route)) ? `${routeAverageSpeed(route).toFixed(1)} km/h` : 'No disponible'],
        ['Velocidad máxima', typeof statsAnalyzeRoute === 'function' && Number.isFinite(statsAnalyzeRoute(route).maxSpeed)
            ? `${statsAnalyzeRoute(route).maxSpeed.toFixed(1)} km/h` : 'No disponible'],
        ['Actividad', activity],
        ...(route.kind !== 'imported' ? [['Frecuencia cardiaca media',
            typeof statsAnalyzeRoute === 'function' && Number.isFinite(statsAnalyzeRoute(route).averageHr)
                ? `${Math.round(statsAnalyzeRoute(route).averageHr)} bpm`
                : Number(route.hrAvg) > 0 ? `${Math.round(Number(route.hrAvg))} bpm` : 'No disponible']] : []),
        [route.kind === 'imported' ? 'Importada por' : 'Realizada por', creator],
        ['Fecha de realización', performedAt ? fmtDate(performedAt) : 'No disponible']
    ];
    if (route.description) values.push(['Descripción', route.description]);
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
            ['Compartir', () => shareSavedRoute(route)],
            ['Exportar GPX', () => download(`${String(route.name || 'ruta').replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]+/g, '_')}.gpx`,
                routeToGpx(route), 'application/gpx+xml')]
        ]
    });
}

$('route-activity-filter').addEventListener('change', renderSavedRoutes);
$('route-user-filter').addEventListener('change', renderSavedRoutes);
$('route-sort-filter').addEventListener('change', () => {
    if (routesTab === 'done' || routesTab === 'pending') routeSortByTab[routesTab] = $('route-sort-filter').value;
    renderSavedRoutes();
});

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
        const ownerId = r.kind === 'recorded' ? (r.groupRankingOwnerId || Cloud.uid) : '';
        const rankingServer = r.groupRankingServer || Cloud.server;
        const clientId = Number(r.id);
        const rankingDelete = ownerId && rankingServer && Number.isSafeInteger(clientId) && clientId > 0
            ? { ownerId, server: rankingServer, clientId }
            : null;
        try { await DB.deleteRoute(id, r.remoteId, rankingDelete); }
        catch (err) { toast('No se pudo eliminar la ruta ni programar su borrado'); return; }
        savedRoutes = savedRoutes.filter(x => x.id !== id);
        if (followedRoute && followedRoute.id === id) unfollowRoute();
        renderSavedRoutes();
        refreshStats();
        if (rankingDelete) await syncPendingGroupRankingDeletes();
        syncRoutes();
    }
});

// ============================================================
