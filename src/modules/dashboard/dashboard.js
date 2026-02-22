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

    function getLast6Months() {
        var result = [];
        var now = new Date();
        for (var i = 5; i >= 0; i--) {
            var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            result.push({
                key: getMonthKey(d),
                label: getMonthLabel(d)
            });
        }
        return result;
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

    // --------------- build dashboard with data ---------------

    var rankingsScope = 'year'; // 'year' | 'all'

    function buildDashboard(sales, receivables, payables, services) {

        // ---- KPI calculations ----

        // Ventas Totales
        var totalVentas = 0;
        var countVentas = sales.length;
        sales.forEach(function (s) {
            totalVentas += Number(s.amount || s.monto_venta || 0);
        });

        // CXC - Por Cobrar
        // Usa monto IVA-inclusive menos pagos registrados (igual que módulo CXC)
        var totalCXC = 0;
        var countCXC = 0;
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

        // CXP - Por Pagar (payments-aware: descuenta pagos ya registrados)
        var totalCXP = 0;
        var countCXP = 0;
        payables.forEach(function (p) {
            var st = (p.status || p.paymentStatus || '').toLowerCase();
            if (st === 'pagada') return;
            var amount = Number(p.amount || p.costAmount || p.monto || p.valor_pago) || 0;
            var paid = 0;
            if (p.payments && Array.isArray(p.payments)) {
                paid = p.payments.reduce(function (s, pay) { return s + (Number(pay.amount) || 0); }, 0);
            } else {
                paid = Number(p.amountPaid) || 0;
            }
            var pending = Math.max(0, amount - paid);
            countCXP++;
            totalCXP += pending;
        });

        // Eventos con Problemas
        var issueCount = 0;
        var refundTotal = 0;
        sales.forEach(function (s) {
            var refund = Number(s.refundAmount || s.monto_devolucion || 0);
            if (s.hasIssue || s.has_issue || refund > 0) {
                issueCount++;
                refundTotal += refund;
            }
        });

        // Margen Histórico: Ventas - Costos CXP agrupados por id de evento.
        // Se suma el monto de cada CXP con categoría 'evento', agrupado por su eventId.
        // Fallback a sale.costAmount si no hay CXP asociado al evento.
        var cxpCostById = {};
        payables.forEach(function (p) {
            var eid = String(p.eventId || '').trim();
            if (!eid) return; // ignorar gastos generales (id=0 o sin id)
            cxpCostById[eid] = (cxpCostById[eid] || 0) + (Number(p.amount) || 0);
        });

        var totalCostos = 0;
        sales.forEach(function (s) {
            var sid = String(s.sourceId || s.id || '').trim();
            var cost = (sid && cxpCostById[sid]) ? cxpCostById[sid] : Number(s.costAmount || 0);
            totalCostos += cost;
        });
        var margen = totalVentas - totalCostos;

        // ---- KPI row HTML ----
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

        // ---- Chart: Eventos por Mes (last 6 months) ----

        var months = getLast6Months();
        var monthCounts = {};
        months.forEach(function (m) { monthCounts[m.key] = 0; });

        sales.forEach(function (s) {
            var ed = s.eventDate || s.event_date || s.fecha_evento;
            if (!ed) return;
            var key = getMonthKey(ed);
            if (monthCounts.hasOwnProperty(key)) {
                monthCounts[key]++;
            }
        });

        var maxCount = 1;
        months.forEach(function (m) {
            if (monthCounts[m.key] > maxCount) maxCount = monthCounts[m.key];
        });

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

        var chartHTML = '' +
            '<div class="card">' +
                '<div class="card-header">' +
                    '<span class="card-title">Eventos por Mes</span>' +
                '</div>' +
                '<div style="display:flex;gap:var(--space-md);align-items:flex-end;padding:var(--space-md) 0;">' +
                    barsHTML +
                '</div>' +
            '</div>';

        // ---- Rankings row ----

        // Filter sales by scope
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
            '<button class="toggle-option' + (rankingsScope === 'year' ? ' active' : '') + '" data-scope="year">Último año</button>' +
            '<button class="toggle-option' + (rankingsScope === 'all' ? ' active' : '') + '" data-scope="all">Histórico</button>' +
            '</div>';

        // Top 5 Clientes by amount
        var clientTotals = {};
        salesForRankings.forEach(function (s) {
            var name = s.clientName || s.client_name || s.nombre_cliente || 'Sin cliente';
            var amt = Number(s.amount || s.monto_venta || 0);
            clientTotals[name] = (clientTotals[name] || 0) + amt;
        });
        var topClients = Object.keys(clientTotals).map(function (name) {
            return { name: name, total: clientTotals[name] };
        }).sort(function (a, b) { return b.total - a.total; }).slice(0, 5);

        var clientRows = '';
        if (topClients.length === 0) {
            clientRows = '<tr><td colspan="2" class="text-center text-muted" style="padding:16px;">Sin datos</td></tr>';
        } else {
            topClients.forEach(function (c, i) {
                clientRows += '' +
                    '<tr>' +
                        '<td>' + (i + 1) + '. ' + c.name + '</td>' +
                        '<td class="text-right">' + formatCLP(c.total) + '</td>' +
                    '</tr>';
            });
        }

        var clientsCardHTML = '' +
            '<div class="card">' +
                '<div class="card-header">' +
                    '<span class="card-title">Top 5 Clientes</span>' +
                    '<span class="badge badge-info">Por monto</span>' +
                '</div>' +
                '<table class="data-table">' +
                    '<thead><tr><th>Cliente</th><th class="text-right">Monto Total</th></tr></thead>' +
                    '<tbody>' + clientRows + '</tbody>' +
                '</table>' +
            '</div>';

        // Top 5 Servicios by usage count
        // Soporta serviceIds (array, ventas creadas en plataforma)
        // y serviceNames (string CSV, ventas importadas) separados por ,;/+
        var serviceCounts = {};
        salesForRankings.forEach(function (s) {
            var ids = s.serviceIds || s.service_ids || [];
            if (Array.isArray(ids) && ids.length > 0) {
                ids.forEach(function (sid) {
                    serviceCounts[sid] = (serviceCounts[sid] || 0) + 1;
                });
            } else {
                // Fallback: parsear serviceNames string del CSV
                var namesStr = s.serviceNames || s.servicenames || s.servicios || '';
                if (typeof namesStr === 'string' && namesStr.trim()) {
                    namesStr.split(/[,;\/+]/).forEach(function (n) {
                        var name = n.trim();
                        if (name) serviceCounts[name] = (serviceCounts[name] || 0) + 1;
                    });
                }
            }
        });

        // Build a lookup map for service names
        var serviceMap = {};
        if (services && services.length) {
            services.forEach(function (svc) {
                serviceMap[svc.id] = svc.name || svc.nombre || svc.serviceName || svc.id;
            });
        }

        var topServices = Object.keys(serviceCounts).map(function (sid) {
            return { id: sid, name: serviceMap[sid] || sid, count: serviceCounts[sid] };
        }).sort(function (a, b) { return b.count - a.count; }).slice(0, 5);

        var serviceRows = '';
        if (topServices.length === 0) {
            serviceRows = '<tr><td colspan="2" class="text-center text-muted" style="padding:16px;">Sin datos</td></tr>';
        } else {
            topServices.forEach(function (sv, i) {
                serviceRows += '' +
                    '<tr>' +
                        '<td>' + (i + 1) + '. ' + sv.name + '</td>' +
                        '<td class="text-right"><span class="badge badge-success">' + sv.count + ' eventos</span></td>' +
                    '</tr>';
            });
        }

        var servicesCardHTML = '' +
            '<div class="card">' +
                '<div class="card-header">' +
                    '<span class="card-title">Top 5 Servicios</span>' +
                    '<span class="badge badge-info">Por uso</span>' +
                '</div>' +
                '<table class="data-table">' +
                    '<thead><tr><th>Servicio</th><th class="text-right">Cantidad</th></tr></thead>' +
                    '<tbody>' + serviceRows + '</tbody>' +
                '</table>' +
            '</div>';

        var rankingsHTML = '' +
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-md);">' +
                '<span style="font-size:13px;color:var(--text-secondary);">Período: <strong>' + scopeLabel + '</strong></span>' +
                toggleHTML +
            '</div>' +
            '<div class="kpi-grid-2">' +
                clientsCardHTML +
                servicesCardHTML +
            '</div>';

        // ---- IVA estimado del mes actual ----

        var ivaHTML = buildIVACard(receivables, payables);

        return kpiHTML + chartHTML + ivaHTML + rankingsHTML;
    }

    // Normaliza billingMonth (DD/MM/YYYY o YYYY-MM-DD o MM/YYYY) a 'YYYY-MM'
    function toMonthKey(dateStr) {
        if (!dateStr) return null;
        var s = String(dateStr).trim();
        // YYYY-MM-DD
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.substring(0, 7);
        // DD/MM/YYYY
        var dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (dmy) return dmy[3] + '-' + dmy[2].padStart(2, '0');
        // YYYY-MM
        if (/^\d{4}-\d{2}$/.test(s)) return s;
        // MM/YYYY
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

        // IVA Débito: facturas emitidas (CXC facturadas, excluir NC y E)
        receivables.forEach(function (r) {
            var tipo = (r.tipoDoc || '').toUpperCase();
            if (tipo === 'NC' || tipo === 'E') return;
            var mk = toMonthKey(r.billingMonth);
            if (!mk || !data[mk]) return;
            data[mk].ivaDebito += (Number(r.invoicedAmount || r.montoNeto) || 0) * 0.19;
        });

        // IVA Crédito y Retención BH: de CXP
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
            var deb  = Math.round(d.ivaDebito);
            var cred = Math.round(d.ivaCredito);
            var ret  = Math.round(d.retencionBH);
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

            // Also fetch services for name resolution in Top 5 Servicios
            var services = [];
            try {
                services = await window.Mazelab.DataService.getAll('services') || [];
            } catch (e) {
                console.warn('Dashboard: could not load services for name mapping:', e);
            }

            var body = document.getElementById('dashboard-body');
            if (body) {
                body.innerHTML = buildDashboard(sales, receivables, payables, services);
                // Rankings scope toggle — use event delegation on body to survive re-renders
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
                body.innerHTML = '' +
                    '<div class="empty-state">' +
                        '<p class="text-danger">Error al cargar datos del dashboard.</p>' +
                        '<p class="text-muted">' + (err.message || err) + '</p>' +
                    '</div>';
            }
        }
    }

    return { render: render, init: init };

})();
