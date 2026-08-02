// Verificación Lote M1-D (Sprint M1) — carga el src/shared/company-info.js REAL
// en Node con un mock inyectable de DataService y de localStorage, sin red real
// ni DOM. Cubre: cache en memoria (getCompanyInfoSync tras preload), fallback a
// localStorage cuando la fila 'config' no existe o la consulta falla, y que
// saveCompanyInfo() espeje en localStorage de inmediato y haga upsert
// (create si no existe fila, update si ya existe) contra DataService.
// Correr con: node tests/verify-config-helper.js
'use strict';
const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..');
const HELPER_PATH = path.join(REPO, 'src/shared/company-info.js');

let pass = 0, fail = 0;
async function at(name, fn) {
    try { await fn(); pass++; console.log('  OK  ' + name); }
    catch (e) { fail++; console.error('FAIL  ' + name + ' — ' + (e && e.stack ? e.stack : e)); }
}

function makeLocalStorageMock(initial) {
    const store = Object.assign({}, initial || {});
    return {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
        setItem: function (k, v) { store[k] = String(v); },
        removeItem: function (k) { delete store[k]; }
    };
}

// script: { getAll: value|{reject}|fn, create: value|{reject}|fn, update: value|{reject}|fn }
function makeDataServiceMock(script) {
    script = script || {};
    const calls = [];
    function resolveOrReject(key, args) {
        calls.push({ method: key, args: args });
        const scripted = script[key];
        if (typeof scripted === 'function') return scripted.apply(null, args);
        if (scripted && scripted.reject) return Promise.reject(scripted.reject);
        if (scripted !== undefined) return Promise.resolve(scripted);
        return Promise.resolve(key === 'getAll' ? [] : null);
    }
    return {
        calls: calls,
        getAll: function (entity) { return resolveOrReject('getAll', [entity]); },
        create: function (entity, record) { return resolveOrReject('create', [entity, record]); },
        update: function (entity, id, updates) { return resolveOrReject('update', [entity, id, updates]); }
    };
}

function freshEnv(dsScript, localStorageInitial) {
    delete require.cache[require.resolve(HELPER_PATH)];
    const ds = makeDataServiceMock(dsScript);
    const ls = makeLocalStorageMock(localStorageInitial);
    global.window = { Mazelab: { DataService: ds } };
    global.localStorage = ls;
    require(HELPER_PATH);
    return { CompanyInfo: global.window.Mazelab.CompanyInfo, ds: ds, ls: ls };
}

