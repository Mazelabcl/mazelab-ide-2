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

            // Build client map: name -> { contactos, phone, email }
            var clientMap = {};
            clients.forEach(function (c) {
                var name = c.name || c.nombre || c.clientName || '';
                if (!name) return;
                // Merge contacts: new contactos array, or legacy ejecutivos as names-only
                var contactos = [];
                if (Array.isArray(c.contactos) && c.contactos.length) {
                    contactos = c.contactos;
                } else if (Array.isArray(c.ejecutivos) && c.ejecutivos.length) {
                    contactos = c.ejecutivos.map(function (n) { return { nombre: n, telefono: '', email: '' }; });
                }
                if (!clientMap[name]) {
                    clientMap[name] = {
                        contactos: contactos,
                        phone: c.phone || c.telefono || c.tel || '',
                        email: c.email || c.correo || ''
                    };
                }
            });

            Object.keys(clientMap).sort().forEach(function (name) {
                var opt = document.createElement('option');
                opt.value = name;
                datalist.appendChild(opt);
            });

            input.setAttribute('list', listId);
            input.parentNode.appendChild(datalist);

            // On client selection, populate contacts
            function onClientSelected() {
                var val = input.value.trim();
                var client = clientMap[val];
                if (!client) return;

                var contactos = client.contactos;
                if (contactos.length > 0) {
                    // If there's a contact name field, set up contact dropdown
                    if (contactNameId) {
                        buildContactDropdown(contactNameId, phoneFillId, emailFillId, contactos);
                        // Auto-select first contact
                        var first = contactos[0];
                        var cnEl = document.getElementById(contactNameId);
                        if (cnEl) { cnEl.value = first.nombre || ''; cnEl.dispatchEvent(new Event('change')); }
                        if (phoneFillId) {
                            var pEl = document.getElementById(phoneFillId);
                            if (pEl) pEl.value = first.telefono || '';
                        }
                        if (emailFillId) {
                            var eEl = document.getElementById(emailFillId);
                            if (eEl) eEl.value = first.email || '';
                        }
                    } else {
                        // No separate contact field — fill phone/email from first contact
                        var first = contactos[0];
                        if (phoneFillId) {
                            var pEl = document.getElementById(phoneFillId);
                            if (pEl && !pEl.value) pEl.value = first.telefono || client.phone || '';
                        }
                        if (emailFillId) {
                            var eEl = document.getElementById(emailFillId);
                            if (eEl && !eEl.value) eEl.value = first.email || client.email || '';
                        }
                    }
                } else {
                    // No contacts — fill from client-level fields
                    if (phoneFillId) {
                        var pEl = document.getElementById(phoneFillId);
                        if (pEl && !pEl.value) pEl.value = client.phone;
                    }
                    if (emailFillId) {
                        var eEl = document.getElementById(emailFillId);
                        if (eEl && !eEl.value) eEl.value = client.email;
                    }
                }
            }

            input.addEventListener('change', onClientSelected);
            input.addEventListener('input', function () {
                // Only trigger on exact match (datalist selection)
                if (clientMap[input.value.trim()]) onClientSelected();
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
                contactMap[name] = { telefono: ct.telefono || '', email: ct.email || '' };
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
            var val = input.value.trim();
            var ct = contactMap[val];
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
            if (contactMap[input.value.trim()]) onContactSelected();
        });
    }

    return {
        attachClientAutocomplete: attachClientAutocomplete,
        buildContactDropdown: buildContactDropdown,
        invalidateCache: invalidateCache
    };
})();
