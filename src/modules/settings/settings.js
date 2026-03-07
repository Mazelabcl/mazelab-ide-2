window.Mazelab.Modules.SettingsModule = (function () {
    let servicesData = [];
    let staffData = [];
    let clientsData = [];
    let activeTab = 'servicios';
    let searchQuery = '';
    let editingId = null;

    // --- Helpers ---

    function formatCLP(amount) {
        if (amount == null || isNaN(amount)) return '$0';
        return '$' + Number(amount).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // --- Cost Template Helpers ---

    // Tipos de documento que se usarán al auto-generar CXP desde plantilla de costos.
    // Coinciden exactamente con los docType de CXP para que sea obvio qué documento se creará.
    const CT_TIPO_OPTIONS = [
        { value: 'bh',      label: 'BH (Boleta Honorarios)' },
        { value: 'factura', label: 'Factura' },
        { value: 'exenta',  label: 'F. Exenta' },
        { value: 'invoice', label: 'Invoice' },
        { value: 'ninguno', label: 'Sin documento (transferencia)' }
    ];

    // Normaliza valores legacy (freelancer/proveedor) y abreviaturas del CSV (BH/T/TC)
    function normalizeCTTipo(raw) {
        var s = (raw || '').trim().toLowerCase();
        if (s === 'bh' || s === 'freelancer') return 'bh';
        if (s === 'factura' || s === 'f' || s === 'proveedor' || s === 'tc') return 'factura';
        if (s === 'exenta' || s === 'e') return 'exenta';
        if (s === 'invoice') return 'invoice';
        // T = transferencia directa, staff_fijo, core → sin documento
        return 'ninguno';
    }

    function makeCTItemHTML(concepto, tipoBeneficiario, cantidad, montoUnitario) {
        const subtotal = (cantidad || 1) * (montoUnitario || 0);
        const tipoNorm = normalizeCTTipo(tipoBeneficiario);
        const tipoSel = CT_TIPO_OPTIONS.map(function (t) {
            return '<option value="' + t.value + '"' + (tipoNorm === t.value ? ' selected' : '') + '>' + t.label + '</option>';
        }).join('');
        return '<div class="form-group ct-concepto">' +
                '<label>Concepto</label>' +
                '<input type="text" class="form-control svc-ct-concepto" value="' + escapeHtml(concepto || '') + '" placeholder="Ej: Operador Glambot" />' +
            '</div>' +
            '<div class="form-group ct-tipo">' +
                '<label>Tipo</label>' +
                '<select class="form-control svc-ct-tipo">' + tipoSel + '</select>' +
            '</div>' +
            '<div class="form-group ct-cantidad">' +
                '<label>Cant.</label>' +
                '<input type="number" class="form-control svc-ct-cantidad" min="1" step="1" value="' + (cantidad || 1) + '" />' +
            '</div>' +
            '<div class="form-group ct-monto">' +
                '<label>Monto Unit.</label>' +
                '<input type="number" class="form-control svc-ct-monto" min="0" step="1" value="' + (montoUnitario || '') + '" placeholder="0" />' +
            '</div>' +
            '<div class="form-group ct-subtotal-cell">' +
                '<label>Subtotal</label>' +
                '<div class="svc-ct-subtotal">' + formatCLP(subtotal) + '</div>' +
            '</div>' +
            '<div style="padding-bottom:var(--space-sm)">' +
                '<button type="button" class="btn btn-secondary btn-remove-ct-row" title="Eliminar" style="padding:6px 10px">&#10005;</button>' +
            '</div>';
    }

    function renderCostTemplateRows(items) {
        if (!items || items.length === 0) return '';
        return items.map(function (item) {
            return '<div class="ct-item">' + makeCTItemHTML(item.concepto, item.tipo_beneficiario, item.cantidad, item.monto_unitario) + '</div>';
        }).join('');
    }

    function getCostTemplateFromDOM() {
        const tbody = document.getElementById('svc-cost-template-rows');
        if (!tbody) return [];
        const items = [];
        tbody.querySelectorAll('.ct-item').forEach(function (row) {
            const conceptoEl = row.querySelector('.svc-ct-concepto');
            const tipoEl = row.querySelector('.svc-ct-tipo');
            const cantidadEl = row.querySelector('.svc-ct-cantidad');
            const montoEl = row.querySelector('.svc-ct-monto');
            const concepto = conceptoEl ? conceptoEl.value.trim() : '';
            const tipo = tipoEl ? tipoEl.value : 'freelancer';
            const cantidad = cantidadEl ? (Number(cantidadEl.value) || 1) : 1;
            const monto_unitario = montoEl ? (Number(montoEl.value) || 0) : 0;
            if (concepto || monto_unitario > 0) {
                items.push({ concepto: concepto, tipo_beneficiario: tipo, cantidad: cantidad, monto_unitario: monto_unitario });
            }
        });
        return items;
    }

    function updateCostTemplateTotal() {
        const tbody = document.getElementById('svc-cost-template-rows');
        const totalEl = document.getElementById('svc-ct-total');
        const costoBaseEl = document.getElementById('svc-costo-base');
        if (!tbody) return;
        let total = 0;
        tbody.querySelectorAll('.ct-item').forEach(function (row) {
            const cantidad = Number((row.querySelector('.svc-ct-cantidad') || {}).value) || 0;
            const monto = Number((row.querySelector('.svc-ct-monto') || {}).value) || 0;
            total += cantidad * monto;
        });
        if (totalEl) totalEl.textContent = formatCLP(total);
        if (costoBaseEl && total > 0) costoBaseEl.value = total;
    }

    function bindCostTemplateEvents() {
        const tbody = document.getElementById('svc-cost-template-rows');
        const addBtn = document.getElementById('btn-add-ct-row');
        if (!tbody) return;

        if (addBtn) {
            addBtn.addEventListener('click', function () {
                const div = document.createElement('div');
                div.className = 'ct-item';
                div.innerHTML = makeCTItemHTML('', 'freelancer', 1, '');
                tbody.appendChild(div);
            });
        }

        tbody.addEventListener('click', function (e) {
            const removeBtn = e.target.closest('.btn-remove-ct-row');
            if (removeBtn) {
                removeBtn.closest('.ct-item').remove();
                updateCostTemplateTotal();
            }
        });

        tbody.addEventListener('input', function (e) {
            const el = e.target;
            if (el.classList.contains('svc-ct-cantidad') || el.classList.contains('svc-ct-monto')) {
                const row = el.closest('.ct-item');
                const cantidad = Number(row.querySelector('.svc-ct-cantidad').value) || 0;
                const monto = Number(row.querySelector('.svc-ct-monto').value) || 0;
                const subtotalCell = row.querySelector('.svc-ct-subtotal');
                if (subtotalCell) subtotalCell.textContent = formatCLP(cantidad * monto);
                updateCostTemplateTotal();
            }
        });
    }

    // --- Rendering ---

    function render() {
        return `
        <div class="content-header">
            <h1>Configuracion</h1>
        </div>
        <div class="content-body">
            <div class="tabs">
                <button class="tab ${activeTab === 'servicios' ? 'active' : ''}" data-tab="servicios">Servicios</button>
                <button class="tab ${activeTab === 'staff' ? 'active' : ''}" data-tab="staff">Staff</button>
                <button class="tab ${activeTab === 'clientes' ? 'active' : ''}" data-tab="clientes">Clientes</button>
                <button class="tab ${activeTab === 'empresa' ? 'active' : ''}" data-tab="empresa">Empresa</button>
            </div>
            <div id="settings-tab-content">
                ${renderTabContent()}
            </div>
        </div>

        <!-- Modal -->
        <div class="modal-overlay" id="settings-modal-overlay">
            <div class="modal">
                <div class="modal-header">
                    <h2 id="settings-modal-title"></h2>
                    <button class="modal-close" id="settings-modal-close">&times;</button>
                </div>
                <form id="settings-form">
                    <div id="settings-modal-body"></div>
                    <div class="form-actions">
                        <button type="button" class="btn-secondary" id="settings-cancel-btn">Cancelar</button>
                        <button type="submit" class="btn-primary" id="settings-save-btn">Guardar</button>
                    </div>
                </form>
            </div>
        </div>`;
    }

    function renderTabContent() {
        switch (activeTab) {
            case 'servicios': return renderServiciosTab();
            case 'staff': return renderStaffTab();
            case 'clientes': return renderClientesTab();
            case 'empresa': return renderEmpresaTab();
            default: return '';
        }
    }

    function renderEmpresaTab() {
        var info = {};
        try { info = JSON.parse(localStorage.getItem('mazelab_company_info') || '{}'); } catch (e) {}
        return `
        <div class="card" style="max-width:640px">
            <div class="card-header"><h3 class="card-title">Datos de la Empresa</h3></div>
            <div style="padding:var(--space-md)">
                <p style="color:var(--text-secondary);font-size:13px;margin-bottom:16px">
                    Esta información se incluye automáticamente en los mensajes de cobro.
                </p>
                <div class="form-row">
                    <div class="form-group">
                        <label>Nombre de la Empresa</label>
                        <input type="text" id="emp-nombre" class="form-control" value="${escapeHtml(info.nombre || '')}" placeholder="Ej: Mazelab Productions">
                    </div>
                    <div class="form-group">
                        <label>RUT Empresa</label>
                        <input type="text" id="emp-rut" class="form-control" value="${escapeHtml(info.rut || '')}" placeholder="Ej: 12.345.678-9">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Banco</label>
                        <input type="text" id="emp-banco" class="form-control" value="${escapeHtml(info.banco || '')}" placeholder="Ej: Banco Estado">
                    </div>
                    <div class="form-group">
                        <label>Tipo de Cuenta</label>
                        <input type="text" id="emp-tipocuenta" class="form-control" value="${escapeHtml(info.tipoCuenta || '')}" placeholder="Ej: Cuenta Corriente">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Número de Cuenta</label>
                        <input type="text" id="emp-cuenta" class="form-control" value="${escapeHtml(info.numeroCuenta || '')}" placeholder="Ej: 123456789">
                    </div>
                    <div class="form-group">
                        <label>Email de Contacto</label>
                        <input type="text" id="emp-email" class="form-control" value="${escapeHtml(info.email || '')}" placeholder="Ej: admin@empresa.cl">
                    </div>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn btn-primary" id="emp-save-btn">Guardar Datos</button>
                    <span id="emp-save-msg" style="display:none;color:var(--success);font-size:13px;margin-left:12px">&#10003; Guardado</span>
                </div>
            </div>
        </div>`;
    }

    // --- Servicios Tab ---

    function getFilteredServices() {
        if (!searchQuery) return servicesData;
        const q = searchQuery.toLowerCase();
        return servicesData.filter(s => {
            const name = (s.name || s.nombre || '').toLowerCase();
            const desc = (s.descripcion || '').toLowerCase();
            return name.includes(q) || desc.includes(q);
        });
    }

    function renderServiciosTab() {
        const filtered = getFilteredServices();
        const rows = filtered.length === 0
            ? '<tr><td colspan="7" style="text-align:center;padding:2rem;color:#888;">No se encontraron servicios</td></tr>'
            : filtered.map(s => {
                const name = s.name || s.nombre || '';
                const durLabel = s.duracion_default != null ? s.duracion_default + ' ' + (s.duracion_tipo || '') : (s.duracion_tipo || '');
                const featuredBadge = s.featured ? '<span class="badge-info">Featured</span>' : '';
                const statusBadge = s.activo !== false
                    ? '<span class="badge-success">Activo</span>'
                    : '<span class="badge-danger">Inactivo</span>';
                const ctItems = Array.isArray(s.cost_template) ? s.cost_template : [];
                const ctTotal = ctItems.reduce(function(acc, i){ return acc + (i.cantidad || 1) * (i.monto_unitario || 0); }, 0);
                const costoDisplay = ctTotal > 0
                    ? formatCLP(ctTotal) + ' <span class="badge-info" style="font-size:10px">' + ctItems.length + ' ítems</span>'
                    : formatCLP(s.costo_base_estimado);
                return `
                <tr data-id="${s.id}">
                    <td>${escapeHtml(name)}</td>
                    <td>${formatCLP(s.precio_base)}</td>
                    <td>${costoDisplay}</td>
                    <td>${escapeHtml(durLabel)}</td>
                    <td>${featuredBadge}</td>
                    <td>${statusBadge}</td>
                    <td>
                        <button class="btn-icon btn-edit-item" data-id="${s.id}" data-type="servicios" title="Editar">
                            <i class="icon-edit">&#9998;</i>
                        </button>
                        <button class="btn-icon btn-delete-item" data-id="${s.id}" data-type="servicios" title="Eliminar">
                            <i class="icon-delete">&#128465;</i>
                        </button>
                    </td>
                </tr>`;
            }).join('');

        return `
            <div class="toolbar">
                <div class="search-bar">
                    <input type="text" id="settings-search" class="form-control" placeholder="Buscar servicios..." value="${escapeHtml(searchQuery)}" />
                </div>
                <button class="btn-primary" id="btn-new-item" data-type="servicios">Nuevo Servicio</button>
            </div>
            <table class="data-table" id="settings-table">
                <thead>
                    <tr>
                        <th>Nombre</th>
                        <th>Precio Base</th>
                        <th>Costo Base</th>
                        <th>Duracion</th>
                        <th>Featured</th>
                        <th>Estado</th>
                        <th>Acciones</th>
                    </tr>
                </thead>
                <tbody id="settings-table-body">
                    ${rows}
                </tbody>
            </table>`;
    }

    function renderServiceForm(service) {
        const s = service || {};
        const name = s.name || s.nombre || '';
        // Categorías dinámicas: las que ya existen en los servicios cargados + mínimo predeterminado
        const DEFAULT_CATS = ['Fotograficas', 'Cineticas', 'Digitales', 'Display', 'Otros'];
        const existingCats = servicesData
            .map(sv => (sv.categoria || '').trim())
            .filter(Boolean);
        const allCats = Array.from(new Set([...existingCats, ...DEFAULT_CATS])).sort();
        const duracionTipos = ['horas', 'jornada', 'dias'];

        return `
            <div class="form-row">
                <div class="form-group">
                    <label for="svc-nombre">Nombre</label>
                    <input type="text" id="svc-nombre" class="form-control" value="${escapeHtml(name)}" required />
                </div>
                <div class="form-group">
                    <label for="svc-categoria">Categoria <span style="font-weight:400;color:var(--text-muted)">(escribe o elige)</span></label>
                    <input type="text" id="svc-categoria" class="form-control" list="svc-categoria-list"
                        value="${escapeHtml(s.categoria || '')}" placeholder="Ej: Cineticas" autocomplete="off" />
                    <datalist id="svc-categoria-list">
                        ${allCats.map(c => `<option value="${escapeHtml(c)}">`).join('')}
                    </datalist>
                </div>
            </div>
            <div class="form-group">
                <label for="svc-descripcion">Descripcion</label>
                <textarea id="svc-descripcion" class="form-control" rows="2">${escapeHtml(s.descripcion || '')}</textarea>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label for="svc-precio-base">Precio Base</label>
                    <input type="number" id="svc-precio-base" class="form-control" min="0" step="1" value="${s.precio_base != null ? s.precio_base : ''}" />
                </div>
                <div class="form-group">
                    <label for="svc-costo-base">Costo Base Estimado</label>
                    <input type="number" id="svc-costo-base" class="form-control" min="0" step="1" value="${s.costo_base_estimado != null ? s.costo_base_estimado : ''}" />
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label for="svc-duracion-tipo">Tipo Duracion</label>
                    <select id="svc-duracion-tipo" class="form-control">
                        <option value="">Seleccionar...</option>
                        ${duracionTipos.map(d => `<option value="${d}" ${(s.duracion_tipo === d) ? 'selected' : ''}>${d.charAt(0).toUpperCase() + d.slice(1)}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label for="svc-duracion-default">Duracion Default</label>
                    <input type="number" id="svc-duracion-default" class="form-control" min="0" step="0.5" value="${s.duracion_default != null ? s.duracion_default : ''}" />
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="checkbox-label">
                        <input type="checkbox" id="svc-featured" ${s.featured ? 'checked' : ''} />
                        Featured
                    </label>
                </div>
                <div class="form-group">
                    <label class="checkbox-label">
                        <input type="checkbox" id="svc-activo" ${s.activo !== false ? 'checked' : ''} />
                        Activo
                    </label>
                </div>
            </div>

            <div class="form-group" style="margin-top:var(--space-lg);border-top:1px solid var(--border-color);padding-top:var(--space-md)">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-md)">
                    <label style="margin:0;font-weight:600">Plantilla de Costos</label>
                    <button type="button" class="btn btn-secondary" id="btn-add-ct-row">+ Agregar costo</button>
                </div>
                <div id="svc-cost-template-rows">
                    ${renderCostTemplateRows(s.cost_template || [])}
                </div>
                <div style="text-align:right;margin-top:var(--space-sm);font-size:13px;color:var(--text-secondary)">
                    Total plantilla: <strong id="svc-ct-total">${formatCLP((s.cost_template || []).reduce(function(acc, i){ return acc + (i.cantidad || 1) * (i.monto_unitario || 0); }, 0))}</strong>
                </div>
            </div>`;
    }

    function getServiceFormData() {
        const costTemplate = getCostTemplateFromDOM();
        const templateTotal = costTemplate.reduce(function(acc, i){ return acc + i.cantidad * i.monto_unitario; }, 0);
        const costoBaseRaw = document.getElementById('svc-costo-base').value;
        const costoBase = templateTotal > 0 ? templateTotal : (costoBaseRaw ? Number(costoBaseRaw) : null);
        return {
            nombre: document.getElementById('svc-nombre').value.trim(),
            categoria: document.getElementById('svc-categoria').value,
            descripcion: document.getElementById('svc-descripcion').value.trim(),
            precio_base: document.getElementById('svc-precio-base').value ? Number(document.getElementById('svc-precio-base').value) : null,
            costo_base_estimado: costoBase,
            duracion_tipo: document.getElementById('svc-duracion-tipo').value || null,
            duracion_default: document.getElementById('svc-duracion-default').value ? Number(document.getElementById('svc-duracion-default').value) : null,
            featured: document.getElementById('svc-featured').checked,
            activo: document.getElementById('svc-activo').checked,
            cost_template: costTemplate
        };
    }

    // --- Staff Tab ---

    function getFilteredStaff() {
        if (!searchQuery) return staffData;
        const q = searchQuery.toLowerCase();
        return staffData.filter(s => {
            const name = (s.name || s.nombre || '').toLowerCase();
            const esp = (s.especialidad || '').toLowerCase();
            const email = (s.email || '').toLowerCase();
            return name.includes(q) || esp.includes(q) || email.includes(q);
        });
    }

    function getStaffTypeBadge(tipo) {
        const map = {
            core: 'badge-primary',
            freelancer: 'badge-info',
            staff_fijo: 'badge-success',
            proveedor: 'badge-warning'
        };
        const cls = map[tipo] || 'badge-secondary';
        const label = tipo ? tipo.charAt(0).toUpperCase() + tipo.slice(1).replace('_', ' ') : '';
        return `<span class="${cls}">${label}</span>`;
    }

    function renderStaffTab() {
        const filtered = getFilteredStaff();
        const rows = filtered.length === 0
            ? '<tr><td colspan="6" style="text-align:center;padding:2rem;color:#888;">No se encontro staff</td></tr>'
            : filtered.map(s => {
                const name = s.name || s.nombre || '';
                const tipo = s.type || s.tipo || '';
                const docTipo = s.tipo_documento === 'factura' ? 'Factura' : (s.tipo_documento === 'bh' ? 'Boleta' : (s.tipo_documento || ''));
                return `
                <tr data-id="${s.id}">
                    <td>${escapeHtml(name)}</td>
                    <td>${getStaffTypeBadge(tipo)}</td>
                    <td>${escapeHtml(s.especialidad || '')}</td>
                    <td>${escapeHtml(docTipo)}</td>
                    <td>${escapeHtml(s.email || '')}</td>
                    <td>
                        <button class="btn-icon btn-edit-item" data-id="${s.id}" data-type="staff" title="Editar">
                            <i class="icon-edit">&#9998;</i>
                        </button>
                        <button class="btn-icon btn-delete-item" data-id="${s.id}" data-type="staff" title="Eliminar">
                            <i class="icon-delete">&#128465;</i>
                        </button>
                    </td>
                </tr>`;
            }).join('');

        return `
            <div class="toolbar">
                <div class="search-bar">
                    <input type="text" id="settings-search" class="form-control" placeholder="Buscar staff..." value="${escapeHtml(searchQuery)}" />
                </div>
                <button class="btn-primary" id="btn-new-item" data-type="staff">Nuevo Staff</button>
            </div>
            <table class="data-table" id="settings-table">
                <thead>
                    <tr>
                        <th>Nombre</th>
                        <th>Tipo</th>
                        <th>Especialidad</th>
                        <th>Documento</th>
                        <th>Email</th>
                        <th>Acciones</th>
                    </tr>
                </thead>
                <tbody id="settings-table-body">
                    ${rows}
                </tbody>
            </table>`;
    }

    function renderStaffForm(member) {
        const s = member || {};
        const name = s.name || s.nombre || '';
        const tipo = s.type || s.tipo || '';
        const tipos = ['core', 'freelancer', 'staff_fijo', 'proveedor'];
        const docTipos = ['bh', 'factura'];

        return `
            <div class="form-row">
                <div class="form-group">
                    <label for="staff-nombre">Nombre</label>
                    <input type="text" id="staff-nombre" class="form-control" value="${escapeHtml(name)}" required />
                </div>
                <div class="form-group">
                    <label for="staff-tipo">Tipo</label>
                    <select id="staff-tipo" class="form-control">
                        <option value="">Seleccionar...</option>
                        ${tipos.map(t => `<option value="${t}" ${(tipo === t) ? 'selected' : ''}>${t.charAt(0).toUpperCase() + t.slice(1).replace('_', ' ')}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label for="staff-especialidad">Especialidad</label>
                    <input type="text" id="staff-especialidad" class="form-control" value="${escapeHtml(s.especialidad || '')}" />
                </div>
                <div class="form-group">
                    <label for="staff-tipo-documento">Tipo Documento</label>
                    <select id="staff-tipo-documento" class="form-control">
                        <option value="">Seleccionar...</option>
                        ${docTipos.map(d => `<option value="${d}" ${(s.tipo_documento === d) ? 'selected' : ''}>${d === 'bh' ? 'Boleta de Honorarios' : 'Factura'}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label for="staff-rut">RUT</label>
                    <input type="text" id="staff-rut" class="form-control" value="${escapeHtml(s.rut || '')}" />
                </div>
                <div class="form-group">
                    <label for="staff-banco">Banco</label>
                    <input type="text" id="staff-banco" class="form-control" value="${escapeHtml(s.banco || '')}" />
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label for="staff-tipo-cuenta">Tipo Cuenta</label>
                    <input type="text" id="staff-tipo-cuenta" class="form-control" value="${escapeHtml(s.tipo_cuenta || '')}" />
                </div>
                <div class="form-group">
                    <label for="staff-numero-cuenta">Numero Cuenta</label>
                    <input type="text" id="staff-numero-cuenta" class="form-control" value="${escapeHtml(s.numero_cuenta || '')}" />
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label for="staff-email">Email</label>
                    <input type="email" id="staff-email" class="form-control" value="${escapeHtml(s.email || '')}" />
                </div>
                <div class="form-group">
                    <label for="staff-telefono">Telefono</label>
                    <input type="text" id="staff-telefono" class="form-control" value="${escapeHtml(s.telefono || '')}" />
                </div>
            </div>`;
    }

    function getStaffFormData() {
        return {
            nombre: document.getElementById('staff-nombre').value.trim(),
            tipo: document.getElementById('staff-tipo').value || null,
            especialidad: document.getElementById('staff-especialidad').value.trim() || null,
            tipo_documento: document.getElementById('staff-tipo-documento').value || null,
            rut: document.getElementById('staff-rut').value.trim() || null,
            banco: document.getElementById('staff-banco').value.trim() || null,
            tipo_cuenta: document.getElementById('staff-tipo-cuenta').value.trim() || null,
            numero_cuenta: document.getElementById('staff-numero-cuenta').value.trim() || null,
            email: document.getElementById('staff-email').value.trim() || null,
            telefono: document.getElementById('staff-telefono').value.trim() || null
        };
    }

    // --- Clientes Tab ---

    function getFilteredClients() {
        if (!searchQuery) return clientsData;
        const q = searchQuery.toLowerCase();
        return clientsData.filter(c => {
            const name = (c.name || c.nombre || '').toLowerCase();
            const rut = (c.rut || '').toLowerCase();
            return name.includes(q) || rut.includes(q);
        });
    }

    function renderClientesTab() {
        const filtered = getFilteredClients();
        const rows = filtered.length === 0
            ? '<tr><td colspan="6" style="text-align:center;padding:2rem;color:#888;">No se encontraron clientes</td></tr>'
            : filtered.map(c => {
                const name = c.name || c.nombre || '';
                const ejecutivos = Array.isArray(c.ejecutivos) ? c.ejecutivos.join(', ') : (c.ejecutivos || '');
                const statusBadge = c.activo !== false
                    ? '<span class="badge-success">Activo</span>'
                    : '<span class="badge-danger">Inactivo</span>';
                return `
                <tr data-id="${c.id}">
                    <td>${escapeHtml(name)}</td>
                    <td>${escapeHtml(c.rut || '')}</td>
                    <td>${c.plazo_pago != null ? c.plazo_pago : 30} dias</td>
                    <td>${escapeHtml(ejecutivos)}</td>
                    <td>${statusBadge}</td>
                    <td>
                        <button class="btn-icon btn-edit-item" data-id="${c.id}" data-type="clientes" title="Editar">
                            <i class="icon-edit">&#9998;</i>
                        </button>
                        <button class="btn-icon btn-delete-item" data-id="${c.id}" data-type="clientes" title="Eliminar">
                            <i class="icon-delete">&#128465;</i>
                        </button>
                    </td>
                </tr>`;
            }).join('');

        return `
            <div class="toolbar">
                <div class="search-bar">
                    <input type="text" id="settings-search" class="form-control" placeholder="Buscar clientes..." value="${escapeHtml(searchQuery)}" />
                </div>
                <button class="btn-primary" id="btn-new-item" data-type="clientes">Nuevo Cliente</button>
            </div>
            <table class="data-table" id="settings-table">
                <thead>
                    <tr>
                        <th>Nombre</th>
                        <th>RUT</th>
                        <th>Plazo Pago</th>
                        <th>Ejecutivos</th>
                        <th>Estado</th>
                        <th>Acciones</th>
                    </tr>
                </thead>
                <tbody id="settings-table-body">
                    ${rows}
                </tbody>
            </table>`;
    }

    function renderClientForm(client) {
        const c = client || {};
        const name = c.name || c.nombre || '';
        const ejecutivos = Array.isArray(c.ejecutivos) ? c.ejecutivos.join(', ') : (c.ejecutivos || '');

        return `
            <div class="form-row">
                <div class="form-group">
                    <label for="client-nombre">Nombre</label>
                    <input type="text" id="client-nombre" class="form-control" value="${escapeHtml(name)}" required />
                </div>
                <div class="form-group">
                    <label for="client-rut">RUT</label>
                    <input type="text" id="client-rut" class="form-control" value="${escapeHtml(c.rut || '')}" />
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label for="client-plazo-pago">Plazo de Pago (dias)</label>
                    <input type="number" id="client-plazo-pago" class="form-control" min="0" step="1" value="${c.plazo_pago != null ? c.plazo_pago : 30}" />
                </div>
                <div class="form-group">
                    <label class="checkbox-label">
                        <input type="checkbox" id="client-activo" ${c.activo !== false ? 'checked' : ''} />
                        Activo
                    </label>
                </div>
            </div>
            <div class="form-group">
                <label for="client-ejecutivos">Ejecutivos (separados por coma)</label>
                <input type="text" id="client-ejecutivos" class="form-control" value="${escapeHtml(ejecutivos)}" placeholder="Ej: Juan Perez, Maria Lopez" />
            </div>
            <div class="form-group">
                <label for="client-notas">Notas</label>
                <textarea id="client-notas" class="form-control" rows="3">${escapeHtml(c.notas || '')}</textarea>
            </div>`;
    }

    function getClientFormData() {
        const ejecutivosRaw = document.getElementById('client-ejecutivos').value.trim();
        const ejecutivos = ejecutivosRaw
            ? ejecutivosRaw.split(',').map(e => e.trim()).filter(Boolean)
            : [];

        return {
            nombre: document.getElementById('client-nombre').value.trim(),
            rut: document.getElementById('client-rut').value.trim() || null,
            plazo_pago: document.getElementById('client-plazo-pago').value ? Number(document.getElementById('client-plazo-pago').value) : 30,
            ejecutivos: ejecutivos,
            notas: document.getElementById('client-notas').value.trim() || null,
            activo: document.getElementById('client-activo').checked
        };
    }

    // --- Modal Logic ---

    function openModal(type, item) {
        const overlay = document.getElementById('settings-modal-overlay');
        const title = document.getElementById('settings-modal-title');
        const body = document.getElementById('settings-modal-body');
        if (!overlay || !body) return;

        editingId = item ? item.id : null;

        const labels = {
            servicios: 'Servicio',
            staff: 'Staff',
            clientes: 'Cliente'
        };
        const label = labels[type] || type;
        title.textContent = (item ? 'Editar ' : 'Nuevo ') + label;

        const modalEl = overlay.querySelector('.modal');

        switch (type) {
            case 'servicios':
                body.innerHTML = renderServiceForm(item);
                if (modalEl) modalEl.classList.add('modal-wide');
                bindCostTemplateEvents();
                break;
            case 'staff':
                body.innerHTML = renderStaffForm(item);
                if (modalEl) modalEl.classList.remove('modal-wide');
                break;
            case 'clientes':
                body.innerHTML = renderClientForm(item);
                if (modalEl) modalEl.classList.remove('modal-wide');
                break;
        }

        // Store current type on the form for save handler
        document.getElementById('settings-form').dataset.entityType = type;
        overlay.classList.add('active');
    }

    function closeModal() {
        const overlay = document.getElementById('settings-modal-overlay');
        if (overlay) overlay.classList.remove('active');
        editingId = null;
    }

    // --- Data operations ---

    function getEntityType() {
        const form = document.getElementById('settings-form');
        return form ? form.dataset.entityType : activeTab;
    }

    function getDataServiceKey(type) {
        // Map tab names to DataService entity types
        const map = { servicios: 'services', staff: 'staff', clientes: 'clients' };
        return map[type] || type;
    }

    function getDataArray(type) {
        switch (type) {
            case 'servicios': return servicesData;
            case 'staff': return staffData;
            case 'clientes': return clientsData;
            default: return [];
        }
    }

    function setDataArray(type, data) {
        switch (type) {
            case 'servicios': servicesData = data; break;
            case 'staff': staffData = data; break;
            case 'clientes': clientsData = data; break;
        }
    }

    function getFormData(type) {
        switch (type) {
            case 'servicios': return getServiceFormData();
            case 'staff': return getStaffFormData();
            case 'clientes': return getClientFormData();
            default: return {};
        }
    }

    async function handleSave(e) {
        e.preventDefault();
        const type = getEntityType();
        const dsKey = getDataServiceKey(type);
        const data = getFormData(type);
        const DS = window.Mazelab.DataService;

        try {
            if (editingId) {
                await DS.update(dsKey, editingId, data);
            } else {
                data.id = window.Mazelab.Storage.generateId();
                await DS.create(dsKey, data);
            }
            const freshData = await DS.getAll(dsKey) || [];
            setDataArray(type, freshData);
            refreshTabContent();
            closeModal();
        } catch (err) {
            console.error('Error guardando ' + type + ':', err);
            alert('Error al guardar. Intente nuevamente.');
        }
    }

    async function handleDelete(type, id) {
        const labels = { servicios: 'servicio', staff: 'miembro de staff', clientes: 'cliente' };
        const label = labels[type] || 'registro';
        if (!confirm('¿Esta seguro de que desea eliminar este ' + label + '?')) return;

        const dsKey = getDataServiceKey(type);
        const DS = window.Mazelab.DataService;

        try {
            await DS.remove(dsKey, id);
            const freshData = await DS.getAll(dsKey) || [];
            setDataArray(type, freshData);
            refreshTabContent();
        } catch (err) {
            console.error('Error eliminando ' + type + ':', err);
            alert('Error al eliminar. Intente nuevamente.');
        }
    }

    // --- Refresh ---

    function refreshTabContent() {
        const container = document.getElementById('settings-tab-content');
        if (container) {
            container.innerHTML = renderTabContent();
            bindTabContentEvents();
        }
    }

    function bindTabContentEvents() {
        // Search
        const searchInput = document.getElementById('settings-search');
        if (searchInput) {
            searchInput.addEventListener('input', function () {
                searchQuery = this.value.trim();
                refreshTabContent();
                // Restore focus and cursor to search input after re-render
                const newInput = document.getElementById('settings-search');
                if (newInput) {
                    newInput.focus();
                    newInput.setSelectionRange(newInput.value.length, newInput.value.length);
                }
            });
        }

        // New button
        const newBtn = document.getElementById('btn-new-item');
        if (newBtn) {
            newBtn.addEventListener('click', function () {
                const type = this.getAttribute('data-type');
                openModal(type, null);
            });
        }

        // Empresa tab save
        var empSaveBtn = document.getElementById('emp-save-btn');
        if (empSaveBtn) {
            empSaveBtn.addEventListener('click', function () {
                var info = {
                    nombre:       (document.getElementById('emp-nombre').value || '').trim(),
                    rut:          (document.getElementById('emp-rut').value || '').trim(),
                    banco:        (document.getElementById('emp-banco').value || '').trim(),
                    tipoCuenta:   (document.getElementById('emp-tipocuenta').value || '').trim(),
                    numeroCuenta: (document.getElementById('emp-cuenta').value || '').trim(),
                    email:        (document.getElementById('emp-email').value || '').trim()
                };
                localStorage.setItem('mazelab_company_info', JSON.stringify(info));
                var msg = document.getElementById('emp-save-msg');
                if (msg) { msg.style.display = 'inline'; setTimeout(function () { msg.style.display = 'none'; }, 2000); }
            });
        }

        // Table edit/delete delegation
        const tbody = document.getElementById('settings-table-body');
        if (tbody) {
            tbody.addEventListener('click', function (e) {
                const editBtn = e.target.closest('.btn-edit-item');
                const deleteBtn = e.target.closest('.btn-delete-item');

                if (editBtn) {
                    const id = editBtn.getAttribute('data-id');
                    const type = editBtn.getAttribute('data-type');
                    const dataArray = getDataArray(type);
                    const item = dataArray.find(i => String(i.id) === String(id));
                    if (item) openModal(type, item);
                }

                if (deleteBtn) {
                    const id = deleteBtn.getAttribute('data-id');
                    const type = deleteBtn.getAttribute('data-type');
                    handleDelete(type, id);
                }
            });
        }
    }

    // --- Init ---

    async function init() {
        const DS = window.Mazelab.DataService;

        try {
            const [svcData, stfData, cltData] = await Promise.all([
                DS.getAll('services'),
                DS.getAll('staff'),
                DS.getAll('clients')
            ]);
            servicesData = svcData || [];
            staffData = stfData || [];
            clientsData = cltData || [];
        } catch (err) {
            console.error('Error cargando datos de configuracion:', err);
            servicesData = [];
            staffData = [];
            clientsData = [];
        }

        refreshTabContent();

        // Tab switching
        const tabButtons = document.querySelectorAll('.tabs .tab');
        tabButtons.forEach(btn => {
            btn.addEventListener('click', function () {
                tabButtons.forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                activeTab = this.getAttribute('data-tab');
                searchQuery = '';
                refreshTabContent();
            });
        });

        // Modal close
        const closeBtn = document.getElementById('settings-modal-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', closeModal);
        }
        const cancelBtn = document.getElementById('settings-cancel-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', closeModal);
        }

        // Click outside modal
        const overlay = document.getElementById('settings-modal-overlay');
        if (overlay) {
            overlay.addEventListener('click', function (e) {
                if (e.target === overlay) closeModal();
            });
        }

        // Form submit
        const form = document.getElementById('settings-form');
        if (form) {
            form.addEventListener('submit', handleSave);
        }
    }

    return { render, init };
})();
