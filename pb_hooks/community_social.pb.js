// Fija en el servidor el alias público de los comentarios de rutas, igual que ya se hace con
// las marcas en community_performance.pb.js: el cliente no puede publicar con el nombre de otra
// persona porque el alias se deriva siempre del id de la cuenta autenticada.
// El handler es autosuficiente porque PocketBase ejecuta cada handler en un runtime aislado.
const normalizeCommunityComment = (e) => {
    if (e.hasSuperuserAuth()) return e.next();
    if (!e.auth) throw new BadRequestError("Inicia sesión para comentar.");
    if (e.record.getString("owner") !== e.auth.id) {
        throw new BadRequestError("El propietario del comentario no coincide con la sesión.");
    }
    e.record.set("alias", "Ciclista " + e.auth.id.toUpperCase());
    e.next();
};

onRecordCreateRequest(normalizeCommunityComment, "community_route_comments");
onRecordUpdateRequest(normalizeCommunityComment, "community_route_comments");
