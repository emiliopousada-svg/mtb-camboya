# Rutas de la comunidad

La app puede compartir una copia pública y reducida de una ruta grabada, separada de la ruta privada que sincroniza la cuenta. El catálogo usa una única colección PocketBase; guarda la provincia de cada ruta y permite buscar por cercanía y actividad.

## Instalar la colección en PocketBase

1. Haz una copia de seguridad de PocketBase.
2. En PocketBase Admin abre **Settings → Import collections** y selecciona `community_routes.json`.
3. Activa **Merge with the existing collections**.
4. En **Detected changes**, confirma que se va a añadir únicamente `community_routes`. Cancela si aparecen cambios para `users`, `routes`, grupos u otras colecciones existentes.
5. Importa y comprueba en **Collections** que `community_routes` tenga activas las reglas de acceso del esquema.

La regla de lectura deja ver públicamente solo registros con `published = true`; el autor también puede consultar sus propias rutas. Un envío nuevo debe tener el propietario autenticado y `published = true`, por lo que aparece en el catálogo inmediatamente. La app no permite cambiar el estado de publicación después de crear el registro.

## Publicación y moderación

Las rutas se publican automáticamente cuando su autor confirma el envío. Para moderar una ruta:

1. En PocketBase Admin abre **Collections → community_routes**.
2. Revisa el nombre, provincia y trazado en `trackJson`.
3. Para retirarla del catálogo, desactiva `published` o elimina el registro.

La moderación es posterior a la publicación. Los administradores pueden revisar el nombre, provincia y trazado, y retirar contenido inapropiado.

Las rutas enviadas antes de activar la publicación automática seguirán con `published = false`; actívalas manualmente una vez si quieres que aparezcan en el catálogo.

## Privacidad y datos

La app solo envía una copia para el catálogo después de que el usuario pulse **Publicar** y acepte la confirmación. Esa copia se publica inmediatamente, omite horas, fechas, pulso, velocidad y otros datos de sensores, recorta aproximadamente 150 metros de ambos extremos y simplifica el trazado. El track privado local y la sincronización personal no se modifican.

El recorte reduce la exposición de los puntos de salida y llegada, pero no garantiza anonimato: una ruta puede revelar lugares reconocibles. El usuario debe revisar y confirmar antes de enviarla.

El catálogo guarda título, provincia, tipo de actividad, distancia, desnivel, tiempo en movimiento cuando está disponible, trazado simplificado y propietario para gestión. La lectura pública está habilitada inmediatamente para cada ruta publicada. El detalle de cada ruta muestra un recorte del mapa con su trazado y las métricas disponibles. Fotos y comentarios quedan fuera de esta primera fase.

## Limitación de la primera fase

La provincia se elige manualmente al publicar; el sistema aún no la deduce automáticamente del recorrido. La búsqueda usa la ubicación GPS actual, un radio y el tipo de actividad. La base es una colección compartida con índice por provincia, no una base física separada para cada provincia.
