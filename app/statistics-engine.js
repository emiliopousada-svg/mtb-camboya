'use strict';

(function (root, factory) {
    const engine = factory();
    root.MTBStatisticsEngine = engine;
    if (typeof module !== 'undefined' && module.exports) module.exports = engine;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const DEFAULTS = {
        elevationThresholdM: 3,
        smoothingWindow: 5,
        gradeWindowM: 25,
        climbGradePercent: 3,
        maxPointSpeedMps: 25,
        maxRecordedSpeedKmh: 90,
        maxTimeDeltaSec: 30
    };
    const DEFAULT_HR_ZONES = [
        { min: 0.50, max: 0.60 },
        { min: 0.60, max: 0.70 },
        { min: 0.70, max: 0.80 },
        { min: 0.80, max: 0.90 },
        { min: 0.90, max: Infinity }
    ];
    const DEFAULT_POWER_ZONES = [
        { min: 0, max: 0.55 },
        { min: 0.55, max: 0.75 },
        { min: 0.75, max: 0.90 },
        { min: 0.90, max: 1.05 },
        { min: 1.05, max: 1.20 },
        { min: 1.20, max: 1.50 },
        { min: 1.50, max: Infinity }
    ];

    function finiteNumber(value) {
        if (value == null || value === '') return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function pointTime(point) {
        const value = point[3];
        if (value == null) return NaN;
        const number = Number(value);
        if (Number.isFinite(number)) return number;
        const parsed = new Date(value).getTime();
        return Number.isFinite(parsed) ? parsed : NaN;
    }

    function calculateDistanceMeters(from, to) {
        if (!Array.isArray(from) || !Array.isArray(to)) return NaN;
        const lat1 = Number(from[0]), lon1 = Number(from[1]);
        const lat2 = Number(to[0]), lon2 = Number(to[1]);
        if (![lat1, lon1, lat2, lon2].every(Number.isFinite)
            || Math.abs(lat1) > 90 || Math.abs(lat2) > 90
            || Math.abs(lon1) > 180 || Math.abs(lon2) > 180) return NaN;
        const radians = Math.PI / 180;
        const dLat = (lat2 - lat1) * radians;
        const dLon = (lon2 - lon1) * radians;
        const haversine = Math.sin(dLat / 2) ** 2
            + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLon / 2) ** 2;
        return 2 * 6371000 * Math.asin(Math.sqrt(Math.min(1, haversine)));
    }

    function median(values) {
        const sorted = values.slice().sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    }

    function createElevationTracker(options = {}) {
        const threshold = Number.isFinite(options.threshold) ? Math.max(0, options.threshold) : DEFAULTS.elevationThresholdM;
        const smoothingWindow = Number.isInteger(options.smoothingWindow) ? Math.max(1, options.smoothingWindow) : DEFAULTS.smoothingWindow;
        const minAltitude = Number.isFinite(options.minAltitude) ? options.minAltitude : -500;
        const maxAltitude = Number.isFinite(options.maxAltitude) ? options.maxAltitude : 9000;
        let samples = [], reference = null, ascent = 0, descent = 0;

        return {
            add(value) {
                const altitude = finiteNumber(value);
                if (altitude === null || altitude < minAltitude || altitude > maxAltitude) {
                    this.reset();
                    return null;
                }
                samples.push(altitude);
                if (samples.length > smoothingWindow) samples.shift();
                const smoothed = median(samples);
                if (reference === null) reference = smoothed;
                else if (smoothed - reference >= threshold) {
                    ascent += smoothed - reference;
                    reference = smoothed;
                } else if (reference - smoothed >= threshold) {
                    descent += reference - smoothed;
                    reference = smoothed;
                }
                return smoothed;
            },
            reset() {
                samples = [];
                reference = null;
            },
            get gain() { return ascent; },
            get loss() { return descent; }
        };
    }

    function maximum(values) {
        return values.reduce((max, value) => Math.max(max, value), -Infinity);
    }

    function analyzeRoute(route, options = {}) {
        if (!route || typeof route !== 'object') throw new TypeError('Se requiere una actividad válida.');
        const config = { ...DEFAULTS, ...options };
        const hrZones = Array.isArray(options.hrZones) ? options.hrZones : DEFAULT_HR_ZONES;
        const powerZones = Array.isArray(options.powerZones) ? options.powerZones : DEFAULT_POWER_ZONES;
        const heartRateMax = finiteNumber(options.heartRateMax);
        const ftpWatts = finiteNumber(options.ftpWatts);
        const sourcePoints = Array.isArray(route.points) ? route.points : [];
        const profile = [];
        const mapSegments = [];
        const hrValues = [], cadenceValues = [], powerValues = [], speedValues = [];
        const zoneSeconds = Array(hrZones.length).fill(0);
        const powerZoneSeconds = Array(powerZones.length).fill(0);
        const gradeDistributionKm = { steepDownhill: 0, downhill: 0, flat: 0, climb: 0, steepClimb: 0 };
        let distanceM = 0;
        let climbAscentM = 0, vamAscentM = 0, estimatedMovingTimeSec = 0;
        let longestClimbDistanceKm = 0, longestClimbAscentM = 0;
        let currentClimbDistanceKm = 0, currentClimbAscentM = 0;
        let minAltitude = Infinity, maxAltitude = -Infinity;
        let gradeDistanceKm = 0, gradeWeightedSum = 0, maxGrade = null;
        let climbDistanceKm = 0, downhillDistanceKm = 0;
        let climbTimeSec = 0, downhillTimeSec = 0, zoneMeasuredSeconds = 0;
        let powerZoneMeasuredSeconds = 0;
        let previous = null, currentMapSegment = null;
        let elevationTracker = createElevationTracker({
            threshold: config.elevationThresholdM,
            smoothingWindow: config.smoothingWindow
        });
        let gradeAnchor = null, currentSlope = null;
        let previousSmoothedAltitude = null, breakPending = false;
        let validAltitudeCount = 0, rejectedGpsPoints = 0;

        const startTime = route.startedAt == null ? NaN : new Date(route.startedAt).getTime();
        const finishClimb = () => {
            if (currentClimbDistanceKm > longestClimbDistanceKm
                || (currentClimbDistanceKm === longestClimbDistanceKm && currentClimbAscentM > longestClimbAscentM)) {
                longestClimbDistanceKm = currentClimbDistanceKm;
                longestClimbAscentM = currentClimbAscentM;
            }
            currentClimbDistanceKm = 0;
            currentClimbAscentM = 0;
        };
        const resetSegment = () => {
            finishClimb();
            previous = null;
            elevationTracker.reset();
            gradeAnchor = null;
            currentSlope = null;
            previousSmoothedAltitude = null;
        };

        sourcePoints.forEach((point, index) => {
            if (!Array.isArray(point)) {
                resetSegment();
                breakPending = true;
                return;
            }
            const lat = finiteNumber(point[0]), lon = finiteNumber(point[1]);
            if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
                rejectedGpsPoints++;
                resetSegment();
                breakPending = true;
                return;
            }

            const startsSegment = index === 0 || point[5] === 1 || breakPending;
            breakPending = false;
            let legMeters = 0;
            let deltaSeconds = 0;
            if (startsSegment) {
                resetSegment();
            } else if (previous) {
                const candidateMeters = calculateDistanceMeters([previous.lat, previous.lon], [lat, lon]);
                const currentTime = pointTime(point);
                const elapsed = (currentTime - previous.time) / 1000;
                const hasValidDelta = Number.isFinite(elapsed) && elapsed > 0;
                if (!Number.isFinite(candidateMeters)
                    || (hasValidDelta && candidateMeters / elapsed > config.maxPointSpeedMps)
                    || (!hasValidDelta && candidateMeters > 1000)) {
                    rejectedGpsPoints++;
                    resetSegment();
                    breakPending = true;
                    return;
                } else {
                    legMeters = candidateMeters;
                    distanceM += legMeters;
                    if (hasValidDelta && elapsed <= config.maxTimeDeltaSec) {
                        deltaSeconds = elapsed;
                        if (candidateMeters / elapsed >= 0.5) estimatedMovingTimeSec += elapsed;
                    }
                }
            }

            const time = pointTime(point);
            const altitude = finiteNumber(point[2]);
            let smoothedAltitude = null;
            if (altitude !== null && altitude >= -500 && altitude <= 9000) {
                smoothedAltitude = elevationTracker.add(altitude);
                validAltitudeCount++;
                minAltitude = Math.min(minAltitude, smoothedAltitude);
                maxAltitude = Math.max(maxAltitude, smoothedAltitude);
            } else {
                finishClimb();
                elevationTracker.reset();
                gradeAnchor = null;
                currentSlope = null;
                previousSmoothedAltitude = null;
            }

            const speed = finiteNumber(point[6]);
            const heartRate = finiteNumber(point[4]);
            const cadence = finiteNumber(point[7]);
            const power = finiteNumber(point[8]);
            if (speed !== null && speed >= 0 && speed <= config.maxRecordedSpeedKmh) speedValues.push(speed);
            if (heartRate !== null && heartRate > 0 && heartRate <= 250) hrValues.push(heartRate);
            if (cadence !== null && cadence > 0 && cadence <= 250) cadenceValues.push(cadence);
            if (power !== null && power >= 0 && power <= 3000) powerValues.push(power);

            if (startsSegment || !currentMapSegment) {
                currentMapSegment = [];
                mapSegments.push(currentMapSegment);
            }
            currentMapSegment.push({ lat, lon, pointIndex: index });

            let slope = null;
            let slopeElevationDelta = null;
            if (smoothedAltitude !== null) {
                const currentDistanceM = distanceM;
                if (gradeAnchor && currentDistanceM - gradeAnchor.distanceM >= config.gradeWindowM) {
                    const runM = currentDistanceM - gradeAnchor.distanceM;
                    slopeElevationDelta = smoothedAltitude - gradeAnchor.altitude;
                    currentSlope = slopeElevationDelta / runM * 100;
                    gradeAnchor = { distanceM: currentDistanceM, altitude: smoothedAltitude };
                } else if (!gradeAnchor) {
                    gradeAnchor = { distanceM: currentDistanceM, altitude: smoothedAltitude };
                }
                slope = currentSlope;

                if (slope !== null && legMeters > 0) {
                    const legKm = legMeters / 1000;
                    gradeDistanceKm += legKm;
                    gradeWeightedSum += Math.abs(slope) * legKm;
                    maxGrade = maxGrade === null ? Math.abs(slope) : Math.max(maxGrade, Math.abs(slope));
                    if (slope > config.climbGradePercent) {
                        climbDistanceKm += legKm;
                        climbTimeSec += deltaSeconds;
                        gradeDistributionKm[slope > 10 ? 'steepClimb' : 'climb'] += legKm;
                        let climbVerticalM = 0;
                        if (slopeElevationDelta !== null) {
                            climbVerticalM = Math.max(0, slopeElevationDelta);
                        } else if (previousSmoothedAltitude !== null) {
                            climbVerticalM = Math.max(0, smoothedAltitude - previousSmoothedAltitude);
                        }
                        climbAscentM += climbVerticalM;
                        if (deltaSeconds > 0) vamAscentM += climbVerticalM;
                        currentClimbDistanceKm += legKm;
                        currentClimbAscentM += climbVerticalM;
                    } else if (slope < -config.climbGradePercent) {
                        finishClimb();
                        downhillDistanceKm += legKm;
                        downhillTimeSec += deltaSeconds;
                        gradeDistributionKm[slope < -10 ? 'steepDownhill' : 'downhill'] += legKm;
                    } else {
                        finishClimb();
                        gradeDistributionKm.flat += legKm;
                    }
                }
            }

            if (previous && deltaSeconds > 0) {
                const previousHr = finiteNumber(previous.point[4]);
                if (previousHr !== null && heartRate !== null && previousHr > 0 && heartRate > 0) {
                    const midpoint = (previousHr + heartRate) / 2;
                    zoneMeasuredSeconds += deltaSeconds;
                    if (heartRateMax !== null && heartRateMax > 0) {
                        const zoneIndex = hrZones.findIndex(zone => {
                            const min = Number(zone.min), max = Number(zone.max);
                            return midpoint / heartRateMax >= min && midpoint / heartRateMax < max;
                        });
                        if (zoneIndex >= 0) zoneSeconds[zoneIndex] += deltaSeconds;
                    }
                }
                const previousPower = finiteNumber(previous.point[8]);
                if (previousPower !== null && previousPower >= 0 && previousPower <= 3000
                    && power !== null && power >= 0 && power <= 3000) {
                    powerZoneMeasuredSeconds += deltaSeconds;
                    if (ftpWatts !== null && ftpWatts > 0) {
                        const midpoint = (previousPower + power) / 2;
                        const zoneIndex = powerZones.findIndex(zone => {
                            const min = Number(zone.min), max = Number(zone.max);
                            return midpoint / ftpWatts >= min && midpoint / ftpWatts < max;
                        });
                        if (zoneIndex >= 0) powerZoneSeconds[zoneIndex] += deltaSeconds;
                    }
                }
            }

            if ((startsSegment || breakPending) && profile.length > 0) profile.push({ x: distanceM / 1000, y: null });
            if (smoothedAltitude !== null) {
                profile.push({
                    x: distanceM / 1000,
                    y: smoothedAltitude,
                    altitude: smoothedAltitude,
                    slope,
                    speed: speed !== null && speed <= config.maxRecordedSpeedKmh ? speed : null,
                    timeSec: Number.isFinite(time) && Number.isFinite(startTime) ? Math.max(0, (time - startTime) / 1000) : null,
                    pointIndex: index,
                    lat,
                    lon
                });
            }
            previousSmoothedAltitude = smoothedAltitude;
            previous = { lat, lon, time, point };
        });
        finishClimb();

        if (!hrValues.length) {
            const recordedHr = finiteNumber(route.hrAvg);
            if (recordedHr !== null && recordedHr > 0 && recordedHr <= 250) hrValues.push(recordedHr);
        }

        const movingTimeValue = finiteNumber(route.movingTimeSec);
        const storedDistanceKm = finiteNumber(route.distanceKm);
        const hasRecordedMovingTime = movingTimeValue !== null
            && (movingTimeValue > 0 || !(storedDistanceKm > 0));
        const movingTimeEstimated = !hasRecordedMovingTime;
        const movingTimeSec = hasRecordedMovingTime ? Math.max(0, movingTimeValue) : estimatedMovingTimeSec;
        const startedAt = Number.isFinite(startTime) ? startTime : NaN;
        const endedAt = route.endedAt == null ? NaN : new Date(route.endedAt).getTime();
        const lastPointTime = sourcePoints.reduce((latest, point) => {
            const value = Array.isArray(point) ? pointTime(point) : NaN;
            return Number.isFinite(value) ? Math.max(latest, value) : latest;
        }, -Infinity);
        const elapsedEnd = Math.max(
            Number.isFinite(endedAt) ? endedAt : -Infinity,
            Number.isFinite(lastPointTime) ? lastPointTime : -Infinity
        );
        const trackElapsedTimeSec = Number.isFinite(startedAt) && elapsedEnd > startedAt
            ? (elapsedEnd - startedAt) / 1000
            : movingTimeSec;
        const elapsedTimeSec = Math.max(trackElapsedTimeSec, movingTimeSec);
        const stoppedTimeSec = Math.max(0, elapsedTimeSec - movingTimeSec);
        const calculatedDistanceKm = distanceM / 1000;
        const distanceKm = calculatedDistanceKm > 0
            ? calculatedDistanceKm
            : Math.max(0, storedDistanceKm || 0);
        const averageSpeed = movingTimeSec > 0 ? distanceKm / (movingTimeSec / 3600) : null;
        const climbSpeed = climbTimeSec > 0 ? climbDistanceKm / (climbTimeSec / 3600) : null;
        const downhillSpeed = downhillTimeSec > 0 ? downhillDistanceKm / (downhillTimeSec / 3600) : null;
        const vam = climbTimeSec > 0 ? vamAscentM / (climbTimeSec / 3600) : null;
        const recordedAscent = finiteNumber(route.elevationGain);
        const hrMax = sourcePoints.reduce((max, point) => {
            const value = Array.isArray(point) ? finiteNumber(point[4]) : null;
            return value !== null && value > 0 && value <= 250 ? Math.max(max, value) : max;
        }, -Infinity);

        return {
            route,
            points: sourcePoints,
            mapSegments,
            profile,
            distanceKm,
            calculatedDistanceKm,
            movingTimeSec,
            movingTimeEstimated,
            elapsedTimeSec,
            stoppedTimeSec,
            ascentM: validAltitudeCount >= 2 ? elevationTracker.gain : Math.max(0, recordedAscent || 0),
            descentM: elevationTracker.loss,
            ascentAvailable: validAltitudeCount >= 2 || recordedAscent !== null,
            descentAvailable: validAltitudeCount >= 2,
            averageSpeed,
            maxSpeed: speedValues.length ? maximum(speedValues) : null,
            averageHr: hrValues.length ? hrValues.reduce((sum, value) => sum + value, 0) / hrValues.length : null,
            maxHr: hrMax === -Infinity ? null : hrMax,
            hrCount: hrValues.length,
            averageCadence: cadenceValues.length ? cadenceValues.reduce((sum, value) => sum + value, 0) / cadenceValues.length : null,
            maxCadence: cadenceValues.length ? maximum(cadenceValues) : null,
            cadenceCount: cadenceValues.length,
            averagePower: powerValues.length ? powerValues.reduce((sum, value) => sum + value, 0) / powerValues.length : null,
            maxPower: powerValues.length ? maximum(powerValues) : null,
            powerCount: powerValues.length,
            meanGrade: gradeDistanceKm ? gradeWeightedSum / gradeDistanceKm : null,
            gradeDistanceKm,
            maxGrade,
            climbDistanceKm,
            downhillDistanceKm,
            longestClimbDistanceKm: longestClimbDistanceKm > 0 ? longestClimbDistanceKm : null,
            longestClimbAscentM: longestClimbDistanceKm > 0 ? longestClimbAscentM : null,
            climbTimeSec,
            downhillTimeSec,
            climbSpeed,
            downhillSpeed,
            climbAscentM,
            vamAscentM,
            vam,
            minAltitude: minAltitude === Infinity ? null : minAltitude,
            maxAltitude: maxAltitude === -Infinity ? null : maxAltitude,
            gradeDistributionKm,
            zoneSeconds,
            zoneMeasuredSeconds,
            powerZoneSeconds,
            powerZoneMeasuredSeconds,
            rejectedGpsPoints
        };
    }

    function aggregate(analyses) {
        const sum = key => analyses.reduce((total, item) => total + (Number(item[key]) || 0), 0);
        const distanceKm = sum('distanceKm');
        const movingTimeSec = sum('movingTimeSec');
        const sampleMean = (key, countKey) => {
            const values = analyses.filter(item => Number.isFinite(item[key]) && item[countKey] > 0);
            const count = values.reduce((total, item) => total + item[countKey], 0);
            return count ? values.reduce((total, item) => total + item[key] * item[countKey], 0) / count : null;
        };
        const maxOf = key => {
            const values = analyses.map(item => item[key]).filter(Number.isFinite);
            return values.length ? maximum(values) : null;
        };
        const minOf = key => {
            const values = analyses.map(item => item[key]).filter(Number.isFinite);
            return values.length ? -maximum(values.map(value => -value)) : null;
        };
        const weightedMean = (key, weightKey) => {
            const values = analyses.filter(item => Number.isFinite(item[key]) && item[weightKey] > 0);
            const weight = values.reduce((total, item) => total + item[weightKey], 0);
            return weight ? values.reduce((total, item) => total + item[key] * item[weightKey], 0) / weight : null;
        };
        const zoneCount = analyses.reduce((max, item) => Math.max(max, item.zoneSeconds.length), 0);
        const zoneSeconds = Array(zoneCount).fill(0);
        analyses.forEach(item => item.zoneSeconds.forEach((seconds, index) => { zoneSeconds[index] += seconds; }));
        const powerZoneCount = analyses.reduce((max, item) => Math.max(max, item.powerZoneSeconds.length), 0);
        const powerZoneSeconds = Array(powerZoneCount).fill(0);
        analyses.forEach(item => item.powerZoneSeconds.forEach((seconds, index) => {
            powerZoneSeconds[index] += seconds;
        }));
        const ascentSamples = analyses.filter(item => item.ascentAvailable);
        const descentSamples = analyses.filter(item => item.descentAvailable);
        const gradeDistributionKm = {
            steepDownhill: 0, downhill: 0, flat: 0, climb: 0, steepClimb: 0
        };
        analyses.forEach(item => {
            Object.keys(gradeDistributionKm).forEach(key => {
                gradeDistributionKm[key] += item.gradeDistributionKm[key] || 0;
            });
        });
        const climbTimeSec = sum('climbTimeSec');
        const downhillTimeSec = sum('downhillTimeSec');
        const vamAscentM = sum('vamAscentM');
        return {
            distanceKm,
            movingTimeSec,
            elapsedTimeSec: sum('elapsedTimeSec'),
            stoppedTimeSec: sum('stoppedTimeSec'),
            ascentM: sum('ascentM'),
            descentM: sum('descentM'),
            ascentSampleCount: ascentSamples.length,
            descentSampleCount: descentSamples.length,
            averageSpeed: movingTimeSec ? distanceKm / (movingTimeSec / 3600) : null,
            maxSpeed: maxOf('maxSpeed'),
            rideCount: analyses.length,
            averageDistance: analyses.length ? distanceKm / analyses.length : null,
            averageDuration: analyses.length ? movingTimeSec / analyses.length : null,
            averageAscent: ascentSamples.length
                ? ascentSamples.reduce((total, item) => total + item.ascentM, 0) / ascentSamples.length
                : null,
            averageHr: sampleMean('averageHr', 'hrCount'),
            maxHr: maxOf('maxHr'),
            averageCadence: sampleMean('averageCadence', 'cadenceCount'),
            maxCadence: maxOf('maxCadence'),
            averagePower: sampleMean('averagePower', 'powerCount'),
            maxPower: maxOf('maxPower'),
            meanGrade: weightedMean('meanGrade', 'gradeDistanceKm'),
            maxGrade: maxOf('maxGrade'),
            gradeDistanceKm: sum('gradeDistanceKm'),
            climbDistanceKm: sum('climbDistanceKm'),
            downhillDistanceKm: sum('downhillDistanceKm'),
            climbTimeSec,
            downhillTimeSec,
            climbSpeed: climbTimeSec ? sum('climbDistanceKm') / (climbTimeSec / 3600) : null,
            downhillSpeed: downhillTimeSec ? sum('downhillDistanceKm') / (downhillTimeSec / 3600) : null,
            climbAscentM: sum('climbAscentM'),
            vamAscentM,
            vam: climbTimeSec ? vamAscentM / (climbTimeSec / 3600) : null,
            minAltitude: minOf('minAltitude'),
            maxAltitude: maxOf('maxAltitude'),
            gradeDistributionKm,
            zoneSeconds,
            zoneMeasuredSeconds: sum('zoneMeasuredSeconds'),
            powerZoneSeconds,
            powerZoneMeasuredSeconds: sum('powerZoneMeasuredSeconds')
        };
    }

    return { calculateDistanceMeters, createElevationTracker, analyzeRoute, aggregate };
});
