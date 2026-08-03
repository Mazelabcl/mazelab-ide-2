#!/usr/bin/env node
// Banco de experimentos E2E — Tanda 2 (rama feature/e2e-bank).
//
// Escenarios "senior" pedidos por el dueño: borrados por estado, el caso
// histórico del "zombie" de CXC, facturar->borrar->re-facturar, y las
// permutaciones de incidencia/NC vs facturación. Mismo estilo que
// tests/e2e/experiments.e2e.js: prefijo E2E-TEST-, verificación numérica por
// API con la SERVICE KEY (bypass RLS) recalculando con src/shared/money.js,
// cleanup en finally por experimento + cleanup-e2e-data.js como red de
// seguridad al final.
//
// Todos los helpers de login/navegación/CRUD por UI se REUTILIZAN desde
// experiments.e2e.js (module.exports) en vez de reimplementarse — mismo
// selector, mismo comportamiento probado, una sola fuente de verdad.
//
// Clasificación de hallazgos (ver reporte, no codificada aquí como pass/fail
// salvo cuando la propia consistencia aritmética es lo que se prueba):
//   BUG      — comportamiento roto (la app no hace lo que su propio código dice que debe hacer, o rompe una invariante financiera).
//   DISEÑO   — funciona tal como está programado, pero la regla de negocio no está definida / es discutible — para decisión del dueño.
//   CENSO    — comportamiento documentado con números reales, sin juicio de valor.
//
// Uso:
//   node tests/e2e/tanda2.e2e.js
//   EXPERIMENTS=T2-1,T2-2 node tests/e2e/tanda2.e2e.js
'use strict';

const path = require('path');
const { chromium } = require('playwright');

const EXP = require('./experiments.e2e.js');
const Money = EXP.Money;
const NAV_TIMEOUT = EXP.NAV_TIMEOUT;
const tag = EXP.tag;
const fmtCLP = EXP.fmtCLP;
const todayISO = EXP.todayISO;
const findVentaByEventName = EXP.findVentaByEventName;
const findFacturasBySaleId = EXP.findFacturasBySaleId;
const findCostosByEventId = EXP.findCostosByEventId;
const findVentaById = EXP.findVentaById;
const deleteRows = EXP.deleteRows;
const newLoggedInPage = EXP.newLoggedInPage;
const gotoRoute = EXP.gotoRoute;
const readKpiCards = EXP.readKpiCards;
const findCard = EXP.findCard;
const createSaleViaUI = EXP.createSaleViaUI;
const editSaleViaUI = EXP.editSaleViaUI;
const salesSearch = EXP.salesSearch;
const financeSearch = EXP.financeSearch;
const clickFacturar = EXP.clickFacturar;
const clickNuevaFactura = EXP.clickNuevaFactura;
const clickNC = EXP.clickNC;
const clickAbono = EXP.clickAbono;
const runExperiment = EXP.runExperiment;

let admin;

// =============================================================================
// HELPERS NUEVOS DE TANDA 2 (borrar factura/venta desde la UI, facturar por
// encima del pendiente para observar el guard) — no existían en el catálogo
// core porque ningún experimento A-J borraba una CXC individual ni una venta
// completa desde la UI.
// =============================================================================
async function clickDeleteFacturaCXC(page, facturaId) {
    const btn = page.locator('.btn-eliminar[data-id="' + facturaId + '"]');
    await btn.waitFor({ timeout: NAV_TIMEOUT });
    let dialogMsg = null;
    page.once('dialog', function (d) { dialogMsg = d.message(); d.accept(); });
    await btn.click();
    await page.waitForTimeout(900);
    return dialogMsg;
}

async function clickDeleteSale(page, ventaId) {
    const btn = page.locator('.btn-delete-sale[data-id="' + ventaId + '"]');
    await btn.waitFor({ timeout: NAV_TIMEOUT });
    let dialogMsg = null;
    page.once('dialog', function (d) { dialogMsg = d.message(); d.accept(); });
    await btn.click();
    await page.waitForTimeout(900);
    return dialogMsg;
}

// Lee el monto pre-llenado del modal "Registrar Factura" (#fac-amount) sin
// guardar — sirve para comprobar si la UI sugiere el monto crudo (venta) o
// el descontado por incidencia (venta - incidencia) al facturar.
async function readFacturarPrefill(page, facturaId) {
    const btn = page.locator('.btn-facturar[data-id="' + facturaId + '"]');
    await btn.waitFor({ timeout: NAV_TIMEOUT });
    await btn.click();
    await page.waitForSelector('#fac-amount', { timeout: NAV_TIMEOUT });
    const prefill = await page.inputValue('#fac-amount');
    await page.click('#fac-cancel-btn');
    await page.waitForTimeout(300);
    return Number(prefill) || 0;
}

// Intenta facturar por ENCIMA del neto pendiente vía el botón "Facturar"
// (no "+ Nueva Factura" — ese usa un confirm() distinto). openFacturarModal
// hace `alert(...); return;` sin guardar si invoicedAmount > netoTotal —
// se captura el diálogo y se confirma que el modal sigue abierto (no hubo
// guardado).
async function attemptFacturarOverLimit(page, facturaId, data) {
    const btn = page.locator('.btn-facturar[data-id="' + facturaId + '"]');
    await btn.waitFor({ timeout: NAV_TIMEOUT });
    await btn.click();
    await page.waitForSelector('#fac-save-btn', { timeout: NAV_TIMEOUT });
    await page.fill('#fac-number', data.number);
    await page.fill('#fac-amount', String(data.amount));
    if (data.tipo) await page.selectOption('#fac-tipo', data.tipo);
    let dialogMsg = null;
    page.once('dialog', function (d) { dialogMsg = d.message(); d.accept(); });
    await page.click('#fac-save-btn');
    await page.waitForTimeout(500);
    const modalStillOpen = await page.locator('#facturar-modal-overlay').count();
    if (modalStillOpen > 0) await page.click('#fac-cancel-btn').catch(function () {});
    await page.waitForTimeout(300);
    return { dialogMsg: dialogMsg, modalStillOpenAfterAlert: modalStillOpen > 0 };
}

