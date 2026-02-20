# 📋 MAZELAB IDE - Especificación Completa del Proyecto

> **Última actualización:** 2026-02-15
> **Auditoría:** Generada leyendo el código fuente real, no de memoria.

---

## 1. ¿QUÉ ES MAZELAB IDE?

Plataforma interna (Internal OS) para **Mazelab**, una productora de eventos y experiencias tecnológicas en Chile. Gestiona ventas, facturación (CXC), costos (CXP), y dashboard operacional.

**URL de acceso:** Se abre como archivo local (`index.html`) o se puede servir con cualquier servidor HTTP estático.

---

## 2. STACK TECNOLÓGICO

| Componente | Tecnología |
|---|---|
| **Frontend** | HTML + JavaScript vanilla (NO frameworks) |
| **Estilos** | CSS vanilla con variables (theme.css, layout.css, components.css) |
| **Fuente** | Inter (Google Fonts) |
| **Base de datos primaria** | Supabase (PostgreSQL) |
| **Fallback** | localStorage del navegador |
| **CDN** | Supabase JS client v2 |
| **Despliegue** | Estático (no requiere build) |

### Arquitectura
```
index.html
├── src/styles/          → CSS (theme, layout, components)
├── src/shared/          → Capa de datos
│   ├── supabase.js      → Cliente Supabase + CRUD helpers
│   ├── storage.js       → CRUD en localStorage (37KB, completo)
│   ├── storage-supabase.js → CRUD en Supabase (36KB)
│   └── data-service.js  → Capa híbrida: Supabase con fallback a localStorage
├── src/modules/
│   ├── dashboard/       → KPIs generales, chart por mes, rankings
│   ├── sales/           → CRUD ventas, formulario con picker de servicios
│   ├── finance/         → CXC: facturas, abonos, KPIs de cobranza
│   ├── payables/        → CXP: costos, proveedores, pagos
│   ├── settings/        → Catálogos (servicios, staff, clientes)
│   └── import/          → Importar CSV (ventas, CXC, CXP, clientes, staff)
└── src/app.js           → Router principal, SPA con navigateTo()
```

### Patrón de módulos
Cada módulo sigue el patrón IIFE con `render()` + `init()`:
```javascript
window.Mazelab.Modules.NombreModulo = (function () {
    function render() { /* retorna HTML string */ }
    function init() { /* event listeners */ }
    return { render, init };
})();
```

---

## 3. CAPA DE DATOS (data-service.js)

### Inicialización
1. Intenta conectar a Supabase
2. Si Supabase tiene datos → usa Supabase
3. Si Supabase está vacío pero localStorage tiene datos → usa localStorage
4. Si ambos vacíos → Supabase (para datos nuevos)
5. Si no hay conexión → localStorage

### Servicios disponibles
| Servicio | Tabla Supabase | localStorage Key |
|---|---|---|
| `ServicesService` | `servicios` | `mazelab_services` |
| `StaffService` | `personal` | `mazelab_staff` |
| `ClientsService` | `clientes` | `mazelab_clients` |
| `SalesService` | `ventas` | `mazelab_sales` |
| `ReceivablesService` | `facturas` | `mazelab_receivables` |
| `PayablesService` | `costos` | `mazelab_payables` |

---

## 4. MODELO DE DATOS (Tablas y Columnas)

### 4.1. `clientes`
| Columna | Tipo | Descripción |
|---|---|---|
| id | UUID | PK |
| nombre / name | VARCHAR | Nombre empresa |
| rut | VARCHAR(20) | RUT chileno |
| plazo_pago | INTEGER | Default 30 días |
| ejecutivos | JSONB | Array de nombres |
| notas | TEXT | |
| activo | BOOLEAN | |

### 4.2. `servicios`
| Columna | Tipo | Descripción |
|---|---|---|
| id | UUID | PK |
| nombre / name | VARCHAR | Nombre del servicio (ej: Glambot, Instaclip) |
| descripcion | TEXT | |
| precio_base | DECIMAL | Precio base del servicio |
| costo_base_estimado | DECIMAL | Costo base estimado |
| duracion_tipo | VARCHAR | 'horas', 'jornada', 'dias' |
| duracion_default | INTEGER | |
| featured | BOOLEAN | Si es servicio destacado |
| activo | BOOLEAN | |

