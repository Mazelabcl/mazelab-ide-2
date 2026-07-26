# Sprint 1 "Detener el sangrado" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cortar el daño nuevo a los datos y corregir todos los cálculos de dinero de MazeLab OS, verificado con tests de Node + trazado de flujos, sin tocar producción.

**Architecture:** Se crea `src/shared/money.js` — módulo puro (UMD: window + module.exports) que centraliza TODA la matemática de dinero hoy duplicada en 4+ archivos. Los módulos existentes (payables, dashboard, finance, import) pasan a llamar `window.Mazelab.Money.*`. La lógica pura se testea con Node sin browser (`node tests/money.test.js`). Los flujos DOM se corrigen en sitio y se verifican trazando flujos hermanos.

**Tech Stack:** Vanilla JS (IIFE, sin build step), Node ≥18 solo para tests (sin package.json — CommonJS por defecto).

**Reglas de negocio:** ver `docs/superpowers/specs/2026-07-26-sprint1-detener-sangrado-design.md` (spec aprobado). Referencias de línea verificadas contra HEAD `610e883`.

---

## Task 1: `src/shared/money.js` + tests (TDD)

**Files:**
- Create: `tests/money.test.js`
- Create: `src/shared/money.js`
- Modify: `index.html:111` (insertar script tag después de `storage.js`)
- Modify: `.gitignore`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `tests/money.test.js`:

