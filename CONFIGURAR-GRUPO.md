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
3. Importa [mtb_group_ranking_entries.json](mtb_group_ranking_entries.json). Debe añadirse `mtb_group_ranking_entries`, con acceso REST directo cerrado.
4. Si aún no existe, importa [live_locations.json](live_locations.json) y comprueba que solo se añade esa colección.

Si `mtb_groups` ya estaba instalada, vuelve a importar su esquema actualizado con **Merge with the existing collections** y confirma que solo se añade el campo opcional `icon` (archivo JPEG de hasta 256 KB). El archivo de icono no está protegido y puede verse mediante su URL; no subas imágenes privadas.

`mtb_group_rankings` es la colección antigua de máximos acumulados y ya no se consulta. Como esas marcas históricas no indican qué ruta las produjo, antes de desplegar esta versión haz una copia de seguridad y elimina sus registros desde el panel de PocketBase para reiniciar el ranking histórico. No elimines las colecciones de grupos o miembros ni las rutas. No hace falta importar `mtb_group_rankings.json` en instalaciones nuevas.

Las colecciones de grupos, miembros y aportaciones al ranking quedan cerradas a las operaciones REST directas. El hook autoriza las acciones según quién creó el grupo y qué miembros siguen autorizados.

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

`groups.pb.js` proporciona rutas autenticadas para crear grupos, aceptar invitaciones, consultar los grupos autorizados, volver a activar un grupo, gestionar miembros, renovar invitaciones, salir y eliminar grupos. La identificación de cada miembro usa el apodo de su cuenta; no se solicita un apodo distinto para cada grupo. Devuelve también el nombre del archivo del icono del grupo para mostrarlo en los accesos directos. Las posiciones en vivo incluyen el apodo de cuenta y el nombre de archivo del avatar para mostrarlos en el mapa. El hook guarda las marcas por actividad, calcula el ranking a partir de ellas y permite retirar las aportaciones de una ruta borrada; solo devuelve las marcas de miembros autorizados. `live_cleanup.pb.js` borra cada minuto las ubicaciones que llevan más de cinco minutos sin actualizarse.

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
2. No hace falta introducir otro apodo: se usará el apodo de tu cuenta. Si todavía no tienes uno, complétalo en **Ajustes → Cuenta**.
3. Para crear un grupo, escribe su nombre, elige opcionalmente un icono y pulsa **Crear grupo y ser administrador**. Si no subes imagen, la app muestra las iniciales del grupo. Comparte el código de invitación.
4. Para unirse, pega el código y pulsa **Unirme a un grupo**.
5. Tus grupos autorizados aparecen como etiquetas de acceso directo. Pulsa una para entrar o cambiar al grupo activo. Al salir con **Salir y conservar acceso**, la app deja de compartir y conserva la autorización.
6. Desde **Administrar grupo**, el administrador puede cambiar el logo, renovar el código para impedir nuevas invitaciones y eliminar el grupo. Las autorizaciones de los miembros existentes se mantienen al renovar el código.
7. Desde la lista de miembros, el administrador puede revocar la entrada de una persona. Esa persona dejará de ver el grupo y ya no podrá volver a entrar salvo que reciba una invitación nueva.
8. El administrador puede eliminar el grupo para retirar todas las autorizaciones y borrar las posiciones asociadas.
9. Con un grupo activo seleccionado, las marcas de tus rutas personales realizadas se añaden automáticamente al ranking cuando se sincronizan con el servidor. Se excluyen las rutas importadas y las de la comunidad. Solo se comparten distancia, tiempo en movimiento y velocidad punta; no se envían el track, nombre, fecha ni ubicación. El botón **🏆 Grupo** permite volver a compartirlas manualmente con confirmación. El servidor guarda el identificador numérico interno de la actividad para reemplazar sus marcas o retirarlas al borrar la ruta.
10. En la tarjeta **Ranking del grupo** aparecen, para ese grupo Live, la actividad más larga, el mayor tiempo en movimiento de una actividad individual y la velocidad punta de cada miembro. Cada grupo mantiene su propio ranking. Al borrar una actividad, sus marcas se eliminan y los máximos se recalculan con las actividades restantes; sin conexión, el borrado se sincroniza al volver a conectarse con la cuenta correspondiente.

En **Compañeros Cerca**, las tarjetas muestran el apodo y la hora de actualización. El botón **Ver mapa** centra el mapa en esa persona.

## Grupos anteriores

Los códigos asignados manualmente antes de instalar este sistema no tienen un registro de administrador y miembros. Un superusuario debe borrar esos valores antiguos de `users.groupCode` antes de que esas cuentas creen o acepten invitaciones nuevas.

## Privacidad

- Solo los miembros autorizados del grupo activo pueden ver ubicaciones en vivo.
- Se comparte el apodo y la posición; no se muestra el correo.
- Las marcas deportivas se envían automáticamente al sincronizar rutas personales realizadas cuando el usuario tiene un grupo activo seleccionado. Las rutas importadas y las de la comunidad quedan excluidas. El servidor conserva por actividad distancia, tiempo en movimiento, velocidad punta y un identificador numérico interno necesario para reemplazar o retirar esa aportación; no recibe el recorrido, el título, la fecha ni la ubicación de la actividad. El botón **🏆 Grupo** permite volver a compartirlas manualmente.
- La app renueva la sesión durante la actividad para aplicar pronto una revocación.
- Renovar una invitación impide que el código anterior autorice a personas nuevas; no elimina miembros que ya estaban autorizados.
