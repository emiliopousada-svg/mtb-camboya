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
const COMMUNITY_REGIONS = {
    'Andalucía': ['Almería', 'Cádiz', 'Córdoba', 'Granada', 'Huelva', 'Jaén', 'Málaga', 'Sevilla'],
    'Aragón': ['Huesca', 'Teruel', 'Zaragoza'],
    'Principado de Asturias': ['Asturias'],
    'Illes Balears': ['Illes Balears'],
    'Canarias': ['Las Palmas', 'Santa Cruz de Tenerife'],
    'Cantabria': ['Cantabria'],
    'Castilla-La Mancha': ['Albacete', 'Ciudad Real', 'Cuenca', 'Guadalajara', 'Toledo'],
    'Castilla y León': ['Ávila', 'Burgos', 'León', 'Palencia', 'Salamanca', 'Segovia', 'Soria', 'Valladolid', 'Zamora'],
    'Cataluña': ['Barcelona', 'Girona', 'Lleida', 'Tarragona'],
    'Comunitat Valenciana': ['Alicante', 'Castellón', 'Valencia'],
    'Extremadura': ['Badajoz', 'Cáceres'],
    'Galicia': ['A Coruña', 'Lugo', 'Ourense', 'Pontevedra'],
    'Comunidad de Madrid': ['Madrid'],
    'Región de Murcia': ['Murcia'],
    'Comunidad Foral de Navarra': ['Navarra'],
    'País Vasco': ['Álava', 'Bizkaia', 'Gipuzkoa'],
    'La Rioja': ['La Rioja'],
    'Ceuta': ['Ceuta'],
    'Melilla': ['Melilla']
};
const COMMUNITY_TRIM_METERS = 150;
const COMMUNITY_MAX_RECORDS = 50;
let communityShareRoute = null;
let communityCatalogRoutes = [];
let communityVisibleLayers = new Map();
let communityLayerGroup = null;

function communitySetStatus(message, isError = false) {
    const status = $('community-status');
    status.textContent = message;
    status.classList.toggle('error', isError);
}

function communityFillRegions(select) {
    select.replaceChildren(new Option('Elige una comunidad autónoma', ''));
    Object.keys(COMMUNITY_REGIONS).forEach(region => select.add(new Option(region, region)));
}

function communityFillProvinces(select) {
    select.replaceChildren(new Option('Elige una provincia', ''));
    COMMUNITY_PROVINCES.forEach(province => select.add(new Option(province, province)));
}

function openCommunityCatalog() {
    $('community-publish').hidden = true;
    $('community-catalog').hidden = false;
    $('community-title').textContent = 'Rutas de la comunidad';
    $('community-dialog').hidden = false;
    communitySetStatus('Elige una comunidad autónoma para buscar rutas publicadas.');
    $('community-region').focus();
}

function closeCommunityDialog() {
    $('community-dialog').hidden = true;
    communityShareRoute = null;
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
    $('community-catalog').hidden = true;
    $('community-publish').hidden = false;
    $('community-title').textContent = 'Proponer ruta a la comunidad';
    $('community-share-title').textContent = route.name || 'Ruta grabada';
    $('community-share-province').value = '';
    $('community-share-consent').checked = false;
    $('community-submit').disabled = true;
    communitySetStatus('El envío quedará pendiente de revisión antes de aparecer en el mapa.');
    $('community-dialog').hidden = false;
    $('community-share-province').focus();
}

