'use strict';

// RUTAS PÚBLICAS DE LA COMUNIDAD
const COMMUNITY_PROVINCES = [
    'A Coruña', 'Álava', 'Albacete', 'Alicante', 'Almería', 'Asturias', 'Ávila',
    'Badajoz', 'Barcelona', 'Burgos', 'Cáceres', 'Cádiz', 'Cantabria', 'Castellón',
    'Ciudad Real', 'Córdoba', 'Cuenca', 'Girona', 'Granada', 'Guadalajara',
    'Gipuzkoa', 'Huelva', 'Huesca', 'Illes Balears', 'Jaén', 'La Rioja',
    'Las Palmas', 'León', 'Lleida', 'Lugo', 'Madrid', 'Málaga', 'Murcia',
    'Navarra', 'Ourense', 'Palencia', 'Pontevedra', 'Salamanca', 'Santa Cruz de Tenerife',
    'Segovia', 'Sevilla', 'Soria', 'Tarragona', 'Teruel', 'Toledo', 'Valencia',
    'Valladolid', 'Bizkaia', 'Zamora', 'Zaragoza', 'Ceuta', 'Melilla'
];

const COMMUNITY_TRIM_METERS = 150;
const COMMUNITY_PAGE_SIZE = 100;
const COMMUNITY_MAX_RESULTS = 15;
const COMMUNITY_TRACK_BATCH_SIZE = 5;
const COMMUNITY_MAX_TRACKS_TO_CHECK = 40;
const COMMUNITY_MAX_METADATA_CANDIDATES = 2000;
const COMMUNITY_SEARCH_CACHE_KEY = 'community-nearby-search-v1';
const COMMUNITY_SEARCH_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const COMMUNITY_DIFFICULTIES = {
    easy: 'Fácil',
    moderate: 'Moderada',
    hard: 'Difícil',
    'very-hard': 'Muy difícil'
};
let communityShareRoute = null;
let communityCatalogRoutes = [];
let communityVisibleLayers = new Map();
let communityLayerGroup = null;
let communityPreviewMap = null;
let communityPreviewBaseLayer = null;
let communityPreviewRouteLayer = null;
let communityPreviewPoiLayer = null;
let communityDetailBackAction = openCommunityCatalog;
let communityDetailFollowAction = null;
let communityDetailRecord = null;
let communityDetailLines = null;
let communitySegmentSelecting = false;
let communitySegmentStart = null;
let communitySegmentGeometry = null;
let communitySegmentMarkers = [];
let communitySegmentDraftLayer = null;

function communitySetStatus(message, isError = false) {
    ['community-status', 'community-modal-status'].forEach(id => {
        const status = $(id);
        status.textContent = message;
        status.classList.toggle('error', isError);
    });
}

function communityFillActivities(select) {
    select.replaceChildren(new Option('Todas las actividades', ''));
    Object.entries(ACTIVITY_TYPES).forEach(([type, activity]) => {
        if (activity.legacy) return;
        select.add(new Option(`${activity.icon} ${activity.label}`, type));
    });
}

function communityFillProvinces(select) {
    select.replaceChildren(new Option('Elige una provincia', ''));
    COMMUNITY_PROVINCES.forEach(province => select.add(new Option(province, province)));
}

function openCommunityCatalog() {
    communityCancelSegmentCreation();
    $('community-publish').hidden = true;
    $('community-detail').hidden = true;
    closeCommunityDialog();
    setRoutesTab('community');
    $('community-activity').focus();
}

function closeCommunityDialog() {
    communityCancelSegmentCreation();
    $('community-dialog').hidden = true;
    communityShareRoute = null;
    communityDetailRecord = null;
    communityDetailLines = null;
    if (communityPreviewPoiLayer) communityPreviewPoiLayer.dispose();
    communityPreviewPoiLayer = null;
}

function handleCommunityBackButton() {
    if ($('community-dialog').hidden) return false;
    if (!$('community-detail').hidden) {
        if (communitySegmentSelecting || !$('community-segment-editor').hidden) {
            communityCancelSegmentCreation();
        } else {
            communityDetailBackAction();
        }
        return true;
    }

    closeCommunityDialog();
    if (currentPage === 3) setRoutesTab('community');
    return true;
}

function openCommunityPublish(route) {
    if (!Cloud.loggedIn()) {
        toast('Entra en tu cuenta para proponer una ruta a la comunidad.', 5000);
        goToPage(4);
        return;
    }
    if (!navigator.onLine) {
        toast('Necesitas conexión para enviar una ruta a la comunidad.', 4500);
        return;
    }
    communityShareRoute = route;
    communityCancelSegmentCreation();
    $('community-detail').hidden = true;
    $('community-publish').hidden = false;
    $('community-title').textContent = 'Publicar ruta en la comunidad';
    $('community-share-title').textContent = route.name || 'Ruta grabada';
    $('community-share-province').value = '';
    $('community-share-locality').value = '';
    $('community-share-description').value = route.description || '';
    $('community-share-difficulty').value = '';
    $('community-share-consent').checked = false;
    $('community-submit').disabled = true;
    communitySetStatus('Al enviarla, la ruta aparecerá publicada en el mapa comunitario.');
    $('community-dialog').hidden = false;
    $('community-share-province').focus();
}

function openCommunityDetail(record, lines, options = {}) {
    communityCancelSegmentCreation();
    communityDetailRecord = record && record.id ? record : null;
    communityDetailLines = lines;
    const pois = Array.isArray(options.pois) ? options.pois : communityPoisFromRecord(record);
    $('community-publish').hidden = true;
    $('community-detail').hidden = false;
    $('community-title').textContent = record.title || 'Ruta de la comunidad';
    $('community-detail-back').textContent = options.backLabel || 'Volver a las rutas';
    communityDetailBackAction = options.onBack || openCommunityCatalog;
    communityDetailFollowAction = options.onFollow || null;
    $('community-detail-follow').hidden = !communityDetailFollowAction;
    const customActions = $('community-detail-custom-actions');
    customActions.replaceChildren();
    (options.actions || []).forEach(([label, callback]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn secondary';
        button.textContent = label;
        button.addEventListener('click', callback);
        customActions.appendChild(button);
    });
    communitySetStatus('');

    const movingTimeSec = Number(record.movingTimeSec);
    const activity = ACTIVITY_TYPES[record.activityType]?.label || record.activityType || 'No disponible';
    const values = [...(options.values || [
        ['Distancia', `${(Number(record.distanceKm) || 0).toFixed(1)} km`],
        ['Desnivel', `+${Math.round(Number(record.elevationGain) || 0)} m`],
        ['Tiempo en movimiento', movingTimeSec > 0 ? fmtDur(movingTimeSec) : 'No disponible'],
        ['Actividad', activity],
        ['Provincia', record.province || 'No disponible'],
        ['Localidad', record.locality || 'No disponible'],
        ['Dificultad', COMMUNITY_DIFFICULTIES[record.difficulty] || 'Sin especificar']
    ])];
    if (record.description) values.push(['Descripción', record.description]);
    if (pois.length) values.push(['Fotos y POI', String(pois.length)]);
    const stats = $('community-detail-stats');
    stats.replaceChildren();
    values.forEach(([label, value]) => {
        const item = document.createElement('div');
        item.className = 'community-detail-stat';
        const caption = document.createElement('span');
        caption.textContent = label;
        const detail = document.createElement('strong');
        detail.textContent = value;
        item.append(caption, detail);
        stats.append(item);
    });
    const showCommunityTools = Boolean(communityDetailRecord);
    $('community-social').hidden = !showCommunityTools;
    $('route-comparison').hidden = true;
    $('community-route-ranking-section').hidden = !showCommunityTools;
    $('community-segments-section').hidden = !showCommunityTools;
    $('community-create-segment').hidden = !showCommunityTools || !Cloud.loggedIn() || !navigator.onLine;
    $('community-route-leaderboard').replaceChildren();
    $('community-route-attempt').replaceChildren();
    $('community-segment-list').replaceChildren();
    if (showCommunityTools) {
        communityLoadSocial(communityDetailRecord);
        communityLoadRanking(communityDetailRecord, 'community_route_efforts', 'route',
            $('community-route-leaderboard'));
        communityRenderEffortWidget($('community-route-attempt'), communityDetailRecord,
            lines, 'community_route_efforts', 'route', 'la ruta');
        communityLoadSegments(communityDetailRecord);
    }

    $('community-dialog').hidden = false;
    setTimeout(() => {
        try {
            if (!communityPreviewMap) {
                communityPreviewMap = L.map('community-detail-map', { scrollWheelZoom: false });
                const style = selectedMapStyle();
                communityPreviewBaseLayer = !navigator.onLine || style === 'ign'
                    ? createOfflineTileLayer()
                    : createMapStyleLayers()[style];
                communityPreviewBaseLayer.addTo(communityPreviewMap);
            }
            if (communityPreviewRouteLayer) communityPreviewMap.removeLayer(communityPreviewRouteLayer);
            if (communityPreviewPoiLayer) communityPreviewPoiLayer.dispose();
            communityPreviewRouteLayer = L.polyline(lines, {
                color: '#ffad69', weight: 5, opacity: 0.9
            }).addTo(communityPreviewMap);
            communityPreviewPoiLayer = createRoutePoiLayer(communityPreviewMap, pois);
            communityPreviewPoiLayer.addTo();
            communityPreviewMap.off('click', communityPickSegmentPoint);
            communityPreviewMap.on('click', communityPickSegmentPoint);
            communityPreviewMap.invalidateSize({ pan: false });
            const bounds = communityPreviewRouteLayer.getBounds();
            pois.forEach(poi => {
                if (routePoiCoordinatesValid(poi)) bounds.extend([poi.lat, poi.lng]);
            });
            if (bounds.isValid()) communityPreviewMap.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 });
        } catch (error) {
            console.warn('No se pudo mostrar el mapa de detalle comunitario:', error);
            $('community-detail-map').textContent = 'No se pudo cargar el mapa de esta ruta.';
        }
    }, 0);
}

