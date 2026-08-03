// Verificación Lote M1-B (Sprint M1) — carga el src/shared/supabase.js REAL en
// Node con un mock inyectable de supabase-js (window.supabase.createClient),
// sin red real. Cubre las 6 funciones del adaptador: contratos de retorno,
// prefijos de error en español EXACTOS, allowlist de tablas, lotes de 100
// secuenciales (250 registros → 3 lotes), y que update() use .single().
// Correr con: node tests/verify-adapter.js
'use strict';
const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..');
const SUPABASE_PATH = path.join(REPO, 'src/shared/supabase.js');

let pass = 0, fail = 0;
async function at(name, fn) {
    try { await fn(); pass++; console.log('  OK  ' + name); }
    catch (e) { fail++; console.error('FAIL  ' + name + ' — ' + (e && e.stack ? e.stack : e)); }
}

async function assertRejects(promiseOrFn, matcher, msgIfNoThrow) {
    let threw = false, err = null;
    try {
        const p = typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn;
        await p;
    } catch (e) { threw = true; err = e; }
    assert.ok(threw, msgIfNoThrow || 'se esperaba que lanzara/rechazara, pero no lo hizo');
    if (matcher) assert.ok(matcher.test(err.message), 'mensaje no matchea ' + matcher + ': "' + err.message + '"');
    return err;
}

// ----------------------------------------------------------------------------
// Mock de supabase-js: un query builder encadenable mínimo que registra las
// llamadas hechas (tabla, método, args) y resuelve según un guion configurable
// por tabla+método. Suficiente para probar el CONTRATO del adaptador sin
// depender del SDK real ni de red.
// ----------------------------------------------------------------------------
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
            range: function (from, to) { state.rangeArgs = [from, to]; return builder; },
            single: function () {
                state.single = true;
                return resolveFor(state);
            },
            // El builder mismo es "thenable" — poder usarse sin .single() (fetchAll,
            // upsertMany, remove, testConnection lo consumen así, con await directo).
            then: function (resolve, reject) {
                return resolveFor(state).then(resolve, reject);
            }
        };
        return builder;
    }

    function resolveFor(state) {
        calls.push({ table: state.table, method: state.method, args: state.args, eq: state.eq, order: state.order, limitArgs: state.limitArgs, rangeArgs: state.rangeArgs, single: !!state.single, selectArgs: state.selectArgs });
        const key = state.table + '.' + state.method;
        const scripted = script[key];
        const result = typeof scripted === 'function' ? scripted(state) : (scripted || { data: null, error: null });
        return Promise.resolve(result);
    }

    const client = {
        from: function (table) { return makeBuilder(table); }
    };

    return { client: client, calls: calls };
}

function freshSupabaseEnv(script) {
    delete require.cache[require.resolve(SUPABASE_PATH)];
    const mock = makeMockSupabaseClient(script || {});
    global.window = {
        supabase: { createClient: function () { return mock.client; } }
    };
    require(SUPABASE_PATH);
    return { Supabase: global.window.Mazelab.Supabase, calls: mock.calls, client: mock.client };
}

