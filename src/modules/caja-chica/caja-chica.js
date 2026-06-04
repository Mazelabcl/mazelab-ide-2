// Modulo Caja Chica V1
//
// Flujo de negocio:
//   1. Aldo (admin) registra una transferencia de caja chica a David.
//   2. David (rol "operaciones") rinde gastos: sube foto de boleta + audio
//      opcional. El backend (endpoint /api/caja-chica/extract) llama a
//      GPT-4o Vision + Whisper para extraer monto/fecha/proveedor y
//      transcribir el audio. El frontend muestra preview editable.
//   3. El gasto se descuenta del balance disponible.
//   4. Aldo aprueba la asociacion del gasto a un evento (venta) para mapear
//      costos por evento.
//
// Decisiones de arquitectura del frontend:
//   - Las tablas caja_chica_transferencias y caja_chica_gastos NO estan en el
//     TABLE_MAP de DataService (que solo conoce un set fijo de entidades). Por
//     eso este modulo habla DIRECTO con window.Mazelab.Supabase, que pasa el
//     nombre de tabla literal a /api/db/<tabla>. Asi no hay que tocar el
//     DataService compartido ni arriesgar romper otros modulos.
//   - El procesamiento de IA corre en el backend (OpenAI key del servidor). El
//     frontend asume que POST /api/caja-chica/extract existe. Si falla o no esta
//     desplegado todavia, el modulo degrada a entrada manual.
//
// Idioma: espanol neutro. Sin emojis en codigo/comentarios.

window.Mazelab = window.Mazelab || {};
window.Mazelab.Modules = window.Mazelab.Modules || {};