function communitySocialError(error, collection) {
    return error.status === 404
        ? `Falta instalar ${collection} desde community_performance.json.`
        : `Error de conexión: ${error.message || 'no se pudieron cargar los datos'}`;
}

async function communityLoadSocial(record) {
    const targetId = record.id;
    const isCurrent = () => communityDetailRecord && communityDetailRecord.id === targetId;
    const summary = $('community-rating-summary');
    const ratingForm = $('community-rating-form');
    const favoriteControl = $('community-favorite-control');
    const comments = $('community-comments');
    const commentForm = $('community-comment-form');
    [summary, ratingForm, favoriteControl, comments, commentForm].forEach(element => element.replaceChildren());
    const ratingLoading = document.createElement('p');
    ratingLoading.className = 'community-empty';
    ratingLoading.textContent = 'Cargando valoraciones…';
    summary.appendChild(ratingLoading);
    const commentsLoading = document.createElement('p');
    commentsLoading.className = 'community-empty';
    commentsLoading.textContent = 'Cargando comentarios…';
    comments.appendChild(commentsLoading);
    await Promise.all([
        communityLoadRatings(record, summary, ratingForm, isCurrent),
        communityLoadComments(record, comments, commentForm, isCurrent),
        communityLoadFavorite(record, favoriteControl, isCurrent)
    ]);
}

async function communityLoadRatings(route, summary, form, isCurrent) {
    try {
        const filter = `route = "${route.id}"`;
        const response = await cloudApi(`/api/collections/community_route_ratings/records?page=1&perPage=500&fields=id,owner,rating&filter=${encodeURIComponent(filter)}`);
        if (!isCurrent()) return;
        const ratings = Array.isArray(response.items) ? response.items.filter(item =>
            Number.isFinite(Number(item.rating)) && Number(item.rating) >= 1 && Number(item.rating) <= 5
        ) : [];
        const average = ratings.length
            ? ratings.reduce((sum, item) => sum + Number(item.rating), 0) / ratings.length
            : null;
        summary.replaceChildren();
        const label = document.createElement('p');
        label.className = 'community-rating-value';
        label.textContent = average === null
            ? 'Sin valoraciones todavía'
            : `${'★'.repeat(Math.round(average))}${'☆'.repeat(5 - Math.round(average))} ${average.toFixed(1)} / 5 · ${response.totalItems || ratings.length} valoración(es)`;
        summary.appendChild(label);

        if (!Cloud.loggedIn() || !navigator.onLine) {
            form.textContent = 'Inicia sesión y conéctate para valorar esta ruta.';
            return;
        }
        const own = ratings.find(item => item.owner === Cloud.uid);
        const select = document.createElement('select');
        select.setAttribute('aria-label', 'Tu valoración de una a cinco estrellas');
        for (let rating = 1; rating <= 5; rating++) {
            select.add(new Option(`${rating} ${rating === 1 ? 'estrella' : 'estrellas'}`, String(rating)));
        }
        select.value = String(own ? own.rating : 5);
        const submit = document.createElement('button');
        submit.type = 'button';
        submit.className = 'btn secondary';
        submit.textContent = own ? 'Actualizar valoración' : 'Valorar ruta';
        submit.addEventListener('click', async () => {
            submit.disabled = true;
            try {
                if (own) {
                    await cloudApi(`/api/collections/community_route_ratings/records/${encodeURIComponent(own.id)}`,
                        'PATCH', { rating: Number(select.value) });
                } else {
                    await cloudApi('/api/collections/community_route_ratings/records', 'POST', {
                        owner: Cloud.uid, route: route.id, rating: Number(select.value)
                    });
                }
                await communityLoadRatings(route, summary, form, isCurrent);
            } catch (error) {
                console.warn('No se pudo guardar la valoración comunitaria:', error);
                summary.textContent = communitySocialError(error, 'community_route_ratings');
                submit.disabled = false;
            }
        });
        form.replaceChildren(select, submit);
    } catch (error) {
        if (!isCurrent()) return;
        console.warn('No se pudieron cargar las valoraciones comunitarias:', error);
        summary.textContent = communitySocialError(error, 'community_route_ratings');
        form.textContent = Cloud.loggedIn()
            ? 'No se puede valorar hasta que la colección esté disponible.'
            : 'Inicia sesión para valorar esta ruta.';
    }
}

async function communityLoadFavorite(route, container, isCurrent) {
    if (!Cloud.loggedIn() || !navigator.onLine) {
        container.textContent = 'Conéctate e inicia sesión para guardar favoritos.';
        return;
    }
    try {
        const filter = `owner = "${Cloud.uid}" && route = "${route.id}"`;
        const response = await cloudApi(`/api/collections/community_route_favorites/records?page=1&perPage=1&fields=id&filter=${encodeURIComponent(filter)}`);
        if (!isCurrent()) return;
        const favorite = Array.isArray(response.items) ? response.items[0] : null;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = favorite ? 'btn secondary' : 'btn secondary';
        button.textContent = favorite ? '★ Quitar de favoritos' : '☆ Guardar en favoritos';
        button.addEventListener('click', async () => {
            button.disabled = true;
            try {
                if (favorite) {
                    await cloudApi(`/api/collections/community_route_favorites/records/${encodeURIComponent(favorite.id)}`, 'DELETE');
                } else {
                    await cloudApi('/api/collections/community_route_favorites/records', 'POST', {
                        owner: Cloud.uid, route: route.id
                    });
                }
                await communityLoadFavorite(route, container, isCurrent);
            } catch (error) {
                console.warn('No se pudo actualizar el favorito comunitario:', error);
                container.textContent = communitySocialError(error, 'community_route_favorites');
            }
        });
        container.replaceChildren(button);
    } catch (error) {
        if (!isCurrent()) return;
        console.warn('No se pudo consultar el favorito comunitario:', error);
        container.textContent = communitySocialError(error, 'community_route_favorites');
    }
}