async function cleanupVenta(venta) {
    if (!venta) return;
    const leftoverF = await findFacturasBySaleId(venta.id).catch(function () { return []; });
    const leftoverC = await findCostosByEventId(venta.id).catch(function () { return []; });
    await deleteRows('facturas', leftoverF.map(function (f) { return f.id; }));
    await deleteRows('costos', leftoverC.map(function (c) { return c.id; }));
    await deleteRows('ventas', [venta.id]);
}

// =============================================================================
// T2-1 — Borrar venta por estado
// =============================================================================
async function expT2_1a(browser) {
    return runExperiment('T2-1a', 'Borrar venta SIN factura', async function (ctx) {
        const eventName = tag('T2-1a-evento');
        const clientName = tag('T2-1a-cliente');
        const AMOUNT = 500000;
        const { context, page } = await newLoggedInPage(browser, 'superadmin');
        let venta = null;
        try {
            // Baseline ANTES de crear nada — la venta debe volver a este mismo
            // número tras crearla y borrarla, no al número medido después de
            // crearla (ese ya incluye la venta y compararía "con venta" contra
            // "sin venta", una diferencia esperada de $AMOUNT, no un hallazgo).
            await gotoRoute(page, 'dashboard', '.kpi-value');
            const kpisBaseline = await readKpiCards(page);
            const cxcBefore = EXP.parseCLP((findCard(kpisBaseline, 'Por Cobrar (CXC)') || {}).value);
            const ventasBefore = EXP.parseCLP((findCard(kpisBaseline, 'Ventas Totales') || {}).value);

            venta = await createSaleViaUI(page, { eventName: eventName, clientName: clientName, amount: AMOUNT, eventDate: todayISO() });
            const before = await findFacturasBySaleId(venta.id);
            ctx.check('setup: la venta nace con 1 CXC residual sin_factura', before.length === 1 && before[0].status === 'sin_factura',
                'facturas=' + JSON.stringify(before.map(function (f) { return { id: f.id, status: f.status }; })));

            await salesSearch(page, eventName);
            const dialogMsg = await clickDeleteSale(page, venta.id);
            ctx.check('el diálogo de confirmación de borrado apareció y se aceptó', !!dialogMsg && dialogMsg.indexOf('eliminar este evento') !== -1, 'dialogo=' + JSON.stringify(dialogMsg));

            const ventaAfter = await findVentaById(venta.id);
            ctx.check('la venta ya no existe en la base', !ventaAfter);
            const facturasAfter = await findFacturasBySaleId(venta.id);
            ctx.check('la CXC residual desaparece junto con la venta', facturasAfter.length === 0, 'quedan=' + facturasAfter.length);

            await page.reload({ waitUntil: 'load' });
            await page.waitForSelector('#login-screen', { state: 'detached', timeout: NAV_TIMEOUT }).catch(function () {});
            await gotoRoute(page, 'dashboard', '.kpi-value');
            const kpisAfter = await readKpiCards(page);
            const cxcAfter = EXP.parseCLP((findCard(kpisAfter, 'Por Cobrar (CXC)') || {}).value);
            const ventasAfter = EXP.parseCLP((findCard(kpisAfter, 'Ventas Totales') || {}).value);
            ctx.check('KPI "Por Cobrar (CXC)" vuelve exacto al valor previo a crear la venta', cxcAfter === cxcBefore, 'antes=' + fmtCLP(cxcBefore) + ' despues=' + fmtCLP(cxcAfter));
            ctx.check('KPI "Ventas Totales" vuelve exacto al valor previo a crear la venta', ventasAfter === ventasBefore, 'antes=' + fmtCLP(ventasBefore) + ' despues=' + fmtCLP(ventasAfter));
            venta = null;
        } catch (e) {
            await ctx.screenshot(page, 'excepcion');
            throw e;
        } finally {
            await cleanupVenta(venta);
            await context.close();
        }
    });
}

async function expT2_1b(browser) {
    return runExperiment('T2-1b', 'Borrar venta FACTURADA (parcial) como superadmin', async function (ctx) {
        const eventName = tag('T2-1b-evento');
        const clientName = tag('T2-1b-cliente');
        const AMOUNT = 1000000;
        const { context, page } = await newLoggedInPage(browser, 'superadmin');
        let venta = null;
        try {
            // Baseline ANTES de crear nada (mismo motivo que T2-1a).
            await gotoRoute(page, 'dashboard', '.kpi-value');
            const kpisBaseline = await readKpiCards(page);
            const cxcBefore = EXP.parseCLP((findCard(kpisBaseline, 'Por Cobrar (CXC)') || {}).value);
            const ventasBefore = EXP.parseCLP((findCard(kpisBaseline, 'Ventas Totales') || {}).value);

            venta = await createSaleViaUI(page, { eventName: eventName, clientName: clientName, amount: AMOUNT, eventDate: todayISO() });
            const facturasInit = await findFacturasBySaleId(venta.id);
            const residual = facturasInit.find(function (f) { return f.status === 'sin_factura'; });
            await financeSearch(page, eventName);
            const invoiceNumber = tag('T2-1b-F');
            await clickFacturar(page, residual.id, { number: invoiceNumber, amount: 600000, tipo: 'F' });

            const facturasBeforeDelete = await findFacturasBySaleId(venta.id);
            ctx.check('setup: quedan 2 filas CXC (residual $400k + factura $600k) antes de borrar', facturasBeforeDelete.length === 2,
                'facturas=' + JSON.stringify(facturasBeforeDelete.map(function (f) { return { status: f.status, monto: f.montoNeto }; })));

            await salesSearch(page, eventName);
            const dialogMsg = await clickDeleteSale(page, venta.id);
            ctx.check('(superadmin) el borrado de la venta facturada parcialmente se confirmó sin bloqueo de rol', !!dialogMsg, 'dialogo=' + JSON.stringify(dialogMsg));

            const ventaAfter = await findVentaById(venta.id);
            ctx.check('la venta ya no existe', !ventaAfter);
            const facturasAfter = await findFacturasBySaleId(venta.id);
            ctx.check('factura ($600k) y residual ($400k) desaparecen ambos', facturasAfter.length === 0, 'quedan=' + facturasAfter.length);

            await page.reload({ waitUntil: 'load' });
            await page.waitForSelector('#login-screen', { state: 'detached', timeout: NAV_TIMEOUT }).catch(function () {});
            await gotoRoute(page, 'dashboard', '.kpi-value');
            const kpisAfter = await readKpiCards(page);
            const cxcAfter = EXP.parseCLP((findCard(kpisAfter, 'Por Cobrar (CXC)') || {}).value);
            const ventasAfter = EXP.parseCLP((findCard(kpisAfter, 'Ventas Totales') || {}).value);
            ctx.check('KPI "Por Cobrar (CXC)" vuelve exacto (factura + residual, ambos borrados)', cxcAfter === cxcBefore, 'antes=' + fmtCLP(cxcBefore) + ' despues=' + fmtCLP(cxcAfter));
            ctx.check('KPI "Ventas Totales" vuelve exacto', ventasAfter === ventasBefore, 'antes=' + fmtCLP(ventasBefore) + ' despues=' + fmtCLP(ventasAfter));
            venta = null;
        } catch (e) {
            await ctx.screenshot(page, 'excepcion');
            throw e;
        } finally {
            await cleanupVenta(venta);
            await context.close();
        }
    });
}