### 4.3. `personal` (Staff + Freelancers + Proveedores)
| Columna | Tipo | Descripción |
|---|---|---|
| id | UUID | PK |
| nombre / name | VARCHAR | |
| tipo / type | VARCHAR | `'staff_fijo'`, `'freelance'`, `'proveedor'` → en localStorage: `'core'`, `'freelancer'` |
| especialidad | VARCHAR | |
| tipo_documento | VARCHAR | `'bh'` o `'factura'` |
| rut | VARCHAR | |
| banco, tipo_cuenta, numero_cuenta | VARCHAR | Datos bancarios |
| email, telefono | VARCHAR | |

### 4.4. `ventas` (Sales)
| Columna DB | Columna localStorage | Descripción |
|---|---|---|
| id | id | PK (UUID o generado) |
| cliente_id | clientId | FK a clientes |
| — | clientName | Nombre duplicado para display |
| nombre_evento | eventName | Nombre del evento |
| fecha_evento | eventDate | Fecha del evento (ISO) |
| fecha_venta | closingMonth | Mes de cierre |
| categoria | — | Categoría |
| servicios (JSONB) | serviceIds (Array) | IDs de servicios |
| jornadas | jornadas | Número de jornadas |
| monto_venta | amount | **Monto neto de venta** |
| devolucion | refundAmount, monto_devolucion | Devolución |
| vendedor_id | staffId | FK a personal |
| estado | status | `'confirmada'`, `'realizada'`, `'pendiente'`, `'cancelada'` |
| notas | comments | |
| — | hasIssue | Boolean: evento con problemas |

### 4.5. `facturas` / Receivables (CXC) ⚠️ MÁS IMPORTANTE

| Columna DB | Columna localStorage | Descripción | Importado del CSV |
|---|---|---|---|
| id | id | PK | auto-generado |
| venta_id | saleId | FK a ventas | `id` del CSV |
| — | clientId | FK a clientes | auto-linkea por nombre |
| — | clientName | Nombre cliente | `empresa` |
| — | eventName | Nombre evento | `nombre_evento` |
| — | eventDate | Fecha evento | `fecha_evento` |
| monto_neto | montoNeto / amount | **Monto neto** | `monto_venta` (del CSV) |
| — | montoFacturado | **Monto facturado neto** (puede ser != montoNeto) | `monto_facturado` |
| — | tipoDoc | Tipo documento: `'F'`, `'E'`, `'H'`, `'NC'` | `tipo_doc` |
| numero_factura | invoiceNumber | N° factura o documento | `nro_factura` |
| mes_emision | billingMonth | Mes de facturación (YYYY-MM o MM/YYYY) | `mes_emision_factura` |
| — | ncAsociada | N° de NC asociada (si fue anulada) | `nc_asociada` |
| — | payments | Array de `{id, amount, date}` | Se crea 1 payment si `monto_pagado > 0` |
| estado | status | Ver sección de estados abajo | `estado` (del CSV) |

#### Estados de CXC (Receivables)
| Status | Significado |
|---|---|
| `pendiente_factura` | Sin factura emitida aún |
| `pendiente` | Facturado, dentro del plazo |
| `vencida_30` | Facturado, 31-60 días desde evento |
| `vencida_60` | Facturado, 61-90 días |
| `vencida_90` | Facturado, 90+ días |
| `pagada` / `pagado` | Pagado totalmente |
| `anulada` | Anulada |
| *(vacío)* | Para NC (notas de crédito) |

### 4.6. `costos` / Payables (CXP)
| Columna DB | Columna localStorage | Descripción |
|---|---|---|
| id | id | PK |
| venta_id | saleId | FK a ventas (null si no asociado) |
| — | concept | Concepto del costo |
| — | eventName | Nombre del evento |
| — | clientName | Nombre del cliente |
| beneficiario_id | vendorId | FK a personal |
| — | vendorName | Nombre proveedor (backup) |
| monto_bruto | amount | Monto bruto |
| monto_pagado | amountPaid | Monto pagado |
| — | docType | `'bh'`, `'factura'`, `'invoice'`, `'ninguno'` |
| numero_documento | docNumber | N° de documento |
| — | eventEndDate | Fecha fin de evento (para vencimiento) |
| estado | status | `'pendiente'` o `'pagada'` |

