window.Mazelab.Modules.PagosModule = (function () {

    // ── State ──────────────────────────────────────────────────────────
    var payables    = [];
    var cachedSales = [];
    var searchQuery = '';
    var sortCol     = 'payDate';
    var sortDir     = 'desc';
    var colFilters  = {}; // { colKey: 'filterText' }

    // ── Helpers ────────────────────────────────────────────────────────

    function formatCLP(n) {
        if (n == null || isNaN(n)) return '$0';
        var num = Math.round(Number(n));
        var str = Math.abs(num).toString();
        var parts = [];
        for (var i = str.length; i > 0; i -= 3) {
            parts.unshift(str.substring(Math.max(0, i - 3), i));
        }
        return (num < 0 ? '-' : '') + '$' + parts.join('.');
    }

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function docTypeLabel(t) {
        var s = (t || '').toLowerCase().trim();
        return ({ bh: 'BH', factura: 'Factura', exenta: 'F. Exenta', invoice: 'Invoice', ninguno: '-' }[s]) || t || '-';
    }

    // ── Ledger builder ─────────────────────────────────────────────────

    function buildLedger() {
        var ledger = [];
        payables.forEach(function (p) {
            if (!p.payments || !p.payments.length) return;
            var linkedSale = p.eventId
                ? cachedSales.find(function (s) { return String(s.id) === String(p.eventId); })
                : null;
            var sourceId = linkedSale ? String(linkedSale.sourceId || '') : '';
            p.payments.forEach(function (pay, idx) {
                ledger.push({
                    payableId:  p.id,
                    paymentId:  pay.id || '',
                    paymentIdx: idx,
                    payDate:    pay.date || '',
                    amount:     Number(pay.amount) || 0,
                    method:     pay.method || '-',
                    comment:    pay.comment || '',
                    vendorName: p.vendorName || '-',
                    eventName:  p.eventName || '-',
                    clientName: p.clientName || '-',
                    concept:    p.concept || '-',
                    docType:    p.docType || '-',
                    docNumber:  p.docNumber || '',
                    sourceId:   sourceId
                });
            });
        });
        return ledger;
    }

    // ── Filter + sort ──────────────────────────────────────────────────

    function getFilteredLedger() {
        var ledger = buildLedger();

        // Global search
        var q = searchQuery.toLowerCase();
        if (q) {
            ledger = ledger.filter(function (r) {
                return [r.vendorName, r.clientName, r.eventName, r.concept,
                        r.method, r.sourceId, r.docNumber, r.comment]
                    .join(' ').toLowerCase().includes(q);
            });
        }

        // Per-column filters
        var activeCols = Object.keys(colFilters).filter(function (k) { return colFilters[k]; });
        if (activeCols.length) {
            ledger = ledger.filter(function (r) {
                return activeCols.every(function (col) {
                    var fv  = (colFilters[col] || '').toLowerCase();
                    var val = String(r[col] || '').toLowerCase();
                    return val.includes(fv);
                });
            });
        }

        // Sort
        if (sortCol) {
            ledger.sort(function (a, b) {
                var av = String(a[sortCol] || '');
                var bv = String(b[sortCol] || '');
                // numeric sort for amount
                if (sortCol === 'amount') { av = Number(a.amount); bv = Number(b.amount); }
                var cmp = (av < bv) ? -1 : (av > bv) ? 1 : 0;
                return sortDir === 'asc' ? cmp : -cmp;
            });
        }

        return ledger;
    }

    // ── Render helpers ─────────────────────────────────────────────────

    var COL_FILTER_STYLE = 'width:100%;font-size:11px;padding:2px 4px;border:1px solid var(--border);border-radius:3px;background:var(--bg-secondary);color:var(--text-primary);box-sizing:border-box';

    function filterInput(col, placeholder) {
        var fv = colFilters[col] || '';
        return '<input class="pagos-col-filter" data-col="' + col + '" type="text" value="' + escapeHtml(fv) + '" placeholder="' + placeholder + '" style="' + COL_FILTER_STYLE + '">';
    }

    function sortIcon(col) {
        if (sortCol !== col) return ' <span style="opacity:0.3">&#8597;</span>';
        return sortDir === 'asc' ? ' <span>&#8593;</span>' : ' <span>&#8595;</span>';
    }

    function sortTh(label, col, extra) {
        var st = extra || '';
        return '<th style="cursor:pointer;white-space:nowrap;' + st + '" class="pagos-sort-th" data-col="' + col + '">' + label + sortIcon(col) + '</th>';
    }

    // ── Render table ───────────────────────────────────────────────────

    function renderTable() {
        var ledger = getFilteredLedger();

        if (!ledger.length) {
            return '<div class="empty-state"><div class="empty-icon">&#128179;</div>' +
                '<p>No hay pagos registrados' + (searchQuery || Object.keys(colFilters).some(function(k){return colFilters[k];}) ? ' que coincidan con el filtro.' : ' a\u00fan.') + '</p></div>';
        }

        var totalPaid = ledger.reduce(function (s, r) { return s + r.amount; }, 0);

        var rows = ledger.map(function (r) {
            var docStr = docTypeLabel(r.docType) + (r.docNumber ? ' #' + r.docNumber : '');
            var idCell = r.sourceId
                ? '<span style="font-size:12px;font-weight:600">' + escapeHtml(r.sourceId) + '</span>'
                : '<span style="font-size:10px;color:var(--text-muted)">-</span>';
            return '<tr>' +
                '<td style="white-space:nowrap;font-weight:600">' + (r.payDate || '-') + '</td>' +
                '<td style="white-space:nowrap">' + idCell + '</td>' +
                '<td>' + escapeHtml(r.vendorName) + '</td>' +
                '<td style="font-size:12px">' + escapeHtml(r.clientName) + '</td>' +
                '<td>' + escapeHtml(r.eventName) + '</td>' +
                '<td>' + escapeHtml(r.concept) + '</td>' +
                '<td>' + docStr + '</td>' +
                '<td style="font-size:12px;color:var(--text-muted)">' + escapeHtml(r.method) + '</td>' +
                '<td class="text-right" style="font-weight:600;color:var(--success)">' + formatCLP(r.amount) + '</td>' +
                '<td style="font-size:11px;color:var(--text-muted)">' + (r.comment ? escapeHtml(r.comment) : '-') + '</td>' +
                '<td><button class="btn-icon pagos-del-payment" ' +
                    'data-payable="' + escapeHtml(r.payableId) + '" ' +
                    'data-pid="' + escapeHtml(r.paymentId) + '" ' +
                    'data-idx="' + r.paymentIdx + '" ' +
                    'title="Eliminar pago">&#128465;</button></td>' +
                '</tr>';
        }).join('');

        var filterRow = '<tr style="background:var(--bg-tertiary)">' +
            '<th></th>' +
            '<th style="padding:2px 4px">' + filterInput('sourceId', 'ID...') + '</th>' +
            '<th style="padding:2px 4px">' + filterInput('vendorName', 'Proveedor...') + '</th>' +
            '<th style="padding:2px 4px">' + filterInput('clientName', 'Cliente...') + '</th>' +
            '<th style="padding:2px 4px">' + filterInput('eventName', 'Evento...') + '</th>' +
            '<th style="padding:2px 4px">' + filterInput('concept', 'Concepto...') + '</th>' +
            '<th></th>' +
            '<th style="padding:2px 4px">' + filterInput('method', 'M\u00e9todo...') + '</th>' +
            '<th></th><th></th><th></th>' +
            '</tr>';

        return '<div style="padding:8px 0 12px;display:flex;justify-content:flex-end;gap:16px;font-size:13px;color:var(--text-muted)">' +
            ledger.length + ' pagos &middot; Total transferido: <strong style="color:var(--text-primary)">' + formatCLP(totalPaid) + '</strong>' +
            '</div>' +
            '<table class="data-table" id="pagos-table">' +
            '<thead><tr>' +
            sortTh('Fecha', 'payDate') +
            '<th style="font-size:11px;color:var(--text-muted)">ID Evento</th>' +
            sortTh('Proveedor', 'vendorName') +
            sortTh('Cliente', 'clientName', 'font-size:12px') +
            sortTh('Evento', 'eventName') +
            sortTh('Concepto', 'concept') +
            '<th>Documento</th>' +
            sortTh('M\u00e9todo', 'method') +
            sortTh('Monto', 'amount', 'text-align:right') +
            '<th>Glosa</th><th></th>' +
            '</tr>' + filterRow + '</thead><tbody>' + rows + '</tbody></table>';
    }

    // ── refresh ────────────────────────────────────────────────────────

    function refreshView() {
        var el = document.getElementById('pagos-content');
        if (el) el.innerHTML = renderTable();
        bindActions();
    }

    // ── Load data ──────────────────────────────────────────────────────

    async function loadData() {
        var results = await Promise.all([
            window.Mazelab.DataService.getAll('payables'),
            window.Mazelab.DataService.getAll('sales')
        ]);
        payables    = Array.isArray(results[0]) ? results[0] : [];
        cachedSales = Array.isArray(results[1]) ? results[1] : [];
    }

    // ── Delete payment ─────────────────────────────────────────────────

    async function deletePayment(payableId, paymentIdx) {
        var p = payables.find(function (x) { return String(x.id) === String(payableId); });
        if (!p || !p.payments) return;
        var updated = p.payments.filter(function (_, i) { return i !== paymentIdx; });
        try {
            await window.Mazelab.DataService.update('payables', payableId, { payments: updated });
            await loadData();
            refreshView();
        } catch (err) { console.error('PagosModule: deletePayment error', err); }
    }

    // ── Bind actions ───────────────────────────────────────────────────

    function bindActions() {
        // Sort headers
        document.querySelectorAll('#pagos-table .pagos-sort-th').forEach(function (th) {
            if (th._bound) return;
            th._bound = true;
            th.addEventListener('click', function () {
                var col = this.dataset.col;
                if (sortCol === col) { sortDir = sortDir === 'asc' ? 'desc' : 'asc'; }
                else { sortCol = col; sortDir = 'asc'; }
                refreshView();
            });
        });

        // Column filter inputs — restore focus after re-render
        document.querySelectorAll('#pagos-table .pagos-col-filter').forEach(function (input) {
            if (input._bound) return;
            input._bound = true;
            input.addEventListener('input', function () {
                var col    = this.dataset.col;
                var val    = this.value;
                var cursor = this.selectionStart;
                colFilters[col] = val;
                refreshView();
                setTimeout(function () {
                    var el = document.querySelector('#pagos-table .pagos-col-filter[data-col="' + col + '"]');
                    if (el) { el.focus(); try { el.setSelectionRange(cursor, cursor); } catch (e) {} }
                }, 0);
            });
        });

        // Global search
        var searchEl = document.getElementById('pagos-search');
        if (searchEl && !searchEl._bound) {
            searchEl._bound = true;
            searchEl.addEventListener('input', function () {
                searchQuery = this.value.trim();
                refreshView();
            });
        }

        // Clear filters
        var clearBtn = document.getElementById('pagos-clear-filters');
        if (clearBtn && !clearBtn._bound) {
            clearBtn._bound = true;
            clearBtn.addEventListener('click', function () {
                searchQuery = '';
                colFilters  = {};
                var s = document.getElementById('pagos-search');
                if (s) s.value = '';
                refreshView();
            });
        }

        // Delete payment buttons
        document.querySelectorAll('.pagos-del-payment').forEach(function (btn) {
            if (btn._bound) return;
            btn._bound = true;
            btn.addEventListener('click', function () {
                if (!confirm('\u00bfEliminar este pago? Esta acci\u00f3n no se puede deshacer.')) return;
                deletePayment(btn.dataset.payable, Number(btn.dataset.idx));
            });
        });
    }

    // ── Public API ─────────────────────────────────────────────────────

    function render() {
        return [
            '<div class="module-container">',
            '  <div class="module-header">',
            '    <h2>&#128179; Pagos</h2>',
            '    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">',
            '      <input id="pagos-search" type="text" placeholder="Buscar..." class="search-input" style="width:200px" value="' + escapeHtml(searchQuery) + '">',
            '      <button id="pagos-clear-filters" class="btn btn-secondary btn-sm">Limpiar filtros</button>',
            '    </div>',
            '  </div>',
            '  <div id="pagos-content"><div class="empty-state"><p>Cargando...</p></div></div>',
            '</div>'
        ].join('\n');
    }

    async function init() {
        // Reset state on each navigation
        searchQuery = '';
        colFilters  = {};
        sortCol     = 'payDate';
        sortDir     = 'desc';

        await loadData();
        refreshView();
    }

    return { render: render, init: init };

})();
