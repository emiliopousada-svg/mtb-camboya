'use strict';

//  NAVEGACIÓN ENTRE PÁGINAS
// ============================================================
let currentPage = 0;
const pageHistory = [currentPage];
const swiper = $('swiper');
const navBtns = document.querySelectorAll('.nav-btn');

function renderPage(index) {
    currentPage = index;
    swiper.style.transform = `translateX(-${index * 100}vw)`;
    navBtns.forEach((btn, idx) => btn.classList.toggle('active', idx === index));
    if (index === 1 && statsNeedsRefresh) requestAnimationFrame(refreshStats);
    if (index === 2 && typeof loadGroupRankings === 'function') loadGroupRankings();
    if (index === 0 && map) setTimeout(() => map.invalidateSize(), 150);
    if (index === 4) {
        if (typeof renderAccount === 'function') renderAccount();
        openOfflineMaps();
    }
}

function goToPage(index) {
    if (!Number.isInteger(index) || index < 0 || index >= navBtns.length) {
        console.warn('Se ignoró una navegación a una pantalla no válida:', index);
        return;
    }
    if (index !== currentPage) {
        pageHistory.push(currentPage);
        if (pageHistory.length > 20) pageHistory.shift();
    }
    renderPage(index);
}

function goBackPage() {
    if (pageHistory.length <= 1) return false;
    pageHistory.pop();
    renderPage(pageHistory[pageHistory.length - 1]);
    return true;
}

// Android delega aquí el botón Atrás para navegar por las páginas antes de salir.
// Devolver true significa que la pulsación quedó atendida por la aplicación.
window.mtbHandleHardwareBack = function () {
    if (currentPage > 0) {
        goToPage(currentPage - 1);
        return true;
    }
    if (isRecording) {
        toast('La grabación sigue activa. Finalízala antes de salir de la aplicación.', 5000);
        return true;
    }
    return false;
};

// Deslizamiento táctil horizontal (no actúa sobre el mapa, gráficas ni diálogos)
let touchStartX = 0, touchStartY = 0, swipeBlocked = false, statsSwipeStart = false;

document.addEventListener('touchstart', e => {
    const t = e.target;
    statsSwipeStart = !!(t.closest && t.closest('#stats-carousel'));
    swipeBlocked = statsSwipeStart
        ? !!(t.closest && t.closest('button, input, select, canvas, .stats-route-map, .leaflet-container'))
        : !!(t.closest && t.closest('#map, .leaflet-container, canvas, input, select, #modal, #activity-picker'));
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
}, { passive: true });

document.addEventListener('touchend', e => {
    if (swipeBlocked) return;
    const diffX = touchStartX - e.changedTouches[0].screenX;
    const diffY = touchStartY - e.changedTouches[0].screenY;
    if (Math.abs(diffX) > 70 && Math.abs(diffY) < 60) {
        if (statsSwipeStart && currentPage === 1) {
            if (diffX > 0 && activeStatsSlide < 5) setStatsSlide(activeStatsSlide + 1);
            else if (diffX < 0 && activeStatsSlide > 0) setStatsSlide(activeStatsSlide - 1);
            return;
        }
        if (diffX > 0 && currentPage < 4) goToPage(currentPage + 1);
        else if (diffX < 0 && currentPage > 0) goToPage(currentPage - 1);
    }
}, { passive: true });

// ============================================================
