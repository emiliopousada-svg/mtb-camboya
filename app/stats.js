'use strict';

//  ESTADÍSTICAS Y GRÁFICAS
// ============================================================
let statsProfileChart = null;
let statsEvolutionChart = null;
let statsAscentChart = null;
let statsSpeedChart = null;
let statsActivityChart = null;
let statsMtbSpeedChart = null;
let statsGradeChart = null;
let statsClimbTimeChart = null;
let statsVamChart = null;
let activeStatsSlide = 0;
let statsWeightKg = null;
let statsAge = null;
let statsHeartRateMax = null;
let statsPowerFtp = null;
let statsAnalysisCache = new WeakMap();

const STATS_PERIOD_LABELS = {
    today: 'hoy',
    weekly: 'esta semana',
    monthly: 'este mes',
    yearly: 'este año',
    all: 'todo el historial'
};
const STATS_MET_VALUES = { mtb: 6.8, road: 7.5, hiking: 5.3, running: 8, walking: 3.5, horse: 5.5 };
const STATS_HR_ZONES = [
    { label: 'Z1', min: 0.50, max: 0.60 },
    { label: 'Z2', min: 0.60, max: 0.70 },
    { label: 'Z3', min: 0.70, max: 0.80 },
    { label: 'Z4', min: 0.80, max: 0.90 },
    { label: 'Z5', min: 0.90, max: Infinity }
];
const STATS_POWER_ZONES = [
    { label: 'Z1', min: 0, max: 0.55 },
    { label: 'Z2', min: 0.55, max: 0.75 },
    { label: 'Z3', min: 0.75, max: 0.90 },
    { label: 'Z4', min: 0.90, max: 1.05 },
    { label: 'Z5', min: 1.05, max: 1.20 },
    { label: 'Z6', min: 1.20, max: 1.50 },
    { label: 'Z7', min: 1.50, max: Infinity }
];

function statsDate(value) {
    if (value == null) return NaN;
    const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isFinite(time) ? time : NaN;
}

function statsPeriodStart(period, value = new Date()) {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    if (period === 'today') return date;
    if (period === 'weekly') {
        date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
        return date;
    }
    if (period === 'monthly') return new Date(date.getFullYear(), date.getMonth(), 1);
    if (period === 'yearly') return new Date(date.getFullYear(), 0, 1);
    return null;
}

function statsRangeRides(period, source = savedRoutes) {
    const rides = source.filter(route => route && route.kind !== 'imported');
    const from = statsPeriodStart(period);
    if (!from) return rides;
    const now = Date.now();
    return rides.filter(route => {
        const time = statsDate(route.startedAt);
        return Number.isFinite(time) && time >= from.getTime() && time <= now;
    });
}

function statsAnalyzeRoute(route) {
    const cacheKey = `${statsHeartRateMax}|${statsPowerFtp}`;
    const cached = statsAnalysisCache.get(route);
    if (cached && cached.key === cacheKey) return cached.analysis;
    const analysis = MTBStatisticsEngine.analyzeRoute(route, {
        heartRateMax: statsHeartRateMax,
        hrZones: STATS_HR_ZONES,
        ftpWatts: statsPowerFtp,
        powerZones: STATS_POWER_ZONES
    });
    statsAnalysisCache.set(route, { key: cacheKey, analysis });
    return analysis;
}

function statsAggregate(analyses) {
    return MTBStatisticsEngine.aggregate(analyses);
}

function statsSetText(id, value) {
    const element = $(id);
    if (element) element.textContent = value;
}

function statsValue(value, digits = 1, unit = '') {
    return Number.isFinite(value) ? `${value.toFixed(digits)}${unit}` : '--';
}

function statsDescentValue(value) {
    return Number.isFinite(value) ? `${value > 0 ? '-' : ''}${Math.round(value)} m` : '--';
}

function statsRenderSummary(summary) {
    statsSetText('st-distance', `${summary.distanceKm.toFixed(1)} km`);
    statsSetText('st-moving-time', fmtDur(summary.movingTimeSec));
    statsSetText('st-total-time', summary.rideCount ? fmtDur(summary.elapsedTimeSec) : '--');
    statsSetText('st-ascent', summary.ascentSampleCount ? `+${Math.round(summary.ascentM)} m` : '--');
    statsSetText('st-descent', summary.descentSampleCount ? statsDescentValue(summary.descentM) : '--');
    statsSetText('st-average-speed', statsValue(summary.averageSpeed, 1, ' km/h'));
    statsSetText('st-max-speed', statsValue(summary.maxSpeed, 1, ' km/h'));
    statsSetText('st-stopped-time', summary.stoppedTimeSec > 0 ? fmtDur(summary.stoppedTimeSec) : (summary.rideCount ? '0h 0m' : '--'));
    statsSetText('st-ride-count', `${summary.rideCount} ${summary.rideCount === 1 ? 'salida' : 'salidas'}`);
    statsSetText('st-average-distance', statsValue(summary.averageDistance, 1, ' km'));
    statsSetText('st-average-duration', Number.isFinite(summary.averageDuration) ? fmtDur(summary.averageDuration) : '--');
    statsSetText('st-average-ascent', statsValue(summary.averageAscent, 0, ' m'));
}

function statsConfiguredNumber(id, min, max) {
    const value = Number($(id).value);
    return Number.isFinite(value) && value >= min && value <= max ? value : null;
}