async function communityLoadComments(route, container, form, isCurrent) {
    try {
        const filter = `route = "${route.id}"`;
        const response = await cloudApi(`/api/collections/community_route_comments/records?page=1&perPage=100&sort=-created&fields=id,owner,alias,comment,created&filter=${encodeURIComponent(filter)}`);
        if (!isCurrent()) return;
        container.replaceChildren();
        const records = Array.isArray(response.items) ? response.items : [];
        if (!records.length) {
            const empty = document.createElement('p');
            empty.className = 'community-empty';
            empty.textContent = 'Todavía no hay comentarios.';
            container.appendChild(empty);
        }
        records.forEach(record => {
            const item = document.createElement('article');
            item.className = 'community-comment';
            const heading = document.createElement('strong');
            heading.textContent = record.alias || 'Ciclista';
            const text = document.createElement('p');
            text.textContent = record.comment || '';
            item.append(heading, text);
            if (record.owner === Cloud.uid && Cloud.loggedIn()) {
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'btn-small danger';
                remove.textContent = 'Eliminar';
                remove.addEventListener('click', async () => {
                    try {
                        await cloudApi(`/api/collections/community_route_comments/records/${encodeURIComponent(record.id)}`, 'DELETE');
                        await communityLoadComments(route, container, form, isCurrent);
                    } catch (error) {
                        console.warn('No se pudo eliminar el comentario comunitario:', error);
                        toast(communitySocialError(error, 'community_route_comments'));
                    }
                });
                item.appendChild(remove);
            }
            container.appendChild(item);
        });
        if (!Cloud.loggedIn() || !navigator.onLine) {
            form.textContent = 'Inicia sesión y conéctate para comentar.';
            return;
        }
        const input = document.createElement('textarea');
        input.maxLength = 500;
        input.rows = 3;
        input.placeholder = 'Añade un comentario útil sobre la ruta';
        input.setAttribute('aria-label', 'Nuevo comentario');
        const submit = document.createElement('button');
        submit.type = 'button';
        submit.className = 'btn';
        submit.textContent = 'Publicar comentario';
        submit.addEventListener('click', async () => {
            const comment = input.value.trim().slice(0, 500);
            if (!comment) {
                toast('Escribe un comentario antes de publicarlo.');
                return;
            }
            submit.disabled = true;
            try {
                const alias = await communityGetPublicAlias();
                if (!alias) return;
                await cloudApi('/api/collections/community_route_comments/records', 'POST', {
                    owner: Cloud.uid, route: route.id, alias, comment
                });
                await communityLoadComments(route, container, form, isCurrent);
            } catch (error) {
                console.warn('No se pudo publicar el comentario comunitario:', error);
                container.textContent = communitySocialError(error, 'community_route_comments');
            } finally {
                submit.disabled = false;
            }
        });
        form.replaceChildren(input, submit);
    } catch (error) {
        if (!isCurrent()) return;
        console.warn('No se pudieron cargar los comentarios comunitarios:', error);
        container.textContent = communitySocialError(error, 'community_route_comments');
        form.textContent = Cloud.loggedIn()
            ? 'No se puede comentar hasta que la colección esté disponible.'
            : 'Inicia sesión para comentar esta ruta.';
    }
}

function communityDistance(a, b) {
    const rad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    const h = Math.sin(dLat / 2) ** 2 +
        Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
    return 12742000 * Math.asin(Math.sqrt(h));
}

function communityRecordLines(record) {
    try {
        const lines = typeof record.trackJson === 'string' ? JSON.parse(record.trackJson) : record.trackJson;
        if (!Array.isArray(lines) || !lines.every(line => Array.isArray(line) && line.length > 1 &&
            line.every(point => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])))) return null;
        return lines;
    } catch (error) {
        return null;
    }
}

function communityPoisFromRecord(record) {
    if (typeof record?.poisJson === 'string' && !record.poisJson.trim()) return [];
    let pois;
    try {
        pois = typeof record?.poisJson === 'string' ? JSON.parse(record.poisJson) : record?.poisJson;
    } catch (error) {
        console.warn('No se pudieron leer los POI publicados de la ruta:', error);
        return [];
    }
    if (!Array.isArray(pois)) return [];
    const files = Array.isArray(record.poiPhotos) ? record.poiPhotos : (record.poiPhotos ? [record.poiPhotos] : []);
    return pois.flatMap(poi => {
        const lat = Number(poi && poi.lat), lng = Number(poi && poi.lng);
        const photoIndex = Number(poi && poi.photoIndex);
        if (!routePoiCoordinatesValid({ lat, lng }) || !Number.isInteger(photoIndex)
            || photoIndex < 0 || photoIndex >= files.length) return [];
        const file = files[photoIndex];
        if (typeof file !== 'string' || !file) return [];
        return [{
            lat,
            lng,
            caption: String(poi.caption || 'Foto de ruta').slice(0, 100),
            photoUrl: `${Cloud.server}/api/files/community_routes/${encodeURIComponent(record.id)}/${encodeURIComponent(file)}`
        }];
    });
}

function communityDistanceToRoute(position, lines) {
    let nearest = Infinity;
    lines.forEach(line => line.forEach(point => {
        nearest = Math.min(nearest, communityDistance(position, point));
    }));
    return nearest;
}

function communityDistanceToBounds(position, record) {
    const minLat = Number(record.minLat), maxLat = Number(record.maxLat);
    const minLng = Number(record.minLng), maxLng = Number(record.maxLng);
    if (![minLat, maxLat, minLng, maxLng].every(Number.isFinite)) return Infinity;
    const nearest = [
        Math.max(minLat, Math.min(maxLat, position[0])),
        Math.max(minLng, Math.min(maxLng, position[1]))
    ];
    return communityDistance(position, nearest) / 1000;
}

function communityRawSegments(points) {
    const lines = [];
    let current = [];
    for (const point of points || []) {
        if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
        if (point[5] === 1 && current.length) {
            lines.push(current);
            current = [];
        }
        current.push([point[0], point[1]]);
    }
    if (current.length) lines.push(current);
    return lines.filter(line => line.length > 1);
}

function communityTrimStart(lines, meters) {
    const result = lines.map(line => line.map(point => point.slice()));
    let remaining = meters;
    while (result.length && remaining > 0) {
        const line = result[0];
        if (line.length < 2) { result.shift(); continue; }
        let passed = 0, index = 1;
        while (index < line.length) {
            const length = communityDistance(line[index - 1], line[index]);
            if (passed + length >= remaining) break;
            passed += length;
            index++;
        }
        if (index >= line.length) {
            remaining -= passed;
            result.shift();
            continue;
        }
        const a = line[index - 1], b = line[index];
        const length = communityDistance(a, b) || 1;
        const fraction = Math.max(0, Math.min(1, (remaining - passed) / length));
        const cut = [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction];
        result[0] = [cut].concat(line.slice(index));
        remaining = 0;
    }
    return result.filter(line => line.length > 1);
}

function communitySimplify(line, toleranceMeters) {
    if (line.length <= 2) return line;
    const lat0 = line.reduce((sum, point) => sum + point[0], 0) / line.length;
    const xScale = Math.cos(lat0 * Math.PI / 180) * 111320;
    const project = point => [point[1] * xScale, point[0] * 110540];
    const sqTolerance = toleranceMeters * toleranceMeters;
    const keep = new Uint8Array(line.length);
    keep[0] = keep[line.length - 1] = 1;
    const stack = [[0, line.length - 1]];
    while (stack.length) {
        const pair = stack.pop(), first = pair[0], last = pair[1];
        const a = project(line[first]), b = project(line[last]);
        const dx = b[0] - a[0], dy = b[1] - a[1];
        let max = sqTolerance, maxIndex = -1;
        for (let i = first + 1; i < last; i++) {
            const p = project(line[i]);
            let t = dx || dy ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy) : 0;
            t = Math.max(0, Math.min(1, t));
            const ex = p[0] - (a[0] + t * dx), ey = p[1] - (a[1] + t * dy);
            const d2 = ex * ex + ey * ey;
            if (d2 > max) { max = d2; maxIndex = i; }
        }
        if (maxIndex >= 0) {
            keep[maxIndex] = 1;
            stack.push([first, maxIndex], [maxIndex, last]);
        }
    }
    return line.filter((point, index) => keep[index]);
}

function communityPublicTrack(route) {
    let lines = communityRawSegments(route.points);
    lines = communityTrimStart(lines, COMMUNITY_TRIM_METERS);
    lines = communityTrimStart(lines.slice().reverse().map(line => line.slice().reverse()), COMMUNITY_TRIM_METERS)
        .reverse().map(line => line.slice().reverse());
    lines = lines.map(line => communitySimplify(line, 8)).filter(line => line.length > 1);
    const count = lines.reduce((sum, line) => sum + line.length, 0);
    if (count < 2) throw new Error('La ruta es demasiado corta para compartirla tras ocultar sus extremos.');
    if (count > 3000) throw new Error('No se pudo reducir el track a un tamaño seguro para publicarlo.');
    return lines;
}

function communityTrackBounds(lines) {
    const points = lines.flat();
    return {
        minLat: Math.min(...points.map(point => point[0])),
        maxLat: Math.max(...points.map(point => point[0])),
        minLng: Math.min(...points.map(point => point[1])),
        maxLng: Math.max(...points.map(point => point[1]))
    };
}