async function expT2_1c(browser) {
    return runExperiment('T2-1c', 'Borrar venta con factura PAGADA (abono total) — hallazgo', async function (ctx) {
        const eventName = tag('T2-1c-evento');
        const clientName = tag('T2-1c-cliente');
        const AMOUNT = 1000000;
        const { context, page } = await newLoggedInPage(browser, 'superadmin');
        let venta = null;
        try {
            // Baseline de "Ventas Totales" ANTES de crear nada (mismo motivo que T2-1a).
            await gotoRoute(page, 'dashboard', '.kpi-value');
            const kpisBaseline = await readKpiCards(page);
            const ventasBefore = EXP.parseCLP((findCard(kpisBaseline, 'Ventas Totales') || {}).value);

            venta = await createSaleViaUI(page, { eventName: eventName, clientName: clientName, amount: AMOUNT, eventDate: todayISO() });
            const facturasInit = await findFacturasBySaleId(venta.id);
            const residual = facturasInit.find(function (f) { return f.status === 'sin_factura'; });
            await financeSearch(page, eventName);
            const invoiceNumber = tag('T2-1c-F');
            await clickFacturar(page, residual.id, { number: invoiceNumber, amount: AMOUNT, tipo: 'F' });

            const facturas1 = await findFacturasBySaleId(venta.id);
            const factura = facturas1.find(function (f) { return f.tipoDoc === 'F' && f.invoiceNumber === invoiceNumber; });
            if (!factura) throw new Error('no se encontró la factura total para T2-1c');

            const abonoTotal = Math.round(AMOUNT * Money.IVA); // pagado va con IVA (tipoDoc F)
            await financeSearch(page, eventName);
            await clickAbono(page, factura.id, abonoTotal);
            const facturas2 = await findFacturasBySaleId(venta.id);
            const facturaPagada = facturas2.find(function (f) { return f.id === factura.id; });
            const pendienteFinal = Money.pendienteFacturadoRow({ tipoDoc: facturaPagada.tipoDoc, facturadoNeto: Number(facturaPagada.montoFacturado || facturaPagada.invoicedAmount || facturaPagada.montoNeto || 0), ncNeto: 0, pagado: abonoTotal });
            ctx.check('setup: la factura queda con pendiente $0 (abono total registrado — status real "pagada")', pendienteFinal === 0, 'pendiente=' + fmtCLP(pendienteFinal) + ' status guardado=' + facturaPagada.status);

            // "Pagado Este Mes" (CXC) — mide cobros del mes vía payments[] de CADA fila
            // de "facturas" (finance.js computeKPIs, línea ~498-511). Iteración sobre
            // el array recién leído de la base — si la fila desaparece, su payments[]
            // desaparece con ella, sin importar que el dinero SÍ se cobró.
            await gotoRoute(page, 'finance', '#kpi-sin-factura');
            const finKpisBefore = await readKpiCards(page);
            const pagadoMesBefore = EXP.parseCLP((findCard(finKpisBefore, 'Pagado Este Mes') || {}).value);
            const cxcBefore = EXP.parseCLP((findCard(finKpisBefore, 'TOTAL POR COBRAR') || {}).value);

            await salesSearch(page, eventName);
            const dialogMsg = await clickDeleteSale(page, venta.id);
            ctx.check('(superadmin) borrado de venta con factura pagada se confirmó', !!dialogMsg, 'dialogo=' + JSON.stringify(dialogMsg));

            const ventaAfter = await findVentaById(venta.id);
            const facturasAfter = await findFacturasBySaleId(venta.id);
            ctx.check('venta y factura pagada desaparecen (cascada de sales.js:handleDelete no distingue por estado)', !ventaAfter && facturasAfter.length === 0,
                'venta=' + (ventaAfter ? 'sigue viva' : 'borrada') + ' facturas restantes=' + facturasAfter.length);

            await page.reload({ waitUntil: 'load' });
            await page.waitForSelector('#login-screen', { state: 'detached', timeout: NAV_TIMEOUT }).catch(function () {});
            await gotoRoute(page, 'dashboard', '.kpi-value');
            const dashKpisAfter = await readKpiCards(page);
            const ventasAfter = EXP.parseCLP((findCard(dashKpisAfter, 'Ventas Totales') || {}).value);
            ctx.check('KPI "Ventas Totales" vuelve exacto tras el borrado', ventasAfter === ventasBefore, 'antes=' + fmtCLP(ventasBefore) + ' despues=' + fmtCLP(ventasAfter));

            await gotoRoute(page, 'finance', '#kpi-sin-factura');
            const finKpisAfter = await readKpiCards(page);
            const pagadoMesAfter = EXP.parseCLP((findCard(finKpisAfter, 'Pagado Este Mes') || {}).value);
            const cxcAfter = EXP.parseCLP((findCard(finKpisAfter, 'TOTAL POR COBRAR') || {}).value);
            ctx.check('"TOTAL POR COBRAR" vuelve exacto (la factura pagada ya no sumaba, pendiente=$0)', cxcAfter === cxcBefore, 'antes=' + fmtCLP(cxcBefore) + ' despues=' + fmtCLP(cxcAfter));

            // HALLAZGO (DISEÑO, no BUG — el resultado es mecánicamente consistente con
            // el código: computeKPIs() suma payments[] de las filas que existan HOY en
            // "facturas"; borrar una fila borra su historial de cobros con ella). Se
            // deja como `check` (no knownIssue) porque es un hallazgo NUEVO de esta
            // tanda, no uno ya documentado en el backlog.
            const dropEsperado = pagadoMesBefore - abonoTotal;
            ctx.check(
                'HALLAZGO (DISEÑO): "Pagado Este Mes" BAJA exactamente el monto del abono borrado (' + fmtCLP(abonoTotal) + ') aunque el dinero SÍ se cobró — borrar una venta paga borra también su historial de cobros del mes',
                pagadoMesAfter === dropEsperado,
                'antes=' + fmtCLP(pagadoMesBefore) + ' despues=' + fmtCLP(pagadoMesAfter) + ' caida=' + fmtCLP(pagadoMesBefore - pagadoMesAfter) +
                ' (esperado por diseño de cascada=' + fmtCLP(abonoTotal) + ') — el KPI "Pagado Este Mes" no distingue entre "nunca se cobró" y "se cobró pero el registro se borró"; ' +
                'para el dueño esto puede violar la expectativa de que un cobro YA RECIBIDO quede en el histórico del mes pase lo que pase con la venta. Ver reporte final.'
            );
            venta = null;
        } catch (e) {
            await ctx.screenshot(page, 'excepcion');
            throw e;
        } finally {
            await cleanupVenta(venta);
            await context.close();
        }
    });
}