function statsLoadPreferences() {
    try {
        statsWeightKg = Number(localStorage.getItem('mtb_stats_weight'));
        if (!Number.isFinite(statsWeightKg) || statsWeightKg < 25 || statsWeightKg > 250) statsWeightKg = null;
        statsAge = Number(localStorage.getItem('mtb_stats_age'));
        if (!Number.isFinite(statsAge) || statsAge < 10 || statsAge > 100) statsAge = null;
        statsHeartRateMax = statsAge === null ? Number(localStorage.getItem('mtb_stats_hr_max')) : 220 - statsAge;
        if (!Number.isFinite(statsHeartRateMax) || statsHeartRateMax < 100 || statsHeartRateMax > 240) statsHeartRateMax = null;
        statsPowerFtp = Number(localStorage.getItem('mtb_stats_ftp'));
        if (!Number.isFinite(statsPowerFtp) || statsPowerFtp < 50 || statsPowerFtp > 800) statsPowerFtp = null;
    } catch (error) {
        console.warn('No se pudieron leer las preferencias de estadísticas:', error);
        statsWeightKg = null;
        statsHeartRateMax = null;
        statsPowerFtp = null;
    }
    $('stats-weight').textContent = statsWeightKg === null ? 'Sin configurar' : `${statsWeightKg} kg`;
    $('stats-age').textContent = statsAge === null ? 'Sin configurar' : `${statsAge} años`;
    $('stats-hr-max-config').value = statsHeartRateMax ?? '';
    $('stats-power-ftp').value = statsPowerFtp ?? '';
}

function statsSavePreferences(ageChanged = false) {
    if (statsAge !== null) statsHeartRateMax = 220 - statsAge;
    else if (ageChanged) statsHeartRateMax = null;
    statsPowerFtp = statsConfiguredNumber('stats-power-ftp', 50, 800);
    $('stats-hr-max-config').value = statsHeartRateMax ?? '';
    try {
        if (statsWeightKg === null) localStorage.removeItem('mtb_stats_weight');
        else localStorage.setItem('mtb_stats_weight', String(statsWeightKg));
        if (statsAge === null) localStorage.removeItem('mtb_stats_age');
        else localStorage.setItem('mtb_stats_age', String(statsAge));
        if (statsHeartRateMax === null) localStorage.removeItem('mtb_stats_hr_max');
        else localStorage.setItem('mtb_stats_hr_max', String(statsHeartRateMax));
        if (statsPowerFtp === null) localStorage.removeItem('mtb_stats_ftp');
        else localStorage.setItem('mtb_stats_ftp', String(statsPowerFtp));
    } catch (error) {
        console.warn('No se pudieron guardar las preferencias de estadísticas:', error);
        toast('No se pudieron guardar los valores de peso, frecuencia cardíaca y FTP.');
    }
    statsAnalysisCache = new WeakMap();
    refreshStats();
}

function statsApplyAccountProfile(weightKg, age) {
    const weight = Number(weightKg);
    const years = Number(age);
    const validWeight = Number.isFinite(weight) && weight >= 25 && weight <= 250;
    const validAge = Number.isFinite(years) && years >= 10 && years <= 100;
    if ((!validWeight || statsWeightKg === weight) && (!validAge || statsAge === years)) return;
    if (validWeight) statsWeightKg = weight;
    if (validAge) statsAge = years;
    $('stats-weight').textContent = statsWeightKg === null ? 'Sin configurar' : `${statsWeightKg} kg`;
    $('stats-age').textContent = statsAge === null ? 'Sin configurar' : `${statsAge} años`;
    statsSavePreferences(validAge);
}

