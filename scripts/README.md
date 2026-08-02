# scripts/ — Migración de respaldo a Supabase (Sprint M1, Lote M1-C)

Esta carpeta es para el **orquestador**, no para el dueño del proyecto. El
dueño no corre estos comandos directamente — el orquestador los ejecuta en su
nombre cuando corresponda (después de que el dueño pegó `supabase/schema.sql`
en el SQL Editor de Supabase y creó su `.env` local).

## `migrate-backup.js`

Migra el respaldo JSON del Postgres de Replit (`mazelab-backup-2026-07-25.json`,
8 tablas) a Supabase, casteando los campos numéricos que el driver `pg`
serializó como string. Es **re-ejecutable**: usa `upsert` por `id`, así que
correrlo N veces da los mismos conteos — nunca duplica filas.

### Los 3 modos

```
node scripts/migrate-backup.js <ruta-al-backup.json> --dry-run
node scripts/migrate-backup.js <ruta-al-backup.json>
node scripts/migrate-backup.js --verify-only
```

| Modo | Red | Requiere `.env` | Requiere ruta al backup | Qué hace |
|---|---|---|---|---|
| `--dry-run` | **Nunca** | No | Sí | Valida que el respaldo tenga las 8 tablas esperadas, castea todos los campos NUMERIC/BIGINT en memoria y reporta por tabla: filas (vs. el conteo esperado), cuántos campos se castearon, y cualquier valor no-casteable (con el `id` de la fila). Termina en el conteo de 8 tablas OK / 0 no-casteables, o lista las diferencias. |
| _(sin flags)_ | Sí | Sí | Sí | **Corrida real.** Castea igual que el dry-run y hace `upsert` por `id` en lotes de 100, secuencial, tabla por tabla, en este orden: `clientes, servicios, personal, equipos, ventas, facturas, costos, cotizaciones`. Al final hace `SELECT count` por tabla contra Supabase y muestra la tabla resumen esperado-vs-en-base. Sale con código 1 si algún conteo no calza. |
| `--verify-only` | Sí | Sí | No | Solo hace los `SELECT count` remotos y compara contra los conteos esperados — no escribe nada. Útil para confirmar el estado de Supabase sin volver a tocar datos (por ejemplo, después de una corrida real, o para chequear el estado sin tener el archivo de respaldo a mano). |

`--dry-run` y `--verify-only` son excluyentes entre sí.

### ⚠️ La corrida real requiere el esquema ya aplicado

Antes de correr el script **sin** `--dry-run` (ni siquiera `--verify-only`),
`supabase/schema.sql` (Lote M1-A) debe estar aplicado en el proyecto Supabase
— las 8 tablas de negocio deben existir con sus columnas, o el `upsert`
falla de inmediato con el error de Postgres correspondiente. El script no
verifica esto de antemano: confía en que el pre-requisito (pasos del dueño,
guiados por el orquestador) ya se cumplió.

### Credenciales (`.env`)

El script parsea `.env` en la raíz del repo a mano (sin `dotenv`), tolerando
el formato que produce Notepad en Windows (el dueño lo crea con Bloc de
notas): BOM UTF-8, fin de línea CRLF, y espacios alrededor de la clave, el
`=` y el valor. Debe tener:

```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=<service_role key, NO la anon key>
```

La `service_role` key vive en el dashboard de Supabase: *Project Settings >
API > service_role*. Bypasa RLS — por eso solo se usa en este script server-
side, nunca en el cliente (`src/shared/supabase.js` usa la `anon` key).

En `--dry-run`, si falta `.env` o alguna de las dos claves, el script
simplemente no las necesita y sigue sin red. En los otros dos modos, si
falta el archivo o alguna clave, el script lanza un error en español con las
instrucciones exactas para crearlo y sale con código 1 — nunca intenta
conectarse con credenciales parciales.

### Cast de tipos

Las listas de campos `NUMERIC`/`BIGINT` por tabla **no están duplicadas
aquí** — se importan por `require` directo desde
`tests/verify-schema-sql.js` (que las deriva parseando `supabase/schema.sql`).
Si el esquema cambia, este script queda sincronizado automáticamente sin
tocar código.

Reglas de cast:
- `null` se preserva `null`.
- Ya viene como `number` (algunos campos del respaldo, como `jornadas` o
  `plazo_pago`, no vienen como string) → se deja tal cual.
- String vacía en un campo numérico → `null` (decisión explícita: Postgres
  rechazaría una columna `NUMERIC`/`BIGINT` con `''`).
- String numérica → `Number(...)`, salvo en campos `BIGINT` (hoy solo
  `ventas.boardOrder`, epoch-millis) donde, si el valor excediera
  `Number.MAX_SAFE_INTEGER`, se preserva como string en vez de perder
  precisión — Postgres/PostgREST casteán un string numérico a `BIGINT` sin
  problema.
- String no numérica o tipo inesperado (boolean/array/objeto en un campo
  declarado numérico) → se reporta como "no casteable" con el `id` de la
  fila, y NO se fuerza ningún valor (queda como venía, para que el error de
  Postgres en la corrida real sea visible en vez de corromper el dato en
  silencio).
- Campos `JSONB` no se tocan — ya llegan como array/objeto/`null` nativo
  desde el JSON.

### Dependencia

Usa `@supabase/supabase-js` (agregada como `dependency` normal en
`package.json`, no `devDependency` — el script corre standalone con Node,
fuera del build de la app). El `require('@supabase/supabase-js')` es
perezoso (dentro de la función que crea el cliente) para que `--dry-run`
nunca dependa de que el paquete esté instalado.
