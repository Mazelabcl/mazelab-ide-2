// Auth UI — Login/Register screen
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
                    '<div id="login-name-group" style="display:none;margin-bottom:12px;">' +
                        '<label style="display:block;font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em;">Nombre</label>' +
                        '<input type="text" id="login-name" class="form-control" placeholder="Tu nombre" style="width:100%;box-sizing:border-box;">' +
                    '</div>' +
                    '<div style="margin-bottom:12px;">' +
                        '<label style="display:block;font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em;">Email</label>' +
                        '<input type="email" id="login-email" class="form-control" placeholder="tu@email.cl" required style="width:100%;box-sizing:border-box;">' +
                    '</div>' +
                    '<div style="margin-bottom:16px;">' +
                        '<label style="display:block;font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em;">Contrasena</label>' +
                        '<input type="password" id="login-password" class="form-control" placeholder="Min. 6 caracteres" required style="width:100%;box-sizing:border-box;">' +
                    '</div>' +
                    '<button type="submit" id="login-submit" class="btn btn-primary" style="width:100%;padding:10px;font-size:14px;font-weight:600;">Iniciar sesion</button>' +
                '</form>' +
                '<div style="text-align:center;margin-top:16px;">' +
                    '<span id="login-toggle" style="color:var(--accent-primary);cursor:pointer;font-size:13px;">No tienes cuenta? Registrate</span>' +
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

        var isRegister = false;
        var form = document.getElementById('login-form');
        var toggle = document.getElementById('login-toggle');
        var nameGroup = document.getElementById('login-name-group');
        var submitBtn = document.getElementById('login-submit');
        var errorEl = document.getElementById('login-error');

        toggle.addEventListener('click', function () {
            isRegister = !isRegister;
            nameGroup.style.display = isRegister ? 'block' : 'none';
            submitBtn.textContent = isRegister ? 'Crear cuenta' : 'Iniciar sesion';
            toggle.textContent = isRegister ? 'Ya tienes cuenta? Inicia sesion' : 'No tienes cuenta? Registrate';
            errorEl.style.display = 'none';
        });

        form.addEventListener('submit', async function (e) {
            e.preventDefault();
            var email = document.getElementById('login-email').value.trim();
            var password = document.getElementById('login-password').value;
            var name = document.getElementById('login-name').value.trim();

            errorEl.style.display = 'none';
            submitBtn.disabled = true;
            submitBtn.textContent = isRegister ? 'Creando cuenta...' : 'Ingresando...';

            try {
                var Auth = window.Mazelab.Auth;
                if (isRegister) {
                    await Auth.register(email, password, name);
                } else {
                    await Auth.login(email, password);
                }

                // Success — show app
                var loginScreen = document.getElementById('login-screen');
                if (loginScreen) loginScreen.remove();
                var appC = document.querySelector('.app-container');
                if (appC) appC.style.display = '';

                // Initialize the app
                if (window.Mazelab.initApp) {
                    await window.Mazelab.initApp();
                }
            } catch (err) {
                errorEl.textContent = err.message || 'Error desconocido';
                errorEl.style.display = 'block';
                submitBtn.disabled = false;
                submitBtn.textContent = isRegister ? 'Crear cuenta' : 'Iniciar sesion';
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