function statsRenderPerformance(summary, analyses) {
    statsSetText('st-hr-average', Number.isFinite(summary.averageHr) ? `${Math.round(summary.averageHr)} lpm` : 'Sin datos');
    statsSetText('st-hr-max', Number.isFinite(summary.maxHr) ? `${Math.round(summary.maxHr)} lpm` : 'Sin datos');
    statsSetText('st-cadence-average', Number.isFinite(summary.averageCadence) ? `${Math.round(summary.averageCadence)} rpm` : 'Sin datos');
    statsSetText('st-cadence-max', Number.isFinite(summary.maxCadence) ? `${Math.round(summary.maxCadence)} rpm` : 'Sin datos');
    statsSetText('st-power-average', Number.isFinite(summary.averagePower) ? `${Math.round(summary.averagePower)} W` : 'Sin datos');
    statsSetText('st-power-max', Number.isFinite(summary.maxPower) ? `${Math.round(summary.maxPower)} W` : 'Sin datos');

    if (statsWeightKg === null) {
        statsSetText('st-calories', 'Configura peso');
    } else {
        const calories = analyses.reduce((total, item) => {
            const met = STATS_MET_VALUES[activityTypeForRoute(item.route)];
            return total + (Number.isFinite(met) ? met * statsWeightKg * item.movingTimeSec / 3600 : 0);
        }, 0);
        statsSetText('st-calories', analyses.length ? `≈${Math.round(calories)} kcal` : '--');
    }

    const zonesContainer = $('stats-hr-zones');
    zonesContainer.replaceChildren();
    const measuredSeconds = Number.isFinite(summary.zoneMeasuredSeconds)
        ? Math.max(0, summary.zoneMeasuredSeconds)
        : 0;
    STATS_HR_ZONES.forEach((zone, index) => {
        const zoneSeconds = Array.isArray(summary.zoneSeconds) && Number.isFinite(summary.zoneSeconds[index])
            ? Math.max(0, summary.zoneSeconds[index])
            : 0;
        const row = document.createElement('div');
        row.className = 'stats-zone';
        const title = document.createElement('span');
        title.textContent = zone.label;
        const range = document.createElement('span');
        range.textContent = statsHeartRateMax
            ? `${Math.round(statsHeartRateMax * zone.min)}–${Math.min(240, Math.round(statsHeartRateMax * zone.max))} lpm`
            : `${Math.round(zone.min * 100)}–${Math.round(Math.min(zone.max, 1) * 100)}%`;
        const value = statsHeartRateMax
            ? fmtDur(zoneSeconds)
            : (measuredSeconds ? 'Configura FC máxima' : 'Sin datos');
        const progress = document.createElement('progress');
        progress.max = measuredSeconds || 1;
        progress.value = statsHeartRateMax ? zoneSeconds : 0;
        progress.setAttribute('aria-label', `${zone.label}: ${value}`);
        row.append(title, range, progress);
        const time = document.createElement('span');
        time.textContent = value;
        row.appendChild(time);
        zonesContainer.appendChild(row);
    });
    const zoneTotal = Array.isArray(summary.zoneSeconds)
        ? summary.zoneSeconds.reduce((total, seconds) => total + (Number.isFinite(seconds) ? Math.max(0, seconds) : 0), 0)
        : 0;
    statsSetText('stats-effort-time', statsHeartRateMax
        ? `Tiempo en zonas de esfuerzo con datos de sensor: ${zoneTotal ? fmtDur(zoneTotal) : 'Sin datos'}`
        : 'Configura tu frecuencia cardíaca máxima para calcular las zonas.');

    const powerZonesContainer = $('stats-power-zones');
    powerZonesContainer.replaceChildren();
    const powerMeasuredSeconds = Number.isFinite(summary.powerZoneMeasuredSeconds)
        ? Math.max(0, summary.powerZoneMeasuredSeconds)
        : 0;
    STATS_POWER_ZONES.forEach((zone, index) => {
        const zoneSeconds = Array.isArray(summary.powerZoneSeconds) && Number.isFinite(summary.powerZoneSeconds[index])
            ? Math.max(0, summary.powerZoneSeconds[index])
            : 0;
        const row = document.createElement('div');
        row.className = 'stats-zone';
        const title = document.createElement('span');
        title.textContent = zone.label;
        const range = document.createElement('span');
        if (statsPowerFtp) {
            range.textContent = zone.min === 0
                ? `≤${Math.round(statsPowerFtp * zone.max)} W`
                : (Number.isFinite(zone.max)
                    ? `${Math.round(statsPowerFtp * zone.min)}–${Math.round(statsPowerFtp * zone.max)} W`
                    : `>${Math.round(statsPowerFtp * zone.min)} W`);
        } else {
            range.textContent = zone.min === 0
                ? `≤${Math.round(zone.max * 100)}%`
                : (Number.isFinite(zone.max)
                    ? `${Math.round(zone.min * 100)}–${Math.round(zone.max * 100)}%`
                    : `>${Math.round(zone.min * 100)}%`);
        }
        const value = statsPowerFtp
            ? fmtDur(zoneSeconds)
            : (powerMeasuredSeconds ? 'Configura FTP' : 'Sin datos');
        const progress = document.createElement('progress');
        progress.max = powerMeasuredSeconds || 1;
        progress.value = statsPowerFtp ? zoneSeconds : 0;
        progress.setAttribute('aria-label', `${zone.label}: ${value}`);
        row.append(title, range, progress);
        const time = document.createElement('span');
        time.textContent = value;
        row.appendChild(time);
        powerZonesContainer.appendChild(row);
    });
    const powerZoneTotal = Array.isArray(summary.powerZoneSeconds)
        ? summary.powerZoneSeconds.reduce((total, seconds) => total + (Number.isFinite(seconds) ? Math.max(0, seconds) : 0), 0)
        : 0;
    statsSetText('stats-power-zone-time', statsPowerFtp
        ? `Tiempo en zonas de potencia: ${powerZoneTotal ? fmtDur(powerZoneTotal) : 'Sin datos de sensor'}`
        : (powerMeasuredSeconds
            ? 'Configura tu FTP para calcular el tiempo en zonas.'
            : 'No hay intervalos de potencia registrados.'));
}

function statsRenderMtb(summary, analyses) {
    statsSetText('st-climb-speed', statsValue(summary.climbSpeed, 1, ' km/h'));
    statsSetText('st-downhill-speed', statsValue(summary.downhillSpeed, 1, ' km/h'));
    statsSetText('st-vam', statsValue(summary.vam, 0, ' m/h'));
    statsSetText('st-average-grade', statsValue(summary.meanGrade, 1, '%'));
    statsSetText('st-max-grade', statsValue(summary.maxGrade, 1, '%'));
    statsSetText('st-climb-time', summary.climbTimeSec ? fmtDur(summary.climbTimeSec) : '--');
    statsSetText('st-downhill-time', summary.downhillTimeSec ? fmtDur(summary.downhillTimeSec) : '--');
    statsSetText('st-downhill-total', summary.descentSampleCount ? `${Math.round(summary.descentM)} m` : '--');
    statsSetText('st-ascent-total', summary.ascentSampleCount ? `${Math.round(summary.ascentM)} m` : '--');
    statsSetText('st-max-altitude', Number.isFinite(summary.maxAltitude) ? `${Math.round(summary.maxAltitude)} m` : '--');
    statsSetText('st-min-altitude', Number.isFinite(summary.minAltitude) ? `${Math.round(summary.minAltitude)} m` : '--');

    const select = $('stats-profile-route');
    const selected = select.value;
    const eligible = analyses.filter(item => item.profile.some(point => Number.isFinite(point.y)));
    select.replaceChildren(new Option(eligible.length ? 'Elige una ruta' : 'Sin perfiles de altitud', ''));
    eligible.forEach(item => {
        select.add(new Option(`${item.route.name} · ${fmtDate(item.route.startedAt)}`, String(item.route.id)));
    });
    if (eligible.some(item => String(item.route.id) === selected)) select.value = selected;
    else if (eligible.length) select.value = String(eligible[0].route.id);
    statsRenderProfile(eligible.find(item => String(item.route.id) === select.value) || null);
}

