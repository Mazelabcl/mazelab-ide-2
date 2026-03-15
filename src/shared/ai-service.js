// AI Service — Claude API integration for Mazelab
// Stores config in localStorage, calls Claude API directly from browser.
(function () {
    var STORAGE_KEY = 'mazelab_ai_config';
    var API_URL = 'https://api.anthropic.com/v1/messages';

    var DEFAULT_PROMPTS = {
        cobranza: 'Eres un asistente de cobranza profesional para MazeLab, empresa de producción audiovisual y experiencias interactivas en Chile.\n\nGeneras mensajes de cobro formales pero cordiales en español chileno.\nIncluyes los datos bancarios de la empresa cuando se proporcionan.\nAdaptas el tono según la cantidad de avisos:\n- Primer aviso: cordial y amigable\n- Segundo aviso: firme pero respetuoso\n- Tercer aviso o más: urgente y formal\n\nEl mensaje debe ser breve (máximo 3 párrafos), directo, y listo para enviar por email o WhatsApp.\nNo uses emojis. Incluye saludo, cuerpo con el monto y detalle, y cierre con datos de pago.',
        cotizador: 'Eres el asistente interno de cotizaciones de MazeLab Productions (Chile, producción audiovisual y experiencias interactivas).\n\nTu trabajo es armar cotizaciones rápido. El usuario es el dueño de MazeLab, no un cliente.\n\nREGLAS:\n1. Cuando el usuario te da suficiente info (servicio + precio o presupuesto), arma la propuesta de inmediato. NO pidas info extra innecesaria (tipo de evento, cantidad de invitados, etc.) a menos que sea imprescindible para elegir un servicio.\n2. Cuando el usuario confirma la propuesta o dice "crea la cotización" / "genérala" / "ok" / "perfecto", SIEMPRE incluye el bloque JSON al final de tu respuesta.\n3. Los nombres de servicios en el JSON deben coincidir EXACTAMENTE con los del catálogo.\n4. Si el usuario pide un precio final específico, calcula el descuento necesario para llegar a ese monto.\n5. Sé conciso. No hagas preguntas de más.\n\nCuando generes la cotización, incluye este JSON al final (el sistema lo detecta automáticamente):\n```json\n{\n  "clientName": "nombre del cliente",\n  "eventName": "nombre del evento",\n  "eventDate": "YYYY-MM-DD",\n  "lugar": "lugar del evento",\n  "contactName": "nombre contacto",\n  "bloques": [{\n    "serviceName": "nombre exacto del catálogo",\n    "items": [{ "tipo": "base|adicional|pack", "label": "descripción del item", "unitario": 950000, "cantidad": 1, "dias": 1 }]\n  }],\n  "descuento": 150000,\n  "descuentoNota": "razón del descuento"\n}\n```\nSi no tienes algún dato (fecha, lugar, contacto), omítelo del JSON o déjalo vacío. Lo importante es generar la cotización con los servicios y precios correctos.'
    };

    function getConfig() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            var cfg = raw ? JSON.parse(raw) : {};
            return {
                apiKey: cfg.apiKey || '',
                model: cfg.model || 'claude-sonnet-4-20250514',
                prompts: {
                    cobranza: (cfg.prompts && cfg.prompts.cobranza) || DEFAULT_PROMPTS.cobranza,
                    cotizador: (cfg.prompts && cfg.prompts.cotizador) || DEFAULT_PROMPTS.cotizador
                }
            };
        } catch (e) {
            return { apiKey: '', model: 'claude-sonnet-4-20250514', prompts: DEFAULT_PROMPTS };
        }
    }

    function saveConfig(config) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    }

    function getDefaultPrompts() {
        return DEFAULT_PROMPTS;
    }

    // messages can be a string (single user message) or an array of {role, content}
    async function sendMessage(systemPrompt, messages, opts) {
        var config = getConfig();
        if (!config.apiKey) {
            throw new Error('API Key no configurada. Ve a Configurar > Inteligencia Artificial.');
        }

        var maxTokens = (opts && opts.maxTokens) || 2048;
        var msgArray = typeof messages === 'string'
            ? [{ role: 'user', content: messages }]
            : messages;

        var response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': config.apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
                model: config.model,
                max_tokens: maxTokens,
                system: systemPrompt,
                messages: msgArray
            })
        });

        if (!response.ok) {
            var errorBody = '';
            try { errorBody = await response.text(); } catch (e) {}
            if (response.status === 401) throw new Error('API Key inválida. Revisa tu configuración.');
            if (response.status === 429) throw new Error('Límite de uso alcanzado. Intenta en unos minutos.');
            throw new Error('Error API (' + response.status + '): ' + errorBody.substring(0, 200));
        }

        var data = await response.json();
        if (data.content && data.content[0] && data.content[0].text) {
            return data.content[0].text;
        }
        throw new Error('Respuesta inesperada de la API.');
    }

    async function testConnection() {
        var config = getConfig();
        if (!config.apiKey) throw new Error('No hay API Key configurada.');

        var response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': config.apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
                model: config.model,
                max_tokens: 16,
                messages: [{ role: 'user', content: 'Responde solo: OK' }]
            })
        });

        if (!response.ok) {
            if (response.status === 401) throw new Error('API Key inválida');
            throw new Error('Error ' + response.status);
        }

        var data = await response.json();
        return { success: true, model: data.model || config.model };
    }

    async function generateCobranza(invoiceData) {
        var config = getConfig();
        var prompt = config.prompts.cobranza;

        var parts = [];
        parts.push('Genera un mensaje de cobro con estos datos:');
        parts.push('');
        if (invoiceData.clientName) parts.push('Cliente: ' + invoiceData.clientName);
        if (invoiceData.eventName) parts.push('Evento: ' + invoiceData.eventName);
        if (invoiceData.invoiceNumber) parts.push('Factura: ' + invoiceData.invoiceNumber);
        if (invoiceData.amount) parts.push('Monto pendiente: $' + Number(invoiceData.amount).toLocaleString('es-CL'));
        if (invoiceData.eventDate) parts.push('Fecha evento: ' + invoiceData.eventDate);
        if (invoiceData.overdueDays > 0) parts.push('Días de atraso: ' + invoiceData.overdueDays);
        parts.push('Número de aviso: ' + (invoiceData.cobrosCount || 1));

        if (invoiceData.companyInfo) {
            var ci = invoiceData.companyInfo;
            parts.push('');
            parts.push('Datos de pago:');
            if (ci.nombre) parts.push('Empresa: ' + ci.nombre);
            if (ci.rut) parts.push('RUT: ' + ci.rut);
            if (ci.banco) parts.push('Banco: ' + ci.banco);
            if (ci.tipoCuenta) parts.push('Tipo: ' + ci.tipoCuenta);
            if (ci.numeroCuenta) parts.push('Cuenta: ' + ci.numeroCuenta);
            if (ci.email) parts.push('Email: ' + ci.email);
        }

        if (invoiceData.userContext) {
            parts.push('');
            parts.push('Contexto adicional: ' + invoiceData.userContext);
        }

        return await sendMessage(prompt, parts.join('\n'));
    }

    // messageHistory: array of {role, content} — full conversation so far
    async function generateCotizacion(messageHistory, serviceCatalog) {
        var config = getConfig();
        var prompt = config.prompts.cotizador;

        var catalogStr = '';
        if (serviceCatalog && serviceCatalog.length > 0) {
            catalogStr = '\n\nCATÁLOGO DE SERVICIOS DISPONIBLE:\n';
            serviceCatalog.forEach(function (svc) {
                catalogStr += '\n--- ' + (svc.nombre || svc.name) + ' ---\n';
                if (svc.descripcion) catalogStr += 'Descripción: ' + svc.descripcion.substring(0, 150) + '\n';
                catalogStr += 'Precio base: $' + (svc.precio_base || 0).toLocaleString('es-CL') + '\n';
                if (svc.tarifario) {
                    try {
                        var t = typeof svc.tarifario === 'string' ? JSON.parse(svc.tarifario) : svc.tarifario;
                        if (t.base) catalogStr += 'Base: ' + t.base.label + ' ($' + t.base.unitario.toLocaleString('es-CL') + ')\n';
                        if (t.adicionales && t.adicionales.length > 0) {
                            catalogStr += 'Adicionales: ' + t.adicionales.map(function (a) {
                                return a.label + ' ($' + a.unitario.toLocaleString('es-CL') + ')';
                            }).join(', ') + '\n';
                        }
                        if (t.packs && t.packs.length > 0) {
                            catalogStr += 'Packs: ' + t.packs.map(function (p) {
                                return p.label + ' ($' + p.unitario.toLocaleString('es-CL') + ')';
                            }).join(', ') + '\n';
                        }
                    } catch (e) {}
                }
            });
        }

        var fullPrompt = prompt + catalogStr;
        return await sendMessage(fullPrompt, messageHistory, { maxTokens: 4096 });
    }

    // Expose on window.Mazelab
    window.Mazelab = window.Mazelab || {};
    window.Mazelab.AIService = {
        getConfig: getConfig,
        saveConfig: saveConfig,
        getDefaultPrompts: getDefaultPrompts,
        testConnection: testConnection,
        sendMessage: sendMessage,
        generateCobranza: generateCobranza,
        generateCotizacion: generateCotizacion
    };
})();
