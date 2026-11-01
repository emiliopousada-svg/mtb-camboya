# Posición de amigos en vivo: configuración del servidor

La app comparte tu ubicación **solo mientras grabas y estás unido al grupo**. Cada 10 segundos envía tu posición y consulta la de los demás; oculta a quien lleve más de 2 minutos sin actualizar. Al pausar, terminar la ruta, salir del grupo o cerrar sesión, borra tu posición del servidor.

Los archivos de esta carpeta (`servidor/`) son para el NAS, no forman parte del APK.

## 1. Cuentas y código de grupo (colección `users`)

1. En el panel de PocketBase (`http://IP-DEL-NAS:8090/_/`) abre **Collections → users → engranaje → Edit collection**.
2. Añade un campo **Plain text** llamado exactamente `groupCode`. Guarda.
3. **Importante: impide que los usuarios cambien su propio grupo.** En la pestaña **API Rules**, pon en **Update rule**:
   ```
   id = @request.auth.id && @request.body.groupCode:isset = false
   ```
   Sin esta regla, cualquier usuario podría ponerse el código de otro grupo desde la API y ver sus posiciones.
4. En la misma pestaña, deja la **Create rule** bloqueada (solo superusuarios), como ya hiciste, para que nadie pueda registrarse.
5. Abre cada usuario del grupo y escribe en `groupCode` **el mismo código**: entre 6 y 64 caracteres, solo letras, números, guion y guion bajo. Elige uno largo y difícil de adivinar.

## 2. Colección `live_locations`

1. **Settings → Import collections**, pega el contenido de `live_locations.json` y pulsa **Review**.
2. Comprueba que solo aparece `live_locations` como colección **nueva**. Si propone borrar `users` o `routes`, no confirmes.
3. Confirma. El archivo ya incluye los campos automáticos `created` y `updated`, que la app necesita para ordenar y ocultar posiciones antiguas.

Las reglas hacen que cada persona solo pueda crear, modificar y borrar **su** posición, y solo vea las posiciones de **su** grupo.

## 3. Limpieza automática (recomendado)

Si el móvil pierde la señal o se cierra la app, la posición queda guardada en el servidor. La app la oculta a los 2 minutos, pero seguiría consultable por la API. Esta tarea la borra a los 5 minutos:

1. En File Station crea la carpeta `docker/pocketbase/pb_hooks` y copia dentro `live_cleanup.pb.js`.
2. Sustituye el `docker-compose.yml` del proyecto por el de esta carpeta (añade la línea `./pb_hooks:/pb_hooks`), o simplemente añade esa línea al tuyo.
3. En Container Manager → Proyecto → `pocketbase`: **Acción → Detener**, y luego **Compilar** o **Iniciar** para recrearlo.
4. Comprueba en **Registro** del contenedor que no hay errores al arrancar.

Este archivo no está probado en tu servidor. Si el contenedor no carga la carpeta de hooks, las posiciones antiguas seguirán sin borrarse.

## 4. Uso en la app

1. En la pestaña **Amigos**, inicia sesión en la tarjeta **Cuenta**.
2. Escribe tu apodo (es lo que verán los demás; no se comparte tu correo) y el código de grupo, y pulsa **Unirse al Grupo**.
3. Se acuerda del grupo: al abrir la app se une solo. Para dejar de compartir, pulsa **Salir del Grupo**.
4. Cuando empieces a grabar, tu posición aparece en el mapa de los miembros como un punto morado.

## Privacidad

- Solo se comparte tu posición durante la grabación y estando unido.
- Los miembros del grupo ven tu apodo y tu posición; no ven tu correo.
- Como administrador, tú puedes ver todos los datos desde el panel de PocketBase.