```js
// Tests de src/shared/money.js — correr con: node tests/money.test.js
const assert = require('assert');
const M = require('../src/shared/money.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  OK  ' + name); }
    catch (e) { fail++; console.error('FAIL  ' + name + ' — ' + e.message); }
}

// ---- Retención BH (tabla SII Ley 21.133, por año de emisión) ----
t('tasa 2024 = 13,75%', () => assert.strictEqual(M.bhRetentionRate('2024-06-15'), 0.1375));
t('tasa 2025 = 14,5%',  () => assert.strictEqual(M.bhRetentionRate('2025-06-15'), 0.145));
t('tasa 2026 = 15,25%', () => assert.strictEqual(M.bhRetentionRate('2026-06-15'), 0.1525));
t('tasa 2027 = 16%',    () => assert.strictEqual(M.bhRetentionRate('2027-06-15'), 0.16));
t('tasa 2028+ = 17%',   () => assert.strictEqual(M.bhRetentionRate('2029-01-01'), 0.17));
t('sin fecha usa año actual', () => assert.strictEqual(typeof M.bhRetentionRate(null), 'number'));

// retención = líquido × tasa/(1−tasa), redondeada a peso
t('retención de 1.000.000 líquido en 2026 = 179.941', () =>
    assert.strictEqual(M.bhRetencion(1000000, '2026-05-01'), 179941));
t('retención de 1.000.000 líquido en 2025 = 169.591', () =>
    assert.strictEqual(M.bhRetencion(1000000, '2025-05-01'), 169591));
t('costo empresa BH = líquido + retención', () =>
    assert.strictEqual(M.bhCostoEmpresa(1000000, '2026-05-01'), 1179941));

// ---- IVA crédito de factura proveedor (monto ingresado = total con IVA) ----
t('IVA crédito de 1.190.000 = 190.000', () => assert.strictEqual(M.ivaCredito(1190000), 190000));
t('neto de 1.190.000 = 1.000.000',      () => assert.strictEqual(M.facturaNeto(1190000), 1000000));
t('IVA crédito de 595.000 = 95.000',    () => assert.strictEqual(M.ivaCredito(595000), 95000));

// ---- Costo empresa por ítem (para utilidad de comisiones) ----
t('costo empresa factura = neto', () => assert.strictEqual(M.costoEmpresaItem('factura', 1190000, '2026-05-01'), 1000000));
t('costo empresa BH = bruto',     () => assert.strictEqual(M.costoEmpresaItem('bh', 1000000, '2026-05-01'), 1179941));
t('costo empresa otros = crudo',  () => assert.strictEqual(M.costoEmpresaItem('efectivo', 400000, '2026-05-01'), 400000));

// ---- parseAmountCL (formato chileno) ----
t('"45.000" → 45000',       () => assert.strictEqual(M.parseAmountCL('45.000'), 45000));
t('"1.500" → 1500',         () => assert.strictEqual(M.parseAmountCL('1.500'), 1500));
t('"1.234.567" → 1234567',  () => assert.strictEqual(M.parseAmountCL('1.234.567'), 1234567));
t('"$ 1.500" → 1500',       () => assert.strictEqual(M.parseAmountCL('$ 1.500'), 1500));
t('"123,45" → 123.45',      () => assert.strictEqual(M.parseAmountCL('123,45'), 123.45));
t('"1.234,5" → 1234.5',     () => assert.strictEqual(M.parseAmountCL('1.234,5'), 1234.5));
t('"12.34" → 12.34 (2 decimales = decimal)', () => assert.strictEqual(M.parseAmountCL('12.34'), 12.34));
t('"#REF!" → 0',            () => assert.strictEqual(M.parseAmountCL('#REF!'), 0));
t('"" → 0',                 () => assert.strictEqual(M.parseAmountCL(''), 0));
t('null → 0',               () => assert.strictEqual(M.parseAmountCL(null), 0));
t('número directo pasa',    () => assert.strictEqual(M.parseAmountCL(45000), 45000));

// ---- Regla del día 20: IVA declarado ----
// factura de junio 2026: se paga el 20 de julio; es "mío" recién desde el 21
t('junio visto el 19-jul → NO declarado', () =>
    assert.strictEqual(M.ivaDeclarado(2026, 6, new Date(2026, 6, 19, 12)), false));
t('junio visto el 20-jul → NO declarado (el día 20 aún no es tuyo)', () =>
    assert.strictEqual(M.ivaDeclarado(2026, 6, new Date(2026, 6, 20, 18)), false));
t('junio visto el 21-jul → SÍ declarado', () =>
    assert.strictEqual(M.ivaDeclarado(2026, 6, new Date(2026, 6, 21, 0, 30)), true));
t('julio visto en julio → NO declarado', () =>
    assert.strictEqual(M.ivaDeclarado(2026, 7, new Date(2026, 6, 25)), false));
t('diciembre cruza año: dic-2025 visto 21-ene-2026 → SÍ', () =>
    assert.strictEqual(M.ivaDeclarado(2025, 12, new Date(2026, 0, 21, 1)), true));

// ---- CXC: pendiente por fila (separación de libros NC vs incidencia) ----
// F5: 1.500.000 + IVA con NC de 200.000 + IVA → pendiente 1.547.000
t('factura 1.5M con NC 200k → pendiente 1.547.000', () =>
    assert.strictEqual(M.pendienteFacturadoRow({ tipoDoc: 'F', facturadoNeto: 1500000, ncNeto: 200000, pagado: 0 }), 1547000));
t('factura sin NC, pago parcial', () =>
    assert.strictEqual(M.pendienteFacturadoRow({ tipoDoc: 'F', facturadoNeto: 1000000, ncNeto: 0, pagado: 500000 }), 690000));
t('la incidencia NO descuenta en fila facturada (eso lo hace la NC)', () =>
    assert.strictEqual(M.pendienteFacturadoRow({ tipoDoc: 'F', facturadoNeto: 1000000, ncNeto: 0, refundNeto: 200000, pagado: 0 }), 1190000));
t('exenta E resta NC sin IVA', () =>
    assert.strictEqual(M.pendienteFacturadoRow({ tipoDoc: 'E', facturadoNeto: 1000000, ncNeto: 200000, pagado: 0 }), 800000));
t('fila sin factura resta incidencia', () =>
    assert.strictEqual(M.pendienteSinFacturaRow({ neto: 1500000, refundNeto: 300000, pagado: 0 }), 1200000));

// ---- Lo que es mío por fila ----
t('NC nunca aporta', () => assert.strictEqual(M.mioRow({ tipoDoc: 'NC' }), 0));
t('sin factura: neto − incidencia', () =>
    assert.strictEqual(M.mioRow({ tipoDoc: 'F', tieneFactura: false, neto: 1500000, refundNeto: 300000, pagado: 0 }), 1200000));
t('facturada, IVA NO declarado: solo neto', () =>
    assert.strictEqual(M.mioRow({ tipoDoc: 'F', tieneFactura: true, facturadoNeto: 1000000, ncNeto: 0, pagado: 0, ivaDeclarado: false }), 1000000));
t('facturada, IVA declarado: total con IVA', () =>
    assert.strictEqual(M.mioRow({ tipoDoc: 'F', tieneFactura: true, facturadoNeto: 1000000, ncNeto: 0, pagado: 0, ivaDeclarado: true }), 1190000));
t('facturada con NC, IVA declarado', () =>
    assert.strictEqual(M.mioRow({ tipoDoc: 'F', tieneFactura: true, facturadoNeto: 1500000, ncNeto: 200000, pagado: 0, ivaDeclarado: true }), 1547000));

// ---- Comisión: % × utilidad × proporción cobrada ----
t('10% de utilidad 600k, cobrada la mitad → 30.000', () =>
    assert.strictEqual(M.comisionDevengada(10, 600000, 500000, 1000000), 30000));
t('10% de utilidad 600k, todo cobrado → 60.000', () =>
    assert.strictEqual(M.comisionDevengada(10, 600000, 1000000, 1000000), 60000));
t('nada cobrado → 0', () => assert.strictEqual(M.comisionDevengada(10, 600000, 0, 1000000), 0));
t('utilidad negativa → 0', () => assert.strictEqual(M.comisionDevengada(10, -50000, 1000000, 1000000), 0));
t('pct 0 → 0', () => assert.strictEqual(M.comisionDevengada(0, 600000, 1000000, 1000000), 0));

console.log('\n' + pass + ' OK, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node tests/money.test.js`
Expected: `Error: Cannot find module '../src/shared/money.js'`

- [ ] **Step 3: Implementar `src/shared/money.js`**