---

## 5. CÁLCULOS Y FÓRMULAS (finance.js)

### 5.1. Funciones Helper

```javascript
getMonto(r)              → Number(r.montoNeto || r.amount) || 0
                         // Retorna MONTO NETO (sin IVA)

getMontoFacturado(r)     → Si r.montoFacturado existe (incluyendo 0), usa ese
                           Si no, fallback a montoNeto/amount
                         // Retorna MONTO FACTURADO NETO

getTotalPagado(r)        → Suma de r.payments[].amount
                         // Retorna TOTAL PAGADO (con IVA incluido)

getPendienteItem(r)      → Si tipoDoc=E: montoNeto - pagado
                           Si tipoDoc=F/H: (montoFacturado * 1.19) - pagado
                         // Lo que queda por cobrar CON IVA

getPendienteFacturado(r) → Si tipoDoc=E: montoFacturado - pagado
                           Si tipoDoc=F/H: (montoFacturado * 1.19) - pagado
                         // Similar a getPendienteItem pero usa montoFacturado

isIvaPaid(mesEmision)    → Calcula si el IVA ya fue pagado al SII
                           Regla: Se paga el día 20 del mes siguiente
                           Ejemplo: Factura enero 2026 → IVA se paga 20/feb/2026
                           Si hoy > 20/feb → IVA ya fue pagado

getPendienteMio(r)       → Lo que realmente me queda a MÍ
                           Si E: montoNeto - pagado
                           Si NC: 0
                           Si pendiente_factura: montoNeto - pagado (no IVA)
                           Si facturado + IVA pagado: (montoFacturado*1.19) - pagado
                           Si facturado + IVA NO pagado: montoNeto - pagado
```

### 5.2. Clasificación de registros (getRealTimeStatus)

```
1. Si tipoDoc = NC → 'nc'
2. Si CSV dice 'anulada' → 'anulada'
3. Si CSV dice 'pagado/pagada' → 'pagada'
4. Si CSV dice 'pendiente_factura' → 'pendiente_factura'
5. Si montoFacturado ≤ 0 → 'pendiente_factura' (sin importar CSV status)
6. Si CSV dice 'pendiente' o 'por_vencer' o vacío:
   a. Si pagado ≥ montoTotal → 'pagada'
   b. Si fecha_evento es pasada:
      - >90 días → 'vencida_90'
      - >60 días → 'vencida_60'
      - >30 días → 'vencida_30'
   c. Si no → 'pendiente'
7. Default: devuelve CSV status tal cual
```

### 5.3. Separación de registros CXC

```
receivables (TODOS)
├── facturas (tipoDoc = F, E, H o vacío → default F)
│   ├── facturasConStatus (con realStatus calculado)
│   │   ├── sinFactura      (realStatus = pendiente_factura, excluye NC)
│   │   ├── pendientes      (realStatus = pendiente)
│   │   ├── vencidas30      (realStatus = vencida_30)
│   │   ├── vencidas60      (realStatus = vencida_60)
│   │   ├── vencidas90      (realStatus = vencida_90)
│   │   ├── pagadas         (realStatus = pagada)
│   │   └── anuladas        (realStatus = anulada)
│   │
│   ├── facturadoPendientes (CSV status≠pendiente_factura, ≠anulada, ≠pagado, ≠NC,
│   │                        ncAsociada vacío, montoFacturado>0, pagado < montoTotal)
│   │   ├── facturadoEnPlazo   (fecha evento futura o ≤30 días)
│   │   ├── facturadoVencido30 (31-60 días)
│   │   ├── facturadoVencido60 (61-90 días)
│   │   └── facturadoVencido90 (90+ días)
│   │
│   └── activeFacturas     (CSV status=pendiente|pendiente_factura,
│                           montoFacturado>0, pagado < montoConIva)
│
└── notasCredito (tipoDoc = NC)
```