async function submitCommunityRoute() {
    if (!communityShareRoute || !Cloud.loggedIn()) return;
    const province = $('community-share-province').value;
    if (!province || !$('community-share-consent').checked) {
        communitySetStatus('Elige la provincia y confirma la publicación voluntaria.', true);
        return;
    }
    const button = $('community-submit');
    button.disabled = true;
    communitySetStatus('Preparando el trazado y las fotos para publicarlos…');
    try {
        const route = communityShareRoute;
        const formData = new FormData();
        const poiData = communityPublicPoiData(route, formData);
        formData.append('owner', Cloud.uid);
        formData.append('title', String(route.name || 'Ruta MTB').trim().slice(0, 100));
        formData.append('province', province);
        formData.append('locality', String($('community-share-locality').value || '').trim().slice(0, 80));
        formData.append('description', String($('community-share-description').value || '').trim().slice(0, 500));
        formData.append('difficulty', $('community-share-difficulty').value);
        formData.append('activityType', activityTypeForRoute(route) || 'mtb');
        formData.append('distanceKm', String(Number(route.distanceKm) || 0));
        formData.append('elevationGain', String(Number(route.elevationGain) || 0));
        formData.append('movingTimeSec', String(Number(route.movingTimeSec) || 0));
        formData.append('trackJson', JSON.stringify(communityPublicTrack(route)));
        formData.append('poisJson', poiData.json);
        formData.append('published', 'true');
        if (poiData.skipped) {
            communitySetStatus(`${poiData.count} foto(s) incluidas; ${poiData.skipped} POI se omiten por falta de foto válida o por estar cerca de un extremo.`);
        } else {
            communitySetStatus(`${poiData.count} foto(s) se publicarán junto con la ruta.`);
        }
        const record = await cloudApi('/api/collections/community_routes/records', 'POST', formData);
        communitySetStatus('Ruta publicada. Ya aparece en el mapa comunitario.');
        toast(`Ruta publicada${poiData.count ? ` con ${poiData.count} foto(s)` : ''} en la comunidad.`);
        button.textContent = 'Publicada';
        setTimeout(closeCommunityDialog, 1400);
        return record;
    } catch (error) {
        console.warn('No se pudo proponer la ruta a la comunidad:', error);
        communitySetStatus(error.status === 404
            ? 'Falta instalar la colección community_routes en el servidor. Consulta CONFIGURAR-RUTAS-COMUNIDAD.md.'
            : error.status === 400
                ? 'No se pudo enviar la ruta. Comprueba que community_routes incluye los campos poisJson y poiPhotos; consulta CONFIGURAR-RUTAS-COMUNIDAD.md.'
                : 'No se pudo enviar la ruta: ' + (error.message || 'error de conexión'), true);
        button.disabled = false;
    }
}

function communityPointsForApp(lines) {
    const points = [];
    lines.forEach(line => line.forEach((coord, index) => {
        points.push([coord[0], coord[1], null, null, null, index === 0 && points.length ? 1 : null]);
    }));
    return points;
}

function communityLocalRoute(record, lines) {
    return {
        id: record.id,
        name: record.title,
        kind: 'community',
        description: record.description || '',
        locality: record.locality || '',
        difficulty: record.difficulty || '',
        points: communityPointsForApp(lines),
        pois: communityPoisFromRecord(record),
        distanceKm: Number(record.distanceKm) || 0,
        elevationGain: Number(record.elevationGain) || 0,
        activityType: record.activityType || 'mtb'
    };
}

async function saveCommunityOffline(record, lines) {
    const existing = savedRoutes.find(route => route.communityRouteId === record.id);
    if (existing) {
        toast('Esta ruta ya está guardada en este dispositivo.');
        return;
    }
    const id = Date.now();
    const route = communityLocalRoute(record, lines);
    route.id = id;
    route.communityRouteId = record.id;
    route.kind = 'imported';
    route.startedAt = new Date().toISOString();
    route.movingTimeSec = 0;
    route.dirty = true;
    let unavailablePhotos = 0;
    for (const poi of route.pois) {
        try {
            const response = await fetch(poi.photoUrl);
            if (!response.ok) throw new Error(`El servidor respondió ${response.status}`);
            poi.photo = await response.blob();
            delete poi.photoUrl;
        } catch (error) {
            unavailablePhotos++;
            console.warn('No se pudo guardar una foto de la ruta para uso sin conexión:', error);
        }
    }
    try {
        await DB.put(route);
        savedRoutes.unshift(route);
        renderSavedRoutes();
        toast(unavailablePhotos
            ? `Ruta guardada sin conexión. ${unavailablePhotos} foto(s) necesitarán internet para mostrarse.`
            : 'Ruta guardada para seguirla sin conexión.');
    } catch (error) {
        console.warn('No se pudo guardar la ruta comunitaria:', error);
        toast('No se pudo guardar la ruta en este dispositivo.');
    }
}

function communityPublicPoiData(route, formData) {
    const sourcePois = Array.isArray(route.pois) ? route.pois : [];
    const segments = communityRawSegments(route.points);
    const endpoints = segments.length
        ? [segments[0][0], segments[segments.length - 1][segments[segments.length - 1].length - 1]]
        : [];
    const pois = [];
    let skipped = 0;
    sourcePois.forEach(poi => {
        if (!routePoiCoordinatesValid(poi) || !(poi.photo instanceof Blob)
            || poi.photo.size > ROUTE_POI_MAX_FILE_BYTES || poi.photo.type !== 'image/jpeg'
            || endpoints.some(endpoint => communityDistance([poi.lat, poi.lng], endpoint) < COMMUNITY_TRIM_METERS)) {
            skipped++;
            return;
        }
        const photoIndex = pois.length;
        if (photoIndex >= ROUTE_POI_MAX_PHOTOS) { skipped++; return; }
        formData.append('poiPhotos', poi.photo, `poi-${photoIndex + 1}.jpg`);
        pois.push({
            lat: poi.lat,
            lng: poi.lng,
            caption: String(poi.caption || 'Foto de ruta').slice(0, 100),
            photoIndex
        });
    });
    return { json: JSON.stringify(pois), count: pois.length, skipped };
}

async function deleteCommunityRoute(record) {
    if (!Cloud.loggedIn() || record.owner !== Cloud.uid) {
        toast('Solo quien publicó esta ruta puede eliminarla.');
        return;
    }
    const ok = await modal({
        message: `¿Eliminar «${record.title || 'Ruta de la comunidad'}» de la comunidad? Las copias guardadas en dispositivos no se borrarán.`,
        ok: 'Eliminar'
    });
    if (!ok) return;
    try {
        await cloudApi(`/api/collections/community_routes/records/${encodeURIComponent(record.id)}`, 'DELETE');
        const layer = communityVisibleLayers.get(record.id);
        if (layer && map) map.removeLayer(layer);
        communityVisibleLayers.delete(record.id);
        communityCatalogRoutes = communityCatalogRoutes.filter(route => route.id !== record.id);
        renderCommunityRoutes(communityCatalogRoutes);
        communitySetStatus('Ruta eliminada de la comunidad.');
        toast('Ruta eliminada de la comunidad.');
    } catch (error) {
        console.warn('No se pudo eliminar la ruta comunitaria:', error);
        communitySetStatus(error.status === 403
            ? 'Solo quien publicó esta ruta puede eliminarla.'
            : 'No se pudo eliminar la ruta: ' + (error.message || 'error de conexión'), true);
    }
}

function communityPopup(record, lines) {
    const box = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = record.title || 'Ruta de la comunidad';
    const info = document.createElement('p');
    info.textContent = (record.province || '') + ' · ' +
        ((Number(record.distanceKm) || 0).toFixed(1)) + ' km · +' +
        (Number(record.elevationGain) || 0) + ' m';
    const follow = document.createElement('button');
    follow.type = 'button';
    follow.textContent = 'Seguir ruta';
    follow.className = 'btn';
    follow.addEventListener('click', () => followRoute(communityLocalRoute(record, lines)));
    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = 'Guardar sin conexión';
    save.className = 'btn secondary';
    save.addEventListener('click', () => saveCommunityOffline(record, lines));
    box.append(title, info, follow, save);
    return box;
}

