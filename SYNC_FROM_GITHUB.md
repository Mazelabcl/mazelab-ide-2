# Instrucciones de sync desde GitHub — para Replit Agent

Este archivo describe los cambios que hizo el agente de Claude en el repositorio GitHub
y lo que necesitas hacer para aplicarlos en el entorno Replit (PostgreSQL).

---

## 1. Archivos que debes NO sobreescribir

Estos 3 archivos son tuyos (Replit) y **no deben ser reemplazados** con los del repo:

| Archivo | Por qué |
|---------|---------|
| `public/src/shared/supabase.js` | Tu versión apunta a Express `/api/db/`. La del repo apunta a Supabase real. |
| `public/index.html` | Tu versión no tiene el CDN de Supabase. Aplica solo los cambios específicos de abajo. |
| `server/` (toda la carpeta) | No existe en el repo. Es tuya. |

---

## 2. Archivos que debes copiar/actualizar desde el repo

Copia estos archivos desde el repo (`src/`) a tu carpeta `public/src/`:

| Archivo en repo | Destino en Replit | Descripción del cambio |
|-----------------|-------------------|------------------------|
| `src/modules/payables/payables.js` | `public/src/modules/payables/payables.js` | Bug fixes: sticky headers, date sync, ID column |
| `src/modules/finance/finance.js` | `public/src/modules/finance/finance.js` | Bug fixes: date sync con ventas, sticky headers |
| `src/modules/nominas/nominas.js` | `public/src/modules/nominas/nominas.js` | Auto-comment con docNumber, FIFO, focus fix |
| `src/styles/components.css` | `public/src/styles/components.css` | Fix sticky table headers (max-height en .table-scroll) |
| `src/app.js` | `public/src/app.js` | Nueva ruta `pagos: 'PagosModule'` |

### Archivo nuevo — créalo en Replit:

El siguiente archivo **no existe aún** en Replit. Créalo en la ruta indicada
con el contenido del repo:

| Archivo en repo | Destino en Replit |
|-----------------|-------------------|
| `src/modules/pagos/pagos.js` | `public/src/modules/pagos/pagos.js` |

---

## 3. Cambios manuales en `public/index.html`

No copies el `index.html` del repo (tiene el CDN de Supabase). Aplica estos
dos cambios a mano en tu `public/index.html`:

### 3a. Agregar nav item "Pagos" (después del item de Nóminas):

```html
<!-- Busca esto: -->
<div class="nav-item" data-route="nominas">
    <span class="nav-icon">&#128179;</span>
    <span>N&oacute;minas</span>
</div>

<!-- Y agrega JUSTO DESPUÉS: -->
<div class="nav-item" data-route="pagos">
    <span class="nav-icon">&#128200;</span>
    <span>Pagos</span>
</div>
```

### 3b. Agregar script de pagos (antes de `app.js`):

```html
<!-- Busca esto: -->
<script src="src/modules/nominas/nominas.js"></script>
<script src="src/app.js"></script>

<!-- Cámbialo a: -->
<script src="src/modules/nominas/nominas.js"></script>
<script src="src/modules/pagos/pagos.js"></script>
<script src="src/app.js"></script>
```

---

## 4. Verificar columnas en PostgreSQL

La tabla `costos` (CXP / cuentas por pagar) necesita estas columnas.
**Probablemente ya existen**, pero si la tabla fue creada vacía o con columnas
mínimas, ejecuta esto en tu consola de PostgreSQL:

```sql
ALTER TABLE costos ADD COLUMN IF NOT EXISTS "eventName"   TEXT;
ALTER TABLE costos ADD COLUMN IF NOT EXISTS "clientName"  TEXT;
ALTER TABLE costos ADD COLUMN IF NOT EXISTS "eventDate"   TEXT;
ALTER TABLE costos ADD COLUMN IF NOT EXISTS "billingDate" TEXT;
ALTER TABLE costos ADD COLUMN IF NOT EXISTS "concept"     TEXT;
ALTER TABLE costos ADD COLUMN IF NOT EXISTS "docNumber"   TEXT;
ALTER TABLE costos ADD COLUMN IF NOT EXISTS "comments"    TEXT;
```

Columnas que ya deberían existir (no las toques):
`id, eventId, category, vendorName, docType, amount, status, payments`

---

## 5. Verificar que `VALID_TABLES` incluye `costos` y `facturas`

En `server/routes.ts`, confirma que el array `VALID_TABLES` incluye todas las tablas:

```typescript
const VALID_TABLES = ['ventas', 'facturas', 'costos', 'servicios', 'personal', 'clientes'];
```

---

## Resumen de lo que hacen los cambios (para tu contexto)

- **Sticky table headers**: la tabla ahora tiene scroll interno con headers fijos
- **Date sync**: cambiar la fecha de un evento en Ventas ahora se refleja en CXC y CXP
- **Módulo Pagos**: nueva pantalla en el menú izquierdo con historial de todos los pagos, filtrable y con columna ID
- **CXP bug fixes**: el ID del evento muestra el sourceId legible (ej. "591"), el tipo de cambio no rompe montos históricos
- **Nóminas**: el comentario de transferencia usa números de documento reales, no UUIDs internos