### 5.4. KPIs Mostrados

#### Fila 1: Métricas Mensuales
| KPI | Fórmula |
|---|---|
| **Facturado Este Mes** | Σ montoFacturado donde billingMonth = mes actual |
| **IVA del Mes** | totalFacturadoMes × 0.19 |
| **Pagado Este Mes** | Estimación: facturas cuyo billing month + 30 días cae en el mes actual Y status=pagado |
| **Por Vencer Este Mes** | facturadoPendientes con eventDate en el mes actual |

#### Fila 2: Categorías de Estado (los 5 boxes)
| KPI | Cantidad | Monto mostrado |
|---|---|---|
| **⚠️ Sin Factura** | sinFactura.length | totalSinFactura = Σ getMonto(r) → **NETO** |
| **📋 En Plazo** | facturadoEnPlazo.length | Σ getPendienteFacturado(r) → **con IVA** |
| **⏰ 30+ Días** | facturadoVencido30.length | Σ getPendienteFacturado(r) |
| **🚨 60+ Días** | facturadoVencido60.length | Σ getPendienteFacturado(r) |
| **🔥 90+ Días** | facturadoVencido90.length | Σ getPendienteFacturado(r) |

#### Fila 3: Totales Grandes
| KPI | Fórmula |
|---|---|
| **💳 TOTAL POR COBRAR** | (totalSinFactura × 1.19) + totalFacturadoPend |
| **💰 LO QUE ES MÍO** | totalSinFacturaMio + totalFacturadoMio |

Donde:
- `totalSinFacturaMio` = Σ max(0, montoNeto - pagado) para sinFactura
- `totalFacturadoMio` = Σ getPendienteMio(r) para facturadoPendientes

---

## 6. IMPORTACIÓN CSV

### 6.1. Tipos de importación
| Tipo | Descripción |
|---|---|
| `sales` | Ventas/eventos |
| `receivables` | CXC (facturas) |
| `payables` | CXP (costos) |
| `clients` | Clientes |
| `services` | Servicios |
| `staff` | Personal |

### 6.2. Mapeo Flexible de Columnas (FIELD_ALIASES)
El importador es case-insensitive y acepta múltiples nombres para cada campo:

| Campo Interno | Aliases Aceptados |
|---|---|
| `clientName` | clientname, cliente, client, nombre cliente, razón social, empresa |
| `eventName` | eventname, evento, event, nombre_evento, activacion, titulo |
| `serviceNames` | servicenames, servicios, tipo, servicio, producto |
| `eventDate` | eventdate, fecha_evento, fecha, date |
| `amount` | amount, monto, monto_venta, precio, valor, total |
| `status` | status, estado, state, situación, estado de pago |
| `invoicedAmount` | monto facturado, monto_facturado, facturado, invoiced amount |
| `amountPaid` | monto pagado, monto_pagado, pagado, paid, abonado |
| `tipoDoc` | tipo_doc, tipo doc, tipo documento cxc |
| `invoiceNumber` | nro_factura, numero_factura, n_factura, invoice number |
| `billingMonth` | mes_emision, mes_emision_factura, mes emision, billing month |
| `ncAsociada` | nc_asociada, nc asociada, nota credito |
| `jornadas` | jornadas, dias, días, days, duracion |
| `closingMonth` | closingmonth, mes_cierre, mes_venta, fecha_venta |
| `staffName` | staffname, ejecutivo, vendedor, responsable |
| `comments` | comments, comentarios, notas, observaciones |
| `refundAmount` | refundamount, devolucion, devolución, reembolso |

### 6.3. Parseo de montos (parseAmount)
```
"7,866,000"    → 7866000   (detecta comas como separador de miles)
"7.866.000"    → 7866000   (detecta puntos como separador de miles)
"$1,234,567"   → 1234567   (remueve $)
"1234567"      → 1234567   (ya es número)
```

### 6.4. Parseo de fechas (parseDate)
```
"15/04/2026"   → "2026-04-15" (DD/MM/YYYY)
"2026-04-15"   → "2026-04-15" (ISO ya correcto)
"01/10/2022"   → "2022-10-01"
```

