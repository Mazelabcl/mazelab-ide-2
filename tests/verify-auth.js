// Verificación Lote M1-B (Sprint M1) — carga el src/shared/auth.js REAL en
// Node con un mock inyectable del cliente supabase-js (vía
// window.Mazelab.Supabase._client, el mismo punto de acceso que usa el auth.js
// real — nunca crea su propio cliente). Sin red real.
//
// Cubre: login OK carga el profile y getUser() (síncrono) devuelve la forma
// {id,email,name,role}; login con profiles.active=false lanza "Usuario
// desactivado" Y cierra la sesión; register() lanza "cerrado"; canAccess()
// respeta la matriz RESTRICTED completa por rol; updateUserRole() hace UPDATE
// sobre profiles (y respeta el gate de superadmin); además cobertura de
// isSuperAdmin/isAdmin/canManageUsers, toggleUserActive, deleteUser,
// resetPassword/requestPasswordReset, hashPassword (obsoleto), getAllUsers,
// e init() restaurando una sesión existente.
// Correr con: node tests/verify-auth.js
'use strict';
const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..');
const AUTH_PATH = path.join(REPO, 'src/shared/auth.js');

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
// Mock de cliente supabase-js: .auth.* configurable + query builder mínimo
// encadenable para .from('profiles')...
// ----------------------------------------------------------------------------
function makeMockClient(opts) {
    opts = opts || {};
    const calls = { auth: [], from: [] };
    let signedOut = false;

    const authMock = {
        getSession: async function () {
            calls.auth.push({ method: 'getSession' });
            return opts.getSession ? opts.getSession() : { data: { session: null }, error: null };
        },
        signInWithPassword: async function (creds) {
            calls.auth.push({ method: 'signInWithPassword', args: creds });
            return opts.signInWithPassword ? opts.signInWithPassword(creds) : { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } };
        },
        signOut: async function () {
            signedOut = true;
            calls.auth.push({ method: 'signOut' });
            return { error: null };
        },
        onAuthStateChange: function (cb) {
            calls.auth.push({ method: 'onAuthStateChange' });
            authMock._subscriber = cb;
            return { data: { subscription: { unsubscribe: function () {} } } };
        },
        updateUser: async function (fields) {
            calls.auth.push({ method: 'updateUser', args: fields });
            return opts.updateUser ? opts.updateUser(fields) : { data: {}, error: null };
        },
        resetPasswordForEmail: async function (email, options) {
            calls.auth.push({ method: 'resetPasswordForEmail', args: email, options: options });
            return opts.resetPasswordForEmail ? opts.resetPasswordForEmail(email) : { data: {}, error: null };
        },
        wasSignedOut: function () { return signedOut; }
    };

    function makeBuilder(table) {
        const state = { table: table };
        const builder = {
            select: function (cols) { state.method = state.method || 'select'; state.selectCols = cols; return builder; },
            update: function (updates) { state.method = 'update'; state.updates = updates; return builder; },
            eq: function (col, val) { state.eq = { col: col, val: val }; return builder; },
            order: function (col) { state.order = col; return builder; },
            single: function () { state.single = true; return resolve(); },
            then: function (res, rej) { return resolve().then(res, rej); }
        };
        function resolve() {
            calls.from.push({ table: state.table, method: state.method, eq: state.eq, updates: state.updates, order: state.order, single: !!state.single, selectCols: state.selectCols });
            const key = table + '.' + state.method + (state.eq ? '.' + state.eq.col + '=' + state.eq.val : '');
            let scripted = opts.from && (opts.from[key] || opts.from[table + '.' + state.method]);
            if (typeof scripted === 'function') scripted = scripted(state);
            return Promise.resolve(scripted || { data: null, error: null });
        }
        return builder;
    }

    const client = {
        auth: authMock,
        from: function (table) { return makeBuilder(table); }
    };

    return { client: client, calls: calls, authMock: authMock };
}