```js
// Matemática de dinero de MazeLab OS — fuente única de verdad.
// Reglas de negocio: docs/superpowers/specs/2026-07-26-sprint1-detener-sangrado-design.md
// Funciona en browser (window.Mazelab.Money) y en Node (module.exports) para tests.
(function (root, factory) {
    var api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) {
        root.Mazelab = root.Mazelab || {};
        root.Mazelab.Money = api;
    }
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    var IVA = 1.19;

    // Tabla SII Ley 21.133 — tasa de retención BH por año de emisión
    var BH_RATES = { 2022: 0.1225, 2023: 0.13, 2024: 0.1375, 2025: 0.145, 2026: 0.1525, 2027: 0.16 };

    function bhRetentionRate(dateStr) {
        var year = NaN;
        if (dateStr) year = new Date(dateStr).getFullYear();
        if (!year || isNaN(year)) year = new Date().getFullYear();
        if (year <= 2022) return 0.1225;
        if (year >= 2028) return 0.17;
        return BH_RATES[year];
    }

    // El monto ingresado de una BH es el LÍQUIDO a transferir.
    // Retención = líquido × tasa/(1−tasa); costo empresa = líquido + retención.
    function bhRetencion(liquido, dateStr) {
        var rate = bhRetentionRate(dateStr);
        return Math.round((Number(liquido) || 0) * rate / (1 - rate));
    }

    function bhCostoEmpresa(liquido, dateStr) {
        return (Number(liquido) || 0) + bhRetencion(liquido, dateStr);
    }

    // El monto ingresado de una factura de proveedor es el TOTAL con IVA.
    function facturaNeto(totalConIva) {
        return Math.round((Number(totalConIva) || 0) / IVA);
    }

    function ivaCredito(totalConIva) {
        var total = Number(totalConIva) || 0;
        return total - facturaNeto(total);
    }

    // Costo real para la empresa de un ítem de CXP (para utilidad de comisiones):
    // BH → bruto; factura → neto (el IVA es crédito); resto → tal cual.
    function costoEmpresaItem(docType, amount, dateStr) {
        var dt = String(docType || '').toLowerCase();
        var amt = Number(amount) || 0;
        if (dt === 'bh') return bhCostoEmpresa(amt, dateStr);
        if (dt === 'factura') return facturaNeto(amt);
        return amt;
    }

    // Parser de montos chilenos: punto = miles, coma = decimal.
    function parseAmountCL(val) {
        if (val === null || val === undefined) return 0;
        if (typeof val === 'number') return val;
        var str = String(val).replace(/[$\s]/g, '');
        if (!str || str === '.') return 0;
        if (str.indexOf('#') !== -1 || str.indexOf('REF') !== -1) return 0;
        var neg = /^-/.test(str);
        if (neg) str = str.slice(1);
        var commaCount = (str.match(/,/g) || []).length;
        var dotCount = (str.match(/\./g) || []).length;
        if (commaCount > 1) {
            str = str.replace(/,/g, '');
        } else if (dotCount > 1) {
            str = str.replace(/\./g, '');
        } else if (commaCount === 1 && dotCount === 1) {
            if (str.lastIndexOf(',') > str.lastIndexOf('.')) str = str.replace(/\./g, '').replace(',', '.');
            else str = str.replace(/,/g, '');
        } else if (commaCount === 1) {
            var afterComma = str.split(',')[1];
            if (afterComma && afterComma.length === 3) str = str.replace(',', '');
            else str = str.replace(',', '.');
        } else if (dotCount === 1) {
            var afterDot = str.split('.')[1];
            if (afterDot && afterDot.length === 3) str = str.replace('.', '');
            // 1-2 dígitos tras el punto → decimal, se deja igual
        }
        var n = Number(str) || 0;
        return neg ? -n : n;
    }

    // Regla del día 20: el IVA de una factura emitida en (year, month 1-12)
    // se paga el 20 del mes siguiente. Es "del negocio" recién DESDE el 21.
    function ivaDeclarado(year, month1to12, today) {
        var m = Number(month1to12) + 1, y = Number(year);
        if (m > 12) { m = 1; y++; }
        var cutoff = new Date(y, m - 1, 20, 23, 59, 59, 999);
        return (today || new Date()).getTime() > cutoff.getTime();
    }

    // ---- CXC por fila. Separación de libros:
    // filas FACTURADAS descuentan solo NC (nunca incidencia);
    // filas SIN FACTURA descuentan solo incidencia (refund).
    // Montos neto; pagado viene con IVA en facturas tipo F.
    function pendienteFacturadoRow(o) {
        var facturado = Number(o.facturadoNeto) || 0;
        var nc = Number(o.ncNeto) || 0;
        var pagado = Number(o.pagado) || 0;
        var base = Math.max(0, facturado - nc);
        if (o.tipoDoc === 'E') return Math.max(0, base - pagado);
        return Math.max(0, Math.round(base * IVA) - pagado);
    }

    function pendienteSinFacturaRow(o) {
        var neto = Number(o.neto) || 0;
        var refund = Number(o.refundNeto) || 0;
        var pagado = Number(o.pagado) || 0;
        return Math.max(0, neto - refund - pagado);
    }

    // "Lo que es mío" por fila (solo CXC):
    // sin factura → neto − incidencia − pagado
    // facturada + IVA no declarado → solo neto (el IVA se le debe al SII)
    // facturada + IVA declarado → total con IVA (ese IVA ya salió del bolsillo)
    function mioRow(o) {
        if (o.tipoDoc === 'NC') return 0;
        var pagado = Number(o.pagado) || 0;
        if (o.tipoDoc === 'E') {
            return Math.max(0, (Number(o.neto) || 0) - (Number(o.refundNeto) || 0) - pagado);
        }
        if (!o.tieneFactura) {
            return Math.max(0, (Number(o.neto) || 0) - (Number(o.refundNeto) || 0) - pagado);
        }
        var baseNeto = Math.max(0, (Number(o.facturadoNeto) || 0) - (Number(o.ncNeto) || 0));
        if (o.ivaDeclarado) return Math.max(0, Math.round(baseNeto * IVA) - pagado);
        return Math.max(0, baseNeto - Math.round(pagado / IVA));
    }

    // Comisión = % × utilidad × proporción cobrada (neto/neto), redondeada.
    function comisionDevengada(pct, utilidad, cobradoNeto, ventaNeta) {
        var p = Number(pct) || 0;
        var vn = Number(ventaNeta) || 0;
        if (p <= 0 || vn <= 0) return 0;
        var prop = Math.max(0, Math.min(1, (Number(cobradoNeto) || 0) / vn));
        return Math.round((p / 100) * Math.max(0, Number(utilidad) || 0) * prop);
    }

    return {
        IVA: IVA,
        bhRetentionRate: bhRetentionRate,
        bhRetencion: bhRetencion,
        bhCostoEmpresa: bhCostoEmpresa,
        facturaNeto: facturaNeto,
        ivaCredito: ivaCredito,
        costoEmpresaItem: costoEmpresaItem,
        parseAmountCL: parseAmountCL,
        ivaDeclarado: ivaDeclarado,
        pendienteFacturadoRow: pendienteFacturadoRow,
        pendienteSinFacturaRow: pendienteSinFacturaRow,
        mioRow: mioRow,
        comisionDevengada: comisionDevengada
    };
});
```