function statsRenderMtbCharts(summary, analyses) {
    statsUpdateChart(statsMtbSpeedChart, ['Subiendo', 'Bajando'], [
        summary.climbSpeed,
        summary.downhillSpeed
    ]);

    const gradeLabels = ['< −10%', '−10 a −3%', '−3 a 3%', '3 a 10%', '> 10%'];
    const gradeValues = summary.gradeDistanceKm > 0
        ? [
            summary.gradeDistributionKm.steepDownhill,
            summary.gradeDistributionKm.downhill,
            summary.gradeDistributionKm.flat,
            summary.gradeDistributionKm.climb,
            summary.gradeDistributionKm.steepClimb
        ]
        : gradeLabels.map(() => null);
    statsUpdateChart(statsGradeChart, gradeLabels, gradeValues);

    const hasClimbTime = summary.climbTimeSec > 0;
    const hasDownhillTime = summary.downhillTimeSec > 0;
    statsUpdateChart(statsClimbTimeChart, ['Ascenso', 'Descenso'], [
        hasClimbTime ? summary.climbTimeSec / 60 : null,
        hasDownhillTime ? summary.downhillTimeSec / 60 : null
    ]);

    if (statsVamChart) {
        const { labels, buckets } = statsPeriodBuckets(statsPeriod, analyses);
        const vamValues = buckets.map(items => {
            const climbing = items.filter(item => item.climbTimeSec > 0);
            const climbingTime = climbing.reduce((total, item) => total + item.climbTimeSec, 0);
            const climbingAscent = climbing.reduce((total, item) => total + item.vamAscentM, 0);
            return climbingTime > 0 ? climbingAscent / (climbingTime / 3600) : null;
        });
        statsUpdateChart(statsVamChart, labels, vamValues);
    }
}

function statsRenderProfile(analysis) {
    if (!statsProfileChart) return;
    const points = analysis ? analysis.profile : [];
    const hasAltitude = points.some(point => Number.isFinite(point.y));
    statsProfileChart.data.datasets[0].data = hasAltitude ? points : [];
    statsProfileChart.update('none');
    statsSetText('stats-profile-point', hasAltitude
        ? 'Toca o selecciona un punto del perfil para consultar altitud, pendiente, velocidad, distancia y tiempo.'
        : 'Esta ruta no contiene datos de altitud.');
}

function statsProfilePointText(point) {
    const values = [
        `Distancia: ${Number.isFinite(point.x) ? point.x.toFixed(2) + ' km' : '--'}`,
        `Altitud: ${Number.isFinite(point.altitude) ? Math.round(point.altitude) + ' m' : '--'}`,
        `Pendiente: ${Number.isFinite(point.slope) ? point.slope.toFixed(1) + '%' : '--'}`,
        `Velocidad: ${Number.isFinite(point.speed) ? point.speed.toFixed(1) + ' km/h' : '--'}`,
        `Tiempo: ${Number.isFinite(point.timeSec) ? fmtDur(point.timeSec) : '--'}`
    ];
    statsSetText('stats-profile-point', values.join(' · '));
}

function statsPeriodBuckets(period, analyses) {
    const now = new Date();
    const dated = analyses.map(item => ({
        item,
        date: new Date(item.route.startedAt)
    })).filter(entry => Number.isFinite(entry.date.getTime()));
    let labels = [];
    let buckets = [];
    const addBuckets = (count, labelForIndex) => {
        labels = Array.from({ length: count }, (_, index) => labelForIndex(index));
        buckets = Array.from({ length: count }, () => []);
    };

    if (period === 'today') {
        addBuckets(4, index => `${String(index * 6).padStart(2, '0')}–${String(index * 6 + 6).padStart(2, '0')}`);
        dated.forEach(({ item, date }) => {
            if (date.toDateString() === now.toDateString()) buckets[Math.min(3, Math.floor(date.getHours() / 6))].push(item);
        });
    } else if (period === 'weekly') {
        const start = statsPeriodStart('weekly', now);
        addBuckets(7, index => ['L', 'M', 'X', 'J', 'V', 'S', 'D'][index]);
        dated.forEach(({ item, date }) => {
            const day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
            const weekStart = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
            const index = Math.round((day - weekStart) / 86400000);
            if (index >= 0 && index < buckets.length) buckets[index].push(item);
        });
    } else if (period === 'monthly') {
        const weekCount = Math.ceil(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() / 7);
        addBuckets(weekCount, index => `S${index + 1}`);
        dated.forEach(({ item, date }) => {
            if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()) {
                buckets[Math.floor((date.getDate() - 1) / 7)].push(item);
            }
        });
    } else if (period === 'yearly') {
        addBuckets(12, index => new Date(now.getFullYear(), index, 1)
            .toLocaleDateString('es-ES', { month: 'short' }));
        dated.forEach(({ item, date }) => {
            if (date.getFullYear() === now.getFullYear()) buckets[date.getMonth()].push(item);
        });
    } else if (dated.length) {
        const earliest = dated.reduce((min, entry) => Math.min(min, entry.date.getTime()), Infinity);
        const start = new Date(earliest);
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        const count = (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth() + 1;
        addBuckets(Math.max(0, count), index => new Date(start.getFullYear(), start.getMonth() + index, 1)
            .toLocaleDateString('es-ES', { month: 'short', year: '2-digit' }));
        dated.forEach(({ item, date }) => {
            const index = (date.getFullYear() - start.getFullYear()) * 12 + date.getMonth() - start.getMonth();
            if (index >= 0 && index < buckets.length) buckets[index].push(item);
        });
    }
    return { labels, buckets };
}

function statsPeriodChartData(buckets, metric) {
    const values = buckets.map(items => {
        if (metric === 'activityCount') return items.length;
        if (metric === 'distanceKm') return items.reduce((sum, item) => sum + item.distanceKm, 0);
        if (metric === 'ascentM') {
            if (!items.length) return 0;
            const available = items.filter(item => item.ascentAvailable);
            return available.length ? available.reduce((sum, item) => sum + item.ascentM, 0) : null;
        }
        if (metric === 'averageSpeed') {
            const distance = items.reduce((sum, item) => sum + item.distanceKm, 0);
            const movingTime = items.reduce((sum, item) => sum + item.movingTimeSec, 0);
            return movingTime > 0 ? distance / (movingTime / 3600) : null;
        }
        const speeds = items.map(item => item.maxSpeed).filter(Number.isFinite);
        return speeds.length ? speeds.reduce((max, value) => Math.max(max, value), -Infinity) : null;
    });
    return values;
}

function statsUpdateChart(chart, labels, values) {
    if (!chart) return;
    chart.data.labels = labels;
    chart.data.datasets[0].data = values;
    chart.update('none');
}

