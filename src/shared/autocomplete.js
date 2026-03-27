window.Mazelab.Autocomplete = (function () {
    // Builds a datalist-based autocomplete for client fields
    // When a client is selected, fills phone + email fields

    function attachClientAutocomplete(inputId, phoneFillId, emailFillId) {
        var input = document.getElementById(inputId);
        if (!input) return;

        window.Mazelab.DataService.getAll('clients').then(function (clients) {
            if (!clients || !clients.length) return;

            var listId = inputId + '-client-list';
            var existing = document.getElementById(listId);
            if (existing) existing.remove();

            var datalist = document.createElement('datalist');
            datalist.id = listId;

            var clientMap = {};
            clients.forEach(function (c) {
                var name = c.name || c.nombre || c.clientName || '';
                if (name && !clientMap[name]) {
                    clientMap[name] = {
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

            function fillContact() {
                var val = input.value.trim();
                if (clientMap[val]) {
                    if (phoneFillId) {
                        var phoneEl = document.getElementById(phoneFillId);
                        if (phoneEl && !phoneEl.value) phoneEl.value = clientMap[val].phone;
                    }
                    if (emailFillId) {
                        var emailEl = document.getElementById(emailFillId);
                        if (emailEl && !emailEl.value) emailEl.value = clientMap[val].email;
                    }
                }
            }

            input.addEventListener('change', fillContact);
            input.addEventListener('input', fillContact);
        });
    }

    function attachContactAutocomplete(inputId, phoneFillId, emailFillId) {
        var input = document.getElementById(inputId);
        if (!input) return;

        window.Mazelab.DataService.getAll('clients').then(function (clients) {
            if (!clients || !clients.length) return;

            var listId = inputId + '-contact-list';
            var existing = document.getElementById(listId);
            if (existing) existing.remove();

            var datalist = document.createElement('datalist');
            datalist.id = listId;

            var contactMap = {};
            clients.forEach(function (c) {
                var name = c.contactName || c.nombre_contacto || c.name || c.nombre || '';
                if (name) {
                    contactMap[name] = {
                        phone: c.contactPhone || c.phone || c.telefono || c.tel || '',
                        email: c.contactEmail || c.email || c.correo || ''
                    };
                    var opt = document.createElement('option');
                    opt.value = name;
                    datalist.appendChild(opt);
                }
            });

            input.setAttribute('list', listId);
            input.parentNode.appendChild(datalist);

            function fillHandler() {
                var val = input.value.trim();
                if (contactMap[val]) {
                    if (phoneFillId) {
                        var phoneEl = document.getElementById(phoneFillId);
                        if (phoneEl) phoneEl.value = contactMap[val].phone;
                    }
                    if (emailFillId) {
                        var emailEl = document.getElementById(emailFillId);
                        if (emailEl) emailEl.value = contactMap[val].email;
                    }
                }
            }
            input.addEventListener('change', fillHandler);
            input.addEventListener('input', fillHandler);
        });
    }

    return {
        attachClientAutocomplete: attachClientAutocomplete,
        attachContactAutocomplete: attachContactAutocomplete
    };
})();