- [ ] **Step 4: Correr tests hasta verde**

Run: `node tests/money.test.js`
Expected: `44 OK, 0 FAIL` (o el total que resulte), exit 0.

- [ ] **Step 5: Insertar script tag y actualizar .gitignore**

En `index.html`, después de la línea 111 (`<script src="src/shared/storage.js"></script>`) insertar:

```html
    <script src="src/shared/money.js"></script>
```

Añadir al final de `.gitignore`:

```
# Dependencias y archivos personales sueltos
node_modules/
branding/
*.xlsx
*.pdf
diff.txt
test.txt
*.png
```

(Verificar con `git status` que ningún archivo TRACKEADO quede ignorado: `git ls-files | findstr /i ".png .pdf .xlsx"` — si algún asset del proyecto está trackeado con esas extensiones, usar rutas específicas en vez de comodines.)

- [ ] **Step 6: Commit**

```bash
git add tests/money.test.js src/shared/money.js index.html .gitignore
git commit -m "feat: shared money.js — matematica de dinero centralizada con tests Node"
```

---

## Task 2: payables.js y dashboard.js usan Money (retención BH + IVA crédito)

**Files:**
- Modify: `src/modules/payables/payables.js:34-39, 190-206, 227-228, 680-711, 914-925`
- Modify: `src/modules/dashboard/dashboard.js:1287-1291, 1306-1324`

- [ ] **Step 1: payables.js — reemplazar `getBHRetentionRate` local por delegación**

En `payables.js:34-39` reemplazar la función completa por:

```js
    // Retención BH — delega en la tabla SII central (shared/money.js)
    function getBHRetentionRate(dateStr) {
        return window.Mazelab.Money.bhRetentionRate(dateStr);
    }
```

- [ ] **Step 2: payables.js — corregir la FÓRMULA en los 4 sitios (era `amount × rate`, debe ser `líquido × rate/(1−rate)`)**

Sitio 1 — `docInfoHTML` (líneas 194-197), reemplazar por:

```js
            var M = window.Mazelab.Money;
            var amount = Number(p.amount) || 0;
            var ret  = M.bhRetencion(amount, p.billingDate || p.eventDate);
            var rate = M.bhRetentionRate(p.billingDate || p.eventDate);
            var totalCosto = amount + ret;
```

Sitio 2 — `computeKPIs` (línea 227), reemplazar por:

```js
            if (isBH(p)) totalRetencion += window.Mazelab.Money.bhRetencion(Number(p.amount) || 0, p.billingDate || p.eventDate);
```

Y la línea 228 (IVA, ya correcta) unificar igualmente:

```js
            if (isFactura(p)) totalIVACredito += window.Mazelab.Money.ivaCredito(Number(p.amount) || 0);
```

Sitios 3 y 4 — `updateDocPreview` (691-693) y `refreshAbonoContent` (916-918): leer el bloque en contexto y aplicar el mismo patrón (`M.bhRetencion(...)` para retención, `M.facturaNeto(...)`/`M.ivaCredito(...)` para IVA). El texto mostrado no cambia, solo el número.

- [ ] **Step 3: dashboard.js — eliminar el duplicado local y corregir IVA crédito**

Borrar `getBHRetentionRate` local (dashboard.js:1287-1291). En el bloque 1314-1324 reemplazar por:

```js
        payables.forEach(function (p) {
            var dt = (p.docType || '').toLowerCase();
            var mk = toMonthKey(p.billingDate || p.eventDate);
            if (!mk || !data[mk]) return;
            if (dt === 'factura') {
                data[mk].ivaCredito += window.Mazelab.Money.ivaCredito(Number(p.amount) || 0);
            } else if (dt === 'bh') {
                data[mk].retencionBH += window.Mazelab.Money.bhRetencion(Number(p.amount) || 0, p.billingDate || p.eventDate);
            }
        });
```

(La línea 1311 de IVA débito queda igual: `invoicedAmount` es neto, `× 0.19` es correcto ahí.)

- [ ] **Step 4: Verificar**

1. `node tests/money.test.js` → verde.
2. `grep -n "0.145\|0.1525\|\* rate" src/modules/payables/payables.js src/modules/dashboard/dashboard.js` → no deben quedar fórmulas locales (solo llamadas a Money).
3. Abrir `index.html` local, ir a CXP, crear BH de prueba con monto 1.000.000 y fecha 2026 → el detalle debe decir Retención 15,25%: $179.941 · Costo total: $1.179.941.

- [ ] **Step 5: Commit**

```bash
git add src/modules/payables/payables.js src/modules/dashboard/dashboard.js
git commit -m "fix: retencion BH sobre bruto con tabla SII por anio + IVA credito correcto en dashboard"
```

