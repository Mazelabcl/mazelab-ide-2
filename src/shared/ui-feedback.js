// Feedback visual compartido: toast de éxito/error + banners de sin conexión / modo prueba.
// Generaliza el toast privado que ya existía en nominas.js.
(function () {
    window.Mazelab = window.Mazelab || {};

    function toast(message, type) {
        var el = document.createElement('div');
        var bg = type === 'error' ? 'var(--danger, #c0392b)' : 'var(--success, #27ae60)';
        el.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;background:' + bg +
            ';color:#fff;border-radius:10px;padding:14px 20px;max-width:340px;box-shadow:0 4px 20px rgba(0,0,0,.25);font-size:14px';
        el.textContent = message;
        document.body.appendChild(el);
        setTimeout(function () { el.style.transition = 'opacity .4s'; el.style.opacity = '0'; }, 3200);
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 3700);
    }

    function showOfflineBanner() {
        if (document.getElementById('mz-offline-banner')) return;
        var b = document.createElement('div');
        b.id = 'mz-offline-banner';
        b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:10000;background:var(--danger,#c0392b);color:#fff;' +
            'padding:10px 16px;text-align:center;font-size:14px;font-weight:600';
        b.textContent = 'Sin conexión con la base de datos — modo solo lectura. Los cambios NO se guardarán.';
        document.body.appendChild(b);
    }

    // Banner de modo prueba local (?localdev=1): naranja/warning, no bloqueante,
    // deja claro que los datos NO viven en producción.
    function showTestModeBanner() {
        if (document.getElementById('mz-testmode-banner')) return;
        var b = document.createElement('div');
        b.id = 'mz-testmode-banner';
        b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:10000;background:var(--warning,#e67e22);color:#fff;' +
            'padding:10px 16px;text-align:center;font-size:14px;font-weight:600';
        b.textContent = 'MODO PRUEBA LOCAL — los datos viven en este navegador, NO en producción.';
        document.body.appendChild(b);
    }

    window.Mazelab.UI = { toast: toast, showOfflineBanner: showOfflineBanner, showTestModeBanner: showTestModeBanner };
})();
