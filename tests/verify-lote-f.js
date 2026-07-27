// Verificación Lote F (Sprint 1, Task 8) — carga el dashboard.js REAL (jsdom, no réplica)
// y ejecuta buildCommissionCard() (expuesta en el return del módulo, mismo patrón que
// computeKPIs en finance.js) con los 6 casos del plan. Correr con: node verify-lote-f.js
'use strict';
const assert = require('assert');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPO = path.join(__dirname, '..');
const MONEY_PATH = REPO + '/src/shared/money.js';
const DASH_PATH = REPO + '/src/modules/dashboard/dashboard.js';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  OK  ' + name); }
    catch (e) { fail++; console.error('FAIL  ' + name + ' — ' + (e && e.stack ? e.stack : e)); }
}

function parseCLP(str) {
    if (str == null) return NaN;
    var m = String(str).match(/-?\$[\d.]+/);
    if (!m) return NaN;
    var s = m[0];
    var neg = /^-/.test(s);
    var digits = s.replace(/[^0-9]/g, '');
    var n = Number(digits) || 0;
    return neg ? -n : n;
}

// ---- DOM real (jsdom) + Mazelab namespace con Money real ----
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
global.window = dom.window;
global.document = dom.window.document;

window.Mazelab = { Modules: {}, Money: require(MONEY_PATH) };
require(DASH_PATH);
const DM = window.Mazelab.Modules.DashboardModule;

const THIS_YEAR = new Date().getFullYear();
const EVENT_DATE = THIS_YEAR + '-05-15';

function findExec(html, name) {
    // Extrae la fila <tr> de la tabla de comisiones para el ejecutivo dado y devuelve
    // [ventas, monto, pctProm, comision] parseados desde las celdas <td>.
    var re = new RegExp('<tr>\\s*<td[^>]*><strong>' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
        '</strong></td>([\\s\\S]*?)</tr>');
    var m = html.match(re);
    if (!m) return null;
    var cells = m[1].match(/<td[^>]*>([\s\S]*?)<\/td>/g).map(function (c) {
        return c.replace(/<[^>]+>/g, '').trim();
    });
    return { ventas: Number(cells[0]), monto: parseCLP(cells[1]), pct: parseFloat(cells[2]), comision: parseCLP(cells[3]) };
}