function toggleCommunityRoute(record, lines, button) {
    if (!map) return;
    const oldLayer = communityVisibleLayers.get(record.id);
    if (oldLayer) {
        map.removeLayer(oldLayer);
        communityVisibleLayers.delete(record.id);
        button.textContent = 'Mostrar en mapa';
        return;
    }
    const layer = L.polyline(lines, { color: '#e040fb', weight: 5, opacity: 0.85 });
    layer.on('click', event => {
        L.popup().setLatLng(event.latlng).setContent(communityPopup(record, lines)).openOn(map);
    });
    layer.addTo(map);
    communityVisibleLayers.set(record.id, layer);
    button.textContent = 'Quitar del mapa';
    const bounds = layer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [36, 36], maxZoom: 15 });
    goToPage(0);
    closeCommunityDialog();
}

function renderCommunityRoutes(records) {
    const list = $('community-route-list');
    list.replaceChildren();
    if (!records.length) {
        const empty = document.createElement('p');
        empty.className = 'community-empty';
        empty.textContent = 'No hay rutas publicadas cerca con estos filtros.';
        list.append(empty);
        return;
    }
    records.forEach(record => {
        const lines = communityRecordLines(record);
        if (!lines) return;
        const card = document.createElement('article');
        card.className = 'community-route-card';
        const heading = document.createElement('button');
        heading.type = 'button';
        heading.className = 'community-route-title';
        heading.textContent = record.title || 'Ruta de la comunidad';
        heading.addEventListener('click', () => openCommunityDetail(record, lines));
        const facts = document.createElement('p');
        const poiCount = communityPoisFromRecord(record).length;
        const difficulty = COMMUNITY_DIFFICULTIES[record.difficulty];
        facts.textContent = (record.proximityKm != null ? `A ${record.proximityKm.toFixed(1)} km · ` : '') +
            [record.locality, record.province].filter(Boolean).join(', ') + ' · ' +
            ((Number(record.distanceKm) || 0).toFixed(1)) + ' km · +' +
            (Number(record.elevationGain) || 0) + ' m' +
            (difficulty ? ` · ${difficulty}` : '') +
            (poiCount ? ` · 📷 ${poiCount} POI` : '');
        const actions = document.createElement('div');
        actions.className = 'community-route-actions';
        const show = document.createElement('button');
        show.type = 'button';
        show.className = 'btn secondary';
        show.textContent = communityVisibleLayers.has(record.id) ? 'Quitar del mapa' : 'Mostrar en mapa';
        show.addEventListener('click', () => toggleCommunityRoute(record, lines, show));
        const follow = document.createElement('button');
        follow.type = 'button';
        follow.className = 'btn';
        follow.textContent = 'Seguir';
        follow.addEventListener('click', () => {
            followRoute(communityLocalRoute(record, lines));
            closeCommunityDialog();
        });
        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'btn secondary';
        save.textContent = 'Guardar';
        save.addEventListener('click', () => saveCommunityOffline(record, lines));
        const gpx = document.createElement('button');
        gpx.type = 'button';
        gpx.className = 'btn secondary';
        gpx.textContent = 'Descargar GPX';
        gpx.addEventListener('click', () => {
            const route = communityLocalRoute(record, lines);
            const filename = String(record.title || 'ruta-comunitaria')
                .replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]+/g, '_').trim() || 'ruta-comunitaria';
            download(`${filename}.gpx`, routeToGpx(route), 'application/gpx+xml');
        });
        actions.append(show, follow, save, gpx);
        if (Cloud.loggedIn() && record.owner === Cloud.uid) {
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'btn secondary';
            remove.textContent = 'Eliminar';
            remove.addEventListener('click', () => deleteCommunityRoute(record));
            actions.append(remove);
        }
        card.append(heading, facts, actions);
        list.append(card);
    });
}

function communityRecordCollectionUrl(collection, filter, fields = 'id,alias,elapsedSeconds', sort = 'elapsedSeconds') {
    return `/api/collections/${collection}/records?perPage=50&sort=${sort}&fields=${fields}&filter=${encodeURIComponent(filter)}`;
}

function communityRenderRanking(records, container, totalItems = records.length) {
    container.replaceChildren();
    const valid = records.filter(record => record && typeof record.alias === 'string'
        && record.alias.trim() && Number.isFinite(Number(record.elapsedSeconds))
        && Number(record.elapsedSeconds) > 0 && Number(record.elapsedSeconds) <= 86400)
        .sort((a, b) => Number(a.elapsedSeconds) - Number(b.elapsedSeconds))
        .slice(0, 10);
    if (!valid.length) {
        const empty = document.createElement('p');
        empty.className = 'community-empty';
        empty.textContent = 'Todavía no hay marcas publicadas para este trazado.';
        container.append(empty);
        return;
    }
    valid.forEach((record, index) => {
        const row = document.createElement('div');
        row.className = 'community-ranking-item';
        const place = document.createElement('span');
        place.className = 'community-ranking-place';
        place.textContent = `${index + 1}.`;
        const name = document.createElement('span');
        name.className = 'community-ranking-name';
        name.textContent = record.alias.trim();
        const time = document.createElement('strong');
        time.className = 'community-ranking-time';
        time.textContent = fmtDur(Number(record.elapsedSeconds));
        row.append(place, name, time);
        container.append(row);
    });
    if (totalItems > valid.length) {
        const more = document.createElement('p');
        more.className = 'hint';
        more.textContent = `Mostrando las ${valid.length} mejores marcas de ${totalItems}.`;
        container.append(more);
    }
}

async function communityLoadRanking(record, collection, relationField, container) {
    const isCurrentTarget = () => {
        if (container === $('stats-community-leaderboard')) {
            return $('stats-community-route').value === record.id;
        }
        if (container === $('community-route-leaderboard')) {
            return communityDetailRecord && communityDetailRecord.id === record.id;
        }
        return container.isConnected;
    };
    if (!isCurrentTarget()) return;
    container.replaceChildren();
    if (!record || !record.id) return;
    const loading = document.createElement('p');
    loading.className = 'community-empty';
    loading.textContent = 'Cargando clasificación…';
    container.append(loading);
    try {
        const filter = `${relationField} = "${record.id}"`;
        const result = await cloudApi(communityRecordCollectionUrl(collection, filter));
        if (!isCurrentTarget()) return;
        communityRenderRanking(Array.isArray(result.items) ? result.items : [], container,
            Number(result.totalItems) || 0);
    } catch (error) {
        if (!isCurrentTarget()) return;
        console.warn(`No se pudo cargar la clasificación de ${record.title || 'la ruta'}:`, error);
        loading.textContent = error.status === 404
            ? 'Faltan las colecciones community_performance.json en PocketBase.'
            : `No se pudo cargar la clasificación: ${error.message || 'error de conexión'}`;
        loading.classList.add('error');
    }
}

async function communityGetPublicAlias() {
    const previous = localStorage.getItem('mtb_community_alias') || '';
    const suggested = previous || localStorage.getItem('mtb_group_name') || '';
    const value = await modal({
        message: 'Elige el apodo que aparecerá públicamente junto a tu mejor tiempo. No uses tu correo: el apodo solo se guarda en este dispositivo y podrás cambiarlo en el próximo envío.',
        input: suggested,
        ok: 'Continuar'
    });
    if (value === null) return null;
    const alias = String(value).trim().slice(0, 32);
    if (!alias) {
        toast('Escribe un apodo para publicar la marca.');
        return null;
    }
    localStorage.setItem('mtb_community_alias', alias);
    return alias;
}

async function communityFindOwnEffort(collection, relationField, targetId) {
    const filter = `owner = "${Cloud.uid}" && ${relationField} = "${targetId}"`;
    const result = await cloudApi(communityRecordCollectionUrl(
        collection, filter, 'id,owner,alias,elapsedSeconds'
    ));
    return Array.isArray(result.items) ? result.items[0] || null : null;
}

