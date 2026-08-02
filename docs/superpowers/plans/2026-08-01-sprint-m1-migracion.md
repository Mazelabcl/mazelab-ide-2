# Sprint M1 — Migración a Vercel + Supabase — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Un lote escritor a la vez; revisores Opus en paralelo solo AS-OF commits.

**Goal:** App completa en URL de Vercel contra Supabase con copia de datos reales, Replit intacto.

**Architecture:** Ver spec `docs/superpowers/specs/2026-07-26-sprint-m1-migracion-design.md` (aprobado con auto-registro cerrado + reset por email). Contrato del adaptador y hallazgos en el recon (sesión 2026-07-26): 6 funciones, errores en español que LANZAN, upsert por id en lotes de 100, PATCH parcial. Fuente del esquema: respaldo `C:\Users\aldot\Downloads\mazelab-backup-2026-07-25.json` (8 tablas, 6.446 filas; numéricos como string) + DDL documentales (REPLIT_DEPLOY.md, DATABASE_INFO.md, SYNC_FROM_GITHUB.md).

**Tech Stack:** Supabase (Postgres + Auth + RLS) vía `@supabase/supabase-js@2` (CDN versión fijada), Vercel estático sin build, Node para scripts/tests.

Proyecto Supabase: `https://xitbarrinioswpyjiwyc.supabase.co` (anon key en `memory/sprint-m1-migracion.md` de la memoria del proyecto / la proporciona el orquestador).

---

## Lote M1-A: Esquema SQL + RLS (sin dependencias — primero)

**Files:** Create `supabase/schema.sql`, `supabase/README.md`.

1. Derivar columnas de cada una de las 8 tablas: unión de campos del respaldo JSON (leerlo con Node, no volcarlo) + DDL documentales. Convenciones: `id TEXT PRIMARY KEY`; identificadores camelCase ENTRE COMILLAS; montos `NUMERIC`; `boardOrder BIGINT`; arrays/objetos `JSONB` con default sensato; texto `TEXT`. `createdAt/updatedAt TEXT` (la app los maneja como strings; no inventar timestamptz salvo cotizaciones/equipos que ya los traen — mantener compatibles con el dato real del respaldo).
2. Tablas nuevas: `profiles` (`id UUID PK REFERENCES auth.users ON DELETE CASCADE, email TEXT UNIQUE, name TEXT DEFAULT '', role TEXT DEFAULT 'operaciones', active BOOLEAN DEFAULT true`) y `config` (`key TEXT PK, value JSONB`).
3. Trigger `handle_new_user` AFTER INSERT ON auth.users → crea el profile. El rol inicial se asigna por email con un CASE (los 4 correos/roles los inyecta el orquestador antes de entregar el SQL — placeholder claramente marcado `-- ORQUESTADOR: completar emails`).
4. Helper `public.get_role() RETURNS TEXT` (SECURITY DEFINER, lee profiles por auth.uid()).
5. RLS en TODAS las tablas. Lectura: `authenticated`. Escritura (INSERT/UPDATE/DELETE):
   - `ventas`, `facturas`, `cotizaciones`: superadmin, socio, comercial
   - `costos`: superadmin, socio
   - `servicios`, `personal`, `clientes`, `equipos`: authenticated (settings/bodega son rutas abiertas hoy)
   - `config`: superadmin, socio
   - `profiles`: SELECT authenticated; UPDATE de `role`/`active` solo superadmin; nadie inserta/borra directo (lo hace el trigger).
   - Anónimos: cero acceso a todo.
6. `supabase/README.md`: cómo aplicar (pegar en SQL Editor), cómo re-aplicar (el schema debe ser idempotente: `CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS` + CREATE), y la matriz de permisos en tabla.
7. Verificación: script Node `tests/verify-schema-sql.js` que parsea schema.sql y valida: las 8+2 tablas presentes, columnas del respaldo cubiertas (compara contra el JSON real), RLS habilitado en todas, ninguna política para `anon`. Commit.

## Lote M1-B: Adaptador supabase.js + auth.js sobre Supabase

**Files:** Modify `src/shared/supabase.js`, `src/shared/auth.js`, `src/shared/auth-ui.js`, `index.html`.