---

## 7. COLUMNAS DEL CSV ORIGINAL (CXC)

Basado en el archivo `cxc.csv` real:
```
id, nombre_evento, mes_evento, año_evento, ms_evento, fecha_evento,
empresa, tipo, brief, monto_venta, costo_evento, utilidad, % utilidad,
fecha_venta, ESTADO, brief, nro_factura, mes_emision_factura,
monto_facturado, iva, monto_pagado, monto_pendiente,
fecha_probable_pago, estado
```

### Mapeo CSV → Campos internos
| Columna CSV | → Campo Interno | Usado en KPIs |
|---|---|---|
| `id` | saleId | ❌ solo referencia |
| `nombre_evento` | eventName | ❌ solo display |
| `fecha_evento` | eventDate | ✅ **cálculo de vencimiento** |
| `empresa` | clientName | ❌ soloDisplay |
| `monto_venta` | montoNeto / amount | ✅ **base para Sin Factura** |
| `monto_facturado` | montoFacturado | ✅ **base para facturado pendiente** |
| `iva` | *(no se importa, se calcula)* | ❌ se recalcula como montoFacturado×0.19 |
| `monto_pagado` | payments[0].amount | ✅ **se resta del pendiente** |
| `monto_pendiente` | *(no se importa, se calcula)* | ❌ se recalcula |
| `estado` | status | ✅ **determina categoría** |
| `nro_factura` | invoiceNumber | ⚠️ si existe, marca como facturado |
| `mes_emision_factura` | billingMonth | ✅ **cálculo IVA pagado** |
| `tipo_doc` | tipoDoc | ✅ **F, E, H, NC** |
| `nc_asociada` | ncAsociada | ✅ **marca como anulada** |

### Columnas del CSV que NO se usan
| Columna CSV | ¿Se importa? | Observación |
|---|---|---|
| `mes_evento` | ❌ | Se calcula de `fecha_evento` |
| `año_evento` | ❌ | Se calcula de `fecha_evento` |
| `ms_evento` | ❌ | Parece redundante con `fecha_evento` |
| `tipo` (tipo de evento) | ❌ | No se usa en ningún cálculo |
| `brief` | ❌ | Aparece 2 veces en el CSV, no se importa |
| `costo_evento` | ❌ | Va por el módulo CXP separado |
| `utilidad` | ❌ | Se podría calcular cruzando CXC y CXP |
| `% utilidad` | ❌ | No se usa |
| `fecha_venta` | ❌ | Solo se usa `closingMonth` para ventas |
| `fecha_probable_pago` | ❌ | No se importa ni usa |
| `iva` | ❌ | Se recalcula como montoFacturado × 0.19 |
| `monto_pendiente` | ❌ | Se recalcula dinámicamente |
| `ESTADO` (primera instancia) | ❌ | Es del evento (realizado), no de pago |

---

## 8. REGLAS DE NEGOCIO DEFINIDAS

### 8.1. IVA (Chile)
- **Tasa IVA:** 19%
- **Factura (F):** montoTotal = montoFacturado × 1.19
- **Exenta (E):** montoTotal = montoFacturado (SIN IVA)
- **Honorarios (H):** montoTotal = montoFacturado × 1.19
- **NC (Nota de Crédito):** No tiene pendiente, solo reduce totales

### 8.2. Vencimiento
- Se calcula desde `eventDate` (fecha del evento), NO desde fecha de facturación
- 0-30 días: "En Plazo"
- 31-60 días: "30+ Días"
- 61-90 días: "60+ Días"
- 91+ días: "90+ Días"

### 8.3. Qué EXCLUIR de los KPIs de facturado pendiente
- `status = 'pendiente_factura'` (van a "Sin Factura")
- `status = 'anulada'`
- `status = 'pagado'` / `'pagada'`
- `tipoDoc = 'NC'`
- `ncAsociada` no vacío (fue reemplazada por NC)
- `montoFacturado ≤ 0`
- Registros donde `pagado ≥ montoTotal`

