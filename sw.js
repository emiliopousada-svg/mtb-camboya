// Service Worker de MTB CAMBOYA
// - Guarda la app y las librerías para que abra sin conexión.
// - Guarda las teselas del mapa que ya has visto (no descarga zonas enteras).
const SHELL = 'mtb-shell-v2';
const TILES = 'mtb-tiles-v1';
const MAX_TILES = 2000;

const SHELL_URLS = [
  './',
  'index.html',
  'manifest.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
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
      .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== TILES).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname.endsWith('tile.opentopomap.org')) {
    e.respondWith(tileCacheFirst(req));
  } else if (url.origin === location.origin || url.hostname === 'unpkg.com' || url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(staleWhileRevalidate(req));
  }
});

async function tileCacheFirst(req) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  try {
    // Con CORS podemos guardar la respuesta real (las "opacas" ocupan muchísima cuota)
    const res = await fetch(req.url, { mode: 'cors' });
    if (res.ok) {
      cache.put(req.url, res.clone());
      trimCache(cache);
    }
    return res;
  } catch (err) {
    try { return await fetch(req); } catch (err2) { return Response.error(); }
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req);
  const net = fetch(req)
    .then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; })
    .catch(() => null);
  return hit || (await net) || Response.error();
}

async function trimCache(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_TILES) {
    await Promise.all(keys.slice(0, keys.length - MAX_TILES).map(k => cache.delete(k)));
  }
}