---

## Task 3: finance.js — NC/incidencia sin doble descuento + regla del día 20

**Files:**
- Modify: `src/modules/finance/finance.js:58-65, 67-94 (isIvaPaid), 96-108 (getPendienteMio), 372-375 (classifyData), 666-672 y 741-746 (tabla), 152-191 (getRealTimeStatus)`

Contexto del bug (verificado): al crear una NC, `openNCModal` crea el registro NC **y** suma a `sale.refundAmount` (finance.js:2373-2383). Después `getPendienteFacturado` (58-65) y `classifyData` (372-375) restan `_ncOffset` **y** `_refundAmount` juntos → doble descuento. Las celdas de tabla (666-672, 741-746) restan solo refund → tercer criterio distinto.

**Regla nueva (separación de libros):** filas FACTURADAS descuentan solo `_ncOffset`; filas SIN FACTURA descuentan solo `_refundAmount`.

- [ ] **Step 1: Reescribir `getPendienteFacturado` (58-65)**

```js
    function getPendienteFacturado(r) {
        // Solo la NC descuenta en filas facturadas (la incidencia vive en la venta / fila sin factura)
        return window.Mazelab.Money.pendienteFacturadoRow({
            tipoDoc: r.tipoDoc,
            facturadoNeto: getMontoFacturado(r),
            ncNeto: r._ncOffset || 0,
            pagado: getTotalPagado(r)
        });
    }
```

- [ ] **Step 2: `classifyData` (372-375)** — mismo criterio. Reemplazar el cálculo de `montoTotal` para que use `Money.pendienteFacturadoRow` en filas facturadas y `Money.pendienteSinFacturaRow({neto: getMonto(r), refundNeto: r._refundAmount, pagado: getTotalPagado(r)})` en filas sin factura. Leer el bloque completo antes de editar (la función clasifica ambos tipos).

- [ ] **Step 3: Celdas de tabla (666-672 y 741-746)** — reemplazar el cálculo manual por las mismas funciones Money para que tabla y KPIs muestren EXACTAMENTE el mismo número. La nota "(Dev: -X)" solo debe aparecer en filas sin factura; en filas facturadas mostrar "(NC: -X)" cuando `_ncOffset > 0`.

- [ ] **Step 4: `isIvaPaid` (67-94)** — conservar el parsing de `billingMonth` pero delegar la comparación final:

```js
        // (tras extraer year y month 1-12 del billingMonth, como ya hace)
        return window.Mazelab.Money.ivaDeclarado(year, month, new Date());
```

Esto además corrige el borde del día 20 (hasta el 20 inclusive el IVA NO es tuyo; desde el 21 sí).

- [ ] **Step 5: `getPendienteMio` (96-108)** — reescribir delegando:

```js
    function getPendienteMio(r) {
        return window.Mazelab.Money.mioRow({
            tipoDoc: r.tipoDoc,
            tieneFactura: !!(r.invoiceNumber || getMontoFacturado(r) > 0),
            neto: getMonto(r),
            facturadoNeto: getMontoFacturado(r),
            ncNeto: r._ncOffset || 0,
            refundNeto: r._refundAmount || 0,
            pagado: getTotalPagado(r),
            ivaDeclarado: isIvaPaid(r.billingMonth)
        });
    }
```

- [ ] **Step 6: NC con status vacío** — en `getRealTimeStatus` (152-191) ya se resuelve por `tipoDoc === 'NC'` (línea 154). Añadir además: al crear la NC en `openNCModal` (línea 2367) el status ya es `'nc'` — cambiarlo a `'nc_aplicada'` y aceptar ambos como sinónimos donde se filtre por `'nc'` (`grep -n "'nc'" src/modules/finance/finance.js` y revisar cada sitio).

- [ ] **Step 7: Verificar**

1. `node tests/money.test.js` verde.
2. Trazado manual del caso Aldo: F5 neto 1.500.000, NC 200.000 → en la tabla y en el KPI el pendiente debe ser $1.547.000 (no $1.309.000, que sería el doble descuento).
3. Abrir la app local, crear venta+factura+NC de prueba y verificar el número en ambos lugares.

- [ ] **Step 8: Commit**

```bash
git add src/modules/finance/finance.js
git commit -m "fix: NC descuenta una sola vez (separacion NC/incidencia) + regla dia 20 en Lo que es mio"
```

---

## Task 4: "+ Nueva Factura" con la misma semántica que "Facturar"

**Files:**
- Modify: `src/modules/finance/finance.js:1848-1992 (openNuevaFacturaModal)`, `2093-2161 (openFacturarModal save)`

- [ ] **Step 1: Extraer la lógica compartida del guardado de `openFacturarModal` (2109-2156) a una función**

