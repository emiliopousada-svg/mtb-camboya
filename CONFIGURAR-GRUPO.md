# Grupos globales y posición de amigos

La app permite crear varios grupos compartidos entre cuentas de PocketBase. Quien crea un grupo es su administrador y puede invitar miembros mediante un código. Los miembros autorizados pueden salir y volver a entrar desde **Grupos a los que tienes acceso**; conservan esa autorización hasta que el administrador la revoca.

La ubicación se actualiza cada 10 segundos y se muestra mientras la persona graba y tiene el grupo activo. Al pausar o terminar la grabación, salir o cerrar sesión, la app retira su posición.

## 1. Campo de grupo en las cuentas

En PocketBase, abre **Collections → users → Edit collection** y comprueba que existe el campo opcional de texto `groupCode`. Si no existe, créalo.

En **API Rules**, la regla de actualización de `users` debe impedir que cada persona se asigne o cambie el grupo por su cuenta:

```
id = @request.auth.id && @request.body.groupCode:isset = false
```

La app solo cambia el grupo activo mediante el hook del servidor. Mantén el registro de cuentas limitado como ya está configurado.

## 2. Importar las colecciones

Haz cada importación con **Merge with the existing collections** activado. Revisa siempre **Detected changes**: confirma solo cuando se añada la colección indicada; cancela si aparecen `users`, `routes` o `live_locations` como eliminadas.

1. En **Settings → Import collections**, importa [mtb_groups.json](mtb_groups.json). Comprueba que se añade `mtb_groups`.
2. Repite con [mtb_group_members.json](mtb_group_members.json). Debe añadirse `mtb_group_members`.
3. Importa [mtb_group_rankings.json](mtb_group_rankings.json). Debe añadirse `mtb_group_rankings`, con acceso REST directo cerrado.
4. Si aún no existe, importa [live_locations.json](live_locations.json) y comprueba que solo se añade esa colección.

Si ya importaste una versión anterior de `mtb_group_rankings.json`, vuelve a importar la versión actualizada con **Merge with the existing collections** y acepta únicamente la incorporación del campo `bestMovingTimeSec` y el aumento del máximo de `distanceMovingTimeSec`; no borres ni reemplaces datos existentes.

Las colecciones de grupos, miembros y ranking quedan cerradas a las operaciones REST directas. El hook autoriza las acciones según quién creó el grupo y qué miembros siguen autorizados.

## 3. Instalar el hook en el NAS

El archivo del servidor está en [pb_hooks/groups.pb.js](pb_hooks/groups.pb.js).