function statsRenderOverviewCharts(analyses) {
    if (!statsChart) return;
    const { labels, buckets } = statsPeriodBuckets(statsPeriod, analyses);
    statsUpdateChart(statsChart, labels, statsPeriodChartData(buckets, 'distanceKm'));
    statsUpdateChart(statsAscentChart, labels, statsPeriodChartData(buckets, 'ascentM'));
    statsUpdateChart(statsActivityChart, labels, statsPeriodChartData(buckets, 'activityCount'));
    statsSetText('stats-activity-title', statsPeriod === 'today'
        ? 'Actividad por hora'
        : statsPeriod === 'weekly' ? 'Actividad semanal' : 'Actividad mensual');
    if (statsSpeedChart) {
        statsSpeedChart.data.labels = labels;
        statsSpeedChart.data.datasets[0].data = statsPeriodChartData(buckets, 'averageSpeed');
        statsSpeedChart.data.datasets[1].data = statsPeriodChartData(buckets, 'maxSpeed');
        statsSpeedChart.update('none');
    }
}

function statsMetricSummary(analyses) {
    return statsAggregate(analyses);
}

function statsPreviousRanges(now = new Date()) {
    const ranges = [];
    for (const [period, label] of [['weekly', 'Semana'], ['monthly', 'Mes'], ['yearly', 'Año']]) {
        const start = statsPeriodStart(period, now);
        const elapsed = now.getTime() - start.getTime();
        const previousStart = new Date(start);
        if (period === 'weekly') previousStart.setDate(previousStart.getDate() - 7);
        else if (period === 'monthly') previousStart.setMonth(previousStart.getMonth() - 1);
        else previousStart.setFullYear(previousStart.getFullYear() - 1);
        const previousEnd = new Date(previousStart.getTime() + elapsed);
        ranges.push({
            label,
            current: statsRangeRidesBetween(start, now),
            previous: statsRangeRidesBetween(previousStart, previousEnd)
        });
    }
    return ranges;
}

function statsRangeRidesBetween(start, end) {
    return savedRoutes.filter(route => {
        if (!route || route.kind === 'imported') return false;
        const time = statsDate(route.startedAt);
        return Number.isFinite(time) && time >= start.getTime() && time < end.getTime();
    }).map(statsAnalyzeRoute);
}

function statsRenderComparisons() {
    const container = $('stats-comparisons');
    container.replaceChildren();
    statsPreviousRanges().forEach(range => {
        const current = statsMetricSummary(range.current);
        const previous = statsMetricSummary(range.previous);
        const card = document.createElement('div');
        card.className = 'stats-comparison';
        const title = document.createElement('strong');
        title.textContent = `${range.label} actual frente a anterior`;
        card.appendChild(title);
        [
            ['Distancia', current.distanceKm, previous.distanceKm, ' km'],
            ['Tiempo en movimiento', current.movingTimeSec, previous.movingTimeSec, ' s'],
            ['Desnivel positivo', current.ascentM, previous.ascentM, ' m'],
            ['Velocidad media', current.averageSpeed, previous.averageSpeed, ' km/h'],
            ['Salidas', current.rideCount, previous.rideCount, ' salidas'],
            ['Duración media', current.averageDuration, previous.averageDuration, ' s'],
            ['VAM', current.vam, previous.vam, ' m/h']
        ].forEach(([label, currentValue, previousValue, unit]) => {
            const row = document.createElement('span');
            let change = 'sin periodo anterior';
            if (Number.isFinite(currentValue) && previousValue > 0) {
                const percent = (currentValue - previousValue) / previousValue * 100;
                change = `${percent >= 0 ? '+' : ''}${percent.toFixed(0)}%`;
            } else if (Number.isFinite(currentValue) && currentValue > 0) change = 'nuevo';
            const renderedCurrent = !Number.isFinite(currentValue)
                ? 'Sin datos'
                : unit === ' s' ? fmtDur(currentValue) : `${currentValue.toFixed(unit === ' km' || unit === ' km/h' ? 1 : 0)}${unit}`;
            row.textContent = `${label}: ${renderedCurrent} (${change})`;
            card.appendChild(row);
        });
        container.appendChild(card);
    });
}

function statsRenderEvolutionSummary() {
    const container = $('stats-evolution-summary');
    container.replaceChildren();
    const now = new Date();
    const ranges = [
        ['Esta semana', statsPeriodStart('weekly', now)],
        ['Este mes', statsPeriodStart('monthly', now)]
    ];
    ranges.forEach(([label, start]) => {
        const summary = statsAggregate(statsRangeRidesBetween(start, new Date(now.getTime() + 1)));
        const period = document.createElement('div');
        period.className = 'stats-evolution-period-summary';
        const heading = document.createElement('h4');
        heading.textContent = label;
        const grid = document.createElement('div');
        grid.className = 'stats-grid stats-evolution-kpis';
        const values = [
            ['Distancia', `${summary.distanceKm.toFixed(1)} km`],
            ['Desnivel positivo', summary.ascentSampleCount ? `+${Math.round(summary.ascentM)} m` : '--'],
            ['Desnivel negativo', summary.descentSampleCount ? statsDescentValue(summary.descentM) : '--'],
            ['Salidas', String(summary.rideCount)],
            ['Duración media', summary.rideCount ? fmtDur(summary.averageDuration) : '--'],
            ['Velocidad media', statsValue(summary.averageSpeed, 1, ' km/h')],
            ['VAM', statsValue(summary.vam, 0, ' m/h')]
        ];
        values.forEach(([metricName, value]) => {
            const box = document.createElement('div');
            box.className = 'stat-box';
            const metric = document.createElement('div');
            metric.className = 'v';
            metric.textContent = value;
            const caption = document.createElement('div');
            caption.className = 'l';
            caption.textContent = metricName;
            box.append(metric, caption);
            grid.appendChild(box);
        });
        period.append(heading, grid);
        container.appendChild(period);
    });
}