function freshAuthEnv(clientOpts) {
    delete require.cache[require.resolve(AUTH_PATH)];
    const mock = makeMockClient(clientOpts);
    global.window = {
        Mazelab: { Supabase: { _client: mock.client } },
        // I7: getRedirectTo() lee window.location.origin/pathname — se define
        // aquí para poder verificar que resetPasswordForEmail() lo manda.
        location: { origin: 'http://localhost:3000', pathname: '/' }
    };
    require(AUTH_PATH);
    return { Auth: global.window.Mazelab.Auth, client: mock.client, calls: mock.calls, authMock: mock.authMock };
}

const PROFILE_ROW = { id: 'u-1', email: 'comercial@mazelab.cl', name: 'Vale', role: 'comercial', active: true, created_at: '2026-01-15T10:00:00.000Z' };

(async function () {

    // ================= login() — camino feliz =================
    await at('login(): OK → signInWithPassword + carga profile; getUser() (sync) devuelve {id,email,name,role}', async function () {
        const env = freshAuthEnv({
            signInWithPassword: function () { return { data: { user: { id: 'u-1', email: 'comercial@mazelab.cl' }, session: {} }, error: null }; },
            from: { 'profiles.select.id=u-1': { data: PROFILE_ROW, error: null } }
        });
        const user = await env.Auth.login('Comercial@Mazelab.cl', 'clave123');
        assert.deepStrictEqual(user, { id: 'u-1', email: 'comercial@mazelab.cl', name: 'Vale', role: 'comercial' });

        // getUser()/isLoggedIn() son SÍNCRONOS — deben reflejar el cache recién poblado
        // sin ningún await adicional.
        assert.deepStrictEqual(env.Auth.getUser(), { id: 'u-1', email: 'comercial@mazelab.cl', name: 'Vale', role: 'comercial' });
        assert.strictEqual(env.Auth.isLoggedIn(), true);

        const loginCall = env.calls.auth.find(function (c) { return c.method === 'signInWithPassword'; });
        assert.strictEqual(loginCall.args.email, 'comercial@mazelab.cl', 'el email debe normalizarse a minúsculas/trim');
    });

    await at('login(): credenciales inválidas → "Email o contraseña incorrectos.", cache queda vacío', async function () {
        const env = freshAuthEnv({
            signInWithPassword: function () { return { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } }; }
        });
        await assertRejects(env.Auth.login('x@mazelab.cl', 'malapass'), /^Email o contraseña incorrectos\.$/);
        assert.strictEqual(env.Auth.getUser(), null);
        assert.strictEqual(env.Auth.isLoggedIn(), false);
    });

    // ================= login() — profile.active = false =================
    await at('login(): profiles.active=false → lanza "Usuario desactivado" Y cierra la sesión (signOut)', async function () {
        const inactiveProfile = Object.assign({}, PROFILE_ROW, { active: false });
        const env = freshAuthEnv({
            signInWithPassword: function () { return { data: { user: { id: 'u-1', email: 'comercial@mazelab.cl' }, session: {} }, error: null }; },
            from: { 'profiles.select.id=u-1': { data: inactiveProfile, error: null } }
        });
        const err = await assertRejects(env.Auth.login('comercial@mazelab.cl', 'clave123'));
        assert.strictEqual(err.message, 'Usuario desactivado');
        assert.strictEqual(env.Auth.getUser(), null, 'el cache NO debe quedar poblado con un usuario desactivado');
        assert.strictEqual(env.Auth.isLoggedIn(), false);
        assert.strictEqual(env.authMock.wasSignedOut(), true, 'debe haber llamado signOut() al detectar active=false');
    });

    await at('login(): sin perfil asociado (profile no encontrado) → mensaje distinto, también cierra sesión', async function () {
        const env = freshAuthEnv({
            signInWithPassword: function () { return { data: { user: { id: 'u-huerfano', email: 'huerfano@mazelab.cl' }, session: {} }, error: null }; },
            from: { 'profiles.select.id=u-huerfano': { data: null, error: { message: 'no rows' } } }
        });
        const err = await assertRejects(env.Auth.login('huerfano@mazelab.cl', 'clave123'));
        assert.ok(/No se encontró un perfil/.test(err.message), 'mensaje real: ' + err.message);
        assert.strictEqual(env.authMock.wasSignedOut(), true);
    });

    // ================= register() =================
    await at('register(): SIEMPRE lanza "registro está cerrado", sin tocar la red', async function () {
        const env = freshAuthEnv({});
        await assertRejects(env.Auth.register('nuevo@mazelab.cl', 'pass123', 'Nuevo'), /El registro está cerrado — pide acceso al administrador\./);
        assert.strictEqual(env.calls.auth.length, 0, 'register() no debe llamar ningún método de auth');
        assert.strictEqual(env.calls.from.length, 0, 'register() no debe tocar profiles');
    });

    // ================= canAccess() — matriz RESTRICTED completa =================
    await at('canAccess(): matriz RESTRICTED completa por rol (intacta respecto al Sprint 1)', async function () {
        const env = freshAuthEnv({
            signInWithPassword: function () { return { data: { user: { id: 'u-1' }, session: {} }, error: null }; }
        });

        const EXPECTED = {
            sales:        ['superadmin', 'socio', 'comercial'],
            finance:      ['superadmin', 'socio', 'comercial'],
            payables:     ['superadmin', 'socio'],
            nominas:      ['superadmin', 'socio'],
            pagos:        ['superadmin', 'socio'],
            cashflow:     ['superadmin', 'socio'],
            analytics:    ['superadmin', 'socio'],
            cotizador:    ['superadmin', 'socio', 'comercial'],
            'cxc-kanban': ['superadmin', 'socio', 'comercial'],
            import:       ['superadmin']
        };
        const ALL_ROLES = ['superadmin', 'socio', 'comercial', 'operaciones'];

        for (const route of Object.keys(EXPECTED)) {
            for (const role of ALL_ROLES) {
                env.client.from = function (table) {
                    // Reconfigura el mock de profiles para simular login con este rol.
                    return makeMockClient({ from: { 'profiles.select.id=u-1': { data: { id: 'u-1', email: 'r@mazelab.cl', name: 'R', role: role, active: true }, error: null } } }).client.from(table);
                };
                await env.Auth.login('r@mazelab.cl', 'x');
                const allowed = EXPECTED[route].indexOf(role) !== -1;
                assert.strictEqual(env.Auth.canAccess(route), allowed,
                    'ruta "' + route + '" con rol "' + role + '" — se esperaba ' + allowed);
            }
        }

        // Rutas abiertas (no listadas en RESTRICTED): abiertas a cualquier rol autenticado.
        ['dashboard', 'kanban', 'bodega', 'events', 'settings'].forEach(function (route) {
            assert.strictEqual(env.Auth.canAccess(route), true, 'ruta abierta "' + route + '" debe ser accesible');
        });

        // Sin sesión (cache vacío): ninguna ruta restringida debe ser accesible.
        await env.Auth.logout();
        assert.strictEqual(env.Auth.canAccess('sales'), false, 'sin sesión, una ruta restringida NO debe ser accesible');
        assert.strictEqual(env.Auth.canAccess('dashboard'), true, 'sin sesión, una ruta abierta sigue siendo accesible (comportamiento intacto del Sprint 1)');
    });

    // ================= isSuperAdmin / isAdmin / canManageUsers =================
    await at('isSuperAdmin()/isAdmin()/canManageUsers(): reflejan el rol cacheado correctamente', async function () {
        async function loginAs(role) {
            const env = freshAuthEnv({
                signInWithPassword: function () { return { data: { user: { id: 'u-1' }, session: {} }, error: null }; },
                from: { 'profiles.select.id=u-1': { data: { id: 'u-1', email: 'r@mazelab.cl', name: 'R', role: role, active: true }, error: null } }
            });
            await env.Auth.login('r@mazelab.cl', 'x');
            return env.Auth;
        }
        const superadminAuth = await loginAs('superadmin');
        assert.strictEqual(superadminAuth.isSuperAdmin(), true);
        assert.strictEqual(superadminAuth.isAdmin(), true);
        assert.strictEqual(superadminAuth.canManageUsers(), true);

        const socioAuth = await loginAs('socio');
        assert.strictEqual(socioAuth.isSuperAdmin(), false);
        assert.strictEqual(socioAuth.isAdmin(), true);
        assert.strictEqual(socioAuth.canManageUsers(), true);

        const comercialAuth = await loginAs('comercial');
        assert.strictEqual(comercialAuth.isSuperAdmin(), false);
        assert.strictEqual(comercialAuth.isAdmin(), false);
        assert.strictEqual(comercialAuth.canManageUsers(), false);
    });

    // ================= updateUserRole() =================
    await at('updateUserRole(): logueado como superadmin → hace UPDATE sobre profiles con {role}', async function () {
        const env = freshAuthEnv({
            signInWithPassword: function () { return { data: { user: { id: 'u-admin' }, session: {} }, error: null }; },
            from: {
                'profiles.select.id=u-admin': { data: { id: 'u-admin', email: 'admin@mazelab.cl', name: 'Admin', role: 'superadmin', active: true }, error: null },
                'profiles.update.id=u-2': { data: { id: 'u-2', role: 'comercial' }, error: null }
            }
        });
        await env.Auth.login('admin@mazelab.cl', 'x');
        const result = await env.Auth.updateUserRole('u-2', 'comercial');
        assert.deepStrictEqual(result, { id: 'u-2', role: 'comercial' });

        const updateCall = env.calls.from.find(function (c) { return c.table === 'profiles' && c.method === 'update' && c.eq && c.eq.val === 'u-2'; });
        assert.ok(updateCall, 'debe haber llamado .from("profiles").update(...).eq("id","u-2")');
        assert.deepStrictEqual(updateCall.updates, { role: 'comercial' });
        assert.ok(updateCall.single, 'debe usar .single()');
    });

    await at('updateUserRole(): logueado como socio (no superadmin) → lanza SIN tocar la red (refleja RLS: solo superadmin)', async function () {
        const env = freshAuthEnv({
            signInWithPassword: function () { return { data: { user: { id: 'u-socio' }, session: {} }, error: null }; },
            from: { 'profiles.select.id=u-socio': { data: { id: 'u-socio', email: 'socio@mazelab.cl', name: 'Socio', role: 'socio', active: true }, error: null } }
        });
        await env.Auth.login('socio@mazelab.cl', 'x');
        const callsBefore = env.calls.from.length;
        await assertRejects(env.Auth.updateUserRole('u-2', 'comercial'), /Solo el superadmin puede cambiar roles\./);
        assert.strictEqual(env.calls.from.length, callsBefore, 'no debe haber tocado profiles si el gate de rol rechaza');
    });

    await at('updateUserRole(): sin sesión → lanza sin tocar la red', async function () {
        const env = freshAuthEnv({});
        await assertRejects(env.Auth.updateUserRole('u-2', 'comercial'), /Solo el superadmin puede cambiar roles\./);
        assert.strictEqual(env.calls.from.length, 0);
    });

    // ================= toggleUserActive() / deleteUser() =================
    await at('toggleUserActive(): superadmin → UPDATE profiles {active}; no-superadmin → lanza', async function () {
        const env = freshAuthEnv({
            signInWithPassword: function () { return { data: { user: { id: 'u-admin' }, session: {} }, error: null }; },
            from: {
                'profiles.select.id=u-admin': { data: { id: 'u-admin', email: 'admin@mazelab.cl', name: 'Admin', role: 'superadmin', active: true }, error: null },
                'profiles.update.id=u-2': { data: { id: 'u-2', active: false }, error: null }
            }
        });
        await env.Auth.login('admin@mazelab.cl', 'x');
        const result = await env.Auth.toggleUserActive('u-2', false);
        assert.deepStrictEqual(result, { id: 'u-2', active: false });
        const updateCall = env.calls.from.find(function (c) { return c.table === 'profiles' && c.method === 'update' && c.eq.val === 'u-2'; });
        assert.deepStrictEqual(updateCall.updates, { active: false });
    });

    await at('deleteUser(): superadmin → desactiva (toggleUserActive) y SIEMPRE lanza explicando el límite', async function () {
        const env = freshAuthEnv({
            signInWithPassword: function () { return { data: { user: { id: 'u-admin' }, session: {} }, error: null }; },
            from: {
                'profiles.select.id=u-admin': { data: { id: 'u-admin', email: 'admin@mazelab.cl', name: 'Admin', role: 'superadmin', active: true }, error: null },
                'profiles.update.id=u-2': { data: { id: 'u-2', active: false }, error: null }
            }
        });
        await env.Auth.login('admin@mazelab.cl', 'x');
        const err = await assertRejects(env.Auth.deleteUser('u-2'));
        assert.ok(/panel de Supabase/.test(err.message), 'debe explicar que el borrado definitivo se hace desde el panel de Supabase. mensaje: ' + err.message);
        const updateCall = env.calls.from.find(function (c) { return c.table === 'profiles' && c.method === 'update' && c.eq.val === 'u-2'; });
        assert.ok(updateCall, 'debe haber desactivado el profile ANTES de lanzar');
        assert.deepStrictEqual(updateCall.updates, { active: false });
    });

    await at('deleteUser(): no-superadmin → lanza de inmediato, sin desactivar nada', async function () {
        const env = freshAuthEnv({
            signInWithPassword: function () { return { data: { user: { id: 'u-com' }, session: {} }, error: null }; },
            from: { 'profiles.select.id=u-com': { data: { id: 'u-com', email: 'com@mazelab.cl', name: 'Com', role: 'comercial', active: true }, error: null } }
        });
        await env.Auth.login('com@mazelab.cl', 'x');
        const callsBefore = env.calls.from.length;
        await assertRejects(env.Auth.deleteUser('u-2'), /Solo el superadmin puede eliminar usuarios\./);
        assert.strictEqual(env.calls.from.length, callsBefore);
    });

    // ================= resetPassword() / requestPasswordReset() =================
    await at('resetPassword(userId): busca el email en profiles y llama resetPasswordForEmail — ya NO recibe contraseña', async function () {
        const env = freshAuthEnv({
            signInWithPassword: function () { return { data: { user: { id: 'u-admin' }, session: {} }, error: null }; },
            from: {
                'profiles.select.id=u-admin': { data: { id: 'u-admin', email: 'admin@mazelab.cl', name: 'Admin', role: 'superadmin', active: true }, error: null },
                'profiles.select.id=u-target': { data: { email: 'target@mazelab.cl' }, error: null }
            },
            resetPasswordForEmail: function (email) { return { data: {}, error: null, _email: email }; }
        });
        await env.Auth.login('admin@mazelab.cl', 'x');
        assert.strictEqual(env.Auth.resetPassword.length, 1, 'resetPassword ya no debe declarar un segundo parámetro (contraseña)');
        const ok = await env.Auth.resetPassword('u-target');
        assert.strictEqual(ok, true);
        const rpCall = env.calls.auth.find(function (c) { return c.method === 'resetPasswordForEmail'; });
        assert.strictEqual(rpCall.args, 'target@mazelab.cl');
        assert.strictEqual(rpCall.options && rpCall.options.redirectTo, 'http://localhost:3000/', 'I7: debe mandar redirectTo explícito (sin él, Supabase manda a la Site URL del proyecto, no necesariamente esta app)');
    });

    await at('requestPasswordReset(email): self-service para la pantalla de login, sin requerir sesión ni permisos', async function () {
        const env = freshAuthEnv({
            resetPasswordForEmail: function (email) { return { data: {}, error: null }; }
        });
        const ok = await env.Auth.requestPasswordReset('Yo@Mazelab.cl');
        assert.strictEqual(ok, true);
        const rpCall = env.calls.auth.find(function (c) { return c.method === 'resetPasswordForEmail'; });
        assert.strictEqual(rpCall.options && rpCall.options.redirectTo, 'http://localhost:3000/', 'I7: requestPasswordReset() también debe mandar redirectTo explícito');
        assert.strictEqual(rpCall.args, 'yo@mazelab.cl', 'debe normalizar el email a minúsculas/trim');
    });

    // ================= getAllUsers() =================
    await at('getAllUsers(): lee profiles y mapea la forma esperada (incluye created_at — M5)', async function () {
        const env = freshAuthEnv({
            from: { 'profiles.select': { data: [PROFILE_ROW, { id: 'u-2', email: 'a@mazelab.cl', name: 'A', role: 'operaciones', active: false, created_at: '2026-02-01T08:30:00.000Z' }], error: null } }
        });
        const users = await env.Auth.getAllUsers();
        assert.strictEqual(users.length, 2);
        assert.deepStrictEqual(users[0], { id: 'u-1', email: 'comercial@mazelab.cl', name: 'Vale', role: 'comercial', active: true, created_at: '2026-01-15T10:00:00.000Z' });
        assert.deepStrictEqual(users[1], { id: 'u-2', email: 'a@mazelab.cl', name: 'A', role: 'operaciones', active: false, created_at: '2026-02-01T08:30:00.000Z' });
    });

    // ================= hashPassword() — obsoleto =================
    await at('hashPassword(): sigue exportado pero SIEMPRE lanza "obsoleto"', async function () {
        const env = freshAuthEnv({});
        assert.throws(function () { env.Auth.hashPassword('x'); }, /obsoleto/);
    });

    // ================= init() — restaura sesión existente =================
    await at('init(): con sesión existente → carga el profile propio, getUser() queda poblado tras esperar init()', async function () {
        const env = freshAuthEnv({
            getSession: function () { return { data: { session: { user: { id: 'u-1', email: 'comercial@mazelab.cl' } } }, error: null }; },
            from: { 'profiles.select.id=u-1': { data: PROFILE_ROW, error: null } }
        });
        assert.strictEqual(env.Auth.getUser(), null, 'antes de init(), el cache debe estar vacío');
        await env.Auth.init();
        assert.deepStrictEqual(env.Auth.getUser(), { id: 'u-1', email: 'comercial@mazelab.cl', name: 'Vale', role: 'comercial' });
        assert.strictEqual(env.Auth.isLoggedIn(), true);
    });

    await at('init(): sin sesión → getUser() sigue null, no lanza', async function () {
        const env = freshAuthEnv({
            getSession: function () { return { data: { session: null }, error: null }; }
        });
        await assert.doesNotReject(env.Auth.init());
        assert.strictEqual(env.Auth.getUser(), null);
    });

    await at('init(): sesión restaurada con profile.active=false → cierra sesión y deja el cache vacío', async function () {
        const inactiveProfile = Object.assign({}, PROFILE_ROW, { active: false });
        const env = freshAuthEnv({
            getSession: function () { return { data: { session: { user: { id: 'u-1', email: 'comercial@mazelab.cl' } } }, error: null }; },
            from: { 'profiles.select.id=u-1': { data: inactiveProfile, error: null } }
        });
        await env.Auth.init();
        assert.strictEqual(env.Auth.getUser(), null);
        assert.strictEqual(env.authMock.wasSignedOut(), true);
    });

    await at('init(): es idempotente — llamadas repetidas reusan la misma promesa (no se suscribe dos veces)', async function () {
        const env = freshAuthEnv({
            getSession: function () { return { data: { session: null }, error: null }; }
        });
        await env.Auth.init();
        await env.Auth.init();
        const subscribeCalls = env.calls.auth.filter(function (c) { return c.method === 'onAuthStateChange'; });
        assert.strictEqual(subscribeCalls.length, 1, 'onAuthStateChange debe suscribirse una sola vez sin importar cuántas veces se llame init()');
    });

    // ================= B1 (fix round): onAuthStateChange ANTES de getSession =================
    await at('B1: onAuthStateChange se suscribe ANTES de getSession() (orden verificable en calls.auth)', async function () {
        const env = freshAuthEnv({
            getSession: function () { return { data: { session: null }, error: null }; }
        });
        await env.Auth.init();
        const subscribeIdx  = env.calls.auth.findIndex(function (c) { return c.method === 'onAuthStateChange'; });
        const getSessionIdx = env.calls.auth.findIndex(function (c) { return c.method === 'getSession'; });
        assert.notStrictEqual(subscribeIdx, -1, 'debe haberse suscrito a onAuthStateChange');
        assert.notStrictEqual(getSessionIdx, -1, 'debe haber llamado getSession');
        assert.ok(subscribeIdx < getSessionIdx,
            'onAuthStateChange debe registrarse ANTES de getSession() — con el SDK real (2.111.0) el evento ' +
            'PASSWORD_RECOVERY puede emitirse durante/antes de esa primera llamada; suscribirse después lo pierde para siempre');
    });

    // ================= B1 (fix round): evento PASSWORD_RECOVERY dispara el flujo real =================
    await at('B1: evento PASSWORD_RECOVERY invoca el flujo de recuperación (prompt + auth.updateUser)', async function () {
        const env = freshAuthEnv({
            getSession: function () { return { data: { session: null }, error: null }; }
        });
        await env.Auth.init();
        assert.strictEqual(typeof env.authMock._subscriber, 'function', 'el mock debe haber capturado el callback suscrito');

        global.window.prompt = function () { return 'nuevaClave123'; };
        global.window.alert = function () {};

        env.authMock._subscriber('PASSWORD_RECOVERY', { user: { id: 'u-1' } });
        await new Promise(function (r) { setTimeout(r, 20); }); // handlePasswordRecovery() no se espera dentro del suscriptor (fire-and-forget)

        const updateCall = env.calls.auth.find(function (c) { return c.method === 'updateUser'; });
        assert.ok(updateCall, 'el evento PASSWORD_RECOVERY debe haber disparado auth.updateUser() con la nueva contraseña');
        assert.deepStrictEqual(updateCall.args, { password: 'nuevaClave123' });
    });

    await at('B1: si el usuario cancela el prompt de recuperación, se cierra la sesión y NO se llama updateUser', async function () {
        const env = freshAuthEnv({
            getSession: function () { return { data: { session: null }, error: null }; }
        });
        await env.Auth.init();

        global.window.prompt = function () { return null; }; // Cancelar
        global.window.alert = function () {};

        env.authMock._subscriber('PASSWORD_RECOVERY', { user: { id: 'u-1' } });
        await new Promise(function (r) { setTimeout(r, 20); });

        const updateCall = env.calls.auth.find(function (c) { return c.method === 'updateUser'; });
        assert.ok(!updateCall, 'cancelar el prompt NO debe llamar updateUser()');
        assert.strictEqual(env.authMock.wasSignedOut(), true, 'cancelar el prompt debe cerrar la sesión de recuperación (no debe quedar viva)');
    });

    // ================= N3 (fix round): limpieza de URL tras recovery (evita repetir con F5) =================
    await at('N3: tras completar handlePasswordRecovery() con éxito, limpia la URL con history.replaceState', async function () {
        const env = freshAuthEnv({
            getSession: function () { return { data: { session: null }, error: null }; }
        });
        await env.Auth.init();

        var replaceStateCalls = [];
        global.window.history = { replaceState: function (state, title, url) { replaceStateCalls.push({ state: state, title: title, url: url }); } };
        global.window.location.pathname = '/app.html';
        global.window.prompt = function () { return 'nuevaClave123'; };
        global.window.alert = function () {};

        env.authMock._subscriber('PASSWORD_RECOVERY', { user: { id: 'u-1' } });
        await new Promise(function (r) { setTimeout(r, 20); });

        assert.strictEqual(replaceStateCalls.length, 1, 'debe haber llamado history.replaceState exactamente una vez tras completar el flujo');
        assert.strictEqual(replaceStateCalls[0].url, '/app.html', 'debe limpiar la URL al pathname actual (sin hash ni query de recuperación)');
    });

    await at('N3: al cancelar el prompt de recuperación, también limpia la URL con history.replaceState', async function () {
        const env = freshAuthEnv({
            getSession: function () { return { data: { session: null }, error: null }; }
        });
        await env.Auth.init();

        var replaceStateCalls = [];
        global.window.history = { replaceState: function (state, title, url) { replaceStateCalls.push(url); } };
        global.window.location.pathname = '/app.html';
        global.window.prompt = function () { return null; }; // Cancelar
        global.window.alert = function () {};

        env.authMock._subscriber('PASSWORD_RECOVERY', { user: { id: 'u-1' } });
        await new Promise(function (r) { setTimeout(r, 20); });

        assert.strictEqual(replaceStateCalls.length, 1,
            'cancelar el prompt también debe limpiar la URL — sin esto, un F5 vuelve a mostrar el prompt de recuperación aunque ya se canceló');
    });

    // ================= N4 (fix round): guard simétrico en el suscriptor PASSWORD_RECOVERY =================
    await at('N4: el suscriptor de PASSWORD_RECOVERY no dispara dos veces si el evento se repite (guard recoveryHandled simétrico)', async function () {
        const env = freshAuthEnv({
            getSession: function () { return { data: { session: null }, error: null }; }
        });
        await env.Auth.init();

        global.window.history = { replaceState: function () {} };
        var promptCalls = 0;
        global.window.prompt = function () { promptCalls++; return 'nuevaClave123'; };
        global.window.alert = function () {};

        env.authMock._subscriber('PASSWORD_RECOVERY', { user: { id: 'u-1' } });
        await new Promise(function (r) { setTimeout(r, 20); });
        env.authMock._subscriber('PASSWORD_RECOVERY', { user: { id: 'u-1' } }); // evento repetido por el SDK
        await new Promise(function (r) { setTimeout(r, 20); });

        assert.strictEqual(promptCalls, 1, 'un segundo evento PASSWORD_RECOVERY no debe volver a pedir la contraseña — la recuperación ya se manejó');
        var updateCalls = env.calls.auth.filter(function (c) { return c.method === 'updateUser'; });
        assert.strictEqual(updateCalls.length, 1, 'updateUser solo debe llamarse una vez aunque el evento PASSWORD_RECOVERY se repita');
    });

    // ================= I5 (fix round): SIGNED_OUT en caliente limpia cache Y re-muestra login =================
    await at('SIGNED_OUT (evento en caliente) limpia el cache Y vuelve a mostrar el login (I5)', async function () {
        const env = freshAuthEnv({
            getSession: function () { return { data: { session: null }, error: null }; },
            signInWithPassword: function () { return { data: { user: { id: 'u-1' }, session: {} }, error: null }; },
            from: { 'profiles.select.id=u-1': { data: PROFILE_ROW, error: null } }
        });
        await env.Auth.init(); // registra el suscriptor
        await env.Auth.login('comercial@mazelab.cl', 'x');
        assert.strictEqual(env.Auth.isLoggedIn(), true, 'precondición: debe haber una sesión cacheada antes del evento');

        var shown = false;
        global.window.Mazelab.AuthUI = { show: function () { shown = true; } };

        env.authMock._subscriber('SIGNED_OUT', null);

        assert.strictEqual(env.Auth.getUser(), null, 'SIGNED_OUT debe limpiar el cache síncrono');
        assert.strictEqual(env.Auth.isLoggedIn(), false);
        assert.strictEqual(shown, true, 'I5: SIGNED_OUT debe volver a mostrar el login (AuthUI.show())');
    });

    console.log('\n' + pass + ' OK, ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
})().catch(function (e) {
    console.error('ERROR FATAL:', e);
    process.exit(1);
});
