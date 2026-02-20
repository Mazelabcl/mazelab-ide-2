window.Mazelab.Modules.PayablesModule = (function () {
    // ── State ──────────────────────────────────────────────────────────
    let payables = [];
    let staffList = [];
    let currentView = 'lista'; // 'lista' | 'agrupada'
    let editingId = null;

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

    function daysSince(dateStr) {
        if (!dateStr) return 0;
        var d = new Date(dateStr);
        var now = new Date();
        return Math.floor((now - d) / (1000 * 60 * 60 * 24));
    }

    function getBHRetention(dateStr) {
        if (!dateStr) return 0.1525;
        var year = new Date(dateStr).getFullYear();
        if (year <= 2024) return 0.145;
        return 0.1525; // 2025-2026+
    }

    function docTypeLabel(t) {
        var map = { bh: 'BH', factura: 'Factura', invoice: 'Invoice', ninguno: 'Ninguno' };
        return map[t] || t || '-';
    }

    // Returns the first Friday on or after (eventDate + 30 days)
    function calcDueDate(dateStr) {
        if (!dateStr) return null;
        var d = new Date(dateStr);
        if (isNaN(d.getTime())) return null;
        d.setDate(d.getDate() + 30);
        var dow = d.getDay(); // 0=Dom … 5=Vie … 6=Sab
        if (dow !== 5) d.setDate(d.getDate() + ((5 - dow + 7) % 7));
        return d;
    }

    function formatDateShort(d) {
        if (!d) return '-';
        return d.getDate().toString().padStart(2, '0') + '/' +
               (d.getMonth() + 1).toString().padStart(2, '0') + '/' +
               d.getFullYear();
    }

    // Returns due-date info for a payable record
    function getDueDateInfo(p) {
        if (p.status === 'pagada') return { status: 'pagada', label: '-', rowStyle: '', cellStyle: '' };
        var dateStr = p.eventEndDate || p.eventDate;
        var dueDate = calcDueDate(dateStr);
        if (!dueDate) return { status: 'sin_fecha', dueDate: null, label: 'Sin fecha evento', rowStyle: '', cellStyle: 'color:var(--text-muted)' };

        var today = new Date(); today.setHours(0, 0, 0, 0);
        var diffDays = Math.floor((dueDate - today) / 86400000);
        var label = formatDateShort(dueDate);

        if (diffDays < 0) {
            return { status: 'vencido', dueDate: dueDate, diffDays: diffDays,
                label: label + ' · VENCIDO',
                rowStyle: 'background:rgba(239,68,68,0.07)',
                cellStyle: 'color:var(--danger);font-weight:600' };
        }
        if (diffDays === 0) {
            return { status: 'hoy', dueDate: dueDate, diffDays: 0,
                label: label + ' · HOY',
                rowStyle: 'background:rgba(239,68,68,0.07)',
                cellStyle: 'color:var(--danger);font-weight:700' };
        }
        if (diffDays <= 7) {
            return { status: 'proximo', dueDate: dueDate, diffDays: diffDays,
                label: label + ' · ' + diffDays + 'd',
                rowStyle: 'background:rgba(245,158,11,0.06)',
                cellStyle: 'color:var(--warning);font-weight:600' };
        }
        return { status: 'pendiente', dueDate: dueDate, diffDays: diffDays,
            label: label,
            rowStyle: '', cellStyle: 'color:var(--text-secondary)' };
    }

    function getVendors() {
        return staffList.filter(function (s) {
            var t = (s.type || s.tipo || '').toLowerCase();
            return t.indexOf('proveedor') !== -1 || t.indexOf('freelancer') !== -1;
        });
    }

    // ── KPIs ───────────────────────────────────────────────────────────
    function computeKPIs() {
        var totalPendiente = 0;
        var vencidoCount = 0, vencidoSum = 0;
        var proximoCount = 0, proximoSum = 0;
        var vendorsSet = {};

        payables.forEach(function (p) {
            if (p.status !== 'pendiente') return;
            var pending = (Number(p.amount) || 0) - (Number(p.amountPaid) || 0);
            totalPendiente += pending;

            var di = getDueDateInfo(p);
            if (di.status === 'vencido' || di.status === 'hoy') {
                vencidoCount++;
                vencidoSum += pending;
            } else if (di.status === 'proximo') {
                proximoCount++;
                proximoSum += pending;
            }
            if (p.vendorName) vendorsSet[p.vendorName] = true;
        });

        return {
            totalPendiente: totalPendiente,
            vencidoCount: vencidoCount, vencidoSum: vencidoSum,
            proximoCount: proximoCount, proximoSum: proximoSum,
            proveedoresCount: Object.keys(vendorsSet).length
        };
    }

    // ── Render ─────────────────────────────────────────────────────────
    function render() {
        return [
            '<div class="content-header">',
            '  <h2>Cuentas por Pagar</h2>',
            '  <button class="btn btn-primary" id="payables-btn-new">+ Nuevo Costo</button>',
            '</div>',
            '<div class="content-body" id="payables-body">',
            '  <div class="kpi-grid" id="payables-kpis"></div>',
            '  <div class="toolbar">',
            '    <div class="toggle-group" id="payables-toggle">',
            '      <button class="toggle-option active" data-view="lista">Vista Lista</button>',
            '      <button class="toggle-option" data-view="agrupada">Vista Agrupada</button>',
            '    </div>',
            '  </div>',
            '  <div id="payables-content"></div>',
            '</div>',
            renderModal()
        ].join('\n');
    }

    function renderKPIs() {
        var k = computeKPIs();
        return [
            '<div class="kpi-card danger">',
            '  <div class="kpi-label">Total Pendiente</div>',
            '  <div class="kpi-value">' + formatCLP(k.totalPendiente) + '</div>',
            '</div>',
            '<div class="kpi-card danger">',
            '  <div class="kpi-label">Vencidos (Viernes pasados)</div>',
            '  <div class="kpi-value">' + k.vencidoCount + '</div>',
            '  <div class="kpi-sub">' + formatCLP(k.vencidoSum) + '</div>',
            '</div>',
            '<div class="kpi-card warning">',
            '  <div class="kpi-label">Pr\u00f3ximos a vencer (\u22647d)</div>',
            '  <div class="kpi-value">' + k.proximoCount + '</div>',
            '  <div class="kpi-sub">' + formatCLP(k.proximoSum) + '</div>',
            '</div>',
            '<div class="kpi-card info">',
            '  <div class="kpi-label">Proveedores por Pagar</div>',
            '  <div class="kpi-value">' + k.proveedoresCount + '</div>',
            '</div>'
        ].join('\n');
    }

    function draftBadge(p) {
        return p.isDraft ? ' <span class="badge badge-secondary" style="font-size:10px">Borrador</span>' : '';
    }

    // ── Lista view ─────────────────────────────────────────────────────
    function renderListView() {
        if (payables.length === 0) {
            return '<div class="empty-state"><div class="empty-icon">&#128203;</div><p>No hay costos registrados.</p></div>';
        }

        var rows = payables.map(function (p) {
            var pending = (Number(p.amount) || 0) - (Number(p.amountPaid) || 0);
            var badgeClass = p.status === 'pagada' ? 'badge-success' : 'badge-warning';
            var statusLabel = p.status === 'pagada' ? 'Pagada' : 'Pendiente';
            var docLabel = docTypeLabel(p.docType) + (p.docNumber ? ' #' + p.docNumber : '');
            var eventLabel = (p.eventName || '-') + (p.eventDate ? ' <span style="color:var(--text-muted);font-size:11px">(' + p.eventDate + ')</span>' : '');
            var di = getDueDateInfo(p);

            return [
                '<tr style="' + di.rowStyle + '">',
                '  <td>' + (p.clientName || '-') + '</td>',
                '  <td>' + eventLabel + '</td>',
                '  <td>' + (p.concept || '-') + draftBadge(p) + '</td>',
                '  <td>' + (p.vendorName || '<span style="color:var(--text-muted)">Sin asignar</span>') + '</td>',
                '  <td>' + docLabel + '</td>',
                '  <td class="text-right">' + formatCLP(p.amount) + '</td>',
                '  <td class="text-right">' + formatCLP(pending) + '</td>',
                '  <td style="white-space:nowrap;' + di.cellStyle + '">' + di.label + '</td>',
                '  <td><span class="badge ' + badgeClass + '">' + statusLabel + '</span></td>',
                '  <td>',
                '    <div class="flex gap-sm">',
                '      <button class="btn-icon payable-edit" data-id="' + p.id + '" title="Editar">&#9998;</button>',
                p.status === 'pendiente'
                    ? '      <button class="btn btn-sm btn-success payable-mark-paid" data-id="' + p.id + '">Pagar</button>'
                    : '',
                '      <button class="btn-icon payable-delete" data-id="' + p.id + '" title="Eliminar">&#128465;</button>',
                '    </div>',
                '  </td>',
                '</tr>'
            ].join('\n');
        }).join('\n');

        return [
            '<div style="overflow-x:auto">',
            '<table class="data-table">',
            '<thead><tr>',
            '  <th>Cliente</th><th>Evento</th><th>Concepto</th><th>Proveedor</th>',
            '  <th>Documento</th><th class="text-right">Monto</th>',
            '  <th class="text-right">Pendiente</th><th>Fecha Pago (Vie +30d)</th><th>Estado</th><th>Acciones</th>',
            '</tr></thead>',
            '<tbody>',
            rows,
            '</tbody>',
            '</table>',
            '</div>'
        ].join('\n');
    }

    // ── Agrupada view (por Evento) ─────────────────────────────────────
    function renderGroupedView() {
        var groups = {};
        payables.forEach(function (p) {
            var key = (p.eventName || 'Sin evento') + (p.eventDate ? ' — ' + p.eventDate : '');
            if (!groups[key]) groups[key] = { eventName: p.eventName || 'Sin evento', eventDate: p.eventDate || '', items: [] };
            groups[key].items.push(p);
        });

        var keys = Object.keys(groups).sort();
        if (keys.length === 0) {
            return '<div class="empty-state"><div class="empty-icon">&#128203;</div><p>No hay costos registrados.</p></div>';
        }

        return keys.map(function (key) {
            var grp = groups[key];
            var items = grp.items;
            var pendingItems = items.filter(function (p) { return p.status === 'pendiente'; });
            var totalPending = pendingItems.reduce(function (s, p) {
                return s + ((Number(p.amount) || 0) - (Number(p.amountPaid) || 0));
            }, 0);
            var clientLabel = items[0] && items[0].clientName ? ' · ' + items[0].clientName : '';

            var rows = items.map(function (p) {
                var pending = (Number(p.amount) || 0) - (Number(p.amountPaid) || 0);
                var badgeClass = p.status === 'pagada' ? 'badge-success' : 'badge-warning';
                var statusLabel = p.status === 'pagada' ? 'Pagada' : 'Pendiente';
                var vendorCell = p.vendorName || '<span style="color:var(--text-muted)">Sin asignar</span>';
                var di = getDueDateInfo(p);
                return [
                    '<tr style="' + di.rowStyle + '">',
                    '  <td>' + (p.concept || '-') + draftBadge(p) + '</td>',
                    '  <td>' + vendorCell + '</td>',
                    '  <td>' + docTypeLabel(p.docType) + '</td>',
                    '  <td class="text-right">' + formatCLP(p.amount) + '</td>',
                    '  <td class="text-right">' + formatCLP(pending) + '</td>',
                    '  <td style="white-space:nowrap;' + di.cellStyle + '">' + di.label + '</td>',
                    '  <td><span class="badge ' + badgeClass + '">' + statusLabel + '</span></td>',
                    '  <td>',
                    '    <div class="flex gap-sm">',
                    '      <button class="btn-icon payable-edit" data-id="' + p.id + '" title="Editar">&#9998;</button>',
                    p.status === 'pendiente'
                        ? '      <button class="btn btn-sm btn-success payable-mark-paid" data-id="' + p.id + '">Pagar</button>'
                        : '',
                    '      <button class="btn-icon payable-delete" data-id="' + p.id + '" title="Eliminar">&#128465;</button>',
                    '    </div>',
                    '  </td>',
                    '</tr>'
                ].join('\n');
            }).join('\n');

            return [
                '<div class="card" style="margin-bottom:var(--space-md)">',
                '  <div class="card-header">',
                '    <div>',
                '      <span class="card-title">' + grp.eventName + '</span>',
                '      <span style="font-size:12px;color:var(--text-muted);margin-left:8px">' + (grp.eventDate || '') + clientLabel + '</span>',
                '    </div>',
                '    <div>',
                '      <span style="font-size:12px;color:var(--text-muted);margin-right:12px">' + pendingItems.length + ' pendientes</span>',
                '      <span class="text-danger" style="font-weight:700">' + formatCLP(totalPending) + '</span>',
                '    </div>',
                '  </div>',
                '  <table class="data-table">',
                '    <thead><tr>',
                '      <th>Concepto</th><th>Proveedor</th><th>Doc</th>',
                '      <th class="text-right">Monto</th><th class="text-right">Pendiente</th>',
                '      <th>Fecha Pago</th><th>Estado</th><th>Acciones</th>',
                '    </tr></thead>',
                '    <tbody>' + rows + '</tbody>',
                '  </table>',
                '</div>'
            ].join('\n');
        }).join('\n');
    }

    // ── Modal ──────────────────────────────────────────────────────────
    function renderModal() {
        return [
            '<div class="modal-overlay" id="payable-modal">',
            '  <div class="modal">',
            '    <div class="modal-header">',
            '      <h3 id="payable-modal-title">Nuevo Costo</h3>',
            '      <button class="modal-close" id="payable-modal-close">&times;</button>',
            '    </div>',
            '    <form id="payable-form">',
            '      <div class="form-row">',
            '        <div class="form-group">',
            '          <label>Nombre del Evento</label>',
            '          <input type="text" class="form-control" id="pay-eventName" required>',
            '        </div>',
            '        <div class="form-group">',
            '          <label>Fecha del Evento</label>',
            '          <input type="date" class="form-control" id="pay-eventDate">',
            '        </div>',
            '      </div>',
            '      <div class="form-group">',
            '        <label>Nombre del Cliente</label>',
            '        <input type="text" class="form-control" id="pay-clientName">',
            '      </div>',
            '      <div class="form-group">',
            '        <label>Concepto</label>',
            '        <input type="text" class="form-control" id="pay-concept" required>',
            '      </div>',
            '      <div class="form-row">',
            '        <div class="form-group">',
            '          <label>Proveedor</label>',
            '          <select class="form-control" id="pay-vendorId"></select>',
            '        </div>',
            '        <div class="form-group">',
            '          <label>Monto (Bruto)</label>',
            '          <input type="number" class="form-control" id="pay-amount" min="0" step="1" required>',
            '        </div>',
            '      </div>',
            '      <div class="form-row">',
            '        <div class="form-group">',
            '          <label>Tipo de Documento</label>',
            '          <select class="form-control" id="pay-docType">',
            '            <option value="bh">BH</option>',
            '            <option value="factura">Factura</option>',
            '            <option value="invoice">Invoice</option>',
            '            <option value="ninguno">Ninguno</option>',
            '          </select>',
            '        </div>',
            '        <div class="form-group">',
            '          <label>N\u00b0 de Documento</label>',
            '          <input type="text" class="form-control" id="pay-docNumber">',
            '        </div>',
            '      </div>',
            '      <div class="form-group">',
            '        <label>Fecha de Pago Estimada <span style="font-weight:400;color:var(--text-muted)">(primer viernes \u226530d desde evento)</span></label>',
            '        <div id="pay-due-date-display" style="padding:var(--space-sm) 0;font-weight:600;font-size:15px">-</div>',
            '      </div>',
            '      <div class="form-actions">',
            '        <button type="button" class="btn btn-secondary" id="payable-cancel">Cancelar</button>',
            '        <button type="submit" class="btn btn-primary" id="payable-save">Guardar</button>',
            '      </div>',
            '    </form>',
            '  </div>',
            '</div>'
        ].join('\n');
    }

    // ── Data loading ───────────────────────────────────────────────────
    async function loadData() {
        try {
            payables = await window.Mazelab.DataService.getAll('payables') || [];
            staffList = await window.Mazelab.DataService.getAll('staff') || [];
        } catch (e) {
            console.warn('PayablesModule: Error loading data', e);
            payables = [];
            staffList = [];
        }
    }

    function refreshView() {
        var kpiContainer = document.getElementById('payables-kpis');
        if (kpiContainer) kpiContainer.innerHTML = renderKPIs();

        var contentContainer = document.getElementById('payables-content');
        if (contentContainer) {
            contentContainer.innerHTML = currentView === 'lista' ? renderListView() : renderGroupedView();
        }

        bindTableActions();
    }

    // ── Modal helpers ──────────────────────────────────────────────────
    function openModal(payable) {
        editingId = payable ? payable.id : null;
        var title = document.getElementById('payable-modal-title');
        if (title) title.textContent = payable ? 'Editar Costo' : 'Nuevo Costo';

        populateVendorDropdown();

        document.getElementById('pay-eventName').value = payable ? (payable.eventName || '') : '';
        document.getElementById('pay-clientName').value = payable ? (payable.clientName || '') : '';
        document.getElementById('pay-eventDate').value = payable ? (payable.eventDate || payable.eventEndDate || '') : '';
        document.getElementById('pay-concept').value = payable ? (payable.concept || '') : '';
        document.getElementById('pay-vendorId').value = payable ? (payable.vendorId || '') : '';
        document.getElementById('pay-amount').value = payable ? (payable.amount || '') : '';
        document.getElementById('pay-docType').value = payable ? (payable.docType || 'bh') : 'bh';
        document.getElementById('pay-docNumber').value = payable ? (payable.docNumber || '') : '';

        updateDueDateDisplay();

        // Live update due date when event date changes
        var eventDateInput = document.getElementById('pay-eventDate');
        if (eventDateInput) {
            eventDateInput.onchange = updateDueDateDisplay;
        }

        var modal = document.getElementById('payable-modal');
        if (modal) modal.classList.add('active');
    }

    function updateDueDateDisplay() {
        var display = document.getElementById('pay-due-date-display');
        if (!display) return;
        var dateStr = (document.getElementById('pay-eventDate') || {}).value;
        var dueDate = calcDueDate(dateStr);
        if (!dueDate) { display.textContent = '-'; display.style.color = ''; return; }

        var today = new Date(); today.setHours(0, 0, 0, 0);
        var diffDays = Math.floor((dueDate - today) / 86400000);
        var label = 'Viernes ' + formatDateShort(dueDate);
        if (diffDays < 0) {
            label += ' (vencido hace ' + Math.abs(diffDays) + ' días)';
            display.style.color = 'var(--danger)';
        } else if (diffDays === 0) {
            label += ' (¡HOY!)';
            display.style.color = 'var(--danger)';
        } else if (diffDays <= 7) {
            label += ' (en ' + diffDays + ' días)';
            display.style.color = 'var(--warning)';
        } else {
            label += ' (en ' + diffDays + ' días)';
            display.style.color = 'var(--text-primary)';
        }
        display.textContent = label;
    }

    function closeModal() {
        var modal = document.getElementById('payable-modal');
        if (modal) modal.classList.remove('active');
        editingId = null;
    }

    function populateVendorDropdown() {
        var select = document.getElementById('pay-vendorId');
        if (!select) return;
        var vendors = getVendors();
        var options = '<option value="">-- Seleccionar Proveedor --</option>';
        vendors.forEach(function (v) {
            var name = v.name || v.nombre || '';
            var id = v.id || '';
            options += '<option value="' + id + '">' + name + '</option>';
        });
        select.innerHTML = options;
    }

    // ── Save / Actions ─────────────────────────────────────────────────
    async function handleSave(e) {
        e.preventDefault();

        var vendorSelect = document.getElementById('pay-vendorId');
        var vendorId = vendorSelect.value;
        var vendorName = '';
        if (vendorId) {
            var selectedOption = vendorSelect.options[vendorSelect.selectedIndex];
            vendorName = selectedOption ? selectedOption.textContent : '';
        }

        var amount = Number(document.getElementById('pay-amount').value) || 0;
        var docType = document.getElementById('pay-docType').value;
        var eventDate = document.getElementById('pay-eventDate').value;

        // Calculate BH retention if applicable
        if (docType === 'bh') {
            getBHRetention(eventDate); // still used for reference; amount stored gross
        }

        var record = {
            eventName: document.getElementById('pay-eventName').value.trim(),
            eventDate: eventDate,
            eventEndDate: eventDate,   // keep both fields in sync for legacy compat
            clientName: document.getElementById('pay-clientName').value.trim(),
            concept: document.getElementById('pay-concept').value.trim(),
            vendorId: vendorId,
            vendorName: vendorName,
            amount: amount,
            amountPaid: 0,
            docType: docType,
            docNumber: document.getElementById('pay-docNumber').value.trim(),
            status: 'pendiente'
        };

        try {
            if (editingId) {
                // Preserve existing amountPaid and status on edit
                var existing = payables.find(function (p) { return p.id === editingId; });
                if (existing) {
                    record.amountPaid = existing.amountPaid;
                    record.status = existing.status;
                    record.isDraft = false; // editing a draft confirms it
                    record.sourceType = existing.sourceType;
                }
                await window.Mazelab.DataService.update('payables', editingId, record);
            } else {
                await window.Mazelab.DataService.create('payables', record);
            }

            closeModal();
            await loadData();
            refreshView();
        } catch (err) {
            console.error('PayablesModule: Save error', err);
            alert('Error al guardar el costo.');
        }
    }

    async function markAsPaid(id) {
        var payable = payables.find(function (p) { return p.id === id; });
        if (!payable) return;
        try {
            await window.Mazelab.DataService.update('payables', id, {
                status: 'pagada',
                amountPaid: payable.amount
            });
            await loadData();
            refreshView();
        } catch (err) {
            console.error('PayablesModule: Mark paid error', err);
        }
    }

    async function deletePayable(id) {
        if (!confirm('¿Eliminar este costo? Esta acción no se puede deshacer.')) return;
        try {
            await window.Mazelab.DataService.remove('payables', id);
            await loadData();
            refreshView();
        } catch (err) {
            console.error('PayablesModule: Delete error', err);
        }
    }

    // ── Table action binding ───────────────────────────────────────────
    function bindTableActions() {
        document.querySelectorAll('.payable-edit').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var p = payables.find(function (x) { return String(x.id) === String(btn.dataset.id); });
                if (p) openModal(p);
            });
        });

        document.querySelectorAll('.payable-mark-paid').forEach(function (btn) {
            btn.addEventListener('click', function () {
                markAsPaid(btn.dataset.id);
            });
        });

        document.querySelectorAll('.payable-delete').forEach(function (btn) {
            btn.addEventListener('click', function () {
                deletePayable(btn.dataset.id);
            });
        });
    }

    // ── Init ───────────────────────────────────────────────────────────
    async function init() {
        await loadData();
        refreshView();

        // New button
        var btnNew = document.getElementById('payables-btn-new');
        if (btnNew) {
            btnNew.addEventListener('click', function () {
                openModal(null);
            });
        }

        // Toggle view
        var toggleGroup = document.getElementById('payables-toggle');
        if (toggleGroup) {
            toggleGroup.querySelectorAll('.toggle-option').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    currentView = btn.dataset.view;
                    toggleGroup.querySelectorAll('.toggle-option').forEach(function (b) {
                        b.classList.toggle('active', b.dataset.view === currentView);
                    });
                    refreshView();
                });
            });
        }

        // Modal close
        var modalClose = document.getElementById('payable-modal-close');
        if (modalClose) {
            modalClose.addEventListener('click', closeModal);
        }
        var cancelBtn = document.getElementById('payable-cancel');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', closeModal);
        }

        // Click overlay to close
        var overlay = document.getElementById('payable-modal');
        if (overlay) {
            overlay.addEventListener('click', function (e) {
                if (e.target === overlay) closeModal();
            });
        }

        // Form submit
        var form = document.getElementById('payable-form');
        if (form) {
            form.addEventListener('submit', handleSave);
        }
    }

    return { render: render, init: init };
})();