window.Mazelab.Modules.CajaChicaModule = (function () {

    // Nombres literales de tabla en el backend (mismos que el SQL).
    var TABLA_TRANSFERENCIAS = 'caja_chica_transferencias';
    var TABLA_GASTOS = 'caja_chica_gastos';
    var EXTRACT_ENDPOINT = '/api/caja-chica/extract';

    // Estado del modulo
    var transferencias = [];
    var gastos = [];
    var ventas = [];

    // Estado de la vista David (flujo de captura)
    var captura = {
        fotoBase64: null,
        audioBase64: null,
        notasDavid: '',
        procesando: false,
        extracted: null,   // resultado de GPT (o manual)
        errorExtract: null // mensaje de fallback si /extract fallo
    };

    // ---- helpers ----

    function escapeHtml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function formatCLP(n) {
        if (n == null || isNaN(n)) return '$0';
        var abs = Math.abs(Math.round(n));
        var s = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return (n < 0 ? '-$' : '$') + s;
    }

    function formatDate(d) {
        if (!d) return '-';
        var dt = window.MazelabDates ? window.MazelabDates.parseLocalDate(d) : new Date(d);
        if (!dt || isNaN(dt)) return String(d);
        return dt.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    function todayStr() {
        return window.MazelabDates ? window.MazelabDates.getTodayLocalStr() : new Date().toISOString().slice(0, 10);
    }

    function genId() {
        return Date.now().toString() + '_' + Math.random().toString(36).substring(2, 8);
    }

    function currentUser() {
        var Auth = window.Mazelab.Auth;
        return Auth ? Auth.getUser() : null;
    }

    // Marcador de peso: el monto real puede llevar "+1 peso al final" como
    // marcador de origen (convencion interna del ERP). montoNeto = monto sin ese
    // marcador. Resta solo la unidad del peso cuando el monto NO es multiplo de
    // 10 (es decir, hay un "1" suelto que no corresponde a un monto redondo).
    // Ej: 200001 -> 200000.  150000 -> 150000 (sin marcador, queda igual).
    function calcularMontoNeto(monto) {
        var m = Math.round(Number(monto) || 0);
        var resto = m % 10;
        return resto === 0 ? m : m - resto;
    }

    // ---- data layer (habla directo con Supabase por tablas no mapeadas) ----

    function SB() {
        return window.Mazelab.Supabase;
    }

    async function cargarDatos() {
        var sb = SB();
        var results = await Promise.all([
            sb.fetchAll(TABLA_TRANSFERENCIAS).catch(function () { return []; }),
            sb.fetchAll(TABLA_GASTOS).catch(function () { return []; }),
            // ventas via DataService (mapeado a 'ventas'); fallback a [].
            window.Mazelab.DataService.getAll('sales').catch(function () { return []; })
        ]);
        transferencias = results[0] || [];
        gastos = results[1] || [];
        ventas = results[2] || [];
    }

    // ---- calculos de balance ----

    function totalTransferido() {
        return transferencias
            .filter(function (t) { return (t.estado || 'activa') === 'activa'; })
            .reduce(function (acc, t) { return acc + Number(t.montoNeto || 0); }, 0);
    }

    function totalRendidoAprobado() {
        return gastos
            .filter(function (g) { return g.estado === 'aprobado'; })
            .reduce(function (acc, g) { return acc + Number(g.monto || 0); }, 0);
    }

    function disponible() {
        return totalTransferido() - totalRendidoAprobado();
    }

    // =====================================================================
    // VISTA ADMIN (Aldo)
    // =====================================================================

    function renderAdmin() {
        return renderBalanceCard(true) +
            '<div class="toolbar" style="margin-bottom:18px">' +
                '<div class="toolbar-left"></div>' +
                '<div class="toolbar-right">' +
                    '<button class="btn btn-primary" id="cc-add-transfer-btn">+ Registrar transferencia</button>' +
                '</div>' +
            '</div>' +
            renderPendientesAprobar() +
            renderAprobados() +
            renderTransferencias();
    }

    function renderBalanceCard(esAdmin) {
        var disp = disponible();
        var transferido = totalTransferido();
        var rendido = totalRendidoAprobado();
        var pendiente = gastos
            .filter(function (g) { return g.estado === 'pendiente_aprobacion'; })
            .reduce(function (acc, g) { return acc + Number(g.monto || 0); }, 0);

        if (esAdmin) {
            return '<div class="kpi-grid" style="margin-bottom:18px">' +
                '<div class="kpi-card accent"><div class="kpi-label">Disponible</div>' +
                    '<div class="kpi-value">' + formatCLP(disp) + '</div></div>' +
                '<div class="kpi-card"><div class="kpi-label">Total transferido</div>' +
                    '<div class="kpi-value">' + formatCLP(transferido) + '</div></div>' +
                '<div class="kpi-card success"><div class="kpi-label">Rendido (aprobado)</div>' +
                    '<div class="kpi-value">' + formatCLP(rendido) + '</div></div>' +
                '<div class="kpi-card warning"><div class="kpi-label">Pendiente de aprobar</div>' +
                    '<div class="kpi-value">' + formatCLP(pendiente) + '</div></div>' +
            '</div>';
        }
        // David: card grande de disponible
        return '<div class="card" style="margin-bottom:18px;text-align:center;padding:24px">' +
            '<div style="font-size:14px;color:var(--text-secondary)">Tienes para rendir</div>' +
            '<div style="font-size:40px;font-weight:800;color:var(--text-primary);margin:6px 0">' + formatCLP(disp) + '</div>' +
            '<div style="font-size:12px;color:var(--text-muted)">de caja chica</div>' +
        '</div>';
    }

    function renderPendientesAprobar() {
        var pend = gastos.filter(function (g) { return g.estado === 'pendiente_aprobacion'; });
        var body = '';
        if (pend.length === 0) {
            body = '<div class="empty-state" style="padding:24px 0"><p>No hay gastos pendientes de aprobar.</p></div>';
        } else {
            body = pend.map(renderGastoCardAdmin).join('');
        }
        return '<div class="card" style="margin-bottom:18px">' +
            '<div class="card-header"><span class="card-title">Gastos pendientes de aprobar</span>' +
                '<span class="badge badge-warning">' + pend.length + '</span></div>' +
            '<div class="card-body">' + body + '</div>' +
        '</div>';
    }

    function renderGastoCardAdmin(g) {
        var thumb = g.fotoBase64
            ? '<img src="' + escapeHtml(g.fotoBase64) + '" alt="boleta" style="width:120px;height:120px;object-fit:cover;border-radius:8px;border:1px solid var(--border-color);cursor:pointer" class="cc-thumb" data-id="' + escapeHtml(g.id) + '" />'
            : '<div style="width:120px;height:120px;border-radius:8px;border:1px dashed var(--border-color);display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:12px">Sin foto</div>';

        var ventaOptions = '<option value="">Selecciona evento...</option>' +
            ventas.map(function (v) {
                var nombre = v.eventName || v.clientName || ('Venta ' + (v.sourceId || v.id));
                var sel = (g.eventoId && String(g.eventoId) === String(v.id)) ? ' selected' : '';
                return '<option value="' + escapeHtml(String(v.id)) + '"' + sel + '>' + escapeHtml(nombre) + '</option>';
            }).join('');

        var sugerido = g.eventoSugerido
            ? '<div style="font-size:12px;color:var(--text-muted);margin-top:4px">Sugerido por IA: <strong>' + escapeHtml(g.eventoSugerido) + '</strong></div>'
            : '';

        var transcripcion = g.audioTranscripcion
            ? '<div style="font-size:12px;color:var(--text-secondary);margin-top:6px;font-style:italic">"' + escapeHtml(g.audioTranscripcion) + '"</div>'
            : '';

        var notas = g.notasDavid
            ? '<div style="font-size:12px;color:var(--text-secondary);margin-top:6px">Nota: ' + escapeHtml(g.notasDavid) + '</div>'
            : '';

        return '<div class="card" style="margin-bottom:12px;display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">' +
            thumb +
            '<div style="flex:1;min-width:220px">' +
                '<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px">' +
                    '<div><strong style="font-size:16px">' + escapeHtml(g.proveedor || 'Proveedor desconocido') + '</strong>' +
                        '<div style="font-size:13px;color:var(--text-secondary)">' + formatDate(g.fechaBoleta) +
                        (g.categoria ? ' &middot; ' + escapeHtml(g.categoria) : '') + '</div></div>' +
                    '<div style="font-size:20px;font-weight:700">' + formatCLP(g.monto) + '</div>' +
                '</div>' +
                sugerido + transcripcion + notas +
                '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
                    '<select class="form-control cc-evento-select" data-id="' + escapeHtml(g.id) + '" style="min-width:200px;flex:1">' + ventaOptions + '</select>' +
                    '<button class="btn btn-sm btn-primary cc-aprobar-btn" data-id="' + escapeHtml(g.id) + '">Aprobar</button>' +
                    '<button class="btn btn-sm btn-danger cc-rechazar-btn" data-id="' + escapeHtml(g.id) + '">Rechazar</button>' +
                '</div>' +
            '</div>' +
        '</div>';
    }

    function renderAprobados() {
        var aprob = gastos.filter(function (g) { return g.estado === 'aprobado'; });
        var rows = '';
        if (aprob.length === 0) {
            rows = '<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--text-muted)">Sin gastos aprobados todavia.</td></tr>';
        } else {
            rows = aprob.map(function (g) {
                var venta = ventas.find(function (v) { return String(v.id) === String(g.eventoId); });
                var ev = venta ? (venta.eventName || venta.clientName || venta.id) : (g.eventoSugerido || '-');
                return '<tr>' +
                    '<td>' + formatDate(g.fechaBoleta) + '</td>' +
                    '<td>' + escapeHtml(g.proveedor || '-') + '</td>' +
                    '<td class="text-right">' + formatCLP(g.monto) + '</td>' +
                    '<td>' + escapeHtml(ev) + '</td>' +
                    '<td>' + escapeHtml(g.createdBy || '-') + '</td>' +
                '</tr>';
            }).join('');
        }
        return '<div class="card" style="margin-bottom:18px">' +
            '<div class="card-header"><span class="card-title">Gastos aprobados</span></div>' +
            '<div class="table-scroll"><table class="data-table">' +
                '<thead><tr><th>Fecha boleta</th><th>Proveedor</th><th class="text-right">Monto</th><th>Evento</th><th>Rendido por</th></tr></thead>' +
                '<tbody>' + rows + '</tbody>' +
            '</table></div>' +
        '</div>';
    }

    function renderTransferencias() {
        var rows = '';
        if (transferencias.length === 0) {
            rows = '<tr><td colspan="4" style="text-align:center;padding:16px;color:var(--text-muted)">Sin transferencias registradas.</td></tr>';
        } else {
            rows = transferencias.slice().sort(function (a, b) {
                return (b.fecha || '') < (a.fecha || '') ? -1 : 1;
            }).map(function (t) {
                return '<tr>' +
                    '<td>' + formatDate(t.fecha) + '</td>' +
                    '<td class="text-right">' + formatCLP(t.montoNeto) + '</td>' +
                    '<td>' + escapeHtml(t.comentario || '-') + '</td>' +
                    '<td>' + escapeHtml(t.createdBy || '-') + '</td>' +
                '</tr>';
            }).join('');
        }
        return '<div class="card">' +
            '<div class="card-header"><span class="card-title">Historial de transferencias</span></div>' +
            '<div class="table-scroll"><table class="data-table">' +
                '<thead><tr><th>Fecha</th><th class="text-right">Monto</th><th>Comentario</th><th>Registrado por</th></tr></thead>' +
                '<tbody>' + rows + '</tbody>' +
            '</table></div>' +
        '</div>';
    }

    // ---- modal: registrar transferencia ----

    function openTransferModal() {
        var html = '<div class="modal-overlay active" id="cc-transfer-modal">' +
            '<div class="modal" style="max-width:460px">' +
                '<div class="modal-header">' +
                    '<h3>Registrar transferencia</h3>' +
                    '<button class="modal-close" id="cc-transfer-close">&times;</button>' +
                '</div>' +
                '<div class="modal-body">' +
                    '<div class="form-group">' +
                        '<label>Fecha</label>' +
                        '<input type="date" class="form-control" id="cc-transfer-fecha" value="' + todayStr() + '" />' +
                    '</div>' +
                    '<div class="form-group">' +
                        '<label>Monto transferido</label>' +
                        '<input type="number" class="form-control" id="cc-transfer-monto" placeholder="Ej: 200000" min="0" step="1" />' +
                        '<small style="color:var(--text-secondary)">Ingresa el monto real transferido. Si lleva el marcador de +1 peso al final, se guarda el monto neto automaticamente.</small>' +
                    '</div>' +
                    '<div class="form-group">' +
                        '<label>Comentario (opcional)</label>' +
                        '<textarea class="form-control" id="cc-transfer-comentario" rows="2" placeholder="Ej: Caja chica de junio para David"></textarea>' +
                    '</div>' +
                '</div>' +
                '<div class="modal-footer">' +
                    '<button class="btn btn-secondary" id="cc-transfer-cancel">Cancelar</button>' +
                    '<button class="btn btn-primary" id="cc-transfer-save">Guardar</button>' +
                '</div>' +
            '</div>' +
        '</div>';
        document.getElementById('modal-container').innerHTML = html;
        document.getElementById('cc-transfer-close').addEventListener('click', closeModal);
        document.getElementById('cc-transfer-cancel').addEventListener('click', closeModal);
        document.getElementById('cc-transfer-modal').addEventListener('click', function (e) {
            if (e.target.id === 'cc-transfer-modal') closeModal();
        });
        document.getElementById('cc-transfer-save').addEventListener('click', saveTransfer);
    }

    async function saveTransfer() {
        var fecha = document.getElementById('cc-transfer-fecha').value || todayStr();
        var montoRaw = Number(document.getElementById('cc-transfer-monto').value || 0);
        var comentario = (document.getElementById('cc-transfer-comentario').value || '').trim();

        if (!montoRaw || montoRaw <= 0) {
            alert('Ingresa un monto valido mayor a cero.');
            return;
        }

        var user = currentUser();
        var record = {
            id: genId(),
            fecha: fecha,
            monto: montoRaw,
            montoNeto: calcularMontoNeto(montoRaw),
            comentario: comentario,
            estado: 'activa',
            createdBy: user ? user.email : 'desconocido',
            createdAt: new Date().toISOString()
        };

        var saveBtn = document.getElementById('cc-transfer-save');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Guardando...'; }
        try {
            await SB().insert(TABLA_TRANSFERENCIAS, record);
            if (window.Mazelab.DataService.invalidateCache) {
                window.Mazelab.DataService.invalidateCache(TABLA_TRANSFERENCIAS);
            }
            closeModal();
            await reload();
        } catch (err) {
            console.error('CajaChica: error al guardar transferencia', err);
            alert('No se pudo guardar la transferencia. ' + (err && err.message ? err.message : ''));
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Guardar'; }
        }
    }

    // ---- acciones admin sobre gastos ----

    async function aprobarGasto(id) {
        var select = document.querySelector('.cc-evento-select[data-id="' + cssEscape(id) + '"]');
        var eventoId = select ? select.value : '';
        var updates = {
            eventoId: eventoId || null,
            eventoAprobado: true,
            estado: 'aprobado'
        };
        try {
            await SB().update(TABLA_GASTOS, id, updates);
            await reload();
        } catch (err) {
            console.error('CajaChica: error al aprobar gasto', err);
            alert('No se pudo aprobar el gasto.');
        }
    }

    async function rechazarGasto(id) {
        if (!confirm('Marcar este gasto como rechazado?')) return;
        try {
            await SB().update(TABLA_GASTOS, id, { estado: 'rechazado', eventoAprobado: false });
            await reload();
        } catch (err) {
            console.error('CajaChica: error al rechazar gasto', err);
            alert('No se pudo rechazar el gasto.');
        }
    }

    function cssEscape(s) {
        return String(s).replace(/(["\\\]\[])/g, '\\$1');
    }

    // =====================================================================
    // VISTA DAVID (operaciones) — mobile-first
    // =====================================================================

    function renderDavid() {
        return renderBalanceCard(false) +
            '<div style="text-align:center;margin-bottom:20px">' +
                '<button class="btn btn-primary" id="cc-rendir-btn" style="font-size:16px;padding:14px 28px;width:100%;max-width:360px">Rendir gasto</button>' +
            '</div>' +
            renderMisGastos();
    }

    function renderMisGastos() {
        var user = currentUser();
        var email = user ? user.email : '';
        var mios = gastos.filter(function (g) { return g.createdBy === email; })
            .sort(function (a, b) { return (b.createdAt || '') < (a.createdAt || '') ? -1 : 1; });

        var estadoMeta = {
            pendiente_aprobacion: { label: 'Pendiente', cls: 'badge-warning' },
            aprobado: { label: 'Aprobado', cls: 'badge-success' },
            rechazado: { label: 'Rechazado', cls: 'badge-danger' }
        };

        var body = '';
        if (mios.length === 0) {
            body = '<div class="empty-state" style="padding:24px 0"><p>Todavia no has rendido gastos.</p></div>';
        } else {
            body = mios.map(function (g) {
                var meta = estadoMeta[g.estado] || { label: g.estado || '-', cls: 'badge-info' };
                var thumb = g.fotoBase64
                    ? '<img src="' + escapeHtml(g.fotoBase64) + '" alt="boleta" style="width:56px;height:56px;object-fit:cover;border-radius:6px;border:1px solid var(--border-color)" />'
                    : '<div style="width:56px;height:56px;border-radius:6px;border:1px dashed var(--border-color)"></div>';
                return '<div class="card" style="margin-bottom:10px;display:flex;gap:12px;align-items:center">' +
                    thumb +
                    '<div style="flex:1;min-width:0">' +
                        '<div style="display:flex;justify-content:space-between;gap:8px">' +
                            '<strong>' + escapeHtml(g.proveedor || 'Sin proveedor') + '</strong>' +
                            '<span>' + formatCLP(g.monto) + '</span>' +
                        '</div>' +
                        '<div style="font-size:12px;color:var(--text-secondary)">' + formatDate(g.fechaBoleta) + '</div>' +
                    '</div>' +
                    '<span class="badge ' + meta.cls + '">' + meta.label + '</span>' +
                '</div>';
            }).join('');
        }
        return '<div class="card">' +
            '<div class="card-header"><span class="card-title">Mis gastos rendidos</span></div>' +
            '<div class="card-body">' + body + '</div>' +
        '</div>';
    }

    // ---- modal flujo de captura (David) ----

    function resetCaptura() {
        captura = {
            fotoBase64: null,
            audioBase64: null,
            notasDavid: '',
            procesando: false,
            extracted: null,
            errorExtract: null
        };
    }

    function openRendirModal() {
        resetCaptura();
        renderRendirModal();
    }

    function renderRendirModal() {
        var html = '<div class="modal-overlay active" id="cc-rendir-modal">' +
            '<div class="modal" style="max-width:480px">' +
                '<div class="modal-header">' +
                    '<h3>Rendir gasto</h3>' +
                    '<button class="modal-close" id="cc-rendir-close">&times;</button>' +
                '</div>' +
                '<div class="modal-body" id="cc-rendir-body">' + renderRendirBody() + '</div>' +
            '</div>' +
        '</div>';
        document.getElementById('modal-container').innerHTML = html;
        attachRendirListeners();
    }

    function renderRendirBody() {
        // Paso 1: captura de foto/audio (siempre visible)
        var fotoPreview = captura.fotoBase64
            ? '<img src="' + escapeHtml(captura.fotoBase64) + '" alt="boleta" style="width:100%;max-height:240px;object-fit:contain;border-radius:8px;border:1px solid var(--border-color);margin-top:8px" />'
            : '';

        var audioOk = captura.audioBase64
            ? '<div style="font-size:12px;color:var(--text-success,#4ade80);margin-top:4px">Audio cargado.</div>'
            : '';

        var captureBlock = '<div class="form-group">' +
                '<label>Foto de la boleta</label>' +
                '<input type="file" accept="image/*" capture="environment" class="form-control" id="cc-foto-input" />' +
                fotoPreview +
            '</div>' +
            '<div class="form-group">' +
                '<label>Audio explicando el gasto (opcional)</label>' +
                '<input type="file" accept="audio/*" capture class="form-control" id="cc-audio-input" />' +
                audioOk +
            '</div>' +
            '<div class="form-group">' +
                '<label>De que es? Que evento? (opcional)</label>' +
                '<textarea class="form-control" id="cc-notas-input" rows="2" placeholder="Ej: bencina para el evento Lupa">' + escapeHtml(captura.notasDavid) + '</textarea>' +
            '</div>';

        // Estado: procesando
        if (captura.procesando) {
            return captureBlock +
                '<div style="text-align:center;padding:16px;color:var(--text-secondary)">Procesando boleta con IA, espera un momento...</div>';
        }

        // Estado: tenemos extracted (de IA o manual) -> preview editable + enviar
        if (captura.extracted) {
            var e = captura.extracted;
            var aviso = captura.errorExtract
                ? '<div style="background:rgba(250,204,21,0.12);border:1px solid rgba(250,204,21,0.4);color:#facc15;padding:10px;border-radius:8px;margin-bottom:12px;font-size:13px">' + escapeHtml(captura.errorExtract) + '</div>'
                : '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">Revisa lo que extrajo la IA y corrige si hace falta.</div>';
            var transcripcion = e.audioTranscripcion
                ? '<div style="font-size:12px;color:var(--text-secondary);font-style:italic;margin-bottom:8px">Audio: "' + escapeHtml(e.audioTranscripcion) + '"</div>'
                : '';
            var sugerido = e.eventoSugerido
                ? '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Evento sugerido: <strong>' + escapeHtml(e.eventoSugerido) + '</strong></div>'
                : '';

            return captureBlock +
                '<hr style="border:none;border-top:1px solid var(--border-color);margin:16px 0" />' +
                aviso + transcripcion + sugerido +
                '<div class="form-group">' +
                    '<label>Monto</label>' +
                    '<input type="number" class="form-control" id="cc-ext-monto" value="' + (e.monto != null ? Number(e.monto) : '') + '" min="0" step="1" />' +
                '</div>' +
                '<div class="form-group">' +
                    '<label>Proveedor</label>' +
                    '<input type="text" class="form-control" id="cc-ext-proveedor" value="' + escapeHtml(e.proveedor || '') + '" />' +
                '</div>' +
                '<div class="form-group">' +
                    '<label>Fecha de la boleta</label>' +
                    '<input type="date" class="form-control" id="cc-ext-fecha" value="' + escapeHtml(e.fechaBoleta || todayStr()) + '" />' +
                '</div>' +
                '<div class="modal-footer" style="padding:0;margin-top:8px">' +
                    '<button class="btn btn-secondary" id="cc-rendir-cancel">Cancelar</button>' +
                    '<button class="btn btn-primary" id="cc-rendir-enviar">Enviar</button>' +
                '</div>';
        }

        // Estado inicial: solo captura + boton procesar / manual
        return captureBlock +
            '<div class="modal-footer" style="padding:0;margin-top:8px">' +
                '<button class="btn btn-secondary" id="cc-rendir-cancel">Cancelar</button>' +
                '<button class="btn btn-secondary" id="cc-rendir-manual">Ingresar manual</button>' +
                '<button class="btn btn-primary" id="cc-rendir-procesar">Procesar con IA</button>' +
            '</div>';
    }

    function rerenderRendirBody() {
        var body = document.getElementById('cc-rendir-body');
        if (body) {
            body.innerHTML = renderRendirBody();
            attachRendirListeners();
        }
    }

    function attachRendirListeners() {
        var closeBtn = document.getElementById('cc-rendir-close');
        if (closeBtn) closeBtn.addEventListener('click', closeModal);
        var overlay = document.getElementById('cc-rendir-modal');
        if (overlay) overlay.addEventListener('click', function (e) {
            if (e.target.id === 'cc-rendir-modal') closeModal();
        });

        var cancelBtn = document.getElementById('cc-rendir-cancel');
        if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

        var notas = document.getElementById('cc-notas-input');
        if (notas) notas.addEventListener('input', function () { captura.notasDavid = this.value; });

        var fotoInput = document.getElementById('cc-foto-input');
        if (fotoInput) fotoInput.addEventListener('change', onFotoSelected);

        var audioInput = document.getElementById('cc-audio-input');
        if (audioInput) audioInput.addEventListener('change', onAudioSelected);

        var procesarBtn = document.getElementById('cc-rendir-procesar');
        if (procesarBtn) procesarBtn.addEventListener('click', procesarConIA);

        var manualBtn = document.getElementById('cc-rendir-manual');
        if (manualBtn) manualBtn.addEventListener('click', function () {
            captura.extracted = {
                monto: null, proveedor: '', fechaBoleta: todayStr(),
                items: [], categoria: '', audioTranscripcion: '', eventoSugerido: ''
            };
            captura.errorExtract = 'Ingreso manual: completa los datos del gasto.';
            rerenderRendirBody();
        });

        var enviarBtn = document.getElementById('cc-rendir-enviar');
        if (enviarBtn) enviarBtn.addEventListener('click', enviarGasto);
    }

    // ---- compresion de imagen en el cliente ----
    // Redimensiona a max 1280px de ancho y exporta JPEG calidad 0.7 para no
    // reventar el payload ni la DB con base64 gigante.
    function comprimirImagen(file) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function (ev) {
                var img = new Image();
                img.onload = function () {
                    var maxW = 1280;
                    var scale = img.width > maxW ? maxW / img.width : 1;
                    var w = Math.round(img.width * scale);
                    var h = Math.round(img.height * scale);
                    var canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    var ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, w, h);
                    try {
                        resolve(canvas.toDataURL('image/jpeg', 0.7));
                    } catch (err) {
                        reject(err);
                    }
                };
                img.onerror = reject;
                img.src = ev.target.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    function fileToBase64(file) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function (ev) { resolve(ev.target.result); };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    async function onFotoSelected(e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
            captura.fotoBase64 = await comprimirImagen(file);
        } catch (err) {
            console.error('CajaChica: error comprimiendo imagen', err);
            // Fallback: base64 crudo si la compresion falla.
            try { captura.fotoBase64 = await fileToBase64(file); } catch (e2) {}
        }
        rerenderRendirBody();
    }

    async function onAudioSelected(e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
            captura.audioBase64 = await fileToBase64(file);
        } catch (err) {
            console.error('CajaChica: error leyendo audio', err);
        }
        rerenderRendirBody();
    }

    async function procesarConIA() {
        if (!captura.fotoBase64) {
            alert('Primero toma o sube la foto de la boleta.');
            return;
        }
        captura.procesando = true;
        captura.errorExtract = null;
        rerenderRendirBody();

        try {
            var res = await fetch(EXTRACT_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    imageBase64: captura.fotoBase64,
                    audioBase64: captura.audioBase64 || undefined
                })
            });

            var data = null;
            try { data = await res.json(); } catch (e) { data = null; }

            if (res.ok && data && data.ok && data.extracted) {
                captura.extracted = {
                    monto: data.extracted.monto != null ? Number(data.extracted.monto) : null,
                    proveedor: data.extracted.proveedor || '',
                    fechaBoleta: data.extracted.fechaBoleta || todayStr(),
                    items: data.extracted.items || [],
                    categoria: data.extracted.categoria || '',
                    audioTranscripcion: data.extracted.audioTranscripcion || '',
                    eventoSugerido: data.extracted.eventoSugerido || '',
                    gptRaw: data.raw || null
                };
                captura.errorExtract = null;
            } else {
                throw new Error((data && data.error) || 'El servidor no devolvio datos.');
            }
        } catch (err) {
            console.warn('CajaChica: /extract no disponible, fallback manual.', err);
            captura.extracted = {
                monto: null, proveedor: '', fechaBoleta: todayStr(),
                items: [], categoria: '', audioTranscripcion: '', eventoSugerido: ''
            };
            captura.errorExtract = 'El procesamiento automatico no esta disponible. Ingresa los datos manualmente.';
        } finally {
            captura.procesando = false;
            rerenderRendirBody();
        }
    }

    async function enviarGasto() {
        var montoEl = document.getElementById('cc-ext-monto');
        var provEl = document.getElementById('cc-ext-proveedor');
        var fechaEl = document.getElementById('cc-ext-fecha');

        var monto = montoEl ? Number(montoEl.value || 0) : 0;
        var proveedor = provEl ? (provEl.value || '').trim() : '';
        var fechaBoleta = fechaEl ? (fechaEl.value || todayStr()) : todayStr();

        if (!monto || monto <= 0) {
            alert('Ingresa un monto valido para el gasto.');
            return;
        }
        if (!captura.fotoBase64) {
            alert('Falta la foto de la boleta.');
            return;
        }

        var e = captura.extracted || {};
        var user = currentUser();
        var record = {
            id: genId(),
            transferenciaId: null,
            fechaBoleta: fechaBoleta,
            proveedor: proveedor,
            monto: monto,
            items: e.items || [],
            categoria: e.categoria || '',
            fotoBase64: captura.fotoBase64,
            audioTranscripcion: e.audioTranscripcion || '',
            eventoId: null,
            eventoSugerido: e.eventoSugerido || '',
            eventoAprobado: false,
            notasDavid: captura.notasDavid || '',
            gptRaw: e.gptRaw || null,
            estado: 'pendiente_aprobacion',
            createdBy: user ? user.email : 'desconocido',
            createdAt: new Date().toISOString()
        };

        var enviarBtn = document.getElementById('cc-rendir-enviar');
        if (enviarBtn) { enviarBtn.disabled = true; enviarBtn.textContent = 'Enviando...'; }
        try {
            await SB().insert(TABLA_GASTOS, record);
            if (window.Mazelab.DataService.invalidateCache) {
                window.Mazelab.DataService.invalidateCache(TABLA_GASTOS);
            }
            closeModal();
            await reload();
        } catch (err) {
            console.error('CajaChica: error al enviar gasto', err);
            alert('No se pudo enviar el gasto. ' + (err && err.message ? err.message : ''));
            if (enviarBtn) { enviarBtn.disabled = false; enviarBtn.textContent = 'Enviar'; }
        }
    }

    // ---- visor de foto en grande (admin) ----

    function openFotoModal(g) {
        if (!g || !g.fotoBase64) return;
        var html = '<div class="modal-overlay active" id="cc-foto-modal">' +
            '<div class="modal" style="max-width:640px">' +
                '<div class="modal-header">' +
                    '<h3>Boleta — ' + escapeHtml(g.proveedor || '') + '</h3>' +
                    '<button class="modal-close" id="cc-foto-close">&times;</button>' +
                '</div>' +
                '<div class="modal-body" style="text-align:center">' +
                    '<img src="' + escapeHtml(g.fotoBase64) + '" alt="boleta" style="max-width:100%;border-radius:8px" />' +
                '</div>' +
                '<div class="modal-footer">' +
                    '<button class="btn btn-secondary" id="cc-foto-ok">Cerrar</button>' +
                '</div>' +
            '</div>' +
        '</div>';
        document.getElementById('modal-container').innerHTML = html;
        document.getElementById('cc-foto-close').addEventListener('click', closeModal);
        document.getElementById('cc-foto-ok').addEventListener('click', closeModal);
        document.getElementById('cc-foto-modal').addEventListener('click', function (ev) {
            if (ev.target.id === 'cc-foto-modal') closeModal();
        });
    }

    function closeModal() {
        document.getElementById('modal-container').innerHTML = '';
    }

    // =====================================================================
    // SHELL + ORQUESTACION
    // =====================================================================

    function render() {
        return '<div class="content-header"><h2>Caja Chica</h2></div>' +
            '<div class="content-body" id="cc-content">' +
                '<div class="empty-state"><p>Cargando caja chica...</p></div>' +
            '</div>';
    }

    function refreshContent() {
        var container = document.getElementById('cc-content');
        if (!container) return;

        var Auth = window.Mazelab.Auth;
        var user = Auth ? Auth.getUser() : null;
        if (!user) {
            container.innerHTML = '<div class="empty-state"><p>Inicia sesion para usar Caja Chica.</p></div>';
            return;
        }

        if (Auth.isAdmin()) {
            container.innerHTML = renderAdmin();
            attachAdminListeners();
        } else if (user.role === 'operaciones') {
            container.innerHTML = renderDavid();
            attachDavidListeners();
        } else {
            container.innerHTML = '<div class="empty-state"><p>No tienes acceso a Caja Chica con tu rol actual.</p></div>';
        }
    }

    function attachAdminListeners() {
        var addBtn = document.getElementById('cc-add-transfer-btn');
        if (addBtn) addBtn.addEventListener('click', openTransferModal);

        document.querySelectorAll('.cc-aprobar-btn').forEach(function (btn) {
            btn.addEventListener('click', function () { aprobarGasto(this.dataset.id); });
        });
        document.querySelectorAll('.cc-rechazar-btn').forEach(function (btn) {
            btn.addEventListener('click', function () { rechazarGasto(this.dataset.id); });
        });
        document.querySelectorAll('.cc-thumb').forEach(function (img) {
            img.addEventListener('click', function () {
                var id = this.dataset.id;
                var g = gastos.find(function (x) { return String(x.id) === String(id); });
                openFotoModal(g);
            });
        });
    }

    function attachDavidListeners() {
        var rendirBtn = document.getElementById('cc-rendir-btn');
        if (rendirBtn) rendirBtn.addEventListener('click', openRendirModal);
    }

    async function reload() {
        try {
            await cargarDatos();
        } catch (err) {
            console.error('CajaChica: error al cargar datos', err);
        }
        refreshContent();
    }

    async function init() {
        resetCaptura();
        var container = document.getElementById('cc-content');
        try {
            await cargarDatos();
            refreshContent();
        } catch (err) {
            console.error('CajaChicaModule error:', err);
            if (container) {
                container.innerHTML = '<div class="empty-state"><p class="text-danger">Error al cargar Caja Chica. Revisa tu conexion.</p></div>';
            }
        }
    }

    return { render: render, init: init };

})();
