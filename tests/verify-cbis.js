// Verificación C-bis — carga el finance.js REAL (jsdom, no réplica) y ejecuta los 4 fixes
// vía la API real (computeKPIs) y vía interacción DOM real (clicks) para el popup, el sort
// y el flujo de facturación parcial. Correr con: node verify-cbis.js
'use strict';
const assert = require('assert');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPO = path.join(__dirname, '..');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  OK  ' + name); }
    catch (e) { fail++; console.error('FAIL  ' + name + ' — ' + (e && e.message)); }
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

function todayDMY() {
    var d = new Date();
    return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
}

// ---- DOM real (jsdom) ----
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
global.window = dom.window;
global.document = dom.window.document;
global.alert = function (msg) { global.__lastAlert = msg; };
global.confirm = function () { return true; };
global.localStorage = dom.window.localStorage;

// ---- Mazelab namespace + Money real (misma fuente de verdad que usa finance.js) ----
window.Mazelab = { Modules: {}, Money: require(REPO + '/src/shared/money.js') };

// ---- Mock DataService: "servidor" en memoria. Solo intercepta la persistencia;
// TODA la lógica de negocio ejecutada es la real de finance.js. ----
var DB = { receivables: [], sales: [] };
var log = { created: [], updated: [], removed: [] };
window.Mazelab.DataService = {
    getAll: async function (table) { return (DB[table] || []).slice(); },
    create: async function (table, rec) { DB[table].push(rec); log.created.push(Object.assign({}, rec)); },
    update: async function (table, id, upd) {
        var row = DB[table].find(function (r) { return String(r.id) === String(id); });
        if (row) Object.assign(row, upd);
        log.updated.push({ id: id, upd: upd });
    },
    remove: async function (table, id) {
        DB[table] = DB[table].filter(function (r) { return String(r.id) !== String(id); });
        log.removed.push(id);
    },
    isUsingSupabase: function () { return false; }
};
var genCount = 0;
window.Mazelab.Storage = { generateId: function () { return 'gen-' + (++genCount); } };

require(REPO + '/src/modules/finance/finance.js');
const FM = window.Mazelab.Modules.FinanceModule;

function settle(ms) { return new Promise(function (r) { setTimeout(r, ms || 30); }); }

