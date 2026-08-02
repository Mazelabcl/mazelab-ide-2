// Auth UI — Sprint M1, Lote M1-B: pantalla de login sobre Supabase Auth.
// El formulario de registro se retira (auto-registro cerrado — Auth.register()
// lanza explícitamente). Se agrega "¿Olvidaste tu contraseña?" (self-service,
// vía Auth.requestPasswordReset).
window.Mazelab = window.Mazelab || {};

(function () {

    function renderLoginScreen() {
        return '<div id="login-screen" style="position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:var(--bg-primary);font-family:Inter,system-ui,sans-serif;">' +
            '<div style="width:100%;max-width:400px;padding:2.5rem;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:16px;backdrop-filter:blur(20px);">' +
                '<div style="text-align:center;margin-bottom:2rem;">' +
                    '<h1 style="font-size:1.8rem;font-weight:800;letter-spacing:0.08em;color:var(--text-primary);margin:0;">MAZELAB</h1>' +
                    '<p style="color:var(--text-secondary);font-size:0.85rem;margin:0.3rem 0 0;">Internal OS</p>' +
                '</div>' +
                '<div id="login-error" style="display:none;background:rgba(231,76,60,0.15);color:var(--danger);padding:8px 12px;border-radius:8px;font-size:13px;margin-bottom:12px;"></div>' +
                '<form id="login-form">' +
                    '<div style="margin-bottom:12px;">' +
                        '<label style="display:block;font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em;">Email</label>' +
                        '<input type="email" id="login-email" class="form-control" placeholder="tu@email.cl" required style="width:100%;box-sizing:border-box;">' +
                    '</div>' +
                    '<div style="margin-bottom:16px;">' +
                        '<label style="display:block;font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em;">Contrasena</label>' +
                        '<input type="password" id="login-password" class="form-control" placeholder="Tu contraseña" required style="width:100%;box-sizing:border-box;">' +
                    '</div>' +
                    '<button type="submit" id="login-submit" class="btn btn-primary" style="width:100%;padding:10px;font-size:14px;font-weight:600;">Iniciar sesion</button>' +
                '</form>' +
                '<div style="text-align:center;margin-top:16px;">' +
                    '<span id="login-forgot" style="color:var(--accent-primary);cursor:pointer;font-size:13px;">Olvidaste tu contrasena?</span>' +
                '</div>' +
            '</div>' +
        '</div>';
    }

    function show() {
        // Insert login screen
        var existing = document.getElementById('login-screen');
        if (existing) existing.remove();

        document.body.insertAdjacentHTML('afterbegin', renderLoginScreen());

        // Hide app
        var appContainer = document.querySelector('.app-container');
        if (appContainer) appContainer.style.display = 'none';

        var form = document.getElementById('login-form');
        var forgotLink = document.getElementById('login-forgot');
        var submitBtn = document.getElementById('login-submit');
        var errorEl = document.getElementById('login-error');

        forgotLink.addEventListener('click', async function () {
            var emailInput = document.getElementById('login-email');
            var email = (emailInput && emailInput.value ? emailInput.value : '').trim();
            if (!email && typeof window.prompt === 'function') {
                email = (window.prompt('Ingresa tu email para enviarte el link de restablecimiento:') || '').trim();
            }
            if (!email) return;

            errorEl.style.display = 'none';
            try {
                await window.Mazelab.Auth.requestPasswordReset(email);
                if (typeof window.alert === 'function') {
                    window.alert('Si el correo existe, te enviamos un link para restablecer tu contrasena.');
                }
            } catch (err) {
                errorEl.textContent = err.message || 'No se pudo enviar el correo.';
                errorEl.style.display = 'block';
            }
        });

        form.addEventListener('submit', async function (e) {
            e.preventDefault();
            var email = document.getElementById('login-email').value.trim();
            var password = document.getElementById('login-password').value;

            errorEl.style.display = 'none';
            submitBtn.disabled = true;
            submitBtn.textContent = 'Ingresando...';

            try {
                var Auth = window.Mazelab.Auth;
                await Auth.login(email, password);

                // Success — show app
                var loginScreen = document.getElementById('login-screen');
                if (loginScreen) loginScreen.remove();
                var appC = document.querySelector('.app-container');
                if (appC) appC.style.display = '';

                // Initialize the app — Auth.login() ya dejó el cache de Auth
                // (getUser/isLoggedIn/canAccess) poblado de forma síncrona
                // ANTES de resolver, así que initApp() puede leerlo de inmediato.
                if (window.Mazelab.initApp) {
                    await window.Mazelab.initApp();
                }
            } catch (err) {
                errorEl.textContent = err.message || 'Error desconocido';
                errorEl.style.display = 'block';
                submitBtn.disabled = false;
                submitBtn.textContent = 'Iniciar sesion';
            }
        });

        // Focus email input
        setTimeout(function () {
            var emailInput = document.getElementById('login-email');
            if (emailInput) emailInput.focus();
        }, 100);
    }

    function hide() {
        var loginScreen = document.getElementById('login-screen');
        if (loginScreen) loginScreen.remove();
        var appContainer = document.querySelector('.app-container');
        if (appContainer) appContainer.style.display = '';
    }

    window.Mazelab.AuthUI = {
        show: show,
        hide: hide
    };
})();
