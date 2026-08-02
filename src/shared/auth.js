// Auth Service — Sprint M1, Lote M1-B: reescrito sobre Supabase Auth + tabla
// profiles (antes: hash SHA-256 casero + fallback a localStorage). Conserva
// TODA la interfaz pública del Sprint 1 (login, register, logout, getUser,
// isLoggedIn, isSuperAdmin, isAdmin, canAccess, canManageUsers, getAllUsers,
// updateUserRole, toggleUserActive, deleteUser, resetPassword, hashPassword,
// ROLE_LABELS) más un init() nuevo que app.js debe esperar antes de decidir
// login vs app. getUser()/isLoggedIn()/canAccess() siguen siendo SÍNCRONOS —
// leen un cache poblado por init()/login()/onAuthStateChange, nunca golpean
// la red directamente (los módulos del Sprint 1 los llaman sync).
//
// Roles: superadmin, socio, comercial, operaciones
// - superadmin: acceso total + gestión de usuarios (rol/activo/borrado lógico)
// - socio: acceso total (gestión de usuarios de solo lectura, ver canManageUsers)
// - comercial: ventas, CXC, cotizador, kanban, bodega, dashboard (vista comercial)
// - operaciones: kanban, bodega, dashboard (vista ops), CXP solo lectura
//
// ELIMINADO respecto al Sprint 1 (ya no aplica con Supabase Auth real):
// - Seed de superadmin con contraseña publicada en el código.
// - Hash SHA-256 casero + salt fijo (hashPassword queda como stub que lanza).
// - mazelab_users_local y cualquier fallback de usuarios a localStorage.
// - migrateRole(): el trigger handle_new_user (supabase/schema.sql) asigna
//   roles nuevos directamente — no hay roles legados que migrar en profiles.
window.Mazelab = window.Mazelab || {};

