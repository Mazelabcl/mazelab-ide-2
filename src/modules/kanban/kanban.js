window.Mazelab = window.Mazelab || {};
window.Mazelab.Modules = window.Mazelab.Modules || {};

window.Mazelab.Modules.KanbanModule = (function () {

    // ---- state ----
    var sales = [], receivables = [], payables = [], clients = [], services = [], staff = [];
    var currentSaleId = null;     // null = board view, string = detail view
    var activeTab = 'info';       // info | finanzas | checklist | notas
    var dragSaleId = null;

    // filters
    var filters = { client: '', service: '', seller: '', financial: '', operational: '' };

    var COLUMNS = [
        { id: 1, title: 'Confirmado \u2013 Pendiente de Gesti\u00f3n' },
        { id: 2, title: 'En Coordinaci\u00f3n' },
        { id: 3, title: 'Listo para Ejecuci\u00f3n' },
        { id: 4, title: 'Ejecutado \u2013 Pendiente Cierre' }
    ];

    var DEFAULT_CHECKLIST = [
        { key: 'contacto_inicial',      label: 'Contacto inicial con cliente',    group: 'Pre-evento' },
        { key: 'diseno_solicitado',     label: 'Dise\u00f1o solicitado',                   group: 'Pre-evento' },
        { key: 'diseno_enviado',        label: 'Dise\u00f1o enviado al cliente',           group: 'Pre-evento' },
        { key: 'diseno_aprobado',       label: 'Dise\u00f1o aprobado por cliente',         group: 'Pre-evento' },
        { key: 'logistica_confirmada',  label: 'Log\u00edstica confirmada',                group: 'Pre-evento' },
        { key: 'equipo_asignado',       label: 'Equipo asignado',                 group: 'Pre-evento' },
        { key: 'freelance_confirmados', label: 'Freelancers confirmados',         group: 'Pre-evento' },
        { key: 'montaje_realizado',     label: 'Montaje realizado',               group: 'D\u00eda del evento' },
        { key: 'foto_montaje',          label: 'Foto montaje enviada',            group: 'D\u00eda del evento' },
        { key: 'evento_ejecutado',      label: 'Evento ejecutado sin incidentes', group: 'D\u00eda del evento' },
        { key: 'desmontaje_correcto',   label: 'Desmontaje correcto',             group: 'Post-evento' },
        { key: 'material_respaldado',   label: 'Material respaldado',             group: 'Post-evento' },
        { key: 'informe_interno',       label: 'Informe interno completado',      group: 'Post-evento' }
    ];

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

    function formatShortDate(d) {
        if (!d) return '';
        var dt = new Date(d);
        if (isNaN(dt)) return '';
        return dt.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' });
    }

    function todayStr() {
        return new Date().toISOString().slice(0, 10);
    }

    // ---- financial linking (copied from events.js) ----

    function getEventCXC(sale) {
        var sid = String(sale.id || '');
        var sourceId = String(sale.sourceId || '');
        var name = (sale.eventName || '').trim().toLowerCase();
        var client = (sale.clientName || '').trim().toLowerCase();
        // Year extracted from eventDate to narrow fallback matches
        var saleYear = (sale.eventDate || '').slice(0, 4);

        return receivables.filter(function (r) {
            // 1. Primary: direct saleId match (most precise, always wins)
            if (r.saleId) {
                return String(r.saleId) === sid || (sourceId && String(r.saleId) === sourceId);
            }
            // 2. Fallback for records without saleId (imported historical data):
            //    require eventName + clientName + same year to avoid cross-event pollution
            if (!name || !client) return false;
            var rName = (r.eventName || '').trim().toLowerCase();
            var rClient = (r.clientName || '').trim().toLowerCase();
            if (rName !== name || rClient !== client) return false;
            // Require same year when we have it (prevents recurring service name collisions)
            if (saleYear) {
                var rYear = (r.eventDate || r.billingMonth || '').slice(0, 4);
                if (rYear && rYear !== saleYear) return false;
            }
            return true;
        });
    }

    function getEventCXP(sale) {
        var eid = String(sale.sourceId || sale.id || '');
        if (!eid) return [];
        return payables.filter(function (p) {
            return String(p.eventId || '') === eid;
        });
    }

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

    // ---- operational status ----

    function getChecklistProgress(sale) {
        var cl = sale.checklist || [];
        if (!cl.length) return { done: 0, total: DEFAULT_CHECKLIST.length, pct: 0 };
        var done = cl.filter(function (c) { return c.checked; }).length;
        return { done: done, total: cl.length, pct: cl.length > 0 ? done / cl.length : 0 };
    }

    function getOperationalStatus(sale) {
        var prog = getChecklistProgress(sale);
        if (prog.pct >= 0.9999) return 'completo';
        if (prog.pct > 0) return 'en_progreso';
        return 'sin_iniciar';
    }

    // ---- visual indicator ----

    function getCardIndicator(sale) {
        var eventDate = sale.eventDate;
        if (!eventDate) return { icon: '\u26aa', cls: '' };
        var today = new Date(todayStr());
        var evDate = new Date(eventDate);
        var diffDays = Math.ceil((evDate - today) / (1000 * 60 * 60 * 24));
        var finSt = getFinancialStatus(sale);
        var prog = getChecklistProgress(sale);

        // Past event not closed
        if (diffDays < 0 && finSt !== 'liquidado') return { icon: '\ud83d\udd34', cls: 'text-danger' };
        // Event within 7 days, checklist < 70%
        if (diffDays >= 0 && diffDays <= 7 && prog.pct < 0.7) return { icon: '\ud83d\udfe1', cls: 'text-warning' };
        // Event > 7 days or checklist ok
        if (prog.pct >= 0.7 || diffDays > 7) return { icon: '\ud83d\udfe2', cls: 'text-success' };
        return { icon: '\u26aa', cls: '' };
    }

    // ---- migration logic ----

    async function runMigration() {
        var DS = window.Mazelab.DataService;
        var today = todayStr();
        var needsUpdate = [];

        sales.forEach(function (s) {
            if (s.boardColumn !== undefined && s.boardColumn !== null) return; // already migrated

            var col = 1;
            var eventDate = s.eventDate || '';

            if (eventDate && eventDate < today) {
                // past event: check financial status
                var finSt = getFinancialStatus(s);
                col = (finSt === 'liquidado') ? 0 : 4;
            }
            // future event → col 1

            needsUpdate.push({
                id: s.id,
                boardColumn: col,
                boardOrder: new Date(s.eventDate || today).getTime(),
                checklist: DEFAULT_CHECKLIST.map(function (item) {
                    return { key: item.key, label: item.label, group: item.group, checked: false, checkedAt: null };
                }),
                encargado: '',
                kanbanNotes: ''
            });
        });

        for (var i = 0; i < needsUpdate.length; i++) {
            var u = needsUpdate[i];
            try {
                await DS.update('sales', u.id, {
                    boardColumn: u.boardColumn,
                    boardOrder: u.boardOrder,
                    checklist: u.checklist,
                    encargado: u.encargado,
                    kanbanNotes: u.kanbanNotes
                });
            } catch (e) {
                // DB columns may not exist yet — update local state anyway
                console.warn('KanbanModule: migration failed for sale', u.id, '(columns may need adding to ventas table)');
            }
            // Always update in-memory so the board renders correctly this session
            var sale = sales.find(function (s) { return String(s.id) === String(u.id); });
            if (sale) {
                sale.boardColumn = u.boardColumn;
                sale.boardOrder = u.boardOrder;
                sale.checklist = u.checklist;
                sale.encargado = u.encargado;
                sale.kanbanNotes = u.kanbanNotes;
            }
        }
    }

    // ---- move sale ----

    async function moveSaleToColumn(saleId, newCol) {
        var DS = window.Mazelab.DataService;
        var sale = sales.find(function (s) { return String(s.id) === String(saleId); });
        if (!sale) return;
        sale.boardColumn = newCol;
        sale.boardOrder = Date.now();
        await DS.update('sales', saleId, { boardColumn: newCol, boardOrder: sale.boardOrder });
        refreshContent();
    }

    // ---- auto-move rules ----

    function checkAutoMove(sale) {
        var cl = sale.checklist || [];
        function isChecked(key) {
            var item = cl.find(function (c) { return c.key === key; });
            return item && item.checked;
        }

        // Rule: contacto + diseno_aprobado + logistica_confirmada → suggest col 3
        if (sale.boardColumn === 2 &&
            isChecked('contacto_inicial') &&
            isChecked('diseno_aprobado') &&
            isChecked('logistica_confirmada')) {
            return { targetCol: 3, message: 'Coordinaci\u00f3n completa. \u00bfMover a "Listo para Ejecuci\u00f3n"?' };
        }

        // Rule: evento_ejecutado → auto-move to col 4
        if (sale.boardColumn < 4 && isChecked('evento_ejecutado')) {
            return { targetCol: 4, message: 'Evento ejecutado. Moviendo a "Pendiente Cierre".' };
        }

        return null;
    }

    // ---- filtering ----

    function getFilteredSales() {
        return sales.filter(function (s) {
            var col = Number(s.boardColumn);
            if (!col || col < 1 || col > 4) return false; // off-board

            if (filters.client && (s.clientName || '') !== filters.client) return false;
            if (filters.seller && (s.staffName || '') !== filters.seller) return false;

            if (filters.service) {
                var svcIds = s.serviceIds || [];
                var svc = services.find(function (sv) { return sv.name === filters.service; });
                if (!svc || svcIds.indexOf(String(svc.id)) === -1) return false;
            }

            if (filters.financial && getFinancialStatus(s) !== filters.financial) return false;

            if (filters.operational) {
                var opSt = getOperationalStatus(s);
                if (opSt !== filters.operational) return false;
            }

            return true;
        });
    }

    function getSalesForColumn(colId) {
        return getFilteredSales().filter(function (s) {
            return Number(s.boardColumn) === colId;
        }).sort(function (a, b) {
            return (a.boardOrder || 0) - (b.boardOrder || 0);
        });
    }

    // ---- unique values for filter dropdowns ----

    function getUniqueValues(field) {
        var vals = {};
        sales.forEach(function (s) {
            var v = s[field];
            if (v && typeof v === 'string') vals[v] = true;
        });
        return Object.keys(vals).sort();
    }

    // ---- render: filter bar ----

    function renderFilters() {
        var clientOpts = getUniqueValues('clientName').map(function (c) {
            return '<option value="' + c + '"' + (filters.client === c ? ' selected' : '') + '>' + c + '</option>';
        }).join('');

        var sellerOpts = getUniqueValues('staffName').map(function (s) {
            return '<option value="' + s + '"' + (filters.seller === s ? ' selected' : '') + '>' + s + '</option>';
        }).join('');

        var svcNames = [];
        services.forEach(function (sv) { if (sv.name) svcNames.push(sv.name); });
        svcNames.sort();
        var svcOpts = svcNames.map(function (n) {
            return '<option value="' + n + '"' + (filters.service === n ? ' selected' : '') + '>' + n + '</option>';
        }).join('');

        var finOpts = ['liquidado', 'cobros', 'pagos', 'abierto'].map(function (f) {
            return '<option value="' + f + '"' + (filters.financial === f ? ' selected' : '') + '>' + STATUS_META[f].label + '</option>';
        }).join('');

        var opOpts = [
            { v: 'sin_iniciar', l: 'Sin iniciar' },
            { v: 'en_progreso', l: 'En progreso' },
            { v: 'completo', l: 'Completo' }
        ].map(function (o) {
            return '<option value="' + o.v + '"' + (filters.operational === o.v ? ' selected' : '') + '>' + o.l + '</option>';
        }).join('');

        var hasFilter = filters.client || filters.seller || filters.service || filters.financial || filters.operational;

        return '<div class="kanban-filters">' +
            '<span class="kanban-filter-label">Filtros:</span>' +
            '<select class="form-control kb-filter" data-filter="client"><option value="">Cliente</option>' + clientOpts + '</select>' +
            '<select class="form-control kb-filter" data-filter="service"><option value="">Servicio</option>' + svcOpts + '</select>' +
            '<select class="form-control kb-filter" data-filter="seller"><option value="">Vendedor</option>' + sellerOpts + '</select>' +
            '<select class="form-control kb-filter" data-filter="financial"><option value="">Estado financiero</option>' + finOpts + '</select>' +
            '<select class="form-control kb-filter" data-filter="operational"><option value="">Estado operativo</option>' + opOpts + '</select>' +
            (hasFilter ? '<button class="kanban-filter-clear" id="kb-clear-filters">Limpiar filtros</button>' : '') +
            '</div>';
    }

    // ---- render: card ----

    function renderCard(sale) {
        var displayId = sale.sourceId || String(sale.id || '').slice(-6);
        var indicator = getCardIndicator(sale);
        var amount = Number(sale.amount || 0);
        var cxcList = getEventCXC(sale);
        var cxpList = getEventCXP(sale);
        var cxcS = getCXCSummary(cxcList);
        var cxpS = getCXPSummary(cxpList);
        var col = Number(sale.boardColumn);
        var prog = getChecklistProgress(sale);

        var facPct = cxcS.pct !== null ? Math.round(cxcS.pct * 100) + '%' : '-';
        var pagPct = cxpS.pct !== null ? Math.round(cxpS.pct * 100) + '%' : '-';

        var progColor = prog.pct >= 0.7 ? 'var(--success)' : (prog.pct > 0.3 ? 'var(--warning)' : 'var(--danger)');

        return '<div class="kanban-card" draggable="true" data-sale-id="' + sale.id + '">' +
            '<div class="kanban-card-top">' +
                '<span class="kanban-card-id">#' + displayId + '</span>' +
                '<span class="kanban-card-indicator">' + indicator.icon + '</span>' +
            '</div>' +
            '<div class="kanban-card-title">' + (sale.eventName || '-') + '</div>' +
            '<div class="kanban-card-client">' + (sale.clientName || '-') + '</div>' +
            (sale.serviceNames ? '<div class="kanban-card-services">' + sale.serviceNames + '</div>' : '') +
            '<div class="kanban-card-meta">' +
                '<span class="kanban-card-date">' + formatDate(sale.eventDate) + '</span>' +
                '<span class="kanban-card-amount">' + formatCLP(amount) + '</span>' +
            '</div>' +
            '<div class="kanban-card-footer">' +
                '<div class="kanban-card-badges">' +
                    '<span class="badge badge-info" title="Facturado">' + facPct + ' fac</span>' +
                    '<span class="badge badge-neutral" title="Pagado CXP">' + pagPct + ' pag</span>' +
                '</div>' +
                '<div class="kanban-card-arrows">' +
                    '<button class="kb-arrow-left" data-sale-id="' + sale.id + '" data-dir="left"' + (col <= 1 ? ' disabled' : '') + ' title="Mover izquierda">\u2190</button>' +
                    '<button class="kb-arrow-right" data-sale-id="' + sale.id + '" data-dir="right"' + (col >= 4 ? ' disabled' : '') + ' title="Mover derecha">\u2192</button>' +
                '</div>' +
            '</div>' +
            '<div class="kanban-card-progress">' +
                '<div class="kanban-card-progress-bar" style="width:' + Math.round(prog.pct * 100) + '%;background:' + progColor + '"></div>' +
            '</div>' +
            '</div>';
    }

    // ---- render: board ----

    function renderBoard() {
        var cols = COLUMNS.map(function (col) {
            var colSales = getSalesForColumn(col.id);
            var cards = colSales.length > 0
                ? colSales.map(renderCard).join('')
                : '<div class="kanban-col-empty">Sin eventos</div>';
            return '<div class="kanban-column" data-col="' + col.id + '">' +
                '<div class="kanban-col-header">' +
                    '<span class="kanban-col-title">' + col.title + '</span>' +
                    '<span class="kanban-col-count">' + colSales.length + '</span>' +
                '</div>' +
                '<div class="kanban-col-body">' + cards + '</div>' +
                '</div>';
        }).join('');

        return renderFilters() + '<div class="kanban-board">' + cols + '</div>';
    }

    // ---- render: detail - info general ----

    function renderDetailInfo(sale) {
        var cxcList = getEventCXC(sale);
        var cxpList = getEventCXP(sale);
        var cxc = getCXCSummary(cxcList);
        var cxp = getCXPSummary(cxpList);
        var amount = Number(sale.amount || 0);
        var totalCost = cxp.totalAmount;
        var margin = amount - totalCost;
        var marginPct = amount > 0 ? (margin / amount) * 100 : null;

        return '<div class="kpi-grid" style="margin-bottom:var(--space-xl)">' +
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
        '</div>' +
        '<div class="card">' +
            '<div class="card-header"><span class="card-title">Datos del Evento</span></div>' +
            '<table class="data-table"><tbody>' +
                '<tr><td style="color:var(--text-secondary);width:140px">Cliente</td><td>' + (sale.clientName || '-') + '</td></tr>' +
                '<tr><td style="color:var(--text-secondary)">Vendedor</td><td>' + (sale.staffName || '-') + '</td></tr>' +
                '<tr><td style="color:var(--text-secondary)">Fecha evento</td><td>' + formatDate(sale.eventDate) + '</td></tr>' +
                '<tr><td style="color:var(--text-secondary)">Servicios</td><td>' + (sale.serviceNames || '-') + '</td></tr>' +
                '<tr><td style="color:var(--text-secondary)">Encargado</td><td>' + (sale.encargado || '<span style="color:var(--text-muted)">No asignado</span>') + '</td></tr>' +
                '<tr><td style="color:var(--text-secondary)">Columna</td><td>' + (COLUMNS.find(function (c) { return c.id === Number(sale.boardColumn); }) || {}).title + '</td></tr>' +
            '</tbody></table>' +
        '</div>';
    }

    // ---- render: detail - finanzas ----

    function renderDetailFinanzas(sale) {
        var cxcList = getEventCXC(sale);
        var cxpList = getEventCXP(sale);
        var cxc = getCXCSummary(cxcList);
        var cxp = getCXPSummary(cxpList);

        // CXC table
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
                '<span class="card-title">CXC \u2014 Cuentas por Cobrar</span>' +
                '<span class="badge badge-info">' + formatCLP(cxc.totalPaid) + ' cobrado de ' + formatCLP(cxc.totalOwed) + '</span>' +
            '</div>' +
            '<table class="data-table"><thead><tr>' +
                '<th>Documento</th><th>Mes emisi\u00f3n</th><th class="text-right">Total</th>' +
                '<th class="text-right">Cobrado</th><th class="text-right">Pendiente</th><th>Estado</th>' +
            '</tr></thead><tbody>' + cxcRows + '</tbody></table></div>';

        // CXP table
        var cxpRows = '';
        if (cxpList.length === 0) {
            cxpRows = '<tr><td colspan="6" style="text-align:center;padding:12px;color:var(--text-muted)">Sin costos CXP registrados</td></tr>';
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
                '<span class="card-title">CXP \u2014 Costos del Evento</span>' +
                '<span class="badge badge-danger">' + formatCLP(cxp.totalPaid) + ' pagado de ' + formatCLP(cxp.totalAmount) + '</span>' +
            '</div>' +
            '<table class="data-table"><thead><tr>' +
                '<th>Proveedor</th><th>Concepto</th><th>Tipo Doc</th>' +
                '<th class="text-right">Monto</th><th class="text-right">Pagado</th><th>Estado</th>' +
            '</tr></thead><tbody>' + cxpRows + '</tbody></table></div>';

        return cxcBlock + cxpBlock;
    }

    // ---- render: detail - checklist ----

    function renderDetailChecklist(sale) {
        var cl = sale.checklist || [];
        var groups = {};
        cl.forEach(function (item) {
            var g = item.group || 'Otros';
            if (!groups[g]) groups[g] = [];
            groups[g].push(item);
        });

        var suggestion = checkAutoMove(sale);
        var suggestionHTML = '';
        if (suggestion) {
            suggestionHTML = '<div class="kanban-suggestion">' +
                '<span>' + suggestion.message + '</span>' +
                '<button class="btn btn-sm btn-primary" id="kb-accept-move" data-target="' + suggestion.targetCol + '">Mover</button>' +
                '</div>';
        }

        var encargadoHTML = '<div class="checklist-encargado">' +
            '<label>Encargado del evento</label>' +
            '<input type="text" class="form-control" id="kb-encargado" value="' + (sale.encargado || '') + '" placeholder="Nombre del encargado...">' +
            '</div>';

        var groupsHTML = '';
        var groupOrder = ['Pre-evento', 'D\u00eda del evento', 'Post-evento', 'Otros'];
        groupOrder.forEach(function (gName) {
            var items = groups[gName];
            if (!items || items.length === 0) return;
            var itemsHTML = items.map(function (item) {
                var checkedClass = item.checked ? ' checked' : '';
                var dateStr = item.checkedAt ? formatShortDate(item.checkedAt) : '';
                return '<div class="checklist-item' + checkedClass + '">' +
                    '<div>' + 
                    '<input type="checkbox" id="cl-' + item.key + '"' + (item.checked ? ' checked' : '') + ' data-key="' + item.key + '">' +
                    '<label for="cl-' + item.key + '">' + item.label + '</label>' +
                    '</div>' + 
                    (dateStr ? '<span class="checklist-date">' + dateStr + '</span>' : '') +
                    '</div>';
            }).join('');
            groupsHTML += '<div class="checklist-group">' +
                '<div class="checklist-group-title">' + gName + '</div>' +
                itemsHTML +
                '</div>';
        });

        var prog = getChecklistProgress(sale);

        return suggestionHTML + encargadoHTML +
            '<div style="margin-bottom:var(--space-sm);font-size:12px;color:var(--text-secondary)">' +
                'Progreso: ' + prog.done + '/' + prog.total +
                ' (' + Math.round(prog.pct * 100) + '%)' +
            '</div>' +
            groupsHTML;
    }

    // ---- render: detail - notas ----

    function renderDetailNotas(sale) {
        return '<div class="kanban-notes">' +
            '<textarea class="form-control" id="kb-notes" placeholder="Notas del evento...">' + (sale.kanbanNotes || '') + '</textarea>' +
            '<div class="kanban-notes-hint">Los cambios se guardan autom\u00e1ticamente al salir del campo.</div>' +
            '</div>';
    }

    // ---- render: detail view ----

    function renderDetail(sale) {
        var displayId = sale.sourceId || String(sale.id || '').slice(-6);
        var finSt = getFinancialStatus(sale);
        var meta = STATUS_META[finSt];
        var colInfo = COLUMNS.find(function (c) { return c.id === Number(sale.boardColumn); }) || {};

        var header = '<div class="kanban-detail-header">' +
            '<button class="btn-secondary" id="kb-back-btn">\u2190 Volver al Board</button>' +
            '<div class="kanban-detail-info">' +
                '<h2 class="kanban-detail-title">#' + displayId + ' \u2014 ' + (sale.eventName || '-') + '</h2>' +
                '<div class="kanban-detail-subtitle">' +
                    (sale.clientName || '') +
                    (sale.staffName ? ' &middot; Vendedor: <strong>' + sale.staffName + '</strong>' : '') +
                    (sale.eventDate ? ' &middot; ' + formatDate(sale.eventDate) : '') +
                    ' &middot; <strong>' + (colInfo.title || '') + '</strong>' +
                '</div>' +
            '</div>' +
            '<span class="badge ' + meta.cls + '" style="font-size:13px;padding:6px 14px;align-self:flex-start">' + meta.label + '</span>' +
            '</div>';

        var tabs = '<div class="tabs">' +
            ['info', 'finanzas', 'checklist', 'notas'].map(function (t) {
                var labels = { info: 'Info General', finanzas: 'Finanzas', checklist: 'Checklist', notas: 'Notas' };
                return '<button class="tab' + (activeTab === t ? ' active' : '') + '" data-tab="' + t + '">' + labels[t] + '</button>';
            }).join('') +
            '</div>';

        var tabContent = '';
        if (activeTab === 'info') tabContent = renderDetailInfo(sale);
        else if (activeTab === 'finanzas') tabContent = renderDetailFinanzas(sale);
        else if (activeTab === 'checklist') tabContent = renderDetailChecklist(sale);
        else if (activeTab === 'notas') tabContent = renderDetailNotas(sale);

        return '<div class="kanban-detail">' + header + tabs +
            '<div class="kanban-tab-content">' + tabContent + '</div>' +
            '</div>';
    }

    // ---- shell ----

    function render() {
        return '<div class="content-header"><h2>Board Operativo</h2></div>' +
            '<div class="content-body" id="kanban-content">' +
            '<div class="empty-state"><p>Cargando board...</p></div>' +
            '</div>';
    }

    function refreshContent() {
        var container = document.getElementById('kanban-content');
        if (!container) return;

        if (currentSaleId) {
            var sale = sales.find(function (s) { return String(s.id) === String(currentSaleId); });
            if (!sale) { currentSaleId = null; refreshContent(); return; }
            container.innerHTML = renderDetail(sale);
            attachDetailListeners(sale);
        } else {
            container.innerHTML = renderBoard();
            attachBoardListeners();
        }
    }

    // ---- board event listeners ----

    function attachBoardListeners() {
        // Filters
        document.querySelectorAll('.kb-filter').forEach(function (sel) {
            sel.addEventListener('change', function () {
                filters[this.dataset.filter] = this.value;
                refreshContent();
            });
        });

        var clearBtn = document.getElementById('kb-clear-filters');
        if (clearBtn) {
            clearBtn.addEventListener('click', function () {
                filters = { client: '', service: '', seller: '', financial: '', operational: '' };
                refreshContent();
            });
        }

        // Card click → detail
        document.querySelectorAll('.kanban-card').forEach(function (card) {
            card.addEventListener('click', function (e) {
                // Ignore if clicking arrow buttons
                if (e.target.closest('.kanban-card-arrows')) return;
                currentSaleId = this.dataset.saleId;
                activeTab = 'info';
                refreshContent();
            });
        });

        // Arrow buttons
        document.querySelectorAll('.kb-arrow-left, .kb-arrow-right').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var saleId = this.dataset.saleId;
                var sale = sales.find(function (s) { return String(s.id) === String(saleId); });
                if (!sale) return;
                var col = Number(sale.boardColumn);
                var dir = this.dataset.dir;
                var newCol = dir === 'left' ? col - 1 : col + 1;
                if (newCol < 1 || newCol > 4) return;
                moveSaleToColumn(saleId, newCol);
            });
        });

        // Drag & Drop
        document.querySelectorAll('.kanban-card').forEach(function (card) {
            card.addEventListener('dragstart', function (e) {
                dragSaleId = this.dataset.saleId;
                this.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', dragSaleId);
            });
            card.addEventListener('dragend', function () {
                this.classList.remove('dragging');
                dragSaleId = null;
                document.querySelectorAll('.kanban-column').forEach(function (col) {
                    col.classList.remove('drag-over');
                });
            });
        });

        document.querySelectorAll('.kanban-column').forEach(function (col) {
            col.addEventListener('dragover', function (e) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                this.classList.add('drag-over');
            });
            col.addEventListener('dragleave', function (e) {
                // Only remove if leaving the column entirely
                if (!this.contains(e.relatedTarget)) {
                    this.classList.remove('drag-over');
                }
            });
            col.addEventListener('drop', function (e) {
                e.preventDefault();
                this.classList.remove('drag-over');
                var saleId = e.dataTransfer.getData('text/plain');
                var newCol = Number(this.dataset.col);
                if (!saleId || !newCol) return;
                moveSaleToColumn(saleId, newCol);
            });
        });
    }

    // ---- detail event listeners ----

    function attachDetailListeners(sale) {
        // Back button
        var backBtn = document.getElementById('kb-back-btn');
        if (backBtn) {
            backBtn.addEventListener('click', function () {
                currentSaleId = null;
                refreshContent();
            });
        }

        // Tabs
        document.querySelectorAll('.kanban-detail .tab').forEach(function (tab) {
            tab.addEventListener('click', function () {
                activeTab = this.dataset.tab;
                refreshContent();
            });
        });

        // Checklist toggles
        document.querySelectorAll('.checklist-item input[type="checkbox"]').forEach(function (cb) {
            cb.addEventListener('change', function () {
                var key = this.dataset.key;
                var checked = this.checked;
                toggleChecklistItem(sale, key, checked);
            });
        });

        // Encargado field
        var encInput = document.getElementById('kb-encargado');
        if (encInput) {
            encInput.addEventListener('blur', function () {
                saveEncargado(sale, this.value);
            });
        }

        // Notes field
        var notesArea = document.getElementById('kb-notes');
        if (notesArea) {
            notesArea.addEventListener('blur', function () {
                saveNotes(sale, this.value);
            });
        }

        // Accept auto-move
        var moveBtn = document.getElementById('kb-accept-move');
        if (moveBtn) {
            moveBtn.addEventListener('click', function () {
                var targetCol = Number(this.dataset.target);
                moveSaleToColumn(String(sale.id), targetCol);
            });
        }
    }

    // ---- checklist / notes persistence ----

    async function toggleChecklistItem(sale, key, checked) {
        var DS = window.Mazelab.DataService;
        var cl = sale.checklist || [];
        var item = cl.find(function (c) { return c.key === key; });
        if (!item) return;

        item.checked = checked;
        item.checkedAt = checked ? new Date().toISOString() : null;

        await DS.update('sales', sale.id, { checklist: cl });

        // Check auto-move after toggle
        var autoMove = checkAutoMove(sale);
        if (autoMove && autoMove.targetCol === 4 && sale.boardColumn < 4) {
            // Auto-move for evento ejecutado
            await moveSaleToColumn(String(sale.id), 4);
            return; // refreshContent already called by moveSaleToColumn
        }

        refreshContent();
    }

    async function saveEncargado(sale, value) {
        var DS = window.Mazelab.DataService;
        sale.encargado = value;
        await DS.update('sales', sale.id, { encargado: value });
    }

    async function saveNotes(sale, value) {
        var DS = window.Mazelab.DataService;
        sale.kanbanNotes = value;
        await DS.update('sales', sale.id, { kanbanNotes: value });
    }

    // ---- init ----

    async function init() {
        currentSaleId = null;
        activeTab = 'info';
        filters = { client: '', service: '', seller: '', financial: '', operational: '' };

        try {
            var DS = window.Mazelab.DataService;
            var results = await Promise.all([
                DS.getAll('sales'),
                DS.getAll('receivables'),
                DS.getAll('payables'),
                DS.getAll('clients'),
                DS.getAll('services'),
                DS.getAll('staff')
            ]);
            sales = results[0] || [];
            receivables = results[1] || [];
            payables = results[2] || [];
            clients = results[3] || [];
            services = results[4] || [];
            staff = results[5] || [];

            // Run migration for sales without boardColumn
            // Wrapped separately so DB errors don't prevent the board from rendering
            try {
                await runMigration();
            } catch (migErr) {
                console.warn('KanbanModule: migration step failed (ventas table may need new columns):', migErr);
            }

            refreshContent();
        } catch (err) {
            console.error('KanbanModule error:', err);
            var c = document.getElementById('kanban-content');
            if (c) c.innerHTML = '<div class="empty-state"><p class="text-danger">Error al cargar board operativo.</p></div>';
        }
    }

    return { render: render, init: init };

})();
