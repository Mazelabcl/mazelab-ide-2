-- ============================================================================
-- MazeLab OS — Esquema Supabase (Sprint M1, Lote M1-A)
-- ============================================================================
-- Origen de las columnas: union de campos observados en TODAS las filas del
-- respaldo real (mazelab-backup-2026-07-25.json — 8 tablas, 6.446 filas) +
-- DDL documentales del repo (REPLIT_DEPLOY.md, DATABASE_INFO.md,
-- SYNC_FROM_GITHUB.md, memory/replit-pending-sql.md) + grep de escrituras
-- DataService.create/update en src/ (no se encontraron campos nuevos que el
-- código escriba y el respaldo no tenga).
--
-- Convenciones:
--   - id TEXT PRIMARY KEY en las 8 tablas de negocio.
--   - Identificadores camelCase SIEMPRE entre comillas dobles (Postgres los
--     pliega a minusculas si no se citan, y PostgREST exige case-sensitivity
--     exacto). Tambien se citan los snake_case heredados (equipos.created_at,
--     facturas.monto_venta, etc.) para mantener consistencia visual.
--   - Montos y porcentajes -> NUMERIC (incluye contadores no monetarios como
--     jornadas/paymentTerms/validezDias/version/boardColumn: el respaldo real
--     los trae como numero via el driver `pg`, que ademas devuelve NUMERIC y
--     BIGINT como string — PostgREST en cambio serializa toda la familia
--     numeric/bigint/integer como numero JSON nativo via to_json(), asi que
--     no hay perdida de compatibilidad al usar NUMERIC de forma amplia).
--   - boardOrder -> BIGINT (unico caso: epoch-millis, puede exceder el rango
--     seguro de un JS number si se declarara NUMERIC-int64 sin cuidado).
--   - BOOLEAN para flags.
--   - JSONB para arrays/objetos, con DEFAULT '[]'::jsonb en los campos de
--     forma-arreglo (listas de items/pagos/notas). Los campos de forma-objeto
--     (ventas.traspaso) quedan JSONB nullable sin default.
--   - createdAt/updatedAt -> TEXT en las 6 tablas donde el respaldo los trae
--     100% NULL y la app los maneja como string. cotizaciones y equipos SI
--     traen timestamps reales (ISO con Z) -> TIMESTAMPTZ DEFAULT NOW().
--
-- Idempotencia: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE
-- POLICY, CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS + CREATE
-- TRIGGER. Todo el archivo se puede volver a pegar y correr sin error (ver
-- nota en README sobre columnas nuevas en tablas ya existentes). Todo el
-- archivo corre dentro de una unica transaccion (BEGIN/COMMIT): si algo
-- falla a mitad de camino, Postgres revierte TODO, nunca deja tablas con
-- RLS habilitado pero sin sus politicas, o politicas sin sus grants. El
-- trigger sobre auth.users va al final, despues de GRANT/REVOKE, por ser la
-- sentencia mas propensa a fallar por permisos (el schema auth no es de
-- este proyecto) — si falla, no debe arrastrar al resto de la migracion.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. TABLAS DE NEGOCIO (8, derivadas del respaldo real)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ventas (992 filas en el respaldo) — TABLE_MAP: sales -> ventas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ventas (
    "id"                      TEXT PRIMARY KEY,
    "sourceId"                TEXT,
    "clientId"                TEXT,
    "clientName"              TEXT,
    "eventName"               TEXT,
    "eventDate"               TEXT,
    "closingDate"             TEXT,
    "serviceIds"              JSONB DEFAULT '[]'::jsonb,
    "serviceNames"            TEXT,
    "jornadas"                NUMERIC,
    "amount"                  NUMERIC DEFAULT 0,
    "costAmount"              NUMERIC,
    "utility"                 NUMERIC,
    "refundAmount"            NUMERIC DEFAULT 0,
    "comisionPct"             NUMERIC DEFAULT 0,
    "staffId"                 TEXT,
    "staffName"               TEXT,
    "status"                  TEXT,
    "comments"                TEXT DEFAULT '',
    "hasIssue"                BOOLEAN DEFAULT false,
    -- Board Operativo (kanban)
    "boardColumn"             NUMERIC,
    "boardOrder"              BIGINT,
    "checklist"               JSONB DEFAULT '[]'::jsonb,
    "encargado"               TEXT DEFAULT '',
    "kanbanNotes"             TEXT DEFAULT '',
    "equiposAsignados"        JSONB DEFAULT '[]'::jsonb,
    -- Traspaso (ficha operativa), consolidado en un solo objeto JSONB
    "traspaso"                JSONB,
    -- Columnas planas legacy de traspaso: siempre NULL en el respaldo real,
    -- superadas por el objeto "traspaso" de arriba, pero existen como
    -- columnas reales y deben preservarse (verificador exige cobertura 1:1).
    "traspaso_contactoNombre" TEXT,
    "traspaso_contactoTel"    TEXT,
    "traspaso_contactoEmail"  TEXT,
    "traspaso_lugarEvento"    TEXT,
    "traspaso_horaMontaje"    TEXT,
    "traspaso_horaInicio"     TEXT,
    "traspaso_horaTermino"    TEXT,
    "traspaso_pax"            TEXT,
    "traspaso_vestimenta"     TEXT,
    "traspaso_notaVendedor"   TEXT,
    "createdAt"               TEXT,
    "updatedAt"               TEXT
);