// =============================================================================
// T2-2 — Caza-zombie: borrar residual a mano -> "+ Nueva Factura" -> borrar factura
// =============================================================================
async function expT2_2(browser) {
    return runExperiment('T2-2', 'Caza-zombie (borrar residual a mano + Nueva Factura + borrar factura)', async function (ctx) {
        const eventName = tag('T2-2-evento');
        const clientName = tag('T2-2-cliente');
        const AMOUNT = 800000;
        const { context, page } = await newLoggedInPage(browser, 'superadmin');
        let venta = null;
        try {
            venta = await createSaleViaUI(page, { eventName: eventName, clientName: clientName, amount: AMOUNT, eventDate: todayISO() });
            const step1 = await findFacturasBySaleId(venta.id);
            ctx.check('paso 1 (API): nace con exactamente 1 fila CXC (residual sin_factura)', step1.length === 1 && step1[0].status === 'sin_factura',
                'facturas=' + JSON.stringify(step1.map(function (f) { return { id: f.id, status: f.status }; })));
            const residual = step1[0];

            // Paso 2: borrar la residual A MANO desde la página CXC (no por API) — es
            // el caso histórico real del dueño: un operador limpia manualmente una fila
            // que ya no debería estar, y luego alguien usa "+ Nueva Factura" sobre el
            // mismo evento sin saber que la residual ya no existe.
            await financeSearch(page, eventName);
            const delDialog = await clickDeleteFacturaCXC(page, residual.id);
            ctx.check('paso 2: diálogo de confirmación de borrado de CXC apareció y se aceptó', !!delDialog && delDialog.indexOf('Eliminar este registro') !== -1, 'dialogo=' + JSON.stringify(delDialog));
            const step2 = await findFacturasBySaleId(venta.id);
            ctx.check('paso 2 (API): 0 filas CXC tras borrar la residual a mano', step2.length === 0, 'quedan=' + step2.length);

            // Paso 3: "+ Nueva Factura" sobre el mismo evento, por el monto total.
            await gotoRoute(page, 'finance', '#kpi-sin-factura');
            const invoiceNumber = tag('T2-2-F');
            await clickNuevaFactura(page, { sourceId: venta.sourceId, number: invoiceNumber, amount: AMOUNT, tipo: 'F' });
            const step3 = await findFacturasBySaleId(venta.id);
            const facturaNueva = step3.find(function (f) { return f.tipoDoc === 'F' && f.invoiceNumber === invoiceNumber; });
            const residualZombie = step3.find(function (f) { return f.status === 'sin_factura'; });
            ctx.check('paso 3 (API): "+ Nueva Factura" crea EXACTAMENTE 1 fila (la factura nueva), sin resucitar ni duplicar la residual borrada',
                step3.length === 1 && !!facturaNueva && !residualZombie,
                'facturas=' + JSON.stringify(step3.map(function (f) { return { id: f.id, status: f.status, tipoDoc: f.tipoDoc, monto: f.montoNeto }; })));
            if (!facturaNueva) throw new Error('no se encontró la factura nueva de T2-2 — no se puede continuar al paso 4');

            // Paso 4: borrar esa factura también, desde CXC.
            await financeSearch(page, eventName);
            const delDialog2 = await clickDeleteFacturaCXC(page, facturaNueva.id);
            ctx.check('paso 4: diálogo de confirmación de borrado de la factura apareció y se aceptó', !!delDialog2, 'dialogo=' + JSON.stringify(delDialog2));
            const step4 = await findFacturasBySaleId(venta.id);
            ctx.check('paso 4 (API): 0 filas CXC — nada quedó colgado tras borrar residual + facturar + borrar factura', step4.length === 0, 'quedan=' + step4.length);

            venta = null; // limpio, no queda nada que borrar salvo la venta misma
            await deleteRows('ventas', [(await findVentaByEventName(eventName) || {}).id].filter(Boolean));
        } catch (e) {
            await ctx.screenshot(page, 'excepcion');
            throw e;
        } finally {
            if (venta) await cleanupVenta(venta);
            else {
                const leftover = await findVentaByEventName(eventName).catch(function () { return null; });
                if (leftover) await deleteRows('ventas', [leftover.id]);
            }
            await context.close();
        }
    });
}

