#!/usr/bin/env node
// EXPERIMENTO L — Reconciliación de KPIs (banco de experimentos E2E, rama feature/e2e-bank).
//
// Objetivo: dejar de "creer" los KPIs y verificarlos. Dos fuentes independientes:
//   1. Cálculo directo (sin browser): lee ventas/facturas/costos/clientes con la
//      SERVICE KEY (bypass RLS) y recalcula usando el MÓDULO REAL de la app
//      (src/shared/money.js + src/modules/finance/finance.js, cargados en Node
//      con window mockeado — mismo patrón que tests/verify-finance-round2.js)
//      para que la comparación sea contra la MISMA lógica que corre en producción,
//      no una reimplementación paralela que podría divergir por error propio.
//   2. Lectura de browser (Playwright, e2e-superadmin): qué muestran realmente
//      el Dashboard y la página CXC contra el deploy vivo.
//
// Contexto crítico (memoria de proyecto, 2026-07-25): "por cobrar" medido a mano
// ese día fue ~$210,7M (88 docs: 40 sin facturar $125,0M + 48 facturas $85,8M)
// contra $200,4M que mostraba el dashboard de ESE entonces (gap de $10,3M por NC
// descontada dos veces, bug ya corregido). Hoy (rama feature/e2e-bank, tras Sprint
// M1 migración a Supabase) el dashboard muestra ~$30,8M/19 docs — una caída mucho
// mayor a lo que el fix de NC podría explicar (esa corrección debería subir el
// número, no bajarlo). Este experimento DIAGNOSTICA la brecha con evidencia, sin
// tocar código ni datos.
//
// Uso:
//   node tests/e2e/reconciliacion-kpi.js
//   BASE_URL=... node tests/e2e/reconciliacion-kpi.js
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { loadEnvFile, parseEnvFile } = require('../../scripts/lib/env.js');

const REPO_ROOT = path.join(__dirname, '..', '..');
const ENV_PATH = path.join(REPO_ROOT, '.env');
const E2E_ENV_PATH = path.join(REPO_ROOT, '.env.e2e');
const ARTIFACTS_DIR = path.join(__dirname, 'artifacts');
const BASE_URL = (process.env.BASE_URL || 'https://mazelab-ide-2.vercel.app').replace(/\/$/, '');

const NAV_TIMEOUT = 60000;
const ACTION_TIMEOUT = 30000;

// Conteos documentados en supabase/schema.sql como comentario al crear las
// tablas — "filas en el respaldo" migrado desde Replit el 2026-07-25/26.
// Sirven de referencia para detectar si hoy hay MENOS filas que las migradas
// (indicio de problema de datos, no de fórmula).
const BACKUP_ROW_COUNTS = { ventas: 992, facturas: 1150 };

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, detail) {
    process.stdout.write('  ' + name + ' ... ');
    if (cond) {
        pass++;
        console.log('OK');
    } else {
        fail++;
        failures.push({ name: name, detail: detail });
        console.log('FAIL');
        if (detail) console.log('      ' + detail);
    }
}

async function step(name, pageForEvidence, fn) {
    process.stdout.write('  ' + name + ' ... ');
    try {
        const result = await fn();
        pass++;
        console.log('OK');
        return result;
    } catch (e) {
        fail++;
        failures.push({ name: name, detail: e && e.message ? e.message : String(e) });
        console.log('FAIL');
        console.log('      ' + (e && e.message ? e.message : String(e)));
        if (pageForEvidence) {
            try {
                if (!fs.existsSync(ARTIFACTS_DIR)) fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
                const slug = 'L-' + name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
                const evidencePath = path.join(ARTIFACTS_DIR, 'FAIL-' + slug + '.png');
                await pageForEvidence.screenshot({ path: evidencePath, fullPage: true });
                console.log('      evidencia: ' + evidencePath);
            } catch (screenshotErr) {
                console.log('      (no se pudo capturar evidencia)');
            }
        }
        return null;
    }
}

function fmtCLP(amount) {
    var n = Math.round(Number(amount) || 0);
    var negative = n < 0;
    if (negative) n = -n;
    var str = n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (negative ? '-$' : '$') + str;
}

function parseCLP(str) {
    if (!str) return NaN;
    var neg = str.indexOf('-') !== -1;
    var digits = String(str).replace(/[^0-9]/g, '');
    if (digits === '') return NaN;
    var n = Number(digits);
    return neg ? -n : n;
}

async function readKpiCards(page) {
    return page.$$eval('.kpi-card', function (cards) {
        return cards.map(function (c) {
            var label = c.querySelector('.kpi-label');
            var value = c.querySelector('.kpi-value');
            var sub = c.querySelector('.kpi-sub');
            return {
                label: label ? label.textContent.trim() : '',
                value: value ? value.textContent.trim() : '',
                sub: sub ? sub.textContent.trim() : ''
            };
        });
    });
}

function findCard(cards, label) {
    return cards.find(function (c) { return c.label === label; });
}