async function communityPublishEffort(record, relationField, collection, match, label, status, button) {
    if (!Cloud.loggedIn()) {
        status.textContent = 'Inicia sesión para publicar una marca.';
        return;
    }
    if (!navigator.onLine) {
        status.textContent = 'Conéctate a internet para publicar la marca.';
        return;
    }
    button.disabled = true;
    try {
        const alias = await communityGetPublicAlias();
        if (!alias) return;
        const existing = await communityFindOwnEffort(collection, relationField, record.id);
        if (existing && Number(existing.elapsedSeconds) <= match.elapsedSeconds) {
            status.textContent = `Ya tienes una marca igual o mejor: ${fmtDur(Number(existing.elapsedSeconds))}.`;
            return;
        }
        const confirmed = await modal({
            message: `Publicar para ${label}: ${fmtDur(match.elapsedSeconds)} con el apodo «${alias}». El tiempo será visible en la comunidad; no se enviarán el track, el correo ni sensores.`,
            ok: 'Publicar tiempo'
        });
        if (!confirmed) return;
        const payload = {
            owner: Cloud.uid,
            [relationField]: record.id,
            alias,
            elapsedSeconds: match.elapsedSeconds
        };
        if (existing) {
            await cloudApi(`/api/collections/${collection}/records/${encodeURIComponent(existing.id)}`, 'PATCH', {
                alias,
                elapsedSeconds: match.elapsedSeconds
            });
        } else {
            await cloudApi(`/api/collections/${collection}/records`, 'POST', payload);
        }
        status.textContent = 'Mejor tiempo publicado en la comunidad.';
        toast('Tiempo publicado en la clasificación.');
        const containers = relationField === 'route'
            ? [$('community-route-leaderboard'), $('stats-community-leaderboard')]
            : [];
        containers.filter(Boolean).forEach(container => communityLoadRanking(record, collection, relationField, container));
        if (relationField === 'segment' && communityDetailRecord) {
            communityLoadSegments(communityDetailRecord);
        }
    } catch (error) {
        console.warn('No se pudo publicar el tiempo comunitario:', error);
        status.textContent = error.status === 404
            ? 'Faltan las colecciones community_performance.json en PocketBase.'
            : `No se pudo publicar el tiempo: ${error.message || 'error de conexión'}`;
        status.classList.add('error');
    } finally {
        button.disabled = !Cloud.loggedIn() || !navigator.onLine;
    }
}

function communityRenderEffortWidget(container, record, lines, collection, relationField, label) {
    container.replaceChildren();
    const widget = document.createElement('div');
    widget.className = 'community-effort-entry';
    const heading = document.createElement('strong');
    heading.textContent = 'Comprobar una actividad guardada';
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Actividad para comparar con la ruta');
    select.add(new Option('Selecciona una actividad', ''));
    (Array.isArray(savedRoutes) ? savedRoutes : [])
        .filter(route => route && route.kind !== 'imported' && Array.isArray(route.points) && route.points.length > 1)
        .forEach(route => {
            const date = route.startedAt ? ` · ${fmtDate(route.startedAt)}` : '';
            select.add(new Option(`${route.name || 'Actividad'}${date}`, String(route.id)));
        });
    const status = document.createElement('p');
    status.className = 'community-effort-status';
    status.textContent = Cloud.loggedIn()
        ? 'El tiempo se calcula comparando puntos GPS y sus marcas temporales con el trazado.'
        : 'Inicia sesión para participar en la clasificación.';
    const submit = document.createElement('button');
    submit.type = 'button';
    submit.className = 'btn';
    submit.textContent = 'Publicar mejor tiempo';
    submit.disabled = true;
    let matched = null;
    select.addEventListener('change', () => {
        matched = null;
        status.classList.remove('error');
        const activity = savedRoutes.find(route => String(route.id) === select.value);
        if (!activity) {
            status.textContent = 'Selecciona una actividad GPS.';
            submit.disabled = true;
            return;
        }
        matched = MTBCommunityPerformance.matchActivity(activity, lines);
        if (!matched) {
            status.textContent = 'No se encontró un recorrido completo con tiempos GPS válidos que coincida con esta ruta.';
            submit.disabled = true;
            return;
        }
        status.textContent = `Coincidencia GPS completa: ${fmtDur(matched.elapsedSeconds)} (${matched.direction === 'reverse' ? 'sentido inverso' : 'sentido de la ruta'}).`;
        submit.disabled = !Cloud.loggedIn() || !navigator.onLine;
    });
    submit.addEventListener('click', () => {
        if (matched) communityPublishEffort(record, relationField, collection, matched, label, status, submit);
    });
    widget.append(heading, select, status, submit);
    container.append(widget);
}

function communityUpdateStatsRouteSelect() {
    const select = $('stats-community-route');
    if (!select) return;
    const previous = select.value;
    select.replaceChildren(new Option(
        communityCatalogRoutes.length ? 'Selecciona una ruta comunitaria' : 'Busca rutas comunitarias para empezar',
        ''
    ));
    communityCatalogRoutes.forEach(record => {
        const distance = (Number(record.distanceKm) || 0).toFixed(1);
        select.add(new Option(`${record.title || 'Ruta comunitaria'} · ${distance} km`, record.id));
    });
    select.value = communityCatalogRoutes.some(record => record.id === previous) ? previous : '';
    if (!select.value) {
        $('stats-community-leaderboard').replaceChildren();
        $('stats-community-attempt').replaceChildren();
    } else {
        communityRenderStatsRoute(communityCatalogRoutes.find(record => record.id === select.value));
    }
}

function communityRenderStatsRoute(record) {
    const leaderboard = $('stats-community-leaderboard');
    const attempt = $('stats-community-attempt');
    if (!record) {
        leaderboard.replaceChildren();
        attempt.replaceChildren();
        return;
    }
    communityLoadRanking(record, 'community_route_efforts', 'route', leaderboard);
    communityRenderEffortWidget(attempt, record, communityRecordLines(record),
        'community_route_efforts', 'route', 'la ruta');
}

function communityNearestRoutePoint(latlng, lines) {
    let nearest = null, distance = Infinity;
    lines.forEach((line, lineIndex) => line.forEach((point, pointIndex) => {
        const candidateDistance = communityDistance([latlng.lat, latlng.lng], point);
        if (candidateDistance < distance) {
            distance = candidateDistance;
            nearest = { lineIndex, pointIndex, point, distance: candidateDistance };
        }
    }));
    return nearest;
}

function communityClearSegmentDraftLayers() {
    if (communityPreviewMap) {
        communitySegmentMarkers.forEach(marker => communityPreviewMap.removeLayer(marker));
        if (communitySegmentDraftLayer) communityPreviewMap.removeLayer(communitySegmentDraftLayer);
    }
    communitySegmentMarkers = [];
    communitySegmentDraftLayer = null;
}

function communityCancelSegmentCreation() {
    communitySegmentSelecting = false;
    communitySegmentStart = null;
    communitySegmentGeometry = null;
    communityClearSegmentDraftLayers();
    const editor = $('community-segment-editor');
    if (editor) editor.hidden = true;
    const create = $('community-create-segment');
    if (create) create.hidden = !communityDetailRecord || !Cloud.loggedIn() || !navigator.onLine;
    if (communityPreviewMap) communityPreviewMap.getContainer().style.cursor = '';
}

function communityBeginSegmentCreation() {
    if (!Cloud.loggedIn()) {
        toast('Inicia sesión para crear un segmento comunitario.');
        return;
    }
    if (!navigator.onLine || !communityDetailRecord || !communityPreviewMap || !communityDetailLines) {
        toast('Abre una ruta comunitaria con conexión para crear un segmento.');
        return;
    }
    communityClearSegmentDraftLayers();
    communitySegmentStart = null;
    communitySegmentGeometry = null;
    communitySegmentSelecting = true;
    $('community-segment-name').value = '';
    $('community-segment-submit').disabled = true;
    $('community-segment-editor-status').textContent = 'Toca el inicio y después el final del tramo en el mapa.';
    $('community-segment-editor-status').classList.remove('error');
    $('community-segment-editor').hidden = false;
    $('community-create-segment').hidden = true;
    communityPreviewMap.getContainer().style.cursor = 'crosshair';
}

