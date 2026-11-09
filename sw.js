// Service Worker de MTB CAMBOYA
// - Guarda la app y las librerías para que abra sin conexión.
// - Los mapas offline (teselas del IGN) se guardan en IndexedDB desde la propia aplicación.
const SHELL = 'mtb-shell-v11';

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
  'app/gps.js',
  'app/recording.js',
  'app/route-following.js',
  'app/routes.js',
  'app/route-files.js',
  'app/stats.js',
  'app/sensors.js',
  'app/pois.js',
  'app/groups.js',
  'app/ui.js',
  'app/cloud.js',
  'app/community-routes.js',
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
