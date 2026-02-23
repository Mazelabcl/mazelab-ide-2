window.Mazelab = window.Mazelab || {};
window.Mazelab.Modules = window.Mazelab.Modules || {};

window.Mazelab.Modules.NominasModule = (function () {

    // ── State ──────────────────────────────────────────────────────────
    let payables = [];
    let cutoffDate = '';       // YYYY-MM-DD, default = hoy
    let activeTab = 'nomina';  // 'nomina' | 'proximas' | 'historial'

    // Por beneficiario: mapa de id → {amount, selected}
    // Permite overrides de monto y selección de BH individuales
    let selectionState = {};   // { [payableId]: { selected: bool, amount: number } }

    // ── Helpers compartidos con PayablesModule ─────────────────────────

    function formatCLP(n) {
        if (n == null || isNaN(n)) return '$0';
        var num = Math.round(Number(n));
        var str = Math.abs(num).toString();
        var parts = [];
        for (var i = str.length; i > 0; i -= 3) parts.unshift(str.substring(Math.max(0, i - 3), i));
        return (num < 0 ? '-' : '') + '$' + parts.join('.');
    }

    function todayStr() { return new Date().toISOString().substring(0, 10); }

    function getBHRetentionRate(dateStr) {
        if (!dateStr) return 0.1525;
        var year = new Date(dateStr).getFullYear();
        return year <= 2024 ? 0.145 : 0.1525;
    }

    function isBH(p) { return (p.docType || '').toLowerCase() === 'bh'; }

    function calcDueDate(dateStr) {
        if (!dateStr) return null;
        var d = new Date(dateStr);
        if (isNaN(d.getTime())) return null;
        d.setDate(d.getDate() + 30);
        var dow = d.getDay();
        if (dow !== 5) d.setDate(d.getDate() + ((5 - dow + 7) % 7));
        return d;
    }

    function formatDateShort(d) {
        if (!d) return '-';
        return d.getDate().toString().padStart(2, '0') + '/' +
               (d.getMonth() + 1).toString().padStart(2, '0') + '/' + d.getFullYear();
    }

    function getTotalPagado(p) {
        if (p.payments && Array.isArray(p.payments) && p.payments.length > 0) {
            return p.payments.reduce(function (s, pay) { return s + (Number(pay.amount) || 0); }, 0);
        }
        return Number(p.amountPaid) || 0;
    }

    function getStatusDerived(p) {
        var pagado = getTotalPagado(p);
        var amount = Number(p.amount) || 0;
        if (amount > 0 && pagado >= amount) return 'pagada';
        if (pagado > 0) return 'parcial';
        return p.status || 'pendiente';
    }

    function generateId() {
        return Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 9);
    }

    // Neto a transferir = bruto × (1 − retención)
    function calcNeto(p) {
        var rate = getBHRetentionRate(p.billingDate || p.eventDate);
        return Math.round((Number(p.amount) || 0) * (1 - rate));
    }

    // Neto pendiente = neto total − ya pagado (payments[] son montos transferidos)
    function calcNetoPendiente(p) {
        return Math.max(0, calcNeto(p) - getTotalPagado(p));
    }

    // Referencia corta para el comentario de transferencia
    // Prioridad: docNumber numérico → abreviatura del evento → índice secuencial
    function shortRef(p, idx) {
        var dn = (p.docNumber || '').trim();
        if (dn && /^\d+$/.test(dn)) return dn;
        var name = (p.eventName || '').trim();
        if (name) {
            // Tomar primeras letras de cada palabra, máx 4 chars
            var abbr = name.split(/\s+/).map(function (w) { return w[0] || ''; }).join('').toUpperCase().substring(0, 4);
            if (abbr) return abbr;
        }
        return String(idx + 1);
    }

    // Genera el comentario de transferencia (máx 40 chars)
    function buildTransferComment(items) {
        var refs = items.map(function (p, i) { return shortRef(p, i); });
        var comment = 'BH ' + refs.join('-');
        if (comment.length <= 40) return comment;
        // Si excede, truncar refs hasta caber
        var base = 'BH ';
        var fitted = [];
        for (var i = 0; i < refs.length; i++) {
            var candidate = base + fitted.concat([refs[i]]).join('-');
            if (candidate.length > 40) break;
            fitted.push(refs[i]);
        }
        return base + fitted.join('-');
    }

    // ── Filtros de elegibilidad ────────────────────────────────────────

    function getCutoff() {
        var d = new Date(cutoffDate || todayStr());
        d.setHours(23, 59, 59, 999);
        return d;
    }

    // BH que entran en la nómina actual (vencidas ≤ cutoff, no pagadas)
    function getEligibleBH() {
        var cutoff = getCutoff();
        return payables.filter(function (p) {
            if (!isBH(p)) return false;
            if (getStatusDerived(p) === 'pagada') return false;
            var dd = calcDueDate(p.eventDate);
            if (!dd) return false;
            return dd <= cutoff;
        });
    }

    // BH que vencen en los próximos N días (sin llegar al cutoff)
    function getUpcomingBH(days) {
        var cutoff = getCutoff();
        var horizon = new Date(cutoff.getTime() + days * 86400000);
        return payables.filter(function (p) {
            if (!isBH(p)) return false;
            if (getStatusDerived(p) === 'pagada') return false;
            var dd = calcDueDate(p.eventDate);
            if (!dd) return false;
            return dd > cutoff && dd <= horizon;
        });
    }

    // BH pagadas (historial)
    function getPaidBH() {
        return payables.filter(function (p) {
            return isBH(p) && getStatusDerived(p) === 'pagada';
        });
    }

    // Agrupa items por vendorName
    function groupByVendor(items) {
        var groups = {};
        var order = [];
        items.forEach(function (p) {
            var key = (p.vendorName || 'Sin beneficiario').trim();
            if (!groups[key]) { groups[key] = []; order.push(key); }
            groups[key].push(p);
        });
        return order.map(function (k) { return { vendor: k, items: groups[k] }; });
    }

    // ── Inicialización del estado de selección ─────────────────────────

    function initSelectionState(eligible) {
        var next = {};
        eligible.forEach(function (p) {
            if (selectionState[p.id]) {
                next[p.id] = selectionState[p.id];
            } else {
                next[p.id] = { selected: true, amount: calcNetoPendiente(p) };
            }
        });
        selectionState = next;
    }

    // ── Render: shell ──────────────────────────────────────────────────

    function render() {
        return [
            '<div class="page-header">',
            '  <div>',
            '    <h1 class="page-title">N\u00f3minas de Pago</h1>',
            '    <p class="page-subtitle">Genera y gestiona las transferencias semanales a beneficiarios</p>',
            '  </div>',
            '</div>',
            '<div id="nominas-root"><div class="empty-state"><p>Cargando...</p></div></div>'
        ].join('\n');
    }

    // ── Render: contenido principal ────────────────────────────────────

    function renderContent() {
        var eligible  = getEligibleBH();
        var upcoming  = getUpcomingBH(14);
        var paid      = getPaidBH();
        initSelectionState(eligible);

        var root = document.getElementById('nominas-root');
        if (!root) return;

        root.innerHTML = [
            renderControls(eligible),
            renderTabs(eligible.length, upcoming.length),
            '<div id="nominas-tab-content">',
            activeTab === 'nomina'    ? renderNominaTab(eligible)    : '',
            activeTab === 'proximas'  ? renderProximasTab(upcoming)  : '',
            activeTab === 'historial' ? renderHistorialTab(paid)     : '',
            '</div>'
        ].join('\n');

        bindEvents();
    }

    // ── Controles superiores ───────────────────────────────────────────

    function renderControls(eligible) {
        var totalSelected = 0;
        var selectedVendors = new Set();
        eligible.forEach(function (p) {
            var s = selectionState[p.id];
            if (s && s.selected) {
                totalSelected += s.amount;
                selectedVendors.add(p.vendorName || 'Sin beneficiario');
            }
        });

        return [
            '<div style="display:flex;align-items:center;gap:var(--space-md);flex-wrap:wrap;margin-bottom:var(--space-lg)">',
            '  <div style="display:flex;align-items:center;gap:8px">',
            '    <label style="font-size:13px;color:var(--text-secondary);white-space:nowrap">Corte al:</label>',
            '    <input type="date" id="nominas-cutoff" class="form-control" style="width:160px" value="' + (cutoffDate || todayStr()) + '">',
            '  </div>',
            '  <div style="margin-left:auto;display:flex;gap:var(--space-sm);align-items:center">',
            '    <span style="font-size:13px;color:var(--text-secondary)">' + selectedVendors.size + ' beneficiarios \u00b7 <strong style="color:var(--text-primary)">' + formatCLP(totalSelected) + '</strong> total</span>',
            '  </div>',
            '</div>'
        ].join('\n');
    }

    // ── Tabs ───────────────────────────────────────────────────────────

    function renderTabs(eligibleCount, upcomingCount) {
        function tab(id, label, count, badge) {
            var active = activeTab === id;
            var badgeHtml = count > 0
                ? ' <span style="background:' + (badge || 'var(--primary)') + ';color:#fff;border-radius:10px;padding:1px 7px;font-size:11px;font-weight:600;margin-left:4px">' + count + '</span>'
                : '';
            return '<div class="tab-btn' + (active ? ' active' : '') + '" data-tab="' + id + '" style="cursor:pointer;padding:8px 18px;border-radius:8px;font-size:14px;font-weight:500;' +
                   (active ? 'background:var(--primary);color:#fff;' : 'color:var(--text-secondary);') + '">' + label + badgeHtml + '</div>';
        }
        return [
            '<div style="display:flex;gap:6px;margin-bottom:var(--space-lg);border-bottom:1px solid var(--border);padding-bottom:var(--space-sm)">',
            tab('nomina',    'N\u00f3mina actual', eligibleCount, eligibleCount > 0 ? '#e74c3c' : null),
            tab('proximas',  'Pr\u00f3ximas',      upcomingCount, upcomingCount > 0 ? '#f39c12' : null),
            tab('historial', 'Historial',           0, null),
            '</div>'
        ].join('\n');
    }

    // ── Tab: Nómina actual ─────────────────────────────────────────────

    function renderNominaTab(eligible) {
        if (!eligible.length) {
            return [
                '<div class="empty-state">',
                '  <div style="font-size:40px;margin-bottom:12px">&#10003;</div>',
                '  <p style="font-size:16px;font-weight:600;margin-bottom:6px">Sin pagos pendientes</p>',
                '  <p style="color:var(--text-muted)">No hay BH que hayan cumplido los 30 d\u00edas al ' + (cutoffDate || todayStr()) + '</p>',
                '</div>'
            ].join('\n');
        }

        var groups = groupByVendor(eligible);
        return groups.map(function (g) { return renderBeneficiaryCard(g.vendor, g.items); }).join('\n');
    }

    // ── Tarjeta por beneficiario ───────────────────────────────────────

    function renderBeneficiaryCard(vendor, items) {
        var totalNeto    = 0;
        var totalPendiente = 0;
        var selectedItems = [];

        items.forEach(function (p) {
            totalNeto += calcNeto(p);
            var s = selectionState[p.id] || { selected: true, amount: calcNetoPendiente(p) };
            if (s.selected) {
                totalPendiente += s.amount;
                selectedItems.push(p);
            }
        });

        var comment     = buildTransferComment(selectedItems);
        var commentLen  = comment.length;
        var commentWarn = commentLen > 40;
        var commentColor = commentWarn ? 'var(--danger)' : commentLen > 32 ? 'var(--warning)' : 'var(--success)';

        var cardId = 'card-' + vendor.replace(/[^a-z0-9]/gi, '_');

        return [
            '<div class="card" id="' + cardId + '" style="margin-bottom:var(--space-lg)">',
            '  <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:var(--space-md)">',
            '    <div>',
            '      <div style="font-size:18px;font-weight:700;color:var(--text-primary)">' + escHtml(vendor) + '</div>',
            '      <div style="font-size:13px;color:var(--text-muted);margin-top:2px">' + items.length + ' BH en n\u00f3mina</div>',
            '    </div>',
            '    <div style="text-align:right">',
            '      <div style="font-size:22px;font-weight:800;color:var(--primary)">' + formatCLP(totalPendiente) + '</div>',
            '      <div style="font-size:12px;color:var(--text-muted)">l\u00edquido a transferir (selecci\u00f3n)</div>',
            '    </div>',
            '  </div>',

            // ── Tabla de BH individuales ──────────────────────────────
            '  <div style="margin-bottom:var(--space-md);overflow-x:auto">',
            '  <table class="data-table" style="margin:0">',
            '    <thead><tr>',
            '      <th style="width:36px"><input type="checkbox" id="check-all-' + cardId + '" class="nomina-check-all" data-vendor="' + escAttr(vendor) + '" ' + (selectedItems.length === items.length ? 'checked' : '') + '></th>',
            '      <th>Evento</th>',
            '      <th>Fecha evento</th>',
            '      <th>Vence</th>',
            '      <th style="text-align:right">Bruto BH</th>',
            '      <th style="text-align:right">Retenci\u00f3n</th>',
            '      <th style="text-align:right">Neto</th>',
            '      <th style="text-align:right;width:140px">A transferir</th>',
            '    </tr></thead>',
            '    <tbody>',
            items.map(function (p) { return renderBHRow(p); }).join('\n'),
            '    </tbody>',
            '  </table>',
            '  </div>',

            // ── Comentario de transferencia ───────────────────────────
            '  <div style="background:var(--surface-secondary,#f8f9fa);border-radius:8px;padding:var(--space-md);margin-bottom:var(--space-md)">',
            '    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">',
            '      <span style="font-size:12px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.5px">Comentario transferencia</span>',
            '      <span style="font-size:11px;color:' + commentColor + ';font-weight:600">' + commentLen + '/40</span>',
            commentWarn ? '      <span style="font-size:11px;color:var(--danger);background:rgba(231,76,60,.1);padding:1px 7px;border-radius:4px">&#9888; Excede 40 caracteres</span>' : '',
            '    </div>',
            '    <div style="display:flex;gap:8px;align-items:center">',
            '      <input type="text" class="form-control nomina-comment-input" data-vendor="' + escAttr(vendor) + '"',
            '             maxlength="60" value="' + escAttr(comment) + '"',
            '             style="font-family:monospace;font-size:15px;font-weight:600;letter-spacing:.5px;flex:1">',
            '      <button class="btn btn-secondary nomina-copy-btn" data-vendor="' + escAttr(vendor) + '" style="white-space:nowrap">&#128203; Copiar</button>',
            '    </div>',
            '  </div>',

            // ── Acciones de la tarjeta ────────────────────────────────
            '  <div style="display:flex;gap:var(--space-sm);justify-content:flex-end">',
            '    <button class="btn btn-primary nomina-pagar-btn" data-vendor="' + escAttr(vendor) + '" ' + (selectedItems.length === 0 ? 'disabled' : '') + '>',
            '      &#10003; Confirmar pago (' + formatCLP(totalPendiente) + ')',
            '    </button>',
            '  </div>',
            '</div>'
        ].join('\n');
    }

    function renderBHRow(p) {
        var s = selectionState[p.id] || { selected: true, amount: calcNetoPendiente(p) };
        var bruto  = Number(p.amount) || 0;
        var rate   = getBHRetentionRate(p.billingDate || p.eventDate);
        var ret    = Math.round(bruto * rate);
        var neto   = bruto - ret;
        var pend   = calcNetoPendiente(p);
        var dd     = calcDueDate(p.eventDate);
        var isParcial = getStatusDerived(p) === 'parcial';

        return [
            '<tr style="' + (s.selected ? '' : 'opacity:.5') + '">',
            '  <td><input type="checkbox" class="nomina-bh-check" data-id="' + escAttr(p.id) + '" ' + (s.selected ? 'checked' : '') + '></td>',
            '  <td>',
            '    <div style="font-weight:600;font-size:13px">' + escHtml(p.eventName || '-') + '</div>',
            isParcial ? '<div style="font-size:11px;color:var(--warning);margin-top:2px">&#9679; Pago parcial previo: ' + formatCLP(getTotalPagado(p)) + ' ya transferido</div>' : '',
            '  </td>',
            '  <td style="font-size:13px;color:var(--text-secondary)">' + (p.eventDate || '-') + '</td>',
            '  <td style="font-size:13px;color:var(--text-secondary)">' + formatDateShort(dd) + '</td>',
            '  <td style="text-align:right;font-size:13px">' + formatCLP(bruto) + '</td>',
            '  <td style="text-align:right;font-size:13px;color:var(--warning)">' + formatCLP(ret) + ' <span style="font-size:10px;opacity:.7">(' + (rate * 100).toFixed(2) + '%)</span></td>',
            '  <td style="text-align:right;font-size:13px;font-weight:600">' + formatCLP(neto) + (isParcial ? '<div style="font-size:10px;color:var(--text-muted)">pend: ' + formatCLP(pend) + '</div>' : '') + '</td>',
            '  <td style="text-align:right">',
            '    <input type="number" class="form-control nomina-amount-input" data-id="' + escAttr(p.id) + '"',
            '           value="' + s.amount + '" min="0" max="' + neto + '" step="1"',
            '           style="text-align:right;width:120px;font-weight:600;' + (!s.selected ? 'opacity:.4;pointer-events:none' : '') + '">',
            '  </td>',
            '</tr>'
        ].join('\n');
    }

    // ── Tab: Próximas a vencer ─────────────────────────────────────────

    function renderProximasTab(upcoming) {
        if (!upcoming.length) {
            return '<div class="empty-state"><p>No hay BH que venzan en los pr\u00f3ximos 14 d\u00edas.</p></div>';
        }
        var groups = groupByVendor(upcoming);
        return [
            '<div class="card" style="margin-bottom:var(--space-md)">',
            '  <div style="font-size:14px;font-weight:600;color:var(--warning);margin-bottom:var(--space-md)">&#9888; Pr\u00f3ximas a vencer (14 d\u00edas)</div>',
            '  <table class="data-table" style="margin:0">',
            '    <thead><tr>',
            '      <th>Beneficiario</th><th>Evento</th><th>Fecha evento</th><th>Vence</th><th style="text-align:right">Neto</th>',
            '    </tr></thead>',
            '    <tbody>',
            upcoming.map(function (p) {
                var dd = calcDueDate(p.eventDate);
                var today = new Date(); today.setHours(0,0,0,0);
                var diff = Math.round((dd - today) / 86400000);
                var urgency = diff <= 3 ? 'color:var(--danger);font-weight:700' : 'color:var(--warning);font-weight:600';
                return [
                    '<tr>',
                    '<td style="font-weight:600">' + escHtml(p.vendorName || '-') + '</td>',
                    '<td style="font-size:13px">' + escHtml(p.eventName || '-') + '</td>',
                    '<td style="font-size:13px;color:var(--text-secondary)">' + (p.eventDate || '-') + '</td>',
                    '<td style="' + urgency + '">' + formatDateShort(dd) + ' &middot; ' + diff + 'd</td>',
                    '<td style="text-align:right;font-weight:600">' + formatCLP(calcNetoPendiente(p)) + '</td>',
                    '</tr>'
                ].join('');
            }).join('\n'),
            '    </tbody>',
            '  </table>',
            '</div>'
        ].join('\n');
    }

    // ── Tab: Historial ─────────────────────────────────────────────────

    function renderHistorialTab(paid) {
        if (!paid.length) {
            return '<div class="empty-state"><p>No hay BH pagadas en el historial.</p></div>';
        }

        // Agrupar por mes de último pago
        var byMonth = {};
        var monthOrder = [];
        paid.forEach(function (p) {
            var lastPay = p.payments && p.payments.length
                ? p.payments.reduce(function (a, b) { return a.date > b.date ? a : b; })
                : null;
            var mKey = lastPay ? lastPay.date.substring(0, 7) : 'sin-fecha';
            if (!byMonth[mKey]) { byMonth[mKey] = []; monthOrder.push(mKey); }
            byMonth[mKey].push(p);
        });
        // Ordenar meses descendente
        monthOrder = monthOrder.filter(function (v, i, a) { return a.indexOf(v) === i; });
        monthOrder.sort(function (a, b) { return b.localeCompare(a); });

        return monthOrder.map(function (mKey) {
            var items = byMonth[mKey];
            var label = mKey === 'sin-fecha' ? 'Sin fecha' : (function () {
                var parts = mKey.split('-');
                var d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
                return d.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
            })();
            var total = items.reduce(function (s, p) { return s + getTotalPagado(p); }, 0);
            var vendors = {};
            items.forEach(function (p) {
                var v = p.vendorName || 'Sin beneficiario';
                vendors[v] = (vendors[v] || 0) + getTotalPagado(p);
            });

            return [
                '<div class="card" style="margin-bottom:var(--space-md)">',
                '  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-md)">',
                '    <div style="font-size:16px;font-weight:700;text-transform:capitalize">' + label + '</div>',
                '    <div style="font-size:15px;font-weight:700;color:var(--primary)">' + formatCLP(total) + '</div>',
                '  </div>',
                '  <div style="display:flex;flex-wrap:wrap;gap:8px">',
                Object.keys(vendors).map(function (v) {
                    return '<div style="background:var(--surface-secondary,#f1f3f5);border-radius:6px;padding:6px 12px;font-size:13px">' +
                           '<span style="font-weight:600">' + escHtml(v) + '</span>' +
                           ' &middot; ' + formatCLP(vendors[v]) + '</div>';
                }).join(''),
                '  </div>',
                '</div>'
            ].join('\n');
        }).join('\n');
    }

    // ── Bind events ────────────────────────────────────────────────────

    function bindEvents() {

        // Cambio de fecha de corte
        var cutoffEl = document.getElementById('nominas-cutoff');
        if (cutoffEl && !cutoffEl._bound) {
            cutoffEl._bound = true;
            cutoffEl.addEventListener('change', function () {
                cutoffDate = this.value;
                selectionState = {};
                renderContent();
            });
        }

        // Tabs
        document.querySelectorAll('.tab-btn').forEach(function (btn) {
            if (!btn._bound) {
                btn._bound = true;
                btn.addEventListener('click', function () {
                    activeTab = this.dataset.tab;
                    renderContent();
                });
            }
        });

        // Checkbox "seleccionar todo" por beneficiario
        document.querySelectorAll('.nomina-check-all').forEach(function (cb) {
            if (!cb._bound) {
                cb._bound = true;
                cb.addEventListener('change', function () {
                    var vendor = this.dataset.vendor;
                    var checked = this.checked;
                    document.querySelectorAll('.nomina-bh-check').forEach(function (bc) {
                        var id = bc.dataset.id;
                        var p = payables.find(function (x) { return x.id === id; });
                        if (p && (p.vendorName || 'Sin beneficiario').trim() === vendor) {
                            bc.checked = checked;
                            if (!selectionState[id]) selectionState[id] = { selected: checked, amount: calcNetoPendiente(p) };
                            selectionState[id].selected = checked;
                        }
                    });
                    renderContent();
                });
            }
        });

        // Checkbox por BH individual
        document.querySelectorAll('.nomina-bh-check').forEach(function (cb) {
            if (!cb._bound) {
                cb._bound = true;
                cb.addEventListener('change', function () {
                    var id = this.dataset.id;
                    var p = payables.find(function (x) { return x.id === id; });
                    if (!p) return;
                    if (!selectionState[id]) selectionState[id] = { selected: true, amount: calcNetoPendiente(p) };
                    selectionState[id].selected = this.checked;
                    renderContent();
                });
            }
        });

        // Input de monto por BH
        document.querySelectorAll('.nomina-amount-input').forEach(function (inp) {
            if (!inp._bound) {
                inp._bound = true;
                inp.addEventListener('input', function () {
                    var id = this.dataset.id;
                    var val = Number(this.value) || 0;
                    if (!selectionState[id]) selectionState[id] = { selected: true, amount: val };
                    selectionState[id].amount = val;
                    // Actualizar solo el total del header sin re-renderizar toda la vista
                    updateCardTotals();
                });
            }
        });

        // Copiar comentario
        document.querySelectorAll('.nomina-copy-btn').forEach(function (btn) {
            if (!btn._bound) {
                btn._bound = true;
                btn.addEventListener('click', function () {
                    var vendor = this.dataset.vendor;
                    var inputEl = document.querySelector('.nomina-comment-input[data-vendor="' + vendor + '"]');
                    if (!inputEl) return;
                    var text = inputEl.value;
                    if (navigator.clipboard) {
                        navigator.clipboard.writeText(text).then(function () {
                            btn.textContent = '\u2713 Copiado';
                            setTimeout(function () { btn.innerHTML = '&#128203; Copiar'; }, 1800);
                        });
                    } else {
                        inputEl.select();
                        document.execCommand('copy');
                        btn.textContent = '\u2713 Copiado';
                        setTimeout(function () { btn.innerHTML = '&#128203; Copiar'; }, 1800);
                    }
                });
            }
        });

        // Confirmar pago
        document.querySelectorAll('.nomina-pagar-btn').forEach(function (btn) {
            if (!btn._bound) {
                btn._bound = true;
                btn.addEventListener('click', function () {
                    var vendor = this.dataset.vendor;
                    handleConfirmPago(vendor);
                });
            }
        });
    }

    // Actualiza solo los totales sin re-renderizar todo (para inputs de monto)
    function updateCardTotals() {
        var eligible = getEligibleBH();
        var groups = groupByVendor(eligible);
        var totalGlobal = 0;
        groups.forEach(function (g) {
            var total = 0;
            var selectedItems = [];
            g.items.forEach(function (p) {
                var s = selectionState[p.id];
                if (s && s.selected) {
                    total += s.amount;
                    selectedItems.push(p);
                }
            });
            totalGlobal += total;
        });
    }

    // ── Confirmar pago ─────────────────────────────────────────────────

    async function handleConfirmPago(vendor) {
        var eligible = getEligibleBH();
        var vendorItems = eligible.filter(function (p) {
            return (p.vendorName || 'Sin beneficiario').trim() === vendor;
        });
        var toPay = vendorItems.filter(function (p) {
            return selectionState[p.id] && selectionState[p.id].selected;
        });

        if (!toPay.length) { alert('No hay BH seleccionadas para pagar.'); return; }

        var totalTransfer = toPay.reduce(function (s, p) { return s + (selectionState[p.id].amount || 0); }, 0);
        var comment = (function () {
            var inputEl = document.querySelector('.nomina-comment-input[data-vendor="' + vendor + '"]');
            return inputEl ? inputEl.value : buildTransferComment(toPay);
        })();

        var confirmMsg = '¿Confirmar pago a ' + vendor + '?\n\n' +
            'Monto: ' + formatCLP(totalTransfer) + '\n' +
            'Comentario: ' + comment + '\n\n' +
            toPay.length + ' BH incluidas.';
        if (!confirm(confirmMsg)) return;

        var dateStr = todayStr();

        try {
            for (var i = 0; i < toPay.length; i++) {
                var p = toPay[i];
                var amt = selectionState[p.id].amount || 0;
                if (amt <= 0) continue;
                var newPayments = (p.payments || []).concat([{
                    id: generateId(),
                    amount: amt,
                    date: dateStr,
                    method: 'transferencia',
                    comment: comment
                }]);
                await window.Mazelab.DataService.update('payables', p.id, { payments: newPayments });
            }
            // Reload data
            payables = await window.Mazelab.DataService.getAll('payables');
            // Limpiar selección para este vendor
            toPay.forEach(function (p) { delete selectionState[p.id]; });
            showSuccessToast(vendor, totalTransfer, comment);
            renderContent();
        } catch (err) {
            console.error('NominasModule: handleConfirmPago error', err);
            alert('Error al guardar los pagos. Intenta nuevamente.');
        }
    }

    // ── Toast de éxito ─────────────────────────────────────────────────

    function showSuccessToast(vendor, amount, comment) {
        var toast = document.createElement('div');
        toast.style.cssText = [
            'position:fixed;bottom:24px;right:24px;z-index:9999',
            'background:var(--success,#27ae60);color:#fff',
            'border-radius:10px;padding:16px 20px;max-width:340px',
            'box-shadow:0 4px 20px rgba(0,0,0,.2);font-size:14px'
        ].join(';');
        toast.innerHTML = [
            '<div style="font-weight:700;margin-bottom:4px">&#10003; Pago registrado</div>',
            '<div>' + escHtml(vendor) + ' &middot; ' + formatCLP(amount) + '</div>',
            '<div style="font-family:monospace;font-size:12px;margin-top:6px;opacity:.85">' + escHtml(comment) + '</div>'
        ].join('');
        document.body.appendChild(toast);
        setTimeout(function () { toast.style.transition = 'opacity .4s'; toast.style.opacity = '0'; }, 3000);
        setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 3500);
    }

    // ── Utilidades HTML ────────────────────────────────────────────────

    function escHtml(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function escAttr(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    }

    // ── Init ───────────────────────────────────────────────────────────

    async function init() {
        cutoffDate = todayStr();
        selectionState = {};
        try {
            payables = await window.Mazelab.DataService.getAll('payables');
        } catch (err) {
            console.error('NominasModule: failed to load payables', err);
            payables = [];
        }
        renderContent();
    }

    return { render: render, init: init };

})();
