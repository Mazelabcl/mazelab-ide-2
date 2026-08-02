// Verificación ronda 2 (B1, I1-I4, M1-M3) — carga el MÓDULO REAL finance.js en Node
// y ejecuta computeKPIs de verdad. Correr con: node verify-finance-round2.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');

// ---- Reloj congelado — 2026-07-26T12:00:00 hora local ----
// finance.js resuelve "mes en curso" y "IVA declarado" con new Date() real
// (getCurrentMonthKey, isIvaPaid). Los fixtures de este archivo (billingMonth
// "05/07/2026" / "26/07/2026") solo son "del mes en curso" el día en que se
// escribieron. Se congela el reloj global de Node a esa fecha ANTES de requerir
// finance.js para que los asserts de mes/IVA sean deterministas sin importar
// cuándo se corra la suite. Con argumentos, FixedDate delega en el Date real.
const REAL_DATE = Date;
const FROZEN_ISO = '2026-07-26T12:00:00';
class FixedDate extends REAL_DATE {
    constructor(...args) {
        if (args.length === 0) super(FROZEN_ISO);
        else super(...args);
    }
    static now() { return new REAL_DATE(FROZEN_ISO).getTime(); }
}
global.Date = FixedDate;

// ---- Bootstrap de entorno browser mínimo (finance.js no toca DOM al cargar) ----
global.window = global;
window.Mazelab = { Modules: {}, Money: require(REPO + '/src/shared/money.js') };
require(REPO + '/src/modules/finance/finance.js');
const FM = window.Mazelab.Modules.FinanceModule;
const M = window.Mazelab.Money;
const SRC = fs.readFileSync(REPO + '/src/modules/finance/finance.js', 'utf8');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  OK  ' + name); }
    catch (e) { fail++; console.error('FAIL  ' + name + ' — ' + e.message); }
}

function mkF(num, neto, extra) {
    return Object.assign({
        id: 'row-' + num, tipoDoc: 'F', invoiceNumber: num, sourceId: '850', saleId: 's1',
        montoNeto: neto, monto_venta: neto, invoicedAmount: neto, montoFacturado: neto,
        status: 'pendiente_pago', billingMonth: '01/07/2026', paymentTerms: 30, payments: []
    }, extra || {});
}

// ================= B1 — NC asociada NO contamina facturas hermanas =================
// Escenario adversarial: venta 1.000.000 facturada parcial F1 600k + F2 400k,
// NC 200k asociada a F1, mismo sourceId 850.
(function () {
    var F1 = mkF('F1', 600000), F2 = mkF('F2', 400000);
    var NC = { id: 'nc1', tipoDoc: 'NC', invoiceNumber: '77', ncAsociada: 'F1', sourceId: '850', saleId: 's1',
               montoNeto: 200000, montoFacturado: 200000, invoicedAmount: 200000, status: 'nc_aplicada', billingMonth: '26/07/2026' };
    var kpis = FM.computeKPIs([F1, F2, NC]);
    t('B1: la NC asociada a F1 solo descuenta en F1 (_ncOffset F1=200k, F2=0)', function () {
        assert.strictEqual(F1._ncOffset, 200000);
        assert.strictEqual(F2._ncOffset, 0);
    });
    t('B1: total facturado pendiente = $952.000 (no $714.000)', function () {
        assert.strictEqual(kpis.totalPorCobrar, 952000);
        var totalPend = 0;
        kpis.data.facturadoPendientes.forEach(function (r) {
            totalPend += M.pendienteFacturadoRow({ tipoDoc: r.tipoDoc, facturadoNeto: r.montoFacturado, ncNeto: r._ncOffset || 0, pagado: 0 });
        });
        assert.strictEqual(totalPend, 952000); // 476.000 + 476.000
    });
    // NC ≥ hermana: NC de 600k asociada a F1 — F2 (400k) jamás debe quedar 'pagada'
    var G1 = mkF('G1', 600000), G2 = mkF('G2', 400000);
    var NCbig = Object.assign({}, NC, { id: 'nc2', ncAsociada: 'G1', montoNeto: 600000, montoFacturado: 600000, invoicedAmount: 600000 });
    var kpis2 = FM.computeKPIs([G1, G2, NCbig]);
    t('B1: con NC 600k asociada a G1 → G1 pagada, G2 NUNCA pagada (pendiente $476.000)', function () {
        assert.strictEqual(G1._realStatus, 'pagada');
        assert.notStrictEqual(G2._realStatus, 'pagada');
        assert.strictEqual(kpis2.totalPorCobrar, 476000);
    });
    // El fallback por sourceId sigue vivo para NCs SIN factura asociada
    var H1 = mkF('H1', 500000, { sourceId: '900' });
    var NCloose = { id: 'nc3', tipoDoc: 'NC', sourceId: '900', montoNeto: 100000, montoFacturado: 100000, invoicedAmount: 100000, status: 'nc_aplicada', billingMonth: '26/07/2026' };
    FM.computeKPIs([H1, NCloose]);
    t('B1: NC sin ncAsociada mantiene el fallback por sourceId (_ncOffset=100k)', function () {
        assert.strictEqual(H1._ncOffset, 100000);
    });
})();

