// Verificación Lote E (Sprint 1, Tasks 6/7 + mitigación I7) — carga el código REAL
// (src/shared/data-service.js, src/modules/finance/finance.js) en Node con
// fetch/window/DOM mockeados. Correr con: node verify-lote-e.js
//
// NOTA (Sprint M1, Lote M1-B): src/shared/supabase.js se reescribió sobre
// @supabase/supabase-js (createClient de un CDN global), no sobre fetch a
// /api/db — ya no existe un "fetch mockeable" dentro de ese archivo. Esta
// suite prueba data-service.js (cache/readOnly/sin fallback), no el
// transporte de Supabase, así que en vez de requerir el supabase.js real se
// instala un shim local que replica el contrato EXTERNO viejo (mismas 6
// funciones, basado en fetch, mismos mensajes de error) — mismo patrón que
// tenía supabase.js antes de M1-B. Ninguna aserción de este archivo cambió.
'use strict';
const assert = require('assert');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPO = path.join(__dirname, '..');
const DS_PATH       = path.join(REPO, 'src/shared/data-service.js');
const FINANCE_PATH  = path.join(REPO, 'src/modules/finance/finance.js');
const MONEY_PATH    = path.join(REPO, 'src/shared/money.js');

// Réplica exacta (pre-M1-B) del adaptador fetch-based — ver nota de cabecera.
function installLegacyFetchSupabaseShim(win) {
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

    win.Mazelab.Supabase = { testConnection, isConnected: () => isConnected, fetchAll, insert, update, remove, upsertMany };
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
function freshEnv(opts) {
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

    installLegacyFetchSupabaseShim(global.window);
    require(DS_PATH);

    return {
        window: global.window,
        uiCalls: uiCalls,
        DS: global.window.Mazelab.DataService,
        Supabase: global.window.Mazelab.Supabase
    };
}

(async function () {

    // ================= (1) update con servidor 500 → lanza (ya no null) =================
    await at('(1) Supabase.update lanza en HTTP 500, ya no devuelve null', async function () {
        var env = freshEnv({ fetch: function () {
            return Promise.resolve({ ok: false, status: 500, text: function () { return Promise.resolve('boom'); } });
        }});
        var err = await assertRejects(env.Supabase.update('ventas', '1', { foo: 1 }), /HTTP 500/);
        assert.notStrictEqual(err, null);
    });

    // ================= (2) fetchAll con red caída → lanza (ya no []) =================
    await at('(2) Supabase.fetchAll lanza si la red está caída, ya no devuelve []', async function () {
        var env = freshEnv({ fetch: function () { return Promise.reject(new Error('ECONNREFUSED')); } });
        await assertRejects(env.Supabase.fetchAll('ventas'), /ECONNREFUSED/);
    });

    // ================= (3) getAll con servidor OK y tabla vacía → [] SIN caer a localStorage =================
    await at('(3) getAll: servidor OK + tabla vacía devuelve [] SIN fallback a localStorage', async function () {
        var localCalled = false;
        var env = freshEnv({ fetch: function () {
            return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve([]); } });
        }});
        env.window.Mazelab.Storage.SalesService.getAll = function () { localCalled = true; return [{ id: 'no-debiera-verse' }]; };
        await env.DS.init();
        assert.strictEqual(env.DS.isUsingSupabase(), true);
        var result = await env.DS.getAll('sales');
        assert.deepStrictEqual(result, []);
        assert.strictEqual(localCalled, false, 'NO debió consultar localStorage como fallback ante array vacío legítimo');
    });

    // ================= (4) readOnly activo → create lanza ANTES de tocar red =================
    await at('(4) readOnly activo: create lanza ANTES de llamar a fetch', async function () {
        var env = freshEnv({ fetch: function () { throw new Error('NO debió llamarse a fetch'); } });
        // Conexión inicial falla → init() debe activar readOnly y mostrar el banner offline
        env.window.Mazelab.Supabase.testConnection = function () { return Promise.resolve(false); };
        await env.DS.init();
        assert.strictEqual(env.DS.readOnly, true, 'readOnly debe quedar activo tras fallo de conexión inicial');
        assert.ok(env.uiCalls.offline >= 1, 'showOfflineBanner debe haberse llamado al activarse readOnly');

        await assertRejects(env.DS.create('sales', { foo: 1 }), /solo lectura/);
        await assertRejects(env.DS.update('sales', 'x', { foo: 1 }), /solo lectura/);
        await assertRejects(env.DS.remove('sales', 'x'), /solo lectura/);
    });

    // ================= (5) ?localdev=1 → modo localStorage + banner de prueba =================
    await at('(5) ?localdev=1 activa modo local, llama showTestModeBanner, y NO toca la red', async function () {
        var fetchCalls = 0;
        var env = freshEnv({
            search: '?localdev=1',
            fetch: function () { fetchCalls++; return Promise.resolve({ ok: true, json: function () { return Promise.resolve([]); } }); }
        });
        env.window.Mazelab.Storage.SalesService = fakeStorageService([{ id: 's1' }]);
        await env.DS.init();
        assert.strictEqual(env.DS.isUsingSupabase(), false, 'en localdev NO debe usar el servidor');
        assert.strictEqual(env.DS.isLocalDev(), true);
        assert.strictEqual(env.uiCalls.testMode, 1, 'showTestModeBanner debe llamarse exactamente una vez');
        assert.strictEqual(env.uiCalls.offline, 0, 'localdev no es un fallo de conexión — no debe mostrar el banner offline');

        var all = await env.DS.getAll('sales');
        assert.deepStrictEqual(all, [{ id: 's1' }]);
        assert.strictEqual(fetchCalls, 0, 'localdev no debe llamar a fetch en ningún momento');

        // Y create/update/remove deben escribir en localStorage (modo prueba explícito, no fallback)
        var created = await env.DS.create('sales', { id: 's2', amount: 100 });
        assert.ok(created);
        var again = await env.DS.getAll('sales');
        assert.strictEqual(again.length, 2);
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
