window.Mazelab = window.Mazelab || {};
window.Mazelab.Modules = window.Mazelab.Modules || {};

window.Mazelab.Modules.KanbanModule = (function () {

    // ---- state ----
    var sales = [], receivables = [], payables = [], clients = [], services = [], staff = [];
    var currentSaleId = null;
    var activeTab = 'resumen';
    var traspasoEditMode = false; // false = show brief when complete, true = show form
    var activeBoard = 'pre';   // 'pre' | 'post'
    var postYearMin = '2026';  // default year filter for post board
    var dragSaleId = null;
    var filters = { client: '', service: '', seller: '', financial: '' };
    var bodegaEquipos = [];

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

    // ---- hitos definitions ----

    var PRE_HITOS = [
        { key: 'traspaso',         label: 'Traspaso de venta' },
        { key: 'pre_coordinacion', label: 'Contacto con cliente' },
        { key: 'pre_diseno_ok',    label: 'Dise\u00f1o aprobado' },
        { key: 'pre_logistica',    label: 'Log\u00edstica confirmada' },
        { key: 'pre_nomina_env',   label: 'N\u00f3mina lista' },
        { key: 'pre_nomina_cap',   label: 'Personal capacitado' },
        { key: 'pre_freelances',   label: 'N\u00f3mina enviada al cliente' },
        { key: 'pre_equipos',      label: 'Equipos configurados' },
        { key: 'pre_material',     label: 'Materiales/insumos', optional: true },
        { key: 'pre_desarrollo',   label: 'Desarrollo/software', optional: true },
        { key: 'pre_visita',       label: 'Visita t\u00e9cnica al venue', optional: true }
    ];

    var POST_HITOS = [
        { key: 'hito_ejecutado', label: 'Evento ejecutado' },
        { key: 'post_contenido', label: 'Contenido enviado al cliente', skipForActivacion: true },
        { key: 'post_feedback',  label: 'Feedback recibido del cliente' },
        { key: 'post_repo',      label: 'Material en repositorio' },
        { key: 'hito_factura',   label: 'Factura emitida' },
        { key: 'hito_cobro',     label: 'Cobro completo' },
        { key: 'hito_cxp',       label: 'CXP pagados' }
    ];

    // ---- helpers ----

    function escapeHtml(s) {
        if (!s) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function formatCLP(n) {
        if (n == null || isNaN(n)) return '$0';
        var abs = Math.abs(Math.round(n));
        var s = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return (n < 0 ? '-$' : '$') + s;
    }

    // Parse date string as LOCAL (not UTC)
    function parseLocalDate(str) {
        if (!str) return null;
        var parts = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (parts) return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
        return new Date(str);
    }

    function formatDate(d) {
        if (!d) return '-';
        var dt = parseLocalDate(d);
        if (!dt || isNaN(dt)) return String(d);
        return dt.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    function formatShortDate(d) {
        if (!d) return '';
        var dt = parseLocalDate(d);
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

    // ---- hitos progress ----

    function getHitoStatus(sale) {
        var board = getBoardForSale(sale);
        var cl = sale.checklist || [];
        var defs = board === 'pre' ? PRE_HITOS : POST_HITOS;

        var hitos = defs.map(function (h) {
            var clItem = cl.find(function (i) { return i.key === h.key; });
            var done = false;
            var na = clItem ? !!clItem.na : false;

            if (h.key === 'traspaso') {
                done = isTraspasoComplete(sale);
            } else if (h.key === 'hito_ejecutado') {
                done = Number(sale.boardColumn) >= 4;
            } else if (h.key === 'hito_factura') {
                done = getCXCSummary(getEventCXC(sale)).invoiced > 0;
            } else if (h.key === 'hito_cobro') {
                var cs = getCXCSummary(getEventCXC(sale));
                done = cs.pct !== null && cs.pct >= 0.99;
            } else if (h.key === 'hito_cxp') {
                var ps = getCXPSummary(getEventCXP(sale));
                done = ps.pct !== null && ps.pct >= 0.99;
            } else if (h.skipForActivacion && isActivacion(sale)) {
                na = true;
            } else {
                done = clItem ? !!(clItem.done || clItem.checked) : false;
            }
            return { key: h.key, label: h.label, done: done, na: na, optional: !!h.optional };
        });

        var applicable = hitos.filter(function (h) { return !h.na; });
        var doneCount = applicable.filter(function (h) { return h.done; }).length;
        return { hitos: hitos, done: doneCount, total: applicable.length, pct: applicable.length ? doneCount / applicable.length : 0 };
    }

    function renderHitosBar(sale) {
        var hs = getHitoStatus(sale);
        var board = getBoardForSale(sale);
        var pct = hs.pct;
        var allDone = hs.done === hs.total && hs.total > 0;
        var barColor = allDone ? '#4ade80' : pct >= 0.6 ? '#a78bfa' : pct >= 0.3 ? '#fb923c' : '#f87171';
        var label = board === 'pre' ? 'pre-evento' : 'post-evento';
        return '<div style="margin:10px 0 0 0;display:flex;align-items:center;gap:10px">' +
            '<div style="flex:1;height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden">' +
                '<div style="height:100%;width:' + Math.round(pct * 100) + '%;background:' + barColor + ';border-radius:3px;transition:width 0.4s"></div>' +
            '</div>' +
            '<span style="font-size:12px;color:' + barColor + ';font-weight:700;white-space:nowrap">' +
                hs.done + '/' + hs.total + ' hitos ' + label +
                (allDone ? ' \uD83C\uDF89' : '') +
            '</span>' +
        '</div>';
    }

    function fireConfetti() {
        var colors = ['#a78bfa','#4ade80','#fb923c','#f87171','#facc15','#38bdf8'];
        for (var i = 0; i < 60; i++) {
            (function(i) {
                setTimeout(function() {
                    var el = document.createElement('div');
                    el.style.cssText = 'position:fixed;top:-10px;left:' + Math.random() * 100 + 'vw;width:8px;height:8px;border-radius:2px;background:' + colors[Math.floor(Math.random() * colors.length)] + ';z-index:9999;pointer-events:none;animation:confettiFall ' + (1.2 + Math.random() * 0.8) + 's linear forwards';
                    document.body.appendChild(el);
                    setTimeout(function() { el.remove(); }, 2200);
                }, i * 30);
            })(i);
        }
        if (!document.getElementById('confetti-style')) {
            var s = document.createElement('style');
            s.id = 'confetti-style';
            s.textContent = '@keyframes confettiFall{0%{transform:translateY(0) rotate(0deg);opacity:1}100%{transform:translateY(110vh) rotate(720deg);opacity:0}}';
            document.head.appendChild(s);
        }
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

    function generateAlerts() {
        var today = new Date(todayStr());
        var todayS = todayStr();
        var alerts = [];

        // Only consider sales on the board (columns 1-6, not 99/removed)
        var boardSales = sales.filter(function (s) {
            var col = Number(s.boardColumn);
            return col >= 1 && col <= 6;
        });

        boardSales.forEach(function (s) {
            var cl = s.checklist || [];
            var done = function (key) {
                return cl.some(function (c) { return c.key === key && c.done; });
            };
            var eventName = s.eventName || '-';

            // Days until event (positive = future, negative = past)
            var daysToEvent = null;
            if (s.eventDate) {
                daysToEvent = Math.ceil((parseLocalDate(s.eventDate) - today) / (1000 * 60 * 60 * 24));
            }

            // 1. sin_contacto (media): traspaso exists but pre_coordinacion not done, 3+ days since traspaso
            if (s.traspaso && s.traspaso.contactoNombre && !done('pre_coordinacion')) {
                var traspasoDate = s.traspaso.savedAt || s.traspaso.timestamp || s.updatedAt || null;
                var daysSinceTraspaso = null;
                if (traspasoDate) {
                    daysSinceTraspaso = Math.ceil((today - new Date(traspasoDate)) / (1000 * 60 * 60 * 24));
                }
                // Fire if 3+ days since traspaso, OR if no timestamp but event is within 14 days
                if ((daysSinceTraspaso !== null && daysSinceTraspaso >= 3) ||
                    (daysSinceTraspaso === null && daysToEvent !== null && daysToEvent <= 14)) {
                    var sinContactoDays = daysSinceTraspaso !== null ? daysSinceTraspaso : '?';
                    alerts.push({
                        type: 'sin_contacto',
                        severity: 'media',
                        message: 'Sin contacto al cliente hace ' + sinContactoDays + ' dias',
                        saleId: s.id,
                        eventName: eventName,
                        daysInfo: typeof daysSinceTraspaso === 'number' ? daysSinceTraspaso : 999,
                        sale: s
                    });
                }
            }

            // Rules 2-4 only apply to future events (including today)
            if (daysToEvent !== null && daysToEvent >= 0) {
                // 2. sin_diseno (alta): event within 7 days, design not approved
                if (daysToEvent <= 7 && !done('pre_diseno_ok')) {
                    alerts.push({
                        type: 'sin_diseno',
                        severity: 'alta',
                        message: 'Diseno no aprobado a ' + daysToEvent + ' dias del evento',
                        saleId: s.id,
                        eventName: eventName,
                        daysInfo: daysToEvent,
                        sale: s
                    });
                }

                // 3. sin_nomina (alta): event within 5 days, nomina not confirmed
                if (daysToEvent <= 5 && !done('pre_nomina_env')) {
                    alerts.push({
                        type: 'sin_nomina',
                        severity: 'alta',
                        message: 'Nomina no confirmada a ' + daysToEvent + ' dias del evento',
                        saleId: s.id,
                        eventName: eventName,
                        daysInfo: daysToEvent,
                        sale: s
                    });
                }

                // 4. sin_equipos (media): event within 3 days, no equipos assigned
                if (daysToEvent <= 3) {
                    var eqList = s.equiposAsignados || [];
                    var hasAssigned = eqList.some(function (eq) { return !!eq.equipoId; });
                    if (eqList.length === 0 || !hasAssigned) {
                        alerts.push({
                            type: 'sin_equipos',
                            severity: 'media',
                            message: 'Equipos no asignados a ' + daysToEvent + ' dias del evento',
                            saleId: s.id,
                            eventName: eventName,
                            daysInfo: daysToEvent,
                            sale: s
                        });
                    }
                }
            }

            // 5. no_retornado (alta): event date passed (1+ day ago), has equipos with retornado===false
            if (daysToEvent !== null && daysToEvent <= -1) {
                var eqAssigned = s.equiposAsignados || [];
                var noRetorno = eqAssigned.filter(function (eq) {
                    return eq.equipoId && eq.retornado === false;
                });
                if (noRetorno.length > 0) {
                    alerts.push({
                        type: 'no_retornado',
                        severity: 'alta',
                        message: noRetorno.length + ' equipos sin retorno desde evento',
                        saleId: s.id,
                        eventName: eventName,
                        daysInfo: Math.abs(daysToEvent),
                        sale: s
                    });
                }
            }
        });

        // Sort: alta first, then media, then baja; within same severity, lowest daysInfo first
        var order = { alta: 0, media: 1, baja: 2 };
        alerts.sort(function (a, b) {
            var oa = order[a.severity] != null ? order[a.severity] : 9;
            var ob = order[b.severity] != null ? order[b.severity] : 9;
            if (oa !== ob) return oa - ob;
            return a.daysInfo - b.daysInfo;
        });
        return alerts;
    }

    // Backward-compat alias used by other functions
    var computeAlerts = generateAlerts;

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

    function renderAlertsPanel() {
        openAlertsPanel();
    }

    function openAlertsPanel() {
        var alerts = generateAlerts();
        var sevMeta = {
            alta:  { label: 'Alta',  color: '#f87171', bg: 'rgba(248,113,113,0.12)', icon: '\u26a0' },
            media: { label: 'Media', color: '#fb923c', bg: 'rgba(251,146,60,0.12)',  icon: '\u25cf' },
            baja:  { label: 'Baja',  color: '#facc15', bg: 'rgba(250,204,21,0.12)',  icon: '\u25cb' }
        };

        var rows = alerts.length === 0
            ? '<div style="text-align:center;padding:32px;color:var(--text-secondary)">No hay alertas activas.</div>'
            : alerts.map(function (a) {
                var m = sevMeta[a.severity] || sevMeta.media;
                return '<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:8px;background:' + m.bg + ';margin-bottom:8px;cursor:pointer" class="kb-alert-row" data-sale-id="' + a.saleId + '">' +
                    '<span style="width:72px;text-align:center;font-size:11px;font-weight:700;color:' + m.color + ';background:' + m.bg + ';border:1px solid ' + m.color + '44;border-radius:12px;padding:2px 6px;white-space:nowrap">' + m.icon + ' ' + m.label + '</span>' +
                    '<div style="flex:1;min-width:0">' +
                        '<div style="font-weight:600;font-size:0.9rem">' + escapeHtml(a.message) + '</div>' +
                        '<div style="font-size:0.8rem;color:var(--text-secondary)">' + escapeHtml(a.eventName) + ' · ' + escapeHtml(a.sale.clientName || '') + '</div>' +
                    '</div>' +
                    '<span style="font-size:0.8rem;color:' + m.color + ';font-weight:600;white-space:nowrap">' + (a.type === 'no_retornado' ? a.daysInfo + 'd pasado' : a.daysInfo + 'd') + '</span>' +
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
                activeTab = 'resumen';
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

    function getContactSuggestions() {
        var map = {};
        sales.forEach(function (s) {
            var t = s.traspaso || {};
            if (t.contactoNombre) map[t.contactoNombre] = true;
        });
        return Object.keys(map).sort().map(function (n) {
            return '<option value="' + escapeHtml(n) + '">';
        }).join('');
    }

    function getBusyEquipoIds(forSaleId, forEventDate, forTraspaso) {
        var busy = {};
        var tFor = forTraspaso || {};
        var forDates = tFor.eventDates && tFor.eventDates.length ? tFor.eventDates : null;
        var forStart = forEventDate || '';
        var forEnd   = tFor.eventDateFin || forStart;

        function datesOverlap(s) {
            var tOther = s.traspaso || {};
            var otherDates = tOther.eventDates && tOther.eventDates.length ? tOther.eventDates : null;
            var otherStart = s.eventDate || '';
            var otherEnd   = tOther.eventDateFin || otherStart;
            if (!otherStart && !otherDates) return false;
            // Both use specific dates list: any date in common?
            if (forDates && otherDates) {
                return forDates.some(function (d) { return otherDates.indexOf(d) !== -1; });
            }
            // For event uses specific dates: check any date against other's range
            if (forDates) {
                return forDates.some(function (d) { return d >= otherStart && d <= otherEnd; });
            }
            // Other uses specific dates: check any date against our range
            if (otherDates) {
                return otherDates.some(function (d) { return d >= forStart && d <= forEnd; });
            }
            // Both use ranges: standard overlap
            if (!forStart || !otherStart) return false;
            return forStart <= otherEnd && otherStart <= forEnd;
        }

        sales.forEach(function (s) {
            if (String(s.id) === String(forSaleId)) return;
            if (!datesOverlap(s)) return;
            (s.equiposAsignados || []).forEach(function (a) {
                if (a.equipoId && !a.retornado) busy[String(a.equipoId)] = s.eventName || '?';
            });
        });
        return busy;
    }

    // Smart category matching: "Cámara" → equipos en categoría "Cámaras"
    function getEquiposForItem(itemLabel, allEquipos) {
        function norm(s) {
            return (s || '').toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .replace(/es$/, '').replace(/s$/, '');
        }
        var words = norm(itemLabel).split(/\s+/).filter(function (w) { return w.length >= 4; });
        if (words.length === 0) return { list: allEquipos, matchedCat: null };
        var byCat = allEquipos.filter(function (eq) {
            var cat = norm(eq.categoria || '');
            return cat && words.some(function (w) { return cat.indexOf(w) !== -1 || w.indexOf(cat) !== -1; });
        });
        if (byCat.length > 0) return { list: byCat, matchedCat: byCat[0].categoria || null };
        var byName = allEquipos.filter(function (eq) {
            var nom = norm(eq.nombre || '');
            return words.some(function (w) { return nom.indexOf(w) !== -1; });
        });
        return { list: byName.length > 0 ? byName : allEquipos, matchedCat: null };
    }

    function initEquiposFromTemplates(sale) {
        var items = [];
        var now = Date.now();
        // Build list of matching services: by serviceIds, fallback by name match
        var matchedServices = services.filter(function (sv) {
            if (!sv.equipos_checklist) return false;
            var svName = (sv.name || sv.nombre || '').toLowerCase();
            var byId = (sale.serviceIds || []).some(function (sid) { return String(sid) === String(sv.id); });
            var byName = svName && (sale.serviceNames || '').toLowerCase().indexOf(svName) !== -1;
            return byId || byName;
        });
        matchedServices.forEach(function (sv) {
            // Parse JSON format [{categoria, label}], fall back to line-based text
            var tplItems = [];
            try {
                var parsed = JSON.parse(sv.equipos_checklist);
                if (Array.isArray(parsed)) tplItems = parsed;
            } catch(e) {
                tplItems = String(sv.equipos_checklist).split('\n')
                    .map(function (l) { return { label: l.trim(), categoria: '' }; })
                    .filter(function (i) { return i.label; });
            }
            tplItems.forEach(function (tpl, idx) {
                items.push({
                    itemId: 'item_' + (now + idx),
                    label: tpl.label,
                    categoria: tpl.categoria || '',
                    serviceId: String(sv.id),
                    serviceName: sv.name || sv.nombre || '',
                    equipoId: null,
                    equipoDisplayId: null,
                    equipoNombre: null,
                    estadoSalida: 'bueno',
                    retornado: false,
                    estadoRetorno: null,
                    notaRetorno: ''
                });
            });
        });
        return items;
    }

    function collectEquiposFromDOM(sale) {
        var items = JSON.parse(JSON.stringify(sale.equiposAsignados || []));
        document.querySelectorAll('.kb-eq-equipo-inp').forEach(function (inp) {
            var itemId = inp.dataset.itemId;
            var item = items.find(function (i) { return i.itemId === itemId; });
            if (!item) return;
            var val = (inp.value || '').trim();
            if (!val) {
                item.equipoId = null; item.equipoDisplayId = null; item.equipoNombre = null;
            } else {
                // Parse "[CODE] Name" format from datalist
                var match = val.match(/^\[([^\]]+)\]\s*(.*)/);
                if (match) {
                    var code = match[1];
                    var eq = bodegaEquipos.find(function (e) { return (e.equipo_id || '') === code; });
                    if (eq) {
                        item.equipoId = eq.id;
                        item.equipoDisplayId = eq.equipo_id || '';
                        item.equipoNombre = eq.nombre || '';
                    } else {
                        item.equipoId = null; item.equipoDisplayId = code; item.equipoNombre = match[2] || '';
                    }
                } else {
                    // Try name match
                    var eq2 = bodegaEquipos.find(function (e) { return (e.nombre || '').toLowerCase() === val.toLowerCase(); });
                    if (eq2) {
                        item.equipoId = eq2.id; item.equipoDisplayId = eq2.equipo_id || ''; item.equipoNombre = eq2.nombre || '';
                    } else {
                        item.equipoId = null; item.equipoDisplayId = null; item.equipoNombre = null;
                    }
                }
            }
        });
        document.querySelectorAll('.kb-eq-estado-sal').forEach(function (sel) {
            var itemId = sel.dataset.itemId;
            var item = items.find(function (i) { return i.itemId === itemId; });
            if (item) item.estadoSalida = sel.value;
        });
        return items;
    }

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

    function getCardAlertChips(sale) {
        var chips = [];
        var board = getBoardForSale(sale);
        var di = getDaysInfo(sale);
        var cl = sale.checklist || [];
        var done = function (key) {
            var item = cl.find(function (i) { return i.key === key; });
            return !!(item && (item.checked || item.done));
        };

        if (board === 'pre') {
            var complete = isTraspasoComplete(sale);
            var minimo = isTraspasoMinimo(sale);
            if (di.days !== null && di.days <= 14) {
                if (!minimo && !complete) {
                    chips.push({ label: 'Sin traspaso', color: '#f87171', bg: 'rgba(248,113,113,0.15)' });
                } else if (!complete) {
                    chips.push({ label: 'Traspaso parcial', color: '#fb923c', bg: 'rgba(251,146,60,0.15)' });
                }
            }
            if (di.days !== null && di.days <= 7 && !done('pre_diseno_ok')) {
                chips.push({ label: 'Sin dise\u00f1o', color: '#facc15', bg: 'rgba(250,204,21,0.15)' });
            }
            if (di.days !== null && di.days <= 5 && !done('pre_nomina_env')) {
                chips.push({ label: 'Sin n\u00f3mina', color: '#fb923c', bg: 'rgba(251,146,60,0.15)' });
            }
        } else {
            var cxc = getCXCSummary(getEventCXC(sale));
            if (cxc.totalOwed === 0) {
                chips.push({ label: 'Sin fact', color: '#f87171', bg: 'rgba(248,113,113,0.15)' });
            } else if (cxc.pct !== null && cxc.pct < 0.9999) {
                chips.push({ label: 'Cobro pendiente', color: '#facc15', bg: 'rgba(250,204,21,0.15)' });
            }
        }
        return chips.slice(0, 3);
    }

    function renderCard(sale) {
        var displayId = sale.sourceId || String(sale.id || '').slice(-6);
        var col = Number(sale.boardColumn);
        var prog = getChecklistProgress(sale);
        var board = getBoardForSale(sale);
        var minCol = board === 'pre' ? 1 : 4;
        var maxCol = board === 'pre' ? 3 : 6;
        var di = getDaysInfo(sale);
        var urgencyBorder = activeBoard === 'pre' ? getCardUrgencyBorder(sale) : '';
        var progColor = prog.pct >= 0.7 ? 'var(--success)' : (prog.pct > 0.3 ? 'var(--warning)' : 'var(--danger)');

        // Services as small tags (with fallback to serviceIds lookup)
        var svcNames = getSaleServiceNames(sale);
        var svcTags = svcNames
            ? '<div class="kanban-card-svc-tags">' +
                svcNames.split(',').map(function (s) {
                    return '<span class="kanban-svc-tag">' + s.trim() + '</span>';
                }).join('') +
              '</div>'
            : '';

        // Alert chips
        var alertChips = getCardAlertChips(sale);
        var chipsHtml = alertChips.length > 0
            ? '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:5px">' +
                alertChips.map(function (c) {
                    return '<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;background:' + c.bg + ';color:' + c.color + ';border:1px solid ' + c.color + '55">! ' + c.label + '</span>';
                }).join('') +
              '</div>'
            : '';

        return '<div class="kanban-card" draggable="true" data-sale-id="' + sale.id + '" style="' + urgencyBorder + '">' +
            '<div class="kanban-card-top">' +
                '<span class="kanban-card-id">#' + displayId + '</span>' +
                (di.label ? '<span style="font-size:11px;font-weight:600;color:' + di.color + '">\u23f1 ' + di.label + '</span>' : '') +
            '</div>' +
            '<div class="kanban-card-client">' + (sale.clientName || '-') + '</div>' +
            '<div class="kanban-card-title">' + (sale.eventName || '-') + '</div>' +
            '<div class="kanban-card-date" style="font-size:12px;color:var(--text-muted);margin-bottom:4px">' + formatDate(sale.eventDate) + '</div>' +
            svcTags +
            chipsHtml +
            '<div class="kanban-card-footer" style="margin-top:8px">' +
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
        var amount = Number(sale.amount || 0);
        var totalCost = cxp.totalAmount;
        var margin = amount - totalCost;
        var marginPct = amount > 0 ? (margin / amount) * 100 : null;

        var kpiGrid = '<div class="kpi-grid" style="margin-bottom:var(--space-xl)">' +
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

        return kpiGrid + cxcBlock + cxpBlock;
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

    function isTraspasoMinimo(sale) {
        var t = sale.traspaso || {};
        return !!(t.contactoNombre && (t.contactoTel || t.contactoEmail));
    }

    function getSaleServiceNames(sale) {
        if (sale.serviceNames) return sale.serviceNames;
        return (sale.serviceIds || []).map(function (sid) {
            var sv = services.find(function (s) { return String(s.id) === String(sid); });
            return sv ? sv.name : null;
        }).filter(Boolean).join(', ') || '';
    }

    function renderTrDateModeContent(mode, eventDate, t) {
        if (mode === 'dia') {
            return '<div style="font-size:13px;color:var(--text-muted);padding:6px 0">Usando la fecha principal del evento: <strong style="color:var(--text-primary)">' + formatDate(eventDate) + '</strong></div>';
        }
        if (mode === 'periodo') {
            return '<div style="display:flex;gap:8px;align-items:center">' +
                '<span style="font-size:13px;color:var(--text-muted)">Desde ' + formatDate(eventDate) + ' hasta</span>' +
                '<input type="date" class="form-control" id="tr-eventDateFin" value="' + (t.eventDateFin || '') + '" style="width:180px;color:var(--text-primary);background:var(--bg-secondary)">' +
            '</div>';
        }
        // especificas
        var dates = t.eventDates || [];
        var dateItems = dates.map(function (d) {
            return '<div class="tr-date-item" data-date="' + escapeHtml(d) + '" style="display:inline-flex;align-items:center;gap:4px;background:rgba(167,139,250,0.12);border:1px solid rgba(167,139,250,0.3);border-radius:12px;padding:2px 8px;margin:2px;font-size:12px;color:#a78bfa">' +
                escapeHtml(formatDate(d)) +
                '<button type="button" class="tr-date-del-btn" data-date="' + escapeHtml(d) + '" style="background:none;border:none;color:#f87171;cursor:pointer;font-size:14px;padding:0 0 0 4px;line-height:1">&times;</button>' +
            '</div>';
        }).join('');
        return '<div id="tr-date-pills" style="margin-bottom:8px;min-height:28px">' + (dateItems || '<span style="font-size:13px;color:var(--text-muted)">Ninguna fecha agregada.</span>') + '</div>' +
            '<div style="display:flex;gap:6px;align-items:center">' +
                '<input type="date" id="tr-date-add-input" class="form-control" style="width:170px;color:var(--text-primary);background:var(--bg-secondary)">' +
                '<button type="button" id="tr-date-add-btn" style="height:34px;padding:0 12px;font-size:13px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:var(--text-secondary);cursor:pointer">+ Agregar</button>' +
            '</div>';
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

        var contactoSuggestions = getContactSuggestions();
        return banner +
            '<datalist id="tr-contactos-list">' + contactoSuggestions + '</datalist>' +
            '<div class="form-row">' +
                '<div class="form-group">' +
                    '<label>Contacto en terreno \u2014 Nombre</label>' +
                    '<input type="text" class="form-control" id="tr-contactoNombre" list="tr-contactos-list" value="' + (t.contactoNombre || '') + '" placeholder="Ej: Paola Riquelme">' +
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
            (() => {
                var dateMode = (t.eventDates && t.eventDates.length) ? 'especificas' : (t.eventDateFin ? 'periodo' : 'dia');
                var btnBase = 'border-radius:6px;padding:4px 12px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid rgba(255,255,255,0.15);';
                var btnActive = btnBase + 'background:rgba(167,139,250,0.2);color:#a78bfa;border-color:rgba(167,139,250,0.4);';
                var btnInactive = btnBase + 'background:rgba(255,255,255,0.05);color:var(--text-muted);';
                return '<div class="form-group">' +
                    '<label>Fechas del evento <span style="font-weight:400;color:var(--text-muted)">(para conflictos de bodega)</span></label>' +
                    '<div style="display:flex;gap:4px;margin-bottom:8px">' +
                        '<button type="button" class="tr-date-mode-btn" data-mode="dia" style="' + (dateMode === 'dia' ? btnActive : btnInactive) + '">1 d\u00eda</button>' +
                        '<button type="button" class="tr-date-mode-btn" data-mode="periodo" style="' + (dateMode === 'periodo' ? btnActive : btnInactive) + '">Per\u00edodo</button>' +
                        '<button type="button" class="tr-date-mode-btn" data-mode="especificas" style="' + (dateMode === 'especificas' ? btnActive : btnInactive) + '">Fechas espec\u00edficas</button>' +
                    '</div>' +
                    '<div id="tr-date-mode-content">' + renderTrDateModeContent(dateMode, sale.eventDate, t) + '</div>' +
                    '<input type="hidden" id="tr-date-mode" value="' + dateMode + '">' +
                    '<input type="hidden" id="tr-eventDates" value="' + escapeHtml(JSON.stringify(t.eventDates || [])) + '">' +
                '</div>';
            })() +
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
        var parts = [];
        parts.push('BRIEF DE OPERACIONES');
        parts.push((sale.eventName || '').toUpperCase());
        parts.push('');
        parts.push('Cliente: ' + (sale.clientName || '-'));
        parts.push('Fecha: ' + formatDate(sale.eventDate));
        if (t.eventDates && t.eventDates.length) parts.push('Fechas: ' + t.eventDates.map(formatDate).join(', '));
        else if (t.eventDateFin) parts.push('Hasta: ' + formatDate(t.eventDateFin));
        parts.push('Servicios: ' + (getSaleServiceNames(sale) || '-'));
        if (sale.jornadas) parts.push('Jornadas: ' + sale.jornadas);
        parts.push('');
        parts.push('Contacto: ' + [t.contactoNombre, t.contactoTel, t.contactoEmail].filter(Boolean).join(' / '));
        parts.push('Lugar: ' + (t.lugar || '-'));
        if (t.pax) parts.push('PAX: ' + t.pax);
        parts.push('');
        parts.push('Horario servicio: ' + (t.horarioServicio || '-'));
        if (t.horarioMontaje) parts.push('Horario montaje: ' + t.horarioMontaje);
        if (t.horarioDesmontaje) parts.push('Horario desmontaje: ' + t.horarioDesmontaje);
        parts.push('Vestimenta: ' + (t.vestimenta || 'Negra sin logos'));
        parts.push('Encargado: ' + (sale.encargado || '-'));
        if (t.requerimientos) { parts.push(''); parts.push('Requerimientos:'); parts.push(t.requerimientos); }
        if (t.notaVendedor) { parts.push(''); parts.push('Nota vendedor:'); parts.push(t.notaVendedor); }
        if (sale.comments) { parts.push(''); parts.push('Comentarios venta:'); parts.push(sale.comments); }
        return parts.join('\n');
    }

    function renderBrief(sale) {
        var t = sale.traspaso || {};
        return '<div style="background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.2);border-radius:8px;padding:10px 14px;margin-bottom:var(--space-md);font-size:13px;color:var(--success)">Traspaso completo \u2014 brief listo para compartir.</div>' +
            '<div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:var(--space-lg);font-size:13px;line-height:1.8">' +
            '<table style="width:100%;border-collapse:collapse">' +
                briefRow('Cliente',        sale.clientName) +
                briefRow('Evento',         sale.eventName) +
                briefRow('Fecha',          formatDate(sale.eventDate)) +
                briefRow('Servicios',      getSaleServiceNames(sale)) +
                (sale.jornadas ? briefRow('Jornadas', sale.jornadas) : '') +
                (t.eventDates && t.eventDates.length ? briefRow('Fechas', t.eventDates.map(formatDate).join(', ')) : (t.eventDateFin ? briefRow('Hasta', formatDate(t.eventDateFin)) : '')) +
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

    // ---- render: detail - resumen (hitos + info + traspaso) ----

    function renderHitosList(sale) {
        var hs = getHitoStatus(sale);
        var items = hs.hitos.map(function (h) {
            if (h.na) {
                return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;opacity:0.35">' +
                    '<span style="width:18px;height:18px;border-radius:50%;background:rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0">—</span>' +
                    '<span style="font-size:13px;text-decoration:line-through">' + h.label + '</span>' +
                    (h.optional ? '<button class="kb-hito-na-toggle" data-key="' + h.key + '" data-na="0" style="margin-left:auto;font-size:10px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:var(--text-muted);cursor:pointer;padding:1px 6px">Activar</button>' : '') +
                '</div>';
            }
            var icon = h.done
                ? '<span style="width:18px;height:18px;border-radius:50%;background:#4ade8033;border:2px solid #4ade80;display:flex;align-items:center;justify-content:center;font-size:10px;flex-shrink:0;color:#4ade80">✓</span>'
                : '<span style="width:18px;height:18px;border-radius:50%;background:rgba(255,255,255,0.06);border:2px solid rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0"></span>';
            return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0">' +
                icon +
                '<span style="font-size:13px;color:' + (h.done ? 'var(--text-primary)' : 'var(--text-secondary)') + '">' + h.label + '</span>' +
                (h.optional && !h.done ? '<button class="kb-hito-na-toggle" data-key="' + h.key + '" data-na="1" style="margin-left:auto;font-size:10px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:var(--text-muted);cursor:pointer;padding:1px 6px">N/A</button>' : '') +
            '</div>';
        }).join('');

        var allDone = hs.done === hs.total && hs.total > 0;
        return '<div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:14px 18px;margin-bottom:var(--space-lg)">' +
            '<div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:8px;letter-spacing:0.5px">HITOS DEL EVENTO</div>' +
            items +
            (allDone ? '<div style="margin-top:10px;text-align:center;font-size:13px;color:#4ade80;font-weight:600">\uD83C\uDF89 ¡Todos los hitos completados!</div>' : '') +
        '</div>';
    }

    function renderDetailResumen(sale) {
        // Editing traspaso: show form
        if (traspasoEditMode) {
            return renderDetailTraspaso(sale);
        }
        // Traspaso complete: show full brief
        if (isTraspasoComplete(sale)) {
            return renderHitosList(sale) + renderBrief(sale);
        }
        // Incomplete: show hitos + basic event info (no KPIs) + CTA
        var svcLabel = getSaleServiceNames(sale) || '-';
        var basicInfo = '<div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:14px 18px;margin-bottom:var(--space-md)">' +
            '<table style="width:100%;border-collapse:collapse">' +
                briefRow('Cliente',   sale.clientName) +
                briefRow('Evento',    sale.eventName) +
                briefRow('Fecha',     formatDate(sale.eventDate)) +
                briefRow('Servicios', svcLabel) +
                (sale.encargado ? briefRow('Encargado', sale.encargado) : '') +
            '</table>' +
            '</div>';

        var minimo = isTraspasoMinimo(sale);
        var banner = minimo
            ? '<div style="background:rgba(251,146,60,0.10);border:1px solid rgba(251,146,60,0.3);border-radius:8px;padding:10px 14px;margin-bottom:var(--space-md);font-size:13px;color:#fb923c">Traspaso parcial \u2014 falta lugar y/o horario del servicio.</div>'
            : '<div style="background:rgba(251,191,36,0.07);border:1px solid rgba(251,191,36,0.25);border-radius:8px;padding:10px 14px;margin-bottom:var(--space-md);font-size:13px;color:var(--warning)">Traspaso pendiente \u2014 ingresa los datos operacionales del evento.</div>';

        return renderHitosList(sale) + basicInfo + banner +
            '<div style="text-align:center">' +
                '<button class="btn btn-primary" id="kb-completar-traspaso-btn" style="padding:10px 28px;font-size:15px">' +
                    (minimo ? 'Completar traspaso \u2192' : 'Iniciar traspaso \u2192') +
                '</button>' +
            '</div>';
    }

    // ---- render: detail - comunicacion ----

    function renderDetailComunicacion(sale) {
        var svcWithTemplates = (sale.serviceIds || []).map(function (sid) {
            return services.find(function (sv) { return String(sv.id) === String(sid); });
        }).filter(function (sv) { return sv; });

        // Build initial text: first service with custom template, or first default preset
        var customSvcs = svcWithTemplates.filter(function (sv) { return sv.template_saludo; });
        var initialText = '';
        if (customSvcs.length > 0) {
            initialText = fillTemplate(customSvcs[0].template_saludo, sale);
        } else {
            initialText = fillTemplate(DEFAULT_SALUDO_TEMPLATES[0].text, sale);
        }

        var svcBtns = '';
        if (customSvcs.length > 1) {
            svcBtns = '<div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
                '<span style="color:var(--text-secondary);font-size:13px">Plantilla de:</span>' +
                customSvcs.map(function (sv, i) {
                    return '<button class="toggle-option kb-com-svc-btn' + (i === 0 ? ' active' : '') + '" data-svc-template="' + escapeHtml(sv.template_saludo || '') + '" style="font-size:12px">' + escapeHtml(sv.name) + '</button>';
                }).join('') +
                '</div>';
        }

        var svcResetBtn = customSvcs.length > 0
            ? '<button id="kb-com-svc-reset" data-svc-template="' + escapeHtml(customSvcs[0].template_saludo || '') + '" style="background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.4);color:#a78bfa;border-radius:6px;padding:4px 12px;font-size:12px;cursor:pointer;font-weight:600">↩ Template del servicio</button>'
            : '';

        var presetBtns = '<div style="margin-bottom:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
            (svcResetBtn ? svcResetBtn + '<span style="color:rgba(255,255,255,0.15)">|</span>' : '') +
            '<span style="color:var(--text-secondary);font-size:13px">Predefinidos:</span>' +
            DEFAULT_SALUDO_TEMPLATES.map(function (t, i) {
                return '<button class="kb-com-preset-btn" data-preset-idx="' + i + '" style="background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);color:var(--text-primary);border-radius:6px;padding:4px 12px;font-size:12px;cursor:pointer">' + t.label + '</button>';
            }).join('') +
            '</div>';

        var noTemplateHint = customSvcs.length === 0
            ? '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Tip: configura plantillas personalizadas por servicio en <strong>Configurar → Servicios</strong>.</div>'
            : '';

        return '<div>' +
            svcBtns +
            presetBtns +
            noTemplateHint +
            '<textarea id="kb-com-textarea" class="form-control" rows="9" style="width:100%;resize:vertical;font-size:14px;line-height:1.6">' + escapeHtml(initialText) + '</textarea>' +
            '<div style="margin-top:10px;display:flex;gap:8px">' +
                '<button id="kb-com-copy-btn" class="btn btn-primary">Copiar mensaje</button>' +
                '<span id="kb-com-copy-ok" style="color:#4ade80;font-size:13px;display:none;align-self:center">Copiado!</span>' +
            '</div>' +
            renderFaqSection(sale) +
        '</div>';
    }

    function renderFaqSection(sale) {
        var matchedSvcs = (sale.serviceIds || []).map(function (sid) {
            return services.find(function (sv) { return String(sv.id) === String(sid); });
        }).filter(function (sv) { return sv && sv.faq; });

        if (matchedSvcs.length === 0) {
            // fallback: try matching by name
            var svcNameStr = (sale.serviceNames || '').toLowerCase();
            if (svcNameStr) {
                matchedSvcs = services.filter(function (sv) {
                    var svName = (sv.name || sv.nombre || '').toLowerCase();
                    return svName && svcNameStr.indexOf(svName) !== -1 && sv.faq;
                });
            }
        }

        if (matchedSvcs.length === 0) {
            return '<div style="margin-top:20px;border-top:1px solid rgba(255,255,255,0.08);padding-top:16px">' +
                '<div style="font-size:11px;font-weight:700;color:var(--text-muted);letter-spacing:0.5px;margin-bottom:8px">FAQ</div>' +
                '<div style="font-size:13px;color:var(--text-muted)">No hay FAQ disponible para los servicios de este evento.</div>' +
            '</div>';
        }

        var accordions = matchedSvcs.map(function (sv, idx) {
            var pairs = parseFaqPairs(sv.faq);
            var pairsHtml = pairs.map(function (pair) {
                return '<div style="margin-bottom:10px">' +
                    '<div style="font-weight:600;color:#a78bfa;font-size:13px;margin-bottom:2px">' + escapeHtml(pair.q) + '</div>' +
                    '<div style="color:var(--text-secondary);font-size:13px;line-height:1.5">' + escapeHtml(pair.a) + '</div>' +
                '</div>';
            }).join('');

            var toggleId = 'kb-faq-body-' + idx;
            return '<div style="margin-bottom:8px;border:1px solid rgba(255,255,255,0.08);border-radius:8px;overflow:hidden">' +
                '<div onclick="var el=document.getElementById(\'' + toggleId + '\');el.style.display=el.style.display===\'none\'?\'block\':\'none\';this.querySelector(\'.kb-faq-arrow\').textContent=el.style.display===\'none\'?\'\u25B6\':\'\u25BC\'" ' +
                    'style="padding:10px 14px;cursor:pointer;display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.04)">' +
                    '<span class="kb-faq-arrow" style="font-size:10px;color:var(--text-muted)">' + (matchedSvcs.length === 1 ? '\u25BC' : '\u25B6') + '</span>' +
                    '<span style="font-size:13px;font-weight:600;color:var(--text-primary)">' + escapeHtml(sv.name || sv.nombre || 'Servicio') + '</span>' +
                '</div>' +
                '<div id="' + toggleId + '" style="padding:12px 14px;display:' + (matchedSvcs.length === 1 ? 'block' : 'none') + '">' +
                    pairsHtml +
                '</div>' +
            '</div>';
        }).join('');

        return '<div style="margin-top:20px;border-top:1px solid rgba(255,255,255,0.08);padding-top:16px">' +
            '<div style="font-size:11px;font-weight:700;color:var(--text-muted);letter-spacing:0.5px;margin-bottom:10px">FAQ DE SERVICIOS</div>' +
            accordions +
        '</div>';
    }

    function parseFaqPairs(faqText) {
        var blocks = (faqText || '').split(/\n\s*\n/);
        var pairs = [];
        var currentQ = '';
        var currentA = '';
        for (var i = 0; i < blocks.length; i++) {
            var lines = blocks[i].trim().split('\n');
            for (var j = 0; j < lines.length; j++) {
                var line = lines[j].trim();
                if (line.indexOf('P:') === 0 || line.indexOf('P :') === 0) {
                    if (currentQ) {
                        pairs.push({ q: currentQ, a: currentA.trim() });
                    }
                    currentQ = line.replace(/^P\s*:\s*/, '');
                    currentA = '';
                } else if (line.indexOf('R:') === 0 || line.indexOf('R :') === 0) {
                    currentA += (currentA ? ' ' : '') + line.replace(/^R\s*:\s*/, '');
                } else if (line) {
                    currentA += (currentA ? ' ' : '') + line;
                }
            }
        }
        if (currentQ) {
            pairs.push({ q: currentQ, a: currentA.trim() });
        }
        return pairs;
    }

    // ---- render: detail - notas ----

    function renderDetailNotas(sale) {
        var notesVal = sale.kanbanNotes || '';
        var commentsHtml = '';
        if (sale.comments && !notesVal) {
            notesVal = sale.comments;
        }
        if (sale.comments) {
            commentsHtml = '<div style="margin-bottom:var(--space-md);padding:10px 14px;background:rgba(255,255,255,0.04);border-radius:8px;font-size:13px">' +
                '<div style="color:var(--text-secondary);font-weight:600;margin-bottom:4px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Comentarios de la venta</div>' +
                '<div style="color:var(--text-primary);white-space:pre-line">' + escapeHtml(sale.comments) + '</div>' +
            '</div>';
        }
        return '<div class="kanban-notes">' +
            commentsHtml +
            '<textarea class="form-control" id="kb-notes" placeholder="Notas del evento...">' + escapeHtml(notesVal) + '</textarea>' +
            '<div class="kanban-notes-hint">Los cambios se guardan autom\u00e1ticamente al salir del campo.</div>' +
            '</div>';
    }

    // ---- render: detail - equipos ----

    function renderDetailEquipos(sale) {
        var isPost = (sale.eventDate || '') < todayStr();
        var items = sale.equiposAsignados || [];
        var ESTADOS_EQ = ['bueno', 'dañado', 'mantenimiento'];

        function estOpts(selected) {
            return ESTADOS_EQ.map(function (e) {
                return '<option value="' + e + '"' + (selected === e ? ' selected' : '') + '>' + e.charAt(0).toUpperCase() + e.slice(1) + '</option>';
            }).join('');
        }

        if (items.length === 0) {
            // Check by serviceIds first, then by name fallback (for imported/historical events)
            var hasTpl = services.some(function (sv) {
                if (!sv.equipos_checklist) return false;
                var svName = (sv.name || sv.nombre || '').toLowerCase();
                var byId = (sale.serviceIds || []).some(function (sid) { return String(sid) === String(sv.id); });
                var byName = svName && (sale.serviceNames || '').toLowerCase().indexOf(svName) !== -1;
                return byId || byName;
            });
            return '<div style="padding:16px 0">' +
                '<div style="color:var(--text-secondary);margin-bottom:16px">No hay equipos asignados a este evento.</div>' +
                (hasTpl
                    ? '<button class="btn btn-primary" id="kb-eq-init-btn" style="margin-bottom:20px">Inicializar desde plantillas del servicio \u2192</button>'
                    : '') +
                '<div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:16px">' +
                    '<div style="font-size:11px;font-weight:700;color:var(--text-muted);letter-spacing:0.5px;padding-bottom:8px">AGREGAR MANUALMENTE</div>' +
                    '<div style="display:flex;gap:6px">' +
                        '<input type="text" class="form-control kb-eq-new-input" data-service-id="__extra__" data-service-name="Extras" placeholder="Nombre del equipo o material..." style="flex:1;height:32px;font-size:13px">' +
                        '<button class="kb-eq-add-item-btn" data-service-id="__extra__" data-service-name="Extras" style="height:32px;padding:0 14px;font-size:13px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:var(--text-secondary);cursor:pointer">+ A\u00f1adir</button>' +
                    '</div>' +
                '</div>' +
            '</div>';
        }

        var tSale = sale.traspaso || {};
        var busyIds = getBusyEquipoIds(sale.id, sale.eventDate, tSale);
        var thisAssigned = {};
        items.forEach(function (it) { if (it.equipoId) thisAssigned[String(it.equipoId)] = true; });
        var selectableEquipos = bodegaEquipos.filter(function (eq) {
            return eq.estado !== 'baja' && (!busyIds[String(eq.id)] || thisAssigned[String(eq.id)]);
        });

        var groupOrder = [], groups = {};
        items.forEach(function (item) {
            var gid = item.serviceId || '__extra__';
            var gname = item.serviceName || (item.serviceId ? item.serviceId : 'Equipos extras');
            if (!groups[gid]) { groups[gid] = { name: gname, items: [] }; groupOrder.push(gid); }
            groups[gid].items.push(item);
        });

        var retornados = items.filter(function (i) { return i.retornado; }).length;

        var groupsHtml = groupOrder.map(function (gid) {
            var g = groups[gid];
            var rows = g.items.map(function (item) {
                if (isPost) {
                    if (item.retornado) {
                        return '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.05)">' +
                            '<span style="color:#4ade80;font-size:13px;flex-shrink:0">\u2713</span>' +
                            '<span style="flex:1;font-size:13px;color:var(--text-secondary)">' + escapeHtml(item.label) +
                                (item.equipoDisplayId ? ' <code style="font-size:10px;opacity:0.6">' + escapeHtml(item.equipoDisplayId) + '</code>' : '') +
                            '</span>' +
                            '<span style="font-size:11px;color:var(--text-muted)">' +
                                escapeHtml(item.estadoRetorno || '') +
                                (item.notaRetorno ? ' \u00b7 ' + escapeHtml(item.notaRetorno) : '') +
                            '</span>' +
                        '</div>';
                    }
                    return '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.05)">' +
                        '<div style="flex:1">' +
                            '<div style="font-size:13px;font-weight:500">' + escapeHtml(item.label) + '</div>' +
                            (item.equipoDisplayId
                                ? '<div style="font-size:11px;color:var(--text-muted)">' + escapeHtml(item.equipoDisplayId) + ' \u00b7 sali\u00f3: ' + escapeHtml(item.estadoSalida || '-') + '</div>'
                                : '<div style="font-size:11px;color:var(--text-muted)">Sin equipo asignado</div>') +
                        '</div>' +
                        '<select class="form-control kb-eq-retorno-estado" data-item-id="' + item.itemId + '" style="width:130px;height:28px;font-size:12px;color:var(--text-primary);background:var(--bg-secondary)">' + estOpts(item.estadoRetorno || 'bueno') + '</select>' +
                        '<input type="text" class="form-control kb-eq-retorno-nota" data-item-id="' + item.itemId + '" placeholder="Nota da\u00f1o..." value="' + escapeHtml(item.notaRetorno || '') + '" style="width:120px;height:28px;font-size:12px;color:var(--text-primary);background:var(--bg-secondary)">' +
                        '<button class="btn btn-primary kb-eq-retorno-btn" data-item-id="' + item.itemId + '" style="height:28px;padding:0 10px;font-size:12px;white-space:nowrap">\u2713 Recib\u00ed conforme</button>' +
                    '</div>';
                } else {
                    // Filter by direct categoria field first (from template), fallback to smart match
                    var filteredEqs, matchedCat;
                    if (item.categoria) {
                        filteredEqs = selectableEquipos.filter(function (eq) { return (eq.categoria || '') === item.categoria; });
                        matchedCat = filteredEqs.length > 0 ? item.categoria : null;
                        if (filteredEqs.length === 0) {
                            var matched = getEquiposForItem(item.label, selectableEquipos);
                            filteredEqs = matched.list;
                            matchedCat = matched.matchedCat;
                        }
                    } else {
                        var matched2 = getEquiposForItem(item.label, selectableEquipos);
                        filteredEqs = matched2.list;
                        matchedCat = matched2.matchedCat;
                    }
                    var catHint = matchedCat
                        ? '<div style="font-size:10px;color:var(--text-muted);margin-top:2px">' + filteredEqs.length + ' en ' + escapeHtml(matchedCat) + '</div>'
                        : '';
                    var dlId = 'eq-dl-' + item.itemId;
                    var dlOpts = filteredEqs.map(function (eq) {
                        return '<option value="[' + escapeHtml(eq.equipo_id || '') + '] ' + escapeHtml(eq.nombre || '') + '">';
                    }).join('');
                    var inpVal = item.equipoDisplayId ? '[' + (item.equipoDisplayId) + '] ' + (item.equipoNombre || '') : '';
                    // Estado badge: use current bodega estado if equipo assigned, else item.estadoSalida
                    var curEstado = item.estadoSalida || 'bueno';
                    if (item.equipoId) {
                        var eqObj = bodegaEquipos.find(function (e) { return String(e.id) === String(item.equipoId); });
                        if (eqObj) curEstado = eqObj.estado || 'bueno';
                    }
                    var estColors = { bueno: '#4ade80', 'dañado': '#f87171', mantenimiento: '#facc15' };
                    var estColor = estColors[curEstado] || '#6b7280';
                    return '<datalist id="' + dlId + '">' + dlOpts + '</datalist>' +
                        '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.05)">' +
                        '<div style="flex:1">' +
                            '<div style="font-size:13px">' + escapeHtml(item.label) + '</div>' +
                            catHint +
                        '</div>' +
                        '<input list="' + dlId + '" class="form-control kb-eq-equipo-inp" data-item-id="' + item.itemId + '" data-categoria="' + escapeHtml(item.categoria || '') + '" value="' + escapeHtml(inpVal) + '" placeholder="Busca por c\u00f3digo o nombre..." style="width:220px;height:28px;font-size:12px;color:var(--text-primary);background:var(--bg-secondary)">' +
                        '<span class="kb-eq-estado-badge" data-item-id="' + item.itemId + '" style="font-size:11px;font-weight:600;padding:2px 10px;border-radius:20px;white-space:nowrap;background:' + estColor + '22;color:' + estColor + ';border:1px solid ' + estColor + '44">' + (curEstado.charAt(0).toUpperCase() + curEstado.slice(1)) + '</span>' +
                        '<input type="hidden" class="kb-eq-estado-sal" data-item-id="' + item.itemId + '" value="' + escapeHtml(curEstado) + '">' +
                        '<button class="kb-eq-remove-btn" data-item-id="' + item.itemId + '" style="height:26px;width:26px;border-radius:4px;padding:0;font-size:16px;line-height:1;background:rgba(248,113,113,0.1);color:#f87171;border:1px solid rgba(248,113,113,0.3);cursor:pointer" title="Quitar">&times;</button>' +
                    '</div>';
                }
            }).join('');

            var addRow = !isPost
                ? '<div style="padding:6px 0;display:flex;gap:6px">' +
                    '<input type="text" class="form-control kb-eq-new-input" data-service-id="' + gid + '" data-service-name="' + escapeHtml(g.name) + '" placeholder="Agregar \u00edtem de equipo..." style="flex:1;height:28px;font-size:12px">' +
                    '<button class="kb-eq-add-item-btn" data-service-id="' + gid + '" data-service-name="' + escapeHtml(g.name) + '" style="height:28px;padding:0 10px;font-size:12px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:var(--text-secondary);cursor:pointer">+ A\u00f1adir</button>' +
                  '</div>'
                : '';

            return '<div style="margin-bottom:var(--space-lg)">' +
                '<div style="font-size:11px;font-weight:700;color:var(--text-muted);letter-spacing:0.5px;text-transform:uppercase;padding-bottom:8px">' + escapeHtml(g.name) + '</div>' +
                rows + addRow +
            '</div>';
        }).join('');

        var title = isPost ? 'RETORNO DE EQUIPOS' : 'EQUIPOS DEL EVENTO';
        var subtitle = isPost
            ? '<div style="font-size:12px;color:' + (retornados === items.length ? '#4ade80' : 'var(--text-muted)') + ';margin-bottom:12px">' + retornados + '/' + items.length + ' equipos retornados</div>'
            : '';
        var actionBar = !isPost
            ? '<div style="margin-top:var(--space-md);display:flex;gap:8px;padding-top:var(--space-md);border-top:1px solid rgba(255,255,255,0.06)">' +
                '<button class="btn btn-primary" id="kb-eq-save-btn">Guardar</button>' +
              '</div>'
            : '';

        return '<div style="font-size:11px;font-weight:700;color:var(--text-muted);letter-spacing:0.5px;margin-bottom:12px">' + title + '</div>' +
            subtitle + groupsHtml + actionBar;
    }

    // ---- render: detail view ----

    function renderDetail(sale) {
        var displayId = sale.sourceId || String(sale.id || '').slice(-6);
        var finSt = getFinancialStatus(sale);
        var meta = STATUS_META[finSt];

        var header = '<div class="kanban-detail-header">' +
            '<div style="display:flex;gap:var(--space-sm);flex-wrap:wrap">' +
                '<button class="btn-secondary" id="kb-back-btn">\u2190 Volver al Board</button>' +
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
                renderHitosBar(sale) +
            '</div>' +
            '<span class="badge ' + meta.cls + '" style="font-size:13px;padding:6px 14px;align-self:flex-start">' + meta.label + '</span>' +
            '</div>';

        var tabs = '<div class="tabs">' +
            [
                { id: 'resumen',      label: 'Resumen'      },
                { id: 'checklist',    label: 'Checklist'    },
                { id: 'equipos',      label: 'Equipos'      },
                { id: 'finanzas',     label: 'Finanzas'     },
                { id: 'comunicacion', label: 'Comunicación' },
                { id: 'notas',        label: 'Notas'        }
            ].map(function (t) {
                return '<button class="tab' + (activeTab === t.id ? ' active' : '') + '" data-tab="' + t.id + '">' + t.label + '</button>';
            }).join('') +
            '</div>';

        var tabContent = '';
        if (activeTab === 'resumen')          tabContent = renderDetailResumen(sale);
        else if (activeTab === 'checklist')   tabContent = renderDetailChecklist(sale);
        else if (activeTab === 'equipos')     tabContent = renderDetailEquipos(sale);
        else if (activeTab === 'finanzas')    tabContent = renderDetailFinanzas(sale);
        else if (activeTab === 'comunicacion') tabContent = renderDetailComunicacion(sale);
        else if (activeTab === 'notas')       tabContent = renderDetailNotas(sale);
        else                                  tabContent = renderDetailResumen(sale);

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
                activeTab = 'resumen';
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
                // Block move to "En Coordinación" (col 2) without at least traspaso mínimo
                if (board === 'pre' && newCol === 2 && !isTraspasoMinimo(sale)) {
                    alert('Para mover a "En Coordinaci\u00f3n" debes completar al menos el contacto del cliente (nombre + tel o email) en el traspaso.');
                    return;
                }
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
                // Block drag to "En Coordinación" (col 2) without traspaso mínimo
                if (board === 'pre' && newCol === 2 && !isTraspasoMinimo(sale)) {
                    alert('Para mover a "En Coordinaci\u00f3n" debes completar al menos el contacto del cliente (nombre + tel o email) en el traspaso.');
                    return;
                }
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

        // Comunicación tab listeners (inline saludo generator)
        document.querySelectorAll('.kb-com-svc-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                document.querySelectorAll('.kb-com-svc-btn').forEach(function (b) { b.classList.remove('active'); });
                this.classList.add('active');
                var ta = document.getElementById('kb-com-textarea');
                if (ta) ta.value = fillTemplate(this.dataset.svcTemplate || '', sale);
            });
        });

        document.querySelectorAll('.kb-com-preset-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var idx = Number(this.dataset.presetIdx);
                var ta = document.getElementById('kb-com-textarea');
                if (ta) ta.value = fillTemplate(DEFAULT_SALUDO_TEMPLATES[idx].text, sale);
            });
        });

        // Resumen tab: completar traspaso CTA
        var ctaBtn = document.getElementById('kb-completar-traspaso-btn');
        if (ctaBtn) ctaBtn.addEventListener('click', function () {
            traspasoEditMode = true;
            refreshContent();
        });

        // Resumen tab: hito N/A toggle
        document.querySelectorAll('.kb-hito-na-toggle').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var key = this.dataset.key;
                var setNa = this.dataset.na === '1';
                var cl = sale.checklist || [];
                var item = cl.find(function (i) { return i.key === key; });
                if (item) {
                    item.na = setNa;
                } else {
                    cl.push({ key: key, done: false, na: setNa });
                }
                sale.checklist = cl;
                var prevDone = getHitoStatus(sale).pct;
                window.Mazelab.DataService.update('sales', sale.id, { checklist: cl });
                var newStatus = getHitoStatus(sale);
                if (newStatus.pct === 1 && newStatus.total > 0 && prevDone < 1) fireConfetti();
                refreshContent();
            });
        });

        // Comunicación: reset to service template
        var svcResetBtn = document.getElementById('kb-com-svc-reset');
        if (svcResetBtn) svcResetBtn.addEventListener('click', function () {
            var ta = document.getElementById('kb-com-textarea');
            if (ta) ta.value = fillTemplate(this.dataset.svcTemplate || '', sale);
        });

        var comCopyBtn = document.getElementById('kb-com-copy-btn');
        if (comCopyBtn) comCopyBtn.addEventListener('click', function () {
            var ta = document.getElementById('kb-com-textarea');
            if (!ta) return;
            var text = ta.value;
            var ok = document.getElementById('kb-com-copy-ok');
            navigator.clipboard.writeText(text).catch(function () {
                ta.select();
                document.execCommand('copy');
            }).finally(function () {
                if (ok) { ok.style.display = 'inline'; setTimeout(function () { ok.style.display = 'none'; }, 2000); }
            });
            if (ok) { ok.style.display = 'inline'; setTimeout(function () { ok.style.display = 'none'; }, 2000); }
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

        // Traspaso: autofill tel/email when selecting a known contact
        var contactoInput = document.getElementById('tr-contactoNombre');
        if (contactoInput) {
            var contactMap = {};
            sales.forEach(function (s) {
                var t = s.traspaso || {};
                if (t.contactoNombre) contactMap[t.contactoNombre] = { tel: t.contactoTel || '', email: t.contactoEmail || '' };
            });
            contactoInput.addEventListener('change', function () {
                var info = contactMap[this.value];
                if (!info) return;
                var telEl   = document.getElementById('tr-contactoTel');
                var emailEl = document.getElementById('tr-contactoEmail');
                if (telEl   && !telEl.value   && info.tel)   telEl.value   = info.tel;
                if (emailEl && !emailEl.value && info.email) emailEl.value = info.email;
            });
        }

        // Traspaso save
        var trSaveBtn = document.getElementById('tr-save-btn');
        if (trSaveBtn) trSaveBtn.addEventListener('click', function () {
            var fields = ['contactoNombre','contactoTel','contactoEmail','lugar','pax',
                          'horarioServicio','horarioMontaje','horarioDesmontaje',
                          'vestimenta','requerimientos','notaVendedor'];
            var data = {};
            fields.forEach(function (f) {
                var el = document.getElementById('tr-' + f);
                if (el) data[f] = el.value.trim();
            });
            // Read date mode
            var modeEl = document.getElementById('tr-date-mode');
            var dateMode = modeEl ? modeEl.value : 'dia';
            if (dateMode === 'periodo') {
                var finEl = document.getElementById('tr-eventDateFin');
                data.eventDateFin = finEl ? finEl.value : null;
                data.eventDates = null;
            } else if (dateMode === 'especificas') {
                var datesEl = document.getElementById('tr-eventDates');
                try { data.eventDates = JSON.parse(datesEl ? datesEl.value : '[]'); } catch(e) { data.eventDates = []; }
                data.eventDateFin = null;
            } else {
                data.eventDateFin = null;
                data.eventDates = null;
            }
            traspasoEditMode = false;
            saveTraspaso(sale, data);
        });

        // Traspaso: date mode toggle buttons
        var btnBase = 'border-radius:6px;padding:4px 12px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid rgba(255,255,255,0.15);';
        var btnActive = btnBase + 'background:rgba(167,139,250,0.2);color:#a78bfa;border-color:rgba(167,139,250,0.4);';
        var btnInactive = btnBase + 'background:rgba(255,255,255,0.05);color:var(--text-muted);';
        document.querySelectorAll('.tr-date-mode-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var newMode = this.dataset.mode;
                var modeEl = document.getElementById('tr-date-mode');
                if (modeEl) modeEl.value = newMode;
                document.querySelectorAll('.tr-date-mode-btn').forEach(function (b) {
                    b.setAttribute('style', b.dataset.mode === newMode ? btnActive : btnInactive);
                });
                var contentEl = document.getElementById('tr-date-mode-content');
                if (contentEl) contentEl.innerHTML = renderTrDateModeContent(newMode, sale.eventDate, sale.traspaso || {});
                // Re-bind date add/delete for "especificas" mode
                bindTrDatePillEvents();
            });
        });

        function bindTrDatePillEvents() {
            var addBtn = document.getElementById('tr-date-add-btn');
            if (addBtn) {
                addBtn.addEventListener('click', function () {
                    var inp = document.getElementById('tr-date-add-input');
                    var d = inp ? inp.value : '';
                    if (!d) return;
                    var datesEl = document.getElementById('tr-eventDates');
                    var dates = [];
                    try { dates = JSON.parse(datesEl ? datesEl.value : '[]'); } catch(e) {}
                    if (dates.indexOf(d) === -1) { dates.push(d); dates.sort(); }
                    if (datesEl) datesEl.value = JSON.stringify(dates);
                    var contentEl = document.getElementById('tr-date-mode-content');
                    if (contentEl) contentEl.innerHTML = renderTrDateModeContent('especificas', sale.eventDate, { eventDates: dates });
                    bindTrDatePillEvents();
                });
            }
            document.querySelectorAll('.tr-date-del-btn').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var d = this.dataset.date;
                    var datesEl = document.getElementById('tr-eventDates');
                    var dates = [];
                    try { dates = JSON.parse(datesEl ? datesEl.value : '[]'); } catch(e) {}
                    dates = dates.filter(function (x) { return x !== d; });
                    if (datesEl) datesEl.value = JSON.stringify(dates);
                    var contentEl = document.getElementById('tr-date-mode-content');
                    if (contentEl) contentEl.innerHTML = renderTrDateModeContent('especificas', sale.eventDate, { eventDates: dates });
                    bindTrDatePillEvents();
                });
            });
        }
        bindTrDatePillEvents();

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

        // Equipos tab: initialize from templates
        var eqInitBtn = document.getElementById('kb-eq-init-btn');
        if (eqInitBtn) eqInitBtn.addEventListener('click', function () {
            var items = initEquiposFromTemplates(sale);
            saveEquiposAsignados(sale, items);
        });

        // Equipos tab: save assignment
        var eqSaveBtn = document.getElementById('kb-eq-save-btn');
        if (eqSaveBtn) eqSaveBtn.addEventListener('click', function () {
            saveEquiposAsignados(sale, collectEquiposFromDOM(sale));
        });

        // Equipos tab: add item to group
        document.querySelectorAll('.kb-eq-add-item-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var gid = this.dataset.serviceId;
                var gname = this.dataset.serviceName;
                var inp = document.querySelector('.kb-eq-new-input[data-service-id="' + gid + '"]');
                var label = inp ? inp.value.trim() : '';
                if (!label) return;
                var items = collectEquiposFromDOM(sale);
                items.push({ itemId: 'item_' + Date.now(), label: label, serviceId: gid !== '__extra__' ? gid : null, serviceName: gid !== '__extra__' ? gname : null, equipoId: null, equipoDisplayId: null, estadoSalida: 'bueno', retornado: false, estadoRetorno: null, notaRetorno: '' });
                saveEquiposAsignados(sale, items);
            });
        });
        document.querySelectorAll('.kb-eq-new-input').forEach(function (inp) {
            inp.addEventListener('keydown', function (e) {
                if (e.key !== 'Enter') return;
                var btn = document.querySelector('.kb-eq-add-item-btn[data-service-id="' + this.dataset.serviceId + '"]');
                if (btn) btn.click();
            });
        });

        // Equipos tab: auto-update estado when equipo is selected from datalist
        document.querySelectorAll('.kb-eq-equipo-inp').forEach(function (inp) {
            inp.addEventListener('change', function () {
                var val = (this.value || '').trim();
                var match = val.match(/^\[([^\]]+)\]/);
                if (!match) return;
                var code = match[1];
                var eq = bodegaEquipos.find(function (e) { return (e.equipo_id || '') === code; });
                if (!eq) return;
                var itemId = inp.dataset.itemId;
                var hiddenEst = document.querySelector('.kb-eq-estado-sal[data-item-id="' + itemId + '"]');
                var badge = document.querySelector('.kb-eq-estado-badge[data-item-id="' + itemId + '"]');
                var estado = eq.estado || 'bueno';
                if (hiddenEst) hiddenEst.value = estado;
                if (badge) {
                    var estColors = { bueno: '#4ade80', 'dañado': '#f87171', mantenimiento: '#facc15' };
                    var c = estColors[estado] || '#6b7280';
                    badge.textContent = estado.charAt(0).toUpperCase() + estado.slice(1);
                    badge.setAttribute('style', 'font-size:11px;font-weight:600;padding:2px 10px;border-radius:20px;white-space:nowrap;background:' + c + '22;color:' + c + ';border:1px solid ' + c + '44');
                }
            });
        });

        // Equipos tab: remove item
        document.querySelectorAll('.kb-eq-remove-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var itemId = this.dataset.itemId;
                var items = collectEquiposFromDOM(sale).filter(function (i) { return i.itemId !== itemId; });
                saveEquiposAsignados(sale, items);
            });
        });

        // Equipos tab: retorno
        document.querySelectorAll('.kb-eq-retorno-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var itemId = this.dataset.itemId;
                var estadoEl = document.querySelector('.kb-eq-retorno-estado[data-item-id="' + itemId + '"]');
                var notaEl   = document.querySelector('.kb-eq-retorno-nota[data-item-id="' + itemId + '"]');
                returnEquipo(sale, itemId, estadoEl ? estadoEl.value : 'bueno', notaEl ? notaEl.value.trim() : '');
            });
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
        var prevStatus = getHitoStatus(sale);
        item.checked = checked;
        item.done = checked;
        item.checkedAt = checked ? new Date().toISOString() : null;
        sale.checklist = cl;
        await DS.update('sales', sale.id, { checklist: cl });
        var newStatus = getHitoStatus(sale);
        if (newStatus.pct === 1 && newStatus.total > 0 && prevStatus.pct < 1) fireConfetti();
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

    async function saveEquiposAsignados(sale, items) {
        sale.equiposAsignados = items;
        await window.Mazelab.DataService.update('sales', sale.id, { equiposAsignados: items });
        // Update global occupation count for bodega
        var today = todayStr();
        window.Mazelab.BodegaOccupied = window.Mazelab.BodegaOccupied || {};
        items.forEach(function (it) {
            var key = String(it.equipoId);
            if (it.equipoId && !it.retornado && (sale.eventDate || '') >= today) {
                window.Mazelab.BodegaOccupied[key] = (window.Mazelab.BodegaOccupied[key] || 0) + 1;
            } else if (it.equipoId && it.retornado && window.Mazelab.BodegaOccupied[key]) {
                window.Mazelab.BodegaOccupied[key] = Math.max(0, window.Mazelab.BodegaOccupied[key] - 1);
                if (window.Mazelab.BodegaOccupied[key] === 0) delete window.Mazelab.BodegaOccupied[key];
            }
        });
        refreshContent();
    }

    async function returnEquipo(sale, itemId, estadoRetorno, notaRetorno) {
        var items = JSON.parse(JSON.stringify(sale.equiposAsignados || []));
        var item = items.find(function (i) { return i.itemId === itemId; });
        if (!item) return;
        item.retornado = true;
        item.estadoRetorno = estadoRetorno;
        item.notaRetorno = notaRetorno;
        // Update bodega equipo estado (if the equipo is in our loaded list)
        if (item.equipoId) {
            var eq = bodegaEquipos.find(function (e) { return String(e.id) === String(item.equipoId); });
            if (eq) {
                eq.estado = estadoRetorno;
                var appendNote = notaRetorno ? '[Retorno ' + (sale.eventName || '') + ']: ' + notaRetorno : '';
                await window.Mazelab.DataService.update('bodega', item.equipoId, {
                    estado: estadoRetorno,
                    notas: (eq.notas ? eq.notas + (appendNote ? '\n' + appendNote : '') : appendNote) || ''
                });
            }
        }
        await saveEquiposAsignados(sale, items);
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
        activeTab = 'resumen';
        filters = { client: '', service: '', seller: '', financial: '' };

        try {
            var DS = window.Mazelab.DataService;
            var results = await Promise.all([
                DS.getAll('sales'),
                DS.getAll('receivables'),
                DS.getAll('payables'),
                DS.getAll('clients'),
                DS.getAll('services'),
                DS.getAll('staff'),
                DS.getAll('bodega')
            ]);
            sales          = results[0] || [];
            receivables    = results[1] || [];
            payables       = results[2] || [];
            clients        = results[3] || [];
            services       = results[4] || [];
            staff          = results[5] || [];
            bodegaEquipos  = results[6] || [];

            // Resolve staffId → staffName on sales for filter/display
            var staffMap = {};
            staff.forEach(function (st) { staffMap[st.id] = st.name || st.nombre || st.id; });
            sales.forEach(function (s) {
                if (!s.staffName && s.staffId && staffMap[s.staffId]) {
                    s.staffName = staffMap[s.staffId];
                }
            });

            // Populate global occupation map for bodega display
            // Stores count of upcoming events per equipment
            var today = todayStr();
            window.Mazelab.BodegaOccupied = {};
            sales.forEach(function (s) {
                if ((s.eventDate || '') < today) return;
                (s.equiposAsignados || []).forEach(function (a) {
                    if (a.equipoId && !a.retornado) {
                        var key = String(a.equipoId);
                        window.Mazelab.BodegaOccupied[key] = (window.Mazelab.BodegaOccupied[key] || 0) + 1;
                    }
                });
            });

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
