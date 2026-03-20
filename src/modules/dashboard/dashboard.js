window.Mazelab = window.Mazelab || {};
window.Mazelab.Modules = window.Mazelab.Modules || {};

window.Mazelab.Modules.DashboardModule = (function () {

    // --------------- helpers ---------------

    // Parse date string as LOCAL date (not UTC). "2026-03-19" → Mar 19 00:00 local time.
    function parseLocalDate(str) {
        if (!str) return null;
        var parts = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (parts) return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
        return new Date(str);
    }

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
        var yoyHTML = buildYoYChart(sales);
        var quarterlyHTML = buildQuarterlyView(sales);
        var comercialCards = buildComercialCards(sales, receivables, services);

        return kpiHTML + upcomingHTML + yoyHTML + quarterlyHTML + chartHTML + ivaHTML + rankingsHTML + comercialCards;
    }

    // ================================================================
    //  COMERCIAL DASHBOARD
    // ================================================================
    function buildComercialDashboard(sales, receivables, services) {
        var now = new Date();
        var thisYear = now.getFullYear();
        var lastYear = thisYear - 1;
        var twoYearsAgo = thisYear - 2;

        // ---- Yearly totals ----
        var totalThisYear = 0, totalLastYear = 0, totalTwoYearsAgo = 0, totalAll = 0;
        var countThisYear = 0;
        sales.forEach(function (s) {
            var amt = Number(s.amount || s.monto_venta || 0);
            var ed = getSaleDate(s);
            if (!ed) { totalAll += amt; return; }
            var y = new Date(ed).getFullYear();
            totalAll += amt;
            if (y === thisYear) { totalThisYear += amt; countThisYear++; }
            else if (y === lastYear) totalLastYear += amt;
            else if (y === twoYearsAgo) totalTwoYearsAgo += amt;
        });

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
                paid = r.payments.reduce(function (s2, p) { return s2 + (Number(p.amount) || 0); }, 0);
            }
            var pending = Math.max(0, totalOwed - paid);
            if (pending > 0) { totalCXC += pending; countCXC++; }
        });

        var cobradoCount = receivables.filter(function (r) { return (r.status || '').toLowerCase() === 'pagada'; }).length;
        var totalDocs = receivables.length;
        var cobradoPct = totalDocs > 0 ? Math.round((cobradoCount / totalDocs) * 100) : 0;

        // Ticket promedio
        var avgTicket = countThisYear > 0 ? Math.round(totalThisYear / countThisYear) : 0;

        // ---- KPIs ----
        var kpiHTML = '' +
            '<div class="kpi-grid">' +
                '<div class="kpi-card accent">' +
                    '<div class="kpi-label">Ventas ' + thisYear + '</div>' +
                    '<div class="kpi-value">' + formatCLP(totalThisYear) + '</div>' +
                    '<div class="kpi-sub">' + countThisYear + ' ventas</div>' +
                '</div>' +
                '<div class="kpi-card">' +
                    '<div class="kpi-label">Meta: ' + lastYear + '</div>' +
                    '<div class="kpi-value">' + formatCLP(totalLastYear) + '</div>' +
                    '<div class="kpi-sub">' + (totalLastYear > 0 ? Math.round(totalThisYear / totalLastYear * 100) + '% alcanzado' : '-') + '</div>' +
                '</div>' +
                '<div class="kpi-card warning">' +
                    '<div class="kpi-label">Por Cobrar</div>' +
                    '<div class="kpi-value text-warning">' + formatCLP(totalCXC) + '</div>' +
                    '<div class="kpi-sub">' + countCXC + ' docs pendientes</div>' +
                '</div>' +
                '<div class="kpi-card ' + (cobradoPct >= 80 ? 'success' : 'warning') + '">' +
                    '<div class="kpi-label">Ratio Cobrado</div>' +
                    '<div class="kpi-value">' + cobradoPct + '%</div>' +
                    '<div class="kpi-sub">' + cobradoCount + ' de ' + totalDocs + '</div>' +
                '</div>' +
                '<div class="kpi-card">' +
                    '<div class="kpi-label">Ticket Promedio</div>' +
                    '<div class="kpi-value">' + formatCLP(avgTicket) + '</div>' +
                    '<div class="kpi-sub">' + thisYear + '</div>' +
                '</div>' +
            '</div>';

        var yoyHTML = buildYoYChart(sales);
        var quarterlyHTML = buildQuarterlyView(sales);
        var upcomingHTML = buildUpcomingEvents(sales, services);
        var comercialCards = buildComercialCards(sales, receivables, services);

        return kpiHTML + yoyHTML + quarterlyHTML + upcomingHTML + comercialCards;
    }

    function formatCLPShort(n) {
        if (n == null || isNaN(n) || n === 0) return '$0';
        var abs = Math.abs(n);
        if (abs >= 1000000) return (n < 0 ? '-' : '') + '$' + (abs / 1000000).toFixed(1) + 'M';
        if (abs >= 1000) return (n < 0 ? '-' : '') + '$' + Math.round(abs / 1000) + 'K';
        return formatCLP(n);
    }

    // Helper: get closing date (date sale was closed, not event date)
    function getSaleDate(s) {
        return s.closingDate || s.closing_date || s.eventDate || s.event_date || s.fecha_evento || '';
    }

    // --- Reusable: YoY Chart ---
    function buildYoYChart(sales) {
        var now = new Date();
        var thisYear = now.getFullYear();
        var lastYear = thisYear - 1;
        var twoYearsAgo = thisYear - 2;
        var months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
        var yoyData = {};
        [thisYear, lastYear, twoYearsAgo].forEach(function (y) { yoyData[y] = new Array(12).fill(0); });
        sales.forEach(function (s) {
            var ed = getSaleDate(s);
            if (!ed) return;
            var d = new Date(ed);
            var y = d.getFullYear();
            var m = d.getMonth();
            if (yoyData[y]) yoyData[y][m] += Number(s.amount || s.monto_venta || 0);
        });

        // Debug: log 2026 Q1 for verification
        console.log('[Dashboard YoY] Ventas por closingDate:');
        [thisYear, lastYear, twoYearsAgo].forEach(function (y) {
            console.log('  ' + y + ':', months.map(function (m, i) { return m + ': ' + formatCLPShort(yoyData[y][i]); }).join(' | '));
        });
        var maxYoY = 1;
        [thisYear, lastYear, twoYearsAgo].forEach(function (y) {
            yoyData[y].forEach(function (v) { if (v > maxYoY) maxYoY = v; });
        });
        var colors = {};
        colors[thisYear] = '#00e676';
        colors[lastYear] = '#475569';
        colors[twoYearsAgo] = 'rgba(255,255,255,0.08)';
        var yoyBars = '';
        for (var mi = 0; mi < 12; mi++) {
            var bars = '';
            [twoYearsAgo, lastYear, thisYear].forEach(function (y) {
                var val = yoyData[y][mi];
                var pct = Math.round((val / maxYoY) * 100);
                bars += '<div style="flex:1;background:' + colors[y] + ';height:' + Math.max(pct, 2) + '%;border-radius:2px 2px 0 0;" title="' + y + ': ' + formatCLP(val) + '"></div>';
            });
            var isCurrentMonth = mi === now.getMonth();
            yoyBars += '<div style="display:flex;flex-direction:column;align-items:center;flex:1;gap:4px;">' +
                '<div style="font-size:11px;font-weight:600;color:var(--text-primary);">' + formatCLPShort(yoyData[thisYear][mi]) + '</div>' +
                '<div style="width:100%;height:140px;display:flex;align-items:flex-end;gap:2px;">' + bars + '</div>' +
                '<span style="font-size:10px;color:' + (isCurrentMonth ? 'var(--accent-primary)' : 'var(--text-secondary)') + ';font-weight:' + (isCurrentMonth ? '700' : '400') + ';">' + months[mi] + '</span>' +
            '</div>';
        }
        var yoyLegend = '<div style="display:flex;gap:16px;justify-content:center;margin-top:8px;font-size:11px;">';
        [thisYear, lastYear, twoYearsAgo].forEach(function (y) {
            yoyLegend += '<span><span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:' + colors[y] + ';vertical-align:middle;margin-right:4px;"></span>' + y + ' (' + formatCLPShort(yoyData[y].reduce(function (a, b) { return a + b; }, 0)) + ')</span>';
        });
        yoyLegend += '</div>';
        // YoY summary table
        var yoyTable = '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px;">';
        yoyTable += '<thead><tr><th style="text-align:left;padding:3px 6px;color:var(--text-secondary);font-size:11px;">Año</th>';
        months.forEach(function (m) { yoyTable += '<th style="text-align:right;padding:3px 4px;color:var(--text-secondary);font-size:11px;">' + m + '</th>'; });
        yoyTable += '<th style="text-align:right;padding:3px 6px;color:var(--text-secondary);font-size:11px;font-weight:700;">Total</th></tr></thead><tbody>';
        [thisYear, lastYear, twoYearsAgo].forEach(function (y) {
            var yearTotal = yoyData[y].reduce(function (a, b) { return a + b; }, 0);
            yoyTable += '<tr><td style="padding:3px 6px;font-weight:600;color:var(--text-primary);">' + y + '</td>';
            yoyData[y].forEach(function (v) {
                yoyTable += '<td style="text-align:right;padding:3px 4px;font-variant-numeric:tabular-nums;color:var(--text-primary);">' + formatCLPShort(v) + '</td>';
            });
            yoyTable += '<td style="text-align:right;padding:3px 6px;font-weight:700;color:var(--text-primary);">' + formatCLPShort(yearTotal) + '</td></tr>';
        });
        yoyTable += '</tbody></table>';

        return '<div class="card" style="margin-bottom:var(--space-md);">' +
            '<div class="card-header"><span class="card-title">Ventas por Mes — Comparativa Anual</span></div>' +
            '<div style="display:flex;gap:4px;align-items:flex-end;padding:var(--space-md) var(--space-sm);">' + yoyBars + '</div>' +
            yoyLegend + yoyTable + '</div>';
    }

    // --- Quarterly comparison with top events ---
    function buildQuarterlyView(sales) {
        var now = new Date();
        var thisYear = now.getFullYear();
        var lastYear = thisYear - 1;
        var qLabels = ['Q1 (Ene-Mar)', 'Q2 (Abr-Jun)', 'Q3 (Jul-Sep)', 'Q4 (Oct-Dic)'];

        // Build quarterly data
        var qData = {};
        [thisYear, lastYear].forEach(function (y) {
            qData[y] = [
                { total: 0, count: 0, topEvents: [] },
                { total: 0, count: 0, topEvents: [] },
                { total: 0, count: 0, topEvents: [] },
                { total: 0, count: 0, topEvents: [] }
            ];
        });

        sales.forEach(function (s) {
            var ed = getSaleDate(s);
            if (!ed) return;
            var d = new Date(ed);
            var y = d.getFullYear();
            if (!qData[y]) return;
            var q = Math.floor(d.getMonth() / 3);
            var amt = Number(s.amount || s.monto_venta || 0);
            qData[y][q].total += amt;
            qData[y][q].count++;
            qData[y][q].topEvents.push({
                name: (s.clientName || s.client_name || '') + ' — ' + (s.eventName || s.event_name || ''),
                amount: amt
            });
        });

        // Sort top events
        [thisYear, lastYear].forEach(function (y) {
            for (var q = 0; q < 4; q++) {
                qData[y][q].topEvents.sort(function (a, b) { return b.amount - a.amount; });
            }
        });

        var html = '';
        for (var q = 0; q < 4; q++) {
            var curr = qData[thisYear][q];
            var prev = qData[lastYear][q];
            var diff = prev.total > 0 ? Math.round((curr.total - prev.total) / prev.total * 100) : 0;
            var diffColor = diff >= 0 ? 'var(--success)' : 'var(--danger)';
            var diffLabel = diff >= 0 ? '+' + diff + '%' : diff + '%';

            html += '<div class="card" style="flex:1;min-width:220px;">';
            html += '<div class="card-header" style="padding:10px 14px;">';
            html += '<span class="card-title" style="font-size:13px;">' + qLabels[q] + '</span>';
            if (prev.total > 0) html += '<span style="color:' + diffColor + ';font-size:12px;font-weight:700;">' + diffLabel + '</span>';
            html += '</div>';
            html += '<div style="padding:8px 14px;">';
            html += '<div style="display:flex;justify-content:space-between;margin-bottom:6px;">';
            html += '<div><div style="font-size:11px;color:var(--text-secondary);">' + thisYear + '</div><div style="font-size:18px;font-weight:700;color:var(--text-primary);">' + formatCLPShort(curr.total) + '</div><div style="font-size:11px;color:var(--text-secondary);">' + curr.count + ' ventas</div></div>';
            html += '<div style="text-align:right;"><div style="font-size:11px;color:var(--text-secondary);">' + lastYear + '</div><div style="font-size:14px;font-weight:600;color:var(--text-secondary);">' + formatCLPShort(prev.total) + '</div><div style="font-size:11px;color:var(--text-secondary);">' + prev.count + ' ventas</div></div>';
            html += '</div>';

            // Top 3 events of current year quarter
            var top = curr.topEvents.slice(0, 3);
            if (top.length > 0) {
                html += '<div style="border-top:1px solid var(--border-color);padding-top:6px;margin-top:4px;">';
                top.forEach(function (ev) {
                    html += '<div style="font-size:11px;display:flex;justify-content:space-between;padding:2px 0;"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:65%;">' + escapeHtml(ev.name) + '</span><span style="font-weight:600;font-variant-numeric:tabular-nums;">' + formatCLPShort(ev.amount) + '</span></div>';
                });
                html += '</div>';
            }
            html += '</div></div>';
        }

        return '<div style="margin-bottom:var(--space-md);">' +
            '<div style="font-size:13px;font-weight:600;color:var(--text-secondary);margin-bottom:var(--space-sm);">Comparativa Trimestral ' + thisYear + ' vs ' + lastYear + '</div>' +
            '<div style="display:flex;gap:var(--space-md);flex-wrap:wrap;">' + html + '</div></div>';
    }

    // --- Reusable: Commercial cards (servicios top, clientes, ejecutivos) ---
    function buildComercialCards(sales, receivables, services) {
        var now = new Date();
        var thisYear = now.getFullYear();
        var lastYear = thisYear - 1;
        var svcMap = {};
        if (services && services.length) {
            services.forEach(function (sv) { svcMap[sv.id] = sv.name || sv.nombre || sv.id; });
        }
        // Service stats — ticket promedio por jornada (no por venta total)
        var svcStats = {};
        sales.forEach(function (s) {
            var ed = s.eventDate || s.event_date || '';
            var y = ed ? new Date(ed).getFullYear() : 0;
            if (y !== thisYear && y !== lastYear) return;
            var amt = Number(s.amount || s.monto_venta || 0);
            var jornadas = Math.max(Number(s.jornadas) || 1, 1);
            var amtPerJornada = amt / jornadas;
            var ids = s.serviceIds || s.service_ids || [];
            if (Array.isArray(ids) && ids.length > 0) {
                ids.forEach(function (sid) {
                    if (!svcStats[sid]) svcStats[sid] = { name: svcMap[sid] || sid, count: 0, totalAmt: 0, totalJornadas: 0 };
                    svcStats[sid].count++;
                    svcStats[sid].totalAmt += amtPerJornada / ids.length;
                    svcStats[sid].totalJornadas += jornadas;
                });
            } else {
                var raw = s.serviceNames || s.servicenames || s.servicios || '';
                if (raw) {
                    var names = raw.split(/[,;\/+]/).map(function (n) { return n.trim(); }).filter(Boolean);
                    names.forEach(function (n) {
                        if (!svcStats[n]) svcStats[n] = { name: n, count: 0, totalAmt: 0, totalJornadas: 0 };
                        svcStats[n].count++;
                        svcStats[n].totalAmt += amtPerJornada / names.length;
                        svcStats[n].totalJornadas += jornadas;
                    });
                }
            }
        });
        var allSvcs = Object.values(svcStats).sort(function (a, b) { return b.count - a.count; });
        var topSvcs = allSvcs.slice(0, 8);
        var svcRows = topSvcs.length === 0 ? '<tr><td colspan="3" style="text-align:center;padding:16px;color:var(--text-muted)">Sin datos</td></tr>'
            : topSvcs.map(function (sv, i) {
                var avg = sv.count > 0 ? Math.round(sv.totalAmt / sv.count) : 0;
                return '<tr><td>' + (i + 1) + '. ' + escapeHtml(sv.name) + '</td><td class="text-right"><span class="badge badge-success">' + sv.count + '</span></td><td class="text-right">' + formatCLP(avg) + '</td></tr>';
            }).join('');
        var svcVerMas = allSvcs.length > 8 ? '<div style="text-align:center;padding:8px;"><button class="btn btn-secondary btn-sm dash-ver-mas" data-target="dash-svc-full" style="font-size:11px;">Ver todos (' + allSvcs.length + ')</button></div>' : '';
        var svcFullRows = allSvcs.slice(8).map(function (sv, i) {
            var avg = sv.count > 0 ? Math.round(sv.totalAmt / sv.count) : 0;
            return '<tr><td>' + (i + 9) + '. ' + escapeHtml(sv.name) + '</td><td class="text-right"><span class="badge badge-success">' + sv.count + '</span></td><td class="text-right">' + formatCLP(avg) + '</td></tr>';
        }).join('');
        var svcCardHTML = '<div class="card">' +
            '<div class="card-header"><span class="card-title">Servicios M\u00e1s Vendidos</span><span class="badge badge-info">' + thisYear + '-' + lastYear + '</span></div>' +
            '<table class="data-table"><thead><tr><th>Servicio</th><th class="text-right">Eventos</th><th class="text-right">Prom./Jornada</th></tr></thead><tbody>' + svcRows + '</tbody>' +
            '<tbody id="dash-svc-full" style="display:none;">' + svcFullRows + '</tbody></table>' + svcVerMas + '</div>';

        // Ejecutivos — build from sales, enrich with receivables for same saleId
        var execData = {};
        var salesById = {};
        sales.forEach(function (s) {
            var ed = s.eventDate || s.event_date || '';
            var y = ed ? new Date(ed).getFullYear() : 0;
            if (y !== thisYear) return;
            var exec = s.staffName || s.ejecutivo || s.vendedor || s.salesperson || s.createdBy || 'Sin asignar';
            if (!execData[exec]) execData[exec] = { name: exec, count: 0, total: 0, cobrado: 0 };
            execData[exec].count++;
            var amt = Number(s.amount || s.monto_venta || 0);
            execData[exec].total += amt;
            salesById[String(s.id)] = exec;
            salesById[String(s.sourceId || '')] = exec;
        });
        // Only count cobrado for receivables linked to this year's sales
        receivables.forEach(function (r) {
            var saleId = String(r.saleId || r.eventId || '');
            var exec = salesById[saleId];
            if (!exec || !execData[exec]) return;
            var st = (r.status || '').toLowerCase();
            if (st === 'pagada') {
                var neto = Number(r.montoNeto || r.monto_neto || r.invoicedAmount || 0);
                execData[exec].cobrado += neto;
            }
        });
        // Also build per-exec monthly sales for drill-down
        var execSales = {};
        var recStatusByEvent = {};
        receivables.forEach(function (r) {
            var sid = String(r.saleId || r.eventId || '');
            if (!sid) return;
            var st = (r.status || '').toLowerCase();
            if (st === 'pagada') recStatusByEvent[sid] = 'pagada';
            else if (!recStatusByEvent[sid]) recStatusByEvent[sid] = st;
        });
        sales.forEach(function (s) {
            var ed = s.eventDate || s.event_date || '';
            var y = ed ? new Date(ed).getFullYear() : 0;
            if (y !== thisYear) return;
            var exec = s.staffName || s.ejecutivo || s.vendedor || s.salesperson || s.createdBy || 'Sin asignar';
            if (!execSales[exec]) execSales[exec] = [];
            var sid = String(s.id || '');
            var recSt = recStatusByEvent[sid] || recStatusByEvent[String(s.sourceId || '')] || '';
            execSales[exec].push({
                client: s.clientName || s.client_name || '',
                event: s.eventName || s.event_name || '',
                date: ed,
                amount: Number(s.amount || s.monto_venta || 0),
                paid: recSt === 'pagada'
            });
        });

        var execList = Object.values(execData).sort(function (a, b) { return b.total - a.total; });
        var thStyle = 'text-align:right;padding:6px 8px;font-variant-numeric:tabular-nums;';
        var execRows = execList.length === 0 ? '<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--text-muted)">Sin datos</td></tr>'
            : execList.map(function (ex) {
                var pct = ex.total > 0 ? Math.round(ex.cobrado / ex.total * 100) : 0;
                var pctColor = pct >= 80 ? 'var(--success)' : pct >= 50 ? 'var(--warning)' : 'var(--danger)';
                return '<tr class="dash-exec-row" data-exec="' + escapeHtml(ex.name) + '" style="cursor:pointer;">' +
                    '<td style="padding:6px 8px;"><strong>' + escapeHtml(ex.name) + '</strong></td>' +
                    '<td style="' + thStyle + '">' + ex.count + '</td>' +
                    '<td style="' + thStyle + '">' + formatCLP(ex.total) + '</td>' +
                    '<td style="' + thStyle + 'color:var(--success)">' + formatCLP(ex.cobrado) + '</td>' +
                    '<td style="' + thStyle + '"><span style="color:' + pctColor + ';font-weight:600">' + pct + '%</span></td>' +
                '</tr>';
            }).join('');
        var execCardHTML = '<div class="card" style="margin-bottom:var(--space-md);">' +
            '<div class="card-header"><span class="card-title">Ejecutivos de Ventas</span><span class="badge badge-info">' + thisYear + '</span></div>' +
            '<table class="data-table"><thead><tr><th style="padding:6px 8px;">Ejecutivo</th><th style="' + thStyle + '">Ventas</th><th style="' + thStyle + '">Monto</th><th style="' + thStyle + '">Cobrado</th><th style="' + thStyle + '">% Cobro</th></tr></thead><tbody>' + execRows + '</tbody></table>' +
            '<div id="dash-exec-detail"></div></div>';

        // Store execSales on window for click handler
        window._dashExecSales = execSales;

        // Top clientes
        var clientStats = {};
        sales.forEach(function (s) {
            var ed = s.eventDate || s.event_date || '';
            var y = ed ? new Date(ed).getFullYear() : 0;
            if (y !== thisYear && y !== lastYear) return;
            var name = s.clientName || s.client_name || 'Sin cliente';
            if (!clientStats[name]) clientStats[name] = { name: name, count: 0, total: 0 };
            clientStats[name].count++;
            clientStats[name].total += Number(s.amount || s.monto_venta || 0);
        });
        var allClients = Object.values(clientStats).sort(function (a, b) { return b.total - a.total; });
        var topClients = allClients.slice(0, 8);
        var clientRows = topClients.length === 0 ? '<tr><td colspan="3" style="text-align:center;padding:16px;color:var(--text-muted)">Sin datos</td></tr>'
            : topClients.map(function (c, i) {
                return '<tr><td>' + (i + 1) + '. ' + escapeHtml(c.name) + '</td><td class="text-right">' + c.count + ' eventos</td><td class="text-right">' + formatCLP(c.total) + '</td></tr>';
            }).join('');
        var clientVerMas = allClients.length > 8 ? '<div style="text-align:center;padding:8px;"><button class="btn btn-secondary btn-sm dash-ver-mas" data-target="dash-cli-full" style="font-size:11px;">Ver todos (' + allClients.length + ')</button></div>' : '';
        var clientFullRows = allClients.slice(8).map(function (c, i) {
            return '<tr><td>' + (i + 9) + '. ' + escapeHtml(c.name) + '</td><td class="text-right">' + c.count + ' eventos</td><td class="text-right">' + formatCLP(c.total) + '</td></tr>';
        }).join('');
        var clientCardHTML = '<div class="card">' +
            '<div class="card-header"><span class="card-title">Mejores Clientes</span><span class="badge badge-info">' + thisYear + '-' + lastYear + '</span></div>' +
            '<table class="data-table"><thead><tr><th>Cliente</th><th class="text-right">Eventos</th><th class="text-right">Monto</th></tr></thead><tbody>' + clientRows + '</tbody>' +
            '<tbody id="dash-cli-full" style="display:none;">' + clientFullRows + '</tbody></table>' + clientVerMas + '</div>';

        return '<div class="kpi-grid-2">' + svcCardHTML + clientCardHTML + '</div>' + execCardHTML;
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
            var d = parseLocalDate(ed);
            if (d && d >= now && d <= in30Days) upcomingCount++;
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
            var d = parseLocalDate(ed);
            var st = (s.kanbanCol || s.status || '').toLowerCase();
            if (d && d < now && st !== 'completado' && st !== 'finalizado' && st !== 'cerrado') {
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
            var d = parseLocalDate(ed);
            if (!d) return;
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
            var d = parseLocalDate(ed);
            if (!d) return;
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
            var staffList = [];
            try { staffList = await window.Mazelab.DataService.getAll('staff') || []; } catch (e) {}

            // Resolve staffId → staffName on sales for ejecutivos display
            var staffMap = {};
            staffList.forEach(function (st) { staffMap[st.id] = st.name || st.nombre || st.id; });
            sales.forEach(function (s) {
                if (!s.staffName && s.staffId && staffMap[s.staffId]) {
                    s.staffName = staffMap[s.staffId];
                }
            });

            var body = document.getElementById('dashboard-body');
            if (body) {
                body.innerHTML = buildDashboard(sales, receivables, payables, services);
                body.addEventListener('click', function (e) {
                    var btn = e.target.closest('#rankings-scope-toggle .toggle-option');
                    if (btn && btn.dataset.scope && btn.dataset.scope !== rankingsScope) {
                        rankingsScope = btn.dataset.scope;
                        body.innerHTML = buildDashboard(sales, receivables, payables, services);
                    }
                    // Ver más toggle
                    var verMasBtn = e.target.closest('.dash-ver-mas');
                    if (verMasBtn) {
                        var targetId = verMasBtn.dataset.target;
                        var targetEl = document.getElementById(targetId);
                        if (targetEl) {
                            var isHidden = targetEl.style.display === 'none';
                            targetEl.style.display = isHidden ? '' : 'none';
                            verMasBtn.textContent = isHidden ? 'Ver menos' : verMasBtn.textContent;
                        }
                    }
                    // Ejecutivo drill-down
                    var execRow = e.target.closest('.dash-exec-row');
                    if (execRow) {
                        var execName = execRow.dataset.exec;
                        var detailEl = document.getElementById('dash-exec-detail');
                        if (!detailEl || !window._dashExecSales) return;
                        var salesList = window._dashExecSales[execName] || [];
                        if (detailEl.dataset.open === execName) {
                            detailEl.innerHTML = '';
                            detailEl.dataset.open = '';
                            return;
                        }
                        detailEl.dataset.open = execName;
                        // Group by month
                        var byMonth = {};
                        salesList.forEach(function (sl) {
                            var mk = sl.date ? sl.date.substring(0, 7) : 'sin-fecha';
                            if (!byMonth[mk]) byMonth[mk] = [];
                            byMonth[mk].push(sl);
                        });
                        var mKeys = Object.keys(byMonth).sort().reverse();
                        var html = '<div style="padding:12px;border-top:1px solid var(--border-color);">';
                        html += '<h4 style="color:var(--accent-primary);margin:0 0 12px;font-size:16px;border-bottom:2px solid var(--accent-primary);padding-bottom:8px;">Detalle: ' + escapeHtml(execName) + '</h4>';
                        mKeys.forEach(function (mk) {
                            var items = byMonth[mk];
                            var mTotal = items.reduce(function (a, b) { return a + b.amount; }, 0);
                            var mLabel = mk === 'sin-fecha' ? 'Sin fecha' : getMonthLabel(mk + '-01');
                            html += '<div style="margin-bottom:8px;">';
                            html += '<div style="font-size:14px;font-weight:700;color:var(--text-primary);margin-bottom:6px;padding:6px 10px;background:var(--bg-tertiary);border-radius:6px;display:flex;justify-content:space-between;">' +
                                '<span>' + mLabel + ' (' + items.length + ' ventas)</span>' +
                                '<span style="color:var(--accent-primary);">' + formatCLP(mTotal) + '</span></div>';
                            items.forEach(function (sl) {
                                var paidBadge = sl.paid ? '<span class="badge badge-success" style="font-size:9px;margin-left:6px;">Pagada</span>' : '';
                                html += '<div style="padding:3px 0;font-size:12px;display:flex;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,0.03);">';
                                html += '<span>' + escapeHtml(sl.client) + ' — ' + escapeHtml(sl.event) + paidBadge + '</span>';
                                html += '<span style="font-variant-numeric:tabular-nums;font-weight:600;">' + formatCLP(sl.amount) + '</span>';
                                html += '</div>';
                            });
                            html += '</div>';
                        });
                        html += '</div>';
                        detailEl.innerHTML = html;
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
