# Rutas de la comunidad

La app puede compartir una copia pública y reducida de una ruta grabada, separada de la ruta privada que sincroniza la cuenta. El catálogo usa una única colección PocketBase; guarda la provincia de cada ruta y permite buscar por cercanía y actividad.

## Instalar la colección en PocketBase

1. Haz una copia de seguridad de PocketBase.
2. En PocketBase Admin abre **Settings → Import collections** y selecciona `community_routes.json`.
3. Activa **Merge with the existing collections**.
4. En **Detected changes**, confirma que solo se añade o actualiza `community_routes`. Cancela si aparecen cambios para `users`, `routes`, grupos u otras colecciones existentes.
5. Importa y comprueba en **Collections** que `community_routes` tenga activas las reglas de acceso del esquema.
6. Copia `pb_hooks/community_routes.pb.js` al directorio `pb_hooks` de PocketBase y reinicia PocketBase. El hook calcula los límites geográficos del trazado para que las búsquedas filtren por zona en el servidor.

El catálogo pagina metadatos que intersectan el radio de búsqueda y descarga el trazado completo solo para un máximo de 40 candidatos, o hasta tener las 15 rutas más cercanas. Las rutas antiguas sin límites geográficos se consultan mediante un fallback acotado a las 100 más recientes; al volver a guardarlas en PocketBase, el hook calcula sus límites.

La regla de lectura deja ver públicamente solo registros con `published = true`; el autor también puede consultar sus propias rutas. Un envío nuevo debe tener el propietario autenticado y `published = true`, por lo que aparece en el catálogo inmediatamente. La app no permite cambiar el estado de publicación después de crear el registro.

La regla `deleteRule` debe ser `owner = @request.auth.id`. Así, únicamente la cuenta que publicó la ruta puede borrarla, también si intenta hacerlo directamente mediante la API. En el catálogo, la app muestra la acción **Eliminar** solo al autor autenticado. El borrado de la publicación no elimina copias que otros usuarios ya guardaron en sus dispositivos.

### Rutas privadas sincronizadas

En la colección privada `routes`, configura `updateRule` como `owner = @request.auth.id && @request.body.owner:changed = false` para que una actualización no pueda transferir la propiedad de la ruta.

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

## Segmentos personales y clasificaciones por tiempo

La app puede preparar tres colecciones adicionales para guardar segmentos públicos dibujados sobre una ruta comunitaria y la mejor marca de cada usuario para la ruta o un segmento:

1. Haz una copia de seguridad de PocketBase.
2. En **Settings → Import collections**, importa `community_performance.json` y activa **Merge with the existing collections**.
3. Antes de confirmar, comprueba que solo se añaden `community_segments`, `community_route_efforts` y `community_segment_efforts`; cancela si se proponen cambios a colecciones existentes.
4. Comprueba en **Collections** que las reglas permiten ver marcas solo de rutas publicadas y que cada usuario solo puede modificar o borrar sus propios registros.

5. Copia `pb_hooks/community_performance.pb.js` al directorio `pb_hooks` de PocketBase y reinicia PocketBase. El servidor sustituye el alias del cliente por uno estable derivado de la cuenta y rechaza tiempos enteros fuera del rango permitido o físicamente incompatibles con la distancia declarada.

La app no envía el correo ni adjunta la actividad GPS. El servidor asigna un alias estable derivado de la cuenta. La hora se calcula localmente a partir de los tiempos GPS y la geometría del trazado, y se enseña al usuario antes de publicarla. Cada usuario conserva una mejor marca por ruta y por segmento. El servidor comprueba un límite físico mínimo contra la distancia declarada, pero los tiempos siguen siendo autodeclarados y no se pueden certificar sin recibir y verificar una fuente de datos confiable.

Los cambios del cliente no instalan estas colecciones por sí solos. Hasta importar el esquema en el servidor, el catálogo actual de rutas sigue funcionando, pero las nuevas funciones compartidas no podrán guardar ni leer segmentos y clasificaciones.
