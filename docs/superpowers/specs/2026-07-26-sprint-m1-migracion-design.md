# Sprint M1 — Migración a Vercel + Supabase (diseño)

Fecha: 2026-07-26 · Rama de trabajo: `feature/sprint-m1` (desde `master` f518dde) · Basado en el reconocimiento del respaldo y del código post-Sprint 1.

## Objetivo

La app completa corriendo en una URL de Vercel contra Supabase, con la copia de los datos reales (6.446 filas, 8 tablas), sin tocar Replit. Replit sigue siendo el único sistema de verdad hasta el cutover.

**Fuera de alcance:** cutover (sprint aparte), limpieza de datos (sobre la copia, con lista aprobada), proxy del servicio de IA (queda como está: clave en localStorage del navegador de quien la configura — anotado para M2), endurecer RLS de LECTURA por columna (M2).

## Decisiones de diseño

1. **Adaptador, no reescritura:** `src/shared/supabase.js` se reescribe usando `@supabase/supabase-js@2` (fijando versión exacta en el CDN) conservando EXACTAMENTE el contrato actual de las 6 funciones: firmas, PATCH parcial, upsert por `id` en lotes de 100, mensajes de error en español (se propagan a los toasts), y la semántica "lanza en error" del Sprint 1 (jamás null/[]-en-error — reintroduciría el sangrado silencioso). `data-service.js` y los módulos no se tocan salvo auditoría del punto 6.
2. **Esquema desde el respaldo:** las columnas se derivan de la unión respaldo + DDL documentales del repo. Identificadores camelCase entre comillas (case-sensitive), `id TEXT PRIMARY KEY`, arrays/objetos como JSONB. Un solo archivo `supabase/schema.sql` versionado. Tabla extra nueva: `config` (key/value JSONB) para migrar `mazelab_company_info` (los datos bancarios hoy viven solo en el navegador de una persona).
3. **Auth = Supabase Auth + tabla `profiles`:** login con `signInWithPassword`; sesión JWT real (adiós al objeto en localStorage editable a mano). Roles en `profiles` (id = auth.uid, email, name, role, active); los 4 usuarios se crean una vez vía SQL/dashboard con contraseña temporal y cada uno la cambia al primer login ("¿olvidaste tu contraseña?" usa el flujo de email de Supabase). **El seed de superadmin con contraseña publicada desaparece.** `auth.js` conserva su interfaz pública completa (login, canAccess, RESTRICTED, ROLE_LABELS, gestión de usuarios → cambios de rol/activo sobre profiles, solo superadmin).
4. **Auto-registro CERRADO** (pendiente veto de Aldo): signups deshabilitados en Supabase; usuarios nuevos los crea el superadmin. Hoy cualquiera se auto-registra como operaciones.
5. **RLS pragmática de M1:** ESCRITURA estricta espejando el mapa RESTRICTED (p.ej. costos/nóminas escriben solo superadmin/socio; ventas/facturas/cotizaciones también comercial; equipos cualquier autenticado; profiles.role solo superadmin). LECTURA: cualquier usuario autenticado (kanban/bodega/events son abiertos y necesitan leer ventas; el ocultamiento visual por rol sigue en el cliente como hoy). Anónimos: nada. Función helper `get_role()` desde profiles. Endurecer lectura por vistas queda para M2.
6. **Tipos numéricos:** PostgREST devuelve `numeric` como número JSON mientras el Express devolvía strings. Auditoría dirigida de comparaciones/concatenaciones directas sobre campos de monto en los módulos + los harnesses corren con números. `parseAmountCL` ya tolera ambos.
7. **Migración re-ejecutable:** `scripts/migrate-backup.js` (Node): lee el JSON del respaldo, castea numéricos, upsert por `id` en lotes vía service_role. La clave vive en `.env` local (gitignored) que Aldot crea a mano — nunca pasa por el chat ni por git. Correrlo N veces = idempotente. El cutover será correrlo una última vez con un respaldo fresco.
8. **Vercel estático sin build:** conectar el repo, deploy de master. Arreglar el logo (hoy `branding/` está gitignoreado y la referencia de index.html saldría rota): copiar el archivo a `src/assets/` sin espacios en el nombre y ajustar la referencia.
9. **Allowlist de tablas** en el adaptador (equivalente al VALID_TABLES del Express): aunque RLS ya protege, el nombre de tabla llega del cliente.

## Verificación

- Suite nueva `tests/verify-adapter.js`: las 6 funciones contra un mock de supabase-js + contrato de errores en español.
- `npm test` completo (las 8 suites del Sprint 1 siguen verdes — nada de la lógica de negocio cambia).
- Migración: dry-run con conteos por tabla (esperados: ventas 992, facturas 1150, costos 3615, servicios 70, personal 2, clientes 599, equipos 2, cotizaciones 16) + segunda corrida que demuestre idempotencia (mismos conteos, cero duplicados).
- Post-deploy en la URL de Vercel: login real, KPIs contra la tabla de "números esperados" del checklist del Sprint 1, flujo venta→factura→NC de prueba (sobre la copia — Replit ni se entera), roles verificados con un usuario operaciones.

## Riesgos anotados

- El `public/` de Replit diverge del repo en 2 archivos (supabase.js e index.html) — justamente los que este sprint reescribe; sin impacto, pero al cutover NO se sincroniza desde Replit.
- El respaldo no trae `users` (esperado: se recrean los 4).
- `createdAt/updatedAt` vienen null en las tablas viejas — se preservan null, no se inventan fechas.
