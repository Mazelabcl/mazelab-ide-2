window.Mazelab = window.Mazelab || {};
window.Mazelab.Modules = window.Mazelab.Modules || {};

window.Mazelab.Modules.CashflowModule = (function () {

    // ---- helpers ----

    function formatCLP(n) {
        if (n == null || isNaN(n)) return '$0';
        var abs = Math.abs(Math.round(n));
        var s = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return (n < 0 ? '-$' : '$') + s;
    }

    function parseLocalDate(str) {
        if (!str) return null;
        var parts = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (parts) return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
        return new Date(str);
    }

    function addDays(dateStr, days) {
        if (!dateStr) return null;
        var d = parseLocalDate(dateStr);
        if (!d || isNaN(d)) return null;
        d.setDate(d.getDate() + days);
        return d;
    }

    function getMonthKey(date) {
        if (!date || isNaN(date)) return null;
        return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
    }

    function getMonthLabel(key) {
        if (!key) return '';
        var parts = key.split('-');
        var d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
        return d.toLocaleDateString('es-CL', { month: 'short', year: 'numeric' });
    }

    // Resuelve la fecha efectiva de pago/cobro de un registro.
    // Regla acordada:
    //   - Registros nuevos (plataforma): usar payments[0].date
    //   - Históricos importados: eventDate + 30 días
    function resolveDate(record) {
        if (record.payments && record.payments.length > 0 && record.payments[0].date) {
            var d = new Date(record.payments[0].date);
            if (!isNaN(d)) return d;
        }
        return addDays(record.eventDate || record.billingDate, 30);
    }

    // Para registros pendientes: fecha esperada de pago.
    // CXP: prefiere paymentDate (fecha_probable_pago_cxp), luego fallback.
    function resolveExpectedDate(record, type) {
        if (type === 'cxp' && record.paymentDate) {
            var d = new Date(record.paymentDate);
            if (!isNaN(d)) return d;
        }
        return addDays(record.billingDate || record.eventDate, 30);
    }

    // ---- ventana de 9 meses ----

    function buildMonthWindow() {
        var now = new Date();
        var months = [];
        for (var i = -3; i <= 5; i++) {
            var d = new Date(now.getFullYear(), now.getMonth() + i, 1);
            var key = getMonthKey(d);
            months.push({
                key: key,
                label: getMonthLabel(key),
                isPast: i < 0,
                isCurrent: i === 0
            });
        }
        return months;
    }

    // ---- construir datos de cashflow ----

    function buildCashflow(receivables, payables) {
        var months = buildMonthWindow();
        var data = {};
        months.forEach(function (m) {
            data[m.key] = { entradas: 0, salidas: 0 };
        });

        // CXC → entradas
        receivables.forEach(function (r) {
            var tipo = (r.tipoDoc || '').toUpperCase();
            var st = (r.status || '').toLowerCase();
            if (tipo === 'NC' || st === 'anulada') return;
            var neto = Number(r.montoNeto || r.invoicedAmount || 0);
            var total = (tipo === 'E') ? neto : neto * 1.19;
            if (total <= 0) return;
            var isPaid = st === 'pagada';
            var date = isPaid ? resolveDate(r) : resolveExpectedDate(r, 'cxc');
            var key = date ? getMonthKey(date) : null;
            if (key && data[key]) data[key].entradas += total;
        });

        // CXP → salidas
        payables.forEach(function (p) {
            var amt = Number(p.amount || 0);
            if (amt <= 0) return;
            var isPaid = (p.status || '').toLowerCase() === 'pagada';
            var date = isPaid ? resolveDate(p) : resolveExpectedDate(p, 'cxp');
            var key = date ? getMonthKey(date) : null;
            if (key && data[key]) data[key].salidas += amt;
        });

        return { months: months, data: data };
    }

    // ---- render ----

    function render() {
        return '<div class="content-header">' +
            '<h2>Flujo de Caja</h2>' +
            '<p style="font-size:13px;color:var(--text-secondary);margin:0">Proyecci&oacute;n de entradas y salidas &mdash; 3 meses pasados + actual + 5 futuros</p>' +
            '</div>' +
            '<div class="content-body" id="cashflow-content">' +
            '<div class="empty-state"><p>Cargando flujo de caja...</p></div>' +
            '</div>';
    }

    async function init() {
        try {
            var DS = window.Mazelab.DataService;
            var results = await Promise.all([DS.getAll('receivables'), DS.getAll('payables')]);
            var receivables = results[0] || [];
            var payables = results[1] || [];

            var cf = buildCashflow(receivables, payables);

            // ---- gráfico de barras ----
            var maxVal = 1;
            cf.months.forEach(function (m) {
                var d = cf.data[m.key];
                if (d.entradas > maxVal) maxVal = d.entradas;
                if (d.salidas > maxVal) maxVal = d.salidas;
            });

            var bars = cf.months.map(function (m) {
                var d = cf.data[m.key];
                var entPct = Math.round((d.entradas / maxVal) * 100);
                var salPct = Math.round((d.salidas / maxVal) * 100);
                var opacity = m.isPast ? '0.55' : '1';
                var accentLabel = m.isCurrent ? 'color:var(--accent);font-weight:600' : 'color:var(--text-secondary)';
                return '<div style="display:flex;flex-direction:column;align-items:center;flex:1;gap:4px' + (m.isCurrent ? ';border-bottom:3px solid var(--accent);padding-bottom:4px' : '') + '">' +
                    '<div style="font-size:10px;text-align:center;min-height:30px;display:flex;flex-direction:column;gap:1px;justify-content:flex-end">' +
                    (d.entradas > 0 ? '<span style="color:var(--success);font-weight:500">' + formatCLP(d.entradas) + '</span>' : '<span>&nbsp;</span>') +
                    (d.salidas > 0 ? '<span style="color:var(--danger)">' + formatCLP(d.salidas) + '</span>' : '<span>&nbsp;</span>') +
                    '</div>' +
                    '<div style="width:100%;height:100px;display:flex;align-items:flex-end;gap:2px;justify-content:center">' +
                    '<div style="width:42%;min-height:2px;height:' + entPct + '%;background:var(--success);border-radius:3px 3px 0 0;opacity:' + opacity + '"></div>' +
                    '<div style="width:42%;min-height:2px;height:' + salPct + '%;background:var(--danger);border-radius:3px 3px 0 0;opacity:' + opacity + '"></div>' +
                    '</div>' +
                    '<span style="font-size:10px;' + accentLabel + ';text-align:center;white-space:nowrap">' + m.label + '</span>' +
                    '</div>';
            }).join('');

            var chartHTML = '<div class="card" style="margin-bottom:var(--space-md)">' +
                '<div class="card-header">' +
                '<span class="card-title">Entradas vs Salidas</span>' +
                '<div style="font-size:11px;color:var(--text-muted);display:flex;gap:12px">' +
                '<span><span style="color:var(--success);font-weight:700">&#9646;</span> Entradas (CXC)</span>' +
                '<span><span style="color:var(--danger);font-weight:700">&#9646;</span> Salidas (CXP)</span>' +
                '</div></div>' +
                '<div style="display:flex;gap:6px;align-items:flex-end;padding:var(--space-sm) 0">' + bars + '</div>' +
                '</div>';

            // ---- tabla resumen ----
            var saldo = 0;
            var tableRows = cf.months.map(function (m) {
                var d = cf.data[m.key];
                var neto = d.entradas - d.salidas;
                saldo += neto;
                var netoClass = neto > 0 ? 'text-success' : neto < 0 ? 'text-danger' : '';
                var saldoClass = saldo >= 0 ? 'text-success' : 'text-danger';
                var rowBg = m.isCurrent ? 'background:var(--bg-tertiary)' : '';
                var monthCell = m.label + (m.isCurrent
                    ? ' <span class="badge badge-info" style="font-size:10px;padding:1px 5px">Hoy</span>'
                    : '');
                return '<tr style="' + rowBg + '">' +
                    '<td style="white-space:nowrap">' + monthCell + '</td>' +
                    '<td class="text-right text-success">' + (d.entradas > 0 ? formatCLP(d.entradas) : '<span style="color:var(--text-muted)">-</span>') + '</td>' +
                    '<td class="text-right text-danger">' + (d.salidas > 0 ? formatCLP(d.salidas) : '<span style="color:var(--text-muted)">-</span>') + '</td>' +
                    '<td class="text-right ' + netoClass + '" style="font-weight:500">' + (neto !== 0 ? formatCLP(neto) : '<span style="color:var(--text-muted)">-</span>') + '</td>' +
                    '<td class="text-right ' + saldoClass + '"><strong>' + formatCLP(saldo) + '</strong></td>' +
                    '</tr>';
            }).join('');

            var tableHTML = '<div class="card" style="margin-bottom:var(--space-sm)">' +
                '<div class="card-header"><span class="card-title">Detalle mensual</span></div>' +
                '<table class="data-table">' +
                '<thead><tr>' +
                '<th>Mes</th>' +
                '<th class="text-right" style="color:var(--success)">Entradas</th>' +
                '<th class="text-right" style="color:var(--danger)">Salidas</th>' +
                '<th class="text-right">Neto del mes</th>' +
                '<th class="text-right">Saldo acumulado</th>' +
                '</tr></thead>' +
                '<tbody>' + tableRows + '</tbody>' +
                '</table></div>';

            var noteHTML = '<div style="font-size:11px;color:var(--text-muted);padding:var(--space-xs) 0">' +
                '* Fecha de pago: registros nuevos usan la fecha registrada en el sistema; datos importados se estiman como fecha del evento + 30 d&iacute;as. ' +
                'Registros pendientes se proyectan en su mes esperado.' +
                '</div>';

            var container = document.getElementById('cashflow-content');
            if (container) container.innerHTML = chartHTML + tableHTML + noteHTML;

        } catch (err) {
            console.error('CashflowModule error:', err);
            var c = document.getElementById('cashflow-content');
            if (c) c.innerHTML = '<div class="empty-state"><p class="text-danger">Error al cargar flujo de caja.</p></div>';
        }
    }

    return { render: render, init: init };

})();
