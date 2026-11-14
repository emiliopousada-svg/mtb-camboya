'use strict';

// Social interactions for public community routes.

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
        const response = await cloudApi(`/api/collections/community_route_comments/records?page=1&perPage=100&sort=-id&fields=id,owner,alias,comment&filter=${encodeURIComponent(filter)}`);
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
