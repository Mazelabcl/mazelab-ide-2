window.Mazelab.Autocomplete = (function () {

    // Cache loaded clients to avoid multiple fetches per page
    var _clientsCache = null;
    function loadClients() {
        if (_clientsCache) return Promise.resolve(_clientsCache);
        return window.Mazelab.DataService.getAll('clients').then(function (clients) {
            _clientsCache = clients || [];
            return _clientsCache;
        });
    }
    // Invalidate cache when navigating (modules call init() on each navigation)
    function invalidateCache() { _clientsCache = null; }

    // FA-009 fix: normalize keys for client/contact matching.
    // Razones:
    //  - typos historicos (ej. "Banco Chile  " con doble espacio interno)
    //  - diferencias entre el texto que ve el usuario y el `name` almacenado
    //  - case-insensitive matching
    // Antes el match era exacto (===), lo que provocaba autocomplete
    // intermitente reportado por el owner.
    function normalizeKey(str) {
        if (!str) return '';
        return String(str)
            .toLowerCase()
            .replace(/\s+/g, ' ')   // colapsa multiples espacios internos
            .trim();
    }

    // Helper para que otros modulos (sales, settings, cotizador) pueden hacer
    // lookup normalizado contra el cache de autocomplete sin reimplementar.
    function findClientByName(name) {
        var key = normalizeKey(name);
        if (!key || !_clientsCache) return null;
        for (var i = 0; i < _clientsCache.length; i++) {
            var c = _clientsCache[i];
            var n = normalizeKey(c.name || c.nombre || c.clientName || '');
            if (n === key) return c;
        }
        return null;
    }

    // Preload — llamado desde app.js#initApp() para garantizar que el cache
    // este listo antes de que el usuario empiece a tipear en cualquier modulo.
    // Antes el cache se cargaba dentro de cada `attachClientAutocomplete`,
    // asincrono — keystrokes durante esa carga se perdian.
    function preload() {
        return loadClients().catch(function (err) {
            console.warn('Autocomplete.preload: error cargando clients', err);
            return [];
        });
    }

    // ---------------------------------------------------------------
    //  attachClientAutocomplete — datalist for client (company) name
    //  When a client is selected, shows a contact dropdown if contacts exist
    // ---------------------------------------------------------------
    function attachClientAutocomplete(inputId, contactNameId, phoneFillId, emailFillId) {
        var input = document.getElementById(inputId);
        if (!input) return;

        // Remove autocomplete="off" which blocks datalist in some browsers
        input.removeAttribute('autocomplete');

        loadClients().then(function (clients) {
            if (!clients.length) return;

            var listId = inputId + '-client-list';
            var existing = document.getElementById(listId);
            if (existing) existing.remove();

            var datalist = document.createElement('datalist');
            datalist.id = listId;

            // Build client map: normalizedKey -> { contactos, phone, email, displayName }
            // FA-009 fix: clave normalizada en lugar de exacta. Esto soluciona
            // los typos de espacios internos / case-insensitive que hacian
            // que el autocomplete fallara intermitentemente.
            var clientMap = {};
            clients.forEach(function (c) {
                var name = c.name || c.nombre || c.clientName || '';
                if (!name) return;
                var key = normalizeKey(name);
                if (!key) return;
                // Merge contacts: new contactos array, or legacy ejecutivos as names-only
                var contactos = [];
                if (Array.isArray(c.contactos) && c.contactos.length) {
                    contactos = c.contactos;
                } else if (Array.isArray(c.ejecutivos) && c.ejecutivos.length) {
                    contactos = c.ejecutivos.map(function (n) { return { nombre: n, telefono: '', email: '' }; });
                }
                if (!clientMap[key]) {
                    clientMap[key] = {
                        displayName: name,
                        contactos: contactos,
                        phone: c.phone || c.telefono || c.tel || '',
                        email: c.email || c.correo || ''
                    };
                }
            });

            // Datalist usa displayName para mostrar bien al usuario (con
            // capitalizacion original), pero el lookup en onClientSelected
            // es por clave normalizada.
            Object.keys(clientMap).sort().forEach(function (key) {
                var opt = document.createElement('option');
                opt.value = clientMap[key].displayName;
                datalist.appendChild(opt);
            });

            input.setAttribute('list', listId);
            input.parentNode.appendChild(datalist);

            // On client selection, populate contacts
            function onClientSelected() {
                var val = input.value;
                var key = normalizeKey(val);
                var client = clientMap[key];
                if (!client) return;

                var contactos = client.contactos;
                var first = contactos.length > 0 ? contactos[0] : null;

                // Auto-fill first contact into fields
                if (first) {
                    if (contactNameId) {
                        var cnEl = document.getElementById(contactNameId);
                        if (cnEl) cnEl.value = first.nombre || '';
                    }
                    if (phoneFillId) {
                        var pEl = document.getElementById(phoneFillId);
                        if (pEl) pEl.value = first.telefono || client.phone || '';
                    }
                    if (emailFillId) {
                        var eEl = document.getElementById(emailFillId);
                        if (eEl) eEl.value = first.email || client.email || '';
                    }
                } else {
                    if (phoneFillId) {
                        var pEl = document.getElementById(phoneFillId);
                        if (pEl && !pEl.value) pEl.value = client.phone || '';
                    }
                    if (emailFillId) {
                        var eEl = document.getElementById(emailFillId);
                        if (eEl && !eEl.value) eEl.value = client.email || '';
                    }
                }

                // Show contact chips for quick selection (if multiple contacts)
                if (contactos.length > 0 && contactNameId) {
                    var cnEl2 = document.getElementById(contactNameId);
                    if (cnEl2) {
                        showContactChips(cnEl2, contactos, phoneFillId, emailFillId);
                        // Auto-expand traspaso section if collapsed
                        var traspasoFields = document.getElementById('traspaso-fields');
                        var traspasoArrow = document.getElementById('traspaso-arrow');
                        if (traspasoFields && traspasoFields.style.display === 'none') {
                            traspasoFields.style.display = 'block';
                            if (traspasoArrow) traspasoArrow.style.transform = 'rotate(180deg)';
                        }
                    }
                }
            }

            input.addEventListener('change', onClientSelected);
            input.addEventListener('input', function () {
                // FA-009: trigger por match normalizado (no exacto)
                if (clientMap[normalizeKey(input.value)]) onClientSelected();
            });
            // FA-009: fallback en blur — si el usuario tipea sin seleccionar
            // del datalist y suelta el foco con un valor que matchea por
            // normalizacion, igualmente disparar el autofill de contactos.
            input.addEventListener('blur', function () {
                if (clientMap[normalizeKey(input.value)]) onClientSelected();
            });
        });
    }

    // ---------------------------------------------------------------
    //  buildContactDropdown — datalist for contact name within a client
    //  On contact selection, fills phone + email
    // ---------------------------------------------------------------
    function buildContactDropdown(contactNameId, phoneFillId, emailFillId, contactos) {
        var input = document.getElementById(contactNameId);
        if (!input) return;

        var listId = contactNameId + '-contact-list';
        var existing = document.getElementById(listId);
        if (existing) existing.remove();

        var datalist = document.createElement('datalist');
        datalist.id = listId;

        var contactMap = {};
        contactos.forEach(function (ct) {
            var name = ct.nombre || '';
            if (name) {
                var key = normalizeKey(name);
                contactMap[key] = { telefono: ct.telefono || '', email: ct.email || '' };
                var opt = document.createElement('option');
                opt.value = name;
                datalist.appendChild(opt);
            }
        });

        input.setAttribute('list', listId);
        input.removeAttribute('autocomplete');
        // Append datalist near input
        if (input.parentNode) input.parentNode.appendChild(datalist);

        function onContactSelected() {
            var val = input.value;
            var ct = contactMap[normalizeKey(val)];
            if (!ct) return;
            if (phoneFillId) {
                var pEl = document.getElementById(phoneFillId);
                if (pEl) pEl.value = ct.telefono;
            }
            if (emailFillId) {
                var eEl = document.getElementById(emailFillId);
                if (eEl) eEl.value = ct.email;
            }
        }

        input.addEventListener('change', onContactSelected);
        input.addEventListener('input', function () {
            if (contactMap[normalizeKey(input.value)]) onContactSelected();
        });
        input.addEventListener('blur', function () {
            if (contactMap[normalizeKey(input.value)]) onContactSelected();
        });
    }

    // ---------------------------------------------------------------
    //  showContactChips — visual chips for quick contact selection
    // ---------------------------------------------------------------
    function showContactChips(anchorEl, contactos, phoneFillId, emailFillId) {
        // Find or create chips container after the anchor element's form-group
        var parent = anchorEl.closest('.form-group') || anchorEl.parentNode;
        var containerId = anchorEl.id + '-contact-chips';
        var container = document.getElementById(containerId);
        if (!container) {
            container = document.createElement('div');
            container.id = containerId;
            container.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:6px';
            parent.appendChild(container);
        }
        container.innerHTML = contactos.map(function (ct, i) {
            var label = ct.nombre || 'Contacto ' + (i + 1);
            var sub = [ct.telefono, ct.email].filter(Boolean).join(' · ');
            return '<button type="button" class="ac-contact-chip" style="font-size:11px;padding:4px 10px;border-radius:12px;background:rgba(139,92,246,0.15);color:var(--accent);border:1px solid rgba(139,92,246,0.3);cursor:pointer;text-align:left;line-height:1.3" ' +
                'data-nombre="' + (ct.nombre || '').replace(/"/g, '&quot;') + '" ' +
                'data-tel="' + (ct.telefono || '').replace(/"/g, '&quot;') + '" ' +
                'data-email="' + (ct.email || '').replace(/"/g, '&quot;') + '">' +
                '<strong>' + label + '</strong>' +
                (sub ? '<br><span style="font-size:10px;opacity:0.7">' + sub + '</span>' : '') +
                '</button>';
        }).join('');

        container.querySelectorAll('.ac-contact-chip').forEach(function (chip) {
            chip.addEventListener('click', function () {
                anchorEl.value = this.dataset.nombre || '';
                if (phoneFillId) {
                    var pEl = document.getElementById(phoneFillId);
                    if (pEl) pEl.value = this.dataset.tel || '';
                }
                if (emailFillId) {
                    var eEl = document.getElementById(emailFillId);
                    if (eEl) eEl.value = this.dataset.email || '';
                }
                // Visual feedback — highlight selected chip
                container.querySelectorAll('.ac-contact-chip').forEach(function (c) {
                    c.style.background = 'rgba(139,92,246,0.15)';
                });
                this.style.background = 'rgba(139,92,246,0.35)';
            });
        });

        // Highlight first chip by default
        var firstChip = container.querySelector('.ac-contact-chip');
        if (firstChip) firstChip.style.background = 'rgba(139,92,246,0.35)';
    }

    return {
        attachClientAutocomplete: attachClientAutocomplete,
        buildContactDropdown: buildContactDropdown,
        showContactChips: showContactChips,
        invalidateCache: invalidateCache,
        preload: preload,
        findClientByName: findClientByName,
        normalizeKey: normalizeKey
    };
})();