-- ---------------------------------------------------------------------------
-- facturas (1150 filas) — TABLE_MAP: receivables -> facturas (CXC)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.facturas (
    "id"              TEXT PRIMARY KEY,
    "sourceId"        TEXT,
    "sourceType"      TEXT,
    "saleId"          TEXT,
    "clientName"      TEXT,
    "eventName"       TEXT,
    "eventDate"       TEXT,
    "tipoDoc"         TEXT,
    "invoiceNumber"   TEXT,
    "billingMonth"    TEXT,
    "paymentTerms"    NUMERIC DEFAULT 30,
    "monto_venta"     NUMERIC,
    "montoNeto"       NUMERIC,
    "montoFacturado"  NUMERIC,
    "invoicedAmount"  NUMERIC DEFAULT 0,
    "amount"          NUMERIC,
    "amountPaid"      NUMERIC,
    "pendingAmount"   NUMERIC,
    "status"          TEXT,
    "ncAsociada"      TEXT,
    "comments"        TEXT DEFAULT '',
    "payments"        JSONB DEFAULT '[]'::jsonb,
    "cobros"          JSONB DEFAULT '[]'::jsonb,
    "avisos_factura"  JSONB DEFAULT '[]'::jsonb,
    "notas_cobranza"  JSONB DEFAULT '[]'::jsonb,
    "createdAt"       TEXT,
    "updatedAt"       TEXT
);

-- ---------------------------------------------------------------------------
-- costos (3615 filas) — TABLE_MAP: payables -> costos (CXP)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.costos (
    "id"           TEXT PRIMARY KEY,
    "eventId"      TEXT,
    "eventName"    TEXT,
    "clientName"   TEXT,
    "eventDate"    TEXT,
    "billingDate"  TEXT,
    "category"     TEXT,
    "concept"      TEXT,
    "vendorName"   TEXT,
    "docType"      TEXT,
    "docNumber"    TEXT,
    "amount"       NUMERIC DEFAULT 0,
    "amountPaid"   NUMERIC,
    "status"       TEXT,
    "payments"     JSONB DEFAULT '[]'::jsonb,
    "comments"     TEXT DEFAULT '',
    "nominaDate"   TEXT,
    "paymentDate"  TEXT,
    "createdAt"    TEXT,
    "updatedAt"    TEXT
);

