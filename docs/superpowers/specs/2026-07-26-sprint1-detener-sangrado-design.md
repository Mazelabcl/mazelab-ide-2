# Sprint 1 — "Detener el sangrado" (diseño aprobado)

Fecha: 2026-07-26 · Rama: `feature/sprint-s02` · Aprobado por Aldo en conversación (ronda de reglas de negocio completa).

## Objetivo

Cortar todo daño nuevo a los datos y corregir los cálculos de dinero, sin tocar producción hasta el deploy único de cierre. Solo frontend. Todo se verifica localmente antes de publicar; los 13 commits pendientes de la rama viajan con este sprint.

**Fuera de alcance:** limpieza de datos ya dañados (Sprint 2, con lista aprobada fila por fila), migración Vercel/Supabase (Sprint 3), configurador de tabla de comisiones (sprint propio futuro).

## Reglas de negocio que gobiernan este sprint

Fuente: `memory/reglas-negocio-mazelab.md` (memoria del proyecto, confirmadas por Aldo 2026-07-25/26).

1. **BH (costos):** el monto ingresado es el líquido a transferir. Retención = `líquido × tasa/(1−tasa)`, redondeada a peso. Costo empresa = líquido + retención. Tasa por año de emisión (SII, Ley 21.133): 2024: 13,75% · 2025: 14,5% · 2026: 15,25% · 2027: 16% · 2028+: 17%. El código actual ("14,5% ≤2024 / 15,25% ≥2025") está corrido un año.
2. **Factura proveedor (costos):** monto ingresado = total con IVA. IVA crédito = `total − total/1,19`. Solo alimenta el cálculo del IVA del mes; jamás entra en "Lo que es mío".
3. **KPI "Lo que es mío":** solo CXC. El IVA de una factura emitida en mes M se paga el 20 de M+1. Hasta el día 20 de M+1 inclusive, esa factura aporta solo el neto; desde el 21 de M+1, el total con IVA. Ej.: factura de junio por 1.000.000+IVA → el 19 de julio aporta $1.000.000, el 21 de julio $1.190.000.
4. **NC:** asociada a factura específica, puede ser parcial. Saldo CXC = factura − NC. Estado explícito `nc_aplicada` (no `''`). La NC impacta el IVA del mes en que se emite.
5. **Incidencia (compensación por problema en evento):** reduce la venta en el mes del evento. Si había factura, además se emite NC por el mismo monto. La venta se descuenta por la incidencia y la CXC por la NC — **nunca ambas en el mismo libro** (no doble descuento).
6. **Facturación parcial:** N facturas por evento; la fila `sin_factura` mantiene el saldo y solo se cierra cuando `Σ facturas ≥ monto venta`.
7. **Comisiones:** % ingresado a mano por la vendedora en el formulario de venta. Comisión = `% × utilidad del evento × (cobrado/total)` — proporcional al cobro real. Utilidad = venta neta sin IVA − costo empresa de los ítems del evento (BH: bruto; factura: neto sin IVA; en negro/otros: tal cual). **Se muestra desde ya** (la vendedora lleva sus anotaciones); el configurador de tabla queda para después.
8. **Sin conexión:** aviso bloqueante y app en solo lectura. Sin escritura fallback a localStorage.
9. **Guardado:** error visible cuando el servidor rechaza (nada de fingir éxito) + toast de confirmación cuando la persistencia en el servidor fue real.

## Alcance (ítems de trabajo)

### A. Flujo de facturación
- **A1.** `finance.js` (~1972-1987): "+ Nueva Factura" debe guardar `sourceId` y descontar el monto facturado de la fila `sin_factura` del evento, cerrándola solo cuando las facturas cubren la venta — misma semántica que el botón "Facturar" de la fila.
- **A2.** `sales.js` (~866-896): al editar una venta con `sourceId` vacío no debe crearse una CXC fantasma `sin_factura` por el monto completo (el match con string vacío falsy falla).
- **A3.** `sales.js` (~178): la columna ID muestra `sourceId`; debe mostrar un identificador visible (o poblarlo).

### B. Cálculos de dinero
- **B1.** `payables.js` (~196-197): retención BH con fórmula `líquido × tasa/(1−tasa)` y tabla de tasas por año (regla 1). Como el monto guardado es el líquido, el fix corrige lo histórico automáticamente.
- **B2.** `dashboard.js` (~1319): IVA crédito = `amount − amount/1.19` (hoy hace `amount × 0.19` sobre un monto que ya incluye IVA).
- **B3.** `finance.js` (~2378): NC descontada una sola vez (causa probable del descuadre de $10,3M entre cálculo directo y dashboard).
- **B4.** `import.js` (~78-83): `parseAmount` chileno: punto = miles, coma = decimal, CLP enteros ("45.000" → 45000).
- **B5.** "Lo que es mío" según la regla fina del día 20 de M+1 (regla 3) — verificar la implementación actual y alinearla.
- **B6.** Incidencia/NC sin doble descuento (regla 5) — verificar cómo interactúan `refundAmount` y NC hoy, y alinear.
- **B7.** Comisiones en dashboard: verificar qué calcula el código pendiente de los 13 commits y alinearlo a la regla 7 (utilidad × % × proporción cobrada). No ocultar.

### C. Robustez de guardado y arranque
- **C1.** Guardados rechazados por el servidor lanzan error visible; guardado exitoso muestra confirmación (toast). El éxito se reporta solo si el servidor confirmó.
- **C2.** Sin conexión con la base: aviso bloqueante y modo solo lectura. Eliminar el fallback de escritura a localStorage.
- **C3.** Eliminar la carga automática de datos de demostración.

### D. Housekeeping
- **D1.** Verificar el fix "artesanal" de edición de venta (comisión/vendedor/servicios ya no se borran según Aldo). Si el orden `populateDropdowns()`-después-de-poblar sigue frágil, mejorarlo **solo si** la verificación demuestra que no hay regresión.
- **D2.** Importador visible solo para superadmin (queda como herramienta de restauración de respaldo).
- **D3.** `.gitignore`: agregar node_modules, imágenes/PDFs personales y archivos de datos sueltos (pendiente del Sprint 0).

## Verificación (obligatoria, la hace el equipo de agentes — Aldo no hace smoke tests)

- Casos numéricos con resultados esperados exactos, por ejemplo: retención de líquido 1.000.000 en 2026 → $179.941; IVA crédito de factura 1.190.000 → $190.000; F5 1.500.000+IVA con NC1 200.000+IVA → CXC $1.547.000; "45.000" → 45000; "1.234.567" → 1234567.
- Trazado de flujos de punta a punta comparando flujos hermanos ("Facturar" vs "+ Nueva Factura" deben dejar el mismo estado final) — la lección de la auditoría: los bugs caros solo aparecen así.
- Verificación en navegador con `index.html` local antes de cualquier deploy.

## Deploy (al cierre, un solo evento)

Git pull en Replit + SQL pendiente de `memory/replit-pending-sql.md` (incluye `comisionPct`, que hoy causa error 500 al guardar). Checklist detallado se entrega al cerrar el sprint.
