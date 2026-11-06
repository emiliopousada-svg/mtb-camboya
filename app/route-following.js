'use strict';

//  AVISO DE DESVÍO
// ============================================================
function pointSegDistM(p, a, b) { // metros de p al segmento a-b (proyección local)
    const k = Math.cos(p[0] * Math.PI / 180);
    const ax = (a[1] - p[1]) * k * 111320, ay = (a[0] - p[0]) * 110540;
    const bx = (b[1] - p[1]) * k * 111320, by = (b[0] - p[0]) * 110540;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 ? -(ax * dx + ay * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(ax + t * dx, ay + t * dy);
}

function unlockOffRouteSound() {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;
    try {
        if (!offRouteAudioContext) offRouteAudioContext = new AudioContextCtor();
        if (offRouteAudioContext.state === 'suspended') offRouteAudioContext.resume().catch(() => {});
    } catch (e) {}
}

function playRouteSound(frequencies) {
    if (localStorage.getItem('mtb_route_sound') === '0') return;
    const ctx = offRouteAudioContext;
    if (!ctx || ctx.state !== 'running') return;
    const start = ctx.currentTime;
    frequencies.forEach((frequency, i) => {
        const at = start + i * 0.22;
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, at);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.linearRampToValueAtTime(0.18, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start(at);
        oscillator.stop(at + 0.17);
    });
}

function playOffRouteSound() { playRouteSound([880, 660]); }
function playBackOnRouteSound() { playRouteSound([660, 880, 1040]); }

function checkOffRoute(lat, lon) {
    const pts = followedRoute.pts;
    if (pts.length < 2) return;
    const p = [lat, lon];
    let min = Infinity;
    for (let i = 1; i < pts.length; i++) {
        const d = pointSegDistM(p, pts[i - 1], pts[i]);
        if (d < min) min = d;
    }
    if (!offRouteState && min > OFFROUTE_M) {
        offRouteState = true;
        toast(`⚠️ Te has salido de la ruta (${Math.round(min)} m)`, 5000);
        playOffRouteSound();
        if (navigator.vibrate && localStorage.getItem('mtb_route_vibration') !== '0') navigator.vibrate([200, 100, 200]);
    } else if (offRouteState && min < BACKONROUTE_M) {
        offRouteState = false;
        toast('✅ De nuevo en la ruta');
        playBackOnRouteSound();
    }
}

function renderMapRouteProfile(r) {
    const panel = $('map-route-profile');
    const points = Array.isArray(r.points) ? r.points : [];
    routeProfileCoords = [];
    routeProfilePointCount = points.length;
    $('map-route-name').textContent = r.name || 'Ruta cargada';

    const valid = points.map((p, i) => ({ i, z: p[2] == null ? NaN : Number(p[2]) }))
        .filter(p => Number.isFinite(p.z));
    if (valid.length < 2) {
        $('map-route-alt').textContent = 'Sin datos de altitud';
        $('map-route-area').setAttribute('d', '');
        $('map-route-line').setAttribute('d', '');
        $('map-route-cursor-line').style.display = 'none';
        $('map-route-cursor').style.display = 'none';
        panel.classList.add('show');
        return;
    }

    const min = Math.min(...valid.map(p => p.z));
    const max = Math.max(...valid.map(p => p.z));
    const range = Math.max(max - min, 1);
    routeProfileCoords = valid.map(p => ({
        i: p.i,
        x: routeProfilePointCount > 1 ? p.i / (routeProfilePointCount - 1) * 320 : 0,
        y: 53 - ((p.z - min) / range) * 42
    }));
    const line = routeProfileCoords.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    $('map-route-line').setAttribute('d', line);
    $('map-route-area').setAttribute('d', `${line} L320,60 L0,60 Z`);
    const gain = Number(r.elevationGain) || 0;
    $('map-route-alt').textContent = `${Math.round(min)}–${Math.round(max)} m · +${Math.round(gain)} m`;
    panel.classList.add('show');
}

function updateMapRouteProfilePosition(lat, lon) {
    if (!followedRoute || !routeProfileCoords.length || !routeProfilePointCount) return;
    let bestIndex = 0, bestDistance = Infinity;
    for (let i = 0; i < followedRoute.pts.length; i++) {
        const d = dist([lat, lon], followedRoute.pts[i]);
        if (d < bestDistance) { bestDistance = d; bestIndex = i; }
    }
    const x = bestIndex / Math.max(routeProfilePointCount - 1, 1) * 320;
    if (!isRecording && followedRoute.gainCum) $('m-elevation').textContent = Math.round(followedRoute.gainCum[bestIndex] || 0);
    let before = routeProfileCoords[0], after = routeProfileCoords[routeProfileCoords.length - 1];
    for (let i = 1; i < routeProfileCoords.length; i++) {
        if (routeProfileCoords[i].i >= bestIndex) {
            before = routeProfileCoords[i - 1];
            after = routeProfileCoords[i];
            break;
        }
    }
    const span = after.i - before.i;
    const t = span ? Math.max(0, Math.min(1, (bestIndex - before.i) / span)) : 0;
    const y = before.y + (after.y - before.y) * t;
    const line = $('map-route-cursor-line'), dot = $('map-route-cursor');
    line.setAttribute('x1', x.toFixed(1)); line.setAttribute('x2', x.toFixed(1));
    dot.setAttribute('cx', x.toFixed(1)); dot.setAttribute('cy', y.toFixed(1));
    line.style.display = 'block';
    dot.style.display = 'block';
}

function followRoute(r) {
    unlockOffRouteSound();
    followedRoute = { id: r.id, name: r.name, kind: r.kind, pts: r.points.map(p => [p[0], p[1]]), gainCum: gainCumulative(r.points) };
    renderMapRouteProfile(r);
    if (lastLat !== null && lastLon !== null) updateMapRouteProfilePosition(lastLat, lastLon);
    offRouteState = false;
    if (map) {
        savedRouteLayer.setLatLngs(buildSegments(r.points));
        const b = savedRouteLayer.getBounds();
        if (b.isValid()) map.fitBounds(b, { padding: [30, 30] });
        if (r.points.length >= 2 && lastLat !== null && lastLon !== null) {
            const routeHeading = routeHeadingFromFollowedRoute(lastLat, lastLon);
            if (routeHeading != null) {
                lastHeading = routeHeading;
                applyMapHeading(routeHeading);
            }
        }
        following = false;
        updateCenterBtn();
    }
    $('btn-unfollow').style.display = 'block';
    goToPage(0);
    toast(`Siguiendo «${r.name}». Te aviso si te desvías.`, 4500);
}

function unfollowRoute() {
    followedRoute = null;
    routeProfileCoords = [];
    routeProfilePointCount = 0;
    offRouteState = false;
    if (savedRouteLayer) savedRouteLayer.setLatLngs([]);
    $('map-route-profile').classList.remove('show');
    $('btn-unfollow').style.display = 'none';
    if (!isRecording) $('m-elevation').textContent = '0';
}
$('btn-unfollow').addEventListener('click', () => { unfollowRoute(); toast('Ruta descargada del mapa'); });

// ============================================================
