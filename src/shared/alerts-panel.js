/**
 * AlertsPanel — bell icon + badge in sidebar, slide-out panel with categorized alerts
 */
window.Mazelab = window.Mazelab || {};

(function () {
    'use strict';

    var isOpen = false;

    var CATEGORIES = [
        { key: 'traspaso', icon: '&#9888;', label: 'Traspasos pendientes', color: '#f59e0b' },
        { key: 'equipos',  icon: '&#128230;', label: 'Equipos sin asignar', color: '#f97316' },
        { key: 'cxc',      icon: '&#9830;', label: 'CXC vencidas', color: '#ef4444' },
        { key: 'contacto', icon: '&#128100;', label: 'Sin contacto de evento', color: '#8b5cf6' }
    ];

    // ── inject bell into sidebar header ──────────────────────────────────
    function injectBell() {
        var header = document.querySelector('.sidebar-header');
        if (!header || document.getElementById('alerts-bell')) return;

        var bell = document.createElement('button');
        bell.id = 'alerts-bell';
        bell.className = 'alerts-bell';
        bell.setAttribute('type', 'button');
        bell.setAttribute('title', 'Alertas');
        bell.innerHTML = '<span class="alerts-bell-icon">&#128276;</span><span id="alerts-badge" class="alerts-badge" style="display:none">0</span>';
        header.style.position = 'relative';
        header.appendChild(bell);

        bell.addEventListener('click', function (e) {
            e.stopPropagation();
            toggle();
        });
    }

    // ── inject panel ─────────────────────────────────────────────────────
    function injectPanel() {
        if (document.getElementById('alerts-panel')) return;

        var panel = document.createElement('div');
        panel.id = 'alerts-panel';
        panel.className = 'alerts-panel';
        panel.innerHTML =
            '<div class="alerts-panel-header">' +
                '<h3>Alertas</h3>' +
                '<button type="button" id="alerts-panel-close" class="alerts-panel-close">&times;</button>' +
            '</div>' +
            '<div id="alerts-panel-body" class="alerts-panel-body"></div>';
        document.body.appendChild(panel);

        // Backdrop
        var backdrop = document.createElement('div');
        backdrop.id = 'alerts-backdrop';
        backdrop.className = 'alerts-backdrop';
        document.body.appendChild(backdrop);

        document.getElementById('alerts-panel-close').addEventListener('click', close);
        backdrop.addEventListener('click', close);
    }

    // ── render alerts ────────────────────────────────────────────────────
    function renderAlerts(alerts) {
        var body = document.getElementById('alerts-panel-body');
        if (!body) return;

        if (!alerts.length) {
            body.innerHTML = '<div class="alerts-empty"><span style="font-size:32px;opacity:0.4">&#10003;</span><p>Sin alertas pendientes</p></div>';
            return;
        }

        var html = '';
        CATEGORIES.forEach(function (cat) {
            var items = alerts.filter(function (a) { return a.category === cat.key; });
            if (!items.length) return;
            html += '<div class="alerts-category">' +
                '<div class="alerts-category-header" style="border-left:3px solid ' + cat.color + '">' +
                    '<span>' + cat.icon + '</span> ' + cat.label +
                    '<span class="alerts-category-count">' + items.length + '</span>' +
                '</div>';
            items.forEach(function (a) {
                var sev = a.severity === 'danger' ? 'badge-danger' : a.severity === 'warning' ? 'badge-warning' : 'badge-info';
                html += '<div class="alerts-item" data-route="' + (a.route || '') + '" data-id="' + (a.saleId || a.receivableId || '') + '">' +
                    '<div class="alerts-item-top">' +
                        '<strong>' + (a.title || '') + '</strong>' +
                        '<span class="badge ' + sev + '" style="font-size:10px">' + (a.date || '') + '</span>' +
                    '</div>' +
                    (a.subtitle ? '<div class="alerts-item-sub">' + a.subtitle + '</div>' : '') +
                    '<div class="alerts-item-detail">' + (a.detail || '') + '</div>' +
                '</div>';
            });
            html += '</div>';
        });

        body.innerHTML = html;

        // click to navigate
        body.querySelectorAll('.alerts-item[data-route]').forEach(function (el) {
            el.addEventListener('click', function () {
                var route = this.dataset.route;
                if (route && window.Mazelab.navigateTo) {
                    close();
                    window.Mazelab.navigateTo(route);
                }
            });
        });
    }

    // ── update badge ─────────────────────────────────────────────────────
    function updateBadge(count) {
        var badge = document.getElementById('alerts-badge');
        if (!badge) return;
        if (count > 0) {
            badge.textContent = count > 99 ? '99+' : String(count);
            badge.style.display = '';
        } else {
            badge.style.display = 'none';
        }
    }

    // ── open / close ─────────────────────────────────────────────────────
    function open() {
        var panel = document.getElementById('alerts-panel');
        var backdrop = document.getElementById('alerts-backdrop');
        if (panel) panel.classList.add('open');
        if (backdrop) backdrop.classList.add('open');
        isOpen = true;
    }

    function close() {
        var panel = document.getElementById('alerts-panel');
        var backdrop = document.getElementById('alerts-backdrop');
        if (panel) panel.classList.remove('open');
        if (backdrop) backdrop.classList.remove('open');
        isOpen = false;
    }

    function toggle() {
        if (isOpen) { close(); return; }
        // Refresh and open
        refresh().then(function () { open(); });
    }

    // ── refresh ──────────────────────────────────────────────────────────
    async function refresh() {
        var svc = window.Mazelab.AlertsService;
        if (!svc) return;
        var alerts = await svc.computeAlerts();
        updateBadge(alerts.length);
        renderAlerts(alerts);
    }

    // ── init ─────────────────────────────────────────────────────────────
    async function init() {
        injectBell();
        injectPanel();
        await refresh();
    }

    window.Mazelab.AlertsPanel = {
        init: init,
        refresh: refresh,
        open: open,
        close: close
    };
})();
