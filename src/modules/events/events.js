window.Mazelab = window.Mazelab || {};
window.Mazelab.Modules = window.Mazelab.Modules || {};

window.Mazelab.Modules.EventsModule = (function () {

    var sales = [], receivables = [], payables = [];
    var currentSaleId = null;
    var searchQuery = '';
    var statusFilter = 'all';

    // ---- helpers ----

    function formatCLP(n) {
        if (n == null || isNaN(n)) return '$0';
        var abs = Math.abs(Math.round(n));
        var s = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return (n < 0 ? '-$' : '$') + s;
    }

    function formatDate(d) {
        if (!d) return '-';
        var dt = new Date(d);
        if (isNaN(dt)) return String(d);
        return dt.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    // ---- linking ----

    function getEventCXC(sale) {
        var sid = String(sale.id || '');
        var name = (sale.eventName || '').trim().toLowerCase();
        return receivables.filter(function (r) {
            if (r.saleId && String(r.saleId) === sid) return true;
            if (name && (r.eventName || '').trim().toLowerCase() === name) return true;
            return false;
        });
    }

    function getEventCXP(sale) {
        var eid = String(sale.sourceId || sale.id || '');
        if (!eid) return [];
        return payables.filter(function (p) {
            return String(p.eventId || '') === eid;
        });
    }

    // ---- financial summaries ----

    function getCXCSummary(cxcList) {
        var totalOwed = 0, totalPaid = 0;
        cxcList.forEach(function (r) {
            var tipo = (r.tipoDoc || '').toUpperCase();
            var st = (r.status || '').toLowerCase();
            if (tipo === 'NC' || st === 'anulada') return;
            var neto = Number(r.montoNeto || r.invoicedAmount || 0);
            var total = (tipo === 'E') ? neto : neto * 1.19;
            totalOwed += total;
            if (r.payments && r.payments.length) {
                r.payments.forEach(function (p) { totalPaid += Number(p.amount || 0); });
            } else {
                totalPaid += Number(r.amountPaid || 0);
            }
        });
        var pct = totalOwed > 0 ? totalPaid / totalOwed : null;
        return { totalOwed: totalOwed, totalPaid: totalPaid, pct: pct };
    }

    function getCXPSummary(cxpList) {
        var totalAmount = 0, totalPaid = 0;
        cxpList.forEach(function (p) {
            totalAmount += Number(p.amount || 0);
            if (p.payments && p.payments.length) {
                p.payments.forEach(function (pay) { totalPaid += Number(pay.amount || 0); });
            } else if ((p.status || '') === 'pagada') {
                totalPaid += Number(p.amount || 0);
            }
        });
        var pct = totalAmount > 0 ? totalPaid / totalAmount : null;
        return { totalAmount: totalAmount, totalPaid: totalPaid, pct: pct };
    }

    // ---- estado financiero derivado ----

    function getFinancialStatus(sale) {
        var cxcList = getEventCXC(sale);
        var cxpList = getEventCXP(sale);
        var cxc = getCXCSummary(cxcList);
        var cxp = getCXPSummary(cxpList);
        var cxcOk = cxc.pct === null || cxc.pct >= 0.9999;
        var cxpOk = cxp.pct === null || cxp.pct >= 0.9999;
        if (cxcOk && cxpOk) return 'liquidado';
        if (cxpOk && !cxcOk) return 'cobros';
        if (cxcOk && !cxpOk) return 'pagos';
        return 'abierto';
    }

    var STATUS_META = {
        liquidado: { label: 'Liquidado',       cls: 'badge-success' },
        cobros:    { label: 'Cobro pendiente', cls: 'badge-warning' },
        pagos:     { label: 'Pago pendiente',  cls: 'badge-warning' },
        abierto:   { label: 'Abierto',         cls: 'badge-danger'  }
    };

    // ---- list view ----

    function getFilteredSales() {
        return sales.filter(function (s) {
            if (statusFilter !== 'all' && getFinancialStatus(s) !== statusFilter) return false;
            if (searchQuery) {
                var q = searchQuery.toLowerCase();
                var name = (s.eventName || '').toLowerCase();
                var client = (s.clientName || '').toLowerCase();
                if (!name.includes(q) && !client.includes(q)) return false;
            }
            return true;
        }).sort(function (a, b) {
            var da = a.eventDate || '', db = b.eventDate || '';
            return da < db ? 1 : da > db ? -1 : 0;
        });
    }

    function renderList() {
        var list = getFilteredSales();

        var filterBtns = ['all', 'liquidado', 'cobros', 'pagos', 'abierto'].map(function (f) {
            var label = f === 'all' ? 'Todos' : STATUS_META[f].label;
            var active = statusFilter === f;
            return '<button class="toggle-option events-filter-btn' + (active ? ' active' : '') + '" data-status="' + f + '">' + label + '</button>';
        }).join('');

        var rows = '';
        if (list.length === 0) {
            rows = '<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--text-secondary)">No se encontraron eventos</td></tr>';
        } else {
            list.forEach(function (s) {
                var st = getFinancialStatus(s);
                var meta = STATUS_META[st];
                var cxpList = getEventCXP(s);
                var cost = cxpList.reduce(function (acc, p) { return acc + Number(p.amount || 0); }, 0);
                var amount = Number(s.amount || 0);
                var margin = cost > 0 ? amount - cost : null;
                var marginPct = (margin !== null && amount > 0) ? (margin / amount) * 100 : null;
                var displayId = s.sourceId || String(s.id || '').slice(-6);
                var marginHTML = marginPct !== null
                    ? '<span class="' + (marginPct >= 0 ? 'text-success' : 'text-danger') + '">' + Math.round(marginPct) + '%</span>'
                    : '<span style="color:var(--text-muted)">-</span>';
                rows += '<tr class="events-list-row" data-id="' + s.id + '" style="cursor:pointer">' +
                    '<td style="font-size:11px;color:var(--text-muted);white-space:nowrap">' + displayId + '</td>' +
                    '<td><strong>' + (s.eventName || '-') + '</strong></td>' +
                    '<td>' + (s.clientName || '-') + '</td>' +
                    '<td>' + (s.staffName || '-') + '</td>' +
                    '<td class="text-right">' + formatCLP(amount) + '</td>' +
                    '<td class="text-right">' + (cost > 0 ? formatCLP(cost) : '<span style="color:var(--text-muted)">-</span>') + '</td>' +
                    '<td class="text-right">' + marginHTML + '</td>' +
                    '<td>' + formatDate(s.eventDate) + '</td>' +
                    '<td><span class="badge ' + meta.cls + '">' + meta.label + '</span></td>' +
                    '</tr>';
            });
        }

        return '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-md);flex-wrap:wrap;gap:var(--space-sm)">' +
            '<div class="search-bar" style="flex:1;min-width:200px"><input type="text" id="events-search" class="form-control" placeholder="Buscar por evento o cliente..." value="' + searchQuery + '" /></div>' +
            '<div class="toggle-group">' + filterBtns + '</div>' +
            '</div>' +
            '<table class="data-table">' +
            '<thead><tr>' +
            '<th style="font-size:11px;color:var(--text-muted)">ID</th>' +
            '<th>Evento</th><th>Cliente</th><th>Vendedor</th>' +
            '<th class="text-right">Monto</th><th class="text-right">Costo Real</th><th class="text-right">Margen</th>' +
            '<th>Fecha</th><th>Estado Financiero</th>' +
            '</tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
            '</table>' +
            '<div style="font-size:11px;color:var(--text-muted);margin-top:var(--space-sm)">Haz clic en un evento para ver su ficha completa.</div>';
    }

    // ---- detail view ----

    function renderDetail(sale) {
        var cxcList = getEventCXC(sale);
        var cxpList = getEventCXP(sale);
        var cxc = getCXCSummary(cxcList);
        var cxp = getCXPSummary(cxpList);
        var st = getFinancialStatus(sale);
        var meta = STATUS_META[st];
        var amount = Number(sale.amount || 0);
        var totalCost = cxp.totalAmount;
        var margin = amount - totalCost;
        var marginPct = amount > 0 ? (margin / amount) * 100 : null;

        var header = '<div style="display:flex;align-items:flex-start;gap:var(--space-md);margin-bottom:var(--space-xl);flex-wrap:wrap">' +
            '<button class="btn-secondary" id="events-back-btn">&#8592; Volver</button>' +
            '<div style="flex:1">' +
            '<h2 style="margin:0;font-size:20px">' + (sale.eventName || '-') + '</h2>' +
            '<div style="color:var(--text-secondary);font-size:13px;margin-top:4px">' +
            (sale.clientName || '') +
            (sale.staffName ? ' &nbsp;&middot;&nbsp; Vendedor: <strong>' + sale.staffName + '</strong>' : '') +
            (sale.eventDate ? ' &nbsp;&middot;&nbsp; ' + formatDate(sale.eventDate) : '') +
            (sale.serviceNames ? ' &nbsp;&middot;&nbsp; ' + sale.serviceNames : '') +
            '</div></div>' +
            '<span class="badge ' + meta.cls + '" style="font-size:13px;padding:6px 14px;align-self:flex-start">' + meta.label + '</span>' +
            '</div>';

        var kpis = '<div class="kpi-grid" style="margin-bottom:var(--space-xl)">' +
            '<div class="kpi-card accent">' +
            '<div class="kpi-label">Venta</div>' +
            '<div class="kpi-value">' + formatCLP(amount) + '</div>' +
            '</div>' +
            '<div class="kpi-card danger">' +
            '<div class="kpi-label">Costo Real (CXP)</div>' +
            '<div class="kpi-value">' + formatCLP(totalCost) + '</div>' +
            '<div class="kpi-sub">' + cxpList.length + ' registro' + (cxpList.length !== 1 ? 's' : '') + '</div>' +
            '</div>' +
            '<div class="kpi-card ' + (margin >= 0 ? 'success' : 'danger') + '">' +
            '<div class="kpi-label">Margen</div>' +
            '<div class="kpi-value ' + (margin >= 0 ? 'text-success' : 'text-danger') + '">' + formatCLP(margin) + '</div>' +
            '<div class="kpi-sub">' + (marginPct !== null ? Math.round(marginPct) + '%' : '-') + '</div>' +
            '</div>' +
            '<div class="kpi-card ' + (cxc.pct === null || cxc.pct >= 0.9999 ? 'success' : 'warning') + '">' +
            '<div class="kpi-label">CXC Cobrado</div>' +
            '<div class="kpi-value">' + formatCLP(cxc.totalPaid) + '</div>' +
            '<div class="kpi-sub">de ' + formatCLP(cxc.totalOwed) + (cxc.pct !== null ? ' (' + Math.round(cxc.pct * 100) + '%)' : '') + '</div>' +
            '</div>' +
            '</div>';

        // CXC block
        var cxcActive = cxcList.filter(function (r) {
            return (r.tipoDoc || '').toUpperCase() !== 'NC' && (r.status || '').toLowerCase() !== 'anulada';
        });
        var cxcRows = '';
        if (cxcActive.length === 0) {
            cxcRows = '<tr><td colspan="6" style="text-align:center;padding:12px;color:var(--text-muted)">Sin documentos CXC asociados</td></tr>';
        } else {
            cxcActive.forEach(function (r) {
                var tipo = (r.tipoDoc || '').toUpperCase();
                var neto = Number(r.montoNeto || r.invoicedAmount || 0);
                var total = tipo === 'E' ? neto : neto * 1.19;
                var paid = 0;
                if (r.payments && r.payments.length) {
                    r.payments.forEach(function (p) { paid += Number(p.amount || 0); });
                } else { paid = Number(r.amountPaid || 0); }
                var pending = Math.max(0, total - paid);
                var stCls = paid >= total * 0.9999 ? 'badge-success' : (paid > 0 ? 'badge-warning' : 'badge-danger');
                var stLabel = paid >= total * 0.9999 ? 'Cobrado' : (paid > 0 ? 'Parcial' : 'Pendiente');
                cxcRows += '<tr>' +
                    '<td>' + (r.invoiceNumber || r.tipoDoc || '-') + '</td>' +
                    '<td>' + (r.billingMonth || '-') + '</td>' +
                    '<td class="text-right">' + formatCLP(total) + '</td>' +
                    '<td class="text-right">' + formatCLP(paid) + '</td>' +
                    '<td class="text-right" style="color:var(--danger)">' + (pending > 0 ? formatCLP(pending) : '-') + '</td>' +
                    '<td><span class="badge ' + stCls + '">' + stLabel + '</span></td>' +
                    '</tr>';
            });
        }

        var cxcBlock = '<div class="card" style="margin-bottom:var(--space-md)">' +
            '<div class="card-header">' +
            '<span class="card-title">CXC &mdash; Cuentas por Cobrar</span>' +
            '<span class="badge badge-info">' + formatCLP(cxc.totalPaid) + ' cobrado de ' + formatCLP(cxc.totalOwed) + '</span>' +
            '</div>' +
            '<table class="data-table"><thead><tr>' +
            '<th>Documento</th><th>Mes emisi&oacute;n</th><th class="text-right">Total</th>' +
            '<th class="text-right">Cobrado</th><th class="text-right">Pendiente</th><th>Estado</th>' +
            '</tr></thead><tbody>' + cxcRows + '</tbody></table></div>';

        // CXP block
        var cxpRows = '';
        if (cxpList.length === 0) {
            cxpRows = '<tr><td colspan="6" style="text-align:center;padding:12px;color:var(--text-muted)">Sin costos CXP registrados para este evento</td></tr>';
        } else {
            cxpList.forEach(function (p) {
                var amt = Number(p.amount || 0);
                var paid = 0;
                if (p.payments && p.payments.length) {
                    p.payments.forEach(function (pay) { paid += Number(pay.amount || 0); });
                } else if ((p.status || '') === 'pagada') { paid = amt; }
                var stCls = paid >= amt * 0.9999 ? 'badge-success' : 'badge-warning';
                var stLabel = paid >= amt * 0.9999 ? 'Pagado' : 'Pendiente';
                cxpRows += '<tr>' +
                    '<td>' + (p.vendorName || '-') + '</td>' +
                    '<td style="color:var(--text-muted);font-size:12px">' + (p.concept || '-') + '</td>' +
                    '<td>' + (p.docType || '-').toUpperCase() + '</td>' +
                    '<td class="text-right">' + formatCLP(amt) + '</td>' +
                    '<td class="text-right">' + formatCLP(paid) + '</td>' +
                    '<td><span class="badge ' + stCls + '">' + stLabel + '</span></td>' +
                    '</tr>';
            });
        }

        var cxpBlock = '<div class="card">' +
            '<div class="card-header">' +
            '<span class="card-title">CXP &mdash; Costos del Evento</span>' +
            '<span class="badge badge-danger">' + formatCLP(cxp.totalPaid) + ' pagado de ' + formatCLP(cxp.totalAmount) + '</span>' +
            '</div>' +
            '<table class="data-table"><thead><tr>' +
            '<th>Proveedor</th><th>Concepto</th><th>Tipo Doc</th>' +
            '<th class="text-right">Monto</th><th class="text-right">Pagado</th><th>Estado</th>' +
            '</tr></thead><tbody>' + cxpRows + '</tbody></table></div>';

        return header + kpis + cxcBlock + cxpBlock;
    }

    // ---- shell ----

    function render() {
        return '<div class="content-header"><h2>Ficha de Eventos</h2></div>' +
            '<div class="content-body" id="events-content">' +
            '<div class="empty-state"><p>Cargando eventos...</p></div>' +
            '</div>';
    }

    function refreshContent() {
        var container = document.getElementById('events-content');
        if (!container) return;
        if (currentSaleId) {
            var sale = sales.find(function (s) { return String(s.id) === String(currentSaleId); });
            if (!sale) { currentSaleId = null; refreshContent(); return; }
            container.innerHTML = renderDetail(sale);
            var backBtn = document.getElementById('events-back-btn');
            if (backBtn) {
                backBtn.addEventListener('click', function () {
                    currentSaleId = null;
                    refreshContent();
                });
            }
        } else {
            container.innerHTML = renderList();
            attachListListeners();
        }
    }

    function attachListListeners() {
        var search = document.getElementById('events-search');
        if (search) {
            search.addEventListener('input', function () {
                searchQuery = this.value.trim();
                refreshContent();
            });
        }
        document.querySelectorAll('.events-filter-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                statusFilter = this.dataset.status;
                refreshContent();
            });
        });
        document.querySelectorAll('.events-list-row').forEach(function (row) {
            row.addEventListener('click', function () {
                currentSaleId = this.dataset.id;
                refreshContent();
            });
        });
    }

    async function init() {
        currentSaleId = null;
        searchQuery = '';
        statusFilter = 'all';
        try {
            var DS = window.Mazelab.DataService;
            var results = await Promise.all([
                DS.getAll('sales'),
                DS.getAll('receivables'),
                DS.getAll('payables')
            ]);
            sales = results[0] || [];
            receivables = results[1] || [];
            payables = results[2] || [];
            refreshContent();
        } catch (err) {
            console.error('EventsModule error:', err);
            var c = document.getElementById('events-content');
            if (c) c.innerHTML = '<div class="empty-state"><p class="text-danger">Error al cargar eventos.</p></div>';
        }
    }

    return { render: render, init: init };

})();
