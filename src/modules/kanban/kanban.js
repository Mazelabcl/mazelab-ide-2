window.Mazelab = window.Mazelab || {};
window.Mazelab.Modules = window.Mazelab.Modules || {};

window.Mazelab.Modules.KanbanModule = (function () {

    // ---- state ----
    var sales = [], receivables = [], payables = [], clients = [], services = [], staff = [];
    var currentSaleId = null;
    var activeTab = 'info';
    var traspasoEditMode = false; // false = show brief when complete, true = show form
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

    // ---- alerts ----

    function computeAlerts() {
        var today = new Date(todayStr());
        var alerts = [];
        var preSales = sales.filter(function (s) {
            var col = Number(s.boardColumn);
            return col >= 1 && col <= 3 && (s.eventDate || '') >= todayStr();
        });

        preSales.forEach(function (s) {
            if (!s.eventDate) return;
            var days = Math.ceil((new Date(s.eventDate) - today) / (1000 * 60 * 60 * 24));
            var cl = s.checklist || [];
            var done = function (key) {
                var item = cl.find(function (i) { return i.key === key; });
                return !!(item && item.done);
            };
            var sev = function (d) { return d <= 3 ? 'critico' : d <= 7 ? 'urgente' : 'aviso'; };

            if (!isTraspasoComplete(s)) {
                alerts.push({ sale: s, type: 'traspaso', label: 'Sin traspaso completo', sev: sev(days), days: days });
            }
            if (days <= 7 && !done('pre_diseno_ok')) {
                alerts.push({ sale: s, type: 'diseno', label: 'Diseño sin aprobar', sev: sev(days), days: days });
            }
            if (days <= 5 && !done('pre_nomina_env')) {
                alerts.push({ sale: s, type: 'nomina', label: 'Nómina no lista', sev: days <= 3 ? 'critico' : 'urgente', days: days });
            }
            if (days <= 5 && !done('pre_nomina_cap')) {
                alerts.push({ sale: s, type: 'nomina_cap', label: 'Personal no capacitado', sev: days <= 3 ? 'critico' : 'urgente', days: days });
            }
            if (days <= 3 && !done('pre_equipos')) {
                alerts.push({ sale: s, type: 'equipos', label: 'Equipos no configurados', sev: 'critico', days: days });
            }
        });

        // Sort: more critical first, then closest event
        var order = { critico: 0, urgente: 1, aviso: 2 };
        alerts.sort(function (a, b) {
            if (order[a.sev] !== order[b.sev]) return order[a.sev] - order[b.sev];
            return a.days - b.days;
        });
        return alerts;
    }

    function updateSidebarBadge() {
        var alerts = computeAlerts();
        var navItem = document.querySelector('.nav-item[data-route="kanban"]');
        if (!navItem) return;
        var existing = navItem.querySelector('.nav-alert-badge');
        if (existing) existing.remove();
        if (alerts.length > 0) {
            var badge = document.createElement('span');
            badge.className = 'nav-alert-badge';
            badge.textContent = alerts.length;
            badge.style.cssText = 'background:#f87171;color:#fff;border-radius:10px;padding:1px 6px;font-size:11px;font-weight:700;margin-left:auto;min-width:18px;text-align:center';
            navItem.style.position = 'relative';
            navItem.appendChild(badge);
        }
    }

    function openAlertsPanel() {
        var alerts = computeAlerts();
        var sevMeta = {
            critico: { label: 'Crítico', color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
            urgente: { label: 'Urgente', color: '#fb923c', bg: 'rgba(251,146,60,0.12)' },
            aviso:   { label: 'Aviso',   color: '#facc15', bg: 'rgba(250,204,21,0.12)' }
        };

        var rows = alerts.length === 0
            ? '<div style="text-align:center;padding:32px;color:var(--text-secondary)">No hay alertas activas.</div>'
            : alerts.map(function (a) {
                var m = sevMeta[a.sev];
                var daysLabel = a.days === 0 ? 'Hoy' : a.days === 1 ? 'Mañana' : 'En ' + a.days + ' días';
                return '<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:8px;background:' + m.bg + ';margin-bottom:8px;cursor:pointer" class="kb-alert-row" data-sale-id="' + a.sale.id + '">' +
                    '<span style="width:72px;text-align:center;font-size:11px;font-weight:700;color:' + m.color + ';background:' + m.bg + ';border:1px solid ' + m.color + '44;border-radius:12px;padding:2px 6px;white-space:nowrap">' + m.label + '</span>' +
                    '<div style="flex:1;min-width:0">' +
                        '<div style="font-weight:600;font-size:0.9rem">' + a.label + '</div>' +
                        '<div style="font-size:0.8rem;color:var(--text-secondary)">' + (a.sale.eventName || '-') + ' · ' + (a.sale.clientName || '') + '</div>' +
                    '</div>' +
                    '<span style="font-size:0.8rem;color:' + m.color + ';font-weight:600;white-space:nowrap">' + daysLabel + '</span>' +
                '</div>';
            }).join('');

        var html = '<div id="kb-alerts-wrapper" style="position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:1000;display:flex;align-items:center;justify-content:center">' +
            '<div style="background:#1e1b2e;border:1px solid rgba(255,255,255,0.12);border-radius:14px;padding:28px;width:min(560px,96vw);max-height:90vh;overflow-y:auto">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">' +
                    '<h3 style="margin:0">Alertas operativas</h3>' +
                    '<button id="kb-alerts-close" style="background:none;border:none;color:var(--text-secondary);font-size:1.4rem;cursor:pointer;line-height:1">&times;</button>' +
                '</div>' +
                '<div id="kb-alerts-list">' + rows + '</div>' +
            '</div>' +
        '</div>';

        var mc = document.getElementById('modal-container');
        mc.innerHTML = html;

        document.getElementById('kb-alerts-close').addEventListener('click', function () { mc.innerHTML = ''; });
        document.getElementById('kb-alerts-wrapper').addEventListener('click', function (e) {
            if (e.target.id === 'kb-alerts-wrapper') mc.innerHTML = '';
        });
        mc.querySelectorAll('.kb-alert-row').forEach(function (row) {
            row.addEventListener('click', function () {
                mc.innerHTML = '';
                currentSaleId = this.dataset.saleId;
                var s = sales.find(function (x) { return String(x.id) === String(currentSaleId); });
                activeTab = (s && !isTraspasoComplete(s)) ? 'traspaso' : 'checklist';
                refreshContent();
            });
        });
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

        var alertCount = computeAlerts().length;
        var alertBtn = '<button id="kb-alerts-btn" style="margin-left:auto;display:flex;align-items:center;gap:6px;background:' +
            (alertCount > 0 ? 'rgba(248,113,113,0.15)' : 'var(--bg-secondary)') +
            ';border:1px solid ' + (alertCount > 0 ? 'rgba(248,113,113,0.5)' : 'rgba(255,255,255,0.1)') +
            ';color:' + (alertCount > 0 ? '#f87171' : 'var(--text-secondary)') +
            ';border-radius:8px;padding:5px 12px;font-size:13px;font-weight:600;cursor:pointer">' +
            (alertCount > 0
                ? '<span style="background:#f87171;color:#fff;border-radius:10px;padding:0 6px;font-size:11px">' + alertCount + '</span> Alertas'
                : 'Alertas') +
            '</button>';

        return '<div style="display:flex;align-items:center;gap:var(--space-sm);margin-bottom:var(--space-md);flex-wrap:wrap">' +
            '<div class="toggle-group">' +
                '<button class="toggle-option' + preActive + '" id="kb-board-pre">Pre-evento</button>' +
                '<button class="toggle-option' + postActive + '" id="kb-board-post">Post-evento</button>' +
            '</div>' +
            yearToggle +
            alertBtn +
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
        var traspasoOk = isTraspasoComplete(sale);

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
                    (board === 'pre' && !traspasoOk ? '<span class="badge badge-danger" title="Traspaso incompleto">Sin traspaso</span>' : '') +
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

        // Also include custom items (key starts with 'custom_') grouped by their group field
        var customItems = cl.filter(function (c) {
            return c.key && c.key.indexOf('custom_') === 0;
        });
        customItems.forEach(function (item) {
            var g = item.group || 'Otros';
            if (!groupMap[g]) { groupMap[g] = []; groupOrder.push(g); }
            // Only add if not already present (avoid duplicates from defs loop)
            var already = groupMap[g].find(function (e) { return e.item.key === item.key; });
            if (!already) groupMap[g].push({ item: item, def: null });
        });

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
                var isCustom = item.key && item.key.indexOf('custom_') === 0;
                var checkedClass = item.checked ? ' checked' : '';
                var dateStr = item.checkedAt ? formatShortDate(item.checkedAt) : '';
                return '<div class="checklist-item' + checkedClass + '" style="padding:10px 0;display:flex;align-items:flex-start;justify-content:space-between;gap:8px" data-key="' + item.key + '">' +
                    '<div style="display:flex;align-items:flex-start;gap:10px;flex:1">' +
                        '<input type="checkbox" id="cl-' + item.key + '"' + (item.checked ? ' checked' : '') + ' data-key="' + item.key + '" style="margin-top:3px;flex-shrink:0">' +
                        '<div>' +
                            '<label for="cl-' + item.key + '" style="font-weight:500;cursor:pointer;display:block">' + (def ? (def.label || item.label) : item.label) + '</label>' +
                            (def && def.desc ? '<div style="font-size:11px;color:var(--text-muted);margin-top:3px;line-height:1.4">' + def.desc + '</div>' : '') +
                        '</div>' +
                    '</div>' +
                    '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0">' +
                        (dateStr ? '<span class="checklist-date">' + dateStr + '</span>' : '') +
                        (isCustom ? '<button class="kb-cl-delete" data-key="' + item.key + '" title="Eliminar \u00edtem" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:14px;padding:0 2px;line-height:1">&times;</button>' : '') +
                    '</div>' +
                    '</div>';
            }).join('');

            // "Add item" row at bottom of each group
            var addRow = '<div style="margin-top:8px;display:flex;gap:6px;align-items:center">' +
                '<input type="text" class="form-control kb-cl-new-input" data-group="' + gName + '" placeholder="Agregar \u00edtem..." style="flex:1;height:30px;font-size:12px;padding:4px 8px">' +
                '<button class="kb-cl-add" data-group="' + gName + '" style="height:30px;padding:0 10px;font-size:12px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:var(--text-secondary);cursor:pointer;white-space:nowrap">+ A\u00f1adir</button>' +
                '</div>';

            groupsHTML += '<div class="checklist-group" style="margin-bottom:var(--space-lg)">' +
                '<div class="checklist-group-title" style="display:flex;justify-content:space-between;align-items:center">' +
                    '<span>' + gName + '</span>' +
                    '<span style="font-size:11px;color:' + barColor + ';font-weight:700;letter-spacing:0.5px">' + done + '/' + total + '</span>' +
                '</div>' +
                progressBar +
                '<div style="margin-top:var(--space-sm)">' + itemsHTML + '</div>' +
                addRow +
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

    // ---- render: detail - traspaso ----

    function isTraspasoComplete(sale) {
        var t = sale.traspaso || {};
        return !!(t.contactoNombre && t.lugar && t.horarioServicio);
    }

    function renderDetailTraspaso(sale) {
        var complete = isTraspasoComplete(sale);
        // Show brief when complete and not in edit mode
        if (complete && !traspasoEditMode) {
            return renderBrief(sale);
        }
        traspasoEditMode = false; // reset after use
        var t = sale.traspaso || {};
        var vest = t.vestimenta || 'Negra sin logos (est\u00e1ndar MazeLab)';
        var banner = complete
            ? ''
            : '<div style="background:rgba(251,191,36,0.10);border:1px solid rgba(251,191,36,0.3);border-radius:8px;padding:10px 14px;margin-bottom:var(--space-lg);font-size:13px;color:var(--warning)">Completa al menos: contacto del cliente, lugar y horario del servicio.</div>';

        return banner +
            '<div class="form-row">' +
                '<div class="form-group">' +
                    '<label>Contacto en terreno \u2014 Nombre</label>' +
                    '<input type="text" class="form-control" id="tr-contactoNombre" value="' + (t.contactoNombre || '') + '" placeholder="Ej: Paola Riquelme">' +
                '</div>' +
                '<div class="form-group">' +
                    '<label>Tel\u00e9fono</label>' +
                    '<input type="text" class="form-control" id="tr-contactoTel" value="' + (t.contactoTel || '') + '" placeholder="+56 9 ...">' +
                '</div>' +
            '</div>' +
            '<div class="form-group">' +
                '<label>Email de contacto</label>' +
                '<input type="text" class="form-control" id="tr-contactoEmail" value="' + (t.contactoEmail || '') + '" placeholder="correo@cliente.cl">' +
            '</div>' +
            '<div class="form-row">' +
                '<div class="form-group">' +
                    '<label>Lugar del evento (direcci\u00f3n completa)</label>' +
                    '<input type="text" class="form-control" id="tr-lugar" value="' + (t.lugar || '') + '" placeholder="Av. Siempreviva 742, Santiago">' +
                '</div>' +
                '<div class="form-group">' +
                    '<label>PAX estimado</label>' +
                    '<input type="number" class="form-control" id="tr-pax" value="' + (t.pax || '') + '" placeholder="Nro. de asistentes" min="0">' +
                '</div>' +
            '</div>' +
            '<div class="form-row">' +
                '<div class="form-group">' +
                    '<label>Horario servicio (inicio \u2013 t\u00e9rmino)</label>' +
                    '<input type="text" class="form-control" id="tr-horarioServicio" value="' + (t.horarioServicio || '') + '" placeholder="20:30 \u2013 22:30">' +
                '</div>' +
                '<div class="form-group">' +
                    '<label>Montaje</label>' +
                    '<input type="text" class="form-control" id="tr-horarioMontaje" value="' + (t.horarioMontaje || '') + '" placeholder="09:00 \u2013 12:00">' +
                '</div>' +
                '<div class="form-group">' +
                    '<label>Desmontaje</label>' +
                    '<input type="text" class="form-control" id="tr-horarioDesmontaje" value="' + (t.horarioDesmontaje || '') + '" placeholder="22:30 \u2013 23:30">' +
                '</div>' +
            '</div>' +
            '<div class="form-group">' +
                '<label>Vestimenta</label>' +
                '<input type="text" class="form-control" id="tr-vestimenta" value="' + vest + '" placeholder="Negra sin logos (est\u00e1ndar MazeLab)">' +
            '</div>' +
            '<div class="form-group">' +
                '<label>Requerimientos especiales del cliente</label>' +
                '<textarea class="form-control" id="tr-requerimientos" rows="3" placeholder="Ej: nos entregan una figurita de mimbre, el holobox debe estar impecable...">' + (t.requerimientos || '') + '</textarea>' +
            '</div>' +
            '<div class="form-group">' +
                '<label>Nota de traspaso del vendedor</label>' +
                '<textarea class="form-control" id="tr-notaVendedor" rows="4" placeholder="Qu\u00e9 cerraste con el cliente, promesas, detalles que no est\u00e1n en el contrato...">' + (t.notaVendedor || '') + '</textarea>' +
            '</div>' +
            '<div style="display:flex;gap:var(--space-sm);margin-top:var(--space-md)">' +
                '<button class="btn-primary" id="tr-save-btn">Guardar traspaso</button>' +
                (complete ? '<button class="btn-secondary" id="tr-cancel-edit-btn">Cancelar</button>' : '') +
            '</div>';
    }

    function briefTextForClipboard(sale) {
        var t = sale.traspaso || {};
        var lines = [
            'BRIEF DE OPERACIONES — ' + (sale.eventName || '').toUpperCase(),
            '─'.repeat(40),
            'Cliente:      ' + (sale.clientName || '-'),
            'Fecha:        ' + formatDate(sale.eventDate),
            'Servicios:    ' + (sale.serviceNames || '-'),
            'Contacto:     ' + [t.contactoNombre, t.contactoTel, t.contactoEmail].filter(Boolean).join(' · '),
            'Lugar:        ' + (t.lugar || '-'),
            t.pax         ? 'PAX:          ' + t.pax : '',
            'Servicio:     ' + (t.horarioServicio || '-'),
            t.horarioMontaje    ? 'Montaje:      ' + t.horarioMontaje    : '',
            t.horarioDesmontaje ? 'Desmontaje:   ' + t.horarioDesmontaje : '',
            'Vestimenta:   ' + (t.vestimenta || 'Negra sin logos'),
            'Encargado:    ' + (sale.encargado || '-'),
            t.requerimientos ? '\nRequerimientos:\n' + t.requerimientos : '',
            t.notaVendedor   ? '\nNota vendedor:\n' + t.notaVendedor   : ''
        ].filter(Boolean).join('\n');
        return lines;
    }

    function renderBrief(sale) {
        var t = sale.traspaso || {};
        return '<div style="background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.2);border-radius:8px;padding:10px 14px;margin-bottom:var(--space-md);font-size:13px;color:var(--success)">Traspaso completo \u2014 brief listo para compartir.</div>' +
            '<div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:var(--space-lg);font-size:13px;line-height:1.8">' +
            '<table style="width:100%;border-collapse:collapse">' +
                briefRow('Cliente',        sale.clientName) +
                briefRow('Evento',         sale.eventName) +
                briefRow('Fecha',          formatDate(sale.eventDate)) +
                briefRow('Servicios',      sale.serviceNames) +
                briefRow('Contacto',       [t.contactoNombre, t.contactoTel, t.contactoEmail].filter(Boolean).join(' \u00b7 ')) +
                briefRow('Lugar',          t.lugar) +
                (t.pax ? briefRow('PAX', t.pax) : '') +
                briefRow('Servicio',       t.horarioServicio) +
                (t.horarioMontaje    ? briefRow('Montaje',    t.horarioMontaje)    : '') +
                (t.horarioDesmontaje ? briefRow('Desmontaje', t.horarioDesmontaje) : '') +
                briefRow('Vestimenta',     t.vestimenta || 'Negra sin logos') +
                (sale.encargado ? briefRow('Encargado',  sale.encargado) : '') +
                (t.requerimientos ? briefRow('Requerimientos', t.requerimientos) : '') +
                (t.notaVendedor   ? briefRow('Nota vendedor',  t.notaVendedor)   : '') +
            '</table>' +
            '</div>' +
            '<div style="display:flex;gap:var(--space-sm);margin-top:var(--space-md)">' +
                '<button class="btn-primary" id="tr-copy-brief-btn">Copiar brief</button>' +
                '<button class="btn-secondary" id="tr-edit-traspaso-btn">Editar</button>' +
            '</div>';
    }

    function briefRow(label, value) {
        if (!value) return '';
        return '<tr style="border-bottom:1px solid rgba(255,255,255,0.06)">' +
            '<td style="padding:7px 0;color:var(--text-muted);width:160px;vertical-align:top">' + label + '</td>' +
            '<td style="padding:7px 0;color:var(--text-primary);white-space:pre-wrap">' + value + '</td>' +
            '</tr>';
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

        var svcForSale = (sale.serviceIds || []).map(function (sid) {
            return services.find(function (sv) { return String(sv.id) === String(sid); });
        }).filter(Boolean);
        var hasSaludo = svcForSale.some(function (sv) { return sv.template_saludo; });

        var header = '<div class="kanban-detail-header">' +
            '<div style="display:flex;gap:var(--space-sm);flex-wrap:wrap">' +
                '<button class="btn-secondary" id="kb-back-btn">\u2190 Volver al Board</button>' +
                (hasSaludo ? '<button class="btn-primary" id="kb-generar-saludo-btn" style="font-size:12px">Generar saludo</button>' : '') +
                '<button class="btn-secondary" id="kb-remove-board-btn" style="font-size:12px;color:var(--text-muted);border-color:rgba(255,255,255,0.1)">Quitar del board</button>' +
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

        var traspasoComplete = isTraspasoComplete(sale);
        var traspasoLabel = 'Traspaso' + (!traspasoComplete ? ' \u26a0\ufe0f' : ' \u2713');

        var tabs = '<div class="tabs">' +
            [
                { id: 'traspaso', label: traspasoLabel },
                { id: 'info',     label: 'Info General' },
                { id: 'finanzas', label: 'Finanzas'     },
                { id: 'checklist',label: 'Checklist'    },
                { id: 'notas',    label: 'Notas'        }
            ].map(function (t) {
                return '<button class="tab' + (activeTab === t.id ? ' active' : '') + '" data-tab="' + t.id + '">' + t.label + '</button>';
            }).join('') +
            '</div>';

        var tabContent = '';
        if (activeTab === 'traspaso')   tabContent = renderDetailTraspaso(sale);
        else if (activeTab === 'info')       tabContent = renderDetailInfo(sale);
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
        updateSidebarBadge();
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

        // Alerts panel
        var alertsBtn = document.getElementById('kb-alerts-btn');
        if (alertsBtn) alertsBtn.addEventListener('click', openAlertsPanel);

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
                // Open traspaso tab if traspaso is not complete, else info
                var s = sales.find(function (x) { return String(x.id) === String(currentSaleId); });
                activeTab = (s && !isTraspasoComplete(s)) ? 'traspaso' : 'info';
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

        var saludoBtn = document.getElementById('kb-generar-saludo-btn');
        if (saludoBtn) saludoBtn.addEventListener('click', function () {
            openSaludoModal(sale);
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

        // Add custom checklist item
        document.querySelectorAll('.kb-cl-add').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var group = this.dataset.group;
                var input = document.querySelector('.kb-cl-new-input[data-group="' + group + '"]');
                var label = input ? input.value.trim() : '';
                if (!label) return;
                addCustomChecklistItem(sale, group, label);
            });
        });
        document.querySelectorAll('.kb-cl-new-input').forEach(function (inp) {
            inp.addEventListener('keydown', function (e) {
                if (e.key !== 'Enter') return;
                var group = this.dataset.group;
                var label = this.value.trim();
                if (!label) return;
                addCustomChecklistItem(sale, group, label);
            });
        });

        // Delete custom checklist item
        document.querySelectorAll('.kb-cl-delete').forEach(function (btn) {
            btn.addEventListener('click', function () {
                deleteCustomChecklistItem(sale, this.dataset.key);
            });
        });

        // Traspaso save
        var trSaveBtn = document.getElementById('tr-save-btn');
        if (trSaveBtn) trSaveBtn.addEventListener('click', function () {
            var fields = ['contactoNombre','contactoTel','contactoEmail','lugar','pax',
                          'horarioServicio','horarioMontaje','horarioDesmontaje','vestimenta',
                          'requerimientos','notaVendedor'];
            var data = {};
            fields.forEach(function (f) {
                var el = document.getElementById('tr-' + f);
                if (el) data[f] = el.value.trim();
            });
            traspasoEditMode = false;
            saveTraspaso(sale, data);
        });

        // Traspaso: cancel edit → back to brief
        var trCancelEdit = document.getElementById('tr-cancel-edit-btn');
        if (trCancelEdit) trCancelEdit.addEventListener('click', function () {
            traspasoEditMode = false;
            refreshContent();
        });

        // Traspaso: copy brief to clipboard
        var trCopyBtn = document.getElementById('tr-copy-brief-btn');
        if (trCopyBtn) trCopyBtn.addEventListener('click', function () {
            var text = briefTextForClipboard(sale);
            navigator.clipboard.writeText(text).then(function () {
                trCopyBtn.textContent = 'Copiado!';
                setTimeout(function () { if (trCopyBtn) trCopyBtn.textContent = 'Copiar brief'; }, 2000);
            }).catch(function () {
                // Fallback for older browsers
                var ta = document.createElement('textarea');
                ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
                document.body.appendChild(ta); ta.select(); document.execCommand('copy');
                document.body.removeChild(ta);
                trCopyBtn.textContent = 'Copiado!';
                setTimeout(function () { if (trCopyBtn) trCopyBtn.textContent = 'Copiar brief'; }, 2000);
            });
        });

        // Traspaso: edit button (from brief view)
        var trEditBtn = document.getElementById('tr-edit-traspaso-btn');
        if (trEditBtn) trEditBtn.addEventListener('click', function () {
            traspasoEditMode = true;
            refreshContent();
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

    async function saveTraspaso(sale, data) {
        sale.traspaso = data;
        try {
            await window.Mazelab.DataService.update('sales', sale.id, { traspaso: data });
            refreshContent();
        } catch (e) {
            alert('Error al guardar traspaso: ' + e.message);
        }
    }

    async function addCustomChecklistItem(sale, group, label) {
        var key = 'custom_' + Date.now();
        var cl = Array.isArray(sale.checklist) ? sale.checklist.slice() : [];
        cl.push({ key: key, label: label, group: group, checked: false, checkedAt: null });
        sale.checklist = cl;
        await window.Mazelab.DataService.update('sales', sale.id, { checklist: cl });
        refreshContent();
    }

    async function deleteCustomChecklistItem(sale, key) {
        var cl = Array.isArray(sale.checklist) ? sale.checklist.slice() : [];
        sale.checklist = cl.filter(function (c) { return c.key !== key; });
        await window.Mazelab.DataService.update('sales', sale.id, { checklist: sale.checklist });
        refreshContent();
    }

    // ---- saludo modal ----

    var DEFAULT_SALUDO_TEMPLATES = [
        {
            label: 'Saludo inicial',
            text: 'Hola {contacto}, te escribo de parte de MazeLab. Quedé a cargo de la coordinación de {servicio} para el evento de {cliente} el {fecha} en {lugar}.\n\nMe pongo en contacto para coordinar los detalles y asegurarme de que todo esté perfecto para el día del evento.\n\n¿Cuándo tienes disponibilidad para conversar?\n\nSaludos,\n{encargado}\nMazeLab'
        },
        {
            label: 'Con solicitud de diseño',
            text: 'Hola {contacto}, te escribo de parte de MazeLab por el evento de {cliente} el {fecha}.\n\nPara preparar {servicio} necesitamos que nos envíes los archivos de diseño/branding con al menos 5 días de anticipación al evento.\n\n¿Puedes confirmarme el formato y si ya lo tienes en proceso?\n\nSaludos,\n{encargado}\nMazeLab'
        },
        {
            label: 'Confirmación de llegada',
            text: 'Hola {contacto}, te confirmamos que el equipo de MazeLab llegará al evento de {cliente} el {fecha} en {lugar} a la hora de montaje acordada.\n\nTe pedimos que nos tengan un punto de corriente asignado cerca del área de instalación.\n\nCualquier consulta estamos disponibles.\n\nSaludos,\n{encargado}\nMazeLab'
        }
    ];

    function fillTemplate(tpl, sale) {
        var t = sale.traspaso || {};
        return (tpl || '')
            .replace(/\{contacto\}/g,   t.contactoNombre || '[nombre contacto]')
            .replace(/\{cliente\}/g,    sale.clientName  || '[cliente]')
            .replace(/\{evento\}/g,     sale.eventName   || '[evento]')
            .replace(/\{fecha\}/g,      formatDate(sale.eventDate))
            .replace(/\{lugar\}/g,      t.lugar          || '[lugar]')
            .replace(/\{encargado\}/g,  sale.encargado   || 'el equipo de MazeLab')
            .replace(/\{servicio\}/g,   sale.serviceNames || '[servicio]');
    }

    function openSaludoModal(sale) {
        var svcForSale = (sale.serviceIds || []).map(function (sid) {
            return services.find(function (sv) { return String(sv.id) === String(sid); });
        }).filter(Boolean);

        var customTemplates = svcForSale.filter(function (sv) { return sv.template_saludo; }).map(function (sv) {
            return { label: sv.name, text: sv.template_saludo };
        });

        // Merge: custom service templates first, then defaults
        var allTemplates = customTemplates.concat(DEFAULT_SALUDO_TEMPLATES);

        function buildContent(idx) {
            var msg = fillTemplate(allTemplates[idx].text, sale);
            var presetBtns = allTemplates.map(function (tpl, i) {
                return '<button class="kb-saludo-preset' + (i === idx ? ' active' : '') + '" data-tpl-idx="' + i + '" style="font-size:11px;padding:4px 10px;border-radius:20px;border:1px solid rgba(255,255,255,' + (i === idx ? '0.4' : '0.15') + ');background:' + (i === idx ? 'rgba(255,255,255,0.12)' : 'transparent') + ';color:var(--text-secondary);cursor:pointer;white-space:nowrap">' + tpl.label + '</button>';
            }).join('');
            return '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-md)">' +
                '<strong style="font-size:15px">Saludo \u2014 ' + (sale.clientName || 'cliente') + '</strong>' +
                '<button id="kb-saludo-close" style="background:none;border:none;font-size:22px;color:var(--text-muted);cursor:pointer;line-height:1">&times;</button>' +
            '</div>' +
            '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">Elige una base y edita libremente antes de copiar:</div>' +
            '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:var(--space-md)" id="kb-saludo-presets">' + presetBtns + '</div>' +
            '<textarea id="kb-saludo-text" class="form-control" rows="13" style="font-size:13px;line-height:1.7;resize:vertical">' + msg + '</textarea>' +
            '<div style="display:flex;gap:var(--space-sm);margin-top:var(--space-md)">' +
                '<button class="btn-primary" id="kb-saludo-copy">Copiar mensaje</button>' +
                '<button class="btn-secondary" id="kb-saludo-close2">Cerrar</button>' +
            '</div>';
        }

        // Build overlay
        var wrapper = document.createElement('div');
        wrapper.id = 'kb-saludo-wrapper';
        wrapper.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:1000;display:flex;align-items:center;justify-content:center';
        var panel = document.createElement('div');
        panel.style.cssText = 'background:#1e1b2e;border:1px solid rgba(255,255,255,0.12);border-radius:14px;padding:28px;width:min(620px,96vw);max-height:90vh;overflow-y:auto;display:flex;flex-direction:column';
        panel.innerHTML = buildContent(0);
        wrapper.appendChild(panel);
        document.body.appendChild(wrapper);

        function close() { var el = document.getElementById('kb-saludo-wrapper'); if (el) el.remove(); }
        function getCurrentMsg() { var ta = document.getElementById('kb-saludo-text'); return ta ? ta.value : ''; }

        // Close on backdrop click
        wrapper.addEventListener('click', function (e) { if (e.target === wrapper) close(); });

        // Use event delegation on panel only — no propagation surprises
        panel.addEventListener('click', function (e) {
            var t = e.target;
            if (t.id === 'kb-saludo-close' || t.id === 'kb-saludo-close2') { close(); return; }
            if (t.id === 'kb-saludo-copy') {
                var text = getCurrentMsg();
                navigator.clipboard.writeText(text).catch(function () {
                    var ta2 = document.createElement('textarea');
                    ta2.value = text; ta2.style.cssText = 'position:fixed;opacity:0';
                    document.body.appendChild(ta2); ta2.select(); document.execCommand('copy'); document.body.removeChild(ta2);
                });
                t.textContent = '\u2713 Copiado!';
                setTimeout(function () { if (t) t.textContent = 'Copiar mensaje'; }, 2000);
                return;
            }
            var tplIdx = t.dataset.tplIdx;
            if (tplIdx !== undefined) {
                panel.innerHTML = buildContent(Number(tplIdx));
            }
        });
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
