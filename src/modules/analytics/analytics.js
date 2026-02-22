window.Mazelab = window.Mazelab || {};
window.Mazelab.Modules = window.Mazelab.Modules || {};

window.Mazelab.Modules.AnalyticsModule = (function () {

    var sales = [], payables = [];
    var periodFilter = 'year';
    var groupBy = 'tipo';

    // ---- helpers ----

    function formatCLP(n) {
        if (n == null || isNaN(n)) return '$0';
        var abs = Math.abs(Math.round(n));
        var s = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return (n < 0 ? '-$' : '$') + s;
    }

    // Mapa de costos por eventId — autónomo, no depende del módulo de ventas
    function buildCostMap() {
        var map = {};
        payables.forEach(function (p) {
            var eid = String(p.eventId || '').trim();
            if (!eid) return;
            map[eid] = (map[eid] || 0) + (Number(p.amount) || 0);
        });
        return map;
    }

    function getFilteredSales() {
        if (periodFilter !== 'year') return sales;
        var cutoff = new Date();
        cutoff.setFullYear(cutoff.getFullYear() - 1);
        return sales.filter(function (s) {
            return s.eventDate && new Date(s.eventDate) >= cutoff;
        });
    }

    function buildGroups(filteredSales, costMap) {
        var groups = {};
        filteredSales.forEach(function (s) {
            var key = groupBy === 'tipo'
                ? ((s.serviceNames || '').trim() || 'Sin tipo')
                : ((s.staffName || '').trim() || 'Sin vendedor');
            var eid = String(s.sourceId || s.id || '');
            var cost = costMap[eid] !== undefined ? costMap[eid] : Number(s.costAmount || 0);
            if (!groups[key]) groups[key] = { count: 0, revenue: 0, cost: 0 };
            groups[key].count++;
            groups[key].revenue += Number(s.amount || 0);
            groups[key].cost += cost;
        });
        return Object.keys(groups).map(function (k) {
            var g = groups[k];
            var margin = g.revenue - g.cost;
            var marginPct = g.revenue > 0 ? (margin / g.revenue) * 100 : 0;
            return { key: k, count: g.count, revenue: g.revenue, cost: g.cost, margin: margin, marginPct: marginPct };
        }).sort(function (a, b) { return b.revenue - a.revenue; });
    }

    // ---- render ----

    function render() {
        return '<div class="content-header">' +
            '<h2>Rentabilidad</h2>' +
            '<p style="font-size:13px;color:var(--text-secondary);margin:0">Costos basados en CXP registrados por evento</p>' +
            '</div>' +
            '<div class="content-body" id="analytics-content">' +
            '<div class="empty-state"><p>Cargando an&aacute;lisis...</p></div>' +
            '</div>';
    }

    function renderAnalytics() {
        var costMap = buildCostMap();
        var filtered = getFilteredSales();
        var groups = buildGroups(filtered, costMap);

        // toggles
        var togglePeriod = '<div class="toggle-group">' +
            '<button class="toggle-option analytics-period' + (periodFilter === 'year' ? ' active' : '') + '" data-period="year">&Uacute;ltimo a&ntilde;o</button>' +
            '<button class="toggle-option analytics-period' + (periodFilter === 'all' ? ' active' : '') + '" data-period="all">Hist&oacute;rico</button>' +
            '</div>';

        var toggleGroup = '<div class="toggle-group">' +
            '<button class="toggle-option analytics-group' + (groupBy === 'tipo' ? ' active' : '') + '" data-group="tipo">Por tipo</button>' +
            '<button class="toggle-option analytics-group' + (groupBy === 'staff' ? ' active' : '') + '" data-group="staff">Por vendedor</button>' +
            '</div>';

        var controls = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-md);flex-wrap:wrap;gap:var(--space-sm)">' +
            '<span style="font-size:13px;color:var(--text-secondary)">' +
            (periodFilter === 'year' ? '&Uacute;ltimo a&ntilde;o' : 'Hist&oacute;rico') +
            ' &mdash; <strong>' + filtered.length + '</strong> eventos' +
            '</span>' +
            '<div style="display:flex;gap:var(--space-sm)">' + togglePeriod + toggleGroup + '</div>' +
            '</div>';

        // KPIs resumen
        var totalRevenue = 0, totalCost = 0;
        filtered.forEach(function (s) {
            var eid = String(s.sourceId || s.id || '');
            totalRevenue += Number(s.amount || 0);
            totalCost += costMap[eid] !== undefined ? costMap[eid] : Number(s.costAmount || 0);
        });
        var totalMargin = totalRevenue - totalCost;
        var totalMarginPct = totalRevenue > 0 ? (totalMargin / totalRevenue) * 100 : 0;

        var kpis = '<div class="kpi-grid" style="margin-bottom:var(--space-md)">' +
            '<div class="kpi-card accent">' +
            '<div class="kpi-label">Ventas totales</div>' +
            '<div class="kpi-value">' + formatCLP(totalRevenue) + '</div>' +
            '<div class="kpi-sub">' + filtered.length + ' eventos</div>' +
            '</div>' +
            '<div class="kpi-card danger">' +
            '<div class="kpi-label">Costos reales (CXP)</div>' +
            '<div class="kpi-value">' + formatCLP(totalCost) + '</div>' +
            '</div>' +
            '<div class="kpi-card ' + (totalMargin >= 0 ? 'success' : 'danger') + '">' +
            '<div class="kpi-label">Margen total</div>' +
            '<div class="kpi-value ' + (totalMargin >= 0 ? 'text-success' : 'text-danger') + '">' + formatCLP(totalMargin) + '</div>' +
            '<div class="kpi-sub">' + Math.round(totalMarginPct) + '% sobre ventas</div>' +
            '</div>' +
            '</div>';

        // Tabla por grupo
        var maxRevenue = groups.length > 0 ? groups[0].revenue : 1;
        var tableRows = '';

        if (groups.length === 0) {
            tableRows = '<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--text-muted)">Sin datos para el per&iacute;odo seleccionado</td></tr>';
        } else {
            groups.forEach(function (g, idx) {
                var barPct = maxRevenue > 0 ? Math.round((g.revenue / maxRevenue) * 100) : 0;
                var marginClass = g.marginPct >= 40 ? 'text-success' : g.marginPct >= 15 ? '' : 'text-danger';
                var rankBadge = idx < 3
                    ? '<span style="font-size:10px;font-weight:700;color:var(--accent);margin-right:4px">#' + (idx + 1) + '</span>'
                    : '';
                tableRows += '<tr>' +
                    '<td>' + rankBadge + '<strong>' + g.key + '</strong></td>' +
                    '<td class="text-right" style="color:var(--text-secondary);white-space:nowrap">' + g.count + ' ev.</td>' +
                    '<td style="min-width:160px;padding:8px 8px">' +
                    '<div style="display:flex;align-items:center;gap:8px">' +
                    '<div style="flex:1;background:var(--bg-tertiary);border-radius:3px;height:8px;min-width:60px">' +
                    '<div style="width:' + barPct + '%;height:100%;background:var(--accent-gradient);border-radius:3px"></div>' +
                    '</div>' +
                    '<span style="font-size:12px;white-space:nowrap;font-weight:500;min-width:90px;text-align:right">' + formatCLP(g.revenue) + '</span>' +
                    '</div>' +
                    '</td>' +
                    '<td class="text-right" style="white-space:nowrap;color:var(--text-secondary)">' + formatCLP(g.cost) + '</td>' +
                    '<td class="text-right ' + marginClass + '" style="white-space:nowrap">' +
                    '<strong>' + Math.round(g.marginPct) + '%</strong>' +
                    '<div style="font-size:11px;font-weight:400">' + formatCLP(g.margin) + '</div>' +
                    '</td>' +
                    '</tr>';
            });
        }

        var table = '<div class="card">' +
            '<div class="card-header">' +
            '<span class="card-title">' + (groupBy === 'tipo' ? 'Por tipo de evento' : 'Por vendedor') + '</span>' +
            '<span style="font-size:11px;color:var(--text-muted)">Ordenado por volumen de ventas</span>' +
            '</div>' +
            '<table class="data-table">' +
            '<thead><tr>' +
            '<th>' + (groupBy === 'tipo' ? 'Tipo de evento' : 'Vendedor') + '</th>' +
            '<th class="text-right">Eventos</th>' +
            '<th>Revenue</th>' +
            '<th class="text-right">Costo real</th>' +
            '<th class="text-right">Margen</th>' +
            '</tr></thead>' +
            '<tbody>' + tableRows + '</tbody>' +
            '</table></div>';

        return controls + kpis + table;
    }

    function refreshAnalytics() {
        var container = document.getElementById('analytics-content');
        if (!container) return;
        container.innerHTML = renderAnalytics();
        attachListeners();
    }

    function attachListeners() {
        document.querySelectorAll('.analytics-period').forEach(function (btn) {
            btn.addEventListener('click', function () {
                periodFilter = this.dataset.period;
                refreshAnalytics();
            });
        });
        document.querySelectorAll('.analytics-group').forEach(function (btn) {
            btn.addEventListener('click', function () {
                groupBy = this.dataset.group;
                refreshAnalytics();
            });
        });
    }

    async function init() {
        periodFilter = 'year';
        groupBy = 'tipo';
        try {
            var DS = window.Mazelab.DataService;
            var results = await Promise.all([DS.getAll('sales'), DS.getAll('payables')]);
            sales = results[0] || [];
            payables = results[1] || [];
            refreshAnalytics();
        } catch (err) {
            console.error('AnalyticsModule error:', err);
            var c = document.getElementById('analytics-content');
            if (c) c.innerHTML = '<div class="empty-state"><p class="text-danger">Error al cargar an&aacute;lisis.</p></div>';
        }
    }

    return { render: render, init: init };

})();