-- ---------------------------------------------------------------------------
-- servicios (70 filas) — TABLE_MAP: services -> servicios
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.servicios (
    "id"                   TEXT PRIMARY KEY,
    "name"                 TEXT,
    "nombre"               TEXT,
    "categoria"            TEXT,
    "descripcion"          TEXT,
    "precio_base"          NUMERIC,
    "costo_base_estimado"  NUMERIC,
    "cost_template"        JSONB DEFAULT '[]'::jsonb,
    "duracion_tipo"        TEXT,
    "duracion_default"     NUMERIC,
    "activo"               BOOLEAN DEFAULT true,
    "featured"             BOOLEAN DEFAULT false,
    "specs"                TEXT,
    "notas_ops"            TEXT,
    "faq"                  TEXT,
    "template_saludo"      TEXT,
    "template_diseno"      TEXT,
    "link_fotos"           TEXT,
    "link_landing"         TEXT,
    -- Guardados como JSON.stringify(...) por el frontend (no objetos nativos)
    "tarifario"            TEXT,
    "equipos_checklist"    TEXT,
    "comments"             TEXT DEFAULT '',
    "createdAt"            TEXT,
    "updatedAt"            TEXT
);

-- ---------------------------------------------------------------------------
-- personal (2 filas) — TABLE_MAP: staff -> personal
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.personal (
    "id"              TEXT PRIMARY KEY,
    "name"            TEXT,
    "nombre"          TEXT,
    "tipo"            TEXT,
    "especialidad"    TEXT,
    "tipo_documento"  TEXT,
    "rut"             TEXT,
    "banco"           TEXT,
    "tipo_cuenta"     TEXT,
    "numero_cuenta"   TEXT,
    "email"           TEXT,
    "telefono"        TEXT,
    "comments"        TEXT DEFAULT '',
    "createdAt"       TEXT,
    "updatedAt"       TEXT
);

-- ---------------------------------------------------------------------------
-- clientes (599 filas) — TABLE_MAP: clients -> clientes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clientes (
    "id"           TEXT PRIMARY KEY,
    "name"         TEXT,
    "nombre"       TEXT,
    "rut"          TEXT,
    "plazo_pago"   NUMERIC DEFAULT 30,
    "ejecutivos"   JSONB DEFAULT '[]'::jsonb,
    "contactos"    JSONB DEFAULT '[]'::jsonb,
    "activo"       BOOLEAN DEFAULT true,
    "notas"        TEXT DEFAULT '',
    "comments"     TEXT DEFAULT '',
    "createdAt"    TEXT,
    "updatedAt"    TEXT
);

