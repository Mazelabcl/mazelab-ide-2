// Matemática de dinero de MazeLab OS — fuente única de verdad.
// Reglas de negocio: docs/superpowers/specs/2026-07-26-sprint1-detener-sangrado-design.md
// Funciona en browser (window.Mazelab.Money) y en Node (module.exports) para tests.
(function (root, factory) {
    var api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) {
        root.Mazelab = root.Mazelab || {};
        root.Mazelab.Money = api;
    }
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    var IVA = 1.19;

    // Tabla SII Ley 21.133 — tasa de retención BH por año de emisión
    var BH_RATES = { 2022: 0.1225, 2023: 0.13, 2024: 0.1375, 2025: 0.145, 2026: 0.1525, 2027: 0.16 };

    function bhRetentionRate(dateStr) {
        // El año se extrae por regex antes de recurrir a Date: evita el corrimiento
        // de año por timezone en fechas ISO date-only ("2026-01-01" parsea medianoche
        // UTC → 2025 en Chile) y soporta formatos chilenos ("15-03-2024", "03/2025").
        var year = NaN;
        if (dateStr) {
            var s = String(dateStr);
            var m = s.match(/^(\d{4})/) || s.match(/(\d{4})$/);
            if (m) year = Number(m[1]);
            else year = new Date(s).getFullYear();
        }
        if (!year || isNaN(year)) year = new Date().getFullYear();
        if (year <= 2022) return 0.1225;
        if (year >= 2028) return 0.17;
        return BH_RATES[year];
    }

    // El monto ingresado de una BH es el LÍQUIDO a transferir.
    // Retención = líquido × tasa/(1−tasa); costo empresa = líquido + retención.
    function bhRetencion(liquido, dateStr) {
        var rate = bhRetentionRate(dateStr);
        return Math.round((Number(liquido) || 0) * rate / (1 - rate));
    }

    function bhCostoEmpresa(liquido, dateStr) {
        return (Number(liquido) || 0) + bhRetencion(liquido, dateStr);
    }

    // El monto ingresado de una factura de proveedor es el TOTAL con IVA.
    function facturaNeto(totalConIva) {
        return Math.round((Number(totalConIva) || 0) / IVA);
    }

    function ivaCredito(totalConIva) {
        var total = Number(totalConIva) || 0;
        return total - facturaNeto(total);
    }

    // Costo real para la empresa de un ítem de CXP (para utilidad de comisiones):
    // BH → bruto; factura → neto (el IVA es crédito); resto → tal cual.
    function costoEmpresaItem(docType, amount, dateStr) {
        var dt = String(docType || '').toLowerCase();
        var amt = Number(amount) || 0;
        if (dt === 'bh') return bhCostoEmpresa(amt, dateStr);
        if (dt === 'factura') return facturaNeto(amt);
        return amt;
    }

    // Parser de montos chilenos: punto = miles, coma = decimal.
    function parseAmountCL(val) {
        if (val === null || val === undefined) return 0;
        if (typeof val === 'number') return isFinite(val) ? val : 0;
        var str = String(val).replace(/[$\s]/g, '');
        if (!str || str === '.') return 0;
        if (str.indexOf('#') !== -1 || str.indexOf('REF') !== -1) return 0;
        var neg = /^-/.test(str);
        if (neg) str = str.slice(1);
        var commaCount = (str.match(/,/g) || []).length;
        var dotCount = (str.match(/\./g) || []).length;
        if (commaCount > 1) {
            str = str.replace(/,/g, '');
        } else if (dotCount > 1) {
            // Varios puntos = miles; si queda exactamente una coma, es el decimal
            str = str.replace(/\./g, '');
            if ((str.match(/,/g) || []).length === 1) str = str.replace(',', '.');
        } else if (commaCount === 1 && dotCount === 1) {
            if (str.lastIndexOf(',') > str.lastIndexOf('.')) str = str.replace(/\./g, '').replace(',', '.');
            else str = str.replace(/,/g, '');
        } else if (commaCount === 1) {
            var afterComma = str.split(',')[1];
            if (afterComma && afterComma.length === 3) str = str.replace(',', '');
            else str = str.replace(',', '.');
        } else if (dotCount === 1) {
            var afterDot = str.split('.')[1];
            if (afterDot && afterDot.length === 3) str = str.replace('.', '');
            // 1-2 dígitos tras el punto → decimal, se deja igual
        }
        var n = Number(str) || 0;
        return neg ? -n : n;
    }

    // Regla del día 20: el IVA de una factura emitida en (year, month 1-12)
    // se paga el 20 del mes siguiente. Es "del negocio" recién DESDE el 21.
    function ivaDeclarado(year, month1to12, today) {
        var m = Number(month1to12) + 1, y = Number(year);
        if (m > 12) { m = 1; y++; }
        var cutoff = new Date(y, m - 1, 20, 23, 59, 59, 999);
        return (today || new Date()).getTime() > cutoff.getTime();
    }

    // ---- CXC por fila. Separación de libros:
    // filas FACTURADAS descuentan solo NC (nunca incidencia);
    // filas SIN FACTURA descuentan solo incidencia (refund).
    // Montos neto; pagado viene con IVA en facturas tipo F.
    function pendienteFacturadoRow(o) {
        var facturado = Number(o.facturadoNeto) || 0;
        var nc = Number(o.ncNeto) || 0;
        var pagado = Number(o.pagado) || 0;
        var base = Math.max(0, facturado - nc);
        if (o.tipoDoc === 'E') return Math.max(0, base - pagado);
        return Math.max(0, Math.round(base * IVA) - pagado);
    }

    function pendienteSinFacturaRow(o) {
        var neto = Number(o.neto) || 0;
        var refund = Number(o.refundNeto) || 0;
        var pagado = Number(o.pagado) || 0;
        return Math.max(0, neto - refund - pagado);
    }

    // "Lo que es mío" por fila (solo CXC):
    // sin factura → neto − incidencia − pagado
    // facturada + IVA no declarado → solo neto (el IVA se le debe al SII)
    // facturada + IVA declarado → total con IVA (ese IVA ya salió del bolsillo)
    function mioRow(o) {
        if (o.tipoDoc === 'NC') return 0;
        var pagado = Number(o.pagado) || 0;
        if (o.tipoDoc === 'E') {
            // Exenta facturada: descuenta NC igual que pendienteFacturadoRow, sin IVA
            if (o.tieneFactura) {
                var baseE = Math.max(0, (Number(o.facturadoNeto) || 0) - (Number(o.ncNeto) || 0));
                return Math.max(0, baseE - pagado);
            }
            return Math.max(0, (Number(o.neto) || 0) - (Number(o.refundNeto) || 0) - pagado);
        }
        if (!o.tieneFactura) {
            return Math.max(0, (Number(o.neto) || 0) - (Number(o.refundNeto) || 0) - pagado);
        }
        var baseNeto = Math.max(0, (Number(o.facturadoNeto) || 0) - (Number(o.ncNeto) || 0));
        if (o.ivaDeclarado) return Math.max(0, Math.round(baseNeto * IVA) - pagado);
        return Math.max(0, baseNeto - Math.round(pagado / IVA));
    }

    // Comisión = % × utilidad × proporción cobrada (neto/neto), redondeada.
    function comisionDevengada(pct, utilidad, cobradoNeto, ventaNeta) {
        var p = Number(pct) || 0;
        var vn = Number(ventaNeta) || 0;
        if (p <= 0 || vn <= 0) return 0;
        var prop = Math.max(0, Math.min(1, (Number(cobradoNeto) || 0) / vn));
        return Math.round((p / 100) * Math.max(0, Number(utilidad) || 0) * prop);
    }

    return {
        IVA: IVA,
        bhRetentionRate: bhRetentionRate,
        bhRetencion: bhRetencion,
        bhCostoEmpresa: bhCostoEmpresa,
        facturaNeto: facturaNeto,
        ivaCredito: ivaCredito,
        costoEmpresaItem: costoEmpresaItem,
        parseAmountCL: parseAmountCL,
        ivaDeclarado: ivaDeclarado,
        pendienteFacturadoRow: pendienteFacturadoRow,
        pendienteSinFacturaRow: pendienteSinFacturaRow,
        mioRow: mioRow,
        comisionDevengada: comisionDevengada
    };
});
