#!/usr/bin/env node
// Smoke test E2E contra el deploy real (Vercel + Supabase) — Sprint E2E,
// primera pieza del "banco de experimentos". Usa Playwright (librería
// directa, sin el runner @playwright/test) con Chromium headless, en el
// mismo estilo que el resto del repo: script Node con asserts propios y un
// resumen final "N OK, M FAIL" (ver tests/run-all.js).
//
// Uso:
//   npm run e2e:smoke
//   node tests/e2e/smoke.e2e.js
//   BASE_URL=http://localhost:5500 node tests/e2e/smoke.e2e.js
//
// Requiere .env.e2e en la raíz del repo (creado por
// scripts/provision-e2e-users.js) con al menos E2E_SUPERADMIN_PASSWORD y
// E2E_OPERACIONES_PASSWORD.
//
// Los 7 pasos (en este orden, cada uno con su propio assert):
//   1. Abre BASE_URL -> aparece la pantalla de login (NO la app).
//   2. Login con e2e-superadmin -> entra, dashboard renderiza, algún KPI
//      muestra contenido no vacío.
//   3. El logo carga (respuesta 200 de mazelab-logo.png).
//   4. Logout -> vuelve el login.
//   5. Login con e2e-operaciones -> entra, y el nav NO muestra los módulos
//      restringidos por rol (según RESTRICTED de src/shared/auth.js).
//   6. ?localdev=1 sobre BASE_URL (contexto de navegador limpio, sin sesión)
//      sigue pidiendo login — aserción de seguridad N8 (src/app.js).
//   7. Screenshot del dashboard logueado, guardado en tests/e2e/artifacts/
//      (gitignored).
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { loadEnvFile } = require('../../scripts/lib/env.js');

const REPO_ROOT = path.join(__dirname, '..', '..');
const E2E_ENV_PATH = path.join(REPO_ROOT, '.env.e2e');
const ARTIFACTS_DIR = path.join(__dirname, 'artifacts');

const BASE_URL = (process.env.BASE_URL || 'https://mazelab-ide-2.vercel.app').replace(/\/$/, '');

// Generosos a propósito: la primera carga de un deploy de Vercel en frío
// (cold start del CDN / funciones) puede tardar bastante más que un
// localhost.
const NAV_TIMEOUT = 60000;
const ACTION_TIMEOUT = 30000;

const RESTRICTED_ROUTES = ['sales', 'finance', 'payables', 'nominas', 'pagos', 'cashflow', 'analytics', 'cotizador', 'cxc-kanban', 'import'];

let pass = 0;
let fail = 0;
const failures = [];

// pageForEvidence es opcional: si se pasa, y el paso falla, se intenta un
// screenshot best-effort en tests/e2e/artifacts/ para que un fallo real
// contra el deploy quede con evidencia visual, no solo con el mensaje de
// error (best-effort porque un paso puede fallar precisamente por navegación
// rota, dejando la propia captura inutilizable — nunca debe tapar el fallo
// original).
async function step(name, pageForEvidence, fn) {
    process.stdout.write('  ' + name + ' ... ');
    try {
        await fn();
        pass++;
        console.log('OK');
    } catch (e) {
        fail++;
        failures.push({ name: name, error: e });
        console.log('FAIL');
        console.log('      ' + (e && e.message ? e.message : String(e)));
        if (pageForEvidence) {
            try {
                const slug = name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
                const evidencePath = path.join(ARTIFACTS_DIR, 'FAIL-' + slug + '.png');
                await pageForEvidence.screenshot({ path: evidencePath, fullPage: true });
                console.log('      evidencia: ' + evidencePath);
            } catch (screenshotErr) {
                console.log('      (no se pudo capturar evidencia: ' + (screenshotErr && screenshotErr.message ? screenshotErr.message : screenshotErr) + ')');
            }
        }
    }
}

async function assertLoginScreenVisibleNoApp(page) {
    await page.waitForSelector('#login-screen #login-form', { timeout: NAV_TIMEOUT });
    const appVisible = await page.evaluate(function () {
        var el = document.querySelector('.app-container');
        if (!el) return false;
        return window.getComputedStyle(el).display !== 'none';
    });
    if (appVisible) throw new Error('la app quedo visible sin login (se esperaba solo la pantalla de login)');
}

async function loginAs(page, email, password) {
    await page.fill('#login-email', email);
    await page.fill('#login-password', password);
    await page.click('#login-submit');
    await page.waitForSelector('#login-screen', { state: 'detached', timeout: NAV_TIMEOUT });
}

