// Modulo Caja Chica V2
//
// Flujo de negocio:
//   1. Aldo (admin) registra una transferencia de caja chica a David.
//   2. David (rol "operaciones") rinde gastos: sube una o varias fotos de
//      boletas + audio opcional grabado in-app. El backend (endpoint
//      /api/caja-chica/extract) llama a GPT-4o Vision + Whisper para extraer
//      monto/fecha/proveedor/categoria y transcribir el audio. El frontend
//      muestra preview editable.
//   3. El gasto se descuenta del balance disponible.
//   4. Aldo aprueba la asociacion del gasto a un evento (venta) para mapear
//      costos por evento.
//
// Novedades V2 (vs V1):
//   - FEATURE 1: el audio ahora se graba dentro de la app con MediaRecorder
//     (microfono del navegador). Reemplaza el file picker de audio. Si el
//     navegador no soporta MediaRecorder o el usuario niega el permiso, se
//     degrada al input de archivo viejo.
//   - FEATURE 2: David puede subir varias fotos a la vez. Cada boleta se
//     procesa con IA EN PARALELO y se arma una lista de gastos editables. Si
//     sube una sola foto el flujo sigue siendo el simple de V1.
//   - Categoria editable: el GPT sugiere una categoria; ahora es un campo
//     editable tanto en el flujo de una boleta como en cada gasto de la lista.
//
// Decisiones de arquitectura del frontend:
//   - Las tablas caja_chica_transferencias y caja_chica_gastos NO estan en el
//     TABLE_MAP de DataService (que solo conoce un set fijo de entidades). Por
//     eso este modulo habla DIRECTO con window.Mazelab.Supabase, que pasa el
//     nombre de tabla literal a /api/db/<tabla>. Asi no hay que tocar el
//     DataService compartido ni arriesgar romper otros modulos.
//   - El procesamiento de IA corre en el backend (OpenAI key del servidor). El
//     frontend asume que POST /api/caja-chica/extract existe y acepta tres
//     formas de payload: { imageBase64 }, { audioBase64 } o { imageBase64,
//     audioBase64 }. Si falla o no esta desplegado todavia, el modulo degrada a
//     entrada manual.
//
// Idioma: espanol neutro. Sin emojis literales en codigo/comentarios (se usan
// entidades HTML para iconos).

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

    // Estado de la vista David (flujo de captura).
    //
    // Modelo de datos del flujo de captura V2:
    //   - captura.fotos: array de strings base64 (cada foto ya comprimida).
    //     Vacio = sin fotos todavia. 1 = flujo simple. 2+ = flujo lista.
    //   - captura.audioBase64: data URI del audio grabado in-app (o subido por
    //     fallback). Es UN solo audio (contexto general de la rendicion).
    //   - captura.gastos: array de gastos editables (resultado de procesar las
    //     fotos). Cada item: { id, fotoBase64, monto, proveedor, fechaBoleta,
    //     categoria, items, gptRaw, error }. En flujo simple tiene 1 item.
    //   - captura.audioContext: { audioTranscripcion, eventoSugerido } extraido
    //     de la llamada audio-solo al endpoint. Se muestra como contexto general
    //     arriba de la lista y se replica en cada gasto al enviar.
    var captura = null;

    // Estado de la grabacion de audio (MediaRecorder). Vive fuera de "captura"
    // porque maneja objetos vivos (stream, recorder, timer) que no deben
    // serializarse ni perderse en cada rerender.
    var grabacion = {
        recorder: null,
        stream: null,
        chunks: [],
        activa: false,
        timer: null,
        segundos: 0,
        mimeType: null,
        soportado: null // null = sin chequear, true/false despues
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

    // =====================================================================
    // FLUJO DE CAPTURA (David) — V2 con multi-boleta + audio in-app
    // =====================================================================

    function resetCaptura() {
        captura = {
            fotos: [],          // array de base64 (cada foto comprimida)
            audioBase64: null,  // un solo audio (data URI)
            notasDavid: '',
            procesando: false,  // true mientras corre /extract en lote
            gastos: null,       // array de gastos editables (post-IA); null = no procesado
            audioContext: null, // { audioTranscripcion, eventoSugerido }
            errorExtract: null, // aviso global (fallback manual, etc.)
            enviando: false,    // true mientras corre el guardado en BD
            progresoEnvio: '',  // texto "Enviando 3 de 10..."
            resumenEnvio: null  // { ok, fail } al terminar
        };
        // Asegura que cualquier grabacion vieja quede liberada.
        cancelarGrabacion();
    }

    function openRendirModal() {
        resetCaptura();
        renderRendirModal();
    }

    function renderRendirModal() {
        var html = '<div class="modal-overlay active" id="cc-rendir-modal">' +
            '<div class="modal" style="max-width:520px">' +
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

    // ---- bloque de captura (fotos + audio + notas) ----

    function renderFotosBlock() {
        var previews = '';
        if (captura.fotos.length > 0) {
            previews = '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">' +
                captura.fotos.map(function (f, idx) {
                    return '<div style="position:relative;width:84px;height:84px">' +
                        '<img src="' + escapeHtml(f) + '" alt="boleta ' + (idx + 1) + '" style="width:84px;height:84px;object-fit:cover;border-radius:8px;border:1px solid var(--border-color)" />' +
                        '<button class="cc-foto-del" data-idx="' + idx + '" title="Quitar foto" ' +
                            'style="position:absolute;top:-6px;right:-6px;width:22px;height:22px;border-radius:50%;border:none;background:var(--danger,#ef4444);color:#fff;cursor:pointer;font-size:14px;line-height:1;display:flex;align-items:center;justify-content:center">&times;</button>' +
                    '</div>';
                }).join('') +
            '</div>';
        }

        var contador = captura.fotos.length > 0
            ? '<div style="font-size:12px;color:var(--text-secondary);margin-top:6px">' + captura.fotos.length + (captura.fotos.length === 1 ? ' boleta cargada.' : ' boletas cargadas. Cada una sera un gasto.') + '</div>'
            : '';

        // DECISION: el input es "multiple" SIN "capture". En moviles, combinar
        // "capture" con "multiple" obliga la camara y bloquea la seleccion de
        // varias fotos de la galeria. Quitando "capture" David puede elegir
        // varias de la galeria; si quiere usar la camara, el sistema operativo
        // igual ofrece la camara como una de las fuentes en la mayoria de los
        // celulares. Asi cubrimos foto unica y multi-boleta con un solo input.
        return '<div class="form-group">' +
                '<label>Fotos de boletas</label>' +
                '<input type="file" accept="image/*" multiple class="form-control" id="cc-foto-input" />' +
                '<small style="color:var(--text-secondary)">Puedes seleccionar varias boletas a la vez.</small>' +
                contador + previews +
            '</div>';
    }

    function renderAudioBlock() {
        // Si ya hay audio grabado/cargado: mini reproductor + volver a grabar.
        if (captura.audioBase64) {
            return '<div class="form-group">' +
                    '<label>Audio del gasto</label>' +
                    '<audio controls src="' + escapeHtml(captura.audioBase64) + '" style="width:100%;margin-top:4px"></audio>' +
                    '<div style="margin-top:8px">' +
                        '<button class="btn btn-sm btn-secondary" id="cc-audio-regrabar" type="button">&#x21bb; Volver a grabar</button>' +
                    '</div>' +
                '</div>';
        }

        // Si esta grabando: indicador + boton detener + contador.
        if (grabacion.activa) {
            return '<div class="form-group">' +
                    '<label>Audio explicando el gasto (opcional)</label>' +
                    '<div style="display:flex;align-items:center;gap:10px;margin-top:4px">' +
                        '<button class="btn btn-sm btn-danger" id="cc-audio-detener" type="button">&#9632; Detener</button>' +
                        '<span style="display:inline-flex;align-items:center;gap:6px;color:var(--danger,#ef4444);font-size:13px">' +
                            '<span style="width:10px;height:10px;border-radius:50%;background:var(--danger,#ef4444);display:inline-block;animation:cc-blink 1s infinite"></span>' +
                            'Grabando... <span id="cc-audio-timer">' + formatSegundos(grabacion.segundos) + '</span>' +
                        '</span>' +
                    '</div>' +
                '</div>';
        }

        // Estado inicial: boton grabar (microfono). Fallback al file input si el
        // navegador no soporta MediaRecorder.
        var soportaGrabar = mediaRecorderSoportado();
        var botonGrabar = soportaGrabar
            ? '<button class="btn btn-sm btn-secondary" id="cc-audio-grabar" type="button">&#127908; Grabar audio</button>'
            : '';
        var avisoNoSoporte = soportaGrabar
            ? ''
            : '<div style="font-size:12px;color:var(--text-muted);margin-top:4px">Tu navegador no permite grabar audio. Sube un archivo de audio si quieres.</div>';
        var fallbackFile = soportaGrabar
            ? ''
            : '<input type="file" accept="audio/*" class="form-control" id="cc-audio-input" style="margin-top:6px" />';
        var errorPermiso = grabacion.errorMsg
            ? '<div style="font-size:12px;color:var(--danger,#ef4444);margin-top:6px">' + escapeHtml(grabacion.errorMsg) + '</div>' +
              '<input type="file" accept="audio/*" class="form-control" id="cc-audio-input" style="margin-top:6px" />'
            : '';

        return '<div class="form-group">' +
                '<label>Audio explicando el gasto (opcional)</label>' +
                '<div style="margin-top:4px">' + botonGrabar + '</div>' +
                avisoNoSoporte + fallbackFile + errorPermiso +
            '</div>';
    }

    function renderCaptureBlock() {
        return renderFotosBlock() +
            renderAudioBlock() +
            '<div class="form-group">' +
                '<label>De que es? Que evento? (opcional)</label>' +
                '<textarea class="form-control" id="cc-notas-input" rows="2" placeholder="Ej: bencina para el evento Lupa">' + escapeHtml(captura.notasDavid) + '</textarea>' +
            '</div>';
    }

    // ---- contexto general del audio (transcripcion + evento sugerido) ----

    function renderAudioContext() {
        var c = captura.audioContext;
        if (!c || (!c.audioTranscripcion && !c.eventoSugerido)) return '';
        var trans = c.audioTranscripcion
            ? '<div style="font-size:12px;color:var(--text-secondary);font-style:italic">Audio: "' + escapeHtml(c.audioTranscripcion) + '"</div>'
            : '';
        var sug = c.eventoSugerido
            ? '<div style="font-size:12px;color:var(--text-muted);margin-top:4px">Evento sugerido: <strong>' + escapeHtml(c.eventoSugerido) + '</strong></div>'
            : '';
        return '<div style="background:var(--bg-secondary,rgba(255,255,255,0.04));border:1px solid var(--border-color);border-radius:8px;padding:10px;margin-bottom:12px">' +
            '<div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:4px">Contexto del audio (aplica a todas las boletas)</div>' +
            trans + sug +
        '</div>';
    }

    // ---- formulario editable de un gasto (reusable: simple y lista) ----

    function renderGastoEditable(g, idx, mostrarHeader) {
        var err = g.error
            ? '<div style="font-size:12px;color:#facc15;margin-bottom:6px">No se pudo leer esta boleta automaticamente. Completa los datos a mano.</div>'
            : '';
        var thumb = g.fotoBase64
            ? '<img src="' + escapeHtml(g.fotoBase64) + '" alt="boleta" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--border-color)" />'
            : '';
        var header = mostrarHeader
            ? '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px">' +
                '<div style="display:flex;align-items:center;gap:8px">' + thumb +
                    '<strong style="font-size:14px">Boleta ' + (idx + 1) + '</strong></div>' +
                '<button class="btn btn-sm btn-danger cc-gasto-del" data-idx="' + idx + '" type="button">Quitar</button>' +
            '</div>'
            : '';

        var wrapStyle = mostrarHeader
            ? 'border:1px solid var(--border-color);border-radius:10px;padding:12px;margin-bottom:12px'
            : '';

        return '<div class="cc-gasto-item" data-idx="' + idx + '" style="' + wrapStyle + '">' +
            header + err +
            '<div class="form-group" style="margin-bottom:8px">' +
                '<label>Monto</label>' +
                '<input type="number" class="form-control cc-g-monto" data-idx="' + idx + '" value="' + (g.monto != null ? Number(g.monto) : '') + '" min="0" step="1" />' +
            '</div>' +
            '<div class="form-group" style="margin-bottom:8px">' +
                '<label>Proveedor</label>' +
                '<input type="text" class="form-control cc-g-proveedor" data-idx="' + idx + '" value="' + escapeHtml(g.proveedor || '') + '" />' +
            '</div>' +
            '<div class="form-group" style="margin-bottom:8px">' +
                '<label>Fecha de la boleta</label>' +
                '<input type="date" class="form-control cc-g-fecha" data-idx="' + idx + '" value="' + escapeHtml(g.fechaBoleta || todayStr()) + '" />' +
            '</div>' +
            '<div class="form-group" style="margin-bottom:0">' +
                '<label>Categoria</label>' +
                '<input type="text" class="form-control cc-g-categoria" data-idx="' + idx + '" value="' + escapeHtml(g.categoria || '') + '" placeholder="Ej: transporte, insumos" />' +
            '</div>' +
        '</div>';
    }

    // ---- cuerpo del modal segun estado ----

    function renderRendirBody() {
        var captureBlock = renderCaptureBlock();

        // Estado: enviando a BD
        if (captura.enviando) {
            return '<div style="text-align:center;padding:24px;color:var(--text-secondary)">' +
                'Guardando gastos...<br/><strong>' + escapeHtml(captura.progresoEnvio) + '</strong></div>';
        }

        // Estado: resumen post-envio
        if (captura.resumenEnvio) {
            var r = captura.resumenEnvio;
            var msg = r.ok + (r.ok === 1 ? ' gasto enviado' : ' gastos enviados');
            if (r.fail > 0) msg += ', ' + r.fail + (r.fail === 1 ? ' fallo' : ' fallaron');
            msg += '.';
            return '<div style="text-align:center;padding:24px">' +
                '<div style="font-size:16px;font-weight:600;margin-bottom:12px">' + escapeHtml(msg) + '</div>' +
                '<button class="btn btn-primary" id="cc-rendir-cerrar-ok" type="button">Listo</button>' +
            '</div>';
        }

        // Estado: procesando con IA
        if (captura.procesando) {
            return captureBlock +
                '<div style="text-align:center;padding:16px;color:var(--text-secondary)">Procesando ' +
                (captura.fotos.length > 1 ? (captura.fotos.length + ' boletas') : 'la boleta') +
                ' con IA, espera un momento...</div>';
        }

        // Estado: ya tenemos gastos editables (post-IA o manual)
        if (captura.gastos && captura.gastos.length > 0) {
            var aviso = captura.errorExtract
                ? '<div style="background:rgba(250,204,21,0.12);border:1px solid rgba(250,204,21,0.4);color:#facc15;padding:10px;border-radius:8px;margin-bottom:12px;font-size:13px">' + escapeHtml(captura.errorExtract) + '</div>'
                : '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">Revisa lo que extrajo la IA y corrige si hace falta.</div>';

            var esMulti = captura.gastos.length > 1;
            var lista = captura.gastos.map(function (g, idx) {
                return renderGastoEditable(g, idx, esMulti);
            }).join('');

            var totalLinea = esMulti
                ? '<div style="text-align:right;font-size:13px;color:var(--text-secondary);margin:4px 0 12px">Total: <strong>' + formatCLP(sumarGastos()) + '</strong> en ' + captura.gastos.length + ' boletas</div>'
                : '';

            var btnEnviar = esMulti ? 'Enviar todo' : 'Enviar';

            return captureBlock +
                '<hr style="border:none;border-top:1px solid var(--border-color);margin:16px 0" />' +
                aviso +
                renderAudioContext() +
                lista +
                totalLinea +
                '<div class="modal-footer" style="padding:0;margin-top:8px">' +
                    '<button class="btn btn-secondary" id="cc-rendir-cancel">Cancelar</button>' +
                    '<button class="btn btn-primary" id="cc-rendir-enviar">' + btnEnviar + '</button>' +
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

    function sumarGastos() {
        if (!captura.gastos) return 0;
        return captura.gastos.reduce(function (acc, g) {
            return acc + (Number(g.monto) || 0);
        }, 0);
    }

    // ---- listeners del modal de rendicion ----

    function attachRendirListeners() {
        var closeBtn = document.getElementById('cc-rendir-close');
        if (closeBtn) closeBtn.addEventListener('click', cerrarRendir);
        var overlay = document.getElementById('cc-rendir-modal');
        if (overlay) overlay.addEventListener('click', function (e) {
            if (e.target.id === 'cc-rendir-modal') cerrarRendir();
        });

        var cancelBtn = document.getElementById('cc-rendir-cancel');
        if (cancelBtn) cancelBtn.addEventListener('click', cerrarRendir);

        var cerrarOk = document.getElementById('cc-rendir-cerrar-ok');
        if (cerrarOk) cerrarOk.addEventListener('click', cerrarRendir);

        var notas = document.getElementById('cc-notas-input');
        if (notas) notas.addEventListener('input', function () { captura.notasDavid = this.value; });

        var fotoInput = document.getElementById('cc-foto-input');
        if (fotoInput) fotoInput.addEventListener('change', onFotosSelected);

        // Borrar foto del preview (antes de procesar).
        document.querySelectorAll('.cc-foto-del').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var idx = Number(this.dataset.idx);
                captura.fotos.splice(idx, 1);
                rerenderRendirBody();
            });
        });

        // Audio: grabar / detener / regrabar / fallback file.
        var grabarBtn = document.getElementById('cc-audio-grabar');
        if (grabarBtn) grabarBtn.addEventListener('click', iniciarGrabacion);
        var detenerBtn = document.getElementById('cc-audio-detener');
        if (detenerBtn) detenerBtn.addEventListener('click', detenerGrabacion);
        var regrabarBtn = document.getElementById('cc-audio-regrabar');
        if (regrabarBtn) regrabarBtn.addEventListener('click', function () {
            captura.audioBase64 = null;
            captura.audioContext = null;
            rerenderRendirBody();
        });
        var audioInput = document.getElementById('cc-audio-input');
        if (audioInput) audioInput.addEventListener('change', onAudioFileSelected);

        var procesarBtn = document.getElementById('cc-rendir-procesar');
        if (procesarBtn) procesarBtn.addEventListener('click', procesarConIA);

        var manualBtn = document.getElementById('cc-rendir-manual');
        if (manualBtn) manualBtn.addEventListener('click', ingresarManual);

        // Edicion en vivo de los campos de cada gasto editable.
        attachGastoFieldListeners();

        // Quitar un gasto de la lista (multi).
        document.querySelectorAll('.cc-gasto-del').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var idx = Number(this.dataset.idx);
                captura.gastos.splice(idx, 1);
                if (captura.gastos.length === 0) {
                    // Si se queda sin gastos, vuelve al estado inicial de captura.
                    captura.gastos = null;
                    captura.errorExtract = null;
                }
                rerenderRendirBody();
            });
        });

        var enviarBtn = document.getElementById('cc-rendir-enviar');
        if (enviarBtn) enviarBtn.addEventListener('click', enviarGastos);
    }

    // Mantiene captura.gastos sincronizado con lo que el usuario edita, sin
    // re-renderizar (evita perder foco mientras escribe).
    function attachGastoFieldListeners() {
        function bind(selector, key, asNumber) {
            document.querySelectorAll(selector).forEach(function (el) {
                el.addEventListener('input', function () {
                    var idx = Number(this.dataset.idx);
                    if (!captura.gastos || !captura.gastos[idx]) return;
                    captura.gastos[idx][key] = asNumber ? Number(this.value) : this.value;
                });
            });
        }
        bind('.cc-g-monto', 'monto', true);
        bind('.cc-g-proveedor', 'proveedor', false);
        bind('.cc-g-fecha', 'fechaBoleta', false);
        bind('.cc-g-categoria', 'categoria', false);
    }

    function cerrarRendir() {
        cancelarGrabacion();
        closeModal();
    }

    // ---- captura de fotos ----

    async function onFotosSelected(e) {
        var files = e.target.files ? Array.prototype.slice.call(e.target.files) : [];
        if (files.length === 0) return;

        // Comprime cada archivo. Las compresiones son independientes -> paralelo.
        var comprimidas = await Promise.all(files.map(function (file) {
            return comprimirImagen(file).catch(function (err) {
                console.error('CajaChica: error comprimiendo imagen, fallback crudo', err);
                return fileToBase64(file).catch(function () { return null; });
            });
        }));

        comprimidas.forEach(function (b64) {
            if (b64) captura.fotos.push(b64);
        });
        rerenderRendirBody();
    }

    // ---- captura de audio (FEATURE 1: MediaRecorder in-app) ----

    function mediaRecorderSoportado() {
        return !!(window.MediaRecorder &&
            navigator.mediaDevices &&
            navigator.mediaDevices.getUserMedia);
    }

    function elegirMimeType() {
        // Probamos formatos comunes en orden de preferencia. isTypeSupported no
        // existe en todos los navegadores; si no esta, devolvemos null y dejamos
        // que MediaRecorder use su default.
        if (!window.MediaRecorder || !window.MediaRecorder.isTypeSupported) return null;
        var candidatos = ['audio/webm', 'audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg'];
        for (var i = 0; i < candidatos.length; i++) {
            if (window.MediaRecorder.isTypeSupported(candidatos[i])) return candidatos[i];
        }
        return null;
    }

    function formatSegundos(s) {
        var m = Math.floor(s / 60);
        var sec = s % 60;
        return (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
    }

    async function iniciarGrabacion() {
        grabacion.errorMsg = null;
        if (!mediaRecorderSoportado()) {
            grabacion.errorMsg = 'Tu navegador no permite grabar audio.';
            rerenderRendirBody();
            return;
        }
        try {
            var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            grabacion.stream = stream;
            grabacion.chunks = [];
            grabacion.segundos = 0;

            var mime = elegirMimeType();
            grabacion.mimeType = mime;
            var opciones = mime ? { mimeType: mime } : undefined;
            var recorder = new MediaRecorder(stream, opciones);
            grabacion.recorder = recorder;

            recorder.ondataavailable = function (ev) {
                if (ev.data && ev.data.size > 0) grabacion.chunks.push(ev.data);
            };
            recorder.onstop = onGrabacionStop;

            recorder.start();
            grabacion.activa = true;

            // Timer del contador (actualiza solo el span, no re-renderiza todo
            // para no romper el MediaRecorder ni el stream).
            grabacion.timer = setInterval(function () {
                grabacion.segundos += 1;
                var span = document.getElementById('cc-audio-timer');
                if (span) span.textContent = formatSegundos(grabacion.segundos);
            }, 1000);

            rerenderRendirBody();
        } catch (err) {
            console.warn('CajaChica: no se pudo iniciar grabacion', err);
            liberarStream();
            // NotAllowedError / PermissionDeniedError = permiso negado.
            if (err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError' || err.name === 'SecurityError')) {
                grabacion.errorMsg = 'Necesitas dar permiso al microfono para grabar. Tambien puedes subir un archivo de audio.';
            } else {
                grabacion.errorMsg = 'No se pudo acceder al microfono. Puedes subir un archivo de audio.';
            }
            grabacion.activa = false;
            rerenderRendirBody();
        }
    }

    function detenerGrabacion() {
        if (grabacion.timer) { clearInterval(grabacion.timer); grabacion.timer = null; }
        if (grabacion.recorder && grabacion.recorder.state !== 'inactive') {
            try { grabacion.recorder.stop(); } catch (e) {}
        } else {
            // Si por algun motivo no hay recorder activo, limpia igual.
            liberarStream();
            grabacion.activa = false;
            rerenderRendirBody();
        }
    }

    function onGrabacionStop() {
        grabacion.activa = false;
        if (grabacion.timer) { clearInterval(grabacion.timer); grabacion.timer = null; }

        var tipo = grabacion.mimeType || (grabacion.chunks[0] && grabacion.chunks[0].type) || 'audio/webm';
        var blob = new Blob(grabacion.chunks, { type: tipo });
        liberarStream();

        var reader = new FileReader();
        reader.onload = function (ev) {
            captura.audioBase64 = ev.target.result; // data URI con el tipo correcto
            captura.audioContext = null; // se recalcula al procesar
            rerenderRendirBody();
        };
        reader.onerror = function () {
            console.error('CajaChica: error convirtiendo audio grabado a base64');
            rerenderRendirBody();
        };
        reader.readAsDataURL(blob);
    }

    function liberarStream() {
        if (grabacion.stream) {
            try {
                grabacion.stream.getTracks().forEach(function (t) { t.stop(); });
            } catch (e) {}
            grabacion.stream = null;
        }
        grabacion.recorder = null;
    }

    // Cancela cualquier grabacion en curso y libera recursos (al cerrar modal o
    // resetear captura). No vuelca audio a captura.audioBase64.
    function cancelarGrabacion() {
        if (grabacion.timer) { clearInterval(grabacion.timer); grabacion.timer = null; }
        if (grabacion.recorder && grabacion.recorder.state !== 'inactive') {
            try {
                grabacion.recorder.onstop = null; // evita volcar el audio cancelado
                grabacion.recorder.stop();
            } catch (e) {}
        }
        liberarStream();
        grabacion.activa = false;
        grabacion.chunks = [];
        grabacion.segundos = 0;
        grabacion.errorMsg = null;
    }

    // Fallback: subir audio como archivo (cuando MediaRecorder no esta o el
    // permiso fue negado).
    async function onAudioFileSelected(e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
            captura.audioBase64 = await fileToBase64(file);
            captura.audioContext = null;
        } catch (err) {
            console.error('CajaChica: error leyendo audio', err);
        }
        rerenderRendirBody();
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

    // ---- ingreso manual (sin IA) ----

    function ingresarManual() {
        // Si hay fotos, una entrada por foto; si no hay fotos, una entrada vacia.
        var base = captura.fotos.length > 0 ? captura.fotos : [null];
        captura.gastos = base.map(function (foto) {
            return gastoVacio(foto);
        });
        captura.errorExtract = 'Ingreso manual: completa los datos del gasto.';
        rerenderRendirBody();
    }

    function gastoVacio(foto) {
        return {
            id: genId(),
            fotoBase64: foto || null,
            monto: null,
            proveedor: '',
            fechaBoleta: todayStr(),
            categoria: '',
            items: [],
            gptRaw: null,
            error: false
        };
    }

    // ---- procesamiento con IA (FEATURE 2: N boletas en paralelo) ----

    function llamarExtract(payload) {
        return fetch(EXTRACT_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(function (res) {
            return res.json().catch(function () { return null; }).then(function (data) {
                return { res: res, data: data };
            });
        });
    }

    async function procesarConIA() {
        if (captura.fotos.length === 0) {
            alert('Primero toma o sube al menos una foto de boleta.');
            return;
        }
        captura.procesando = true;
        captura.errorExtract = null;
        rerenderRendirBody();

        // 1) Una llamada /extract por foto, EN PARALELO. allSettled para que una
        //    foto que falle no tumbe a las demas.
        var fotoPromesas = captura.fotos.map(function (foto) {
            return llamarExtract({ imageBase64: foto });
        });

        // 2) Si hay audio, UNA llamada extra audio-solo para sacar transcripcion
        //    + evento sugerido (contexto general). Corre en paralelo con las
        //    fotos.
        var audioPromesa = captura.audioBase64
            ? llamarExtract({ audioBase64: captura.audioBase64 })
            : Promise.resolve(null);

        var fotosResult = await Promise.allSettled(fotoPromesas);
        var audioResult = await audioPromesa.then(
            function (v) { return { status: 'fulfilled', value: v }; },
            function (e) { return { status: 'rejected', reason: e }; }
        );

        // Mapea cada resultado de foto a un gasto editable.
        var algunFallo = false;
        captura.gastos = fotosResult.map(function (r, idx) {
            var foto = captura.fotos[idx];
            if (r.status === 'fulfilled' && r.value && r.value.res && r.value.res.ok &&
                r.value.data && r.value.data.ok && r.value.data.extracted) {
                var ex = r.value.data.extracted;
                return {
                    id: genId(),
                    fotoBase64: foto,
                    monto: ex.monto != null ? Number(ex.monto) : null,
                    proveedor: ex.proveedor || '',
                    fechaBoleta: ex.fechaBoleta || todayStr(),
                    categoria: ex.categoria || '',
                    items: ex.items || [],
                    gptRaw: (r.value.data && r.value.data.raw) || null,
                    error: false
                };
            }
            algunFallo = true;
            var g = gastoVacio(foto);
            g.error = true;
            return g;
        });

        // Procesa el contexto del audio (si vino).
        if (captura.audioBase64) {
            var av = audioResult.value;
            if (audioResult.status === 'fulfilled' && av && av.res && av.res.ok &&
                av.data && av.data.ok && av.data.extracted) {
                captura.audioContext = {
                    audioTranscripcion: av.data.extracted.audioTranscripcion || '',
                    eventoSugerido: av.data.extracted.eventoSugerido || ''
                };
            } else {
                captura.audioContext = null;
            }
        }

        // Aviso global: si todo fallo, mensaje de fallback manual. Si fallo solo
        // alguna, las que fallaron quedan marcadas con error y el usuario las
        // completa a mano.
        var todasFallaron = captura.gastos.every(function (g) { return g.error; });
        if (todasFallaron) {
            captura.errorExtract = 'El procesamiento automatico no esta disponible. Ingresa los datos manualmente.';
        } else if (algunFallo) {
            captura.errorExtract = 'Algunas boletas no se pudieron leer. Completa esas a mano.';
        } else {
            captura.errorExtract = null;
        }

        captura.procesando = false;
        rerenderRendirBody();
    }

    // ---- envio a BD (FEATURE 2: N gastos en paralelo) ----

    function sincronizarGastosDesdeDOM() {
        // Por si el ultimo input no disparo "input" antes de enviar, releemos los
        // valores actuales del DOM hacia captura.gastos.
        if (!captura.gastos) return;
        document.querySelectorAll('.cc-gasto-item').forEach(function (item) {
            var idx = Number(item.dataset.idx);
            var g = captura.gastos[idx];
            if (!g) return;
            var monto = item.querySelector('.cc-g-monto');
            var prov = item.querySelector('.cc-g-proveedor');
            var fecha = item.querySelector('.cc-g-fecha');
            var cat = item.querySelector('.cc-g-categoria');
            if (monto) g.monto = Number(monto.value);
            if (prov) g.proveedor = (prov.value || '').trim();
            if (fecha) g.fechaBoleta = fecha.value || todayStr();
            if (cat) g.categoria = (cat.value || '').trim();
        });
    }

    function construirRecord(g) {
        var user = currentUser();
        var ctx = captura.audioContext || {};
        return {
            id: g.id || genId(),
            transferenciaId: null,
            fechaBoleta: g.fechaBoleta || todayStr(),
            proveedor: (g.proveedor || '').trim(),
            monto: Number(g.monto) || 0,
            items: g.items || [],
            categoria: (g.categoria || '').trim(),
            fotoBase64: g.fotoBase64 || null,
            // DECISION: la transcripcion del audio es contexto general de la
            // rendicion, asi que se guarda en TODOS los gastos del lote. Asi el
            // admin ve el mismo contexto sin importar que boleta abra. El reparto
            // fino (audio -> boleta especifica) queda como feature futura.
            audioTranscripcion: ctx.audioTranscripcion || '',
            eventoId: null,
            eventoSugerido: ctx.eventoSugerido || '',
            eventoAprobado: false,
            notasDavid: captura.notasDavid || '',
            gptRaw: g.gptRaw || null,
            estado: 'pendiente_aprobacion',
            createdBy: user ? user.email : 'desconocido',
            createdAt: new Date().toISOString()
        };
    }

    async function enviarGastos() {
        sincronizarGastosDesdeDOM();

        if (!captura.gastos || captura.gastos.length === 0) {
            alert('No hay gastos para enviar.');
            return;
        }

        // Validacion: cada gasto necesita monto > 0. Listamos las boletas
        // invalidas para que el usuario sepa cual corregir.
        var invalidos = [];
        captura.gastos.forEach(function (g, idx) {
            if (!g.monto || Number(g.monto) <= 0) invalidos.push(idx + 1);
        });
        if (invalidos.length > 0) {
            alert('Ingresa un monto valido (mayor a cero) en ' +
                (captura.gastos.length > 1 ? ('la(s) boleta(s): ' + invalidos.join(', ')) : 'el gasto') + '.');
            return;
        }

        var total = captura.gastos.length;
        captura.enviando = true;
        captura.progresoEnvio = 'Enviando 0 de ' + total + '...';
        rerenderRendirBody();

        // Inserta los N gastos en paralelo. allSettled para que un fallo no
        // detenga al resto. Contamos el progreso a medida que resuelven.
        var hechos = 0;
        var promesas = captura.gastos.map(function (g) {
            var record = construirRecord(g);
            return SB().insert(TABLA_GASTOS, record).then(function () {
                hechos += 1;
                actualizarProgresoEnvio(hechos, total);
                return true;
            }, function (err) {
                hechos += 1;
                actualizarProgresoEnvio(hechos, total);
                console.error('CajaChica: fallo al insertar gasto', err);
                throw err;
            });
        });

        var resultados = await Promise.allSettled(promesas);
        var ok = resultados.filter(function (r) { return r.status === 'fulfilled'; }).length;
        var fail = total - ok;

        if (window.Mazelab.DataService.invalidateCache) {
            window.Mazelab.DataService.invalidateCache(TABLA_GASTOS);
        }

        captura.enviando = false;
        captura.resumenEnvio = { ok: ok, fail: fail };
        rerenderRendirBody();

        // Refresca los datos por detras (el resumen ya esta en pantalla).
        reload();
    }

    function actualizarProgresoEnvio(hechos, total) {
        captura.progresoEnvio = 'Enviando ' + hechos + ' de ' + total + '...';
        var body = document.getElementById('cc-rendir-body');
        if (body && captura.enviando) {
            // Actualiza solo el texto de progreso sin re-render completo.
            var strong = body.querySelector('strong');
            if (strong) strong.textContent = captura.progresoEnvio;
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
            // Animacion del punto rojo de "grabando". Inyectada una vez aqui para
            // no depender de tocar el CSS global del ERP.
            '<style>@keyframes cc-blink{0%,100%{opacity:1}50%{opacity:0.25}}</style>' +
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
