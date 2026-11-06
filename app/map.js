'use strict';

//  MAPA
// ============================================================
async function calculateAlbergueRoute(feature, button) {
    if (lastLat === null || lastLon === null) {
        toast('Esperando una ubicación GPS válida para calcular la ruta.', 5000);
        return;
    }
    if (!navigator.onLine) {
        toast('Necesitas conexión a internet para calcular la ruta al albergue.', 5000);
        return;
    }

    const [destinationLon, destinationLat] = feature.geometry.coordinates;
    const request = ++albergueRouteRequest;
    const routeProfile = ['mtb', 'road'].includes(preferredActivityType) ? 'routed-bike' : 'routed-foot';
    const modeLabel = routeProfile === 'routed-bike' ? 'bicicleta' : 'a pie';
    const buttonText = button.textContent;
    button.disabled = true;
    button.textContent = 'Calculando ruta…';
    caminoStatus(`Calculando ruta ${modeLabel} al albergue…`);
    try {
        const url = `https://routing.openstreetmap.de/${routeProfile}/route/v1/driving/${lastLon},${lastLat};${destinationLon},${destinationLat}?overview=full&geometries=geojson&steps=false`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`El servicio de rutas respondió ${response.status}.`);
        const data = await response.json();
        const route = data.routes && data.routes[0];
        const coordinates = route && route.geometry && route.geometry.coordinates;
        if (data.code !== 'Ok' || !Array.isArray(coordinates) || coordinates.length < 2 ||
            !Number.isFinite(route.distance) || !Number.isFinite(route.duration)) {
            throw new Error('No se encontró un itinerario transitable hasta este albergue.');
        }
        const points = coordinates
            .filter(point => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]))
            .map(point => [point[1], point[0]]);
        if (points.length < 2) throw new Error('El itinerario recibido no tiene suficientes puntos.');
        if (request !== albergueRouteRequest) return;

        if (albergueRouteLayer) map.removeLayer(albergueRouteLayer);
        albergueRouteLayer = L.polyline(points, {
            color: '#ff1744',
            weight: 6,
            opacity: 0.95
        }).addTo(map);
        $('btn-albergue-route-clear').style.display = 'flex';
        map.fitBounds(albergueRouteLayer.getBounds(), { padding: [35, 35], maxZoom: 16 });
        map.closePopup();
        const distanceKm = (route.distance / 1000).toFixed(1);
        const durationMin = Math.max(1, Math.round(route.duration / 60));
        const name = feature.properties?.nombre || 'el albergue';
        caminoStatus(`Ruta ${modeLabel} a ${name}: ${distanceKm} km · ${durationMin} min. Datos de OpenStreetMap.`);
        goToPage(0);
    } catch (error) {
        if (request === albergueRouteRequest) {
            console.warn('No se pudo calcular la ruta al albergue:', error);
            caminoStatus(error.message || 'No se pudo calcular la ruta al albergue.', true);
            toast(error.message || 'No se pudo calcular la ruta al albergue.', 5000);
        }
    } finally {
        if (button.isConnected) {
            button.disabled = false;
            button.textContent = buttonText;
        }
    }
}

function clearAlbergueRoute() {
    albergueRouteRequest++;
    if (albergueRouteLayer && map) map.removeLayer(albergueRouteLayer);
    albergueRouteLayer = null;
    $('btn-albergue-route-clear').style.display = 'none';
}

$('btn-albergue-route-clear').addEventListener('click', clearAlbergueRoute);

function albergueFavoriteId(feature) {
    const properties = feature.properties || {};
    const [lng, lat] = feature.geometry.coordinates;
    return String(properties.id_reat || `${lat.toFixed(6)},${lng.toFixed(6)}`);
}

function readAlbergueFavorites() {
    const stored = JSON.parse(localStorage.getItem(ALBERGUE_FAVORITES_KEY) || '[]');
    if (!Array.isArray(stored)) throw new Error('La lista de favoritos tiene un formato no válido.');
    return new Set(stored.filter(id => typeof id === 'string'));
}