-- ---------------------------------------------------------------------------
-- equipos (2 filas) — TABLE_MAP: bodega -> equipos.
-- Unica tabla de negocio con columnas snake_case y timestamptz real (ya
-- traia created_at como TIMESTAMPTZ en el respaldo original — se preserva
-- tal cual, sin forzar camelCase ni TEXT sobre un dato que ya es timestamp).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.equipos (
    "id"          TEXT PRIMARY KEY,
    "equipo_id"   TEXT,
    "nombre"      TEXT,
    "categoria"   TEXT,
    "estado"      TEXT,
    "notas"       TEXT DEFAULT '',
    "created_at"  TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- cotizaciones (16 filas) — ya definida en REPLIT_DEPLOY.md; se reproduce
-- aqui identica + el campo nuevo "cotMode" (Sprint S02, toggle
-- Paquete/Opciones, ya presente en el 100% de las filas del respaldo).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cotizaciones (
    "id"             TEXT PRIMARY KEY,
    "codigo"         TEXT,
    "version"        NUMERIC DEFAULT 1,
    "clientName"     TEXT,
    "contactName"    TEXT,
    "contactEmail"   TEXT,
    "contactTel"     TEXT,
    "eventName"      TEXT,
    "eventDate"      TEXT,
    "lugar"          TEXT,
    "validezDias"    NUMERIC DEFAULT 7,
    "condiciones"    TEXT DEFAULT '50% adelanto, 50% a 30 dias',
    "estado"         TEXT DEFAULT 'borrador',
    "cotMode"        TEXT DEFAULT 'paquete',
    "bloques"        JSONB DEFAULT '[]'::jsonb,
    "subtotal"       NUMERIC DEFAULT 0,
    "descuento"      NUMERIC DEFAULT 0,
    "descuentoPct"   NUMERIC DEFAULT 0,
    "descuentoNota"  TEXT,
    "totalNeto"      NUMERIC DEFAULT 0,
    "notas"          TEXT,
    "saleId"         TEXT,
    "createdAt"      TIMESTAMPTZ DEFAULT NOW(),
    "updatedAt"      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 2. TABLAS NUEVAS (auth + config)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.profiles (
    "id"          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    "email"       TEXT UNIQUE,
    "name"        TEXT DEFAULT '',
    "role"        TEXT DEFAULT 'operaciones',
    "active"      BOOLEAN DEFAULT true,
    "created_at"  TIMESTAMPTZ DEFAULT NOW()
);

-- Hallazgo M4: proyectos donde profiles ya existia ANTES de este campo no
-- reciben la columna solo con el CREATE TABLE IF NOT EXISTS de arriba (la
-- tabla ya existe, Postgres lo ignora) — este ALTER es lo que de verdad la
-- agrega en esos entornos. Idempotente: ADD COLUMN IF NOT EXISTS no falla si
-- ya esta presente (proyectos nuevos donde el CREATE TABLE ya la trajo).
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMPTZ DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.config (
    -- Contrato del adaptador generico: TODAS las tablas se operan por "id"
    -- (DataService.getAll/create/update/remove asumen PK "id" en todas las
    -- tablas). config es la unica tabla de este archivo cuyo identificador
    -- de negocio natural es "key" (no un id arbitrario) — se preserva "key"
    -- como UNIQUE NOT NULL para las lecturas por nombre de config, y se
    -- agrega "id" TEXT PRIMARY KEY para que el adaptador generico funcione
    -- igual que en el resto de las tablas.
    "id"     TEXT PRIMARY KEY,
    "key"    TEXT UNIQUE NOT NULL,
    "value"  JSONB
);

-- ============================================================================
-- 3. FUNCIONES + TRIGGERS
-- ============================================================================

-- ---------------------------------------------------------------------------
-- handle_new_user: crea el profile automaticamente al registrarse un usuario
-- en auth.users. El rol inicial se asigna por email. Auto-registro esta
-- CERRADO en Supabase (Auth > Providers > Email > disable signups), asi que
-- en la practica solo el superadmin crea usuarios desde el dashboard — pero
-- el trigger igual corre para esos altas. El trigger que la conecta a
-- auth.users (on_auth_user_created) se define al FINAL de este archivo, no
-- aqui — ver seccion 7.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles ("id", "email", "name", "role", "active")
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'name', ''),
        -- ORQUESTADOR: completar emails
        CASE lower(NEW.email)
            WHEN 'aldo@mazelab.cl' THEN 'superadmin'
            -- WHEN 'socio@mazelab.cl'      THEN 'socio'
            -- WHEN 'comercial@mazelab.cl'  THEN 'comercial'
            -- WHEN 'operaciones@mazelab.cl' THEN 'operaciones'
            ELSE 'operaciones'
        END,
        true
    )
    ON CONFLICT ("id") DO NOTHING;
    RETURN NEW;
EXCEPTION
    WHEN unique_violation THEN
        -- Colision en un unique distinto de "id" (tipicamente "email": un
        -- profile huerfano con el mismo correo, de un alta previa que quedo
        -- desincronizada de auth.users). Crear un usuario NUNCA debe morir
        -- con "Database error saving new user": se actualiza el profile
        -- existente para que quede enlazado al nuevo id.
        UPDATE public.profiles
        SET "id" = NEW.id,
            "name" = COALESCE(NULLIF(NEW.raw_user_meta_data->>'name', ''), "name"),
            "active" = true
        WHERE "email" = NEW.email;
        RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- get_role(): helper de RLS. SECURITY DEFINER + search_path fijado a
-- 'public' — sin el SET search_path, una funcion SECURITY DEFINER es
-- vulnerable a que alguien con permiso de CREATE en otro schema del mismo
-- rol inyecte un objeto con el mismo nombre en un schema que quede antes de
-- "public" en el search_path del llamador (hoyo de seguridad conocido y
-- documentado por Postgres/Supabase para funciones SECURITY DEFINER).
-- "AND active": un usuario desactivado (profiles.active = false) pierde su
-- rol a nivel de base de datos al instante — get_role() devuelve NULL y
-- ninguna politica de escritura lo reconoce como superadmin/socio/comercial,
-- sin depender de que el frontend respete el flag.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid() AND active;
$$;

