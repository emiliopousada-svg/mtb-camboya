# App scripts

The HTML shell and styles live in `index.html` and `styles.css`. Runtime code is split by feature so changes to one area are easier to locate.

## Load order

The scripts are classic scripts loaded synchronously from `index.html`. Their order is intentional: they share the existing application state, and top-level functions remain available to the inline HTML handlers. Keep the order in `index.html` when moving code between files.

1. `config.js` — app configuration and shared utilities
2. `storage.js` — IndexedDB and elevation calculations
3. `navigation.js` and `state.js` — page navigation and shared app state
4. `offline-maps.js` — offline map tile storage and downloads
5. `map.js` — map setup, zoom/centre/orientation controls
6. `gps.js` and `recording.js` — location tracking and ride recording
7. `route-following.js`, `routes.js` and `route-files.js` — route guidance, saved rides and GPX/KML/GeoJSON import/export
8. `statistics-engine.js` and `stats.js` — pure activity calculations and statistics UI
9. `sensors.js`, `pois.js` and `groups.js` — Bluetooth sensors, shared map places and live group locations
10. `ui.js`, `cloud.js` and `community-routes.js` — app startup, account and route synchronization

The statistics engine reads saved GPS points without modifying them. Its focused regression tests run with `npm run test:statistics`.
The route-analysis view uses the engine's filtered GPS segments for Leaflet and keeps its map layers separate from the main map. Its elevation profile can be compared across two recorded activities and moves a marker to the selected GPS point; it uses the selected map style online and the existing IGN tile cache offline.
Evolution views group activities by their local start date, with weekly or monthly history and period comparisons. VAM includes only climbing elevation with valid timed GPS intervals. Personal records use available activity data only; time records exclude estimated moving times, longest sustained climb uses the engine's filtered GPS/elevation analysis, and segment records remain unavailable until the app has defined segments.
The sensor view reports only recorded heart rate, cadence, and power samples. Coggan power-zone time uses a user-configured FTP and valid adjacent GPS sensor readings; the FTP is stored locally, and power-zone times remain unavailable until it is configured.

## Screen and GPS power use

The Android activity keeps the display awake while the app is in the foreground. After five minutes without touch or keyboard input, it lowers the actual window brightness and shows a touch-to-wake layer; returning the app to the background restores the system brightness. Browsers use the Screen Wake Lock API and a dark overlay where native brightness control is unavailable.

The web GPS watch uses low-power mode while the app is idle, switches to fresh high-accuracy fixes while recording or following a route, and stops when the app is hidden outside a recording. During native background recording, the background watcher replaces the web watch and uses the same four-metre movement threshold as track sampling. Poor-accuracy fixes and impossible jumps remain excluded from recorded tracks.

`scripts/prepare-web.js` copies this directory into the Capacitor web bundle. The service worker precaches these files for PWA startup without a network connection.

## APK versions and updates

`package.json` is the single source of truth for the app version. Before publishing an APK update, increment its patch, minor, or major version. The web bundle and Android APK use that version. GitHub Actions also adds the workflow run number to Android's `versionCode`, so every CI build has a higher code while local builds continue to use the semantic-version code.

GitHub Actions signs APKs explicitly with the persistent keystore configured by the `DEBUG_KEYSTORE_B64` secret and checks the final APK certificate (`2b429c7f9244e5d45e11678939a420501ea8844d1da98e775281aa8fa6b6fd5f`). Keep that key unchanged for all future builds. Existing installations from builds #88, #108 and #109 use different certificates and must be uninstalled once before installing an APK signed with this official key; export or synchronize local routes first. A local debug build uses the machine's local debug keystore and cannot update an APK signed by the GitHub Actions keystore.
