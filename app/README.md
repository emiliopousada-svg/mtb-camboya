# App scripts

The HTML shell and styles live in `index.html` and `styles.css`. Runtime code is split by feature so changes to one area are easier to locate.

## Load order

The scripts are classic scripts loaded synchronously from `index.html`. Their order is intentional: they share the existing application state, and top-level functions remain available to the inline HTML handlers. Keep the order in `index.html` when moving code between files.

1. `config.js` — app configuration and shared utilities
2. `storage.js` — IndexedDB and elevation calculations
3. `navigation.js` and `state.js` — page navigation and shared app state
4. `offline-maps.js` — offline map tile storage and downloads
5. `map.js` and `camino-data.js` — map setup, places, Camino data and services
6. `camino-guide.js` — Camino guidance, stage selection and downloads
7. `gps.js` and `recording.js` — location tracking and ride recording
8. `route-following.js`, `routes.js` and `route-files.js` — route guidance, saved rides and GPX/KML/GeoJSON import/export
9. `stats.js` and `sensors.js` — ride statistics and Bluetooth sensors
10. `pois.js` and `groups.js` — shared map places and live group locations
11. `ui.js` and `cloud.js` — app startup, account and route synchronization

`scripts/prepare-web.js` copies this directory into the Capacitor web bundle. The service worker precaches these files for PWA startup without a network connection.
