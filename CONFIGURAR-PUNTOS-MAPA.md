# Puntos compartidos del mapa

La colección `map_pois` hace que las fuentes, los bares y los sitios de comida marcados en la app se compartan entre las instalaciones que usan el mismo servidor PocketBase. El tipo `food` debe estar permitido en el campo `type` de la colección.

## Instalar la colección en el NAS

1. Abre el panel de PocketBase en el NAS.
2. Ve a **Settings → Import collections**.
3. Pega el contenido completo de `map_pois.json` y pulsa **Review**.
4. Si `map_pois` ya existe, activa **Merge with the existing collections** y confirma que solo cambia esa colección. Cancela si el panel propone cambios o borrados en otras colecciones.
5. Importa la colección o sus cambios.
6. Copia `pb_hooks/map_pois.pb.js` al directorio `pb_hooks` de PocketBase y reinicia PocketBase. El hook limita a 500 puntos compartidos por cuenta. La colección exige iniciar sesión para listar o consultar puntos y valida nombres y coordenadas.

## Permisos incluidos

- Solo las cuentas iniciadas pueden consultar los puntos compartidos; los puntos ya descargados siguen disponibles en la copia local.
- Para crear un punto hace falta una cuenta iniciada. Cada registro queda vinculado al usuario que lo creó.
- Solo el creador puede eliminarlo. Los demás usuarios lo ven sin botón de borrar.
- Los registros no se pueden editar desde la API.

Todas las instalaciones deben iniciar sesión contra el mismo servidor PocketBase para compartir la misma colección. Si se marca un punto sin sesión o sin conexión, se guarda en el móvil y queda pendiente de sincronizarse al iniciar sesión y recuperar conexión. Los puntos locales que ya existían se publican la primera vez que el usuario inicia sesión con la versión nueva.

La app consulta el servidor al abrirse, al recuperar conexión y cada minuto mientras está abierta. También conserva una copia local para mostrar los puntos descargados sin conexión.
