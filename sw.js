// Service Worker de MTB CAMBOYA
// - Guarda la app y las librerías para que abra sin conexión.
// - Los mapas offline (teselas del IGN) se guardan en IndexedDB desde la propia aplicación.
// prepare-web.js sustituye el marcador con la versión de package.json.
const SHELL = 'mtb-shell-v__APP_VERSION__-v2';

const SHELL_URLS = [
  './',
  'index.html',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'estrella-galicia.svg',
  'app/styles.css',
  'app/config.js',
  'app/storage.js',
  'app/navigation.js',
  'app/state.js',
  'app/offline-maps.js',
  'app/map.js',
  'app/route-photos.js',
  'app/account-avatar.js',
  'app/gps.js',
  'app/recording.js',
  'app/route-following.js',
  'app/routes.js',
  'lib/fit.js',
  'app/route-files.js',
  'app/statistics-engine.js',
  'app/community-performance.js',
  'app/stats.js',
  'app/sensors.js',
  'app/pois.js',
  'app/groups.js',
  'app/ui.js',
  'lib/native-app.js',
  'app/cloud.js',
  'app/community-routes.js',
  'app/screen-activity.js',
  'app/back-button.js',
  'lib/ble.js',
  'lib/leaflet/leaflet.css',
  'lib/leaflet/leaflet.js',
  'lib/leaflet/leaflet-rotate.umd.min.js',
  'lib/leaflet/images/layers.png',
  'lib/leaflet/images/layers-2x.png',
  'lib/leaflet/images/marker-icon.png',
  'lib/leaflet/images/marker-icon-2x.png',
  'lib/leaflet/images/marker-shadow.png',
  'lib/chart.umd.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/gh/tomickigrzegorz/leaflet-rotate@v0.3.0/dist/leaflet-rotate.umd.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js'
];

const APP_SCOPE = new URL(self.registration.scope);
const APP_PATHS = new Set(SHELL_URLS
  .filter(url => !/^https?:\/\//i.test(url))
  .map(url => new URL(url, APP_SCOPE).pathname));

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL)
      .then(cache => Promise.allSettled(SHELL_URLS.map(async url => {
        const response = await fetch(url);
        if (isCacheableResponse(response)) await cache.put(url, response);
      })))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (isAppRequest(req, url)) {
    e.respondWith(networkFirst(req));
  } else if (url.hostname === 'unpkg.com' || url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(staleWhileRevalidate(req));
  }
});

function isAppRequest(req, url) {
  if (url.origin !== APP_SCOPE.origin || isExcludedAppPath(url)) return false;
  if (url.search || req.cache === 'no-store' || req.headers.has('authorization')) return false;
  if (req.mode === 'navigate') {
    return url.pathname === APP_SCOPE.pathname
      || url.pathname === new URL('index.html', APP_SCOPE).pathname;
  }
  return APP_PATHS.has(url.pathname);
}

function isExcludedAppPath(url) {
  const relativePath = url.pathname.startsWith(APP_SCOPE.pathname)
    ? url.pathname.slice(APP_SCOPE.pathname.length)
    : url.pathname;
  return relativePath.split('/').some(segment => /^(api|auth|oauth|login|logout)$/i.test(segment));
}

function isCacheableResponse(response) {
  if (!response || !response.ok || response.headers.get('Vary') === '*') return false;
  const cacheControl = response.headers.get('Cache-Control') || '';
  return !/(?:^|,)\s*(?:private|no-store)(?:\s|=|,|$)/i.test(cacheControl);
}

async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  try {
    const response = await fetch(req);
    if (isCacheableResponse(response)) await cache.put(req, response.clone());
    return response;
  } catch (error) {
    return (await cache.match(req)) || Response.error();
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req);
  const net = fetch(req)
    .then(res => { if (isCacheableResponse(res)) cache.put(req, res.clone()); return res; })
    .catch(() => null);
  return hit || (await net) || Response.error();
}
