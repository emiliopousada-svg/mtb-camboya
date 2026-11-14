// Keeps each public account nickname unique and stable once selected.
const validateUserNickname = (e) => {
    if (e.hasSuperuserAuth()) return e.next();

    const isNew = e.record.isNew();
    const originalNickname = isNew ? "" : e.record.original().getString("nickname");
    const nickname = e.record.getString("nickname").trim().replace(/\s+/g, " ");

    if (!isNew && originalNickname && nickname !== originalNickname) {
        throw new BadRequestError("El apodo no se puede cambiar una vez elegido.");
    }
    if (nickname.length > 32) throw new BadRequestError("El apodo no puede superar los 32 caracteres.");

    // Existing or legacy accounts without a nickname remain valid; unrelated profile updates
    // do not query or rewrite the nickname.
    if (nickname === originalNickname) return e.next();
    if (!nickname) return e.next();

    const matches = $app.findRecordsByFilter(
        "users",
        "id != {:id} && nickname:lower = {:nickname}",
        "",
        1,
        0,
        { id: e.record.id, nickname: nickname.toLowerCase() }
    );
    if (matches.length) throw new BadRequestError("Ese apodo ya está en uso.");

    e.record.set("nickname", nickname);
    e.next();
};

onRecordCreateRequest(validateUserNickname, "users");
onRecordUpdateRequest(validateUserNickname, "users");
