// Verificación de los hallazgos de la revisión adversarial sobre db17baa/e17ef86
// (B1, I1-I5, M1-M2) — carga el código REAL en Node con fetch/DOM mockeados.
// Correr con: node verify-e-fixes.js
//
// NOTA (Sprint M1, Lote M1-B): src/shared/supabase.js se reescribió sobre
// @supabase/supabase-js (createClient de un CDN global), no sobre fetch a
// /api/db — ya no existe un "fetch mockeable" dentro de ese archivo. Los
// escenarios (a)/(b) de esta suite prueban data-service.js (readOnly/cache/sin
// fallback), no el transporte de Supabase, así que en vez de requerir el
// supabase.js real se instala un shim local que replica el contrato EXTERNO
// viejo (mismas 6 funciones, basado en fetch, mismos mensajes de error) —
// mismo patrón que tenía supabase.js antes de M1-B. Ninguna aserción cambió.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPO = path.join(__dirname, '..');
const DS_PATH        = path.join(REPO, 'src/shared/data-service.js');
const MONEY_PATH     = path.join(REPO, 'src/shared/money.js');
const PAYABLES_PATH  = path.join(REPO, 'src/modules/payables/payables.js');
const PAGOS_PATH     = path.join(REPO, 'src/modules/pagos/pagos.js');
const SALES_PATH     = path.join(REPO, 'src/modules/sales/sales.js');

// Réplica exacta (pre-M1-B) del adaptador fetch-based — ver nota de cabecera.
function installLegacyFetchSupabaseShim() {
    const BASE = '/api/db';
    let isConnected = false;

    async function testConnection() {
        try {
            const res = await fetch(BASE + '/ventas?limit=1');
            isConnected = res.ok;
            return isConnected;
        } catch {
            isConnected = false;
            return false;
        }
    }

    async function fetchAll(table) {
        const res = await fetch(BASE + '/' + table);
        if (!res.ok) {
            const errText = await res.text().catch(function () { return String(res.status); });
            throw new Error('Error al leer ' + table + ' (HTTP ' + res.status + '): ' + errText);
        }
        const data = await res.json();
        return Array.isArray(data) ? data : (data.rows || data.data || []);
    }

    async function insert(table, record) {
        const res = await fetch(BASE + '/' + table, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record)
        });
        if (!res.ok) {
            const errText = await res.text().catch(function () { return String(res.status); });
            throw new Error('Error al guardar en ' + table + ' (HTTP ' + res.status + '): ' + errText);
        }
        return await res.json();
    }

    async function update(table, id, updates) {
        const res = await fetch(BASE + '/' + table + '/' + id, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates)
        });
        if (!res.ok) {
            const errText = await res.text().catch(function () { return String(res.status); });
            throw new Error('Error al actualizar en ' + table + ' (HTTP ' + res.status + '): ' + errText);
        }
        return await res.json();
    }

    async function remove(table, id) {
        const res = await fetch(BASE + '/' + table + '/' + id, { method: 'DELETE' });
        if (!res.ok) {
            const errText = await res.text().catch(function () { return String(res.status); });
            throw new Error('Error al eliminar en ' + table + ' (HTTP ' + res.status + '): ' + errText);
        }
        return true;
    }

    async function upsertMany(table, records) {
        const BATCH_SIZE = 100;
        const results = [];
        for (let i = 0; i < records.length; i += BATCH_SIZE) {
            const batch = records.slice(i, i + BATCH_SIZE);
            const res = await fetch(BASE + '/' + table + '/upsert', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(batch)
            });
            if (!res.ok) {
                const errText = await res.text().catch(function () { return String(res.status); });
                throw new Error('Error al importar "' + table + '" (lote ' + Math.floor(i / BATCH_SIZE + 1) + '): HTTP ' + res.status + ' — ' + errText);
            }
            const data = await res.json().catch(function () { return []; });
            if (Array.isArray(data)) results.push(...data);
        }
        return results;
    }

    global.window.Mazelab.Supabase = { testConnection, isConnected: () => isConnected, fetchAll, insert, update, remove, upsertMany };
}

// ---- Reloj congelado — 2026-07-26T12:00:00 hora local ----
// El escenario (e) usa una venta con eventDate "2026-08-01" para verificar el
// flujo de edición (sales.js deriva el estado efectivo con new Date() real vía
// getEffectiveStatus: eventDate pasado => "realizada" => cae fuera del filtro
// default "pendiente" => el botón editar no se renderiza). Se congela el reloj
// global de Node ANTES de requerir los módulos para que "2026-08-01" siga
// siendo una fecha futura sin importar cuándo se corra la suite. Con
// argumentos, FixedDate delega en el Date real (usado por Date.now() para IDs).
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