async function main() {
    if (!fs.existsSync(E2E_ENV_PATH)) {
        console.error('No se encontro .env.e2e en la raiz del repo. Correr primero: node scripts/provision-e2e-users.js');
        process.exit(1);
    }
    const e2eEnv = loadEnvFile(E2E_ENV_PATH);
    const superadminPassword = e2eEnv.E2E_SUPERADMIN_PASSWORD;
    const operacionesPassword = e2eEnv.E2E_OPERACIONES_PASSWORD;
    if (!superadminPassword || !operacionesPassword) {
        console.error('.env.e2e no trae E2E_SUPERADMIN_PASSWORD y/o E2E_OPERACIONES_PASSWORD. Correr: node scripts/provision-e2e-users.js');
        process.exit(1);
    }

    if (!fs.existsSync(ARTIFACTS_DIR)) fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

    console.log('=== Smoke E2E — ' + BASE_URL + ' ===\n');

    const browser = await chromium.launch({ headless: true });

    try {
        // Contexto principal — se reusa para los pasos 1-5 y 7 (necesitan
        // login/logout encadenados, misma navegación).
        const context = await browser.newContext();
        const page = await context.newPage();
        page.setDefaultTimeout(ACTION_TIMEOUT);
        page.setDefaultNavigationTimeout(NAV_TIMEOUT);

        const logoResponses = [];
        page.on('response', function (res) {
            if (/mazelab-logo\.png/.test(res.url())) logoResponses.push(res);
        });

        await step('1. abre BASE_URL -> pantalla de login (no la app)', page, async function () {
            await page.goto(BASE_URL, { waitUntil: 'load', timeout: NAV_TIMEOUT });
            await assertLoginScreenVisibleNoApp(page);
        });

        await step('2. login e2e-superadmin -> dashboard con KPI no vacio', page, async function () {
            await loginAs(page, 'e2e-superadmin@mazelab-test.cl', superadminPassword);
            await page.waitForSelector('.kpi-value', { timeout: NAV_TIMEOUT });
            const kpiTexts = await page.$$eval('.kpi-value', function (els) {
                return els.map(function (e) { return e.textContent.trim(); });
            });
            const anyNonEmpty = kpiTexts.some(function (t) { return t.length > 0; });
            if (!anyNonEmpty) throw new Error('ningun .kpi-value tiene contenido (KPIs encontrados: ' + JSON.stringify(kpiTexts) + ')');
        });

        await step('3. logo mazelab-logo.png responde 200', page, async function () {
            if (logoResponses.length === 0) {
                // El <img> esta en el DOM desde el primer render (aunque el
                // contenedor este display:none) — normalmente ya cargo durante
                // el paso 1. Este margen es solo por si la respuesta seguia en
                // vuelo.
                await page.waitForTimeout(1500);
            }
            if (logoResponses.length === 0) throw new Error('no se observo ninguna respuesta de red para mazelab-logo.png');
            const statuses = logoResponses.map(function (r) { return r.status(); });
            if (!statuses.includes(200)) throw new Error('mazelab-logo.png respondio con status(es): ' + statuses.join(', '));
        });

        await step('4. logout -> vuelve la pantalla de login', page, async function () {
            await page.click('#logout-btn');
            await assertLoginScreenVisibleNoApp(page);
        });

        await step('5. login e2e-operaciones -> nav sin modulos restringidos', page, async function () {
            await loginAs(page, 'e2e-operaciones@mazelab-test.cl', operacionesPassword);
            await page.waitForSelector('.nav-item[data-route="dashboard"]', { timeout: NAV_TIMEOUT });
            // applyNavPermissions() corre de forma sincrona dentro de initApp(),
            // antes del primer await — pero se da un margen chico igual por las
            // dudas (arranque en frio del deploy).
            await page.waitForTimeout(300);

            const visibility = await page.evaluate(function (routes) {
                var out = {};
                routes.forEach(function (r) {
                    var el = document.querySelector('.nav-item[data-route="' + r + '"]');
                    out[r] = el ? window.getComputedStyle(el).display : 'ausente-en-dom';
                });
                return out;
            }, RESTRICTED_ROUTES);

            const stillVisible = Object.keys(visibility).filter(function (r) { return visibility[r] !== 'none'; });
            if (stillVisible.length > 0) {
                throw new Error('rutas restringidas visibles para operaciones: ' + JSON.stringify(visibility));
            }
        });

        // Paso 6 usa un CONTEXTO NUEVO (sin cookies/localStorage) a propósito:
        // el contexto principal ya tiene una sesión válida (operaciones, del
        // paso 5) persistida por Supabase Auth en localStorage — probar
        // ?localdev=1 ahí mismo daría un falso positivo (entraría por la
        // sesión ya restaurada, no por el bypass que se quiere descartar).
        await step('6. ?localdev=1 sobre BASE_URL (sesion limpia) sigue pidiendo login (N8)', null, async function () {
            const cleanContext = await browser.newContext();
            const cleanPage = await cleanContext.newPage();
            cleanPage.setDefaultTimeout(ACTION_TIMEOUT);
            cleanPage.setDefaultNavigationTimeout(NAV_TIMEOUT);
            try {
                await cleanPage.goto(BASE_URL + '/?localdev=1', { waitUntil: 'load', timeout: NAV_TIMEOUT });
                await assertLoginScreenVisibleNoApp(cleanPage);
            } finally {
                await cleanContext.close();
            }
        });

        await step('7. screenshot del dashboard logueado', page, async function () {
            // El contexto principal esta logueado como operaciones (paso 5) —
            // se cierra sesion y se vuelve a entrar como superadmin para el
            // screenshot final, dejando el flujo logout->login probado una
            // vez mas de paso.
            await page.click('#logout-btn');
            await assertLoginScreenVisibleNoApp(page);
            await loginAs(page, 'e2e-superadmin@mazelab-test.cl', superadminPassword);
            await page.waitForSelector('.kpi-value', { timeout: NAV_TIMEOUT });

            const screenshotPath = path.join(ARTIFACTS_DIR, 'dashboard-logged-in.png');
            await page.screenshot({ path: screenshotPath, fullPage: true });
            if (!fs.existsSync(screenshotPath)) throw new Error('el screenshot no se genero en ' + screenshotPath);
            console.log('\n      guardado en: ' + screenshotPath);
        });

        await context.close();
    } finally {
        await browser.close();
    }

    console.log('\n=== Resumen ===');
    console.log(pass + ' OK, ' + fail + ' FAIL');
    if (fail > 0) {
        console.log('\nDetalle de fallas:');
        failures.forEach(function (f) {
            console.log('  - ' + f.name);
            console.log('    ' + (f.error && f.error.message ? f.error.message : String(f.error)));
        });
    }
    process.exit(fail === 0 ? 0 : 1);
}

main().catch(function (err) {
    console.error('ERROR FATAL: ' + (err && err.stack ? err.stack : err));
    process.exit(1);
});
