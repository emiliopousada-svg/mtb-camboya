// Service Worker de MTB CAMBOYA
// - Guarda la app y las librerías para que abra sin conexión.
// - Los mapas offline (teselas del IGN) se guardan en IndexedDB desde la propia aplicación.
const SHELL = 'mtb-shell-v5';

const SHELL_URLS = [
  './',
  'index.html',
  'manifest.json',
  'css/styles.css',
  'js/config.js',
  'js/utils.js',
  'js/state.js',
  'js/offline-maps.js',
  'js/map.js',
  'js/camino.js',
  'js/gps.js',
  'js/recording.js',
  'js/deviation.js',
  'js/routes.js',
  'js/gpx-io.js',
  'js/stats.js',
  'js/heart-rate.js',
  'js/pois.js',
  'js/group.js',
  'js/metrics.js',
  'js/cloud.js',
  'js/app.js',
  'estrella-galicia.svg',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/gh/tomickigrzegorz/leaflet-rotate@v0.3.0/dist/leaflet-rotate.umd.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL)
      .then(c => Promise.allSettled(SHELL_URLS.map(u => c.add(u))))
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
  if (url.origin === location.origin || url.hostname === 'unpkg.com' || url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(staleWhileRevalidate(req));
  }
});

async function staleWhileRevalidate(req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req);
  const net = fetch(req)
    .then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; })
    .catch(() => null);
  return hit || (await net) || Response.error();
}