### 8.4. "Lo Que Es Mío" (IVA pagado al SII)
- Si aún NO facturé → solo el neto es mío
- Si facturé pero IVA no pagado al SII todavía → solo el neto es mío
- Si facturé Y el IVA ya fue pagado al SII → neto + IVA es mío (puedo recuperarlo)
- Plazo IVA: día 20 del mes siguiente al mes de emisión

### 8.5. Retención Boleta de Honorarios (CXP)
- 2024: 14.50%
- 2025-2026: 15.25%

---

## 9. MÓDULOS DETALLADOS

### 9.1. Dashboard (dashboard.js, 467 líneas)
**KPIs:**
- Ventas Totales: `Σ(s.monto_venta || s.amount)`
- Por Cobrar (CXC): filtra `status=pendiente|pendiente_factura|facturada` → suma `monto_total || amount`
- Por Pagar (CXP): filtra `status=pendiente` → suma `monto_neto || amount`
- Eventos con Problemas: count de `hasIssue=true`, suma de refunds
- Margen Estimado: Ventas - CXP pendiente

**Chart:** Eventos por mes (últimos 6 meses), usa SOLO `eventDate`

**Rankings:**
- Top 5 Servicios (por cantidad o por monto, toggle)
- Top 5 Clientes (por monto total)
- Ambos con toggle Histórico/Último Año

### 9.2. Ventas (sales.js, 730 líneas)
- CRUD de ventas con formulario
- Picker de servicios (checkboxes)
- Selector de fecha con click en calendario
- Selector de cliente con autocompletado
- Columnas en tabla: Cliente, Servicios, Evento, Jornadas, Monto, Fecha, Estado

### 9.3. Finanzas / CXC (finance.js, 1181 líneas) ⭐ MÓDULO PRINCIPAL
- KPIs (3 filas: mensuales, categorías, totales)
- Panel de verificación colapsable (debug)
- Formulario nueva factura
- Tabla de registros con: Cliente/Evento, N°Factura, Neto, Total+IVA, Pagado, Restante, Vencimiento, Estado
- Acciones: Facturar, +Abono, Pagado Total, Eliminar
- Modal para ingresar números de factura y montos
- Búsqueda y filtro (Solo Pendientes / Ver Todo)
- Límite inicial de 25 registros con "Ver más"

### 9.4. CXP / Payables (payables.js, 341 líneas)
- Vista de lista y vista agrupada por proveedor
- KPIs: Total Pendiente, Vencido (30+ días), Proveedores por pagar
- CRUD con formulario
- Columnas: Cliente, Evento, Concepto, Proveedor, Documento, Monto, Fecha Evento, Estado, Acciones

### 9.5. Configuración (settings.js, 613 líneas)
- Tabs: Servicios, Staff, Clientes
- CRUD para cada catálogo
- Categorías de servicio (Fotograficas, Cinéticas, Digitales, Display, Otros)
- Tipos de staff: Core, Freelancer

### 9.6. Importar (import.js, 837 líneas)
- Drag & drop o click para subir CSV
- Auto-detecta separador (TAB o coma)
- Vista previa de datos antes de importar
- Tipos: sales, receivables, payables, clients, services, staff
- Crea automáticamente clientes/servicios/staff que no existan

---

## 10. DATOS DE CONEXIÓN

```javascript
// Supabase
const SUPABASE_URL = 'https://dvrgltvicfkhlukwvdcr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_pbSQgmfgt-DzOmYcjBn3Mw_WmB207Sj';
```

---

## 11. BUGS CONOCIDOS Y PENDIENTES

### 11.1. ⚠️ KPIs CXC no cuadran (EN INVESTIGACIÓN)
- **Problema:** "Sin Factura" mostraba 22 registros / $89M cuando debían ser 14 / $42.9M
- **Causa parcial:** NC estaban siendo incluidas como "Sin Factura" porque:
  - En el CSV, registros con NC tienen `montoFacturado = 0`, lo cual gatilla `pendiente_factura` en `getRealTimeStatus`
  - Aunque `facturas` filtra `tipoDoc = F|E|H`, registros con `tipoDoc` vacío defaultean a `'F'`
