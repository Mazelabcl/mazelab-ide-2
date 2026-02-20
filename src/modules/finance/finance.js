window.Mazelab.Modules.FinanceModule = (function () {

    // =========================================================================
    // STATE
    // =========================================================================
    let allReceivables = [];
    let filteredList = [];
    let showOnlyPending = true;
    let visibleCount = 25;
    let searchQuery = '';

    // =========================================================================
    // HELPER FUNCTIONS
    // =========================================================================

    function getMonto(r) {
        // Precedencia: montoNeto (nativo) → invoicedAmount (CSV import) → monto_venta (auto-CXC sin factura) → amount (legacy)
        return Number(r.montoNeto || r.invoicedAmount || r.monto_venta || r.amount) || 0;
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
        return Math.max(0, neto - pagado);
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
        // Fallback: fecha del evento
        if (r.eventDate) return new Date(r.eventDate);
        return null;
    }

    function getRealTimeStatus(r) {
        // 1. NC
        if (r.tipoDoc === 'NC') return 'nc';
        // 2. Anulada
        if (r.status === 'anulada') return 'anulada';
        // 3. Pagada
        if (r.status === 'pagado' || r.status === 'pagada') return 'pagada';
        // 4. Pendiente factura by status
        if (r.status === 'pendiente_factura') return 'pendiente_factura';
        // 5. montoFacturado <= 0
        if (getMontoFacturado(r) <= 0) return 'pendiente_factura';
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
                // paymentTerms: días de plazo desde emisión de factura (default 30).
                // Para sin_factura, baseDate = eventDate, paymentTerms aplica igual.
                var paymentTerms = Number(r.paymentTerms) || 30;
                var daysOverdue = diffDays - paymentTerms;
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

    function formatCLP(amount) {
        var n = Math.round(Number(amount) || 0);
        var negative = n < 0;
        if (negative) n = -n;
        var str = n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return (negative ? '-$' : '$') + str;
    }

    function formatDate(dateStr) {
        if (!dateStr) return '-';
        try {
            var d = new Date(dateStr);
            if (isNaN(d.getTime())) return dateStr;
            var dd = String(d.getDate()).padStart(2, '0');
            var mm = String(d.getMonth() + 1).padStart(2, '0');
            var yyyy = d.getFullYear();
            return dd + '/' + mm + '/' + yyyy;
        } catch (e) {
            return dateStr;
        }
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

    function getStatusBadge(status) {
        var map = {
            'pagada': '<span class="badge badge-success">Pagada</span>',
            'pendiente': '<span class="badge badge-warning">Pendiente</span>',
            'pendiente_pago': '<span class="badge badge-warning">Pendiente</span>',
            'pendiente_factura': '<span class="badge badge-info">Sin Factura</span>',
            'vencida_30': '<span class="badge badge-warning">Vencida 30+</span>',
            'vencida_60': '<span class="badge badge-danger">Vencida 60+</span>',
            'vencida_90': '<span class="badge badge-danger">Vencida 90+</span>',
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

            // sinFactura
            if (realStatus === 'pendiente_factura' && r.tipoDoc !== 'NC') {
                sinFactura.push(r);
            }

            // facturadoPendientes
            if (
                realStatus !== 'pendiente_factura' &&
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
            facturadoVencido90: facturadoVencido90
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
        var pagadoMes = 0;
        var porVencerMes = 0;

        receivables.forEach(function (r) {
            if (r.tipoDoc === 'NC') return;
            if (matchesBillingMonth(r.billingMonth, currentMonthKey)) {
                facturadoMes += getMontoFacturado(r);
            }
        });

        var ivaMes = facturadoMes * 0.19;

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

        var totalPorCobrar = (totalSinFacturaNeto * 1.19) + totalFacturadoPend;

        var totalSinFacturaMio = 0;
        data.sinFactura.forEach(function (r) { totalSinFacturaMio += getPendienteMio(r); });

        var totalFacturadoMio = 0;
        data.facturadoPendientes.forEach(function (r) { totalFacturadoMio += getPendienteMio(r); });

        var totalLoQueEsMio = totalSinFacturaMio + totalFacturadoMio;

        return {
            data: data,
            facturadoMes: facturadoMes,
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
        html += '  <div class="kpi-value">' + formatCLP(kpis.facturadoMes) + '</div>';
        html += '  <div class="kpi-sub">Neto facturado del mes</div>';
        html += '</div>';
        html += '<div class="kpi-card">';
        html += '  <div class="kpi-label">IVA del Mes</div>';
        html += '  <div class="kpi-value">' + formatCLP(kpis.ivaMes) + '</div>';
        html += '  <div class="kpi-sub">19% del facturado</div>';
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
        html += '<div class="kpi-card warning">';
        html += '  <div class="kpi-label">Sin Factura</div>';
        html += '  <div class="kpi-value">' + kpis.data.sinFactura.length + '</div>';
        html += '  <div class="kpi-sub">' + formatCLP(kpis.totalSinFacturaNeto) + ' neto</div>';
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

    function renderTable(receivables) {
        var list = filterReceivables(receivables);
        filteredList = list;

        var showing = list.slice(0, visibleCount);
        var hasMore = list.length > visibleCount;

        var html = '';
        html += '<div class="card">';
        html += '<div class="toolbar">';
        html += '  <input type="text" class="search-bar" id="finance-search" placeholder="Buscar cliente, evento, factura..." value="' + (searchQuery || '') + '">';
        html += '  <button class="btn-secondary btn-sm" id="finance-toggle-pending">';
        html += showOnlyPending ? 'Ver Todo' : 'Solo Pendientes';
        html += '  </button>';
        html += '</div>';

        html += '<table class="data-table">';
        html += '<thead><tr>';
        html += '  <th>Cliente / Evento</th>';
        html += '  <th>N\u00b0Factura</th>';
        html += '  <th>Neto</th>';
        html += '  <th>Total+IVA</th>';
        html += '  <th>Pagado</th>';
        html += '  <th>Restante</th>';
        html += '  <th>Vencimiento</th>';
        html += '  <th>Estado</th>';
        html += '  <th>Acciones</th>';
        html += '</tr></thead>';
        html += '<tbody>';

        showing.forEach(function (r) {
            var realStatus = r._realStatus || getRealTimeStatus(r);
            var neto = getMonto(r);
            var totalIva = r.tipoDoc === 'E' ? neto : (getMontoFacturado(r) * 1.19);
            var pagado = getTotalPagado(r);
            var restante = totalIva - pagado;

            html += '<tr>';
            html += '  <td>';
            html += '    <strong>' + (r.clientName || 'Sin cliente') + '</strong>';
            html += '    <br><small>' + (r.eventName || '-') + '</small>';
            html += '  </td>';
            html += '  <td>' + (r.invoiceNumber || '-') + '</td>';
            html += '  <td>' + formatCLP(neto) + '</td>';
            html += '  <td>' + formatCLP(totalIva) + '</td>';
            html += '  <td>' + formatCLP(pagado) + '</td>';
            html += '  <td>' + formatCLP(restante) + '</td>';
            html += '  <td>' + formatDate(r.eventDate) + '</td>';
            html += '  <td>' + getStatusBadge(realStatus) + '</td>';
            html += '  <td>';
            if (realStatus === 'pendiente_factura') {
                html += '    <button class="btn btn-secondary btn-sm btn-facturar" data-id="' + r.id + '" style="margin-right:4px">Facturar</button>';
            }
            if (realStatus !== 'pagada' && realStatus !== 'anulada' && realStatus !== 'nc') {
                html += '    <button class="btn-primary btn-sm btn-icon btn-abono" data-id="' + r.id + '" title="Agregar abono">+Abono</button> ';
                html += '    <button class="btn-secondary btn-sm btn-icon btn-pagado-total" data-id="' + r.id + '" title="Marcar pagado total">Pagado Total</button> ';
            }
            html += '    <button class="btn-sm btn-icon btn-eliminar" data-id="' + r.id + '" title="Eliminar" style="color:var(--danger,#e74c3c);">Eliminar</button>';
            html += '  </td>';
            html += '</tr>';
        });

        html += '</tbody></table>';

        if (hasMore) {
            html += '<div style="text-align:center;padding:16px;">';
            html += '  <button class="btn-secondary" id="finance-load-more">Ver m\u00e1s (' + (list.length - visibleCount) + ' restantes)</button>';
            html += '</div>';
        }

        html += '<div style="padding:8px 16px;color:var(--text-secondary,#888);font-size:0.85rem;">';
        html += 'Mostrando ' + showing.length + ' de ' + list.length + ' registros';
        html += '</div>';
        html += '</div>';

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
                var searchable = [
                    r.clientName || '',
                    r.eventName || '',
                    r.invoiceNumber || '',
                    r.tipoDoc || '',
                    r.billingMonth || ''
                ].join(' ').toLowerCase();
                return searchable.includes(q);
            });
        }

        // Sort: pending/overdue first, then by eventDate descending
        list.sort(function (a, b) {
            var priorityMap = {
                'vencida_90': 0,
                'vencida_60': 1,
                'vencida_30': 2,
                'pendiente': 3,
                'pendiente_pago': 3,
                'pendiente_factura': 4,
                'por_vencer': 5,
                'pagada': 6,
                'anulada': 7,
                'nc': 8
            };
            var pa = priorityMap[a._realStatus] !== undefined ? priorityMap[a._realStatus] : 5;
            var pb = priorityMap[b._realStatus] !== undefined ? priorityMap[b._realStatus] : 5;
            if (pa !== pb) return pa - pb;
            // Sort by eventDate descending
            var da = a.eventDate ? new Date(a.eventDate).getTime() : 0;
            var db = b.eventDate ? new Date(b.eventDate).getTime() : 0;
            return db - da;
        });

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
            allReceivables = await window.Mazelab.DataService.getAll('receivables');
            if (!Array.isArray(allReceivables)) allReceivables = [];

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

        // Toggle pending
        var toggleBtn = document.getElementById('finance-toggle-pending');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', function () {
                showOnlyPending = !showOnlyPending;
                visibleCount = 25;
                refreshTable();
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

        // Facturar buttons (sin_factura records)
        document.querySelectorAll('.btn-facturar').forEach(function (btn) {
            btn.addEventListener('click', function () {
                openFacturarModal(this.dataset.id);
            });
        });

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

        // Eliminar buttons
        document.querySelectorAll('.btn-eliminar').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var id = this.dataset.id;
                deleteReceivable(id);
            });
        });
    }

    function refreshTable() {
        // Re-render just the table portion while preserving KPIs
        var container = document.getElementById('finance-content');
        if (!container) return;

        // Capture focus before re-render (search input gets destroyed)
        var searchHadFocus = document.activeElement && document.activeElement.id === 'finance-search';

        // Rebuild the table card only
        var kpis = computeKPIs(allReceivables);
        container.innerHTML = renderKPIs(kpis) + renderTable(allReceivables);
        attachTableListeners();

        // Restore focus and cursor position to search input
        if (searchHadFocus || searchQuery) {
            var newInput = document.getElementById('finance-search');
            if (newInput && searchHadFocus) {
                newInput.focus();
                newInput.setSelectionRange(newInput.value.length, newInput.value.length);
            }
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
        var refAmount = rec.monto_venta || rec.amount || 0;

        var html = '';
        html += '<div class="modal-overlay active" id="facturar-modal-overlay">';
        html += '<div class="modal">';
        html += '  <div class="modal-header">';
        html += '    <h3>Registrar Factura</h3>';
        html += '    <button class="modal-close" id="fac-close-x">&times;</button>';
        html += '  </div>';
        html += '  <p style="color:var(--text-secondary);font-size:13px;margin-bottom:16px;">';
        html += '    <strong>' + (rec.clientName || '') + '</strong> — ' + (rec.eventName || '') + '</p>';
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
        html += '      <label>Monto Neto Facturado (sin IVA)</label>';
        html += '      <input type="number" class="form-control" id="fac-amount" value="' + refAmount + '" placeholder="Ej: 4500000">';
        html += '    </div>';
        html += '    <div class="form-group">';
        html += '      <label>Cond. de Pago (d\u00edas)</label>';
        html += '      <input type="number" class="form-control" id="fac-terms" value="30" min="1" step="1" placeholder="30">';
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
        document.getElementById('fac-amount').addEventListener('input', function () {
            var neto = Number(this.value) || 0;
            document.getElementById('fac-iva-preview').textContent = formatCLP(neto * 0.19);
            document.getElementById('fac-total-preview').textContent = formatCLP(neto * 1.19);
        });

        document.getElementById('fac-save-btn').addEventListener('click', async function () {
            var invoiceNumber = document.getElementById('fac-number').value.trim();
            var billingMonth = document.getElementById('fac-date').value.trim();
            var invoicedAmount = Number(document.getElementById('fac-amount').value) || 0;
            var paymentTerms = Number(document.getElementById('fac-terms').value) || 30;

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
                await window.Mazelab.DataService.update('receivables', rec.id, {
                    invoiceNumber: invoiceNumber,
                    billingMonth: billingMonth,
                    invoicedAmount: invoicedAmount,
                    paymentTerms: paymentTerms,
                    status: 'pendiente_pago'
                });
                closeModal();
                await loadAndRender();
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
        loadAndRender();
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================
    return { render: render, init: init };

})();
