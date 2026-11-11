# Perfil personal de MTB

El peso y la edad se guardan en el registro de cada cuenta de PocketBase. La edad se usa para estimar la frecuencia cardíaca máxima con la fórmula `220 - edad`; es una estimación, no una medición clínica. El FTP sigue guardándose solo en el dispositivo.

## Preparar PocketBase

No hace falta crear una colección nueva: se usan los campos de la colección de autenticación `users` que ya utiliza el inicio de sesión. Antes de actualizar la app, haz una copia de seguridad y abre **Collections → users → Edit collection**. Añade estos campos numéricos opcionales:

| Campo | Rango usado por la app |
| --- | --- |
| `weightKg` | 25–250 kg |
| `age` | 10–100 años |

No reemplaces la colección `users` ni sus reglas. El registro y la actualización de perfiles deben seguir limitados a la cuenta autenticada. Si configuraste la regla de actualización para grupos siguiendo [CONFIGURAR-GRUPO.md](./CONFIGURAR-GRUPO.md), mantenla: bloquea cambios de `groupCode` y permite guardar los campos de perfil.

## Uso

Al crear una cuenta se solicitan peso y edad. Al iniciar sesión, las cuentas que ya tienen perfil cargan esos datos automáticamente; si falta alguno, se puede introducir y guardar. Después se pueden cambiar desde **Ajustes → Cuenta y sincronización** o desde **Estadísticas → Rendimiento físico**.
