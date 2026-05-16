/**
 * CXC Kanban — accounts receivable kanban board
 * Columns: Por Cobrar | En Gestion | Cobrada | Vencida
 */
window.Mazelab = window.Mazelab || {};
window.Mazelab.Modules = window.Mazelab.Modules || {};

window.Mazelab.Modules.CxcKanbanModule = (function () {
    'use strict';

    // ── state ────────────────────────────────────────────────────────────
    var receivables = [];
    var cachedSales = [];
    var dragItemId = null;
    var filterClient = '';
    var filterStatus = '';

    var COLUMNS = [
        { id: 'por_cobrar',  label: 'Por Cobrar',  color: 'var(--info)',    dataCol: '1' },
        { id: 'en_gestion',  label: 'En Gesti\u00f3n', color: 'var(--warning)', dataCol: '2' },
        { id: 'cobrada',     label: 'Cobrada',      color: 'var(--success)', dataCol: '3' },
        { id: 'vencida',     label: 'Vencida',      color: 'var(--danger)',  dataCol: '4' }
    ];

    // ── helpers ──────────────────────────────────────────────────────────
    function formatCLP(n) {
        n = Math.round(Number(n) || 0);
        if (n < 0) return '-$' + String(-n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return '$' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function parseDate(str) {
        if (!str) return null;
        var d = window.MazelabDates.parseLocalDate(str);
        return d && !isNaN(d.getTime()) ? d : null;
    }

    function formatDate(str) {
        var d = parseDate(str);
        if (!d) return '\u2014';
        return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    // ── column assignment ────────────────────────────────────────────────
    function getColumn(r) {
        var st = (r.status || '').toLowerCase();

        // Manually set en_gestion always respected
        if (st === 'en_gestion') return 'en_gestion';

        // Paid
        if (st === 'pagada' || st === 'pagado') return 'cobrada';

        // Anulada / NC — skip
        if (st === 'anulada' || (r.tipoDoc || '').toUpperCase() === 'NC') return null;

        // Check overdue
        var monto = getMontoTotal(r);
        var pagado = getTotalPagado(r);
        if (pagado >= monto && monto > 0) return 'cobrada';

        var baseStr = r.billingMonth || r.eventDate;
        var base = parseDate(baseStr);
        if (base) {
            var diffDays = Math.floor((new Date() - base) / 86400000);
            var terms = Number(r.paymentTerms) || 30;
            if (diffDays - terms > 0) return 'vencida';
        }

        // Default: por cobrar
        return 'por_cobrar';
    }

    function getMontoTotal(r) {
        var neto = Number(r.montoFacturado || r.montoNeto || r.invoicedAmount || r.amount || 0);
        if ((r.tipoDoc || '').toUpperCase() === 'E') return neto;
        return neto > 0 ? Math.round(neto * 1.19) : 0;
    }

    function getTotalPagado(r) {
        if (r.payments && Array.isArray(r.payments)) {
            return r.payments.reduce(function (s, p) { return s + (Number(p.amount) || 0); }, 0);
        }
        return Number(r.amountPaid) || 0;
    }

    function getOverdueDays(r) {
        var baseStr = r.billingMonth || r.eventDate;
        var base = parseDate(baseStr);
        if (!base) return 0;
        var diffDays = Math.floor((new Date() - base) / 86400000);
        var terms = Number(r.paymentTerms) || 30;
        return Math.max(0, diffDays - terms);
    }

    // ── render loading state ─────────────────────────────────────────────
    function render() {
        return '' +
            '<div class="content-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">' +
                '<h2>Kanban de Cobranza</h2>' +
                '<div style="display:flex;gap:8px;align-items:center;">' +
                    '<input type="text" id="cxc-kb-filter-client" class="form-control" placeholder="Filtrar cliente..." style="width:200px;font-size:12px;padding:6px 10px;" />' +
                '</div>' +
            '</div>' +
            '<div class="content-body" id="cxc-kanban-body">' +
                '<div class="empty-state"><p>Cargando cobranza...</p></div>' +
            '</div>';
    }

    // ── build board ──────────────────────────────────────────────────────
    function buildBoard() {
        // Enrich receivables with sale info
        var salesMap = {};
        cachedSales.forEach(function (s) {
            salesMap[String(s.id)] = s;
            if (s.sourceId) salesMap[String(s.sourceId)] = s;
        });

        // Assign to columns
        var cols = {};
        COLUMNS.forEach(function (c) { cols[c.id] = []; });

        var filtered = receivables;
        if (filterClient) {
            var q = filterClient.toLowerCase();
            filtered = receivables.filter(function (r) {
                return (r.clientName || '').toLowerCase().indexOf(q) !== -1;
            });
        }

        filtered.forEach(function (r) {
            var col = getColumn(r);
            if (col && cols[col]) {
                // Enrich with sale data
                var sale = salesMap[String(r.saleId || r.eventId || '')] || {};
                r._clientName = r.clientName || sale.clientName || 'Sin cliente';
                r._eventName = r.eventName || sale.eventName || '';
                r._eventDate = r.eventDate || sale.eventDate || '';
                r._montoTotal = getMontoTotal(r);
                r._pagado = getTotalPagado(r);
                r._pendiente = Math.max(0, r._montoTotal - r._pagado);
                r._overdueDays = getOverdueDays(r);
                cols[col].push(r);
            }
        });

        // Sort: vencida by overdue desc, others by date
        cols.vencida.sort(function (a, b) { return b._overdueDays - a._overdueDays; });
        cols.por_cobrar.sort(function (a, b) {
            var da = a._eventDate ? window.MazelabDates.parseLocalDate(a._eventDate) : new Date(0);
            var db = b._eventDate ? window.MazelabDates.parseLocalDate(b._eventDate) : new Date(0);
            return da - db;
        });

        // Build HTML
        var html = '<div class="kanban-board cxc-kanban-board">';
        COLUMNS.forEach(function (col) {
            var items = cols[col.id];
            var totalPendiente = items.reduce(function (s, r) { return s + r._pendiente; }, 0);
            html += '<div class="kanban-column" data-col="' + col.dataCol + '" data-col-id="' + col.id + '">';
            html += '<div class="kanban-col-header">' +
                '<span class="kanban-col-title">' + col.label + '</span>' +
                '<div style="display:flex;align-items:center;gap:8px;">' +
                    '<span style="font-size:11px;color:var(--text-secondary);">' + formatCLP(totalPendiente) + '</span>' +
                    '<span class="kanban-col-count">' + items.length + '</span>' +
                '</div>' +
            '</div>';
            html += '<div class="kanban-col-body" data-col-id="' + col.id + '">';

            items.forEach(function (r) {
                var id = r.id || r.sourceId || '';
                var overdueBadge = '';
                if (col.id === 'vencida' && r._overdueDays > 0) {
                    var badgeClass = r._overdueDays > 60 ? 'badge-danger' : 'badge-warning';
                    overdueBadge = '<span class="badge ' + badgeClass + '" style="font-size:10px;">' + r._overdueDays + 'd</span>';
                }
                var docInfo = '';
                if (r.tipoDoc) docInfo += r.tipoDoc;
                if (r.numDoc || r.invoiceNumber) docInfo += ' #' + (r.numDoc || r.invoiceNumber);

                var progressPct = r._montoTotal > 0 ? Math.min(100, Math.round(r._pagado / r._montoTotal * 100)) : 0;
                var progressBar = '';
                if (col.id !== 'cobrada') {
                    progressBar = '<div style="height:3px;background:rgba(255,255,255,0.08);border-radius:2px;margin-top:8px;">' +
                        '<div style="height:100%;width:' + progressPct + '%;background:' + (progressPct >= 100 ? 'var(--success)' : 'var(--accent-primary)') + ';border-radius:2px;"></div>' +
                    '</div>';
                }

                html += '<div class="kanban-card cxc-kb-card" draggable="true" data-id="' + id + '">' +
                    '<div style="display:flex;justify-content:space-between;align-items:start;gap:6px;">' +
                        '<strong style="font-size:13px;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(r._clientName) + '</strong>' +
                        overdueBadge +
                    '</div>' +
                    (r._eventName ? '<div style="font-size:11px;color:var(--text-secondary);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(r._eventName) + '</div>' : '') +
                    '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;">' +
                        '<span style="font-size:14px;font-weight:700;color:var(--text-primary);font-variant-numeric:tabular-nums;">' + formatCLP(r._pendiente) + '</span>' +
                        '<span style="font-size:10px;color:var(--text-muted);">' + formatDate(r._eventDate) + '</span>' +
                    '</div>' +
                    (docInfo ? '<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">' + escapeHtml(docInfo) + '</div>' : '') +
                    progressBar +
                '</div>';
            });

            html += '</div></div>'; // col-body + column
        });
        html += '</div>';

        // Summary bar
        var totalAll = receivables.reduce(function (s, r) {
            var col = getColumn(r);
            if (!col || col === 'cobrada') return s;
            return s + Math.max(0, getMontoTotal(r) - getTotalPagado(r));
        }, 0);
        var totalVencida = cols.vencida.reduce(function (s, r) { return s + r._pendiente; }, 0);

        var summary = '<div style="display:flex;gap:var(--space-lg);margin-bottom:var(--space-md);flex-wrap:wrap;">' +
            '<div class="kpi-card" style="flex:1;min-width:160px;"><div class="kpi-label">Total Pendiente</div><div class="kpi-value text-warning">' + formatCLP(totalAll) + '</div></div>' +
            '<div class="kpi-card" style="flex:1;min-width:160px;"><div class="kpi-label">Total Vencido</div><div class="kpi-value text-danger">' + formatCLP(totalVencida) + '</div></div>' +
            '<div class="kpi-card" style="flex:1;min-width:160px;"><div class="kpi-label">En Gesti\u00f3n</div><div class="kpi-value">' + cols.en_gestion.length + '</div></div>' +
            '<div class="kpi-card" style="flex:1;min-width:160px;"><div class="kpi-label">Cobradas</div><div class="kpi-value text-success">' + cols.cobrada.length + '</div></div>' +
        '</div>';

        return summary + html;
    }

    // ── drag and drop ────────────────────────────────────────────────────
    function bindDragEvents() {
        var body = document.getElementById('cxc-kanban-body');
        if (!body) return;

        body.addEventListener('dragstart', function (e) {
            var card = e.target.closest('.cxc-kb-card');
            if (!card) return;
            dragItemId = card.dataset.id;
            card.style.opacity = '0.4';
            e.dataTransfer.effectAllowed = 'move';
        });

        body.addEventListener('dragend', function (e) {
            var card = e.target.closest('.cxc-kb-card');
            if (card) card.style.opacity = '1';
            dragItemId = null;
            // Remove all drag-over highlights
            body.querySelectorAll('.kanban-col-body').forEach(function (el) {
                el.style.background = '';
            });
        });

        body.addEventListener('dragover', function (e) {
            var colBody = e.target.closest('.kanban-col-body');
            if (!colBody) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            colBody.style.background = 'rgba(139, 92, 246, 0.08)';
        });

        body.addEventListener('dragleave', function (e) {
            var colBody = e.target.closest('.kanban-col-body');
            if (colBody) colBody.style.background = '';
        });

        body.addEventListener('drop', function (e) {
            e.preventDefault();
            var colBody = e.target.closest('.kanban-col-body');
            if (!colBody || !dragItemId) return;
            colBody.style.background = '';

            var targetCol = colBody.dataset.colId;
            if (!targetCol) return;

            // Map column to status
            var statusMap = {
                por_cobrar: 'pendiente_pago',
                en_gestion: 'en_gestion',
                cobrada: 'pagada',
                vencida: null // can't drag INTO vencida
            };

            if (targetCol === 'vencida') return; // disallow dragging to vencida

            var newStatus = statusMap[targetCol];
            if (!newStatus) return;

            // Find the receivable and update
            var rec = receivables.find(function (r) { return String(r.id || r.sourceId) === String(dragItemId); });
            if (!rec) return;

            rec.status = newStatus;
            // Persist
            var DS = window.Mazelab.DataService;
            if (DS) {
                DS.update('receivables', rec.id, { status: newStatus }).then(function () {
                    refreshBoard();
                }).catch(function (err) {
                    console.error('CXC Kanban: update failed', err);
                    refreshBoard(); // re-render even on failure
                });
            } else {
                refreshBoard();
            }
        });
    }

    function refreshBoard() {
        var body = document.getElementById('cxc-kanban-body');
        if (body) body.innerHTML = buildBoard();
    }

    // ── init ─────────────────────────────────────────────────────────────
    async function init() {
        try {
            var DS = window.Mazelab.DataService;
            var results = await Promise.all([
                DS.getAll('receivables'),
                DS.getAll('sales')
            ]);
            receivables = results[0] || [];
            cachedSales = results[1] || [];

            refreshBoard();
            bindDragEvents();

            // Filter binding
            var filterInput = document.getElementById('cxc-kb-filter-client');
            if (filterInput) {
                filterInput.addEventListener('input', function () {
                    filterClient = this.value.trim();
                    refreshBoard();
                });
            }
        } catch (err) {
            console.error('CXC Kanban init error:', err);
            var body = document.getElementById('cxc-kanban-body');
            if (body) body.innerHTML = '<div class="empty-state"><p class="text-danger">Error al cargar datos.</p><p class="text-muted">' + (err.message || err) + '</p></div>';
        }
    }

    return { render: render, init: init };
})();
