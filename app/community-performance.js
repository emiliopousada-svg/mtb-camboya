'use strict';

(function (root, factory) {
    const engine = factory();
    root.MTBCommunityPerformance = engine;
    if (typeof module !== 'undefined' && module.exports) module.exports = engine;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const MAX_MATCH_DISTANCE_M = 40;
    const MAX_POINT_SPEED_MPS = 25;
    const SAMPLE_SPACING_M = 150;
    const MAX_EFFORT_SECONDS = 24 * 60 * 60;

    function distanceMeters(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b)) return NaN;
        const lat1 = Number(a[0]), lon1 = Number(a[1]);
        const lat2 = Number(b[0]), lon2 = Number(b[1]);
        if (![lat1, lon1, lat2, lon2].every(Number.isFinite)
            || Math.abs(lat1) > 90 || Math.abs(lat2) > 90
            || Math.abs(lon1) > 180 || Math.abs(lon2) > 180) return NaN;
        const radians = Math.PI / 180;
        const dLat = (lat2 - lat1) * radians;
        const dLon = (lon2 - lon1) * radians;
        const h = Math.sin(dLat / 2) ** 2
            + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLon / 2) ** 2;
        return 12742000 * Math.asin(Math.sqrt(Math.min(1, h)));
    }

    function timedPoints(activity) {
        if (!activity || !Array.isArray(activity.points)) return [];
        const points = activity.points.map((point, index) => {
            if (!Array.isArray(point)) return null;
            const lat = Number(point[0]), lon = Number(point[1]);
            let timeMs = Number(point[3]);
            if (!Number.isFinite(timeMs) && point[3] != null) timeMs = Date.parse(point[3]);
            if (!Number.isFinite(lat) || Math.abs(lat) > 90
                || !Number.isFinite(lon) || Math.abs(lon) > 180
                || !Number.isFinite(timeMs) || timeMs <= 0) return null;
            return { coord: [lat, lon], timeMs, index, startsSegment: point[5] === 1 };
        }).filter(Boolean);
        for (let i = 1; i < points.length; i++) {
            const previous = points[i - 1], current = points[i];
            const elapsedSeconds = (current.timeMs - previous.timeMs) / 1000;
            if (elapsedSeconds <= 0) return [];
            if (!current.startsSegment
                && distanceMeters(previous.coord, current.coord) / elapsedSeconds > MAX_POINT_SPEED_MPS) return [];
        }
        return points;
    }

    function sampleLine(line, spacing) {
        if (!Array.isArray(line) || line.length < 2) return [];
        const cumulative = [0];
        for (let i = 1; i < line.length; i++) {
            const leg = distanceMeters(line[i - 1], line[i]);
            if (!Number.isFinite(leg)) return [];
            cumulative.push(cumulative[i - 1] + leg);
        }
        const length = cumulative[cumulative.length - 1];
        if (length <= 0) return [];
        const count = Math.max(1, Math.ceil(length / spacing));
        const samples = [];
        let legIndex = 1;
        for (let i = 0; i <= count; i++) {
            const target = length * i / count;
            while (legIndex < cumulative.length - 1 && cumulative[legIndex] < target) legIndex++;
            const from = line[legIndex - 1], to = line[legIndex];
            const legLength = cumulative[legIndex] - cumulative[legIndex - 1];
            const ratio = legLength ? (target - cumulative[legIndex - 1]) / legLength : 0;
            samples.push([
                Number(from[0]) + (Number(to[0]) - Number(from[0])) * ratio,
                Number(from[1]) + (Number(to[1]) - Number(from[1])) * ratio
            ]);
        }
        return samples;
    }

    function referenceSamples(lines, reverse) {
        if (!Array.isArray(lines)) return [];
        const source = reverse
            ? lines.slice().reverse().map(line => Array.isArray(line) ? line.slice().reverse() : line)
            : lines;
        const length = source.reduce((sum, line) => {
            if (!Array.isArray(line)) return sum;
            for (let i = 1; i < line.length; i++) sum += distanceMeters(line[i - 1], line[i]) || 0;
            return sum;
        }, 0);
        if (!Number.isFinite(length) || length < 100) return [];
        const spacing = Math.max(SAMPLE_SPACING_M, length / 500);
        const samples = [];
        source.forEach(line => {
            const points = sampleLine(line, spacing);
            if (points.length) samples.push(...points);
        });
        return samples;
    }

    function spatialIndex(points, maxDistanceM) {
        const latitudeStep = maxDistanceM / 111_000;
        const meanLatitude = points.reduce((sum, point) => sum + point.coord[0], 0) / points.length;
        const longitudeStep = maxDistanceM / Math.max(1000, 111_000 * Math.cos(meanLatitude * Math.PI / 180));
        const cells = new Map();
        const key = (latCell, lonCell) => `${latCell}:${lonCell}`;
        points.forEach((point, index) => {
            const latCell = Math.floor(point.coord[0] / latitudeStep);
            const lonCell = Math.floor(point.coord[1] / longitudeStep);
            const cellKey = key(latCell, lonCell);
            if (!cells.has(cellKey)) cells.set(cellKey, []);
            cells.get(cellKey).push(index);
        });
        return { cells, latitudeStep, longitudeStep, key };
    }

    function matchDirection(points, samples, maxDistanceM, index) {
        let previousIndex = -1;
        let first = null, last = null;
        for (const sample of samples) {
            const latCell = Math.floor(sample[0] / index.latitudeStep);
            const lonCell = Math.floor(sample[1] / index.longitudeStep);
            let nearestIndex = -1, nearestDistance = Infinity;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const candidates = index.cells.get(index.key(latCell + dy, lonCell + dx)) || [];
                    for (const candidateIndex of candidates) {
                        if (candidateIndex <= previousIndex) continue;
                        const distance = distanceMeters(points[candidateIndex].coord, sample);
                        if (distance <= maxDistanceM && distance < nearestDistance) {
                            nearestDistance = distance;
                            nearestIndex = candidateIndex;
                        }
                    }
                }
            }
            if (nearestIndex < 0) return null;
            if (previousIndex >= 0 && points[nearestIndex].startsSegment) return null;
            if (!first) first = points[nearestIndex];
            last = points[nearestIndex];
            previousIndex = nearestIndex;
        }
        if (!first || !last || last.timeMs <= first.timeMs) return null;
        const elapsedSeconds = Math.round((last.timeMs - first.timeMs) / 1000);
        if (elapsedSeconds < 1 || elapsedSeconds > MAX_EFFORT_SECONDS) return null;
        return { elapsedSeconds, startPointIndex: first.index, endPointIndex: last.index };
    }

    function matchActivity(activity, lines, options = {}) {
        const points = timedPoints(activity);
        if (points.length < 2) return null;
        const maxDistanceM = Number.isFinite(options.maxDistanceM)
            ? Math.max(5, Math.min(100, options.maxDistanceM))
            : MAX_MATCH_DISTANCE_M;
        const forwardSamples = referenceSamples(lines, false);
        if (forwardSamples.length < 2) return null;
        const index = spatialIndex(points, maxDistanceM);
        const forward = matchDirection(points, forwardSamples, maxDistanceM, index);
        const reverse = matchDirection(points, referenceSamples(lines, true), maxDistanceM, index);
        if (!forward) return reverse ? { ...reverse, direction: 'reverse' } : null;
        if (!reverse || forward.elapsedSeconds <= reverse.elapsedSeconds) {
            return { ...forward, direction: 'forward' };
        }
        return { ...reverse, direction: 'reverse' };
    }

    function matchActivities(activities, lines, options) {
        if (!Array.isArray(activities)) return [];
        return activities.map(activity => {
            const effort = matchActivity(activity, lines, options);
            return effort ? { activity, ...effort } : null;
        }).filter(Boolean).sort((a, b) => a.elapsedSeconds - b.elapsedSeconds);
    }

    return { distanceMeters, matchActivity, matchActivities };
});
