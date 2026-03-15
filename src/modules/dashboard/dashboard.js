window.Mazelab = window.Mazelab || {};
window.Mazelab.Modules = window.Mazelab.Modules || {};

window.Mazelab.Modules.DashboardModule = (function () {

    // --------------- helpers ---------------

    function formatCLP(n) {
        if (n == null || isNaN(n)) return '$0';
        var abs = Math.abs(Math.round(n));
        var formatted = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return (n < 0 ? '-$' : '$') + formatted;
    }

    function getMonthLabel(date) {
        var months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
                      'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        var d = new Date(date);
        return months[d.getMonth()] + ' ' + d.getFullYear();
    }

    function getMonthKey(date) {
        var d = new Date(date);
        var y = d.getFullYear();
        var m = (d.getMonth() + 1).toString().padStart(2, '0');
        return y + '-' + m;
    }

    function getWeekKey(date) {
        var d = new Date(date);
        // ISO week start (Monday)
        var day = d.getDay() || 7;
        d.setDate(d.getDate() - day + 1); // Monday
        return d.toISOString().substring(0, 10);
    }

    function getLast6Months() {
        var result = [];
        var now = new Date();
        for (var i = 5; i >= 0; i--) {
            var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            result.push({ key: getMonthKey(d), label: getMonthLabel(d) });
        }
        return result;
    }

    function getNext6Months() {
        var result = [];
        var now = new Date();
        for (var i = 0; i < 6; i++) {
            var d = new Date(now.getFullYear(), now.getMonth() + i, 1);
            result.push({ key: getMonthKey(d), label: getMonthLabel(d) });
        }
        return result;
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function getUserRole() {
        var Auth = window.Mazelab.Auth;
        if (!Auth) return 'superadmin';
        var u = Auth.getUser();
        return u ? u.role : 'operaciones';
    }

    // --------------- render (loading state) ---------------

    function render() {
        return '' +
            '<div class="content-header">' +
                '<h2>Dashboard</h2>' +
            '</div>' +
            '<div class="content-body" id="dashboard-body">' +
                '<div class="empty-state">' +
                    '<p>Cargando datos del dashboard...</p>' +
                '</div>' +
            '</div>';
    }

    // --------------- role-aware build ---------------

    var rankingsScope = 'year';

    function buildDashboard(sales, receivables, payables, services) {
        var role = getUserRole();

        // Full financial dashboard for superadmin & socio
        if (role === 'superadmin' || role === 'socio') {
            return buildFullDashboard(sales, receivables, payables, services);
        }

        // Comercial: sales KPIs + upcoming events + rankings (no CXP, no IVA)
        if (role === 'comercial') {
            return buildComercialDashboard(sales, receivables, services);
        }

        // Operaciones: upcoming events, alerts, equipment status
        return buildOpsDashboard(sales, payables, services);
    }

    // ================================================================
    //  FULL DASHBOARD (superadmin / socio)
    // ================================================================
    function buildFullDashboard(sales, receivables, payables, services) {
        // ---- KPI calculations ----
        var totalVentas = 0;
        var countVentas = sales.length;
        sales.forEach(function (s) { totalVentas += Number(s.amount || s.monto_venta || 0); });

        // CXC
        var totalCXC = 0, countCXC = 0;
        receivables.forEach(function (r) {
            var st = (r.status || '').toLowerCase();
            var tipo = (r.tipoDoc || r.tipo_doc || '').toUpperCase();
            if (st === 'pagada' || st === 'anulada' || tipo === 'NC') return;
            if (st === 'pendiente' || st === 'pendiente_pago' || st === 'pendiente_factura' ||
                st === 'facturada' || st === 'vencida_30' || st === 'vencida_60' || st === 'vencida_90') {
                var neto = Number(r.montoNeto || r.monto_neto || r.invoicedAmount || r.monto_venta || r.amount) || 0;
                var totalOwed = (tipo === 'E') ? neto : neto * 1.19;
                var paid = 0;
                if (r.payments && Array.isArray(r.payments)) {
                    paid = r.payments.reduce(function (s, p) { return s + (Number(p.amount) || 0); }, 0);
                }
                var pending = Math.max(0, totalOwed - paid);
                if (pending > 0) { totalCXC += pending; countCXC++; }
            }
        });

        // CXP
        var totalCXP = 0, countCXP = 0;
        payables.forEach(function (p) {
            var st = (p.status || p.paymentStatus || '').toLowerCase();
            if (st === 'pagada') return;
            var amount = Number(p.amount || p.costAmount || p.monto || p.valor_pago) || 0;
            var paid = 0;
            if (p.payments && Array.isArray(p.payments)) {
                paid = p.payments.reduce(function (s, pay) { return s + (Number(pay.amount) || 0); }, 0);
            } else { paid = Number(p.amountPaid) || 0; }
            var pending = Math.max(0, amount - paid);
            countCXP++;
            totalCXP += pending;
        });

        // Issues
        var issueCount = 0, refundTotal = 0;
        sales.forEach(function (s) {
            var refund = Number(s.refundAmount || s.monto_devolucion || 0);
            if (s.hasIssue || s.has_issue || refund > 0) { issueCount++; refundTotal += refund; }
        });

        // Margen
        var cxpCostById = {};
        payables.forEach(function (p) {
            var eid = String(p.eventId || '').trim();
            if (!eid) return;
            cxpCostById[eid] = (cxpCostById[eid] || 0) + (Number(p.amount) || 0);
        });
        var totalCostos = 0;
        sales.forEach(function (s) {
            var sid = String(s.sourceId || s.id || '').trim();
            var cost = (sid && cxpCostById[sid]) ? cxpCostById[sid] : Number(s.costAmount || 0);
            totalCostos += cost;
        });
        var margen = totalVentas - totalCostos;

        var kpiHTML = '' +
            '<div class="kpi-grid">' +
                '<div class="kpi-card accent">' +
                    '<div class="kpi-label">Ventas Totales</div>' +
                    '<div class="kpi-value">' + formatCLP(totalVentas) + '</div>' +
                    '<div class="kpi-sub">' + countVentas + ' ventas registradas</div>' +
                '</div>' +
                '<div class="kpi-card warning">' +
                    '<div class="kpi-label">Por Cobrar (CXC)</div>' +
                    '<div class="kpi-value text-warning">' + formatCLP(totalCXC) + '</div>' +
                    '<div class="kpi-sub">' + countCXC + ' documentos pendientes</div>' +
                '</div>' +
                '<div class="kpi-card danger">' +
                    '<div class="kpi-label">Por Pagar (CXP)</div>' +
                    '<div class="kpi-value text-danger">' + formatCLP(totalCXP) + '</div>' +
                    '<div class="kpi-sub">' + countCXP + ' cuentas pendientes</div>' +
                '</div>' +
                '<div class="kpi-card ' + (issueCount > 0 ? 'danger' : 'success') + '">' +
                    '<div class="kpi-label">Eventos con Problemas</div>' +
                    '<div class="kpi-value ' + (issueCount > 0 ? 'text-danger' : 'text-success') + '">' + issueCount + '</div>' +
                    '<div class="kpi-sub">Devoluciones: ' + formatCLP(refundTotal) + '</div>' +
                '</div>' +
                '<div class="kpi-card ' + (margen >= 0 ? 'success' : 'danger') + '">' +
                    '<div class="kpi-label">Margen Hist\u00f3rico</div>' +
                    '<div class="kpi-value ' + (margen >= 0 ? 'text-success' : 'text-danger') + '">' + formatCLP(margen) + '</div>' +
                    '<div class="kpi-sub">Ventas - costos directos</div>' +
                '</div>' +
            '</div>';

        var chartHTML = buildEventsBarChart(sales, 'past');
        var ivaHTML = buildIVACard(receivables, payables);
        var rankingsHTML = buildRankings(sales, services);
        var upcomingHTML = buildUpcomingEvents(sales, services);

        return kpiHTML + upcomingHTML + chartHTML + ivaHTML + rankingsHTML;
    }

    // ================================================================
    //  COMERCIAL DASHBOARD
    // ================================================================
    function buildComercialDashboard(sales, receivables, services) {
        var totalVentas = 0;
        sales.forEach(function (s) { totalVentas += Number(s.amount || s.monto_venta || 0); });

        // CXC
        var totalCXC = 0, countCXC = 0;
        receivables.forEach(function (r) {
            var st = (r.status || '').toLowerCase();
            var tipo = (r.tipoDoc || r.tipo_doc || '').toUpperCase();
            if (st === 'pagada' || st === 'anulada' || tipo === 'NC') return;
            var neto = Number(r.montoNeto || r.monto_neto || r.invoicedAmount || r.monto_venta || r.amount) || 0;
            var totalOwed = (tipo === 'E') ? neto : neto * 1.19;
            var paid = 0;
            if (r.payments && Array.isArray(r.payments)) {
                paid = r.payments.reduce(function (s, p) { return s + (Number(p.amount) || 0); }, 0);
            }
            var pending = Math.max(0, totalOwed - paid);
            if (pending > 0) { totalCXC += pending; countCXC++; }
        });

        // Cobrado ratio
        var cobradoCount = receivables.filter(function (r) { return (r.status || '').toLowerCase() === 'pagada'; }).length;
        var totalDocs = receivables.length;
        var cobradoPct = totalDocs > 0 ? Math.round((cobradoCount / totalDocs) * 100) : 0;

        var kpiHTML = '' +
            '<div class="kpi-grid">' +
                '<div class="kpi-card accent">' +
                    '<div class="kpi-label">Ventas Totales</div>' +
                    '<div class="kpi-value">' + formatCLP(totalVentas) + '</div>' +
                    '<div class="kpi-sub">' + sales.length + ' ventas</div>' +
                '</div>' +
                '<div class="kpi-card warning">' +
                    '<div class="kpi-label">Por Cobrar</div>' +
                    '<div class="kpi-value text-warning">' + formatCLP(totalCXC) + '</div>' +
                    '<div class="kpi-sub">' + countCXC + ' docs pendientes</div>' +
                '</div>' +
                '<div class="kpi-card ' + (cobradoPct >= 80 ? 'success' : 'warning') + '">' +
                    '<div class="kpi-label">Ratio Cobrado</div>' +
                    '<div class="kpi-value">' + cobradoPct + '%</div>' +
                    '<div class="kpi-sub">' + cobradoCount + ' de ' + totalDocs + ' documentos</div>' +
                '</div>' +
            '</div>';

        var upcomingHTML = buildUpcomingEvents(sales, services);
        var rankingsHTML = buildRankings(sales, services);

        return kpiHTML + upcomingHTML + rankingsHTML;
    }

    // ================================================================
    //  OPERACIONES DASHBOARD
    // ================================================================
    function buildOpsDashboard(sales, payables, services) {
        var now = new Date();

        // ---- KPIs for Ops ----
        // Upcoming events count (next 30 days)
        var in30Days = new Date(now.getTime() + 30 * 86400000);
        var upcomingCount = 0;
        sales.forEach(function (s) {
            var ed = s.eventDate || s.event_date || s.fecha_evento;
            if (!ed) return;
            var d = new Date(ed);
            if (d >= now && d <= in30Days) upcomingCount++;
        });

        // Events with issues
        var issueCount = 0;
        sales.forEach(function (s) {
            var refund = Number(s.refundAmount || s.monto_devolucion || 0);
            if (s.hasIssue || s.has_issue || refund > 0) issueCount++;
        });

        // Overdue events (past date, status not completed)
        var overdueCount = 0;
        sales.forEach(function (s) {
            var ed = s.eventDate || s.event_date || s.fecha_evento;
            if (!ed) return;
            var d = new Date(ed);
            var st = (s.kanbanCol || s.status || '').toLowerCase();
            if (d < now && st !== 'completado' && st !== 'finalizado' && st !== 'cerrado') {
                overdueCount++;
            }
        });

        // CXP ratio (pagado vs pendiente) — ops needs to know if freelancers are paid
        var cxpTotal = 0, cxpPaid = 0;
        payables.forEach(function (p) {
            var amount = Number(p.amount || p.costAmount || 0);
            cxpTotal += amount;
            var st = (p.status || p.paymentStatus || '').toLowerCase();
            if (st === 'pagada') {
                cxpPaid += amount;
            } else if (p.payments && Array.isArray(p.payments)) {
                cxpPaid += p.payments.reduce(function (s, pay) { return s + (Number(pay.amount) || 0); }, 0);
            }
        });
        var cxpPct = cxpTotal > 0 ? Math.round((cxpPaid / cxpTotal) * 100) : 100;

        var kpiHTML = '' +
            '<div class="kpi-grid">' +
                '<div class="kpi-card accent">' +
                    '<div class="kpi-label">Eventos Próximos (30d)</div>' +
                    '<div class="kpi-value">' + upcomingCount + '</div>' +
                    '<div class="kpi-sub">en los próximos 30 días</div>' +
                '</div>' +
                '<div class="kpi-card ' + (overdueCount > 0 ? 'danger' : 'success') + '">' +
                    '<div class="kpi-label">Eventos Atrasados</div>' +
                    '<div class="kpi-value ' + (overdueCount > 0 ? 'text-danger' : 'text-success') + '">' + overdueCount + '</div>' +
                    '<div class="kpi-sub">sin cerrar después de la fecha</div>' +
                '</div>' +
                '<div class="kpi-card ' + (issueCount > 0 ? 'danger' : 'success') + '">' +
                    '<div class="kpi-label">Eventos con Problemas</div>' +
                    '<div class="kpi-value ' + (issueCount > 0 ? 'text-danger' : 'text-success') + '">' + issueCount + '</div>' +
                    '<div class="kpi-sub">requieren atención</div>' +
                '</div>' +
                '<div class="kpi-card ' + (cxpPct >= 80 ? 'success' : 'warning') + '">' +
                    '<div class="kpi-label">Pagos a Proveedores</div>' +
                    '<div class="kpi-value">' + cxpPct + '%</div>' +
                    '<div class="kpi-sub">del total pagado a freelancers</div>' +
                '</div>' +
            '</div>';

        var upcomingHTML = buildUpcomingEvents(sales, services);
        var alertsHTML = buildOpsAlerts(sales);
        var futureChart = buildEventsBarChart(sales, 'future');

        return kpiHTML + alertsHTML + upcomingHTML + futureChart;
    }

    // ================================================================
    //  SHARED COMPONENTS
    // ================================================================

    // --- Upcoming Events (next weeks) ---
    function buildUpcomingEvents(sales, services) {
        var now = new Date();
        now.setHours(0, 0, 0, 0);
        var in7 = new Date(now.getTime() + 7 * 86400000);
        var in14 = new Date(now.getTime() + 14 * 86400000);
        var in21 = new Date(now.getTime() + 21 * 86400000);
        var in28 = new Date(now.getTime() + 28 * 86400000);

        var weeks = [
            { label: 'Esta semana', from: now, to: in7, events: [] },
            { label: 'Próxima semana', from: in7, to: in14, events: [] },
            { label: 'En 2 semanas', from: in14, to: in21, events: [] },
            { label: 'En 3 semanas', from: in21, to: in28, events: [] }
        ];

        // Service name lookup
        var svcMap = {};
        if (services && services.length) {
            services.forEach(function (s) { svcMap[s.id] = s.name || s.nombre || s.id; });
        }

        sales.forEach(function (s) {
            var ed = s.eventDate || s.event_date || s.fecha_evento;
            if (!ed) return;
            var d = new Date(ed);
            d.setHours(0, 0, 0, 0);
            for (var i = 0; i < weeks.length; i++) {
                if (d >= weeks[i].from && d < weeks[i].to) {
                    // Resolve service names
                    var svcNames = [];
                    var ids = s.serviceIds || s.service_ids || [];
                    if (Array.isArray(ids) && ids.length > 0) {
                        ids.forEach(function (id) { svcNames.push(svcMap[id] || id); });
                    } else {
                        var raw = s.serviceNames || s.servicenames || s.servicios || '';
                        if (raw) svcNames = raw.split(/[,;\/+]/).map(function (n) { return n.trim(); }).filter(Boolean);
                    }
                    weeks[i].events.push({
                        client: s.clientName || s.client_name || s.nombre_cliente || 'Sin cliente',
                        date: ed,
                        services: svcNames.slice(0, 3),
                        hasIssue: !!(s.hasIssue || s.has_issue || Number(s.refundAmount || 0) > 0)
                    });
                    break;
                }
            }
        });

        // Build cards
        var cardsHTML = '';
        weeks.forEach(function (w) {
            var count = w.events.length;
            var evList = '';
            if (count === 0) {
                evList = '<p style="color:var(--text-secondary);font-size:12px;padding:8px 0;">Sin eventos</p>';
            } else {
                // Sort by date
                w.events.sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
                w.events.slice(0, 5).forEach(function (ev) {
                    var dateStr = new Date(ev.date).toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short' });
                    var svcs = ev.services.length > 0 ? ev.services.join(', ') : 'Sin servicio';
                    var issueFlag = ev.hasIssue ? ' <span class="badge badge-danger" style="font-size:9px;">Problema</span>' : '';
                    evList += '<div style="padding:6px 0;border-bottom:1px solid var(--border-color);font-size:12px;">' +
                        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
                            '<strong>' + escapeHtml(ev.client) + '</strong>' + issueFlag +
                        '</div>' +
                        '<div style="color:var(--text-secondary);margin-top:2px;">' + dateStr + ' — ' + escapeHtml(svcs) + '</div>' +
                    '</div>';
                });
                if (count > 5) {
                    evList += '<p style="color:var(--text-secondary);font-size:11px;padding:4px 0;">+' + (count - 5) + ' más</p>';
                }
            }

            cardsHTML += '' +
                '<div class="card" style="flex:1;min-width:200px;">' +
                    '<div class="card-header" style="display:flex;justify-content:space-between;align-items:center;">' +
                        '<span class="card-title">' + w.label + '</span>' +
                        '<span class="badge ' + (count > 0 ? 'badge-info' : 'badge-secondary') + '">' + count + '</span>' +
                    '</div>' +
                    '<div style="padding:0 var(--space-sm);">' + evList + '</div>' +
                '</div>';
        });

        return '' +
            '<div style="margin-bottom:var(--space-md);">' +
                '<div style="font-size:13px;font-weight:600;color:var(--text-secondary);margin-bottom:var(--space-sm);">Próximos Eventos</div>' +
                '<div style="display:flex;gap:var(--space-md);flex-wrap:wrap;">' + cardsHTML + '</div>' +
            '</div>';
    }

    // --- Ops Alerts ---
    function buildOpsAlerts(sales) {
        var now = new Date();
        var alerts = [];

        sales.forEach(function (s) {
            var ed = s.eventDate || s.event_date || s.fecha_evento;
            if (!ed) return;
            var d = new Date(ed);
            var client = s.clientName || s.client_name || 'Sin cliente';
            var dateStr = d.toLocaleDateString('es-CL', { day: 'numeric', month: 'short' });
            var daysDiff = Math.round((d - now) / 86400000);

            // Overdue (past event, not closed)
            var st = (s.kanbanCol || s.status || '').toLowerCase();
            if (d < now && st !== 'completado' && st !== 'finalizado' && st !== 'cerrado') {
                alerts.push({ type: 'danger', icon: '&#9888;', text: client + ' (' + dateStr + ') — Evento pasado sin cerrar', priority: 1 });
            }

            // Events with issues
            if (s.hasIssue || s.has_issue || Number(s.refundAmount || 0) > 0) {
                alerts.push({ type: 'warning', icon: '&#9888;', text: client + ' (' + dateStr + ') — Tiene problema reportado', priority: 2 });
            }

            // Upcoming in 3 days without traspaso (no kanbanCol or still in col 1)
            if (daysDiff >= 0 && daysDiff <= 3) {
                var col = s.kanbanCol || '';
                if (!col || col === 'ingreso' || col === 'por_confirmar') {
                    alerts.push({ type: 'warning', icon: '&#128276;', text: client + ' (' + dateStr + ') — Evento en ' + daysDiff + ' días, requiere traspaso', priority: 3 });
                }
            }
        });

        if (alerts.length === 0) {
            return '<div class="card" style="margin-bottom:var(--space-md);">' +
                '<div class="card-header"><span class="card-title">Alertas</span></div>' +
                '<div style="padding:var(--space-md);text-align:center;color:var(--success);font-size:13px;">Todo en orden. Sin alertas pendientes.</div>' +
            '</div>';
        }

        // Sort by priority
        alerts.sort(function (a, b) { return a.priority - b.priority; });

        var rows = alerts.slice(0, 10).map(function (a) {
            var badgeClass = a.type === 'danger' ? 'badge-danger' : 'badge-warning';
            return '<div style="padding:8px 12px;border-bottom:1px solid var(--border-color);display:flex;align-items:center;gap:8px;font-size:13px;">' +
                '<span class="badge ' + badgeClass + '" style="font-size:12px;">' + a.icon + '</span>' +
                '<span>' + a.text + '</span>' +
            '</div>';
        }).join('');

        return '' +
            '<div class="card" style="margin-bottom:var(--space-md);">' +
                '<div class="card-header" style="display:flex;justify-content:space-between;">' +
                    '<span class="card-title">Alertas</span>' +
                    '<span class="badge badge-danger">' + alerts.length + '</span>' +
                '</div>' +
                rows +
            '</div>';
    }

    // --- Bar chart (past or future months) ---
    function buildEventsBarChart(sales, mode) {
        var months = mode === 'future' ? getNext6Months() : getLast6Months();
        var title = mode === 'future' ? 'Eventos Próximos por Mes' : 'Eventos por Mes';
        var monthCounts = {};
        months.forEach(function (m) { monthCounts[m.key] = 0; });

        sales.forEach(function (s) {
            var ed = s.eventDate || s.event_date || s.fecha_evento;
            if (!ed) return;
            var key = getMonthKey(ed);
            if (monthCounts.hasOwnProperty(key)) monthCounts[key]++;
        });

        var maxCount = 1;
        months.forEach(function (m) { if (monthCounts[m.key] > maxCount) maxCount = monthCounts[m.key]; });

        var barsHTML = '';
        months.forEach(function (m) {
            var count = monthCounts[m.key];
            var pct = Math.round((count / maxCount) * 100);
            barsHTML += '' +
                '<div style="display:flex;flex-direction:column;align-items:center;flex:1;gap:8px;">' +
                    '<span style="font-size:13px;font-weight:600;color:var(--text-primary);">' + count + '</span>' +
                    '<div style="width:100%;background:var(--bg-tertiary);border-radius:4px;height:160px;display:flex;align-items:flex-end;justify-content:center;">' +
                        '<div style="width:60%;min-height:4px;height:' + pct + '%;background:var(--accent-gradient);border-radius:4px 4px 0 0;transition:height 0.4s ease;"></div>' +
                    '</div>' +
                    '<span style="font-size:11px;color:var(--text-secondary);">' + m.label + '</span>' +
                '</div>';
        });

        return '' +
            '<div class="card" style="margin-bottom:var(--space-md);">' +
                '<div class="card-header"><span class="card-title">' + title + '</span></div>' +
                '<div style="display:flex;gap:var(--space-md);align-items:flex-end;padding:var(--space-md) 0;">' +
                    barsHTML +
                '</div>' +
            '</div>';
    }

    // --- Rankings ---
    function buildRankings(sales, services) {
        var oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        var salesForRankings = rankingsScope === 'year'
            ? sales.filter(function (s) {
                var d = s.eventDate || s.event_date;
                return d && new Date(d) >= oneYearAgo;
            })
            : sales;

        var scopeLabel = rankingsScope === 'year' ? '\u00daltimo a\u00f1o' : 'Hist\u00f3rico';
        var toggleHTML = '<div class="toggle-group" id="rankings-scope-toggle">' +
            '<button class="toggle-option' + (rankingsScope === 'year' ? ' active' : '') + '" data-scope="year">\u00daltimo a\u00f1o</button>' +
            '<button class="toggle-option' + (rankingsScope === 'all' ? ' active' : '') + '" data-scope="all">Hist\u00f3rico</button>' +
            '</div>';

        // Top 5 Clientes
        var clientTotals = {};
        salesForRankings.forEach(function (s) {
            var name = s.clientName || s.client_name || s.nombre_cliente || 'Sin cliente';
            var amt = Number(s.amount || s.monto_venta || 0);
            clientTotals[name] = (clientTotals[name] || 0) + amt;
        });
        var topClients = Object.keys(clientTotals).map(function (name) {
            return { name: name, total: clientTotals[name] };
        }).sort(function (a, b) { return b.total - a.total; }).slice(0, 5);

        var clientRows = topClients.length === 0
            ? '<tr><td colspan="2" class="text-center text-muted" style="padding:16px;">Sin datos</td></tr>'
            : topClients.map(function (c, i) {
                return '<tr><td>' + (i + 1) + '. ' + escapeHtml(c.name) + '</td><td class="text-right">' + formatCLP(c.total) + '</td></tr>';
            }).join('');

        var clientsCardHTML = '' +
            '<div class="card">' +
                '<div class="card-header"><span class="card-title">Top 5 Clientes</span><span class="badge badge-info">Por monto</span></div>' +
                '<table class="data-table"><thead><tr><th>Cliente</th><th class="text-right">Monto Total</th></tr></thead>' +
                '<tbody>' + clientRows + '</tbody></table>' +
            '</div>';

        // Top 5 Servicios
        var serviceCounts = {};
        salesForRankings.forEach(function (s) {
            var ids = s.serviceIds || s.service_ids || [];
            if (Array.isArray(ids) && ids.length > 0) {
                ids.forEach(function (sid) { serviceCounts[sid] = (serviceCounts[sid] || 0) + 1; });
            } else {
                var namesStr = s.serviceNames || s.servicenames || s.servicios || '';
                if (typeof namesStr === 'string' && namesStr.trim()) {
                    namesStr.split(/[,;\/+]/).forEach(function (n) {
                        var name = n.trim();
                        if (name) serviceCounts[name] = (serviceCounts[name] || 0) + 1;
                    });
                }
            }
        });

        var serviceMap = {};
        if (services && services.length) {
            services.forEach(function (svc) { serviceMap[svc.id] = svc.name || svc.nombre || svc.serviceName || svc.id; });
        }
        var topServices = Object.keys(serviceCounts).map(function (sid) {
            return { id: sid, name: serviceMap[sid] || sid, count: serviceCounts[sid] };
        }).sort(function (a, b) { return b.count - a.count; }).slice(0, 5);

        var serviceRows = topServices.length === 0
            ? '<tr><td colspan="2" class="text-center text-muted" style="padding:16px;">Sin datos</td></tr>'
            : topServices.map(function (sv, i) {
                return '<tr><td>' + (i + 1) + '. ' + escapeHtml(sv.name) + '</td><td class="text-right"><span class="badge badge-success">' + sv.count + ' eventos</span></td></tr>';
            }).join('');

        var servicesCardHTML = '' +
            '<div class="card">' +
                '<div class="card-header"><span class="card-title">Top 5 Servicios</span><span class="badge badge-info">Por uso</span></div>' +
                '<table class="data-table"><thead><tr><th>Servicio</th><th class="text-right">Cantidad</th></tr></thead>' +
                '<tbody>' + serviceRows + '</tbody></table>' +
            '</div>';

        return '' +
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-md);">' +
                '<span style="font-size:13px;color:var(--text-secondary);">Per\u00edodo: <strong>' + scopeLabel + '</strong></span>' +
                toggleHTML +
            '</div>' +
            '<div class="kpi-grid-2">' + clientsCardHTML + servicesCardHTML + '</div>';
    }

    // --- IVA Card ---
    function toMonthKey(dateStr) {
        if (!dateStr) return null;
        var s = String(dateStr).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.substring(0, 7);
        var dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (dmy) return dmy[3] + '-' + dmy[2].padStart(2, '0');
        if (/^\d{4}-\d{2}$/.test(s)) return s;
        var my = s.match(/^(\d{1,2})\/(\d{4})$/);
        if (my) return my[2] + '-' + my[1].padStart(2, '0');
        return null;
    }

    function getBHRetentionRate(dateStr) {
        if (!dateStr) return 0.1525;
        var year = new Date(dateStr).getFullYear();
        return year <= 2024 ? 0.145 : 0.1525;
    }

    function buildIVACard(receivables, payables) {
        var now = new Date();
        var thisMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
        var lastMonth = (function () {
            var d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        })();
        var months = [thisMonth, lastMonth];
        var labels = { [thisMonth]: 'Este mes', [lastMonth]: 'Mes pasado (declaraci\u00f3n pendiente)' };

        var data = {};
        months.forEach(function (m) { data[m] = { ivaDebito: 0, ivaCredito: 0, retencionBH: 0 }; });

        receivables.forEach(function (r) {
            var tipo = (r.tipoDoc || '').toUpperCase();
            if (tipo === 'NC' || tipo === 'E') return;
            var mk = toMonthKey(r.billingMonth);
            if (!mk || !data[mk]) return;
            data[mk].ivaDebito += (Number(r.invoicedAmount || r.montoNeto) || 0) * 0.19;
        });

        payables.forEach(function (p) {
            var dt = (p.docType || '').toLowerCase();
            var mk = toMonthKey(p.billingDate || p.eventDate);
            if (!mk || !data[mk]) return;
            if (dt === 'factura') {
                data[mk].ivaCredito += (Number(p.amount) || 0) * 0.19;
            } else if (dt === 'bh') {
                var rate = getBHRetentionRate(p.billingDate || p.eventDate);
                data[mk].retencionBH += (Number(p.amount) || 0) * rate;
            }
        });

        var cards = months.map(function (m) {
            var d = data[m];
            var deb = Math.round(d.ivaDebito);
            var cred = Math.round(d.ivaCredito);
            var ret = Math.round(d.retencionBH);
            var neto = deb - cred + ret;
            var color = neto > 0 ? 'var(--danger)' : 'var(--success)';
            return '<div class="card" style="flex:1">' +
                '<div class="card-header"><span class="card-title">IVA ' + labels[m] + '</span></div>' +
                '<table style="width:100%;font-size:13px;border-collapse:collapse">' +
                '<tr><td style="padding:5px 0;color:var(--text-secondary)">D\u00e9bito fiscal (ventas)</td><td class="text-right" style="font-weight:600">' + formatCLP(deb) + '</td></tr>' +
                '<tr><td style="padding:5px 0;color:var(--text-secondary)">Cr\u00e9dito fiscal (compras)</td><td class="text-right" style="font-weight:600;color:var(--success)">- ' + formatCLP(cred) + '</td></tr>' +
                '<tr><td style="padding:5px 0;color:var(--text-secondary)">Retenci\u00f3n BH</td><td class="text-right" style="font-weight:600">' + formatCLP(ret) + '</td></tr>' +
                '<tr style="border-top:2px solid var(--border)"><td style="padding:8px 0;font-weight:700">IVA Neto estimado</td><td class="text-right" style="font-weight:700;font-size:15px;color:' + color + '">' + formatCLP(neto) + '</td></tr>' +
                '</table>' +
                '<div style="font-size:11px;color:var(--text-muted);margin-top:8px">IVA ventas - IVA compras + Ret. BH. No incluye PPM.</div>' +
                '</div>';
        }).join('');

        return '<div style="margin-bottom:var(--space-md)">' +
            '<div style="font-size:13px;font-weight:600;color:var(--text-secondary);margin-bottom:var(--space-sm)">Estimaci\u00f3n de IVA mensual</div>' +
            '<div style="display:flex;gap:var(--space-md)">' + cards + '</div>' +
            '</div>';
    }

    // --------------- init ---------------

    async function init() {
        try {
            var sales = await window.Mazelab.DataService.getAll('sales') || [];
            var receivables = await window.Mazelab.DataService.getAll('receivables') || [];
            var payables = await window.Mazelab.DataService.getAll('payables') || [];
            var services = [];
            try { services = await window.Mazelab.DataService.getAll('services') || []; } catch (e) {}

            var body = document.getElementById('dashboard-body');
            if (body) {
                body.innerHTML = buildDashboard(sales, receivables, payables, services);
                body.addEventListener('click', function (e) {
                    var btn = e.target.closest('#rankings-scope-toggle .toggle-option');
                    if (btn && btn.dataset.scope && btn.dataset.scope !== rankingsScope) {
                        rankingsScope = btn.dataset.scope;
                        body.innerHTML = buildDashboard(sales, receivables, payables, services);
                    }
                });
            }
        } catch (err) {
            console.error('Dashboard init error:', err);
            var body = document.getElementById('dashboard-body');
            if (body) {
                body.innerHTML = '<div class="empty-state"><p class="text-danger">Error al cargar datos del dashboard.</p><p class="text-muted">' + (err.message || err) + '</p></div>';
            }
        }
    }

    return { render: render, init: init };

})();
