# Supabase — cómo aplicar el esquema

Esta guía es para aplicar `schema.sql` en el proyecto Supabase de MazeLab OS
(`https://xitbarrinioswpyjiwyc.supabase.co`). Está escrita paso a paso, sin dar
nada por sabido — si ya lo has hecho antes, salta directo al paso 4.

## 1. Dónde está el SQL Editor

1. Entra a [supabase.com](https://supabase.com) e inicia sesión.
2. Abre el proyecto MazeLab OS (el de la URL de arriba).
3. En el menú lateral izquierdo, busca el ícono de una hoja con `</>` — dice
   **SQL Editor**. Haz clic ahí.
4. Vas a ver una pantalla con un editor de texto en blanco (o una lista de
   queries guardadas si ya usaste el editor antes). Haz clic en **"+ New
   query"** (arriba a la izquierda) para abrir una pestaña nueva y limpia.

## 2. Pegar y ejecutar

1. Abre el archivo `supabase/schema.sql` de este repo (en tu editor de
   código, VS Code, o el que uses).
2. Selecciona TODO el contenido (`Ctrl+A`) y cópialo (`Ctrl+C`).
3. Vuelve a la pestaña del SQL Editor de Supabase y pega (`Ctrl+V`) en el
   recuadro en blanco.
4. Haz clic en el botón verde **"Run"** (abajo a la derecha del editor, o
   `Ctrl+Enter` / `Cmd+Enter`).

**Qué output esperar:** un mensaje verde que dice algo como `Success. No rows
returned`. Eso significa que las 10 tablas, las funciones, los triggers y las
políticas de seguridad quedaron creadas.

Si en cambio ves texto rojo con la palabra `ERROR`, copia el mensaje
completo y pásaselo al orquestador (Claude) antes de seguir — no seguir a la
tarea siguiente sin resolver el error.

## 3. Verificar que quedó bien

En el menú lateral, entra a **Table Editor** (el ícono de una tabla, arriba
del SQL Editor). Deberías ver 10 tablas nuevas en la lista de la izquierda:

`ventas, facturas, costos, servicios, personal, clientes, equipos, cotizaciones, profiles, config`

Haz clic en cualquiera (por ejemplo `ventas`) — debería mostrarse vacía (sin
filas todavía; los datos reales se cargan en el Lote M1-C, no en este paso) y
con las columnas correctas (verás nombres como `clientName`, `eventDate`,
etc.).

## 4. Cómo re-aplicar (si algo cambia)

El archivo completo está escrito para poder pegarse y correrse **cuantas
veces quieras**, sin que truene. Internamente usa:

- `CREATE TABLE IF NOT EXISTS` — si la tabla ya existe, no hace nada (no
  borra datos).
- `DROP POLICY IF EXISTS` seguido de `CREATE POLICY` — borra la política
  vieja (si existía) y crea la nueva. Esto es necesario porque Postgres no
  tiene un `CREATE POLICY IF NOT EXISTS`.
- `CREATE OR REPLACE FUNCTION` — actualiza las funciones sin duplicarlas.

**En la práctica:** si el orquestador te dice "actualicé `schema.sql`,
vuelve a pegarlo", simplemente repite el paso 2 completo (selecciona todo el
archivo de nuevo, no solo la parte que cambió). No hay riesgo de duplicar
nada ni de perder las filas que ya existan en las tablas.

## 5. Antes de que la app funcione — pasos pendientes (no son de este lote)

Estos los guía el orquestador cuando corresponda, quedan anotados aquí para
que sepas que existen:

1. Crear los 4 usuarios reales en **Authentication → Users → Add user**
   (con contraseña temporal) — hoy el `schema.sql` solo tiene el email de
   `aldo@mazelab.cl` resuelto a `superadmin` en el trigger; los otros 3
   quedan como comentario (`-- ORQUESTADOR: completar emails`) hasta que se
   sepan los emails reales del resto del equipo.
2. Desactivar el auto-registro en **Authentication → Providers → Email →
   "Enable email signups"** (apagar el toggle) — si no, cualquiera que
   entre a la app puede crearse una cuenta sola.
3. Correr el script de migración (`scripts/migrate-backup.js`, Lote M1-C)
   para copiar los datos reales del respaldo a estas tablas vacías.

## Matriz de permisos (RLS)

"Lectura" = poder ver filas (`SELECT`). "Escritura" = poder crear, editar o
borrar filas (`INSERT` / `UPDATE` / `DELETE`). `anon` (usuario sin sesión
iniciada) nunca tiene acceso a nada, en ninguna tabla — ni lectura ni
escritura.

| Tabla | Lectura | Escritura |
|---|---|---|
| `ventas` | cualquier usuario con sesión | superadmin, socio, comercial |
| `facturas` | cualquier usuario con sesión | superadmin, socio, comercial |
| `cotizaciones` | cualquier usuario con sesión | superadmin, socio, comercial |
| `costos` | cualquier usuario con sesión | superadmin, socio |
| `config` | cualquier usuario con sesión | superadmin, socio |
| `servicios` | cualquier usuario con sesión | cualquier usuario con sesión |
| `personal` | cualquier usuario con sesión | cualquier usuario con sesión |
| `clientes` | cualquier usuario con sesión | cualquier usuario con sesión |
| `equipos` | cualquier usuario con sesión | cualquier usuario con sesión |
| `profiles` | cualquier usuario con sesión (ve todos los perfiles) | solo superadmin, y solo puede cambiar `role` y `active` — ni siquiera superadmin puede cambiar el `email` o `name` de otro usuario por esta vía (lo bloquea un trigger aparte de la política) |

Notas:

- "Cualquier usuario con sesión" = el usuario inició sesión con
  `signInWithPassword` (login normal de la app) y su cuenta está en
  `profiles`. No importa su rol específico para esas filas.
- La fila de `profiles` en "Escritura" es la única con una restricción
  además del rol: aunque seas superadmin, un `UPDATE` que intente tocar
  `email` o `name` es rechazado por un trigger (`protect_profile_columns`),
  no solo por la política RLS. Es una segunda capa de seguridad porque RLS
  por sí sola no puede limitar un `UPDATE` a columnas específicas.
- Nadie (ni superadmin) puede insertar o borrar filas de `profiles`
  directamente — esas filas las crea automáticamente el trigger
  `handle_new_user` cuando alguien se registra en Supabase Auth.
- El ocultamiento de módulos por rol en la interfaz (por ejemplo,
  "Operaciones" no ve el menú de Finanzas) sigue viviendo en el código del
  frontend (`src/shared/auth.js`, mapa `RESTRICTED`) — esta matriz es la
  capa de seguridad real en la base de datos, por si alguien intenta saltarse
  la interfaz y pegarle directo a la API.
