import FitParser from 'fit-file-parser';

const MAX_GAP_MS = 5 * 60 * 1000;

function fitRecordsToSegments(records) {
    const segments = [];
    let current = [];
    let previousTime = null;
    for (const record of records) {
        const latitude = record.position_lat;
        const longitude = record.position_long;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
            || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;

        const parsedTimestamp = record.timestamp instanceof Date
            ? record.timestamp.getTime()
            : Number.isFinite(record.timestamp) ? record.timestamp * 1000 : null;
        const timestamp = Number.isFinite(parsedTimestamp) ? parsedTimestamp : null;
        if (previousTime !== null && timestamp !== null && timestamp - previousTime > MAX_GAP_MS && current.length) {
            segments.push(current);
            current = [];
        }
        current.push([
            latitude,
            longitude,
            Number.isFinite(record.enhanced_altitude) ? record.enhanced_altitude
                : Number.isFinite(record.altitude) ? record.altitude : null,
            timestamp,
            Number.isFinite(record.heart_rate) ? record.heart_rate : null
        ]);
        if (timestamp !== null) previousTime = timestamp;
    }
    if (current.length) segments.push(current);
    if (segments.reduce((count, segment) => count + segment.length, 0) < 2) {
        throw new Error('el archivo FIT no contiene suficientes puntos GPS válidos');
    }
    return segments;
}

async function parseFitFile(arrayBuffer) {
    if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength < 12) {
        throw new Error('el archivo FIT está vacío o incompleto');
    }

    const parser = new FitParser({ force: false, mode: 'list' });
    let data;
    try {
        data = await parser.parseAsync(arrayBuffer);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`no se pudo leer el archivo FIT: ${reason}`);
    }
    const records = Array.isArray(data.records) ? data.records : [];
    const segments = fitRecordsToSegments(records);
    const sessionName = data.sessions && data.sessions[0] && data.sessions[0].name;
    return { name: typeof sessionName === 'string' ? sessionName : '', segs: segments };
}

export { fitRecordsToSegments, parseFitFile };
