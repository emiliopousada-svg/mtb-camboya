'use strict';

//  ESTADÍSTICAS Y GRÁFICAS
// ============================================================

function startOfWeek(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // lunes
    return x;
}

function refreshStats() {
    const now = new Date();
    let from, when;
    if (statsPeriod === 'semanal') { from = startOfWeek(now); when = 'esta semana'; }
    else if (statsPeriod === 'mensual') { from = new Date(now.getFullYear(), now.getMonth(), 1); when = 'este mes'; }
    else { from = new Date(now.getFullYear(), 0, 1); when = 'este año'; }
    const rides = savedRoutes.filter(r => r.kind !== 'imported' && new Date(r.startedAt) >= from);

    const km = rides.reduce((a, r) => a + r.distanceKm, 0);
    const sec = rides.reduce((a, r) => a + (r.movingTimeSec || 0), 0);
    const gain = rides.reduce((a, r) => a + (r.elevationGain || 0), 0);

    $('st-vel').textContent = (sec > 0 ? km / (sec / 3600) : 0).toFixed(1) + ' km/h';
    $('st-dist').textContent = km.toFixed(1) + ' km';
    $('st-time').textContent = fmtDur(sec);
    $('st-desnivel').textContent = '+' + Math.round(gain) + ' m';
    $('st-rutas').textContent = rides.length + (rides.length === 1 ? ' salida' : ' salidas');
    $('st-dist-lbl').textContent = 'Distancia ' + when;
    $('st-time-lbl').textContent = 'Tiempo ' + when;

    let labels, buckets;
    if (statsPeriod === 'semanal') {
        labels = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
        buckets = Array(7).fill(0);
        rides.forEach(r => { buckets[(new Date(r.startedAt).getDay() + 6) % 7] += r.distanceKm; });
    } else if (statsPeriod === 'mensual') {
        const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const n = Math.ceil(days / 7);
        labels = Array.from({ length: n }, (_, i) => 'S' + (i + 1));
        buckets = Array(n).fill(0);
        rides.forEach(r => { buckets[Math.floor((new Date(r.startedAt).getDate() - 1) / 7)] += r.distanceKm; });
    } else {
        labels = ['E', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
        buckets = Array(12).fill(0);
        rides.forEach(r => { buckets[new Date(r.startedAt).getMonth()] += r.distanceKm; });
    }
    if (statsChart) {
        statsChart.data.labels = labels;
        statsChart.data.datasets[0].data = buckets.map(v => +v.toFixed(2));
        statsChart.update();
    }
}

function setStatsPeriod(periodo, element) {
    element.parentElement.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
    element.classList.add('active');
    statsPeriod = periodo;
    refreshStats();
}

function initCharts() {
    if (typeof Chart === 'undefined') return;
    const axis = { ticks: { color: '#b0b0b0', font: { size: 10 } }, grid: { color: '#2a2a2a' } };

    statsChart = new Chart($('statsChart').getContext('2d'), {
        type: 'bar',
        data: { labels: [], datasets: [{
            label: 'km', data: [],
            backgroundColor: 'rgba(46,125,50,0.7)', borderColor: '#2e7d32', borderWidth: 1, borderRadius: 4
        }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: axis, y: { ...axis, beginAtZero: true } }
        }
    });

}

// ============================================================
