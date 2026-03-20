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
                if (p && p.then) p.then(wrapTables);
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
                console.warn('DataService init failed, using localStorage fallback:', e);
            }
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
    document.addEventListener('DOMContentLoaded', async () => {
        var Auth = window.Mazelab.Auth;

        // If not logged in, show login screen
        if (!Auth || !Auth.isLoggedIn()) {
            if (window.Mazelab.AuthUI) {
                var appContainer = document.querySelector('.app-container');
                if (appContainer) appContainer.style.display = 'none';
                window.Mazelab.AuthUI.show();
            } else {
                // AuthUI not loaded — skip auth and show app directly
                console.warn('AuthUI not available, skipping login screen.');
                await initApp();
            }
            return;
        }

        // Already logged in — init app directly
        await initApp();
    });
})();
