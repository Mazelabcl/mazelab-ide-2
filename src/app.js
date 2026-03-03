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
        cashflow: 'CashflowModule',
        analytics: 'AnalyticsModule',
        settings: 'SettingsModule',
        import: 'ImportModule'
    };

    let currentRoute = 'dashboard';

    // Auto-wrap data-tables in a scrollable div if not already wrapped.
    // Called after each module init so wide tables scroll horizontally.
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
            // Wrap tables immediately (for tables in initial render)
            setTimeout(() => {
                wrapTables();
                const p = mod.init();
                if (p && p.then) p.then(wrapTables);
                // Second wrap after async init populates dynamic content
                setTimeout(wrapTables, 500);
            }, 0);
        }
    }

    window.Mazelab.navigateTo = navigateTo;

    document.addEventListener('DOMContentLoaded', async () => {
        // Initialize data service
        if (window.Mazelab.DataService && window.Mazelab.DataService.init) {
            try {
                await window.Mazelab.DataService.init();
            } catch (e) {
                console.warn('DataService init failed, using localStorage fallback:', e);
            }
        }

        // Set up nav clicks
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                navigateTo(item.dataset.route);
            });
        });

        // Navigate to initial route
        navigateTo('dashboard');
    });
})();
