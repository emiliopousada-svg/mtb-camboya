# Grupos globales y posición de amigos

La app permite crear grupos compartidos entre cuentas de PocketBase. Quien crea el grupo queda como administrador y obtiene un código de invitación. Los miembros que se unen con ese código pueden ver la posición en vivo del resto mientras graban una ruta.

La ubicación se actualiza cada 10 segundos y se oculta si no se ha actualizado durante 2 minutos. Al pausar o terminar la grabación, salir o cerrar la sesión, el móvil retira su posición.

## 1. Campo de grupo en las cuentas

En PocketBase, abre **Collections → users → Edit collection** y comprueba que existe el campo opcional de texto `groupCode`. Si no existe, créalo.

En **API Rules**, la regla de actualización de `users` debe impedir que cada usuario se asigne o cambie el grupo por su cuenta:

```
id = @request.auth.id && @request.body.groupCode:isset = false
```

La asignación de miembros la hace el hook del servidor con la sesión autenticada. Mantén el registro de cuentas limitado como ya está configurado.

## 2. Importar la colección de grupos

1. Abre **Settings → Import collections**.
2. Pega el contenido de [mtb_groups.json](mtb_groups.json).
3. Activa **Merge with the existing collections**.
4. Revisa que la única colección nueva sea `mtb_groups`; no confirmes si aparecen como eliminadas `users`, `routes` o `live_locations`.
5. Confirma la importación.

La colección queda cerrada a las operaciones REST directas. El hook verifica la identidad del creador y los miembros antes de permitir cambios.

## 3. Instalar el hook en el NAS

El archivo del servidor está en [pb_hooks/groups.pb.js](pb_hooks/groups.pb.js).

1. Copia `groups.pb.js` a la carpeta del NAS que se monta dentro del contenedor de PocketBase como `/pb_hooks`.
2. Si tu proyecto Docker aún no monta esa carpeta, añade un volumen como este al servicio PocketBase, ajustando la ruta del lado izquierdo a la carpeta real:
   ```yaml
   volumes:
     - ./pb_hooks:/pb_hooks
   ``
3. Recrea o reinicia el contenedor de PocketBase para que cargue el hook.
4. Revisa el registro del contenedor. Si el hook tiene un error de sintaxis o no encuentra la colección, PocketBase lo mostrará al arrancar.

El hook añade las rutas autenticadas `/api/mtb/groups/*` para crear grupos, aceptar invitaciones, renovar el código, salir y eliminar el grupo.

## 4. Comprobar `live_locations`

La colección debe tener el campo de texto `groupCode` y estas reglas para que cada persona vea solo a miembros del mismo grupo:

- **List rule** y **View rule**: autenticado y `groupCode = @request.auth.groupCode`.
- **Create rule**: autenticado, `owner = @request.auth.id` y el `groupCode` coincide con la cuenta.
- **Update rule**: el propietario actualiza solo su registro y no puede cambiar `owner` ni `groupCode`.
- **Delete rule**: el propietario puede borrar su posición.

Si aún no existe, importa [live_locations.json](live_locations.json) con **Merge with the existing collections** activado y comprueba que solo se añade esa colección.

## 5. Uso en la app

1. Actualiza la web app desde la rama `pruebas` y entra en **Amigos** con una cuenta de PocketBase.
2. Escribe el apodo que verán los demás.
3. Para crear grupo, escribe su nombre y pulsa **Crear grupo y ser administrador**. Comparte el código desde **Copiar invitación**.
4. Para unirse, pega el código de invitación y pulsa **Unirme a un grupo**.
5. El administrador puede **Renovar código** para impedir nuevas entradas con el código anterior; los miembros actuales conservan el acceso.
6. El administrador puede eliminar el grupo. Los miembros pueden salir desde su cuenta.

En **Compañeros Cerca**, las tarjetas muestran el apodo y la hora de actualización. **Ver mapa** centra el mapa en esa persona.

## Grupos anteriores

Los códigos asignados manualmente antes de instalar el hook no tienen un grupo administrador asociado. Un superusuario debe borrar el valor antiguo de `groupCode` de esas cuentas antes de que puedan crear o aceptar una invitación nueva. Luego una persona crea el grupo y el resto se une con el código generado.

## Privacidad

- El apodo y la posición se comparten con los miembros del mismo grupo; el correo no se muestra.
- Solo se comparte la ubicación mientras se graba una ruta.
- Renovar el código cierra futuras invitaciones; para retirar a todos los miembros y terminar el grupo, el administrador puede eliminarlo.
- La gestión de grupos requiere que el hook esté instalado en PocketBase, además de actualizar la app.