// =============================================================================
// T2-3 — Facturar parcial -> borrar esa factura -> ¿se reconstruye el residual?
// =============================================================================
async function expT2_3(browser) {
    return runExperiment('T2-3', 'Facturar -> borrar factura -> re-facturar (¿se reconstruye el residual?)', async function (ctx) {
        const eventName = tag('T2-3-evento');
        const clientName = tag('T2-3-cliente');
        const AMOUNT = 1000000;
        const { context, page } = await newLoggedInPage(browser, 'superadmin');
        let venta = null;
        try {
            venta = await createSaleViaUI(page, { eventName: eventName, clientName: clientName, amount: AMOUNT, eventDate: todayISO() });
            const facturasInit = await findFacturasBySaleId(venta.id);
            const residualInit = facturasInit.find(function (f) { return f.status === 'sin_factura'; });
            await financeSearch(page, eventName);
            const invoiceNumber = tag('T2-3-F');
            await clickFacturar(page, residualInit.id, { number: invoiceNumber, amount: 600000, tipo: 'F' });

            const step1 = await findFacturasBySaleId(venta.id);
            const residual1 = step1.find(function (f) { return f.status === 'sin_factura'; });
            const factura1 = step1.find(function (f) { return f.tipoDoc === 'F' && f.invoiceNumber === invoiceNumber; });
            const sumaInicial = (residual1 ? Number(residual1.montoNeto || 0) : 0) + (factura1 ? Number(factura1.montoNeto || 0) : 0);
            ctx.check('paso 1 (API): residual $400k + factura $600k, suma = venta ($1.000.000)', sumaInicial === AMOUNT,
                'residual=' + fmtCLP(residual1 ? residual1.montoNeto : 0) + ' factura=' + fmtCLP(factura1 ? factura1.montoNeto : 0) + ' suma=' + fmtCLP(sumaInicial));

            // Paso 2: borrar la FACTURA (no el residual) desde CXC.
            await financeSearch(page, eventName);
            await clickDeleteFacturaCXC(page, factura1.id);
            const step2 = await findFacturasBySaleId(venta.id);
            const residual2 = step2.find(function (f) { return f.status === 'sin_factura'; });
            const sumaTrasBorrado = step2.reduce(function (s, f) { return s + Number(f.montoNeto || 0); }, 0);
            ctx.note('tras borrar la factura de $600.000: quedan ' + step2.length + ' fila(s), suma=' + fmtCLP(sumaTrasBorrado) +
                ' (residual=' + fmtCLP(residual2 ? residual2.montoNeto : 0) + ')');

            // HALLAZGO: la invariante "residual + facturas == venta" debe sostenerse
            // SIEMPRE — si no, hay un agujero de plata que la app ya no rastrea en
            // ninguna parte. deleteReceivable() (finance.js:2530) solo hace
            // DS.remove() de la fila — no existe lógica que reconstruya el residual.
            ctx.check(
                'HALLAZGO (BUG si falla): tras borrar una factura parcial, la suma residual+facturas SIGUE siendo igual a la venta ($1.000.000) — o si no, se documenta el agujero exacto',
                sumaTrasBorrado === AMOUNT,
                'suma tras borrar la factura de $600.000 = ' + fmtCLP(sumaTrasBorrado) + ' vs venta=' + fmtCLP(AMOUNT) +
                ' — AGUJERO=' + fmtCLP(AMOUNT - sumaTrasBorrado) + '. deleteReceivable() (finance.js) borra la fila sin reconstruir nada: ' +
                'el residual NO se reconstruye a $1.000.000, se queda tal cual estaba ($400.000) — los $600.000 que representaba la factura ' +
                'borrada desaparecen de todo libro (Por Cobrar, Lo Que Es Mío) sin dejar rastro ni NC ni ajuste. Es un BUG de integridad financiera: ' +
                'borrar una CXC facturada dejando su venta viva SIEMPRE debe reconciliarse con el residual, y hoy no lo hace.'
            );

            // Paso 3: intentar re-facturar los $600.000 originales sobre lo que quedó
            // ($400.000 de residual) — el propio guard de la UI debería bloquearlo
            // porque 600.000 > 400.000 (netoTotal del residual actual).
            if (residual2) {
                await financeSearch(page, eventName);
                const attempt = await attemptFacturarOverLimit(page, residual2.id, { number: tag('T2-3-F2-blocked'), amount: 600000, tipo: 'F' });
                ctx.check('paso 3: la UI bloquea con alert al intentar re-facturar $600.000 sobre un residual de solo $400.000 (no deja crear una factura inconsistente)',
                    !!attempt.dialogMsg && attempt.dialogMsg.indexOf('no puede superar') !== -1,
                    'dialogo=' + JSON.stringify(attempt.dialogMsg) + ' — CONSECUENCIA DEL HALLAZGO ANTERIOR: como el residual quedó en $400.000 en vez de $1.000.000, ' +
                    'ya NO es posible recuperar por UI un estado facturado por el monto original ($600.000) sin editar la venta a mano primero.');
                const step2b = await findFacturasBySaleId(venta.id);
                ctx.check('paso 3 (API): el intento bloqueado NO creó ninguna fila nueva', step2b.length === step2.length, 'antes=' + step2.length + ' despues=' + step2b.length);

                // Paso 4: re-facturar lo que SÍ cabe ($400.000, el 100% del residual actual)
                // para dejar el evento en un estado facturado sin filas huérfanas — aunque
                // el total ya no sea $1.000.000 (ver hallazgo).
                await financeSearch(page, eventName);
                const invoiceNumber2 = tag('T2-3-F2');
                await clickFacturar(page, residual2.id, { number: invoiceNumber2, amount: 400000, tipo: 'F' });
                const step4 = await findFacturasBySaleId(venta.id);
                const sumaFinal = step4.reduce(function (s, f) { return s + Number(f.montoNeto || 0); }, 0);
                ctx.check('paso 4 (API): tras re-facturar los $400.000 que sí quedaban, no hay residual sin_factura huérfano', !step4.find(function (f) { return f.status === 'sin_factura'; }));
                ctx.note('ESTADO FINAL del evento T2-3: ' + step4.length + ' fila(s) CXC, suma=' + fmtCLP(sumaFinal) + ' vs venta original=' + fmtCLP(AMOUNT) +
                    ' — los $600.000 de la primera factura (borrada en el paso 2) quedaron permanentemente fuera de todo libro. Este es el estado final ' +
                    'que ve el dueño si borra una factura parcial desde CXC sin tocar la venta.');
            } else {
                ctx.check('paso 3/4 omitidos: no quedó residual sobre el cual reintentar facturar (ver nota del paso 2)', false, 'residual2=null');
            }
            // OJO: a diferencia de T2-1/T2-2, este experimento NUNCA borra la venta
            // (solo manipula sus CXC) — "venta" debe seguir con valor para que el
            // finally de abajo la limpie de verdad vía cleanupVenta(). Ponerla en null
            // aquí (como en los demás experimentos, donde SÍ se borra la venta a mitad
            // del test) dejaría la venta y su última CXC huérfanas hasta el barrido de
            // seguridad — ya se detectó y corrigió ese leak en esta misma tanda.
        } catch (e) {
            await ctx.screenshot(page, 'excepcion');
            throw e;
        } finally {
            await cleanupVenta(venta);
            await context.close();
        }
    });
}