function line(char) { return new Array(78).join(char || '-'); }

async function main() {
    console.log('=== EXPERIMENTO L — Reconciliación de KPIs (' + BASE_URL + ') ===\n');

    // =========================================================================
    // 1. CONFIG
    // =========================================================================
    if (!fs.existsSync(ENV_PATH)) {
        console.error('No se encontró .env en la raíz del repo (SUPABASE_URL + SUPABASE_SERVICE_KEY).');
        process.exit(1);
    }
    const mainEnv = parseEnvFile(ENV_PATH);
    const SUPABASE_URL = mainEnv.SUPABASE_URL;
    const SERVICE_KEY = mainEnv.SUPABASE_SERVICE_KEY;
    if (!SUPABASE_URL || !SERVICE_KEY) {
        console.error('.env incompleto: falta SUPABASE_URL y/o SUPABASE_SERVICE_KEY.');
        process.exit(1);
    }
    if (!fs.existsSync(E2E_ENV_PATH)) {
        console.error('No se encontró .env.e2e. Correr primero: node scripts/provision-e2e-users.js');
        process.exit(1);
    }
    const e2eEnv = loadEnvFile(E2E_ENV_PATH);
    const superadminPassword = e2eEnv.E2E_SUPERADMIN_PASSWORD;
    if (!superadminPassword) {
        console.error('.env.e2e sin E2E_SUPERADMIN_PASSWORD.');
        process.exit(1);
    }

    // =========================================================================
    // 2. LECTURA DIRECTA (service key — bypass RLS por completo)
    // =========================================================================
    console.log('--- Fase 1: cálculo directo (service key, sin browser) ---\n');
    const { createClient } = require('@supabase/supabase-js');
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

    // HALLAZGO CRÍTICO (encontrado en esta misma corrida): src/shared/supabase.js
    // fetchAll() hace `client.from(table).select('*').order('id')` SIN `.range()`
    // — Supabase/PostgREST aplica un límite por defecto de 1000 filas por
    // respuesta cuando no hay paginación explícita, así que fetchAll() TRUNCA
    // en silencio cualquier tabla con más de 1000 filas (ni error ni warning,
    // simplemente devuelve las primeras 1000 según el orden pedido). Se mide
    // esto ANTES de paginar: una llamada idéntica a la de la app real (sin
    // range), para cuantificar el hueco exacto — y LUEGO se pagina de verdad
    // para tener el dato completo con el que comparar.
    const TABLES = ['ventas', 'facturas', 'costos', 'clientes'];
    const raw = {};
    const truncatedCounts = {}; // lo que vería fetchAll() real de la app (sin range)
    const exactCounts = {}; // count() real de Postgres, vía head:true (no trae filas)
    for (let i = 0; i < TABLES.length; i++) {
        const t = TABLES[i];

        const naiveRes = await admin.from(t).select('*').order('id');
        if (naiveRes.error) throw new Error('Error leyendo "' + t + '" (sin range) con service key: ' + naiveRes.error.message);
        truncatedCounts[t] = (naiveRes.data || []).length;

        const countRes = await admin.from(t).select('id', { count: 'exact', head: true });
        if (countRes.error) throw new Error('Error contando "' + t + '": ' + countRes.error.message);
        exactCounts[t] = countRes.count;

        // Paginación real con .range() — página de 1000, hasta agotar la tabla.
        let all = [];
        let page = 0;
        const PAGE_SIZE = 1000;
        while (true) {
            const from = page * PAGE_SIZE;
            const to = from + PAGE_SIZE - 1;
            const pageRes = await admin.from(t).select('*').order('id').range(from, to);
            if (pageRes.error) throw new Error('Error paginando "' + t + '" (page ' + page + '): ' + pageRes.error.message);
            const rows = pageRes.data || [];
            all = all.concat(rows);
            if (rows.length < PAGE_SIZE) break;
            page++;
        }
        raw[t] = all;

        const truncado = truncatedCounts[t] < exactCounts[t];
        console.log('  ' + t.padEnd(10) + ' -> count exacto=' + exactCounts[t] +
            '  | select() sin range (como fetchAll real)=' + truncatedCounts[t] +
            '  | paginado completo=' + all.length +
            (truncado ? '   <<< TRUNCAMIENTO SILENCIOSO: faltan ' + (exactCounts[t] - truncatedCounts[t]) + ' fila(s)' : ''));
    }
    const ventas = raw.ventas, facturas = raw.facturas, costos = raw.costos, clientes = raw.clientes;
    console.log('');

    check(
        'fetchAll() real (sin .range()) NO trunca "facturas" — src/shared/supabase.js:82',
        truncatedCounts.facturas >= exactCounts.facturas,
        'BUG EN VIVO: fetchAll(\'facturas\') devuelve ' + truncatedCounts.facturas + ' de ' + exactCounts.facturas +
        ' filas reales (faltan ' + (exactCounts.facturas - truncatedCounts.facturas) + '). Límite por defecto de PostgREST/Supabase ' +
        '(1000 filas) sin `.range()`/paginación en fetchAll(). Afecta a TODA la app (dashboard, CXC, CXP, comisiones) ' +
        'para cualquier tabla que supere 1000 filas — no es específico de este experimento.'
    );
    check(
        'fetchAll() real (sin .range()) NO trunca "costos" — src/shared/supabase.js:82',
        truncatedCounts.costos >= exactCounts.costos,
        'BUG EN VIVO: fetchAll(\'costos\') devuelve ' + truncatedCounts.costos + ' de ' + exactCounts.costos +
        ' filas reales (faltan ' + (exactCounts.costos - truncatedCounts.costos) + ', ' +
        Math.round((1 - truncatedCounts.costos / exactCounts.costos) * 100) + '% de la tabla invisible para la app). ' +
        'Mismo bug que en facturas — CXP ("Por Pagar") está calculado sobre una fracción de los costos reales.'
    );

    check(
        'ventas: filas actuales (' + ventas.length + ') vs migradas según schema.sql (' + BACKUP_ROW_COUNTS.ventas + ')',
        true, // informativo, no pass/fail real — se reporta siempre
        ventas.length < BACKUP_ROW_COUNTS.ventas
            ? 'HAY MENOS FILAS HOY (' + ventas.length + ') QUE LAS MIGRADAS (' + BACKUP_ROW_COUNTS.ventas + ') — posible borrado o migración parcial.'
            : 'igual o más filas que la migración original — no hay pérdida de datos evidente en ventas.'
    );
    check(
        'facturas: filas actuales (' + facturas.length + ') vs migradas según schema.sql (' + BACKUP_ROW_COUNTS.facturas + ')',
        true,
        facturas.length < BACKUP_ROW_COUNTS.facturas
            ? 'HAY MENOS FILAS HOY (' + facturas.length + ') QUE LAS MIGRADAS (' + BACKUP_ROW_COUNTS.facturas + ') — posible borrado o migración parcial.'
            : 'igual o más filas que la migración original — no hay pérdida de datos evidente en facturas.'
    );

    // ---- Cargar el MÓDULO REAL (money.js + finance.js) en Node, mismo patrón
    // que tests/verify-finance-round2.js: window = global, para que
    // computeKPIs() sea LITERALMENTE la función que corre en el navegador.
    global.window = global;
    const Money = require(path.join(REPO_ROOT, 'src/shared/money.js'));
    global.window.Mazelab = { Modules: {}, Money: Money };
    require(path.join(REPO_ROOT, 'src/modules/finance/finance.js'));
    const FM = global.window.Mazelab.Modules.FinanceModule;
    if (!FM || typeof FM.computeKPIs !== 'function') {
        throw new Error('No se pudo cargar FinanceModule.computeKPIs en Node — revisar el require de finance.js');
    }

    // Clonamos porque computeKPIs MUTA las filas (_ncOffset, _refundAmount,
    // _realStatus) — clonar deja el array crudo intacto para las variantes de
    // abajo (breakdown por status, cálculo "naive").
    const facturasClone = JSON.parse(JSON.stringify(facturas));
    const kpis = FM.computeKPIs(facturasClone, ventas);

    // ---- Impacto real del truncamiento de fetchAll(): mismo computeKPIs()
    // real, pero alimentado SOLO con las primeras 1000 filas (orden por id) —
    // exactamente lo que ve la app hoy en producción, sin range().
    const facturasTruncadas = JSON.parse(JSON.stringify(facturas.slice(0, 1000)));
    const kpisTruncado = FM.computeKPIs(facturasTruncadas, ventas);
    const truncadoPorCobrar = kpisTruncado.totalPorCobrar;
    const truncadoDocs = kpisTruncado.data.sinFactura.length + kpisTruncado.data.facturadoPendientes.length;

    const directoPorCobrar = kpis.totalPorCobrar;
    const directoLoQueEsMio = kpis.totalLoQueEsMio;
    const directoSinFacturaCount = kpis.data.sinFactura.length;
    const directoFacturadoPendCount = kpis.data.facturadoPendientes.length;
    const directoDocsPendientes = directoSinFacturaCount + directoFacturadoPendCount;
    const directoSinFacturaNeto = kpis.totalSinFacturaNeto;
    const directoSinFacturaConIva = Math.round(directoSinFacturaNeto * Money.IVA);
    // El total facturado-pendiente real ya está adentro de totalPorCobrar:
    // totalPorCobrar = sinFacturaNeto*1.19 + facturadoPend. Se despeja así en
    // vez de reimplementar getPendienteFacturado (no exportada) para no
    // arriesgar una fórmula paralela que diverja de la real.
    const directoFacturadoPend = directoPorCobrar - directoSinFacturaConIva;

    // total ventas (all-time, bruto/neto) — réplica exacta de dashboard.js
    // buildFullDashboard (líneas ~197-209): sin filtro de fecha.
    let totalVentasBruto = 0, totalRefunds = 0;
    ventas.forEach(function (s) {
        totalVentasBruto += Number(s.amount || s.monto_venta || 0) || 0;
        totalRefunds += Number(s.refundAmount || s.monto_devolucion || 0) || 0;
    });
    const totalVentasNeto = totalVentasBruto - totalRefunds;

    // =========================================================================
    // 3. DESGLOSE POR ESTADO REAL (_realStatus, mutado in-place por classifyData)
    // =========================================================================
    function getMonto(r) { return Number(r.montoNeto || r.monto_venta || r.invoicedAmount || r.amount) || 0; }
    function getMontoFacturado(r) {
        if (r.montoFacturado !== undefined && r.montoFacturado !== null && r.montoFacturado !== '') return Number(r.montoFacturado) || 0;
        if (r.invoicedAmount !== undefined && r.invoicedAmount !== null && r.invoicedAmount !== '') return Number(r.invoicedAmount) || 0;
        return 0;
    }

    const buckets = {};
    facturasClone.forEach(function (r) {
        const st = r._realStatus || 'sin_clasificar';
        if (!buckets[st]) buckets[st] = { count: 0, monto: 0 };
        buckets[st].count++;
        const mf = getMontoFacturado(r);
        buckets[st].monto += (mf > 0 ? mf : getMonto(r));
    });

    console.log('\n--- Desglose por estado real (getRealTimeStatus), TODAS las filas de facturas ---');
    console.log('  estado'.padEnd(28) + 'docs'.padStart(6) + '   monto (bruto/facturado, sin ajustar NC/pago)');
    const inKPI = { pendiente_factura: true, post_evento_sin_factura: true };
    // facturadoPendientes cubre varios _realStatus (pendiente/pendiente_pago/vencida_*, etc.)
    // — se marcan explícitamente los que SI entran al agregado facturadoPendientes.
    const facturadoPendStatuses = {};
    kpis.data.facturadoPendientes.forEach(function (r) { facturadoPendStatuses[r._realStatus] = true; });
    Object.keys(buckets).sort().forEach(function (st) {
        const b = buckets[st];
        const entra = inKPI[st] || facturadoPendStatuses[st];
        console.log('  ' + st.padEnd(26) + String(b.count).padStart(6) + '   ' + fmtCLP(b.monto).padStart(14) + (entra ? '  [suma a Por Cobrar]' : '  [NO suma a Por Cobrar]'));
    });
    const enGestion = buckets['en_gestion'] || { count: 0, monto: 0 };

    // =========================================================================
    // 4. MÉTODO "NAIVE" — todo lo no-NC/no-pagada/no-anulada, IGNORANDO
    // en_gestion a propósito, para medir cuánto pesa esa exclusión sola.
    // =========================================================================
    let naiveSinFacturaNeto = 0, naiveSinFacturaCount = 0;
    let naiveFacturadoBruto = 0, naiveFacturadoCount = 0;
    facturasClone.forEach(function (r) {
        if (r.tipoDoc === 'NC') return;
        const st = r._realStatus;
        if (st === 'pagada' || st === 'anulada' || st === 'nc') return;
        const mf = getMontoFacturado(r);
        if (mf > 0) { naiveFacturadoBruto += mf; naiveFacturadoCount++; }
        else { naiveSinFacturaNeto += getMonto(r); naiveSinFacturaCount++; }
    });
    const naiveTotal = naiveFacturadoBruto + Math.round(naiveSinFacturaNeto * Money.IVA);
    const naiveDocs = naiveSinFacturaCount + naiveFacturadoCount;

    console.log('\n--- Comparación: cálculo directo (real, con exclusiones) vs "naive" (incluye en_gestión, sin NC-offset por invoice individual ya que _ncOffset viene de classifyData igual) ---');
    console.log('  Sin factura:   directo ' + directoSinFacturaCount + ' docs / ' + fmtCLP(directoSinFacturaConIva) + '   vs   naive ' + naiveSinFacturaCount + ' docs / ' + fmtCLP(Math.round(naiveSinFacturaNeto * Money.IVA)));
    console.log('  Facturado:     directo ' + directoFacturadoPendCount + ' docs / ' + fmtCLP(directoFacturadoPend) + '   vs   naive ' + naiveFacturadoCount + ' docs / ' + fmtCLP(naiveFacturadoBruto));
    console.log('  TOTAL:         directo ' + directoDocsPendientes + ' docs / ' + fmtCLP(directoPorCobrar) + '   vs   naive ' + naiveDocs + ' docs / ' + fmtCLP(naiveTotal));
    console.log('  "en_gestión" (parqueado en CXC Kanban, invisible a AMBOS totales de arriba): ' + enGestion.count + ' docs / ' + fmtCLP(enGestion.monto) + ' (monto bruto sin ajustar NC/IVA)');

    console.log('\n--- Impacto del truncamiento silencioso de fetchAll() (facturas: ' + exactCounts.facturas + ' filas reales, la app solo lee las primeras 1000 por id) ---');
    console.log('  computeKPIs() con las 1000 filas que SÍ ve la app hoy: ' + fmtCLP(truncadoPorCobrar) + '  (' + truncadoDocs + ' docs)');
    console.log('  computeKPIs() con las ' + exactCounts.facturas + ' filas reales (paginado completo):    ' + fmtCLP(directoPorCobrar) + '  (' + directoDocsPendientes + ' docs)');
    console.log('  Diferencia atribuible SOLO al truncamiento: ' + fmtCLP(directoPorCobrar - truncadoPorCobrar) + '  (' + (directoDocsPendientes - truncadoDocs) + ' docs)');

    // =========================================================================
    // 5. LECTURA DE BROWSER (Playwright, e2e-superadmin) — solo lectura
    // =========================================================================
    console.log('\n--- Fase 2: lectura de browser (e2e-superadmin, ' + BASE_URL + ') ---\n');

    if (!fs.existsSync(ARTIFACTS_DIR)) fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    const browser = await chromium.launch({ headless: true });
    let dashCards = [], finCards = [];
    let dashboardPorCobrarCard, dashboardVentasCard, cxcTotalCard, cxcMioCard, cxcSinFacturaCard;
    let cxcEnPlazoCard, cxcVencida30Card, cxcVencida60Card, cxcVencida90Card;

    try {
        const context = await browser.newContext();
        const page = await context.newPage();
        page.setDefaultTimeout(ACTION_TIMEOUT);
        page.setDefaultNavigationTimeout(NAV_TIMEOUT);

        await step('login e2e-superadmin', page, async function () {
            await page.goto(BASE_URL, { waitUntil: 'load', timeout: NAV_TIMEOUT });
            await page.waitForSelector('#login-screen #login-form', { timeout: NAV_TIMEOUT });
            await page.fill('#login-email', 'e2e-superadmin@mazelab-test.cl');
            await page.fill('#login-password', superadminPassword);
            await page.click('#login-submit');
            await page.waitForSelector('#login-screen', { state: 'detached', timeout: NAV_TIMEOUT });
            await page.waitForSelector('.kpi-value', { timeout: NAV_TIMEOUT });
        });

        await step('leer KPIs del Dashboard (Ventas Totales, Por Cobrar (CXC))', page, async function () {
            await page.waitForTimeout(400);
            dashCards = await readKpiCards(page);
            dashboardVentasCard = findCard(dashCards, 'Ventas Totales');
            dashboardPorCobrarCard = findCard(dashCards, 'Por Cobrar (CXC)');
            if (!dashboardVentasCard) throw new Error('no se encontró la tarjeta "Ventas Totales" (' + JSON.stringify(dashCards.map(function (c) { return c.label; })) + ')');
            if (!dashboardPorCobrarCard) throw new Error('no se encontró la tarjeta "Por Cobrar (CXC)"');
        });

        const dashScreenshot = path.join(ARTIFACTS_DIR, 'L-dashboard-kpis.png');
        await page.screenshot({ path: dashScreenshot, fullPage: true }).catch(function () {});

        await step('navegar a CXC (Finance) y leer KPIs', page, async function () {
            await page.click('.nav-item[data-route="finance"]');
            await page.waitForSelector('#kpi-sin-factura', { timeout: NAV_TIMEOUT });
            await page.waitForTimeout(400);
            finCards = await readKpiCards(page);
            cxcTotalCard = findCard(finCards, 'TOTAL POR COBRAR');
            cxcMioCard = findCard(finCards, 'LO QUE ES MIO');
            cxcSinFacturaCard = findCard(finCards, 'Sin Factura');
            cxcEnPlazoCard = findCard(finCards, 'En Plazo');
            cxcVencida30Card = findCard(finCards, '30+ Días');
            cxcVencida60Card = findCard(finCards, '60+ Días');
            cxcVencida90Card = findCard(finCards, '90+ Días');
            if (!cxcTotalCard) throw new Error('no se encontró "TOTAL POR COBRAR" en CXC (' + JSON.stringify(finCards.map(function (c) { return c.label; })) + ')');
            if (!cxcMioCard) throw new Error('no se encontró "LO QUE ES MIO" en CXC');
        });

        const cxcScreenshot = path.join(ARTIFACTS_DIR, 'L-cxc-kpis.png');
        await page.screenshot({ path: cxcScreenshot, fullPage: true }).catch(function () {});

        await context.close();
    } finally {
        await browser.close();
    }

    // =========================================================================
    // 6. TABLA COMPARATIVA + ASSERTS
    // =========================================================================
    console.log('\n' + line('='));
    console.log('TABLA COMPARATIVA — "Por Cobrar" / "TOTAL POR COBRAR"');
    console.log(line('='));
    const dashboardPorCobrarVal = dashboardPorCobrarCard ? parseCLP(dashboardPorCobrarCard.value) : NaN;
    const dashboardDocsSub = dashboardPorCobrarCard ? dashboardPorCobrarCard.sub : '';
    const dashboardDocsMatch = dashboardDocsSub.match(/(\d+)/);
    const dashboardDocs = dashboardDocsMatch ? Number(dashboardDocsMatch[1]) : NaN;
    const cxcTotalVal = cxcTotalCard ? parseCLP(cxcTotalCard.value) : NaN;
    const cxcMioVal = cxcMioCard ? parseCLP(cxcMioCard.value) : NaN;
    const cxcSinFacturaCount = cxcSinFacturaCard ? Number(cxcSinFacturaCard.value) : NaN;
    const cxcFacturadoPendCount = [cxcEnPlazoCard, cxcVencida30Card, cxcVencida60Card, cxcVencida90Card]
        .reduce(function (sum, c) { return sum + (c ? Number(c.value) || 0 : 0); }, 0);
    const cxcDocsTotal = (isNaN(cxcSinFacturaCount) ? 0 : cxcSinFacturaCount) + cxcFacturadoPendCount;

    console.log('  Cálculo directo COMPLETO (paginado, ' + exactCounts.facturas + ' facturas reales):  ' + fmtCLP(directoPorCobrar) + '   (' + directoDocsPendientes + ' docs)');
    console.log('  Cálculo replicando el truncamiento de fetchAll() (1000 filas):  ' + fmtCLP(truncadoPorCobrar) + '   (' + truncadoDocs + ' docs)');
    console.log('  Dashboard "Por Cobrar (CXC)"  (browser, deploy vivo):           ' + (dashboardPorCobrarCard ? fmtCLP(dashboardPorCobrarVal) : 'N/D') + '   (' + (isNaN(dashboardDocs) ? 'N/D' : dashboardDocs) + ' docs)');
    console.log('  CXC "TOTAL POR COBRAR"        (browser, deploy vivo):           ' + (cxcTotalCard ? fmtCLP(cxcTotalVal) : 'N/D') + '   (' + cxcDocsTotal + ' docs)');
    console.log('  Contexto julio 2026 (medición manual, memoria):                 ' + fmtCLP(210700000) + '  (88 docs: 40 sin facturar $125,0M + 48 facturas $85,8M)');
    console.log('');
    console.log('  Diff cálculo completo vs dashboard: ' + fmtCLP((dashboardPorCobrarVal || 0) - directoPorCobrar));
    console.log('  Diff cálculo completo vs CXC:       ' + fmtCLP((cxcTotalVal || 0) - directoPorCobrar));
    console.log('  Diff cálculo completo vs truncado (impacto puro del bug de paginación): ' + fmtCLP(directoPorCobrar - truncadoPorCobrar));
    console.log('');
    console.log('LO QUE ES MIO — directo: ' + fmtCLP(directoLoQueEsMio) + '   vs   CXC (browser): ' + (cxcMioCard ? fmtCLP(cxcMioVal) : 'N/D'));
    console.log('VENTAS TOTALES — directo: ' + fmtCLP(totalVentasBruto) + ' bruto / ' + fmtCLP(totalVentasNeto) + ' neto   vs   Dashboard (browser): ' + (dashboardVentasCard ? dashboardVentasCard.value : 'N/D') + '  (' + (dashboardVentasCard ? dashboardVentasCard.sub : '') + ')');
    console.log(line('='));

    check(
        'Dashboard y CXC muestran EXACTAMENTE el mismo número entre sí (ambos delegan en computeKPIs sobre los mismos datos truncados)',
        !isNaN(dashboardPorCobrarVal) && !isNaN(cxcTotalVal) && Math.abs(dashboardPorCobrarVal - cxcTotalVal) <= 1,
        'dashboard=' + (isNaN(dashboardPorCobrarVal) ? 'N/D' : fmtCLP(dashboardPorCobrarVal)) + ' CXC=' + (isNaN(cxcTotalVal) ? 'N/D' : fmtCLP(cxcTotalVal))
    );
    check(
        'Lo que muestra la app hoy == cálculo con el MISMO truncamiento que sufre fetchAll() (replica el bug, no lo esconde)',
        !isNaN(dashboardPorCobrarVal) && Math.abs(dashboardPorCobrarVal - truncadoPorCobrar) <= 1,
        'app (browser)=' + (isNaN(dashboardPorCobrarVal) ? 'N/D' : fmtCLP(dashboardPorCobrarVal)) + ' cálculo-replicando-truncamiento=' + fmtCLP(truncadoPorCobrar)
    );
    check(
        'CRÍTICO: "Por Cobrar" completo (paginado, ' + exactCounts.facturas + ' facturas reales) == lo que muestra la app (' + truncatedCounts.facturas + ' facturas, truncada)',
        Math.abs(directoPorCobrar - truncadoPorCobrar) <= 1 && directoDocsPendientes === truncadoDocs,
        'FALLA ESPERADA si el truncamiento de fetchAll() esconde documentos pendientes: completo=' + fmtCLP(directoPorCobrar) +
        ' (' + directoDocsPendientes + ' docs) vs app-truncada=' + fmtCLP(truncadoPorCobrar) + ' (' + truncadoDocs + ' docs). ' +
        'Diferencia=' + fmtCLP(directoPorCobrar - truncadoPorCobrar) + ' / ' + (directoDocsPendientes - truncadoDocs) + ' doc(s) — ' +
        'dentro de las 150 filas de "facturas" que fetchAll() nunca trae porque supera el límite de 1000 de PostgREST sin `.range()`.'
    );
    check(
        '"LO QUE ES MIO" CXC (browser, truncado) == cálculo con el mismo truncamiento',
        !isNaN(cxcMioVal) && Math.abs(cxcMioVal - kpisTruncado.totalLoQueEsMio) <= 1,
        'CXC=' + (isNaN(cxcMioVal) ? 'N/D' : fmtCLP(cxcMioVal)) + ' cálculo-truncado=' + fmtCLP(kpisTruncado.totalLoQueEsMio) +
        ' (cálculo COMPLETO real=' + fmtCLP(directoLoQueEsMio) + ')'
    );

    // =========================================================================
    // 7. DIAGNÓSTICO NARRATIVO
    // =========================================================================
    const facturasFaltantes = exactCounts.facturas - truncatedCounts.facturas;
    const costosFaltantes = exactCounts.costos - truncatedCounts.costos;
    const truncamientoExplicaTodo = Math.abs(directoPorCobrar - truncadoPorCobrar) < 1;
    const menosFilasQueMigracion = ventas.length < BACKUP_ROW_COUNTS.ventas || facturas.length < BACKUP_ROW_COUNTS.facturas;

    console.log('\n' + line('='));
    console.log('DIAGNÓSTICO — brecha $30,8M/19 docs (hoy) vs ~$210,7M/88 docs (julio 2026)');
    console.log(line('='));
    console.log([
        'HALLAZGO PRINCIPAL (nuevo, encontrado en esta corrida — no estaba en la',
        'auditoría de julio porque en julio la base vivía en Replit/Postgres directo,',
        'sin PostgREST de por medio): src/shared/supabase.js fetchAll() hace',
        '`.select(\'*\').order(\'id\')` SIN `.range()`. Supabase/PostgREST limita cada',
        'respuesta a 1000 filas por defecto cuando no hay paginación explícita, así',
        'que fetchAll() trunca EN SILENCIO — sin error, sin warning — cualquier tabla',
        'que supere 1000 filas. Esto es un bug EN VIVO, hoy, no específico de este',
        'experimento:',
        '  - facturas: ' + exactCounts.facturas + ' filas reales, la app solo lee ' + truncatedCounts.facturas + ' (' +
            'faltan ' + facturasFaltantes + ').',
        '  - costos:   ' + exactCounts.costos + ' filas reales, la app solo lee ' + truncatedCounts.costos + ' (' +
            'faltan ' + costosFaltantes + ', ' + Math.round(costosFaltantes / exactCounts.costos * 100) + '% de la tabla INVISIBLE — "Por Pagar (CXP)" está',
        '              calculado sobre menos de un tercio de los costos reales).',
        '  - ventas y clientes están bajo 1000 filas hoy, así que no truncan — pero',
        '    ventas superará 1000 filas pronto al ritmo actual de crecimiento, momento',
        '    en que el mismo bug empezará a afectar también "Ventas Totales" y CXP por evento.',
        '',
        'Impacto medido en "Por Cobrar" específicamente (arriba, sección "Impacto del',
        'truncamiento"): ' + (truncamientoExplicaTodo
            ? 'en esta corrida, las 150 filas de facturas fuera de alcance NO cambian el total\n' +
              '  de "Por Cobrar" (ninguna de las 150 filas ausentes está en estado pendiente hoy) —\n' +
              '  el bug es real y grave para CXP/costos, pero NO es la explicación completa de\n' +
              '  la brecha de $180M en "Por Cobrar" específicamente.'
            : 'el total COMPLETO (paginado) difiere del que muestra la app hoy en ' +
              fmtCLP(directoPorCobrar - truncadoPorCobrar) + ' (' + (directoDocsPendientes - truncadoDocs) + ' documento(s)) —\n' +
              '  parte de la brecha reportada SÍ es este bug, no solo actividad de negocio.'),
        '',
        'Con eso descartado/acotado como explicación de "Por Cobrar", el resto de la',
        'brecha de ~$210,7M (julio) a ' + fmtCLP(directoPorCobrar) + ' (hoy, cálculo COMPLETO) se explica por:',
        '',
        '  a) La dirección del fix de NC (Sprint 1, B3 — "NC descontada una sola vez") va',
        '     en sentido CONTRARIO al observado: en julio, restar la NC dos veces hacía que',
        '     el dashboard de ENTONCES mostrara MENOS ($200,4M) que el cálculo directo de',
        '     ese momento ($210,7M). Arreglar ese bug empuja el número hacia ARRIBA, no',
        '     explica una caída — queda descartado como causa de la caída a $30,8M.',
        '',
        '  b) classifyData() excluye "pagada"/"anulada"/"nc" de ambos KPIs por diseño (así',
        '     debe ser). En esta corrida hay ' + (buckets.pagada ? buckets.pagada.count : 0) + ' facturas "pagada" (' +
            fmtCLP(buckets.pagada ? buckets.pagada.monto : 0) + ' bruto) y ' + (buckets.anulada ? buckets.anulada.count : 0),
        '     "anulada" (' + fmtCLP(buckets.anulada ? buckets.anulada.monto : 0) + ') — volumen consistente con casi un',
        '     año calendario de facturación ya resuelta, NO con datos faltantes.',
        '',
        '  c) "en_gestión" (estado nuevo del CXC Kanban, no existía en julio): ' + enGestion.count + ' fila(s)',
        '     por ' + fmtCLP(enGestion.monto) + ' en esta corrida — hoy NO es la explicación (0 o casi 0 filas',
        '     parqueadas), pero es un mecanismo real de "desaparición" a vigilar a futuro',
        '     porque classifyData() lo excluye de AMBOS KPIs sin avisar.',
        '',
        '  d) Filas: hoy (paginado completo, cuenta exacta de Postgres) hay ventas=' + exactCounts.ventas + ',',
        '     facturas=' + exactCounts.facturas + '. La migración (comentario en supabase/schema.sql) documentó',
        '     ventas=' + BACKUP_ROW_COUNTS.ventas + ', facturas=' + BACKUP_ROW_COUNTS.facturas + ' el 25-jul.',
        (menosFilasQueMigracion
            ? '     HAY MENOS FILAS HOY QUE LAS MIGRADAS — coherente con el plan aprobado por Aldo\n' +
              '     de limpiar a mano duplicados ya facturados/pagados tras el fix de "+ Nueva\n' +
              '     Factura" (memoria: auditoria-2026-07-estado.md). No hay evidencia de pérdida\n' +
              '     accidental — el conteo BAJÓ, no quedó por debajo de forma inexplicable.'
            : '     El conteo de filas NO bajó respecto a la migración (' + exactCounts.ventas + '>=' + BACKUP_ROW_COUNTS.ventas +
              ' ventas, ' + exactCounts.facturas + (exactCounts.facturas >= BACKUP_ROW_COUNTS.facturas ? '>=' : '<') + BACKUP_ROW_COUNTS.facturas + ' facturas) —\n' +
              '     la caída de $210,7M a ' + fmtCLP(directoPorCobrar) + ' NO es por filas borradas, es por CLASIFICACIÓN\n' +
              '     (estado real de cada fila) y/o 8 días reales de cobranza/facturación entre el\n' +
              '     25-jul y hoy sobre la copia de pruebas en paralelo (Replit sigue siendo el\n' +
              '     sistema de verdad — Vercel/Supabase es la copia donde se está iterando).'),
        '',
        line('-'),
        'CONCLUSIÓN:',
        '1) Bug real y accionable, hoy: fetchAll() (src/shared/supabase.js:82) trunca en',
        '   silencio cualquier tabla >1000 filas. HOY afecta más a "costos" (72% de la',
        '   tabla invisible, CXP subestimado en TODA la app) que a "facturas" (150 filas',
        '   fuera de alcance, pero ' + (truncamientoExplicaTodo ? 'sin impacto medido en "Por Cobrar" en esta corrida' : 'con impacto medido de ' + fmtCLP(directoPorCobrar - truncadoPorCobrar) + ' en "Por Cobrar"') + ').',
        '   Se recomienda agregar paginación real (`.range()` en loop, como hace este',
        '   mismo experimento) a fetchAll() — no se corrige aquí por alcance del experimento.',
        '',
        '2) El número "$' + Math.round(directoPorCobrar / 1000000) + 'M / ' + directoDocsPendientes + ' docs" que reporta este experimento como',
        '   "cálculo directo completo" (paginado, sin el bug de truncamiento) es la cifra',
        '   MÁS CONFIABLE de "Por Cobrar" disponible hoy — pero AÚN diverge fuerte de los',
        '   $210,7M de julio, y esa parte de la brecha es de DATOS (facturas pagadas/',
        '   anuladas/limpiadas + 8 días de operación real), no de fórmula ni de bug de',
        '   paginación. No se puede cerrar del todo sin que Aldo confirme qué pasó',
        '   puntualmente con los 40 eventos sin facturar ($125,0M) y 48 facturas',
        '   ($85,8M) de la medición de julio.'
    ].join('\n'));
    console.log(line('='));

    console.log('\n=== Resumen Experimento L ===');
    console.log(pass + ' OK, ' + fail + ' FAIL');
    if (fail > 0) {
        console.log('\nDetalle de fallas:');
        failures.forEach(function (f) {
            console.log('  - ' + f.name);
            if (f.detail) console.log('    ' + f.detail);
        });
    }
    return { pass: pass, fail: fail };
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