function communityDistance(a, b) {
    const rad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    const h = Math.sin(dLat / 2) ** 2 +
        Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
    return 12742000 * Math.asin(Math.sqrt(h));
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

async function submitCommunityRoute() {
    if (!communityShareRoute || !Cloud.loggedIn()) return;
    const province = $('community-share-province').value;
    if (!province || !$('community-share-consent').checked) {
        communitySetStatus('Elige la provincia y confirma la publicación voluntaria.', true);
        return;
    }
    const button = $('community-submit');
    button.disabled = true;
    communitySetStatus('Preparando una copia reducida y privada en sus extremos…');
    try {
        const route = communityShareRoute;
        const trackJson = JSON.stringify(communityPublicTrack(route));
        const record = await cloudApi('/api/collections/community_routes/records', 'POST', {
            owner: Cloud.uid,
            title: String(route.name || 'Ruta MTB').trim().slice(0, 100),
            province,
            activityType: activityTypeForRoute(route) || 'mtb',
            distanceKm: Number(route.distanceKm) || 0,
            elevationGain: Number(route.elevationGain) || 0,
            trackJson,
            published: false
        });
        communitySetStatus('Ruta enviada. Aparecerá en el mapa cuando se apruebe.');
        toast('Ruta enviada para revisión.');
        button.textContent = 'Enviada';
        setTimeout(closeCommunityDialog, 1400);
        return record;
    } catch (error) {
        console.warn('No se pudo proponer la ruta a la comunidad:', error);
        communitySetStatus(error.status === 404
            ? 'Falta instalar la colección community_routes en el servidor. Consulta CONFIGURAR-RUTAS-COMUNIDAD.md.'
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
        points: communityPointsForApp(lines),
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
    try {
        await DB.put(route);
        savedRoutes.unshift(route);
        renderSavedRoutes();
        toast('Ruta guardada para seguirla sin conexión.');
    } catch (error) {
        console.warn('No se pudo guardar la ruta comunitaria:', error);
        toast('No se pudo guardar la ruta en este dispositivo.');
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
        empty.textContent = 'No hay rutas aprobadas en esta comunidad autónoma todavía.';
        list.append(empty);
        return;
    }
    records.forEach(record => {
        let lines;
        try {
            lines = typeof record.trackJson === 'string' ? JSON.parse(record.trackJson) : record.trackJson;
            if (!Array.isArray(lines) || !lines.every(line => Array.isArray(line) && line.length > 1)) return;
        } catch (error) { return; }
        const card = document.createElement('article');
        card.className = 'community-route-card';
        const heading = document.createElement('strong');
        heading.textContent = record.title || 'Ruta de la comunidad';
        const facts = document.createElement('p');
        facts.textContent = (record.province || '') + ' · ' +
            ((Number(record.distanceKm) || 0).toFixed(1)) + ' km · +' +
            (Number(record.elevationGain) || 0) + ' m';
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
        actions.append(show, follow, save);
        card.append(heading, facts, actions);
        list.append(card);
    });
}

async function loadCommunityRoutes() {
    const region = $('community-region').value;
    const provinces = COMMUNITY_REGIONS[region];
    if (!provinces) {
        communitySetStatus('Elige una comunidad autónoma para buscar rutas.', true);
        return;
    }
    if (!navigator.onLine) {
        communitySetStatus('El catálogo necesita conexión. Las rutas guardadas sí están disponibles sin conexión.', true);
        return;
    }
    const button = $('community-search');
    button.disabled = true;
    communitySetStatus('Buscando rutas aprobadas…');
    try {
        const provinceFilter = provinces.map(province => 'province = "' + province.replace(/"/g, '\\"') + '"').join(' || ');
        const filter = 'published = true && (' + provinceFilter + ')';
        const result = await cloudApi('/api/collections/community_routes/records?page=1&perPage=' +
            COMMUNITY_MAX_RECORDS + '&fields=id,title,province,activityType,distanceKm,elevationGain,trackJson&filter=' + encodeURIComponent(filter));
        communityCatalogRoutes = Array.isArray(result.items) ? result.items : [];
        renderCommunityRoutes(communityCatalogRoutes);
        communitySetStatus(communityCatalogRoutes.length
            ? communityCatalogRoutes.length + ' rutas disponibles. Puedes mostrarlas en el mapa, seguirlas o guardarlas.'
            : 'No hay rutas aprobadas en esta comunidad autónoma todavía.');
    } catch (error) {
        console.warn('No se pudo cargar el catálogo comunitario:', error);
        communitySetStatus(error.status === 404
            ? 'El servidor aún no tiene la colección community_routes instalada.'
            : 'No se pudo cargar el catálogo: ' + (error.message || 'error de conexión'), true);
        $('community-route-list').replaceChildren();
    } finally {
        button.disabled = false;
    }
}

function initCommunityRoutes() {
    communityFillRegions($('community-region'));
    communityFillProvinces($('community-share-province'));
    $('btn-community-routes').addEventListener('click', openCommunityCatalog);
    $('community-close').addEventListener('click', closeCommunityDialog);
    $('community-dialog').addEventListener('click', event => {
        if (event.target === $('community-dialog')) closeCommunityDialog();
    });
    $('community-search').addEventListener('click', loadCommunityRoutes);
    $('community-submit').addEventListener('click', submitCommunityRoute);
    $('community-share-consent').addEventListener('change', event => {
        $('community-submit').disabled = !event.target.checked || !$('community-share-province').value;
    });
    $('community-share-province').addEventListener('change', () => {
        $('community-submit').disabled = !$('community-share-consent').checked || !$('community-share-province').value;
    });
    $('community-back').addEventListener('click', openCommunityCatalog);
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !$('community-dialog').hidden) closeCommunityDialog();
    });
}

initCommunityRoutes();
