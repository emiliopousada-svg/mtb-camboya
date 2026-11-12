# MTB Camboya

Aplicación para registrar, seguir y analizar actividades al aire libre, con especial atención al ciclismo de montaña (MTB). Incluye mapas sin conexión, navegación GPS, estadísticas, sensores Bluetooth y funciones sociales para compartir rutas y rodar en grupo.

## Características principales

### Registro y navegación GPS
- Grabación de actividades con GPS.
- Seguimiento de rutas y avisos cuando te alejas del recorrido.
- Orientación del mapa y funciones para mantener la pantalla activa durante la actividad.
- Compatibilidad con actividades de MTB, ciclismo de carretera, senderismo, carrera y caminata.
- En Android, soporte de geolocalización en segundo plano y avisos relacionados con la batería.

### Rutas y mapas
- Guardar y consultar rutas.
- Importar archivos GPX, KML y GeoJSON.
- Exportar recorridos en formato GPX.
- La importación admite archivos de hasta 10 MB y tracks de hasta 100.000 puntos.
- Mapas y zonas descargables para utilizarlos sin conexión.
- Capas y proveedores cartográficos como OpenTopoMap, CyclOSM, OpenStreetMap, Esri Satellite e IGN.

### Estadísticas
- Resúmenes de actividad y gráficos por semana, mes y año.
- Datos de distancia, duración, velocidad y desnivel.
- Historial de actividades para consultar la evolución del entrenamiento.

### Sensores
- Conexión con sensores Bluetooth Low Energy (BLE) compatibles, como frecuencia cardíaca, cadencia, potencia y velocidad.

### Grupos y comunidad
- Funciones para crear o unirse a grupos y compartir ubicaciones en directo.
- Invitaciones, apodos y controles de administración del grupo.
- Publicación y descubrimiento de rutas de la comunidad, con filtros por actividad, provincia y distancia.
- Captura de fotos geolocalizadas durante una ruta; al publicar en Comunidad, se pueden compartir como POI visibles al seguirla.
- Para proteger la privacidad, la aplicación recorta aproximadamente 150 metros de cada extremo de las rutas comunitarias publicadas. Esto reduce la exposición de los puntos de inicio y final, pero no garantiza el anonimato.

### Almacenamiento y sincronización
- Almacenamiento local mediante IndexedDB.
- Sincronización de cuenta y datos en la nube mediante una API basada en PocketBase.
- Las rutas grabadas sin conexión quedan pendientes de sincronizar al recuperar la conexión; consulta [CONFIGURAR-SINCRONIZACION.md](CONFIGURAR-SINCRONIZACION.md) para habilitar el apodo de autor en PocketBase.
- Peso y edad sincronizados con la cuenta para estimar calorías y frecuencia cardíaca máxima; consulta [CONFIGURAR-PERFIL.md](CONFIGURAR-PERFIL.md) para añadir los campos de PocketBase.
- Aplicación web progresiva (PWA), con recursos preparados para uso sin conexión.

## Tecnologías

| Área | Tecnología |
| --- | --- |
| Interfaz | HTML, CSS y JavaScript |
| Mapas | Leaflet |
| Gráficos | Chart.js |
| Aplicación Android | Capacitor 8 |
| Datos locales | IndexedDB |
| Sincronización | PocketBase |
| Compilación web | esbuild |
| Automatización | GitHub Actions |

## Estructura del proyecto

```text
mtb-camboya/
├── .github/
│   └── workflows/
│       └── build-apk.yml
├── android/              # Proyecto Android / Capacitor
├── android-res/          # Recursos Android
├── app/                  # Código y módulos de la aplicación
├── scripts/              # Scripts de preparación y compilación
├── src/                  # Código fuente adicional
├── vendor/               # Dependencias o recursos incluidos
├── index.html
├── manifest.json
├── sw.js                 # Service worker
├── capacitor.config.*
├── package.json
└── package-lock.json
```

## Requisitos

- Node.js (el flujo de GitHub Actions utiliza Node 22).
- npm.
- Para compilar Android: Android Studio y un entorno Android compatible con Capacitor 8.
- Java 21 para el flujo de compilación Android utilizado en GitHub Actions.

## Instalación y ejecución

Clona el repositorio e instala las dependencias:

```bash
git clone https://github.com/emiliopousada-svg/mtb-camboya.git
cd mtb-camboya
npm ci
```

Prepara los recursos web:

```bash
npm run prepare-web
```

Los comandos disponibles pueden consultarse en `package.json`:

```bash
npm run
```

## Compilar para Android

Para preparar la aplicación web y sincronizar los recursos con Android:

```bash
npm run build
```

También puedes ejecutar los pasos por separado:

```bash
npm run prepare-web
npx cap sync android
```

Abre el proyecto Android:

```bash
npx cap open android
```

Para generar un APK de depuración desde la terminal:

**Linux / macOS**
```bash
cd android
./gradlew assembleDebug
```

**Windows**
```bat
cd android
gradlew.bat assembleDebug
```

El APK de depuración se genera normalmente en:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## Compilación automática

El repositorio incluye un flujo de GitHub Actions en `.github/workflows/build-apk.yml` para automatizar la compilación del APK. El flujo utiliza Node.js 22 y Java 21, firma explícitamente con `DEBUG_KEYSTORE_B64`, comprueba el certificado del APK final y aumenta `versionCode` en cada ejecución. La firma oficial para las nuevas builds es `2b429c7f9244e5d45e11678939a420501ea8844d1da98e775281aa8fa6b6fd5f`. Las instalaciones anteriores (#88, #108 y #109) deben desinstalarse una vez antes de instalar una APK con esta firma; exporta o sincroniza las rutas locales antes de hacerlo.

Consulta la pestaña **Actions** del repositorio para ver las ejecuciones y sus resultados.

## Uso sin conexión

La aplicación incorpora una PWA y mecanismos de caché para facilitar el uso sin conexión. Para navegar sin cobertura, descarga previamente las zonas o paquetes de mapas que necesites y comprueba que la región está disponible antes de iniciar la actividad.

Cada descarga regional está limitada a 25.000 teselas y el dispositivo conserva hasta 30.000 teselas IGN descargadas. Las cachés automáticas de IGN y de mapas online conservan hasta 2.500 teselas cada una y eliminan las más antiguas; estas cachés no sustituyen a una descarga regional.

Durante una grabación larga, el trazado del mapa se dibuja en segmentos acotados para reducir el coste de actualización. Se intenta guardar el borrador cada 30 segundos y también al pausar o dejar la aplicación; una interrupción brusca puede perder los puntos posteriores al último guardado.

La disponibilidad sin conexión puede variar según el mapa, el espacio disponible, los datos descargados y las funciones que necesiten conexión con los servicios en la nube.

## Privacidad

- Revisa los permisos de ubicación antes de utilizar el registro GPS.
- Las funciones de ubicación compartida en grupos transmiten información de posición a otros miembros del grupo.
- Las rutas publicadas en la comunidad se recortan en sus extremos para reducir la exposición de los puntos de salida y llegada; aun así, conviene revisar cada recorrido antes de publicarlo.
- La sincronización y las funciones comunitarias pueden requerir conexión a Internet.

## Estado del proyecto

Versión indicada en el proyecto: **1.2.1**.

Este README describe las funciones y los comandos identificados en el código del repositorio. Algunas funciones pueden depender de la configuración del servidor, los permisos del dispositivo, los sensores compatibles o la disponibilidad de servicios externos.

## Repositorio

[https://github.com/emiliopousada-svg/mtb-camboya](https://github.com/emiliopousada-svg/mtb-camboya)
