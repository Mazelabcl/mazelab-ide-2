// Verificación Lote E (Sprint 1, Tasks 6/7 + mitigación I7) — carga el código REAL
// (src/shared/data-service.js, src/modules/finance/finance.js) en Node con
// fetch/window/DOM mockeados. Correr con: node verify-lote-e.js
//
// NOTA (Sprint M1, Lote M1-B, actualizada en el fix round — hallazgo I9): esta
// suite probaba data-service.js contra un shim local que replicaba el
// contrato EXTERNO viejo (fetch a /api/db) — "teatro" que no ejercitaba el
// src/shared/supabase.js real en absoluto. Ahora carga supabase.js REAL con
// window.supabase.createClient mockeado (mismo patrón que tests/verify-adapter.js:
// un query builder encadenable que registra las llamadas y resuelve según un
// guion configurable por tabla+método). Los tests (1) y (2) citaban el
// formato viejo de mensaje de error ("HTTP 500", literal de red) — se
// actualizaron al contrato nuevo de supabase.js ("Error al leer/actualizar
// <tabla>: <mensaje>"), conservando la intención (update lanza en error;
// fetchAll lanza en error). Los tests (3)-(5) solo cambian el MECANISMO de
// scripting (antes fetch, ahora el cliente mockeado); su intención y
// aserciones de comportamiento no cambiaron. Los tests (6a)/(6b) construyen
// su propio window.Mazelab.DataService inline y nunca pasaron por el shim —
// quedan intactos.
'use strict';
const assert = require('assert');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPO = path.join(__dirname, '..');
const DS_PATH       = path.join(REPO, 'src/shared/data-service.js');
const SUPABASE_PATH = path.join(REPO, 'src/shared/supabase.js');
const FINANCE_PATH  = path.join(REPO, 'src/modules/finance/finance.js');
const MONEY_PATH    = path.join(REPO, 'src/shared/money.js');

// Mock de supabase-js — copiado del patrón de tests/verify-adapter.js: query
// builder encadenable mínimo que registra las llamadas hechas (tabla, método,
// args) y resuelve según un guion configurable por tabla+método.
function makeMockSupabaseClient(script) {
    const calls = [];

    function makeBuilder(table) {
        const state = { table: table, method: null, args: [] };
        const builder = {
            select: function (col, opts) {
                state.selectArgs = [col, opts];
                if (state.method === null) state.method = 'select';
                return builder;
            },
            insert: function (record) { state.method = 'insert'; state.args = [record]; return builder; },
            update: function (updates) { state.method = 'update'; state.args = [updates]; return builder; },
            upsert: function (records, opts) { state.method = 'upsert'; state.args = [records, opts]; return builder; },
            delete: function () { state.method = 'delete'; return builder; },
            eq: function (col, val) { state.eq = { col: col, val: val }; return builder; },
            order: function (col) { state.order = col; return builder; },
            limit: function (n) { state.limitArgs = n; return builder; },
            single: function () { state.single = true; return resolveFor(state); },
            then: function (resolve, reject) { return resolveFor(state).then(resolve, reject); }
        };
        return builder;
    }

    function resolveFor(state) {
        calls.push({ table: state.table, method: state.method, args: state.args, eq: state.eq, order: state.order, limitArgs: state.limitArgs, single: !!state.single, selectArgs: state.selectArgs });
        const key = state.table + '.' + state.method;
        const scripted = script[key];
        const result = typeof scripted === 'function' ? scripted(state) : (scripted || { data: null, error: null });
        return Promise.resolve(result);
    }

    const client = { from: function (table) { return makeBuilder(table); } };
    return { client: client, calls: calls };
}

let pass = 0, fail = 0;
async function at(name, fn) {
    try { await fn(); pass++; console.log('  OK  ' + name); }
    catch (e) { fail++; console.error('FAIL  ' + name + ' — ' + (e && e.stack ? e.stack : e)); }
}

async function assertRejects(promiseOrFn, matcher) {
    let threw = false, err = null;
    try {
        const p = typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn;
        await p;
    } catch (e) { threw = true; err = e; }
    assert.ok(threw, 'se esperaba que lanzara/rechazara, pero no lo hizo');
    if (matcher) assert.ok(matcher.test(err.message), 'mensaje no matchea ' + matcher + ': "' + err.message + '"');
    return err;
}

