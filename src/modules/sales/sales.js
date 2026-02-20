window.Mazelab.Modules.SalesModule = (function () {
    let sales = [];
    let clients = [];
    let services = [];
    let staff = [];
    let currentFilter = 'todas';
    let searchQuery = '';
    let editingId = null;

    function formatCLP(amount) {
        if (amount == null || isNaN(amount)) return '$0';
        return '$' + Number(amount).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    }

    function getStatusBadgeClass(status) {
        const map = {
            realizada: 'badge-success',
            pendiente: 'badge-warning',
            confirmada: 'badge-info',
            cancelada: 'badge-danger',
            anulada: 'badge-neutral'
        };
        return map[status] || 'badge-secondary';
    }

    // Auto-calcula el estado efectivo: si el evento ya pasó y estaba pendiente/confirmado,
    // se muestra como 'realizada' sin necesidad de actualizarlo manualmente.
    function getEffectiveStatus(sale) {
        if (sale.status === 'realizada' || sale.status === 'anulada' || sale.status === 'cancelada') {
            return sale.status;
        }
        if (sale.eventDate && new Date(sale.eventDate) < new Date()) {
            return 'realizada';
        }
        return sale.status || 'pendiente';
    }

    function getClientName(clientId) {
        const client = clients.find(c => c.id === clientId);
        return client ? (client.name || client.nombre || '') : '';
    }

    function getServiceNames(serviceIds) {
        if (!serviceIds || !Array.isArray(serviceIds)) return '';
        return serviceIds
            .map(sid => {
                const svc = services.find(s => s.id === sid);
                return svc ? (svc.name || svc.nombre || '') : '';
            })
            .filter(Boolean)
            .join(', ');
    }

    function getStaffName(staffId) {
        const member = staff.find(s => s.id === staffId);
        return member ? (member.name || member.nombre || '') : '';
    }

    function getFilteredSales() {
        return sales.filter(sale => {
            // Status filter — use effectiveStatus so auto-realizada events are filtered correctly
            if (currentFilter !== 'todas' && getEffectiveStatus(sale) !== currentFilter) {
                return false;
            }
            // Search filter
            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                const clientName = (sale.clientName || getClientName(sale.clientId)).toLowerCase();
                const eventName = (sale.eventName || '').toLowerCase();
                const serviceNames = getServiceNames(sale.serviceIds).toLowerCase();
                return clientName.includes(q) || eventName.includes(q) || serviceNames.includes(q);
            }
            return true;
        });
    }

    function renderTableRows() {
        const filtered = getFilteredSales();
        if (filtered.length === 0) {
            return '<tr><td colspan="8" style="text-align:center;padding:2rem;color:#888;">No se encontraron ventas</td></tr>';
        }
        return filtered.map(sale => {
            const clientName = sale.clientName || getClientName(sale.clientId);
            const serviceNames = getServiceNames(sale.serviceIds);
            const effectiveStatus = getEffectiveStatus(sale);
            const badgeClass = getStatusBadgeClass(effectiveStatus);
            const statusLabel = effectiveStatus ? effectiveStatus.charAt(0).toUpperCase() + effectiveStatus.slice(1) : '';
            const formattedAmount = formatCLP(sale.amount);
            const eventDate = sale.eventDate || '';
            return `
                <tr data-id="${sale.id}">
                    <td>${clientName}</td>
                    <td>${serviceNames}</td>
                    <td>${sale.eventName || ''}</td>
                    <td>${sale.jornadas != null ? sale.jornadas : ''}</td>
                    <td>${formattedAmount}</td>
                    <td>${eventDate}</td>
                    <td><span class="${badgeClass}">${statusLabel}</span></td>
                    <td>
                        <button class="btn-icon btn-edit-sale" data-id="${sale.id}" title="Editar">
                            <i class="icon-edit">&#9998;</i>
                        </button>
                        <button class="btn-icon btn-delete-sale" data-id="${sale.id}" title="Eliminar">
                            <i class="icon-delete">&#128465;</i>
                        </button>
                    </td>
                </tr>`;
        }).join('');
    }

    function render() {
        return `
        <div class="content-header">
            <h1>Ventas</h1>
            <button class="btn-primary" id="btn-new-sale">Nueva Venta</button>
        </div>
        <div class="content-body">
            <div class="toolbar">
                <div class="search-bar">
                    <input type="text" id="sales-search" class="form-control" placeholder="Buscar por cliente, evento o servicio..." />
                </div>
                <div class="filter-buttons">
                    <button class="btn-sm filter-btn active" data-filter="todas">Todas</button>
                    <button class="btn-sm filter-btn" data-filter="pendiente">Pendientes</button>
                    <button class="btn-sm filter-btn" data-filter="realizada">Realizadas</button>
                    <button class="btn-sm filter-btn" data-filter="cancelada">Canceladas</button>
                </div>
            </div>
            <table class="data-table" id="sales-table">
                <thead>
                    <tr>
                        <th>Cliente</th>
                        <th>Servicios</th>
                        <th>Evento</th>
                        <th>Jornadas</th>
                        <th>Monto</th>
                        <th>Fecha</th>
                        <th>Estado</th>
                        <th>Acciones</th>
                    </tr>
                </thead>
                <tbody id="sales-table-body">
                </tbody>
            </table>
        </div>

        <!-- Modal de Venta -->
        <div class="modal-overlay" id="sale-modal-overlay">
            <div class="modal">
                <div class="modal-header">
                    <h2 id="sale-modal-title">Nueva Venta</h2>
                    <button class="modal-close" id="sale-modal-close">&times;</button>
                </div>
                <form id="sale-form">
                    <input type="hidden" id="sale-id" />

                    <div class="form-row">
                        <div class="form-group">
                            <label for="sale-client">Cliente</label>
                            <select id="sale-client" class="form-control" required>
                                <option value="">Seleccionar cliente...</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="sale-staff">Vendedor</label>
                            <select id="sale-staff" class="form-control">
                                <option value="">Seleccionar vendedor...</option>
                            </select>
                        </div>
                    </div>

                    <div class="form-row">
                        <div class="form-group">
                            <label for="sale-event-name">Nombre del Evento</label>
                            <input type="text" id="sale-event-name" class="form-control" placeholder="Nombre del evento" />
                        </div>
                        <div class="form-group">
                            <label for="sale-event-date">Fecha del Evento</label>
                            <input type="date" id="sale-event-date" class="form-control" />
                        </div>
                    </div>

                    <div class="form-row">
                        <div class="form-group">
                            <label for="sale-closing-month">Fecha de Venta (Mes)</label>
                            <input type="month" id="sale-closing-month" class="form-control" />
                        </div>
                        <div class="form-group">
                            <label for="sale-status">Estado</label>
                            <select id="sale-status" class="form-control">
                                <option value="pendiente">Pendiente</option>
                                <option value="confirmada">Confirmada</option>
                                <option value="realizada">Realizada</option>
                                <option value="cancelada">Cancelada</option>
                            </select>
                        </div>
                    </div>

                    <div class="form-group">
                        <label>Servicios</label>
                        <div id="sale-services-checkboxes" class="checkbox-group">
                        </div>
                    </div>

                    <div class="form-row">
                        <div class="form-group">
                            <label for="sale-jornadas">Jornadas</label>
                            <input type="number" id="sale-jornadas" class="form-control" min="0" step="1" placeholder="0" />
                        </div>
                        <div class="form-group">
                            <label for="sale-amount">Monto</label>
                            <input type="number" id="sale-amount" class="form-control" min="0" step="1" placeholder="0" />
                        </div>
                    </div>

                    <div class="form-group">
                        <label for="sale-comments">Comentarios</label>
                        <textarea id="sale-comments" class="form-control" rows="3" placeholder="Comentarios adicionales..."></textarea>
                    </div>

                    <div class="form-row">
                        <div class="form-group">
                            <label class="checkbox-label">
                                <input type="checkbox" id="sale-has-issue" />
                                Tiene incidencia
                            </label>
                        </div>
                        <div class="form-group" id="sale-refund-group" style="display:none;">
                            <label for="sale-refund-amount">Monto de Devoluci&oacute;n</label>
                            <input type="number" id="sale-refund-amount" class="form-control" min="0" step="1" placeholder="0" />
                        </div>
                    </div>

                    <div class="form-actions">
                        <button type="button" class="btn-secondary" id="sale-cancel-btn">Cancelar</button>
                        <button type="submit" class="btn-primary" id="sale-save-btn">Guardar</button>
                    </div>
                </form>
            </div>
        </div>`;
    }

    function populateDropdowns() {
        // Clients dropdown
        const clientSelect = document.getElementById('sale-client');
        if (clientSelect) {
            clientSelect.innerHTML = '<option value="">Seleccionar cliente...</option>' +
                clients.map(c => {
                    const name = c.name || c.nombre || '';
                    return `<option value="${c.id}">${name}</option>`;
                }).join('');
        }

        // Staff dropdown
        const staffSelect = document.getElementById('sale-staff');
        if (staffSelect) {
            staffSelect.innerHTML = '<option value="">Seleccionar vendedor...</option>' +
                staff.map(s => {
                    const name = s.name || s.nombre || '';
                    return `<option value="${s.id}">${name}</option>`;
                }).join('');
        }

        // Services checkboxes
        const servicesContainer = document.getElementById('sale-services-checkboxes');
        if (servicesContainer) {
            servicesContainer.innerHTML = services.map(svc => {
                const name = svc.name || svc.nombre || '';
                return `
                    <label class="checkbox-label">
                        <input type="checkbox" class="sale-service-cb" value="${svc.id}" />
                        ${name}
                    </label>`;
            }).join('');
        }
    }

    function refreshTable() {
        const tbody = document.getElementById('sales-table-body');
        if (tbody) {
            tbody.innerHTML = renderTableRows();
        }
    }

    function openModal(sale) {
        const overlay = document.getElementById('sale-modal-overlay');
        const title = document.getElementById('sale-modal-title');
        const form = document.getElementById('sale-form');

        if (!overlay || !form) return;

        populateDropdowns();

        if (sale) {
            editingId = sale.id;
            title.textContent = 'Editar Venta';
            document.getElementById('sale-id').value = sale.id;
            document.getElementById('sale-client').value = sale.clientId || '';
            document.getElementById('sale-event-name').value = sale.eventName || '';
            document.getElementById('sale-event-date').value = sale.eventDate || '';
            document.getElementById('sale-closing-month').value = sale.closingMonth || '';
            document.getElementById('sale-jornadas').value = sale.jornadas != null ? sale.jornadas : '';
            document.getElementById('sale-amount').value = sale.amount != null ? sale.amount : '';
            document.getElementById('sale-staff').value = sale.staffId || '';
            document.getElementById('sale-status').value = sale.status || 'pendiente';
            document.getElementById('sale-comments').value = sale.comments || '';

            const hasIssue = document.getElementById('sale-has-issue');
            hasIssue.checked = !!sale.hasIssue;
            document.getElementById('sale-refund-group').style.display = sale.hasIssue ? '' : 'none';
            document.getElementById('sale-refund-amount').value = sale.refundAmount != null ? sale.refundAmount : '';

            // Check service checkboxes
            const checkboxes = document.querySelectorAll('.sale-service-cb');
            const sids = sale.serviceIds || [];
            checkboxes.forEach(cb => {
                cb.checked = sids.includes(cb.value) || sids.includes(Number(cb.value));
            });
        } else {
            editingId = null;
            title.textContent = 'Nueva Venta';
            form.reset();
            document.getElementById('sale-id').value = '';
            document.getElementById('sale-refund-group').style.display = 'none';
        }

        overlay.classList.add('active');
    }

    function closeModal() {
        const overlay = document.getElementById('sale-modal-overlay');
        if (overlay) {
            overlay.classList.remove('active');
        }
        editingId = null;
    }

    function getFormData() {
        const selectedServices = [];
        document.querySelectorAll('.sale-service-cb:checked').forEach(cb => {
            selectedServices.push(cb.value);
        });

        const clientId = document.getElementById('sale-client').value;
        const clientName = getClientName(clientId);

        return {
            clientId: clientId,
            clientName: clientName,
            eventName: document.getElementById('sale-event-name').value,
            eventDate: document.getElementById('sale-event-date').value,
            closingMonth: document.getElementById('sale-closing-month').value,
            serviceIds: selectedServices,
            jornadas: document.getElementById('sale-jornadas').value ? Number(document.getElementById('sale-jornadas').value) : null,
            amount: document.getElementById('sale-amount').value ? Number(document.getElementById('sale-amount').value) : 0,
            staffId: document.getElementById('sale-staff').value,
            status: document.getElementById('sale-status').value || 'pendiente',
            comments: document.getElementById('sale-comments').value,
            hasIssue: document.getElementById('sale-has-issue').checked,
            refundAmount: document.getElementById('sale-refund-amount').value ? Number(document.getElementById('sale-refund-amount').value) : 0
        };
    }

    async function handleSave(e) {
        e.preventDefault();
        const data = getFormData();
        const DS = window.Mazelab.DataService;

        try {
            if (editingId) {
                await DS.update('sales', editingId, data);
            } else {
                // Capture the created sale so we can link CXC and CXP to it
                const createdSale = await DS.create('sales', data);
                const saleId = createdSale ? createdSale.id : null;

                // Auto-create CXC (receivable) for this sale
                await DS.create('receivables', {
                    eventName: data.eventName || '',
                    eventDate: data.eventDate || '',
                    clientName: data.clientName || '',
                    monto_venta: data.amount || 0,
                    invoicedAmount: 0,
                    amountPaid: 0,
                    pendingAmount: 0,
                    status: 'sin_factura',
                    saleId: saleId,
                    sourceType: 'auto',
                    isDraft: true
                });

                // Auto-generate CXP draft entries from service cost templates
                const drafts = [];
                (data.serviceIds || []).forEach(function (svcId) {
                    const svc = services.find(s => String(s.id) === String(svcId));
                    if (svc && Array.isArray(svc.cost_template) && svc.cost_template.length > 0) {
                        svc.cost_template.forEach(function (item) {
                            drafts.push({
                                eventName: data.eventName || '',
                                eventDate: data.eventDate || '',
                                clientName: data.clientName || '',
                                concept: item.concepto || '',
                                vendorName: '',
                                amount: (item.cantidad || 1) * (item.monto_unitario || 0),
                                amountPaid: 0,
                                docType: item.tipo_beneficiario === 'freelancer' ? 'bh' : 'factura',
                                status: 'pendiente',
                                isDraft: true,
                                sourceType: 'auto',
                                saleId: saleId
                            });
                        });
                    }
                });
                for (const draft of drafts) {
                    await DS.create('payables', draft);
                }
            }
            // Reload sales
            sales = await DS.getAll('sales') || [];
            refreshTable();
            closeModal();
        } catch (err) {
            console.error('Error guardando venta:', err);
            alert('Error al guardar la venta.');
        }
    }

    async function handleDelete(id) {
        const DS = window.Mazelab.DataService;

        try {
            // Find the sale being deleted
            const sale = sales.find(s => String(s.id) === String(id));

            // Find linked CXC and CXP records (by saleId or by event+sourceType)
            const allReceivables = await DS.getAll('receivables') || [];
            const allPayables = await DS.getAll('payables') || [];

            const linkedCXC = allReceivables.filter(function (r) {
                return String(r.saleId) === String(id) ||
                    (r.sourceType === 'auto' && sale && r.eventName === sale.eventName && r.eventDate === sale.eventDate);
            });
            const linkedCXP = allPayables.filter(function (p) {
                return String(p.saleId) === String(id) ||
                    (p.sourceType === 'auto' && sale && p.eventName === sale.eventName && p.eventDate === sale.eventDate);
            });

            // Build warning message
            const lines = ['¿Estás seguro de eliminar este evento?', ''];
            if (sale) lines.push('Evento: ' + (sale.eventName || '(sin nombre)'));
            lines.push('');
            lines.push('También se eliminarán:');
            lines.push('  • ' + linkedCXC.length + ' CXC asociada' + (linkedCXC.length !== 1 ? 's' : '') + (linkedCXC.some(r => r.amountPaid > 0) ? ' (¡con abonos registrados!)' : ''));
            lines.push('  • ' + linkedCXP.length + ' CXP asociada' + (linkedCXP.length !== 1 ? 's' : ''));
            lines.push('');
            lines.push('Esta acción no se puede deshacer.');

            if (!confirm(lines.join('\n'))) return;

            // Delete linked records first
            for (const r of linkedCXC) await DS.remove('receivables', r.id);
            for (const p of linkedCXP) await DS.remove('payables', p.id);

            // Delete the sale
            await DS.remove('sales', id);
            sales = await DS.getAll('sales') || [];
            refreshTable();
        } catch (err) {
            console.error('Error eliminando venta:', err);
            alert('Error al eliminar la venta.');
        }
    }

    async function init() {
        const DS = window.Mazelab.DataService;

        try {
            const [salesData, clientsData, servicesData, staffData] = await Promise.all([
                DS.getAll('sales'),
                DS.getAll('clients'),
                DS.getAll('services'),
                DS.getAll('staff')
            ]);
            sales = salesData || [];
            clients = clientsData || [];
            services = servicesData || [];
            staff = staffData || [];
        } catch (err) {
            console.error('Error cargando datos de ventas:', err);
            sales = [];
            clients = [];
            services = [];
            staff = [];
        }

        refreshTable();

        // Search
        const searchInput = document.getElementById('sales-search');
        if (searchInput) {
            searchInput.addEventListener('input', function () {
                searchQuery = this.value.trim();
                refreshTable();
            });
        }

        // Status filter buttons
        const filterBtns = document.querySelectorAll('.filter-btn');
        filterBtns.forEach(btn => {
            btn.addEventListener('click', function () {
                filterBtns.forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                currentFilter = this.getAttribute('data-filter');
                refreshTable();
            });
        });

        // New sale button
        const newBtn = document.getElementById('btn-new-sale');
        if (newBtn) {
            newBtn.addEventListener('click', function () {
                openModal(null);
            });
        }

        // Modal close
        const closeBtn = document.getElementById('sale-modal-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', closeModal);
        }
        const cancelBtn = document.getElementById('sale-cancel-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', closeModal);
        }

        // Click outside modal to close
        const overlay = document.getElementById('sale-modal-overlay');
        if (overlay) {
            overlay.addEventListener('click', function (e) {
                if (e.target === overlay) {
                    closeModal();
                }
            });
        }

        // Has issue toggle
        const hasIssueCheckbox = document.getElementById('sale-has-issue');
        if (hasIssueCheckbox) {
            hasIssueCheckbox.addEventListener('change', function () {
                const refundGroup = document.getElementById('sale-refund-group');
                if (refundGroup) {
                    refundGroup.style.display = this.checked ? '' : 'none';
                }
            });
        }

        // Form submit
        const form = document.getElementById('sale-form');
        if (form) {
            form.addEventListener('submit', handleSave);
        }

        // Table delegation for edit/delete
        const tableBody = document.getElementById('sales-table-body');
        if (tableBody) {
            tableBody.addEventListener('click', function (e) {
                const editBtn = e.target.closest('.btn-edit-sale');
                const deleteBtn = e.target.closest('.btn-delete-sale');

                if (editBtn) {
                    const id = editBtn.getAttribute('data-id');
                    const sale = sales.find(s => String(s.id) === String(id));
                    if (sale) {
                        openModal(sale);
                    }
                }

                if (deleteBtn) {
                    const id = deleteBtn.getAttribute('data-id');
                    handleDelete(id);
                }
            });
        }
    }

    return { render, init };
})();