```js
    // Crea la CXC de la factura y reduce/cierra la fila residual sin_factura.
    // rec: fila residual (puede ser null si la venta no tiene residual);
    // sale: venta vinculada (puede ser null); datos: {invoicedAmount, invoiceNumber, billingMonth, paymentTerms, tipoDoc}
    async function crearFacturaYCerrarResidual(rec, sale, datos) {
        var DS = window.Mazelab.DataService;
        var linkedSaleId = (rec && rec.saleId) || (sale && sale.id) || null;
        var srcId = (rec && rec.sourceId) || (sale && sale.sourceId) || '';
        var newRec = {
            id:             window.Mazelab.Storage.generateId(),
            eventName:      (rec && rec.eventName)  || (sale && sale.eventName)  || '',
            eventDate:      (rec && rec.eventDate)  || (sale && sale.eventDate)  || '',
            clientName:     (rec && rec.clientName) || (sale && sale.clientName) || '',
            montoNeto:      datos.invoicedAmount,
            invoicedAmount: datos.invoicedAmount,
            monto_venta:    datos.invoicedAmount,
            invoiceNumber:  datos.invoiceNumber,
            billingMonth:   datos.billingMonth,
            paymentTerms:   datos.paymentTerms,
            tipoDoc:        datos.tipoDoc,
            status:         'pendiente_pago',
            saleId:         linkedSaleId,
            sourceId:       srcId,
            sourceType:     'factura',
            payments:       []
        };
        if (rec) {
            if (rec.avisos_factura && rec.avisos_factura.length) newRec.avisos_factura = rec.avisos_factura;
            if (rec.notas_cobranza && rec.notas_cobranza.length) newRec.notas_cobranza = rec.notas_cobranza;
            if (rec.cobros && rec.cobros.length) newRec.cobros = rec.cobros;
        }
        await DS.create('receivables', newRec);

        if (rec) {
            var netoTotal = getMonto(rec);
            var netoRestante = netoTotal - datos.invoicedAmount;
            if (netoRestante <= 0) {
                await DS.remove('receivables', rec.id);
            } else {
                await DS.update('receivables', rec.id, {
                    monto_venta:    netoRestante,
                    montoNeto:      netoRestante,
                    invoicedAmount: 0,   // la residual NO tiene factura — antes escribía netoRestante (bug)
                    amount:         netoRestante,
                    status:         'sin_factura'
                });
            }
        }
        return newRec;
    }
```

- [ ] **Step 2: `openFacturarModal` guarda vía la función compartida** (mantener su validación `invoicedAmount > netoTotal` previa).

- [ ] **Step 3: `openNuevaFacturaModal` (1957-1991)** — reemplazar el `DataService.create` directo: al guardar, buscar la fila residual `sin_factura` de la venta seleccionada (`allReceivables.filter(r → r.saleId/sourceId coincide con la venta && status sin_factura/pendiente_factura)`) y llamar `crearFacturaYCerrarResidual(residual || null, sale, datos)`. Si la factura supera el neto residual, permitir con `confirm()` explicando que la fila pendiente se cerrará completa.

- [ ] **Step 4: Verificar — los flujos hermanos deben terminar en el MISMO estado**

Con datos de prueba locales: venta de 1.000.000 → (a) camino "Facturar" por 600.000; (b) reset, camino "+ Nueva Factura" por 600.000 sobre la misma venta. En ambos: debe existir 1 CXC factura de 600.000 con `sourceId` poblado, y 1 residual `sin_factura` de 400.000 con `invoicedAmount: 0`. Documentar la traza en el reporte.

- [ ] **Step 5: Commit**

```bash
git add src/modules/finance/finance.js
git commit -m "fix: + Nueva Factura cierra/reduce la fila pendiente y guarda sourceId igual que Facturar"
```

---

## Task 5: sales.js — orden de populateDropdowns, columna ID, CXC fantasma

**Files:**
- Modify: `src/modules/sales/sales.js:178, 635-795 (openModal), 866-896`

- [ ] **Step 1: Fix del orden en `openModal`** — hoy `populateDropdowns()` (línea 755, tras `overlay.classList.add('active')` en 752) destruye vendedor y checkboxes poblados antes (669-708). Reestructurar: mover TODO el bloque de población de valores (comisión 667, vendedor 669-678, incidencia 683-686, checkboxes 688-708 y cualquier otro campo que dependa de los dropdowns) a DESPUÉS de `populateDropdowns()`. El orden final: abrir overlay → `populateDropdowns()` → poblar valores. Verificar que ningún campo poblado quede antes de la reconstrucción del DOM.

- [ ] **Step 2: Columna ID (línea 178)**:

```js
            const displayId = sale.sourceId || sale.id || '';
```

- [ ] **Step 3: CXC fantasma (866-896)** — antes de crear la CXC nueva (bloque 882-896), agregar un match de último recurso por identidad de evento para no duplicar cuando los IDs no calzan:

```js
                if (linkedCXCs.length === 0) {
                    var fuzzy = allReceivables.filter(function (r) {
                        return r.tipoDoc !== 'NC' &&
                               (r.eventName || '') === (data.eventName || '') &&
                               (r.clientName || '') === (data.clientName || '') &&
                               (r.eventDate || '') === (data.eventDate || '');
                    });
                    if (fuzzy.length > 0) linkedCXCs = fuzzy;
                }
                if (linkedCXCs.length === 0 && data.amount > 0) {
                    // ... (creación existente, sin cambios)
```

- [ ] **Step 4: Verificar en navegador**

1. Editar una venta existente que tenga servicios + vendedor + comisión → guardar SIN tocar nada → volver a abrir: los tres deben seguir. (Antes del fix: servicios y vendedor se borraban.)
2. Editar una venta importada con `sourceId` vacío → guardar → NO debe aparecer una nueva fila `sin_factura` en CXC.
3. La columna ID nunca queda en blanco.

- [ ] **Step 5: Commit**

```bash
git add src/modules/sales/sales.js
git commit -m "fix: editar venta preserva servicios/vendedor (orden populateDropdowns) + ID visible + sin CXC fantasma"
```

---

## Task 6: Persistencia honesta — errores visibles, sin fallback silencioso, sin datos demo