function fakeStorageService(seed) {
    var data = (seed || []).slice();
    return {
        getAll:   function ()      { return data.slice(); },
        getById:  function (id)    { return data.find(function (x) { return x.id === id; }) || null; },
        create:   function (r)     { data.push(r); return r; },
        update:   function (id, u) { var i = data.findIndex(function (x) { return x.id === id; }); if (i !== -1) Object.assign(data[i], u); return data[i]; },
        remove:   function (id)    { data = data.filter(function (x) { return x.id !== id; }); return true; },
        importMany: function (rs)  { data = data.concat(rs); return rs; }
    };
}

// Simula una carga de página nueva: limpia el require cache de supabase.js/data-service.js
// y reconstruye window.Mazelab desde cero, para que cada escenario parta con el mismo
// estado inicial (initialized=false, useSupabase=false, readOnly=false).
// opts.script: guion tabla.método -> respuesta, para el cliente supabase-js mockeado
// (ver makeMockSupabaseClient arriba) — reemplaza al viejo opts.fetch.
function freshEnv(opts) {
    opts = opts || {};
    delete require.cache[require.resolve(DS_PATH)];
    delete require.cache[require.resolve(SUPABASE_PATH)];

    global.window = {};
    global.window.location = { search: opts.search || '' };

    var uiCalls = { toast: [], offline: 0, testMode: 0 };
    global.window.Mazelab = {
        UI: {
            toast: function (msg, type) { uiCalls.toast.push({ msg: msg, type: type }); },
            showOfflineBanner: function () { uiCalls.offline++; },
            showTestModeBanner: function () { uiCalls.testMode++; }
        },
        Storage: {
            generateId: function () { return 'gen-' + Math.random().toString(36).slice(2); },
            SalesService:        fakeStorageService(),
            ServicesService:     fakeStorageService(),
            StaffService:        fakeStorageService(),
            ClientsService:      fakeStorageService(),
            ReceivablesService:  fakeStorageService(),
            PayablesService:     fakeStorageService(),
            BodegaService:       fakeStorageService(),
            CotizacionesService: fakeStorageService()
        }
    };

    var mock = makeMockSupabaseClient(opts.script || {});
    global.window.supabase = { createClient: function () { return mock.client; } };

    require(SUPABASE_PATH);
    require(DS_PATH);

    return {
        window: global.window,
        uiCalls: uiCalls,
        DS: global.window.Mazelab.DataService,
        Supabase: global.window.Mazelab.Supabase,
        calls: mock.calls
    };
}

