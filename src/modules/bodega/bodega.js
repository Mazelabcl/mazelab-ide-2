window.Mazelab.Modules.BodegaModule = (function () {
    var equipos = [];
    var filterCategoria = 'all';
    var filterEstado = 'all';
    var searchQuery = '';
    var editingId = null;

    var CATEGORIAS_SUGERIDAS = [
        'Notebooks', 'PCs', 'Tablets', 'Teléfonos',
        'Cámaras', 'Impresoras', 'Pantallas', 'Totems',
        'Sensores', 'Iluminación', 'Trípodes', 'Mobiliario',
        'Cables', 'Accesorios', 'Otro'
    ];

    var ESTADOS = [
        { value: 'bueno',         label: 'Bueno',            color: '#4ade80' },
        { value: 'dañado',        label: 'Dañado',           color: '#f87171' },
        { value: 'mantenimiento', label: 'En mantenimiento', color: '#facc15' },
        { value: 'baja',          label: 'Dado de baja',     color: '#6b7280' }
    ];

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function estadoInfo(val) {
        return ESTADOS.find(function (e) { return e.value === val; }) || { label: val || '—', color: '#6b7280' };
    }

    function generateEquipoId(categoria) {
        var prefix = (categoria || 'EQ').replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ]/g, '').substring(0, 3).toUpperCase() || 'EQ';
        var same = equipos.filter(function (e) { return (e.categoria || '') === categoria; });
        var num = String(same.length + 1).padStart(3, '0');
        return prefix + '-' + num;
    }

    function getFiltered() {
        return equipos.filter(function (e) {
            if (filterCategoria !== 'all' && e.categoria !== filterCategoria) return false;
            if (filterEstado !== 'all' && e.estado !== filterEstado) return false;
            if (searchQuery) {
                var q = searchQuery.toLowerCase();
                var match = (e.nombre || '').toLowerCase().includes(q) ||
                            (e.equipo_id || '').toLowerCase().includes(q) ||
                            (e.notas || '').toLowerCase().includes(q);
                if (!match) return false;
            }
            return true;
        });
    }

    function renderToolbar() {
        var usedCats = {};
        equipos.forEach(function (e) { if (e.categoria) usedCats[e.categoria] = true; });
        var allCats = Object.keys(usedCats).sort();
        var catOptions = '<option value="all">Todas las categorías</option>' +
            allCats.map(function (c) {
                return '<option value="' + escapeHtml(c) + '"' + (filterCategoria === c ? ' selected' : '') + '>' + escapeHtml(c) + '</option>';
            }).join('');

        var estadoOptions = '<option value="all">Todos los estados</option>' +
            ESTADOS.map(function (s) {
                return '<option value="' + s.value + '"' + (filterEstado === s.value ? ' selected' : '') + '>' + s.label + '</option>';
            }).join('');

        return '<div class="toolbar">' +
            '<div class="toolbar-left">' +
                '<input type="text" id="bodega-search" class="form-control" placeholder="Buscar equipo..." value="' + escapeHtml(searchQuery) + '" style="width:200px" />' +
                '<select id="bodega-filter-cat" class="form-control" style="width:190px">' + catOptions + '</select>' +
                '<select id="bodega-filter-estado" class="form-control" style="width:185px">' + estadoOptions + '</select>' +
            '</div>' +
            '<div class="toolbar-right">' +
                '<button class="btn btn-primary" id="bodega-add-btn">+ Agregar equipo</button>' +
            '</div>' +
        '</div>';
    }

    function renderStats() {
        var total = equipos.length;
        var buenos = equipos.filter(function (e) { return e.estado === 'bueno'; }).length;
        var dañados = equipos.filter(function (e) { return e.estado === 'dañado'; }).length;
        var mant = equipos.filter(function (e) { return e.estado === 'mantenimiento'; }).length;
        return '<div class="kpi-grid" style="margin-bottom:18px">' +
            '<div class="kpi-card"><div class="kpi-label">Total equipos</div><div class="kpi-value">' + total + '</div></div>' +
            '<div class="kpi-card"><div class="kpi-label">Buenos</div><div class="kpi-value" style="color:#4ade80">' + buenos + '</div></div>' +
            '<div class="kpi-card"><div class="kpi-label">Dañados</div><div class="kpi-value" style="color:#f87171">' + dañados + '</div></div>' +
            '<div class="kpi-card"><div class="kpi-label">En mantenimiento</div><div class="kpi-value" style="color:#facc15">' + mant + '</div></div>' +
        '</div>';
    }

    function renderTable() {
        var list = getFiltered();
        if (list.length === 0) {
            return '<div class="empty-state"><p>No hay equipos' + (searchQuery || filterCategoria !== 'all' || filterEstado !== 'all' ? ' con ese filtro' : '') + '.</p></div>';
        }

        var rows = list.map(function (e) {
            var est = estadoInfo(e.estado);
            var badge = '<span style="background:' + est.color + '22;color:' + est.color + ';border:1px solid ' + est.color + '44;padding:2px 10px;border-radius:20px;font-size:0.75rem;font-weight:600">' + escapeHtml(est.label) + '</span>';
            var occupiedCount = (window.Mazelab && window.Mazelab.BodegaOccupied && window.Mazelab.BodegaOccupied[String(e.id)]) || 0;
            var enUsoBadge = occupiedCount > 0
                ? '<span style="background:rgba(0,200,83,0.12);color:#00e676;border:1px solid rgba(0,200,83,0.3);padding:2px 10px;border-radius:20px;font-size:0.75rem;font-weight:600;margin-left:6px">Asignado a ' + occupiedCount + ' evento' + (occupiedCount > 1 ? 's' : '') + '</span>'
                : '';
            return '<tr>' +
                '<td><code style="font-size:0.8rem;color:var(--text-secondary)">' + escapeHtml(e.equipo_id || '—') + '</code></td>' +
                '<td><strong>' + escapeHtml(e.nombre || '—') + '</strong></td>' +
                '<td>' + escapeHtml(e.categoria || '—') + '</td>' +
                '<td>' + badge + enUsoBadge + '</td>' +
                '<td style="color:var(--text-secondary);font-size:0.85rem;max-width:250px;white-space:pre-wrap">' + escapeHtml(e.notas || '') + '</td>' +
                '<td>' +
                    '<button class="btn btn-sm btn-secondary bodega-hist-btn" data-id="' + e.id + '">Ver historial</button> ' +
                    '<button class="btn btn-sm btn-secondary bodega-edit-btn" data-id="' + e.id + '">Editar</button> ' +
                    '<button class="btn btn-sm btn-danger bodega-del-btn" data-id="' + e.id + '">Eliminar</button>' +
                '</td>' +
            '</tr>';
        }).join('');

        return '<div class="table-scroll"><table class="data-table">' +
            '<thead><tr><th>ID</th><th>Nombre</th><th>Categoría</th><th>Estado</th><th>Notas</th><th>Acciones</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
            '</table></div>';
    }

    function renderContent() {
        return renderStats() + renderTable();
    }

    function openModal(equipo) {
        editingId = equipo ? equipo.id : null;
        var t = equipo || {};

        var catSuggestions = CATEGORIAS_SUGERIDAS.concat(
            equipos.map(function(e) { return e.categoria || ''; }).filter(Boolean)
        ).filter(function(v, i, a) { return a.indexOf(v) === i; }).sort()
        .map(function(c) { return '<option value="' + escapeHtml(c) + '">'; }).join('');

        var estadoOptions = ESTADOS.map(function (s) {
            return '<option value="' + s.value + '"' + ((t.estado || 'bueno') === s.value ? ' selected' : '') + '>' + s.label + '</option>';
        }).join('');

        var html = '<div class="modal-overlay active" id="bodega-modal">' +
            '<div class="modal" style="max-width:480px">' +
                '<div class="modal-header">' +
                    '<h3>' + (editingId ? 'Editar equipo' : 'Agregar equipo') + '</h3>' +
                    '<button class="modal-close" id="bodega-modal-close">&times;</button>' +
                '</div>' +
                '<div class="modal-body">' +
                    '<div class="form-group">' +
                        '<label>Categoría</label>' +
                        '<datalist id="bq-cat-list">' + catSuggestions + '</datalist>' +
                        '<input type="text" class="form-control" id="bq-categoria" list="bq-cat-list" value="' + escapeHtml(t.categoria || '') + '" placeholder="Ej: Notebooks, Cámaras, Trípodes..." />' +
                    '</div>' +
                    '<div class="form-group">' +
                        '<label>Nombre</label>' +
                        '<input type="text" class="form-control" id="bq-nombre" value="' + escapeHtml(t.nombre || '') + '" placeholder="Ej: Notebook Dell XPS 15" />' +
                    '</div>' +
                    '<div class="form-group">' +
                        '<label>ID único</label>' +
                        '<input type="text" class="form-control" id="bq-equipo-id" value="' + escapeHtml(t.equipo_id || '') + '" placeholder="Ej: NB-001 (se genera automático si se deja vacío)" />' +
                        '<small style="color:var(--text-secondary)">Se genera automáticamente si se deja vacío.</small>' +
                    '</div>' +
                    '<div class="form-group">' +
                        '<label>Estado</label>' +
                        '<select class="form-control" id="bq-estado">' + estadoOptions + '</select>' +
                    '</div>' +
                    '<div class="form-group">' +
                        '<label>Notas de condición</label>' +
                        '<textarea class="form-control" id="bq-notas" rows="3" placeholder="Ej: Pantalla rayada en esquina inferior derecha">' + escapeHtml(t.notas || '') + '</textarea>' +
                    '</div>' +
                '</div>' +
                '<div class="modal-footer">' +
                    '<button class="btn btn-secondary" id="bodega-modal-cancel">Cancelar</button>' +
                    '<button class="btn btn-primary" id="bodega-modal-save">Guardar</button>' +
                '</div>' +
            '</div>' +
        '</div>';

        document.getElementById('modal-container').innerHTML = html;

        document.getElementById('bodega-modal-close').addEventListener('click', closeModal);
        document.getElementById('bodega-modal-cancel').addEventListener('click', closeModal);
        document.getElementById('bodega-modal').addEventListener('click', function (e) {
            if (e.target.id === 'bodega-modal') closeModal();
        });
        document.getElementById('bodega-modal-save').addEventListener('click', saveEquipo);
    }

    function estadoBadgeHtml(val) {
        var colorMap = { bueno: '#4ade80', dañado: '#f87171', mantenimiento: '#facc15' };
        var labelMap = { bueno: 'Bueno', dañado: 'Dañado', mantenimiento: 'En mantenimiento' };
        var color = colorMap[val] || '#6b7280';
        var label = labelMap[val] || val || '—';
        return '<span style="background:' + color + '22;color:' + color + ';border:1px solid ' + color + '44;padding:2px 10px;border-radius:20px;font-size:0.75rem;font-weight:600">' + escapeHtml(label) + '</span>';
    }

    async function openHistorialModal(equipo) {
        var sales = [];
        try {
            sales = await window.Mazelab.DataService.getAll('sales');
        } catch (err) {
            sales = [];
        }

        var historial = [];
        sales.forEach(function (sale) {
            var asignados = sale.equiposAsignados;
            if (!asignados || !Array.isArray(asignados)) return;
            asignados.forEach(function (item) {
                if (String(item.equipoId) !== String(equipo.id)) return;
                historial.push({
                    evento: sale.eventName || sale.clientName || '—',
                    fecha: sale.eventDate || sale.date || '',
                    estadoSalida: item.estadoSalida || '',
                    estadoRetorno: item.estadoRetorno || '',
                    notaRetorno: item.notaRetorno || '',
                    retornado: item.retornado
                });
            });
        });

        historial.sort(function (a, b) {
            if (a.fecha > b.fecha) return -1;
            if (a.fecha < b.fecha) return 1;
            return 0;
        });

        var bodyContent = '';
        if (historial.length === 0) {
            bodyContent = '<div class="empty-state" style="padding:24px 0"><p>Este equipo no tiene historial de uso.</p></div>';
        } else {
            var rows = historial.map(function (h) {
                var retornoBadge = h.retornado ? estadoBadgeHtml(h.estadoRetorno) : '<span style="color:var(--text-secondary);font-size:0.85rem">Pendiente</span>';
                return '<tr>' +
                    '<td>' + escapeHtml(h.evento) + '</td>' +
                    '<td>' + escapeHtml(h.fecha) + '</td>' +
                    '<td>' + estadoBadgeHtml(h.estadoSalida) + '</td>' +
                    '<td>' + retornoBadge + '</td>' +
                    '<td style="color:var(--text-secondary);font-size:0.85rem;max-width:200px;white-space:pre-wrap">' + escapeHtml(h.notaRetorno) + '</td>' +
                '</tr>';
            }).join('');

            bodyContent = '<div class="table-scroll"><table class="data-table">' +
                '<thead><tr><th>Evento</th><th>Fecha</th><th>Estado salida</th><th>Estado retorno</th><th>Nota retorno</th></tr></thead>' +
                '<tbody>' + rows + '</tbody>' +
            '</table></div>';
        }

        var displayId = equipo.equipo_id || equipo.id;
        var html = '<div class="modal-overlay active" id="bodega-historial-modal">' +
            '<div class="modal" style="max-width:720px">' +
                '<div class="modal-header">' +
                    '<h3>' + escapeHtml(displayId) + ' ' + escapeHtml(equipo.nombre || '') + ' — Historial</h3>' +
                    '<button class="modal-close" id="bodega-historial-close">&times;</button>' +
                '</div>' +
                '<div class="modal-body">' + bodyContent + '</div>' +
                '<div class="modal-footer">' +
                    '<button class="btn btn-secondary" id="bodega-historial-ok">Cerrar</button>' +
                '</div>' +
            '</div>' +
        '</div>';

        document.getElementById('modal-container').innerHTML = html;

        document.getElementById('bodega-historial-close').addEventListener('click', closeModal);
        document.getElementById('bodega-historial-ok').addEventListener('click', closeModal);
        document.getElementById('bodega-historial-modal').addEventListener('click', function (e) {
            if (e.target.id === 'bodega-historial-modal') closeModal();
        });
    }

    function closeModal() {
        document.getElementById('modal-container').innerHTML = '';
        editingId = null;
    }

    async function saveEquipo() {
        var nombre = (document.getElementById('bq-nombre').value || '').trim();
        var categoria = document.getElementById('bq-categoria').value;
        var equipoIdInput = (document.getElementById('bq-equipo-id').value || '').trim();
        var estado = document.getElementById('bq-estado').value;
        var notas = (document.getElementById('bq-notas').value || '').trim();

        if (!nombre) {
            alert('El nombre es obligatorio.');
            return;
        }

        var record = { nombre, categoria, estado, notas };

        if (editingId) {
            if (equipoIdInput) record.equipo_id = equipoIdInput;
            await window.Mazelab.DataService.update('bodega', editingId, record);
        } else {
            record.equipo_id = equipoIdInput || generateEquipoId(categoria);
            record.id = 'eq-' + Date.now();
            await window.Mazelab.DataService.create('bodega', record);
        }

        closeModal();
        await loadData();
        refreshContent();
    }

    async function deleteEquipo(id) {
        var eq = equipos.find(function (e) { return String(e.id) === String(id); });
        if (!eq) return;
        if (!confirm('¿Eliminar "' + (eq.nombre || eq.equipo_id) + '"? Esta acción no se puede deshacer.')) return;
        await window.Mazelab.DataService.remove('bodega', id);
        await loadData();
        refreshContent();
    }

    function refreshContent() {
        var toolbarEl = document.getElementById('bodega-toolbar-area');
        if (toolbarEl) {
            toolbarEl.innerHTML = renderToolbar();
            bindToolbarListeners();
        }
        var el = document.getElementById('bodega-content');
        if (el) el.innerHTML = renderContent();
        bindContentListeners();
    }

    function bindToolbarListeners() {
        var search = document.getElementById('bodega-search');
        if (search) search.addEventListener('input', function () {
            searchQuery = this.value;
            refreshContent();
        });

        var cat = document.getElementById('bodega-filter-cat');
        if (cat) cat.addEventListener('change', function () {
            filterCategoria = this.value;
            refreshContent();
        });

        var est = document.getElementById('bodega-filter-estado');
        if (est) est.addEventListener('change', function () {
            filterEstado = this.value;
            refreshContent();
        });

        var addBtn = document.getElementById('bodega-add-btn');
        if (addBtn) addBtn.addEventListener('click', function () {
            openModal(null);
        });
    }

    function bindContentListeners() {
        document.querySelectorAll('.bodega-hist-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var id = this.dataset.id;
                var eq = equipos.find(function (e) { return String(e.id) === String(id); });
                if (eq) openHistorialModal(eq);
            });
        });

        document.querySelectorAll('.bodega-edit-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var id = this.dataset.id;
                var eq = equipos.find(function (e) { return String(e.id) === String(id); });
                if (eq) openModal(eq);
            });
        });

        document.querySelectorAll('.bodega-del-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                deleteEquipo(this.dataset.id);
            });
        });
    }

    async function loadData() {
        equipos = await window.Mazelab.DataService.getAll('bodega');
    }

    function render() {
        return '<div class="module-container">' +
            '<div class="module-header">' +
                '<h2>Bodega</h2>' +
                '<p class="module-subtitle">Inventario de equipos</p>' +
            '</div>' +
            '<div id="bodega-toolbar-area"></div>' +
            '<div id="bodega-content">' +
                '<div class="empty-state"><p>Cargando...</p></div>' +
            '</div>' +
        '</div>';
    }

    async function init() {
        await loadData();
        refreshContent();
    }

    return { render, init };
})();