function statsEvolutionPeriods(period, now = new Date()) {
    if (period === 'weekly') {
        const start = statsPeriodStart('weekly', now);
        start.setDate(start.getDate() - 77);
        return Array.from({ length: 12 }, (_, index) => {
            const date = new Date(start);
            date.setDate(start.getDate() + index * 7);
            return date;
        });
    }
    const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    return Array.from({ length: 12 }, (_, index) =>
        new Date(start.getFullYear(), start.getMonth() + index, 1));
}

function statsEvolutionValue(analyses, metric) {
    if (metric === 'activityCount') return analyses.length;
    if (metric === 'distance') return analyses.reduce((sum, item) => sum + item.distanceKm, 0);
    if (metric === 'ascent') {
        if (!analyses.length) return 0;
        const available = analyses.filter(item => item.ascentAvailable);
        return available.length ? available.reduce((sum, item) => sum + item.ascentM, 0) : null;
    }
    if (metric === 'descent') {
        if (!analyses.length) return 0;
        const available = analyses.filter(item => item.descentAvailable);
        return available.length ? available.reduce((sum, item) => sum + item.descentM, 0) : null;
    }
    if (metric === 'speed') {
        const distance = analyses.reduce((sum, item) => sum + item.distanceKm, 0);
        const moving = analyses.reduce((sum, item) => sum + item.movingTimeSec, 0);
        return moving > 0 ? distance / (moving / 3600) : null;
    }
    if (metric === 'duration') {
        const moving = analyses.reduce((sum, item) => sum + item.movingTimeSec, 0);
        return moving > 0 ? moving / analyses.length / 60 : null;
    }
    const climbing = analyses.filter(item => Number.isFinite(item.vamAscentM) && item.climbTimeSec > 0);
    const climbingTime = climbing.reduce((sum, item) => sum + item.climbTimeSec, 0);
    const climbingAscent = climbing.reduce((sum, item) => sum + item.vamAscentM, 0);
    return climbingTime > 0 ? climbingAscent / (climbingTime / 3600) : null;
}

function statsRenderEvolutionChart() {
    if (!statsEvolutionChart) return;
    const now = new Date();
    const period = $('stats-evolution-period').value;
    const metric = $('stats-evolution-metric').value;
    const periods = statsEvolutionPeriods(period, now);
    const firstPeriod = periods[0];
    const records = savedRoutes.filter(route => route && route.kind !== 'imported').map(route => {
        const time = statsDate(route.startedAt);
        return { route, time, analysis: statsAnalyzeRoute(route) };
    }).filter(item => Number.isFinite(item.time) && item.time >= firstPeriod.getTime());
    const buckets = periods.map(() => []);
    records.forEach(item => {
        const date = new Date(item.time);
        const bucketIndex = period === 'weekly'
            ? Math.round((statsPeriodStart('weekly', date).getTime() - firstPeriod.getTime()) / (7 * 86400000))
            : (date.getFullYear() - firstPeriod.getFullYear()) * 12 + date.getMonth() - firstPeriod.getMonth();
        if (bucketIndex >= 0 && bucketIndex < buckets.length) buckets[bucketIndex].push(item.analysis);
    });
    const metricLabels = {
        distance: 'Distancia (km)',
        speed: 'Velocidad media (km/h)',
        ascent: 'Desnivel positivo (m)',
        descent: 'Desnivel negativo (m)',
        activityCount: 'Salidas',
        duration: 'Duración media en movimiento (min)',
        vam: 'VAM (m/h)'
    };
    const labels = periods.map(date => period === 'weekly'
        ? date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
        : date.toLocaleDateString('es-ES', { month: 'short', year: '2-digit' }));
    statsEvolutionChart.data.labels = labels;
    statsEvolutionChart.data.datasets[0].label = metricLabels[metric];
    statsEvolutionChart.data.datasets[0].data = buckets.map(items => statsEvolutionValue(items, metric));
    statsEvolutionChart.update('none');
}