// =============================================================================
// T2-4 — Permutaciones incidencia/NC vs facturación
// =============================================================================
async function expT2_4a(browser) {
    return runExperiment('T2-4a', 'Incidencia ANTES de facturar -> facturar "el total"', async function (ctx) {
        const eventName = tag('T2-4a-evento');
        const clientName = tag('T2-4a-cliente');
        const AMOUNT = 1000000;
        const REFUND = 200000;
        const { context, page } = await newLoggedInPage(browser, 'superadmin');
        let venta = null;
        try {
            venta = await createSaleViaUI(page, { eventName: eventName, clientName: clientName, amount: AMOUNT, eventDate: todayISO() });
            await editSaleViaUI(page, venta, async function (p) {
                await p.check('#sale-has-issue');
                await p.fill('#sale-refund-amount', String(REFUND));
            });
            const ventaConIncidencia = await findVentaById(venta.id);
            ctx.check('setup: incidencia registrada ANTES de facturar (refundAmount=$200.000)', Number(ventaConIncidencia.refundAmount) === REFUND);

            const facturas1 = await findFacturasBySaleId(venta.id);
            const residual = facturas1.find(function (f) { return f.status === 'sin_factura'; });
            const restanteComputado = Money.pendienteSinFacturaRow({ neto: Number(residual.montoNeto || 0), refundNeto: REFUND, pagado: 0 });
            ctx.check('el "restante" computado de la residual SÍ refleja la incidencia ($800.000 = 1.000.000 - 200.000)', restanteComputado === 800000, 'restante=' + fmtCLP(restanteComputado));

            await financeSearch(page, eventName);
            const prefill = await readFacturarPrefill(page, residual.id);
            ctx.check(
                'HALLAZGO (DISEÑO/riesgo de sobre-facturación): el modal "Facturar" pre-llena el monto CRUDO de la venta ($1.000.000), NO el descontado por la incidencia ($800.000)',
                prefill === AMOUNT,
                'prefill leído del campo #fac-amount=' + fmtCLP(prefill) + ' (esperado si NO descuenta incidencia=' + fmtCLP(AMOUNT) + ', esperado si SÍ la descontara=' + fmtCLP(AMOUNT - REFUND) + '). ' +
                'Un operador que confíe en el valor pre-llenado (o use el botón "100%") factura al cliente el monto COMPLETO pese a la incidencia ya registrada.'
            );

            // Se factura "el total" tal como lo sugiere la UI (monto pre-llenado, sin
            // ajuste manual) — esto es justamente lo que un operador haría siguiendo
            // el flujo normal, y es lo que el experimento quiere observar.
            const invoiceNumber = tag('T2-4a-F');
            await clickFacturar(page, residual.id, { number: invoiceNumber, amount: prefill, tipo: 'F' });
            const facturas2 = await findFacturasBySaleId(venta.id);
            const factura = facturas2.find(function (f) { return f.tipoDoc === 'F' && f.invoiceNumber === invoiceNumber; });
            ctx.check('la factura nace por el monto pre-llenado ($1.000.000), no por venta-incidencia ($800.000) — confirma el hallazgo con la fila real',
                !!factura && Number(factura.montoNeto) === AMOUNT, factura ? ('montoNeto=' + fmtCLP(factura.montoNeto)) : 'no se encontró la factura');
            // Este experimento nunca borra la venta — la limpia cleanupVenta() en finally.
        } catch (e) {
            await ctx.screenshot(page, 'excepcion');
            throw e;
        } finally {
            await cleanupVenta(venta);
            await context.close();
        }
    });
}

async function expT2_4b(browser) {
    return runExperiment('T2-4b', 'Incidencia DESPUÉS de facturar el total (sin NC)', async function (ctx) {
        const eventName = tag('T2-4b-evento');
        const clientName = tag('T2-4b-cliente');
        const AMOUNT = 1000000;
        const REFUND = 200000;
        const { context, page } = await newLoggedInPage(browser, 'superadmin');
        let venta = null;
        try {
            venta = await createSaleViaUI(page, { eventName: eventName, clientName: clientName, amount: AMOUNT, eventDate: todayISO() });
            const facturas1 = await findFacturasBySaleId(venta.id);
            const residual = facturas1.find(function (f) { return f.status === 'sin_factura'; });
            await financeSearch(page, eventName);
            const invoiceNumber = tag('T2-4b-F');
            await clickFacturar(page, residual.id, { number: invoiceNumber, amount: AMOUNT, tipo: 'F' });

            const facturas2 = await findFacturasBySaleId(venta.id);
            ctx.check('setup: facturado el 100%, residual se cierra/borra (queda solo la factura)', facturas2.length === 1 && facturas2[0].status !== 'sin_factura');
            const facturaAntes = facturas2[0];
            const pendienteAntes = Money.pendienteFacturadoRow({ tipoDoc: facturaAntes.tipoDoc, facturadoNeto: Number(facturaAntes.montoNeto || 0), ncNeto: 0, pagado: 0 });

            // Marcar incidencia DESPUÉS de facturar el total, sin crear NC.
            await editSaleViaUI(page, venta, async function (p) {
                await p.check('#sale-has-issue');
                await p.fill('#sale-refund-amount', String(REFUND));
            });
            const ventaConIncidencia = await findVentaById(venta.id);
            ctx.check('la venta registra refundAmount=$200.000 pese a estar 100% facturada', Number(ventaConIncidencia.refundAmount) === REFUND);

            const facturas3 = await findFacturasBySaleId(venta.id);
            const facturaDespues = facturas3.find(function (f) { return f.id === facturaAntes.id; });
            const pendienteDespues = Money.pendienteFacturadoRow({ tipoDoc: facturaDespues.tipoDoc, facturadoNeto: Number(facturaDespues.montoNeto || 0), ncNeto: 0, pagado: 0 });
            ctx.check(
                'HALLAZGO (DISEÑO): la incidencia marcada DESPUÉS de facturar el total (sin NC) NO reduce el pendiente de CXC — getPendienteFacturado() solo descuenta NC, nunca refundAmount',
                pendienteDespues === pendienteAntes,
                'pendiente antes de la incidencia=' + fmtCLP(pendienteAntes) + ' pendiente despues=' + fmtCLP(pendienteDespues) +
                ' (sin cambio — el CXC sigue mostrando que se le debe el monto COMPLETO al cliente, aunque el sistema ya registró una incidencia de $200.000 en la venta). ' +
                'Comparado con T2-4a (incidencia ANTES de facturar SÍ reduce lo que se factura si el operador ajusta el monto): el efecto de una incidencia depende ' +
                '100% de EN QUÉ MOMENTO del flujo se marca, no de que exista — inconsistente para el usuario final.'
            );
            // Este experimento nunca borra la venta — la limpia cleanupVenta() en finally.
        } catch (e) {
            await ctx.screenshot(page, 'excepcion');
            throw e;
        } finally {
            await cleanupVenta(venta);
            await context.close();
        }
    });
}

