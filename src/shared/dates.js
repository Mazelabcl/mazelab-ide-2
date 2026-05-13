/**
 * src/shared/dates.js — helpers de fecha local unificados
 *
 * Fix B-002: el ERP usa fechas en formato "YYYY-MM-DD" como strings.
 * El bug viene de `new Date("2026-05-13")` y `toISOString().slice(0, 10)`,
 * que interpretan/devuelven valores en UTC. En Chile (UTC-3/-4) eso desplaza
 * 1 día al cruzar medianoche UTC (21:00 hora local en horario de verano).
 *
 * Estos helpers garantizan parseo y formateo en horario LOCAL del browser.
 * Sin dependencias externas, compatible con código vanilla del ERP (IIFE
 * pattern + window.MazelabDates global).
 */
(function () {
    'use strict';

    /**
     * Parsea "YYYY-MM-DD" (o "YYYY-MM-DDTHH:mm:ss") como fecha LOCAL.
     * Reemplazo de las 6 copias de parseLocalDate en cashflow/dashboard/
     * finance/kanban/nominas/payables (todas idénticas).
     *
     * @param {string|null|undefined} str
     * @returns {Date|null}
     */
    function parseLocalDate(str) {
        if (!str) return null;
        var parts = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (parts) return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
        return new Date(str);
    }

    /**
     * Devuelve la fecha de HOY como "YYYY-MM-DD" en horario LOCAL.
     * Reemplazo del bug `new Date().toISOString().slice(0, 10)` que devuelve UTC.
     *
     * @returns {string} "YYYY-MM-DD"
     */
    function getTodayLocalStr() {
        var d = new Date();
        var y = d.getFullYear();
        var m = String(d.getMonth() + 1).padStart(2, '0');
        var dd = String(d.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + dd;
    }

    /**
     * Formatea Date como "YYYY-MM-DD" en horario LOCAL.
     *
     * @param {Date|null|undefined} date
     * @returns {string}
     */
    function formatLocalDate(date) {
        if (!date || isNaN(date)) return '';
        var y = date.getFullYear();
        var m = String(date.getMonth() + 1).padStart(2, '0');
        var d = String(date.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + d;
    }

    /**
     * Devuelve el mes actual como "YYYY-MM" en horario LOCAL.
     *
     * @returns {string}
     */
    function getCurrentMonthKey() {
        return getTodayLocalStr().slice(0, 7);
    }

    window.MazelabDates = {
        parseLocalDate: parseLocalDate,
        getTodayLocalStr: getTodayLocalStr,
        formatLocalDate: formatLocalDate,
        getCurrentMonthKey: getCurrentMonthKey,
    };
})();