(async function () {

    // ================= (1) update en error → lanza (ya no null) =================
    // Contrato nuevo de supabase.js (I9): "Error al actualizar en <tabla>: <mensaje>"
    // — reemplaza al viejo "HTTP 500". La intención se conserva: update() lanza en error.
    await at('(1) Supabase.update lanza en error, ya no devuelve null', async function () {
        var env = freshEnv({ script: { 'ventas.update': { data: null, error: { message: 'internal server error' } } } });
        var err = await assertRejects(env.Supabase.update('ventas', '1', { foo: 1 }), /^Error al actualizar en ventas: internal server error$/);
        assert.notStrictEqual(err, null);
    });

    // ================= (2) fetchAll con red caída → lanza (ya no []) =================
    // Contrato nuevo de supabase.js (I9): "Error al leer <tabla>: <mensaje>" —
    // reemplaza al viejo literal de red. La intención se conserva: fetchAll() lanza en error.
    await at('(2) Supabase.fetchAll lanza si la red está caída, ya no devuelve []', async function () {
        var env = freshEnv({ script: { 'ventas.select': { data: null, error: { message: 'ECONNREFUSED' } } } });
        await assertRejects(env.Supabase.fetchAll('ventas'), /^Error al leer ventas: ECONNREFUSED$/);
    });

    // ================= (3) getAll con servidor OK y tabla vacía → [] SIN caer a localStorage =================
    await at('(3) getAll: servidor OK + tabla vacía devuelve [] SIN fallback a localStorage', async function () {
        var localCalled = false;
        var env = freshEnv({ script: { 'ventas.select': { data: [], error: null } } });
        env.window.Mazelab.Storage.SalesService.getAll = function () { localCalled = true; return [{ id: 'no-debiera-verse' }]; };
        await env.DS.init();
        assert.strictEqual(env.DS.isUsingSupabase(), true);
        var result = await env.DS.getAll('sales');
        assert.deepStrictEqual(result, []);
        assert.strictEqual(localCalled, false, 'NO debió consultar localStorage como fallback ante array vacío legítimo');
    });

    // ================= (4) readOnly activo → create lanza ANTES de tocar red =================
    await at('(4) readOnly activo: create lanza ANTES de llamar al cliente Supabase', async function () {
        var env = freshEnv({});
        // Conexión inicial falla → init() debe activar readOnly y mostrar el banner offline
        env.window.Mazelab.Supabase.testConnection = function () { return Promise.resolve(false); };
        await env.DS.init();
        assert.strictEqual(env.DS.readOnly, true, 'readOnly debe quedar activo tras fallo de conexión inicial');
        assert.ok(env.uiCalls.offline >= 1, 'showOfflineBanner debe haberse llamado al activarse readOnly');

        await assertRejects(env.DS.create('sales', { foo: 1 }), /solo lectura/);
        await assertRejects(env.DS.update('sales', 'x', { foo: 1 }), /solo lectura/);
        await assertRejects(env.DS.remove('sales', 'x'), /solo lectura/);
        assert.strictEqual(env.calls.length, 0, 'ningún CRUD debió tocar el cliente Supabase real estando en readOnly');
    });

    // ================= (5) ?localdev=1 → modo localStorage + banner de prueba =================
    await at('(5) ?localdev=1 activa modo local, llama showTestModeBanner, y NO toca el cliente Supabase', async function () {
        var env = freshEnv({ search: '?localdev=1' });
        env.window.Mazelab.Storage.SalesService = fakeStorageService([{ id: 's1' }]);
        await env.DS.init();
        assert.strictEqual(env.DS.isUsingSupabase(), false, 'en localdev NO debe usar el servidor');
        assert.strictEqual(env.DS.isLocalDev(), true);
        assert.strictEqual(env.uiCalls.testMode, 1, 'showTestModeBanner debe llamarse exactamente una vez');
        assert.strictEqual(env.uiCalls.offline, 0, 'localdev no es un fallo de conexión — no debe mostrar el banner offline');

        var all = await env.DS.getAll('sales');
        assert.deepStrictEqual(all, [{ id: 's1' }]);
        assert.strictEqual(env.calls.length, 0, 'localdev no debe llamar al cliente Supabase en ningún momento');

        // Y create/update/remove deben escribir en localStorage (modo prueba explícito, no fallback)
        var created = await env.DS.create('sales', { id: 's2', amount: 100 });
        assert.ok(created);
        var again = await env.DS.getAll('sales');
        assert.strictEqual(again.length, 2);
        assert.strictEqual(env.calls.length, 0, 'localdev tampoco debe tocar el cliente Supabase en create/getAll subsecuentes');
    });

    // ================= (6) compensación de crearFacturaYCerrarResidual (I7) =================
    // 6a: update de la residual falla, el delete compensatorio SÍ funciona →
    //     la factura recién creada se elimina y se relanza el error ORIGINAL.
    await at('(6a) update de residual falla → factura creada se compensa (delete) y se relanza el error original', async function () {
        delete require.cache[require.resolve(FINANCE_PATH)];
        delete require.cache[require.resolve(MONEY_PATH)];

        var dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
        global.window = dom.window;
        global.document = dom.window.document;
        global.alert = function () {};
        global.confirm = function () { return true; };

        var log = { created: [], updated: [], removed: [] };
        var toastCalls = [];
        window.Mazelab = {
            Modules: {},
            Money: require(MONEY_PATH),
            Storage: { generateId: function () { return 'newfac-1'; } },
            UI: { toast: function (msg, type) { toastCalls.push({ msg: msg, type: type }); }, showOfflineBanner: function () {}, showTestModeBanner: function () {} },
            DataService: {
                getAll: async function (table) {
                    if (table === 'receivables') return [{
                        id: 'res-1', tipoDoc: 'F', saleId: 'sale-9', sourceId: '850',
                        montoNeto: 1000000, monto_venta: 1000000, invoicedAmount: 0, montoFacturado: 0,
                        status: 'sin_factura', payments: [], eventName: 'Evento X', clientName: 'Cliente X', eventDate: '2026-07-01'
                    }];
                    if (table === 'sales') return [{ id: 'sale-9', sourceId: '850', eventName: 'Evento X', clientName: 'Cliente X' }];
                    return [];
                },
                create: async function (table, rec) { log.created.push(rec); return rec; },
                update: async function (table, id, upd) { log.updated.push({ id: id, upd: upd }); throw new Error('update residual falló (simulado)'); },
                remove: async function (table, id) { log.removed.push(id); return true; },
                isUsingSupabase: function () { return false; }
            }
        };

        require(FINANCE_PATH);
        var FM = window.Mazelab.Modules.FinanceModule;

        document.body.innerHTML = FM.render();
        FM.init();
        await new Promise(function (r) { setTimeout(r, 50); });

        var facBtn = document.querySelector('.btn-facturar[data-id="res-1"]');
        assert.ok(facBtn, 'el botón Facturar debe existir para la residual sin_factura');
        facBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await new Promise(function (r) { setTimeout(r, 20); });

        document.getElementById('fac-number').value = 'F-COMP-1';
        document.getElementById('fac-amount').value = '600000'; // parcial: 600k de 1.000.000 → update() de la residual (no remove)

        document.getElementById('fac-save-btn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await new Promise(function (r) { setTimeout(r, 80); });

        assert.strictEqual(log.created.length, 1, 'la factura debe haberse creado (paso 1 exitoso)');
        assert.strictEqual(log.created[0].invoiceNumber, 'F-COMP-1');
        assert.strictEqual(log.updated.length, 1, 'el update de la residual debe haberse intentado');
        assert.strictEqual(log.removed.length, 1, 'debe haberse intentado el delete compensatorio de la factura');
        assert.strictEqual(log.removed[0], log.created[0].id, 'el delete compensatorio debe apuntar a la factura recién creada, no a la residual');

        var errToast = toastCalls.find(function (c) { return c.type === 'error'; });
        assert.ok(errToast, 'debe haberse mostrado un toast de error');
        assert.ok(/update residual falló \(simulado\)/.test(errToast.msg), 'el error propagado debe ser el ORIGINAL (compensación exitosa → relanza), no el de "no reintentes". Mensaje real: ' + errToast.msg);
    });

    // 6b: update de la residual falla Y el delete compensatorio TAMBIÉN falla →
    //     debe lanzarse el error especial "NO reintentes...".
    await at('(6b) si además el delete compensatorio falla → error especial "NO reintentes"', async function () {
        delete require.cache[require.resolve(FINANCE_PATH)];
        delete require.cache[require.resolve(MONEY_PATH)];

        var dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
        global.window = dom.window;
        global.document = dom.window.document;
        global.alert = function () {};
        global.confirm = function () { return true; };

        var toastCalls = [];
        window.Mazelab = {
            Modules: {},
            Money: require(MONEY_PATH),
            Storage: { generateId: function () { return 'newfac-2'; } },
            UI: { toast: function (msg, type) { toastCalls.push({ msg: msg, type: type }); }, showOfflineBanner: function () {}, showTestModeBanner: function () {} },
            DataService: {
                getAll: async function (table) {
                    if (table === 'receivables') return [{
                        id: 'res-2', tipoDoc: 'F', saleId: 'sale-10', sourceId: '851',
                        montoNeto: 1000000, monto_venta: 1000000, invoicedAmount: 0, montoFacturado: 0,
                        status: 'sin_factura', payments: [], eventName: 'Evento Y', clientName: 'Cliente Y', eventDate: '2026-07-01'
                    }];
                    if (table === 'sales') return [{ id: 'sale-10', sourceId: '851', eventName: 'Evento Y', clientName: 'Cliente Y' }];
                    return [];
                },
                create: async function (table, rec) { return rec; },
                update: async function () { throw new Error('update residual falló (simulado)'); },
                remove: async function () { throw new Error('delete compensatorio también falló (simulado)'); },
                isUsingSupabase: function () { return false; }
            }
        };

        require(FINANCE_PATH);
        var FM = window.Mazelab.Modules.FinanceModule;

        document.body.innerHTML = FM.render();
        FM.init();
        await new Promise(function (r) { setTimeout(r, 50); });

        var facBtn = document.querySelector('.btn-facturar[data-id="res-2"]');
        assert.ok(facBtn, 'el botón Facturar debe existir para la residual sin_factura');
        facBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await new Promise(function (r) { setTimeout(r, 20); });

        document.getElementById('fac-number').value = 'F-COMP-2';
        document.getElementById('fac-amount').value = '600000';

        document.getElementById('fac-save-btn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await new Promise(function (r) { setTimeout(r, 80); });

        var errToast = toastCalls.find(function (c) { return c.type === 'error'; });
        assert.ok(errToast, 'debe haberse mostrado un toast de error');
        assert.ok(/NO reintentes crear la factura/.test(errToast.msg), 'debe lanzarse el error especial de doble falla. Mensaje real: ' + errToast.msg);
    });

    console.log('\n' + pass + ' OK, ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
})().catch(function (e) {
    console.error('ERROR FATAL:', e);
    process.exit(1);
});
