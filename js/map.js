'use strict';

        // ============================================================
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
            popup.style.cssText = 'max-width:280px;color:#121212;';
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

        async function loadCaminoServicePois(id, routeId, lines) {
            clearCaminoServicePois();
            if (!CAMINO_ROUTES[id] || !Array.isArray(lines) || !navigator.onLine) {
                if (CAMINO_ROUTES[id] && !navigator.onLine) {
                    $('camino-poi-status').textContent = 'Sin conexión: los albergues incluidos siguen disponibles; los demás servicios necesitan internet.';
                }
                return;
            }

            const request = caminoServicePoiRequest;
            const cacheKey = `${id}:${routeId}`;
            const cached = caminoServicePoiCache.get(cacheKey);
            if (cached) {
                showCaminoServicePois(cached, request);
                return;
            }

            const { points, radius } = sampleCaminoPoiCoordinates(lines);
            if (!points.length) {
                $('camino-poi-status').textContent = 'No se pudieron localizar puntos válidos a lo largo del track.';
                return;
            }
            $('camino-poi-status').textContent = 'Buscando restaurantes, talleres, monumentos, fuentes, supermercados y centros médicos cerca del Camino…';
            const around = `(around:${radius},${points.map(([lat, lon]) => `${lat.toFixed(5)},${lon.toFixed(5)}`).join(',')})`;
            const query = `[out:json][timeout:60];(` + CAMINO_POI_QUERY_FILTERS(around) + `);out center tags;`;
            const controller = new AbortController();
            caminoServicePoiController = controller;
            const timeout = setTimeout(() => controller.abort(), 65000);
            try {
                const response = await fetch('https://overpass-api.de/api/interpreter', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
                    body: `data=${encodeURIComponent(query)}`,
                    signal: controller.signal
                });
                if (!response.ok) throw new Error(`OpenStreetMap respondió ${response.status}.`);
                const result = await response.json();
                const services = parseCaminoServiceElements(result);
                if (request !== caminoServicePoiRequest) return;
                caminoServicePoiCache.set(cacheKey, services);
                while (caminoServicePoiCache.size > 5) {
                    caminoServicePoiCache.delete(caminoServicePoiCache.keys().next().value);
                }
                showCaminoServicePois(services, request);
            } catch (error) {
                if (request !== caminoServicePoiRequest) return;
                console.warn('No se pudieron cargar los servicios del Camino desde OpenStreetMap:', error);
                $('camino-poi-status').textContent = error.name === 'AbortError'
                    ? 'La búsqueda de servicios tardó demasiado. Vuelve a mostrar el track para intentarlo de nuevo.'
                    : `${error.message || 'No se pudieron cargar los servicios de OpenStreetMap.'} Los albergues incluidos siguen disponibles.`;
            } finally {
                clearTimeout(timeout);
                if (request === caminoServicePoiRequest) caminoServicePoiController = null;
            }
        }

        let caminoServicesLast = null;
        let caminoHiddenGroups = new Set();

        function caminoCategoryVisible(category) {
            return !Object.entries(CAMINO_FILTER_GROUPS)
                .some(([group, def]) => caminoHiddenGroups.has(group) && def.cats.includes(category));
        }

        function applyCaminoAlbergueFilter() {
            if (!caminoAlberguesLayer || !map) return;
            const visible = !caminoHiddenGroups.has('albergue') && !!guide.active;
            if (visible && !map.hasLayer(caminoAlberguesLayer)) caminoAlberguesLayer.addTo(map);
            if (!visible && map.hasLayer(caminoAlberguesLayer)) map.removeLayer(caminoAlberguesLayer);
        }

        function showCaminoServicePois(services, request) {
            if (request !== caminoServicePoiRequest) return;
            caminoServicesLast = services;
            const shown = services.filter(service => caminoCategoryVisible(service.category));
            const markers = shown.map(({ element, category, lat, lon }) => L.marker([lat, lon], {
                icon: L.divIcon({
                    html: CAMINO_SERVICE_CATEGORIES[category].emoji,
                    className: 'poi-icon',
                    iconSize: [30, 30],
                    iconAnchor: [15, 15]
                })
            }).bindPopup(caminoServicePoiPopup(element, category)));
            if (caminoServicePoiLayer && map) map.removeLayer(caminoServicePoiLayer);
            caminoServicePoiLayer = L.featureGroup(markers).addTo(map);
            const counts = shown.reduce((result, service) => {
                result[service.category] = (result[service.category] || 0) + 1;
                return result;
            }, {});
            const categories = Object.entries(counts)
                .map(([category, count]) => `${CAMINO_SERVICE_CATEGORIES[category].emoji} ${count}`)
                .join(' · ');
            $('camino-poi-status').textContent = shown.length
                ? `${shown.length} servicios encontrados cerca del track${categories ? `: ${categories}` : ''}. Datos de OpenStreetMap.`
                : 'No hay servicios visibles cerca de este track (revisa los filtros). Los albergues incluidos siguen disponibles.';
        }

        function setCaminoGroupVisible(group, visible) {
            if (visible) caminoHiddenGroups.delete(group); else caminoHiddenGroups.add(group);
            try { localStorage.setItem(CAMINO_FILTERS_KEY, JSON.stringify([...caminoHiddenGroups])); } catch (e) {}
            applyCaminoAlbergueFilter();
            if (caminoServicesLast && caminoServicePoiLayer) showCaminoServicePois(caminoServicesLast, caminoServicePoiRequest);
            renderCaminoFilterChips();
        }

        function renderCaminoFilterChips() {
            const box = $('camino-filter-chips');
            if (!box) return;
            box.textContent = '';
            Object.entries(CAMINO_FILTER_GROUPS).forEach(([group, def]) => {
                const button = document.createElement('button');
                const visible = !caminoHiddenGroups.has(group);
                button.type = 'button';
                button.className = 'camino-chip';
                button.setAttribute('aria-pressed', String(visible));
                button.textContent = `${def.emoji} ${def.label}`;
                button.addEventListener('click', () => setCaminoGroupVisible(group, !visible));
                box.append(button);
            });
        }

        function clearCaminoAlbergues() {
            caminoAlberguesRequest++;
            if (caminoAlberguesLayer && map) map.removeLayer(caminoAlberguesLayer);
            caminoAlberguesLayer = null;
            caminoAlbergueCount = null;
            renderCaminoDashboard();
        }

        async function loadCaminoAlbergues(id, fitBounds = true) {
            clearCaminoAlbergues();
            if (!id || !CAMINO_ROUTES[id] || !map) return 0;
            const request = caminoAlberguesRequest;
            if (!caminoAlberguesPromise) {
                caminoAlberguesPromise = fetch('data/albergues.geojson')
                    .then(response => {
                        if (!response.ok) throw new Error(`No se pudo cargar el archivo de albergues (${response.status}).`);
                        return response.json();
                    })
                    .then(data => {
                        if (!data || !Array.isArray(data.features)) throw new Error('El archivo de albergues no tiene un formato GeoJSON válido.');
                        return data;
                    })
                    .catch(error => {
                        caminoAlberguesPromise = null;
                        throw error;
                    });
            }
            try {
                const data = await caminoAlberguesPromise;
                if (request !== caminoAlberguesRequest || $('camino-select').value !== id) return 0;
                const routePaths = new Set(CAMINO_ROUTES[id].alberguePaths || []);
                const features = data.features.filter(feature => {
                    if (feature.geometry?.type !== 'Point' || !Array.isArray(feature.geometry.coordinates)) return false;
                    const properties = feature.properties || {};
                    const paths = Array.isArray(properties.caminos) ? properties.caminos : [properties.camino].filter(Boolean);
                    return paths.some(path => routePaths.has(path));
                });
                const markers = features.map(feature => {
                    const [lng, lat] = feature.geometry.coordinates;
                    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
                    return L.marker([lat, lng], {
                        icon: L.divIcon({ html: '🏠', className: 'poi-icon', iconSize: [30, 30], iconAnchor: [15, 15] })
                    }).bindPopup(caminoAlberguePopup(feature));
                }).filter(Boolean);
                if (!markers.length) {
                    caminoAlbergueCount = 0;
                    renderCaminoDashboard();
                    caminoStatus(`No hay albergues cargados para ${CAMINO_ROUTES[id].name}.`, true);
                    return 0;
                }
                caminoAlberguesLayer = L.featureGroup(markers);
                applyCaminoAlbergueFilter();
                caminoAlbergueCount = markers.length;
                renderCaminoDashboard();
                if (fitBounds) map.fitBounds(caminoAlberguesLayer.getBounds(), { padding: [30, 30], maxZoom: 12 });
                caminoStatus(`${CAMINO_ROUTES[id].name}: ${markers.length} albergues en el mapa.`);
                setTimeout(() => map.invalidateSize(), 150);
                return markers.length;
            } catch (error) {
                if (request === caminoAlberguesRequest) {
                    caminoAlbergueCount = null;
                    renderCaminoDashboard();
                    console.warn('No se pudieron cargar los albergues del Camino:', error);
                    caminoStatus(error.message || 'No se pudieron cargar los albergues.', true);
                }
                return 0;
            }
        }

        function caminoTracksKey(id) {
            return `camino-tracks:${id}`;
        }

        function loadCaminoTracksData() {
            if (!caminoTracksDataPromise) {
                caminoTracksDataPromise = fetch('data/caminos.geojson')
                    .then(response => {
                        if (!response.ok) throw new Error(`No se pudieron cargar los tracks incluidos (${response.status}).`);
                        return response.json();
                    })
                    .then(data => {
                        if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
                            throw new Error('El archivo de tracks incluidos no tiene un formato GeoJSON válido.');
                        }
                        return data;
                    })
                    .catch(error => {
                        caminoTracksDataPromise = null;
                        throw error;
                    });
            }
            return caminoTracksDataPromise;
        }

        function caminoFeatureToPoints(feature) {
            const lines = feature.geometry.type === 'LineString'
                ? [feature.geometry.coordinates]
                : feature.geometry.coordinates;
            const points = [];
            for (const line of lines) {
                const validPoints = Array.isArray(line)
                    ? line.filter(point =>
                        Array.isArray(point) &&
                        Number.isFinite(point[0]) &&
                        Number.isFinite(point[1]) &&
                        point[0] >= -10 && point[0] <= 5 &&
                        point[1] >= 35 && point[1] <= 45
                    )
                    : [];
                if (validPoints.length < 2) continue;
                validPoints.forEach((point, index) => {
                    points.push([
                        point[1], point[0], null, null, null,
                        points.length > 0 && index === 0 ? 1 : null
                    ]);
                });
            }
            return points;
        }

        async function loadCaminoTracks(id, preferredId = '') {
            caminoTracks = [];
            bundledCaminoTrack = null;
            caminoOfficialStages = [];
            populateCaminoTracks(preferredId);
            renderCaminoDashboard();
            renderCaminoStages();
            renderCaminoFavorites();
            if (!CAMINO_ROUTES[id]) {
                return;
            }
            const [savedResult, dataResult] = await Promise.allSettled([
                DB.kvGet(caminoTracksKey(id)),
                guideLoad(id)
            ]);
            if ($('camino-select').value !== id) return;

            const errors = [];
            if (savedResult.status === 'fulfilled') {
                const tracks = savedResult.value;
                caminoTracks = Array.isArray(tracks)
                    ? tracks.filter(track =>
                        track &&
                        Number.isFinite(track.id) &&
                        Array.isArray(track.points) &&
                        track.points.length > 1
                    )
                    : [];
            } else {
                console.warn(`No se pudieron cargar los tracks importados de ${CAMINO_ROUTES[id].name}:`, savedResult.reason);
                errors.push('No se pudieron leer los tracks importados guardados.');
            }

            if (dataResult.status === 'fulfilled') {
                const raw = dataResult.value.data;
                const pts = raw.points.map((p, i) => [p[0], p[1], Number.isFinite(p[2]) ? p[2] : null, null, null, null]);
                caminoOfficialStages = (raw.baseStages || raw.stages).map((st, index) => ({
                    id: `stage:${index}`,
                    name: st.name || `Etapa ${index + 1}`,
                    points: pts.slice(st.from, st.to + 1)
                })).filter(stage => stage.points.length > 1);
                bundledCaminoTrack = {
                    id: 'official',
                    name: `${CAMINO_ROUTES[id].name} · recorrido completo`,
                    points: pts
                };
            } else {
                console.error('No se pudo leer el recorrido completo del Camino:', dataResult.reason);
                errors.push('No hay recorrido completo disponible para este Camino.');
            }
            populateCaminoTracks(preferredId);
            renderCaminoDashboard();
            renderCaminoStages();
            renderCaminoFavorites();
            if (errors.length) caminoStatus(errors.join(' '), true);
        }

        function populateCaminoTracks(preferredId = '') {
            const select = $('camino-track-select');
            const previousId = preferredId || select.value;
            select.replaceChildren();
            $('btn-camino-import').disabled = !CAMINO_ROUTES[$('camino-select').value];
            if (!CAMINO_ROUTES[$('camino-select').value]) {
                select.add(new Option('Selecciona un Camino primero', ''));
                return;
            }
            if (!caminoTracks.length && !bundledCaminoTrack) {
                select.add(new Option('Aún no hay tracks importados para este Camino', ''));
                return;
            }
            if (bundledCaminoTrack) {
                select.add(new Option('Recorrido completo desde el inicio', 'official'));
            }
            caminoOfficialStages.forEach(stage => {
                select.add(new Option(`Etapa · ${stage.name}`, stage.id));
            });
            caminoTracks.forEach(track => {
                const distance = Number.isFinite(track.distanceKm) ? ` · ${track.distanceKm.toFixed(1)} km` : '';
                select.add(new Option(`${track.name || 'Track sin nombre'}${distance}`, String(track.id)));
            });
            const availableIds = caminoTracks.map(track => String(track.id));
            if (bundledCaminoTrack) availableIds.unshift('official');
            availableIds.push(...caminoOfficialStages.map(stage => stage.id));
            const selectedId = availableIds.includes(previousId)
                ? previousId
                : availableIds.includes('official') ? 'official'
                    : caminoTracks.length === 1 ? String(caminoTracks[0].id) : '';
            select.value = selectedId;
        }

        function populateCaminoList() {
            const list = $('camino-list');
            list.replaceChildren();
            Object.entries(CAMINO_ROUTES).filter(([id]) => GUIDE_IDS.has(id)).forEach(([id, route]) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'camino-option';
                button.dataset.camino = id;
                button.setAttribute('aria-pressed', String($('camino-select').value === id));
                const visual = CAMINO_VISUALS[id];
                const icon = document.createElement('span');
                icon.className = 'camino-option-icon';
                icon.style.color = visual.color;
                icon.setAttribute('aria-hidden', 'true');
                icon.textContent = visual.icon;
                const copy = document.createElement('span');
                copy.className = 'camino-option-copy';
                copy.append(document.createTextNode(route.name));
                const hint = document.createElement('small');
                hint.textContent = 'Recorrido completo';
                copy.append(hint);
                const arrow = document.createElement('span');
                arrow.className = 'camino-option-arrow';
                arrow.setAttribute('aria-hidden', 'true');
                arrow.textContent = '›';
                button.append(icon, copy, arrow);
                button.addEventListener('click', () => {
                    if ($('camino-select').value === id) {
                        clearCamino();
                        return;
                    }
                    $('camino-select').value = id;
                    $('camino-select').dispatchEvent(new Event('change'));
                    setCaminoTab('routes');
                    $('camino-panel-routes').scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
                list.append(button);
            });
        }

        function loadCaminoFavorites() {
            try {
                const stored = JSON.parse(localStorage.getItem(CAMINO_FAVORITES_KEY) || '[]');
                caminoFavorites = Array.isArray(stored)
                    ? [...new Set(stored.filter(id => Object.prototype.hasOwnProperty.call(CAMINO_ROUTES, id)))]
                    : [];
            } catch (error) {
                console.warn('No se pudieron leer los Caminos favoritos:', error);
                caminoFavorites = [];
            }
        }

        function saveCaminoFavorites() {
            try {
                localStorage.setItem(CAMINO_FAVORITES_KEY, JSON.stringify(caminoFavorites));
            } catch (error) {
                console.warn('No se pudieron guardar los Caminos favoritos:', error);
                caminoStatus('No se pudo guardar el favorito en este dispositivo.', true);
                return false;
            }
            return true;
        }

        function renderCaminoDashboard() {
            const id = $('camino-select')?.value || '';
            const route = CAMINO_ROUTES[id];
            $('camino-route-title').textContent = route ? route.name : 'Elige un Camino';
            if (!route) $('camino-route-subtitle').textContent = 'Selecciona un Camino para consultar sus tracks y albergues';
            $('camino-stage-count').textContent = route ? String(caminoOfficialStages.length) : '—';
            $('camino-albergue-count').textContent = caminoAlbergueCount === null ? '—' : caminoAlbergueCount.toLocaleString('es-ES');
            $('camino-import-count').textContent = caminoTracks.length.toLocaleString('es-ES');
        }

        function renderCaminoStages() {
            const container = $('camino-stage-list');
            if (!container) return;
            container.replaceChildren();
            if (!CAMINO_ROUTES[$('camino-select').value]) {
                container.append(Object.assign(document.createElement('p'), {
                    className: 'camino-empty',
                    textContent: 'Selecciona un Camino para consultar sus etapas.'
                }));
                return;
            }
            if (!caminoOfficialStages.length) {
                container.append(Object.assign(document.createElement('p'), {
                    className: 'camino-empty',
                    textContent: 'No hay etapas disponibles para este Camino.'
                }));
                return;
            }
            caminoOfficialStages.forEach(stage => {
                const row = document.createElement('div');
                row.className = 'camino-stage';
                const name = document.createElement('span');
                name.className = 'camino-stage-name';
                name.textContent = stage.name;
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'btn-small';
                button.textContent = 'Ver en mapa';
                button.addEventListener('click', () => {
                    $('camino-track-select').value = stage.id;
                    showSelectedCamino();
                });
                row.append(name, button);
                container.append(row);
            });
        }

        function renderCaminoFavorites() {
            const favorites = $('camino-favorite-list');
            const imported = $('camino-imported-list');
            if (!favorites || !imported) return;
            favorites.replaceChildren();
            imported.replaceChildren();
            const favoriteIds = caminoFavorites.filter(id => CAMINO_ROUTES[id]);
            if (!favoriteIds.length) {
                favorites.append(Object.assign(document.createElement('p'), {
                    className: 'camino-empty',
                    textContent: 'Todavía no tienes favoritos. Abre un Camino y toca «Guardar en Mis Caminos».'
                }));
            }
            favoriteIds.forEach(id => {
                const row = document.createElement('div');
                row.className = 'camino-stage';
                const name = document.createElement('span');
                name.className = 'camino-stage-name';
                name.textContent = CAMINO_ROUTES[id].name;
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'btn-small';
                button.textContent = 'Abrir';
                button.addEventListener('click', () => {
                    $('camino-select').value = id;
                    $('camino-select').dispatchEvent(new Event('change'));
                    setCaminoTab('routes');
                });
                row.append(name, button);
                favorites.append(row);
            });
            if (!caminoTracks.length) {
                imported.append(Object.assign(document.createElement('p'), {
                    className: 'camino-empty',
                    textContent: CAMINO_ROUTES[$('camino-select').value]
                        ? `No hay tracks personales guardados para ${CAMINO_ROUTES[$('camino-select').value].name}.`
                        : 'Selecciona un Camino para ver sus tracks personales.'
                }));
            }
            caminoTracks.forEach(track => {
                const row = document.createElement('div');
                row.className = 'camino-stage';
                const name = document.createElement('span');
                name.className = 'camino-stage-name';
                name.textContent = track.name || 'Track sin nombre';
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'btn-small';
                button.textContent = 'Ver en mapa';
                button.addEventListener('click', () => {
                    $('camino-track-select').value = String(track.id);
                    showSelectedCamino();
                });
                row.append(name, button);
                imported.append(row);
            });
        }

        function setCaminoTab(tab) {
            caminoActiveTab = tab;
            document.querySelectorAll('[data-camino-tab]').forEach(button => {
                const selected = button.dataset.caminoTab === tab;
                button.setAttribute('aria-pressed', String(selected));
            });
            document.querySelectorAll('.camino-panel').forEach(panel => {
                panel.hidden = panel.id !== `camino-panel-${tab}`;
            });
            document.querySelector('.camino-dashboard').classList.toggle('guide-mode', tab === 'guide');
            if (tab === 'routes' || tab === 'guide') guideRender();
            if (tab === 'favorites') renderCaminoFavorites();
        }

        function updateCaminoListSelection(id) {
            $('camino-list').querySelectorAll('[data-camino]').forEach(button => {
                button.setAttribute('aria-pressed', String(button.dataset.camino === id));
            });
        }

        async function addCaminoTrack(id, parsed) {
            const routeName = `${CAMINO_ROUTES[id].name} · ${parsed.name || 'Track importado'}`;
            const route = buildImportedRoute(parsed, routeName);
            const tracks = caminoTracks.slice();
            while (tracks.some(track => track.id === route.id)) route.id++;
            tracks.push(route);
            await DB.kvSet(caminoTracksKey(id), tracks);
            caminoTracks = tracks;
            populateCaminoTracks(String(route.id));
            renderCaminoDashboard();
            renderCaminoFavorites();
            caminoStatus(`Track «${route.name}» añadido a ${CAMINO_ROUTES[id].name}.`);
        }

        document.querySelectorAll('[data-camino-tab]').forEach(button => {
            button.addEventListener('click', () => setCaminoTab(button.dataset.caminoTab));
        });

        $('btn-camino-import').addEventListener('click', async () => {
            const id = $('camino-select').value;
            const file = $('camino-file-input').files[0];
            if (!CAMINO_ROUTES[id]) {
                caminoStatus('Selecciona primero el Camino al que pertenece este track.', true);
                return;
            }
            if (!file) {
                caminoStatus('Elige primero un archivo GPX, KML o GeoJSON.', true);
                return;
            }
            const button = $('btn-camino-import');
            button.disabled = true;
            try {
                const parsed = parseTrack(await file.text(), file.name);
                await addCaminoTrack(id, parsed);
                $('camino-file-input').value = '';
            } catch (e) {
                console.warn('No se pudo importar el track del Camino:', e);
                caminoStatus(`No se pudo importar el track: ${e.message || e}`, true);
            } finally {
                button.disabled = !CAMINO_ROUTES[$('camino-select').value];
            }
        });

        function displayCamino(id, route) {
            if (!map || !window.L) throw new Error('El mapa no está disponible.');
            const config = CAMINO_ROUTES[id];
            if (!config || !route || !Array.isArray(route.points)) throw new Error('No hay un track válido para mostrar.');
            const lines = buildSegments(route.points)
                .map(line => line.filter(point =>
                    Array.isArray(point) &&
                    point.length === 2 &&
                    Number.isFinite(point[0]) &&
                    Number.isFinite(point[1])
                ))
                .filter(line => line.length > 1);
            if (!lines.length) throw new Error('El track seleccionado no contiene suficientes puntos válidos.');
            if (caminoLayer) map.removeLayer(caminoLayer);
            caminoLayer = L.polyline(lines, {
                color: '#ab47bc',
                weight: 5,
                opacity: 0.9
            }).addTo(map);

            $('camino-select').value = id;
            updateCaminoListSelection(id);
            $('camino-track-select').value = String(route.id);
            renderCaminoDashboard();
            if (route.id === 'official') {
                caminoStatus(`${config.name}: recorrido completo dibujado (${lines.reduce((total, line) => total + line.length, 0).toLocaleString('es-ES')} puntos).`);
            } else if (String(route.id).startsWith('stage:')) {
                caminoStatus(`${config.name}: etapa «${route.name}» dibujada en el mapa.`);
            } else {
                caminoStatus(`${config.name}: track «${route.name || 'sin nombre'}» dibujado (${lines.reduce((total, line) => total + line.length, 0).toLocaleString('es-ES')} puntos).`);
            }
            try { localStorage.setItem('mtb_camino_active', id); } catch (e) {}
            try { localStorage.setItem('mtb_camino_saved_track', String(route.id)); } catch (e) {}

            const bounds = caminoLayer.getBounds();
            if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 });
            if (route.id === 'official') clearCaminoServicePois();
            else loadCaminoServicePois(id, String(route.id), lines);
            setTimeout(() => map.invalidateSize(), 150);
        }

        function caminoStatus(message, isError = false) {
            const status = $('camino-status');
            status.textContent = message;
            status.style.color = isError ? '#b3261e' : '#53677d';
        }

        function selectedCaminoTrack() {
            const selectedId = $('camino-track-select').value;
            if (selectedId === 'official') return bundledCaminoTrack;
            const stage = caminoOfficialStages.find(item => item.id === selectedId);
            if (stage) return stage;
            return caminoTracks.find(item => String(item.id) === selectedId);
        }

        async function showSelectedCamino() {
            const id = $('camino-select').value;
            if (!id || !CAMINO_ROUTES[id]) {
                caminoStatus('Selecciona uno de los caminos para continuar.', true);
                return;
            }
            const route = selectedCaminoTrack();
            if (!route) {
                caminoStatus('Importa o selecciona un track que pertenezca a este Camino.', true);
                return;
            }
            caminoStatus(`Dibujando el track de ${CAMINO_ROUTES[id].name}…`);
            try {
                displayCamino(id, route);
                setCaminoTab('routes');
                goToPage(0);
                toast(`${CAMINO_ROUTES[id].name} dibujado en el mapa.`);
            } catch (e) {
                console.warn('No se pudo dibujar el track del Camino:', e);
                caminoStatus(`No se pudo dibujar el track. ${e.message || ''}`, true);
            }
        }

        function clearCamino() {
            if (guide.active) guideStop(true);
            try { localStorage.removeItem(GUIDE_PAUSED_KEY); } catch (e) {}
            if (caminoLayer) map.removeLayer(caminoLayer);
            caminoLayer = null;
            clearCaminoServicePois();
            clearAlbergueRoute();
            clearCaminoAlbergues();
            $('camino-select').value = '';
            updateFollowCaminoBtn();
            updateCaminoListSelection('');
            caminoTracks = [];
            caminoOfficialStages = [];
            bundledCaminoTrack = null;
            populateCaminoTracks();
            renderCaminoDashboard();
            renderCaminoStages();
            renderCaminoFavorites();
            try { localStorage.removeItem('mtb_camino_active'); } catch (e) {}
            try { localStorage.removeItem('mtb_camino_track'); } catch (e) {}
            try { localStorage.removeItem('mtb_camino_saved_track'); } catch (e) {}
            caminoStatus('Camino quitado del mapa.');
            guideRender();
        }

        async function restoreCamino() {
            let id = '';
            let trackId = '';
            try {
                id = localStorage.getItem('mtb_camino_active') || '';
                trackId = localStorage.getItem('mtb_camino_saved_track') || '';
            } catch (e) {}
            try { localStorage.removeItem('mtb_camino_track'); } catch (e) {}
            if (!id || !CAMINO_ROUTES[id]) {
                $('camino-select').value = '';
                updateCaminoListSelection('');
                updateFollowCaminoBtn();
                return;
            }
            $('camino-select').value = id;
            updateCaminoListSelection(id);
            await loadCaminoAlbergues(id);
            await loadCaminoTracks(id, trackId || 'official');
            const route = trackId === 'official'
                ? bundledCaminoTrack
                : caminoOfficialStages.find(item => item.id === trackId) ||
                    caminoTracks.find(item => String(item.id) === trackId);
            if (route) displayCamino(id, route);
        }

        $('camino-select').addEventListener('change', async () => {
            const id = $('camino-select').value;
            updateCaminoListSelection(id);
            if (caminoLayer) map.removeLayer(caminoLayer);
            caminoLayer = null;
            clearCaminoServicePois();
            clearAlbergueRoute();
            clearCaminoAlbergues();
            if (id && CAMINO_ROUTES[id]) {
                try { localStorage.setItem('mtb_camino_active', id); } catch (e) {}
            } else {
                try { localStorage.removeItem('mtb_camino_active'); } catch (e) {}
            }
            try { localStorage.removeItem('mtb_camino_track'); } catch (e) {}
            try { localStorage.removeItem('mtb_camino_saved_track'); } catch (e) {}
            await Promise.all([
                loadCaminoAlbergues(id),
                loadCaminoTracks(id, id ? 'official' : '')
            ]);
            renderCaminoDashboard();
            renderCaminoStages();
            renderCaminoFavorites();
            setCaminoTab('routes');
            if (id && bundledCaminoTrack) displayCamino(id, bundledCaminoTrack);
        });
        $('camino-track-select').addEventListener('change', () => {
            renderCaminoDashboard();
        });
        populateCaminoList();
        loadCaminoFavorites();
        renderCaminoDashboard();
        renderCaminoStages();
        renderCaminoFavorites();