**Files:**
- Modify: `src/shared/supabase.js:18-28 (fetchAll), 43-56 (update), 58-67 (remove)`
- Modify: `src/shared/data-service.js:76-96 (getAll), init/testConnection (leer archivo completo, 165 líneas)`
- Modify: `index.html:133` (quitar demo-data)
- Delete: `src/shared/demo-data.js`

- [ ] **Step 1: `supabase.js` — update y remove LANZAN en vez de tragarse el error** (mismo patrón que `insert`, 30-41):

```js
    async function update(table, id, updates) {
        const res = await fetch(BASE + '/' + table + '/' + id, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
        if (!res.ok) {
            const errText = await res.text().catch(function () { return String(res.status); });
            throw new Error('Error al actualizar en ' + table + ' (HTTP ' + res.status + '): ' + errText);
        }
        return await res.json();
    }
```

(leer las líneas 43-56 actuales para conservar URL/headers exactos; ídem `remove`.)

- [ ] **Step 2: `fetchAll` distingue error de vacío** — en error debe LANZAR, no devolver `[]`. Y en `data-service.js:87` cambiar `if (data && data.length > 0) result = data;` por `result = data;` — un array vacío del servidor ES la verdad, no una señal para caer a localStorage.

- [ ] **Step 3: Modo solo lectura** — en `data-service.js`: leer cómo se setea `useSupabase` (testConnection al init). Si la conexión falla al iniciar o un `fetchAll` lanza: fijar `window.Mazelab.DataService.readOnly = true` y mostrar banner bloqueante (creado en Task 7). Mientras `readOnly === true`, `create/update/remove` lanzan `Error('Sin conexión con la base de datos — modo solo lectura')` en vez de escribir en localStorage. **Eliminar todo camino donde `useSupabase === true` termine escribiendo en localStorage.**

- [ ] **Step 4: Datos demo** — borrar `src/shared/demo-data.js` y su `<script>` en `index.html:133`. Verificar con grep que nada más referencia `demo-data` ni depende del seed de 47 servicios.

- [ ] **Step 5: Verificar**

1. Con servidor OK: crear/editar registros → todo normal.
2. Simular caída (cambiar BASE a URL inválida temporalmente): la app debe mostrar el banner bloqueante, y cualquier intento de guardar debe fallar con mensaje visible — y NO escribir en localStorage.
3. localStorage limpio + servidor OK → la app NO siembra datos demo.

- [ ] **Step 6: Commit**

```bash
git add src/shared/supabase.js src/shared/data-service.js index.html
git rm src/shared/demo-data.js
git commit -m "fix: errores de persistencia visibles, sin fallback silencioso a localStorage, fuera datos demo"
```

---

## Task 7: Feedback de guardado — toast compartido + banner offline

**Files:**
- Create: `src/shared/ui-feedback.js`
- Modify: `index.html` (script tag tras `money.js`)
- Modify: call sites de guardado en `sales.js`, `finance.js`, `payables.js`

- [ ] **Step 1: Crear `src/shared/ui-feedback.js`** (generalizar el toast privado de `nominas.js:814-825`):

```js
// Feedback visual compartido: toast de éxito/error + banner de sin conexión.
(function () {
    window.Mazelab = window.Mazelab || {};

    function toast(message, type) {
        var el = document.createElement('div');
        var bg = type === 'error' ? 'var(--danger, #c0392b)' : 'var(--success, #27ae60)';
        el.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;background:' + bg +
            ';color:#fff;border-radius:10px;padding:14px 20px;max-width:340px;box-shadow:0 4px 20px rgba(0,0,0,.25);font-size:14px';
        el.textContent = message;
        document.body.appendChild(el);
        setTimeout(function () { el.style.transition = 'opacity .4s'; el.style.opacity = '0'; }, 3200);
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 3700);
    }

    function showOfflineBanner() {
        if (document.getElementById('mz-offline-banner')) return;
        var b = document.createElement('div');
        b.id = 'mz-offline-banner';
        b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:10000;background:var(--danger,#c0392b);color:#fff;' +
            'padding:10px 16px;text-align:center;font-size:14px;font-weight:600';
        b.textContent = 'Sin conexión con la base de datos — modo solo lectura. Los cambios NO se guardarán.';
        document.body.appendChild(b);
    }

    window.Mazelab.UI = { toast: toast, showOfflineBanner: showOfflineBanner };
})();
```

- [ ] **Step 2: Wire en los guardados principales** — patrón en cada flujo (venta, factura, NC, abono, costo):

```js
try {
    await DS.update('sales', editingId, data);
    window.Mazelab.UI.toast('Guardado en la base de datos');
} catch (err) {
    window.Mazelab.UI.toast('ERROR: no se guardó — ' + err.message, 'error');
    return; // no cerrar el modal ni refrescar como si hubiera funcionado
}
```

Call sites mínimos: `sales.js` guardado (866-867 y creación ~985), `finance.js` modales (nf-save 1957, facturar 2093, NC 2353, abonos), `payables.js` guardado del modal. `data-service.js` invoca `showOfflineBanner()` cuando entra en `readOnly`.

- [ ] **Step 3: Verificar** — guardar una venta con servidor OK → toast verde. Con servidor caído → toast rojo + modal abierto (los datos del formulario no se pierden).

- [ ] **Step 4: Commit**

```bash
git add src/shared/ui-feedback.js index.html src/modules/sales/sales.js src/modules/finance/finance.js src/modules/payables/payables.js
git commit -m "feat: toast de guardado + banner offline bloqueante"
```

---

## Task 8: Comisiones del dashboard — utilidad × % × proporción cobrada