async function expT2_4c(browser) {
    return runExperiment('T2-4c', 'NC sin incidencia previa (confirma H1: el flujo la crea junto)', async function (ctx) {
        const eventName = tag('T2-4c-evento');
        const clientName = tag('T2-4c-cliente');
        const AMOUNT = 1000000;
        const NC_AMOUNT = 200000;
        const { context, page } = await newLoggedInPage(browser, 'superadmin');
        let venta = null;
        try {
            venta = await createSaleViaUI(page, { eventName: eventName, clientName: clientName, amount: AMOUNT, eventDate: todayISO() });
            const facturas1 = await findFacturasBySaleId(venta.id);
            const residual = facturas1.find(function (f) { return f.status === 'sin_factura'; });
            await financeSearch(page, eventName);
            const invoiceNumber = tag('T2-4c-F');
            await clickFacturar(page, residual.id, { number: invoiceNumber, amount: AMOUNT, tipo: 'F' });
            const facturas2 = await findFacturasBySaleId(venta.id);
            const factura = facturas2.find(function (f) { return f.tipoDoc === 'F' && f.invoiceNumber === invoiceNumber; });

            const ventaAntesNC = await findVentaById(venta.id);
            ctx.check('setup: SIN incidencia previa a la NC (refundAmount=0, hasIssue falso)', Number(ventaAntesNC.refundAmount || 0) === 0 && !ventaAntesNC.hasIssue);

            await financeSearch(page, eventName);
            const ncNumber = tag('T2-4c-NC');
            await clickNC(page, factura.id, { number: ncNumber, amount: NC_AMOUNT, motivo: 'E2E T2-4c sin incidencia previa' });

            const ventaTrasNC = await findVentaById(venta.id);
            ctx.check(
                'CONFIRMA H1/patrón conocido (expD): crear una NC pura (sin marcar incidencia antes) IGUAL escribe refundAmount en la venta como side-effect',
                Number(ventaTrasNC.refundAmount) === NC_AMOUNT,
                'refundAmount tras la NC=' + fmtCLP(ventaTrasNC.refundAmount) + ' (esperado=' + fmtCLP(NC_AMOUNT) + ') — "el flujo actual la crea junto", tal como predice el hallazgo H1 documentado en Experimento D.'
            );

            const facturas3 = await findFacturasBySaleId(venta.id);
            const facturaConNC = facturas3.find(function (f) { return f.id === factura.id; });
            const pendienteConNC = Money.pendienteFacturadoRow({ tipoDoc: facturaConNC.tipoDoc, facturadoNeto: Number(facturaConNC.montoNeto || 0), ncNeto: NC_AMOUNT, pagado: 0 });
            ctx.check('a diferencia de T2-4b (incidencia sola), la NC SÍ baja el pendiente de la factura ($952.000 = (1.000.000-200.000)×1,19)', pendienteConNC === 952000, 'pendiente=' + fmtCLP(pendienteConNC));

            // Contraste explícito (a) vs (b) vs (c): en (c) NO hay residual sin_factura
            // coexistiendo (se facturó el 100% antes de la NC), así que el doble
            // descuento H1 (que requiere una residual viva) NO puede manifestarse aquí
            // — se documenta como censo, no como fallo, porque la precondición de H1
            // (residual + refundAmount en la MISMA venta) no se da en este flujo.
            ctx.note('CENSO — comparación (a)/(b)/(c): (a) incidencia antes de facturar SÍ se refleja en el "restante" de la residual, pero el modal "Facturar" no la descuenta al sugerir el monto (riesgo de sobre-facturar). ' +
                '(b) incidencia después de facturar el total, sin NC, no tiene NINGÚN efecto en el pendiente de CXC (queda invisible). ' +
                '(c) una NC SÍ reduce el pendiente de la factura correctamente, y de paso escribe refundAmount en la venta (mismo mecanismo que causa H1) — pero aquí no hay residual viva para que el doble descuento de H1 se exprese.');
            // Este experimento nunca borra la venta — la limpia cleanupVenta() en finally.
        } catch (e) {
            await ctx.screenshot(page, 'excepcion');
            throw e;
        } finally {
            await cleanupVenta(venta);
            await context.close();
        }
    });
}

