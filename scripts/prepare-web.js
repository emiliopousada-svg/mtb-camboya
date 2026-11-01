// Prepara la carpeta www/ que empaqueta Capacitor dentro del APK.
// Copia la app y sustituye los enlaces a CDN por copias locales,
// para que el APK no dependa de internet para arrancar.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const www = path.join(root, 'www');
const nm = path.join(root, 'node_modules');

fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(path.join(www, 'lib', 'leaflet'), { recursive: true });

for (const f of ['index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'estrella-galicia.svg']) {
  fs.copyFileSync(path.join(root, f), path.join(www, f));
}
// sw.js no se copia: dentro del APK los archivos ya van empaquetados.

fs.copyFileSync(path.join(nm, 'leaflet/dist/leaflet.css'), path.join(www, 'lib/leaflet/leaflet.css'));
fs.copyFileSync(path.join(nm, 'leaflet/dist/leaflet.js'), path.join(www, 'lib/leaflet/leaflet.js'));
fs.cpSync(path.join(nm, 'leaflet/dist/images'), path.join(www, 'lib/leaflet/images'), { recursive: true });
fs.copyFileSync(path.join(nm, 'chart.js/dist/chart.umd.js'), path.join(www, 'lib/chart.umd.js'));

// El módulo BLE usa imports de npm: se empaqueta como script clásico para Capacitor.
require('esbuild').buildSync({
  entryPoints: [path.join(root, 'src', 'ble.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2019',
  outfile: path.join(www, 'lib/ble.js')
});

const file = path.join(www, 'index.html');
let html = fs.readFileSync(file, 'utf8');
const swaps = [
  ['https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'lib/leaflet/leaflet.css'],
  ['https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', 'lib/leaflet/leaflet.js'],
  ['https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js', 'lib/chart.umd.js']
];
for (const [from, to] of swaps) {
  if (!html.includes(from)) throw new Error('No encuentro este enlace en index.html: ' + from);
  html = html.split(from).join(to);
}
fs.writeFileSync(file, html);
console.log('www listo');