function statsRideDateKey(route) {
    const time = statsDate(route.startedAt);
    if (!Number.isFinite(time)) return '';
    const date = new Date(time);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function statsRenderRecords() {
    const fullHistory = savedRoutes.filter(route => route && route.kind !== 'imported').map(statsAnalyzeRoute);
    const records = $('stats-records');
    records.replaceChildren();
    const routeNamesSummary = items => {
        const names = [...new Set(items.map(item => item.route.name || 'Salida'))];
        if (!names.length) return '';
        const visibleNames = names.slice(0, 3).join(', ');
        return `Rutas: ${visibleNames}${names.length > 3 ? ` y ${names.length - 3} más` : ''}`;
    };
    const renderRecord = (label, item = null, value = '', context = '') => {
        const row = document.createElement('div');
        row.className = 'stats-record';
        const heading = document.createElement('div');
        heading.className = 'stats-record-heading';
        if (item || context) {
            const medal = document.createElement('span');
            medal.className = 'stats-record-medal';
            medal.setAttribute('aria-hidden', 'true');
            medal.textContent = '🏅';
            heading.appendChild(medal);
        }
        const title = document.createElement('strong');
        title.textContent = label;
        heading.appendChild(title);
        const detail = document.createElement('span');
        detail.textContent = item
            ? `${value} · Ruta: ${item.route.name || 'Salida'} · ${fmtDate(item.route.startedAt)}`
            : (context ? `${value} · ${context}` : (value || 'Sin datos suficientes'));
        row.append(heading, detail);
        records.appendChild(row);
    };
    const bestOf = (items, valueFor) => items.reduce((best, item) => {
        const value = valueFor(item);
        return Number.isFinite(value) && (!best || value > valueFor(best)) ? item : best;
    }, null);
    const longest = bestOf(fullHistory.filter(item => item.distanceKm > 0), item => item.distanceKm);
    const biggestClimb = bestOf(
        fullHistory.filter(item => item.ascentAvailable && item.ascentM > 0),
        item => item.ascentM
    );
    const longestRide = bestOf(
        fullHistory.filter(item => !item.movingTimeEstimated && item.elapsedTimeSec > 0),
        item => item.elapsedTimeSec
    );
    const fastest = bestOf(fullHistory.filter(item => item.maxSpeed > 0), item => item.maxSpeed);
    const longestClimb = bestOf(
        fullHistory.filter(item => Number.isFinite(item.longestClimbDistanceKm)),
        item => item.longestClimbDistanceKm
    );
    const bestVam = bestOf(fullHistory.filter(item => item.vam > 0), item => item.vam);

    renderRecord('Mayor distancia', longest, longest && `${longest.distanceKm.toFixed(1)} km`);
    renderRecord('Mayor desnivel positivo', biggestClimb, biggestClimb && `${Math.round(biggestClimb.ascentM)} m`);
    renderRecord('Mayor duración total', longestRide, longestRide && fmtDur(longestRide.elapsedTimeSec));
    renderRecord('Velocidad máxima GPS válida', fastest, fastest && `${fastest.maxSpeed.toFixed(1)} km/h`);
    renderRecord('Subida continua más larga', longestClimb, longestClimb
        && `${longestClimb.longestClimbDistanceKm.toFixed(2)} km · +${Math.round(longestClimb.longestClimbAscentM)} m`);
    renderRecord('Mayor VAM', bestVam, bestVam && `${Math.round(bestVam.vam)} m/h`);

    const weeklyDistances = new Map();
    fullHistory.forEach(item => {
        const time = statsDate(item.route.startedAt);
        if (!Number.isFinite(time)) return;
        const start = statsPeriodStart('weekly', new Date(time));
        const key = statsRideDateKey({ startedAt: start });
        const weekly = weeklyDistances.get(key) || { start, distanceKm: 0 };
        weekly.distanceKm += item.distanceKm;
        weeklyDistances.set(key, weekly);
    });
    const biggestWeek = [...weeklyDistances.values()].reduce((best, item) =>
        !best || item.distanceKm > best.distanceKm ? item : best, null);
    const biggestWeekItems = biggestWeek && fullHistory.filter(item => {
        const time = statsDate(item.route.startedAt);
        return Number.isFinite(time)
            && statsPeriodStart('weekly', new Date(time)).getTime() === biggestWeek.start.getTime();
    });
    renderRecord('Mayor distancia semanal', null,
        biggestWeek && biggestWeek.distanceKm > 0 ? `${biggestWeek.distanceKm.toFixed(1)} km` : '',
        biggestWeek && biggestWeek.distanceKm > 0
            ? [
                `semana del ${biggestWeek.start.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}`,
                routeNamesSummary(biggestWeekItems || [])
            ].filter(Boolean).join(' · ')
            : '');

    const dates = new Set(fullHistory.map(item => statsRideDateKey(item.route)).filter(Boolean));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    let streak = 0;
    const streakDateKeys = new Set();
    let cursor = new Date(dates.has(dateKey(today)) ? today : yesterday);
    while (dates.has(dateKey(cursor))) {
        streak++;
        streakDateKeys.add(dateKey(cursor));
        cursor.setDate(cursor.getDate() - 1);
    }
    const streakItems = fullHistory.filter(item => streakDateKeys.has(statsRideDateKey(item.route)));
    renderRecord('Racha actual', null, `${streak} ${streak === 1 ? 'día' : 'días'} consecutivos`,
        routeNamesSummary(streakItems));

}

let statsNeedsRefresh = true;

function refreshStats() {
    if (currentPage !== 1) {
        statsNeedsRefresh = true;
        return;
    }
    statsNeedsRefresh = false;
    const rides = statsRangeRides(statsPeriod);
    const analyses = rides.map(statsAnalyzeRoute);
    const summary = statsAggregate(analyses);
    statsRenderSummary(summary);
    statsRenderPerformance(summary, analyses);
    statsRenderMtb(summary, analyses);
    statsRenderOverviewCharts(analyses);
    statsRenderMtbCharts(summary, analyses);
    statsRenderComparisons();
    statsRenderEvolutionSummary();
    statsRenderEvolutionChart();
    statsRenderRecords();
}

function setStatsPeriod(period) {
    if (!Object.prototype.hasOwnProperty.call(STATS_PERIOD_LABELS, period)) return;
    statsPeriod = period;
    document.querySelectorAll('[data-stats-period]').forEach(button => {
        const active = button.dataset.statsPeriod === period;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
    });
    refreshStats();
}

function setStatsSlide(index) {
    const track = $('stats-track');
    if (!track) return;
    const slideCount = track.children.length;
    if (!slideCount) return;
    activeStatsSlide = Math.max(0, Math.min(slideCount - 1, Number(index) || 0));
    track.style.transform = `translateX(-${activeStatsSlide * (100 / slideCount)}%)`;
    document.querySelectorAll('[data-stats-slide]').forEach(button => {
        const active = Number(button.dataset.statsSlide) === activeStatsSlide;
        button.classList.toggle('active', active);
        if (active) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
    });
    if (activeStatsSlide === 0) {
        [statsChart, statsAscentChart, statsSpeedChart, statsActivityChart].forEach(chart => chart?.resize());
    }
    if (activeStatsSlide === 1) {
        [statsProfileChart, statsMtbSpeedChart, statsGradeChart, statsClimbTimeChart, statsVamChart]
            .forEach(chart => chart?.resize());
    }
    if (activeStatsSlide === 2) statsEvolutionChart?.resize();
}

function statsInitCharts() {
    if (typeof Chart === 'undefined') return;
    const axis = { ticks: { color: '#aab8ca', font: { size: 10 } }, grid: { color: 'rgba(143,166,199,0.14)' } };
    statsChart = new Chart($('statsChart').getContext('2d'), {
        type: 'bar',
        data: { labels: [], datasets: [{
            label: 'km', data: [],
            backgroundColor: 'rgba(73,221,181,0.72)', borderColor: '#49ddb5', borderWidth: 1, borderRadius: 5
        }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: axis, y: { ...axis, beginAtZero: true } }
        }
    });
    statsAscentChart = new Chart($('stats-ascent-chart').getContext('2d'), {
        type: 'bar',
        data: { labels: [], datasets: [{
            label: 'm', data: [],
            backgroundColor: 'rgba(255,173,105,0.7)', borderColor: '#ffad69', borderWidth: 1, borderRadius: 5
        }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: axis, y: { ...axis, beginAtZero: true } }
        }
    });
    statsSpeedChart = new Chart($('stats-speed-chart').getContext('2d'), {
        type: 'line',
        data: { labels: [], datasets: [
            {
                label: 'Media (km/h)', data: [], borderColor: '#55dce7',
                backgroundColor: 'rgba(85,220,231,0.14)', fill: true, tension: 0.25, pointRadius: 2
            },
            {
                label: 'Máxima (km/h)', data: [], borderColor: '#ff8791',
                backgroundColor: 'rgba(255,135,145,0.1)', fill: false, tension: 0.2, pointRadius: 2
            }
        ] },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: true, labels: { color: '#aab8ca', boxWidth: 10, font: { size: 10 } } } },
            scales: { x: axis, y: { ...axis, beginAtZero: true } }
        }
    });
    statsActivityChart = new Chart($('stats-activity-chart').getContext('2d'), {
        type: 'bar',
        data: { labels: [], datasets: [{
            label: 'Salidas', data: [],
            backgroundColor: 'rgba(85,220,231,0.68)', borderColor: '#55dce7', borderWidth: 1, borderRadius: 5
        }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: axis, y: { ...axis, beginAtZero: true, ticks: { ...axis.ticks, precision: 0 } } }
        }
    });
    statsMtbSpeedChart = new Chart($('stats-mtb-speed-chart').getContext('2d'), {
        type: 'bar',
        data: { labels: [], datasets: [{
            label: 'km/h', data: [],
            backgroundColor: ['rgba(73,221,181,0.72)', 'rgba(255,173,105,0.72)'],
            borderColor: ['#49ddb5', '#ffad69'], borderWidth: 1, borderRadius: 5
        }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: axis, y: { ...axis, beginAtZero: true } }
        }
    });
    statsGradeChart = new Chart($('stats-grade-chart').getContext('2d'), {
        type: 'bar',
        data: { labels: [], datasets: [{
            label: 'Distancia (km)', data: [],
            backgroundColor: 'rgba(85,220,231,0.7)', borderColor: '#55dce7', borderWidth: 1, borderRadius: 5
        }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { ...axis, ticks: { ...axis.ticks, maxRotation: 0, minRotation: 0 } }, y: { ...axis, beginAtZero: true } }
        }
    });
    statsClimbTimeChart = new Chart($('stats-climb-time-chart').getContext('2d'), {
        type: 'bar',
        data: { labels: [], datasets: [{
            label: 'Minutos', data: [],
            backgroundColor: ['rgba(73,221,181,0.72)', 'rgba(255,173,105,0.72)'],
            borderColor: ['#49ddb5', '#ffad69'], borderWidth: 1, borderRadius: 5
        }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: axis, y: { ...axis, beginAtZero: true } }
        }
    });
    statsVamChart = new Chart($('stats-vam-chart').getContext('2d'), {
        type: 'line',
        data: { labels: [], datasets: [{
            label: 'VAM (m/h)', data: [], borderColor: '#ffad69',
            backgroundColor: 'rgba(255,173,105,0.16)', fill: true, tension: 0.25, pointRadius: 2
        }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: axis, y: { ...axis, beginAtZero: true } }
        }
    });
    statsProfileChart = new Chart($('stats-profile-chart').getContext('2d'), {
        type: 'scatter',
        data: { datasets: [{
            label: 'Altitud',
            data: [],
            showLine: true,
            spanGaps: false,
            borderColor: '#55dce7',
            backgroundColor: 'rgba(85,220,231,0.15)',
            pointRadius: 0,
            pointHitRadius: 10,
            borderWidth: 2,
            fill: true
        }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            parsing: false,
            interaction: { mode: 'nearest', intersect: true },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: context => {
                            const point = context.raw;
                            return ` ${point.x.toFixed(2)} km · ${Math.round(point.y)} m`;
                        }
                    }
                }
            },
            scales: {
                x: { ...axis, type: 'linear', title: { display: true, text: 'Distancia (km)', color: '#aab8ca' } },
                y: { ...axis, title: { display: true, text: 'Altitud (m)', color: '#aab8ca' } }
            },
            onClick: (event, elements) => {
                if (elements.length) statsProfilePointText(statsProfileChart.data.datasets[0].data[elements[0].index]);
            }
        }
    });
    statsEvolutionChart = new Chart($('stats-evolution-chart').getContext('2d'), {
        type: 'line',
        data: { labels: [], datasets: [{
            label: 'km', data: [], borderColor: '#55dce7', backgroundColor: 'rgba(85,220,231,0.15)',
            fill: true, tension: 0.25, pointRadius: 3
        }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: axis, y: { ...axis, beginAtZero: true } }
        }
    });
}

function initCharts() {
    statsLoadPreferences();
    statsInitCharts();
    document.querySelectorAll('[data-stats-period]').forEach(button =>
        button.addEventListener('click', () => setStatsPeriod(button.dataset.statsPeriod)));
    document.querySelectorAll('[data-stats-slide]').forEach(button =>
        button.addEventListener('click', () => setStatsSlide(button.dataset.statsSlide)));
    $('stats-power-ftp').addEventListener('change', statsSavePreferences);
    $('stats-profile-route').addEventListener('change', () => {
        const route = savedRoutes.find(item => String(item.id) === $('stats-profile-route').value);
        statsRenderProfile(route ? statsAnalyzeRoute(route) : null);
    });
    $('stats-evolution-period').addEventListener('change', statsRenderEvolutionChart);
    $('stats-evolution-metric').addEventListener('change', statsRenderEvolutionChart);
    refreshStats();
}

// ============================================================
