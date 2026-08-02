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
node scripts/migrate-backup.js <ruta-al-backup.json> --write
node scripts/migrate-backup.js --verify-only
```

**No hay modo por defecto.** Se requiere EXACTAMENTE una de las 3 flags de
arriba, y son una **allowlist estricta**: cualquier otra cosa (`--dryrun`,
`--dry_run`, `--DRY-RUN`, `-dry-run` con un solo guion, `--dry-run=true`,
correr el script sin ninguna flag) sale con el mensaje de uso y código 1,
**sin tocar la red ni el archivo**. Antes del fix round, un typo en la flag
(o correr el script sin flags) escalaba silenciosamente a la corrida real —
eso ya no es posible.

| Modo | Red | Requiere `.env` | Requiere ruta al backup | Qué hace |
|---|---|---|---|---|
| `--dry-run` | **Nunca** | No | Sí | Valida que el respaldo tenga las 8 tablas esperadas, castea todos los campos NUMERIC/BIGINT en memoria y reporta por tabla: filas leídas y casteadas (con el baseline del 25-jul solo como referencia informativa, ver abajo), cuántos campos se castearon, y cualquier valor no-casteable (con el `id` de la fila). Termina OK si las 8 tablas están presentes y no hay valores no-casteables. |
| `--write` | Sí | Sí | Sí | **Corrida real.** Castea igual que el dry-run y hace `upsert` por `id` en lotes de 100, secuencial, tabla por tabla, en este orden: `clientes, servicios, personal, equipos, ventas, facturas, costos, cotizaciones`. Al final hace `SELECT count` por tabla contra Supabase y compara **contra las filas del archivo que se acaba de procesar** (no contra un número hardcodeado — ver "Conteos: siempre contra el archivo" abajo). |
| `--verify-only` | Sí | Sí | No | Solo hace los `SELECT count` remotos y los lista junto al baseline del 25-jul, **sin escribir nada y sin pass/fail** (no hay archivo con el cual comparar en este modo — ver abajo). Útil para ver el estado actual de Supabase sin tocar datos. |

`--dry-run`, `--write` y `--verify-only` son excluyentes entre sí.

### Conteos: siempre contra el archivo, nunca contra un número hardcodeado

El pass/fail de este script (dry-run y `--write`) es **siempre** contra
`rows.length` del archivo que se está procesando en esa corrida — nunca
contra un número fijo del pasado. Esto importa porque el negocio sigue
operando entre el respaldo de referencia (25-jul-2026) y el día del
cutover: un respaldo fresco con más filas es el resultado **esperado**, no
un error.

- **`--dry-run`** reporta cada tabla como *"N en el archivo (baseline
  25-jul: M, +/-diff)"* — el baseline es puramente informativo, para que
  se note si algo bajó de forma inesperada; nunca hace fallar el dry-run
  por sí solo.
- **`--write`** define éxito como *"todas las filas del archivo están en
  la base"*, es decir conteo remoto **≥** filas del archivo, tabla por
  tabla. Si el remoto tiene **más** filas que el archivo (datos que
  llegaron después de este respaldo, o que no vienen en él), se informa
  como nota — *"filas adicionales en la base (no vienen en este
  respaldo)"* — nunca como fallo. Solo falla si el remoto tiene **menos**
  filas que el archivo (señal real de un `upsert` incompleto).
- **`--verify-only`** no recibe un archivo de respaldo, así que no tiene
  con qué comparar — lista los conteos remotos junto al baseline del
  25-jul como pura referencia, sin pass/fail.

### ⚠️ La corrida real requiere el esquema ya aplicado

Antes de correr el script con `--write` (ni siquiera con `--verify-only`),
`supabase/schema.sql` (Lote M1-A) debe estar aplicado en el proyecto Supabase
— las 8 tablas de negocio deben existir con sus columnas, o el `upsert`
falla de inmediato con el error de Postgres correspondiente. El script no
verifica esto de antemano: confía en que el pre-requisito (pasos del dueño,
guiados por el orquestador) ya se cumplió.

Lo que el script **sí** verifica de antemano, en los 3 modos, antes de tocar
archivo o red: que `TABLE_ORDER` (su orden interno de escritura) y las 8
tablas derivadas de `supabase/schema.sql` sean exactamente el mismo
conjunto, y que las listas de campos `NUMERIC`/`BIGINT` (ver más abajo) no
vengan vacías. Si `supabase/schema.sql` no existe o no se pudo parsear, el
script corta con un error claro y código 1 — nunca sigue adelante "en
verde" sin saber qué campos castear.

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

**⚠️ Guardar el `.env` en UTF-8, key en una sola línea.** Si al pegar la
`service_role` key en Notepad el archivo queda guardado en "Unicode" /
"UTF-16" (una opción real del desplegable "Guardar como" de Notepad en
Windows), o si la key queda partida en dos líneas al pegarla, el script
detecta que `SUPABASE_SERVICE_KEY` quedó con menos de 100 caracteres y
corta con un error explícito ("la clave parece truncada o incompleta")
en vez de dejar que la corrida real falle más adelante con un error de
autenticación confuso. Al crear el `.env`: usar "Guardar como" > elegir
**UTF-8** en el desplegable de codificación, y verificar que la línea de
`SUPABASE_SERVICE_KEY=...` sea una sola línea larga (sin saltos de línea
en medio de la key).

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
- String numérica → primero se valida contra el patrón estricto
  `/^-?\d+(\.\d+)?$/` (entero o decimal, signo opcional) y recién si calza
  se aplica `Number(...)`. Esto rechaza explícitamente `"Infinity"`,
  `"NaN"`, notación exponencial (`"1e10"`) y hex (`"0x1F"`) — strings que
  `Number(...)` a secas castearía sin avisar a un valor que no es el que
  el string representa a simple vista. Salvo en campos `BIGINT` (hoy solo
  `ventas.boardOrder`, epoch-millis) donde, si el valor excediera
  `Number.MAX_SAFE_INTEGER`, se preserva como string en vez de perder
  precisión — Postgres/PostgREST casteán un string numérico a `BIGINT` sin
  problema.
- String no numérica, tipo inesperado (boolean/array/objeto en un campo
  declarado numérico), o un valor que evaluaría a `Infinity` (una cadena
  de muchos dígitos) → se reporta como "no casteable" con el `id` de la
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

### ¿Se cortó a la mitad?

El script es **re-ejecutable por diseño**: usa `upsert` por `id`, en lotes
de 100, secuencial por tabla en `TABLE_ORDER`. Si `--write` se corta a la
mitad (se cierra la terminal, se cae la red, el proceso muere), correrlo de
nuevo con el mismo archivo **converge** — las filas que ya se escribieron
se vuelven a escribir con el mismo valor (upsert, no insert), y las que
faltaban se agregan. No duplica filas ni deja "huecos" a medio llenar
entre lotes.

**⚠️ Advertencia — re-correr sobreescribe la fila COMPLETA.** El `upsert`
reemplaza toda la fila por `id`, no solo los campos que cambiaron. Si entre
el momento del respaldo y el momento de re-correr el script alguien editó
esa misma fila **en la app nueva** (la que ya corre sobre Supabase), volver
a correr `--write` con el respaldo viejo **revierte esa edición** — pisa el
dato nuevo con el dato del respaldo.

Por eso el procedimiento de cutover exige congelar la app vieja (Replit)
antes de generar el respaldo, y no volver a escribir en Supabase desde
ningún otro lugar mientras se corre o se re-corre este script: el respaldo
usado debe ser siempre el más fresco posible, generado con la app vieja ya
detenida, para que "re-correr por las dudas" nunca tenga datos nuevos que
pisar.
