# Configurar la sincronización de rutas

Las rutas grabadas se guardan primero en el dispositivo. Al iniciar sesión y recuperar la conexión, la app sincroniza las rutas pendientes y pide una vez un apodo para asociarlo a las rutas de esa cuenta. El apodo se puede cambiar desde el almacenamiento local de la app si se desea usar otro.

La colección PocketBase `routes` necesita el campo opcional `createdBy` (texto, máximo 32 caracteres) para guardar el apodo. En **Collections → routes → Edit collection**, añade ese campo sin reemplazar la colección ni cambiar sus reglas de acceso. La app sincroniza rutas privadas solo con la cuenta propietaria.

Al activar los datos móviles, la app reintenta la sincronización al recibir el evento de conexión; también lo hace al volver a primer plano. Si se cancela la elección del apodo, las rutas permanecen guardadas localmente y se reintentan en la siguiente sincronización.