-- ---------------------------------------------------------------------------
-- protect_profile_columns: RLS por si sola no puede restringir un UPDATE a
-- columnas especificas (USING/WITH CHECK ven la fila completa, no columna a
-- columna). La politica de abajo ya limita QUIEN puede hacer UPDATE
-- (superadmin), y este trigger asegura QUE columnas puede tocar ese UPDATE
-- (solo role/active — id/email/name quedan inmutables por esta via).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_profile_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.name IS DISTINCT FROM OLD.name THEN
        RAISE EXCEPTION 'Solo se pueden actualizar los campos role y active en profiles';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_columns ON public.profiles;
CREATE TRIGGER profiles_protect_columns
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.protect_profile_columns();

-- ---------------------------------------------------------------------------
-- protect_ventas_operational_columns: mismo patron que protect_profile_columns
-- (RLS decide QUIEN puede hacer UPDATE via USING/WITH CHECK, no ve columnas
-- individuales — este trigger es quien restringe QUE columnas). La politica
-- ventas_update_operaciones (seccion 5) le abre UPDATE a operaciones porque el
-- kanban lo necesita (mover tarjetas, marcar checklist, asignar equipos,
-- completar traspaso) — pero operaciones NUNCA debe poder tocar columnas
-- comerciales/financieras (amount, status, clientName, staffId, etc.), que
-- siguen siendo terreno exclusivo de ventas_write_comercial (superadmin,
-- socio, comercial). Si el rol no es operaciones, el trigger no hace nada
-- (esos roles ya pasaron por ventas_write_comercial sin esta restriccion).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_ventas_operational_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF (SELECT public.get_role()) IS DISTINCT FROM 'operaciones' THEN
        RETURN NEW;
    END IF;

    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."sourceId" IS DISTINCT FROM OLD."sourceId"
       OR NEW."clientId" IS DISTINCT FROM OLD."clientId"
       OR NEW."clientName" IS DISTINCT FROM OLD."clientName"
       OR NEW."eventName" IS DISTINCT FROM OLD."eventName"
       OR NEW."eventDate" IS DISTINCT FROM OLD."eventDate"
       OR NEW."closingDate" IS DISTINCT FROM OLD."closingDate"
       OR NEW."serviceIds" IS DISTINCT FROM OLD."serviceIds"
       OR NEW."serviceNames" IS DISTINCT FROM OLD."serviceNames"
       OR NEW."jornadas" IS DISTINCT FROM OLD."jornadas"
       OR NEW."amount" IS DISTINCT FROM OLD."amount"
       OR NEW."costAmount" IS DISTINCT FROM OLD."costAmount"
       OR NEW."utility" IS DISTINCT FROM OLD."utility"
       OR NEW."refundAmount" IS DISTINCT FROM OLD."refundAmount"
       OR NEW."comisionPct" IS DISTINCT FROM OLD."comisionPct"
       OR NEW."staffId" IS DISTINCT FROM OLD."staffId"
       OR NEW."staffName" IS DISTINCT FROM OLD."staffName"
       OR NEW."status" IS DISTINCT FROM OLD."status"
       OR NEW."comments" IS DISTINCT FROM OLD."comments"
       OR NEW."hasIssue" IS DISTINCT FROM OLD."hasIssue"
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
       OR NEW."updatedAt" IS DISTINCT FROM OLD."updatedAt" THEN
        RAISE EXCEPTION 'Tu rol (operaciones) solo puede actualizar los campos operativos del board (checklist, boardColumn, boardOrder, encargado, kanbanNotes, traspaso, equiposAsignados y los campos traspaso_*) — no puedes modificar datos comerciales ni financieros de la venta';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ventas_protect_operational_columns ON public.ventas;
CREATE TRIGGER ventas_protect_operational_columns
    BEFORE UPDATE ON public.ventas
    FOR EACH ROW EXECUTE FUNCTION public.protect_ventas_operational_columns();

-- ============================================================================
-- 4. ROW LEVEL SECURITY — habilitar en las 10 tablas
-- ============================================================================

