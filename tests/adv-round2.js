/* Re-revision independiente de bb732f4. Harness nuevo, escrito por el revisor,
   sin depender de adv-lote-d.js (que fue editado por el implementador). */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const SALES = process.argv[2] || path.join(__dirname, '..', 'src/modules/sales/sales.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log('  OK   ' + name); }
    else { fail++; console.log('  FAIL ' + name + (extra ? '  ->  ' + extra : '')); }
}

const CLIENTS = [{ id: 'c1', name: 'ACME SpA' }];
const SERVICES = [{ id: 's1', name: 'Glambot', categoria: 'Foto' }];
const STAFF = [{ id: 'st1', name: 'Pedro' }];

function env(salesData, receivables) {
    const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>',
        { runScripts: 'outside-only', pretendToBeVisual: true });
    const win = dom.window;
    const ops = { u: [], c: [], warns: [] };
    win.console = Object.assign({}, console, { warn: function (m) { ops.warns.push(String(m)); } });
    win.Mazelab = {
        Modules: {},
        Storage: { generateId: (function () { let n = 0; return function () { return 'gen-' + (++n); }; })() },
        DataService: {
            getAll: async function (t) {
                if (t === 'sales') return JSON.parse(JSON.stringify(salesData));
                if (t === 'clients') return JSON.parse(JSON.stringify(CLIENTS));
                if (t === 'services') return JSON.parse(JSON.stringify(SERVICES));
                if (t === 'staff') return JSON.parse(JSON.stringify(STAFF));
                if (t === 'receivables') return JSON.parse(JSON.stringify(receivables));
                return [];
            },
            update: async function (t, id, d) { ops.u.push({ t, id, d }); return d; },
            create: async function (t, d) { ops.c.push({ t, d }); return d; },
            remove: async function (t, id) { ops.removes = ops.removes || []; ops.removes.push(id); }
        }
    };
    win.alert = function () {}; win.confirm = function () { return true; };
    win.eval(fs.readFileSync(SALES, 'utf8'));
    return { win, ops };
}

