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

    function bindEquiposChecklistEvents() {
        const list = document.getElementById('svc-eq-items-list');
        const addBtn = document.getElementById('svc-eq-add-btn');
        const catInput = document.getElementById('svc-eq-new-cat');
        const labelInput = document.getElementById('svc-eq-new-label');
        if (!list || !addBtn) return;

        function makeItemHTML(cat, label) {
            return `<div class="svc-eq-item" data-categoria="${escapeHtml(cat)}" data-label="${escapeHtml(label)}" style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
                <span style="font-size:11px;background:rgba(167,139,250,0.12);color:#a78bfa;border:1px solid rgba(167,139,250,0.3);padding:2px 8px;border-radius:12px;white-space:nowrap;min-width:70px;text-align:center">${escapeHtml(cat || '—')}</span>
                <span style="flex:1;font-size:13px">${escapeHtml(label)}</span>
                <button type="button" class="svc-eq-del-btn" style="background:none;border:none;color:#f87171;cursor:pointer;font-size:18px;padding:0 4px;line-height:1" title="Eliminar">&times;</button>
            </div>`;
        }

        function addItem() {
            const cat = catInput ? catInput.value.trim() : '';
            const label = labelInput ? labelInput.value.trim() : '';
            if (!label) return;
            const empty = list.querySelector('.svc-eq-empty');
            if (empty) empty.remove();
            list.insertAdjacentHTML('beforeend', makeItemHTML(cat, label));
            if (catInput) catInput.value = '';
            if (labelInput) { labelInput.value = ''; labelInput.focus(); }
        }

        addBtn.addEventListener('click', addItem);
        if (labelInput) labelInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } });
        list.addEventListener('click', e => {
            if (e.target.classList.contains('svc-eq-del-btn')) {
                e.target.closest('.svc-eq-item').remove();
                if (!list.querySelector('.svc-eq-item')) {
                    list.innerHTML = '<div class="svc-eq-empty" style="color:var(--text-muted);font-size:13px;padding:6px 0">Sin equipos definidos.</div>';
                }
            }
        });
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

    function makeTarifItemHTML(label, desc, unitario, className) {
        return '<div class="form-group tarif-label"><input type="text" class="form-control tarif-item-label" value="' + escapeHtml(label) + '" placeholder="Nombre"></div>' +
            '<div class="form-group tarif-desc"><input type="text" class="form-control tarif-item-desc" value="' + escapeHtml(desc) + '" placeholder="Descripcion breve"></div>' +
            '<div class="form-group tarif-price"><input type="number" class="form-control tarif-item-unit" value="' + (unitario || '') + '" min="0" placeholder="Precio"></div>' +
            '<div style="padding-bottom:var(--space-sm)"><button type="button" class="btn btn-secondary btn-remove-tarif" style="padding:6px 10px">&#10005;</button></div>';
    }

    function bindTarifarioEvents() {
        // Add adicional
        var addAdic = document.getElementById('btn-add-tarif-adicional');
        if (addAdic) {
            addAdic.addEventListener('click', function() {
                var container = document.getElementById('tarif-adicionales-list');
                if (!container) return;
                var div = document.createElement('div');
                div.className = 'tarif-item tarif-adicional';
                div.innerHTML = makeTarifItemHTML('', '', '', 'tarif-adicional');
                container.appendChild(div);
            });
        }
        // Add pack
        var addPack = document.getElementById('btn-add-tarif-pack');
        if (addPack) {
            addPack.addEventListener('click', function() {
                var container = document.getElementById('tarif-packs-list');
                if (!container) return;
                var div = document.createElement('div');
                div.className = 'tarif-item tarif-pack';
                div.innerHTML = makeTarifItemHTML('', '', '', 'tarif-pack');
                container.appendChild(div);
            });
        }
        // Remove delegation
        document.querySelectorAll('#tarif-adicionales-list, #tarif-packs-list').forEach(function(list) {
            list.addEventListener('click', function(e) {
                var btn = e.target.closest('.btn-remove-tarif');
                if (btn) btn.closest('.tarif-item').remove();
            });
        });
    }

    function bindAccordionEvents() {
        document.querySelectorAll('.accordion-header').forEach(function(header) {
            header.addEventListener('click', function() {
                this.closest('.accordion-section').classList.toggle('open');
            });
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
                <button class="tab ${activeTab === 'ia' ? 'active' : ''}" data-tab="ia">Inteligencia Artificial</button>
                ${window.Mazelab.Auth && window.Mazelab.Auth.canManageUsers() ? '<button class="tab ' + (activeTab === 'usuarios' ? 'active' : '') + '" data-tab="usuarios">Usuarios</button>' : ''}
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
            case 'ia': return renderIATab();
            case 'usuarios': return renderUsuariosTab();
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

    // --- Inteligencia Artificial Tab ---

    function renderIATab() {
        var AI = window.Mazelab.AIService;
        var config = AI ? AI.getConfig() : { apiKey: '', model: 'claude-sonnet-4-20250514', prompts: {} };
        var defaults = AI ? AI.getDefaultPrompts() : { cobranza: '', cotizador: '' };
        var maskedKey = config.apiKey ? config.apiKey.substring(0, 10) + '...' + config.apiKey.slice(-4) : '';

        return `
        <div class="card" style="max-width:720px">
            <div class="card-header"><h3 class="card-title">Inteligencia Artificial</h3></div>
            <div style="padding:var(--space-md)">
                <p style="color:var(--text-secondary);font-size:13px;margin-bottom:16px">
                    Configura la conexión a Claude API para generar mensajes de cobranza y cotizaciones con IA.
                    La API Key se guarda solo en tu navegador y nunca se envía a nuestros servidores.
                </p>

                <div class="form-row">
                    <div class="form-group" style="flex:2">
                        <label>API Key de Claude</label>
                        <div style="display:flex;gap:8px">
                            <input type="password" id="ia-apikey" class="form-control" value="${escapeHtml(config.apiKey)}" placeholder="sk-ant-api03-...">
                            <button type="button" class="btn btn-secondary" id="ia-toggle-key" style="white-space:nowrap;padding:0 12px" title="Mostrar/ocultar key">&#128065;</button>
                        </div>
                    </div>
                    <div class="form-group" style="flex:1">
                        <label>Modelo</label>
                        <select id="ia-model" class="form-control">
                            <option value="claude-sonnet-4-20250514" ${config.model === 'claude-sonnet-4-20250514' ? 'selected' : ''}>Claude Sonnet 4</option>
                            <option value="claude-opus-4-0-20250115" ${config.model === 'claude-opus-4-0-20250115' ? 'selected' : ''}>Claude Opus 4</option>
                            <option value="claude-haiku-3-5-20241022" ${config.model === 'claude-haiku-3-5-20241022' ? 'selected' : ''}>Claude Haiku 3.5</option>
                        </select>
                    </div>
                </div>

                <div class="form-group">
                    <label>
                        System Prompt: Cobranza
                        <button type="button" class="btn btn-secondary" id="ia-reset-cobranza" style="font-size:11px;padding:2px 8px;margin-left:8px">Restaurar default</button>
                    </label>
                    <textarea id="ia-prompt-cobranza" class="form-control" rows="6" placeholder="Instrucciones para generar mensajes de cobro...">${escapeHtml(config.prompts.cobranza || '')}</textarea>
                </div>

                <div class="form-group">
                    <label>
                        System Prompt: Cotizador
                        <button type="button" class="btn btn-secondary" id="ia-reset-cotizador" style="font-size:11px;padding:2px 8px;margin-left:8px">Restaurar default</button>
                    </label>
                    <textarea id="ia-prompt-cotizador" class="form-control" rows="6" placeholder="Instrucciones para el agente cotizador...">${escapeHtml(config.prompts.cotizador || '')}</textarea>
                </div>

                <div class="form-actions" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
                    <button type="button" class="btn btn-primary" id="ia-save-btn">Guardar</button>
                    <button type="button" class="btn btn-secondary" id="ia-test-btn">Probar Conexión</button>
                    <span id="ia-save-msg" style="display:none;color:var(--success);font-size:13px">&#10003; Guardado</span>
                    <span id="ia-test-msg" style="font-size:13px"></span>
                </div>
            </div>
        </div>`;
    }

    // --- Usuarios Tab (superadmin only) ---

    var usersData = [];

    function renderUsuariosTab() {
        var Auth = window.Mazelab.Auth;
        if (!Auth || !Auth.canManageUsers()) return '<p style="color:var(--text-secondary);padding:1rem;">Acceso restringido.</p>';

        var currentUser = Auth.getUser();
        var isSuperAdmin = Auth.isSuperAdmin();
        var roleLabels = Auth.ROLE_LABELS || {};

        var rows = usersData.length === 0
            ? '<tr><td colspan="6" style="text-align:center;padding:2rem;color:#888;">Cargando usuarios...</td></tr>'
            : usersData.map(function (u) {
                var isSelf = u.id === currentUser.id;
                var roleLabel = roleLabels[u.role] || u.role;
                var roleSelect = isSelf
                    ? '<span class="badge badge-info">' + escapeHtml(roleLabel) + '</span>'
                    : '<select class="form-control users-role-select" data-id="' + u.id + '" style="font-size:12px;padding:2px 6px;width:auto;">' +
                      '<option value="operaciones"' + (u.role === 'operaciones' ? ' selected' : '') + '>Operaciones</option>' +
                      '<option value="comercial"' + (u.role === 'comercial' ? ' selected' : '') + '>Comercial</option>' +
                      '<option value="socio"' + (u.role === 'socio' ? ' selected' : '') + '>Socio</option>' +
                      (isSuperAdmin ? '<option value="superadmin"' + (u.role === 'superadmin' ? ' selected' : '') + '>Super Admin</option>' : '') +
                      '</select>';
                var statusBadge = u.active !== false
                    ? '<span class="badge badge-success">Activo</span>'
                    : '<span class="badge badge-danger">Inactivo</span>';
                var actions = isSelf ? '<span style="color:var(--text-secondary);font-size:11px;">Tu cuenta</span>' :
                    '<button class="btn-icon users-reset-pwd-btn" data-id="' + u.id + '" data-name="' + escapeHtml(u.name || u.email) + '" title="Reset contraseña" style="margin-right:4px;">&#128273;</button>' +
                    (isSuperAdmin ? '<button class="btn-icon users-toggle-btn" data-id="' + u.id + '" data-active="' + (u.active !== false) + '" title="' + (u.active !== false ? 'Desactivar' : 'Activar') + '">' +
                    (u.active !== false ? '&#9940;' : '&#9989;') + '</button>' +
                    '<button class="btn-icon users-delete-btn" data-id="' + u.id + '" title="Eliminar" style="color:var(--danger);margin-left:4px;">&#128465;</button>' : '');
                return '<tr>' +
                    '<td>' + escapeHtml(u.name || '') + '</td>' +
                    '<td>' + escapeHtml(u.email) + '</td>' +
                    '<td>' + roleSelect + '</td>' +
                    '<td>' + statusBadge + '</td>' +
                    '<td>' + formatDateShort(u.created_at) + '</td>' +
                    '<td style="white-space:nowrap;">' + actions + '</td>' +
                    '</tr>';
            }).join('');

        var roleDescHTML = '' +
            '<div style="margin-bottom:16px;padding:12px;background:var(--bg-tertiary);border-radius:8px;font-size:12px;color:var(--text-secondary);line-height:1.6;">' +
                '<strong style="color:var(--text-primary);">Perfiles disponibles:</strong><br>' +
                '<strong>Operaciones</strong> — Kanban, Bodega, Dashboard operativo (eventos, alertas). Ve ratio de pagos a freelancers pero no montos.<br>' +
                '<strong>Comercial</strong> — Ventas, CXC, Cotizador + todo lo de Operaciones.<br>' +
                '<strong>Socio</strong> — Acceso completo (igual que Super Admin pero no puede eliminar usuarios).<br>' +
                '<strong>Super Admin</strong> — Control total del sistema.' +
            '</div>';

        return `
        <div class="card" style="max-width:960px">
            <div class="card-header"><h3 class="card-title">Usuarios Registrados</h3></div>
            <div style="padding:var(--space-md)">
                ${roleDescHTML}
                <div style="overflow-x:auto;">
                    <table class="data-table" id="users-table">
                        <thead><tr>
                            <th>Nombre</th><th>Email</th><th>Perfil</th><th>Estado</th><th>Registro</th><th>Acciones</th>
                        </tr></thead>
                        <tbody id="users-table-body">${rows}</tbody>
                    </table>
                </div>
            </div>
        </div>`;
    }

    function formatDateShort(d) {
        if (!d) return '-';
        try { return new Date(d).toLocaleDateString('es-CL'); } catch (e) { return d; }
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
                const tarifBase = (() => {
                    try { return JSON.parse(s.tarifario || '{}').base || {}; } catch(e) { return {}; }
                })();
                const precioDisplay = tarifBase.unitario > 0
                    ? formatCLP(tarifBase.unitario) + ' <span class="badge-info" style="font-size:10px">Tarifario</span>'
                    : formatCLP(s.precio_base);
                return `
                <tr data-id="${s.id}">
                    <td>${escapeHtml(name)}</td>
                    <td>${precioDisplay}</td>
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

        // Equipos del servicio — pre-compute before main template
        const EQ_CATS = ['Notebooks','PCs','Tablets','Teléfonos','Cámaras','Impresoras','Pantallas','Totems','Sensores','Iluminación','Trípodes','Mobiliario','Cables','Accesorios','Otro'];
        let eqItems = [];
        try {
            const parsed = JSON.parse(s.equipos_checklist || '[]');
            if (Array.isArray(parsed)) eqItems = parsed;
        } catch(e) {
            if (s.equipos_checklist) {
                eqItems = s.equipos_checklist.split('\n').filter(l => l.trim()).map(l => ({ categoria: '', label: l.trim() }));
            }
        }
        const eqItemRowsHTML = eqItems.map(item =>
            '<div class="svc-eq-item" data-categoria="' + escapeHtml(item.categoria || '') + '" data-label="' + escapeHtml(item.label || '') + '" style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.05)">' +
                '<span style="font-size:11px;background:rgba(167,139,250,0.12);color:#a78bfa;border:1px solid rgba(167,139,250,0.3);padding:2px 8px;border-radius:12px;white-space:nowrap;min-width:70px;text-align:center">' + escapeHtml(item.categoria || '—') + '</span>' +
                '<span style="flex:1;font-size:13px">' + escapeHtml(item.label || '') + '</span>' +
                '<button type="button" class="svc-eq-del-btn" style="background:none;border:none;color:#f87171;cursor:pointer;font-size:18px;padding:0 4px;line-height:1" title="Eliminar">&times;</button>' +
            '</div>'
        ).join('');
        const eqCatListHTML = EQ_CATS.map(c => '<option value="' + escapeHtml(c) + '">').join('');
        const eqSectionHTML = '<div class="form-group" style="margin-top:var(--space-md)">' +
            '<label>Equipos del servicio <span style="font-weight:400;color:var(--text-muted)">(el operador asigna IDs por evento)</span></label>' +
            '<datalist id="svc-eq-cat-list">' + eqCatListHTML + '</datalist>' +
            '<div id="svc-eq-items-list" style="margin-bottom:10px;min-height:20px">' +
                (eqItemRowsHTML || '<div class="svc-eq-empty" style="color:var(--text-muted);font-size:13px;padding:6px 0">Sin equipos definidos.</div>') +
            '</div>' +
            '<div style="display:flex;gap:6px;align-items:center">' +
                '<input type="text" list="svc-eq-cat-list" id="svc-eq-new-cat" class="form-control" placeholder="Categoría..." style="width:150px;height:34px;font-size:13px">' +
                '<input type="text" id="svc-eq-new-label" class="form-control" placeholder="Nombre del ítem..." style="flex:1;height:34px;font-size:13px">' +
                '<button type="button" id="svc-eq-add-btn" style="white-space:nowrap;height:34px;padding:0 12px;font-size:13px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:var(--text-secondary);cursor:pointer">+ Añadir</button>' +
            '</div>' +
        '</div>';

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

            ${(() => {
                let tarifario = { base: { label: '', descripcion: '', unitario: '' }, adicionales: [], packs: [] };
                try {
                    var parsed = JSON.parse(s.tarifario || '{}');
                    if (parsed.base) tarifario = parsed;
                } catch(e) {}
                const adicionalesHTML = (tarifario.adicionales || []).map(a =>
                    '<div class="tarif-item tarif-adicional">' + makeTarifItemHTML(a.label || '', a.descripcion || '', a.unitario || '', 'tarif-adicional') + '</div>'
                ).join('');
                const packsHTML = (tarifario.packs || []).map(p =>
                    '<div class="tarif-item tarif-pack">' + makeTarifItemHTML(p.label || '', p.descripcion || '', p.unitario || '', 'tarif-pack') + '</div>'
                ).join('');
                return '<div style="margin-top:var(--space-lg);border-top:1px solid var(--border-color);padding-top:var(--space-md)">' +

                    '<div class="accordion-section open">' +
                        '<div class="accordion-header">' +
                            '<span class="acc-title">Tarifario</span>' +
                            '<span class="acc-arrow">&#9660;</span>' +
                        '</div>' +
                        '<div class="accordion-body">' +
                            '<div style="font-size:13px;font-weight:600;color:var(--text-secondary);margin-bottom:var(--space-sm)">Base (siempre 1 unidad)</div>' +
                            '<div style="display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap">' +
                                '<div class="form-group tarif-label"><input type="text" id="tarif-base-label" class="form-control" value="' + escapeHtml(tarifario.base.label || '') + '" placeholder="Nombre"></div>' +
                                '<div class="form-group tarif-desc"><textarea id="tarif-base-desc" class="form-control" rows="1" placeholder="Descripcion breve">' + escapeHtml(tarifario.base.descripcion || '') + '</textarea></div>' +
                                '<div class="form-group tarif-price"><input type="number" id="tarif-base-unit" class="form-control" value="' + (tarifario.base.unitario || '') + '" min="0" placeholder="Precio"></div>' +
                            '</div>' +
                            '<div style="font-size:13px;font-weight:600;color:var(--text-secondary);margin-top:var(--space-md);margin-bottom:var(--space-sm)">Adicionales</div>' +
                            '<div id="tarif-adicionales-list">' + adicionalesHTML + '</div>' +
                            '<button type="button" class="btn btn-secondary" id="btn-add-tarif-adicional" style="margin-top:6px">+ Agregar adicional</button>' +
                            '<div style="font-size:13px;font-weight:600;color:var(--text-secondary);margin-top:var(--space-md);margin-bottom:var(--space-sm)">Packs</div>' +
                            '<div id="tarif-packs-list">' + packsHTML + '</div>' +
                            '<button type="button" class="btn btn-secondary" id="btn-add-tarif-pack" style="margin-top:6px">+ Agregar pack</button>' +
                        '</div>' +
                    '</div>' +

                    '<div class="accordion-section">' +
                        '<div class="accordion-header">' +
                            '<span class="acc-title">Costos Internos</span>' +
                            '<span class="acc-arrow">&#9660;</span>' +
                        '</div>' +
                        '<div class="accordion-body">' +
                            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-md)">' +
                                '<label style="margin:0;font-weight:600">Plantilla de Costos</label>' +
                                '<button type="button" class="btn btn-secondary" id="btn-add-ct-row">+ Agregar costo</button>' +
                            '</div>' +
                            '<div id="svc-cost-template-rows">' +
                                renderCostTemplateRows(s.cost_template || []) +
                            '</div>' +
                            '<div style="text-align:right;margin-top:var(--space-sm);font-size:13px;color:var(--text-secondary)">' +
                                'Total plantilla: <strong id="svc-ct-total">' + formatCLP((s.cost_template || []).reduce(function(acc, i){ return acc + (i.cantidad || 1) * (i.monto_unitario || 0); }, 0)) + '</strong>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +

                    '<div class="accordion-section">' +
                        '<div class="accordion-header">' +
                            '<span class="acc-title">Equipos</span>' +
                            '<span class="acc-arrow">&#9660;</span>' +
                        '</div>' +
                        '<div class="accordion-body">' +
                            eqSectionHTML +
                        '</div>' +
                    '</div>' +

                    '<div class="accordion-section open">' +
                        '<div class="accordion-header">' +
                            '<span class="acc-title">Comunicacion (Links, Templates)</span>' +
                            '<span class="acc-arrow">&#9660;</span>' +
                        '</div>' +
                        '<div class="accordion-body">' +
                            '<div class="form-group">' +
                                '<label for="svc-template-saludo">Template: Saludo inicial al cliente <span style="font-weight:400;color:var(--text-muted)">(usa {cliente}, {evento}, {fecha}, {encargado})</span></label>' +
                                '<textarea id="svc-template-saludo" class="form-control" rows="5" placeholder="Hola {contacto}, te escribo de parte de MazeLab...">' + escapeHtml(s.template_saludo || '') + '</textarea>' +
                            '</div>' +
                            '<div class="form-group">' +
                                '<label for="svc-template-diseno">Template: Solicitud de diseño/branding <span style="font-weight:400;color:var(--text-muted)">(cuando el cliente debe enviarnos archivos)</span></label>' +
                                '<textarea id="svc-template-diseno" class="form-control" rows="5" placeholder="Hola {contacto}, para poder preparar el {servicio} necesitamos los siguientes archivos...">' + escapeHtml(s.template_diseno || '') + '</textarea>' +
                            '</div>' +
                            '<div class="form-group">' +
                                '<label for="svc-faq">Preguntas frecuentes del cliente <span style="font-weight:400;color:var(--text-muted)">(una por línea: P: … / R: …)</span></label>' +
                                '<textarea id="svc-faq" class="form-control" rows="5" placeholder="P: ¿Se puede agregar una base de datos?...">' + escapeHtml(s.faq || '') + '</textarea>' +
                            '</div>' +
                            '<div class="form-group">' +
                                '<label for="svc-link-fotos">Link fotos/galería <span style="font-weight:400;color:var(--text-muted)">(Google Drive, Dropbox, etc.)</span></label>' +
                                '<input type="url" id="svc-link-fotos" class="form-control" placeholder="https://drive.google.com/..." value="' + escapeHtml(s.link_fotos || '') + '">' +
                            '</div>' +
                            '<div class="form-group">' +
                                '<label for="svc-link-landing">Link ficha técnica / landing <span style="font-weight:400;color:var(--text-muted)">(página web del servicio)</span></label>' +
                                '<input type="url" id="svc-link-landing" class="form-control" placeholder="https://mazelab.cl/glambot" value="' + escapeHtml(s.link_landing || '') + '">' +
                            '</div>' +
                            '<div class="form-group">' +
                                '<label for="svc-specs">Especificaciones técnicas <span style="font-weight:400;color:var(--text-muted)">(medidas, espacio mínimo, consumo eléctrico, conexiones)</span></label>' +
                                '<textarea id="svc-specs" class="form-control" rows="3" placeholder="Ej: Espacio mínimo 2x2m. Consumo 300W...">' + escapeHtml(s.specs || '') + '</textarea>' +
                            '</div>' +
                            '<div class="form-group">' +
                                '<label for="svc-notas-ops">Notas operacionales <span style="font-weight:400;color:var(--text-muted)">(qué debe saber el equipo antes de llegar)</span></label>' +
                                '<textarea id="svc-notas-ops" class="form-control" rows="3" placeholder="Ej: Verificar que el exterior del Holobox esté impecable...">' + escapeHtml(s.notas_ops || '') + '</textarea>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +

                '</div>';
            })()}`;
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
            precio_base: (() => {
                const tarifUnit = Number((document.getElementById('tarif-base-unit') || {}).value) || 0;
                const legacyVal = document.getElementById('svc-precio-base').value ? Number(document.getElementById('svc-precio-base').value) : null;
                return tarifUnit > 0 ? tarifUnit : legacyVal;
            })(),
            costo_base_estimado: costoBase,
            duracion_tipo: document.getElementById('svc-duracion-tipo').value || null,
            duracion_default: document.getElementById('svc-duracion-default').value ? Number(document.getElementById('svc-duracion-default').value) : null,
            featured: document.getElementById('svc-featured').checked,
            activo: document.getElementById('svc-activo').checked,
            cost_template: costTemplate,
            specs:            (document.getElementById('svc-specs')            || {}).value || null,
            notas_ops:        (document.getElementById('svc-notas-ops')        || {}).value || null,
            faq:              (document.getElementById('svc-faq')               || {}).value || null,
            template_saludo:  (document.getElementById('svc-template-saludo')  || {}).value || null,
            template_diseno:  (document.getElementById('svc-template-diseno')  || {}).value || null,
            link_fotos:       (document.getElementById('svc-link-fotos')       || {}).value || null,
            link_landing:     (document.getElementById('svc-link-landing')     || {}).value || null,
            equipos_checklist: (() => {
                const items = [];
                document.querySelectorAll('#svc-eq-items-list .svc-eq-item').forEach(el => {
                    const label = el.dataset.label || '';
                    if (label) items.push({ categoria: el.dataset.categoria || '', label });
                });
                return items.length ? JSON.stringify(items) : null;
            })(),
            tarifario: (() => {
                const base = {
                    label: (document.getElementById('tarif-base-label') || {}).value || '',
                    descripcion: (document.getElementById('tarif-base-desc') || {}).value || '',
                    unitario: Number((document.getElementById('tarif-base-unit') || {}).value) || 0
                };
                const adicionales = [];
                document.querySelectorAll('.tarif-adicional').forEach(el => {
                    const label = (el.querySelector('.tarif-item-label') || {}).value || '';
                    const desc = (el.querySelector('.tarif-item-desc') || {}).value || '';
                    const unit = Number((el.querySelector('.tarif-item-unit') || {}).value) || 0;
                    if (label || unit) adicionales.push({ label, descripcion: desc, unitario: unit });
                });
                const packs = [];
                document.querySelectorAll('.tarif-pack').forEach(el => {
                    const label = (el.querySelector('.tarif-item-label') || {}).value || '';
                    const desc = (el.querySelector('.tarif-item-desc') || {}).value || '';
                    const unit = Number((el.querySelector('.tarif-item-unit') || {}).value) || 0;
                    if (label || unit) packs.push({ label, descripcion: desc, unitario: unit });
                });
                return JSON.stringify({ base, adicionales, packs });
            })(),
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
                bindEquiposChecklistEvents();
                bindTarifarioEvents();
                bindAccordionEvents();
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

        // IA tab events
        var iaSaveBtn = document.getElementById('ia-save-btn');
        if (iaSaveBtn) {
            iaSaveBtn.addEventListener('click', function () {
                var AI = window.Mazelab.AIService;
                if (!AI) return;
                AI.saveConfig({
                    apiKey: (document.getElementById('ia-apikey').value || '').trim(),
                    model: document.getElementById('ia-model').value,
                    prompts: {
                        cobranza: (document.getElementById('ia-prompt-cobranza').value || '').trim(),
                        cotizador: (document.getElementById('ia-prompt-cotizador').value || '').trim()
                    }
                });
                var msg = document.getElementById('ia-save-msg');
                if (msg) { msg.style.display = 'inline'; setTimeout(function () { msg.style.display = 'none'; }, 2000); }
            });
        }

        var iaTestBtn = document.getElementById('ia-test-btn');
        if (iaTestBtn) {
            iaTestBtn.addEventListener('click', async function () {
                var AI = window.Mazelab.AIService;
                var testMsg = document.getElementById('ia-test-msg');
                if (!AI || !testMsg) return;

                // Save first so test uses current values
                AI.saveConfig({
                    apiKey: (document.getElementById('ia-apikey').value || '').trim(),
                    model: document.getElementById('ia-model').value,
                    prompts: {
                        cobranza: (document.getElementById('ia-prompt-cobranza').value || '').trim(),
                        cotizador: (document.getElementById('ia-prompt-cotizador').value || '').trim()
                    }
                });

                testMsg.style.color = 'var(--text-secondary)';
                testMsg.textContent = 'Conectando...';

                try {
                    var result = await AI.testConnection();
                    testMsg.style.color = 'var(--success)';
                    testMsg.textContent = '\u2713 Conectado — ' + result.model;
                } catch (err) {
                    testMsg.style.color = 'var(--danger)';
                    testMsg.textContent = '\u2717 ' + (err.message || 'Error de conexión');
                }
            });
        }

        var iaToggleKey = document.getElementById('ia-toggle-key');
        if (iaToggleKey) {
            iaToggleKey.addEventListener('click', function () {
                var input = document.getElementById('ia-apikey');
                if (input) input.type = input.type === 'password' ? 'text' : 'password';
            });
        }

        var iaResetCobranza = document.getElementById('ia-reset-cobranza');
        if (iaResetCobranza) {
            iaResetCobranza.addEventListener('click', function () {
                var AI = window.Mazelab.AIService;
                if (!AI) return;
                var ta = document.getElementById('ia-prompt-cobranza');
                if (ta) ta.value = AI.getDefaultPrompts().cobranza;
            });
        }

        var iaResetCotizador = document.getElementById('ia-reset-cotizador');
        if (iaResetCotizador) {
            iaResetCotizador.addEventListener('click', function () {
                var AI = window.Mazelab.AIService;
                if (!AI) return;
                var ta = document.getElementById('ia-prompt-cotizador');
                if (ta) ta.value = AI.getDefaultPrompts().cotizador;
            });
        }

        // Users tab events (superadmin)
        var usersBody = document.getElementById('users-table-body');
        if (usersBody) {
            // Role change
            usersBody.querySelectorAll('.users-role-select').forEach(function (sel) {
                sel.addEventListener('change', async function () {
                    var userId = this.getAttribute('data-id');
                    try {
                        await window.Mazelab.Auth.updateUserRole(userId, this.value);
                        usersData = await window.Mazelab.Auth.getAllUsers();
                        refreshTabContent();
                    } catch (err) { alert(err.message); }
                });
            });
            // Toggle active, delete, reset password
            usersBody.addEventListener('click', async function (e) {
                var toggleBtn = e.target.closest('.users-toggle-btn');
                if (toggleBtn) {
                    var userId = toggleBtn.getAttribute('data-id');
                    var isActive = toggleBtn.getAttribute('data-active') === 'true';
                    try {
                        await window.Mazelab.Auth.toggleUserActive(userId, !isActive);
                        usersData = await window.Mazelab.Auth.getAllUsers();
                        refreshTabContent();
                    } catch (err) { alert(err.message); }
                }
                // Delete
                var deleteBtn = e.target.closest('.users-delete-btn');
                if (deleteBtn) {
                    var userId2 = deleteBtn.getAttribute('data-id');
                    if (!confirm('Eliminar este usuario permanentemente?')) return;
                    try {
                        await window.Mazelab.Auth.deleteUser(userId2);
                        usersData = await window.Mazelab.Auth.getAllUsers();
                        refreshTabContent();
                    } catch (err) { alert(err.message); }
                }
                // Reset password
                var resetBtn = e.target.closest('.users-reset-pwd-btn');
                if (resetBtn) {
                    var resetUserId = resetBtn.getAttribute('data-id');
                    var userName = resetBtn.getAttribute('data-name');
                    var newPwd = prompt('Nueva contraseña para ' + userName + ' (min 6 caracteres):');
                    if (!newPwd) return;
                    try {
                        await window.Mazelab.Auth.resetPassword(resetUserId, newPwd);
                        alert('Contraseña actualizada para ' + userName);
                    } catch (err) { alert(err.message); }
                }
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
                // Load users when switching to usuarios tab
                if (activeTab === 'usuarios' && window.Mazelab.Auth && window.Mazelab.Auth.canManageUsers()) {
                    window.Mazelab.Auth.getAllUsers().then(function (data) {
                        usersData = data || [];
                        refreshTabContent();
                    }).catch(function () { refreshTabContent(); });
                    return;
                }
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