// ================= I1 — computeKPIs(receivables, sales) enriquece internamente =================
(function () {
    function fixture() {
        return {
            recs: [{ id: 'sf1', tipoDoc: 'F', saleId: 's9', montoNeto: 1000000, monto_venta: 1000000, invoicedAmount: 0,
                     status: 'sin_factura', eventDate: '2026-07-01', payments: [] }],
            sales: [{ id: 's9', sourceId: '901', refundAmount: 300000, eventDate: '2026-07-01' }]
        };
    }
    // "Página CXC": loadAndRender ahora llama computeKPIs(allReceivables, cachedSales)
    var a = fixture();
    var kpisFinance = FM.computeKPIs(a.recs, a.sales);
    // "Dashboard": mismo call con su propia copia de los datos
    var b = fixture();
    var kpisDash = FM.computeKPIs(b.recs, b.sales);
    t('I1: computeKPIs enriquece _refundAmount desde sales (300k)', function () {
        assert.strictEqual(a.recs[0]._refundAmount, 300000);
    });
    t('I1: página CXC y dashboard producen EL MISMO número (sin factura neto 700k → porCobrar 833k)', function () {
        assert.strictEqual(kpisFinance.totalSinFacturaNeto, 700000);
        assert.strictEqual(kpisFinance.totalPorCobrar, Math.round(700000 * 1.19));
        assert.deepStrictEqual(
            { sf: kpisFinance.totalSinFacturaNeto, pc: kpisFinance.totalPorCobrar, mio: kpisFinance.totalLoQueEsMio },
            { sf: kpisDash.totalSinFacturaNeto,    pc: kpisDash.totalPorCobrar,    mio: kpisDash.totalLoQueEsMio }
        );
    });
    t('I1: sin el parámetro sales no crashea y conserva el enriquecimiento previo', function () {
        var kpis3 = FM.computeKPIs(a.recs);
        assert.strictEqual(a.recs[0]._refundAmount, 300000);
        assert.strictEqual(kpis3.totalSinFacturaNeto, 700000);
    });
    t('I1: match también por sale.sourceId (saleId de la CXC apunta al sourceId)', function () {
        var recs = [{ id: 'sf2', tipoDoc: 'F', saleId: '901', montoNeto: 500000, status: 'sin_factura', eventDate: '2026-07-01', payments: [] }];
        FM.computeKPIs(recs, [{ id: 's9', sourceId: '901', refundAmount: 100000 }]);
        assert.strictEqual(recs[0]._refundAmount, 100000);
    });
})();

