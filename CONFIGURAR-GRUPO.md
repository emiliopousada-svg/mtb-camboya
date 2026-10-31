# Posiciones de amigos en MTB CAMBOYA

La función comparte la ubicación únicamente mientras la persona está grabando y se ha unido al grupo. La app actualiza las posiciones aproximadamente cada 10 segundos y oculta las que llevan más de 2 minutos sin actualizarse. Al pausar, finalizar o salir del grupo, intenta borrar la posición activa.

## 1. Asignar miembros al grupo

En PocketBase, abre la colección de autenticación `users` y añade un campo de texto `groupCode`. Asigna exactamente el mismo código a cada cuenta que pertenezca al grupo, por ejemplo un código largo y difícil de adivinar usando solo letras, números, guion y guion bajo (de 6 a 64 caracteres). Los usuarios no deben poder cambiar este campo desde la app; mantenlo editable solo por administradores. La app actualiza la sesión al unirse al grupo para cargar el valor más reciente.

La app también pide que la persona escriba ese código en la pantalla **Posición de Amigos**. El código escrito debe coincidir con el que PocketBase devuelve para su cuenta.

## 2. Crear `live_locations`

Crea una colección de tipo **Base** llamada exactamente `live_locations` con estos campos:

| Campo | Tipo | Opciones |
|---|---|---|
| `owner` | Relation | Colección `users`, una relación, obligatorio |
| `groupCode` | Text | Obligatorio |
| `name` | Text | |
| `lat` | Number | Obligatorio |
| `lon` | Number | Obligatorio |
| `accuracy` | Number | |

No uses una regla pública. Configura las reglas API así:

- **List** y **View**:
  ```text
  @request.auth.id != "" && @request.auth.groupCode != "" && groupCode = @request.auth.groupCode
  ```
- **Create**:
  ```text
  @request.auth.id != "" && owner = @request.auth.id && groupCode = @request.auth.groupCode
  ```
- **Update**:
  ```text
  @request.auth.id != "" && owner = @request.auth.id && @request.body.owner:changed = false && @request.body.groupCode:changed = false
  ```
- **Delete**:
  ```text
  @request.auth.id != "" && owner = @request.auth.id
  ```

La regla de actualización impide que el dueño cambie el usuario o el grupo de una posición existente. La app vuelve a enviar esos valores sin cambiarlos al actualizar coordenadas. PocketBase documenta el modificador `:changed` para validar que esos campos no hayan cambiado en la petición.

## 3. Uso

Cada usuario inicia sesión, escribe el código de su grupo y pulsa **Unirse al Grupo**. Al empezar una grabación, su posición aparece en el mapa de los miembros. Pausar o detener la grabación deja de compartirla. Las posiciones antiguas se ocultan automáticamente tras 2 minutos por si el móvil pierde conexión antes de poder borrarlas.

Las rutas grabadas siguen siendo privadas según las reglas de `routes`; esta función usa una colección separada solo para la posición activa.