1. `supabase.js`: cliente supabase-js (URL + anon key), mismas 6 funciones y contrato EXACTO (recon §3): mensajes de error en español idénticos en formato, lanzan siempre, upsert `onConflict:'id'` en lotes de 100 secuenciales, allowlist de tablas (las 8 + rechazo explícito de cualquier otra), `isConnected`. `update` envía solo el delta. `fetchAll` ordena estable (por `createdAt` si existe o `id`).
2. `auth.js`: misma interfaz pública (recon §4) sobre Supabase Auth: `login` → `signInWithPassword` + carga del profile; `logout` → `signOut`; `getUser` desde la sesión de supabase-js + profile cacheado; `register` → deshabilitado (lanza "El registro está cerrado — pide acceso al administrador"); gestión de usuarios → UPDATE sobre profiles (role/active); `resetPassword` → `resetPasswordForEmail`; ELIMINAR: seed de superadmin, hash SHA-256, `mazelab_users_local`, fallback a localStorage de usuarios. `canAccess`/`RESTRICTED`/`ROLE_LABELS` intactos.
3. `auth-ui.js`: quitar el formulario de registro; agregar "¿Olvidaste tu contraseña?".
4. `index.html`: fijar versión exacta del CDN supabase-js; el orden de scripts se mantiene.
5. `data-service.js` NO se toca (el contrato del adaptador lo garantiza). `app.js:221-223` (bypass de login si AuthUI no carga) → corregir: sin AuthUI, mostrar error, no entrar.
6. Verificación: `tests/verify-adapter.js` (mock de supabase-js: las 6 funciones, contrato de errores, allowlist, lotes de 100) + `npm test` completo verde + trazado de auth (login OK, login mal password → error español, ruta restringida por rol). Commit.

## Lote M1-C: Script de migración re-ejecutable

**Files:** Create `scripts/migrate-backup.js`, `scripts/README.md`.

1. Lee `.env` (SUPABASE_URL, SUPABASE_SERVICE_KEY) — sin dependencia dotenv (parse manual de 5 líneas) — y la ruta del respaldo por argumento (`node scripts/migrate-backup.js "C:\...\mazelab-backup-2026-07-25.json"`).
2. Por tabla: castear numéricos string→number (lista de campos NUMERIC del schema), preservar null, upsert por `id` en lotes de 100 con supabase-js (service key, bypassa RLS). Reporte final: conteos por tabla insertados/actualizados vs esperados (992/1150/3615/70/2/599/2/16), diffs si no calzan, exit code.
3. `--dry-run`: valida y cuenta sin escribir.
4. Idempotencia: correrlo dos veces = mismos conteos, cero duplicados (verificar con un SELECT count por tabla vía service key al final).
5. Verificación: dry-run real contra el archivo + (cuando el esquema esté aplicado) corrida real y segunda corrida demostrando idempotencia. Commit.

## Lote M1-D: Vercel + logo + config table wiring

**Files:** Modify `index.html`, `src/modules/settings/settings.js`, `src/modules/finance/finance.js`, `src/modules/cotizador/cotizador.js`; Create `src/assets/` (logo).

1. Logo: copiar `branding/logo and isotype/MazeLab_Logo degrade.png` → `src/assets/mazelab-logo.png`, actualizar referencia en index.html, verificar que .gitignore no lo excluya (src/assets/ con excepción si hace falta).
2. `mazelab_company_info` → tabla `config` (key `company_info`): settings lee/escribe vía DataService (entidad nueva `config` en TABLE_MAP), finance/cotizador leen con fallback al localStorage para transición. Cachear en memoria al cargar.
3. Auditoría de tipos numéricos (spec §6): grep dirigido de comparaciones/concatenación sobre campos de monto que asuman string; corregir solo lo que rompa (reportar lista).
4. Verificación: `npm test` + harness de config + revisión visual del index (logo). Commit.

## Lote M1-E: Verificación E2E + revisión final

1. Con esquema aplicado + datos migrados + Vercel conectado (pasos del dueño): correr contra la URL de Vercel el checklist: login de los 4 roles, KPIs vs tabla de números esperados del Sprint 1, flujo venta→factura parcial→NC de prueba sobre la copia, usuario operaciones no ve finanzas, `?localdev=1` sigue funcionando, offline banner.
2. Revisión final Opus del diff completo del sprint.
3. Actualizar memoria (sprint-m1-migracion.md estado) + reporte a Aldo.

---

**Pasos del dueño (los guía el orquestador en el momento):** pegar schema.sql en el SQL Editor; crear los 4 usuarios en Auth (dashboard) con contraseña temporal; desactivar signups (Auth → Providers → Email → disable signups); crear `.env` local; autorizar GitHub→Vercel.