(async function () {

    // ================= preload() / getCompanyInfo() =================
    await at('preload(): fila config existe en la base → cachea su value', async function () {
        const env = freshEnv({ getAll: [{ id: 'company_info', key: 'company_info', value: { nombre: 'Mazelab SPA' } }] });
        const info = await env.CompanyInfo.preload();
        assert.deepStrictEqual(info, { nombre: 'Mazelab SPA' });
        assert.deepStrictEqual(env.CompanyInfo.getCompanyInfoSync(), { nombre: 'Mazelab SPA' });
    });

    await at('preload(): fila config no existe (getAll=[]) → cae a localStorage', async function () {
        const env = freshEnv({ getAll: [] }, { mazelab_company_info: JSON.stringify({ nombre: 'Desde LS' }) });
        const info = await env.CompanyInfo.preload();
        assert.deepStrictEqual(info, { nombre: 'Desde LS' });
    });

    await at('preload(): getAll rechaza (sin conexión / solo lectura) → cae a localStorage, NO lanza', async function () {
        const env = freshEnv(
            { getAll: { reject: new Error('Sin conexión con la base de datos — modo solo lectura') } },
            { mazelab_company_info: JSON.stringify({ nombre: 'Offline' }) }
        );
        const info = await env.CompanyInfo.preload();
        assert.deepStrictEqual(info, { nombre: 'Offline' });
    });

    await at('getCompanyInfo(): tras preload(), reusa la cache sin volver a llamar a DataService', async function () {
        const env = freshEnv({ getAll: [{ id: 'company_info', key: 'company_info', value: { nombre: 'A' } }] });
        await env.CompanyInfo.preload();
        env.ds.calls.length = 0;
        const info = await env.CompanyInfo.getCompanyInfo();
        assert.deepStrictEqual(info, { nombre: 'A' });
        assert.strictEqual(env.ds.calls.length, 0, 'no debió volver a llamar a DataService.getAll');
    });

    // ================= getCompanyInfoSync() sin preload previo =================
    await at('getCompanyInfoSync(): sin preload() previo → lee localStorage directo', function () {
        const env = freshEnv({}, { mazelab_company_info: JSON.stringify({ nombre: 'Directo LS' }) });
        assert.deepStrictEqual(env.CompanyInfo.getCompanyInfoSync(), { nombre: 'Directo LS' });
    });

    await at('getCompanyInfoSync(): sin preload() y sin localStorage → objeto vacío, no lanza', function () {
        const env = freshEnv({});
        assert.deepStrictEqual(env.CompanyInfo.getCompanyInfoSync(), {});
    });

    // ================= saveCompanyInfo() =================
    await at('saveCompanyInfo(): espeja en localStorage de inmediato', async function () {
        const env = freshEnv({ getAll: [] });
        await env.CompanyInfo.saveCompanyInfo({ nombre: 'Nueva Empresa' });
        assert.deepStrictEqual(JSON.parse(env.ls.getItem('mazelab_company_info')), { nombre: 'Nueva Empresa' });
    });

    await at('saveCompanyInfo(): actualiza la cache sincrónica de inmediato (no espera la red)', async function () {
        const env = freshEnv({ getAll: [] });
        const p = env.CompanyInfo.saveCompanyInfo({ nombre: 'Sync ya' });
        assert.deepStrictEqual(env.CompanyInfo.getCompanyInfoSync(), { nombre: 'Sync ya' });
        await p;
    });

    await at('saveCompanyInfo(): sin fila previa → hace create() con id/key "company_info"', async function () {
        const env = freshEnv({ getAll: [] });
        await env.CompanyInfo.saveCompanyInfo({ nombre: 'X' });
        const createCall = env.ds.calls.find(function (c) { return c.method === 'create'; });
        assert.ok(createCall, 'debió llamar a DataService.create');
        assert.strictEqual(createCall.args[0], 'config');
        assert.deepStrictEqual(createCall.args[1], { id: 'company_info', key: 'company_info', value: { nombre: 'X' } });
    });

    await at('saveCompanyInfo(): con fila previa → hace update() sobre el id existente, no create()', async function () {
        const env = freshEnv({ getAll: [{ id: 'company_info', key: 'company_info', value: { nombre: 'Vieja' } }] });
        await env.CompanyInfo.saveCompanyInfo({ nombre: 'Nueva' });
        const updateCall = env.ds.calls.find(function (c) { return c.method === 'update'; });
        const createCall = env.ds.calls.find(function (c) { return c.method === 'create'; });
        assert.ok(updateCall, 'debió llamar a DataService.update');
        assert.strictEqual(updateCall.args[0], 'config');
        assert.strictEqual(updateCall.args[1], 'company_info');
        assert.deepStrictEqual(updateCall.args[2], { value: { nombre: 'Nueva' } });
        assert.ok(!createCall, 'no debió llamar a create() habiendo fila existente');
    });

    await at('saveCompanyInfo(): DataService.getAll rechaza en el upsert → la promesa RECHAZA, pero el espejo local ya quedó escrito', async function () {
        const env = freshEnv({ getAll: { reject: new Error('Sin conexión con la base de datos') } });
        await assert.rejects(
            env.CompanyInfo.saveCompanyInfo({ nombre: 'Resiliente' }),
            /Sin conexión con la base de datos/
        );
        // El espejo en localStorage y la cache en memoria se escriben ANTES del
        // upsert remoto, así que quedan guardados aunque la promesa rechace
        // (revisión final Sprint M1, hallazgo 1: settings.js es quien debe
        // atrapar este rechazo y avisar al usuario — ver saveCompanyInfo() en
        // src/shared/company-info.js).
        assert.deepStrictEqual(JSON.parse(env.ls.getItem('mazelab_company_info')), { nombre: 'Resiliente' });
        assert.deepStrictEqual(env.CompanyInfo.getCompanyInfoSync(), { nombre: 'Resiliente' });
    });

    await at('saveCompanyInfo(): DataService.update rechaza (RLS sin permiso de escritura) → la promesa RECHAZA con ese error', async function () {
        const env = freshEnv({
            getAll: [{ id: 'company_info', key: 'company_info', value: { nombre: 'Vieja' } }],
            update: { reject: new Error('new row violates row-level security policy for table "config"') }
        });
        await assert.rejects(
            env.CompanyInfo.saveCompanyInfo({ nombre: 'Comercial intenta guardar' }),
            /row-level security/
        );
        assert.deepStrictEqual(JSON.parse(env.ls.getItem('mazelab_company_info')), { nombre: 'Comercial intenta guardar' });
    });

    console.log('\n' + pass + ' OK, ' + fail + ' FAIL');
    process.exit(fail === 0 ? 0 : 1);
})();
