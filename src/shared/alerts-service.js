/**
 * AlertsService — computes in-app alerts from existing data
 * Categories: traspaso missing, equipment missing, CXC overdue, missing contact
 */
window.Mazelab = window.Mazelab || {};

(function () {
    'use strict';

    var DS = null;
    var _cache = { alerts: [], ts: 0 };
    var CACHE_TTL = 60000; // 1 minute

    function getDS() {
        if (!DS) DS = window.Mazelab.DataService;
        return DS;
    }

    // ── helpers ──────────────────────────────────────────────────────────
    function parseDate(str) {
        // B-002 fix: parsear como fecha LOCAL (no UTC). new Date("YYYY-MM-DD")
        // interpreta el string como UTC midnight; en Chile eso desplaza 1 dia.
        if (!str) return null;
        var d = window.MazelabDates.parseLocalDate(str);
        return d && !isNaN(d.getTime()) ? d : null;
    }

    function daysUntil(dateStr) {
        var d = parseDate(dateStr);
        if (!d) return Infinity;
        var now = new Date();
        now.setHours(0, 0, 0, 0);
        d.setHours(0, 0, 0, 0);
        return Math.floor((d - now) / 86400000);
    }

    function formatDate(str) {
        var d = parseDate(str);
        if (!d) return '—';
        return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });
    }

    function formatCLP(n) {
        n = Math.round(Number(n) || 0);
        if (n < 0) return '-$' + String(-n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return '$' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    }

    // ── alert builders ──────────────────────────────────────────────────

    /** Events within 7 days missing traspaso */
    function checkTraspasoMissing(sales) {
        var alerts = [];
        sales.forEach(function (s) {
            if (s.status === 'cancelada' || s.status === 'perdida') return;
            var days = daysUntil(s.eventDate);
            if (days < 0 || days > 7) return;
            var tr = s.traspaso;
            var hasTrsp = tr && (tr.contactoNombre || tr.lugar || tr.horarioServicio);
            if (!hasTrsp) {
                alerts.push({
                    category: 'traspaso',
                    severity: days <= 2 ? 'danger' : 'warning',
                    title: s.clientName || 'Sin cliente',
                    subtitle: s.eventName || s.serviceName || '',
                    detail: days === 0 ? 'HOY' : days === 1 ? 'Manana' : 'En ' + days + ' dias',
                    date: formatDate(s.eventDate),
                    saleId: s.id,
                    route: 'sales'
                });
            }
        });
        return alerts.sort(function (a, b) {
            return (a.severity === 'danger' ? 0 : 1) - (b.severity === 'danger' ? 0 : 1);
        });
    }

    /** Events missing equipment assignment */
    function checkEquipmentMissing(sales) {
        var alerts = [];
        sales.forEach(function (s) {
            if (s.status === 'cancelada' || s.status === 'perdida') return;
            var days = daysUntil(s.eventDate);
            if (days < 0 || days > 7) return;
            var eq = s.equiposAsignados;
            var hasEq = eq && ((Array.isArray(eq) && eq.length > 0) || (typeof eq === 'string' && eq.trim()));
            if (!hasEq) {
                alerts.push({
                    category: 'equipos',
                    severity: days <= 2 ? 'danger' : 'warning',
                    title: s.clientName || 'Sin cliente',
                    subtitle: s.eventName || s.serviceName || '',
                    detail: days === 0 ? 'HOY — sin equipos' : 'En ' + days + ' dias — sin equipos',
                    date: formatDate(s.eventDate),
                    saleId: s.id,
                    route: 'kanban'
                });
            }
        });
        return alerts;
    }

    /** CXC overdue invoices */
    function checkOverdueReceivables(receivables) {
        var alerts = [];
        // Need finance module's getRealTimeStatus — replicate key logic
        receivables.forEach(function (r) {
            if (r.tipoDoc === 'NC') return;
            if (r.status === 'anulada' || r.status === 'pagado' || r.status === 'pagada') return;
            // Check if overdue by billing/event date
            var baseStr = r.billingMonth || r.eventDate;
            var base = parseDate(baseStr);
            if (!base) return;
            var diffDays = Math.floor((new Date() - base) / 86400000);
            var terms = Number(r.paymentTerms) || 30;
            var overdue = diffDays - terms;
            if (overdue <= 0) return;

            var monto = Number(r.montoFacturado || r.amount || 0);
            var label = overdue > 90 ? '+90 dias' : overdue > 60 ? '+60 dias' : overdue > 30 ? '+30 dias' : overdue + ' dias';
            alerts.push({
                category: 'cxc',
                severity: overdue > 60 ? 'danger' : 'warning',
                title: r.clientName || 'Sin cliente',
                subtitle: (r.tipoDoc || '') + (r.numDoc ? ' #' + r.numDoc : ''),
                detail: 'Vencida ' + label + ' — ' + formatCLP(monto * 1.19),
                date: formatDate(baseStr),
                receivableId: r.id,
                route: 'finance'
            });
        });
        return alerts.sort(function (a, b) {
            return (a.severity === 'danger' ? 0 : 1) - (b.severity === 'danger' ? 0 : 1);
        });
    }

    /** Sales without contact info */
    function checkMissingContact(sales) {
        var alerts = [];
        sales.forEach(function (s) {
            if (s.status === 'cancelada' || s.status === 'perdida') return;
            var days = daysUntil(s.eventDate);
            if (days < 0 || days > 14) return; // upcoming 14 days
            var tr = s.traspaso;
            var hasContact = tr && (tr.contactoNombre || tr.contactoTel || tr.contactoEmail);
            if (!hasContact) {
                alerts.push({
                    category: 'contacto',
                    severity: 'info',
                    title: s.clientName || 'Sin cliente',
                    subtitle: s.eventName || '',
                    detail: 'Sin contacto de evento',
                    date: formatDate(s.eventDate),
                    saleId: s.id,
                    route: 'sales'
                });
            }
        });
        return alerts;
    }

    // ── main compute ────────────────────────────────────────────────────

    async function computeAlerts() {
        var now = Date.now();
        if (_cache.alerts.length && (now - _cache.ts) < CACHE_TTL) {
            return _cache.alerts;
        }

        var ds = getDS();
        if (!ds) return [];

        var results = await Promise.all([
            ds.getAll('sales'),
            ds.getAll('receivables')
        ]);
        var sales = results[0] || [];
        var receivables = results[1] || [];

        var all = []
            .concat(checkTraspasoMissing(sales))
            .concat(checkEquipmentMissing(sales))
            .concat(checkOverdueReceivables(receivables))
            .concat(checkMissingContact(sales));

        _cache = { alerts: all, ts: Date.now() };
        return all;
    }

    function getCount() {
        return _cache.alerts.length;
    }

    function getByCategory(cat) {
        return _cache.alerts.filter(function (a) { return a.category === cat; });
    }

    function invalidate() {
        _cache.ts = 0;
    }

    // ── public API ──────────────────────────────────────────────────────
    window.Mazelab.AlertsService = {
        computeAlerts: computeAlerts,
        getCount: getCount,
        getByCategory: getByCategory,
        invalidate: invalidate
    };
})();
