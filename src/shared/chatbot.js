/**
 * Chatbot — floating AI assistant with platform data context
 * Uses AIService for Claude API calls.
 */
window.Mazelab = window.Mazelab || {};

(function () {
    'use strict';

    var STORAGE_KEY = 'mazelab_chatbot_history';
    var MAX_MESSAGES = 20;
    var isOpen = false;
    var isLoading = false;
    var messages = []; // {role: 'user'|'assistant', content: string}
    var contextSummary = '';

    var SYSTEM_PROMPT = 'Eres el asistente virtual de MazeLab, empresa chilena de produccion audiovisual y experiencias interactivas.\n\n' +
        'REGLAS:\n' +
        '- Responde en espanol chileno, breve y directo\n' +
        '- No uses emojis ni markdown pesado (negritas OK, no headers ni listas largas)\n' +
        '- Tienes acceso a un resumen de datos de la plataforma que se actualiza cada vez que el usuario abre el chat\n' +
        '- Puedes ayudar con: redaccion de emails, consultas sobre datos, sugerencias comerciales, calculos financieros\n' +
        '- Si no tienes datos suficientes, dilo — no inventes numeros\n' +
        '- Cuando redactes emails/mensajes de cobro, genera texto plano listo para copiar\n';

    var QUICK_ACTIONS = [
        { label: 'Resumen del mes', prompt: 'Dame un resumen ejecutivo del mes actual: ventas, cobranza, eventos proximos.' },
        { label: 'CXC vencidas', prompt: 'Cuales son las cuentas por cobrar vencidas? Necesito saber clientes, montos y dias de atraso.' },
        { label: 'Proximos eventos', prompt: 'Que eventos tengo proximos en los siguientes 7 dias? Dame cliente, fecha y servicios.' },
        { label: 'Redactar email', prompt: 'Necesito redactar un email profesional. Te dare los detalles a continuacion.' }
    ];

    // ── load/save history ────────────────────────────────────────────────
    function loadHistory() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            messages = raw ? JSON.parse(raw) : [];
            if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES);
        } catch (e) { messages = []; }
    }

    function saveHistory() {
        try {
            var toSave = messages.slice(-MAX_MESSAGES);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
        } catch (e) {}
    }

    // ── build context ────────────────────────────────────────────────────
    async function buildContext() {
        var DS = window.Mazelab.DataService;
        if (!DS) return '';

        try {
            var results = await Promise.all([
                DS.getAll('sales'),
                DS.getAll('receivables')
            ]);
            var sales = results[0] || [];
            var receivables = results[1] || [];

            var now = new Date();
            var thisYear = now.getFullYear();
            var thisMonth = now.getMonth();
            var monthKey = thisYear + '-' + String(thisMonth + 1).padStart(2, '0');

            // Sales this month / this year
            var monthSales = 0, monthCount = 0, yearSales = 0, yearCount = 0;
            var upcoming7 = [];
            var in7Days = new Date(now.getTime() + 7 * 86400000);

            sales.forEach(function (s) {
                var amt = Number(s.amount || 0);
                var ed = s.eventDate || s.closingDate || '';
                if (ed.substring(0, 7) === monthKey) { monthSales += amt; monthCount++; }
                var d = new Date(ed);
                if (d.getFullYear() === thisYear) { yearSales += amt; yearCount++; }
                // Upcoming
                if (d >= now && d <= in7Days) {
                    upcoming7.push({
                        client: s.clientName || 'Sin cliente',
                        date: ed.substring(0, 10),
                        services: s.serviceNames || '',
                        amount: amt
                    });
                }
            });

            // CXC
            var totalPendiente = 0, totalVencido = 0, vencidaList = [];
            receivables.forEach(function (r) {
                if (r.status === 'pagada' || r.status === 'pagado' || r.status === 'anulada') return;
                if ((r.tipoDoc || '').toUpperCase() === 'NC') return;
                var neto = Number(r.montoFacturado || r.montoNeto || r.invoicedAmount || r.amount || 0);
                var total = neto > 0 ? Math.round(neto * 1.19) : 0;
                var pagado = 0;
                if (r.payments && Array.isArray(r.payments)) {
                    pagado = r.payments.reduce(function (s, p) { return s + (Number(p.amount) || 0); }, 0);
                }
                var pendiente = Math.max(0, total - pagado);
                totalPendiente += pendiente;

                var baseStr = r.billingMonth || r.eventDate;
                var base = new Date(baseStr);
                if (!isNaN(base.getTime())) {
                    var diff = Math.floor((now - base) / 86400000);
                    var terms = Number(r.paymentTerms) || 30;
                    if (diff - terms > 0) {
                        totalVencido += pendiente;
                        vencidaList.push({
                            client: r.clientName || 'Sin cliente',
                            amount: pendiente,
                            days: diff - terms,
                            doc: (r.tipoDoc || '') + (r.numDoc ? ' #' + r.numDoc : '')
                        });
                    }
                }
            });

            vencidaList.sort(function (a, b) { return b.days - a.days; });

            var ctx = '--- DATOS DE LA PLATAFORMA (actualizado ahora) ---\n';
            ctx += 'Fecha actual: ' + now.toLocaleDateString('es-CL') + '\n\n';
            ctx += 'VENTAS:\n';
            ctx += '- Este mes: ' + monthCount + ' ventas por $' + Math.round(monthSales / 1000000) + 'M\n';
            ctx += '- Este ano (' + thisYear + '): ' + yearCount + ' ventas por $' + Math.round(yearSales / 1000000) + 'M\n\n';

            if (upcoming7.length > 0) {
                ctx += 'EVENTOS PROXIMOS (7 dias):\n';
                upcoming7.forEach(function (e) {
                    ctx += '- ' + e.date + ' | ' + e.client + ' | ' + (e.services || 'sin servicio') + ' | $' + Math.round(e.amount / 1000) + 'K\n';
                });
                ctx += '\n';
            }

            ctx += 'COBRANZA (CXC):\n';
            ctx += '- Total pendiente: $' + Math.round(totalPendiente / 1000000) + 'M\n';
            ctx += '- Total vencido: $' + Math.round(totalVencido / 1000000) + 'M\n';
            if (vencidaList.length > 0) {
                ctx += '- Top vencidas:\n';
                vencidaList.slice(0, 5).forEach(function (v) {
                    ctx += '  ' + v.client + ' | $' + Math.round(v.amount / 1000) + 'K | ' + v.days + ' dias | ' + v.doc + '\n';
                });
            }
            ctx += '---\n';

            return ctx;
        } catch (e) {
            console.warn('Chatbot: context build failed', e);
            return '';
        }
    }

    // ── UI ────────────────────────────────────────────────────────────────
    function injectUI() {
        if (document.getElementById('chatbot-fab')) return;

        // FAB button
        var fab = document.createElement('button');
        fab.id = 'chatbot-fab';
        fab.className = 'chatbot-fab';
        fab.setAttribute('type', 'button');
        fab.setAttribute('title', 'Asistente IA');
        fab.innerHTML = '<span style="font-size:24px;">&#9993;</span>';
        document.body.appendChild(fab);

        // Chat panel
        var panel = document.createElement('div');
        panel.id = 'chatbot-panel';
        panel.className = 'chatbot-panel';
        panel.innerHTML =
            '<div class="chatbot-header">' +
                '<div style="display:flex;align-items:center;gap:8px;">' +
                    '<span style="font-size:16px;">&#9993;</span>' +
                    '<span style="font-weight:600;font-size:14px;">Asistente MazeLab</span>' +
                '</div>' +
                '<div style="display:flex;gap:4px;">' +
                    '<button type="button" id="chatbot-clear" class="chatbot-header-btn" title="Nueva conversacion">&#8635;</button>' +
                    '<button type="button" id="chatbot-close" class="chatbot-header-btn" title="Cerrar">&times;</button>' +
                '</div>' +
            '</div>' +
            '<div id="chatbot-messages" class="chatbot-messages"></div>' +
            '<div id="chatbot-quick-actions" class="chatbot-quick-actions"></div>' +
            '<div class="chatbot-input-area">' +
                '<textarea id="chatbot-input" class="chatbot-input" rows="1" placeholder="Escribe tu mensaje..."></textarea>' +
                '<button type="button" id="chatbot-send" class="chatbot-send-btn" title="Enviar">&#10148;</button>' +
            '</div>';
        document.body.appendChild(panel);

        // Event bindings
        fab.addEventListener('click', toggle);
        document.getElementById('chatbot-close').addEventListener('click', close);
        document.getElementById('chatbot-clear').addEventListener('click', clearChat);
        document.getElementById('chatbot-send').addEventListener('click', sendUserMessage);

        var input = document.getElementById('chatbot-input');
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendUserMessage();
            }
        });
        // Auto-resize
        input.addEventListener('input', function () {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        });

        renderQuickActions();
    }

    function renderQuickActions() {
        var container = document.getElementById('chatbot-quick-actions');
        if (!container) return;
        if (messages.length > 0) { container.style.display = 'none'; return; }
        container.style.display = '';
        container.innerHTML = QUICK_ACTIONS.map(function (qa) {
            return '<button type="button" class="chatbot-qa-btn">' + qa.label + '</button>';
        }).join('');
        container.querySelectorAll('.chatbot-qa-btn').forEach(function (btn, i) {
            btn.addEventListener('click', function () {
                var input = document.getElementById('chatbot-input');
                if (input) input.value = QUICK_ACTIONS[i].prompt;
                sendUserMessage();
            });
        });
    }

    function renderMessages() {
        var container = document.getElementById('chatbot-messages');
        if (!container) return;

        if (messages.length === 0) {
            container.innerHTML = '<div class="chatbot-welcome">' +
                '<p style="font-size:14px;font-weight:600;margin-bottom:8px;">Hola, soy el asistente de MazeLab</p>' +
                '<p style="font-size:12px;color:var(--text-secondary);">Puedo ayudarte con consultas, redaccion de emails, analisis de datos y mas.</p>' +
            '</div>';
            return;
        }

        container.innerHTML = messages.map(function (m) {
            var cls = m.role === 'user' ? 'chatbot-msg-user' : 'chatbot-msg-assistant';
            return '<div class="' + cls + '">' + formatMessageContent(m.content) + '</div>';
        }).join('');

        if (isLoading) {
            container.innerHTML += '<div class="chatbot-msg-assistant chatbot-typing"><span></span><span></span><span></span></div>';
        }

        container.scrollTop = container.scrollHeight;
    }

    function formatMessageContent(text) {
        // Basic formatting: escape HTML, convert newlines, bold
        var safe = String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');
        return safe;
    }

    // ── send message ─────────────────────────────────────────────────────
    async function sendUserMessage() {
        var input = document.getElementById('chatbot-input');
        if (!input) return;
        var text = input.value.trim();
        if (!text || isLoading) return;

        input.value = '';
        input.style.height = 'auto';

        messages.push({ role: 'user', content: text });
        isLoading = true;
        renderMessages();
        renderQuickActions();

        try {
            var AI = window.Mazelab.AIService;
            if (!AI) throw new Error('AIService no disponible.');

            // Build system prompt with context
            var fullSystem = SYSTEM_PROMPT + '\n\n' + contextSummary;

            var response = await AI.sendMessage(fullSystem, messages.slice(-MAX_MESSAGES), { maxTokens: 2048 });
            messages.push({ role: 'assistant', content: response });
        } catch (err) {
            var errMsg = err.message || 'Error desconocido';
            if (errMsg.indexOf('API Key') !== -1) {
                errMsg += ' Ve a Configurar > Inteligencia Artificial para configurarla.';
            }
            messages.push({ role: 'assistant', content: 'Error: ' + errMsg });
        }

        isLoading = false;
        renderMessages();
        saveHistory();
    }

    // ── open/close ───────────────────────────────────────────────────────
    async function open() {
        var panel = document.getElementById('chatbot-panel');
        var fab = document.getElementById('chatbot-fab');
        if (panel) panel.classList.add('open');
        if (fab) fab.classList.add('hidden');
        isOpen = true;

        // Refresh context
        contextSummary = await buildContext();
        renderMessages();

        var input = document.getElementById('chatbot-input');
        if (input) input.focus();
    }

    function close() {
        var panel = document.getElementById('chatbot-panel');
        var fab = document.getElementById('chatbot-fab');
        if (panel) panel.classList.remove('open');
        if (fab) fab.classList.remove('hidden');
        isOpen = false;
    }

    function toggle() {
        if (isOpen) close(); else open();
    }

    function clearChat() {
        messages = [];
        saveHistory();
        renderMessages();
        renderQuickActions();
    }

    // ── init ─────────────────────────────────────────────────────────────
    function init() {
        loadHistory();
        injectUI();
        renderMessages();
    }

    window.Mazelab.Chatbot = {
        init: init,
        open: open,
        close: close,
        toggle: toggle
    };
})();