(async function () {

    // ================= testConnection() =================
    // I3: HEAD nunca ejecuta la query real (algunos proxies delante de
    // PostgREST responden HEAD sin reenviarlo) — ahora es un GET real:
    // .select("id").limit(1).
    await at('testConnection(): éxito → true, usa .from("ventas").select("id").limit(1) — GET real, no HEAD', async function () {
        const env = freshSupabaseEnv({ 'ventas.select': { data: [{ id: '1' }], error: null } });
        const ok = await env.Supabase.testConnection();
        assert.strictEqual(ok, true);
        assert.strictEqual(env.Supabase.isConnected(), true);
        const call = env.calls.find(function (c) { return c.table === 'ventas' && c.method === 'select'; });
        assert.ok(call, 'debe haber llamado .from("ventas").select(...)');
        assert.deepStrictEqual(call.selectArgs, ['id', undefined]);
        assert.strictEqual(call.limitArgs, 1, 'debe usar .limit(1) — un GET real que fuerza la ejecución completa de la query');
    });

    await at('testConnection(): error de supabase-js → false, JAMÁS lanza', async function () {
        const env = freshSupabaseEnv({ 'ventas.select': { data: null, error: { message: 'relation "ventas" does not exist' } } });
        const ok = await env.Supabase.testConnection();
        assert.strictEqual(ok, false);
        assert.strictEqual(env.Supabase.isConnected(), false);
    });

    await at('testConnection(): excepción sincrónica/red → false, JAMÁS lanza', async function () {
        delete require.cache[require.resolve(SUPABASE_PATH)];
        global.window = { supabase: { createClient: function () { throw new Error('ENOTFOUND'); } } };
        require(SUPABASE_PATH);
        const Supabase = global.window.Mazelab.Supabase;
        const ok = await Supabase.testConnection();
        assert.strictEqual(ok, false);
    });

    // ================= fetchAll() =================
    await at('fetchAll(): éxito → array, usa .select("*").order("id").range(0,999)', async function () {
        const rows = [{ id: '2' }, { id: '1' }];
        const env = freshSupabaseEnv({ 'ventas.select': { data: rows, error: null } });
        const result = await env.Supabase.fetchAll('ventas');
        assert.deepStrictEqual(result, rows);
        const call = env.calls.find(function (c) { return c.table === 'ventas' && c.method === 'select'; });
        assert.deepStrictEqual(call.selectArgs, ['*', undefined]);
        assert.strictEqual(call.order, 'id');
        assert.deepStrictEqual(call.rangeArgs, [0, 999]);
    });

    await at('fetchAll(): data null del servidor → [] (nunca null)', async function () {
        const env = freshSupabaseEnv({ 'ventas.select': { data: null, error: null } });
        const result = await env.Supabase.fetchAll('ventas');
        assert.deepStrictEqual(result, []);
    });

    await at('fetchAll(): error → lanza con prefijo "Error al leer " exacto', async function () {
        const env = freshSupabaseEnv({ 'facturas.select': { data: null, error: { message: 'permission denied for table facturas' } } });
        const err = await assertRejects(env.Supabase.fetchAll('facturas'));
        assert.strictEqual(err.message, 'Error al leer facturas: permission denied for table facturas');
    });

    // ---- Paginación real: PostgREST trunca a 1000 filas por página EN SILENCIO
    // (200 OK, sin error, sin indicador de truncamiento) — fetchAll() debe
    // seguir pidiendo páginas vía .range() hasta que una venga incompleta.
    await at('fetchAll(): 2 páginas (1000 + 500) → devuelve 1500 filas, pide .range(0,999) y luego .range(1000,1999)', async function () {
        const page1 = [];
        for (let i = 0; i < 1000; i++) page1.push({ id: 'r' + i });
        const page2 = [];
        for (let i = 1000; i < 1500; i++) page2.push({ id: 'r' + i });

        const env = freshSupabaseEnv({
            'costos.select': function (state) {
                const from = state.rangeArgs[0];
                if (from === 0) return { data: page1, error: null };
                if (from === 1000) return { data: page2, error: null };
                throw new Error('range inesperado en el mock: ' + JSON.stringify(state.rangeArgs));
            }
        });

        const result = await env.Supabase.fetchAll('costos');
        assert.strictEqual(result.length, 1500, 'debe acumular las 2 páginas — la truncación silenciosa de PostgREST es exactamente el bug que esto corrige');
        assert.deepStrictEqual(result[0], { id: 'r0' });
        assert.deepStrictEqual(result[1499], { id: 'r1499' });

        const selectCalls = env.calls.filter(function (c) { return c.table === 'costos' && c.method === 'select'; });
        assert.strictEqual(selectCalls.length, 2, 'debe hacer exactamente 2 consultas — una por página');
        assert.deepStrictEqual(selectCalls[0].rangeArgs, [0, 999]);
        assert.deepStrictEqual(selectCalls[1].rangeArgs, [1000, 1999]);
        selectCalls.forEach(function (c) { assert.strictEqual(c.order, 'id', 'cada página debe mantener el mismo order("id") — si el orden cambiara entre páginas podrían duplicarse o saltarse filas'); });
    });

    await at('fetchAll(): primera página con < 1000 filas → UNA sola consulta (no pagina de más)', async function () {
        const rows = [];
        for (let i = 0; i < 300; i++) rows.push({ id: 'r' + i });
        const env = freshSupabaseEnv({ 'ventas.select': { data: rows, error: null } });

        const result = await env.Supabase.fetchAll('ventas');
        assert.strictEqual(result.length, 300);

        const selectCalls = env.calls.filter(function (c) { return c.table === 'ventas' && c.method === 'select'; });
        assert.strictEqual(selectCalls.length, 1, 'una página con menos de 1000 filas es la señal de "no hay más" — no debe pedir una segunda página');
    });

    await at('fetchAll(): error en la página 2 → lanza con prefijo "Error al leer " exacto (la página 1 sí se pidió)', async function () {
        const page1 = [];
        for (let i = 0; i < 1000; i++) page1.push({ id: 'r' + i });
        let callNum = 0;
        const env = freshSupabaseEnv({
            'costos.select': function () {
                callNum++;
                if (callNum === 1) return { data: page1, error: null };
                return { data: null, error: { message: 'statement timeout' } };
            }
        });

        const err = await assertRejects(env.Supabase.fetchAll('costos'));
        assert.strictEqual(err.message, 'Error al leer costos: statement timeout');
        assert.strictEqual(callNum, 2, 'debe haber intentado la página 2 antes de fallar');
    });

    // ================= insert() =================
    await at('insert(): éxito → registro creado, usa .insert(record).select().single()', async function () {
        const created = { id: 'v1', amount: 100 };
        const env = freshSupabaseEnv({ 'ventas.insert': { data: created, error: null } });
        const result = await env.Supabase.insert('ventas', { id: 'v1', amount: 100 });
        assert.deepStrictEqual(result, created);
        const call = env.calls.find(function (c) { return c.table === 'ventas' && c.method === 'insert'; });
        assert.ok(call.single, 'insert debe usar .single()');
        assert.deepStrictEqual(call.args, [{ id: 'v1', amount: 100 }]);
    });

    await at('insert(): error → lanza con prefijo "Error al guardar en " exacto', async function () {
        const env = freshSupabaseEnv({ 'ventas.insert': { data: null, error: { message: 'duplicate key value violates unique constraint' } } });
        const err = await assertRejects(env.Supabase.insert('ventas', { id: 'dup' }));
        assert.strictEqual(err.message, 'Error al guardar en ventas: duplicate key value violates unique constraint');
    });

    // ================= update() =================
    await at('update(): éxito → registro actualizado, usa .update(delta).eq("id",id).select().single()', async function () {
        const updated = { id: 'v1', amount: 999 };
        const env = freshSupabaseEnv({ 'ventas.update': { data: updated, error: null } });
        const result = await env.Supabase.update('ventas', 'v1', { amount: 999 });
        assert.deepStrictEqual(result, updated);
        const call = env.calls.find(function (c) { return c.table === 'ventas' && c.method === 'update'; });
        assert.deepStrictEqual(call.args, [{ amount: 999 }], 'update debe enviar SOLO el delta recibido, no el registro completo');
        assert.deepStrictEqual(call.eq, { col: 'id', val: 'v1' });
        assert.ok(call.single, 'update debe usar .single()');
    });

    await at('update(): id inexistente (.single() con 0 filas) → lanza con prefijo "Error al actualizar en " exacto', async function () {
        const env = freshSupabaseEnv({ 'ventas.update': { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } } });
        const err = await assertRejects(env.Supabase.update('ventas', 'no-existe', { amount: 1 }));
        assert.strictEqual(err.message, 'Error al actualizar en ventas: JSON object requested, multiple (or no) rows returned');
    });

    // ================= remove() =================
    // I4: un DELETE sin .select() puede devolver éxito con 0 filas afectadas
    // (RLS filtró la fila en silencio) — ahora pide .select("id") de vuelta y
    // lanza si viene vacío, en vez de reportar un borrado que nunca ocurrió.
    await at('remove(): éxito → true, usa .delete().eq("id",id).select("id"), la fila SÍ existía', async function () {
        const env = freshSupabaseEnv({ 'ventas.delete': { data: [{ id: 'v1' }], error: null } });
        const result = await env.Supabase.remove('ventas', 'v1');
        assert.strictEqual(result, true);
        const call = env.calls.find(function (c) { return c.table === 'ventas' && c.method === 'delete'; });
        assert.deepStrictEqual(call.eq, { col: 'id', val: 'v1' });
    });

    await at('remove(): error → lanza con prefijo "Error al eliminar en " exacto', async function () {
        const env = freshSupabaseEnv({ 'ventas.delete': { data: null, error: { message: 'foreign key constraint' } } });
        const err = await assertRejects(env.Supabase.remove('ventas', 'v1'));
        assert.strictEqual(err.message, 'Error al eliminar en ventas: foreign key constraint');
    });

    await at('remove(): RLS bloquea en silencio (sin error, 0 filas afectadas) → lanza "no existe o no tienes permiso" (I4)', async function () {
        const env = freshSupabaseEnv({ 'ventas.delete': { data: [], error: null } });
        const err = await assertRejects(env.Supabase.remove('ventas', 'v1'));
        assert.ok(/no existe o no tienes permiso/.test(err.message), 'mensaje real: ' + err.message);
    });

    // ================= upsertMany() =================
    await at('upsertMany(): 250 registros → exactamente 3 lotes SECUENCIALES de <=100, onConflict:"id"', async function () {
        const allRecords = [];
        for (let i = 0; i < 250; i++) allRecords.push({ id: 'r' + i });

        const batchSizes = [];
        const inFlight = { count: 0, maxConcurrent: 0 };
        const env = freshSupabaseEnv({
            'ventas.upsert': function (state) {
                batchSizes.push(state.args[0].length);
                inFlight.count++;
                inFlight.maxConcurrent = Math.max(inFlight.maxConcurrent, inFlight.count);
                inFlight.count--;
                return { data: state.args[0].map(function (r) { return { id: r.id }; }), error: null };
            }
        });

        const result = await env.Supabase.upsertMany('ventas', allRecords);
        assert.strictEqual(result.length, 250, 'debe devolver los 250 registros concatenados');
        assert.deepStrictEqual(batchSizes, [100, 100, 50], 'debe partir en lotes de 100/100/50');
        assert.strictEqual(inFlight.maxConcurrent, 1, 'los lotes deben ejecutarse SECUENCIALES, no en paralelo');

        const upsertCalls = env.calls.filter(function (c) { return c.table === 'ventas' && c.method === 'upsert'; });
        assert.strictEqual(upsertCalls.length, 3);
        upsertCalls.forEach(function (c) {
            assert.deepStrictEqual(c.args[1], { onConflict: 'id' });
        });
    });

    await at('upsertMany(): error en el lote 2 → lanza con "(lote 2)" y prefijo exacto', async function () {
        const allRecords = [];
        for (let i = 0; i < 150; i++) allRecords.push({ id: 'r' + i });
        let call = 0;
        const env = freshSupabaseEnv({
            'costos.upsert': function () {
                call++;
                if (call === 2) return { data: null, error: { message: 'invalid input syntax for type numeric' } };
                return { data: [], error: null };
            }
        });
        const err = await assertRejects(env.Supabase.upsertMany('costos', allRecords));
        assert.strictEqual(err.message, 'Error al importar "costos" (lote 2): invalid input syntax for type numeric');
    });

    // ================= Allowlist de tablas =================
    await at('allowlist: tabla no permitida → lanza "Tabla no permitida: X" en las 5 funciones CRUD, SIN tocar red', async function () {
        const env = freshSupabaseEnv({});
        const badTable = 'usuarios_legacy';
        await assertRejects(env.Supabase.fetchAll(badTable), /^Tabla no permitida: usuarios_legacy$/);
        await assertRejects(env.Supabase.insert(badTable, {}), /^Tabla no permitida: usuarios_legacy$/);
        await assertRejects(env.Supabase.update(badTable, '1', {}), /^Tabla no permitida: usuarios_legacy$/);
        await assertRejects(env.Supabase.remove(badTable, '1'), /^Tabla no permitida: usuarios_legacy$/);
        await assertRejects(env.Supabase.upsertMany(badTable, [{ id: '1' }]), /^Tabla no permitida: usuarios_legacy$/);
        assert.strictEqual(env.calls.length, 0, 'ninguna llamada debe haber tocado el cliente supabase-js');
    });

    await at('allowlist: las 9 tablas permitidas no lanzan por nombre de tabla', async function () {
        const TABLES = ['ventas', 'facturas', 'costos', 'servicios', 'personal', 'clientes', 'equipos', 'cotizaciones', 'config'];
        for (const t of TABLES) {
            const env = freshSupabaseEnv((function () {
                const s = {};
                s[t + '.select'] = { data: [], error: null };
                return s;
            })());
            const result = await env.Supabase.fetchAll(t);
            assert.deepStrictEqual(result, []);
        }
    });

    // ================= _client — un solo cliente memoizado =================
    await at('_client: expone el cliente crudo, memoizado (una sola instancia, un solo createClient())', async function () {
        delete require.cache[require.resolve(SUPABASE_PATH)];
        let createClientCalls = 0;
        const fakeClient = { marker: 'unico' };
        global.window = { supabase: { createClient: function () { createClientCalls++; return fakeClient; } } };
        require(SUPABASE_PATH);
        const Supabase = global.window.Mazelab.Supabase;

        const c1 = Supabase._client;
        const c2 = Supabase._client;
        assert.strictEqual(c1, fakeClient);
        assert.strictEqual(c1, c2, 'debe ser exactamente la misma instancia en accesos repetidos');
        assert.strictEqual(createClientCalls, 1, 'createClient() debe llamarse UNA sola vez (cliente único en toda la app)');
    });

    // ================= Requerir el módulo sin el CDN cargado no debe lanzar =================
    await at('require(supabase.js) sin window.supabase (CDN no cargado) NO lanza al cargar el módulo', function () {
        delete require.cache[require.resolve(SUPABASE_PATH)];
        global.window = {}; // sin .supabase — simula que el script del CDN no cargó
        assert.doesNotThrow(function () { require(SUPABASE_PATH); });
        assert.ok(global.window.Mazelab.Supabase, 'el módulo debe seguir exportando su interfaz');
    });

    await at('sin window.supabase: invocar un método SÍ lanza (recién ahí, no al cargar)', async function () {
        delete require.cache[require.resolve(SUPABASE_PATH)];
        global.window = {};
        require(SUPABASE_PATH);
        const Supabase = global.window.Mazelab.Supabase;
        await assertRejects(Supabase.fetchAll('ventas'), /Supabase SDK no está cargado/);
    });

    console.log('\n' + pass + ' OK, ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
})().catch(function (e) {
    console.error('ERROR FATAL:', e);
    process.exit(1);
});
