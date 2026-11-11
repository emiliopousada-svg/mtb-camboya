'use strict';

const ROUTE_POI_MAX_PHOTOS = 5;
const ROUTE_POI_MAX_FILE_BYTES = 600 * 1024;
const ROUTE_POI_MAX_INPUT_BYTES = 20 * 1024 * 1024;
let activeRoutePoiMarkers = null;

function routePoiCoordinatesValid(poi) {
    return poi && Number.isFinite(poi.lat) && poi.lat >= -90 && poi.lat <= 90
        && Number.isFinite(poi.lng) && poi.lng >= -180 && poi.lng <= 180;
}

function routePoiImageFromFile(file) {
    return new Promise((resolve, reject) => {
        if (typeof createImageBitmap === 'function') {
            createImageBitmap(file).then(resolve, reject);
            return;
        }
        const url = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
            URL.revokeObjectURL(url);
            resolve(image);
        };
        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('No se pudo abrir la imagen.'));
        };
        image.src = url;
    });
}

function routePoiCanvasBlob(canvas, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (blob) resolve(blob);
            else reject(new Error('No se pudo preparar la foto.'));
        }, 'image/jpeg', quality);
    });
}

async function prepareRoutePoiPhoto(file) {
    if (!file || !file.type || !file.type.startsWith('image/')) {
        throw new Error('Elige una imagen válida.');
    }
    if (file.size > ROUTE_POI_MAX_INPUT_BYTES) {
        throw new Error('La foto original supera el límite de 20 MB.');
    }
    const image = await routePoiImageFromFile(file);
    try {
        let scale = Math.min(1, 1440 / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        let blob = null;
        for (let attempt = 0; attempt < 8; attempt++) {
            canvas.width = Math.max(1, Math.round(image.width * scale));
            canvas.height = Math.max(1, Math.round(image.height * scale));
            const context = canvas.getContext('2d');
            if (!context) throw new Error('No se pudo preparar la foto.');
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            const quality = attempt < 3 ? 0.82 - attempt * 0.12 : 0.76;
            blob = await routePoiCanvasBlob(canvas, quality);
            if (blob.size <= ROUTE_POI_MAX_FILE_BYTES) return blob;
            scale *= 0.78;
        }
        if (!blob || blob.size > ROUTE_POI_MAX_FILE_BYTES) {
            throw new Error('No se pudo reducir la foto por debajo de 600 KB.');
        }
        return blob;
    } finally {
        if (typeof image.close === 'function') image.close();
    }
}

function routePoiPopupContent(poi, imageUrl) {
    const content = document.createElement('div');
    content.className = 'route-photo-popup';
    const title = document.createElement('strong');
    title.textContent = poi.caption || 'Foto de ruta';
    content.appendChild(title);
    if (imageUrl) {
        const image = document.createElement('img');
        image.src = imageUrl;
        image.alt = poi.caption || 'Foto del punto de ruta';
        image.loading = 'lazy';
        image.referrerPolicy = 'no-referrer';
        content.appendChild(image);
    }
    return content;
}

function createRoutePoiLayer(targetMap, pois) {
    const layer = L.layerGroup();
    const objectUrls = [];
    (Array.isArray(pois) ? pois : []).forEach(poi => {
        if (!routePoiCoordinatesValid(poi)) return;
        let imageUrl = typeof poi.photoUrl === 'string' && /^https:\/\//i.test(poi.photoUrl)
            ? poi.photoUrl
            : '';
        if (poi.photo instanceof Blob) {
            imageUrl = URL.createObjectURL(poi.photo);
            objectUrls.push(imageUrl);
        }
        const marker = L.marker([poi.lat, poi.lng], {
            title: poi.caption || 'Foto de ruta',
            alt: poi.caption || 'Foto de ruta',
            icon: L.divIcon({
                html: '📷',
                className: 'poi-icon route-photo-poi-icon',
                iconSize: [32, 32],
                iconAnchor: [16, 16]
            })
        });
        marker.bindPopup(routePoiPopupContent(poi, imageUrl), { maxWidth: 260 });
        marker.addTo(layer);
    });
    return {
        layer,
        addTo: () => { if (targetMap) layer.addTo(targetMap); },
        dispose: () => {
            if (targetMap && targetMap.hasLayer(layer)) targetMap.removeLayer(layer);
            objectUrls.forEach(url => URL.revokeObjectURL(url));
        }
    };
}

function showRoutePoisOnMap(pois) {
    if (activeRoutePoiMarkers) activeRoutePoiMarkers.dispose();
    activeRoutePoiMarkers = null;
    if (!map || !Array.isArray(pois) || !pois.length) return;
    activeRoutePoiMarkers = createRoutePoiLayer(map, pois);
    activeRoutePoiMarkers.addTo();
}

function dataUrlToRoutePoiBlob(value) {
    if (typeof value !== 'string' || !/^data:image\/jpeg;base64,/i.test(value)) return null;
    const encoded = value.slice(value.indexOf(',') + 1);
    const binary = atob(encoded);
    if (binary.length > ROUTE_POI_MAX_FILE_BYTES) return null;
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: 'image/jpeg' });
}

async function routePoisForSync(pois) {
    const result = [];
    for (const poi of Array.isArray(pois) ? pois : []) {
        if (!routePoiCoordinatesValid(poi) || !(poi.photo instanceof Blob)) continue;
        const photoData = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('No se pudo preparar una foto de ruta.'));
            reader.readAsDataURL(poi.photo);
        });
        result.push({
            lat: poi.lat,
            lng: poi.lng,
            caption: String(poi.caption || 'Foto de ruta').slice(0, 100),
            photoData
        });
    }
    return result;
}

function routePoisFromSync(pois) {
    if (!Array.isArray(pois)) return [];
    return pois.flatMap(poi => {
        if (!routePoiCoordinatesValid(poi)) return [];
        const photo = dataUrlToRoutePoiBlob(poi.photoData);
        return photo ? [{
            lat: poi.lat,
            lng: poi.lng,
            caption: String(poi.caption || 'Foto de ruta').slice(0, 100),
            photo
        }] : [];
    });
}
