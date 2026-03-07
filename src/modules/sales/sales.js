window.Mazelab.Modules.SalesModule = (function () {
    let sales = [];
    let clients = [];
    let services = [];
    let staff = [];
    let currentFilter = 'pendiente';
    let searchQuery = '';
    let editingId = null;
    let sortCol = null;
    let sortDir = 'asc';
    let payables = [];
    let eventCosts = {}; // { [saleId|eventId]: totalAmount }
    let columnFilters = {}; // { colKey: 'filterText' }

    function formatCLP(amount) {
        if (amount == null || isNaN(amount)) return '$0';
        return '$' + Number(amount).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
        // 'confirmada' tratada como 'pendiente' (estado eliminado)
        if (sale.status === 'confirmada') return 'pendiente';
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
        let list = sales.filter(sale => {
            if (currentFilter !== 'todas' && getEffectiveStatus(sale) !== currentFilter) return false;
            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                const clientName = (sale.clientName || getClientName(sale.clientId)).toLowerCase();
                const eventName = (sale.eventName || '').toLowerCase();
                const serviceNames = getServiceNames(sale.serviceIds).toLowerCase();
                const sourceId = String(sale.sourceId || '').toLowerCase();
                return clientName.includes(q) || eventName.includes(q) || serviceNames.includes(q) || sourceId.includes(q);
            }
            return true;
        });
        // Per-column filters
        const activeCols = Object.keys(columnFilters).filter(k => columnFilters[k]);
        if (activeCols.length) {
            list = list.filter(sale => {
                return activeCols.every(col => {
                    const fv = (columnFilters[col] || '').toLowerCase();
                    let val;
                    if (col === '_status') val = getEffectiveStatus(sale);
                    else val = String(sale[col] || '');
                    return val.toLowerCase().includes(fv);
                });
            });
        }

        if (sortCol) {
            list = list.slice().sort((a, b) => {
                let av = a[sortCol], bv = b[sortCol];
                if (sortCol === '_status') { av = getEffectiveStatus(a); bv = getEffectiveStatus(b); }
                else if (sortCol === 'margin') {
                    var _an = (a.eventName || '').trim().toLowerCase(), _bn = (b.eventName || '').trim().toLowerCase();
                    var ac = eventCosts[String(a.id)] || (a.sourceId ? eventCosts[String(a.sourceId)] : 0) || (_an ? eventCosts['__n__' + _an] : 0) || 0;
                    var bc = eventCosts[String(b.id)] || (b.sourceId ? eventCosts[String(b.sourceId)] : 0) || (_bn ? eventCosts['__n__' + _bn] : 0) || 0;
                    av = (Number(a.amount) || 0) > 0 ? ((Number(a.amount) || 0) - ac) / (Number(a.amount) || 0) : 0;
                    bv = (Number(b.amount) || 0) > 0 ? ((Number(b.amount) || 0) - bc) / (Number(b.amount) || 0) : 0;
                }
                const aNum = Number(av), bNum = Number(bv);
                if (!isNaN(aNum) && !isNaN(bNum)) return sortDir === 'asc' ? aNum - bNum : bNum - aNum;
                return sortDir === 'asc' ? String(av || '').localeCompare(String(bv || '')) : String(bv || '').localeCompare(String(av || ''));
            });
        }
        return list;
    }

    function sortTh(label, col) {
        const active = sortCol === col;
        const arrow = active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ↕';
        return `<th class="sortable-th" data-sort="${col}" style="cursor:pointer;white-space:nowrap">${label}<span style="opacity:${active ? 1 : 0.25};font-size:10px">${arrow}</span></th>`;
    }

    const FILTER_INPUT_STYLE = 'width:100%;font-size:11px;padding:2px 4px;border:1px solid var(--border);border-radius:3px;background:var(--bg-secondary);color:var(--text-primary);box-sizing:border-box';

    function filterInput(col, placeholder) {
        const fv = columnFilters[col] || '';
        return `<input class="col-filter" data-col="${col}" type="text" value="${fv}" placeholder="${placeholder}" style="${FILTER_INPUT_STYLE}">`;
    }

    function buildEventCostsMap() {
        eventCosts = {};
        payables.forEach(function (p) {
            var amt = Number(p.amount || p.monto || 0);
            // 1. Primario: indexar por eventId (columna "id" del CSV de CXP).
            //    Tras el fix de import, los payables importados desde CXP tienen eventId
            //    seteado correctamente. Los gastos generales (id=0) tienen eventId=''.
            var linkId = String(p.eventId || p.saleId || '').trim();
            if (linkId) {
                eventCosts[linkId] = (eventCosts[linkId] || 0) + amt;
                return; // si hay id, no hacer fallback por nombre (evita doble conteo)
            }
            // 2. Fallback por nombre solo para payables SIN eventId (datos legacy o manuales)
            //    que tengan categoría 'evento' (no gastos generales).
            if ((p.category || '') === 'evento') {
                var name = (p.eventName || '').trim().toLowerCase();
                if (name) {
                    eventCosts['__n__' + name] = (eventCosts['__n__' + name] || 0) + amt;
                }
            }
        });
    }

    function renderTableRows() {
        const filtered = getFilteredSales();
        if (filtered.length === 0) {
            return '<tr><td colspan="11" style="text-align:center;padding:2rem;color:#888;">No se encontraron ventas</td></tr>';
        }
        return filtered.map(sale => {
            const clientName = sale.clientName || getClientName(sale.clientId);
            const serviceNames = getServiceNames(sale.serviceIds) || (sale.serviceNames || '');
            const effectiveStatus = getEffectiveStatus(sale);
            const badgeClass = getStatusBadgeClass(effectiveStatus);
            const statusLabel = effectiveStatus ? effectiveStatus.charAt(0).toUpperCase() + effectiveStatus.slice(1) : '';
            const _sn = (sale.eventName || '').trim().toLowerCase();
            const cost = eventCosts[String(sale.id)]
                || (sale.sourceId ? eventCosts[String(sale.sourceId)] : 0)
                || (_sn ? eventCosts['__n__' + _sn] : 0)
                || 0;
            const utilidad = (Number(sale.amount) || 0) - cost;
            const margenPct = (Number(sale.amount) || 0) > 0 ? utilidad / Number(sale.amount) : null;
            const marginClass = utilidad >= 0 ? 'text-success' : 'text-danger';
            const displayId = sale.sourceId || '';
            return `
                <tr data-id="${sale.id}">
                    <td style="font-size:12px;font-weight:600;white-space:nowrap">${displayId}</td>
                    <td>${clientName}</td>
                    <td>${serviceNames}</td>
                    <td>${sale.eventName || ''}</td>
                    <td>${sale.jornadas != null ? sale.jornadas : ''}</td>
                    <td>${formatCLP(sale.amount)}</td>
                    <td>${cost > 0 ? formatCLP(cost) : '<span style="color:var(--text-muted)">-</span>'}</td>
                    <td class="${marginClass}">${margenPct !== null && cost > 0 ? Math.round(margenPct * 100) + '%' : '<span style="color:var(--text-muted)">-</span>'}</td>
                    <td>${sale.eventDate || ''}</td>
                    <td><span class="${badgeClass}">${statusLabel}</span></td>
                    <td>
                        <button class="btn-icon btn-edit-sale" data-id="${sale.id}" title="Editar">&#9998;</button>
                        <button class="btn-icon btn-delete-sale" data-id="${sale.id}" title="Eliminar">&#128465;</button>
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
                <div class="toggle-group" id="sales-pending-toggle">
                    <button class="toggle-option" data-filter="todas">Mostrar todos</button>
                    <button class="toggle-option active" data-filter="pendiente">Mostrar pendientes</button>
                </div>
            </div>
            <table class="data-table" id="sales-table">
                <thead id="sales-thead">
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
                            <label for="sale-closing-date">Fecha Cierre de Venta</label>
                            <input type="date" id="sale-closing-date" class="form-control" />
                        </div>
                        <div class="form-group">
                            <label for="sale-status">Estado</label>
                            <select id="sale-status" class="form-control">
                                <option value="pendiente">Pendiente</option>
                                <option value="realizada">Realizada</option>
                                <option value="cancelada">Cancelada</option>
                            </select>
                        </div>
                    </div>

                    <div class="form-group">
                        <label>Servicios</label>
                        <div id="sale-services-accordion" class="services-accordion">
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

        // Services accordion
        const servicesContainer = document.getElementById('sale-services-accordion');
        if (servicesContainer) {
            // Group by category
            const grouped = {};
            services.forEach(svc => {
                let cat = (svc.categoria || svc.category || 'Otros').trim();
                // Standardize common cases
                if (cat.toLowerCase() === 'fotográficas' || cat.toLowerCase() === 'fotograficas') cat = 'Fotograficas';
                if (!grouped[cat]) grouped[cat] = [];
                grouped[cat].push(svc);
            });

            // Sort categories alphabetically
            const categories = Object.keys(grouped).sort();

            let html = '';
            categories.forEach(cat => {
                // Sort services alphabetically within category
                grouped[cat].sort((a, b) => {
                    const nameA = (a.name || a.nombre || '').toLowerCase();
                    const nameB = (b.name || b.nombre || '').toLowerCase();
                    return nameA.localeCompare(nameB);
                });

                html += `
                    <div class="accordion-item" style="margin-bottom: 8px; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: var(--bg-tertiary);">
                        <button type="button" class="accordion-header" style="width: 100%; text-align: left; padding: 12px 16px; background: transparent; border: none; color: var(--text-primary); font-weight: 600; display: flex; justify-content: space-between; align-items: center; cursor: pointer;" onclick="
                            var content = this.nextElementSibling;
                            var arrow = this.querySelector('.accordion-arrow');
                            if (content.style.display === 'none' || content.style.display === '') {
                                content.style.display = 'grid';
                                arrow.style.transform = 'rotate(180deg)';
                            } else {
                                content.style.display = 'none';
                                arrow.style.transform = 'rotate(0deg)';
                            }
                        ">
                            <span>${cat}</span> 
                            <span class="accordion-arrow" style="font-size: 12px; opacity: 0.6; transition: transform 0.2s; display: inline-block;">▼</span>
                        </button>
                        <div class="accordion-content checkbox-group" style="padding: 16px; background: rgba(255, 255, 255, 0.02); border-top: 1px solid var(--border); display: none; flex-direction: column; gap: 12px;">
                            ${(function () {
                        const featured = grouped[cat].filter(s => s.featured);
                        const regular = grouped[cat].filter(s => !s.featured);

                        const renderSvc = (svc) => {
                            const name = svc.name || svc.nombre || '';
                            return `
                                        <label class="checkbox-label" style="margin: 0; background: var(--bg-card); padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border); width: 100%; box-sizing: border-box; display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                            <input type="checkbox" class="sale-service-cb" value="${svc.id}" style="margin: 0; cursor: pointer;" />
                                            <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
                                            ${svc.featured ? '<span style="font-size:12px;color:var(--warning);margin-left:auto" title="Destacado">★</span>' : ''}
                                        </label>`;
                        };

                        let innerHtml = '<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px;">';
                        if (featured.length > 0) {
                            innerHtml += featured.map(renderSvc).join('');
                        } else if (regular.length > 0) {
                            // Make sure nothing is hidden if no "featured" is available
                            innerHtml += regular.map(renderSvc).join('');
                            regular.length = 0;
                        }
                        innerHtml += '</div>';

                        if (regular.length > 0) {
                            const moreId = 'more-btn-' + cat.replace(/[^a-zA-Z0-9]/g, '');
                            innerHtml += `
                                    <div style="margin-top: 8px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 12px;">
                                        <button type="button" class="btn-sm btn-secondary" style="width: 100%; margin-bottom: 12px; background: transparent; border: 1px solid rgba(255,255,255,0.1);" onclick="
                                            var d = document.getElementById('${moreId}');
                                            if (d.style.display === 'none' || d.style.display === '') {
                                                d.style.display = 'grid';
                                                this.innerHTML = 'Mostrar menos ▲';
                                            } else {
                                                d.style.display = 'none';
                                                this.innerHTML = 'Mostrar ${regular.length} más ▼';
                                            }
                                        ">Mostrar ${regular.length} más ▼</button>
                                        <div id="${moreId}" style="display: none; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px;">
                                            ${regular.map(renderSvc).join('')}
                                        </div>
                                    </div>`;
                        }
                        return innerHtml;
                    })()}
                        </div>
                    </div>`;
            });
            servicesContainer.innerHTML = html;
        }
    }

    function renderTableHeader() {
        const filterRow = `<tr class="filter-row" style="background:var(--bg-tertiary)">
            <th style="padding:2px 4px">${filterInput('sourceId', 'ID...')}</th>
            <th style="padding:2px 4px">${filterInput('clientName', 'Cliente...')}</th>
            <th style="padding:2px 4px"></th>
            <th style="padding:2px 4px">${filterInput('eventName', 'Evento...')}</th>
            <th style="padding:2px 4px"></th>
            <th style="padding:2px 4px"></th>
            <th style="padding:2px 4px"></th>
            <th style="padding:2px 4px"></th>
            <th style="padding:2px 4px">${filterInput('eventDate', 'YYYY-MM-DD')}</th>
            <th style="padding:2px 4px">${filterInput('_status', 'Estado...')}</th>
            <th style="padding:2px 4px"></th>
        </tr>`;
        return `<tr>
            ${sortTh('ID', 'sourceId')}
            ${sortTh('Cliente', 'clientName')}
            <th>Servicios</th>
            ${sortTh('Evento', 'eventName')}
            ${sortTh('Jornadas', 'jornadas')}
            ${sortTh('Monto', 'amount')}
            ${sortTh('Costo', 'costAmount')}
            ${sortTh('Margen', 'margin')}
            ${sortTh('Fecha', 'eventDate')}
            ${sortTh('Estado', '_status')}
            <th>Acciones</th>
        </tr>` + filterRow;
    }

    function refreshTable() {
        // Preserve focused filter column before re-render
        const focusedEl = document.activeElement;
        const focusedCol = (focusedEl && focusedEl.classList.contains('col-filter')) ? focusedEl.dataset.col : null;
        const focusCursor = focusedCol ? { s: focusedEl.selectionStart, e: focusedEl.selectionEnd } : null;

        const thead = document.getElementById('sales-thead');
        if (thead) thead.innerHTML = renderTableHeader();
        const tbody = document.getElementById('sales-table-body');
        if (tbody) tbody.innerHTML = renderTableRows();

        // Bind sort headers
        document.querySelectorAll('#sales-table .sortable-th').forEach(th => {
            th.addEventListener('click', () => {
                const col = th.dataset.sort;
                if (sortCol === col) { sortDir = sortDir === 'asc' ? 'desc' : 'asc'; }
                else { sortCol = col; sortDir = 'asc'; }
                refreshTable();
            });
        });

        // Bind column filter inputs
        document.querySelectorAll('#sales-table .col-filter').forEach(input => {
            input.addEventListener('input', function () {
                columnFilters[this.dataset.col] = this.value;
                refreshTable();
            });
        });

        // Restore focus to filter input
        if (focusedCol) {
            const el = document.querySelector(`#sales-table .col-filter[data-col="${focusedCol}"]`);
            if (el) { el.focus(); if (focusCursor) el.setSelectionRange(focusCursor.s, focusCursor.e); }
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

            // Client — prefer clientId; fallback to name-match for imported records
            var clientSelEl = document.getElementById('sale-client');
            if (sale.clientId) {
                clientSelEl.value = sale.clientId;
            } else if (sale.clientName) {
                var matchedClient = clients.find(function(c) { return (c.name || c.nombre || '') === sale.clientName; });
                clientSelEl.value = matchedClient ? matchedClient.id : '';
            } else {
                clientSelEl.value = '';
            }

            document.getElementById('sale-event-name').value = sale.eventName || '';
            document.getElementById('sale-event-date').value = sale.eventDate || '';
            // Soporta closingDate (nuevo) y closingMonth (legacy mes)
            var closingVal = sale.closingDate || '';
            if (!closingVal && sale.closingMonth) {
                closingVal = /^\d{4}-\d{2}$/.test(sale.closingMonth) ? sale.closingMonth + '-01' : sale.closingMonth;
            }
            document.getElementById('sale-closing-date').value = closingVal;
            document.getElementById('sale-jornadas').value = sale.jornadas != null ? sale.jornadas : '';
            document.getElementById('sale-amount').value = sale.amount != null ? sale.amount : '';

            // Staff — prefer staffId; fallback to name-match for imported records
            var staffSelEl = document.getElementById('sale-staff');
            if (sale.staffId) {
                staffSelEl.value = sale.staffId;
            } else if (sale.staffName) {
                var matchedStaff = staff.find(function(s) { return (s.name || s.nombre || '') === sale.staffName; });
                staffSelEl.value = matchedStaff ? matchedStaff.id : '';
            } else {
                staffSelEl.value = '';
            }

            document.getElementById('sale-status').value = sale.status || 'pendiente';
            document.getElementById('sale-comments').value = sale.comments || '';

            const hasIssue = document.getElementById('sale-has-issue');
            hasIssue.checked = !!sale.hasIssue;
            document.getElementById('sale-refund-group').style.display = sale.hasIssue ? '' : 'none';
            document.getElementById('sale-refund-amount').value = sale.refundAmount != null ? sale.refundAmount : '';

            // Check service checkboxes — prefer serviceIds; fallback to name-match for imported records
            const checkboxes = document.querySelectorAll('.sale-service-cb');
            const sids = Array.isArray(sale.serviceIds) ? sale.serviceIds : [];
            if (sids.length > 0) {
                checkboxes.forEach(cb => {
                    cb.checked = sids.includes(cb.value) || sids.includes(Number(cb.value));
                });
            } else if (sale.serviceNames) {
                var svcNameList = sale.serviceNames.split(/[,;\/+]/).map(function(s) { return s.trim().toLowerCase(); }).filter(Boolean);
                checkboxes.forEach(cb => {
                    var svc = services.find(s => String(s.id) === String(cb.value));
                    cb.checked = svc ? svcNameList.includes((svc.name || svc.nombre || '').toLowerCase()) : false;
                });
            } else {
                checkboxes.forEach(cb => { cb.checked = false; });
            }
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
            closingDate: document.getElementById('sale-closing-date').value,
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
                // Sincronizar la CXC auto-generada con los datos actualizados de la venta
                const allReceivables = await DS.getAll('receivables') || [];
                const linkedCXC = allReceivables.find(function (r) {
                    return String(r.saleId) === String(editingId) && r.sourceType === 'auto';
                });
                if (linkedCXC) {
                    await DS.update('receivables', linkedCXC.id, {
                        eventName: data.eventName || linkedCXC.eventName,
                        eventDate: data.eventDate || linkedCXC.eventDate,
                        clientName: data.clientName || linkedCXC.clientName,
                        monto_venta: data.amount || 0
                    });
                }
            } else {
                // Asignar ID numérico auto-incremental (max existente + 1)
                var maxId = 0;
                sales.forEach(function (s) {
                    var numId = parseInt(s.sourceId || s.id, 10);
                    if (!isNaN(numId) && numId > maxId) maxId = numId;
                });
                var nextId = String(maxId + 1);

                // Capture the created sale so we can link CXC and CXP to it
                // Kanban board fields for new sale (pre-evento checklist)
                var kanbanChecklist = [
                    { key: 'pre_coordinacion', label: 'Coordinaci\u00f3n del evento',      group: 'Coordinaci\u00f3n', checked: false, checkedAt: null },
                    { key: 'pre_visita',       label: 'Visita t\u00e9cnica al venue',       group: 'Coordinaci\u00f3n', checked: false, checkedAt: null },
                    { key: 'pre_diseno_ok',    label: 'Dise\u00f1o aprobado por cliente',   group: 'Coordinaci\u00f3n', checked: false, checkedAt: null },
                    { key: 'pre_logistica',    label: 'Log\u00edstica confirmada',          group: 'Coordinaci\u00f3n', checked: false, checkedAt: null },
                    { key: 'pre_nomina_env',   label: 'N\u00f3mina enviada al personal',    group: 'Personal', checked: false, checkedAt: null },
                    { key: 'pre_nomina_cap',   label: 'N\u00f3mina capacitada / briefed',   group: 'Personal', checked: false, checkedAt: null },
                    { key: 'pre_freelances',   label: 'Freelancers confirmados',            group: 'Personal', checked: false, checkedAt: null },
                    { key: 'pre_equipos',      label: 'Equipos confirmados',                group: 'Producci\u00f3n', checked: false, checkedAt: null },
                    { key: 'pre_material',     label: 'Material de producci\u00f3n listo',  group: 'Producci\u00f3n', checked: false, checkedAt: null }
                ];

                const createdSale = await DS.create('sales', Object.assign({}, data, {
                    id: nextId,
                    sourceId: nextId,
                    boardColumn: 1,
                    boardOrder: Date.now(),
                    checklist: kanbanChecklist,
                    encargado: '',
                    kanbanNotes: ''
                }));
                const saleId = createdSale ? createdSale.id : null;

                // Auto-create CXC (receivable) for this sale
                await DS.create('receivables', {
                    id: window.Mazelab.Storage.generateId(),
                    eventName: data.eventName || '',
                    eventDate: data.eventDate || '',
                    clientName: data.clientName || '',
                    monto_venta: data.amount || 0,
                    invoicedAmount: 0,
                    amountPaid: 0,
                    status: 'sin_factura',
                    saleId: saleId,
                    sourceType: 'auto'
                });

                // Auto-generate CXP draft entries from service cost templates
                const drafts = [];
                (data.serviceIds || []).forEach(function (svcId) {
                    const svc = services.find(s => String(s.id) === String(svcId));
                    if (svc && Array.isArray(svc.cost_template) && svc.cost_template.length > 0) {
                        svc.cost_template.forEach(function (item) {
                            drafts.push({
                                id: window.Mazelab.Storage.generateId(),
                                eventName: data.eventName || '',
                                eventDate: data.eventDate || '',
                                clientName: data.clientName || '',
                                concept: item.concepto || '',
                                vendorName: '',
                                amount: (item.cantidad || 1) * (item.monto_unitario || 0),
                                docType: (function(t) {
                                    // Soporta valores nuevos (bh/factura/exenta/invoice/ninguno)
                                    // y legacy (freelancer/proveedor/staff_fijo/core)
                                    var s = (t || '').toLowerCase().trim();
                                    if (s === 'bh' || s === 'freelancer') return 'bh';
                                    if (s === 'factura' || s === 'proveedor' || s === 'f' || s === 'tc') return 'factura';
                                    if (s === 'exenta' || s === 'e') return 'exenta';
                                    if (s === 'invoice') return 'invoice';
                                    return 'ninguno';
                                })(item.tipo_beneficiario),
                                status: 'pendiente',
                                saleId: saleId,
                                eventId: saleId  // ID numérico del evento para Nóminas y CXP
                            });
                        });
                    }
                });
                for (const draft of drafts) {
                    await DS.create('payables', draft);
                }
            }
            // Reload sales and payables (new sale may have auto-created CXP)
            const [freshSales, freshPayables] = await Promise.all([DS.getAll('sales'), DS.getAll('payables')]);
            sales = freshSales || [];
            payables = freshPayables || [];
            buildEventCostsMap();
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
        // Reset filter state on every navigation to this module
        currentFilter = 'pendiente';
        searchQuery = '';

        const DS = window.Mazelab.DataService;

        try {
            const [salesData, clientsData, servicesData, staffData, payablesData] = await Promise.all([
                DS.getAll('sales'),
                DS.getAll('clients'),
                DS.getAll('services'),
                DS.getAll('staff'),
                DS.getAll('payables')
            ]);
            sales = salesData || [];
            clients = clientsData || [];
            services = servicesData || [];
            staff = staffData || [];
            payables = payablesData || [];
            buildEventCostsMap();
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

        // Status filter toggle
        const pendingToggle = document.getElementById('sales-pending-toggle');
        if (pendingToggle) {
            pendingToggle.querySelectorAll('.toggle-option').forEach(btn => {
                btn.addEventListener('click', function () {
                    pendingToggle.querySelectorAll('.toggle-option').forEach(b => b.classList.remove('active'));
                    this.classList.add('active');
                    currentFilter = this.getAttribute('data-filter');
                    refreshTable();
                });
            });
        }

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
