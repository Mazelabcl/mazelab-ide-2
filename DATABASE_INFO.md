# Base de Datos — Información para desarrollo

## Cambio importante: de Supabase a PostgreSQL directo

La app originalmente usaba Supabase como base de datos remota. Ahora usa **PostgreSQL directamente** a través de un servidor Express que corre en Replit.

## Cómo funciona

### Flujo de datos
```
Frontend (browser)
  → supabase.js (hace fetch a /api/db/...)
    → Express server (server/routes.ts)
      → PostgreSQL (Replit built-in, vía DATABASE_URL)
```

### Archivos modificados respecto al repositorio original
1. **`public/src/shared/supabase.js`** — Ya NO usa la librería de Supabase. Ahora hace `fetch()` a endpoints Express locales (`/api/db/:table`). Mantiene la misma interfaz pública (`testConnection`, `fetchAll`, `insert`, `update`, `remove`, `upsertMany`) para que `data-service.js` funcione sin cambios.

2. **`public/index.html`** — Se eliminó la línea `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>` ya que no se necesita la librería de Supabase.

3. **`server/routes.ts`** — Nuevas rutas API CRUD:
   - `GET /api/db/:table` — obtener todos los registros
   - `POST /api/db/:table` — insertar un registro
   - `PATCH /api/db/:table/:id` — actualizar un registro
   - `DELETE /api/db/:table/:id` — eliminar un registro
   - `POST /api/db/:table/upsert` — upsert masivo (para imports CSV)

4. **`server/index.ts`** — Sirve archivos estáticos desde `public/` y las rutas API.

### Archivos que NO cambiaron
- `data-service.js` — sigue igual, decide entre DB y localStorage
- `storage.js` — sigue igual, maneja localStorage como fallback
- Todos los módulos (dashboard, sales, finance, payables, etc.) — sin cambios

## Tablas en PostgreSQL

Todas las tablas usan `id TEXT PRIMARY KEY`. Las tablas son:

| Tabla | Descripción | Campos principales |
|-------|-------------|-------------------|
| `ventas` | Ventas/eventos | sourceId, clientName, eventName, serviceNames, eventDate, amount, status, staffName, refundAmount |
| `facturas` | CXC (cuentas por cobrar) | sourceId, clientName, eventName, tipoDoc, invoiceNumber, billingMonth, montoNeto, invoicedAmount, amountPaid, status, payments (JSONB) |
| `costos` | CXP (cuentas por pagar) | eventId, category, vendorName, docType, amount, status, payments (JSONB) |
| `servicios` | Catálogo de servicios | name, nombre |
| `personal` | Staff/vendedores | name, nombre |
| `clientes` | Base de clientes | name, nombre |

## Si necesitas agregar columnas

Si agregas nuevos campos a los módulos del frontend, también debes agregar la columna correspondiente en PostgreSQL. La ruta API es genérica y acepta cualquier campo que exista como columna en la tabla.

Ejemplo para agregar una columna:
```sql
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS "newField" TEXT;
```

También necesitas agregar la tabla al array `VALID_TABLES` en `server/routes.ts` si creas una tabla nueva.

## Entorno de ejecución

- **Desarrollo**: Replit (npm run dev → Express en puerto 5000)
- **Base de datos**: PostgreSQL de Replit (variable de entorno `DATABASE_URL`)
- **No se necesitan credenciales externas** (Supabase ya no se usa)
