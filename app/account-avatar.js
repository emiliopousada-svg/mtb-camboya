'use strict';

const ACCOUNT_AVATAR_MAX_BYTES = 256 * 1024;
const ACCOUNT_AVATAR_MAX_INPUT_BYTES = 20 * 1024 * 1024;
const ACCOUNT_AVATAR_CACHE_PREFIX = 'mtb_avatar_';
const ACCOUNT_AVATAR_PENDING_PREFIX = 'mtb_avatar_pending_';
const ACCOUNT_AVATAR_REMOTE_PREFIX = 'mtb_avatar_remote_';
let accountAvatarPreviewUrl = '';
let accountProfileLoadedUid = '';

function accountAvatarKey(uid) { return `${ACCOUNT_AVATAR_CACHE_PREFIX}${uid}`; }
function accountAvatarPendingKey(uid) { return `${ACCOUNT_AVATAR_PENDING_PREFIX}${uid}`; }
function resetAccountProfileCache() { accountProfileLoadedUid = ''; }

function getAccountAvatarUrl() {
    const uid = Cloud.uid || localStorage.getItem('mtb_avatar_last_uid') || '';
    if (!uid) return '';
    try { return localStorage.getItem(accountAvatarKey(uid)) || ''; }
    catch (error) { return ''; }
}

function renderAccountAvatar() {
    const image = $('acc-avatar-image');
    const placeholder = $('acc-avatar-placeholder');
    if (image && placeholder) {
        const src = getAccountAvatarUrl();
        image.src = src || '';
        image.hidden = !src;
        placeholder.hidden = !!src;
    }
    if (typeof updateGpsAvatarMarkers === 'function') updateGpsAvatarMarkers();
}

function accountAvatarToJpeg(file) {
    return new Promise((resolve, reject) => {
        if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > ACCOUNT_AVATAR_MAX_INPUT_BYTES) {
            reject(new Error('Elige una imagen JPEG, PNG o WebP de hasta 20 MB.'));
            return;
        }
        createImageBitmap(file).then(image => {
            try {
                const scale = Math.min(1, 512 / Math.max(image.width, image.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(image.width * scale));
                canvas.height = Math.max(1, Math.round(image.height * scale));
                const context = canvas.getContext('2d');
                if (!context) throw new Error('No se pudo preparar el avatar.');
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                const encode = quality => new Promise((res, rej) => canvas.toBlob(blob => blob ? res(blob) : rej(new Error('No se pudo preparar el avatar.')), 'image/jpeg', quality));
                (async () => {
                    for (const quality of [0.86, 0.72, 0.58, 0.45]) {
                        const blob = await encode(quality);
                        if (blob.size <= ACCOUNT_AVATAR_MAX_BYTES) return blob;
                    }
                    throw new Error('La imagen no se pudo comprimir por debajo de 256 KB.');
                })().then(resolve, reject);
            } catch (error) { reject(error); }
            finally { image.close(); }
        }, reject);
    });
}

function accountAvatarDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('No se pudo guardar el avatar en este teléfono.'));
        reader.readAsDataURL(blob);
    });
}

async function syncPendingAccountAvatar(record = null) {
    const uid = Cloud.uid;
    if (!uid || !navigator.onLine) return;
    const key = accountAvatarPendingKey(uid);
    const pendingValue = localStorage.getItem(key);
    if (!pendingValue) {
        if (record) await cacheRemoteAccountAvatar(record);
        return;
    }
    let pending;
    try { pending = JSON.parse(pendingValue); }
    catch (error) { pending = { avatar: pendingValue }; }
    const form = new FormData();
    if (pending.avatar) {
        const blob = await (await fetch(pending.avatar)).blob();
        form.append('avatar', blob, 'avatar.jpg');
    }
    if (pending.weightKg !== undefined && pending.weightKg !== '') form.append('weightKg', pending.weightKg);
    if (pending.age !== undefined && pending.age !== '') form.append('age', pending.age);
    const updated = await cloudApi(`/api/collections/users/records/${encodeURIComponent(uid)}`, 'PATCH', form);
    localStorage.removeItem(key);
    if (updated && updated.avatar) localStorage.setItem(`${ACCOUNT_AVATAR_REMOTE_PREFIX}${uid}`, updated.avatar);
    if (updated) renderAccountProfile(updated, true);
}

function renderAccountProfile(record = {}, force = false) {
    const uid = Cloud.uid;
    if (!uid || !record || (!Object.prototype.hasOwnProperty.call(record, 'weightKg') && !Object.prototype.hasOwnProperty.call(record, 'age'))) return;
    if (!force && accountProfileLoadedUid === uid) return;
    const weight = $('acc-profile-weight');
    const age = $('acc-profile-age');
    if (weight && document.activeElement !== weight) weight.value = record.weightKg ?? '';
    if (age && document.activeElement !== age) age.value = record.age ?? '';
    if (typeof statsApplyAccountProfile === 'function') {
        statsApplyAccountProfile(record.weightKg, record.age);
    }
    accountProfileLoadedUid = uid;
}

