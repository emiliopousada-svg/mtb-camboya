'use strict';

// Public performance rankings and submission UI.

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
    // El nombre público es el apodo único de la cuenta; el servidor lo impone en comentarios y marcas.
    const alias = String(Cloud.nickname || '').trim().slice(0, 32);
    if (!alias) {
        toast('Añade un apodo a tu cuenta (Ajustes → Cuenta) para publicar en la comunidad.');
        return null;
    }
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
        const container = relationField === 'route' ? $('community-route-leaderboard') : null;
        if (container) communityLoadRanking(record, collection, relationField, container);
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
