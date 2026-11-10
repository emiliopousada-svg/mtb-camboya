'use strict';

const SCREEN_IDLE_DELAY_MS = 5 * 60 * 1000;
let screenIdleTimer = null;
let screenWakeLock = null;
let screenWakeRequest = null;
let screenDimmed = false;
let screenWakeWarningShown = false;

function screenControlPlugin() {
    const cap = window.Capacitor;
    if (!(cap && cap.isNativePlatform && cap.isNativePlatform())) return null;
    return cap.Plugins && cap.Plugins.ScreenControl || null;
}

function screenSetDimmed(dimmed) {
    const overlay = $('screen-dim-overlay');
    if (!overlay || screenDimmed === dimmed) return;
    screenDimmed = dimmed;
    const plugin = screenControlPlugin();
    overlay.classList.toggle('screen-dim-native', !!plugin);
    overlay.classList.toggle('screen-dim-fallback', !plugin);
    overlay.hidden = !dimmed;
    document.body.classList.toggle('screen-dimmed', dimmed);

    if (plugin) {
        const action = dimmed ? 'dim' : 'wake';
        if (typeof plugin[action] !== 'function') {
            overlay.classList.remove('screen-dim-native');
            overlay.classList.add('screen-dim-fallback');
            console.warn(`El control nativo no ofrece la acción «${action}».`);
            return;
        }
        try {
            plugin[action]().catch(error => {
                console.warn(`No se pudo ${dimmed ? 'atenuar' : 'restaurar'} el brillo de la pantalla:`, error);
                overlay.classList.remove('screen-dim-native');
                overlay.classList.add('screen-dim-fallback');
            });
        } catch (error) {
            console.warn(`No se pudo ${dimmed ? 'atenuar' : 'restaurar'} el brillo de la pantalla:`, error);
            overlay.classList.remove('screen-dim-native');
            overlay.classList.add('screen-dim-fallback');
        }
    }
}

async function screenEnsureAwake() {
    if (document.visibilityState === 'hidden' || screenControlPlugin()) return;
    if (!('wakeLock' in navigator) || screenWakeLock || screenWakeRequest) {
        if (!('wakeLock' in navigator) && !screenWakeWarningShown) {
            screenWakeWarningShown = true;
            console.warn('Este navegador no permite mantener activa la pantalla.');
            toast('Este dispositivo puede apagar la pantalla automáticamente.', 6000);
        }
        return;
    }

    try {
        screenWakeRequest = navigator.wakeLock.request('screen');
        screenWakeLock = await screenWakeRequest;
        screenWakeLock.addEventListener('release', () => { screenWakeLock = null; });
    } catch (error) {
        console.warn('No se pudo mantener activa la pantalla:', error);
        if (!screenWakeWarningShown) {
            screenWakeWarningShown = true;
            toast('No se pudo mantener activa la pantalla; el dispositivo podría apagarla.', 6000);
        }
    } finally {
        screenWakeRequest = null;
    }
}

function screenReleaseWakeLock() {
    if (!screenWakeLock) return;
    const lock = screenWakeLock;
    screenWakeLock = null;
    lock.release().catch(error => console.warn('No se pudo liberar el bloqueo de pantalla:', error));
}

function screenScheduleDim() {
    clearTimeout(screenIdleTimer);
    screenIdleTimer = null;
    if (document.visibilityState === 'hidden') return;
    screenIdleTimer = setTimeout(() => screenSetDimmed(true), SCREEN_IDLE_DELAY_MS);
}

function screenWakeNow() {
    screenSetDimmed(false);
    screenEnsureAwake();
    screenScheduleDim();
}

function initScreenActivity() {
    const overlay = $('screen-dim-overlay');
    if (!overlay) return;
    const wakeFromOverlay = event => {
        event.preventDefault();
        event.stopPropagation();
        screenWakeNow();
    };
    overlay.addEventListener('pointerdown', wakeFromOverlay);
    overlay.addEventListener('click', wakeFromOverlay);
    document.addEventListener('pointerdown', () => {
        screenEnsureAwake();
        screenScheduleDim();
    }, { passive: true });
    document.addEventListener('keydown', () => {
        if (screenDimmed) screenWakeNow();
        else screenScheduleDim();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            clearTimeout(screenIdleTimer);
            screenIdleTimer = null;
            screenSetDimmed(false);
            screenReleaseWakeLock();
        } else {
            screenEnsureAwake();
            screenScheduleDim();
        }
    });
    window.addEventListener('pageshow', () => {
        screenEnsureAwake();
        screenScheduleDim();
    });
    screenEnsureAwake();
    screenScheduleDim();
}

initScreenActivity();
