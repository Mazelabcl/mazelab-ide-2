// ============================================================================
// src/shared/debounce.js
//
// Helper minimo de debounce. Sin frameworks ni dependencias externas — apenas
// 10 LOC efectivas. Vibe-coder-mantenible.
//
// Uso:
//
//   var debounced = Mazelab.debounce(function () { refreshTable(); }, 300);
//   input.addEventListener('input', debounced);
//
// El handler retorna nunca antes de `ms` milisegundos desde el ultimo evento.
// Llamadas en rafaga (ej. mientras se tipea) cancelan la anterior y resetean
// el timer — la funcion subyacente solo corre una vez que el usuario para.
//
// Fix de B-007: search bars y filtros de columna del ERP recalculan KPIs
// + reconstruyen tabla + re-atachan listeners en cada keystroke. Con miles
// de CxCs eso lagea visible y pierde foco del input. Debounce 300ms en
// search-bar y 150ms en filtros de columna lo arregla.
// ============================================================================
window.Mazelab = window.Mazelab || {};
window.Mazelab.debounce = function debounce(fn, wait) {
    var timer = null;
    var ms = (typeof wait === 'number' && wait > 0) ? wait : 300;
    return function debounced() {
        var ctx = this;
        var args = arguments;
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () {
            timer = null;
            fn.apply(ctx, args);
        }, ms);
    };
};
