'use strict';

// Segment selection, publication, and rankings.

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
            'community_segments', filter, 'id,owner,route,title,trackJson,distanceKm', '-id'
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