- **Fix aplicado:** Filtro explícito de NC en `sinFactura` (línea 184-189)
- **Estado:** Pendiente de verificación por el usuario

### 11.2. ⚠️ Duplicidad de lógica de status
- `import.js` calcula el status al importar (líneas 527-565)
- `finance.js` RECALCULA el status en runtime con `getRealTimeStatus()` (líneas 128-168)
- Esto puede causar discrepancias si los criterios no son idénticos

### 11.3. ⚠️ Console.log y Panel de Debug activos
- `finance.js` tiene ~50 líneas de `console.group/log` activas (líneas 268-310)
- Panel de verificación HTML activo (líneas 527-726)
- **TODO:** Remover ambos antes de producción

### 11.4. ⚠️ Dashboard KPI CXC simplificado
- Dashboard calcula "Por Cobrar" con un filtro simple: `status=pendiente|pendiente_factura|facturada`
- **NO usa** la misma lógica detallada que `finance.js` (que recalcula status y excluye NC, anuladas, etc.)
- Esto causa que Dashboard y CXC muestren cifras diferentes de "Por Cobrar"

---

## 12. VALORES CORRECTOS SEGÚN USUARIO (referencia)

Los KPIs deberían mostrar estos valores (proporcionados por el usuario en enero 2026):

| KPI | Valor Esperado |
|---|---|
| Sin Factura (neto) | $42,909,500 |
| 30+ Días | $80,003,017 |
| 60+ Días | $16,011,450 |
| 90+ Días | $8,377,600 |
| Lo que es mío | $146,640,367 |

---

## 13. ARCHIVOS DEL PROYECTO

| Archivo | Tamaño | Descripción |
|---|---|---|
| `index.html` | 3.7 KB | Entry point, sidebar nav |
| `src/app.js` | 4.3 KB | Router SPA |
| `src/shared/supabase.js` | 4 KB | Cliente Supabase |
| `src/shared/storage.js` | 37.6 KB | CRUD localStorage |
| `src/shared/storage-supabase.js` | 36.6 KB | CRUD Supabase |
| `src/shared/data-service.js` | 24.8 KB | Capa híbrida |
| `src/modules/dashboard/dashboard.js` | 25.8 KB | Dashboard |
| `src/modules/sales/sales.js` | 41.4 KB | Ventas |
| `src/modules/finance/finance.js` | 73.6 KB | CXC ⭐ |
| `src/modules/payables/payables.js` | 19.2 KB | CXP |
| `src/modules/settings/settings.js` | 33 KB | Catálogos |
| `src/modules/import/import.js` | 41.3 KB | Importar CSV |
| `src/styles/theme.css` | 1.7 KB | Variables CSS |
| `src/styles/layout.css` | 3.3 KB | Layout |
| `src/styles/components.css` | 3.9 KB | Componentes |
| `database/schema.sql` | 9.4 KB | Schema PostgreSQL |
| `cxc.csv` | 157.7 KB | Datos CXC originales |
| `cxp.csv` | 604.8 KB | Datos CXP originales |
| `vendidos.csv` | 132.1 KB | Datos ventas originales |

---

## 14. RESUMEN PARA OTRO AGENTE

### Para seguir con el proyecto, necesitas:
1. **Leer `finance.js`** completo (1181 líneas) — es el archivo crítico
2. **Entender los helpers** (sección 5.1) — definen todo el cálculo financiero
3. **Verificar los KPIs** — abrir la app, expandir el panel de verificación, comparar con los valores del usuario
4. **Cruzar con CSV** — comparar registros del panel con el archivo `cxc.csv` real
5. **No tocar** `storage.js` ni `storage-supabase.js` — son extensos pero estables.

### Prioridades inmediatas:
1. Resolver discrepancia en "Sin Factura" (verificar que NC ya no entren)
2. Verificar que "En Plazo" no incluya registros que ya fueron pagados
3. Confirmar que los 5 KPIs cuadren con los valores del usuario
4. Remover panel de debug y console.logs cuando todo cuadre
5. Armonizar lógica entre Dashboard y Finance (actualmente usan filtros distintos)
