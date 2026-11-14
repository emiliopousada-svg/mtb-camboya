# Configurar el perfil de usuario en PocketBase

El apodo de cuenta se guarda en el campo de texto opcional `nickname` (máximo 32 caracteres) de la colección de autenticación `users`. Añádelo antes de habilitar registros: la app lo requiere para crear cuentas y para sincronizar rutas. Las cuentas antiguas sin apodo podrán completarlo al iniciar sesión.

El peso y la edad se guardan en los campos `weightKg` y `age` de esa colección. Para guardar también un avatar, añade:

- Nombre: `avatar`
- Tipo: `File`
- Número máximo de archivos: `1`
- Tamaño máximo: `262144` bytes
- Tipos MIME permitidos: `image/jpeg`
- Archivo no protegido, para que se muestre en la ficha de perfil

La app convierte la imagen seleccionada a JPEG, limita su lado mayor a 512 píxeles y la comprime a un máximo de 256 KB antes de subirla. La conversión elimina los metadatos originales de la imagen. Solo se sube al pulsar **Guardar perfil**. También guarda una copia comprimida en el almacenamiento local del teléfono para que el avatar siga apareciendo sin conexión y en el marcador GPS. Si no hay red, la subida queda pendiente para la siguiente sincronización autenticada. Al cambiar el avatar, la app actualiza el mismo campo `avatar` de la cuenta.

Añade los campos desde **PocketBase Admin → Collections → users → Edit collection → New field**. No importes una colección `users`: es la colección de autenticación existente. Conserva sus reglas actuales de acceso y comprueba que el usuario autenticado pueda actualizar su propio registro.

Como el avatar queda accesible para mostrarse en el perfil, no uses una imagen que contenga información sensible.

## Apodo único

El apodo es el nombre público de la cuenta (comentarios, marcas, rutas y grupos), por lo que no puede repetirse y, una vez elegido, no se cambia. Se garantiza en dos niveles:

1. Copia `pb_hooks/users_nickname.pb.js` al directorio `pb_hooks` de PocketBase y reinicia. El hook normaliza los espacios, rechaza con un mensaje legible un apodo ya usado (sin distinguir mayúsculas de minúsculas) y bloquea el cambio del apodo cuando ya existe.
2. Añade un índice único en **Collections → users → Edit collection → Indexes**, que es la garantía real frente a dos registros simultáneos:

   ```sql
   CREATE UNIQUE INDEX `idx_users_nickname` ON `users` (`nickname` COLLATE NOCASE) WHERE `nickname` != ''
   ```

   La condición `WHERE` permite que las cuentas antiguas sin apodo sigan existiendo.

Antes de crear el índice, comprueba que no haya apodos repetidos; si los hay, PocketBase no dejará guardarlo. En **Collections → users** usa el filtro de búsqueda con un apodo concreto, o ejecuta en SQLite:

```sql
SELECT lower(nickname), count(*) FROM users WHERE nickname != '' GROUP BY lower(nickname) HAVING count(*) > 1;
```

Resuelve los duplicados editando el apodo de las cuentas afectadas desde el panel de administración (el hook no restringe a los superusuarios). Los comentarios y marcas publicados antes de este cambio conservan el alias con el que se guardaron.

Limitación: SQLite solo ignora mayúsculas en letras ASCII, así que «Ñandú» y «ñandú» se consideran apodos distintos.
