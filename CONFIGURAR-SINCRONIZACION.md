# Configurar la sincronización de rutas

Las rutas grabadas se guardan primero en el dispositivo. Para sincronizarlas, la cuenta debe tener un apodo; la app usa el apodo guardado en `users.nickname` para identificar al autor de las rutas. Las cuentas antiguas sin apodo podrán completarlo en **Ajustes → Cuenta y sincronización**.

La colección PocketBase `routes` necesita el campo opcional `createdBy` (texto, máximo 32 caracteres) para guardar el apodo. En **Collections → routes → Edit collection**, añade ese campo sin reemplazar la colección ni cambiar sus reglas de acceso. La app sincroniza rutas privadas solo con la cuenta propietaria.

Al activar los datos móviles, la app reintenta la sincronización al recibir el evento de conexión; también lo hace al volver a primer plano. Si la cuenta todavía no tiene apodo, las rutas permanecen guardadas localmente hasta completar el perfil y pulsar **Sincronizar ahora**.

Tras la primera sincronización, la app consulta incrementalmente las rutas modificadas desde el campo automático `updated` de PocketBase. La sincronización manual y una auditoría automática diaria comparan el inventario completo para detectar rutas eliminadas desde otro dispositivo. Las rutas locales pendientes y la cola de borrados se conservan hasta que el servidor confirma la operación.

Los puntos compartidos también se actualizan incrementalmente y se reconcilian por completo una vez al día. El catálogo comunitario conserva en el teléfono la última búsqueda cercana durante siete días; puede mostrarla sin conexión si el GPS sigue dentro de 5 km del punto de búsqueda guardado.
