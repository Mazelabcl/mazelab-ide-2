window.Mazelab.Modules.FinanceModule = (function () {

    // =========================================================================
    // STATE
    // =========================================================================
    let allReceivables = [];
    let cachedSales = [];
    let filteredList = [];
    let showOnlyPending = true;
    let visibleCount = 25;
    let searchQuery = '';
    let sortCol = null;
    let sortDir = 'asc';
    let currentView = 'lista'; // 'lista' | 'agrupada'
    let columnFilters = {}; // { colKey: 'filterText' }

    // =========================================================================
    // HELPER FUNCTIONS
    // =========================================================================

    function getMonto(r) {
        // Precedencia: montoNeto (CSV import explícito) → monto_venta (total evento auto-CXC) → invoicedAmount → amount (legacy)
        // monto_venta va antes de invoicedAmount para que al facturar parcialmente no se pierda el valor total del evento
        return Number(r.montoNeto || r.monto_venta || r.invoicedAmount || r.amount) || 0;
    }

    function getMontoFacturado(r) {
        // Solo leer monto facturado real — NO caer en getMonto/montoNeto.
        // Si no hay factura, devuelve 0 → getRealTimeStatus lo detecta como pendiente_factura.
        if (r.montoFacturado !== undefined && r.montoFacturado !== null && r.montoFacturado !== '') {
            return Number(r.montoFacturado) || 0;
        }
        if (r.invoicedAmount !== undefined && r.invoicedAmount !== null && r.invoicedAmount !== '') {
            return Number(r.invoicedAmount) || 0;
        }
        return 0;
    }

    function getTotalPagado(r) {
        if (!r.payments || !Array.isArray(r.payments)) return 0;
        return r.payments.reduce(function (sum, p) { return sum + (Number(p.amount) || 0); }, 0);
    }

    function getPendienteItem(r) {
        var pagado = getTotalPagado(r);
        if (r.tipoDoc === 'E') return getMonto(r) - pagado;
        return (getMontoFacturado(r) * 1.19) - pagado;
    }

    function getPendienteFacturado(r) {
        var pagado = getTotalPagado(r);
        if (r.tipoDoc === 'E') return getMontoFacturado(r) - pagado;
        return (getMontoFacturado(r) * 1.19) - pagado;
    }

    function isIvaPaid(mesEmision) {
        if (!mesEmision) return false;
        var year, month;
        if (mesEmision.includes('-')) {
            var parts1 = mesEmision.split('-').map(Number);
            year = parts1[0];
            month = parts1[1];
        } else if (mesEmision.includes('/')) {
            var parts = mesEmision.split('/');
            if (parts[2]) {
                // DD/MM/YYYY
                month = Number(parts[1]);
                year = Number(parts[2]);
            } else {
                // MM/YYYY
                month = Number(parts[0]);
                year = Number(parts[1]);
            }
        } else {
            return false;
        }
        // IVA paid on 20th of next month
        var ivaMonth = month + 1;
        var ivaYear = year;
        if (ivaMonth > 12) { ivaMonth = 1; ivaYear++; }
        var ivaDate = new Date(ivaYear, ivaMonth - 1, 20);
        return new Date() > ivaDate;
    }

    function getPendienteMio(r) {
        var pagado = getTotalPagado(r);
        var neto = getMonto(r);
        if (r.tipoDoc === 'E') return Math.max(0, neto - pagado);
        if (r.tipoDoc === 'NC') return 0;
        var facturado = getMontoFacturado(r);
        if (!r.invoiceNumber && facturado <= 0) return Math.max(0, neto - pagado);
        if (isIvaPaid(r.billingMonth)) return Math.max(0, (facturado * 1.19) - pagado);
        // IVA aún no declarado: el pago recibido incluye IVA, extraer solo la parte neta
        return Math.max(0, neto - Math.round(pagado / 1.19));
    }

    // Returns the current eventDate from the linked sale (if loaded), falling back to stored copy.
    // Keeps CXC dates in sync when a sale's eventDate is edited.
    function getEffectiveEventDate(r) {
        if (r.saleId && cachedSales.length) {
            var sale = cachedSales.find(function (s) {
                return String(s.id) === String(r.saleId) || String(s.sourceId) === String(r.saleId);
            });
            if (sale && sale.eventDate) return sale.eventDate;
        }
        return r.eventDate || '';
    }

    // =========================================================================
    // STATUS CALCULATION
    // =========================================================================

    // Parsea billingMonth a una Date para calcular vencimiento.
    // - DD/MM/YYYY (fecha completa): usa el día real → datos nuevos
    // - MM/YYYY o YYYY-MM (solo mes): usa día 1 → datos históricos
    // Fallback: eventDate.
    function getVencimientoBaseDate(r) {
        var bm = r.billingMonth;
        if (bm) {
            var str = String(bm).trim();
            // Fecha completa DD/MM/YYYY → preserva el día real
            var dmy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
            if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
            // Solo mes YYYY-MM → día 1
            if (/^\d{4}-\d{2}$/.test(str)) {
                var p = str.split('-');
                return new Date(Number(p[0]), Number(p[1]) - 1, 1);
            }
            // Solo mes MM/YYYY → día 1
            var my = str.match(/^(\d{1,2})\/(\d{4})$/);
            if (my) return new Date(Number(my[2]), Number(my[1]) - 1, 1);
        }
        // Fallback: fecha del evento (uses linked sale date if available)
        var effDate = getEffectiveEventDate(r);
        if (effDate) return parseLocalDate(effDate);
        return null;
    }

    function getRealTimeStatus(r) {
        // 1. NC
        if (r.tipoDoc === 'NC') return 'nc';
        // 2. Anulada
        if (r.status === 'anulada') return 'anulada';
        // 3. Pagada
        if (r.status === 'pagado' || r.status === 'pagada') return 'pagada';
        // 4. Pendiente factura by status — differentiate pre/post evento
        if (r.status === 'pendiente_factura' || r.status === 'sin_factura' || getMontoFacturado(r) <= 0) {
            var evDate = getEffectiveEventDate(r);
            if (evDate && new Date(evDate) < new Date()) {
                return 'post_evento_sin_factura';
            }
            return 'pendiente_factura';
        }
        // 6. Pending / overdue states — recalculate dynamically from billingMonth
        if (r.status === 'pendiente' || r.status === 'pendiente_pago' ||
            r.status === 'vencida_30' || r.status === 'vencida_60' || r.status === 'vencida_90' ||
            r.status === 'por_vencer' || !r.status || r.status === '') {
            var pagado = getTotalPagado(r);
            var montoTotal = r.tipoDoc === 'E' ? getMonto(r) : (getMontoFacturado(r) * 1.19);
            if (pagado >= montoTotal) return 'pagada';
            var baseDate = getVencimientoBaseDate(r);
            if (baseDate) {
                var diffDays = Math.floor((new Date() - baseDate) / (1000 * 60 * 60 * 24));
                var paymentTerms = Number(r.paymentTerms) || 30;
                var daysOverdue = diffDays - paymentTerms;
                r._daysOverdue = Math.max(0, daysOverdue); // store for badge display
                if (daysOverdue > 90) return 'vencida_90';
                if (daysOverdue > 60) return 'vencida_60';
                if (daysOverdue > 30) return 'vencida_30';
            }
            return 'pendiente_pago';
        }
        // 7. Default
        return r.status;
    }

    // =========================================================================
    // FORMAT HELPERS
    // =========================================================================

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function formatCLP(amount) {
        var n = Math.round(Number(amount) || 0);
        var negative = n < 0;
        if (negative) n = -n;
        var str = n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return (negative ? '-$' : '$') + str;
    }

    // Parse date string as LOCAL (not UTC)
    function parseLocalDate(str) {
        if (!str) return null;
        var parts = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (parts) return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
        return new Date(str);
    }

    function formatDate(dateStr) {
        if (!dateStr) return '-';
        try {
            var d = parseLocalDate(dateStr);
            if (!d || isNaN(d.getTime())) return dateStr;
            var dd = String(d.getDate()).padStart(2, '0');
            var mm = String(d.getMonth() + 1).padStart(2, '0');
            var yyyy = d.getFullYear();
            return dd + '/' + mm + '/' + yyyy;
        } catch (e) {
            return dateStr;
        }
    }

    function getCompanyInfo() {
        try { return JSON.parse(localStorage.getItem('mazelab_company_info') || '{}'); } catch (e) { return {}; }
    }

    function getOverdueDays(r) {
        var base = getVencimientoBaseDate(r);
        if (!base) return 0;
        var paymentTerms = Number(r.paymentTerms) || 30;
        return Math.max(0, Math.floor((new Date() - base) / 86400000) - paymentTerms);
    }

    function getCurrentMonthKey() {
        var now = new Date();
        var yyyy = now.getFullYear();
        var mm = String(now.getMonth() + 1).padStart(2, '0');
        return yyyy + '-' + mm;
    }

    function matchesBillingMonth(billingMonth, targetKey) {
        if (!billingMonth) return false;
        // targetKey = "YYYY-MM"
        var targetYear = Number(targetKey.split('-')[0]);
        var targetMonth = Number(targetKey.split('-')[1]);
        if (billingMonth.includes('-')) {
            var parts = billingMonth.split('-').map(Number);
            return parts[0] === targetYear && parts[1] === targetMonth;
        } else if (billingMonth.includes('/')) {
            var p = billingMonth.split('/');
            if (p[2]) {
                // DD/MM/YYYY
                return Number(p[2]) === targetYear && Number(p[1]) === targetMonth;
            } else {
                // MM/YYYY
                return Number(p[1]) === targetYear && Number(p[0]) === targetMonth;
            }
        }
        return false;
    }

    function sortTh(label, col) {
        var active = sortCol === col;
        var arrow = active ? (sortDir === 'asc' ? ' \u25b2' : ' \u25bc') : ' \u2195';
        return '<th class="finance-sort-th" data-sort="' + col + '" style="cursor:pointer;white-space:nowrap">' +
               label + '<span style="opacity:' + (active ? 1 : 0.25) + ';font-size:10px">' + arrow + '</span></th>';
    }

    function getStatusBadge(status, rec) {
        var days = (rec && rec._daysOverdue) ? rec._daysOverdue : 0;
        var daysLabel = days > 0 ? ' (' + days + 'd)' : '';
        var map = {
            'pagada': '<span class="badge badge-success">Pagada</span>',
            'pendiente': '<span class="badge badge-warning">Pendiente</span>',
            'pendiente_pago': '<span class="badge badge-warning">Pendiente</span>',
            'pendiente_factura': '<span class="badge badge-info">Pre-evento</span>',
            'post_evento_sin_factura': '<span class="badge badge-warning">Facturar</span>',
            'vencida_30': '<span class="badge badge-warning">Vencida' + daysLabel + '</span>',
            'vencida_60': '<span class="badge badge-danger">Vencida' + daysLabel + '</span>',
            'vencida_90': '<span class="badge badge-danger">Vencida' + daysLabel + '</span>',
            'anulada': '<span class="badge badge-secondary">Anulada</span>',
            'nc': '<span class="badge badge-secondary">N. Cr\u00e9dito</span>',
            'por_vencer': '<span class="badge badge-warning">Por Vencer</span>'
        };
        return map[status] || '<span class="badge">' + (status || 'Desconocido') + '</span>';
    }

    // =========================================================================
    // DATA CLASSIFICATION
    // =========================================================================

    function classifyData(receivables) {
        var facturas = [];
        var notasCredito = [];
        var sinFactura = [];
        var preEvento = [];
        var postEventoSinFactura = [];
        var facturadoPendientes = [];
        var facturadoEnPlazo = [];
        var facturadoVencido30 = [];
        var facturadoVencido60 = [];
        var facturadoVencido90 = [];

        receivables.forEach(function (r) {
            var realStatus = getRealTimeStatus(r);
            r._realStatus = realStatus;

            // facturas: tipoDoc = F, E, H, or empty. Exclude NC.
            if (r.tipoDoc !== 'NC') {
                facturas.push(r);
            }

            // notasCredito
            if (r.tipoDoc === 'NC') {
                notasCredito.push(r);
            }

            // sinFactura — separate pre-event from post-event
            if (realStatus === 'pendiente_factura' && r.tipoDoc !== 'NC') {
                sinFactura.push(r);
                preEvento.push(r);
            }
            if (realStatus === 'post_evento_sin_factura' && r.tipoDoc !== 'NC') {
                sinFactura.push(r);
                postEventoSinFactura.push(r);
            }

            // facturadoPendientes
            if (
                realStatus !== 'pendiente_factura' &&
                realStatus !== 'post_evento_sin_factura' &&
                realStatus !== 'anulada' &&
                realStatus !== 'pagada' &&
                realStatus !== 'nc' &&
                r.tipoDoc !== 'NC' &&
                (!r.ncAsociada || r.ncAsociada === '') &&
                getMontoFacturado(r) > 0
            ) {
                var pagado = getTotalPagado(r);
                var montoTotal = r.tipoDoc === 'E' ? getMonto(r) : (getMontoFacturado(r) * 1.19);
                if (pagado < montoTotal) {
                    facturadoPendientes.push(r);

                    // Sub-clasificar por días desde emisión de factura (billingMonth)
                    var diffDays = 0;
                    var baseDate = getVencimientoBaseDate(r);
                    if (baseDate) {
                        diffDays = Math.floor((new Date() - baseDate) / (1000 * 60 * 60 * 24));
                    }

                    if (diffDays <= 30) {
                        facturadoEnPlazo.push(r);
                    } else if (diffDays <= 60) {
                        facturadoVencido30.push(r);
                    } else if (diffDays <= 90) {
                        facturadoVencido60.push(r);
                    } else {
                        facturadoVencido90.push(r);
                    }
                }
            }
        });

        return {
            facturas: facturas,
            notasCredito: notasCredito,
            sinFactura: sinFactura,
            facturadoPendientes: facturadoPendientes,
            facturadoEnPlazo: facturadoEnPlazo,
            facturadoVencido30: facturadoVencido30,
            facturadoVencido60: facturadoVencido60,
            facturadoVencido90: facturadoVencido90,
            preEvento: preEvento,
            postEventoSinFactura: postEventoSinFactura
        };
    }

    // =========================================================================
    // KPI CALCULATIONS
    // =========================================================================

    function computeKPIs(receivables) {
        var data = classifyData(receivables);
        var currentMonthKey = getCurrentMonthKey();

        // Row 1 — Monthly metrics
        var facturadoMes = 0;
        var ncMes = 0;
        var pagadoMes = 0;
        var porVencerMes = 0;

        receivables.forEach(function (r) {
            if (matchesBillingMonth(r.billingMonth, currentMonthKey)) {
                if (r.tipoDoc === 'NC') {
                    ncMes += getMontoFacturado(r);
                } else {
                    facturadoMes += getMontoFacturado(r);
                }
            }
        });

        var facturadoNetoMes = facturadoMes - ncMes;
        var ivaMes = facturadoNetoMes * 0.19;

        // Pagado este mes: estimate from billing month + ~30 days
        receivables.forEach(function (r) {
            if (r.tipoDoc === 'NC') return;
            if (r.payments && Array.isArray(r.payments)) {
                r.payments.forEach(function (p) {
                    if (p.date) {
                        var pDate = new Date(p.date);
                        var now = new Date();
                        if (pDate.getMonth() === now.getMonth() && pDate.getFullYear() === now.getFullYear()) {
                            pagadoMes += Number(p.amount) || 0;
                        }
                    }
                });
            }
        });

        // Por vencer este mes: facturas emitidas este mes (billingMonth) aún pendientes
        data.facturadoPendientes.forEach(function (r) {
            if (matchesBillingMonth(r.billingMonth, currentMonthKey)) {
                porVencerMes += getPendienteFacturado(r);
            }
        });

        // Row 2 — Status categories
        var totalSinFacturaNeto = 0;
        data.sinFactura.forEach(function (r) { totalSinFacturaNeto += getMonto(r); });

        var totalEnPlazo = 0;
        data.facturadoEnPlazo.forEach(function (r) { totalEnPlazo += getPendienteFacturado(r); });

        var totalVencido30 = 0;
        data.facturadoVencido30.forEach(function (r) { totalVencido30 += getPendienteFacturado(r); });

        var totalVencido60 = 0;
        data.facturadoVencido60.forEach(function (r) { totalVencido60 += getPendienteFacturado(r); });

        var totalVencido90 = 0;
        data.facturadoVencido90.forEach(function (r) { totalVencido90 += getPendienteFacturado(r); });

        // Row 3 — Totals
        var totalFacturadoPend = 0;
        data.facturadoPendientes.forEach(function (r) { totalFacturadoPend += getPendienteFacturado(r); });

        // Por cobrar: ALL sin factura (pre + post) + facturado pendiente
        var totalPorCobrar = (totalSinFacturaNeto * 1.19) + totalFacturadoPend;

        // Lo que es mío: ALL sin factura + facturado pendiente
        var totalSinFacturaMio = 0;
        data.sinFactura.forEach(function (r) { totalSinFacturaMio += getPendienteMio(r); });

        var totalFacturadoMio = 0;
        data.facturadoPendientes.forEach(function (r) { totalFacturadoMio += getPendienteMio(r); });

        var totalLoQueEsMio = totalSinFacturaMio + totalFacturadoMio;

        return {
            data: data,
            facturadoMes: facturadoMes,
            ncMes: ncMes,
            facturadoNetoMes: facturadoNetoMes,
            ivaMes: ivaMes,
            pagadoMes: pagadoMes,
            porVencerMes: porVencerMes,
            totalSinFacturaNeto: totalSinFacturaNeto,
            totalEnPlazo: totalEnPlazo,
            totalVencido30: totalVencido30,
            totalVencido60: totalVencido60,
            totalVencido90: totalVencido90,
            totalPorCobrar: totalPorCobrar,
            totalLoQueEsMio: totalLoQueEsMio
        };
    }

    // =========================================================================
    // RENDER KPI HTML
    // =========================================================================

    function renderKPIs(kpis) {
        var html = '';

        // Row 1 — 4 cards (monthly)
        html += '<div class="kpi-grid">';
        html += '<div class="kpi-card">';
        html += '  <div class="kpi-label">Facturado Este Mes</div>';
        html += '  <div class="kpi-value">' + formatCLP(kpis.facturadoNetoMes) + '</div>';
        if (kpis.ncMes > 0) html += '  <div class="kpi-sub" style="color:var(--danger)">NC: -' + formatCLP(kpis.ncMes) + ' (Bruto: ' + formatCLP(kpis.facturadoMes) + ')</div>';
        else html += '  <div class="kpi-sub">Neto facturado del mes</div>';
        html += '</div>';
        html += '<div class="kpi-card">';
        html += '  <div class="kpi-label">IVA del Mes</div>';
        html += '  <div class="kpi-value">' + formatCLP(kpis.ivaMes) + '</div>';
        html += '  <div class="kpi-sub">19% del facturado neto</div>';
        html += '</div>';
        html += '<div class="kpi-card">';
        html += '  <div class="kpi-label">Pagado Este Mes</div>';
        html += '  <div class="kpi-value">' + formatCLP(kpis.pagadoMes) + '</div>';
        html += '  <div class="kpi-sub">Cobros recibidos</div>';
        html += '</div>';
        html += '<div class="kpi-card">';
        html += '  <div class="kpi-label">Por Vencer Este Mes</div>';
        html += '  <div class="kpi-value">' + formatCLP(kpis.porVencerMes) + '</div>';
        html += '  <div class="kpi-sub">Vencimientos del mes</div>';
        html += '</div>';
        html += '</div>';

        // Row 2 — 5 cards (status)
        html += '<div class="kpi-grid-5">';
        var postCount = kpis.data.postEventoSinFactura.length;
        var preCount = kpis.data.preEvento.length;
        var postMonto = 0, preMonto = 0;
        kpis.data.postEventoSinFactura.forEach(function (r) { postMonto += getMonto(r); });
        kpis.data.preEvento.forEach(function (r) { preMonto += getMonto(r); });
        html += '<div class="kpi-card ' + (postCount > 0 ? 'danger' : 'warning') + '" id="kpi-sin-factura" style="cursor:pointer;" title="Click para ver detalle">';
        html += '  <div class="kpi-label">Sin Factura</div>';
        html += '  <div class="kpi-value">' + kpis.data.sinFactura.length + '</div>';
        html += '  <div class="kpi-sub">';
        if (postCount > 0) html += '<span style="color:var(--danger);font-weight:600;">' + postCount + ' por facturar (' + formatCLP(postMonto) + ')</span><br>';
        html += preCount + ' pre-evento (' + formatCLP(preMonto) + ')';
        html += '</div>';
        html += '</div>';
        html += '<div class="kpi-card info">';
        html += '  <div class="kpi-label">En Plazo</div>';
        html += '  <div class="kpi-value">' + kpis.data.facturadoEnPlazo.length + '</div>';
        html += '  <div class="kpi-sub">' + formatCLP(kpis.totalEnPlazo) + '</div>';
        html += '</div>';
        html += '<div class="kpi-card warning">';
        html += '  <div class="kpi-label">30+ D\u00edas</div>';
        html += '  <div class="kpi-value">' + kpis.data.facturadoVencido30.length + '</div>';
        html += '  <div class="kpi-sub">' + formatCLP(kpis.totalVencido30) + '</div>';
        html += '</div>';
        html += '<div class="kpi-card danger">';
        html += '  <div class="kpi-label">60+ D\u00edas</div>';
        html += '  <div class="kpi-value">' + kpis.data.facturadoVencido60.length + '</div>';
        html += '  <div class="kpi-sub">' + formatCLP(kpis.totalVencido60) + '</div>';
        html += '</div>';
        html += '<div class="kpi-card danger">';
        html += '  <div class="kpi-label">90+ D\u00edas</div>';
        html += '  <div class="kpi-value">' + kpis.data.facturadoVencido90.length + '</div>';
        html += '  <div class="kpi-sub">' + formatCLP(kpis.totalVencido90) + '</div>';
        html += '</div>';
        html += '</div>';

        // Row 3 — 2 big cards (totals)
        html += '<div class="kpi-grid-2">';
        html += '<div class="kpi-card accent">';
        html += '  <div class="kpi-label">TOTAL POR COBRAR</div>';
        html += '  <div class="kpi-value">' + formatCLP(kpis.totalPorCobrar) + '</div>';
        html += '  <div class="kpi-sub">Sin factura + facturado pendiente</div>';
        html += '</div>';
        html += '<div class="kpi-card success">';
        html += '  <div class="kpi-label">LO QUE ES MIO</div>';
        html += '  <div class="kpi-value">' + formatCLP(kpis.totalLoQueEsMio) + '</div>';
        html += '  <div class="kpi-sub">Neto a recibir efectivo</div>';
        html += '</div>';
        html += '</div>';

        return html;
    }

    // =========================================================================
    // RENDER TABLE
    // =========================================================================

    var FIN_FILTER_STYLE = 'width:100%;font-size:11px;padding:2px 4px;border:1px solid var(--border);border-radius:3px;background:var(--bg-secondary);color:var(--text-primary);box-sizing:border-box';
    function finFilterInput(col, placeholder) {
        var fv = columnFilters[col] || '';
        return '<input class="fin-col-filter" data-col="' + col + '" type="text" value="' + fv + '" placeholder="' + placeholder + '" style="' + FIN_FILTER_STYLE + '">';
    }

    function renderTable(receivables) {
        var list = filterReceivables(receivables);
        filteredList = list;

        var html = '<div class="card">';
        html += '<div class="toolbar">';
        html += '  <input type="text" class="search-bar" id="finance-search" placeholder="Buscar cliente, evento, factura..." value="' + (searchQuery || '') + '">';
        html += '  <div class="toggle-group" id="finance-view-toggle">';
        html += '    <button class="toggle-option' + (currentView === 'lista' ? ' active' : '') + '" data-finview="lista">Lista</button>';
        html += '    <button class="toggle-option' + (currentView === 'agrupada' ? ' active' : '') + '" data-finview="agrupada">Por Evento</button>';
        html += '  </div>';
        html += '  <div class="toggle-group" id="finance-pending-toggle">';
        html += '    <button class="toggle-option' + (!showOnlyPending ? ' active' : '') + '" data-pending="false">Mostrar todos</button>';
        html += '    <button class="toggle-option' + (showOnlyPending ? ' active' : '') + '" data-pending="true">Mostrar pendientes</button>';
        html += '  </div>';
        var hasActiveFilters = Object.keys(columnFilters).some(function(k) { return columnFilters[k]; });
        html += '  <button class="btn-secondary btn-sm" id="finance-clear-filters"' + (hasActiveFilters ? '' : ' style="opacity:.45"') + '>\u2715 Limpiar filtros</button>';
        html += '  <button class="btn-primary btn-sm" id="finance-nueva-factura" style="margin-left:auto">+ Nueva Factura</button>';
        html += '</div>';

        if (currentView === 'agrupada') {
            html += renderGroupedCXC(list);
        } else {
            var showing = list.slice(0, visibleCount);
            var hasMore = list.length > visibleCount;
            html += '<table class="data-table">';
            html += '<thead><tr>';
            html += '<th style="font-size:11px;white-space:nowrap">ID</th>';
            html += sortTh('Cliente / Evento', 'clientName');
            html += sortTh('N\u00b0 Factura', 'invoiceNumber');
            html += sortTh('Neto', 'neto');
            html += sortTh('Total+IVA', 'totalIva');
            html += sortTh('Pagado', 'pagado');
            html += sortTh('Restante', 'pending');
            html += sortTh('Vencimiento', 'eventDate');
            html += sortTh('Estado', '_status');
            html += '<th>Acciones</th>';
            html += '</tr>';
            // Filter row
            html += '<tr style="background:var(--bg-tertiary)">';
            html += '<th style="padding:2px 4px">' + finFilterInput('sourceId', 'ID...') + '</th>';
            html += '<th style="padding:2px 4px">' + finFilterInput('clientName', 'Cliente/Evento...') + '</th>';
            html += '<th style="padding:2px 4px">' + finFilterInput('invoiceNumber', 'N° Fact...') + '</th>';
            html += '<th></th><th></th><th></th><th></th>';
            html += '<th style="padding:2px 4px">' + finFilterInput('eventDate', 'YYYY-MM-DD') + '</th>';
            html += '<th style="padding:2px 4px">' + finFilterInput('_status', 'Estado...') + '</th>';
            html += '<th></th></tr>';
            html += '</thead><tbody>';
            if (!showing.length) {
                html += '<tr><td colspan="10" style="text-align:center;padding:2rem;color:var(--text-muted)">No se encontraron registros que coincidan con el filtro.</td></tr>';
            }
            showing.forEach(function (r) {
                var realStatus = r._realStatus || getRealTimeStatus(r);
                var neto = getMonto(r);
                // totalIva siempre se calcula sobre el neto completo (monto_venta) para no perder valor al facturar parcialmente
                var totalIva = r.tipoDoc === 'E' ? neto : Math.round(neto * 1.19);
                var pagado = getTotalPagado(r);
                var restante = Math.max(0, totalIva - pagado);
                // ID numérico: sourceId del registro CXC, o saleId si es numérico
                var displayId = r.sourceId || (/^\d+$/.test(String(r.saleId || '')) ? r.saleId : '') || '-';
                html += '<tr>';
                html += '<td style="font-size:12px;font-weight:600;white-space:nowrap">' + displayId + '</td>';
                html += '<td><strong>' + (r.clientName || 'Sin cliente') + '</strong><br><small>' + (r.eventName || '-') + '</small></td>';
                html += '<td>' + (r.invoiceNumber || '-') + '</td>';
                html += '<td>' + formatCLP(neto) + '</td>';
                html += '<td>' + formatCLP(totalIva) + '</td>';
                html += '<td>' + formatCLP(pagado) + '</td>';
                html += '<td>' + formatCLP(restante) + '</td>';
                html += '<td>' + formatDate(getEffectiveEventDate(r)) + '</td>';
                html += '<td>' + getStatusBadge(realStatus, r) + '</td>';
                html += '<td>';
                if (realStatus === 'pendiente_factura' || realStatus === 'post_evento_sin_factura') {
                    html += '<button class="btn btn-secondary btn-sm btn-facturar" data-id="' + r.id + '" style="margin-right:4px">Facturar</button>';
                    html += '<button class="btn btn-secondary btn-sm btn-solicitar-oc" data-id="' + r.id + '" style="margin-right:4px;font-size:10px;">Solicitar OC</button>';
                }
                // Abono/Pagado Total solo para facturas emitidas
                if (realStatus !== 'pagada' && realStatus !== 'anulada' && realStatus !== 'nc' && realStatus !== 'pendiente_factura' && realStatus !== 'post_evento_sin_factura') {
                    html += '<button class="btn-primary btn-sm btn-icon btn-abono" data-id="' + r.id + '" title="Agregar abono">+Abono</button> ';
                    html += '<button class="btn-secondary btn-sm btn-icon btn-pagado-total" data-id="' + r.id + '" title="Marcar pagado total">Pagado Total</button> ';
                    var cobrosArr = Array.isArray(r.cobros) ? r.cobros : [];
                    var cobrarLabel = cobrosArr.length > 0 ? (cobrosArr.length + 1) + '\u00b0 Cobro' : 'Cobrar';
                    html += '<button class="btn-sm btn-icon btn-cobrar" data-id="' + r.id + '" title="Enviar cobro" style="background:linear-gradient(135deg,#e67e22,#f39c12);color:white;border:none;margin-right:4px">' + cobrarLabel + '</button>';
                }
                // NC available for any invoiced record (including paid)
                if (getMontoFacturado(r) > 0 && realStatus !== 'nc' && realStatus !== 'anulada') {
                    html += '<button class="btn-sm btn-icon btn-nc" data-id="' + r.id + '" title="Registrar Nota de Cr\u00e9dito" style="color:var(--text-secondary);margin-right:4px">NC</button>';
                }
                // Mail facturacion button — only for invoiced records
                if (r.invoiceNumber) {
                    html += '<button class="btn-sm btn-icon btn-mail-factura" data-id="' + r.id + '" title="Mail facturaci\u00f3n" style="color:var(--accent-primary);margin-right:4px">&#9993; Mail</button>';
                }
                html += '<button class="btn-sm btn-icon btn-eliminar" data-id="' + r.id + '" title="Eliminar" style="color:var(--danger,#e74c3c);">Eliminar</button>';
                html += '</td></tr>';
            });
            html += '</tbody></table>';
            if (hasMore) {
                html += '<div style="text-align:center;padding:16px;">';
                html += '<button class="btn-secondary" id="finance-load-more">Ver m\u00e1s (' + (list.length - visibleCount) + ' restantes)</button>';
                html += '</div>';
            }
            html += '<div style="padding:8px 16px;color:var(--text-secondary,#888);font-size:0.85rem;">Mostrando ' + showing.length + ' de ' + list.length + ' registros</div>';
        }

        html += '</div>';
        return html;
    }

    function renderGroupedCXC(list) {
        if (!list.length) return '<div style="text-align:center;padding:2rem;color:var(--text-muted)">No se encontraron registros que coincidan con el filtro.</div>';
        var groups = {};
        list.forEach(function (r) {
            var key = r.eventName || 'Sin evento';
            if (!groups[key]) groups[key] = { clientName: r.clientName || '', items: [] };
            groups[key].items.push(r);
        });
        var html = '';
        Object.keys(groups).sort().forEach(function (key) {
            var grp = groups[key];
            var totalPending = grp.items.reduce(function (s, r) {
                var rs = r._realStatus || getRealTimeStatus(r);
                if (rs === 'pagada' || rs === 'anulada' || rs === 'nc') return s;
                return s + Math.max(0, getPendienteFacturado(r));
            }, 0);
            var rows = grp.items.map(function (r) {
                var realStatus = r._realStatus || getRealTimeStatus(r);
                var neto = getMonto(r);
                var totalIva = r.tipoDoc === 'E' ? neto : Math.round(neto * 1.19);
                var pagado = getTotalPagado(r);
                var restante = Math.max(0, totalIva - pagado);
                var row = '<tr>';
                row += '<td>' + (r.invoiceNumber || '-') + '</td>';
                row += '<td>' + formatCLP(neto) + '</td>';
                row += '<td>' + formatCLP(totalIva) + '</td>';
                row += '<td>' + formatCLP(pagado) + '</td>';
                row += '<td>' + formatCLP(restante) + '</td>';
                row += '<td>' + formatDate(r.eventDate) + '</td>';
                row += '<td>' + getStatusBadge(realStatus, r) + '</td>';
                row += '<td>';
                if (realStatus === 'pendiente_factura' || realStatus === 'post_evento_sin_factura') {
                    row += '<button class="btn btn-secondary btn-sm btn-facturar" data-id="' + r.id + '" style="margin-right:4px">Facturar</button>';
                }
                if (realStatus !== 'pagada' && realStatus !== 'anulada' && realStatus !== 'nc' && realStatus !== 'pendiente_factura' && realStatus !== 'post_evento_sin_factura') {
                    row += '<button class="btn-primary btn-sm btn-icon btn-abono" data-id="' + r.id + '">+Abono</button> ';
                    row += '<button class="btn-secondary btn-sm btn-icon btn-pagado-total" data-id="' + r.id + '">Pagado Total</button> ';
                    var cobrosArr2 = Array.isArray(r.cobros) ? r.cobros : [];
                    var cobrarLabel2 = cobrosArr2.length > 0 ? (cobrosArr2.length + 1) + '\u00b0 Cobro' : 'Cobrar';
                    row += '<button class="btn-sm btn-icon btn-cobrar" data-id="' + r.id + '" style="background:linear-gradient(135deg,#e67e22,#f39c12);color:white;border:none;margin-right:4px">' + cobrarLabel2 + '</button>';
                }
                // Mail facturacion button — only for invoiced records
                if (r.invoiceNumber) {
                    row += '<button class="btn-sm btn-icon btn-mail-factura" data-id="' + r.id + '" title="Mail facturaci\u00f3n" style="color:var(--accent-primary);margin-right:4px">&#9993; Mail</button>';
                }
                row += '<button class="btn-sm btn-icon btn-eliminar" data-id="' + r.id + '" style="color:var(--danger)">Eliminar</button>';
                row += '</td></tr>';
                return row;
            }).join('');
            html += '<div class="card" style="margin-bottom:var(--space-md)">';
            html += '<div class="card-header">';
            html += '<div><span class="card-title">' + key + '</span>';
            if (grp.clientName) html += ' <span style="font-size:13px;color:var(--text-secondary)"> \u00b7 ' + grp.clientName + '</span>';
            html += '</div>';
            if (totalPending > 0) html += '<span class="text-danger" style="font-weight:700">' + formatCLP(totalPending) + ' pendiente</span>';
            html += '</div>';
            html += '<table class="data-table"><thead><tr>';
            html += '<th>N\u00b0 Factura</th><th>Neto</th><th>Total+IVA</th><th>Pagado</th><th>Restante</th><th>Vencimiento</th><th>Estado</th><th>Acciones</th>';
            html += '</tr></thead><tbody>' + rows + '</tbody></table></div>';
        });
        return html;
    }

    // =========================================================================
    // FILTERING
    // =========================================================================

    function filterReceivables(receivables) {
        var list = receivables.slice();

        // Filter pending only
        if (showOnlyPending) {
            list = list.filter(function (r) {
                var st = r._realStatus || getRealTimeStatus(r);
                return st !== 'pagada' && st !== 'anulada' && st !== 'nc';
            });
        }

        // Search filter
        if (searchQuery && searchQuery.trim() !== '') {
            var q = searchQuery.toLowerCase().trim();
            list = list.filter(function (r) {
                var eventId = r.sourceId || (/^\d+$/.test(String(r.saleId || '')) ? r.saleId : '') || '';
                var searchable = [
                    r.clientName || '',
                    r.eventName || '',
                    r.invoiceNumber || '',
                    r.tipoDoc || '',
                    r.billingMonth || '',
                    eventId
                ].join(' ').toLowerCase();
                return searchable.includes(q);
            });
        }

        // Sort: when searching, by ID desc; otherwise by priority then date desc
        list.sort(function (a, b) {
            if (searchQuery && searchQuery.trim()) {
                // Search mode: most recent ID first
                var idA = Number(a.sourceId || a.id || 0);
                var idB = Number(b.sourceId || b.id || 0);
                return idB - idA;
            }
            var priorityMap = {
                'vencida_90': 0,
                'vencida_60': 1,
                'vencida_30': 2,
                'pendiente': 3,
                'pendiente_pago': 3,
                'post_evento_sin_factura': 4,
                'pendiente_factura': 5,
                'por_vencer': 6,
                'pagada': 6,
                'anulada': 7,
                'nc': 8
            };
            var pa = priorityMap[a._realStatus] !== undefined ? priorityMap[a._realStatus] : 5;
            var pb = priorityMap[b._realStatus] !== undefined ? priorityMap[b._realStatus] : 5;
            if (pa !== pb) return pa - pb;
            var da = a.eventDate ? parseLocalDate(a.eventDate).getTime() : 0;
            var db = b.eventDate ? parseLocalDate(b.eventDate).getTime() : 0;
            return db - da;
        });

        // Per-column filters
        var activeCols = Object.keys(columnFilters).filter(function(k) { return columnFilters[k]; });
        if (activeCols.length) {
            list = list.filter(function (r) {
                return activeCols.every(function (col) {
                    var fv = (columnFilters[col] || '').toLowerCase();
                    var val;
                    if (col === '_status') val = r._realStatus || '';
                    else if (col === 'sourceId') val = r.sourceId || (/^\d+$/.test(String(r.saleId || '')) ? r.saleId : '') || '';
                    else val = String(r[col] || '');
                    return val.toLowerCase().includes(fv);
                });
            });
        }

        // Override with user-selected column sort
        if (sortCol) {
            list.sort(function (a, b) {
                var av, bv;
                switch (sortCol) {
                    case '_status':  av = a._realStatus || ''; bv = b._realStatus || ''; break;
                    case 'neto':     av = getMonto(a); bv = getMonto(b); break;
                    case 'totalIva': av = getMontoFacturado(a) * 1.19; bv = getMontoFacturado(b) * 1.19; break;
                    case 'pagado':   av = getTotalPagado(a); bv = getTotalPagado(b); break;
                    case 'pending':  av = getPendienteFacturado(a); bv = getPendienteFacturado(b); break;
                    default:         av = a[sortCol] || ''; bv = b[sortCol] || '';
                }
                var an = Number(av), bn = Number(bv);
                if (!isNaN(an) && !isNaN(bn)) return sortDir === 'asc' ? an - bn : bn - an;
                return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
            });
        }

        return list;
    }

    // =========================================================================
    // MODAL — ABONO
    // =========================================================================

    function renderAbonoModal(receivable) {
        var neto = getMonto(receivable);
        var totalIva = receivable.tipoDoc === 'E' ? neto : (getMontoFacturado(receivable) * 1.19);
        var pagado = getTotalPagado(receivable);
        var restante = totalIva - pagado;
        var today = new Date().toISOString().split('T')[0];
        var payments = Array.isArray(receivable.payments) ? receivable.payments : [];

        var html = '';
        html += '<div class="modal-overlay active" id="abono-modal-overlay">';
        html += '<div class="modal">';
        html += '  <div class="modal-header">';
        html += '    <h3>Pagos — ' + (receivable.clientName || '-') + '</h3>';
        html += '    <button class="modal-close" id="abono-close-x">&times;</button>';
        html += '  </div>';
        html += '  <p style="color:var(--text-secondary);font-size:13px;margin-bottom:8px;">' + (receivable.eventName || '-') + ' &nbsp;|&nbsp; Factura: ' + (receivable.invoiceNumber || 'Sin factura') + '</p>';
        html += '  <div style="display:flex;gap:24px;margin-bottom:16px;font-size:13px;">';
        html += '    <span>Total: <strong>' + formatCLP(totalIva) + '</strong></span>';
        html += '    <span>Pagado: <strong style="color:var(--success)">' + formatCLP(pagado) + '</strong></span>';
        html += '    <span>Restante: <strong style="color:var(--danger)">' + formatCLP(Math.max(0, restante)) + '</strong></span>';
        html += '  </div>';

        // Pagos existentes
        if (payments.length > 0) {
            html += '  <table class="data-table" style="margin-bottom:16px;">';
            html += '    <thead><tr><th>Fecha</th><th>Monto</th><th style="text-align:center;width:90px">Acciones</th></tr></thead>';
            html += '    <tbody>';
            payments.forEach(function (p) {
                html += '<tr id="prow-' + p.id + '">';
                html += '  <td>' + (p.date || '-') + '</td>';
                html += '  <td>' + formatCLP(p.amount) + '</td>';
                html += '  <td style="text-align:center">';
                html += '    <button class="btn btn-sm btn-secondary btn-edit-payment" data-pid="' + p.id + '" style="padding:2px 8px;margin-right:3px" title="Editar">&#9998;</button>';
                html += '    <button class="btn btn-sm btn-danger btn-delete-payment" data-pid="' + p.id + '" style="padding:2px 8px;background:var(--danger);color:white;border:none" title="Eliminar">&#10005;</button>';
                html += '  </td>';
                html += '</tr>';
            });
            html += '    </tbody></table>';
        } else {
            html += '  <p style="color:var(--text-muted);font-size:13px;margin-bottom:16px;">Sin pagos registrados aún.</p>';
        }

        html += '  <hr style="border-color:var(--border-color);margin:12px 0 16px">';
        html += '  <h4 style="font-size:13px;font-weight:600;margin-bottom:12px;">Registrar nuevo pago</h4>';
        html += '  <div class="form-row">';
        html += '    <div class="form-group">';
        html += '      <label>Monto</label>';
        html += '      <input type="number" class="form-control" id="abono-amount" placeholder="Monto" value="' + Math.round(Math.max(0, restante)) + '">';
        html += '    </div>';
        html += '    <div class="form-group">';
        html += '      <label>Fecha del Pago</label>';
        html += '      <input type="date" class="form-control" id="abono-date" value="' + today + '">';
        html += '    </div>';
        html += '  </div>';
        html += '  <div class="form-actions">';
        html += '    <button class="btn btn-secondary" id="abono-cancel-btn">Cancelar</button>';
        html += '    <button class="btn btn-primary" id="abono-save" data-id="' + receivable.id + '">Guardar Pago</button>';
        html += '  </div>';
        html += '</div>';
        html += '</div>';

        return html;
    }

    // =========================================================================
    // MAIN RENDER
    // =========================================================================

    function render() {
        var html = '';
        html += '<div class="content-header">';
        html += '  <h2>Finanzas / CXC</h2>';
        html += '  <p>Cuentas por cobrar y seguimiento de pagos</p>';
        html += '</div>';
        html += '<div class="content-body" id="finance-content">';
        html += '  <div class="empty-state"><p>Cargando datos...</p></div>';
        html += '</div>';
        html += '<div id="finance-modal-container"></div>';
        return html;
    }

    // =========================================================================
    // ASYNC RENDER (loads data then renders KPIs + table)
    // =========================================================================

    async function loadAndRender() {
        try {
            var results = await Promise.all([
                window.Mazelab.DataService.getAll('receivables'),
                window.Mazelab.DataService.getAll('sales')
            ]);
            allReceivables = Array.isArray(results[0]) ? results[0] : [];
            cachedSales    = Array.isArray(results[1]) ? results[1] : [];
            // ── DB MIGRATION STATUS ───────────────────────────────────────
            // Schema: tabla 'facturas' en PostgreSQL (Replit) / 'receivables' en Supabase
            // eventDate en CXC es una copia de ventas.eventDate al momento de crear el registro.
            // getEffectiveEventDate() lo resuelve dinámicamente via saleId → ventas.
            // ESTADO: en branch pr-1, aún no mergeado a master.
            console.log('[CXC] Loaded', allReceivables.length, 'receivables,', cachedSales.length, 'sales. Using Supabase:', window.Mazelab.DataService.isUsingSupabase());

            // Compute real-time status for all
            allReceivables.forEach(function (r) {
                r._realStatus = getRealTimeStatus(r);
            });

            var kpis = computeKPIs(allReceivables);
            var container = document.getElementById('finance-content');
            if (!container) return;

            var html = renderKPIs(kpis) + renderTable(allReceivables);
            container.innerHTML = html;

            attachTableListeners();
        } catch (err) {
            console.error('FinanceModule: Error loading data', err);
            var container = document.getElementById('finance-content');
            if (container) {
                container.innerHTML = '<div class="empty-state"><p>Error al cargar datos: ' + err.message + '</p></div>';
            }
        }
    }

    // =========================================================================
    // EVENT LISTENERS
    // =========================================================================

    function attachTableListeners() {
        // Search
        var searchInput = document.getElementById('finance-search');
        if (searchInput) {
            searchInput.addEventListener('input', function () {
                searchQuery = this.value;
                refreshTable();
            });
        }

        // View toggle (Lista / Por Evento)
        var viewToggle = document.getElementById('finance-view-toggle');
        if (viewToggle) {
            viewToggle.querySelectorAll('.toggle-option').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    currentView = btn.dataset.finview;
                    refreshTable();
                });
            });
        }

        // Column sort headers
        document.querySelectorAll('.finance-sort-th').forEach(function (th) {
            th.addEventListener('click', function () {
                var col = th.dataset.sort;
                if (sortCol === col) { sortDir = sortDir === 'asc' ? 'desc' : 'asc'; }
                else { sortCol = col; sortDir = 'asc'; }
                refreshTable();
            });
        });

        // Column filter inputs
        document.querySelectorAll('.fin-col-filter').forEach(function (input) {
            input.addEventListener('input', function () {
                columnFilters[input.dataset.col] = input.value;
                refreshTable();
            });
        });

        // Limpiar filtros
        var clearFiltersBtn = document.getElementById('finance-clear-filters');
        if (clearFiltersBtn) {
            clearFiltersBtn.addEventListener('click', function () {
                columnFilters = {};
                searchQuery = '';
                var searchEl = document.getElementById('finance-search');
                if (searchEl) searchEl.value = '';
                refreshTable();
            });
        }

        // Toggle pending
        var pendingToggle = document.getElementById('finance-pending-toggle');
        if (pendingToggle) {
            pendingToggle.querySelectorAll('.toggle-option').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    showOnlyPending = btn.dataset.pending === 'true';
                    visibleCount = 25;
                    refreshTable();
                });
            });
        }

        // Load more
        var loadMoreBtn = document.getElementById('finance-load-more');
        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', function () {
                visibleCount = filteredList.length;
                refreshTable();
            });
        }

        // Nueva Factura manual
        var nuevaFacturaBtn = document.getElementById('finance-nueva-factura');
        if (nuevaFacturaBtn) {
            nuevaFacturaBtn.addEventListener('click', function () {
                openNuevaFacturaModal();
            });
        }

        // Facturar buttons (sin_factura records)
        document.querySelectorAll('.btn-facturar').forEach(function (btn) {
            btn.addEventListener('click', function () {
                openFacturarModal(this.dataset.id);
            });
        });
        document.querySelectorAll('.btn-solicitar-oc').forEach(function (btn) {
            btn.addEventListener('click', function () {
                openSolicitarOCModal(this.dataset.id);
            });
        });

        // KPI "Sin Factura" click → show popup with post-evento list
        var kpiSinFactura = document.getElementById('kpi-sin-factura');
        if (kpiSinFactura) {
            kpiSinFactura.addEventListener('click', function () {
                var postEvento = allReceivables.filter(function (r) {
                    return (r._realStatus || getRealTimeStatus(r)) === 'post_evento_sin_factura';
                });
                if (postEvento.length === 0) { alert('No hay eventos post-evento pendientes de factura.'); return; }
                var modalContainer = document.getElementById('finance-modal-container');
                if (!modalContainer) return;
                var rows = postEvento.map(function (r) {
                    var evDate = getEffectiveEventDate(r);
                    var diasSinFactura = evDate ? Math.floor((new Date() - parseLocalDate(evDate)) / 86400000) : 0;
                    var avisos = Array.isArray(r.avisos_factura) ? r.avisos_factura.length : 0;
                    return '<tr>' +
                        '<td style="padding:4px 6px;font-size:12px;">' + (r.sourceId || '-') + '</td>' +
                        '<td style="padding:4px 6px;font-size:12px;">' + escapeHtml(r.clientName || '') + '</td>' +
                        '<td style="padding:4px 6px;font-size:12px;">' + escapeHtml(r.eventName || '') + '</td>' +
                        '<td style="padding:4px 6px;font-size:12px;">' + formatCLP(getMonto(r)) + '</td>' +
                        '<td style="padding:4px 6px;font-size:12px;color:' + (diasSinFactura > 30 ? 'var(--danger)' : 'var(--warning)') + ';font-weight:600;">' + diasSinFactura + 'd</td>' +
                        '<td style="padding:4px 6px;font-size:12px;">' + (avisos > 0 ? avisos + ' aviso(s)' : '-') + '</td>' +
                        '<td style="padding:4px 6px;"><button class="btn btn-secondary btn-sm btn-solicitar-oc" data-id="' + r.id + '" style="font-size:10px;">Solicitar OC</button> <button class="btn btn-secondary btn-sm btn-facturar" data-id="' + r.id + '" style="font-size:10px;">Facturar</button></td>' +
                    '</tr>';
                }).join('');
                var html = '<div class="modal-overlay active" id="sin-factura-overlay">' +
                    '<div class="modal" style="max-width:850px;width:95%">' +
                    '<div class="modal-header"><h3>Pendientes de Facturar (' + postEvento.length + ')</h3><button class="modal-close" id="sf-close">&times;</button></div>' +
                    '<div style="overflow-x:auto;"><table class="data-table"><thead><tr><th>ID</th><th>Cliente</th><th>Evento</th><th>Monto</th><th>D\u00edas</th><th>Avisos</th><th>Acciones</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
                    '<div class="form-actions" style="margin-top:12px"><button class="btn btn-secondary" id="sf-close-btn">Cerrar</button></div>' +
                    '</div></div>';
                modalContainer.innerHTML = html;
                document.getElementById('sf-close').addEventListener('click', function () { modalContainer.innerHTML = ''; });
                document.getElementById('sf-close-btn').addEventListener('click', function () { modalContainer.innerHTML = ''; });
                document.getElementById('sin-factura-overlay').addEventListener('click', function (e) { if (e.target === this) modalContainer.innerHTML = ''; });
                // Delegate buttons inside modal
                modalContainer.addEventListener('click', function (e) {
                    var facBtn = e.target.closest('.btn-facturar');
                    if (facBtn) { modalContainer.innerHTML = ''; openFacturarModal(facBtn.dataset.id); }
                    var ocBtn = e.target.closest('.btn-solicitar-oc');
                    if (ocBtn) { openSolicitarOCModal(ocBtn.dataset.id); }
                });
            });
        }

        // Abono buttons
        document.querySelectorAll('.btn-abono').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var id = this.dataset.id;
                openAbonoModal(id);
            });
        });

        // Pagado Total buttons
        document.querySelectorAll('.btn-pagado-total').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var id = this.dataset.id;
                markAsPaid(id);
            });
        });

        // Cobrar buttons
        document.querySelectorAll('.btn-cobrar').forEach(function (btn) {
            btn.addEventListener('click', function () {
                openCobrarModal(this.dataset.id);
            });
        });

        // Mail facturacion buttons
        document.querySelectorAll('.btn-mail-factura').forEach(function (btn) {
            btn.addEventListener('click', function () {
                openMailFacturaModal(this.dataset.id);
            });
        });

        // NC buttons
        document.querySelectorAll('.btn-nc').forEach(function (btn) {
            btn.addEventListener('click', function () {
                openNCModal(this.dataset.id);
            });
        });

        // Eliminar buttons
        document.querySelectorAll('.btn-eliminar').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var id = this.dataset.id;
                deleteReceivable(id);
            });
        });
    }

    // =========================================================================
    // MAIL FACTURACION — enviar factura al cliente
    // =========================================================================

    function openMailFacturaModal(id) {
        var rec = allReceivables.find(function (r) { return r.id === id; });
        if (!rec) return;
        var modalContainer = document.getElementById('finance-modal-container');
        if (!modalContainer) return;

        var companyInfo = getCompanyInfo();
        var montoNeto = getMontoFacturado(rec);
        var iva = Math.round(montoNeto * 0.19);
        var total = montoNeto + iva;
        var eventDateStr = formatDate(getEffectiveEventDate(rec));
        var invoiceNum = rec.invoiceNumber || '';
        var eventName = rec.eventName || '';
        var clientName = rec.clientName || '';
        var clientEmail = rec.clientEmail || rec.contactEmail || '';
        var subject = 'Factura N\u00b0 ' + invoiceNum + ' - ' + eventName;

        // Build bank info section
        var bankText = '';
        if (companyInfo && (companyInfo.banco || companyInfo.numeroCuenta || companyInfo.bankName || companyInfo.bankAccount)) {
            bankText = '\nDatos de transferencia:\n';
            if (companyInfo.nombre) bankText += '  Titular:        ' + companyInfo.nombre + '\n';
            if (companyInfo.rut || companyInfo.bankRut) bankText += '  RUT:            ' + (companyInfo.rut || companyInfo.bankRut) + '\n';
            if (companyInfo.banco || companyInfo.bankName) bankText += '  Banco:          ' + (companyInfo.banco || companyInfo.bankName) + '\n';
            if (companyInfo.tipoCuenta) bankText += '  Tipo de Cuenta: ' + companyInfo.tipoCuenta + '\n';
            if (companyInfo.numeroCuenta || companyInfo.bankAccount) bankText += '  N\u00famero Cuenta:  ' + (companyInfo.numeroCuenta || companyInfo.bankAccount) + '\n';
            if (companyInfo.email) bankText += '  Email:          ' + companyInfo.email + '\n';
        }

        var emailBody = 'Estimado/a,\n\n' +
            'Se adjunta factura N\u00b0 ' + invoiceNum + ' por servicios realizados el d\u00eda ' + eventDateStr + ' para el evento ' + eventName + '.\n\n' +
            'Monto neto: ' + formatCLP(montoNeto) + '\n' +
            'IVA (19%): ' + formatCLP(iva) + '\n' +
            'Total: ' + formatCLP(total) + '\n' +
            bankText +
            '\nQuedamos atentos a la confirmaci\u00f3n del pago.\n\n' +
            'Saludos cordiales,\n' +
            (companyInfo && companyInfo.nombre ? companyInfo.nombre : 'Mazelab Producciones');

        var html = '<div class="modal-overlay active" id="mail-factura-overlay">';
        html += '<div class="modal" style="max-width:640px;width:95%">';
        html += '  <div class="modal-header">';
        html += '    <h3>Mail Facturaci\u00f3n</h3>';
        html += '    <button class="modal-close" id="mail-factura-close-x">&times;</button>';
        html += '  </div>';

        // Summary
        html += '  <div style="background:var(--bg-tertiary);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;font-size:13px">';
        html += '    <strong>' + escapeHtml(clientName || 'Sin cliente') + '</strong>';
        html += '    &nbsp;&middot;&nbsp;' + escapeHtml(eventName || 'Sin evento');
        html += '    &nbsp;&middot;&nbsp;Factura: <strong>' + escapeHtml(invoiceNum) + '</strong>';
        html += '    <br>Neto: ' + formatCLP(montoNeto) + ' &middot; IVA: ' + formatCLP(iva) + ' &middot; <strong>Total: ' + formatCLP(total) + '</strong>';
        html += '  </div>';

        // Client email
        html += '  <div class="form-group" style="margin-bottom:8px">';
        html += '    <label style="font-size:13px">Email del cliente</label>';
        html += '    <input type="email" id="mail-factura-email" class="form-control" value="' + escapeHtml(clientEmail) + '" placeholder="correo@cliente.cl">';
        html += '  </div>';

        // Subject
        html += '  <div class="form-group" style="margin-bottom:8px">';
        html += '    <label style="font-size:13px">Asunto</label>';
        html += '    <input type="text" id="mail-factura-subject" class="form-control" value="' + escapeHtml(subject) + '">';
        html += '  </div>';

        // Email body textarea
        html += '  <div class="form-group" style="margin-bottom:12px">';
        html += '    <label style="font-size:13px">Mensaje <span style="font-weight:400;color:var(--text-secondary)">(editable)</span></label>';
        html += '    <textarea id="mail-factura-body" class="form-control" rows="12" style="font-family:monospace;font-size:12px;margin-top:4px"></textarea>';
        html += '  </div>';

        // Action buttons
        html += '  <div style="display:flex;gap:8px;flex-wrap:wrap">';
        html += '    <button class="btn btn-secondary" id="mail-factura-copy">Copiar al portapapeles</button>';
        html += '    <button class="btn btn-primary" id="mail-factura-send">Enviar por email</button>';
        html += '  </div>';

        html += '  <div class="form-actions" style="margin-top:12px">';
        html += '    <button class="btn btn-secondary" id="mail-factura-cancel">Cerrar</button>';
        html += '  </div>';
        html += '</div></div>';

        modalContainer.innerHTML = html;

        // Set textarea value via DOM to avoid HTML escaping issues
        document.getElementById('mail-factura-body').value = emailBody;

        function closeModal() { modalContainer.innerHTML = ''; }

        document.getElementById('mail-factura-close-x').addEventListener('click', closeModal);
        document.getElementById('mail-factura-cancel').addEventListener('click', closeModal);
        document.getElementById('mail-factura-overlay').addEventListener('click', function (e) {
            if (e.target === this) closeModal();
        });

        // Copy to clipboard
        document.getElementById('mail-factura-copy').addEventListener('click', function () {
            var body = document.getElementById('mail-factura-body').value;
            if (navigator.clipboard) {
                navigator.clipboard.writeText(body).then(function () {
                    var btn = document.getElementById('mail-factura-copy');
                    if (btn) { btn.textContent = 'Copiado!'; setTimeout(function () { btn.textContent = 'Copiar al portapapeles'; }, 2000); }
                });
            }
        });

        // Send via mailto
        document.getElementById('mail-factura-send').addEventListener('click', function () {
            var toEmail = (document.getElementById('mail-factura-email').value || '').trim();
            var subjectVal = (document.getElementById('mail-factura-subject').value || '').trim();
            var bodyVal = document.getElementById('mail-factura-body').value || '';
            var mailtoUrl = 'mailto:' + encodeURIComponent(toEmail) +
                '?subject=' + encodeURIComponent(subjectVal) +
                '&body=' + encodeURIComponent(bodyVal);
            window.open(mailtoUrl, '_blank');
        });
    }

    // =========================================================================
    // COBRAR — email de cobro + tracking
    // =========================================================================

    function buildCobrarTemplate(rec, cobrosCount, overdueDays, userContext, companyInfo) {
        var pendiente = formatCLP(Math.round(getPendienteFacturado(rec)));
        var clientName = rec.clientName || 'Estimado cliente';
        var eventName = rec.eventName || 'el evento';
        var invoiceNum = rec.invoiceNumber || 'sin n\u00famero';
        var eventDateStr = formatDate(getEffectiveEventDate(rec));

        var subject, intro, urgencyNote;
        if (cobrosCount === 1) {
            subject = 'Recordatorio de Pago \u2014 Factura ' + invoiceNum;
            intro = 'Junto con saludar, le hacemos un cordial recordatorio de la siguiente factura pendiente de pago:';
            urgencyNote = 'Le agradecemos gestionar el pago a la brevedad posible.';
        } else if (cobrosCount === 2) {
            subject = 'Segundo Aviso \u2014 Factura ' + invoiceNum + ' (vencida ' + overdueDays + ' d\u00edas)';
            intro = 'Nos permitimos recordarle por segunda vez la siguiente factura que se encuentra vencida:';
            urgencyNote = 'De no recibir confirmaci\u00f3n de pago en los pr\u00f3ximos d\u00edas, nos veremos en la obligaci\u00f3n de escalar esta situaci\u00f3n.';
        } else {
            subject = 'URGENTE \u2014 Factura ' + invoiceNum + ' con ' + overdueDays + ' d\u00edas de atraso';
            intro = 'Le informamos que la siguiente factura lleva ' + overdueDays + ' d\u00edas vencida sin pago registrado:';
            urgencyNote = 'Solicitamos resolver esta situaci\u00f3n de forma inmediata para evitar mayores inconvenientes en nuestra relaci\u00f3n comercial.';
        }

        var contextNote = userContext ? '\nObservaci\u00f3n: ' + userContext + '\n' : '';

        var bankInfo = '';
        if (companyInfo && (companyInfo.banco || companyInfo.numeroCuenta)) {
            bankInfo = '\nDatos bancarios para transferencia:\n' +
                (companyInfo.nombre       ? '  Titular:        ' + companyInfo.nombre       + '\n' : '') +
                (companyInfo.rut          ? '  RUT:            ' + companyInfo.rut           + '\n' : '') +
                (companyInfo.banco        ? '  Banco:          ' + companyInfo.banco         + '\n' : '') +
                (companyInfo.tipoCuenta   ? '  Tipo de Cuenta: ' + companyInfo.tipoCuenta   + '\n' : '') +
                (companyInfo.numeroCuenta ? '  N\u00famero Cuenta:  ' + companyInfo.numeroCuenta + '\n' : '') +
                (companyInfo.email        ? '  Email:          ' + companyInfo.email         + '\n' : '');
        }

        return 'Asunto: ' + subject + '\n\n' +
            'Estimado/a ' + clientName + ',\n\n' +
            intro + '\n\n' +
            '  Evento:            ' + eventName + '\n' +
            '  Fecha del evento:  ' + eventDateStr + '\n' +
            '  N\u00b0 Factura:         ' + invoiceNum + '\n' +
            '  Monto pendiente:   ' + pendiente + '\n' +
            (overdueDays > 0 ? '  D\u00edas de atraso:  ' + overdueDays + '\n' : '') +
            contextNote +
            '\n' + urgencyNote + '\n' +
            bankInfo +
            '\nAgradecemos su pronta respuesta.\n\n' +
            'Saludos cordiales,\n' +
            (companyInfo && companyInfo.nombre ? companyInfo.nombre : 'Equipo de Cobranza') +
            (companyInfo && companyInfo.email ? '\n' + companyInfo.email : '');
    }

    async function fetchAICobrarEmail(rec, cobrosCount, overdueDays, userContext, companyInfo) {
        var AI = window.Mazelab && window.Mazelab.AIService;
        if (!AI || !AI.getConfig().apiKey) {
            throw new Error('API Key no configurada. Ve a Configurar > Inteligencia Artificial.');
        }

        // Build history context from notas + cobros for AI
        var historyContext = '';
        var notas = Array.isArray(rec.notas_cobranza) ? rec.notas_cobranza : [];
        var cobros = Array.isArray(rec.cobros) ? rec.cobros : [];
        if (notas.length > 0 || cobros.length > 0) {
            historyContext += '\n\nHISTORIAL DE GESTIONES PREVIAS:';
            cobros.forEach(function (c) {
                historyContext += '\n- ' + (c.date || '') + ': Aviso #' + (c.num || '') + ' enviado' + (c.context ? ' (' + c.context + ')' : '');
            });
            notas.forEach(function (n) {
                historyContext += '\n- ' + (n.date || '') + ': ' + (n.text || '');
            });
            historyContext += '\n\nUsa este historial para dar continuidad al mensaje. Si hay compromisos de pago previos, haz seguimiento.';
        }

        return await AI.generateCobranza({
            clientName:    rec.clientName || '',
            eventName:     rec.eventName  || '',
            invoiceNumber: rec.invoiceNumber || '',
            amount:        Math.round(getPendienteFacturado(rec)),
            eventDate:     getEffectiveEventDate(rec),
            cobrosCount:   cobrosCount,
            overdueDays:   overdueDays,
            userContext:   (userContext || '') + historyContext,
            companyInfo:   companyInfo || {}
        });
    }

    function renderCobrarHistory(cobros) {
        if (!cobros || !cobros.length) return '';
        var rows = cobros.map(function (c) {
            var label = c.method === 'ai' ? 'IA' : 'Plantilla';
            return '<tr>' +
                '<td style="white-space:nowrap">' + (c.date || '-') + '</td>' +
                '<td>' + (c.num || '-') + '\u00b0 aviso</td>' +
                '<td><span class="badge badge-info" style="font-size:10px">' + label + '</span></td>' +
                '<td style="font-size:11px;color:var(--text-secondary);max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (c.context || '') + '</td>' +
                '</tr>';
        }).join('');
        return '<div style="margin-bottom:12px">' +
            '<p style="font-size:11px;font-weight:600;color:var(--text-secondary);margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em">Historial de cobros enviados</p>' +
            '<table class="data-table" style="font-size:12px"><thead><tr><th>Fecha</th><th>Aviso</th><th>M\u00e9todo</th><th>Contexto</th></tr></thead><tbody>' +
            rows + '</tbody></table></div>';
    }

    function openCobrarModal(id) {
        var rec = allReceivables.find(function (r) { return r.id === id; });
        if (!rec) return;
        var modalContainer = document.getElementById('finance-modal-container');
        if (!modalContainer) return;

        var cobros = Array.isArray(rec.cobros) ? rec.cobros : [];
        var cobrosCount = cobros.length + 1;
        var overdueDays = getOverdueDays(rec);
        var companyInfo = getCompanyInfo();

        var pendiente = formatCLP(Math.round(getPendienteFacturado(rec)));

        var html = '<div class="modal-overlay active" id="cobrar-modal-overlay">';
        html += '<div class="modal" style="max-width:680px;width:95%">';
        html += '  <div class="modal-header">';
        html += '    <h3>' + cobrosCount + '\u00b0 Aviso de Cobro</h3>';
        html += '    <button class="modal-close" id="cobrar-close-x">&times;</button>';
        html += '  </div>';

        // Invoice summary
        html += '  <div style="background:var(--bg-tertiary);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;font-size:13px">';
        html += '    <strong>' + (rec.clientName || 'Sin cliente') + '</strong>';
        html += '    &nbsp;&middot;&nbsp;' + (rec.eventName || 'Sin evento');
        html += '    &nbsp;&middot;&nbsp;Factura: <strong>' + (rec.invoiceNumber || '-') + '</strong>';
        html += '    <br><span style="color:var(--danger)">Pendiente: <strong>' + pendiente + '</strong></span>';
        if (overdueDays > 0) {
            html += '    &nbsp;&middot;&nbsp;<span style="color:var(--danger)">' + overdueDays + ' d\u00edas de atraso</span>';
        }
        html += '  </div>';

        // Copy event info button
        var evDate = getEffectiveEventDate(rec);
        var svcNames = rec.serviceNames || rec.servicios || '';
        html += '  <div style="margin-bottom:12px">';
        html += '    <button class="btn btn-secondary btn-sm" id="cobrar-copy-info" style="font-size:11px">Copiar info evento</button>';
        html += '  </div>';

        // History
        html += renderCobrarHistory(cobros);

        // Notas de seguimiento
        var notas = Array.isArray(rec.notas_cobranza) ? rec.notas_cobranza : [];
        if (notas.length > 0) {
            html += '<div style="margin-bottom:12px">';
            html += '<p style="font-size:11px;font-weight:600;color:var(--text-secondary);margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em">Notas de seguimiento</p>';
            notas.forEach(function (n) {
                html += '<div style="padding:6px 10px;background:var(--bg-tertiary);border-radius:6px;margin-bottom:4px;font-size:12px;">';
                html += '<span style="color:var(--text-secondary)">' + (n.date || '') + '</span> — ';
                html += '<span style="color:var(--text-primary)">' + (n.text || '') + '</span>';
                html += '</div>';
            });
            html += '</div>';
        }

        // Add note
        html += '  <div class="form-group" style="margin-bottom:8px">';
        html += '    <label style="font-size:13px">Agregar nota de seguimiento</label>';
        html += '    <div style="display:flex;gap:8px">';
        html += '      <input type="text" id="cobrar-nota-text" class="form-control" placeholder="Ej: Quedaron en pagar a fin de mes, contactar el martes" style="flex:1">';
        html += '      <button class="btn btn-secondary" id="cobrar-nota-save" style="white-space:nowrap">Guardar nota</button>';
        html += '    </div>';
        html += '  </div>';

        // Context for AI
        html += '  <div class="form-group" style="margin-bottom:12px">';
        html += '    <label style="font-size:13px">Contexto adicional para IA <span style="font-weight:400;color:var(--text-secondary)">(opcional)</span></label>';
        html += '    <textarea id="cobrar-context" class="form-control" rows="2" placeholder="Ej: La OC fue enviada tarde, pegar aqui emails de respuesta del cliente..."></textarea>';
        html += '  </div>';

        // Generate buttons
        html += '  <div style="display:flex;gap:8px;margin-bottom:12px">';
        html += '    <button class="btn btn-secondary" id="cobrar-btn-template">Usar plantilla</button>';
        html += '    <button class="btn btn-primary" id="cobrar-btn-ai">Generar con IA &#10024;</button>';
        html += '  </div>';

        // AI loading spinner (hidden)
        html += '  <div id="cobrar-ai-loading" style="display:none;color:var(--text-secondary);font-size:13px;margin-bottom:8px">Generando mensaje...</div>';

        // Email area (hidden until generated)
        html += '  <div id="cobrar-email-area" style="display:none">';
        html += '    <label style="font-size:13px;font-weight:600">Mensaje generado <span style="font-weight:400;color:var(--text-secondary)">(editable)</span></label>';
        html += '    <textarea id="cobrar-email-text" class="form-control" rows="12" style="font-family:monospace;font-size:12px;margin-top:4px"></textarea>';
        html += '    <div style="display:flex;gap:8px;margin-top:8px">';
        html += '      <button class="btn btn-secondary" id="cobrar-copy-btn">Copiar al portapapeles</button>';
        html += '      <button class="btn btn-primary" id="cobrar-save-btn">Marcar como enviado</button>';
        html += '    </div>';
        html += '  </div>';

        html += '  <div class="form-actions" style="margin-top:12px">';
        html += '    <button class="btn btn-secondary" id="cobrar-cancel-btn">Cerrar</button>';
        html += '  </div>';
        html += '</div></div>';

        modalContainer.innerHTML = html;

        var currentMethod = 'template';

        function closeModal() { modalContainer.innerHTML = ''; }

        document.getElementById('cobrar-close-x').addEventListener('click', closeModal);
        document.getElementById('cobrar-cancel-btn').addEventListener('click', closeModal);
        document.getElementById('cobrar-modal-overlay').addEventListener('click', function (e) {
            if (e.target === this) closeModal();
        });

        // Copy event info
        document.getElementById('cobrar-copy-info').addEventListener('click', function () {
            var evDate2 = getEffectiveEventDate(rec);
            var info = 'Evento: ' + (rec.eventName || '-') + '\n' +
                'Cliente: ' + (rec.clientName || '-') + '\n' +
                'Factura: ' + (rec.invoiceNumber || '-') + '\n' +
                'Fecha evento: ' + (evDate2 || '-') + '\n' +
                'Servicios: ' + (rec.serviceNames || rec.servicios || '-') + '\n' +
                'Pendiente: ' + formatCLP(Math.round(getPendienteFacturado(rec)));
            if (navigator.clipboard) {
                navigator.clipboard.writeText(info).then(function () {
                    var btn = document.getElementById('cobrar-copy-info');
                    if (btn) { btn.textContent = 'Copiado!'; setTimeout(function () { btn.textContent = 'Copiar info evento'; }, 2000); }
                });
            }
        });

        // Save nota
        document.getElementById('cobrar-nota-save').addEventListener('click', async function () {
            var textInput = document.getElementById('cobrar-nota-text');
            var text = textInput ? textInput.value.trim() : '';
            if (!text) return;
            var today = new Date().toISOString().split('T')[0];
            var existingNotas = Array.isArray(rec.notas_cobranza) ? rec.notas_cobranza : [];
            var updatedNotas = existingNotas.concat([{ date: today, text: text }]);
            try {
                await window.Mazelab.DataService.update('receivables', rec.id, { notas_cobranza: updatedNotas });
                var idx2 = allReceivables.findIndex(function (r2) { return r2.id === rec.id; });
                if (idx2 !== -1) allReceivables[idx2].notas_cobranza = updatedNotas;
                rec.notas_cobranza = updatedNotas;
                // Re-render the modal to show new note
                closeModal();
                openCobrarModal(rec.id);
            } catch (err) {
                alert('Error al guardar nota: ' + err.message);
            }
        });

        function showEmailArea(text, method) {
            currentMethod = method;
            document.getElementById('cobrar-email-text').value = text;
            document.getElementById('cobrar-email-area').style.display = 'block';
        }

        // Template button
        document.getElementById('cobrar-btn-template').addEventListener('click', function () {
            var userContext = document.getElementById('cobrar-context').value.trim();
            var text = buildCobrarTemplate(rec, cobrosCount, overdueDays, userContext, companyInfo);
            showEmailArea(text, 'template');
        });

        // AI button
        document.getElementById('cobrar-btn-ai').addEventListener('click', async function () {
            var userContext = document.getElementById('cobrar-context').value.trim();
            var loadingEl = document.getElementById('cobrar-ai-loading');
            var btn = this;
            btn.disabled = true;
            if (loadingEl) loadingEl.style.display = 'block';
            try {
                var text = await fetchAICobrarEmail(rec, cobrosCount, overdueDays, userContext, companyInfo);
                showEmailArea(text, 'ai');
            } catch (err) {
                console.warn('AI generation failed, falling back to template:', err);
                var fallback = buildCobrarTemplate(rec, cobrosCount, overdueDays, userContext, companyInfo);
                showEmailArea(fallback, 'template');
                var errMsg = err.message || 'Error desconocido';
                if (errMsg.indexOf('API Key') !== -1) {
                    alert(errMsg);
                } else {
                    alert('La generaci\u00f3n con IA fall\u00f3: ' + errMsg + '\nSe us\u00f3 la plantilla en su lugar.');
                }
            } finally {
                btn.disabled = false;
                if (loadingEl) loadingEl.style.display = 'none';
            }
        });

        // Copy button
        document.getElementById('cobrar-copy-btn').addEventListener('click', function () {
            var text = document.getElementById('cobrar-email-text').value;
            if (navigator.clipboard) {
                navigator.clipboard.writeText(text).then(function () {
                    var btn = document.getElementById('cobrar-copy-btn');
                    if (btn) { btn.textContent = '\u2713 Copiado'; setTimeout(function () { btn.textContent = 'Copiar al portapapeles'; }, 2000); }
                });
            } else {
                document.getElementById('cobrar-email-text').select();
                document.execCommand('copy');
            }
        });

        // Mark as sent button
        document.getElementById('cobrar-save-btn').addEventListener('click', async function () {
            var userContext = document.getElementById('cobrar-context').value.trim();
            var today = new Date().toISOString().split('T')[0];
            var newCobro = {
                id:      Date.now().toString(),
                date:    today,
                num:     cobrosCount,
                method:  currentMethod,
                context: userContext
            };
            var updatedCobros = cobros.concat([newCobro]);
            try {
                await window.Mazelab.DataService.update('receivables', rec.id, { cobros: updatedCobros });
                // Update local cache
                var idx = allReceivables.findIndex(function (r) { return r.id === rec.id; });
                if (idx !== -1) allReceivables[idx].cobros = updatedCobros;
                closeModal();
                refreshTable();
            } catch (err) {
                alert('Error al guardar: ' + err.message);
            }
        });
    }

    function refreshTable() {
        var container = document.getElementById('finance-content');
        if (!container) return;

        // Capturar foco ANTES de destruir el DOM (el activeElement se pierde al reasignar innerHTML)
        var focusedEl = document.activeElement;
        var searchHadFocus = focusedEl && focusedEl.id === 'finance-search';
        var focusedCol = (focusedEl && focusedEl.classList && focusedEl.classList.contains('fin-col-filter')) ? focusedEl.dataset.col : null;
        var focusCursor = focusedCol ? { s: focusedEl.selectionStart, e: focusedEl.selectionEnd } : null;

        var kpis = computeKPIs(allReceivables);
        container.innerHTML = renderKPIs(kpis) + renderTable(allReceivables);
        attachTableListeners();

        // Restaurar foco después del re-render
        if (focusedCol) {
            setTimeout(function () {
                var el = document.querySelector('.fin-col-filter[data-col="' + focusedCol + '"]');
                if (el) { el.focus(); if (focusCursor) el.setSelectionRange(focusCursor.s, focusCursor.e); }
            }, 0);
        } else if (searchHadFocus) {
            var newInput = document.getElementById('finance-search');
            if (newInput) { newInput.focus(); newInput.setSelectionRange(newInput.value.length, newInput.value.length); }
        }
    }

    // =========================================================================
    // ACTIONS
    // =========================================================================

    function openAbonoModal(id) {
        var rec = allReceivables.find(function (r) { return r.id === id; });
        if (!rec) return;

        var modalContainer = document.getElementById('finance-modal-container');
        if (!modalContainer) return;

        function reopen() {
            // Re-fetch the updated rec from allReceivables before reopening
            var updated = allReceivables.find(function (r) { return r.id === id; });
            if (updated) rec = updated;
            modalContainer.innerHTML = renderAbonoModal(rec);
            bindAbonoEvents();
        }
        function closeModal() { modalContainer.innerHTML = ''; }

        function bindAbonoEvents() {
            var closeX = document.getElementById('abono-close-x');
            var cancelBtn = document.getElementById('abono-cancel-btn');
            if (closeX) closeX.addEventListener('click', closeModal);
            if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

            document.getElementById('abono-modal-overlay').addEventListener('click', function (e) {
                if (e.target === this) closeModal();
            });

            // Delete existing payment
            document.querySelectorAll('.btn-delete-payment').forEach(function (btn) {
                btn.addEventListener('click', async function () {
                    var pid = this.dataset.pid;
                    if (!confirm('\u00bfEliminar este pago?')) return;
                    try {
                        var payments = (Array.isArray(rec.payments) ? rec.payments : []).filter(function (p) { return p.id !== pid; });
                        await window.Mazelab.DataService.update('receivables', rec.id, { payments: payments });
                        rec.payments = payments;
                        // Update in allReceivables
                        var idx = allReceivables.findIndex(function (r) { return r.id === rec.id; });
                        if (idx !== -1) allReceivables[idx].payments = payments;
                        reopen();
                    } catch (err) { alert('Error: ' + err.message); }
                });
            });

            // Edit existing payment (inline)
            document.querySelectorAll('.btn-edit-payment').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var pid = this.dataset.pid;
                    var row = document.getElementById('prow-' + pid);
                    var pmt = (rec.payments || []).find(function (p) { return p.id === pid; });
                    if (!row || !pmt) return;
                    row.innerHTML =
                        '<td><input type="date" class="form-control" id="epd-' + pid + '" value="' + (pmt.date || '') + '" style="padding:4px"></td>' +
                        '<td><input type="number" class="form-control" id="epa-' + pid + '" value="' + (pmt.amount || 0) + '" style="padding:4px"></td>' +
                        '<td style="text-align:center">' +
                        '  <button class="btn btn-sm btn-primary btn-save-ep" data-pid="' + pid + '" style="padding:2px 8px;margin-right:3px">&#10003;</button>' +
                        '  <button class="btn btn-sm btn-secondary btn-cancel-ep" style="padding:2px 8px">&#10005;</button>' +
                        '</td>';
                    row.querySelector('.btn-cancel-ep').addEventListener('click', reopen);
                    row.querySelector('.btn-save-ep').addEventListener('click', async function () {
                        var newDate = document.getElementById('epd-' + pid).value;
                        var newAmt = Number(document.getElementById('epa-' + pid).value) || 0;
                        try {
                            var payments = (rec.payments || []).map(function (p) {
                                return p.id === pid ? { id: p.id, amount: newAmt, date: newDate, method: p.method || 'manual' } : p;
                            });
                            await window.Mazelab.DataService.update('receivables', rec.id, { payments: payments });
                            rec.payments = payments;
                            var idx = allReceivables.findIndex(function (r) { return r.id === rec.id; });
                            if (idx !== -1) allReceivables[idx].payments = payments;
                            reopen();
                        } catch (err) { alert('Error: ' + err.message); }
                    });
                });
            });

            // Save new payment
            var saveBtn = document.getElementById('abono-save');
            if (saveBtn) {
                saveBtn.addEventListener('click', async function () {
                    var amount = Number(document.getElementById('abono-amount').value) || 0;
                    var date = document.getElementById('abono-date').value;
                    if (amount <= 0) { alert('Ingrese un monto v\u00e1lido'); return; }
                    try {
                        var payments = Array.isArray(rec.payments) ? rec.payments.slice() : [];
                        payments.push({ id: Date.now().toString(), amount: amount, date: date || new Date().toISOString().split('T')[0] });
                        await window.Mazelab.DataService.update('receivables', rec.id, { payments: payments });
                        closeModal();
                        await loadAndRender();
                    } catch (err) {
                        console.error('Error saving abono:', err);
                        alert('Error al guardar abono: ' + err.message);
                    }
                });
            }
        }

        modalContainer.innerHTML = renderAbonoModal(rec);
        bindAbonoEvents();
    }

    function openNuevaFacturaModal() {
        var modalContainer = document.getElementById('finance-modal-container');
        if (!modalContainer) return;

        var today = new Date();
        var dd = String(today.getDate()).padStart(2, '0');
        var mm = String(today.getMonth() + 1).padStart(2, '0');
        var yyyy = today.getFullYear();
        var todayDMY = dd + '/' + mm + '/' + yyyy;

        var html = '<div class="modal-overlay active" id="nueva-fac-overlay">' +
            '<div class="modal">' +
            '  <div class="modal-header">' +
            '    <h3>Nueva Factura — ingreso manual</h3>' +
            '    <button class="modal-close" id="nf-close-x">&times;</button>' +
            '  </div>' +
            '  <p style="color:var(--text-secondary);font-size:13px;margin-bottom:12px">Asocia esta factura a un evento existente.</p>' +
            '  <div class="form-group">' +
            '    <label>ID del evento <span style="color:var(--text-muted);font-weight:400">(escribe el n\u00famero, ej: 850)</span></label>' +
            '    <input type="text" class="form-control" id="nf-id-search" placeholder="Ej: 850" autocomplete="off">' +
            '  </div>' +
            '  <input type="hidden" id="nf-sale-id">' +
            '  <div id="nf-sale-info" style="background:var(--bg-tertiary);border-radius:6px;padding:8px 12px;margin:-4px 0 12px 0;font-size:12px;color:var(--text-secondary);min-height:32px">Escribe el ID para buscar el evento.</div>' +
            '  <div class="form-row">' +
            '    <div class="form-group">' +
            '      <label>N\u00b0 Factura</label>' +
            '      <input type="text" class="form-control" id="nf-number" placeholder="Ej: F-001245">' +
            '    </div>' +
            '    <div class="form-group">' +
            '      <label>Fecha Emisi\u00f3n (DD/MM/AAAA)</label>' +
            '      <input type="text" class="form-control" id="nf-date" value="' + todayDMY + '">' +
            '    </div>' +
            '  </div>' +
            '  <div class="form-row">' +
            '    <div class="form-group">' +
            '      <label>Monto Neto (sin IVA)</label>' +
            '      <input type="number" class="form-control" id="nf-amount" placeholder="Ej: 650000" min="0">' +
            '    </div>' +
            '    <div class="form-group">' +
            '      <label>Cond. de Pago (d\u00edas)</label>' +
            '      <input type="number" class="form-control" id="nf-terms" value="30" min="1">' +
            '    </div>' +
            '  </div>' +
            '  <div class="form-group" style="margin-bottom:8px">' +
            '    <label>Tipo de documento</label>' +
            '    <select class="form-control" id="nf-tipo">' +
            '      <option value="F">Factura (+ 19% IVA)</option>' +
            '      <option value="E">Factura Exenta (sin IVA)</option>' +
            '    </select>' +
            '  </div>' +
            '  <div style="background:var(--bg-tertiary);border-radius:var(--radius-sm);padding:12px;margin-bottom:16px;font-size:13px;">' +
            '    <span style="color:var(--text-secondary)">IVA (19%): </span><strong id="nf-iva-preview">$0</strong>' +
            '    &nbsp;&nbsp; <span style="color:var(--text-secondary)">Total con IVA: </span><strong id="nf-total-preview">$0</strong>' +
            '  </div>' +
            '  <div class="form-actions">' +
            '    <button class="btn btn-secondary" id="nf-cancel-btn">Cancelar</button>' +
            '    <button class="btn btn-primary" id="nf-save-btn">Guardar Factura</button>' +
            '  </div>' +
            '</div></div>';

        modalContainer.innerHTML = html;

        function closeModal() { modalContainer.innerHTML = ''; }
        document.getElementById('nf-close-x').addEventListener('click', closeModal);
        document.getElementById('nf-cancel-btn').addEventListener('click', closeModal);
        document.getElementById('nueva-fac-overlay').addEventListener('click', function (e) {
            if (e.target === this) closeModal();
        });

        function updatePreview() {
            var neto = Number(document.getElementById('nf-amount').value) || 0;
            var tipo = document.getElementById('nf-tipo').value;
            var iva  = tipo === 'E' ? 0 : Math.round(neto * 0.19);
            document.getElementById('nf-iva-preview').textContent = tipo === 'E' ? '$0 (exenta)' : formatCLP(iva);
            document.getElementById('nf-total-preview').textContent = formatCLP(neto + iva);
        }
        document.getElementById('nf-amount').addEventListener('input', updatePreview);
        document.getElementById('nf-tipo').addEventListener('change', updatePreview);

        // ID search → auto-fill sale info
        document.getElementById('nf-id-search').addEventListener('input', function () {
            var q = this.value.trim();
            var info = document.getElementById('nf-sale-info');
            var hidSaleId = document.getElementById('nf-sale-id');
            if (!q) {
                info.textContent = 'Escribe el ID para buscar el evento.';
                info.style.color = 'var(--text-muted)';
                hidSaleId.value = '';
                this.style.borderColor = '';
                return;
            }
            var found = (cachedSales || []).find(function (s) {
                return String(s.sourceId || '') === q || String(s.id || '') === q;
            });
            if (found) {
                hidSaleId.value = found.id;
                info.innerHTML = '<strong style="color:var(--text-primary)">#' + (found.sourceId || found.id) + ' — ' + (found.eventName || '-') + '</strong>' +
                    '<span style="margin-left:8px">' + (found.clientName || '') + '</span>' +
                    (found.eventDate ? '<span style="margin-left:8px;color:var(--text-muted)">' + found.eventDate + '</span>' : '') +
                    (found.amount ? '<span style="margin-left:8px;color:var(--success)">' + formatCLP(Number(found.amount)) + '</span>' : '');
                this.style.borderColor = 'var(--success)';
            } else {
                hidSaleId.value = '';
                info.textContent = q.length >= 2 ? 'Evento no encontrado — verifica el ID.' : 'Escribe el ID para buscar el evento.';
                info.style.color = q.length >= 2 ? 'var(--danger)' : 'var(--text-muted)';
                this.style.borderColor = q.length >= 2 ? 'var(--danger)' : '';
            }
        });

        document.getElementById('nf-save-btn').addEventListener('click', async function () {
            var saleId = document.getElementById('nf-sale-id').value;
            var invoiceNumber = document.getElementById('nf-number').value.trim();
            var billingMonth  = document.getElementById('nf-date').value.trim();
            var invoicedAmount = Number(document.getElementById('nf-amount').value) || 0;
            var paymentTerms  = Number(document.getElementById('nf-terms').value) || 30;
            var tipoDoc = document.getElementById('nf-tipo').value;

            if (!saleId) { alert('Selecciona el evento al que pertenece esta factura.'); return; }
            if (!/^\d{2}\/\d{2}\/\d{4}$/.test(billingMonth)) { alert('La fecha debe tener formato DD/MM/AAAA'); return; }
            if (invoicedAmount <= 0) { alert('Ingresa el monto neto facturado.'); return; }

            var sale = (cachedSales || []).find(function (s) { return String(s.id) === saleId; });

            try {
                await window.Mazelab.DataService.create('receivables', {
                    id:             window.Mazelab.Storage.generateId(),
                    eventName:      sale ? (sale.eventName  || '') : '',
                    eventDate:      sale ? (sale.eventDate  || '') : '',
                    clientName:     sale ? (sale.clientName || '') : '',
                    montoNeto:      invoicedAmount,
                    invoicedAmount: invoicedAmount,
                    monto_venta:    invoicedAmount,
                    invoiceNumber:  invoiceNumber,
                    billingMonth:   billingMonth,
                    paymentTerms:   paymentTerms,
                    tipoDoc:        tipoDoc,
                    status:         'pendiente_pago',
                    saleId:         saleId,
                    payments:       []
                });
                closeModal();
                await loadAndRender();
            } catch (err) { alert('Error al guardar: ' + err.message); }
        });
    }

    function openFacturarModal(id) {
        var rec = allReceivables.find(function (r) { return r.id === id; });
        if (!rec) return;
        var modalContainer = document.getElementById('finance-modal-container');
        if (!modalContainer) return;

        var today = new Date();
        var dd = String(today.getDate()).padStart(2, '0');
        var mm = String(today.getMonth() + 1).padStart(2, '0');
        var yyyy = today.getFullYear();
        var todayDMY = dd + '/' + mm + '/' + yyyy;
        var refAmount = getMonto(rec); // neto restante a facturar

        var html = '';
        html += '<div class="modal-overlay active" id="facturar-modal-overlay">';
        html += '<div class="modal">';
        html += '  <div class="modal-header">';
        html += '    <h3>Registrar Factura</h3>';
        html += '    <button class="modal-close" id="fac-close-x">&times;</button>';
        html += '  </div>';
        html += '  <p style="color:var(--text-secondary);font-size:13px;margin-bottom:8px;">';
        html += '    <strong>' + (rec.clientName || '') + '</strong> — ' + (rec.eventName || '') + '</p>';
        html += '  <div style="background:#f0f7ff;border:1px solid #bdd7f5;border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:13px;">';
        html += '    <span style="color:#212529">Neto pendiente de facturar: </span><strong style="color:#212529">' + formatCLP(refAmount) + '</strong>';
        html += '    <span style="color:#555;margin-left:12px;font-size:12px">(puedes facturar una parte o el total)</span>';
        html += '  </div>';
        html += '  <div class="form-row">';
        html += '    <div class="form-group">';
        html += '      <label>N\u00b0 Factura</label>';
        html += '      <input type="text" class="form-control" id="fac-number" placeholder="Ej: F-001245">';
        html += '    </div>';
        html += '    <div class="form-group">';
        html += '      <label>Fecha Emisi\u00f3n (DD/MM/AAAA)</label>';
        html += '      <input type="text" class="form-control" id="fac-date" value="' + todayDMY + '" placeholder="DD/MM/AAAA">';
        html += '    </div>';
        html += '  </div>';
        html += '  <div class="form-row">';
        html += '    <div class="form-group">';
        html += '      <label>Monto Neto Facturado (sin IVA)';
        html += '        <button type="button" id="fac-btn-50" style="margin-left:10px;font-size:11px;padding:2px 8px;background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:4px;cursor:pointer;color:var(--text-secondary)">50%</button>';
        html += '        <button type="button" id="fac-btn-100" style="margin-left:4px;font-size:11px;padding:2px 8px;background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:4px;cursor:pointer;color:var(--text-secondary)">100%</button>';
        html += '      </label>';
        html += '      <input type="number" class="form-control" id="fac-amount" value="' + refAmount + '" placeholder="Ej: 4500000">';
        html += '    </div>';
        html += '    <div class="form-group">';
        html += '      <label>Cond. de Pago (d\u00edas)</label>';
        html += '      <input type="number" class="form-control" id="fac-terms" value="30" min="1" step="1" placeholder="30">';
        html += '    </div>';
        html += '  </div>';
        html += '  <div class="form-row" style="margin-bottom:8px">';
        html += '    <div class="form-group" style="margin-bottom:0">';
        html += '      <label>Tipo de documento</label>';
        html += '      <select class="form-control" id="fac-tipo">';
        html += '        <option value="F">Factura (+ 19% IVA)</option>';
        html += '        <option value="E">Factura Exenta (sin IVA)</option>';
        html += '      </select>';
        html += '    </div>';
        html += '  </div>';
        html += '  <div style="background:var(--bg-tertiary);border-radius:var(--radius-sm);padding:12px;margin-bottom:16px;font-size:13px;">';
        html += '    <span style="color:var(--text-secondary)">IVA (19%): </span><strong id="fac-iva-preview">$0</strong>';
        html += '    &nbsp;&nbsp; <span style="color:var(--text-secondary)">Total con IVA: </span><strong id="fac-total-preview">$0</strong>';
        html += '  </div>';
        html += '  <div class="form-actions">';
        html += '    <button class="btn btn-secondary" id="fac-cancel-btn">Cancelar</button>';
        html += '    <button class="btn btn-primary" id="fac-save-btn">Guardar Factura</button>';
        html += '  </div>';
        html += '</div>';
        html += '</div>';

        modalContainer.innerHTML = html;

        function closeModal() { modalContainer.innerHTML = ''; }

        document.getElementById('fac-close-x').addEventListener('click', closeModal);
        document.getElementById('fac-cancel-btn').addEventListener('click', closeModal);
        document.getElementById('facturar-modal-overlay').addEventListener('click', function (e) {
            if (e.target === this) closeModal();
        });

        // Live IVA preview
        function updateIvaPreview() {
            var neto = Number(document.getElementById('fac-amount').value) || 0;
            var tipo = document.getElementById('fac-tipo').value;
            var iva  = tipo === 'E' ? 0 : Math.round(neto * 0.19);
            document.getElementById('fac-iva-preview').textContent = tipo === 'E' ? '$0 (exenta)' : formatCLP(iva);
            document.getElementById('fac-total-preview').textContent = formatCLP(neto + iva);
        }
        document.getElementById('fac-amount').addEventListener('input', updateIvaPreview);
        document.getElementById('fac-tipo').addEventListener('change', updateIvaPreview);
        updateIvaPreview(); // populate on open
        document.getElementById('fac-btn-50').addEventListener('click', function () {
            document.getElementById('fac-amount').value = Math.round(refAmount / 2);
            updateIvaPreview();
        });
        document.getElementById('fac-btn-100').addEventListener('click', function () {
            document.getElementById('fac-amount').value = refAmount;
            updateIvaPreview();
        });

        document.getElementById('fac-save-btn').addEventListener('click', async function () {
            var invoiceNumber = document.getElementById('fac-number').value.trim();
            var billingMonth = document.getElementById('fac-date').value.trim();
            var invoicedAmount = Number(document.getElementById('fac-amount').value) || 0;
            var paymentTerms = Number(document.getElementById('fac-terms').value) || 30;
            var tipoDoc = document.getElementById('fac-tipo').value;

            // Validate DD/MM/YYYY
            if (!/^\d{2}\/\d{2}\/\d{4}$/.test(billingMonth)) {
                alert('La fecha debe tener formato DD/MM/AAAA (ej: 18/01/2026)');
                return;
            }
            if (invoicedAmount <= 0) {
                alert('Ingrese el monto neto facturado');
                return;
            }
            try {
                var netoTotal = getMonto(rec); // monto_venta del registro residual
                if (invoicedAmount > netoTotal) {
                    alert('El monto facturado (' + formatCLP(invoicedAmount) + ') no puede superar el neto pendiente (' + formatCLP(netoTotal) + ').');
                    return;
                }
                var netoRestante = netoTotal - invoicedAmount;

                // 1. Crear una nueva CXC row para esta factura específica
                var linkedSaleId = rec.saleId || (/^\d+$/.test(String(rec.id || '')) ? rec.id : null);
                var newRec = {
                    id:             window.Mazelab.Storage.generateId(),
                    eventName:      rec.eventName  || '',
                    eventDate:      rec.eventDate  || '',
                    clientName:     rec.clientName || '',
                    montoNeto:      invoicedAmount,
                    invoicedAmount: invoicedAmount,
                    monto_venta:    invoicedAmount,
                    invoiceNumber:  invoiceNumber,
                    billingMonth:   billingMonth,
                    paymentTerms:   paymentTerms,
                    tipoDoc:        tipoDoc,
                    status:         'pendiente_pago',
                    saleId:         linkedSaleId,
                    sourceId:       rec.sourceId || '',
                    sourceType:     'factura',
                    payments:       []
                };
                // Preserve history arrays only if they exist on the original record
                if (rec.avisos_factura && rec.avisos_factura.length) newRec.avisos_factura = rec.avisos_factura;
                if (rec.notas_cobranza && rec.notas_cobranza.length) newRec.notas_cobranza = rec.notas_cobranza;
                if (rec.cobros && rec.cobros.length) newRec.cobros = rec.cobros;
                await window.Mazelab.DataService.create('receivables', newRec);

                // 2. Actualizar o eliminar la CXC residual (por facturar)
                if (netoRestante <= 0) {
                    // Completamente facturado: eliminar la fila residual
                    await window.Mazelab.DataService.remove('receivables', rec.id);
                } else {
                    // Parcialmente facturado: reducir el monto restante
                    await window.Mazelab.DataService.update('receivables', rec.id, {
                        monto_venta: netoRestante,
                        status:      'sin_factura'
                    });
                }

                closeModal();
                await loadAndRender();
            } catch (err) { alert('Error: ' + err.message); }
        });
    }

    // =========================================================================
    // SOLICITAR OC / FACTURA
    // =========================================================================

    function openSolicitarOCModal(id) {
        var rec = allReceivables.find(function (r) { return r.id === id; });
        if (!rec) return;
        var modalContainer = document.getElementById('finance-modal-container');
        if (!modalContainer) return;

        var avisos = Array.isArray(rec.avisos_factura) ? rec.avisos_factura : [];
        var avisoNum = avisos.length + 1;
        var monto = getMonto(rec);
        var evDate = getEffectiveEventDate(rec);

        var historyHTML = '';
        if (avisos.length > 0) {
            historyHTML = '<div style="margin-bottom:12px"><p style="font-size:11px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Avisos enviados</p>';
            avisos.forEach(function (a) {
                historyHTML += '<div style="padding:4px 8px;background:var(--bg-tertiary);border-radius:4px;margin-bottom:3px;font-size:12px;"><span style="color:var(--text-secondary)">' + (a.date || '') + '</span> — Aviso #' + (a.num || '') + (a.context ? ' — ' + a.context : '') + '</div>';
            });
            historyHTML += '</div>';
        }

        var templateText = 'Estimado/a,\n\nEn nuestro sistema nos figura como pendiente de facturaci\u00f3n el evento:\n\n' +
            'Evento: ' + (rec.eventName || '-') + '\n' +
            'Fecha: ' + (evDate || '-') + '\n' +
            'Monto neto: ' + formatCLP(monto) + '\n\n' +
            'Favor cu\u00e9ntanos si nos env\u00edas una OC o datos de facturaci\u00f3n para poder emitir la factura.\n\n' +
            'Quedo atento, saludos.';

        var html = '<div class="modal-overlay active" id="oc-modal-overlay">';
        html += '<div class="modal" style="max-width:650px;width:95%">';
        html += '<div class="modal-header"><h3>' + avisoNum + '\u00b0 Solicitud de OC / Factura</h3><button class="modal-close" id="oc-close-x">&times;</button></div>';
        html += '<div style="background:var(--bg-tertiary);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;font-size:13px">';
        html += '<strong>' + escapeHtml(rec.clientName || '') + '</strong> — ' + escapeHtml(rec.eventName || '') + '<br>Monto: <strong>' + formatCLP(monto) + '</strong>';
        html += '</div>';
        html += historyHTML;
        html += '<div class="form-group" style="margin-bottom:8px"><label style="font-size:13px">Contexto adicional</label>';
        html += '<input type="text" id="oc-context" class="form-control" placeholder="Ej: Se comprometi\u00f3 a enviar OC hoy..."></div>';
        html += '<div style="display:flex;gap:8px;margin-bottom:12px">';
        html += '<button class="btn btn-secondary" id="oc-btn-template">Usar plantilla</button>';
        html += '<button class="btn btn-primary" id="oc-btn-ai">Generar con IA</button>';
        html += '</div>';
        html += '<div id="oc-email-area" style="display:none">';
        html += '<textarea id="oc-email-text" class="form-control" rows="10" style="font-family:monospace;font-size:12px;margin-bottom:8px"></textarea>';
        html += '<div style="display:flex;gap:8px">';
        html += '<button class="btn btn-secondary" id="oc-copy">Copiar</button>';
        html += '<button class="btn btn-primary" id="oc-save">Marcar como enviado</button>';
        html += '</div></div>';
        html += '<div class="form-actions" style="margin-top:12px"><button class="btn btn-secondary" id="oc-cancel">Cerrar</button></div>';
        html += '</div></div>';

        modalContainer.innerHTML = html;

        function closeModal() { modalContainer.innerHTML = ''; }
        document.getElementById('oc-close-x').addEventListener('click', closeModal);
        document.getElementById('oc-cancel').addEventListener('click', closeModal);
        document.getElementById('oc-modal-overlay').addEventListener('click', function (e) { if (e.target === this) closeModal(); });

        document.getElementById('oc-btn-template').addEventListener('click', function () {
            document.getElementById('oc-email-text').value = templateText;
            document.getElementById('oc-email-area').style.display = 'block';
        });

        document.getElementById('oc-btn-ai').addEventListener('click', async function () {
            var ctx = (document.getElementById('oc-context').value || '').trim();
            var AI = window.Mazelab && window.Mazelab.AIService;
            if (!AI || !AI.getConfig().apiKey) { alert('API Key no configurada.'); return; }
            this.disabled = true;
            this.textContent = 'Generando...';
            try {
                var histCtx = avisos.map(function (a) { return a.date + ': Aviso #' + a.num + (a.context ? ' (' + a.context + ')' : ''); }).join('\n');
                var prompt = 'Genera un mensaje profesional y cordial en español para solicitar una orden de compra o datos de facturación al cliente.\n' +
                    'Cliente: ' + (rec.clientName || '') + '\nEvento: ' + (rec.eventName || '') + '\nMonto neto: ' + formatCLP(monto) + '\nFecha evento: ' + (evDate || '') + '\n' +
                    'N\u00famero de aviso: ' + avisoNum + '\n' +
                    (histCtx ? 'Historial de avisos previos:\n' + histCtx + '\n' : '') +
                    (ctx ? 'Contexto adicional: ' + ctx + '\n' : '') +
                    'Genera texto plano sin markdown. Breve, directo, profesional.';
                var text = await AI.sendMessage(prompt, 'Solicita OC/factura al cliente.');
                document.getElementById('oc-email-text').value = text;
                document.getElementById('oc-email-area').style.display = 'block';
            } catch (err) {
                alert('Error: ' + err.message);
                document.getElementById('oc-email-text').value = templateText;
                document.getElementById('oc-email-area').style.display = 'block';
            } finally {
                this.disabled = false;
                this.textContent = 'Generar con IA';
            }
        });

        document.getElementById('oc-copy').addEventListener('click', function () {
            var t = document.getElementById('oc-email-text').value;
            if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () {
                document.getElementById('oc-copy').textContent = 'Copiado!';
                setTimeout(function () { document.getElementById('oc-copy').textContent = 'Copiar'; }, 2000);
            });
        });

        document.getElementById('oc-save').addEventListener('click', async function () {
            var ctx = (document.getElementById('oc-context').value || '').trim();
            var today = new Date().toISOString().split('T')[0];
            var newAviso = { date: today, num: avisoNum, context: ctx };
            var updated = avisos.concat([newAviso]);
            try {
                await window.Mazelab.DataService.update('receivables', rec.id, { avisos_factura: updated });
                var idx = allReceivables.findIndex(function (r2) { return r2.id === rec.id; });
                if (idx !== -1) allReceivables[idx].avisos_factura = updated;
                closeModal();
                refreshTable();
            } catch (err) { alert('Error: ' + err.message); }
        });
    }

    async function markAsPaid(id) {
        var rec = allReceivables.find(function (r) { return r.id === id; });
        if (!rec) return;

        if (!confirm('\u00bfMarcar como pagado total?\n\n' + (rec.clientName || '') + ' - ' + (rec.eventName || '') + '\n' + (rec.invoiceNumber || 'Sin factura'))) {
            return;
        }

        try {
            var totalIva = rec.tipoDoc === 'E' ? getMonto(rec) : (getMontoFacturado(rec) * 1.19);
            var pagado = getTotalPagado(rec);
            var restante = totalIva - pagado;

            if (restante > 0) {
                var payments = Array.isArray(rec.payments) ? rec.payments.slice() : [];
                payments.push({
                    id: Date.now().toString(),
                    amount: restante,
                    date: new Date().toISOString().split('T')[0]
                });
                await window.Mazelab.DataService.update('receivables', rec.id, {
                    payments: payments,
                    status: 'pagada'
                });
            } else {
                await window.Mazelab.DataService.update('receivables', rec.id, { status: 'pagada' });
            }

            await loadAndRender();
        } catch (err) {
            console.error('Error marking as paid:', err);
            alert('Error al marcar como pagado: ' + err.message);
        }
    }

    // =========================================================================
    // NOTA DE CRÉDITO
    // =========================================================================

    function openNCModal(id) {
        var rec = allReceivables.find(function (r) { return r.id === id; });
        if (!rec) return;
        var modalContainer = document.getElementById('finance-modal-container');
        if (!modalContainer) return;

        var montoFacturado = getMontoFacturado(rec);

        var html = '<div class="modal-overlay active" id="nc-modal-overlay">';
        html += '<div class="modal" style="max-width:500px;width:95%">';
        html += '<div class="modal-header"><h3>Registrar Nota de Cr\u00e9dito</h3><button class="modal-close" id="nc-close">&times;</button></div>';
        html += '<div style="background:var(--bg-tertiary);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;font-size:13px">';
        html += '<strong>' + escapeHtml(rec.clientName || '') + '</strong> — ' + escapeHtml(rec.eventName || '');
        html += '<br>Factura: <strong>' + (rec.invoiceNumber || '-') + '</strong> — Neto: ' + formatCLP(montoFacturado);
        html += '</div>';
        html += '<div class="form-group"><label>N\u00b0 Nota de Cr\u00e9dito</label><input type="text" id="nc-number" class="form-control" placeholder="Ej: 456"></div>';
        html += '<div class="form-group"><label>Monto Neto de la NC</label><input type="number" id="nc-amount" class="form-control" min="0" placeholder="Ej: 170000"></div>';
        html += '<div class="form-group"><label>Motivo</label><input type="text" id="nc-motivo" class="form-control" placeholder="Ej: Problema en servicio, descuento acordado..."></div>';
        html += '<div class="form-actions"><button class="btn btn-primary" id="nc-save">Registrar NC</button><button class="btn btn-secondary" id="nc-cancel">Cancelar</button></div>';
        html += '</div></div>';

        modalContainer.innerHTML = html;

        function closeModal() { modalContainer.innerHTML = ''; }
        document.getElementById('nc-close').addEventListener('click', closeModal);
        document.getElementById('nc-cancel').addEventListener('click', closeModal);
        document.getElementById('nc-modal-overlay').addEventListener('click', function (e) { if (e.target === this) closeModal(); });

        document.getElementById('nc-save').addEventListener('click', async function () {
            var ncNumber = (document.getElementById('nc-number').value || '').trim();
            var ncAmount = Number(document.getElementById('nc-amount').value) || 0;
            var ncMotivo = (document.getElementById('nc-motivo').value || '').trim();

            if (ncAmount <= 0) { alert('Ingresa el monto neto de la NC.'); return; }

            try {
                // Create NC record linked to original invoice
                await window.Mazelab.DataService.create('receivables', {
                    id: window.Mazelab.Storage.generateId(),
                    sourceId: rec.sourceId || '',
                    tipoDoc: 'NC',
                    invoiceNumber: ncNumber,
                    eventName: rec.eventName || '',
                    eventDate: rec.eventDate || '',
                    clientName: rec.clientName || '',
                    montoNeto: ncAmount,
                    invoicedAmount: ncAmount,
                    montoFacturado: ncAmount,
                    billingMonth: new Date().toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }),
                    status: 'nc',
                    saleId: rec.saleId || '',
                    ncAsociada: rec.invoiceNumber || '',
                    comments: ncMotivo
                });

                // Also update the sale's refundAmount if linked
                if (rec.saleId) {
                    var linkedSale = (cachedSales || []).find(function (s) { return String(s.id) === String(rec.saleId); });
                    if (linkedSale) {
                        var currentRefund = Number(linkedSale.refundAmount || 0);
                        await window.Mazelab.DataService.update('sales', linkedSale.id, {
                            refundAmount: currentRefund + ncAmount,
                            hasIssue: true
                        });
                    }
                }

                closeModal();
                await loadAndRender();
            } catch (err) {
                alert('Error al registrar NC: ' + err.message);
            }
        });
    }

    async function deleteReceivable(id) {
        var rec = allReceivables.find(function (r) { return r.id === id; });
        if (!rec) return;

        if (!confirm('\u00bfEliminar este registro?\n\n' + (rec.clientName || '') + ' - ' + (rec.eventName || '') + '\n' + (rec.invoiceNumber || 'Sin factura') + '\n\nEsta acci\u00f3n no se puede deshacer.')) {
            return;
        }

        try {
            await window.Mazelab.DataService.remove('receivables', rec.id);
            await loadAndRender();
        } catch (err) {
            console.error('Error deleting receivable:', err);
            alert('Error al eliminar: ' + err.message);
        }
    }

    // =========================================================================
    // INIT
    // =========================================================================

    function init() {
        showOnlyPending = true;
        visibleCount = 25;
        searchQuery = '';
        sortCol = null;
        sortDir = 'asc';
        currentView = 'lista';
        columnFilters = {};
        loadAndRender();
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================
    return { render: render, init: init, computeKPIs: computeKPIs };

})();