function caminoAlberguePopup(feature) {
    const properties = feature.properties || {};
    const popup = document.createElement('div');
    popup.style.cssText = 'width:100%;color:#121212;';
    const label = document.createElement('div');
    label.textContent = '🛏️ Albergue';
    label.style.cssText = 'font-size:12px;color:#52605a;';
    popup.append(label);
    const title = document.createElement('strong');
    title.textContent = `📍 ${properties.nombre || 'Albergue'}`;
    popup.append(title);

    const appendInfo = (icon, name, value) => {
        const line = document.createElement('div');
        line.textContent = `${icon} ${name}: ${value || 'No disponible'}`;
        popup.append(line);
    };
    const address = [properties.direccion, properties.lugar, properties.municipio]
        .map(value => String(value || '').trim())
        .filter((value, index, values) => value && values.indexOf(value) === index)
        .join(', ');
    const rawType = String(properties.tipo || '').trim();
    const normalizedType = rawType.toLowerCase();
    const type = normalizedType === 'publico' || normalizedType === 'público'
        ? 'Público'
        : normalizedType === 'privado'
            ? 'Privado'
            : rawType || 'No especificado';
    const price = properties.precio_orientativo ?? properties.precio ?? properties.precio_desde;
    const priceText = price === undefined || price === null || price === ''
        ? 'No disponible'
        : typeof price === 'number' ? `${price} €` : String(price);
    const [lng, lat] = feature.geometry.coordinates;
    const distance = lastLat === null || lastLon === null
        ? null
        : dist([lastLat, lastLon], [lat, lng]);
    const distanceText = distance === null
        ? 'No disponible'
        : distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(1)} km`;

    appendInfo('🗺️', 'Dirección', address);
    appendInfo('💶', 'Precio orientativo', priceText);
    appendInfo('🏷️', 'Tipo', type);
    appendInfo('📏', 'Distancia desde tu posición', distanceText);
    if (properties.plazas) appendInfo('👥', 'Plazas', String(properties.plazas));
    if (properties.horario_admision) appendInfo('🕒', 'Admisión', properties.horario_admision);
    if (properties.apertura) appendInfo('📅', 'Apertura', properties.apertura);
    if (Number(properties.km_camino) > 0) appendInfo('🥾', 'Km del Camino', String(properties.km_camino));

    const phone = String(properties.telefono || '').trim();
    if (phone) {
        const link = document.createElement('a');
        link.href = `tel:${phone.replace(/[^\d+]/g, '')}`;
        link.textContent = `📞 Teléfono: ${phone}`;
        link.style.cssText = 'display:inline-block;margin-top:6px;color:#176b2c;font-weight:700;';
        popup.append(link);
    } else appendInfo('📞', 'Teléfono', 'No disponible');
    const sourceUrl = properties.ficha_xunta || properties.url_caminoahora;
    if (sourceUrl && /^https:\/\//i.test(sourceUrl)) {
        const link = document.createElement('a');
        link.href = sourceUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Más información';
        link.style.cssText = 'display:block;margin-top:5px;';
        popup.append(link);
    }
    const routeNotice = document.createElement('p');
    routeNotice.textContent = 'El cálculo online enviará tu ubicación y la del albergue al servicio de rutas de OpenStreetMap.';
    routeNotice.style.cssText = 'margin:8px 0 4px;font-size:12px;';
    popup.append(routeNotice);

    const routeButton = document.createElement('button');
    routeButton.type = 'button';
    routeButton.className = 'btn';
    routeButton.textContent = '🧭 Cómo llegar';
    routeButton.style.cssText = 'width:100%;margin-top:5px;padding:8px;';
    routeButton.addEventListener('click', () => calculateAlbergueRoute(feature, routeButton));
    popup.append(routeButton);

    const favoriteButton = document.createElement('button');
    favoriteButton.type = 'button';
    favoriteButton.className = 'btn';
    favoriteButton.style.cssText = 'width:100%;margin-top:5px;padding:8px;';
    const favoriteId = albergueFavoriteId(feature);
    const updateFavoriteButton = isFavorite => {
        favoriteButton.textContent = isFavorite ? '⭐ Quitar favorito' : '⭐ Guardar favorito';
        favoriteButton.setAttribute('aria-pressed', String(isFavorite));
    };
    try {
        updateFavoriteButton(readAlbergueFavorites().has(favoriteId));
    } catch (error) {
        console.warn('No se pudieron leer los albergues favoritos:', error);
        updateFavoriteButton(false);
    }
    favoriteButton.addEventListener('click', () => {
        try {
            const favorites = readAlbergueFavorites();
            const isFavorite = favorites.has(favoriteId);
            if (isFavorite) favorites.delete(favoriteId);
            else favorites.add(favoriteId);
            localStorage.setItem(ALBERGUE_FAVORITES_KEY, JSON.stringify([...favorites]));
            updateFavoriteButton(!isFavorite);
            toast(isFavorite ? 'Albergue quitado de favoritos.' : 'Albergue guardado en favoritos.');
        } catch (error) {
            console.warn('No se pudo guardar el albergue favorito:', error);
            toast('No se pudo guardar el favorito en este dispositivo.');
        }
    });
    popup.append(favoriteButton);
    return popup;
}

let alberguePopupReturnFocus = null;
function openCaminoAlbergueInfo(feature) {
    const overlay = $('albergue-popup-overlay');
    $('albergue-popup-content').replaceChildren(caminoAlberguePopup(feature));
    alberguePopupReturnFocus = document.activeElement;
    overlay.hidden = false;
    $('albergue-popup-close').focus();
}

function closeCaminoAlbergueInfo() {
    const overlay = $('albergue-popup-overlay');
    if (overlay.hidden) return;
    overlay.hidden = true;
    $('albergue-popup-content').textContent = '';
    if (alberguePopupReturnFocus && alberguePopupReturnFocus.isConnected) alberguePopupReturnFocus.focus();
    alberguePopupReturnFocus = null;
}

$('albergue-popup-close').addEventListener('click', closeCaminoAlbergueInfo);
$('albergue-popup-overlay').addEventListener('click', event => {
    if (event.target === $('albergue-popup-overlay')) closeCaminoAlbergueInfo();
});
document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeCaminoAlbergueInfo();
});

function caminoServicePoiCategory(tags) {
    const amenity = String(tags.amenity || '').toLowerCase();
    const shop = String(tags.shop || '').toLowerCase();
    const historic = String(tags.historic || '').toLowerCase();
    const building = String(tags.building || '').toLowerCase();
    const healthcare = String(tags.healthcare || '').toLowerCase();
    if (amenity === 'pharmacy') return 'pharmacy';
    if (amenity === 'atm') return 'atm';
    if (['bus_station', 'ferry_terminal'].includes(amenity) || tags.railway === 'station' ||
        tags.public_transport === 'station') return 'transport';
    if (['restaurant', 'cafe', 'fast_food', 'bar'].includes(amenity)) return 'restaurant';
    if (amenity === 'bicycle_repair_station' || shop === 'bicycle' || tags['service:bicycle:repair'] === 'yes') return 'bicycle';
    if (['monument', 'memorial', 'wayside_shrine', 'wayside_cross'].includes(historic) ||
        amenity === 'place_of_worship' || ['church', 'chapel', 'cathedral'].includes(building)) return 'landmark';
    if (['drinking_water', 'fountain'].includes(amenity)) return 'fountain';
    if (['supermarket', 'convenience'].includes(shop)) return 'supermarket';
    if (['hospital', 'clinic', 'doctors', 'health_centre'].includes(amenity) ||
        ['hospital', 'clinic', 'doctor', 'centre'].includes(healthcare)) return 'medical';
    return null;
}

function sampleCaminoPoiCoordinates(lines) {
    const validLines = lines.filter(line => Array.isArray(line) && line.length > 1);
    const totalDistance = validLines.reduce((total, line) => {
        for (let i = 1; i < line.length; i++) total += dist(line[i - 1], line[i]);
        return total;
    }, 0);
    if (!totalDistance) return { points: [], radius: 800 };

    const spacing = Math.max(1000, totalDistance / Math.max(1, 430 - validLines.length));
    const points = [];
    for (const line of validLines) {
        points.push(line[0]);
        let segmentStartDistance = 0;
        let nextSample = spacing;
        for (let i = 1; i < line.length; i++) {
            const start = line[i - 1], end = line[i];
            const segmentDistance = dist(start, end);
            if (!segmentDistance) continue;
            while (nextSample <= segmentStartDistance + segmentDistance) {
                const fraction = (nextSample - segmentStartDistance) / segmentDistance;
                points.push([
                    start[0] + (end[0] - start[0]) * fraction,
                    start[1] + (end[1] - start[1]) * fraction
                ]);
                nextSample += spacing;
            }
            segmentStartDistance += segmentDistance;
        }
        const last = line[line.length - 1];
        if (dist(points[points.length - 1], last) > spacing * 0.5) points.push(last);
    }

    const cappedPoints = points.length > 500
        ? points.filter((_, index) => index % Math.ceil(points.length / 500) === 0)
        : points;
    const radius = Math.min(1800, Math.max(700, Math.round(spacing * 0.65)));
    return { points: cappedPoints, radius };
}

function caminoServicePoiPopup(element, category) {
    const tags = element.tags || {};
    const meta = CAMINO_SERVICE_CATEGORIES[category];
    const name = tags.name || tags['name:es'] || tags.operator || meta.label;
    const popup = document.createElement('div');
    popup.style.cssText = 'max-width:260px;color:#121212;';
    const title = document.createElement('strong');
    title.textContent = `${meta.emoji} ${name}`;
    popup.append(title);
    const address = [
        [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' '),
        tags['addr:postcode'],
        tags['addr:city'] || tags['addr:place']
    ].filter(Boolean).join(', ');
    if (address) {
        const line = document.createElement('div');
        line.textContent = `📍 ${address}`;
        popup.append(line);
    }
    if (tags.opening_hours) {
        const line = document.createElement('div');
        line.textContent = `🕒 ${tags.opening_hours}`;
        popup.append(line);
    }
    if (tags.phone || tags['contact:phone']) {
        const phone = String(tags.phone || tags['contact:phone']);
        const link = document.createElement('a');
        link.href = `tel:${phone.replace(/[^\d+]/g, '')}`;
        link.textContent = `📞 ${phone}`;
        link.style.cssText = 'display:block;margin-top:5px;';
        popup.append(link);
    }
    const website = tags.website || tags['contact:website'];
    if (website && /^https:\/\//i.test(website)) {
        const link = document.createElement('a');
        link.href = website;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Más información';
        link.style.cssText = 'display:block;margin-top:5px;';
        popup.append(link);
    }
    const attribution = document.createElement('small');
    attribution.textContent = 'OpenStreetMap · © OpenStreetMap contributors';
    attribution.style.cssText = 'display:block;margin-top:6px;color:#53677d;';
    popup.append(attribution);
    return popup;
}

function clearCaminoServicePois() {
    caminoServicePoiRequest++;
    if (caminoServicePoiController) {
        caminoServicePoiController.abort();
        caminoServicePoiController = null;
    }
    if (caminoServicePoiLayer && map) map.removeLayer(caminoServicePoiLayer);
    caminoServicePoiLayer = null;
    $('camino-poi-status').textContent = 'Los servicios de OpenStreetMap se cargan al mostrar el track y requieren conexión. Los albergues están incluidos en la app.';
}

const CAMINO_POI_QUERY_FILTERS = (around) =>
    `nwr${around}[amenity~"^(restaurant|cafe|fast_food|bar)$"];` +
    `nwr${around}[shop=bicycle];` +
    `nwr${around}[amenity=bicycle_repair_station];` +
    `nwr${around}["service:bicycle:repair"="yes"];` +
    `nwr${around}[historic~"^(monument|memorial|wayside_shrine|wayside_cross)$"];` +
    `nwr${around}[amenity=place_of_worship];` +
    `nwr${around}[building~"^(church|chapel|cathedral)$"];` +
    `nwr${around}[amenity~"^(drinking_water|fountain|pharmacy|atm|bus_station)$"];` +
    `nwr${around}[railway=station];` +
    `nwr${around}[shop~"^(supermarket|convenience)$"];` +
    `nwr${around}[amenity~"^(hospital|clinic|doctors|health_centre)$"];` +
    `nwr${around}[healthcare~"^(hospital|clinic|doctor|centre)$"];`;

function parseCaminoServiceElements(result) {
    if (!result || !Array.isArray(result.elements)) throw new Error('La respuesta de OpenStreetMap no tiene un formato válido.');
    if (result.elements.length > 8000) throw new Error('La búsqueda devuelve demasiados puntos. Prueba con un tramo más corto del Camino.');
    return result.elements.map(element => {
        const tags = element.tags || {};
        const category = caminoServicePoiCategory(tags);
        const lat = element.lat ?? element.center?.lat;
        const lon = element.lon ?? element.center?.lon;
        if (!category || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        return { element, category, lat, lon };
    }).filter(Boolean);
}

