'use strict';

function handleAppBack() {
    const dimOverlay = $('screen-dim-overlay');
    if (dimOverlay && !dimOverlay.hidden) {
        screenWakeNow();
        return true;
    }

    if (activityPickerOpen) {
        finishActivityPicker(null);
        return true;
    }

    const modalDialog = $('modal');
    if (modalDialog && modalDialog.classList.contains('show')) {
        $('modal-cancel').click();
        return true;
    }

    if (typeof handleCommunityBackButton === 'function' && handleCommunityBackButton()) return true;
    if (currentPage === 3 && routesTab !== 'done') {
        setRoutesTab('done');
        return true;
    }
    if (currentPage === 3 && routesShowAll) {
        routesShowAll = false;
        renderSavedRoutes();
        return true;
    }
    return goBackPage();
}

function initNativeBackButton() {
    const capacitor = window.Capacitor;
    if (!capacitor || typeof capacitor.isNativePlatform !== 'function'
        || !capacitor.isNativePlatform() || !window.MTBNativeApp) return;

    window.MTBNativeApp.addBackButtonListener(async event => {
        if (handleAppBack()) return;
        if (event.canGoBack) {
            window.history.back();
            return;
        }
        try {
            await window.MTBNativeApp.exitApp();
        } catch (error) {
            console.warn('No se pudo cerrar la aplicación:', error);
            toast('No se pudo cerrar la aplicación.', 4000);
        }
    }).catch(error => {
        console.warn('No se pudo activar el botón de retroceso de Android:', error);
    });
}

initNativeBackButton();
