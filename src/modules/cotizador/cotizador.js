window.Mazelab.Modules.CotizadorModule = (function () {

    // ── State ──────────────────────────────────────────────────────────
    var cotizaciones = [];
    var services = [];
    var clients = [];
    var currentView = 'list'; // 'list' | 'form' | 'preview'
    var editingId = null;
    var formState = null;
    var _delegationBound = false; // prevent stacking event listeners
    var aiChatHistory = []; // [{role:'user',content:''},{role:'assistant',content:''}]
    var lastParsedCot = null; // last parsed AI cotización JSON

    // ── Helpers ────────────────────────────────────────────────────────

    function escapeHtml(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

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

    function todayStr() {
        return new Date().toISOString().substring(0, 10);
    }

    function formatDateShort(dateStr) {
        if (!dateStr) return '-';
        var parts = dateStr.split('-');
        if (parts.length !== 3) return dateStr;
        return parts[2] + '/' + parts[1] + '/' + parts[0];
    }

    function generateCodigo() {
        var maxNum = 0;
        for (var i = 0; i < cotizaciones.length; i++) {
            var cod = cotizaciones[i].codigo || '';
            var match = cod.match(/COT-(\d+)/);
            if (match) {
                var n = parseInt(match[1], 10);
                if (n > maxNum) maxNum = n;
            }
        }
        var next = maxNum + 1;
        var padded = next.toString();
        while (padded.length < 3) padded = '0' + padded;
        return 'COT-' + padded;
    }

    function parseTarifario(svc) {
        if (!svc || !svc.tarifario) return null;
        try {
            if (typeof svc.tarifario === 'object') return svc.tarifario;
            return JSON.parse(svc.tarifario);
        } catch (e) {
            return null;
        }
    }

    function getServiceName(svc) {
        return svc.name || svc.nombre || '';
    }

    function getClientDisplayName(c) {
        return c.name || c.nombre || '';
    }

    function findService(nameOrId) {
        if (!nameOrId) return null;
        var q = nameOrId.toLowerCase().trim();
        // Exact match first
        for (var i = 0; i < services.length; i++) {
            if (services[i].id === nameOrId || getServiceName(services[i]) === nameOrId) return services[i];
        }
        // Case-insensitive match
        for (var j = 0; j < services.length; j++) {
            if (getServiceName(services[j]).toLowerCase() === q) return services[j];
        }
        // Partial match (AI might say "Glambot" when service is "Glambot ")
        for (var k = 0; k < services.length; k++) {
            var sn = getServiceName(services[k]).toLowerCase();
            if (sn.indexOf(q) !== -1 || q.indexOf(sn) !== -1) return services[k];
        }
        return null;
    }

    function findCot(id) {
        for (var i = 0; i < cotizaciones.length; i++) {
            if (cotizaciones[i].id === id) return cotizaciones[i];
        }
        return null;
    }

    function sortedClients() {
        return clients.slice().sort(function (a, b) {
            return getClientDisplayName(a).localeCompare(getClientDisplayName(b));
        });
    }

    function sortedServices() {
        return services.slice().sort(function (a, b) {
            return getServiceName(a).localeCompare(getServiceName(b));
        });
    }

    // ── Form State Management ─────────────────────────────────────────

    function resetFormState() {
        formState = {
            clientName: '',
            contactName: '',
            contactEmail: '',
            contactTel: '',
            eventName: '',
            eventDate: '',
            lugar: '',
            validezDias: 7,
            condiciones: '50% adelanto, 50% a 30 dias',
            descuento: 0,
            descuentoNota: '',
            notas: '',
            bloques: []
        };
    }

    function calcBloqueSubtotal(bloque) {
        var sub = 0;
        for (var i = 0; i < bloque.items.length; i++) {
            var item = bloque.items[i];
            var cant = Number(item.cantidad) || 0;
            item.total = (Number(item.unitario) || 0) * cant * (Number(item.dias) || 1);
            // Items with cantidad=0 are opcionales — don't add to subtotal
            if (cant > 0) sub += item.total;
        }
        bloque.subtotalBloque = sub;
        return sub;
    }

    function calcTotals() {
        var subtotal = 0;
        for (var i = 0; i < formState.bloques.length; i++) {
            subtotal += calcBloqueSubtotal(formState.bloques[i]);
        }
        var descuento = Number(formState.descuento) || 0;
        var descuentoPct = subtotal > 0 ? Math.round(descuento / subtotal * 10000) / 100 : 0;
        var totalNeto = subtotal - descuento;
        return {
            subtotal: subtotal,
            descuento: descuento,
            descuentoPct: descuentoPct,
            totalNeto: totalNeto
        };
    }

    // ── Data Loading ──────────────────────────────────────────────────

    function loadData(callback) {
        var DS = window.Mazelab.DataService;
        var pending = 3;
        var done = function () {
            pending--;
            if (pending === 0 && callback) callback();
        };
        DS.getAll('cotizaciones').then(function (data) {
            cotizaciones = data || [];
            done();
        }).catch(function () { cotizaciones = []; done(); });
        DS.getAll('services').then(function (data) {
            services = data || [];
            done();
        }).catch(function () { services = []; done(); });
        DS.getAll('clients').then(function (data) {
            clients = data || [];
            done();
        }).catch(function () { clients = []; done(); });
    }

    // ── Render (outer shell) ──────────────────────────────────────────

    function render() {
        var html = '';
        html += '<style>';
        html += '@media print {';
        html += '  @page { margin: 12mm 10mm; size: A4; }';
        html += '  body, html { background: #fff !important; }';
        html += '  body > * { display: none !important; }';
        html += '  body > .app-container { display: block !important; }';
        html += '  .app-container > * { display: none !important; }';
        html += '  .app-container > .main-content { display: block !important; }';
        html += '  .main-content > * { display: none !important; }';
        html += '  .main-content > #app-content { display: block !important; }';
        html += '  #app-content > * { display: none !important; }';
        html += '  #app-content > .content-body { display: block !important; }';
        html += '  .content-body > * { display: none !important; }';
        html += '  .cotizador-preview { display: block !important; position: static !important; width: 100% !important; background: #fff !important; color: #000 !important; overflow: visible !important; }';
        html += '  .cotizador-preview * { visibility: visible !important; color: inherit !important; }';
        html += '  .preview-actions { display: none !important; }';
        html += '  .sidebar, .sidebar-footer, .content-header { display: none !important; }';
        html += '}';
        html += '.cotizador-preview.ops-mode .cot-price { display: none !important; }';
        html += '</style>';
        html += '<div class="content-header"><h1>Cotizador</h1></div>';
        html += '<div class="content-body" id="cotizador-content"></div>';
        return html;
    }

    // ── List View ─────────────────────────────────────────────────────

    function renderListView() {
        var html = '';

        // KPIs
        var now = new Date();
        var thisMonth = now.getFullYear() + '-' + (now.getMonth() + 1 < 10 ? '0' : '') + (now.getMonth() + 1);
        var cotThisMonth = 0;
        var montoTotal = 0;
        var aprobadas = 0;
        for (var k = 0; k < cotizaciones.length; k++) {
            var c = cotizaciones[k];
            if ((c.createdAt || '').substring(0, 7) === thisMonth) cotThisMonth++;
            montoTotal += Number(c.totalNeto) || 0;
            if (c.estado === 'aprobada') aprobadas++;
        }
        var tasa = cotizaciones.length > 0 ? Math.round(aprobadas / cotizaciones.length * 100) : 0;

        html += '<div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:1.5rem;">';
        html += '  <div class="kpi-card"><div class="kpi-label">Cotizaciones este mes</div><div class="kpi-value">' + cotThisMonth + '</div></div>';
        html += '  <div class="kpi-card"><div class="kpi-label">Monto total cotizado</div><div class="kpi-value">' + formatCLP(montoTotal) + '</div></div>';
        html += '  <div class="kpi-card"><div class="kpi-label">Tasa conversion</div><div class="kpi-value">' + tasa + '%</div></div>';
        html += '</div>';

        // Toolbar
        html += '<div class="toolbar">';
        html += '  <button class="btn btn-primary" id="cot-btn-new">+ Nueva Cotizacion</button>';
        html += '  <button class="btn btn-secondary" id="cot-btn-toggle-ai" style="margin-left:auto;">Asistente IA</button>';
        html += '</div>';

        // AI Assistant Panel (hidden by default)
        html += '<div id="cot-ai-panel" style="display:none;margin-bottom:1.5rem;">';
        html += '  <div class="card">';
        html += '    <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;">';
        html += '      <h3 class="card-title">Asistente IA</h3>';
        html += '      <button class="btn btn-secondary btn-sm" id="cot-ai-clear" style="font-size:11px;">Nueva conversacion</button>';
        html += '    </div>';
        html += '    <div style="padding:var(--space-md);">';
        html += '      <div id="cot-ai-messages" style="max-height:320px;overflow-y:auto;margin-bottom:12px;font-size:13px;"><div style="color:var(--text-secondary);font-size:12px;padding:8px;">Describe el evento y los servicios que necesitas. Ej: "Glambot 4 horas con pantalla para Banco Chile, 15 abril en CasaPiedra, que quede en 1.5M"</div></div>';
        html += '      <div style="display:flex;gap:8px;">';
        html += '        <textarea id="cot-ai-input" class="form-control" rows="4" placeholder="Ej: Necesito cotizar un Glambot de 4 horas con pantalla para un evento en CasaPiedra el 15 de abril, cliente Banco Chile..." style="flex:1;resize:vertical;min-height:80px;"></textarea>';
        html += '        <button class="btn btn-primary" id="cot-ai-send" style="align-self:flex-end;white-space:nowrap;">Enviar</button>';
        html += '      </div>';
        html += '      <div id="cot-ai-status" style="font-size:11px;color:var(--text-secondary);margin-top:4px;"></div>';
        html += '    </div>';
        html += '  </div>';
        html += '</div>';

        if (cotizaciones.length === 0) {
            html += '<p style="color:var(--text-secondary);padding:2rem;">No hay cotizaciones. Crea la primera.</p>';
            return html;
        }

        html += '<div style="overflow-x:auto;">';
        html += '<table class="data-table">';
        html += '<thead><tr>';
        html += '<th>N</th><th>Cliente</th><th>Evento</th><th>Fecha</th><th>Servicios</th><th>Total</th><th>Estado</th><th>Acciones</th>';
        html += '</tr></thead><tbody>';

        var sorted = cotizaciones.slice().sort(function (a, b) {
            return (b.createdAt || '').localeCompare(a.createdAt || '');
        });

        for (var i = 0; i < sorted.length; i++) {
            var cot = sorted[i];
            var svcNames = '';
            if (cot.bloques && cot.bloques.length) {
                var names = [];
                for (var j = 0; j < cot.bloques.length; j++) {
                    if (cot.bloques[j].serviceName) names.push(cot.bloques[j].serviceName);
                }
                svcNames = names.join(', ');
            }

            var badgeMap = { borrador: 'badge-warning', enviada: 'badge-info', aprobada: 'badge-success', rechazada: 'badge-danger' };
            var labelMap = { borrador: 'Borrador', enviada: 'Enviada', aprobada: 'Aprobada', rechazada: 'Rechazada' };
            var st = cot.estado || 'borrador';

            html += '<tr>';
            html += '<td>' + escapeHtml(cot.codigo) + '</td>';
            html += '<td>' + escapeHtml(cot.clientName) + '</td>';
            html += '<td>' + escapeHtml(cot.eventName || '') + '</td>';
            html += '<td>' + formatDateShort(cot.eventDate || cot.createdAt) + '</td>';
            html += '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(svcNames) + '</td>';
            html += '<td>' + formatCLP(cot.totalNeto) + '</td>';
            html += '<td><span class="badge ' + (badgeMap[st] || 'badge-warning') + '">' + (labelMap[st] || st) + '</span></td>';
            html += '<td>';
            html += '  <button class="btn btn-secondary btn-sm cot-btn-view" data-id="' + cot.id + '">Ver</button> ';
            html += '  <button class="btn btn-secondary btn-sm cot-btn-edit" data-id="' + cot.id + '">Editar</button> ';
            html += '  <button class="btn btn-secondary btn-sm cot-btn-delete" data-id="' + cot.id + '" style="color:var(--danger);">Eliminar</button>';
            html += '</td>';
            html += '</tr>';
        }

        html += '</tbody></table></div>';
        return html;
    }

    // ── Form View ─────────────────────────────────────────────────────

    function renderFormView() {
        var html = '';
        var inputStyle = 'color:var(--text-primary);background:var(--bg-secondary);';

        html += '<div class="toolbar">';
        html += '  <button class="btn btn-secondary" id="cot-btn-back-list">Volver a lista</button>';
        html += '</div>';

        // Datalists (sorted)
        var clientOptions = '';
        var sc = sortedClients();
        for (var ci = 0; ci < sc.length; ci++) {
            clientOptions += '<option value="' + escapeHtml(getClientDisplayName(sc[ci])) + '">';
        }
        var serviceOptions = '';
        var ss = sortedServices();
        for (var si = 0; si < ss.length; si++) {
            serviceOptions += '<option value="' + escapeHtml(getServiceName(ss[si])) + '">';
        }
        html += '<datalist id="cot-clients-datalist">' + clientOptions + '</datalist>';
        html += '<datalist id="cot-services-datalist">' + serviceOptions + '</datalist>';

        html += '<div style="max-width:960px;">';

        // ── Client section
        html += '<h3 style="color:var(--text-primary);margin:1rem 0 0.5rem;">Datos del cliente</h3>';
        html += '<div class="form-row">';
        html += '  <div class="form-group" style="flex:2;">';
        html += '    <label class="form-label">Cliente</label>';
        html += '    <input type="text" class="form-control" id="cot-clientName" list="cot-clients-datalist" placeholder="Nombre del cliente" value="' + escapeHtml(formState.clientName) + '" style="' + inputStyle + '">';
        html += '  </div>';
        html += '  <div class="form-group" style="flex:1;">';
        html += '    <label class="form-label">Contacto</label>';
        html += '    <input type="text" class="form-control" id="cot-contactName" placeholder="Nombre contacto" value="' + escapeHtml(formState.contactName) + '" style="' + inputStyle + '">';
        html += '  </div>';
        html += '</div>';
        html += '<div class="form-row">';
        html += '  <div class="form-group" style="flex:1;">';
        html += '    <label class="form-label">Email</label>';
        html += '    <input type="email" class="form-control" id="cot-contactEmail" placeholder="email@ejemplo.cl" value="' + escapeHtml(formState.contactEmail) + '" style="' + inputStyle + '">';
        html += '  </div>';
        html += '  <div class="form-group" style="flex:1;">';
        html += '    <label class="form-label">Telefono</label>';
        html += '    <input type="text" class="form-control" id="cot-contactTel" placeholder="+56 9 1234 5678" value="' + escapeHtml(formState.contactTel) + '" style="' + inputStyle + '">';
        html += '  </div>';
        html += '</div>';

        // ── Event section
        html += '<h3 style="color:var(--text-primary);margin:1.5rem 0 0.5rem;">Datos del evento</h3>';
        html += '<div class="form-row">';
        html += '  <div class="form-group" style="flex:2;">';
        html += '    <label class="form-label">Nombre del evento</label>';
        html += '    <input type="text" class="form-control" id="cot-eventName" placeholder="Ej: Lanzamiento marca X" value="' + escapeHtml(formState.eventName) + '" style="' + inputStyle + '">';
        html += '  </div>';
        html += '  <div class="form-group" style="flex:1;">';
        html += '    <label class="form-label">Fecha evento</label>';
        html += '    <input type="date" class="form-control" id="cot-eventDate" value="' + escapeHtml(formState.eventDate) + '" style="' + inputStyle + '">';
        html += '  </div>';
        html += '  <div class="form-group" style="flex:1;">';
        html += '    <label class="form-label">Lugar</label>';
        html += '    <input type="text" class="form-control" id="cot-lugar" placeholder="Venue / direccion" value="' + escapeHtml(formState.lugar) + '" style="' + inputStyle + '">';
        html += '  </div>';
        html += '</div>';

        // ── Bloques (services)
        html += '<h3 style="color:var(--text-primary);margin:1.5rem 0 0.5rem;">Servicios</h3>';
        html += '<div id="cot-bloques-container">';
        for (var bi = 0; bi < formState.bloques.length; bi++) {
            html += renderBloqueForm(bi);
        }
        html += '</div>';

        // Add service: inline datalist selector instead of prompt()
        html += '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;align-items:center;">';
        html += '  <input type="text" class="form-control" id="cot-new-service-input" list="cot-services-datalist" placeholder="Seleccionar servicio..." style="max-width:300px;' + inputStyle + '">';
        html += '  <button class="btn btn-secondary" id="cot-btn-add-service">+ Agregar</button>';
        html += '</div>';

        // ── Descuento section
        html += '<h3 style="color:var(--text-primary);margin:1.5rem 0 0.5rem;">Descuento</h3>';
        html += '<div class="form-row" style="align-items:flex-end;">';
        html += '  <div class="form-group" style="flex:0 0 180px;">';
        html += '    <label class="form-label">Monto ($)</label>';
        html += '    <input type="number" class="form-control" id="cot-descuento-monto" value="' + (formState.descuento || '') + '" min="0" placeholder="0" style="' + inputStyle + '">';
        html += '  </div>';
        html += '  <div class="form-group" style="flex:0 0 120px;">';
        html += '    <label class="form-label">Porcentaje (%)</label>';
        var t = calcTotals();
        var pctVal = t.subtotal > 0 && formState.descuento > 0 ? Math.round(formState.descuento / t.subtotal * 10000) / 100 : '';
        html += '    <input type="number" class="form-control" id="cot-descuento-pct" value="' + pctVal + '" min="0" max="100" placeholder="%" style="' + inputStyle + '">';
        html += '  </div>';
        html += '  <div class="form-group" style="flex:1;">';
        html += '    <label class="form-label">Nota descuento</label>';
        html += '    <input type="text" class="form-control" id="cot-descuento-nota" placeholder="Ej: Descuento por volumen" value="' + escapeHtml(formState.descuentoNota) + '" style="' + inputStyle + '">';
        html += '  </div>';
        html += '</div>';

        // ── Condiciones / Validez / Notas
        html += '<div class="form-row" style="margin-top:1rem;">';
        html += '  <div class="form-group" style="flex:1;">';
        html += '    <label class="form-label">Condiciones de pago</label>';
        html += '    <input type="text" class="form-control" id="cot-condiciones" value="' + escapeHtml(formState.condiciones) + '" style="' + inputStyle + '">';
        html += '  </div>';
        html += '  <div class="form-group" style="flex:0 0 140px;">';
        html += '    <label class="form-label">Validez (dias)</label>';
        html += '    <input type="number" class="form-control" id="cot-validezDias" value="' + (formState.validezDias || 7) + '" min="1" style="' + inputStyle + '">';
        html += '  </div>';
        html += '</div>';
        html += '<div class="form-group">';
        html += '  <label class="form-label">Notas internas <span style="font-weight:400;color:var(--text-muted)">(no aparecen en el PDF)</span></label>';
        html += '  <textarea class="form-control" id="cot-notas" rows="2" placeholder="Observaciones internas..." style="' + inputStyle + '">' + escapeHtml(formState.notas) + '</textarea>';
        html += '</div>';

        // Live summary
        html += renderFormSummary();

        // Action buttons
        html += '<div style="display:flex;gap:1rem;margin-top:1.5rem;padding-bottom:2rem;">';
        html += '  <button class="btn btn-primary" id="cot-btn-preview">Vista previa</button>';
        html += '  <button class="btn btn-secondary" id="cot-btn-save-draft">Guardar borrador</button>';
        html += '</div>';

        html += '</div>'; // max-width wrapper
        return html;
    }

    function renderBloqueForm(bIdx) {
        var bloque = formState.bloques[bIdx];
        var inputStyle = 'color:var(--text-primary);background:var(--bg-secondary);';
        var html = '';

        html += '<div class="cot-bloque" data-bidx="' + bIdx + '" style="border:1px solid var(--bg-secondary);border-radius:8px;padding:1rem;margin-bottom:1rem;background:rgba(255,255,255,0.03);">';

        // Bloque header with reorder arrows
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">';
        html += '  <div style="display:flex;align-items:center;gap:8px;">';
        if (bIdx > 0) html += '<button class="btn btn-secondary btn-sm cot-btn-move-bloque" data-bidx="' + bIdx + '" data-dir="up" style="padding:2px 6px;font-size:14px;line-height:1;">&#9650;</button>';
        if (bIdx < formState.bloques.length - 1) html += '<button class="btn btn-secondary btn-sm cot-btn-move-bloque" data-bidx="' + bIdx + '" data-dir="down" style="padding:2px 6px;font-size:14px;line-height:1;">&#9660;</button>';
        html += '  <input type="text" class="cot-bloque-name" data-bidx="' + bIdx + '" value="' + escapeHtml(bloque.serviceName || 'Servicio ' + (bIdx + 1)) + '" style="margin:0;color:var(--accent-primary);font-size:1.1rem;font-weight:700;background:transparent;border:none;border-bottom:1px dashed var(--border-color);padding:2px 4px;width:auto;min-width:120px;">';
        html += '  </div>';
        html += '  <button class="btn btn-secondary btn-sm cot-btn-remove-bloque" data-bidx="' + bIdx + '" style="color:var(--danger);">Quitar servicio</button>';
        html += '</div>';

        // Description (editable textarea)
        html += '<textarea class="form-control cot-bloque-desc" data-bidx="' + bIdx + '" rows="2" style="color:var(--text-secondary);font-size:0.85rem;margin:0 0 0.75rem;resize:vertical;background:transparent;border:1px solid var(--border-color);" placeholder="Descripcion del servicio...">' + escapeHtml(bloque.descripcion || '') + '</textarea>';

        // Links (auto-filled from service config, shown read-only)
        if (bloque.linkFotos || bloque.linkLanding) {
            html += '<div style="margin-bottom:0.75rem;font-size:0.8rem;">';
            if (bloque.linkFotos) html += '<a href="' + escapeHtml(bloque.linkFotos) + '" target="_blank" style="color:var(--accent-primary);margin-right:1rem;">Ver fotos</a>';
            if (bloque.linkLanding) html += '<a href="' + escapeHtml(bloque.linkLanding) + '" target="_blank" style="color:var(--accent-primary);">Ver ficha del producto</a>';
            html += '</div>';
        }

        // Column visibility — auto-detect from data, store on bloque
        if (bloque.showCant === undefined) bloque.showCant = true;
        if (bloque.showDias === undefined) {
            bloque.showDias = false;
            for (var dc = 0; dc < bloque.items.length; dc++) {
                if ((Number(bloque.items[dc].dias) || 1) > 1) { bloque.showDias = true; break; }
            }
        }
        var showCantCol = bloque.showCant;
        var showDiasCol = bloque.showDias;
        var diasLabel = bloque.diasLabel || 'Dias';

        var cantLabel = bloque.cantLabel || 'Cant.';

        // Column toggle buttons
        html += '<div style="display:flex;gap:6px;margin-bottom:6px;font-size:11px;align-items:center;">';
        html += '<span style="color:var(--text-muted);">Columnas:</span>';
        html += '<button class="btn btn-secondary btn-sm cot-toggle-col" data-bidx="' + bIdx + '" data-col="showCant" style="padding:1px 8px;font-size:10px;' + (showCantCol ? 'border-color:var(--accent-primary);color:var(--accent-primary);' : 'opacity:0.5;') + '">' + escapeHtml(cantLabel) + '</button>';
        if (showCantCol) html += '<input type="text" class="cot-cant-label" data-bidx="' + bIdx + '" value="' + escapeHtml(cantLabel) + '" style="width:55px;font-size:10px;padding:1px 4px;background:transparent;border:1px dashed var(--border-color);color:var(--text-secondary);border-radius:4px;" title="Editar nombre">';
        html += '<button class="btn btn-secondary btn-sm cot-toggle-col" data-bidx="' + bIdx + '" data-col="showDias" style="padding:1px 8px;font-size:10px;' + (showDiasCol ? 'border-color:var(--accent-primary);color:var(--accent-primary);' : 'opacity:0.5;') + '">' + escapeHtml(diasLabel) + '</button>';
        if (showDiasCol) html += '<input type="text" class="cot-dias-label" data-bidx="' + bIdx + '" value="' + escapeHtml(diasLabel) + '" style="width:55px;font-size:10px;padding:1px 4px;background:transparent;border:1px dashed var(--border-color);color:var(--text-secondary);border-radius:4px;" title="Editar nombre">';
        html += '</div>';

        // Items table
        html += '<table style="width:100%;border-collapse:collapse;">';
        html += '<thead><tr>';
        html += '<th style="text-align:left;padding:0.4rem;color:var(--text-secondary);font-size:0.8rem;border-bottom:1px solid var(--bg-secondary);">Item</th>';
        if (showCantCol) html += '<th style="text-align:center;padding:0.4rem;color:var(--text-secondary);font-size:0.8rem;border-bottom:1px solid var(--bg-secondary);width:60px;">' + escapeHtml(cantLabel) + '</th>';
        if (showDiasCol) html += '<th style="text-align:center;padding:0.4rem;color:var(--text-secondary);font-size:0.8rem;border-bottom:1px solid var(--bg-secondary);width:60px;">' + escapeHtml(diasLabel) + '</th>';
        html += '<th style="text-align:right;padding:0.4rem;color:var(--text-secondary);font-size:0.8rem;border-bottom:1px solid var(--bg-secondary);width:110px;">Unitario</th>';
        html += '<th style="text-align:right;padding:0.4rem;color:var(--text-secondary);font-size:0.8rem;border-bottom:1px solid var(--bg-secondary);width:110px;">Total</th>';
        html += '<th style="width:40px;border-bottom:1px solid var(--bg-secondary);"></th>';
        html += '</tr></thead><tbody>';

        for (var ii = 0; ii < bloque.items.length; ii++) {
            var item = bloque.items[ii];
            var itemDias = Number(item.dias) || 1;
            var itemTotal = (Number(item.unitario) || 0) * (Number(item.cantidad) || 0) * itemDias;
            var isBase = item.tipo === 'base';

            html += '<tr class="cot-item-row" data-bidx="' + bIdx + '" data-iidx="' + ii + '">';
            html += '<td style="padding:0.4rem;">';
            html += '  <textarea class="form-control cot-item-label" data-bidx="' + bIdx + '" data-iidx="' + ii + '" rows="2" style="border:none;background:transparent;color:var(--text-primary);font-size:0.85rem;padding:2px 4px;width:100%;resize:vertical;min-height:32px;">' + escapeHtml(item.label) + '</textarea>';
            if (item.tipo !== 'base') {
                html += ' <span style="color:var(--text-muted);font-size:0.65rem;">(' + escapeHtml(item.tipo) + ')</span>';
            }
            html += '</td>';
            if (showCantCol) html += '<td style="padding:0.4rem;text-align:center;"><input type="number" class="form-control cot-item-cantidad" data-bidx="' + bIdx + '" data-iidx="' + ii + '" value="' + (item.cantidad || 1) + '" min="0" style="width:65px;text-align:center;' + inputStyle + '"></td>';
            if (showDiasCol) html += '<td style="padding:0.4rem;text-align:center;"><input type="number" class="form-control cot-item-dias" data-bidx="' + bIdx + '" data-iidx="' + ii + '" value="' + itemDias + '" min="1" style="width:65px;text-align:center;' + inputStyle + '"></td>';
            html += '<td style="padding:0.4rem;text-align:right;"><input type="number" class="form-control cot-item-unitario" data-bidx="' + bIdx + '" data-iidx="' + ii + '" value="' + (item.unitario || 0) + '" min="0" style="width:100px;text-align:right;' + inputStyle + '"></td>';
            html += '<td style="padding:0.4rem;text-align:right;color:var(--text-primary);font-weight:600;font-size:0.9rem;" class="cot-item-total">' + formatCLP(itemTotal) + '</td>';
            html += '<td style="padding:0.4rem;text-align:center;">';
            if (!isBase) {
                html += '<button class="btn btn-secondary btn-sm cot-btn-remove-item" data-bidx="' + bIdx + '" data-iidx="' + ii + '" style="color:var(--danger);padding:0.1rem 0.4rem;">X</button>';
            }
            html += '</td>';
            html += '</tr>';
        }

        html += '</tbody></table>';

        // Subtotal bloque
        calcBloqueSubtotal(bloque);
        html += '<div style="text-align:right;margin-top:0.5rem;padding-top:0.5rem;border-top:1px solid var(--bg-secondary);">';
        html += '  <span style="color:var(--text-secondary);font-size:0.85rem;">Subtotal:</span> ';
        html += '  <span style="color:var(--text-primary);font-weight:700;" class="cot-bloque-subtotal" data-bidx="' + bIdx + '">' + formatCLP(bloque.subtotalBloque) + '</span>';
        html += '</div>';

        // Adicionales available (not yet added)
        var svc = findService(bloque.serviceId) || findService(bloque.serviceName);
        var tarif = parseTarifario(svc);
        if (tarif) {
            var availableAdicionales = [];
            if (tarif.adicionales) {
                for (var ai = 0; ai < tarif.adicionales.length; ai++) {
                    var ad = tarif.adicionales[ai];
                    var alreadyAdded = false;
                    for (var ei = 0; ei < bloque.items.length; ei++) {
                        if (bloque.items[ei].label === ad.label) {
                            alreadyAdded = true;
                            break;
                        }
                    }
                    if (!alreadyAdded) availableAdicionales.push(ad);
                }
            }
            var availablePacks = [];
            if (tarif.packs) {
                for (var pi = 0; pi < tarif.packs.length; pi++) {
                    var pk = tarif.packs[pi];
                    var packAdded = false;
                    for (var pe = 0; pe < bloque.items.length; pe++) {
                        if (bloque.items[pe].label === pk.label) {
                            packAdded = true;
                            break;
                        }
                    }
                    if (!packAdded) availablePacks.push(pk);
                }
            }

            if (availableAdicionales.length > 0 || availablePacks.length > 0) {
                html += '<div style="margin-top:0.5rem;">';
                html += '<span style="color:var(--text-secondary);font-size:0.8rem;">Agregar: </span>';
                for (var aai = 0; aai < availableAdicionales.length; aai++) {
                    html += '<button class="btn btn-secondary btn-sm cot-btn-add-adicional" data-bidx="' + bIdx + '" data-label="' + escapeHtml(availableAdicionales[aai].label) + '" style="margin:0.2rem 0.25rem;font-size:0.75rem;">+ ' + escapeHtml(availableAdicionales[aai].label) + '</button>';
                }
                for (var ppi = 0; ppi < availablePacks.length; ppi++) {
                    html += '<button class="btn btn-secondary btn-sm cot-btn-add-pack" data-bidx="' + bIdx + '" data-label="' + escapeHtml(availablePacks[ppi].label) + '" style="margin:0.2rem 0.25rem;font-size:0.75rem;border-color:var(--accent-primary);">+ ' + escapeHtml(availablePacks[ppi].label) + '</button>';
                }
                html += '</div>';
            }
        }

        // Always show "Add custom item" button
        html += '<div style="margin-top:0.5rem;">';
        html += '<button class="btn btn-secondary btn-sm cot-btn-add-custom" data-bidx="' + bIdx + '" style="margin:0.2rem 0.25rem;font-size:0.75rem;border-style:dashed;">+ Agregar item manual</button>';
        html += '</div>';

        html += '</div>'; // .cot-bloque
        return html;
    }

    function renderFormSummary() {
        var t = calcTotals();
        var html = '';
        html += '<div class="kpi-grid" id="cot-form-summary" style="margin-top:1.5rem;grid-template-columns:repeat(3,1fr);">';
        html += '  <div class="kpi-card"><div class="kpi-label">Subtotal</div><div class="kpi-value" id="cot-kpi-subtotal">' + formatCLP(t.subtotal) + '</div></div>';
        html += '  <div class="kpi-card"><div class="kpi-label">Descuento</div><div class="kpi-value" id="cot-kpi-descuento" style="color:var(--danger);">-' + formatCLP(t.descuento) + '</div></div>';
        html += '  <div class="kpi-card" style="border:1px solid var(--accent-primary);"><div class="kpi-label">Total Neto</div><div class="kpi-value" id="cot-kpi-total" style="font-size:1.4rem;">' + formatCLP(t.totalNeto) + '</div></div>';
        html += '</div>';
        return html;
    }

    // ── Preview View ──────────────────────────────────────────────────

    function renderPreviewView() {
        var t = calcTotals();
        var cotCodigo = '';
        var cotFecha = todayStr();
        var cotEstado = 'borrador';
        if (editingId) {
            var existing = findCot(editingId);
            if (existing) {
                cotCodigo = existing.codigo || '';
                cotFecha = existing.createdAt || todayStr();
                cotEstado = existing.estado || 'borrador';
            }
        }
        if (!cotCodigo) cotCodigo = generateCodigo();

        var html = '';

        // Action bar
        html += '<div class="toolbar preview-actions">';
        html += '  <button class="btn btn-secondary" id="cot-btn-back-form">Volver al formulario</button>';
        html += '  <button class="btn btn-primary" id="cot-btn-print">Descargar PDF</button>';
        html += '  <button class="btn btn-secondary" id="cot-btn-ops-view">Vista Operario (sin precios)</button>';
        html += '  <button class="btn btn-primary" id="cot-btn-save-final">Guardar</button>';
        if (cotEstado !== 'aprobada') {
            html += '  <button class="btn btn-primary" id="cot-btn-convert" style="background:var(--success);border-color:var(--success);">Convertir a Venta</button>';
        }
        html += '</div>';

        // ── Preview body (white, PDF-ready)
        html += '<div class="cotizador-preview" style="background:#fff;color:#222;padding:3rem;border-radius:12px;max-width:800px;margin:1rem auto;font-family:Arial,Helvetica,sans-serif;">';

        // Header
        html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #00c853;padding-bottom:1.5rem;margin-bottom:1.5rem;">';
        html += '  <div>';
        html += '    <h1 style="margin:0;font-size:2rem;color:#00c853;font-weight:800;letter-spacing:2px;">MAZELAB</h1>';
        html += '    <p style="margin:0.25rem 0 0;font-size:0.85rem;color:#666;">Produccion Audiovisual &amp; Tecnologia</p>';
        html += '  </div>';
        html += '  <div style="text-align:right;">';
        html += '    <h2 style="margin:0;font-size:1.3rem;color:#333;">COTIZACION ' + escapeHtml(cotCodigo) + '</h2>';
        html += '    <p style="margin:0.25rem 0 0;font-size:0.9rem;color:#666;">Fecha: ' + formatDateShort(cotFecha) + '</p>';
        html += '  </div>';
        html += '</div>';

        // Client info
        html += '<div style="margin-bottom:1.5rem;padding:1rem;background:#f9f8ff;border-radius:8px;">';
        html += '  <p style="margin:0.2rem 0;color:#444;"><strong>Cliente:</strong> ' + escapeHtml(formState.clientName) + '</p>';
        if (formState.contactName) html += '  <p style="margin:0.2rem 0;color:#444;"><strong>Contacto:</strong> ' + escapeHtml(formState.contactName) + '</p>';
        if (formState.contactEmail) html += '  <p style="margin:0.2rem 0;color:#444;"><strong>Email:</strong> ' + escapeHtml(formState.contactEmail) + '</p>';
        if (formState.eventName) html += '  <p style="margin:0.2rem 0;color:#444;"><strong>Evento:</strong> ' + escapeHtml(formState.eventName) + '</p>';
        if (formState.eventDate) html += '  <p style="margin:0.2rem 0;color:#444;"><strong>Fecha:</strong> ' + formatDateShort(formState.eventDate) + '</p>';
        if (formState.lugar) html += '  <p style="margin:0.2rem 0;color:#444;"><strong>Lugar:</strong> ' + escapeHtml(formState.lugar) + '</p>';
        html += '  <p style="margin:0.2rem 0;color:#444;"><strong>Validez:</strong> ' + (formState.validezDias || 7) + ' dias</p>';
        html += '</div>';

        // Bloques
        for (var bi = 0; bi < formState.bloques.length; bi++) {
            var bloque = formState.bloques[bi];
            html += '<div style="margin-bottom:1.5rem;">';
            html += '<h3 style="margin:0 0 0.5rem;font-size:1.1rem;color:#00c853;text-transform:uppercase;">' + escapeHtml(bloque.serviceName) + '</h3>';
            if (bloque.descripcion) {
                html += '<p style="margin:0 0 0.5rem;font-size:0.85rem;color:#666;white-space:pre-line;">' + escapeHtml(bloque.descripcion) + '</p>';
            }
            if (bloque.linkFotos || bloque.linkLanding) {
                html += '<p style="margin:0 0 0.5rem;font-size:0.8rem;">';
                if (bloque.linkFotos) html += '<a href="' + escapeHtml(bloque.linkFotos) + '" style="color:#00c853;">Ver fotos</a>';
                if (bloque.linkFotos && bloque.linkLanding) html += ' &middot; ';
                if (bloque.linkLanding) html += '<a href="' + escapeHtml(bloque.linkLanding) + '" style="color:#00c853;">Ver ficha del producto</a>';
                html += '</p>';
            }

            // Items table (only items with cantidad > 0)
            var hasItems = false;
            for (var ci2 = 0; ci2 < bloque.items.length; ci2++) {
                if ((bloque.items[ci2].cantidad || 0) > 0) { hasItems = true; break; }
            }
            if (hasItems) {
                html += '<table style="width:100%;border-collapse:collapse;">';
                for (var ii = 0; ii < bloque.items.length; ii++) {
                    var item = bloque.items[ii];
                    if ((item.cantidad || 0) <= 0) continue;
                    var itemDias2 = Number(item.dias) || 1;
                    var rowTotal = (Number(item.unitario) || 0) * (Number(item.cantidad) || 0) * itemDias2;
                    html += '<tr style="border-bottom:1px solid #e5e7eb;">';
                    html += '<td style="padding:0.5rem 0.5rem 0.5rem 0;color:#333;">';
                    html += '<strong>' + escapeHtml(item.label) + '</strong>';
                    var previewParts = [];
                    if (item.cantidad > 1) previewParts.push(item.cantidad + ' unid.');
                    if (itemDias2 > 1) previewParts.push(itemDias2 + ' ' + (bloque.diasLabel || 'dias'));
                    if (previewParts.length) html += ' <span style="color:#666;">(' + previewParts.join(' x ') + ')</span>';
                    if (item.descripcion) html += '<br><span style="font-size:0.8rem;color:#888;font-style:italic;white-space:pre-line;">' + escapeHtml(item.descripcion) + '</span>';
                    html += '</td>';
                    html += '<td class="cot-price" style="padding:0.5rem 0;text-align:right;color:#333;font-weight:600;white-space:nowrap;">' + formatCLP(rowTotal) + '</td>';
                    html += '</tr>';
                }
                html += '</table>';
            }

            // Opcionales (qty=0 items) — shown separately
            var opcionales = bloque.items.filter(function (it) { return (Number(it.cantidad) || 0) === 0 && (Number(it.unitario) || 0) > 0; });
            if (opcionales.length > 0) {
                html += '<div style="margin-top:0.5rem;padding-top:0.5rem;border-top:1px dashed #ccc;">';
                html += '<p style="font-size:0.8rem;color:#999;margin:0 0 0.3rem;font-style:italic;">Opcionales (no incluidos en el total):</p>';
                html += '<table style="width:100%;border-collapse:collapse;">';
                opcionales.forEach(function (op) {
                    html += '<tr style="opacity:0.7;"><td style="padding:0.3rem 0;color:#666;font-size:0.85rem;">' + escapeHtml(op.label) + '</td>';
                    html += '<td class="cot-price" style="padding:0.3rem 0;text-align:right;color:#666;font-size:0.85rem;">' + formatCLP(Number(op.unitario) || 0) + '</td></tr>';
                });
                html += '</table></div>';
            }

            // Bloque subtotal
            calcBloqueSubtotal(bloque);
            if (formState.bloques.length > 1) {
                html += '<div class="cot-price" style="text-align:right;margin-top:0.3rem;padding-top:0.3rem;font-size:0.85rem;color:#666;">Subtotal ' + escapeHtml(bloque.serviceName) + ': <strong style="color:#333;">' + formatCLP(bloque.subtotalBloque) + '</strong></div>';
            }
            html += '</div>';
        }

        // Grand totals
        html += '<div class="cot-price" style="margin-top:1.5rem;border-top:2px solid #e5e7eb;padding-top:1rem;">';
        html += '<table style="width:300px;margin-left:auto;border-collapse:collapse;">';
        html += '<tr><td style="padding:0.3rem 0;color:#555;">Subtotal</td><td style="padding:0.3rem 0;text-align:right;color:#333;">' + formatCLP(t.subtotal) + '</td></tr>';
        if (t.descuento > 0) {
            html += '<tr><td style="padding:0.3rem 0;color:#c00;">Descuento';
            if (formState.descuentoNota) html += ' <span style="font-size:0.8rem;font-style:italic;">(' + escapeHtml(formState.descuentoNota) + ')</span>';
            html += '</td><td style="padding:0.3rem 0;text-align:right;color:#c00;">-' + formatCLP(t.descuento) + '</td></tr>';
        }
        html += '<tr style="border-top:2px solid #00c853;"><td style="padding:0.6rem 0;font-weight:800;font-size:1.1rem;color:#00c853;">TOTAL</td><td style="padding:0.6rem 0;text-align:right;font-weight:800;font-size:1.1rem;color:#00c853;">' + formatCLP(t.totalNeto) + '</td></tr>';
        html += '</table>';
        html += '<p style="text-align:right;font-size:0.8rem;color:#999;margin-top:0.3rem;">*Valores no incluyen IVA</p>';
        html += '</div>';

        // Condiciones
        html += '<div style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid #e5e7eb;font-size:0.85rem;color:#666;">';
        html += '  <p style="margin:0.2rem 0;"><strong>Condiciones:</strong> ' + escapeHtml(formState.condiciones || '50% adelanto, 50% a 30 dias') + '</p>';

        // Company bank details
        var companyInfo = {};
        try { companyInfo = JSON.parse(localStorage.getItem('mazelab_company_info') || '{}'); } catch (e) {}
        if (companyInfo.banco) {
            html += '<p style="margin:0.5rem 0;"><strong>Datos de transferencia:</strong><br>';
            html += escapeHtml(companyInfo.nombre || '') + '<br>';
            html += escapeHtml(companyInfo.banco || '') + ' &middot; ' + escapeHtml(companyInfo.tipoCuenta || '') + ' &middot; ' + escapeHtml(companyInfo.numeroCuenta || '') + '<br>';
            if (companyInfo.rut) html += 'RUT: ' + escapeHtml(companyInfo.rut) + '<br>';
            if (companyInfo.email) html += escapeHtml(companyInfo.email);
            html += '</p>';
        }
        html += '</div>';

        html += '</div>'; // .cotizador-preview
        return html;
    }

    // ── View management ───────────────────────────────────────────────

    function showView(view) {
        currentView = view;
        var container = document.getElementById('cotizador-content');
        if (!container) return;

        if (view === 'list') {
            container.innerHTML = renderListView();
            bindListEvents();
        } else if (view === 'form') {
            container.innerHTML = renderFormView();
            bindFormEvents();
        } else if (view === 'preview') {
            container.innerHTML = renderPreviewView();
            bindPreviewEvents();
        }
    }

    // ── Read form state from DOM ──────────────────────────────────────

    function readFormState() {
        var el;
        el = document.getElementById('cot-clientName');
        if (el) formState.clientName = el.value.trim();
        el = document.getElementById('cot-contactName');
        if (el) formState.contactName = el.value.trim();
        el = document.getElementById('cot-contactEmail');
        if (el) formState.contactEmail = el.value.trim();
        el = document.getElementById('cot-contactTel');
        if (el) formState.contactTel = el.value.trim();
        el = document.getElementById('cot-eventName');
        if (el) formState.eventName = el.value.trim();
        el = document.getElementById('cot-eventDate');
        if (el) formState.eventDate = el.value;
        el = document.getElementById('cot-lugar');
        if (el) formState.lugar = el.value.trim();
        el = document.getElementById('cot-validezDias');
        if (el) formState.validezDias = parseInt(el.value, 10) || 7;
        el = document.getElementById('cot-condiciones');
        if (el) formState.condiciones = el.value.trim();
        el = document.getElementById('cot-descuento-nota');
        if (el) formState.descuentoNota = el.value.trim();
        el = document.getElementById('cot-notas');
        if (el) formState.notas = el.value.trim();

        // Read item quantities and prices from DOM
        var cantInputs = document.querySelectorAll('.cot-item-cantidad');
        for (var ci = 0; ci < cantInputs.length; ci++) {
            var bIdx = parseInt(cantInputs[ci].getAttribute('data-bidx'), 10);
            var iIdx = parseInt(cantInputs[ci].getAttribute('data-iidx'), 10);
            if (formState.bloques[bIdx] && formState.bloques[bIdx].items[iIdx]) {
                formState.bloques[bIdx].items[iIdx].cantidad = parseInt(cantInputs[ci].value, 10) || 0;
            }
        }
        var unitInputs = document.querySelectorAll('.cot-item-unitario');
        for (var ui = 0; ui < unitInputs.length; ui++) {
            var bIdx3 = parseInt(unitInputs[ui].getAttribute('data-bidx'), 10);
            var iIdx3 = parseInt(unitInputs[ui].getAttribute('data-iidx'), 10);
            if (formState.bloques[bIdx3] && formState.bloques[bIdx3].items[iIdx3]) {
                formState.bloques[bIdx3].items[iIdx3].unitario = parseFloat(unitInputs[ui].value) || 0;
            }
        }
        var diasInputs = document.querySelectorAll('.cot-item-dias');
        for (var di = 0; di < diasInputs.length; di++) {
            var bIdx4 = parseInt(diasInputs[di].getAttribute('data-bidx'), 10);
            var iIdx4 = parseInt(diasInputs[di].getAttribute('data-iidx'), 10);
            if (formState.bloques[bIdx4] && formState.bloques[bIdx4].items[iIdx4]) {
                formState.bloques[bIdx4].items[iIdx4].dias = parseInt(diasInputs[di].value, 10) || 1;
            }
        }
        var labelInputs = document.querySelectorAll('.cot-item-label');
        for (var li = 0; li < labelInputs.length; li++) {
            var bIdx5 = parseInt(labelInputs[li].getAttribute('data-bidx'), 10);
            var iIdx5 = parseInt(labelInputs[li].getAttribute('data-iidx'), 10);
            if (formState.bloques[bIdx5] && formState.bloques[bIdx5].items[iIdx5]) {
                formState.bloques[bIdx5].items[iIdx5].label = labelInputs[li].value;
            }
        }
        // Read bloque descriptions and names
        var descInputs = document.querySelectorAll('.cot-bloque-desc');
        for (var dci = 0; dci < descInputs.length; dci++) {
            var bIdx6 = parseInt(descInputs[dci].getAttribute('data-bidx'), 10);
            if (formState.bloques[bIdx6]) formState.bloques[bIdx6].descripcion = descInputs[dci].value;
        }
        var nameInputs = document.querySelectorAll('.cot-bloque-name');
        for (var nci = 0; nci < nameInputs.length; nci++) {
            var bIdx7 = parseInt(nameInputs[nci].getAttribute('data-bidx'), 10);
            if (formState.bloques[bIdx7]) formState.bloques[bIdx7].serviceName = nameInputs[nci].value;
        }
    }

    function loadCotIntoForm(cot) {
        formState = {
            clientName: cot.clientName || '',
            contactName: cot.contactName || '',
            contactEmail: cot.contactEmail || '',
            contactTel: cot.contactTel || '',
            eventName: cot.eventName || '',
            eventDate: cot.eventDate || '',
            lugar: cot.lugar || '',
            validezDias: cot.validezDias || 7,
            condiciones: cot.condiciones || '50% adelanto, 50% a 30 dias',
            descuento: cot.descuento || 0,
            descuentoNota: cot.descuentoNota || '',
            notas: cot.notas || '',
            bloques: []
        };
        var bloques = cot.bloques || [];
        for (var i = 0; i < bloques.length; i++) {
            var b = bloques[i];
            var items = [];
            var srcItems = b.items || [];
            for (var j = 0; j < srcItems.length; j++) {
                items.push({
                    tipo: srcItems[j].tipo || 'base',
                    label: srcItems[j].label || '',
                    descripcion: srcItems[j].descripcion || '',
                    unitario: Number(srcItems[j].unitario) || 0,
                    cantidad: Number(srcItems[j].cantidad) || 0,
                    total: Number(srcItems[j].total) || 0
                });
            }
            formState.bloques.push({
                serviceId: b.serviceId || null,
                serviceName: b.serviceName || '',
                descripcion: b.descripcion || '',
                linkFotos: b.linkFotos || '',
                linkLanding: b.linkLanding || '',
                items: items,
                subtotalBloque: b.subtotalBloque || 0
            });
        }
    }

    function syncDescuentoPct() {
        var t = calcTotals();
        var pctInput = document.getElementById('cot-descuento-pct');
        if (pctInput && t.subtotal > 0) {
            pctInput.value = Math.round(formState.descuento / t.subtotal * 10000) / 100;
        }
    }

    function updateLiveTotals() {
        var t = calcTotals();
        var kpiSub = document.getElementById('cot-kpi-subtotal');
        var kpiDesc = document.getElementById('cot-kpi-descuento');
        var kpiTotal = document.getElementById('cot-kpi-total');
        if (kpiSub) kpiSub.textContent = formatCLP(t.subtotal);
        if (kpiDesc) kpiDesc.textContent = '-' + formatCLP(t.descuento);
        if (kpiTotal) kpiTotal.textContent = formatCLP(t.totalNeto);

        // Update bloque subtotals
        var bloqueEls = document.querySelectorAll('.cot-bloque-subtotal');
        for (var i = 0; i < bloqueEls.length; i++) {
            var bIdx = parseInt(bloqueEls[i].getAttribute('data-bidx'), 10);
            if (formState.bloques[bIdx]) {
                bloqueEls[i].textContent = formatCLP(formState.bloques[bIdx].subtotalBloque);
            }
        }

        // Update item totals
        var itemTotalEls = document.querySelectorAll('.cot-item-total');
        for (var j = 0; j < itemTotalEls.length; j++) {
            var row = itemTotalEls[j].closest('.cot-item-row');
            if (!row) continue;
            var bi = parseInt(row.getAttribute('data-bidx'), 10);
            var ii = parseInt(row.getAttribute('data-iidx'), 10);
            if (formState.bloques[bi] && formState.bloques[bi].items[ii]) {
                var item = formState.bloques[bi].items[ii];
                itemTotalEls[j].textContent = formatCLP((Number(item.unitario) || 0) * (Number(item.cantidad) || 0));
            }
        }
    }

    // ── Save ─────────────────────────────────────────────────────────

    function saveCotizacion(status, callback) {
        readFormState();
        var t = calcTotals();
        var record = {
            clientName: formState.clientName,
            contactName: formState.contactName,
            contactEmail: formState.contactEmail,
            contactTel: formState.contactTel,
            eventName: formState.eventName,
            eventDate: formState.eventDate,
            lugar: formState.lugar,
            validezDias: formState.validezDias,
            condiciones: formState.condiciones,
            estado: status || 'borrador',
            bloques: formState.bloques,
            subtotal: t.subtotal,
            descuento: t.descuento,
            descuentoPct: t.descuentoPct,
            descuentoNota: formState.descuentoNota,
            totalNeto: t.totalNeto,
            notas: formState.notas
        };

        var DS = window.Mazelab.DataService;

        if (editingId) {
            var existing = findCot(editingId);
            record.id = editingId;
            record.codigo = existing ? existing.codigo : generateCodigo();
            record.version = existing ? (existing.version || 1) : 1;
            record.saleId = existing ? existing.saleId : null;
            record.createdAt = existing ? existing.createdAt : todayStr();
            record.updatedAt = new Date().toISOString();
            DS.update('cotizaciones', editingId, record).then(function () {
                for (var k = 0; k < cotizaciones.length; k++) {
                    if (cotizaciones[k].id === editingId) {
                        cotizaciones[k] = record;
                        break;
                    }
                }
                if (callback) { callback(record); return; }
                showView('list');
            }).catch(function (err) {
                console.error('Error updating cotizacion:', err);
                alert('Error al guardar.');
            });
        } else {
            record.id = 'cot-' + Date.now();
            record.codigo = generateCodigo();
            record.version = 1;
            record.saleId = null;
            record.createdAt = new Date().toISOString();
            record.updatedAt = new Date().toISOString();
            DS.create('cotizaciones', record).then(function () {
                cotizaciones.push(record);
                editingId = record.id;
                if (callback) { callback(record); return; }
                showView('list');
            }).catch(function (err) {
                console.error('Error creating cotizacion:', err);
                alert('Error al guardar.');
            });
        }
    }

    function deleteCotizacion(id) {
        if (!confirm('Eliminar esta cotizacion?')) return;
        var DS = window.Mazelab.DataService;
        DS.remove('cotizaciones', id).then(function () {
            cotizaciones = cotizaciones.filter(function (c) { return c.id !== id; });
            showView('list');
        }).catch(function (err) {
            console.error('Error deleting cotizacion:', err);
        });
    }

    function convertToSale() {
        readFormState();
        if (!formState.clientName || formState.bloques.length === 0) {
            alert('La cotizacion debe tener cliente y al menos un servicio.');
            return;
        }

        saveCotizacion('aprobada', function (savedCot) {
            var t = calcTotals();
            var serviceIds = [];
            var serviceNames = [];
            var maxDias = 1;
            for (var i = 0; i < formState.bloques.length; i++) {
                var bl = formState.bloques[i];
                if (bl.serviceId) serviceIds.push(bl.serviceId);
                if (bl.serviceName) serviceNames.push(bl.serviceName);
                for (var j = 0; j < bl.items.length; j++) {
                    var d = Number(bl.items[j].dias) || 1;
                    if (d > maxDias) maxDias = d;
                }
            }

            // Build structured comments
            var comments = '';
            comments += '-- Servicios: ' + serviceNames.join('; ') + '\n';
            comments += '-- Jornadas: ' + maxDias + '\n';
            if (savedCot.codigo) comments += '-- Cotización: ' + savedCot.codigo + '\n';
            if (formState.lugar) comments += '-- Lugar: ' + formState.lugar + '\n';
            if (formState.contactName) comments += '-- Contacto: ' + formState.contactName + (formState.contactTel ? ' (' + formState.contactTel + ')' : '') + '\n';
            if (formState.notas) comments += '\nNotas:\n' + formState.notas;

            // Store pre-fill data for Sales module to pick up
            window.Mazelab._pendingSaleFromCot = {
                cotId: savedCot.id,
                cotCodigo: savedCot.codigo || '',
                clientName: formState.clientName,
                eventName: formState.eventName || formState.clientName,
                eventDate: formState.eventDate || '',
                closingDate: todayStr(),
                serviceIds: serviceIds,
                amount: t.totalNeto,
                jornadas: maxDias,
                comments: comments
            };

            // Navigate to Sales module — it will detect _pendingSaleFromCot and open the form
            window.Mazelab.navigateTo('sales');
        });
    }

    // ── Service Bloque Management ─────────────────────────────────────

    function addServiceBloque(serviceName) {
        var svc = findService(serviceName);
        var tarif = parseTarifario(svc);
        var bloque = {
            serviceId: svc ? svc.id : null,
            serviceName: serviceName,
            descripcion: '',
            linkFotos: '',
            linkLanding: '',
            items: [],
            subtotalBloque: 0
        };

        // Auto-fill links from service config
        if (svc) {
            bloque.linkFotos = svc.link_fotos || '';
            bloque.linkLanding = svc.link_landing || '';
            bloque.descripcion = svc.descripcion || '';
        }

        if (tarif) {
            if (tarif.base) {
                bloque.items.push({
                    tipo: 'base',
                    label: tarif.base.label || serviceName,
                    descripcion: tarif.base.descripcion || '',
                    unitario: Number(tarif.base.unitario) || 0,
                    cantidad: 1,
                    total: Number(tarif.base.unitario) || 0
                });
                if (tarif.base.descripcion) bloque.descripcion = tarif.base.descripcion;
            }
        } else {
            bloque.items.push({
                tipo: 'base',
                label: serviceName,
                descripcion: '',
                unitario: svc ? (Number(svc.precio_base) || 0) : 0,
                cantidad: 1,
                total: svc ? (Number(svc.precio_base) || 0) : 0
            });
        }

        formState.bloques.push(bloque);
    }

    function addAdicionalToBloque(bIdx, label) {
        var bloque = formState.bloques[bIdx];
        if (!bloque) return;
        var svc = findService(bloque.serviceId) || findService(bloque.serviceName);
        var tarif = parseTarifario(svc);
        if (!tarif || !tarif.adicionales) return;

        for (var i = 0; i < tarif.adicionales.length; i++) {
            if (tarif.adicionales[i].label === label) {
                bloque.items.push({
                    tipo: 'adicional',
                    label: tarif.adicionales[i].label,
                    descripcion: tarif.adicionales[i].descripcion || '',
                    unitario: Number(tarif.adicionales[i].unitario) || 0,
                    cantidad: 1,
                    total: Number(tarif.adicionales[i].unitario) || 0
                });
                break;
            }
        }
    }

    function addPackToBloque(bIdx, label) {
        var bloque = formState.bloques[bIdx];
        if (!bloque) return;
        var svc = findService(bloque.serviceId) || findService(bloque.serviceName);
        var tarif = parseTarifario(svc);
        if (!tarif || !tarif.packs) return;

        for (var i = 0; i < tarif.packs.length; i++) {
            if (tarif.packs[i].label === label) {
                bloque.items.push({
                    tipo: 'pack',
                    label: tarif.packs[i].label,
                    descripcion: tarif.packs[i].descripcion || '',
                    unitario: Number(tarif.packs[i].unitario) || 0,
                    cantidad: 1,
                    total: Number(tarif.packs[i].unitario) || 0
                });
                break;
            }
        }
    }

    // ── Apply AI-generated cotización ─────────────────────────────────

    function applyAICotizacion(parsed) {
        editingId = null;
        resetFormState();

        // Fill client/event if provided
        if (parsed.clientName) formState.clientName = parsed.clientName;
        if (parsed.eventName) formState.eventName = parsed.eventName;
        if (parsed.eventDate) formState.eventDate = parsed.eventDate;
        if (parsed.lugar) formState.lugar = parsed.lugar;
        if (parsed.contactName) formState.contactName = parsed.contactName;

        // Build bloques from AI output
        if (parsed.bloques && parsed.bloques.length) {
            for (var b = 0; b < parsed.bloques.length; b++) {
                var aiBloque = parsed.bloques[b];
                var svcName = aiBloque.serviceName || '';
                var svc = findService(svcName);
                var bloque = {
                    serviceId: svc ? svc.id : null,
                    serviceName: svc ? (svc.name || svc.nombre || svcName) : svcName,
                    descripcion: aiBloque.descripcion || (svc ? (svc.descripcion || '') : ''),
                    linkFotos: svc ? (svc.link_fotos || '') : '',
                    linkLanding: svc ? (svc.link_landing || '') : '',
                    items: [],
                    subtotalBloque: 0
                };

                if (aiBloque.items && aiBloque.items.length) {
                    for (var ii = 0; ii < aiBloque.items.length; ii++) {
                        var aiItem = aiBloque.items[ii];
                        var cant = Number(aiItem.cantidad) || 1;
                        var dias = Number(aiItem.dias) || 1;
                        var unit = Number(aiItem.unitario) || 0;
                        // Fallback 1: if AI provided a total that doesn't match unit*cant*dias, infer dias
                        if (aiItem.total && unit > 0 && cant > 0 && dias === 1) {
                            var expectedTotal = unit * cant;
                            var aiTotal = Number(aiItem.total) || 0;
                            if (aiTotal > expectedTotal && expectedTotal > 0) {
                                var inferredDias = Math.round(aiTotal / expectedTotal);
                                if (inferredDias > 1) dias = inferredDias;
                            }
                        }
                        // Fallback 2: if unitario is much higher than catalog price, AI likely baked dias into unitario
                        if (dias === 1 && svc && unit > 0) {
                            var catTarif = parseTarifario(svc);
                            if (catTarif) {
                                var catUnit = 0;
                                if (aiItem.tipo === 'pack' && catTarif.packs) {
                                    for (var pi = 0; pi < catTarif.packs.length; pi++) {
                                        if (catTarif.packs[pi].unitario > catUnit) catUnit = catTarif.packs[pi].unitario;
                                    }
                                }
                                if (!catUnit && catTarif.base) catUnit = Number(catTarif.base.unitario) || 0;
                                if (catUnit > 0 && unit > catUnit * 1.5) {
                                    var inferDias2 = Math.round(unit / catUnit);
                                    if (inferDias2 > 1 && inferDias2 <= 365) {
                                        dias = inferDias2;
                                        unit = catUnit;
                                    }
                                }
                            }
                        }
                        bloque.items.push({
                            tipo: aiItem.tipo || 'base',
                            label: aiItem.label || svcName,
                            descripcion: aiItem.descripcion || '',
                            unitario: unit,
                            cantidad: cant,
                            dias: dias,
                            total: unit * cant * dias
                        });
                    }
                } else {
                    // Fallback: use addServiceBloque logic
                    addServiceBloque(svcName);
                    continue;
                }

                formState.bloques.push(bloque);
            }
        }

        // Apply discount
        if (parsed.descuento) formState.descuento = Number(parsed.descuento) || 0;
        if (parsed.descuentoNota) formState.descuentoNota = parsed.descuentoNota || '';

        calcTotals();
        showView('form');
    }

    // ── Event Binding ────────────────────────────────────────────────

    function bindListEvents() {
        var btnNew = document.getElementById('cot-btn-new');
        if (btnNew) {
            btnNew.addEventListener('click', function () {
                editingId = null;
                resetFormState();
                showView('form');
            });
        }

        // AI panel toggle
        var btnToggleAI = document.getElementById('cot-btn-toggle-ai');
        if (btnToggleAI) {
            btnToggleAI.addEventListener('click', function () {
                var panel = document.getElementById('cot-ai-panel');
                if (!panel) return;
                var isHidden = panel.style.display === 'none';
                panel.style.display = isHidden ? 'block' : 'none';
                btnToggleAI.textContent = isHidden ? 'Cerrar Asistente' : 'Asistente IA';
                if (isHidden) {
                    var input = document.getElementById('cot-ai-input');
                    if (input) input.focus();
                }
            });
        }

        // AI clear conversation
        var aiClearBtn = document.getElementById('cot-ai-clear');
        if (aiClearBtn) {
            aiClearBtn.addEventListener('click', function () {
                aiChatHistory = [];
                var messagesEl = document.getElementById('cot-ai-messages');
                if (messagesEl) messagesEl.innerHTML = '<div style="color:var(--text-secondary);font-size:12px;padding:8px;">Describe el evento y los servicios que necesitas. Ej: "Glambot 4 horas con pantalla para Banco Chile, 15 abril en CasaPiedra, que quede en 1.5M"</div>';
            });
        }

        // AI send message (with conversation history)
        var aiSendBtn = document.getElementById('cot-ai-send');
        var aiInput = document.getElementById('cot-ai-input');
        if (aiSendBtn && aiInput) {
            var sendAIMessage = async function () {
                var msg = aiInput.value.trim();
                if (!msg) return;

                var AI = window.Mazelab && window.Mazelab.AIService;
                if (!AI || !AI.getConfig().apiKey) {
                    alert('API Key no configurada. Ve a Configurar > Inteligencia Artificial.');
                    return;
                }

                var messagesEl = document.getElementById('cot-ai-messages');
                var statusEl = document.getElementById('cot-ai-status');

                // Add to history
                aiChatHistory.push({ role: 'user', content: msg });

                // Show user message
                messagesEl.innerHTML += '<div style="margin-bottom:8px;padding:8px 12px;background:var(--accent-primary);color:white;border-radius:8px 8px 2px 8px;max-width:80%;margin-left:auto;">' + escapeHtml(msg) + '</div>';
                aiInput.value = '';
                aiSendBtn.disabled = true;
                if (statusEl) statusEl.textContent = 'Pensando...';

                try {
                    // Send full conversation history
                    var response = await AI.generateCotizacion(aiChatHistory, services);

                    // Add assistant response to history
                    aiChatHistory.push({ role: 'assistant', content: response });

                    // Show AI response (strip JSON block from display for cleaner UX)
                    var displayText = response.replace(/```json[\s\S]*?```/g, '').trim();
                    var responseHtml = escapeHtml(displayText).split('\n').join('<br>');
                    messagesEl.innerHTML += '<div style="margin-bottom:8px;padding:8px 12px;background:var(--bg-tertiary);border-radius:8px 8px 8px 2px;max-width:90%;white-space:pre-wrap;font-size:12px;line-height:1.5;">' + responseHtml + '</div>';
                    messagesEl.scrollTop = messagesEl.scrollHeight;

                    // Try to detect JSON block for auto-fill
                    var jsonMatch = response.match(/```json\s*([\s\S]*?)```/);
                    if (!jsonMatch) {
                        var rawMatch = response.match(/(\{[\s\S]*?"bloques"\s*:\s*\[[\s\S]*?\][\s\S]*?\})/);
                        if (rawMatch) jsonMatch = rawMatch;
                    }
                    var parsedCot = null;
                    if (jsonMatch) {
                        var jsonStr = jsonMatch[1] || jsonMatch[0];
                        try { parsedCot = JSON.parse(jsonStr); } catch (e) {}
                        if (parsedCot && !parsedCot.bloques) parsedCot = null;
                    }

                    // Always show "Generar cotización" button — uses class-based delegation (no ID conflicts)
                    var buttonsHTML = '<div style="margin-bottom:8px;margin-top:4px;display:flex;gap:8px;">';
                    if (parsedCot) {
                        lastParsedCot = parsedCot;
                        buttonsHTML += '<button class="btn btn-primary btn-sm cot-ai-apply-btn">Crear cotizacion</button>';
                    } else {
                        buttonsHTML += '<button class="btn btn-secondary btn-sm cot-ai-generate-btn">Generar cotizacion</button>';
                    }
                    buttonsHTML += '</div>';
                    messagesEl.innerHTML += buttonsHTML;
                    messagesEl.scrollTop = messagesEl.scrollHeight;

                    if (statusEl) statusEl.textContent = '';
                } catch (err) {
                    messagesEl.innerHTML += '<div style="margin-bottom:8px;padding:8px 12px;background:rgba(231,76,60,0.15);border-radius:8px;color:var(--danger);font-size:12px;">' + escapeHtml(err.message || 'Error') + '</div>';
                    if (statusEl) statusEl.textContent = '';
                } finally {
                    aiSendBtn.disabled = false;
                    aiInput.focus();
                }
            };

            aiSendBtn.addEventListener('click', sendAIMessage);
            aiInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendAIMessage();
                }
            });

            // Delegated click handler for AI action buttons (class-based, survives innerHTML +=)
            var messagesElForDelegation = document.getElementById('cot-ai-messages');
            if (messagesElForDelegation) {
                messagesElForDelegation.addEventListener('click', function (e) {
                    if (e.target.classList.contains('cot-ai-apply-btn') && lastParsedCot) {
                        applyAICotizacion(lastParsedCot);
                        aiChatHistory = [];
                        lastParsedCot = null;
                    } else if (e.target.classList.contains('cot-ai-generate-btn')) {
                        aiInput.value = 'Genera la cotizacion con lo que hablamos.';
                        sendAIMessage();
                    }
                });
            }
        }

        // Delegation for list buttons
        var container = document.getElementById('cotizador-content');
        if (!container) return;
        container.addEventListener('click', function (e) {
            var target = e.target;
            if (target.classList.contains('cot-btn-view')) {
                var id = target.getAttribute('data-id');
                var cot = findCot(id);
                if (!cot) return;
                editingId = id;
                loadCotIntoForm(cot);
                showView('preview');
            } else if (target.classList.contains('cot-btn-edit')) {
                var id2 = target.getAttribute('data-id');
                var cot2 = findCot(id2);
                if (!cot2) return;
                editingId = id2;
                loadCotIntoForm(cot2);
                showView('form');
            } else if (target.classList.contains('cot-btn-delete')) {
                deleteCotizacion(target.getAttribute('data-id'));
            }
        });
    }

    function bindFormEvents() {
        // Back to list
        var btnBack = document.getElementById('cot-btn-back-list');
        if (btnBack) {
            btnBack.addEventListener('click', function () {
                editingId = null;
                resetFormState();
                showView('list');
            });
        }

        // Add service via inline datalist (not prompt)
        var btnAddService = document.getElementById('cot-btn-add-service');
        var newSvcInput = document.getElementById('cot-new-service-input');
        if (btnAddService && newSvcInput) {
            btnAddService.addEventListener('click', function () {
                var svcName = newSvcInput.value.trim();
                if (!svcName) { newSvcInput.focus(); return; }
                readFormState();
                addServiceBloque(svcName);
                showView('form');
            });
            newSvcInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    btnAddService.click();
                }
            });
        }

        // Preview button
        var btnPreview = document.getElementById('cot-btn-preview');
        if (btnPreview) {
            btnPreview.addEventListener('click', function () {
                readFormState();
                showView('preview');
            });
        }

        // Save draft button
        var btnSaveDraft = document.getElementById('cot-btn-save-draft');
        if (btnSaveDraft) {
            btnSaveDraft.addEventListener('click', function () {
                saveCotizacion('borrador');
            });
        }

        // Delegated click events on the bloques container
        var bloquesContainer = document.getElementById('cot-bloques-container');
        if (bloquesContainer) {
            bloquesContainer.addEventListener('click', function (e) {
                var target = e.target;

                if (target.classList.contains('cot-btn-remove-bloque')) {
                    readFormState();
                    var bIdx = parseInt(target.getAttribute('data-bidx'), 10);
                    formState.bloques.splice(bIdx, 1);
                    showView('form');
                    return;
                }

                if (target.classList.contains('cot-btn-move-bloque')) {
                    readFormState();
                    var mIdx = parseInt(target.getAttribute('data-bidx'), 10);
                    var dir = target.getAttribute('data-dir');
                    var swapIdx = dir === 'up' ? mIdx - 1 : mIdx + 1;
                    if (swapIdx >= 0 && swapIdx < formState.bloques.length) {
                        var tmp = formState.bloques[mIdx];
                        formState.bloques[mIdx] = formState.bloques[swapIdx];
                        formState.bloques[swapIdx] = tmp;
                    }
                    showView('form');
                    return;
                }

                if (target.classList.contains('cot-btn-remove-item')) {
                    readFormState();
                    var bIdx2 = parseInt(target.getAttribute('data-bidx'), 10);
                    var iIdx2 = parseInt(target.getAttribute('data-iidx'), 10);
                    if (formState.bloques[bIdx2]) {
                        formState.bloques[bIdx2].items.splice(iIdx2, 1);
                    }
                    showView('form');
                    return;
                }

                if (target.classList.contains('cot-btn-add-adicional')) {
                    readFormState();
                    var bIdx3 = parseInt(target.getAttribute('data-bidx'), 10);
                    var label = target.getAttribute('data-label');
                    addAdicionalToBloque(bIdx3, label);
                    showView('form');
                    return;
                }

                if (target.classList.contains('cot-btn-add-pack')) {
                    readFormState();
                    var bIdx4 = parseInt(target.getAttribute('data-bidx'), 10);
                    var packLabel = target.getAttribute('data-label');
                    addPackToBloque(bIdx4, packLabel);
                    showView('form');
                    return;
                }

                if (target.classList.contains('cot-toggle-col')) {
                    readFormState();
                    var togBIdx = parseInt(target.getAttribute('data-bidx'), 10);
                    var togCol = target.getAttribute('data-col');
                    if (formState.bloques[togBIdx]) {
                        formState.bloques[togBIdx][togCol] = !formState.bloques[togBIdx][togCol];
                    }
                    showView('form');
                    return;
                }

                if (target.classList.contains('cot-btn-add-custom')) {
                    readFormState();
                    var bIdx5 = parseInt(target.getAttribute('data-bidx'), 10);
                    if (formState.bloques[bIdx5]) {
                        formState.bloques[bIdx5].items.push({
                            tipo: 'adicional',
                            label: 'Item personalizado',
                            descripcion: '',
                            unitario: 0,
                            cantidad: 0,
                            dias: 1,
                            total: 0
                        });
                    }
                    showView('form');
                    return;
                }
            });
        }

        // Live calculation: delegated input events on bloques container
        if (bloquesContainer) {
            bloquesContainer.addEventListener('input', function (e) {
                var target = e.target;
                if (target.classList.contains('cot-bloque-desc')) {
                    var descBIdx = parseInt(target.getAttribute('data-bidx'), 10);
                    if (formState.bloques[descBIdx]) formState.bloques[descBIdx].descripcion = target.value;
                    return;
                }
                if (target.classList.contains('cot-bloque-name')) {
                    var nameBIdx = parseInt(target.getAttribute('data-bidx'), 10);
                    if (formState.bloques[nameBIdx]) formState.bloques[nameBIdx].serviceName = target.value;
                    return;
                }
                if (target.classList.contains('cot-dias-label')) {
                    var dlBIdx = parseInt(target.getAttribute('data-bidx'), 10);
                    if (formState.bloques[dlBIdx]) formState.bloques[dlBIdx].diasLabel = target.value;
                    return;
                }
                if (target.classList.contains('cot-cant-label')) {
                    var clBIdx = parseInt(target.getAttribute('data-bidx'), 10);
                    if (formState.bloques[clBIdx]) formState.bloques[clBIdx].cantLabel = target.value;
                    return;
                }
                if (target.classList.contains('cot-item-cantidad') || target.classList.contains('cot-item-unitario') || target.classList.contains('cot-item-dias') || target.classList.contains('cot-item-label')) {
                    var bIdx = parseInt(target.getAttribute('data-bidx'), 10);
                    var iIdx = parseInt(target.getAttribute('data-iidx'), 10);
                    if (formState.bloques[bIdx] && formState.bloques[bIdx].items[iIdx]) {
                        if (target.classList.contains('cot-item-cantidad')) {
                            formState.bloques[bIdx].items[iIdx].cantidad = parseInt(target.value, 10) || 0;
                        } else if (target.classList.contains('cot-item-dias')) {
                            formState.bloques[bIdx].items[iIdx].dias = parseInt(target.value, 10) || 1;
                        } else if (target.classList.contains('cot-item-unitario')) {
                            formState.bloques[bIdx].items[iIdx].unitario = parseFloat(target.value) || 0;
                        } else if (target.classList.contains('cot-item-label')) {
                            formState.bloques[bIdx].items[iIdx].label = target.value;
                        }
                        updateLiveTotals();
                    }
                }
            });
        }

        // Descuento input events (not delegated since they're specific IDs)
        var descMontoInput = document.getElementById('cot-descuento-monto');
        var descPctInput = document.getElementById('cot-descuento-pct');
        if (descMontoInput) {
            descMontoInput.addEventListener('input', function () {
                formState.descuento = parseFloat(this.value) || 0;
                syncDescuentoPct();
                updateLiveTotals();
            });
        }
        if (descPctInput) {
            descPctInput.addEventListener('input', function () {
                var pct = parseFloat(this.value) || 0;
                var t = calcTotals();
                var montoFromPct = Math.round(t.subtotal * pct / 100);
                formState.descuento = montoFromPct;
                if (descMontoInput) descMontoInput.value = montoFromPct > 0 ? montoFromPct : '';
                updateLiveTotals();
            });
        }

        // Client autocomplete with contact auto-fill
        if (window.Mazelab.Autocomplete) {
            window.Mazelab.Autocomplete.attachClientAutocomplete('cot-clientName', 'cot-contactName', 'cot-contactTel', 'cot-contactEmail');
        }
    }

    function bindPreviewEvents() {
        var btnBackForm = document.getElementById('cot-btn-back-form');
        if (btnBackForm) {
            btnBackForm.addEventListener('click', function () {
                showView('form');
            });
        }

        var btnPrint = document.getElementById('cot-btn-print');
        if (btnPrint) {
            btnPrint.addEventListener('click', async function () {
                var preview = document.querySelector('.cotizador-preview');
                if (!preview) return;

                var btn = this;
                btn.disabled = true;
                btn.textContent = 'Generando PDF...';

                var clientName = (formState.clientName || '').replace(/[^a-zA-Z0-9\s\u00e0-\u00ff]/g, '').trim();
                var eventName = (formState.eventName || '').replace(/[^a-zA-Z0-9\s\u00e0-\u00ff]/g, '').trim();
                var cotCode = '';
                var cotEl = document.querySelector('.cotizador-preview h2');
                if (cotEl) {
                    var match = (cotEl.textContent || '').match(/COT-\d+/);
                    if (match) cotCode = match[0];
                }
                var pdfName = cotCode || 'Cotizacion';
                if (clientName) pdfName += ' - ' + clientName;
                if (eventName) pdfName += ' - ' + eventName;

                try {
                    if (typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined') {
                        throw new Error('Librerías PDF no disponibles');
                    }
                    var canvas = await html2canvas(preview, {
                        scale: 2,
                        useCORS: true,
                        backgroundColor: '#ffffff',
                        scrollX: 0,
                        scrollY: -window.scrollY
                    });
                    var imgData = canvas.toDataURL('image/jpeg', 0.95);
                    var pdfWidth = 210;
                    var margin = 10;
                    var contentW = pdfWidth - margin * 2;
                    var contentH = (canvas.height * contentW) / canvas.width;
                    var pdfHeight = contentH + margin * 2;

                    var pdf = new window.jspdf.jsPDF({
                        orientation: 'portrait',
                        unit: 'mm',
                        format: [pdfWidth, pdfHeight]
                    });
                    pdf.addImage(imgData, 'JPEG', margin, margin, contentW, contentH);
                    pdf.save(pdfName + '.pdf');
                } catch (err) {
                    console.error('PDF error:', err);
                    alert('Error generando PDF: ' + err.message + '. Usando impresión del navegador.');
                    window.print();
                } finally {
                    btn.disabled = false;
                    btn.textContent = 'Descargar PDF';
                }
            });
        }

        // Ops view toggle — hide/show prices for screenshot
        var btnOpsView = document.getElementById('cot-btn-ops-view');
        if (btnOpsView) {
            btnOpsView.addEventListener('click', function () {
                var preview = document.querySelector('.cotizador-preview');
                if (!preview) return;
                var isOps = preview.classList.toggle('ops-mode');
                btnOpsView.textContent = isOps ? 'Vista Completa (con precios)' : 'Vista Operario (sin precios)';
            });
        }

        var btnSave = document.getElementById('cot-btn-save-final');
        if (btnSave) {
            btnSave.addEventListener('click', function () {
                saveCotizacion('borrador');
            });
        }

        var btnConvert = document.getElementById('cot-btn-convert');
        if (btnConvert) {
            btnConvert.addEventListener('click', function () {
                if (!confirm('Convertir esta cotizacion en una venta confirmada?')) return;
                convertToSale();
            });
        }
    }

    // ── Public API ─────────────────────────────────────────────────────

    function init() {
        currentView = 'list';
        editingId = null;
        _delegationBound = false;
        resetFormState();
        loadData(function () {
            showView('list');
        });
    }

    return { render: render, init: init };

})();
