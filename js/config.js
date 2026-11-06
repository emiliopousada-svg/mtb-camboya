'use strict';

        // ============================================================
        //  CONFIGURACIÓN
        // ============================================================
        const APP_VERSION = '1.2.0'; // La compilación APK reemplaza esta versión por la del paquete.
        const DEFAULT_CLOUD_SERVER = 'https://vamp69.ddns.net';
        const MIN_STEP_M = 4;        // distancia mínima entre puntos grabados (filtra el ruido parado)
        const MAX_ACC_M = 30;        // se descartan fixes con peor precisión que esto
        const MAX_SPEED_MS = 25;     // 90 km/h: por encima es un salto de GPS
        const ELEV_STEP = 3;         // metros mínimos para contar una subida
        const OFFROUTE_M = 60;       // aviso de desvío
        const BACKONROUTE_M = 30;    // se considera que has vuelto a la ruta
        const ACTIVITY_TYPES = {
            mtb: { label: 'MTB', icon: '🚵' },
            road: { label: 'Carretera', icon: '🚴' },
            hiking: { label: 'Senderismo', icon: '🥾' },
            running: { label: 'Correr', icon: '🏃' },
            walking: { label: 'Paseo', icon: '🚶' }
        };
        const CAMINO_ROUTES = {
            frances: { name: 'Camino Francés', alberguePaths: ['frances'], trackKey: 'frances' },
            portugues: { name: 'Camino Portugués', alberguePaths: ['portugues'], trackKey: 'portugues' },
            'portugues-costa': { name: 'Camino Portugués por la Costa', alberguePaths: ['portugues-costa'], trackKey: 'portugues-costa' },
            primitivo: { name: 'Camino Primitivo', alberguePaths: ['primitivo'], trackKey: 'primitivo' },
            norte: { name: 'Camino del Norte', alberguePaths: ['norte'], trackKey: 'norte' },
            ingles: { name: 'Camino Inglés', alberguePaths: ['ingles'], trackKey: 'ingles' },
            fisterra: { name: 'Camino de Fisterra y Muxía', alberguePaths: ['fisterra-muxia'], trackKey: 'fisterra' },
            invierno: { name: 'Camino de Invierno', alberguePaths: ['invierno'], trackKey: 'invierno' },
            plata: { name: 'Vía de la Plata', alberguePaths: ['via-de-la-plata', 'via-de-la-plata-verin'], trackKey: 'plata' },
            'plata-verin': { name: 'Vía de la Plata por Verín', alberguePaths: ['via-de-la-plata-verin'], trackKey: 'plata-verin' }
        };
        const GUIDE_IDS = new Set(['frances', 'portugues', 'primitivo', 'norte', 'ingles', 'fisterra']);
        const CAMINO_VISUALS = {
            frances: { icon: '✺', color: '#f0a51b' },
            portugues: { icon: '✺', color: '#59a83f' },
            'portugues-costa': { icon: '✺', color: '#14a5a9' },
            primitivo: { icon: '✺', color: '#a24fce' },
            norte: { icon: '✺', color: '#2775dc' },
            ingles: { icon: '✺', color: '#56a94b' },
            fisterra: { icon: '✺', color: '#09a69b' },
            invierno: { icon: '✺', color: '#d59c08' },
            plata: { icon: '✺', color: '#327fe4' },
            'plata-verin': { icon: '✺', color: '#ea7b22' }
        };
        const CAMINO_FAVORITES_KEY = 'mtb_camino_favorites';
        const CAMINO_SERVICE_CATEGORIES = {
            restaurant: { emoji: '🍴', label: 'Restaurante' },
            bicycle: { emoji: '🔧', label: 'Taller de bicicletas' },
            landmark: { emoji: '⛪', label: 'Monumento o iglesia' },
            fountain: { emoji: '💧', label: 'Fuente' },
            supermarket: { emoji: '🛒', label: 'Supermercado' },
            medical: { emoji: '🏥', label: 'Centro médico' },
            pharmacy: { emoji: '💊', label: 'Farmacia' },
            atm: { emoji: '🏧', label: 'Cajero automático' },
            transport: { emoji: '🚌', label: 'Transporte' }
        };
        const CAMINO_FILTER_GROUPS = {
            albergue: { emoji: '🛏️', label: 'Albergues', cats: [] },
            water: { emoji: '💧', label: 'Fuentes', cats: ['fountain'] },
            pharmacy: { emoji: '💊', label: 'Farmacias', cats: ['pharmacy', 'medical'] },
            food: { emoji: '🍴', label: 'Comida', cats: ['restaurant', 'supermarket'] },
            atm: { emoji: '🏧', label: 'Cajeros', cats: ['atm'] },
            transport: { emoji: '🚌', label: 'Transporte', cats: ['transport'] },
            other: { emoji: '⛪', label: 'Otros', cats: ['bicycle', 'landmark'] }
        };
        const CAMINO_FILTERS_KEY = 'mtb_camino_filters';
        const CAMINO_DATA_REMOTE = 'https://raw.githubusercontent.com/emiliopousada-svg/mtb-camboya/main/data/camino/';
        const CAMINO_TILE_CORRIDOR_M = 5000;
        const CAMINO_TILE_MIN_ZOOM = 10, CAMINO_TILE_MAX_ZOOM = 14;

