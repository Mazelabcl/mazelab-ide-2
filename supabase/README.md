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

**Importante — qué NO hace un re-pegado:** `CREATE TABLE IF NOT EXISTS` no
toca una tabla que ya existe, ni siquiera si `schema.sql` le agregó una
columna nueva en el archivo. Volver a pegar el esquema actualiza políticas
RLS, funciones (`get_role`, `handle_new_user`, `protect_profile_columns`) y
permisos — pero **no agrega columnas nuevas a tablas que ya existan** en tu
proyecto Supabase. Si una tabla necesita una columna nueva, ese cambio llega
como un `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` aparte que entrega el
orquestador (o lo corres tú mismo con su guía) — nunca asumas que re-pegar
`schema.sql` sincroniza columnas.

## 5. Editar un profile directo desde el SQL Editor (solo superadmin)

El trigger `profiles_protect_columns` bloquea cualquier `UPDATE` que toque
`id`, `email` o `name` en `public.profiles` — y lo bloquea **incluso si lo
ejecutas tú mismo desde el SQL Editor** como superadmin, porque el trigger
corre a nivel de base de datos, no distingue quién mandó el `UPDATE`. Es
intencional (ver matriz de permisos abajo), pero si alguna vez necesitas
corregir a mano el nombre o el email de un usuario (por ejemplo, un typo al
crearlo), sigue estos 3 pasos en el SQL Editor:

1. Desactiva el trigger temporalmente:
   ```sql
   ALTER TABLE public.profiles DISABLE TRIGGER profiles_protect_columns;
   ```
2. Corrige el dato (ejemplo cambiando el nombre):
   ```sql
   UPDATE public.profiles SET "name" = 'Nombre Correcto' WHERE "email" = 'persona@mazelab.cl';
   ```
3. **Reactiva el trigger de inmediato** (no lo dejes apagado):
   ```sql
   ALTER TABLE public.profiles ENABLE TRIGGER profiles_protect_columns;
   ```

Si te saltas el paso 3, cualquier `UPDATE` posterior a `profiles` — incluso
desde la app, vía la política `profiles_update_superadmin` — podría tocar
`id`/`email`/`name` sin la protección puesta, así que siempre corre los 3
pasos juntos, en la misma sesión del SQL Editor.

## 6. Antes de que la app funcione — pasos pendientes (no son de este lote)

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
- La fila de `profiles` en "Escritura" es la única con tres capas de
  seguridad en vez de una: la política RLS decide QUIÉN puede hacer
  `UPDATE` (solo superadmin); el `GRANT UPDATE ("role", "active")` limita a
  nivel de base de datos QUÉ columnas puede tocar ese `UPDATE` (ni
  `email` ni `name` están en la lista, así que Postgres rechaza el intento
  antes de llegar a evaluar la fila); y el trigger `protect_profile_columns`
  es la tercera capa, defensa en profundidad por si algo se cuela por las
  dos anteriores. RLS por sí sola no puede limitar un `UPDATE` a columnas
  específicas — por eso hacen falta las otras dos capas.
- Nadie (ni superadmin) puede insertar o borrar filas de `profiles`
  directamente — esas filas las crea automáticamente el trigger
  `handle_new_user` cuando alguien se registra en Supabase Auth.
- El ocultamiento de módulos por rol en la interfaz (por ejemplo,
  "Operaciones" no ve el menú de Finanzas) sigue viviendo en el código del
  frontend (`src/shared/auth.js`, mapa `RESTRICTED`) — esta matriz es la
  capa de seguridad real en la base de datos, por si alguien intenta saltarse
  la interfaz y pegarle directo a la API.
