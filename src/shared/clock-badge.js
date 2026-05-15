/**
 * src/shared/clock-badge.js — visual canary del horario local del ERP.
 *
 * Idea del owner: mostrar arriba a la derecha la FECHA y HORA que el ERP
 * usa internamente como "ahora" (via window.MazelabDates). Si el badge
 * coincide con el reloj real del usuario, toda la logica de timezone esta
 * bien por definicion (porque usa la misma fuente que el resto del codigo).
 *
 * Sirve de smoke test visual permanente: 1 mirada al badge confirma que
 * los fixes de B-002 funcionan sin tener que ejecutar suite de tests.
 */
(function () {
    'use strict';

    function getNowLocalHHMMSS() {
        var d = new Date();
        var hh = String(d.getHours()).padStart(2, '0');
        var mm = String(d.getMinutes()).padStart(2, '0');
        var ss = String(d.getSeconds()).padStart(2, '0');
        return hh + ':' + mm + ':' + ss;
    }

    function mountBadge() {
        if (document.getElementById('mzlab-clock-badge')) return;

        var badge = document.createElement('div');
        badge.id = 'mzlab-clock-badge';
        badge.title = 'Fuente: window.MazelabDates.getTodayLocalStr() — la misma que el ERP usa para clasificar eventos. Si esta hora coincide con tu reloj, el timezone esta OK.';
        badge.style.cssText = [
            'position: fixed',
            'top: 12px',
            'right: 12px',
            'z-index: 9999',
            'background: rgba(15, 23, 42, 0.92)',
            'color: #d9f99d',
            'font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            'font-size: 11px',
            'line-height: 1.4',
            'padding: 6px 10px',
            'border-radius: 6px',
            'border: 1px solid rgba(217, 249, 157, 0.25)',
            'box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25)',
            'pointer-events: auto',
            'user-select: none',
            'opacity: 0.85',
        ].join(';');

        badge.innerHTML = '<div id="mzlab-clock-date" style="font-weight:600"></div>' +
                          '<div id="mzlab-clock-time" style="font-size:13px;letter-spacing:1px"></div>';
        document.body.appendChild(badge);

        var $date = document.getElementById('mzlab-clock-date');
        var $time = document.getElementById('mzlab-clock-time');

        function tick() {
            // CLAVE: la fecha usa el MISMO helper que el resto del codigo del ERP.
            // Si esta linea muestra el dia correcto, todos los modulos que usan
            // MazelabDates.getTodayLocalStr() tambien lo hacen.
            if (window.MazelabDates && typeof window.MazelabDates.getTodayLocalStr === 'function') {
                $date.textContent = window.MazelabDates.getTodayLocalStr();
            } else {
                $date.textContent = '(MazelabDates no cargado)';
                $date.style.color = '#fda4af';
            }
            $time.textContent = getNowLocalHHMMSS();
        }

        tick();
        setInterval(tick, 1000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mountBadge);
    } else {
        mountBadge();
    }
})();