// =============================================================================
// T2-5 (bonus) — Doble sesión, misma venta, last-write-wins (censo)
// =============================================================================
async function expT2_5(browser) {
    return runExperiment('T2-5', 'Doble sesión editando la misma venta (censo de last-write-wins)', async function (ctx) {
        const eventName = tag('T2-5-evento');
        const clientName = tag('T2-5-cliente');
        const AMOUNT = 400000;
        const { context: ctx1, page: page1 } = await newLoggedInPage(browser, 'superadmin');
        let venta = null, ctx2 = null, page2 = null;
        try {
            venta = await createSaleViaUI(page1, { eventName: eventName, clientName: clientName, amount: AMOUNT, eventDate: todayISO(), comisionPct: 5 });
            const inicial = await findVentaById(venta.id);
            ctx.check('setup: venta creada con comisionPct=5', Number(inicial.comisionPct) === 5);

            const opened = await newLoggedInPage(browser, 'superadmin');
            ctx2 = opened.context; page2 = opened.page;

            // Sesión 1 abre el modal de edición primero (carga comisionPct=5 en el form).
            await salesSearch(page1, eventName);
            const editBtn1 = page1.locator('.btn-edit-sale[data-id="' + venta.id + '"]');
            await editBtn1.waitFor({ timeout: NAV_TIMEOUT });
            await editBtn1.click();
            await page1.waitForSelector('#sale-modal-overlay.active', { timeout: NAV_TIMEOUT });

            // Sesión 2 abre el MISMO registro, cambia la comisión a 20 y guarda primero.
            await salesSearch(page2, eventName);
            const editBtn2 = page2.locator('.btn-edit-sale[data-id="' + venta.id + '"]');
            await editBtn2.waitFor({ timeout: NAV_TIMEOUT });
            await editBtn2.click();
            await page2.waitForSelector('#sale-modal-overlay.active', { timeout: NAV_TIMEOUT });
            await page2.fill('#sale-comision', '20');
            await page2.click('#sale-save-btn');
            await page2.waitForTimeout(900);

            const trasSesion2 = await findVentaById(venta.id);
            ctx.check('tras guardar la sesión 2, comisionPct=20 en la base', Number(trasSesion2.comisionPct) === 20, 'comisionPct=' + trasSesion2.comisionPct);

            // Sesión 1 (que YA tenía el modal abierto con datos de ANTES de la sesión 2)
            // cambia la comisión a 15 y guarda DESPUÉS — sin refrescar, sin conocer el
            // cambio de la sesión 2.
            await page1.fill('#sale-comision', '15');
            await page1.click('#sale-save-btn');
            await page1.waitForTimeout(900);

            const final = await findVentaById(venta.id);
            ctx.check(
                'CENSO (comportamiento esperado hoy, sin optimistic locking): last-write-wins — comisionPct final=15 (lo que guardó la sesión 1, que escribió DESPUÉS), el cambio de la sesión 2 (20) se pierde silenciosamente sin aviso de conflicto',
                Number(final.comisionPct) === 15,
                'comisionPct final=' + final.comisionPct + ' (sesión 2 guardó 20 primero, sesión 1 guardó 15 después sin ver el 20 — no hay detección de conflicto, versión, ni aviso al usuario de la sesión 1 de que sobreescribió un cambio ajeno).'
            );
            // OJO (mismo leak que se encontró y corrigió en T2-3/T2-4): esta venta
            // NUNCA se borra por UI durante el test, así que todavía tiene su CXC
            // residual sin_factura viva — no poner venta=null aquí; cleanupVenta() en
            // el finally debe limpiar facturas+costos+venta juntos, no solo la venta.
        } catch (e) {
            await ctx.screenshot(page1, 'excepcion').catch(function () {});
            throw e;
        } finally {
            if (venta) await cleanupVenta(venta);
            else {
                const leftover = await findVentaByEventName(eventName).catch(function () { return null; });
                if (leftover) await deleteRows('ventas', [leftover.id]);
            }
            await ctx1.close();
            if (ctx2) await ctx2.close();
        }
    });
}

// =============================================================================
// MAIN
// =============================================================================
async function main() {
    console.log('=== Banco de experimentos E2E — Tanda 2 (MazeLab OS, ' + EXP.BASE_URL + ') ===\n');

    EXP.loadConfig();
    admin = EXP.getAdmin();

    const only = process.env.EXPERIMENTS ? process.env.EXPERIMENTS.split(',').map(function (s) { return s.trim().toUpperCase(); }) : null;
    function want(letter) { return !only || only.indexOf(letter.toUpperCase()) !== -1; }

    const browser = await chromium.launch({ headless: true });
    try {
        if (want('T2-1a')) await expT2_1a(browser);
        if (want('T2-1b')) await expT2_1b(browser);
        if (want('T2-1c')) await expT2_1c(browser);
        if (want('T2-2')) await expT2_2(browser);
        if (want('T2-3')) await expT2_3(browser);
        if (want('T2-4a')) await expT2_4a(browser);
        if (want('T2-4b')) await expT2_4b(browser);
        if (want('T2-4c')) await expT2_4c(browser);
        if (want('T2-5')) await expT2_5(browser);
    } finally {
        await browser.close();
    }

    const experimentResults = EXP.getExperimentResults();
    console.log('\n' + new Array(90).join('='));
    console.log('RESUMEN GLOBAL — Banco de experimentos E2E, Tanda 2');
    console.log(new Array(90).join('='));
    let totalPass = 0, totalFail = 0, totalWarn = 0;
    experimentResults.forEach(function (r) {
        totalPass += r.pass; totalFail += r.fail; totalWarn += (r.warn || 0);
        console.log('  Experimento ' + r.letter.padEnd(8) + ' ' + (r.title || '').padEnd(58) + '  ' + r.pass + ' OK, ' + r.fail + ' FAIL' + (r.warn ? ', ' + r.warn + ' WARN' : ''));
    });
    console.log(new Array(90).join('-'));
    console.log('  TOTAL: ' + totalPass + ' OK, ' + totalFail + ' FAIL' + (totalWarn ? ', ' + totalWarn + ' WARN' : ''));
    console.log(new Array(90).join('='));

    console.log('\n=== Limpieza final (scripts/cleanup-e2e-data.js) ===');
    const { execFileSync } = require('child_process');
    const REPO_ROOT = path.join(__dirname, '..', '..');
    try {
        const out = execFileSync('node', [path.join(REPO_ROOT, 'scripts', 'cleanup-e2e-data.js')], { encoding: 'utf8' });
        console.log(out);
    } catch (e) {
        console.log('ERROR corriendo cleanup-e2e-data.js: ' + (e && e.stdout ? e.stdout : e.message));
    }

    return { pass: totalPass, fail: totalFail, experiments: experimentResults };
}

if (require.main === module) {
    main().then(function (r) {
        process.exit(r.fail === 0 ? 0 : 1);
    }).catch(function (err) {
        console.error('ERROR FATAL: ' + (err && err.stack ? err.stack : err));
        process.exit(1);
    });
} else {
    module.exports = { main: main };
}
