window.Mazelab = window.Mazelab || {};
window.Mazelab.Modules = window.Mazelab.Modules || {};

window.Mazelab.Modules.NominasModule = (function () {

    // ── State ──────────────────────────────────────────────────────────
    let payables = [];
    let cachedSales = [];
    let cutoffDate = '';
    let activeTab = 'nomina';
    let historialExpanded = {}; // { monthKey: bool }

    // Overrides por payable: { [id]: { selected: bool, amount: number } }
    let selectionState = {};

    // ── Helpers ────────────────────────────────────────────────────────

    function formatCLP(n) {
        if (n == null || isNaN(n)) return '$0';
        var num = Math.round(Number(n));
        var str = Math.abs(num).toString();
        var parts = [];
        for (var i = str.length; i > 0; i -= 3) parts.unshift(str.substring(Math.max(0, i - 3), i));
        return (num < 0 ? '-' : '') + '$' + parts.join('.');
    }

    function todayStr() { return new Date().toISOString().substring(0, 10); }

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

    function getPendiente(p) {
        return Math.max(0, (Number(p.amount) || 0) - getTotalPagado(p));
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

    // ── Identificación BH ──────────────────────────────────────────────
    // Después del fix de import: docType = 'bh' para todos los registros con documento = 'BH'
    // Legacy (datos importados con mapping viejo): docType = 'freelance' o 'fuera de horario'
    function isBH(p) {
        var dt = (p.docType || '').toLowerCase().trim();
        if (dt === 'bh') return true;
        // Fallback legacy: tipo_de_costo almacenado como docType en imports anteriores
        // "Freelance" y "Fuera de horario" son exclusivamente BH en el CSV
        if (dt === 'freelance' || dt === 'fuera de horario') return true;
        return false;
    }

    // Use nominaDate override if set, otherwise calculate from eventDate
    function getEffectiveDueDate(p) {
        if (p.nominaDate) {
            var d = new Date(p.nominaDate);
            if (!isNaN(d.getTime())) return d;
        }
        return calcDueDate(p.eventDate);
    }

    // ── Filtros de elegibilidad ────────────────────────────────────────

    function getCutoff() {
        var d = new Date(cutoffDate || todayStr());
        d.setHours(23, 59, 59, 999);
        return d;
    }

    function getEligibleBH() {
        var cutoff = getCutoff();
        return payables.filter(function (p) {
            if (!isBH(p)) return false;
            if (getStatusDerived(p) === 'pagada') return false;
            var dd = getEffectiveDueDate(p);
            if (!dd) return false;
            return dd <= cutoff;
        });
    }

    function getUpcomingBH(days) {
        var cutoff = getCutoff();
        var horizon = new Date(cutoff.getTime() + days * 86400000);
        return payables.filter(function (p) {
            if (!isBH(p)) return false;
            if (getStatusDerived(p) === 'pagada') return false;
            var dd = getEffectiveDueDate(p);
            if (!dd) return false;
            return dd > cutoff && dd <= horizon;
        });
    }

    function getPaidBH() {
        return payables.filter(function (p) {
            return isBH(p) && getStatusDerived(p) === 'pagada';
        });
    }

    function groupByVendor(items) {
        var groups = {};
        var order = [];
        items.forEach(function (p) {
            var key = (p.vendorName || 'Sin beneficiario').trim();
            if (!groups[key]) { groups[key] = []; order.push(key); }
            groups[key].push(p);
        });
        // Ordenar items de cada grupo por fecha de evento
        order.forEach(function (k) {
            groups[k].sort(function (a, b) { return (a.eventDate || '').localeCompare(b.eventDate || ''); });
        });
        return order.map(function (k) { return { vendor: k, items: groups[k] }; });
    }

    // ── Estado de selección ────────────────────────────────────────────

    function initSelectionState(eligible) {
        var next = {};
        eligible.forEach(function (p) {
            next[p.id] = selectionState[p.id] || { selected: true, amount: getPendiente(p) };
        });
        selectionState = next;
    }

    // ── Transfer comment ───────────────────────────────────────────────

    // Returns the human-readable ID for a payable: docNumber if set, else sourceId of linked sale
    function getEventSourceId(p) {
        if (p.docNumber && String(p.docNumber).trim()) return String(p.docNumber).trim();
        var sale = cachedSales.find(function (s) { return s.id === p.eventId; });
        return sale && sale.sourceId ? String(sale.sourceId).trim() : '';
    }

    // Builds the transfer glosa using doc numbers. Detects full vs partial payments from selectionState.
    // Format: "BH 1-2-3" (all full), "BH 1-2 parc 3" (mixed), "BH parc 1-2" (all partial)
    function buildTransferComment(items) {
        var fullNums = [], partialNums = [];
        items.forEach(function (p) {
            var num = getEventSourceId(p);
            var pend = getPendiente(p);
            var paying = selectionState[p.id] ? (selectionState[p.id].amount || 0) : pend;
            // Consider "full" if paying within 1 peso of pending
            if (Math.abs(paying - pend) < 1) {
                fullNums.push(num);
            } else {
                partialNums.push(num);
            }
        });

        var comment;
        if (!partialNums.length) {
            // All full
            var nums = fullNums.filter(Boolean);
            comment = nums.length ? 'BH ' + nums.join('-') : 'BH (' + items.length + ')';
        } else if (!fullNums.length) {
            // All partial
            var nums = partialNums.filter(Boolean);
            comment = nums.length ? 'BH parc ' + nums.join('-') : 'BH parc (' + items.length + ')';
        } else {
            // Mixed: full first, then partial
            var fStr = fullNums.filter(Boolean).join('-');
            var pStr = partialNums.filter(Boolean).join('-');
            comment = 'BH ' + (fStr || '(varios)') + ' parc ' + (pStr || '(parcial)');
        }

        if (comment.length <= 40) return comment;
        // Trim: try to fit as many full IDs as possible
        var parts = [];
        var prefix = partialNums.length ? 'BH ' : 'BH ';
        for (var i = 0; i < fullNums.length; i++) {
            var candidate = prefix + parts.concat([fullNums[i]]).join('-');
            if (candidate.length > 40) break;
            parts.push(fullNums[i]);
        }
        return (prefix + parts.join('-')).substring(0, 40);
    }

    // FIFO distribution: given a budget, pay items oldest-first until budget is exhausted
    function applyFIFO(vendor, budget) {
        var eligible = getEligibleBH();
        var vendorItems = eligible.filter(function (p) {
            return (p.vendorName || 'Sin beneficiario').trim() === vendor;
        });
        // Already sorted by eventDate ascending (from groupByVendor)
        var remaining = budget;
        vendorItems.forEach(function (p) {
            var pend = getPendiente(p);
            if (remaining <= 0) {
                selectionState[p.id] = { selected: false, amount: 0 };
            } else if (remaining >= pend) {
                selectionState[p.id] = { selected: true, amount: pend };
                remaining -= pend;
            } else {
                selectionState[p.id] = { selected: true, amount: remaining };
                remaining = 0;
            }
        });
    }

    // ── Render: shell ──────────────────────────────────────────────────

    function render() {
        return [
            '<div class="content-header">',
            '  <div>',
            '    <h1 style="font-size:20px;font-weight:700">N\u00f3minas de Pago</h1>',
            '    <p style="font-size:13px;color:var(--text-secondary);margin:0">Genera y gestiona las transferencias semanales a beneficiarios BH</p>',
            '  </div>',
            '</div>',
            '<div class="content-body">',
            '  <div id="nominas-root"><div class="empty-state"><p>Cargando...</p></div></div>',
            '</div>'
        ].join('\n');
    }

    // ── Render: contenido ──────────────────────────────────────────────

    function renderContent() {
        var eligible = getEligibleBH();
        var upcoming = getUpcomingBH(14);
        var paid = getPaidBH();
        initSelectionState(eligible);

        var root = document.getElementById('nominas-root');
        if (!root) return;

        var totalBHInSystem = payables.filter(isBH).length;

        root.innerHTML = [
            renderControls(eligible),
            renderTabs(eligible.length, upcoming.length),
            '<div id="nominas-tab-content">',
            activeTab === 'nomina' ? renderNominaTab(eligible, totalBHInSystem) : '',
            activeTab === 'proximas' ? renderProximasTab(upcoming) : '',
            activeTab === 'historial' ? renderHistorialTab(paid) : '',
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
                selectedVendors.add((p.vendorName || 'Sin beneficiario').trim());
            }
        });

        return [
            '<div style="display:flex;align-items:center;gap:var(--space-md);flex-wrap:wrap;margin-bottom:var(--space-lg)">',
            '  <div style="display:flex;align-items:center;gap:8px">',
            '    <label style="font-size:13px;color:var(--text-secondary);white-space:nowrap">Fecha de corte:</label>',
            '    <input type="date" id="nominas-cutoff" class="form-control" style="width:160px" value="' + (cutoffDate || todayStr()) + '">',
            '  </div>',
            '  <div style="margin-left:auto;font-size:13px;color:var(--text-secondary)">',
            '    <strong style="color:var(--text-primary)">' + selectedVendors.size + '</strong> beneficiarios &middot;',
            '    <strong style="color:var(--text-primary)">' + formatCLP(totalSelected) + '</strong> total',
            '  </div>',
            '</div>'
        ].join('\n');
    }

    // ── Tabs ───────────────────────────────────────────────────────────

    function renderTabs(eligibleCount, upcomingCount) {
        function tab(id, label, count, danger) {
            var active = activeTab === id;
            var badge = count > 0
                ? ' <span class="badge ' + (danger ? 'badge-danger' : 'badge-warning') + '" style="margin-left:4px">' + count + '</span>'
                : '';
            return '<button class="tab' + (active ? ' active' : '') + '" data-tab="' + id + '">' + label + badge + '</button>';
        }
        return [
            '<div class="tabs">',
            tab('nomina', 'N\u00f3mina actual', eligibleCount, true),
            tab('proximas', 'Pr\u00f3ximas 14d', upcomingCount, false),
            tab('historial', 'Historial', 0, false),
            '</div>'
        ].join('\n');
    }

    // ── Tab: Nómina actual ─────────────────────────────────────────────

    function renderNominaTab(eligible, totalBHInSystem) {
        var html = '';

        // Debug info si hay datos pero no coinciden con el filtro
        var allBH = payables.filter(isBH);
        var pendientesBH = allBH.filter(function (p) { return getStatusDerived(p) !== 'pagada'; });
        if (!eligible.length && pendientesBH.length > 0) {
            var nearestDD = null;
            pendientesBH.forEach(function (p) {
                var dd = getEffectiveDueDate(p);
                if (dd && (!nearestDD || dd < nearestDD)) nearestDD = dd;
            });
            html += [
                '<div style="background:var(--warning-bg);border:1px solid var(--warning);border-radius:8px;padding:16px;margin-bottom:var(--space-md)">',
                '  <div style="font-weight:600;margin-bottom:4px">&#9888; Sin pagos a la fecha de corte</div>',
                '  <div style="font-size:13px">Hay <strong>' + pendientesBH.length + '</strong> BH pendientes que a\u00fan no cumplen los 30 d\u00edas.',
                nearestDD ? ' El pr\u00f3ximo vencimiento es el <strong>' + formatDateShort(nearestDD) + '</strong>.' : '',
                '  </div>',
                '</div>'
            ].join('');
        }

        if (!eligible.length) {
            html += [
                '<div class="empty-state">',
                '  <div style="font-size:36px;margin-bottom:12px">&#10003;</div>',
                '  <p style="font-size:15px;font-weight:600;margin-bottom:6px">Sin BH para pagar al ' + (cutoffDate || todayStr()) + '</p>',
                totalBHInSystem === 0
                    ? '<p style="color:var(--text-muted)">No hay registros BH en el sistema. Re-importa el CSV de CXP.</p>'
                    : '<p style="color:var(--text-muted)">Revisa la pesta\u00f1a \u201cPr\u00f3ximas 14d\u201d para ver qu\u00e9 viene.</p>',
                '</div>'
            ].join('');
            return html;
        }

        var groups = groupByVendor(eligible);
        html += groups.map(function (g) { return renderBeneficiaryCard(g.vendor, g.items); }).join('\n');
        return html;
    }

    // ── Tarjeta por beneficiario ───────────────────────────────────────

    function renderBeneficiaryCard(vendor, items) {
        var totalAmount = 0; // suma de p.amount de los seleccionados
        var totalPagado = 0;
        var totalPend = 0;
        var selectedItems = [];

        items.forEach(function (p) {
            var s = selectionState[p.id] || { selected: true, amount: getPendiente(p) };
            if (s.selected) {
                totalAmount += Number(p.amount) || 0;
                totalPagado += getTotalPagado(p);
                totalPend += s.amount;
                selectedItems.push(p);
            }
        });

        var comment = buildTransferComment(selectedItems);
        var commentLen = comment.length;
        var lenColor = commentLen > 40 ? 'var(--danger)' : commentLen > 32 ? 'var(--warning)' : 'var(--success)';
        var cardId = 'card-' + vendor.replace(/[^a-z0-9]/gi, '_');
        var allSelected = selectedItems.length === items.length;

        return [
            '<div class="card" id="' + cardId + '" style="margin-bottom:var(--space-lg)">',

            // Header
            '  <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:var(--space-md)">',
            '    <div>',
            '      <div style="font-size:18px;font-weight:700">' + escHtml(vendor) + '</div>',
            '      <div style="font-size:12px;color:var(--text-muted);margin-top:2px">',
            '        ' + items.length + ' BH en n\u00f3mina &middot; ' + selectedItems.length + ' seleccionadas',
            '      </div>',
            '    </div>',
            '    <div style="text-align:right">',
            '      <div style="font-size:22px;font-weight:800;color:var(--primary)">' + formatCLP(totalPend) + '</div>',
            '      <div style="font-size:11px;color:var(--text-muted)">a transferir (selecci\u00f3n)</div>',
            '    </div>',
            '  </div>',

            // FIFO budget section
            '  <div style="display:flex;align-items:center;gap:8px;margin-bottom:var(--space-md);padding:10px 14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px">',
            '    <span style="font-size:12px;color:var(--text-secondary);white-space:nowrap">Presupuesto disponible:</span>',
            '    <input type="number" class="form-control nomina-budget-input" data-vendor="' + escAttr(vendor) + '"',
            '           placeholder="Ingresa el total a transferir..." min="0" step="1"',
            '           style="max-width:220px;font-size:13px">',
            '    <button class="btn btn-secondary btn-sm nomina-fifo-btn" data-vendor="' + escAttr(vendor) + '" style="white-space:nowrap">',
            '      Distribuir FIFO \u2193',
            '    </button>',
            '    <span style="font-size:11px;color:var(--text-muted)">Paga de m\u00e1s antigua a m\u00e1s reciente</span>',
            '  </div>',

            // Tabla
            '  <div style="overflow-x:auto;margin-bottom:var(--space-md)">',
            '  <table class="data-table" style="margin:0">',
            '    <thead><tr>',
            '      <th style="width:32px"><input type="checkbox" class="nomina-check-all" data-vendor="' + escAttr(vendor) + '" ' + (allSelected ? 'checked' : '') + '></th>',
            '      <th>ID</th>',
            '      <th>Cliente</th>',
            '      <th>Evento</th>',
            '      <th>Fecha evento</th>',
            '      <th>Vence</th>',
            '      <th style="text-align:right">Total BH</th>',
            '      <th style="text-align:right">Pagado</th>',
            '      <th style="text-align:right;width:140px">A transferir</th>',
            '    </tr></thead>',
            '    <tbody>',
            items.map(function (p) { return renderBHRow(p); }).join('\n'),
            '    </tbody>',
            '  </table>',
            '  </div>',

            // Comentario transferencia
            '  <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:14px;margin-bottom:var(--space-md)">',
            '    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">',
            '      <span style="font-size:12px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.4px">Glosa para transferencia</span>',
            '      <span style="font-size:12px;font-weight:700;color:' + lenColor + '">' + commentLen + '/40</span>',
            commentLen > 40 ? '      <span style="font-size:11px;color:var(--danger);background:var(--danger-bg);padding:2px 8px;border-radius:4px">&#9888; Excede 40 caracteres</span>' : '',
            '    </div>',
            '    <div style="display:flex;gap:8px;align-items:center">',
            '      <input type="text" class="form-control nomina-comment-input" data-vendor="' + escAttr(vendor) + '"',
            '             maxlength="60" value="' + escAttr(comment) + '"',
            '             style="font-family:monospace;font-size:15px;font-weight:700;flex:1">',
            '      <button class="btn btn-secondary nomina-copy-btn" data-vendor="' + escAttr(vendor) + '">&#128203; Copiar</button>',
            '    </div>',
            '    <div style="font-size:11px;color:var(--text-muted);margin-top:6px">',
            '      Los IDs corresponden al n\u00famero de evento del CSV. Edit\u00e1 el texto antes de copiar si necesit\u00e1s ajustarlo.',
            '    </div>',
            '  </div>',

            // Botón confirmar
            '  <div style="display:flex;justify-content:flex-end">',
            '    <button class="btn btn-primary nomina-pagar-btn" data-vendor="' + escAttr(vendor) + '"' + (selectedItems.length === 0 ? ' disabled' : '') + '>',
            '      &#10003; Confirmar pago &mdash; ' + formatCLP(totalPend),
            '    </button>',
            '  </div>',

            '</div>'
        ].join('\n');
    }

    function renderBHRow(p) {
        var s = selectionState[p.id] || { selected: true, amount: getPendiente(p) };
        var amount = Number(p.amount) || 0;
        var pagado = getTotalPagado(p);
        var pend = getPendiente(p);
        var dd = getEffectiveDueDate(p);
        var isParcial = getStatusDerived(p) === 'parcial';
        var rowDim = s.selected ? '' : 'opacity:.45';

        return [
            '<tr style="' + rowDim + '">',
            '  <td><input type="checkbox" class="nomina-bh-check" data-id="' + escAttr(p.id) + '" ' + (s.selected ? 'checked' : '') + '></td>',
            '  <td style="font-weight:700;font-size:13px;color:var(--primary)">' + escHtml(getEventSourceId(p) || p.eventId || '-') + '</td>',
            '  <td style="font-size:12px">' + escHtml(p.clientName || '-') + '</td>',
            '  <td>',
            '    <div style="font-size:13px;font-weight:600">' + escHtml(p.eventName || '-') + '</div>',
            isParcial ? '<div style="font-size:11px;color:var(--warning);margin-top:1px">&#9679; Pago parcial previo (' + formatCLP(pagado) + ' ya pagado)</div>' : '',
            '  </td>',
            '  <td style="font-size:12px;white-space:nowrap">' + (p.eventDate || '-') + '</td>',
            '  <td style="font-size:12px;white-space:nowrap">' + formatDateShort(dd) + '</td>',
            '  <td style="text-align:right;font-size:13px">' + formatCLP(amount) + '</td>',
            '  <td style="text-align:right;font-size:13px;color:' + (pagado > 0 ? 'var(--success)' : 'var(--text-muted)') + '">' + (pagado > 0 ? formatCLP(pagado) : '-') + '</td>',
            '  <td style="text-align:right">',
            '    <input type="number" class="form-control nomina-amount-input" data-id="' + escAttr(p.id) + '"',
            '           value="' + s.amount + '" min="0" max="' + pend + '" step="1"',
            '           style="text-align:right;width:120px;font-weight:700' + (!s.selected ? ';opacity:.35;pointer-events:none' : '') + '">',
            '  </td>',
            '</tr>'
        ].join('\n');
    }

    // ── Tab: Próximas ──────────────────────────────────────────────────

    function renderProximasTab(upcoming) {
        if (!upcoming.length) {
            return '<div class="empty-state"><p>No hay BH que venzan en los pr\u00f3ximos 14 d\u00edas.</p></div>';
        }
        var today = new Date(); today.setHours(0, 0, 0, 0);
        return [
            '<div class="card">',
            '  <div style="font-size:14px;font-weight:700;color:var(--warning);margin-bottom:var(--space-md)">&#9888; Pr\u00f3ximas a vencer &mdash; 14 d\u00edas</div>',
            '  <table class="data-table" style="margin:0">',
            '    <thead><tr>',
            '      <th>ID</th><th>Beneficiario</th><th>Cliente</th><th>Evento</th><th>Fecha evento</th><th>Vence</th><th style="text-align:right">Pendiente</th>',
            '    </tr></thead><tbody>',
            upcoming.map(function (p) {
                var dd = getEffectiveDueDate(p);
                var diff = Math.round((dd - today) / 86400000);
                var urg = diff <= 3 ? 'color:var(--danger);font-weight:700' : 'color:var(--warning);font-weight:600';
                return [
                    '<tr>',
                    '<td style="font-weight:700;color:var(--primary)">' + escHtml(p.eventId || '-') + '</td>',
                    '<td style="font-weight:600">' + escHtml(p.vendorName || '-') + '</td>',
                    '<td style="font-size:12px">' + escHtml(p.clientName || '-') + '</td>',
                    '<td style="font-size:13px">' + escHtml(p.eventName || '-') + '</td>',
                    '<td style="font-size:12px;color:var(--text-secondary)">' + (p.eventDate || '-') + '</td>',
                    '<td style="' + urg + '">' + formatDateShort(dd) + ' &middot; ' + diff + 'd</td>',
                    '<td style="text-align:right;font-weight:700">' + formatCLP(getPendiente(p)) + '</td>',
                    '</tr>'
                ].join('');
            }).join(''),
            '    </tbody></table>',
            '</div>'
        ].join('\n');
    }

    // ── Tab: Historial ─────────────────────────────────────────────────

    function renderHistorialTab(paid) {
        if (!paid.length) {
            return '<div class="empty-state"><p>No hay BH pagadas en el historial a\u00fan.</p></div>';
        }

        // Agrupar por mes de último pago
        var byMonth = {}, monthOrder = [];
        paid.forEach(function (p) {
            var lastPay = p.payments && p.payments.length
                ? p.payments.reduce(function (a, b) { return a.date > b.date ? a : b; })
                : null;
            var mKey = lastPay ? lastPay.date.substring(0, 7) : 'sin-fecha';
            if (!byMonth[mKey]) { byMonth[mKey] = []; monthOrder.push(mKey); }
            byMonth[mKey].push(p);
        });
        monthOrder = monthOrder.filter(function (v, i, a) { return a.indexOf(v) === i; });
        monthOrder.sort(function (a, b) { return b.localeCompare(a); });

        return monthOrder.map(function (mKey) {
            var items = byMonth[mKey];
            var label = mKey === 'sin-fecha' ? 'Sin fecha' : (function () {
                var parts = mKey.split('-');
                var d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
                return d.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
            })();

            var totalPagado = items.reduce(function (s, p) { return s + getTotalPagado(p); }, 0);
            var byVendor = {};
            items.forEach(function (p) {
                var v = (p.vendorName || 'Sin beneficiario').trim();
                if (!byVendor[v]) byVendor[v] = [];
                byVendor[v].push(p);
            });

            var isExpanded = !!historialExpanded[mKey];

            var vendorSummary = Object.keys(byVendor).map(function (v) {
                var total = byVendor[v].reduce(function (s, p) { return s + getTotalPagado(p); }, 0);
                return '<span style="display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:5px 12px;font-size:13px;margin:3px;color:var(--text-primary)">' +
                    '<strong style="color:var(--text-primary)">' + escHtml(v) + '</strong><span style="margin-left:4px;color:var(--text-primary)">' + formatCLP(total) + '</span></span>';
            }).join('');

            var detailRows = isExpanded ? Object.keys(byVendor).map(function (v) {
                return byVendor[v].map(function (p) {
                    var pagado = getTotalPagado(p);
                    var lastPay = p.payments && p.payments.length
                        ? p.payments.reduce(function (a, b) { return a.date > b.date ? a : b; })
                        : null;
                    return [
                        '<tr style="background:rgba(255,255,255,0.02)">',
                        '<td style="font-size:12px;font-weight:700;color:var(--text-primary)">' + escHtml(getEventSourceId(p) || p.eventId || '-') + '</td>',
                        '<td style="font-weight:600;font-size:13px;color:var(--text-primary)">' + escHtml(v) + '</td>',
                        '<td style="font-size:12px;color:var(--text-primary)">' + escHtml(p.clientName || '-') + '</td>',
                        '<td style="font-size:13px;color:var(--text-primary)">' + escHtml(p.eventName || '-') + '</td>',
                        '<td style="font-size:12px;color:var(--text-primary)">' + (p.eventDate || '-') + '</td>',
                        '<td style="font-size:12px;color:var(--text-primary)">' + (lastPay ? lastPay.date : '-') + '</td>',
                        '<td style="text-align:right;font-weight:700;color:var(--success)">' + formatCLP(pagado) + '</td>',
                        '</tr>'
                    ].join('');
                }).join('');
            }).join('') : '';

            return [
                '<div style="border:1px solid rgba(255,255,255,0.1);border-radius:10px;margin-bottom:12px;overflow:hidden">',

                // Header de mes (siempre visible)
                '  <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;background:var(--bg-card);cursor:pointer" class="hist-month-header" data-mkey="' + escAttr(mKey) + '">',
                '    <div style="font-size:16px;font-weight:700;color:var(--text-primary);text-transform:capitalize">' + label + '</div>',
                '    <div style="display:flex;align-items:center;gap:12px">',
                '      <div style="font-size:16px;font-weight:700;color:var(--accent-primary)">' + formatCLP(totalPagado) + '</div>',
                '      <div style="font-size:13px;color:var(--text-secondary);">' + items.length + ' BH &middot; ' + Object.keys(byVendor).length + ' personas</div>',
                '      <div style="font-size:12px;color:var(--text-muted)">' + (isExpanded ? '&#9650;' : '&#9660;') + '</div>',
                '    </div>',
                '  </div>',

                // Resumen por beneficiario (siempre visible)
                '  <div style="padding:8px 18px 12px;background:var(--bg-card);border-top:1px solid rgba(255,255,255,0.05)">',
                '    ' + vendorSummary,
                '  </div>',

                // Detalle expandible
                isExpanded ? [
                    '  <div style="background:rgba(255,255,255,0.02);border-top:1px solid rgba(255,255,255,0.1);padding:8px 18px 14px">',
                    '  <table class="data-table" style="margin:0;background:var(--bg-card)">',
                    '    <thead><tr style="background:rgba(255,255,255,0.05)">',
                    '      <th style="font-size:11px">ID</th><th style="font-size:11px">Beneficiario</th><th style="font-size:11px">Cliente</th>',
                    '      <th style="font-size:11px">Evento</th><th style="font-size:11px">Fecha evento</th><th style="font-size:11px">Fecha pago</th>',
                    '      <th style="text-align:right;font-size:11px">Transferido</th>',
                    '    </tr></thead>',
                    '    <tbody>' + detailRows + '</tbody>',
                    '  </table>',
                    '  </div>'
                ].join('') : '',

                '</div>'
            ].join('\n');
        }).join('\n');
    }

    // ── Bind events ────────────────────────────────────────────────────

    function bindEvents() {
        // Fecha de corte
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
        document.querySelectorAll('.tab').forEach(function (btn) {
            if (!btn._bound) {
                btn._bound = true;
                btn.addEventListener('click', function () {
                    activeTab = this.dataset.tab;
                    renderContent();
                });
            }
        });

        // Historial: expandir/colapsar mes
        document.querySelectorAll('.hist-month-header').forEach(function (el) {
            if (!el._bound) {
                el._bound = true;
                el.addEventListener('click', function () {
                    var mKey = this.dataset.mkey;
                    historialExpanded[mKey] = !historialExpanded[mKey];
                    renderContent();
                });
            }
        });

        // Checkbox "todo" por beneficiario
        document.querySelectorAll('.nomina-check-all').forEach(function (cb) {
            if (!cb._bound) {
                cb._bound = true;
                cb.addEventListener('change', function () {
                    var vendor = this.dataset.vendor;
                    var checked = this.checked;
                    document.querySelectorAll('.nomina-bh-check').forEach(function (bc) {
                        var p = payables.find(function (x) { return x.id === bc.dataset.id; });
                        if (p && (p.vendorName || 'Sin beneficiario').trim() === vendor) {
                            bc.checked = checked;
                            if (!selectionState[p.id]) selectionState[p.id] = { selected: checked, amount: getPendiente(p) };
                            selectionState[p.id].selected = checked;
                        }
                    });
                    renderContent();
                });
            }
        });

        // Checkbox individual BH
        document.querySelectorAll('.nomina-bh-check').forEach(function (cb) {
            if (!cb._bound) {
                cb._bound = true;
                cb.addEventListener('change', function () {
                    var id = this.dataset.id;
                    var p = payables.find(function (x) { return x.id === id; });
                    if (!p) return;
                    if (!selectionState[id]) selectionState[id] = { selected: true, amount: getPendiente(p) };
                    selectionState[id].selected = this.checked;
                    renderContent();
                });
            }
        });

        // Input de monto por BH — restore focus after re-render to avoid losing cursor position
        document.querySelectorAll('.nomina-amount-input').forEach(function (inp) {
            if (!inp._bound) {
                inp._bound = true;
                inp.addEventListener('input', function () {
                    var id = this.dataset.id;
                    var cursor = this.selectionStart;
                    var p = payables.find(function (x) { return x.id === id; });
                    if (!p) return;
                    if (!selectionState[id]) selectionState[id] = { selected: true, amount: getPendiente(p) };
                    selectionState[id].amount = Number(this.value) || 0;
                    renderContent();
                    setTimeout(function () {
                        var el = document.querySelector('.nomina-amount-input[data-id="' + id + '"]');
                        if (el) { el.focus(); try { el.setSelectionRange(cursor, cursor); } catch (e) {} }
                    }, 0);
                });
            }
        });

        // FIFO budget distribution button
        document.querySelectorAll('.nomina-fifo-btn').forEach(function (btn) {
            if (!btn._bound) {
                btn._bound = true;
                btn.addEventListener('click', function () {
                    var vendor = this.dataset.vendor;
                    var budgetEl = document.querySelector('.nomina-budget-input[data-vendor="' + vendor + '"]');
                    var budget = budgetEl ? (Number(budgetEl.value) || 0) : 0;
                    if (budget <= 0) { alert('Ingresa un monto de presupuesto disponible.'); return; }
                    applyFIFO(vendor, budget);
                    renderContent();
                });
            }
        });

        // Copiar glosa
        document.querySelectorAll('.nomina-copy-btn').forEach(function (btn) {
            if (!btn._bound) {
                btn._bound = true;
                btn.addEventListener('click', function () {
                    var vendor = this.dataset.vendor;
                    var inputEl = document.querySelector('.nomina-comment-input[data-vendor="' + vendor + '"]');
                    if (!inputEl) return;
                    var text = inputEl.value;
                    var self = this;
                    if (navigator.clipboard) {
                        navigator.clipboard.writeText(text).then(function () {
                            self.textContent = '\u2713 Copiado!';
                            setTimeout(function () { self.innerHTML = '&#128203; Copiar'; }, 2000);
                        });
                    } else {
                        inputEl.select();
                        document.execCommand('copy');
                        self.textContent = '\u2713 Copiado!';
                        setTimeout(function () { self.innerHTML = '&#128203; Copiar'; }, 2000);
                    }
                });
            }
        });

        // Confirmar pago
        document.querySelectorAll('.nomina-pagar-btn').forEach(function (btn) {
            if (!btn._bound) {
                btn._bound = true;
                btn.addEventListener('click', function () {
                    handleConfirmPago(this.dataset.vendor);
                });
            }
        });
    }

    // ── Confirmar pago ─────────────────────────────────────────────────

    async function handleConfirmPago(vendor) {
        var eligible = getEligibleBH();
        var vendorItems = eligible.filter(function (p) { return (p.vendorName || 'Sin beneficiario').trim() === vendor; });
        var toPay = vendorItems.filter(function (p) { return selectionState[p.id] && selectionState[p.id].selected; });

        if (!toPay.length) { alert('No hay BH seleccionadas.'); return; }

        var totalTransfer = toPay.reduce(function (s, p) { return s + (selectionState[p.id].amount || 0); }, 0);
        var inputEl = document.querySelector('.nomina-comment-input[data-vendor="' + vendor + '"]');
        var comment = inputEl ? inputEl.value : buildTransferComment(toPay);

        var confirmMsg = '\u00bfConfirmar pago a ' + vendor + '?\n\n' +
            'Monto: ' + formatCLP(totalTransfer) + '\n' +
            'Glosa: ' + comment + '\n\n' +
            toPay.length + ' BH incluidas.';
        if (!confirm(confirmMsg)) return;

        var dateStr = todayStr();
        try {
            for (var i = 0; i < toPay.length; i++) {
                var p = toPay[i];
                var amt = selectionState[p.id].amount || 0;
                if (amt <= 0) continue;
                var newPayments = (p.payments || []).concat([{
                    id: generateId(), amount: amt, date: dateStr, method: 'transferencia', comment: comment
                }]);
                await window.Mazelab.DataService.update('payables', p.id, { payments: newPayments });
            }
            payables = await window.Mazelab.DataService.getAll('payables');
            toPay.forEach(function (p) { delete selectionState[p.id]; });
            showSuccessToast(vendor, totalTransfer, comment);
            renderContent();
        } catch (err) {
            console.error('NominasModule: handleConfirmPago error', err);
            alert('Error al guardar. Intenta nuevamente.');
        }
    }

    // ── Toast ──────────────────────────────────────────────────────────

    function showSuccessToast(vendor, amount, comment) {
        var toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;background:var(--success);color:var(--text-primary);border-radius:10px;padding:16px 20px;max-width:340px;box-shadow:0 4px 20px rgba(0,0,0,.25);font-size:14px';
        toast.innerHTML = '<div style="font-weight:700;margin-bottom:4px">&#10003; Pago registrado</div>' +
            '<div>' + escHtml(vendor) + ' &middot; ' + formatCLP(amount) + '</div>' +
            '<div style="font-family:monospace;font-size:12px;margin-top:6px;opacity:.9">' + escHtml(comment) + '</div>';
        document.body.appendChild(toast);
        setTimeout(function () { toast.style.transition = 'opacity .4s'; toast.style.opacity = '0'; }, 3200);
        setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 3700);
    }

    // ── Utils HTML ─────────────────────────────────────────────────────

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
        historialExpanded = {};
        try {
            var results = await Promise.all([
                window.Mazelab.DataService.getAll('payables'),
                window.Mazelab.DataService.getAll('sales')
            ]);
            payables     = results[0] || [];
            cachedSales  = results[1] || [];
        } catch (err) {
            console.error('NominasModule: init error', err);
            payables = [];
            cachedSales = [];
        }
        renderContent();
    }

    return { render: render, init: init };

})();
