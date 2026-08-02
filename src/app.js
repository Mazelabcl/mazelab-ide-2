window.Mazelab = window.Mazelab || {};
window.Mazelab.Modules = window.Mazelab.Modules || {};

(function () {
    const routes = {
        dashboard: 'DashboardModule',
        sales: 'SalesModule',
        finance: 'FinanceModule',
        payables: 'PayablesModule',
        nominas: 'NominasModule',
        pagos: 'PagosModule',
        events: 'EventsModule',
        kanban: 'KanbanModule',
        bodega: 'BodegaModule',
        cotizador: 'CotizadorModule',
        cashflow: 'CashflowModule',
        analytics: 'AnalyticsModule',
        'cxc-kanban': 'CxcKanbanModule',
        settings: 'SettingsModule',
        import: 'ImportModule'
    };

    let currentRoute = 'dashboard';

    function wrapTables() {
        document.querySelectorAll('.data-table').forEach(function (table) {
            if (table.parentElement && !table.parentElement.classList.contains('table-scroll')) {
                const wrapper = document.createElement('div');
                wrapper.className = 'table-scroll';
                table.parentNode.insertBefore(wrapper, table);
                wrapper.appendChild(table);
            }
        });
    }

    function navigateTo(route) {
        if (!routes[route]) return;

        // Route guard — check permissions
        var Auth = window.Mazelab.Auth;
        if (Auth && !Auth.canAccess(route)) {
            navigateTo('dashboard');
            return;
        }

        currentRoute = route;

        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.route === route);
        });

        const moduleName = routes[route];
        const mod = window.Mazelab.Modules[moduleName];
        if (!mod) {
            document.getElementById('app-content').innerHTML =
                '<div class="empty-state"><p>Module not found: ' + moduleName + '</p></div>';
            return;
        }

        const container = document.getElementById('app-content');
        container.innerHTML = mod.render();

        if (mod.init) {
            setTimeout(() => {
                wrapTables();
                const p = mod.init();
                if (p && p.then) p.then(function () {
                    wrapTables();
                    // Refresh alerts badge after data loads
                    if (window.Mazelab.AlertsService) window.Mazelab.AlertsService.invalidate();
                    if (window.Mazelab.AlertsPanel) window.Mazelab.AlertsPanel.refresh();
                }).catch(function (e) {
                    // mod.init() ya debería manejar sus propios errores de carga y pintar
                    // un mensaje visible en su contenedor — esto es solo la red de seguridad
                    // para que un rechazo no gestionado no quede como unhandled rejection.
                    console.warn('navigateTo: mod.init() rechazó para la ruta "' + route + '":', e);
                });
                setTimeout(wrapTables, 500);
            }, 0);
        }
    }

    window.Mazelab.navigateTo = navigateTo;

    // --- Apply nav permissions based on role ---
    function applyNavPermissions() {
        var Auth = window.Mazelab.Auth;
        if (!Auth || !Auth.getUser()) return; // No auth or no user = show all nav
        document.querySelectorAll('.nav-item[data-route]').forEach(function (item) {
            var route = item.dataset.route;
            item.style.display = Auth.canAccess(route) ? '' : 'none';
        });
    }

    // --- Show user info in sidebar ---
    function showUserInfo() {
        var Auth = window.Mazelab.Auth;
        if (!Auth) return;
        var user = Auth.getUser();
        var footer = document.getElementById('sidebar-user-info');
        if (footer && user) {
            footer.style.display = '';
            var nameEl = document.getElementById('sidebar-user-name');
            var roleEl = document.getElementById('sidebar-user-role');
            if (nameEl) nameEl.textContent = user.name || user.email;
            if (roleEl) {
                var roleLabels = Auth.ROLE_LABELS || { superadmin: 'Super Admin', socio: 'Socio', comercial: 'Comercial', operaciones: 'Operaciones' };
                roleEl.textContent = roleLabels[user.role] || user.role;
            }
        }
    }

    // --- Main app init (called after successful auth) ---
    async function initApp() {
        // Show app container
        var appContainer = document.querySelector('.app-container');
        if (appContainer) appContainer.style.display = '';

        // Apply role-based nav visibility
        applyNavPermissions();
        showUserInfo();

        // Initialize data service
        if (window.Mazelab.DataService && window.Mazelab.DataService.init) {
            try {
                await window.Mazelab.DataService.init();
            } catch (e) {
                // init() está diseñado para NO lanzar nunca (maneja conexión fallida
                // activando readOnly, no hay fallback a localStorage fuera de ?localdev=1).
                // Si de todos modos lanza, es un bug real — no lo disfracemos de fallback.
                console.error('DataService.init() lanzó inesperadamente:', e);
            }
        }

        // Precargar company_info (tabla config) en cache sincrónica — settings.js,
        // finance.js y cotizador.js lo leen dentro de renders sincrónicos y no
        // pueden esperar una promesa a mitad de un render(). Best-effort: si falla,
        // getCompanyInfoSync() cae a localStorage directo (ver company-info.js).
        if (window.Mazelab.CompanyInfo && window.Mazelab.CompanyInfo.preload) {
            try {
                await window.Mazelab.CompanyInfo.preload();
            } catch (e) {
                console.warn('CompanyInfo.preload() rechazó:', e);
            }
        }

        // Initialize alerts panel (bell + badge)
        if (window.Mazelab.AlertsPanel) {
            var alertsInit = window.Mazelab.AlertsPanel.init();
            if (alertsInit && alertsInit.catch) {
                alertsInit.catch(function (e) { console.warn('AlertsPanel.init() rechazó:', e); });
            }
        }

        // Initialize chatbot (only if AI service has API key)
        if (window.Mazelab.Chatbot) {
            window.Mazelab.Chatbot.init();
        }

        // Set up nav clicks + mobile sidebar close
        var sidebar = document.querySelector('.sidebar');
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                navigateTo(item.dataset.route);
                // Close mobile sidebar on nav
                if (sidebar) sidebar.classList.remove('open');
                var overlay = document.querySelector('.mobile-overlay');
                if (overlay) overlay.remove();
            });
        });

        // Mobile hamburger menu
        var mobileBtn = document.getElementById('mobile-menu-btn');
        if (mobileBtn && sidebar) {
            mobileBtn.addEventListener('click', function () {
                var isOpen = sidebar.classList.toggle('open');
                if (isOpen) {
                    var ov = document.createElement('div');
                    ov.className = 'mobile-overlay';
                    ov.addEventListener('click', function () {
                        sidebar.classList.remove('open');
                        ov.remove();
                    });
                    document.body.appendChild(ov);
                } else {
                    var ov2 = document.querySelector('.mobile-overlay');
                    if (ov2) ov2.remove();
                }
            });
        }

        // Logout button
        var logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', function () {
                window.Mazelab.Auth.logout();
                location.reload();
            });
        }

        // Navigate to initial route
        navigateTo('dashboard');
    }

    // Expose for AuthUI callback
    window.Mazelab.initApp = initApp;

    // --- Entry point ---
    // Protect modals: prevent close when mousedown starts inside .modal
    // (user drags/selects text and releases outside the modal box)
    var _modalMouseDownInside = false;
    document.addEventListener('mousedown', function (e) {
        _modalMouseDownInside = !!e.target.closest('.modal');
    }, true);
    document.addEventListener('click', function (e) {
        if (_modalMouseDownInside && e.target.classList &&
            (e.target.classList.contains('modal-overlay') || e.target.id && e.target.id.indexOf('overlay') !== -1)) {
            e.stopImmediatePropagation();
        }
        _modalMouseDownInside = false;
    }, true);

    // Bloquea el acceso con un mensaje visible — usado cuando Auth/AuthUI no
    // cargaron. Nunca se debe entrar a la app sin poder verificar login/rol
    // (Sprint M1, Lote M1-B: antes esto entraba sin login si AuthUI fallaba).
    function showFatalAuthError(message) {
        var appContainer = document.querySelector('.app-container');
        if (appContainer) appContainer.style.display = 'none';
        var el = document.createElement('div');
        el.id = 'fatal-auth-error';
        el.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;' +
            'background:var(--bg-primary,#0b0b12);color:var(--text-primary,#fff);font-family:Inter,system-ui,sans-serif;padding:2rem;';
        el.innerHTML = '<div style="max-width:420px;text-align:center;">' +
            '<h2 style="margin:0 0 8px;font-size:1.3rem;">Error critico</h2>' +
            '<p style="margin:0;color:var(--text-secondary,#9a9aa8);font-size:0.9rem;">' + message + '</p>' +
        '</div>';
        document.body.appendChild(el);
    }

    document.addEventListener('DOMContentLoaded', async () => {
        var Auth = window.Mazelab.Auth;

        if (!Auth) {
            // Sin el módulo de Auth no hay forma segura de verificar sesión/rol —
            // bloquear siempre, nunca entrar a la app directamente.
            console.error('Auth module not available — bloqueando el acceso.');
            showFatalAuthError('No se pudo cargar el modulo de autenticacion. Recarga la pagina o contacta al administrador.');
            return;
        }

        // I2: ?localdev=1 es una vía de escape EXPLÍCITA para desarrollo local —
        // nunca implícita, nunca un fallback de error. Antes el gate exigía una
        // sesión real de Supabase incluso en este modo (roto si no había red o
        // proyecto configurado); ahora salta la autenticación por completo e
        // inyecta un usuario local superadmin en el cache síncrono de Auth.
        // data-service.js ya maneja el modo local de forma independiente (su
        // propio init() detecta el mismo parámetro y usa localStorage).
        var urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('localdev') === '1') {
            if (typeof Auth._setLocalDevUser === 'function') {
                Auth._setLocalDevUser({ id: 'localdev', email: 'localdev@local', name: 'Modo Prueba', role: 'superadmin' });
            } else {
                console.warn('Auth._setLocalDevUser no está disponible — ?localdev=1 no pudo inyectar un usuario local.');
            }
            await initApp();
            return;
        }

        // Restaura la sesión (si existe) y puebla el cache síncrono de Auth
        // (getUser/isLoggedIn/canAccess) ANTES de decidir login vs app — de lo
        // contrario isLoggedIn() vería el cache todavía vacío aunque exista una
        // sesión válida en Supabase.
        //
        // I1: si Auth.init() lanza (ej. el CDN de supabase-js no cargó, o la
        // red falla de una forma que el propio init() no atrapó), antes esto
        // dejaba una excepción sin manejar en el listener de DOMContentLoaded
        // y la app quedaba en blanco sin ningún mensaje — ahora se bloquea con
        // un error visible, igual que las otras ramas de este gate.
        try {
            await Auth.init();
        } catch (e) {
            console.error('Auth.init() lanzó inesperadamente:', e);
            showFatalAuthError('No se pudo cargar el sistema de autenticacion' + (e && e.message ? ': ' + e.message : '.') + ' Recarga la pagina o contacta al administrador.');
            return;
        }

        // If not logged in, show login screen
        if (!Auth.isLoggedIn()) {
            if (window.Mazelab.AuthUI) {
                var appContainer = document.querySelector('.app-container');
                if (appContainer) appContainer.style.display = 'none';
                window.Mazelab.AuthUI.show();
            } else {
                // AuthUI no disponible — bloquear con error visible. Antes esto
                // entraba a la app sin login; con Supabase Auth + RLS reales, un
                // ingreso sin sesión no vería datos igual (o vería datos anónimos
                // que RLS no debería exponer), así que el bypass silencioso ya no
                // es una degradación aceptable — debe fallar de forma visible.
                console.error('AuthUI not available — bloqueando el acceso (no se puede mostrar el login).');
                showFatalAuthError('No se pudo cargar la pantalla de inicio de sesion. Recarga la pagina o contacta al administrador.');
            }
            return;
        }

        // Ya había sesión activa (restaurada por Auth.init()) — init app directo.
        // DataService.init() (y su testConnection) solo se llama DENTRO de
        // initApp(), que solo se alcanza tras pasar este gate — nunca corre
        // antes de tener una sesión autenticada.
        await initApp();
    });
})();