// ================= I2 — markAsPaid y modal abono usan getPendienteFacturado =================
(function () {
    // Caso de control numérico: F 1.500.000 + NC 200.000 → restante $1.547.000
    var F5 = mkF('F5', 1500000);
    var NC = { id: 'nc5', tipoDoc: 'NC', ncAsociada: 'F5', sourceId: '850', montoNeto: 200000, montoFacturado: 200000, invoicedAmount: 200000, status: 'nc_aplicada', billingMonth: '26/07/2026' };
    FM.computeKPIs([F5, NC]);
    var restante = M.pendienteFacturadoRow({ tipoDoc: 'F', facturadoNeto: 1500000, ncNeto: F5._ncOffset, pagado: 0 });
    t('I2: Pagado Total sobre F 1.5M + NC 200k registraría $1.547.000 (no $1.785.000)', function () {
        assert.strictEqual(F5._ncOffset, 200000);
        assert.strictEqual(restante, 1547000);
    });
    t('I2 (fuente): markAsPaid usa getPendienteFacturado, sin montoFacturado×1.19', function () {
        var body = SRC.split('async function markAsPaid')[1].split('// ===')[0];
        assert.ok(/var restante = getPendienteFacturado\(rec\);/.test(body));
        assert.ok(!/getMontoFacturado\(rec\) \* 1\.19/.test(body));
    });
    t('I2 (fuente): renderAbonoModal calcula Restante con getPendienteFacturado', function () {
        var body = SRC.split('function renderAbonoModal')[1].split('// ===')[0];
        assert.ok(/var restante = getPendienteFacturado\(receivable\);/.test(body));
    });
})();

// ================= I3 — billingMonth de NC en DD/MM/YYYY + guard de isIvaPaid =================
(function () {
    // La NC del fixture B1/I2 usa billingMonth '26/07/2026' (mes actual 2026-07):
    // con el formato bueno, matchesBillingMonth SÍ la encuentra → resta en "Facturado Este Mes"
    var F = mkF('F9', 1000000, { billingMonth: '05/07/2026' });
    var NCok = { id: 'nc9', tipoDoc: 'NC', ncAsociada: 'F9', sourceId: '850', montoNeto: 200000, montoFacturado: 200000, invoicedAmount: 200000, status: 'nc_aplicada', billingMonth: '26/07/2026' };
    var kpisOk = FM.computeKPIs([F, NCok]);
    t('I3: NC con DD/MM/YYYY resta en el mes (ncMes=200k, facturadoNetoMes=800k)', function () {
        assert.strictEqual(kpisOk.ncMes, 200000);
        assert.strictEqual(kpisOk.facturadoNetoMes, 800000);
    });
    var NCbad = Object.assign({}, NCok, { id: 'nc10', billingMonth: '26-07-2026' }); // formato viejo con guiones
    var kpisBad = FM.computeKPIs([mkF('F9', 1000000, { billingMonth: '05/07/2026' }), NCbad]);
    t('I3: el formato viejo "26-07-2026" NO matcheaba el mes (ncMes=0) — bug demostrado', function () {
        assert.strictEqual(kpisBad.ncMes, 0);
    });
    t('I3 (fuente): openNCModal ya no usa toLocaleDateString y arma DD/MM/YYYY', function () {
        var body = SRC.split('function openNCModal')[1].split('async function deleteReceivable')[0];
        // sin llamada real .toLocaleDateString( — la mención en comentario no cuenta
        assert.ok(!/\.toLocaleDateString\(/.test(body));
        assert.ok(/getDate\(\)\)\.padStart\(2, '0'\) \+ '\/'/.test(body));
    });
    // Guard de isIvaPaid: billingMonth con guiones legado "26-07-2026" parsea year=26 →
    // sin guard, "Lo que es mío" trataba el IVA como declarado (inflado a 1.190.000)
    var Flegacy = mkF('F11', 1000000, { billingMonth: '26-07-2026' });
    var kpisLegacy = FM.computeKPIs([Flegacy]);
    t('I3: guard de año — billingMonth "26-07-2026" → IVA NO declarado → mío = $1.000.000 (no $1.190.000)', function () {
        assert.strictEqual(kpisLegacy.totalLoQueEsMio, 1000000);
    });
})();

