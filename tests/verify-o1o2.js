// Verificación O1/O2 (revisión Opus commit 5b48285) — carga el finance.js REAL (jsdom)
// y ejecuta los 2 fixes vía la API real (DOM real, clicks reales, DataService mock).
// Correr con: node verify-o1o2.js
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

function todayDMY() {
    var d = new Date();
    return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
}

// ---- DOM real (jsdom) ----
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
global.window = dom.window;
global.document = dom.window.document;
var lastAlert = null;
global.alert = function (msg) { lastAlert = msg; };
global.confirm = function () { return true; };
global.localStorage = dom.window.localStorage;

// ---- Mazelab namespace + Money real ----
window.Mazelab = { Modules: {}, Money: require(REPO + '/src/shared/money.js') };

// ---- Mock DataService: "servidor" en memoria. Solo intercepta persistencia. ----
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
    // (1) Facturación parcial: la residual CONSERVA avisos_factura y la
    //     factura nueva NO los tiene; cobros/notas_cobranza sí se mueven.
    //     (repite el escenario de verify-cbis.js test (4) como caso
    //     independiente y explícito del fix O1)
    // =====================================================================
    await (async function () {
        var residual = {
            id: 'res-o1', tipoDoc: 'F', saleId: 'sale-o1', sourceId: '851',
            montoNeto: 1000000, monto_venta: 1000000, invoicedAmount: 0, montoFacturado: 0,
            status: 'sin_factura', payments: [],
            eventName: 'Evento O1', clientName: 'Cliente O1',
            avisos_factura: [{ fecha: '2026-02-01', nota: 'solicitud OC' }],
            notas_cobranza: [{ fecha: '2026-02-05', nota: 'nota previa' }],
            cobros: [{ fecha: '2026-02-10', tipo: 'cobro previo' }]
        };
        var venta = { id: 'sale-o1', sourceId: '851', eventName: 'Evento O1', clientName: 'Cliente O1' };
        DB.receivables = [residual];
        DB.sales = [venta];
        log.created = []; log.updated = []; log.removed = [];
        FM.init();
        await settle(50);

        var facBtn = document.querySelector('.btn-facturar[data-id="res-o1"]');
        assert.ok(facBtn, 'el botón Facturar debe existir para la fila residual sin factura');
        facBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await settle(20);

        document.getElementById('fac-number').value = 'F-O1';
        document.getElementById('fac-amount').value = '600000'; // parcial: netoRestante 400k > 0
        document.getElementById('fac-save-btn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await settle(80);

        var finalReceivables = await window.Mazelab.DataService.getAll('receivables');
        var nueva = finalReceivables.find(function (r) { return r.invoiceNumber === 'F-O1'; });
        var residualFinal = finalReceivables.find(function (r) { return r.id === 'res-o1'; });

        t('(O1-1) la factura nueva NO tiene avisos_factura', function () {
            assert.ok(nueva, 'la factura F-O1 debe existir');
            assert.strictEqual(nueva.avisos_factura, undefined);
        });
        t('(O1-1) la factura nueva SÍ hereda notas_cobranza y cobros', function () {
            assert.strictEqual(nueva.notas_cobranza.length, 1);
            assert.strictEqual(nueva.cobros.length, 1);
            assert.strictEqual(nueva.cobros[0].tipo, 'cobro previo');
        });
        t('(O1-1) la residual CONSERVA avisos_factura (sigue pendiente de facturar)', function () {
            assert.ok(residualFinal, 'la residual debe seguir existiendo (netoRestante 400k > 0)');
            assert.strictEqual(residualFinal.avisos_factura.length, 1);
            assert.strictEqual(residualFinal.avisos_factura[0].nota, 'solicitud OC');
        });
        t('(O1-1) la residual queda con notas_cobranza y cobros VACÍOS (se movieron a la factura)', function () {
            assert.deepStrictEqual(residualFinal.notas_cobranza, []);
            assert.deepStrictEqual(residualFinal.cobros, []);
        });
    })();

    // =====================================================================
    // (2) openNCModal sobre fila SIN invoiceNumber → alert + modal NO abre
    // =====================================================================
    await (async function () {
        var recSinNumero = {
            id: 'rec-sin-num', tipoDoc: 'F', invoiceNumber: '', sourceId: '852', saleId: 'sale-sn',
            montoNeto: 500000, montoFacturado: 500000, invoicedAmount: 500000,
            status: 'pendiente_pago', billingMonth: todayDMY(), paymentTerms: 30, payments: [],
            clientName: 'Cliente SN', eventName: 'Evento SN'
        };
        DB.receivables = [recSinNumero];
        DB.sales = [];
        FM.init();
        await settle(50);

        lastAlert = null;
        document.getElementById('finance-modal-container').innerHTML = ''; // aseguramos estado limpio

        // openNCModal no está expuesta en la API pública del módulo (solo render/init/computeKPIs),
        // y el fix O2 además retira el botón NC del render para filas sin invoiceNumber (ver caso 3).
        // Para probar el guard DENTRO de openNCModal en forma aislada (debe defenderse aunque se
        // invoque por otra vía — código legado, consola, futuro atajo de teclado, etc.), inyectamos
        // un botón .btn-nc manualmente con el data-id de la fila sin número y dejamos que
        // attachTableListeners (disparado por FM.init) lo enganche con el manejador real.
        var btn = document.createElement('button');
        btn.className = 'btn-nc';
        btn.setAttribute('data-id', 'rec-sin-num');
        document.body.appendChild(btn);
        FM.init(); // re-bind delegando sobre el botón inyectado manualmente
        await settle(20);
        btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await settle(20);

        t('(O2-2) al invocar openNCModal sobre fila sin invoiceNumber, se dispara el alert de bloqueo', function () {
            assert.ok(lastAlert, 'debe haberse llamado alert()');
            assert.ok(/N.? de factura/.test(lastAlert), 'el mensaje debe mencionar el N° de factura: "' + lastAlert + '"');
        });
        t('(O2-2) el modal de NC NO se abre (no existe #nc-modal-overlay)', function () {
            assert.strictEqual(document.getElementById('nc-modal-overlay'), null);
        });

        btn.remove();
    })();

    // =====================================================================
    // (3) El botón NC no se renderiza para filas sin invoiceNumber
    // =====================================================================
    await (async function () {
        var conNumero = {
            id: 'rec-con-num', tipoDoc: 'F', invoiceNumber: 'F-999', sourceId: '853', saleId: 'sale-cn',
            montoNeto: 700000, montoFacturado: 700000, invoicedAmount: 700000,
            status: 'pendiente_pago', billingMonth: todayDMY(), paymentTerms: 30, payments: [],
            clientName: 'Cliente CN', eventName: 'Evento CN'
        };
        var sinNumero = {
            id: 'rec-sin-num-2', tipoDoc: 'F', invoiceNumber: '', sourceId: '854', saleId: 'sale-sn2',
            montoNeto: 400000, montoFacturado: 400000, invoicedAmount: 400000,
            status: 'pendiente_pago', billingMonth: todayDMY(), paymentTerms: 30, payments: [],
            clientName: 'Cliente SN2', eventName: 'Evento SN2'
        };
        DB.receivables = [conNumero, sinNumero];
        DB.sales = [];
        FM.init();
        await settle(50);

        t('(O2-3) el botón NC SÍ aparece para la fila CON invoiceNumber', function () {
            assert.ok(document.querySelector('.btn-nc[data-id="rec-con-num"]'), 'debe existir el botón NC para rec-con-num');
        });
        t('(O2-3) el botón NC NO aparece para la fila SIN invoiceNumber', function () {
            assert.strictEqual(document.querySelector('.btn-nc[data-id="rec-sin-num-2"]'), null, 'no debe existir el botón NC para rec-sin-num-2');
        });
    })();

    console.log('\n' + pass + ' OK, ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
})().catch(function (e) {
    console.error('ERROR FATAL:', e);
    process.exit(1);
});