(function () {

    // ================= Caso de control del plan =================
    // venta neta 1.000.000, pct 10, costo 400.000 (efectivo), CXC pagada 595.000 (con IVA)
    // → cobradoNeto 500.000 → utilidad 600.000 → comisión = 10% × 600.000 × (500.000/1.000.000) = $30.000
    t('(1) caso de control: comisión = $30.000', function () {
        var sales = [{ id: 's1', sourceId: '100', eventDate: EVENT_DATE, amount: 1000000, comisionPct: 10, staffName: 'Ana' }];
        var payables = [{ eventId: '100', docType: 'efectivo', amount: 400000, billingDate: EVENT_DATE }];
        var receivables = [{ tipoDoc: 'F', saleId: 's1', payments: [{ amount: 595000 }] }];
        var html = DM.buildCommissionCard(sales, receivables, payables);
        var row = findExec(html, 'Ana');
        assert.ok(row, 'debe existir la fila de Ana');
        assert.strictEqual(row.comision, 30000);
        assert.strictEqual(row.ventas, 1);
        assert.strictEqual(row.pct, 10);
    });

    // ================= (2) todo cobrado → $60.000 =================
    t('(2) todo cobrado (CXC 1.190.000 con IVA = 1.000.000 neto) → comisión $60.000', function () {
        var sales = [{ id: 's2', sourceId: '101', eventDate: EVENT_DATE, amount: 1000000, comisionPct: 10, staffName: 'Bea' }];
        var payables = [{ eventId: '101', docType: 'efectivo', amount: 400000, billingDate: EVENT_DATE }];
        var receivables = [{ tipoDoc: 'F', saleId: 's2', payments: [{ amount: 1190000 }] }];
        var html = DM.buildCommissionCard(sales, receivables, payables);
        var row = findExec(html, 'Bea');
        assert.ok(row, 'debe existir la fila de Bea');
        assert.strictEqual(row.comision, 60000);
    });

    // ================= (3) nada cobrado → $0 =================
    t('(3) nada cobrado → comisión $0', function () {
        var sales = [{ id: 's3', sourceId: '102', eventDate: EVENT_DATE, amount: 1000000, comisionPct: 10, staffName: 'Caro' }];
        var payables = [{ eventId: '102', docType: 'efectivo', amount: 400000, billingDate: EVENT_DATE }];
        var receivables = [{ tipoDoc: 'F', saleId: 's3', payments: [] }];
        var html = DM.buildCommissionCard(sales, receivables, payables);
        var row = findExec(html, 'Caro');
        assert.ok(row, 'debe existir la fila de Caro (con 0 comisión, no debe desaparecer)');
        assert.strictEqual(row.comision, 0);
    });

    // ================= (4) con refundAmount 200.000 → utilidad y proporción usan 800.000 =================
    // ventaNeta = 1.000.000 - 200.000 = 800.000. Costo 400.000 efectivo → utilidad 400.000.
    // CXC pagada 476.000 (con IVA) → cobradoNeto = round(476000/1.19) = 400.000.
    // proporción = 400.000/800.000 = 0.5 → comisión = 10% × 400.000 × 0.5 = $20.000
    t('(4) refundAmount 200.000 → utilidad/proporción usan venta neta 800.000, comisión $20.000', function () {
        var sales = [{ id: 's4', sourceId: '103', eventDate: EVENT_DATE, amount: 1000000, refundAmount: 200000, comisionPct: 10, staffName: 'Deni' }];
        var payables = [{ eventId: '103', docType: 'efectivo', amount: 400000, billingDate: EVENT_DATE }];
        var receivables = [{ tipoDoc: 'F', saleId: 's4', payments: [{ amount: 476000 }] }];
        var html = DM.buildCommissionCard(sales, receivables, payables);
        var row = findExec(html, 'Deni');
        assert.ok(row, 'debe existir la fila de Deni');
        assert.strictEqual(row.comision, 20000);
        // El monto mostrado en la tabla ("Monto") es la venta bruta, no la neta —
        // pero el cálculo interno de utilidad/proporción sí usa la neta (verificado por el resultado $20.000).
        assert.strictEqual(row.monto, 1000000);
    });

    // ================= (5) atribución: staffId + catálogo staff → aparece bajo el nombre, no "Sin asignar" =================
    // Nota: dashboard.js resuelve staffId→staffName en init() ANTES de llamar a buildDashboard/
    // buildCommissionCard (líneas ~1404-1411: staffMap desde DataService.getAll('staff'), luego
    // "if (!s.staffName && s.staffId && staffMap[s.staffId]) s.staffName = staffMap[s.staffId];").
    // Replicamos ese mismo paso aquí para probar el flujo real end-to-end.
    t('(5) atribución por staffId (vía catálogo staff) → nombre correcto, no "Sin asignar"', function () {
        var staffList = [{ id: 'st2', name: 'Francisca Soto' }];
        var staffMap = {};
        staffList.forEach(function (st) { staffMap[st.id] = st.name || st.nombre || st.id; });
        var sales = [{ id: 's5', sourceId: '104', eventDate: EVENT_DATE, amount: 1000000, comisionPct: 10, staffId: 'st2' }];
        // Replica el enriquecimiento real de init():
        sales.forEach(function (s) {
            if (!s.staffName && s.staffId && staffMap[s.staffId]) s.staffName = staffMap[s.staffId];
        });
        var payables = [];
        var receivables = [{ tipoDoc: 'F', saleId: 's5', payments: [{ amount: 1190000 }] }];
        var html = DM.buildCommissionCard(sales, receivables, payables);
        var row = findExec(html, 'Francisca Soto');
        assert.ok(row, 'debe existir la fila "Francisca Soto" resuelta desde staffId');
        assert.ok(!/Sin asignar/.test(html) || html.indexOf('Francisca Soto') !== -1, 'no debe caer en Sin asignar');
        // Confirma explícitamente que NO aparece como "Sin asignar"
        var sinAsignarRow = findExec(html, 'Sin asignar');
        assert.strictEqual(sinAsignarRow, null, 'esta venta con staffId resuelto NO debe caer en la fila "Sin asignar"');
    });

    // ================= (6) BH de 1.000.000 como costo → costoEmpresa 1.179.941 en la utilidad =================
    // ventaNeta 1.000.000, BH 1.000.000 (líquido) en 2026 → costoEmpresa = 1.000.000 + 179.941 = 1.179.941
    // utilidad = 1.000.000 - 1.179.941 = -179.941 (negativa) → comisionDevengada clampa a 0 vía Math.max(0, utilidad)
    // Para observar el costo BH reflejado en una utilidad positiva, se agrega venta neta mayor.
    t('(6) BH 1.000.000 como costo → costoEmpresa 1.179.941 reduce la utilidad correctamente', function () {
        var sales = [{ id: 's6', sourceId: '105', eventDate: EVENT_DATE, amount: 3000000, comisionPct: 10, staffName: 'Elio' }];
        // BH de 1.000.000 líquido, emitido en 2026 → costoEmpresa = 1.179.941 (tabla SII)
        var payables = [{ eventId: '105', docType: 'bh', amount: 1000000, billingDate: '2026-05-01' }];
        // utilidad = 3.000.000 - 1.179.941 = 1.820.059; CXC pagada íntegra (3.570.000 con IVA → neto 3.000.000)
        // proporción = 1 → comisión = 10% × 1.820.059 × 1 = 182.006 (round)
        var receivables = [{ tipoDoc: 'F', saleId: 's6', payments: [{ amount: 3570000 }] }];
        var html = DM.buildCommissionCard(sales, receivables, payables);
        var row = findExec(html, 'Elio');
        assert.ok(row, 'debe existir la fila de Elio');
        var utilidadEsperada = 3000000 - 1179941; // 1.820.059
        var comisionEsperada = Math.round(0.10 * utilidadEsperada * 1); // 182.006
        assert.strictEqual(comisionEsperada, 182006, 'sanity check del cálculo esperado');
        assert.strictEqual(row.comision, comisionEsperada, 'la comisión debe reflejar el costo empresa BH de 1.179.941 restado de la utilidad');
    });

    // ================= Guarda defensiva: sin window.Mazelab.Money no debe crashear =================
    t('(guarda) sin window.Mazelab.Money → comisión 0, no crashea', function () {
        var savedMoney = window.Mazelab.Money;
        delete window.Mazelab.Money;
        try {
            var sales = [{ id: 's7', sourceId: '106', eventDate: EVENT_DATE, amount: 1000000, comisionPct: 10, staffName: 'Gaby' }];
            var payables = [{ eventId: '106', docType: 'efectivo', amount: 400000, billingDate: EVENT_DATE }];
            var receivables = [{ tipoDoc: 'F', saleId: 's7', payments: [{ amount: 595000 }] }];
            var html;
            assert.doesNotThrow(function () { html = DM.buildCommissionCard(sales, receivables, payables); });
            var row = findExec(html, 'Gaby');
            assert.ok(row, 'la fila debe seguir apareciendo aunque Money no exista');
            assert.strictEqual(row.comision, 0);
        } finally {
            window.Mazelab.Money = savedMoney;
        }
    });

    // ================= Subtítulo visible =================
    t('(subtítulo) la tarjeta muestra el subtítulo de la fórmula', function () {
        var sales = [{ id: 's8', sourceId: '107', eventDate: EVENT_DATE, amount: 1000000, comisionPct: 10, staffName: 'Hugo' }];
        var html = DM.buildCommissionCard(sales, [], []);
        assert.ok(/Comisión devengada por cobro \(% × utilidad × proporción cobrada\)/.test(html), 'debe incluir el subtítulo exacto pedido');
    });

    console.log('\n' + pass + ' OK, ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
})();