async function cacheRemoteAccountAvatar(record) {
    const uid = Cloud.uid;
    if (!uid || !record) return;
    localStorage.setItem('mtb_avatar_last_uid', uid);
    const remoteName = String(record.avatar || '');
    const remoteKey = `${ACCOUNT_AVATAR_REMOTE_PREFIX}${uid}`;
    if (!remoteName) {
        if (localStorage.getItem(remoteKey)) localStorage.removeItem(accountAvatarKey(uid));
        localStorage.removeItem(remoteKey);
        renderAccountAvatar();
        return;
    }
    if (localStorage.getItem(remoteKey) === remoteName && localStorage.getItem(accountAvatarKey(uid))) return;
    const url = `${Cloud.server}/api/files/users/${encodeURIComponent(uid)}/${encodeURIComponent(remoteName)}?thumb=256x256`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('No se pudo descargar el avatar de la cuenta.');
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) throw new Error('El servidor devolvió un archivo de avatar no válido.');
    localStorage.setItem(accountAvatarKey(uid), await accountAvatarDataUrl(blob));
    localStorage.setItem(remoteKey, remoteName);
    renderAccountAvatar();
}

function initAccountAvatar() {
    const input = $('acc-avatar-file');
    const save = $('acc-profile-save');
    const cancel = $('acc-profile-cancel');
    if (!input || !save) return;
    renderAccountAvatar();
    input.addEventListener('change', () => {
        if (accountAvatarPreviewUrl) URL.revokeObjectURL(accountAvatarPreviewUrl);
        accountAvatarPreviewUrl = input.files && input.files[0] ? URL.createObjectURL(input.files[0]) : '';
        if (accountAvatarPreviewUrl) {
            $('acc-avatar-image').src = accountAvatarPreviewUrl;
            $('acc-avatar-image').hidden = false;
            $('acc-avatar-placeholder').hidden = true;
        } else renderAccountAvatar();
    });
    if (cancel) cancel.addEventListener('click', () => {
        input.value = '';
        if (accountAvatarPreviewUrl) URL.revokeObjectURL(accountAvatarPreviewUrl);
        accountAvatarPreviewUrl = '';
        renderAccountAvatar();
    });
    save.addEventListener('click', async () => {
        const file = input.files && input.files[0];
        const weightInput = $('acc-profile-weight');
        const ageInput = $('acc-profile-age');
        const weight = weightInput.value.trim();
        const age = ageInput.value.trim();
        if (weight && (!Number.isFinite(Number(weight)) || Number(weight) < 25 || Number(weight) > 250)) { toast('El peso debe estar entre 25 y 250 kg.'); return; }
        if (age && (!Number.isInteger(Number(age)) || Number(age) < 10 || Number(age) > 100)) { toast('La edad debe estar entre 10 y 100 años.'); return; }
        save.disabled = true;
        try {
            const dataUrl = file ? await accountAvatarDataUrl(await accountAvatarToJpeg(file)) : '';
            const uid = Cloud.uid;
            if (!uid) throw new Error('Inicia sesión para guardar el avatar.');
            if (dataUrl) localStorage.setItem(accountAvatarKey(uid), dataUrl);
            localStorage.setItem('mtb_avatar_last_uid', uid);
            localStorage.setItem(accountAvatarPendingKey(uid), JSON.stringify({ avatar: dataUrl, weightKg: weight, age }));
            if (typeof statsApplyAccountProfile === 'function') {
                statsApplyAccountProfile(weight, age);
            }
            renderAccountAvatar();
            input.value = '';
            if (accountAvatarPreviewUrl) URL.revokeObjectURL(accountAvatarPreviewUrl);
            accountAvatarPreviewUrl = '';
            if (navigator.onLine) {
                try {
                    await syncPendingAccountAvatar();
                    toast(dataUrl ? 'Perfil y avatar guardados en este teléfono y sincronizados.' : 'Perfil guardado y sincronizado con tu cuenta.');
                } catch (error) {
                    console.warn('Avatar guardado localmente; queda pendiente de sincronización:', error);
                    toast('Perfil guardado en este teléfono; se sincronizará cuando haya conexión.');
                }
            } else toast('Perfil guardado en este teléfono; se sincronizará cuando haya conexión.');
        } catch (error) {
            console.warn('No se pudo guardar el avatar:', error);
            toast(error.message || 'No se pudo guardar el avatar.');
        } finally { save.disabled = false; }
    });
}
