# Instrucciones de Deploy — Replit Agent

Ejecutar todo en orden. No saltar pasos.

## Paso 1: SQL en PostgreSQL

Copiar y ejecutar este bloque completo en la consola SQL de PostgreSQL:

```sql
-- Nuevas columnas en servicios
ALTER TABLE servicios ADD COLUMN IF NOT EXISTS "tarifario" TEXT;
ALTER TABLE servicios ADD COLUMN IF NOT EXISTS "equipos_checklist" TEXT;
ALTER TABLE servicios ADD COLUMN IF NOT EXISTS "link_fotos" TEXT;
ALTER TABLE servicios ADD COLUMN IF NOT EXISTS "link_landing" TEXT;

-- Equipos asignados en ventas
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS "equiposAsignados" JSONB;

-- Tabla cotizaciones (nuevo modulo)
CREATE TABLE IF NOT EXISTS cotizaciones (
  id TEXT PRIMARY KEY,
  codigo TEXT,
  version INTEGER DEFAULT 1,
  "clientName" TEXT,
  "contactName" TEXT,
  "contactEmail" TEXT,
  "contactTel" TEXT,
  "eventName" TEXT,
  "eventDate" TEXT,
  lugar TEXT,
  "validezDias" INTEGER DEFAULT 7,
  condiciones TEXT DEFAULT '50% adelanto, 50% a 30 dias',
  estado TEXT DEFAULT 'borrador',
  bloques JSONB DEFAULT '[]'::jsonb,
  subtotal NUMERIC DEFAULT 0,
  descuento NUMERIC DEFAULT 0,
  "descuentoPct" NUMERIC DEFAULT 0,
  "descuentoNota" TEXT,
  "totalNeto" NUMERIC DEFAULT 0,
  notas TEXT,
  "saleId" TEXT,
  "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla usuarios (auth)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL DEFAULT '',
  role VARCHAR(20) NOT NULL DEFAULT 'operaciones',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Paso 1b: SQL adicional (sprint 19-03)

```sql
-- Nómina override en costos
ALTER TABLE costos ADD COLUMN IF NOT EXISTS "nominaDate" TEXT;

-- Notas de cobranza en facturas
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS "notas_cobranza" JSONB;
```

## Paso 2: Migrar tarifarios a servicios existentes

Ejecutar el contenido del archivo `tarifario_migration.sql` que está en la raíz del repositorio.
Son 46 UPDATE statements que llenan el campo tarifario de cada servicio con sus precios (base + adicionales + packs).
Solo actualiza servicios que no tienen tarifario aún — no toca equipos ni costos existentes.

## Paso 3: Agregar tablas a VALID_TABLES

En el archivo `server/routes.ts`, buscar el array `VALID_TABLES` y agregar estas dos entradas:

```
'cotizaciones', 'users'
```

## Paso 4: Pull del código

```bash
git pull origin master
```

## Paso 5: Verificar

1. Abrir la app en el navegador — debe mostrar pantalla de login
2. Login con `aldo@mazelab.cl` / `mazelab2026` (superadmin, se auto-crea)
3. Ir a Configurar > Servicios > editar Glambot > verificar Tarifario (base $1.350.000 + 11 adicionales + 3 packs)
4. Ir a Configurar > Usuarios > verificar tabla de usuarios con roles
5. Registrar un segundo usuario desde login — debe quedar como "Operaciones"
6. Dashboard debe mostrar KPIs financieros para superadmin