function communityPickSegmentPoint(event) {
    if (!communitySegmentSelecting || !communityDetailLines) return;
    const selected = communityNearestRoutePoint(event.latlng, communityDetailLines);
    const status = $('community-segment-editor-status');
    if (!selected || selected.distance > 60) {
        status.textContent = 'Toca sobre el trazado o a menos de 60 m de él.';
        status.classList.add('error');
        return;
    }
    status.classList.remove('error');
    const marker = L.circleMarker(selected.point, {
        radius: 7, color: '#0b1324', weight: 2, fillColor: '#49ddb5', fillOpacity: 1
    }).addTo(communityPreviewMap);
    communitySegmentMarkers.push(marker);
    if (!communitySegmentStart) {
        communitySegmentStart = selected;
        status.textContent = 'Inicio seleccionado. Toca ahora el final del segmento.';
        return;
    }
    if (selected.lineIndex !== communitySegmentStart.lineIndex) {
        communityPreviewMap.removeLayer(marker);
        communitySegmentMarkers.pop();
        status.textContent = 'El inicio y el final deben estar en el mismo tramo continuo de la ruta.';
        status.classList.add('error');
        return;
    }
    const from = communitySegmentStart.pointIndex;
    const to = selected.pointIndex;
    const line = communityDetailLines[selected.lineIndex];
    const geometry = from <= to ? line.slice(from, to + 1) : line.slice(to, from + 1).reverse();
    let lengthM = 0;
    for (let i = 1; i < geometry.length; i++) {
        lengthM += MTBCommunityPerformance.distanceMeters(geometry[i - 1], geometry[i]);
    }
    if (!Number.isFinite(lengthM) || lengthM < 100) {
        communityPreviewMap.removeLayer(marker);
        communitySegmentMarkers.pop();
        status.textContent = 'El segmento debe medir al menos 100 m. Selecciona un final más alejado.';
        status.classList.add('error');
        return;
    }
    communitySegmentGeometry = geometry;
    communitySegmentDraftLayer = L.polyline(geometry, {
        color: '#49ddb5', weight: 8, opacity: 0.9, dashArray: '8 6'
    }).addTo(communityPreviewMap);
    communitySegmentSelecting = false;
    communityPreviewMap.getContainer().style.cursor = '';
    status.textContent = `Tramo seleccionado: ${(lengthM / 1000).toFixed(2)} km.`;
    $('community-segment-submit').disabled = false;
}

async function communitySubmitSegment() {
    if (!Cloud.loggedIn() || !communityDetailRecord || !communitySegmentGeometry) return;
    const title = $('community-segment-name').value.trim().slice(0, 60);
    const status = $('community-segment-editor-status');
    if (title.length < 3) {
        status.textContent = 'Escribe un nombre de al menos 3 caracteres.';
        status.classList.add('error');
        return;
    }
    const lengthM = communitySegmentGeometry.slice(1).reduce((sum, point, index) =>
        sum + MTBCommunityPerformance.distanceMeters(communitySegmentGeometry[index], point), 0);
    const button = $('community-segment-submit');
    button.disabled = true;
    status.textContent = 'Publicando el segmento…';
    try {
        await cloudApi('/api/collections/community_segments/records', 'POST', {
            owner: Cloud.uid,
            route: communityDetailRecord.id,
            title,
            trackJson: JSON.stringify([communitySegmentGeometry]),
            distanceKm: +(lengthM / 1000).toFixed(3)
        });
        status.textContent = 'Segmento publicado y añadido a esta ruta.';
        communityCancelSegmentCreation();
        toast('Segmento añadido a la ruta comunitaria.');
        communityLoadSegments(communityDetailRecord);
    } catch (error) {
        console.warn('No se pudo publicar el segmento comunitario:', error);
        status.textContent = error.status === 404
            ? 'Faltan las colecciones community_performance.json en PocketBase.'
            : `No se pudo publicar el segmento: ${error.message || 'error de conexión'}`;
        status.classList.add('error');
        button.disabled = false;
    }
}

async function communityDeleteSegment(segment) {
    if (!Cloud.loggedIn() || segment.owner !== Cloud.uid) return;
    const confirmed = await modal({
        message: `¿Eliminar «${segment.title}» y su clasificación? Solo se eliminará este segmento de la comunidad.`,
        ok: 'Eliminar'
    });
    if (!confirmed) return;
    try {
        await cloudApi(`/api/collections/community_segments/records/${encodeURIComponent(segment.id)}`, 'DELETE');
        communityLoadSegments(communityDetailRecord);
    } catch (error) {
        console.warn('No se pudo eliminar el segmento comunitario:', error);
        communitySetStatus(`No se pudo eliminar el segmento: ${error.message || 'error de conexión'}`, true);
    }
}

async function communityLoadSegments(record) {
    if (!communityDetailRecord || communityDetailRecord.id !== record.id) return;
    const list = $('community-segment-list');
    list.replaceChildren();
    const loading = document.createElement('p');
    loading.className = 'community-empty';
    loading.textContent = 'Cargando segmentos…';
    list.append(loading);
    try {
        const filter = `route = "${record.id}"`;
        const result = await cloudApi(communityRecordCollectionUrl(
            'community_segments', filter, 'id,owner,route,title,trackJson,distanceKm', 'created'
        ));
        if (!communityDetailRecord || communityDetailRecord.id !== record.id) return;
        const segments = Array.isArray(result.items) ? result.items : [];
        list.replaceChildren();
        if (!segments.length) {
            const empty = document.createElement('p');
            empty.className = 'community-empty';
            empty.textContent = 'Aún no hay segmentos. Puedes crear uno seleccionando el inicio y el final en el mapa.';
            list.append(empty);
            return;
        }
        segments.forEach(segment => {
            const card = document.createElement('article');
            card.className = 'community-segment-item';
            const heading = document.createElement('strong');
            heading.textContent = segment.title || 'Segmento';
            const facts = document.createElement('p');
            facts.textContent = `${(Number(segment.distanceKm) || 0).toFixed(2)} km · creado por ${segment.owner === Cloud.uid ? 'ti' : 'un miembro de la comunidad'}`;
            const ranking = document.createElement('div');
            ranking.className = 'community-ranking-list';
            const widget = document.createElement('div');
            const geometry = communityRecordLines(segment);
            card.append(heading, facts, ranking, widget);
            list.append(card);
            if (geometry) {
                communityLoadRanking(segment, 'community_segment_efforts', 'segment', ranking);
                communityRenderEffortWidget(widget, segment, geometry,
                    'community_segment_efforts', 'segment', `el segmento «${segment.title || 'Segmento'}»`);
            }
            if (Cloud.loggedIn() && segment.owner === Cloud.uid) {
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'btn-small danger';
                remove.textContent = 'Eliminar mi segmento';
                remove.addEventListener('click', () => communityDeleteSegment(segment));
                card.append(remove);
            }
        });
    } catch (error) {
        if (!communityDetailRecord || communityDetailRecord.id !== record.id) return;
        console.warn('No se pudieron cargar los segmentos comunitarios:', error);
        loading.textContent = error.status === 404
            ? 'Faltan las colecciones community_performance.json en PocketBase.'
            : `No se pudieron cargar los segmentos: ${error.message || 'error de conexión'}`;
        loading.classList.add('error');
    }
}

async function readCommunitySearchCache(activity, radiusKm, searchPosition) {
    try {
        const cache = await DB.kvGet(COMMUNITY_SEARCH_CACHE_KEY);
        if (!cache || cache.activity !== activity || cache.radiusKm !== radiusKm
            || Date.now() - cache.savedAt > COMMUNITY_SEARCH_CACHE_MAX_AGE_MS
            || !Array.isArray(cache.position) || !Array.isArray(cache.routes)) return null;
        if (communityDistanceToBounds(searchPosition, {
            minLat: cache.position[0], maxLat: cache.position[0],
            minLng: cache.position[1], maxLng: cache.position[1]
        }) > 5) return null;
        const routes = cache.routes.map(route => {
            const lines = communityRecordLines(route);
            if (!lines) return null;
            const proximityKm = communityDistanceToRoute(searchPosition, lines) / 1000;
            return proximityKm <= radiusKm ? { ...route, proximityKm } : null;
        }).filter(Boolean).sort((a, b) => a.proximityKm - b.proximityKm).slice(0, COMMUNITY_MAX_RESULTS);
        return { routes, savedAt: cache.savedAt };
    } catch (error) {
        console.warn('No se pudo leer la búsqueda comunitaria guardada:', error);
        return null;
    }
}

