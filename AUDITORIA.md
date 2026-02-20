# AUDITORÍA TÉCNICA — Mazelab IDE 2
> Última actualización: 19-Feb-2026 (v2)
> Propósito: Verificar que todos los cálculos y reglas de negocio estén correctamente implementados antes de migrar definitivamente desde Excel.

---

## ÍNDICE

1. [Arquitectura General](#1-arquitectura-general)
2. [Reglas de Negocio](#2-reglas-de-negocio)
3. [Módulo Dashboard](#3-módulo-dashboard)
4. [Módulo Ventas](#4-módulo-ventas)
5. [Módulo Finanzas / CXC](#5-módulo-finanzas--cxc)
6. [Módulo CXP](#6-módulo-cxp)
7. [Módulo Importar](#7-módulo-importar)
8. [Módulo Ajustes](#8-módulo-ajustes)
9. [Flujos Automáticos](#9-flujos-automáticos)
10. [Estructuras de Datos](#10-estructuras-de-datos)
11. [Bugs Identificados y Correcciones](#11-bugs-identificados-y-correcciones)
12. [Almacenamiento: Local vs Supabase](#12-almacenamiento-local-vs-supabase)
13. [Checklist de Validación Manual](#13-checklist-de-validación-manual)

---

## 1. ARQUITECTURA GENERAL

### Stack Técnico
- **Frontend**: Vanilla HTML5 + CSS3 + JavaScript (sin frameworks)
- **Patrón de módulos**: IIFE, expuestos como `window.Mazelab.Modules.XModule`
- **Almacenamiento**: Modo híbrido — localStorage (default) o Supabase si está configurado
- **SPA**: navegación sin recarga de página

### localStorage — Claves internas
```
mazelab_sales        → Ventas
mazelab_receivables  → CXC (cuentas por cobrar)
mazelab_payables     → CXP (cuentas por pagar)
mazelab_clients      → Clientes
mazelab_services     → Servicios
mazelab_staff        → Staff / Ejecutivos
```

---

## 2. REGLAS DE NEGOCIO

### 2.1 IVA (Impuesto al Valor Agregado)
- **Tasa**: 19% sobre el monto neto facturado
- **Fecha de pago al SII**: día 20 del mes siguiente a la emisión de la factura
  - Ejemplo: factura del 15/01/2026 → IVA se paga el 20/02/2026
  - La función `isIvaPaid(billingMonth)` verifica si ese día ya pasó

### 2.2 Retención Boleta de Honorarios (BH)
- **Hasta 2024**: retención del 14,5%
- **Desde 2025**: retención del 15,25%

### 2.3 Tipos de Documento CXC
| Código | Nombre | IVA | Nota |
|--------|--------|-----|------|
| (vacío / F) | Factura Afecta | +19% | Venta estándar |
| `E` | Factura Exenta | Sin IVA | Clientes exentos |
| `NC` | Nota de Crédito | — | Solo registro, no suma a CXC ni genera IVA |
| `anulada` | Factura Anulada | — | Solo registro histórico |

**Regla NC/Anulada**: Una NC existe para anular una factura previamente emitida. Tanto la factura anulada como su NC son solo registros contables — NO se suman al total por cobrar ni al IVA. Si un evento tuvo: factura original → NC → factura final, solo la factura final cuenta para CXC e IVA.

### 2.4 Vencimiento de CXC — Formato de Fechas

**Formato estándar único**: `DD/MM/YYYY`
- Datos nuevos registrados en plataforma: fecha exacta de emisión, ej: `18/01/2026`
- Datos históricos del Excel: día 1 del mes, ej: `01/01/2026` (importado como `01/01/2026`)
- Al importar desde CSV en formato `MM/YYYY` (ej: `01/2026`) → el sistema lo convierte automáticamente a `01/01/2026`

**¿Por qué estandarizar?** Tener un solo formato evita bugs de parsing. El día 01 para datos históricos es una convención elegida conscientemente (para contarlos más fácil en Excel).

### 2.5 Condición de Pago (paymentTerms)

Al registrar una factura en el módulo CXC, se puede definir el plazo de pago en días (default: **30 días**). Ejemplos:
- Cliente estándar: 30 días
- Clientes con contrato especial: 45 o 60 días

Este valor se guarda en el campo `paymentTerms` de cada CXC.

### 2.6 Vencimiento de CXC — Buckets

La base de vencimiento es **`billingMonth`** (fecha de emisión de la factura), NO la fecha del evento.

Para registros **sin_factura**: se usa `eventDate` como fecha de referencia (fallback), con los mismos `paymentTerms` de 30 días. Esto permite saber cuándo se espera cobrar ese evento aunque no esté facturado aún.

```
dueDate = billingDate + paymentTerms días
daysOverdue = hoy - dueDate (días de mora)
```

| Estado | Condición | Descripción |
|--------|-----------|-------------|
| `pendiente_factura` | Sin invoicedAmount | No hay factura emitida aún |
| `pendiente_pago` | daysOverdue ≤ 0 | Facturado, dentro del plazo |
| `vencida_30` | 1–30 días de mora | Pasó 1 a 30 días del plazo |
| `vencida_60` | 31–60 días de mora | Pasó 31 a 60 días del plazo |
| `vencida_90` | > 60 días de mora | Pasó más de 60 días del plazo |
| `pagada` | pagado ≥ total con IVA | Cobrado completo |
| `anulada` | status = 'anulada' | Registro histórico |
| `nc` | tipoDoc = 'NC' | Nota de crédito, no cuenta |

**Nota**: El status `pendiente` (legacy) es equivalente a `pendiente_pago` y se acepta como sinónimo para compatibilidad con datos anteriores.

### 2.7 Fecha de Pago de CXP (Cuentas por Pagar)
**Regla**: Pago el **primer viernes** ≥ `eventDate + 30 días`.

```
baseDate = eventDate + 30 días
dow = día de semana de baseDate (0=Dom...5=Vie)
Si dow = 5 → dueDate = baseDate
Si dow ≠ 5 → dueDate = baseDate + (5 - dow + 7) % 7 días
```

**Ejemplo**: Evento 01-Dic-2025 → +30 = 31-Dic-2025 (Mié) → primer viernes = 02-Ene-2026

### 2.8 Estado de Ventas — Auto-actualización
Si `eventDate < hoy` y el estado es `pendiente` o `confirmada`, el sistema **muestra automáticamente** el estado como `realizada` en la tabla (sin necesidad de actualizarlo manualmente). El estado guardado en la BD no se modifica; es una transformación solo de visualización.

---

## 3. MÓDULO DASHBOARD

### 3.1 KPIs

#### Ventas Totales
```
= Σ (s.amount || s.monto_venta) para TODAS las ventas sin filtro
```

#### Por Cobrar (CXC)
```
= Σ (r.montoNeto || r.monto_neto || r.invoicedAmount || r.monto_venta || r.amount)
  WHERE r.status IN ('pendiente', 'pendiente_pago', 'pendiente_factura', 'facturada',
                     'vencida_30', 'vencida_60', 'vencida_90')
  AND r.tipoDoc ≠ 'NC'
```
- Muestra monto NETO (sin IVA) — es una aproximación rápida
- Las NC, Anuladas y Pagadas no se cuentan

#### Por Pagar (CXP)
```
= Σ (p.amount || p.costAmount) WHERE p.status = 'pendiente'
```

#### Eventos con Problemas
```
= count WHERE s.hasIssue = true OR s.refundAmount > 0
```

#### Margen Estimado
```
= Ventas Totales − CXP pendiente
```
Es una estimación aproximada. No incluye CXP pagadas ni CXC cobradas.

### 3.2 Gráfico — Eventos por Mes
Últimos 6 meses, cuenta ventas por `eventDate`. Barras proporcionales al mes con más eventos.

### 3.3 Rankings — Top 5 Clientes y Servicios
- **Toggle**: "Último año" (default) / "Histórico"
- Top Clientes: suma `amount` por `clientName`
- Top Servicios: cuenta uso de `serviceIds` array

---

## 4. MÓDULO VENTAS

### 4.1 Estados de Venta
| Estado (guardado) | Visualizado como | Condición |
|-------------------|-----------------|-----------|
| `pendiente` | Realizada | Si `eventDate < hoy` (auto) |
| `confirmada` | Realizada | Si `eventDate < hoy` (auto) |
| `pendiente` | Pendiente | Si `eventDate ≥ hoy` |
| `realizada` | Realizada | Siempre |
| `anulada` | Anulada | Siempre |
| `cancelada` | Cancelada | Siempre |

El estado se actualiza automáticamente en visualización, sin tocar la base de datos.

### 4.2 Eliminación en Cascada
Al eliminar una venta, el sistema elimina también sus CXC y CXP vinculadas (por `saleId` o por coincidencia de `eventName + eventDate` con `sourceType = 'auto'`).

---

## 5. MÓDULO FINANZAS / CXC

### 5.1 KPIs

#### Facturado Este Mes
```
= Σ getMontoFacturado(r)
  WHERE billingMonth = mes actual
  AND tipoDoc ≠ 'NC' AND status ≠ 'anulada'
```

#### IVA del Mes
```
= Facturado Este Mes × 0.19
```
⚠️ No incluye facturas anuladas ni NC.

#### Pagado Este Mes
```
= Σ p.amount WHERE p.date está en el mes actual
  (suma de todos los payments[] de todas las CXC)
```
Se actualiza automáticamente cuando se registra un abono o se marca como pagado total.

#### Por Vencer Este Mes
```
= Σ getPendienteFacturado(r)
  WHERE billingMonth = mes actual AND r no está pagada
```

#### Total Por Cobrar
```
= (Σ getMonto(r) de sinFactura) × 1.19 + Σ getPendienteFacturado(r) de facturadas
```

#### Lo Que Es Mío
Para cada CXC, calcula cuánto de lo que se debe cobrar "es tuyo" neto de IVA:
```
Si tipoDoc = 'NC' → $0 (no cuenta)
Si status = 'anulada' → $0 (no cuenta)
Si pendiente_factura → Neto (eventualmente cobrarás el neto cuando factures)
Si tipoDoc = 'E' → Neto - Pagado (exenta, sin IVA)
Si hay factura Y IVA aún no pagado al SII → Neto - Pagado (el IVA es deuda tuya)
Si hay factura Y IVA ya pagado al SII → (Neto × 1.19) - Pagado (el IVA ya salió de tu cuenta)
```

**Razonamiento**: Cuando emites una factura de $100 neto, el cliente te debe $119. Pero el IVA ($19) lo debes al SII el día 20 del mes siguiente. Hasta que lo pagues, ese $19 es una deuda — "Lo Mío" es solo el neto ($100). Una vez pagado el IVA, la totalidad es tuya.

### 5.2 Botones de Acción por Estado

| Estado | Botones disponibles |
|--------|---------------------|
| `pendiente_factura` | **Facturar** + +Abono + Pagado Total + Eliminar |
| `pendiente_pago` | +Abono + Pagado Total + Eliminar |
| `vencida_30/60/90` | +Abono + Pagado Total + Eliminar |
| `pagada` | Eliminar |
| `anulada` / `nc` | Eliminar |

### 5.3 Modal "Facturar" (desde estado sin_factura)
Campos:
- N° Factura
- Fecha Emisión **DD/MM/YYYY** (formato obligatorio, se valida)
- Monto Neto Facturado (sin IVA)
- Condición de Pago en días (default 30, editable)
- Preview IVA y Total con IVA (se calcula en tiempo real)

Al guardar: actualiza `invoiceNumber`, `billingMonth`, `invoicedAmount`, `paymentTerms` y cambia status a `pendiente_pago`.

### 5.4 Modal "+Abono" — Gestión de Pagos
Muestra los pagos existentes del registro con opciones de **Editar** (✏️) y **Eliminar** (✕) para cada uno. Al guardar un nuevo pago, se agrega al array `payments[]`.

Los pagos tienen: `{ id, amount, date, method }`.

### 5.5 Funciones clave

#### `getMonto(r)` — Monto neto
```
r.montoNeto || r.invoicedAmount || r.monto_venta || r.amount || 0
```

#### `getMontoFacturado(r)` — Monto efectivamente facturado
```
r.montoFacturado ?? getMonto(r)
```

#### `getTotalPagado(r)` — Total de pagos recibidos
```
Σ p.amount de r.payments[]
```

#### `isIvaPaid(billingMonth)` — ¿Ya se pagó el IVA?
```
ivaDate = new Date(año, mesFact, 20)  // día 20 del mes SIGUIENTE
return new Date() > ivaDate
```

#### `getRealTimeStatus(r)` — Estado calculado en tiempo real
```
1. tipoDoc = 'NC' → 'nc'
2. status = 'anulada' → 'anulada'
3. status = 'pagada'/'pagado' → 'pagada'
4. status = 'pendiente_factura' → 'pendiente_factura'
5. getMontoFacturado(r) ≤ 0 → 'pendiente_factura'
6. Si pendiente/por_vencer/vacío:
   - Si pagado ≥ total → 'pagada'
   - Calcula baseDate (billingMonth o eventDate como fallback)
   - daysOverdue = diffDays - paymentTerms (default 30)
   - Si daysOverdue > 90 → 'vencida_90'
   - Si daysOverdue > 60 → 'vencida_60'
   - Si daysOverdue > 30 → 'vencida_30'
   → 'pendiente_pago'
7. Default → r.status
```

---

## 6. MÓDULO CXP

### 6.1 KPIs
| KPI | Cálculo |
|-----|---------|
| Total Pendiente | Σ p.amount WHERE status ≠ 'pagada' |
| Vencidos | count WHERE dueDate < hoy |
| Próximos | count WHERE 0 < dueDate - hoy ≤ 7 días |
| Proveedores | count de vendorName únicos |

### 6.2 Vistas
- **Lista**: todos los CXP ordenados, columna "Fecha Pago (Vie +30d)"
- **Agrupada**: agrupa por **EVENTO** (eventName + eventDate), no por proveedor

### 6.3 Color coding de filas
| Color | Condición |
|-------|-----------|
| Rojo | dueDate < hoy |
| Amarillo | dueDate dentro de ≤7 días |
| Sin color | pendiente lejano o pagado |

### 6.4 Campos del Modal CXP
| Campo | Descripción |
|-------|-------------|
| Proveedor / Beneficiario | `vendorName` |
| Evento | `eventName` |
| Cliente | `clientName` |
| Concepto | `concept` |
| Tipo Documento | `docType` (factura/bh/boleta) |
| Fecha del Evento | `eventDate` — base para calcular fecha de pago |
| Monto | `amount` |
| Monto Pagado | `amountPaid` |
| Estado | `status` (pendiente/pagada) |
| Fecha Pago Calculada | Read-only: primer viernes ≥ eventDate+30d |

---

## 7. MÓDULO IMPORTAR

### 7.1 Tipos de importación
sales / receivables / payables / clients / services / staff

### 7.2 Mapeo de columnas (FIELD_ALIASES)
| Campo interno | Nombres CSV aceptados |
|---------------|----------------------|
| `clientName` | cliente, client, nombre cliente, razón social, empresa, clientname |
| `eventName` | evento, event, nombre_evento, activacion, titulo, nombre, eventname |
| `serviceNames` | servicios, tipo, servicio, producto, servicenames |
| `eventDate` | fecha_evento, fecha, date, eventdate |
| `amount` | monto, monto_venta, precio, valor, total, amount |
| `status` | estado, state, situación, estado de pago, status |
| `invoicedAmount` | monto facturado, monto_facturado, facturado, invoiced amount |
| `amountPaid` | monto pagado, monto_pagado, pagado, paid, abonado |
| `tipoDoc` | tipo_doc, tipo doc, tipo documento cxc |
| `invoiceNumber` | nro_factura, numero_factura, n_factura, invoice number |
| `billingMonth` | mes_emision, mes_emision_factura, mes emision, billing month |
| `vendorName` | beneficiario, proveedor, vendor, vendorname |
| `docType` | tipo_de_costo, tipo_documento, document_type, documento |
| `concept` | tipo_de_costo, concepto, concept |
| `paymentDate` | fecha_probable_pago, payment_date |
| `paymentStatus` | estado_cxp, payment_status |
| `staffName` | ejecutivo, vendedor, responsable, vendido por, staffname |
| `refundAmount` | devolucion, devolución, reembolso, refundamount |
| `jornadas` | dias, días, days, duracion, jornadas |

### 7.3 Normalización de billingMonth
Al importar CXC, `billingMonth` siempre se normaliza a `DD/MM/YYYY`:
- `DD/MM/YYYY` → se mantiene sin cambios
- `MM/YYYY` → se convierte a `01/MM/YYYY`
- `YYYY-MM` → se convierte a `01/MM/YYYY`

### 7.4 Estado CXC calculado al importar
```
Si tipoDoc = 'NC' → '' (vacío)
Si status = 'anulada' → 'anulada'
Si status = 'pagado/pagada' → 'pagada'
Si invoicedAmount ≤ 0 → 'pendiente_factura'
Si amountPaid ≥ invoicedAmount → 'pagada'
Calcula billingMonth vs hoy con paymentTerms=30:
  → 'vencida_90' / 'vencida_60' / 'vencida_30' / 'pendiente_pago'
```

### 7.5 Creación automática de entidades
Al importar ventas/CXC/CXP, se crean automáticamente los registros nuevos en:
- Clientes (de clientName)
- Servicios (de serviceNames)
- Staff (de staffName)
- Proveedores como clientes (de vendorName)

### 7.6 Botón "Limpiar todos los datos"
Ubicación: módulo Importar → "Zona de Peligro" (al final de la página).
Requiere doble confirmación. Elimina todos los registros de las 6 tablas del sistema.
Usar antes de cada test de importación para empezar desde cero.

---

## 8. MÓDULO AJUSTES

### 8.1 Catálogos
- Clientes, Servicios, Staff (CRUD completo)
- Conexión Supabase (URL + API key)

### 8.2 Plantilla de Costos por Servicio
Cada servicio puede tener `cost_template[]` con ítems:
```json
{
  "concepto": "Animador de eventos",
  "tipo_beneficiario": "freelancer",
  "cantidad": 1,
  "monto_unitario": 320000
}
```
Tipo beneficiario:
- `freelancer` → genera CXP con docType = 'bh'
- `empresa` / otros → genera CXP con docType = 'factura'

---

## 9. FLUJOS AUTOMÁTICOS

### 9.1 Crear Venta → Auto-generar CXC + CXP

**Paso 1**: Se guarda la venta → retorna con `saleId`.

**Paso 2**: Se crea 1 CXC con:
```json
{
  "status": "pendiente_factura",
  "monto_venta": amount,
  "invoicedAmount": 0,
  "saleId": saleId,
  "sourceType": "auto",
  "isDraft": true
}
```
El campo `monto_venta` sirve de referencia para saber cuánto se espera cobrar mientras no haya factura.

**Paso 3**: Por cada ítem de `cost_template` de cada servicio incluido en la venta:
```json
{
  "concept": item.concepto,
  "vendorName": "",
  "amount": item.cantidad × item.monto_unitario,
  "docType": "bh" o "factura",
  "status": "pendiente",
  "saleId": saleId,
  "sourceType": "auto",
  "isDraft": true
}
```

### 9.2 Eliminar Venta → Cascada
Se eliminan: CXC donde `saleId` coincide + CXP donde `saleId` coincide.
Se muestra advertencia detallada con conteo y si hay abonos registrados.

---

## 10. ESTRUCTURAS DE DATOS

### 10.1 Venta (sales)
```json
{
  "id": "string",
  "clientName": "string",
  "eventName": "string",
  "serviceIds": ["id1", "id2"],
  "eventDate": "YYYY-MM-DD",
  "amount": 0,
  "status": "pendiente|confirmada|realizada|anulada|cancelada",
  "jornadas": 0,
  "staffName": "string",
  "comments": "string",
  "refundAmount": 0,
  "hasIssue": false
}
```

### 10.2 CXC — Cuenta por Cobrar (receivables)
```json
{
  "id": "string",
  "clientName": "string",
  "eventName": "string",
  "tipoDoc": "F|E|NC",
  "invoiceNumber": "string",
  "billingMonth": "DD/MM/YYYY",
  "invoicedAmount": 0,
  "paymentTerms": 30,
  "monto_venta": 0,
  "amountPaid": 0,
  "status": "pendiente_factura|pendiente_pago|pagada|anulada|vencida_30|vencida_60|vencida_90",
  "eventDate": "YYYY-MM-DD",
  "ncAsociada": "string",
  "payments": [
    { "id": "string", "amount": 0, "date": "YYYY-MM-DD", "method": "string" }
  ],
  "saleId": "string",
  "sourceType": "auto",
  "isDraft": true
}
```

### 10.3 CXP — Cuenta por Pagar (payables)
```json
{
  "id": "string",
  "vendorName": "string",
  "eventName": "string",
  "clientName": "string",
  "concept": "string",
  "docType": "factura|bh|boleta",
  "amount": 0,
  "amountPaid": 0,
  "status": "pendiente|pagada",
  "eventDate": "YYYY-MM-DD",
  "saleId": "string",
  "sourceType": "auto",
  "isDraft": true
}
```

---

## 11. BUGS IDENTIFICADOS Y CORRECCIONES

| # | Archivo | Descripción | Estado |
|---|---------|-------------|--------|
| 1 | finance.js | `getMonto()` no leía `invoicedAmount` (montos en $0 para registros importados) | ✅ Corregido |
| 2 | dashboard.js | KPI CXC leía campo incorrecto ($0 para registros importados) | ✅ Corregido |
| 3 | import.js | `buildPayableRecord` no guardaba `eventDate` (calcDueDate fallaba) | ✅ Corregido |
| 4 | finance.js | Modal abono invisible (faltaba clase `.active`) | ✅ Corregido |
| 5 | finance.js | Modal facturar también necesitaba clase `.active` | ✅ Corregido |
| 6 | finance.js | `getMonto()` no leía `monto_venta` (CXC auto sin factura mostraba $0) | ✅ Corregido |
| 7 | sales.js | Estado venta no se actualizaba si el evento ya pasó | ✅ Corregido (auto-visualización) |
| 8 | Varios | `pendiente` → renombrado a `pendiente_pago` para evitar confusión con `pendiente_factura` | ✅ Implementado |

### Punto de Atención — billingMonth de importación histórica
El día `01` en `billingMonth` para datos históricos (ej: `01/10/2025`) hace que el vencimiento se calcule desde el día 1 del mes, no desde el día real de emisión. Esto es intencional y consistente con la convención del Excel anterior.

---

## 12. ALMACENAMIENTO: LOCAL VS SUPABASE

### Estado actual
**El sistema corre 100% en localStorage** (del navegador).

- Todos los datos se guardan en el navegador local
- Si limpias el caché del navegador → **se pierden todos los datos**
- Si accedes desde otro navegador o equipo → verás datos vacíos

### Cuándo migrar a Supabase
Supabase es la opción para tener datos en la nube (persistentes y accesibles desde cualquier dispositivo). Para activarlo:
1. Crear una cuenta en [supabase.com](https://supabase.com)
2. Crear un proyecto con las tablas: `sales`, `receivables`, `payables`, `clients`, `services`, `staff`
3. Ingresar la URL y API Key en **Ajustes → Conexión Supabase**

### Recomendación para la migración
1. Probar todo con los CSV ficticios en localStorage
2. Verificar que los cálculos son correctos
3. Conectar Supabase
4. Importar los CSV reales del Excel
5. A partir de entonces, registrar todo desde la plataforma

---

## 13. CHECKLIST DE VALIDACIÓN MANUAL

### Importación
- [ ] Ir a **Importar → Zona de Peligro → Limpiar todos los datos** antes de empezar
- [ ] Importar `test_ventas.csv` → ver 8 ventas en módulo Ventas
- [ ] Importar `test_cxc.csv` → ver 10 registros en módulo Finanzas/CXC
- [ ] Importar `test_cxp.csv` → ver 8 registros en módulo CXP
- [ ] Verificar que se crearon clientes y servicios automáticamente en Ajustes

### Dashboard
- [ ] KPI "Ventas Totales" muestra suma > $0
- [ ] KPI "Por Cobrar (CXC)" muestra monto > $0
- [ ] KPI "Eventos con Problemas" muestra 1 (Constructora Nova tiene devolución)
- [ ] Toggle "Último año" / "Histórico" en Rankings cambia los datos mostrados

### Finanzas / CXC
- [ ] El filtro "Solo Pendientes" oculta los registros pagados y NC
- [ ] Los registros del CSV con billingMonth antiguo aparecen como "Vencida 30+", "Vencida 60+", etc.
- [ ] Los registros con billingMonth reciente aparecen como "Pendiente"
- [ ] El botón "Facturar" aparece en registros sin factura
- [ ] Al hacer clic en "Facturar": se abre el modal, se ingresa fecha DD/MM/YYYY y monto → status cambia a Pendiente
- [ ] Al hacer "+Abono": aparecen los pagos existentes con botones Editar y Eliminar
- [ ] Editar un pago modifica el monto/fecha correctamente
- [ ] Eliminar un pago reduce el saldo Restante
- [ ] "Pagado Total" marca el registro como Pagada
- [ ] El buscador no pierde el foco al escribir

### CXP
- [ ] Vista Agrupada agrupa por EVENTO (no por proveedor)
- [ ] Los CXP con eventDate antigua muestran fondo rojo (vencidos)
- [ ] Los CXP con eventDate en 7 días muestran fondo amarillo
- [ ] La columna "Fecha Pago" muestra viernes calculado correctamente
- [ ] CXP importados tienen fecha de pago calculada (no "Sin fecha")

### Ventas — auto-estado
- [ ] Ventas con fecha de evento pasada muestran badge "Realizada" aunque el status guardado sea "pendiente"
- [ ] El filtro "Realizadas" captura esas ventas auto-clasificadas

### Flujo completo (crear → pagar → borrar)
- [ ] Crear nueva venta manualmente → se auto-crea 1 CXC en Finanzas
- [ ] En la CXC auto-creada → hacer clic "Facturar" → ingresar datos de factura
- [ ] Registrar un abono parcial → verificar que Restante disminuye
- [ ] Eliminar la venta → confirmar que se eliminaron las CXC y CXP asociadas

---

*Documento generado por auditoría de código fuente — v2.0*