(async function () {
    document.body.innerHTML = FM.render();

    // =====================================================================
    // (1) Factura con ncAsociada poblada visible en KPIs (computeKPIs real)
    // =====================================================================
    (function () {
        var F_bug = {
            id: 'F-bug', tipoDoc: 'F', invoiceNumber: 'F-BUG', sourceId: '900', saleId: 's-900',
            montoNeto: 5000000, monto_venta: 5000000, invoicedAmount: 5000000, montoFacturado: 5000000,
            status: 'pendiente_pago', billingMonth: '01/06/2026', paymentTerms: 30, payments: [],
            ncAsociada: 'ALGO' // columna poblada por error de import CSV — esta fila NO es una NC (tipoDoc F)
        };
        var kpis = FM.computeKPIs([F_bug]);
        t('(1) factura con ncAsociada poblada SÍ aparece en facturadoPendientes', function () {
            assert.ok(kpis.data.facturadoPendientes.some(function (r) { return r.id === 'F-bug'; }));
        });
        t('(1) el KPI totalPorCobrar suma su pendiente ($5.950.000, no $0)', function () {
            assert.strictEqual(kpis.totalPorCobrar, 5950000);
        });
    })();

    // =====================================================================
    // (2) Encabezado del popup de KPIs = suma de la columna "Pendiente"
    //     (click real sobre la card, popup real, lectura del DOM real)
    // =====================================================================
    await (async function () {
        var Fa = {
            id: 'kp-a', tipoDoc: 'F', invoiceNumber: 'A-1', sourceId: '100', saleId: 'sa',
            montoNeto: 1000000, montoFacturado: 1000000, invoicedAmount: 1000000,
            status: 'pendiente_pago', billingMonth: todayDMY(), paymentTerms: 30, payments: [],
            clientName: 'Cliente A', eventName: 'Evento A'
        };
        var NCa = {
            id: 'kp-nc', tipoDoc: 'NC', ncAsociada: 'A-1', sourceId: '100', montoNeto: 200000,
            montoFacturado: 200000, invoicedAmount: 200000, status: 'nc_aplicada', billingMonth: todayDMY()
        };
        var Fb = {
            id: 'kp-b', tipoDoc: 'F', invoiceNumber: 'B-1', sourceId: '101', saleId: 'sb',
            montoNeto: 500000, montoFacturado: 500000, invoicedAmount: 500000,
            status: 'pendiente_pago', billingMonth: todayDMY(), paymentTerms: 30, payments: [],
            clientName: 'Cliente B', eventName: 'Evento B'
        };
        DB.receivables = [Fa, NCa, Fb];
        DB.sales = [];
        FM.init();
        await settle(50);

        var card = document.getElementById('kpi-en-plazo');
        assert.ok(card, 'la card kpi-en-plazo debe existir en el DOM real renderizado');
        card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await settle(20);

        var header = document.querySelector('#kpi-status-overlay .modal-header h3');
        assert.ok(header, 'el popup debe abrir');
        var headerTotal = parseCLP(header.textContent);
        var rows = Array.from(document.querySelectorAll('#kpi-status-overlay tbody tr'));
        assert.strictEqual(rows.length, 2, 'deben mostrarse Fa y Fb (la NC no es una fila facturada)');
        var columnSum = rows.reduce(function (s, tr) { return s + parseCLP(tr.children[6].textContent); }, 0);
        var oldBuggyTotal = Math.round(1000000 * 1.19) + Math.round(500000 * 1.19); // montoIVA sin descontar NC

        t('(2) el total del encabezado = suma de la columna "Pendiente" ($1.547.000)', function () {
            assert.strictEqual(headerTotal, columnSum);
            assert.strictEqual(headerTotal, 1547000); // (1.000.000-200.000)*1.19 + 500.000*1.19
        });
        t('(2) el total NO es la fórmula vieja getMonto*1.19 sin NC ($1.785.000)', function () {
            assert.notStrictEqual(headerTotal, oldBuggyTotal);
        });

        document.getElementById('kpi-status-close').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await settle(10);
    })();

    // =====================================================================
    // (3) Orden por "Restante" coincide con lo mostrado
    //     (click real sobre el header de columna, lectura del DOM real)
    // =====================================================================
    await (async function () {
        var SF = {
            id: 'sf-1', tipoDoc: 'F', sourceId: '200', saleId: 'ssf',
            montoNeto: 2000000, invoicedAmount: 0, montoFacturado: 0,
            status: 'pendiente_factura', payments: [], clientName: 'Cliente SF', eventName: 'Evento SF'
        };
        var FInv = {
            id: 'fi-1', tipoDoc: 'F', invoiceNumber: 'C-1', sourceId: '201', saleId: 'sfi',
            montoNeto: 1000000, montoFacturado: 1000000, invoicedAmount: 1000000,
            status: 'pendiente_pago', billingMonth: todayDMY(), paymentTerms: 30, payments: [],
            clientName: 'Cliente FI', eventName: 'Evento FI'
        };
        DB.receivables = [SF, FInv];
        DB.sales = [];
        FM.init();
        await settle(50);

        var sortTh = document.querySelector('.finance-sort-th[data-sort="pending"]');
        assert.ok(sortTh, 'el header de columna Restante debe existir');
        sortTh.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await settle(20);

        var bodyRows = Array.from(document.querySelectorAll('#finance-content table.data-table > tbody > tr'))
            .filter(function (tr) { return tr.children.length > 5; }); // descarta la fila de filtros (colspan)
        var displayed = bodyRows.map(function (tr) { return parseCLP(tr.children[6].textContent); });

        t('(3) hay 2 filas mostradas (SF y FInv)', function () {
            assert.strictEqual(displayed.length, 2);
        });
        t('(3) el orden asc coincide con los valores REALMENTE mostrados: [1.190.000, 2.380.000]', function () {
            assert.deepStrictEqual(displayed, [1190000, 2380000]);
        });
        t('(3) la fila sin factura (restante > 0 mostrado) NO quedó ordenada como si fuera $0', function () {
            // Bug viejo: getPendienteFacturado(SF) = 0 (sin monto facturado) → SF habría quedado primera.
            assert.notStrictEqual(displayed[0], 0);
            assert.strictEqual(displayed[0], 1190000); // FInv primero (valor real más chico)
        });
    })();

    // =====================================================================
    // (4) Facturación parcial: cobros/notas_cobranza se MUEVEN (no se duplican);
    //     avisos_factura queda en la residual (fix O1 — pertenece a la fila que
    //     sigue pendiente de facturar, no a la factura ya emitida)
    //     (click real "Facturar" → completar modal → click real "Guardar Factura")
    // =====================================================================
    await (async function () {
        var residual = {
            id: 'res-1', tipoDoc: 'F', saleId: 'sale-9', sourceId: '850',
            montoNeto: 1000000, monto_venta: 1000000, invoicedAmount: 0, montoFacturado: 0,
            status: 'sin_factura', payments: [],
            eventName: 'Evento X', clientName: 'Cliente X',
            avisos_factura: [{ fecha: '2026-01-01', nota: 'aviso previo' }],
            notas_cobranza: [{ fecha: '2026-01-05', nota: 'nota previa' }],
            cobros: [{ fecha: '2026-01-10', tipo: 'cobro previo' }]
        };
        var venta = { id: 'sale-9', sourceId: '850', eventName: 'Evento X', clientName: 'Cliente X' };
        DB.receivables = [residual];
        DB.sales = [venta];
        log.created = []; log.updated = []; log.removed = [];
        FM.init();
        await settle(50);

        var facBtn = document.querySelector('.btn-facturar[data-id="res-1"]');
        assert.ok(facBtn, 'el botón Facturar debe existir para la fila residual sin factura');
        facBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await settle(20);

        var numberInput = document.getElementById('fac-number');
        var amountInput = document.getElementById('fac-amount');
        assert.ok(numberInput && amountInput, 'el modal Registrar Factura debe estar abierto');
        numberInput.value = 'F-200';
        amountInput.value = '600000'; // parcial: 600k de 1.000.000 → netoRestante 400k > 0

        document.getElementById('fac-save-btn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await settle(80);

        var finalReceivables = await window.Mazelab.DataService.getAll('receivables');
        var nueva = finalReceivables.find(function (r) { return r.invoiceNumber === 'F-200'; });
        var residualFinal = finalReceivables.find(function (r) { return r.id === 'res-1'; });

        t('(4) se creó la factura F-200 con cobros/notas_cobranza HEREDADOS y SIN avisos_factura (fix O1)', function () {
            assert.ok(nueva, 'la factura F-200 debe existir');
            assert.strictEqual(log.created.length, 1);
            assert.strictEqual(log.created[0].avisos_factura, undefined, 'la factura NO debe recibir avisos_factura');
            assert.strictEqual(log.created[0].notas_cobranza.length, 1);
            assert.strictEqual(log.created[0].cobros.length, 1);
            assert.strictEqual(log.created[0].cobros[0].tipo, 'cobro previo');
        });
        t('(4) la residual (400k restantes) CONSERVA avisos_factura y queda con notas_cobranza/cobros VACÍOS (fix O1)', function () {
            assert.ok(residualFinal, 'la residual debe seguir existiendo (netoRestante 400k > 0)');
            assert.strictEqual(residualFinal.monto_venta, 400000);
            assert.strictEqual(residualFinal.invoicedAmount, 0);
            assert.strictEqual(residualFinal.avisos_factura.length, 1, 'avisos_factura debe seguir en la residual (sigue pendiente de facturar)');
            assert.strictEqual(residualFinal.avisos_factura[0].nota, 'aviso previo');
            assert.deepStrictEqual(residualFinal.notas_cobranza, []);
            assert.deepStrictEqual(residualFinal.cobros, []);
        });
        t('(4) el historial no se duplicó: 1 sola fila tiene cada aviso/cobro, no N+1', function () {
            var conAvisos = finalReceivables.filter(function (r) { return Array.isArray(r.avisos_factura) && r.avisos_factura.length > 0; });
            var conCobros = finalReceivables.filter(function (r) { return Array.isArray(r.cobros) && r.cobros.length > 0; });
            assert.strictEqual(conAvisos.length, 1);
            assert.strictEqual(conCobros.length, 1);
        });
    })();

    console.log('\n' + pass + ' OK, ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
})().catch(function (e) {
    console.error('ERROR FATAL:', e);
    process.exit(1);
});