// Mismo patrón que verify-lote-e.js: simula una carga de página nueva para
// supabase.js/data-service.js (limpia su require cache y reconstruye window.Mazelab).
function freshDSEnv(opts) {
    opts = opts || {};
    delete require.cache[require.resolve(DS_PATH)];

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
    global.fetch = opts.fetch || function () { return Promise.reject(new Error('fetch no mockeado en este escenario')); };

    installLegacyFetchSupabaseShim();
    require(DS_PATH);

    return { window: global.window, uiCalls: uiCalls, DS: global.window.Mazelab.DataService, Supabase: global.window.Mazelab.Supabase };
}

(async function () {

    // ================= (a) importMany en readOnly lanza sin tocar red (B1) =================
    await at('(a) importMany en modo readOnly lanza ANTES de tocar la red', async function () {
        var env = freshDSEnv({ fetch: function () { throw new Error('NO debió llamarse a fetch'); } });
        env.window.Mazelab.Supabase.testConnection = function () { return Promise.resolve(false); };
        await env.DS.init();
        assert.strictEqual(env.DS.readOnly, true, 'readOnly debe quedar activo tras fallo de conexión inicial');
        await assertRejects(env.DS.importMany('sales', [{ id: 'x' }]), /solo lectura/);
    });

    // ================= (b) getAll ANTES de init() no cae a localStorage en silencio (I1) =================
    await at('(b) getAll() llamado ANTES de init() no lee localStorage en silencio (useSupabase default = true)', async function () {
        var localCalled = false;
        var fetchCalls = 0;
        var env = freshDSEnv({ fetch: function () {
            fetchCalls++;
            return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve([{ id: 'server-1' }]); } });
        }});
        env.window.Mazelab.Storage.SalesService.getAll = function () { localCalled = true; return [{ id: 'local-fantasma' }]; };
        // A propósito: NO se llama env.DS.init() — simula un getAll() disparado antes
        // de que el bootstrap de la app corra init() (I1: mina latente por orden de llamadas).
        var result = await env.DS.getAll('sales');
        assert.deepStrictEqual(result, [{ id: 'server-1' }], 'debe leer del servidor, no del localStorage fantasma');
        assert.strictEqual(localCalled, false, 'NO debió leer localStorage en silencio antes de init()');
        assert.ok(fetchCalls > 0, 'debió intentar el servidor (useSupabase default = true)');
    });

    // ================= (c) delete de payables fallando → toast de error (I2) =================
    await at('(c) PayablesModule: eliminar costo fallando → toast de error visible (no falla silenciosa)', async function () {
        delete require.cache[require.resolve(PAYABLES_PATH)];
        var dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' });
        global.window = dom.window;
        global.document = dom.window.document;
        global.confirm = function () { return true; };
        global.alert = function () {};

        var toastCalls = [];
        var PAYABLE = {
            id: 'pay-1', category: 'general', docType: 'ninguno', eventName: 'Gasto oficina',
            clientName: '', eventId: '', eventDate: '', billingDate: '2026-07-01', concept: 'Arriendo',
            vendorName: '', docNumber: '', amount: 100000, status: 'pendiente', payments: []
        };

        window.Mazelab = {
            Modules: {},
            Money: require(MONEY_PATH),
            UI: { toast: function (msg, type) { toastCalls.push({ msg: msg, type: type }); }, showOfflineBanner: function () {}, showTestModeBanner: function () {} },
            DataService: {
                getAll: async function (table) { return table === 'payables' ? [PAYABLE] : []; },
                remove: async function () { throw new Error('DB caída (simulado)'); },
                update: async function (t, id, upd) { return upd; },
                create: async function (t, rec) { return rec; },
                isUsingSupabase: function () { return false; }
            }
        };
        require(PAYABLES_PATH);
        var PM = window.Mazelab.Modules.PayablesModule;

        document.getElementById('app').innerHTML = PM.render();
        await PM.init();

        var delBtn = document.querySelector('.payable-delete[data-id="pay-1"]');
        assert.ok(delBtn, 'debe existir el botón eliminar para el costo de prueba');
        delBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await new Promise(function (r) { setTimeout(r, 50); });

        var errToast = toastCalls.find(function (c) { return c.type === 'error'; });
        assert.ok(errToast, 'debe haberse mostrado un toast de error');
        assert.ok(/no se eliminó/.test(errToast.msg), 'mensaje real: ' + (errToast && errToast.msg));
    });

    // ================= (d) PagosModule.init con getAll fallando → error visible, no "Cargando…" (I4) =================
    await at('(d) PagosModule.init(): getAll falla → el contenedor muestra error, no queda en "Cargando…"', async function () {
        delete require.cache[require.resolve(PAGOS_PATH)];
        var dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' });
        global.window = dom.window;
        global.document = dom.window.document;

        window.Mazelab = {
            Modules: {},
            DataService: { getAll: async function () { throw new Error('DB caída (simulado)'); } }
        };
        require(PAGOS_PATH);
        var PM = window.Mazelab.Modules.PagosModule;

        document.getElementById('app').innerHTML = PM.render();
        var before = document.getElementById('pagos-content').innerHTML;
        assert.ok(/Cargando/.test(before), 'estado inicial de render() debe mostrar "Cargando..."');

        await PM.init(); // antes del fix: loadData() lanza sin catch → queda congelado en "Cargando..."

        var after = document.getElementById('pagos-content').innerHTML;
        assert.ok(!/Cargando/.test(after), 'NO debe quedar congelado en "Cargando..." tras el fallo');
        assert.ok(/Error al cargar datos/.test(after), 'debe mostrar un error visible. HTML real: ' + after);
    });

    // ================= (e) sales handleSave: escritura OK + recarga falla (I5) =================
    await at('(e) sales.handleSave: escritura OK + recarga falla → toast de éxito SÍ, "no se guardó" NUNCA', async function () {
        delete require.cache[require.resolve(SALES_PATH)];
        var dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' });
        global.window = dom.window;
        global.document = dom.window.document;
        global.alert = function () {};
        global.confirm = function () { return true; };

        var toastCalls = [];
        var salesCallCount = 0;
        var VENTA = { id: '101', sourceId: '101', clientName: 'ACME SpA', eventName: 'Gala',
            eventDate: '2026-08-01', amount: 1000000, serviceIds: [], status: 'pendiente' };

        window.Mazelab = {
            Modules: {},
            Storage: { generateId: (function () { var n = 0; return function () { return 'gen-' + (++n); }; })() },
            UI: { toast: function (msg, type) { toastCalls.push({ msg: msg, type: type }); }, showOfflineBanner: function () {}, showTestModeBanner: function () {} },
            DataService: {
                getAll: async function (table) {
                    if (table === 'sales') {
                        salesCallCount++;
                        // 1ª llamada: SalesModule.init() carga el listado inicial (debe funcionar).
                        // 2ª llamada: la recarga del BLOQUE 3 dentro de handleSave — esta es la
                        // que debe fallar para probar que el fallo de recarga NUNCA se reporta
                        // como "no se guardó" (la venta ya se escribió antes de este punto).
                        if (salesCallCount >= 2) throw new Error('red caída en la recarga (simulado)');
                        return [Object.assign({}, VENTA)];
                    }
                    return []; // clients, services, staff, payables, receivables
                },
                create: async function (t, rec) { return rec; },
                update: async function (t, id, upd) { return upd; },
                remove: async function () { return true; }
            }
        };
        require(SALES_PATH);
        var SM = window.Mazelab.Modules.SalesModule;

        document.getElementById('app').innerHTML = SM.render();
        await SM.init();

        var editBtn = document.querySelector('.btn-edit-sale[data-id="101"]');
        assert.ok(editBtn, 'debe existir el botón editar para la venta de prueba');
        editBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await new Promise(function (r) { setTimeout(r, 20); });

        var form = document.getElementById('sale-form');
        assert.ok(form, 'el formulario de edición debe estar abierto');
        form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
        await new Promise(function (r) { setTimeout(r, 150); });

        var successToast     = toastCalls.find(function (c) { return c.type !== 'error' && /Guardado en la base de datos/.test(c.msg); });
        var noSeGuardoToast   = toastCalls.find(function (c) { return /no se guardó/.test(c.msg); });
        var reloadFailToast   = toastCalls.find(function (c) { return /la recarga falló/.test(c.msg); });

        assert.ok(successToast, 'debe haberse mostrado el toast de éxito ("Guardado en la base de datos"). Toasts: ' + JSON.stringify(toastCalls));
        assert.ok(!noSeGuardoToast, 'JAMÁS debe decir "no se guardó" cuando la escritura sí funcionó. Toasts: ' + JSON.stringify(toastCalls));
        assert.ok(reloadFailToast, 'debe reportarse que la recarga falló, con mensaje propio. Toasts: ' + JSON.stringify(toastCalls));
    });

    console.log('\n' + pass + ' OK, ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
})().catch(function (e) {
    console.error('ERROR FATAL:', e);
    process.exit(1);
});
