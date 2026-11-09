'use strict';

// ============================================================
//  CONFIGURACIÓN
// ============================================================
const APP_VERSION = '1.2.0'; // La compilación APK reemplaza esta versión por la del paquete.
const DEFAULT_CLOUD_SERVER = 'https://vamp69.ddns.net';
const MIN_STEP_M = 4;        // distancia mínima entre puntos grabados (filtra el ruido parado)
const MAX_ACC_M = 30;        // se descartan fixes con peor precisión que esto
const MAX_SPEED_MS = 25;     // 90 km/h: por encima es un salto de GPS
const AUTO_PAUSE_AFTER_MS = 10000;
const AUTO_PAUSE_MAX_ACCURACY_M = 20;
const ELEV_STEP = 3;         // metros mínimos para contar una subida
const OFFROUTE_M = 60;       // aviso de desvío
const BACKONROUTE_M = 30;    // se considera que has vuelto a la ruta
const ACTIVITY_TYPES = {
    mtb: { label: 'MTB', icon: '🚵' },
    road: { label: 'Carretera', icon: '🚴' },
    hiking: { label: 'Senderismo', icon: '🥾' },
    running: { label: 'Correr', icon: '🏃' },
    walking: { label: 'Paseo', icon: '🚶' }
};

// ============================================================
//  UTILIDADES
// ============================================================
const $ = id => document.getElementById(id);

function dist(a, b) { // metros entre [lat, lon] y [lat, lon]
    const R = 6371000, r = Math.PI / 180;
    const dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
    const s = Math.sin(dLat / 2) ** 2 +
              Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
}

function activityTypeFromName(name) {
    const value = String(name || '');
    for (const [type, activity] of Object.entries(ACTIVITY_TYPES)) {
        if (value.startsWith(`${activity.icon} ${activity.label} · `)) return type;
    }
    return null;
}

function activityTypeForRoute(route) {
    if (!route || typeof route !== 'object') return null;
    return Object.prototype.hasOwnProperty.call(ACTIVITY_TYPES, route.activityType)
        ? route.activityType
        : activityTypeFromName(route.name);
}

function routeActivityPrefix(type) {
    const activity = ACTIVITY_TYPES[type];
    return activity ? `${activity.icon} ${activity.label} · ` : '';
}

function routeNameWithoutActivity(route) {
    if (!route || typeof route !== 'object') return '';
    const name = String(route.name ?? '');
    const type = activityTypeForRoute(route);
    const prefix = type ? routeActivityPrefix(type) : '';
    return prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

async function promptRequiredRouteName(suggestion) {
    while (true) {
        const value = await modal({
            message: 'Escribe un nombre para esta ruta (obligatorio):',
            input: suggestion || '',
            ok: 'Guardar'
        });
        if (value === null) return null;
        const name = value.trim().slice(0, 80);
        if (name) return name;
        toast('El nombre de la ruta no puede estar vacío.');
    }
}

function fmtClock(sec) {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const p = n => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}
function fmtDur(sec) {
    return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}
function fmtDate(iso) {
    return new Date(iso).toLocaleDateString('es-ES');
}
function xmlEsc(s) {
    return String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

let toastTimer = null;
function toast(msg, ms = 3500) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// Diálogo propio (sustituye a confirm/prompt). Con `input` devuelve texto o null.
function modal({ message, input = null, ok = 'Aceptar', cancel = 'Cancelar' }) {
    return new Promise(resolve => {
        const m = $('modal'), inp = $('modal-input'), bOk = $('modal-ok'), bCancel = $('modal-cancel');
        $('modal-msg').textContent = message;
        inp.style.display = input !== null ? 'block' : 'none';
        if (input !== null) inp.value = input;
        bOk.textContent = ok;
        bCancel.textContent = cancel;
        m.classList.add('show');
        if (input !== null) setTimeout(() => { inp.focus(); inp.select(); }, 50);

        const done = v => {
            m.classList.remove('show');
            bOk.onclick = bCancel.onclick = inp.onkeydown = null;
            resolve(v);
        };
        bOk.onclick = () => done(input !== null ? inp.value : true);
        bCancel.onclick = () => done(input !== null ? null : false);
        inp.onkeydown = e => { if (e.key === 'Enter') bOk.click(); };
    });
}

async function download(name, text, mime) {
    // Dentro del APK (Capacitor) las descargas por enlace no funcionan: se comparte el archivo
    const cap = window.Capacitor;
    if (cap && cap.isNativePlatform && cap.isNativePlatform() && cap.Plugins && cap.Plugins.Filesystem && cap.Plugins.Share) {
        try {
            const res = await cap.Plugins.Filesystem.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
            await cap.Plugins.Share.share({ title: name, url: res.uri, dialogTitle: 'Guardar o compartir' });
            return;
        } catch (e) {
            if (e && /cancel/i.test(String(e.message || e))) return;
            console.warn('Compartir falló, probando descarga normal:', e);
        }
    }
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ============================================================