**Files:**
- Modify: `src/modules/dashboard/dashboard.js:810-872 (buildCommissionCard)` y la carga de datos del dashboard (agregar staff y payables si no están)

Contexto (verificado): hoy calcula `% × venta bruta`, ignora costos y cobros, y agrupa por `s.staffName` que nunca se guarda (las ventas guardan `staffId`, sales.js:850) → todo cae en "Sin asignar".

- [ ] **Step 1: Resolver el nombre del ejecutivo** — cargar el catálogo staff en el dashboard y mapear `staffId → nombre`; fallback a `staffName/ejecutivo/vendedor` para registros importados.

- [ ] **Step 2: Calcular comisión por venta según la regla**:

```js
        // Por venta: utilidad = venta neta − Σ costo empresa de los costos del evento;
        // proporción cobrada = Σ cobrado neto en CXC vinculadas / venta neta.
        var M = window.Mazelab.Money;
        sales.forEach(function (s) {
            var pct = Number(s.comisionPct || 0);
            if (pct <= 0) return;
            var ed = s.eventDate || s.event_date || '';
            if (!ed || new Date(ed).getFullYear() !== thisYear) return;

            var ventaNeta = Number(s.amount || s.monto_venta || 0);

            var costos = payables.filter(function (p) {
                return String(p.eventId || '') === String(s.id) || String(p.eventId || '') === String(s.sourceId || '__none__');
            });
            var costoTotal = costos.reduce(function (sum, p) {
                return sum + M.costoEmpresaItem(p.docType, p.amount, p.billingDate || p.eventDate);
            }, 0);
            var utilidad = ventaNeta - costoTotal;

            var cxcs = receivables.filter(function (r) {
                var sid = String(s.id), ssid = String(s.sourceId || '__none__');
                return [String(r.saleId || ''), String(r.eventId || ''), String(r.sourceId || '')].some(function (k) {
                    return k === sid || k === ssid;
                });
            });
            var cobradoNeto = cxcs.reduce(function (sum, r) {
                if (r.tipoDoc === 'NC') return sum;
                var pagado = getTotalPagadoR(r);   // helper local: payments[] o amountPaid
                return sum + (r.tipoDoc === 'E' ? pagado : Math.round(pagado / 1.19));
            }, 0);

            var comm = M.comisionDevengada(pct, utilidad, cobradoNeto, ventaNeta);
            // ... acumular en commByExec con el nombre resuelto por staffId
        });
```

(Adaptar nombres de variables al código real del bloque 816-830; `receivables` y `payables` deben estar disponibles en `buildCommissionCard` — revisar la firma con que se invoca en dashboard.js:805-807 y pasarlos si falta.)

- [ ] **Step 3: Etiquetar la tarjeta** — subtítulo: "Comisión devengada por cobro (% × utilidad × proporción cobrada)". Mantener visible el % por venta que ingresó la vendedora.

- [ ] **Step 4: Verificar** — caso de control: venta 1.000.000 neto, pct 10, costos evento 400.000 (efectivo), CXC pagada 595.000 (con IVA) → cobradoNeto 500.000 → comisión = 10% × 600.000 × 0,5 = $30.000. Montar el caso con datos de prueba locales y confirmar el número en la tarjeta.

- [ ] **Step 5: Commit**

```bash
git add src/modules/dashboard/dashboard.js
git commit -m "feat: comisiones sobre utilidad proporcional al cobro, atribuidas por staffId"
```

---

## Task 9: import.js usa parseAmountCL + verificación E2E final

**Files:**
- Modify: `src/modules/import/import.js:70-84`
- Verificar (sin modificar): `src/shared/auth.js:40` (import ya restringido a superadmin)

- [ ] **Step 1: `parseAmount` delega**:

```js
    function parseAmount(val) {
        return window.Mazelab.Money.parseAmountCL(val);
    }
```

- [ ] **Step 2: Verificación E2E completa (checklist de cierre del sprint)**

1. `node tests/money.test.js` → verde.
2. Flujos hermanos "Facturar" vs "+ Nueva Factura" → estado final idéntico (traza documentada).
3. Editar venta 3 veces seguidas → servicios/vendedor/comisión intactos.
4. Caso NC de Aldo (F 1.500.000 + NC 200.000) → $1.547.000 en tabla y KPI.
5. BH 1.000.000 en 2026 → retención $179.941 en CXP, KPIs y dashboard.
6. "Lo que es mío" con factura del mes pasado: antes del 21 solo neto, después total (simular cambiando la fecha del sistema o con un registro de junio).
7. Servidor caído → banner + solo lectura + nada escrito en localStorage.
8. localStorage limpio → cero datos demo.
9. Importador: visible solo como superadmin (login con rol operaciones NO lo ve).

- [ ] **Step 3: Commit final**

```bash
git add src/modules/import/import.js
git commit -m "fix: parser de montos chilenos maneja punto de miles unico"
```

---

## Self-review del plan (hecho)

- Cobertura del spec: A1→Task 4, A2/A3→Task 5, B1/B2→Tasks 1-2, B3→Task 3, B4→Tasks 1+9, B5→Task 3, B6→Task 3, B7→Task 8, C1→Tasks 6-7, C2→Tasks 6-7, C3→Task 6, D1→Task 5, D2→Task 9 (verificación), D3→Task 1.
- Los números de línea provienen de un reconocimiento verificado contra HEAD `610e883`; si el archivo cambió, buscar el ancla textual citada.
- Nota para el ejecutor: NO hay framework de tests previo ni package.json — `node tests/money.test.js` corre directo (CommonJS).
