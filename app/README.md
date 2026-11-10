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
8. `stats.js` and `sensors.js` — ride statistics and Bluetooth sensors
9. `pois.js` and `groups.js` — shared map places and live group locations
10. `ui.js` and `cloud.js` — app startup, account and route synchronization

`scripts/prepare-web.js` copies this directory into the Capacitor web bundle. The service worker precaches these files for PWA startup without a network connection.

## APK versions and updates

`package.json` is the single source of truth for the app version. Before publishing an APK update, increment its patch, minor, or major version. The web bundle and Android APK use that version. GitHub Actions also adds the workflow run number to Android's `versionCode`, so every CI build has a higher code while local builds continue to use the semantic-version code.

GitHub Actions signs APKs explicitly with the persistent keystore configured by the `DEBUG_KEYSTORE_B64` secret and checks the final APK certificate (`2b429c7f9244e5d45e11678939a420501ea8844d1da98e775281aa8fa6b6fd5f`). Keep that key unchanged for all future builds. Existing installations from builds #88, #108 and #109 use different certificates and must be uninstalled once before installing an APK signed with this official key; export or synchronize local routes first. A local debug build uses the machine's local debug keystore and cannot update an APK signed by the GitHub Actions keystore.
