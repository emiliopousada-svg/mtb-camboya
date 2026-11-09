'use strict';

//  NAVEGACIÓN ENTRE PÁGINAS
// ============================================================
let currentPage = 0;
const swiper = $('swiper');
const navBtns = document.querySelectorAll('.nav-btn');

function goToPage(index) {
    currentPage = index;
    swiper.style.transform = `translateX(-${index * 100}vw)`;
    navBtns.forEach((btn, idx) => btn.classList.toggle('active', idx === index));
    if (index === 0 && map) setTimeout(() => map.invalidateSize(), 150);
    if (index === 4) openOfflineMaps();
}

// Deslizamiento táctil horizontal (no actúa sobre el mapa, gráficas ni diálogos)
let touchStartX = 0, touchStartY = 0, swipeBlocked = false;

document.addEventListener('touchstart', e => {
    const t = e.target;
    swipeBlocked = !!(t.closest && t.closest('#map, canvas, input, select, #modal, #activity-picker'));
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
}, { passive: true });

document.addEventListener('touchend', e => {
    if (swipeBlocked) return;
    const diffX = touchStartX - e.changedTouches[0].screenX;
    const diffY = touchStartY - e.changedTouches[0].screenY;
    if (Math.abs(diffX) > 70 && Math.abs(diffY) < 60) {
        if (diffX > 0 && currentPage < 4) goToPage(currentPage + 1);
        else if (diffX < 0 && currentPage > 0) goToPage(currentPage - 1);
    }
}, { passive: true });

// ============================================================
