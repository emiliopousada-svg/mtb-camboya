# Configurar el perfil de usuario en PocketBase

El peso y la edad se guardan en los campos `weightKg` y `age` de la colección de autenticación `users`. Para guardar también un avatar, añade a esa colección un campo:

- Nombre: `avatar`
- Tipo: `File`
- Número máximo de archivos: `1`
- Tamaño máximo: `262144` bytes
- Tipos MIME permitidos: `image/jpeg`
- Archivo no protegido, para que se muestre en la ficha de perfil

La app convierte la imagen seleccionada a JPEG, limita su lado mayor a 512 píxeles y la comprime a un máximo de 256 KB antes de subirla. La conversión elimina los metadatos originales de la imagen. Solo se sube al pulsar **Guardar perfil**. También guarda una copia comprimida en el almacenamiento local del teléfono para que el avatar siga apareciendo sin conexión y en el marcador GPS. Si no hay red, la subida queda pendiente para la siguiente sincronización autenticada. Al cambiar el avatar, la app actualiza el mismo campo `avatar` de la cuenta.

Añade el campo desde **PocketBase Admin → Collections → users → Edit collection → New field**. No importes una colección `users`: es la colección de autenticación existente. Conserva sus reglas actuales de acceso y comprueba que el usuario autenticado pueda actualizar su propio registro.

Como el avatar queda accesible para mostrarse en el perfil, no uses una imagen que contenga información sensible.