ALTER TABLE public.ventas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facturas     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.costos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.servicios    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cotizaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.config       ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 5. POLITICAS RLS
-- ============================================================================
-- Matriz completa documentada en supabase/README.md. Resumen:
--   Lectura: authenticated en TODO (kanban/bodega/dashboard son rutas
--   abiertas hoy y necesitan leer ventas/facturas/etc.; el ocultamiento
--   visual por rol sigue viviendo en el cliente, como hoy).
--   Escritura (INSERT/UPDATE/DELETE) por tabla:
--     ventas, facturas, cotizaciones -> superadmin, socio, comercial
--     costos, config                 -> superadmin, socio
--     servicios, personal, clientes, equipos -> cualquier authenticated
--     profiles -> SELECT authenticated; UPDATE (solo role/active) superadmin;
--                 INSERT/DELETE bloqueados para todos (los crea el trigger).
--   anon: cero politicas en ningun lado -> cero acceso a todo.
--   Rendimiento: toda llamada a get_role() dentro de USING/WITH CHECK va
--   envuelta en subselect — (SELECT public.get_role()) — patron InitPlan
--   recomendado por Supabase: Postgres la evalua una sola vez por consulta
--   en vez de una vez por fila.
-- ============================================================================

-- ---- ventas / facturas / cotizaciones: superadmin, socio, comercial ----
DROP POLICY IF EXISTS "ventas_select_authenticated" ON public.ventas;
CREATE POLICY "ventas_select_authenticated" ON public.ventas
    FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "ventas_write_comercial" ON public.ventas;
CREATE POLICY "ventas_write_comercial" ON public.ventas
    FOR ALL TO authenticated
    USING ((SELECT public.get_role()) IN ('superadmin', 'socio', 'comercial'))
    WITH CHECK ((SELECT public.get_role()) IN ('superadmin', 'socio', 'comercial'));

-- Decision de producto (orquestador, Sprint M1 fix round): operaciones NO
-- puede escribir en ventas via ventas_write_comercial (no esta en la lista de
-- roles), pero el kanban operativo SI necesita que operaciones mueva
-- tarjetas, marque checklist, asigne equipos y complete el traspaso. Esta
-- politica adicional (permissiva, se OR-ea con ventas_write_comercial) le
-- abre UPDATE a operaciones; el trigger protect_ventas_operational_columns
-- (abajo, seccion 3) es quien de verdad limita QUE columnas puede tocar —
-- sin ese trigger, operaciones podria editar amount/status/clientName, que
-- es terreno exclusivo de superadmin/socio/comercial.
DROP POLICY IF EXISTS "ventas_update_operaciones" ON public.ventas;
CREATE POLICY "ventas_update_operaciones" ON public.ventas
    FOR UPDATE TO authenticated
    USING ((SELECT public.get_role()) = 'operaciones')
    WITH CHECK ((SELECT public.get_role()) = 'operaciones');

DROP POLICY IF EXISTS "facturas_select_authenticated" ON public.facturas;
CREATE POLICY "facturas_select_authenticated" ON public.facturas
    FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "facturas_write_comercial" ON public.facturas;
CREATE POLICY "facturas_write_comercial" ON public.facturas
    FOR ALL TO authenticated
    USING ((SELECT public.get_role()) IN ('superadmin', 'socio', 'comercial'))
    WITH CHECK ((SELECT public.get_role()) IN ('superadmin', 'socio', 'comercial'));

DROP POLICY IF EXISTS "cotizaciones_select_authenticated" ON public.cotizaciones;
CREATE POLICY "cotizaciones_select_authenticated" ON public.cotizaciones
    FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "cotizaciones_write_comercial" ON public.cotizaciones;
CREATE POLICY "cotizaciones_write_comercial" ON public.cotizaciones
    FOR ALL TO authenticated
    USING ((SELECT public.get_role()) IN ('superadmin', 'socio', 'comercial'))
    WITH CHECK ((SELECT public.get_role()) IN ('superadmin', 'socio', 'comercial'));

-- ---- costos: solo superadmin, socio ----
DROP POLICY IF EXISTS "costos_select_authenticated" ON public.costos;
CREATE POLICY "costos_select_authenticated" ON public.costos
    FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "costos_write_socios" ON public.costos;
