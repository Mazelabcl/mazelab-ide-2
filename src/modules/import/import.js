window.Mazelab.Modules.ImportModule = (function () {
    let selectedType = null;
    let parsedRows = [];
    let parsedHeaders = [];
    let mappedHeaders = [];
    let importing = false;

    const IMPORT_TYPES = [
        { key: 'sales', label: 'Ventas', icon: '&#128176;', desc: 'Eventos y ventas' },
        { key: 'receivables', label: 'CXC', icon: '&#128196;', desc: 'Cuentas por cobrar' },
        { key: 'payables', label: 'CXP', icon: '&#128181;', desc: 'Cuentas por pagar' },
        { key: 'clients', label: 'Clientes', icon: '&#128101;', desc: 'Base de clientes' },
        { key: 'services', label: 'Servicios', icon: '&#9881;', desc: 'Cat\u00e1logo de servicios' },
        { key: 'staff', label: 'Staff', icon: '&#128100;', desc: 'Personal / vendedores' }
    ];

    const FIELD_ALIASES = {
        clientName: ['clientname','cliente','client','nombre cliente','raz\u00f3n social','empresa'],
        eventName: ['eventname','evento','event','nombre_evento','activacion','titulo','nombre'],
        serviceNames: ['servicenames','servicios','tipo','servicio','producto'],
        eventDate: ['eventdate','fecha_evento','fecha','date','fecha_evento'],
        amount: ['amount','monto','monto_venta','precio','valor','total'],
        status: ['status','estado','state','situaci\u00f3n','estado de pago','estado'],
        invoicedAmount: ['monto facturado','monto_facturado','facturado','invoiced amount'],
        amountPaid: ['monto pagado','monto_pagado','pagado','paid','abonado'],
        tipoDoc: ['tipo_doc','tipo doc','tipo documento cxc'],
        montoNeto: ['monto_neto','neto','monto neto'],
        invoiceNumber: ['n_documento','nro_factura','numero_factura','n_factura','invoice number'],
        billingMonth: ['mes_emision','mes_emision_factura','mes emision','billing month'],
        ncAsociada: ['nc_asociada','nc asociada','nota credito'],
        jornadas: ['jornadas','dias','d\u00edas','days','duracion'],
        closingMonth: ['closingmonth','mes_cierre','mes_venta','fecha_venta'],
        staffName: ['staffname','ejecutivo','vendedor','responsable','vendido por'],
        comments: ['comments','comentarios','comentario','notas','observaciones'],
        refundAmount: ['refundamount','devolucion','devoluci\u00f3n','reembolso','monto_devolucion','monto devolucion'],
        costAmount: ['costo_evento','costo','cost'],
        utility: ['utilidad','utility','profit'],
        vendorName: ['beneficiario','proveedor','vendor','vendorname'],
        eventId: ['id_venta','sale_id','eventid'],
        sourceId: ['id','id_evento','sale_identifier'],
        billingDate: ['fecha_emision','fecha_doc','emision','billing_date','fecha emision'],
        docType: ['documento','tipo_documento','document_type'],
        docNumber: ['num_doc','numero_documento','doc_number'],
        paymentAmount: ['valor_pago','payment_amount'],
        paidAmount: ['monto_pagado','paid_amount'],
        pendingAmount: ['monto_pendiente','pending_amount'],
        paymentDate: ['fecha_probable_pago','payment_date','fecha_probable_pago_cxp'],
        paymentStatus: ['estado_cxp','payment_status'],
        concept: ['tipo_de_costo','concepto','concept']
    };

    // --- Utility functions ---

    function parseAmount(val) {
        if (!val || val === '.' || val === '0') return 0;
        let str = String(val).replace(/[$\s]/g, '');
        if (str.includes('#') || str.includes('REF')) return 0;
        const commaCount = (str.match(/,/g) || []).length;
        const dotCount = (str.match(/\./g) || []).length;
        if (commaCount > 1) str = str.replace(/,/g, '');
        else if (dotCount > 1) str = str.replace(/\./g, '');
        else if (commaCount === 1 && dotCount === 0) {
            const afterComma = str.split(',')[1];
            if (afterComma && afterComma.length === 3) str = str.replace(',', '');
            else str = str.replace(',', '.');
        }
        return Number(str) || 0;
    }

    function parseDate(val) {
        if (!val) return '';
        const str = String(val).trim();
        const dmy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (dmy) return dmy[3] + '-' + dmy[2].padStart(2, '0') + '-' + dmy[1].padStart(2, '0');
        if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.substring(0, 10);
        const my = str.match(/^(\d{1,2})\/(\d{4})$/);
        if (my) return my[2] + '-' + my[1].padStart(2, '0');
        return str;
    }

    function formatCLP(amount) {
        if (amount == null || isNaN(amount)) return '$0';
        return '$' + Number(amount).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    }

    function generateId() {
        return Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 9);
    }

    // --- CSV Parsing ---

    function parseCSVLine(line) {
        const fields = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (inQuotes) {
                if (ch === '"') {
                    if (i + 1 < line.length && line[i + 1] === '"') {
                        current += '"';
                        i++;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    current += ch;
                }
            } else {
                if (ch === '"') {
                    inQuotes = true;
                } else if (ch === ',' || ch === '\t') {
                    fields.push(current.trim());
                    current = '';
                } else {
                    current += ch;
                }
            }
        }
        fields.push(current.trim());
        return fields;
    }

    function detectSeparator(text) {
        const firstLine = text.split(/\r?\n/)[0] || '';
        const tabs = (firstLine.match(/\t/g) || []).length;
        const commas = (firstLine.match(/,/g) || []).length;
        return tabs > commas ? '\t' : ',';
    }

    function parseCSV(text) {
        const lines = text.split(/\r?\n/).filter(function (l) { return l.trim().length > 0; });
        if (lines.length < 2) return { headers: [], rows: [] };

        const headerFields = parseCSVLine(lines[0]);
        const rows = [];
        for (let i = 1; i < lines.length; i++) {
            const fields = parseCSVLine(lines[i]);
            if (fields.length === 0 || (fields.length === 1 && !fields[0])) continue;
            const row = {};
            for (let j = 0; j < headerFields.length; j++) {
                row[headerFields[j]] = j < fields.length ? fields[j] : '';
            }
            rows.push(row);
        }
        return { headers: headerFields, rows: rows };
    }

    function mapHeader(rawHeader) {
        const normalized = rawHeader.toLowerCase().trim();
        for (var field in FIELD_ALIASES) {
            if (FIELD_ALIASES.hasOwnProperty(field)) {
                var aliases = FIELD_ALIASES[field];
                for (var i = 0; i < aliases.length; i++) {
                    if (aliases[i].toLowerCase() === normalized) {
                        return field;
                    }
                }
            }
        }
        return rawHeader;
    }

    function mapRow(rawRow, rawHeaders) {
        var mapped = {};
        for (var i = 0; i < rawHeaders.length; i++) {
            var key = mapHeader(rawHeaders[i]);
            var val = rawRow[rawHeaders[i]];
            if (val !== undefined) {
                mapped[key] = val;
            }
        }
        return mapped;
    }

    // --- Record Transformation ---

    function calcReceivableStatus(row) {
        var tipoDoc = (row.tipoDoc || '').toLowerCase().trim();
        if (tipoDoc === 'nc') return '';

        var csvStatus = (row.status || '').toLowerCase().trim();
        if (csvStatus === 'anulada') return 'anulada';
        if (csvStatus === 'pagado' || csvStatus === 'pagada') return 'pagada';

        var invoiced = parseAmount(row.invoicedAmount);
        if (invoiced <= 0) return 'pendiente_factura';

        var paid = parseAmount(row.amountPaid);
        if (paid >= invoiced) return 'pagada';

        // Vencimiento desde mes de emisión de factura (billingMonth), no desde eventDate
        var baseDate = parseBillingMonthToDate(row.billingMonth) || (row.eventDate ? new Date(parseDate(row.eventDate)) : null);
        if (baseDate) {
            var diffDays = (Date.now() - baseDate.getTime()) / (1000 * 60 * 60 * 24);
            if (diffDays > 90) return 'vencida_90';
            if (diffDays > 60) return 'vencida_60';
            if (diffDays > 30) return 'vencida_30';
        }

        return 'pendiente_pago';
    }

    // Normaliza billingMonth al formato estándar DD/MM/YYYY.
    // Formato de entrada: DD/MM/YYYY (se mantiene) o MM/YYYY (→ 01/MM/YYYY) o YYYY-MM (→ 01/MM/YYYY)
    function normalizeBillingMonth(val) {
        if (!val) return '';
        var str = String(val).trim();
        // Ya está en DD/MM/YYYY → mantener
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) return str;
        // MM/YYYY → 01/MM/YYYY
        var my = str.match(/^(\d{1,2})\/(\d{4})$/);
        if (my) return '01/' + my[1].padStart(2, '0') + '/' + my[2];
        // YYYY-MM → 01/MM/YYYY
        if (/^\d{4}-\d{2}$/.test(str)) {
            var p = str.split('-');
            return '01/' + p[1] + '/' + p[0];
        }
        return str;
    }

    // Parsea billingMonth a Date para calcular vencimiento.
    // DD/MM/YYYY → usa el día real; MM/YYYY o YYYY-MM → día 1 (histórico)
    function parseBillingMonthToDate(bm) {
        if (!bm) return null;
        var str = String(bm).trim();
        // Fecha completa DD/MM/YYYY → preserva el día
        var dmy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
        // Solo mes YYYY-MM → día 1
        if (/^\d{4}-\d{2}$/.test(str)) {
            var p = str.split('-');
            return new Date(Number(p[0]), Number(p[1]) - 1, 1);
        }
        // Solo mes MM/YYYY → día 1
        var my = str.match(/^(\d{1,2})\/(\d{4})$/);
        if (my) return new Date(Number(my[2]), Number(my[1]) - 1, 1);
        return null;
    }

    function buildSaleRecord(row) {
        // devolucion (columna vendidos.csv) → refundAmount
        // Si hay monto de devolución, el evento tuvo un problema
        var refundAmount = parseAmount(row.refundAmount);
        var rawStatus = (row.status || 'pendiente').toLowerCase().trim();
        // Normaliza 'realizado' → 'realizada' para consistencia interna
        var status = rawStatus === 'realizado' ? 'realizada' : rawStatus;
        // Use the CSV's own id column if present — so id_venta in CXP CSVs links directly
        var csvId = (row.sourceId || '').toString().trim();
        return {
            id: csvId || generateId(),
            sourceId: csvId, // original CSV id for CXP linking
            clientName: row.clientName || '',
            eventName: row.eventName || '',
            serviceNames: row.serviceNames || '',
            eventDate: parseDate(row.eventDate),
            amount: parseAmount(row.amount),
            status: status,
            jornadas: row.jornadas ? parseInt(row.jornadas, 10) || 0 : 0,
            closingDate: parseDate(row.closingMonth || row.closingDate),
            staffName: row.staffName || '',
            comments: row.comments || '',
            refundAmount: refundAmount,
            hasIssue: refundAmount > 0,    // flag para dashboard "Eventos con Problemas"
            costAmount: parseAmount(row.costAmount),
            utility: parseAmount(row.utility)
        };
    }

    function buildReceivableRecord(row) {
        var invoiced = parseAmount(row.invoicedAmount);
        var paid = parseAmount(row.amountPaid);
        var status = calcReceivableStatus(row);

        var csvSourceId = (row.sourceId || row.eventId || '').toString().trim();
        var rec = {
            id: generateId(),
            sourceId: csvSourceId || undefined,  // ID numérico del CSV para búsqueda/filtro
            clientName: row.clientName || '',
            eventName: row.eventName || '',
            tipoDoc: row.tipoDoc || '',
            invoiceNumber: row.invoiceNumber || '',
            billingMonth: normalizeBillingMonth(row.billingMonth),
            montoNeto: parseAmount(row.montoNeto),
            invoicedAmount: invoiced,
            amountPaid: paid,
            pendingAmount: invoiced - paid,
            status: status,
            eventDate: parseDate(row.eventDate),
            ncAsociada: row.ncAsociada || '',
            comments: row.comments || ''
        };

        if (paid > 0) {
            rec.payments = [{
                id: generateId(),
                amount: paid,
                date: parseDate(row.eventDate) || new Date().toISOString().substring(0, 10),
                method: 'importado'
            }];
        }

        return rec;
    }

    function normalizePayableDocType(val) {
        var s = (val || '').trim().toLowerCase();
        if (s === 'bh') return 'bh';
        if (s === 'f' || s === 'factura' || s === 'boleta') return 'factura';
        if (s === 'e' || s === 'exenta' || s === 'exento') return 'exenta';
        if (s === 'invoice') return 'invoice';
        return s || 'ninguno';
    }

    function buildPayableRecord(row) {
        // Monto bruto del documento (valor_pago en CSV).
        // No usar row.amount como fallback: en CXP ese campo vendría de monto_venta
        // (el ingreso total del evento, no su costo), lo que daría valores incorrectos.
        var amount = parseAmount(row.paymentAmount);
        var amountPaid = parseAmount(row.paidAmount || row.amountPaid);
        var rawStatus = (row.paymentStatus || row.status || 'pendiente').toLowerCase().trim();
        var isPaid = rawStatus === 'pagado' || rawStatus === 'pagada';

        // Categoría: si id es 0/vacío/VARIOS → general, si no → evento.
        // El CSV de CXP usa la columna "id" (alias → sourceId) para identificar el evento.
        // row.eventId viene de alias id_venta/sale_id/eventid, que NO existe en el CSV de CXP,
        // por lo que usamos row.sourceId como fallback (la columna "id" del CSV).
        var eventIdRaw = (row.eventId || row.sourceId || '').toString().trim();
        var isGeneralEvent = !eventIdRaw || eventIdRaw === '0' ||
            eventIdRaw.toLowerCase() === 'varios' ||
            eventIdRaw.toLowerCase() === 'general';
        var category = isGeneralEvent ? 'general' : 'evento';

        // billingDate: fecha emisión del doc; fallback a eventDate
        var billingDate = parseDate(row.billingDate) || parseDate(row.eventDate) || '';

        var rec = {
            id: generateId(),
            eventId: isGeneralEvent ? '' : eventIdRaw,
            category: category,
            clientName: row.clientName || '',
            eventName: row.eventName || '',
            eventDate: parseDate(row.eventDate),
            billingDate: billingDate,
            concept: row.concept || '',
            vendorName: row.vendorName || '',
            docType: normalizePayableDocType(row.tipoDoc || row.docType),
            docNumber: row.docNumber || '',
            amount: amount,
            status: isPaid ? 'pagada' : 'pendiente',
            comments: row.comments || '',
            payments: []
        };

        // Inicializar payments[] si hay monto pagado
        if (amountPaid > 0) {
            rec.payments = [{
                id: generateId(),
                amount: amountPaid,
                date: parseDate(row.paymentDate || row.eventDate) || new Date().toISOString().substring(0, 10),
                method: 'importado'
            }];
        } else if (isPaid && amount > 0) {
            // Estado pagado pero sin monto_pagado → asumir pago completo
            rec.payments = [{
                id: generateId(),
                amount: amount,
                date: new Date().toISOString().substring(0, 10),
                method: 'importado'
            }];
        }

        return rec;
    }

    function buildClientRecord(row) {
        return {
            id: generateId(),
            name: row.clientName || row.eventName || '',
            nombre: row.clientName || row.eventName || '',
            comments: row.comments || ''
        };
    }

    function buildServiceRecord(row) {
        return {
            id: generateId(),
            name: row.serviceNames || row.eventName || '',
            nombre: row.serviceNames || row.eventName || '',
            comments: row.comments || ''
        };
    }

    function buildStaffRecord(row) {
        return {
            id: generateId(),
            name: row.staffName || row.eventName || '',
            nombre: row.staffName || row.eventName || '',
            comments: row.comments || ''
        };
    }

    function buildRecords(mappedRows, type) {
        var builders = {
            sales: buildSaleRecord,
            receivables: buildReceivableRecord,
            payables: buildPayableRecord,
            clients: buildClientRecord,
            services: buildServiceRecord,
            staff: buildStaffRecord
        };
        var fn = builders[type];
        if (!fn) return mappedRows;
        return mappedRows.map(fn);
    }

    async function autoCreateEntities(mappedRows) {
        var DS = window.Mazelab.DataService;
        var existingClients = await DS.getAll('clients') || [];
        var existingServices = await DS.getAll('services') || [];
        var existingStaff = await DS.getAll('staff') || [];

        var clientNames = new Set(existingClients.map(function (c) { return (c.name || c.nombre || '').toLowerCase(); }));
        var serviceNames = new Set(existingServices.map(function (s) { return (s.name || s.nombre || '').toLowerCase(); }));
        var staffNames = new Set(existingStaff.map(function (s) { return (s.name || s.nombre || '').toLowerCase(); }));

        var newClients = [];
        var newServices = [];
        var newStaff = [];

        mappedRows.forEach(function (row) {
            var cn = (row.clientName || '').trim();
            if (cn && !clientNames.has(cn.toLowerCase())) {
                clientNames.add(cn.toLowerCase());
                newClients.push({ id: generateId(), name: cn, nombre: cn });
            }

            var sn = (row.serviceNames || '').trim();
            if (sn) {
                sn.split(/[,;\/+]/).forEach(function (s) {
                    var name = s.trim();
                    if (name && !serviceNames.has(name.toLowerCase())) {
                        serviceNames.add(name.toLowerCase());
                        newServices.push({ id: generateId(), name: name, nombre: name });
                    }
                });
            }

            var staff = (row.staffName || '').trim();
            if (staff && !staffNames.has(staff.toLowerCase())) {
                staffNames.add(staff.toLowerCase());
                newStaff.push({ id: generateId(), name: staff, nombre: staff });
            }

            var vendor = (row.vendorName || '').trim();
            if (vendor && !clientNames.has(vendor.toLowerCase())) {
                clientNames.add(vendor.toLowerCase());
                newClients.push({ id: generateId(), name: vendor, nombre: vendor });
            }
        });

        var counts = { clients: 0, services: 0, staff: 0 };
        if (newClients.length > 0) {
            await DS.importMany('clients', newClients);
            counts.clients = newClients.length;
        }
        if (newServices.length > 0) {
            await DS.importMany('services', newServices);
            counts.services = newServices.length;
        }
        if (newStaff.length > 0) {
            await DS.importMany('staff', newStaff);
            counts.staff = newStaff.length;
        }
        return counts;
    }

    // --- Render ---

    function render() {
        var typeCards = IMPORT_TYPES.map(function (t) {
            return '<div class="card toggle-option import-type-card" data-type="' + t.key + '">' +
                '<div class="drop-icon">' + t.icon + '</div>' +
                '<strong>' + t.label + '</strong>' +
                '<small>' + t.desc + '</small>' +
                '</div>';
        }).join('');

        return '' +
            '<div class="content-header">' +
                '<h1>Importar Datos</h1>' +
            '</div>' +
            '<div class="content-body">' +
                '<div class="form-group">' +
                    '<label>Tipo de importaci\u00f3n</label>' +
                    '<div class="kpi-grid toggle-group" id="import-type-selector">' +
                        typeCards +
                    '</div>' +
                '</div>' +

                '<div class="form-group" id="import-dropzone-area" style="display:none;">' +
                    '<label>Archivo CSV</label>' +
                    '<div class="drop-zone" id="import-drop-zone">' +
                        '<div class="drop-icon">&#128193;</div>' +
                        '<p>Arrastra tu archivo CSV aqu\u00ed o <strong>haz clic</strong> para seleccionar</p>' +
                        '<small id="import-file-name"></small>' +
                    '</div>' +
                    '<input type="file" id="import-file-input" accept=".csv,.tsv,.txt" style="display:none;" />' +
                '</div>' +

                '<div id="import-preview-area" style="display:none;">' +
                    '<div class="form-group">' +
                        '<label>Vista previa <span id="import-preview-count" class="badge-info"></span></label>' +
                        '<div style="overflow-x:auto;">' +
                            '<table class="data-table" id="import-preview-table">' +
                                '<thead id="import-preview-thead"></thead>' +
                                '<tbody id="import-preview-tbody"></tbody>' +
                            '</table>' +
                        '</div>' +
                    '</div>' +
                    '<div class="form-group" style="text-align:right;">' +
                        '<button class="btn-secondary" id="import-cancel-btn">Cancelar</button> ' +
                        '<button class="btn-primary" id="import-run-btn">Importar</button>' +
                    '</div>' +
                '</div>' +

                '<div id="import-results-area" style="display:none;">' +
                    '<div class="card" id="import-results-card">' +
                        '<h3>Resultado de la importaci\u00f3n</h3>' +
                        '<div id="import-results-body"></div>' +
                    '</div>' +
                '</div>' +

                '<div class="card" style="border-color:var(--danger);margin-top:var(--space-xl)">' +
                    '<div class="card-header">' +
                        '<span class="card-title" style="color:var(--danger)">&#9888; Zona de Peligro</span>' +
                    '</div>' +
                    '<p style="font-size:13px;color:var(--text-secondary);margin-bottom:var(--space-md)">Elimina TODOS los datos del sistema (ventas, CXC, CXP, clientes, servicios, staff). \u00datil para empezar de cero o para probar imports.</p>' +
                    '<button class="btn btn-danger" id="btn-clear-all-data">Limpiar todos los datos</button>' +
                '</div>' +
            '</div>';
    }

    // --- Preview rendering ---

    function renderPreview() {
        var previewArea = document.getElementById('import-preview-area');
        var thead = document.getElementById('import-preview-thead');
        var tbody = document.getElementById('import-preview-tbody');
        var countEl = document.getElementById('import-preview-count');

        if (!previewArea || !thead || !tbody) return;

        countEl.textContent = parsedRows.length + ' registros';

        var headerRow = '<tr>' + mappedHeaders.map(function (h) {
            return '<th>' + h + '</th>';
        }).join('') + '</tr>';
        thead.innerHTML = headerRow;

        var previewRows = parsedRows.slice(0, 10);
        tbody.innerHTML = previewRows.map(function (row) {
            return '<tr>' + mappedHeaders.map(function (h) {
                var val = row[h] !== undefined ? row[h] : '';
                if (String(val).length > 60) val = String(val).substring(0, 57) + '...';
                return '<td>' + escapeHtml(String(val)) + '</td>';
            }).join('') + '</tr>';
        }).join('');

        previewArea.style.display = '';
    }

    function escapeHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // --- File handling ---

    function handleFile(file) {
        if (!file) return;
        var nameEl = document.getElementById('import-file-name');
        if (nameEl) nameEl.textContent = file.name;

        var reader = new FileReader();
        reader.onload = function (e) {
            var text = e.target.result;
            var result = parseCSV(text);
            parsedHeaders = result.headers;

            // Map headers
            mappedHeaders = parsedHeaders.map(mapHeader);

            // Map rows
            parsedRows = result.rows.map(function (rawRow) {
                return mapRow(rawRow, parsedHeaders);
            });

            renderPreview();
        };
        reader.readAsText(file, 'UTF-8');
    }

    // --- Import execution ---

    async function runImport() {
        if (importing || !selectedType || parsedRows.length === 0) return;
        importing = true;

        var runBtn = document.getElementById('import-run-btn');
        if (runBtn) {
            runBtn.disabled = true;
            runBtn.textContent = 'Importando...';
        }

        var DS = window.Mazelab.DataService;
        var resultsArea = document.getElementById('import-results-area');
        var resultsBody = document.getElementById('import-results-body');

        try {
            // Auto-create referenced entities for sales, receivables, payables
            var entityCounts = { clients: 0, services: 0, staff: 0 };
            if (selectedType === 'sales' || selectedType === 'receivables' || selectedType === 'payables') {
                entityCounts = await autoCreateEntities(parsedRows);
            }

            // Build records
            var records = buildRecords(parsedRows, selectedType);

            // Import
            var saved = await DS.importMany(selectedType, records);
            var savedCount = Array.isArray(saved) ? saved.length : records.length;

            // Show results
            var typeLabel = IMPORT_TYPES.find(function (t) { return t.key === selectedType; });
            var html = '<p><span class="badge-success">Importaci\u00f3n exitosa</span></p>' +
                '<p><strong>' + savedCount + '</strong> registros de <strong>' + (typeLabel ? typeLabel.label : selectedType) + '</strong> importados.</p>';

            if (entityCounts.clients > 0 || entityCounts.services > 0 || entityCounts.staff > 0) {
                html += '<p>Entidades creadas autom\u00e1ticamente:</p><ul>';
                if (entityCounts.clients > 0) html += '<li>' + entityCounts.clients + ' clientes nuevos</li>';
                if (entityCounts.services > 0) html += '<li>' + entityCounts.services + ' servicios nuevos</li>';
                if (entityCounts.staff > 0) html += '<li>' + entityCounts.staff + ' miembros de staff nuevos</li>';
                html += '</ul>';
            }

            if (resultsBody) resultsBody.innerHTML = html;
            if (resultsArea) resultsArea.style.display = '';

        } catch (err) {
            console.error('Error en importaci\u00f3n:', err);
            if (resultsBody) {
                resultsBody.innerHTML = '<p><span class="badge-danger">Error en la importaci\u00f3n</span></p>' +
                    '<p>' + escapeHtml(String(err.message || err)) + '</p>';
            }
            if (resultsArea) resultsArea.style.display = '';
        }

        importing = false;
        if (runBtn) {
            runBtn.disabled = false;
            runBtn.textContent = 'Importar';
        }
    }

    function resetState() {
        parsedRows = [];
        parsedHeaders = [];
        mappedHeaders = [];

        var previewArea = document.getElementById('import-preview-area');
        var resultsArea = document.getElementById('import-results-area');
        var nameEl = document.getElementById('import-file-name');
        var fileInput = document.getElementById('import-file-input');

        if (previewArea) previewArea.style.display = 'none';
        if (resultsArea) resultsArea.style.display = 'none';
        if (nameEl) nameEl.textContent = '';
        if (fileInput) fileInput.value = '';
    }

    // --- Init ---

    function init() {
        // Type selector
        var typeCards = document.querySelectorAll('.import-type-card');
        typeCards.forEach(function (card) {
            card.addEventListener('click', function () {
                typeCards.forEach(function (c) { c.classList.remove('active'); });
                card.classList.add('active');
                selectedType = card.getAttribute('data-type');

                var dropArea = document.getElementById('import-dropzone-area');
                if (dropArea) dropArea.style.display = '';

                resetState();
            });
        });

        // Drop zone click
        var dropZone = document.getElementById('import-drop-zone');
        var fileInput = document.getElementById('import-file-input');

        if (dropZone && fileInput) {
            dropZone.addEventListener('click', function () {
                fileInput.click();
            });

            dropZone.addEventListener('dragover', function (e) {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.add('active');
            });

            dropZone.addEventListener('dragleave', function (e) {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.remove('active');
            });

            dropZone.addEventListener('drop', function (e) {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.remove('active');
                var files = e.dataTransfer.files;
                if (files.length > 0) {
                    handleFile(files[0]);
                }
            });

            fileInput.addEventListener('change', function () {
                if (fileInput.files.length > 0) {
                    handleFile(fileInput.files[0]);
                }
            });
        }

        // Import button
        var runBtn = document.getElementById('import-run-btn');
        if (runBtn) {
            runBtn.addEventListener('click', function () {
                runImport();
            });
        }

        // Cancel button
        var cancelBtn = document.getElementById('import-cancel-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', function () {
                resetState();
            });
        }

        // Clear all data button
        var clearBtn = document.getElementById('btn-clear-all-data');
        if (clearBtn) {
            clearBtn.addEventListener('click', async function () {
                if (!confirm('\u00bfEliminar TODOS los datos del sistema?\n\nSe borrar\u00e1n: ventas, CXC, CXP, clientes, servicios y staff.\n\nEsta acci\u00f3n no se puede deshacer.')) return;
                if (!confirm('\u00daltima confirmaci\u00f3n: \u00bfEst\u00e1s seguro?')) return;
                try {
                    var DS = window.Mazelab.DataService;
                    var tables = ['sales', 'receivables', 'payables', 'clients', 'services', 'staff'];
                    clearBtn.textContent = 'Eliminando...';
                    clearBtn.disabled = true;
                    for (var i = 0; i < tables.length; i++) {
                        var items = (await DS.getAll(tables[i])) || [];
                        for (var j = 0; j < items.length; j++) {
                            await DS.remove(tables[i], items[j].id);
                        }
                    }
                    alert('Todos los datos han sido eliminados.');
                } catch (err) {
                    alert('Error al limpiar datos: ' + err.message);
                } finally {
                    clearBtn.textContent = 'Limpiar todos los datos';
                    clearBtn.disabled = false;
                }
            });
        }
    }

    return { render, init };
})();
