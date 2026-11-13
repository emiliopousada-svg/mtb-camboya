# Rutas de la comunidad

La app puede compartir una copia pública y reducida de una ruta grabada, separada de la ruta privada que sincroniza la cuenta. El catálogo usa una única colección PocketBase; guarda la provincia de cada ruta y permite buscar por cercanía, actividad y apodo de usuario.

## Instalar la colección en PocketBase

1. Haz una copia de seguridad de PocketBase.
2. En PocketBase Admin abre **Settings → Import collections** y selecciona `community_routes.json`.
3. Activa **Merge with the existing collections**.
4. En **Detected changes**, al instalar por primera vez confirma que se va a añadir únicamente `community_routes`. Si ya existe, acepta solo la incorporación de los campos opcionales `poisJson`, `poiPhotos`, `locality`, `description`, `difficulty` y `performedAt`, y los índices de localidad y límites geográficos; cancela si se propone reemplazar o borrar colecciones existentes.
5. Importa y comprueba en **Collections** que `community_routes` tenga activas las reglas de acceso del esquema y los campos de POI, localidad, descripción y dificultad.
6. Copia `pb_hooks/community_routes.pb.js` al directorio `pb_hooks` de PocketBase y reinicia PocketBase para calcular los límites geográficos.

El catálogo pagina metadatos por zona y descarga los trazados completos solo para un conjunto acotado de candidatos; las rutas antiguas sin límites usan un fallback limitado.

La regla de lectura deja ver públicamente solo registros con `published = true`; el autor también puede consultar sus propias rutas. Un envío nuevo debe tener el propietario autenticado y `published = true`, por lo que aparece en el catálogo inmediatamente. La app no permite cambiar el estado de publicación después de crear el registro.

La regla `deleteRule` debe ser `owner = @request.auth.id`. Así, únicamente la cuenta que publicó la ruta puede borrarla, también si intenta hacerlo directamente mediante la API. En el catálogo, la app muestra la acción **Eliminar** solo al autor autenticado. El borrado de la publicación no elimina copias que otros usuarios ya guardaron en sus dispositivos.

## Publicación y moderación

Las rutas se publican automáticamente cuando su autor confirma el envío. Para moderar una ruta:

1. En PocketBase Admin abre **Collections → community_routes**.
2. Revisa el nombre, provincia y trazado en `trackJson`.
3. Para retirarla del catálogo, desactiva `published` o elimina el registro.

La moderación es posterior a la publicación. Los administradores pueden revisar el nombre, provincia y trazado, y retirar contenido inapropiado.

Las rutas enviadas antes de activar la publicación automática seguirán con `published = false`; actívalas manualmente una vez si quieres que aparezcan en el catálogo.

## Privacidad y datos

La app solo envía una copia para el catálogo después de que el usuario pulse **Publicar** y acepte la confirmación. Esa copia se publica inmediatamente, incluye el día de realización cuando puede recuperarse de la actividad y omite la hora, el pulso, la velocidad y otros datos de sensores. También recorta aproximadamente 150 metros de ambos extremos y simplifica el trazado. Si la ruta ya estaba vinculada a una publicación, se actualiza esa ficha; si el registro ya no existe, se crea una nueva publicación. Localidad, descripción y dificultad son datos aportados manualmente; la dificultad es subjetiva. Las fotos se comprimen en el dispositivo a un máximo de 600 KB en JPEG, eliminando metadatos incrustados; cada ruta admite hasta 5 fotos. Se excluyen del envío las fotos situadas a menos de 150 metros de los extremos del trazado original. Aun así, las fotos y las coordenadas de sus POI son públicas y pueden identificar lugares; el usuario debe revisarlas antes de confirmar. El track privado local y la sincronización personal no se publican.

El recorte reduce la exposición de los puntos de salida y llegada, pero no garantiza anonimato: una ruta puede revelar lugares reconocibles. El usuario debe revisar y confirmar antes de enviarla.

El catálogo guarda título, provincia, localidad (si existe en una publicación anterior), descripción, dificultad percibida, tipo de actividad, fecha de realización (solo el día), distancia, desnivel, tiempo en movimiento cuando está disponible, trazado simplificado, POI con fotos y propietario para gestión. El contador de **Comunidad** refleja las rutas válidas que aparecen en la búsqueda o lista actual y se actualiza al recargar el catálogo; las rutas descargadas se guardan como tracks importados en **Guardadas**. La lectura pública está habilitada inmediatamente para cada ruta publicada. La búsqueda permite filtrar por localidad/provincia, apodo de usuario o cercanía GPS, actividad, dificultad y desnivel positivo. El formulario actual no solicita ni envía localidad; el filtro sigue disponible para publicaciones anteriores que ya tengan ese dato. El filtro de usuario usa `users.nickname`, que debe estar configurado como se explica en `CONFIGURAR-PERFIL-USUARIO.md`. El detalle muestra mapa, distancia desde tu posición, fecha de realización, provincia, distancia, desnivel, valoraciones, comentarios y las mejores marcas voluntarias publicadas con apodo; al seguirla, los POI con foto aparecen como marcadores en el mapa.

## Limitación de la primera fase

La provincia se elige manualmente al publicar; el sistema aún no la deduce automáticamente del recorrido. El formulario ya no solicita localidad. La búsqueda usa la ubicación GPS actual, un radio y el tipo de actividad. La base es una colección compartida con índice por provincia, no una base física separada para cada provincia.

## Segmentos personales y clasificaciones por tiempo

La app puede usar colecciones adicionales para segmentos, mejores marcas, valoraciones, comentarios y favoritos. Si todavía no tienes las colecciones de segmentos y marcas, importa `community_performance.json` con **Merge with the existing collections** y revisa todos los cambios detectados antes de confirmar.

Si ya tienes `community_segments`, `community_route_efforts` y `community_segment_efforts`, pero solo te faltan valoraciones, comentarios y favoritos, usa el archivo más pequeño `community_social.json` para no proponer cambios a esas colecciones existentes:

1. Haz una copia de seguridad de PocketBase.
2. En **Settings → Import collections**, importa `community_social.json` y activa **Merge with the existing collections**.
3. Comprueba que PocketBase detecta solo tres colecciones nuevas: `community_route_ratings`, `community_route_comments` y `community_route_favorites`. Cancela si aparecen cambios en colecciones existentes.
4. Tras importar, comprueba que las valoraciones y comentarios solo se leen para rutas publicadas y que cada usuario solo ve sus favoritos.

La app usa el apodo que el usuario confirma para comentarios y marcas; no envía el correo ni adjunta la actividad GPS. Las valoraciones permiten una puntuación de 1 a 5 por usuario y ruta; los comentarios admiten hasta 500 caracteres y el autor puede borrarlos. Los favoritos son privados por cuenta. La hora se calcula localmente a partir de los tiempos GPS y la geometría del trazado, y se enseña al usuario antes de publicarla. Cada usuario conserva una mejor marca por ruta y por segmento. Los tiempos son marcas comunitarias basadas en GPS del dispositivo, no resultados verificados contra fraude por el servidor.

Los cambios del cliente no instalan estas colecciones por sí solos. Hasta importar el esquema en el servidor, el catálogo actual de rutas sigue funcionando, pero las nuevas funciones compartidas no podrán guardar ni leer segmentos y clasificaciones.
