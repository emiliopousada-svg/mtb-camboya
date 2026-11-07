# Rutas de la comunidad

La app puede compartir una copia pública y reducida de una ruta grabada, separada de la ruta privada que sincroniza la cuenta. El catálogo usa una única colección PocketBase, filtrada por provincia.

## Instalar la colección en PocketBase

1. Haz una copia de seguridad de PocketBase.
2. En PocketBase Admin abre **Settings → Import collections** y selecciona `community_routes.json`.
3. Activa **Merge with the existing collections**.
4. En **Detected changes**, confirma que se va a añadir únicamente `community_routes`. Cancela si aparecen cambios para `users`, `routes`, grupos u otras colecciones existentes.
5. Importa y comprueba en **Collections** que `community_routes` tenga activas las reglas de acceso del esquema.

La regla de lectura deja ver públicamente solo registros con `published = true`; el autor puede consultar sus propios envíos pendientes. Un envío nuevo debe tener el propietario autenticado y `published = false`. El cliente no puede aprobarlo: las reglas impiden cambiar ese campo desde la app.

## Revisión y publicación

Los envíos quedan pendientes. Antes de mostrarlos a todos:

1. En PocketBase Admin abre **Collections → community_routes**.
2. Revisa el nombre, provincia y trazado en `trackJson`.
3. Si es apropiado, cambia `published` a verdadero y guarda. Para retirarlo, desactiva el campo o elimina el registro.

En esta primera fase la revisión es manual. No se publica automáticamente contenido de usuarios.

## Privacidad y datos

La app solo envía una copia para el catálogo después de que el usuario pulse **Publicar** y acepte la confirmación. Esa copia omite horas, fechas, pulso, velocidad y otros datos de sensores, recorta aproximadamente 150 metros de ambos extremos y simplifica el trazado. El track privado local y la sincronización personal no se modifican.

El recorte reduce la exposición de los puntos de salida y llegada, pero no garantiza anonimato: una ruta puede revelar lugares reconocibles. El usuario debe revisar y confirmar antes de enviarla.

El catálogo guarda título, provincia, tipo de actividad, distancia, desnivel, trazado simplificado y propietario para gestión. La lectura pública solo está habilitada después de la aprobación administrativa. Fotos y comentarios quedan fuera de esta primera fase.

## Limitación de la primera fase

La provincia se elige manualmente al publicar o buscar; el sistema aún no la deduce automáticamente del recorrido. La base es una colección compartida con índice por provincia, no una base física separada para cada provincia.