(function () {
    var ROLE_LABELS = {
        superadmin:   'Super Admin',
        socio:        'Socio',
        comercial:    'Comercial',
        operaciones:  'Operaciones'
    };

    // Rutas restringidas por rol — si una ruta NO está listada, es abierta a
    // cualquier usuario autenticado. Cada entrada lista los roles que SÍ pueden
    // acceder. Intacto respecto al Sprint 1.
    var RESTRICTED = {
        sales:     ['superadmin', 'socio', 'comercial'],
        finance:   ['superadmin', 'socio', 'comercial'],
        payables:  ['superadmin', 'socio'],
        nominas:   ['superadmin', 'socio'],
        pagos:     ['superadmin', 'socio'],
        cashflow:  ['superadmin', 'socio'],
        analytics: ['superadmin', 'socio'],
        cotizador: ['superadmin', 'socio', 'comercial'],
        'cxc-kanban': ['superadmin', 'socio', 'comercial'],
        import:    ['superadmin']
    };
    // Abierto a todos: dashboard, kanban, bodega, events, settings

    // Cache síncrono del usuario logueado — {id, email, name, role} o null.
    // Poblado por init() (restauración de sesión), login(), y onAuthStateChange
    // (cambios de sesión en caliente: expiración, logout en otra pestaña, etc.).
    var _cachedUser = null;

    var _client = null;
    var _initPromise = null;

    // Mismo cliente supabase-js que usa src/shared/supabase.js — nunca se crea
    // uno propio aquí (dos clientes duplicarían sesiones).
    function getClient() {
        if (_client) return _client;
        var SB = window.Mazelab.Supabase;
        if (!SB) throw new Error('Auth: window.Mazelab.Supabase no está disponible (revisa el orden de scripts en index.html).');
        _client = SB._client;
        return _client;
    }

    // Carga el profile del usuario autenticado dentro del cache síncrono.
    // Devuelve la fila de profiles (con "active" incluido) para que el llamador
    // distinga "sin perfil" (null) de "perfil desactivado" (profile.active === false).
    // NO decide por sí sola si cerrar sesión — eso lo resuelve cada llamador
    // según su propio contexto (login() sí cierra sesión ante inactivo/ausente,
    // init() solo deja el cache en null).
    async function loadProfileIntoCache(authUser) {
        var client = getClient();
        var res = await client.from('profiles').select('*').eq('id', authUser.id).single();
        if (res.error || !res.data) {
            _cachedUser = null;
            return null;
        }
        if (res.data.active === false) {
            _cachedUser = null;
            return res.data;
        }
        _cachedUser = { id: res.data.id, email: res.data.email, name: res.data.name || '', role: res.data.role };
        return res.data;
    }

    // Flujo mínimo viable para el link de recuperación de contraseña: Supabase
    // redirige a la app con una sesión de tipo PASSWORD_RECOVERY activa. Sin
    // pantalla dedicada en este sprint — se pide la contraseña nueva por
    // prompt() y se aplica con updateUser(). (M2: pantalla propia.)
    async function handlePasswordRecovery() {
        var newPassword = (typeof window.prompt === 'function')
            ? window.prompt('Ingresa tu nueva contraseña (mínimo 6 caracteres):')
            : null;
        if (!newPassword) return;
        if (newPassword.length < 6) {
            if (typeof window.alert === 'function') window.alert('La contraseña debe tener al menos 6 caracteres. Vuelve a abrir el link del correo para intentar de nuevo.');
            return;
        }
        try {
            var client = getClient();
            var res = await client.auth.updateUser({ password: newPassword });
            if (res.error) throw new Error(res.error.message);
            if (typeof window.alert === 'function') window.alert('Contraseña actualizada. Ya puedes iniciar sesión con tu nueva contraseña.');
        } catch (e) {
            if (typeof window.alert === 'function') window.alert('No se pudo actualizar la contraseña: ' + e.message);
        }
    }

    // init() — restaura la sesión (si existe), carga el profile propio en el
    // cache síncrono, y se suscribe a onAuthStateChange para mantenerlo al día.
    // Idempotente: llamadas repetidas reusan la misma promesa (no vuelve a
    // suscribirse dos veces). app.js debe esperar esta promesa ANTES de decidir
    // login vs app — de lo contrario getUser()/isLoggedIn() verían el cache
    // todavía vacío aunque exista una sesión válida.
    async function init() {
        if (_initPromise) return _initPromise;
        _initPromise = (async function () {
            var client = getClient();

            try {
                var sessionRes = await client.auth.getSession();
                var session = sessionRes && sessionRes.data ? sessionRes.data.session : null;
                if (session && session.user) {
                    var profile = await loadProfileIntoCache(session.user);
                    if (!profile || profile.active === false) {
                        // Sesión restaurada pero sin perfil válido o desactivado —
                        // no debe quedar una sesión "viva" en localStorage mientras
                        // la app trata al usuario como deslogueado.
                        try { await client.auth.signOut(); } catch (e) { /* best-effort */ }
                        _cachedUser = null;
                    }
                } else {
                    _cachedUser = null;
                }
            } catch (e) {
                console.error('Auth.init(): error obteniendo la sesión:', e);
                _cachedUser = null;
            }

            try {
                client.auth.onAuthStateChange(function (event, session) {
                    if (event === 'SIGNED_OUT') {
                        _cachedUser = null;
                        return;
                    }
                    if (event === 'PASSWORD_RECOVERY') {
                        handlePasswordRecovery();
                        return;
                    }
                    if (session && session.user) {
                        loadProfileIntoCache(session.user).catch(function (e) {
                            console.error('Auth: error refrescando el perfil tras cambio de sesión:', e);
                        });
                    }
                });
            } catch (e) {
                console.error('Auth.init(): no se pudo suscribir a onAuthStateChange:', e);
            }
        })();
        return _initPromise;
    }

    function getUser() {
        return _cachedUser;
    }

    function isLoggedIn() {
        return !!_cachedUser;
    }

    function isSuperAdmin() {
        return !!_cachedUser && _cachedUser.role === 'superadmin';
    }

    function isAdmin() {
        return !!_cachedUser && (_cachedUser.role === 'superadmin' || _cachedUser.role === 'socio');
    }

    function canAccess(route) {
        var allowed = RESTRICTED[route];
        if (!allowed) return true; // ruta sin restricción
        if (!_cachedUser) return false;
        return allowed.indexOf(_cachedUser.role) !== -1;
    }

    function canManageUsers() {
        return !!_cachedUser && (_cachedUser.role === 'superadmin' || _cachedUser.role === 'socio');
    }

    async function login(email, password) {
        if (!email || !password) throw new Error('Email y contraseña son requeridos.');
        email = email.trim().toLowerCase();

        var client = getClient();
        var res = await client.auth.signInWithPassword({ email: email, password: password });
        if (res.error || !res.data || !res.data.user) {
            throw new Error('Email o contraseña incorrectos.');
        }

        var profile = await loadProfileIntoCache(res.data.user);
        if (!profile) {
            try { await client.auth.signOut(); } catch (e) { /* best-effort */ }
            throw new Error('No se encontró un perfil para este usuario. Contacta al administrador.');
        }
        if (profile.active === false) {
            try { await client.auth.signOut(); } catch (e) { /* best-effort */ }
            throw new Error('Usuario desactivado');
        }
        return _cachedUser;
    }

    async function logout() {
        try {
            var client = getClient();
            await client.auth.signOut();
        } catch (e) {
            console.warn('Auth.logout(): error cerrando sesión en el servidor:', e);
        }
        _cachedUser = null;
    }

    async function register() {
        throw new Error('El registro está cerrado — pide acceso al administrador.');
    }

    // Self-service: pantalla de login (no autenticado) pide un link de reseteo
    // para su propio email. Distinto de resetPassword(userId), que es la acción
    // de un admin logueado sobre OTRO usuario.
    async function requestPasswordReset(email) {
        if (!email) throw new Error('Ingresa tu email.');
        email = email.trim().toLowerCase();
        var client = getClient();
        var res = await client.auth.resetPasswordForEmail(email);
        if (res.error) throw new Error('No se pudo enviar el correo: ' + res.error.message);
        return true;
    }

    async function getAllUsers() {
        var client = getClient();
        var res = await client.from('profiles').select('*').order('email');
        if (res.error) throw new Error('Error al leer usuarios: ' + res.error.message);
        return (res.data || []).map(function (p) {
            return { id: p.id, email: p.email, name: p.name, role: p.role, active: p.active };
        });
    }

    // RLS (supabase/schema.sql, política profiles_update_superadmin) solo permite
    // UPDATE de profiles al rol superadmin — el gate de cliente refleja esa
    // misma verdad para fallar con un mensaje claro antes de tocar la red, en
    // vez de dejar que RLS lo rechace con un error genérico.
    async function updateUserRole(userId, newRole) {
        if (!isSuperAdmin()) throw new Error('Solo el superadmin puede cambiar roles.');
        var client = getClient();
        var res = await client.from('profiles').update({ role: newRole }).eq('id', userId).select().single();
        if (res.error) throw new Error('Error al actualizar el rol: ' + res.error.message);
        return res.data;
    }

    async function toggleUserActive(userId, active) {
        if (!isSuperAdmin()) throw new Error('Solo el superadmin puede activar/desactivar usuarios.');
        var client = getClient();
        var res = await client.from('profiles').update({ active: active }).eq('id', userId).select().single();
        if (res.error) throw new Error('Error al actualizar el usuario: ' + res.error.message);
        return res.data;
    }

    // El cliente (anon key + RLS) nunca puede borrar de auth.users — solo el
    // panel de Supabase o la service key pueden. deleteUser() desactiva el
    // profile (best-effort) y siempre lanza para explicar el límite real,
    // en vez de fingir un borrado que no ocurrió.
    async function deleteUser(userId) {
        if (!isSuperAdmin()) throw new Error('Solo el superadmin puede eliminar usuarios.');
        await toggleUserActive(userId, false);
        throw new Error('Usuario desactivado. El borrado definitivo se hace desde el panel de Supabase (Authentication > Users) — el cliente no puede borrar usuarios de auth.users.');
    }

    // Acción de administrador sobre OTRO usuario: busca su email en profiles y
    // dispara el correo de restablecimiento de Supabase — ya no recibe (ni
    // puede recibir) una contraseña nueva en texto plano.
    async function resetPassword(userId) {
        if (!canManageUsers()) throw new Error('No tienes permisos para resetear contraseñas.');
        var client = getClient();
        var res = await client.from('profiles').select('email').eq('id', userId).single();
        if (res.error || !res.data || !res.data.email) {
            throw new Error('No se pudo encontrar el email del usuario.');
        }
        var result = await client.auth.resetPasswordForEmail(res.data.email);
        if (result.error) throw new Error('Error al enviar el correo de restablecimiento: ' + result.error.message);
        return true;
    }

    function hashPassword() {
        throw new Error('hashPassword: obsoleto — la autenticación ahora usa Supabase Auth (el hash lo gestiona el servidor).');
    }

    window.Mazelab.Auth = {
        init: init,
        login: login,
        register: register,
        logout: logout,
        getUser: getUser,
        isLoggedIn: isLoggedIn,
        isSuperAdmin: isSuperAdmin,
        isAdmin: isAdmin,
        canAccess: canAccess,
        canManageUsers: canManageUsers,
        getAllUsers: getAllUsers,
        updateUserRole: updateUserRole,
        toggleUserActive: toggleUserActive,
        deleteUser: deleteUser,
        resetPassword: resetPassword,
        requestPasswordReset: requestPasswordReset,
        hashPassword: hashPassword,
        ROLE_LABELS: ROLE_LABELS
    };
})();
