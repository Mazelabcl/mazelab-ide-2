window.Mazelab = window.Mazelab || {};
window.Mazelab.Modules = window.Mazelab.Modules || {};

window.Mazelab.Modules.KanbanModule = (function () {

    // ---- state ----
    var sales = [], receivables = [], payables = [], clients = [], services = [], staff = [];
    var currentSaleId = null;
    var activeTab = 'info';
    var activeBoard = 'pre';   // 'pre' | 'post'
    var postYearMin = '2026';  // default year filter for post board
    var dragSaleId = null;
    var filters = { client: '', service: '', seller: '', financial: '' };

    // ---- column definitions ----

    var PRE_COLUMNS = [
        { id: 1, title: 'Confirmado \u2014 Pendiente Gesti\u00f3n' },
        { id: 2, title: 'En Coordinaci\u00f3n' },
        { id: 3, title: 'Listo para Ejecutar' }
    ];

    var POST_COLUMNS = [
        { id: 4, title: 'Ejecutado \u2014 Pendiente Cierre' },
        { id: 5, title: 'En Gesti\u00f3n' },
        { id: 6, title: 'Listo para Liquidar' }
    ];

    // ---- checklist definitions ----

    var PRE_CHECKLIST = [
        { key: 'pre_coordinacion', label: 'Coordinaci\u00f3n del evento',       group: 'Coordinaci\u00f3n', desc: 'El coordinador est\u00e1 al tanto de los horarios y tom\u00f3 contacto con el cliente.' },
        { key: 'pre_visita',       label: 'Visita t\u00e9cnica al venue',        group: 'Coordinaci\u00f3n', desc: 'Se verific\u00f3 el espacio f\u00edsico. No siempre aplica seg\u00fan el tipo de evento.' },
        { key: 'pre_diseno_ok',    label: 'Dise\u00f1o aprobado por cliente',    group: 'Coordinaci\u00f3n', desc: 'El cliente aprob\u00f3 el dise\u00f1o o propuesta visual del evento.' },
        { key: 'pre_logistica',    label: 'Log\u00edstica confirmada',           group: 'Coordinaci\u00f3n', desc: 'Se tiene noci\u00f3n completa de equipos t\u00e9cnicos, software y c\u00f3mo funcionar\u00e1 la soluci\u00f3n.' },
        { key: 'pre_nomina_env',   label: 'N\u00f3mina lista',                  group: 'Personal',        desc: 'Se consigui\u00f3 al personal freelance y ya se sabe qui\u00e9nes trabajar\u00e1n en el evento.' },
        { key: 'pre_nomina_cap',   label: 'N\u00f3mina capacitada',             group: 'Personal',        desc: 'Se hizo reuni\u00f3n con cada freelance: operaci\u00f3n, contingencias y soluci\u00f3n explicadas.' },
        { key: 'pre_freelances',   label: 'N\u00f3mina enviada al cliente',     group: 'Personal',        desc: 'El cliente tiene la lista del personal que participar\u00e1 en el evento.' },
        { key: 'pre_equipos',      label: 'Equipos configurados y probados',    group: 'Producci\u00f3n',   desc: 'Se realiz\u00f3 prueba t\u00e9cnica aprobada por el encargado comercial y el cliente.' },
        { key: 'pre_material',     label: 'Material de producci\u00f3n listo',   group: 'Producci\u00f3n',   desc: 'Todos los materiales f\u00edsicos y digitales est\u00e1n preparados para el evento.' }
    ];

    // skipForActivacion: excluded when service is "activaciones interactivas" or "activaciones cin\u00e9ticas"
    var POST_CHECKLIST_DEF = [
        { key: 'post_contenido', label: 'Env\u00edo contenido al cliente',      group: 'Cierre', skipForActivacion: true  },
        { key: 'post_feedback',  label: 'Contacto cliente para feedback',       group: 'Cierre', skipForActivacion: false },
        { key: 'post_repo',      label: 'Material guardado en repositorio',     group: 'Cierre', skipForActivacion: false }
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

    function isActivacion(sale) {
        var svc = (sale.serviceNames || '').toLowerCase();
        return svc.indexOf('activacion') !== -1 || svc.indexOf('activaci\u00f3n') !== -1;
    }

    function getPostChecklist(sale) {
        var act = isActivacion(sale);
        return POST_CHECKLIST_DEF.filter(function (item) {
            return !(item.skipForActivacion && act);
        });
    }

    function getBoardForSale(sale) {
        return (sale.eventDate || '') > todayStr() ? 'pre' : 'post';
    }

    function getColumnInfo(colId) {
        return PRE_COLUMNS.concat(POST_COLUMNS).find(function (c) { return c.id === Number(colId); }) || {};
    }

    // ---- financial linking ----

    function getEventCXC(sale) {
        var sid      = String(sale.id       || '');
        var sourceId = String(sale.sourceId || '');
        return receivables.filter(function (r) {
            // New records: linked via saleId (set when user clicks "Facturar")
            if (r.saleId) {
                return String(r.saleId) === sid ||
                       (sourceId && String(r.saleId) === sourceId);
            }
            // Historical imports: linked via sourceId (numeric CSV id, safe — no name fallback)
            if (r.sourceId && sourceId) {
                return String(r.sourceId) === sourceId;
            }
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
        var cxc = getCXCSummary(getEventCXC(sale));
        var cxp = getCXPSummary(getEventCXP(sale));
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

    // ---- checklist progress ----

    function getChecklistProgress(sale) {
        var board = getBoardForSale(sale);
        var cl = sale.checklist || [];
        var defs, keys;
        if (board === 'pre') {
            defs = PRE_CHECKLIST;
        } else {
            defs = getPostChecklist(sale);
        }
        keys = defs.map(function (d) { return d.key; });
        var relevant = cl.filter(function (c) { return keys.indexOf(c.key) !== -1; });
        var total = defs.length;
        var done = relevant.filter(function (c) { return c.checked; }).length;
        return { done: done, total: total, pct: total > 0 ? done / total : 0 };
    }

    function hasPendingItems(sale) {
        var cxc = getCXCSummary(getEventCXC(sale));
        var cxp = getCXPSummary(getEventCXP(sale));
        if (cxc.pct !== null && cxc.pct < 0.9999) return true;
        if (cxp.pct !== null && cxp.pct < 0.9999) return true;
        return getChecklistProgress(sale).pct < 0.9999;
    }

    // ---- migration ----

    function runMigration() {
        var DS = window.Mazelab.DataService;
        var today = todayStr();
        var needsUpdate = [];

        sales.forEach(function (s) {
            var board = getBoardForSale(s);
            var col = (s.boardColumn !== undefined && s.boardColumn !== null) ? Number(s.boardColumn) : NaN;
            var changed = false;

            // Skip events manually removed from board
            if (col === 99) return;

            // Assign to correct column range for each board
            if (board === 'pre') {
                if (isNaN(col) || col < 1 || col > 3) {
                    s.boardColumn = 1;
                    s.boardOrder = s.boardOrder || new Date(s.eventDate || today).getTime();
                    changed = true;
                }
            } else {
                // Old col 4 already maps to new post col 4 — keep it
                if (isNaN(col) || col < 4 || col > 6) {
                    s.boardColumn = 4;
                    s.boardOrder = s.boardOrder || new Date(s.eventDate || today).getTime();
                    changed = true;
                }
            }

            // Add missing board-specific checklist items
            var cl = Array.isArray(s.checklist) ? s.checklist.slice() : [];
            var clChanged = false;
            var itemsToAdd = board === 'pre' ? PRE_CHECKLIST : getPostChecklist(s);
            itemsToAdd.forEach(function (def) {
                if (!cl.find(function (c) { return c.key === def.key; })) {
                    cl.push({ key: def.key, label: def.label, group: def.group, checked: false, checkedAt: null });
                    clChanged = true;
                }
            });
            if (clChanged) { s.checklist = cl; changed = true; }

            if (changed) {
                needsUpdate.push({
                    id: s.id,
                    boardColumn: s.boardColumn,
                    boardOrder:  s.boardOrder,
                    checklist:   s.checklist,
                    encargado:   s.encargado   || '',
                    kanbanNotes: s.kanbanNotes || ''
                });
            }
        });

        if (needsUpdate.length > 0) {
            (async function () {
                for (var i = 0; i < needsUpdate.length; i++) {
                    var u = needsUpdate[i];
                    try {
                        await DS.update('sales', u.id, {
                            boardColumn: u.boardColumn,
                            boardOrder:  u.boardOrder,
                            checklist:   u.checklist,
                            encargado:   u.encargado,
                            kanbanNotes: u.kanbanNotes
                        });
                    } catch (e) { /* non-fatal — DB columns may not exist yet */ }
                }
            })();
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

    // ---- filtering ----

    function getBoardSales() {
        var today = todayStr();
        if (activeBoard === 'pre') {
            return sales.filter(function (s) {
                var col = Number(s.boardColumn);
                return col >= 1 && col <= 3 && (s.eventDate || '') > today;
            });
        } else {
            var minDate = postYearMin ? (postYearMin + '-01-01') : '';
            return sales.filter(function (s) {
                var col = Number(s.boardColumn);
                if (col === 99) return false;
                var ed = s.eventDate || '';
                if (col < 4 || col > 6) return false;
                if (ed > today) return false;
                if (minDate && ed < minDate) return false;
                return hasPendingItems(s);
            });
        }
    }

    function getFilteredSales() {
        return getBoardSales().filter(function (s) {
            if (filters.client && (s.clientName || '') !== filters.client) return false;
            if (filters.seller && (s.staffName || '') !== filters.seller) return false;
            if (filters.service) {
                var svc = services.find(function (sv) { return sv.name === filters.service; });
                if (!svc || (s.serviceIds || []).indexOf(String(svc.id)) === -1) return false;
            }
            if (filters.financial && getFinancialStatus(s) !== filters.financial) return false;
            return true;
        });
    }

    function getSalesForColumn(colId) {
        return getFilteredSales().filter(function (s) {
            return Number(s.boardColumn) === colId;
        }).sort(function (a, b) {
            // Nearest event date first; no date goes to bottom
            var da = a.eventDate || '9999-12-31';
            var db = b.eventDate || '9999-12-31';
            return da < db ? -1 : da > db ? 1 : 0;
        });
    }

    function getUniqueValues(field) {
        var vals = {};
        getBoardSales().forEach(function (s) {
            var v = s[field];
            if (v && typeof v === 'string') vals[v] = true;
        });
        return Object.keys(vals).sort();
    }

    // ---- card indicator ----

    function getCardIndicator(sale) {
        var eventDate = sale.eventDate;
        if (!eventDate) return { icon: '\u26aa', cls: '' };
        var today = new Date(todayStr());
        var evDate = new Date(eventDate);
        var diffDays = Math.ceil((evDate - today) / (1000 * 60 * 60 * 24));
        var prog = getChecklistProgress(sale);

        if (activeBoard === 'pre') {
            if (diffDays >= 0 && diffDays <= 7 && prog.pct < 0.7) return { icon: '\ud83d\udfe1', cls: 'text-warning' };
            if (prog.pct >= 0.7 || diffDays > 7) return { icon: '\ud83d\udfe2', cls: 'text-success' };
            return { icon: '\u26aa', cls: '' };
        } else {
            var finSt = getFinancialStatus(sale);
            if (finSt !== 'liquidado') return { icon: '\ud83d\udd34', cls: 'text-danger' };
            if (prog.pct < 0.9999) return { icon: '\ud83d\udfe1', cls: 'text-warning' };
            return { icon: '\ud83d\udfe2', cls: 'text-success' };
        }
    }

    // ---- render: board selector ----

    function renderBoardSelector() {
        var preActive = activeBoard === 'pre' ? ' active' : '';
        var postActive = activeBoard === 'post' ? ' active' : '';

        var yearToggle = '';
        if (activeBoard === 'post') {
            var yearOpts = '<option value=""' + (!postYearMin ? ' selected' : '') + '>Todos los a\u00f1os</option>' +
                ['2024', '2025', '2026'].map(function (y) {
                    return '<option value="' + y + '"' + (postYearMin === y ? ' selected' : '') + '>Desde ' + y + '</option>';
                }).join('');
            yearToggle = '<span style="margin-left:var(--space-md);font-size:13px;color:var(--text-secondary)">A\u00f1o: </span>' +
                '<select class="form-control" id="kb-year-filter" style="display:inline-block;width:auto;height:28px;padding:2px 8px;font-size:13px">' + yearOpts + '</select>';
        }

        return '<div style="display:flex;align-items:center;gap:var(--space-sm);margin-bottom:var(--space-md);flex-wrap:wrap">' +
            '<div class="toggle-group">' +
                '<button class="toggle-option' + preActive + '" id="kb-board-pre">Pre-evento</button>' +
                '<button class="toggle-option' + postActive + '" id="kb-board-post">Post-evento</button>' +
            '</div>' +
            yearToggle +
            '</div>';
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
        var hasFilter = filters.client || filters.seller || filters.service || filters.financial;

        return '<div class="kanban-filters">' +
            '<span class="kanban-filter-label">Filtros:</span>' +
            '<select class="form-control kb-filter" data-filter="client"><option value="">Cliente</option>' + clientOpts + '</select>' +
            '<select class="form-control kb-filter" data-filter="service"><option value="">Servicio</option>' + svcOpts + '</select>' +
            '<select class="form-control kb-filter" data-filter="seller"><option value="">Vendedor</option>' + sellerOpts + '</select>' +
            '<select class="form-control kb-filter" data-filter="financial"><option value="">Estado financiero</option>' + finOpts + '</select>' +
            (hasFilter ? '<button class="kanban-filter-clear" id="kb-clear-filters">Limpiar filtros</button>' : '') +
            '</div>';
    }

    // ---- render: card ----

    function getDaysInfo(sale) {
        if (!sale.eventDate) return { days: null, label: '', color: 'var(--text-muted)' };
        var today = new Date(todayStr());
        var evDate = new Date(sale.eventDate);
        var diff = Math.ceil((evDate - today) / (1000 * 60 * 60 * 24));
        var label, color;
        if (diff < 0)       { label = Math.abs(diff) + 'd pasado'; color = 'var(--danger)'; }
        else if (diff === 0){ label = 'Hoy';                        color = 'var(--danger)'; }
        else if (diff <= 3) { label = diff + 'd';                   color = 'var(--danger)'; }
        else if (diff <= 7) { label = diff + 'd';                   color = '#f97316'; }
        else if (diff <= 14){ label = diff + 'd';                   color = 'var(--warning)'; }
        else                { label = diff + 'd';                   color = 'var(--success)'; }
        return { days: diff, label: label, color: color };
    }

    // Column-specific urgency: alert if event is still in an early column with few days left
    function getCardUrgencyBorder(sale) {
        var di = getDaysInfo(sale);
        if (di.days === null) return '';
        var col = Number(sale.boardColumn);
        if ((col === 1 && di.days <= 14) ||
            (col === 2 && di.days <= 7)  ||
            (col <= 2  && di.days <= 3)) {
            return 'box-shadow:0 0 0 2px ' + di.color + ';';
        }
        return '';
    }

    function renderCard(sale) {
        var displayId = sale.sourceId || String(sale.id || '').slice(-6);
        var indicator = getCardIndicator(sale);
        var amount = Number(sale.amount || 0);
        var cxcS = getCXCSummary(getEventCXC(sale));
        var cxpS = getCXPSummary(getEventCXP(sale));
        var col = Number(sale.boardColumn);
        var prog = getChecklistProgress(sale);
        var board = getBoardForSale(sale);
        var minCol = board === 'pre' ? 1 : 4;
        var maxCol = board === 'pre' ? 3 : 6;
        var di = getDaysInfo(sale);
        var urgencyBorder = activeBoard === 'pre' ? getCardUrgencyBorder(sale) : '';

        var facPct = cxcS.pct !== null ? Math.round(cxcS.pct * 100) + '%' : '-';
        var pagPct = cxpS.pct !== null ? Math.round(cxpS.pct * 100) + '%' : '-';
        var progColor = prog.pct >= 0.7 ? 'var(--success)' : (prog.pct > 0.3 ? 'var(--warning)' : 'var(--danger)');

        // Services as small tags
        var svcTags = '';
        if (sale.serviceNames) {
            svcTags = '<div class="kanban-card-svc-tags">' +
                sale.serviceNames.split(',').map(function (s) {
                    return '<span class="kanban-svc-tag">' + s.trim() + '</span>';
                }).join('') +
                '</div>';
        }

        return '<div class="kanban-card" draggable="true" data-sale-id="' + sale.id + '" style="' + urgencyBorder + '">' +
            '<div class="kanban-card-top">' +
                '<span class="kanban-card-id">#' + displayId + '</span>' +
                '<span style="display:flex;align-items:center;gap:4px">' +
                    (di.label ? '<span style="font-size:11px;font-weight:600;color:' + di.color + '">' + di.label + '</span>' : '') +
                    '<span class="kanban-card-indicator">' + indicator.icon + '</span>' +
                '</span>' +
            '</div>' +
            '<div class="kanban-card-title">' + (sale.eventName || '-') + '</div>' +
            '<div class="kanban-card-client">' + (sale.clientName || '-') + '</div>' +
            svcTags +
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
                    '<button class="kb-arrow-left" data-sale-id="' + sale.id + '" data-dir="left"' + (col <= minCol ? ' disabled' : '') + ' title="Mover izquierda">\u2190</button>' +
                    '<button class="kb-arrow-right" data-sale-id="' + sale.id + '" data-dir="right"' + (col >= maxCol ? ' disabled' : '') + ' title="Mover derecha">\u2192</button>' +
                '</div>' +
            '</div>' +
            '<div class="kanban-card-progress">' +
                '<div class="kanban-card-progress-bar" style="width:' + Math.round(prog.pct * 100) + '%;background:' + progColor + '"></div>' +
            '</div>' +
            '</div>';
    }

    // ---- render: board ----

    function renderBoard() {
        var columns = activeBoard === 'pre' ? PRE_COLUMNS : POST_COLUMNS;
        var totalVisible = 0;
        var cols = columns.map(function (col) {
            var colSales = getSalesForColumn(col.id);
            totalVisible += colSales.length;
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

        var emptyMsg = '';
        if (totalVisible === 0 && activeBoard === 'post') {
            var yearLabel = postYearMin ? ('desde ' + postYearMin) : 'en todos los a\u00f1os';
            emptyMsg = '<div class="empty-state" style="margin-top:var(--space-lg)"><p>No hay eventos con pendientes ' + yearLabel + '.</p></div>';
        }

        return renderBoardSelector() + renderFilters() +
            '<div class="kanban-board">' + cols + '</div>' + emptyMsg;
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
                '<tr><td style="color:var(--text-secondary)">Columna</td><td>' + (getColumnInfo(sale.boardColumn).title || '-') + '</td></tr>' +
            '</tbody></table>' +
        '</div>';
    }

    // ---- render: detail - finanzas ----

    function renderDetailFinanzas(sale) {
        var cxcList = getEventCXC(sale);
        var cxpList = getEventCXP(sale);
        var cxc = getCXCSummary(cxcList);
        var cxp = getCXPSummary(cxpList);

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
        var board = getBoardForSale(sale);
        var cl = sale.checklist || [];
        var defs = board === 'pre' ? PRE_CHECKLIST : getPostChecklist(sale);

        // Build group map preserving definition order
        var groupMap = {};
        var groupOrder = [];
        defs.forEach(function (def) {
            var item = cl.find(function (c) { return c.key === def.key; }) ||
                { key: def.key, label: def.label, group: def.group, checked: false, checkedAt: null };
            var g = def.group || 'Otros';
            if (!groupMap[g]) { groupMap[g] = []; groupOrder.push(g); }
            groupMap[g].push({ item: item, def: def });
        });

        var encargadoHTML = '<div class="checklist-encargado">' +
            '<label>Encargado del evento</label>' +
            '<input type="text" class="form-control" id="kb-encargado" value="' + (sale.encargado || '') + '" placeholder="Nombre del encargado...">' +
            '</div>';

        var groupsHTML = '';
        groupOrder.forEach(function (gName) {
            var entries = groupMap[gName];
            var done = entries.filter(function (e) { return e.item.checked; }).length;
            var total = entries.length;
            var pct = total > 0 ? done / total : 0;
            var barColor = pct >= 0.9999 ? 'var(--success)' : (pct > 0 ? 'var(--warning)' : 'rgba(255,255,255,0.2)');

            var progressBar = '<div style="height:4px;border-radius:2px;background:rgba(255,255,255,0.08);margin-top:6px;overflow:hidden">' +
                '<div style="height:100%;width:' + Math.round(pct * 100) + '%;background:' + barColor + ';transition:width 0.3s"></div>' +
                '</div>';

            var itemsHTML = entries.map(function (e) {
                var item = e.item;
                var def = e.def;
                var checkedClass = item.checked ? ' checked' : '';
                var dateStr = item.checkedAt ? formatShortDate(item.checkedAt) : '';
                return '<div class="checklist-item' + checkedClass + '" style="padding:10px 0;display:flex;align-items:flex-start;justify-content:space-between;gap:8px">' +
                    '<div style="display:flex;align-items:flex-start;gap:10px;flex:1">' +
                        '<input type="checkbox" id="cl-' + item.key + '"' + (item.checked ? ' checked' : '') + ' data-key="' + item.key + '" style="margin-top:3px;flex-shrink:0">' +
                        '<div>' +
                            '<label for="cl-' + item.key + '" style="font-weight:500;cursor:pointer;display:block">' + (def.label || item.label) + '</label>' +
                            (def.desc ? '<div style="font-size:11px;color:var(--text-muted);margin-top:3px;line-height:1.4">' + def.desc + '</div>' : '') +
                        '</div>' +
                    '</div>' +
                    (dateStr ? '<span class="checklist-date" style="flex-shrink:0">' + dateStr + '</span>' : '') +
                    '</div>';
            }).join('');

            groupsHTML += '<div class="checklist-group" style="margin-bottom:var(--space-lg)">' +
                '<div class="checklist-group-title" style="display:flex;justify-content:space-between;align-items:center">' +
                    '<span>' + gName + '</span>' +
                    '<span style="font-size:11px;color:' + barColor + ';font-weight:700;letter-spacing:0.5px">' + done + '/' + total + '</span>' +
                '</div>' +
                progressBar +
                '<div style="margin-top:var(--space-sm)">' + itemsHTML + '</div>' +
                '</div>';
        });

        var prog = getChecklistProgress(sale);
        return encargadoHTML +
            '<div style="margin-bottom:var(--space-md);font-size:12px;color:var(--text-secondary)">' +
                'Progreso total: ' + prog.done + '/' + prog.total +
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

        var header = '<div class="kanban-detail-header">' +
            '<div style="display:flex;gap:var(--space-sm)">' +
                '<button class="btn-secondary" id="kb-back-btn">\u2190 Volver al Board</button>' +
                '<button class="btn-secondary" id="kb-remove-board-btn" style="font-size:12px;color:var(--text-muted);border-color:rgba(255,255,255,0.1)" title="Ocultar este evento del board">Quitar del board</button>' +
            '</div>' +
            '<div class="kanban-detail-info">' +
                '<h2 class="kanban-detail-title">#' + displayId + ' \u2014 ' + (sale.eventName || '-') + '</h2>' +
                '<div class="kanban-detail-subtitle">' +
                    (sale.clientName || '') +
                    (sale.staffName ? ' &middot; Vendedor: <strong>' + sale.staffName + '</strong>' : '') +
                    (sale.eventDate ? ' &middot; ' + formatDate(sale.eventDate) : '') +
                    ' &middot; <strong>' + (getColumnInfo(sale.boardColumn).title || '') + '</strong>' +
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
        if (activeTab === 'info')       tabContent = renderDetailInfo(sale);
        else if (activeTab === 'finanzas') tabContent = renderDetailFinanzas(sale);
        else if (activeTab === 'checklist') tabContent = renderDetailChecklist(sale);
        else if (activeTab === 'notas')    tabContent = renderDetailNotas(sale);

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
        // Board toggle
        var preBtn = document.getElementById('kb-board-pre');
        var postBtn = document.getElementById('kb-board-post');
        if (preBtn) preBtn.addEventListener('click', function () {
            activeBoard = 'pre';
            filters = { client: '', service: '', seller: '', financial: '' };
            refreshContent();
        });
        if (postBtn) postBtn.addEventListener('click', function () {
            activeBoard = 'post';
            filters = { client: '', service: '', seller: '', financial: '' };
            refreshContent();
        });

        // Year filter (post board only)
        var yearSel = document.getElementById('kb-year-filter');
        if (yearSel) yearSel.addEventListener('change', function () {
            postYearMin = this.value;
            refreshContent();
        });

        // Column filters
        document.querySelectorAll('.kb-filter').forEach(function (sel) {
            sel.addEventListener('change', function () {
                filters[this.dataset.filter] = this.value;
                refreshContent();
            });
        });

        var clearBtn = document.getElementById('kb-clear-filters');
        if (clearBtn) clearBtn.addEventListener('click', function () {
            filters = { client: '', service: '', seller: '', financial: '' };
            refreshContent();
        });

        // Card click → detail
        document.querySelectorAll('.kanban-card').forEach(function (card) {
            card.addEventListener('click', function (e) {
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
                var board = getBoardForSale(sale);
                var minCol = board === 'pre' ? 1 : 4;
                var maxCol = board === 'pre' ? 3 : 6;
                var newCol = this.dataset.dir === 'left' ? col - 1 : col + 1;
                if (newCol < minCol || newCol > maxCol) return;
                moveSaleToColumn(saleId, newCol);
            });
        });

        // Drag & drop
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
                if (!this.contains(e.relatedTarget)) this.classList.remove('drag-over');
            });
            col.addEventListener('drop', function (e) {
                e.preventDefault();
                this.classList.remove('drag-over');
                var saleId = e.dataTransfer.getData('text/plain');
                var newCol = Number(this.dataset.col);
                if (!saleId || !newCol) return;
                // Validate drop target matches current board
                var sale = sales.find(function (s) { return String(s.id) === String(saleId); });
                if (!sale) return;
                var board = getBoardForSale(sale);
                var minCol = board === 'pre' ? 1 : 4;
                var maxCol = board === 'pre' ? 3 : 6;
                if (newCol < minCol || newCol > maxCol) return;
                moveSaleToColumn(saleId, newCol);
            });
        });
    }

    // ---- detail event listeners ----

    function attachDetailListeners(sale) {
        var backBtn = document.getElementById('kb-back-btn');
        if (backBtn) backBtn.addEventListener('click', function () {
            currentSaleId = null;
            refreshContent();
        });

        var removeBtn = document.getElementById('kb-remove-board-btn');
        if (removeBtn) removeBtn.addEventListener('click', function () {
            if (!confirm('¿Quitar "' + (sale.eventName || 'este evento') + '" del board operativo?\n\nEl evento seguirá en Ventas y no se perderá ningún dato.')) return;
            sale.boardColumn = 99;
            window.Mazelab.DataService.update('sales', sale.id, { boardColumn: 99 });
            currentSaleId = null;
            refreshContent();
        });

        document.querySelectorAll('.kanban-detail .tab').forEach(function (tab) {
            tab.addEventListener('click', function () {
                activeTab = this.dataset.tab;
                refreshContent();
            });
        });

        document.querySelectorAll('.checklist-item input[type="checkbox"]').forEach(function (cb) {
            cb.addEventListener('change', function () {
                toggleChecklistItem(sale, this.dataset.key, this.checked);
            });
        });

        var encInput = document.getElementById('kb-encargado');
        if (encInput) encInput.addEventListener('blur', function () {
            saveEncargado(sale, this.value);
        });

        var notesArea = document.getElementById('kb-notes');
        if (notesArea) notesArea.addEventListener('blur', function () {
            saveNotes(sale, this.value);
        });
    }

    // ---- checklist / notes persistence ----

    async function toggleChecklistItem(sale, key, checked) {
        var DS = window.Mazelab.DataService;
        var cl = Array.isArray(sale.checklist) ? sale.checklist.slice() : [];
        var item = cl.find(function (c) { return c.key === key; });
        if (!item) {
            var def = PRE_CHECKLIST.concat(POST_CHECKLIST_DEF).find(function (d) { return d.key === key; });
            if (!def) return;
            item = { key: key, label: def.label, group: def.group, checked: false, checkedAt: null };
            cl.push(item);
        }
        item.checked = checked;
        item.checkedAt = checked ? new Date().toISOString() : null;
        sale.checklist = cl;
        await DS.update('sales', sale.id, { checklist: cl });
        refreshContent();
    }

    async function saveEncargado(sale, value) {
        sale.encargado = value;
        await window.Mazelab.DataService.update('sales', sale.id, { encargado: value });
    }

    async function saveNotes(sale, value) {
        sale.kanbanNotes = value;
        await window.Mazelab.DataService.update('sales', sale.id, { kanbanNotes: value });
    }

    // ---- init ----

    async function init() {
        currentSaleId = null;
        activeTab = 'info';
        filters = { client: '', service: '', seller: '', financial: '' };

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
            sales       = results[0] || [];
            receivables = results[1] || [];
            payables    = results[2] || [];
            clients     = results[3] || [];
            services    = results[4] || [];
            staff       = results[5] || [];

            runMigration();
            refreshContent();
        } catch (err) {
            console.error('KanbanModule error:', err);
            var c = document.getElementById('kanban-content');
            if (c) c.innerHTML = '<div class="empty-state"><p class="text-danger">Error al cargar board operativo.</p></div>';
        }
    }

    return { render: render, init: init };

})();
