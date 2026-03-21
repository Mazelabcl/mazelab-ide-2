window.Mazelab.Modules.PayablesModule = (function () {

    // ── State ──────────────────────────────────────────────────────────
    let payables = [];
    let currentView = 'lista';        // 'lista' | 'agrupada'
    let currentCategory = 'todos';    // 'todos' | 'evento' | 'general'
    let showOnlyPending = true;
    let cachedSales = [];
    let cachedClients = [];
    let searchQuery = '';
    let sortCol = null;
    let sortDir = 'asc';
    let columnFilters = {}; // { colKey: 'filterText' }
    let editingId = null;
    let abonoTargetId = null;

    // ── Helpers ────────────────────────────────────────────────────────

    function formatCLP(n) {
        if (n == null || isNaN(n)) return '$0';
        var num = Math.round(Number(n));
        var str = Math.abs(num).toString();
        var parts = [];
        for (var i = str.length; i > 0; i -= 3) {
            parts.unshift(str.substring(Math.max(0, i - 3), i));
        }
        return (num < 0 ? '-' : '') + '$' + parts.join('.');
    }

    function escapeHtml(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // Retención BH configurable por año (SII Chile)
    function getBHRetentionRate(dateStr) {
        if (!dateStr) return 0.1525;
        var year = new Date(dateStr).getFullYear();
        return year <= 2024 ? 0.145 : 0.1525; // 14.5% ≤2024, 15.25% 2025+
    }

    function docTypeLabel(t) {
        var s = (t || '').toLowerCase().trim();
        return ({ bh: 'BH', factura: 'Factura', exenta: 'F. Exenta', invoice: 'Invoice', ninguno: '-' }[s]) || t || '-';
    }

    function isBH(p)      { return (p.docType || '').toLowerCase() === 'bh'; }
    function isFactura(p) { return (p.docType || '').toLowerCase() === 'factura'; }

    // Parse as LOCAL date to avoid UTC timezone shift
    function parseLocalDate(str) {
        if (!str) return null;
        var parts = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (parts) return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
        return new Date(str);
    }

    // Primer viernes >= eventDate + 30 días
    function calcDueDate(dateStr) {
        if (!dateStr) return null;
        var d = parseLocalDate(dateStr);
        if (!d || isNaN(d.getTime())) return null;
        d.setDate(d.getDate() + 30);
        var dow = d.getDay();
        if (dow !== 5) d.setDate(d.getDate() + ((5 - dow + 7) % 7));
        return d;
    }

    function formatDateShort(d) {
        if (!d) return '-';
        return d.getDate().toString().padStart(2, '0') + '/' +
               (d.getMonth() + 1).toString().padStart(2, '0') + '/' +
               d.getFullYear();
    }

    function todayStr() { return new Date().toISOString().substring(0, 10); }

    function generateId() { return Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 9); }

    // ── Payment array helpers ──────────────────────────────────────────

    function getTotalPagado(p) {
        if (p.payments && Array.isArray(p.payments) && p.payments.length > 0) {
            return p.payments.reduce(function (s, pay) { return s + (Number(pay.amount) || 0); }, 0);
        }
        return Number(p.amountPaid) || 0;
    }

    function getPendiente(p) {
        return Math.max(0, (Number(p.amount) || 0) - getTotalPagado(p));
    }

    function getStatusDerived(p) {
        var pagado = getTotalPagado(p);
        var amount = Number(p.amount) || 0;
        if (amount > 0 && pagado >= amount) return 'pagada';
        if (pagado > 0) return 'parcial';
        return p.status || 'pendiente';
    }

    // Returns the current eventDate from the linked sale (if loaded), falling back to stored copy.
    // This keeps CXP dates in sync when a sale's eventDate is edited.
    function getEffectiveEventDate(p) {
        if (p.eventId) {
            var sale = cachedSales.find(function (s) { return String(s.id) === String(p.eventId); });
            if (sale && sale.eventDate) return sale.eventDate;
        }
        return p.eventDate || '';
    }

    // ── Due date info ──────────────────────────────────────────────────

    function getDueDateInfo(p) {
        if (getStatusDerived(p) === 'pagada') return { status: 'pagada', label: '-', rowStyle: '', cellStyle: '' };
        var dueDate = calcDueDate(getEffectiveEventDate(p));
        if (!dueDate) return { status: 'sin_fecha', label: 'Sin fecha', rowStyle: '', cellStyle: 'color:var(--text-muted)' };
        var today = new Date(); today.setHours(0, 0, 0, 0);
        var diff = Math.floor((dueDate - today) / 86400000);
        var label = formatDateShort(dueDate);
        if (diff < 0)  return { status: 'vencido',  label: label + ' \u00b7 VENCIDO', rowStyle: 'background:rgba(239,68,68,0.07)', cellStyle: 'color:var(--danger);font-weight:600' };
        if (diff === 0) return { status: 'hoy',     label: label + ' \u00b7 HOY',     rowStyle: 'background:rgba(239,68,68,0.07)', cellStyle: 'color:var(--danger);font-weight:700' };
        if (diff <= 7) return { status: 'proximo',  label: label + ' \u00b7 ' + diff + 'd', rowStyle: 'background:rgba(245,158,11,0.06)', cellStyle: 'color:var(--warning);font-weight:600' };
        return { status: 'pendiente', label: label, rowStyle: '', cellStyle: 'color:var(--text-secondary)' };
    }

    // ── Category filter ────────────────────────────────────────────────

    function getFilteredPayables() {
        var list = payables;
        if (currentCategory === 'evento')  list = list.filter(function (p) { return p.category === 'evento'; });
        if (currentCategory === 'general') list = list.filter(function (p) { return !p.category || p.category === 'general'; });
        if (showOnlyPending) list = list.filter(function (p) { return getStatusDerived(p) !== 'pagada'; });
        if (searchQuery) {
            var q = searchQuery.toLowerCase();
            list = list.filter(function (p) {
                return [p.clientName, p.eventName, p.concept, p.vendorName, p.docNumber].join(' ').toLowerCase().includes(q);
            });
        }
        // Per-column filters
        var activeCols = Object.keys(columnFilters).filter(function(k) { return columnFilters[k]; });
        if (activeCols.length) {
            list = list.filter(function(p) {
                return activeCols.every(function(col) {
                    var fv = (columnFilters[col] || '').toLowerCase();
                    var val;
                    if (col === '_status') {
                        val = getStatusDerived(p);
                    } else if (col === '_sourceId') {
                        var ls = cachedSales.find(function (s) { return String(s.id) === String(p.eventId); });
                        val = ls ? String(ls.sourceId || '') : '';
                    } else {
                        val = String(p[col] || '');
                    }
                    return val.toLowerCase().includes(fv);
                });
            });
        }

        if (sortCol) {
            list = list.slice().sort(function (a, b) {
                var av = sortCol === 'pending' ? getPendiente(a)
                       : sortCol === '_status' ? getStatusDerived(a)
                       : (a[sortCol] || 0);
                var bv = sortCol === 'pending' ? getPendiente(b)
                       : sortCol === '_status' ? getStatusDerived(b)
                       : (b[sortCol] || 0);
                var an = Number(av), bn = Number(bv);
                if (!isNaN(an) && !isNaN(bn)) return sortDir === 'asc' ? an - bn : bn - an;
                return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
            });
        }
        return list;
    }

    function sortTh(label, col) {
        var active = sortCol === col;
        var arrow = active ? (sortDir === 'asc' ? ' \u25b2' : ' \u25bc') : ' \u2195';
        return '<th class="payable-sort-th" data-sort="' + col + '" style="cursor:pointer;white-space:nowrap">' +
               label + '<span style="opacity:' + (active ? 1 : 0.25) + ';font-size:10px">' + arrow + '</span></th>';
    }

    // ── Documento info sub-row ─────────────────────────────────────────

    function docInfoHTML(p) {
        var lines = [];
        if (isBH(p)) {
            // amount = transferencia al proveedor (neto); retención se paga al SII encima de eso
            var rate = getBHRetentionRate(p.billingDate || p.eventDate);
            var amount = Number(p.amount) || 0;
            var ret  = Math.round(amount * rate);
            var totalCosto = amount + ret;
            lines.push('Retenci\u00f3n ' + (rate * 100).toFixed(2) + '%: ' + formatCLP(ret) + ' \u00b7 Costo total: ' + formatCLP(totalCosto));
        }
        if (isFactura(p)) {
            // amount = total a transferir (incluye IVA); IVA es crédito fiscal
            var amount = Number(p.amount) || 0;
            var neto = Math.round(amount / 1.19);
            var iva  = amount - neto;
            lines.push('Neto proveedor: ' + formatCLP(neto) + ' \u00b7 IVA cr\u00e9dito: ' + formatCLP(iva));
        }
        if (!lines.length) return '';
        return '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + lines.join(' \u00b7 ') + '</div>';
    }

    // ── KPIs ───────────────────────────────────────────────────────────

    function computeKPIs() {
        var filtered = getFilteredPayables();
        var totalPendiente = 0, vencidoCount = 0, vencidoSum = 0, proximoCount = 0, proximoSum = 0;
        var vendorsSet = {}, totalRetencion = 0, totalIVACredito = 0;

        filtered.forEach(function (p) {
            var st = getStatusDerived(p);
            if (st === 'pagada') return;
            var pending = getPendiente(p);
            totalPendiente += pending;
            var di = getDueDateInfo(p);
            if (di.status === 'vencido' || di.status === 'hoy') { vencidoCount++; vencidoSum += pending; }
            else if (di.status === 'proximo') { proximoCount++; proximoSum += pending; }
            if (p.vendorName) vendorsSet[p.vendorName] = true;
            if (isBH(p)) totalRetencion += Math.round((Number(p.amount) || 0) * getBHRetentionRate(p.billingDate || p.eventDate));
            if (isFactura(p)) { var _a = Number(p.amount) || 0; totalIVACredito += (_a - Math.round(_a / 1.19)); }
        });

        return {
            totalPendiente: totalPendiente,
            vencidoCount: vencidoCount, vencidoSum: vencidoSum,
            proximoCount: proximoCount, proximoSum: proximoSum,
            proveedoresCount: Object.keys(vendorsSet).length,
            totalRetencion: Math.round(totalRetencion),
            totalIVACredito: Math.round(totalIVACredito)
        };
    }

    function renderKPIs() {
        var k = computeKPIs();
        var cards = [
            kpiCard('danger', 'Total Pendiente', formatCLP(k.totalPendiente), ''),
            kpiCard('danger', 'Vencidos', k.vencidoCount, formatCLP(k.vencidoSum)),
            kpiCard('warning', 'Pr\u00f3ximos \u22647d', k.proximoCount, formatCLP(k.proximoSum)),
            kpiCard('info', 'Proveedores', k.proveedoresCount, '')
        ];
        if (k.totalRetencion > 0) cards.push(kpiCard('warning', 'Retenci\u00f3n BH pendiente', formatCLP(k.totalRetencion), 'SII mes en curso'));
        if (k.totalIVACredito > 0) cards.push(kpiCard('success', 'IVA Cr\u00e9dito Fiscal', formatCLP(k.totalIVACredito), 'Facturas pendientes'));
        return cards.join('\n');
    }

    function kpiCard(color, label, value, sub) {
        return '<div class="kpi-card ' + color + '">' +
               '<div class="kpi-label">' + label + '</div>' +
               '<div class="kpi-value">' + value + '</div>' +
               (sub ? '<div class="kpi-sub">' + sub + '</div>' : '') +
               '</div>';
    }

    // ── Render skeleton ────────────────────────────────────────────────

    function render() {
        return [
            '<div class="content-header">',
            '  <h2>Cuentas por Pagar</h2>',
            '  <button class="btn btn-primary" id="payables-btn-new">+ Nuevo Costo</button>',
            '</div>',
            '<div class="content-body" id="payables-body">',
            '  <div class="kpi-grid" id="payables-kpis"></div>',
            '  <div class="toolbar">',
            '    <input type="text" id="payables-search" class="form-control" placeholder="Buscar proveedor, evento, concepto..." style="max-width:280px" value="' + searchQuery + '">',
            '    <button id="payables-clear-filters" class="btn btn-secondary btn-sm" style="white-space:nowrap" title="Limpiar todos los filtros">&#10006; Limpiar filtros</button>',
            '    <div class="toggle-group" id="payables-pending-toggle">',
            '      <button class="toggle-option' + (!showOnlyPending ? ' active' : '') + '" data-pending="false">Mostrar todos</button>',
            '      <button class="toggle-option' + (showOnlyPending ? ' active' : '') + '" data-pending="true">Mostrar pendientes</button>',
            '    </div>',
            '    <div class="toggle-group" id="payables-category-toggle">',
            '      <button class="toggle-option active" data-cat="todos">Todos</button>',
            '      <button class="toggle-option" data-cat="evento">Por Evento</button>',
            '      <button class="toggle-option" data-cat="general">Gastos Generales</button>',
            '    </div>',
            '    <div class="toggle-group" id="payables-view-toggle">',
            '      <button class="toggle-option active" data-view="lista">Lista</button>',
            '      <button class="toggle-option" data-view="agrupada">Agrupada</button>',
            '    </div>',
            '  </div>',
            '  <div id="payables-content"></div>',
            '</div>',
            renderEditModal(),
            renderAbonoModal()
        ].join('\n');
    }

    // ── Column filter helpers ──────────────────────────────────────────

    var COL_FILTER_STYLE = 'width:100%;font-size:11px;padding:2px 4px;border:1px solid var(--border);border-radius:3px;background:var(--bg-secondary);color:var(--text-primary);box-sizing:border-box';

    function payFilterInput(col, placeholder) {
        var fv = columnFilters[col] || '';
        return '<input class="pay-col-filter" data-col="' + col + '" type="text" value="' + fv + '" placeholder="' + placeholder + '" style="' + COL_FILTER_STYLE + '">';
    }

    // ── List view ──────────────────────────────────────────────────────

    function renderListView() {
        var filtered = getFilteredPayables();
        if (!filtered.length) return '<div class="empty-state"><div class="empty-icon">&#128203;</div><p>No hay costos registrados.</p></div>';

        var rows = filtered.map(function (p) {
            var st = getStatusDerived(p);
            var pending = getPendiente(p);
            var bClass = { pagada: 'badge-success', parcial: 'badge-info', pendiente: 'badge-warning' }[st] || 'badge-warning';
            var stLabel = { pagada: 'Pagada', parcial: 'Parcial', pendiente: 'Pendiente' }[st] || st;
            var di = getDueDateInfo(p);
            var catBadge = p.category === 'general' ? ' <span class="badge badge-secondary" style="font-size:10px">General</span>' : '';
            var docStr = docTypeLabel(p.docType) + (p.docNumber ? ' #' + p.docNumber : '');
            var effDate = getEffectiveEventDate(p);
            var eventCell = (p.eventName || '-') + catBadge + (effDate ? '<div style="font-size:11px;color:var(--text-muted)">' + effDate + '</div>' : '');
            // "Pagar" when pending, "Pagos" (always accessible) when paid — allows viewing/reversing payments
            var abonarBtn = st !== 'pagada'
                ? '<button class="btn btn-sm btn-success payable-abonar" data-id="' + p.id + '">Pagar</button>'
                : '<button class="btn btn-sm btn-secondary payable-abonar" data-id="' + p.id + '" title="Ver historial de pagos">Pagos</button>';

            // Show actual payment date when paid, scheduled due date when pending
            var dueCellLabel, dueCellStyle;
            if (st === 'pagada') {
                var lastPay = p.payments && p.payments.length
                    ? p.payments.reduce(function (a, b) { return (a.date || '') > (b.date || '') ? a : b; })
                    : null;
                dueCellLabel = lastPay ? lastPay.date : '-';
                dueCellStyle = 'color:var(--success)';
            } else {
                dueCellLabel = di.label;
                dueCellStyle = di.cellStyle;
            }

            var linkedSale = p.eventId ? cachedSales.find(function (s) { return String(s.id) === String(p.eventId); }) : null;
            var sourceId = linkedSale ? String(linkedSale.sourceId || '') : '';
            var eventIdCell = sourceId
                ? '<span style="font-size:12px;font-weight:600">' + sourceId + '</span>'
                : (p.eventId ? '<span style="font-size:10px;color:var(--text-muted)">' + p.eventId.substring(0, 8) + '\u2026</span>' : '-');
            return '<tr style="' + di.rowStyle + '">' +
                '<td style="white-space:nowrap">' + eventIdCell + '</td>' +
                '<td>' + (p.clientName || '-') + '</td>' +
                '<td>' + eventCell + '</td>' +
                '<td>' + (p.concept || '-') + '</td>' +
                '<td>' + (p.vendorName || '<span style="color:var(--text-muted)">-</span>') + '</td>' +
                '<td>' + docStr + docInfoHTML(p) + '</td>' +
                '<td class="text-right">' + formatCLP(p.amount) + '</td>' +
                '<td class="text-right" style="' + (pending > 0 ? 'color:var(--danger)' : '') + '">' + formatCLP(pending) + '</td>' +
                '<td style="white-space:nowrap;' + dueCellStyle + '">' + dueCellLabel + '</td>' +
                '<td><span class="badge ' + bClass + '">' + stLabel + '</span></td>' +
                '<td><div class="flex gap-sm">' +
                '  <button class="btn-icon payable-edit" data-id="' + p.id + '" title="Editar">&#9998;</button>' +
                abonarBtn +
                '  <button class="btn-icon payable-delete" data-id="' + p.id + '" title="Eliminar">&#128465;</button>' +
                '</div></td>' +
                '</tr>';
        }).join('');

        var filterRow = '<tr style="background:var(--bg-tertiary)">' +
            '<th style="padding:2px 4px">' + payFilterInput('_sourceId', 'ID...') + '</th>' +
            '<th style="padding:2px 4px">' + payFilterInput('clientName', 'Cliente...') + '</th>' +
            '<th style="padding:2px 4px">' + payFilterInput('eventName', 'Evento...') + '</th>' +
            '<th style="padding:2px 4px">' + payFilterInput('concept', 'Concepto...') + '</th>' +
            '<th style="padding:2px 4px">' + payFilterInput('vendorName', 'Proveedor...') + '</th>' +
            '<th></th><th></th><th></th><th></th>' +
            '<th style="padding:2px 4px">' + payFilterInput('_status', 'Estado...') + '</th>' +
            '<th></th></tr>';
        return '<table class="data-table" id="payables-list-table">' +
            '<thead><tr>' +
            '<th style="font-size:11px;color:var(--text-muted)">ID Evento</th>' +
            sortTh('Cliente', 'clientName') +
            sortTh('Evento / Descripci\u00f3n', 'eventName') +
            sortTh('Concepto', 'concept') +
            sortTh('Proveedor', 'vendorName') +
            '<th>Documento</th>' +
            sortTh('Monto', 'amount') +
            sortTh('Pendiente', 'pending') +
            sortTh('Fecha Pago', 'eventDate') +
            sortTh('Estado', '_status') + '<th>Acciones</th>' +
            '</tr>' + filterRow + '</thead><tbody>' + rows + '</tbody></table>';
    }

    // ── Grouped view ───────────────────────────────────────────────────

    function renderGroupedView() {
        var filtered = getFilteredPayables();
        if (!filtered.length) return '<div class="empty-state"><div class="empty-icon">&#128203;</div><p>No hay costos registrados.</p></div>';

        var groups = {};
        filtered.forEach(function (p) {
            var key = (p.category === 'general')
                ? '__general__'
                : (p.eventName || 'Sin evento') + '||' + (p.eventDate || '');
            if (!groups[key]) groups[key] = {
                isGeneral: p.category === 'general',
                eventName: (p.category === 'general') ? 'Gastos Generales' : (p.eventName || 'Sin evento'),
                eventDate: p.eventDate || '',
                clientName: p.clientName || '',
                items: []
            };
            groups[key].items.push(p);
        });

        return Object.keys(groups).sort().map(function (key) {
            var grp = groups[key];
            var totalPending = grp.items.reduce(function (s, p) { return s + (getStatusDerived(p) !== 'pagada' ? getPendiente(p) : 0); }, 0);
            var clientLabel = grp.clientName ? ' \u00b7 ' + grp.clientName : '';
            var dateLabel = grp.eventDate ? ' <span style="font-size:12px;color:var(--text-muted)">' + grp.eventDate + clientLabel + '</span>' : '';

            var rows = grp.items.map(function (p) {
                var st = getStatusDerived(p);
                var pending = getPendiente(p);
                var bClass = { pagada: 'badge-success', parcial: 'badge-info', pendiente: 'badge-warning' }[st] || 'badge-warning';
                var stLabel = { pagada: 'Pagada', parcial: 'Parcial', pendiente: 'Pendiente' }[st] || st;
                var di = getDueDateInfo(p);
                var docStr = docTypeLabel(p.docType) + (p.docNumber ? ' #' + p.docNumber : '');
                var abonarBtn = st !== 'pagada'
                    ? '<button class="btn btn-sm btn-success payable-abonar" data-id="' + p.id + '">Pagar</button>'
                    : '<button class="btn btn-sm btn-secondary payable-abonar" data-id="' + p.id + '" title="Ver historial de pagos">Pagos</button>';
                var grpDueLabel, grpDueStyle;
                if (st === 'pagada') {
                    var lastPay = p.payments && p.payments.length
                        ? p.payments.reduce(function (a, b) { return (a.date || '') > (b.date || '') ? a : b; })
                        : null;
                    grpDueLabel = lastPay ? lastPay.date : '-';
                    grpDueStyle = 'color:var(--success)';
                } else {
                    grpDueLabel = di.label;
                    grpDueStyle = di.cellStyle;
                }

                return '<tr style="' + di.rowStyle + '">' +
                    '<td>' + (p.concept || '-') + '</td>' +
                    '<td>' + (p.vendorName || '-') + '</td>' +
                    '<td>' + docStr + docInfoHTML(p) + '</td>' +
                    '<td class="text-right">' + formatCLP(p.amount) + '</td>' +
                    '<td class="text-right" style="' + (pending > 0 ? 'color:var(--danger)' : '') + '">' + formatCLP(pending) + '</td>' +
                    '<td style="white-space:nowrap;' + grpDueStyle + '">' + grpDueLabel + '</td>' +
                    '<td><span class="badge ' + bClass + '">' + stLabel + '</span></td>' +
                    '<td><div class="flex gap-sm">' +
                    '<button class="btn-icon payable-edit" data-id="' + p.id + '">&#9998;</button>' +
                    abonarBtn +
                    '<button class="btn-icon payable-delete" data-id="' + p.id + '">&#128465;</button>' +
                    '</div></td></tr>';
            }).join('');

            return '<div class="card" style="margin-bottom:var(--space-md)">' +
                '<div class="card-header">' +
                '  <div><span class="card-title">' + grp.eventName + '</span>' + dateLabel + '</div>' +
                '  <span class="text-danger" style="font-weight:700">' + formatCLP(totalPending) + ' pendiente</span>' +
                '</div>' +
                '<table class="data-table"><thead><tr>' +
                '<th>Concepto</th><th>Proveedor</th><th>Documento</th>' +
                '<th class="text-right">Monto</th><th class="text-right">Pendiente</th>' +
                '<th>Fecha Pago</th><th>Estado</th><th>Acciones</th>' +
                '</tr></thead><tbody>' + rows + '</tbody></table></div>';
        }).join('');
    }

    // ── Edit Modal ─────────────────────────────────────────────────────

    function renderEditModal() {
        return [
            '<div class="modal-overlay" id="payable-modal">',
            '<div class="modal">',
            '  <div class="modal-header">',
            '    <h3 id="payable-modal-title">Nuevo Costo</h3>',
            '    <button class="modal-close" id="payable-modal-close">&times;</button>',
            '  </div>',
            '  <form id="payable-form">',
            '    <div class="form-row">',
            '      <div class="form-group">',
            '        <label>Categor\u00eda</label>',
            '        <select class="form-control" id="pay-category">',
            '          <option value="evento">Por Evento</option>',
            '          <option value="general">Gasto General</option>',
            '        </select>',
            '      </div>',
            '      <div class="form-group">',
            '        <label>Tipo de Documento</label>',
            '        <select class="form-control" id="pay-docType">',
            '          <option value="bh">BH</option>',
            '          <option value="factura">Factura</option>',
            '          <option value="exenta">F. Exenta</option>',
            '          <option value="invoice">Invoice</option>',
            '          <option value="ninguno">Sin documento</option>',
            '        </select>',
            '      </div>',
            '    </div>',
            '    <input type="hidden" id="pay-eventName">',
            '    <input type="hidden" id="pay-clientName">',
            '    <input type="hidden" id="pay-linked-eventId">',
            '    <div id="pay-evento-selector">',
            '      <div class="form-group" style="margin-bottom:var(--space-sm)">',
            '        <label>Buscar por ID de evento <span style="color:var(--text-muted);font-weight:400">(escribe el n\u00famero de venta)</span></label>',
            '        <input type="text" class="form-control" id="pay-id-search" placeholder="Ej. 42 \u2192 busca y selecciona autom\u00e1ticamente" autocomplete="off">',
            '      </div>',
            '      <div class="form-row">',
            '        <div class="form-group">',
            '          <label>Cliente</label>',
            '          <select class="form-control" id="pay-clientSelect">',
            '            <option value="">— Seleccionar cliente —</option>',
            '          </select>',
            '        </div>',
            '        <div class="form-group">',
            '          <label>Evento</label>',
            '          <select class="form-control" id="pay-eventSelect">',
            '            <option value="">— Seleccionar evento —</option>',
            '          </select>',
            '        </div>',
            '      </div>',
            '    </div>',
            '    <div id="pay-general-desc" style="display:none">',
            '      <div class="form-group">',
            '        <label>Descripci\u00f3n</label>',
            '        <input type="text" class="form-control" id="pay-eventName-text" placeholder="Descripci\u00f3n del gasto general...">',
            '      </div>',
            '    </div>',
            '    <div class="form-row">',
            '      <div class="form-group">',
            '        <label>Fecha del Evento <span style="color:var(--text-muted);font-weight:400">(para calcular fecha pago)</span></label>',
            '        <input type="date" class="form-control" id="pay-eventDate">',
            '      </div>',
            '      <div class="form-group">',
            '        <label>Fecha Emisi\u00f3n Documento <span style="color:var(--text-muted);font-weight:400">(BH / Factura)</span></label>',
            '        <input type="date" class="form-control" id="pay-billingDate">',
            '      </div>',
            '    </div>',
            '    <div class="form-row">',
            '      <div class="form-group">',
            '        <label>Concepto</label>',
            '        <input type="text" class="form-control" id="pay-concept" required list="pay-concept-list" autocomplete="off">',
            '        <datalist id="pay-concept-list"></datalist>',
            '      </div>',
            '      <div class="form-group">',
            '        <label>Proveedor / Beneficiario</label>',
            '        <input type="text" class="form-control" id="pay-vendorName" list="pay-vendor-list" autocomplete="off">',
            '        <datalist id="pay-vendor-list"></datalist>',
            '      </div>',
            '    </div>',
            '    <div class="form-row">',
            '      <div class="form-group">',
            '        <label>N\u00b0 de Documento</label>',
            '        <input type="text" class="form-control" id="pay-docNumber">',
            '      </div>',
            '      <div class="form-group">',
            '        <label id="pay-amount-label">Monto a transferir al proveedor</label>',
            '        <input type="number" class="form-control" id="pay-amount" min="0" step="1" required>',
            '      </div>',
            '    </div>',
            '    <div id="pay-doc-preview" style="display:none;background:var(--bg-tertiary);border-radius:8px;padding:10px 14px;margin-bottom:var(--space-md);font-size:13px;line-height:1.8"></div>',
            '    <div class="form-group">',
            '      <label>Comentarios</label>',
            '      <textarea class="form-control" id="pay-comments" rows="2" style="resize:vertical"></textarea>',
            '    </div>',
            '    <div class="form-group">',
            '      <label>Fecha de Pago / N\u00f3mina <span style="font-weight:400;color:var(--text-muted)">(auto = viernes \u226530d. Edita para adelantar/atrasar)</span></label>',
            '      <div style="display:flex;gap:8px;align-items:center">',
            '        <input type="date" class="form-control" id="pay-nomina-date" style="max-width:200px">',
            '        <button type="button" class="btn btn-secondary btn-sm" id="pay-nomina-auto" style="white-space:nowrap;font-size:11px">Auto (30d)</button>',
            '        <span id="pay-due-date-display" style="font-size:13px;color:var(--text-secondary)"></span>',
            '      </div>',
            '    </div>',
            '    <div class="form-actions">',
            '      <button type="button" class="btn btn-secondary" id="payable-cancel">Cancelar</button>',
            '      <button type="submit" class="btn btn-primary">Guardar</button>',
            '    </div>',
            '  </form>',
            '</div>',
            '</div>'
        ].join('\n');
    }

    // ── Abono Modal ────────────────────────────────────────────────────

    function renderAbonoModal() {
        return [
            '<div class="modal-overlay" id="payable-abono-modal">',
            '<div class="modal">',
            '  <div class="modal-header">',
            '    <h3>Registrar Pago</h3>',
            '    <button class="modal-close" id="abono-close">&times;</button>',
            '  </div>',
            '  <div id="abono-summary" style="background:var(--bg-tertiary);border-radius:8px;padding:10px 14px;margin-bottom:var(--space-md);font-size:13px;line-height:1.8"></div>',
            '  <div id="abono-payments-list" style="margin-bottom:var(--space-md)"></div>',
            '  <form id="abono-form">',
            '    <div class="form-row">',
            '      <div class="form-group">',
            '        <label>Monto a pagar</label>',
            '        <input type="number" class="form-control" id="abono-amount" min="1" step="1">',
            '      </div>',
            '      <div class="form-group">',
            '        <label>Fecha</label>',
            '        <input type="date" class="form-control" id="abono-date">',
            '      </div>',
            '    </div>',
            '    <div class="form-row">',
            '      <div class="form-group">',
            '        <label>M\u00e9todo</label>',
            '        <select class="form-control" id="abono-method">',
            '          <option value="transferencia">Transferencia</option>',
            '          <option value="efectivo">Efectivo</option>',
            '          <option value="cheque">Cheque</option>',
            '          <option value="otro">Otro</option>',
            '        </select>',
            '      </div>',
            '      <div class="form-group" style="display:flex;align-items:flex-end">',
            '        <button type="button" class="btn btn-secondary" id="abono-fill-total" style="width:100%">Pagar total pendiente</button>',
            '      </div>',
            '    </div>',
            '    <div class="form-actions">',
            '      <button type="button" class="btn btn-secondary" id="abono-cancel">Cancelar</button>',
            '      <button type="submit" class="btn btn-primary">Guardar Pago</button>',
            '    </div>',
            '  </form>',
            '</div>',
            '</div>'
        ].join('\n');
    }

    // ── Data loading ───────────────────────────────────────────────────

    async function loadData() {
        try {
            var results = await Promise.all([
                window.Mazelab.DataService.getAll('payables'),
                window.Mazelab.DataService.getAll('sales'),
                window.Mazelab.DataService.getAll('clients')
            ]);
            payables      = results[0] || [];
            cachedSales   = results[1] || [];
            cachedClients = results[2] || [];
        } catch (e) {
            console.warn('PayablesModule: Error loading data', e);
            payables = [];
            cachedSales = [];
            cachedClients = [];
        }
    }

    function refreshView() {
        var kpi = document.getElementById('payables-kpis');
        if (kpi) kpi.innerHTML = renderKPIs();
        var content = document.getElementById('payables-content');
        if (content) content.innerHTML = currentView === 'lista' ? renderListView()
            : renderGroupedView();
        bindTableActions();
    }

    // ── Edit Modal helpers ─────────────────────────────────────────────

    function updateDueDateDisplay(autoFill) {
        var display = document.getElementById('pay-due-date-display');
        var nominaInput = document.getElementById('pay-nomina-date');
        if (!display) return;
        var dateStr = (document.getElementById('pay-eventDate') || {}).value;
        var dueDate = calcDueDate(dateStr);

        // Auto mode: clear the override so nóminas uses auto-calc
        if (autoFill && nominaInput) {
            nominaInput.value = '';
        }

        // Show info based on override date or calculated date
        var selectedDate = (nominaInput && nominaInput.value) ? new Date(nominaInput.value) : dueDate;
        if (!selectedDate || isNaN(selectedDate.getTime())) { display.textContent = ''; return; }
        var today = new Date(); today.setHours(0, 0, 0, 0);
        var diff = Math.floor((selectedDate - today) / 86400000);
        var label = '';
        if (diff < 0) { label = 'vencido hace ' + Math.abs(diff) + 'd'; display.style.color = 'var(--danger)'; }
        else if (diff === 0) { label = '\u00a1HOY!'; display.style.color = 'var(--danger)'; }
        else { label = 'en ' + diff + ' d\u00edas'; display.style.color = diff <= 7 ? 'var(--warning)' : 'var(--text-secondary)'; }
        display.textContent = label;
    }

    function updateDocPreview() {
        var preview = document.getElementById('pay-doc-preview');
        if (!preview) return;
        var docType = (document.getElementById('pay-docType') || {}).value || '';
        var amount = Number((document.getElementById('pay-amount') || {}).value) || 0;
        var billingDate = (document.getElementById('pay-billingDate') || {}).value
                       || (document.getElementById('pay-eventDate') || {}).value || '';

        var amountLabel = document.getElementById('pay-amount-label');
        if (docType === 'bh' && amount > 0) {
            // amount = TRANSFERENCIA al proveedor (neto); retención = amount * rate, pagada al SII por el empleador
            var rate = getBHRetentionRate(billingDate);
            var ret  = Math.round(amount * rate);
            var totalCosto = amount + ret;
            if (amountLabel) amountLabel.textContent = 'Monto a transferir al proveedor';
            preview.style.display = 'block';
            preview.innerHTML = '\u24d8 BH &middot; Transferencia al proveedor: <strong>' + formatCLP(amount) + '</strong>' +
                '<br>Retenci\u00f3n ' + (rate * 100).toFixed(2) + '%: <strong>' + formatCLP(ret) + '</strong> (queda en tu cuenta para SII)' +
                '<br>Costo real total: <strong>' + formatCLP(totalCosto) + '</strong>';
        } else if (docType === 'factura' && amount > 0) {
            // amount = TOTAL a transferir (incluye IVA); neto = amount/1.19; IVA es crédito fiscal
            var neto = Math.round(amount / 1.19);
            var iva  = amount - neto;
            if (amountLabel) amountLabel.textContent = 'Monto total a transferir (incluye IVA)';
            preview.style.display = 'block';
            preview.innerHTML = '\u24d8 Factura &middot; Monto neto al proveedor: <strong>' + formatCLP(neto) + '</strong>' +
                '<br>IVA cr\u00e9dito fiscal (19%): <strong>' + formatCLP(iva) + '</strong> (se descuenta de tu d\u00e9bito fiscal del mes)';
        } else {
            if (amountLabel) amountLabel.textContent = 'Monto a transferir al proveedor';
            preview.style.display = 'none';
        }
    }

    function populatePayClientDropdown() {
        var sel = document.getElementById('pay-clientSelect');
        if (!sel) return;
        // Key by clientName (ventas table has clientName, not clientId, in PostgreSQL)
        var names = {};
        cachedSales.forEach(function (s) { if (s.clientName) names[s.clientName] = true; });
        cachedClients.forEach(function (c) {
            var n = c.name || c.nombre;
            if (n) names[n] = true;
        });
        var opts = '<option value="">— Seleccionar cliente —</option>';
        Object.keys(names).sort(function (a, b) { return a.localeCompare(b); }).forEach(function (n) {
            opts += '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + '</option>';
        });
        sel.innerHTML = opts;
    }

    // clientKey = clientName string (value of the client select)
    function populatePayEventDropdown(clientKey) {
        var sel = document.getElementById('pay-eventSelect');
        if (!sel) return;
        var filtered = !clientKey ? [] : cachedSales.filter(function (s) { return s.clientName === clientKey; });
        filtered.sort(function (a, b) { return (b.eventDate || '').localeCompare(a.eventDate || ''); });
        var opts = '<option value="">— Seleccionar evento —</option>';
        filtered.forEach(function (s) {
            var label = (s.eventName || 'Sin nombre') +
                (s.eventDate ? '  ·  ' + s.eventDate : '') +
                (s.sourceId ? '  #' + s.sourceId : '');
            opts += '<option value="' + s.id + '" data-ename="' + escapeHtml(s.eventName || '') +
                '" data-cname="' + escapeHtml(s.clientName || '') +
                '" data-edate="' + (s.eventDate || '') + '">' + escapeHtml(label) + '</option>';
        });
        sel.innerHTML = opts;
        sel.disabled = filtered.length === 0;
    }

    function applyPayEventSelection() {
        var eventSel = document.getElementById('pay-eventSelect');
        if (!eventSel || !eventSel.value) return;
        var opt = eventSel.options[eventSel.selectedIndex];
        var hidEventName  = document.getElementById('pay-eventName');
        var hidClientName = document.getElementById('pay-clientName');
        var hidLinkedId   = document.getElementById('pay-linked-eventId');
        var dateEl        = document.getElementById('pay-eventDate');
        if (hidEventName)  hidEventName.value  = opt.dataset.ename || '';
        if (hidClientName) hidClientName.value = opt.dataset.cname || '';
        if (hidLinkedId)   hidLinkedId.value   = eventSel.value;
        if (dateEl && opt.dataset.edate) { dateEl.value = opt.dataset.edate; updateDueDateDisplay(); }
    }

    function updatePayCategoryUI() {
        var cat = (document.getElementById('pay-category') || {}).value;
        var eventoEl  = document.getElementById('pay-evento-selector');
        var generalEl = document.getElementById('pay-general-desc');
        if (eventoEl)  eventoEl.style.display  = (cat === 'general') ? 'none' : '';
        if (generalEl) generalEl.style.display = (cat === 'general') ? '' : 'none';
    }

    function openEditModal(payable) {
        editingId = payable ? payable.id : null;
        var title = document.getElementById('payable-modal-title');
        if (title) title.textContent = payable ? 'Editar Costo' : 'Nuevo Costo';

        var category = payable ? (payable.category || 'evento') : 'evento';
        document.getElementById('pay-category').value        = category;
        document.getElementById('pay-docType').value         = payable ? (payable.docType     || 'bh') : 'bh';
        document.getElementById('pay-eventName').value       = payable ? (payable.eventName   || '')   : '';
        document.getElementById('pay-clientName').value      = payable ? (payable.clientName  || '')   : '';
        document.getElementById('pay-linked-eventId').value  = payable ? (payable.eventId     || '')   : '';
        document.getElementById('pay-eventDate').value       = payable ? (payable.eventDate   || '')   : '';
        document.getElementById('pay-billingDate').value     = payable ? (payable.billingDate || '')   : '';
        document.getElementById('pay-concept').value         = payable ? (payable.concept     || '')   : '';
        document.getElementById('pay-vendorName').value      = payable ? (payable.vendorName  || '')   : '';
        document.getElementById('pay-docNumber').value       = payable ? (payable.docNumber   || '')   : '';
        document.getElementById('pay-amount').value          = payable ? (payable.amount || '') : '';
        document.getElementById('pay-comments').value        = payable ? (payable.comments    || '')   : '';

        // Show/hide cascade vs general text
        updatePayCategoryUI();

        if (category === 'evento') {
            populatePayClientDropdown();
            // Pre-select using clientName (primary key in dropdown since ventas has no clientId column)
            var linkedSale = payable && payable.eventId
                ? cachedSales.find(function (s) { return s.id === payable.eventId; })
                : null;
            var preClientName = (linkedSale && linkedSale.clientName) || (payable && payable.clientName) || '';
            if (preClientName) {
                var clientSel = document.getElementById('pay-clientSelect');
                if (clientSel) clientSel.value = preClientName;
                populatePayEventDropdown(preClientName);
                if (payable && payable.eventId) {
                    var eventSel = document.getElementById('pay-eventSelect');
                    if (eventSel) eventSel.value = payable.eventId;
                }
            } else {
                populatePayEventDropdown('');
            }
        } else {
            var textEl = document.getElementById('pay-eventName-text');
            if (textEl) textEl.value = payable ? (payable.eventName || '') : '';
        }

        // Populate datalists from existing payables data
        var vendors = {}, concepts = {};
        payables.forEach(function (p) {
            if (p.vendorName) vendors[p.vendorName] = true;
            if (p.concept)    concepts[p.concept]   = true;
        });
        var vendorList = document.getElementById('pay-vendor-list');
        if (vendorList) vendorList.innerHTML = Object.keys(vendors).sort().map(function (v) { return '<option value="' + escapeHtml(v) + '">'; }).join('');
        var conceptList = document.getElementById('pay-concept-list');
        if (conceptList) conceptList.innerHTML = Object.keys(concepts).sort().map(function (c) { return '<option value="' + escapeHtml(c) + '">'; }).join('');

        // Fix: browsers filter datalist to match current input value, so pre-filled inputs
        // only show their own value as a suggestion. Clear on focus → show all options.
        var vendorInput = document.getElementById('pay-vendorName');
        if (vendorInput) {
            vendorInput.onfocus = function () { this._savedVal = this.value; this.value = ''; };
            vendorInput.onblur  = function () { if (!this.value) this.value = this._savedVal || ''; };
        }
        var conceptInput = document.getElementById('pay-concept');
        if (conceptInput) {
            conceptInput.onfocus = function () { this._savedVal = this.value; this.value = ''; };
            conceptInput.onblur  = function () { if (!this.value) this.value = this._savedVal || ''; };
        }

        // Clear ID search
        var idSearch = document.getElementById('pay-id-search');
        if (idSearch) idSearch.value = '';

        // Load nominaDate if exists, otherwise auto-calc
        var nominaInput = document.getElementById('pay-nomina-date');
        if (nominaInput && payable && payable.nominaDate) {
            nominaInput.value = payable.nominaDate;
        }
        updateDueDateDisplay(!payable || !payable.nominaDate); // auto-fill only if no override

        // "Auto" button resets to calculated date
        var autoBtn = document.getElementById('pay-nomina-auto');
        if (autoBtn) {
            autoBtn.addEventListener('click', function () {
                // Clear override so nóminas falls back to auto-calc
                var ni = document.getElementById('pay-nomina-date');
                if (ni) ni.value = '';
                updateDueDateDisplay(true);
            });
        }
        // Update display when nomina date changes manually
        if (nominaInput) {
            nominaInput.addEventListener('change', function () {
                updateDueDateDisplay(false);
            });
        }

        updateDocPreview();

        ['pay-eventDate', 'pay-billingDate'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) { el.onchange = function () { updateDueDateDisplay(); updateDocPreview(); }; }
        });
        var dtSel = document.getElementById('pay-docType');
        if (dtSel) dtSel.onchange = updateDocPreview;
        var amtEl = document.getElementById('pay-amount');
        if (amtEl) amtEl.oninput = updateDocPreview;

        var modal = document.getElementById('payable-modal');
        if (modal) modal.classList.add('active');
    }

    function closeEditModal() {
        var modal = document.getElementById('payable-modal');
        if (modal) modal.classList.remove('active');
        editingId = null;
    }

    // ── Abono Modal helpers ────────────────────────────────────────────

    function openAbonoModal(id) {
        abonoTargetId = id;
        var p = payables.find(function (x) { return x.id === id; });
        if (!p) return;
        refreshAbonoContent(p);
        var modal = document.getElementById('payable-abono-modal');
        if (modal) modal.classList.add('active');
    }

    function closeAbonoModal() {
        var modal = document.getElementById('payable-abono-modal');
        if (modal) modal.classList.remove('active');
        abonoTargetId = null;
    }

    function refreshAbonoContent(p) {
        var pending = getPendiente(p);
        var docStr = docTypeLabel(p.docType) + (p.docNumber ? ' #' + p.docNumber : '');
        var amount = Number(p.amount) || 0;

        // Summary block
        var summaryEl = document.getElementById('abono-summary');
        if (summaryEl) {
            var extraLine = '';
            if (isBH(p) && amount > 0) {
                var rate = getBHRetentionRate(p.billingDate || p.eventDate);
                var ret  = Math.round(amount * rate);
                var totalCosto = amount + ret;
                extraLine = '<br><span style="color:var(--text-muted);font-size:12px">Retenci\u00f3n SII (' + (rate * 100).toFixed(2) + '%): ' + formatCLP(ret) +
                            ' &middot; Costo total: ' + formatCLP(totalCosto) + '</span>';
            } else if (isFactura(p) && amount > 0) {
                var neto = Math.round(amount / 1.19);
                var iva  = amount - neto;
                extraLine = '<br><span style="color:var(--text-muted);font-size:12px">Neto proveedor: ' + formatCLP(neto) + ' &middot; IVA cr\u00e9dito: ' + formatCLP(iva) + '</span>';
            }
            summaryEl.innerHTML =
                '<strong>' + (p.vendorName || 'Sin proveedor') + '</strong> &middot; ' + (p.eventName || 'Sin evento') +
                '<br>Documento: ' + docStr +
                ' &middot; Monto: ' + formatCLP(amount) +
                ' &middot; Pagado: ' + formatCLP(getTotalPagado(p)) +
                ' &middot; <strong style="color:var(--danger)">Pendiente: ' + formatCLP(pending) + '</strong>' +
                extraLine;
        }

        // Payments list
        var listEl = document.getElementById('abono-payments-list');
        if (listEl) {
            var payments = p.payments || [];
            if (!payments.length) {
                listEl.innerHTML = '<p style="color:var(--text-muted);font-size:13px">Sin pagos registrados.</p>';
            } else {
                var rows = payments.map(function (pay, i) {
                    return '<div style="display:flex;align-items:center;gap:12px;padding:6px 0;border-bottom:1px solid var(--border)">' +
                        '<span style="flex:1;font-size:13px">' + (pay.date || '-') + ' &middot; ' + (pay.method || '-') + '</span>' +
                        '<strong>' + formatCLP(pay.amount) + '</strong>' +
                        '<button class="btn-icon abono-del-pay" data-idx="' + i + '" title="Eliminar">&#128465;</button>' +
                        '</div>';
                }).join('');
                listEl.innerHTML = '<div style="font-size:13px;font-weight:600;color:var(--text-secondary);margin-bottom:4px">Pagos registrados:</div>' + rows;
                listEl.querySelectorAll('.abono-del-pay').forEach(function (btn) {
                    btn.addEventListener('click', function () { deletePayment(abonoTargetId, Number(btn.dataset.idx)); });
                });
            }
        }

        // Pre-fill amount input
        var amountEl = document.getElementById('abono-amount');
        if (amountEl) amountEl.value = pending > 0 ? Math.round(pending) : '';
        var dateEl = document.getElementById('abono-date');
        if (dateEl) dateEl.value = todayStr();

        // Fill-total button
        var fillBtn = document.getElementById('abono-fill-total');
        if (fillBtn) {
            fillBtn.onclick = function () {
                var pNow = payables.find(function (x) { return x.id === abonoTargetId; });
                var am = document.getElementById('abono-amount');
                if (am && pNow) am.value = Math.round(getPendiente(pNow));
            };
        }
    }

    async function deletePayment(payableId, idx) {
        var p = payables.find(function (x) { return x.id === payableId; });
        if (!p || !p.payments) return;
        var updated = p.payments.filter(function (_, i) { return i !== idx; });
        try {
            await window.Mazelab.DataService.update('payables', payableId, { payments: updated });
            await loadData();
            var fresh = payables.find(function (x) { return x.id === payableId; });
            if (fresh) refreshAbonoContent(fresh);
            refreshView();
        } catch (err) { console.error('PayablesModule: deletePayment error', err); }
    }

    async function handleAbonoSave(e) {
        e.preventDefault();
        if (!abonoTargetId) return;
        var p = payables.find(function (x) { return x.id === abonoTargetId; });
        if (!p) return;
        var amount = Number(document.getElementById('abono-amount').value) || 0;
        if (amount <= 0) { alert('Ingresa un monto v\u00e1lido.'); return; }
        var date   = document.getElementById('abono-date').value || todayStr();
        var method = document.getElementById('abono-method').value || 'transferencia';
        var newPayments = (p.payments || []).concat([{ id: generateId(), amount: amount, date: date, method: method }]);
        try {
            await window.Mazelab.DataService.update('payables', abonoTargetId, { payments: newPayments });
            await loadData();
            var fresh = payables.find(function (x) { return x.id === abonoTargetId; });
            if (fresh) refreshAbonoContent(fresh);
            refreshView();
        } catch (err) { console.error('PayablesModule: handleAbonoSave error', err); alert('Error al guardar el pago.'); }
    }

    // ── Save ───────────────────────────────────────────────────────────

    async function handleSave(e) {
        e.preventDefault();
        var catVal = document.getElementById('pay-category').value || 'evento';
        // For general costs, sync description text to hidden field
        if (catVal === 'general') {
            var textEl = document.getElementById('pay-eventName-text');
            var hidEl  = document.getElementById('pay-eventName');
            if (textEl && hidEl) hidEl.value = textEl.value.trim();
        }
        var docTypeVal   = document.getElementById('pay-docType').value || 'bh';
        var billingDateV = document.getElementById('pay-billingDate').value
                        || document.getElementById('pay-eventDate').value || '';
        var rawAmount    = Number(document.getElementById('pay-amount').value) || 0;
        var record = {
            category:    catVal,
            docType:     docTypeVal,
            eventName:   document.getElementById('pay-eventName').value.trim(),
            clientName:  document.getElementById('pay-clientName').value.trim(),
            eventId:     document.getElementById('pay-linked-eventId').value.trim(),
            eventDate:   document.getElementById('pay-eventDate').value,
            billingDate: billingDateV,
            concept:     document.getElementById('pay-concept').value.trim(),
            vendorName:  document.getElementById('pay-vendorName').value.trim(),
            docNumber:   document.getElementById('pay-docNumber').value.trim(),
            amount:      rawAmount,
            comments:    document.getElementById('pay-comments').value.trim(),
            status:      'pendiente'
        };
        var nominaVal = (document.getElementById('pay-nomina-date') || {}).value || '';
        if (nominaVal) record.nominaDate = nominaVal;
        try {
            if (editingId) {
                var existing = payables.find(function (p) { return p.id === editingId; });
                record.payments = existing ? (existing.payments || []) : [];
                if (existing && existing.nominaDate && !record.nominaDate) record.nominaDate = existing.nominaDate;
                await window.Mazelab.DataService.update('payables', editingId, record);
            } else {
                record.id = generateId();
                record.payments = [];
                await window.Mazelab.DataService.create('payables', record);
            }
            closeEditModal();
            await loadData();
            refreshView();
        } catch (err) { console.error('PayablesModule: Save error', err); alert('Error al guardar el costo.'); }
    }

    async function deletePayable(id) {
        if (!confirm('\u00bfEliminar este costo? Esta acci\u00f3n no se puede deshacer.')) return;
        try {
            await window.Mazelab.DataService.remove('payables', id);
            await loadData();
            refreshView();
        } catch (err) { console.error('PayablesModule: Delete error', err); }
    }

    // ── Bind table actions ─────────────────────────────────────────────

    function bindSortAndSearch() {
        var searchEl = document.getElementById('payables-search');
        if (searchEl && !searchEl._bound) {
            searchEl._bound = true;
            searchEl.addEventListener('input', function () {
                searchQuery = this.value.trim();
                refreshView();
                var el = document.getElementById('payables-search');
                if (el) { el.value = searchQuery; el.focus(); }
            });
        }
        document.querySelectorAll('#payables-list-table .payable-sort-th').forEach(function (th) {
            th.addEventListener('click', function () {
                var col = th.dataset.sort;
                if (sortCol === col) { sortDir = sortDir === 'asc' ? 'desc' : 'asc'; }
                else { sortCol = col; sortDir = 'asc'; }
                refreshView();
            });
        });
        // Column filter inputs — restaurar foco después del re-render con setTimeout
        document.querySelectorAll('#payables-list-table .pay-col-filter').forEach(function (input) {
            if (input._bound) return;
            input._bound = true;
            input.addEventListener('input', function () {
                var col    = this.dataset.col;
                var val    = this.value;
                var cursor = this.selectionStart;
                columnFilters[col] = val;
                refreshView();
                setTimeout(function () {
                    var el = document.querySelector('#payables-list-table .pay-col-filter[data-col="' + col + '"]');
                    if (el) { el.focus(); try { el.setSelectionRange(cursor, cursor); } catch(e){} }
                }, 0);
            });
        });

        // Botón limpiar filtros
        var clearBtn = document.getElementById('payables-clear-filters');
        if (clearBtn && !clearBtn._bound) {
            clearBtn._bound = true;
            clearBtn.addEventListener('click', function () {
                searchQuery = '';
                columnFilters = {};
                var searchEl2 = document.getElementById('payables-search');
                if (searchEl2) searchEl2.value = '';
                refreshView();
            });
        }
    }

    function bindTableActions() {
        bindSortAndSearch();
        document.querySelectorAll('.payable-edit').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var p = payables.find(function (x) { return String(x.id) === String(btn.dataset.id); });
                if (p) openEditModal(p);
            });
        });
        document.querySelectorAll('.payable-abonar').forEach(function (btn) {
            btn.addEventListener('click', function () { openAbonoModal(btn.dataset.id); });
        });
        document.querySelectorAll('.payable-delete').forEach(function (btn) {
            btn.addEventListener('click', function () { deletePayable(btn.dataset.id); });
        });
    }

    // ── Init ───────────────────────────────────────────────────────────

    async function init() {
        // Reset filter state on every navigation to this module
        showOnlyPending = true;
        currentCategory = 'todos';
        currentView = 'lista';
        searchQuery = '';
        columnFilters = {};

        await loadData();

        // ── DB MIGRATION STATUS ───────────────────────────────────────────
        // Schema: tabla 'costos' en PostgreSQL (Replit) / tabla 'payables' en Supabase
        // Campos: id, category, docType, eventName, clientName, eventId, eventDate,
        //         billingDate, concept, vendorName, docNumber, amount, comments, status,
        //         payments (JSONB array: [{id, amount, date, method, comment}])
        // CONVENCION DE MONTO (actualizado 2025-03-05):
        //   - amount = siempre lo que se transfiere al proveedor/trabajador (monto real de la transferencia)
        //   - BH:      amount = neto transferido; retención = amount * rate (pagada al SII por el empleador)
        //              costo total = amount + retención
        //   - Factura: amount = total con IVA (lo que se transfiere); neto = amount/1.19; IVA = amount - neto
        //   - Otros:   amount = monto directo
        console.log('[CXP] Loaded', payables.length, 'payables,', cachedSales.length, 'sales. Using Supabase:', window.Mazelab.DataService.isUsingSupabase());

        refreshView();

        // New record button
        var btnNew = document.getElementById('payables-btn-new');
        if (btnNew) btnNew.addEventListener('click', function () { openEditModal(null); });

        // Category toggle
        var catToggle = document.getElementById('payables-category-toggle');
        if (catToggle) {
            catToggle.querySelectorAll('.toggle-option').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    currentCategory = btn.dataset.cat;
                    catToggle.querySelectorAll('.toggle-option').forEach(function (b) { b.classList.toggle('active', b.dataset.cat === currentCategory); });
                    refreshView();
                });
            });
        }

        // View toggle
        var viewToggle = document.getElementById('payables-view-toggle');
        if (viewToggle) {
            viewToggle.querySelectorAll('.toggle-option').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    currentView = btn.dataset.view;
                    viewToggle.querySelectorAll('.toggle-option').forEach(function (b) { b.classList.toggle('active', b.dataset.view === currentView); });
                    refreshView();
                });
            });
        }

        // Pending filter toggle
        var pendingToggle = document.getElementById('payables-pending-toggle');
        if (pendingToggle) {
            pendingToggle.querySelectorAll('.toggle-option').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    showOnlyPending = btn.dataset.pending === 'true';
                    pendingToggle.querySelectorAll('.toggle-option').forEach(function (b) {
                        b.classList.toggle('active', b.dataset.pending === String(showOnlyPending));
                    });
                    refreshView();
                });
            });
        }

        // Cascade: category change in form
        var payCatSel = document.getElementById('pay-category');
        if (payCatSel) {
            payCatSel.addEventListener('change', function () {
                updatePayCategoryUI();
                if (this.value === 'evento') populatePayClientDropdown();
                // Clear resolved fields on category switch
                var hidEvent = document.getElementById('pay-eventName');
                var hidClient = document.getElementById('pay-clientName');
                var hidLinked = document.getElementById('pay-linked-eventId');
                if (hidEvent)  hidEvent.value  = '';
                if (hidClient) hidClient.value = '';
                if (hidLinked) hidLinked.value = '';
            });
        }

        // Cascade: client selection → populate events
        var payClientSel = document.getElementById('pay-clientSelect');
        if (payClientSel) {
            payClientSel.addEventListener('change', function () {
                var hidEvent = document.getElementById('pay-eventName');
                var hidClient = document.getElementById('pay-clientName');
                var hidLinked = document.getElementById('pay-linked-eventId');
                if (hidEvent)  hidEvent.value  = '';
                if (hidClient) hidClient.value = '';
                if (hidLinked) hidLinked.value = '';
                populatePayEventDropdown(this.value);
            });
        }

        // Cascade: event selection → fill hidden fields
        var payEventSel = document.getElementById('pay-eventSelect');
        if (payEventSel) {
            payEventSel.addEventListener('change', function () { applyPayEventSelection(); });
        }

        // General description text → keep hidden field in sync
        var payGeneralText = document.getElementById('pay-eventName-text');
        if (payGeneralText) {
            payGeneralText.addEventListener('input', function () {
                var hidEvent = document.getElementById('pay-eventName');
                if (hidEvent) hidEvent.value = this.value;
            });
        }

        // ID search → auto-select client + event
        var payIdSearch = document.getElementById('pay-id-search');
        if (payIdSearch) {
            payIdSearch.addEventListener('input', function () {
                var q = this.value.trim();
                if (!q) return;
                var found = cachedSales.find(function (s) {
                    return String(s.sourceId || '') === q || String(s.id || '') === q;
                });
                if (found) {
                    populatePayClientDropdown();
                    var clientSel = document.getElementById('pay-clientSelect');
                    if (clientSel) clientSel.value = found.clientName || '';
                    populatePayEventDropdown(found.clientName || '');
                    var eventSel = document.getElementById('pay-eventSelect');
                    if (eventSel) {
                        eventSel.value = found.id;
                        applyPayEventSelection();
                    }
                    // Visual feedback
                    this.style.borderColor = 'var(--success)';
                } else {
                    this.style.borderColor = q.length >= 2 ? 'var(--danger)' : '';
                }
            });
        }

        // Edit modal events
        var el;
        el = document.getElementById('payable-modal-close'); if (el) el.addEventListener('click', closeEditModal);
        el = document.getElementById('payable-cancel');       if (el) el.addEventListener('click', closeEditModal);
        el = document.getElementById('payable-modal');        if (el) el.addEventListener('click', function (e) { if (e.target === el) closeEditModal(); });
        el = document.getElementById('payable-form');         if (el) el.addEventListener('submit', handleSave);

        // Abono modal events
        el = document.getElementById('abono-close');              if (el) el.addEventListener('click', closeAbonoModal);
        el = document.getElementById('abono-cancel');             if (el) el.addEventListener('click', closeAbonoModal);
        el = document.getElementById('payable-abono-modal');      if (el) el.addEventListener('click', function (e) { if (e.target === el) closeAbonoModal(); });
        el = document.getElementById('abono-form');               if (el) el.addEventListener('submit', handleAbonoSave);
    }

    return { render: render, init: init };

})();
