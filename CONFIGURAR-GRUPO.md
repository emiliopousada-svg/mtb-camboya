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
3. Si aún no existe, importa [live_locations.json](live_locations.json) y comprueba que solo se añade esa colección.

Las colecciones de grupos y miembros quedan cerradas a las operaciones REST directas. El hook autoriza las acciones según quién creó el grupo y qué miembros siguen autorizados.

## 3. Instalar el hook en el NAS

El archivo del servidor está en [pb_hooks/groups.pb.js](pb_hooks/groups.pb.js).

1. Copia `groups.pb.js` a la carpeta del NAS montada dentro del contenedor de PocketBase como `/pb_hooks`.
2. Si tu proyecto Docker todavía no monta esa carpeta, añade un volumen al servicio PocketBase y ajusta la ruta izquierda a tu carpeta real:
   ```yaml
   volumes:
     - ./pb_hooks:/pb_hooks
   ``
3. Recrea o reinicia el contenedor para que PocketBase cargue el hook.
4. Revisa el registro del contenedor. Si hay errores al arrancar, el hook no se habrá instalado.

El hook proporciona rutas autenticadas para crear grupos, aceptar invitaciones, consultar los grupos autorizados, volver a activar un grupo, gestionar miembros, renovar invitaciones, salir y eliminar grupos.

## 4. Reglas de `live_locations`

La colección debe tener el campo de texto `groupCode` y reglas que permitan ver solo a miembros del mismo grupo:

La configuración actualizada está en [live_locations.json](live_locations.json). Importa ese archivo también con **Merge with the existing collections** activado para aplicar las reglas nuevas. En **Detected changes**, comprueba que se actualizan las reglas de `live_locations` y que no se eliminan colecciones ni campos. Las reglas consultan `mtb_group_members` en cada petición, por lo que una revocación bloquea el acceso aunque la sesión del móvil todavía no se haya renovado.

- **List rule** y **View rule**: autenticado, grupo activo coincidente y existe una autorización en `mtb_group_members` para ese usuario y grupo.
- **Create rule**: autenticado, propietario coincidente, grupo activo coincidente y autorización vigente.
- **Update rule**: el propietario actualiza solo su registro, no cambia propietario ni grupo, y conserva autorización.
- **Delete rule**: el propietario puede borrar su posición.

## 5. Uso en la app

1. Actualiza la web app desde la rama `pruebas` y entra en **Amigos** con tu cuenta.
2. Escribe el apodo que verán los demás.
3. Para crear un grupo, escribe su nombre y pulsa **Crear grupo y ser administrador**. Comparte el código de invitación.
4. Para unirse, pega el código y pulsa **Unirme a un grupo**.
5. Al salir con **Salir y conservar acceso**, la app deja de compartir y el grupo aparece entre los autorizados. Pulsa **Volver a entrar** cuando quieras volver.
6. El administrador puede renovar el código para impedir nuevas invitaciones. Las autorizaciones de los miembros existentes se mantienen.
7. Desde la lista de miembros, el administrador puede revocar la entrada de una persona. Esa persona dejará de ver el grupo y ya no podrá volver a entrar salvo que reciba una invitación nueva.
8. El administrador puede eliminar el grupo para retirar todas las autorizaciones y borrar las posiciones asociadas.

En **Compañeros Cerca**, las tarjetas muestran el apodo y la hora de actualización. El botón **Ver mapa** centra el mapa en esa persona.

## Grupos anteriores

Los códigos asignados manualmente antes de instalar este sistema no tienen un registro de administrador y miembros. Un superusuario debe borrar esos valores antiguos de `users.groupCode` antes de que esas cuentas creen o acepten invitaciones nuevas.

## Privacidad

- Solo los miembros autorizados del grupo activo pueden ver ubicaciones en vivo.
- Se comparte el apodo y la posición; no se muestra el correo.
- La app renueva la sesión durante la actividad para aplicar pronto una revocación.
- Renovar una invitación impide que el código anterior autorice a personas nuevas; no elimina miembros que ya estaban autorizados.