// ================= I4 — N° de factura obligatorio en ambos modales =================
(function () {
    t('I4 (fuente): openFacturarModal exige invoiceNumber', function () {
        var body = SRC.split('function openFacturarModal')[1].split('function openSolicitarOCModal')[0];
        assert.ok(/if \(!invoiceNumber\) \{\s*\n?\s*alert\('Ingresa el N° de factura\.'\);/.test(body));
    });
    t('I4 (fuente): openNuevaFacturaModal exige invoiceNumber', function () {
        var body = SRC.split('function openNuevaFacturaModal')[1].split('function openFacturarModal')[0];
        assert.ok(/if \(!invoiceNumber\) \{ alert\('Ingresa el N° de factura\.'\); return; \}/.test(body));
    });
})();

// ================= M1 — código muerto eliminado =================
(function () {
    t('M1: getPendienteItem y getMontoAfterRefund ya no existen', function () {
        assert.ok(SRC.indexOf('getPendienteItem') === -1);
        assert.ok(SRC.indexOf('getMontoAfterRefund') === -1);
    });
})();

// ================= M2 — popup Sin Factura cuadra con el KPI =================
(function () {
    t('M2 (fuente): popup Sin Factura usa getPendienteSinFacturaNeto', function () {
        var body = SRC.split("var kpiSinFactura")[1].split('kpiStatusCards')[0];
        assert.ok(/formatCLP\(getPendienteSinFacturaNeto\(r\)\)/.test(body));
        assert.ok(!/formatCLP\(getMonto\(r\)\)/.test(body));
    });
})();

// ================= M3 — total de grupo suma también las filas sin factura =================
(function () {
    t('M3 (fuente): encabezado de grupo usa getRestanteCell (no solo getPendienteFacturado)', function () {
        var body = SRC.split('function renderGroupedCXC')[1].split('// ===')[0];
        assert.ok(/return s \+ getRestanteCell\(r, rs\)\.restante;/.test(body));
    });
    // Numérico con la misma derivación: grupo con F 1.5M+NC 200k y sin-factura 1M con refund 300k
    var F = mkF('F12', 1500000);
    var NC = { id: 'nc12', tipoDoc: 'NC', ncAsociada: 'F12', sourceId: '850', montoNeto: 200000, montoFacturado: 200000, invoicedAmount: 200000, status: 'nc_aplicada', billingMonth: '26/07/2026' };
    var SF = { id: 'sf12', tipoDoc: 'F', saleId: 's9', montoNeto: 1000000, invoicedAmount: 0, status: 'sin_factura', eventDate: '2026-07-01', payments: [] };
    FM.computeKPIs([F, NC, SF], [{ id: 's9', refundAmount: 300000 }]);
    var totalGrupo = [F, NC, SF].reduce(function (s, r) {
        var rs = r._realStatus;
        if (rs === 'pagada' || rs === 'anulada' || rs === 'nc') return s;
        // réplica exacta de getRestanteCell
        if (rs === 'pendiente_factura' || rs === 'post_evento_sin_factura') {
            var neto = Number(r.montoNeto) || 0;
            var pendNeto = M.pendienteSinFacturaRow({ neto: neto, refundNeto: r._refundAmount || 0, pagado: 0 });
            return s + Math.round(pendNeto * 1.19);
        }
        return s + M.pendienteFacturadoRow({ tipoDoc: r.tipoDoc, facturadoNeto: r.montoFacturado || 0, ncNeto: r._ncOffset || 0, pagado: 0 });
    }, 0);
    t('M3: total del grupo = $1.547.000 + $833.000 = $2.380.000 (la sin-factura ya no aporta $0)', function () {
        assert.strictEqual(totalGrupo, 1547000 + 833000);
    });
})();

console.log('\n' + pass + ' OK, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