async function loadCommunityRoutes() {
    if (lastLat === null || lastLon === null) {
        communitySetStatus('Esperando una ubicación GPS para buscar rutas cercanas. Comprueba el permiso de ubicación e inténtalo de nuevo.', true);
        if (typeof requestCurrentGpsFix === 'function') requestCurrentGpsFix();
        return;
    }
    const searchPosition = [lastLat, lastLon];
    const button = $('community-search');
    const activity = $('community-activity').value;
    const radiusKm = Number($('community-radius').value) || 25;
    const cached = await readCommunitySearchCache(activity, radiusKm, searchPosition);
    let displayedCache = false;
    if (cached) {
        communityCatalogRoutes = cached.routes;
        renderCommunityRoutes(communityCatalogRoutes);
        communityUpdateStatsRouteSelect();
        displayedCache = true;
    }
    if (!navigator.onLine) {
        communitySetStatus(cached
            ? `Mostrando ${cached.routes.length} rutas guardadas sin conexión (búsqueda del ${new Date(cached.savedAt).toLocaleDateString('es-ES')}).`
            : 'El catálogo necesita conexión. Las rutas guardadas sí están disponibles sin conexión.', !cached);
        return;
    }
    button.disabled = true;
    communitySetStatus(displayedCache ? 'Mostrando resultados guardados mientras se actualiza la búsqueda…' : 'Buscando rutas cercanas…');
    try {
        const latDelta = radiusKm / 110.574;
        const lonDelta = Math.min(180, radiusKm / (111.32 * Math.max(0.05, Math.cos(searchPosition[0] * Math.PI / 180))));
        const south = Math.max(-90, searchPosition[0] - latDelta);
        const north = Math.min(90, searchPosition[0] + latDelta);
        const west = Math.max(-180, searchPosition[1] - lonDelta);
        const east = Math.min(180, searchPosition[1] + lonDelta);
        const filters = [
            'published = true',
            `minLat <= ${north.toFixed(6)}`,
            `maxLat >= ${south.toFixed(6)}`,
            `minLng <= ${east.toFixed(6)}`,
            `maxLng >= ${west.toFixed(6)}`
        ];
        if (activity) filters.push('activityType = "' + activity.replace(/"/g, '\\"') + '"');
        const filter = filters.join(' && ');
        const metadata = [];
        let page = 1, totalPages = 1;
        do {
            const result = await cloudApi('/api/collections/community_routes/records?page=' + page + '&perPage=' +
                COMMUNITY_PAGE_SIZE + '&fields=id,owner,title,province,activityType,distanceKm,elevationGain,movingTimeSec,minLat,maxLat,minLng,maxLng&filter=' + encodeURIComponent(filter));
            if (Array.isArray(result.items)) {
                metadata.push(...result.items.slice(0, COMMUNITY_MAX_METADATA_CANDIDATES - metadata.length));
            }
            totalPages = Number(result.totalPages) || 1;
            page++;
        } while (page <= totalPages && metadata.length < COMMUNITY_MAX_METADATA_CANDIDATES);

        // Incluye un conjunto acotado de rutas anteriores a los campos espaciales nuevos.
        const indexedIds = new Set(metadata.map(record => record.id));
        const legacyFilter = ['published = true', '(minLat = null || maxLat = null || minLng = null || maxLng = null)'];
        if (activity) legacyFilter.push('activityType = "' + activity.replace(/"/g, '\\"') + '"');
        const legacyResult = await cloudApi('/api/collections/community_routes/records?page=1&perPage=100&sort=-created&fields=id,owner,title,province,activityType,distanceKm,elevationGain,movingTimeSec&filter=' + encodeURIComponent(legacyFilter.join(' && ')));
        const legacyRoutes = (legacyResult.items || []).filter(record => !indexedIds.has(record.id));
        const legacyTruncated = Number(legacyResult.totalItems) > legacyRoutes.length;

        const candidates = metadata.map(record => ({
            ...record,
            boundsDistanceKm: communityDistanceToBounds(searchPosition, record),
            indexed: true
        })).filter(record => record.boundsDistanceKm <= radiusKm)
            .concat(legacyRoutes.map(record => ({ ...record, boundsDistanceKm: 0, indexed: false })))
            .sort((a, b) => a.boundsDistanceKm - b.boundsDistanceKm);

        const nearbyRoutes = [];
        let checked = 0, tracksComplete = false;
        while (checked < candidates.length && checked < COMMUNITY_MAX_TRACKS_TO_CHECK) {
            const batch = candidates.slice(checked, Math.min(checked + COMMUNITY_TRACK_BATCH_SIZE, COMMUNITY_MAX_TRACKS_TO_CHECK));
            const results = await Promise.allSettled(batch.map(async record => {
                const detail = await cloudApi(`/api/collections/community_routes/records/${encodeURIComponent(record.id)}?fields=trackJson`);
                const fullRecord = { ...record, trackJson: detail.trackJson };
                const lines = communityRecordLines(fullRecord);
                if (!lines) return null;
                const proximityKm = communityDistanceToRoute(searchPosition, lines) / 1000;
                return proximityKm <= radiusKm ? { ...fullRecord, proximityKm } : null;
            }));
            checked += batch.length;
            results.forEach(result => {
                if (result.status === 'fulfilled' && result.value) nearbyRoutes.push(result.value);
                else if (result.status === 'rejected') console.warn('No se pudo cargar un trazado candidato:', result.reason);
            });
            nearbyRoutes.sort((a, b) => a.proximityKm - b.proximityKm);
            const nextCandidate = candidates[checked];
            if (nearbyRoutes.length >= COMMUNITY_MAX_RESULTS
                && (!nextCandidate || nextCandidate.boundsDistanceKm > nearbyRoutes[COMMUNITY_MAX_RESULTS - 1].proximityKm)) {
                tracksComplete = true;
                break;
            }
        }
        if (checked >= candidates.length) tracksComplete = true;
        const metadataTruncated = metadata.length >= COMMUNITY_MAX_METADATA_CANDIDATES && page <= totalPages;
        const searchLimited = metadataTruncated || legacyTruncated || (!tracksComplete && checked < candidates.length);
        communityCatalogRoutes = nearbyRoutes.slice(0, COMMUNITY_MAX_RESULTS);
        renderCommunityRoutes(communityCatalogRoutes);
        communityUpdateStatsRouteSelect();
        DB.kvSet(COMMUNITY_SEARCH_CACHE_KEY, {
            activity, radiusKm, position: searchPosition, savedAt: Date.now(),
            routes: communityCatalogRoutes
        }).catch(error => console.warn('No se pudo guardar la búsqueda comunitaria:', error));
        communitySetStatus(searchLimited
            ? `${communityCatalogRoutes.length} rutas encontradas en una búsqueda limitada a ${checked} trazados. Reduce el radio para afinar los resultados.`
            : nearbyRoutes.length >= COMMUNITY_MAX_RESULTS
                ? `Mostrando las ${COMMUNITY_MAX_RESULTS} rutas más cercanas dentro de ${radiusKm} km.`
                : nearbyRoutes.length
                ? `${nearbyRoutes.length} rutas cercanas. Puedes abrir el detalle, mostrarlas en el mapa, seguirlas o guardarlas.`
                : 'No hay rutas publicadas dentro de ' + radiusKm + ' km con esta actividad.');
    } catch (error) {
        console.warn('No se pudo cargar el catálogo comunitario:', error);
        communitySetStatus(error.status === 404
            ? 'El servidor aún no tiene la colección community_routes instalada.'
            : 'No se pudo cargar el catálogo: ' + (error.message || 'error de conexión'), true);
        if (!displayedCache) $('community-route-list').replaceChildren();
    } finally {
        button.disabled = false;
    }
}
function initCommunityRoutes() {
    communityFillActivities($('community-activity'));
    communityFillProvinces($('community-share-province'));
    $('community-close').addEventListener('click', closeCommunityDialog);
    $('community-dialog').addEventListener('click', event => {
        if (event.target === $('community-dialog')) closeCommunityDialog();
    });
    $('community-search').addEventListener('click', loadCommunityRoutes);
    $('community-favorites-show').addEventListener('click', loadCommunityFavorites);
    $('community-submit').addEventListener('click', submitCommunityRoute);
    $('community-share-consent').addEventListener('change', event => {
        $('community-submit').disabled = !event.target.checked || !$('community-share-province').value;
    });
    $('community-share-province').addEventListener('change', () => {
        $('community-submit').disabled = !$('community-share-consent').checked || !$('community-share-province').value;
    });
    $('community-back').addEventListener('click', openCommunityCatalog);
    $('community-detail-back').addEventListener('click', () => communityDetailBackAction());
    $('community-detail-follow').addEventListener('click', () => {
        if (communityDetailFollowAction) communityDetailFollowAction();
    });
    $('community-create-segment').addEventListener('click', communityBeginSegmentCreation);
    $('community-segment-cancel').addEventListener('click', communityCancelSegmentCreation);
    $('community-segment-submit').addEventListener('click', communitySubmitSegment);
    $('stats-community-browse').addEventListener('click', openCommunityCatalog);
    $('stats-community-route').addEventListener('change', () => {
        const record = communityCatalogRoutes.find(item => item.id === $('stats-community-route').value);
        communityRenderStatsRoute(record || null);
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !$('community-dialog').hidden) closeCommunityDialog();
    });
}

initCommunityRoutes();