CREATE POLICY "costos_write_socios" ON public.costos
    FOR ALL TO authenticated
    USING ((SELECT public.get_role()) IN ('superadmin', 'socio'))
    WITH CHECK ((SELECT public.get_role()) IN ('superadmin', 'socio'));

-- ---- servicios / personal / clientes / equipos: cualquier authenticated ----
DROP POLICY IF EXISTS "servicios_all_authenticated" ON public.servicios;
CREATE POLICY "servicios_all_authenticated" ON public.servicios
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "personal_all_authenticated" ON public.personal;
CREATE POLICY "personal_all_authenticated" ON public.personal
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "clientes_all_authenticated" ON public.clientes;
CREATE POLICY "clientes_all_authenticated" ON public.clientes
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "equipos_all_authenticated" ON public.equipos;
CREATE POLICY "equipos_all_authenticated" ON public.equipos
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---- config: solo superadmin, socio ----
DROP POLICY IF EXISTS "config_select_authenticated" ON public.config;
CREATE POLICY "config_select_authenticated" ON public.config
    FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "config_write_socios" ON public.config;
CREATE POLICY "config_write_socios" ON public.config
    FOR ALL TO authenticated
    USING ((SELECT public.get_role()) IN ('superadmin', 'socio'))
    WITH CHECK ((SELECT public.get_role()) IN ('superadmin', 'socio'));

-- ---- profiles: SELECT authenticated; UPDATE role/active solo superadmin;
-- INSERT/DELETE sin politica -> bloqueados para authenticated/anon (los
-- crea unicamente el trigger handle_new_user, via SECURITY DEFINER) ----
DROP POLICY IF EXISTS "profiles_select_authenticated" ON public.profiles;
CREATE POLICY "profiles_select_authenticated" ON public.profiles
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "profiles_update_superadmin" ON public.profiles;
CREATE POLICY "profiles_update_superadmin" ON public.profiles
    FOR UPDATE TO authenticated
    USING ((SELECT public.get_role()) = 'superadmin')
    WITH CHECK ((SELECT public.get_role()) = 'superadmin');

-- ============================================================================
-- 6. GRANTS — anon nunca aparece: cero grants = cero acceso, ademas de RLS.
-- ============================================================================

GRANT USAGE ON SCHEMA public TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON
    public.ventas, public.facturas, public.costos, public.servicios,
    public.personal, public.clientes, public.equipos, public.cotizaciones,
    public.config
TO authenticated;

-- profiles: SELECT completo, pero UPDATE solo a nivel de columna (role,
-- active) — el resto de columnas (id/email/name) queda protegido incluso a
-- nivel de GRANT, no solo por RLS. El trigger protect_profile_columns sigue
-- vigente como defensa en profundidad: la politica RLS decide QUIEN puede
-- hacer UPDATE, este GRANT limita QUE columnas puede tocar ese UPDATE, y el
-- trigger es la tercera capa por si algo se cuela.
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE ("role", "active") ON public.profiles TO authenticated;

-- service_role explicito: la migracion de datos (Lote M1-C) y cualquier
-- proceso backend que use la service key no deben depender de privilegios
-- por defecto de Supabase — se otorgan aqui sin ambiguedad.
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

REVOKE ALL ON
    public.ventas, public.facturas, public.costos, public.servicios,
    public.personal, public.clientes, public.equipos, public.cotizaciones,
    public.config, public.profiles
FROM anon;

-- ============================================================================
-- 7. TRIGGER SOBRE auth.users — al FINAL, despues de GRANT/REVOKE
-- ============================================================================
-- Se deja para el final a proposito: es la sentencia con mas probabilidad de
-- fallar (auth.users vive en un schema que no es de este proyecto, sujeto a
-- permisos que pueden variar entre entornos de Supabase). Al estar envuelta
-- en la misma transaccion (BEGIN/COMMIT) y ser lo ultimo del archivo, si
-- falla aqui, Postgres revierte TODO lo anterior — nunca queda una tabla con
-- RLS habilitado pero sin sus politicas, o politicas sin sus grants.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

COMMIT;
