// Auth Service — simple email/password auth
// Hybrid: tries server (/api/db/users) first, falls back to localStorage.
// Passwords hashed client-side with SHA-256. Session stored in localStorage.
//
// Roles: superadmin, socio, comercial, operaciones
// - superadmin: full access + user management + delete users
// - socio: full access (read-only user management, no delete)
// - comercial: sales, CXC, cotizador, kanban, bodega, dashboard (commercial view)
// - operaciones: kanban, bodega, dashboard (ops view), CXP read-only (to check freelancer payments)
window.Mazelab = window.Mazelab || {};

(function () {
    var TOKEN_KEY = 'mazelab_auth_user';
    var USERS_LOCAL_KEY = 'mazelab_users_local';
    var SUPERADMIN_EMAIL = 'aldo@mazelab.cl';

    // Default password for superadmin seed (will be hashed)
    var SUPERADMIN_DEFAULT_PASS = 'mazelab2026';

    // Roles and their labels
    var ROLE_LABELS = {
        superadmin:   'Super Admin',
        socio:        'Socio',
        comercial:    'Comercial',
        operaciones:  'Operaciones'
    };

    // Routes restricted by role — if a route is NOT listed, it's open to all authenticated users
    // Each entry lists the roles that CAN access it
    var RESTRICTED = {
        sales:     ['superadmin', 'socio', 'comercial'],
        finance:   ['superadmin', 'socio', 'comercial'],
        payables:  ['superadmin', 'socio'],
        nominas:   ['superadmin', 'socio'],
        pagos:     ['superadmin', 'socio'],
        cashflow:  ['superadmin', 'socio'],
        analytics: ['superadmin', 'socio'],
        cotizador: ['superadmin', 'socio', 'comercial'],
        import:    ['superadmin']
    };
    // Open to all: dashboard, kanban, bodega, events, settings

    // --- localStorage helpers for users ---
    function getLocalUsers() {
        try {
            var raw = localStorage.getItem(USERS_LOCAL_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) { return []; }
    }

    function saveLocalUsers(users) {
        localStorage.setItem(USERS_LOCAL_KEY, JSON.stringify(users));
    }

    // Ensure superadmin seed exists
    async function ensureSuperAdmin(users) {
        var found = users.find(function (u) { return u.email === SUPERADMIN_EMAIL; });
        if (!found) {
            var hash = await hashPassword(SUPERADMIN_DEFAULT_PASS);
            var seed = {
                id: 'superadmin_seed_001',
                email: SUPERADMIN_EMAIL,
                password_hash: hash,
                name: 'Aldo',
                role: 'superadmin',
                active: true,
                created_at: new Date().toISOString()
            };
            users.push(seed);
            saveLocalUsers(users);
            // Best-effort server save
            var SB = window.Mazelab.Supabase;
            try { await SB.insert('users', seed); } catch (e) {}
        }
        return users;
    }

    // Try server first, fall back to localStorage
    async function fetchUsers() {
        var SB = window.Mazelab.Supabase;
        var users;
        try {
            var serverUsers = await SB.fetchAll('users');
            if (serverUsers && serverUsers.length > 0) {
                saveLocalUsers(serverUsers);
            }
            users = serverUsers || [];
        } catch (e) {
            console.warn('Auth: server unreachable, using localStorage fallback.');
            users = getLocalUsers();
        }
        // Always ensure superadmin exists
        users = await ensureSuperAdmin(users);
        return users;
    }

    // Save user to server + local (best-effort server)
    async function saveUser(user) {
        var locals = getLocalUsers();
        var idx = locals.findIndex(function (u) { return u.id === user.id; });
        if (idx >= 0) locals[idx] = user; else locals.push(user);
        saveLocalUsers(locals);

        var SB = window.Mazelab.Supabase;
        try { await SB.insert('users', user); } catch (e) {
            console.warn('Auth: could not save user to server, stored locally.');
        }
    }

    async function updateUserOnServer(userId, data) {
        var locals = getLocalUsers();
        var idx = locals.findIndex(function (u) { return u.id === userId; });
        if (idx >= 0) {
            Object.assign(locals[idx], data);
            saveLocalUsers(locals);
        }

        var SB = window.Mazelab.Supabase;
        try { await SB.update('users', userId, data); } catch (e) {
            console.warn('Auth: could not update user on server, updated locally.');
        }
    }

    async function removeUserOnServer(userId) {
        var locals = getLocalUsers();
        saveLocalUsers(locals.filter(function (u) { return u.id !== userId; }));

        var SB = window.Mazelab.Supabase;
        try { await SB.remove('users', userId); } catch (e) {
            console.warn('Auth: could not delete user on server, removed locally.');
        }
    }

    async function hashPassword(password) {
        var encoder = new TextEncoder();
        var data = encoder.encode(password + '_mazelab_salt_2026');
        var hash = await crypto.subtle.digest('SHA-256', data);
        var arr = Array.from(new Uint8Array(hash));
        return arr.map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    }

    // Map legacy roles to new system
    function migrateRole(role) {
        if (role === 'admin') return 'socio';
        if (role === 'operario') return 'operaciones';
        return role;
    }

    function getUser() {
        try {
            var raw = localStorage.getItem(TOKEN_KEY);
            if (!raw) return null;
            var u = JSON.parse(raw);
            if (u && u.role) u.role = migrateRole(u.role);
            return u;
        } catch (e) { return null; }
    }

    function setUser(user) {
        localStorage.setItem(TOKEN_KEY, JSON.stringify(user));
    }

    function logout() {
        localStorage.removeItem(TOKEN_KEY);
    }

    function isLoggedIn() {
        return !!getUser();
    }

    function isSuperAdmin() {
        var u = getUser();
        return u && u.role === 'superadmin';
    }

    function isAdmin() {
        var u = getUser();
        return u && (u.role === 'superadmin' || u.role === 'socio');
    }

    function canAccess(route) {
        var allowed = RESTRICTED[route];
        if (!allowed) return true; // unrestricted route
        var u = getUser();
        if (!u) return false;
        return allowed.indexOf(u.role) !== -1;
    }

    function canManageUsers() {
        var u = getUser();
        return u && (u.role === 'superadmin' || u.role === 'socio');
    }

    async function register(email, password, name) {
        if (!email || !password) throw new Error('Email y contraseña son requeridos.');
        if (password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');

        email = email.trim().toLowerCase();
        var passwordHash = await hashPassword(password);

        var existing = await fetchUsers();
        var found = existing.find(function (u) { return u.email === email; });
        if (found) throw new Error('Este email ya está registrado.');

        var role = (email === SUPERADMIN_EMAIL) ? 'superadmin' : 'operaciones';

        var newUser = {
            id: Date.now().toString() + '_' + Math.random().toString(36).substring(2, 8),
            email: email,
            password_hash: passwordHash,
            name: (name || '').trim() || email.split('@')[0],
            role: role,
            active: true,
            created_at: new Date().toISOString()
        };

        await saveUser(newUser);

        var session = { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role };
        setUser(session);
        return session;
    }

    async function login(email, password) {
        if (!email || !password) throw new Error('Email y contraseña son requeridos.');

        email = email.trim().toLowerCase();
        var passwordHash = await hashPassword(password);

        var users = await fetchUsers();

        var user = users.find(function (u) { return u.email === email; });
        if (!user) throw new Error('Email o contraseña incorrectos.');
        if (!user.active) throw new Error('Tu cuenta ha sido desactivada. Contacta al administrador.');
        if (user.password_hash !== passwordHash) throw new Error('Email o contraseña incorrectos.');

        var session = { id: user.id, email: user.email, name: user.name, role: migrateRole(user.role) };
        setUser(session);
        return session;
    }

    async function getAllUsers() {
        var users = await fetchUsers();
        return users.map(function (u) {
            return { id: u.id, email: u.email, name: u.name, role: migrateRole(u.role), active: u.active, created_at: u.created_at };
        });
    }

    async function updateUserRole(userId, newRole) {
        if (!canManageUsers()) throw new Error('No tienes permisos para cambiar roles.');
        // Only superadmin can assign superadmin
        var u = getUser();
        if (newRole === 'superadmin' && u.role !== 'superadmin') throw new Error('Solo el superadmin puede asignar ese rol.');
        await updateUserOnServer(userId, { role: newRole });
    }

    async function toggleUserActive(userId, active) {
        if (!isSuperAdmin()) throw new Error('Solo el superadmin puede activar/desactivar usuarios.');
        await updateUserOnServer(userId, { active: active });
    }

    async function deleteUser(userId) {
        if (!isSuperAdmin()) throw new Error('Solo el superadmin puede eliminar usuarios.');
        await removeUserOnServer(userId);
    }

    async function resetPassword(userId, newPassword) {
        if (!canManageUsers()) throw new Error('No tienes permisos para resetear contraseñas.');
        if (!newPassword || newPassword.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');
        var newHash = await hashPassword(newPassword);
        await updateUserOnServer(userId, { password_hash: newHash });
    }

    window.Mazelab.Auth = {
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
        hashPassword: hashPassword,
        ROLE_LABELS: ROLE_LABELS
    };
})();