async function editar(salesData, receivables, editId, mutar) {
    const e = env(salesData, receivables);
    const d = e.win.document;
    d.getElementById('app').innerHTML = e.win.Mazelab.Modules.SalesModule.render();
    await e.win.Mazelab.Modules.SalesModule.init();
    d.querySelector('.btn-edit-sale[data-id="' + editId + '"]').dispatchEvent(new e.win.MouseEvent('click', { bubbles: true }));
    if (mutar) mutar(d);
    d.getElementById('sale-form').dispatchEvent(new e.win.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(function (r) { setTimeout(r, 400); });
    e.ru = e.ops.u.filter(function (x) { return x.t === 'receivables'; });
    e.rc = e.ops.c.filter(function (x) { return x.t === 'receivables'; });
    e.doc = d;
    return e;
}

const VENTA = { id: '101', sourceId: '101', clientName: 'ACME SpA', eventName: 'Gala',
    eventDate: '2026-08-01', amount: 1000000, serviceIds: [], status: 'pendiente' };
function venta(over) { return Object.assign({}, VENTA, over || {}); }
function cxc(over) {
    return Object.assign({ id: 'x', sourceId: '101', saleId: '101', sourceType: 'auto',
        monto_venta: 400000, montoNeto: 400000, amount: 400000, invoicedAmount: 0, status: 'sin_factura',
        eventName: 'Gala', eventDate: '2026-08-01', clientName: 'ACME SpA' }, over || {});
}
const FACT = cxc({ id: 'f1', sourceType: 'factura', invoiceNumber: 'F-500', tipoDoc: 'F',
    montoNeto: 600000, invoicedAmount: 600000, monto_venta: 600000, amount: undefined, status: 'pendiente_pago' });
const NC = cxc({ id: 'nc1', tipoDoc: 'NC', invoiceNumber: 'NC-77', montoNeto: 100000,
    invoicedAmount: 100000, montoFacturado: 100000, status: 'nc_aplicada', sourceType: undefined });
const RESID = cxc({ id: 'res1' });

function dump(e) {
    console.log('     updates: ' + JSON.stringify(e.ru.map(function (x) {
        return { id: x.id, campos: Object.keys(x.d).join('|'), monto: x.d.monto_venta };
    })) + '   creates: ' + e.rc.length + (e.ops.warns.length ? '   warns: ' + e.ops.warns.length : ''));
}

(async function () {
    // ---------- (b) NC fuera del filtro primario ----------
    console.log('\n### 1. Venta 1M con factura 600k + residual 400k + NC 100k');
    let e = await editar([venta()], [FACT, RESID, NC], '101');
    dump(e);
    const uF = e.ru.find(function (x) { return x.id === 'f1'; });
    const uR = e.ru.find(function (x) { return x.id === 'res1'; });
    const uN = e.ru.find(function (x) { return x.id === 'nc1'; });
    check('(b) la NC no recibe NINGUN update', !uN, uN ? JSON.stringify(uN.d) : '');
    check('(b) INVARIANTE los montos de la NC nunca se escriben', !uN || uN.d.monto_venta === undefined);
    check('(b) residual = 400000 (la NC ya no infla totalAlreadyInvoiced)', !!uR && uR.d.monto_venta === 400000, uR ? String(uR.d.monto_venta) : 'sin update');
    check('(b) factura solo recibe metadata', !!uF && Object.keys(uF.d).sort().join(',') === 'clientName,eventDate,eventName', uF ? Object.keys(uF.d).join('|') : 'sin update');
    check('(b) residual sin invoicedAmount (invariante Lote C)', !!uR && uR.d.invoicedAmount === undefined);
    check('(b) sin CXC creada', e.rc.length === 0, 'n=' + e.rc.length);

    // ---------- (a) fuzzy endurecido ----------
    console.log('\n### 2a. CXC de OTRA venta (saleId 202) con mismo evento/cliente/fecha');
    e = await editar([venta()], [cxc({ id: 'ajena', saleId: '202', sourceId: '202', monto_venta: 250000, montoNeto: 250000, amount: 250000 })], '101');
    dump(e);
    check('(a) NO secuestra la CXC ajena', !e.ru.some(function (x) { return x.id === 'ajena'; }), 'la toco');
    check('(a) crea CXC propia en su lugar', e.rc.length === 1, 'n=' + e.rc.length);

    console.log('\n### 2b. FACTURA huerfana con mismo evento/cliente/fecha');
    e = await editar([venta()], [cxc({ id: 'fact-huerf', saleId: '', sourceId: '', sourceType: 'factura', invoiceNumber: 'F-9', invoicedAmount: 700000, montoNeto: 700000, monto_venta: 700000, status: 'pendiente_pago' })], '101');
    dump(e);
    check('(a) no adopta una FACTURA por fuzzy', !e.ru.some(function (x) { return x.id === 'fact-huerf'; }));
    check('(a) crea CXC propia', e.rc.length === 1, 'n=' + e.rc.length);

    console.log('\n### 2c. Venta SIN eventDate -> fuzzy desactivado');
    e = await editar([venta({ id: '303', sourceId: '303', eventDate: '' })],
        [cxc({ id: 'v1', saleId: '', sourceId: '', eventDate: '', monto_venta: 100000 }),
         cxc({ id: 'v2', saleId: '', sourceId: '', eventDate: '', monto_venta: 200000 })], '303');
    dump(e);
    check('(a) sin eventDate no barre CXC ajenas', e.ru.length === 0, JSON.stringify(e.ru.map(function (x) { return x.id; })));
    check('(a) crea una sola CXC propia', e.rc.length === 1, 'n=' + e.rc.length);

    console.log('\n### 2c-bis. Venta SIN eventName -> fuzzy desactivado');
    e = await editar([venta({ id: '304', sourceId: '304', eventName: '' })],
        [cxc({ id: 'w1', saleId: '', sourceId: '', eventName: '', monto_venta: 100000 })], '304');
    dump(e);
    check('(a) sin eventName no adopta', e.ru.length === 0, JSON.stringify(e.ru.map(function (x) { return x.id; })));

    console.log('\n### 2d. DOS candidatas huerfanas ambiguas -> no adopta ninguna');
    e = await editar([venta()],
        [cxc({ id: 'h1', saleId: '', sourceId: '', monto_venta: 100000 }),
         cxc({ id: 'h2', saleId: '', sourceId: '', monto_venta: 200000 })], '101');
    dump(e);
    check('(a) con 2 candidatas no adopta ninguna', e.ru.length === 0, JSON.stringify(e.ru.map(function (x) { return x.id; })));
    check('(a) crea una sola CXC propia', e.rc.length === 1, 'n=' + e.rc.length);

    console.log('\n### 2e. UNA huerfana exacta -> SI la adopta (objetivo D1: sin fantasma)');
    e = await editar([venta()], [cxc({ id: 'huerf', saleId: '', sourceId: '', monto_venta: 999 })], '101');
    dump(e);
    check('(a) adopta la unica huerfana', e.ru.length === 1 && e.ru[0].id === 'huerf' && e.ru[0].d.monto_venta === 1000000, JSON.stringify(e.ru));
    check('(a) NO crea fantasma', e.rc.length === 0, 'n=' + e.rc.length);

    console.log('\n### 2f. saleId vacio pero sourceId de OTRA venta -> no adopta');
    e = await editar([venta()], [cxc({ id: 'mixta', saleId: '', sourceId: '202', monto_venta: 250000 })], '101');
    dump(e);
    check('(a) no adopta con sourceId ajeno', !e.ru.some(function (x) { return x.id === 'mixta'; }));
    check('(a) crea CXC propia', e.rc.length === 1, 'n=' + e.rc.length);

    // ---------- (c) residual unico ----------
    console.log('\n### 3. DOS residuales ligadas por ID a la misma venta');
    e = await editar([venta()], [cxc({ id: 'res-a' }), cxc({ id: 'res-b' })], '101');
    dump(e);
    const conMonto = e.ru.filter(function (x) { return x.d.monto_venta !== undefined; });
    check('(c) solo UNA residual recibe monto', conMonto.length === 1, 'n=' + conMonto.length + ' -> ' + JSON.stringify(conMonto.map(function (x) { return x.id; })));
    check('(c) es la primera (res-a)', conMonto.length === 1 && conMonto[0].id === 'res-a', conMonto.length ? conMonto[0].id : '');
    check('(c) monto correcto = 1000000', conMonto.length === 1 && conMonto[0].d.monto_venta === 1000000, conMonto.length ? String(conMonto[0].d.monto_venta) : '');
    check('(c) console.warn emitido', e.ops.warns.length === 1, JSON.stringify(e.ops.warns));
    check('(c) la segunda residual queda intacta', !e.ru.some(function (x) { return x.id === 'res-b'; }), 'res-b fue tocada');

    // ---------- 2 (regresiones nuevas) ----------
    console.log('\n### 4. Venta SOLO con facturas (sin residual)');
    e = await editar([venta()], [FACT], '101');
    dump(e);
    check('(2) factura solo metadata', e.ru.length === 1 && e.ru[0].id === 'f1' && e.ru[0].d.monto_venta === undefined, JSON.stringify(e.ru));
    check('(2) no crea CXC (ya hay linkedCXC)', e.rc.length === 0, 'n=' + e.rc.length);
    console.log('     NOTA: los 400.000 no facturados quedan sin fila CXC (comportamiento previo, no regresion).');

    console.log('\n### 5. Venta SOLO con residual');
    e = await editar([venta()], [RESID], '101');
    dump(e);
    check('(2) residual recibe el monto completo 1000000', e.ru.length === 1 && e.ru[0].d.monto_venta === 1000000, JSON.stringify(e.ru));
    check('(2) sin creates', e.rc.length === 0);
    check('(2) sin warns', e.ops.warns.length === 0, JSON.stringify(e.ops.warns));

    console.log('\n### 6. Cero CXC -> crea exactamente una, con invariantes de Lote C');
    e = await editar([venta()], [], '101');
    dump(e);
    check('(2) crea exactamente 1', e.rc.length === 1, 'n=' + e.rc.length);
    check('(2) nace con invoicedAmount 0 y status sin_factura',
        e.rc.length === 1 && e.rc[0].d.invoicedAmount === 0 && e.rc[0].d.status === 'sin_factura', JSON.stringify(e.rc[0] && e.rc[0].d));

    console.log('\n### 7. Residual legacy (invoicedAmount>0 + status sin_factura) sigue siendo residual');
    e = await editar([venta()], [cxc({ id: 'legacy', invoicedAmount: 400000, status: 'sin_factura' })], '101');
    dump(e);
    check('(2) isFacturaCXC movida no rompe el guard de status',
        e.ru.length === 1 && e.ru[0].id === 'legacy' && e.ru[0].d.monto_venta === 1000000, JSON.stringify(e.ru));

    console.log('\n### 8. Renombre del evento con CXC huerfana (limite conocido)');
    e = await editar([venta({ sourceId: '' })], [cxc({ id: 'vieja', saleId: '', sourceId: '', eventName: 'Gala' })], '101',
        function (d) { d.getElementById('sale-event-name').value = 'Gala 2026'; });
    dump(e);
    console.log('     (informativo) al renombrar, el fuzzy no reconoce la huerfana -> se crea otra fila');

    // ---------- (d) columna ID ----------
    console.log('\n### 9. Filtro de columna ID y busqueda global con sourceId vacio');
    const e9 = env([{ id: 'abc-uuid-999', sourceId: '', clientName: 'BETA', eventName: 'Lanzamiento',
        eventDate: '2026-09-10', amount: 500000, status: 'pendiente' }], []);
    const d9 = e9.win.document;
    d9.getElementById('app').innerHTML = e9.win.Mazelab.Modules.SalesModule.render();
    await e9.win.Mazelab.Modules.SalesModule.init();
    check('(d) la tabla muestra sale.id', d9.querySelector('#sales-table-body tr').children[0].textContent.trim() === 'abc-uuid-999');
    const f9 = d9.querySelector('#sales-table .col-filter[data-col="sourceId"]');
    f9.value = 'abc'; f9.dispatchEvent(new e9.win.Event('input', { bubbles: true }));
    const t1 = d9.querySelector('#sales-table-body tr').textContent;
    check('(d) el filtro de columna ID encuentra la fila', t1.indexOf('abc-uuid-999') !== -1, t1.trim().slice(0, 40));
    f9.value = ''; f9.dispatchEvent(new e9.win.Event('input', { bubbles: true }));
    const s9 = d9.getElementById('sales-search');
    s9.value = 'abc'; s9.dispatchEvent(new e9.win.Event('input', { bubbles: true }));
    const t2 = d9.querySelector('#sales-table-body tr').textContent;
    check('(d) la busqueda global encuentra la fila', t2.indexOf('abc-uuid-999') !== -1, t2.trim().slice(0, 40));

    console.log('\n===== ' + pass + ' OK, ' + fail + ' FAIL =====');
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
