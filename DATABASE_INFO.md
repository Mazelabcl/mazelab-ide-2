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
| `facturas` | CXC (cuentas por cobrar) | sourceId, clientName, eventName, tipoDoc, invoiceNumber, billingMonth, montoNeto, invoicedAmount, amountPaid, status, payments (JSONB), cobros (JSONB) |
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

## Cambios requeridos en Replit — feature/cxc-cobrar

### 1. Columna `cobros` en tabla `facturas`
```sql
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS cobros JSONB DEFAULT '[]';
```
Almacena el historial de avisos de cobro enviados para cada factura.
Estructura: `[{ id, date, num, method: 'template'|'ai', context }]`

### 2. Columnas kanban en tabla `ventas` (requerido para Board Operativo)
```sql
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS "boardColumn" INTEGER;
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS "boardOrder" BIGINT;
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS checklist JSONB DEFAULT '[]';
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS encargado TEXT DEFAULT '';
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS "kanbanNotes" TEXT DEFAULT '';
```
Sin estas columnas el Board Operativo lanza 500 en cada PATCH de migración.

### 3. Nuevo endpoint POST `/api/cobrar/generar` (para generación IA de emails de cobro)
Usa **OpenAI** (no Anthropic). Requiere `OPENAI_API_KEY` en Replit Secrets.

Agrega este endpoint en `server/routes.ts`:
```typescript
router.post('/cobrar/generar', async (req, res) => {
  try {
    const { clientName, eventName, invoiceNumber, amount, eventDate,
            cobrosCount, overdueDays, userContext, companyInfo } = req.body;

    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const tone = cobrosCount === 1 ? 'cordial y profesional'
               : cobrosCount === 2 ? 'firme pero respetuoso'
               : 'urgente y directo';

    const bankBlock = companyInfo?.banco
      ? `Datos bancarios:\n  Titular: ${companyInfo.nombre || ''}\n  RUT: ${companyInfo.rut || ''}\n  Banco: ${companyInfo.banco}\n  Tipo: ${companyInfo.tipoCuenta || ''}\n  N° Cuenta: ${companyInfo.numeroCuenta || ''}`
      : '';

    const prompt = `Redacta un email profesional de cobro en español chileno.
Cliente: ${clientName}
Evento: ${eventName}
Factura N°: ${invoiceNumber}
Monto pendiente: $${amount.toLocaleString('es-CL')}
Fecha del evento: ${eventDate}
Este es el aviso número ${cobrosCount}. Días de atraso: ${overdueDays}.
${userContext ? 'Contexto adicional: ' + userContext : ''}
Empresa que cobra: ${companyInfo?.nombre || ''}
${bankBlock}

Tono: ${tone}.
Incluye: línea de Asunto, cuerpo del correo, despedida.
Si hay datos bancarios, inclúyelos al final del cuerpo.`;

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1024
    });

    res.json({ email: completion.choices[0].message.content });
  } catch (err) {
    console.error('/api/cobrar/generar error:', err);
    res.status(500).json({ error: err.message });
  }
});
```
Instalar dependencia si no está: `npm install openai`
Si no se configura este endpoint, la app hace fallback automático a la plantilla local.

## Entorno de ejecución

- **Desarrollo**: Replit (npm run dev → Express en puerto 5000)
- **Base de datos**: PostgreSQL de Replit (variable de entorno `DATABASE_URL`)
- **No se necesitan credenciales externas** (Supabase ya no se usa)
