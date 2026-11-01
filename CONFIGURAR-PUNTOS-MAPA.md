# Puntos compartidos del mapa

La colección `map_pois` hace que las fuentes y los bares marcados en la app se compartan entre las instalaciones que usan el mismo servidor PocketBase.

## Instalar la colección en el NAS

1. Abre el panel de PocketBase en el NAS.
2. Ve a **Settings → Import collections**.
3. Pega el contenido completo de `map_pois.json` y pulsa **Review**.
4. Confirma que `map_pois` aparece como colección nueva. Si el panel propone modificar o borrar `users`, `routes` o `live_locations`, cancela y revisa el JSON antes de continuar.
5. Importa la colección.

## Permisos incluidos

- Cualquier instalación puede consultar los puntos del mapa.
- Para crear un punto hace falta una cuenta iniciada. Cada registro queda vinculado al usuario que lo creó.
- Solo el creador puede eliminarlo. Los demás usuarios lo ven sin botón de borrar.
- Los registros no se pueden editar desde la API.

Todas las instalaciones deben iniciar sesión contra el mismo servidor PocketBase para compartir la misma colección. Si se marca un punto sin sesión o sin conexión, se guarda en el móvil y queda pendiente de sincronizarse al iniciar sesión y recuperar conexión. Los puntos locales que ya existían se publican la primera vez que el usuario inicia sesión con la versión nueva.

La app consulta el servidor al abrirse, al recuperar conexión y cada minuto mientras está abierta. También conserva una copia local para mostrar los puntos descargados sin conexión.