1. Copia los archivos de `pb_hooks/` (`groups.pb.js`, `groups_utils.js` y `live_cleanup.pb.js`) a la carpeta del NAS montada dentro del contenedor de PocketBase como `/pb_hooks`.
2. Si tu proyecto Docker todavía no monta esa carpeta, añade un volumen al servicio PocketBase y ajusta la ruta izquierda a tu carpeta real:
   ```yaml
   volumes:
     - ./pb_hooks:/pb_hooks
   ``
3. Recrea o reinicia el contenedor para que PocketBase cargue el hook.
4. Revisa el registro del contenedor. Si hay errores al arrancar, el hook no se habrá instalado.

`groups.pb.js` proporciona rutas autenticadas para crear grupos, aceptar invitaciones, consultar los grupos autorizados, volver a activar un grupo, gestionar miembros, renovar invitaciones, salir y eliminar grupos. También devuelve las posiciones en vivo de los miembros autorizados junto con su apodo de cuenta y el nombre de archivo de su avatar para mostrarlo en el mapa; si falta el apodo de cuenta, usa el apodo del grupo. El hook gestiona también el envío y consulta del ranking, y solo devuelve las marcas de miembros autorizados. `live_cleanup.pb.js` borra cada minuto las ubicaciones que llevan más de cinco minutos sin actualizarse.

## 4. Reglas de `live_locations`

La colección debe tener el campo de texto `groupCode` y reglas que permitan ver solo a miembros del mismo grupo:

En la colección existente, cambia las reglas desde **Collections → live_locations → API Rules**; así no se vuelve a importar su esquema ni se alteran los IDs de sus campos. Copia estas reglas:

**List rule** y **View rule**:
```
@request.auth.id != "" && @request.auth.groupCode != "" && groupCode = @request.auth.groupCode && @collection.mtb_group_members.group ?= groupCode && @collection.mtb_group_members.user ?= @request.auth.id
```

**Create rule**:
```
@request.auth.id != "" && @request.auth.groupCode != "" && @request.body.owner = @request.auth.id && @request.body.groupCode = @request.auth.groupCode && @collection.mtb_group_members.group ?= @request.body.groupCode && @collection.mtb_group_members.user ?= @request.auth.id
```

**Update rule**:
```
@request.auth.id != "" && owner = @request.auth.id && groupCode = @request.auth.groupCode && @request.body.owner:changed = false && @request.body.groupCode:changed = false && @collection.mtb_group_members.group ?= groupCode && @collection.mtb_group_members.user ?= @request.auth.id
```

**Delete rule**:
```
@request.auth.id != "" && owner = @request.auth.id
```

Las reglas consultan `mtb_group_members` en cada petición, por lo que una revocación bloquea el acceso de inmediato incluso si la sesión del móvil todavía no se ha renovado. [live_locations.json](live_locations.json) contiene la configuración de referencia para instalaciones nuevas; no la importes sobre la colección existente.

## 5. Uso en la app

1. Actualiza la web app desde la rama `pruebas` y entra en **Amigos** con tu cuenta.
2. Escribe el apodo que verán los demás.
3. Para crear un grupo, escribe su nombre y pulsa **Crear grupo y ser administrador**. Comparte el código de invitación.
4. Para unirse, pega el código y pulsa **Unirme a un grupo**.
5. Al salir con **Salir y conservar acceso**, la app deja de compartir y el grupo aparece entre los autorizados. Pulsa **Volver a entrar** cuando quieras volver.
6. El administrador puede renovar el código para impedir nuevas invitaciones. Las autorizaciones de los miembros existentes se mantienen.
7. Desde la lista de miembros, el administrador puede revocar la entrada de una persona. Esa persona dejará de ver el grupo y ya no podrá volver a entrar salvo que reciba una invitación nueva.
8. El administrador puede eliminar el grupo para retirar todas las autorizaciones y borrar las posiciones asociadas.
9. En **Mis rutas → Realizadas**, pulsa **🏆 Grupo** para compartir manualmente las marcas de una actividad. Cada envío pide confirmación y comparte distancia, tiempo en movimiento y velocidad punta; no envía el track, nombre, fecha ni ubicación.
10. En la tarjeta **Ranking del grupo** aparecen, para ese grupo Live, la actividad más larga, el mayor tiempo en movimiento de una actividad individual y la velocidad punta de cada miembro. Cada grupo mantiene su propio ranking.

En **Compañeros Cerca**, las tarjetas muestran el apodo y la hora de actualización. El botón **Ver mapa** centra el mapa en esa persona.

## Grupos anteriores

Los códigos asignados manualmente antes de instalar este sistema no tienen un registro de administrador y miembros. Un superusuario debe borrar esos valores antiguos de `users.groupCode` antes de que esas cuentas creen o acepten invitaciones nuevas.

## Privacidad

- Solo los miembros autorizados del grupo activo pueden ver ubicaciones en vivo.
- Se comparte el apodo y la posición; no se muestra el correo.
- Las marcas deportivas se envían únicamente cuando el usuario pulsa **🏆 Grupo** y confirma. El servidor conserva solo sus récords de distancia, tiempo en movimiento y velocidad punta dentro de ese grupo; no recibe el recorrido, el título ni la fecha de la actividad.
- La app renueva la sesión durante la actividad para aplicar pronto una revocación.
- Renovar una invitación impide que el código anterior autorice a personas nuevas; no elimina miembros que ya estaban autorizados.
