#!/usr/bin/env node
// Provisión idempotente de 4 usuarios de prueba dedicados para el banco de
// experimentos E2E (Sprint E2E) — nunca reutiliza cuentas reales del equipo.
//
// Uso:
//   node scripts/provision-e2e-users.js
//
// Qué hace, por cada uno de los 4 usuarios e2e-<rol>@mazelab-test.cl:
//   - Si el profile ya existe (por email) y .env.e2e ya trae su contraseña
//     -> no toca la contraseña, solo confirma que el rol en profiles sea el
//     correcto (idempotente: correrlo N veces da el mismo resultado).
//   - Si el profile ya existe pero .env.e2e NO trae su contraseña (se perdió
//     el archivo local, o es la primera corrida en esta máquina) -> genera
//     una contraseña nueva y la fija con auth.admin.updateUserById (no hay
//     forma de leer la contraseña actual desde Supabase, así que se
//     resetea en vez de adivinar).
//   - Si el profile no existe -> crea el usuario con
//     auth.admin.createUser({email_confirm:true}) con una contraseña nueva,
//     espera a que el trigger handle_new_user (supabase/schema.sql) cree su
//     fila en profiles, y corrige el rol (el trigger asigna 'operaciones'
//     por defecto a cualquier email que no sea aldo@mazelab.cl).
//
// Al final escribe/actualiza .env.e2e en la raíz del repo (KEY=VALUE,
// gitignored) SOLO con las contraseñas nuevas o rotadas en esta corrida —
// las que ya eran conocidas se preservan tal cual. Nunca imprime contraseñas
// en consola.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.join(__dirname, '..');
const ENV_PATH = path.join(REPO_ROOT, '.env');
const E2E_ENV_PATH = path.join(REPO_ROOT, '.env.e2e');

const { parseEnvFile, loadEnvFile } = require('./lib/env.js');

// Mismo umbral que MIN_SERVICE_KEY_LENGTH en scripts/migrate-backup.js —
// duplicado a propósito (este script es standalone, no depende de
// migrate-backup.js) para detectar una service_role key truncada al
// pegarla en el .env.
const MIN_SERVICE_KEY_LENGTH = 100;

const E2E_USERS = [
    { email: 'e2e-superadmin@mazelab-test.cl', role: 'superadmin', envKey: 'E2E_SUPERADMIN_PASSWORD' },
    { email: 'e2e-socio@mazelab-test.cl', role: 'socio', envKey: 'E2E_SOCIO_PASSWORD' },
    { email: 'e2e-comercial@mazelab-test.cl', role: 'comercial', envKey: 'E2E_COMERCIAL_PASSWORD' },
    { email: 'e2e-operaciones@mazelab-test.cl', role: 'operaciones', envKey: 'E2E_OPERACIONES_PASSWORD' }
];

// Sin comillas ni "#" al inicio no aplica aquí (el chequeo de comentario de
// parseEnvFile es por línea completa, no por valor) — igual se excluyen
// comillas simples/dobles del charset para que la lógica de "value envuelto
// en comillas" de parseEnvFile nunca las toque por accidente.
const PASSWORD_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_+=';
const PASSWORD_LENGTH = 24;

function generateStrongPassword() {
    let out = '';
    for (let i = 0; i < PASSWORD_LENGTH; i++) {
        out += PASSWORD_CHARSET[crypto.randomInt(0, PASSWORD_CHARSET.length)];
    }
    return out;
}

function loadMainEnv() {
    if (!fs.existsSync(ENV_PATH)) {
        throw new Error(
            'No se encontro el archivo .env en la raiz del repo (' + ENV_PATH + ').\n' +
            'Debe tener SUPABASE_URL y SUPABASE_SERVICE_KEY (service_role, NO anon).'
        );
    }
    const parsed = parseEnvFile(ENV_PATH);
    const url = parsed.SUPABASE_URL;
    const key = parsed.SUPABASE_SERVICE_KEY;
    const missing = [];
    if (!url) missing.push('SUPABASE_URL');
    if (!key) missing.push('SUPABASE_SERVICE_KEY');
    if (missing.length) {
        throw new Error('Falta(n) variable(s) en .env: ' + missing.join(', '));
    }
    if (key.length < MIN_SERVICE_KEY_LENGTH) {
        throw new Error(
            'SUPABASE_SERVICE_KEY parece truncada (largo=' + key.length + ', se esperaban >= ' + MIN_SERVICE_KEY_LENGTH + ').'
        );
    }
    return { url: url, key: key };
}

// Agrega, si faltan, las entradas de .gitignore necesarias para que
// .env.e2e y tests/e2e/artifacts/ nunca queden trackeados. Se llama SIEMPRE
// antes de escribir .env.e2e por primera vez. ".env.*" ya cubre ".env.e2e"
// de forma genérica en este repo, pero esto deja una entrada explícita y
// documentada — guard barato por si algún día cambia el patrón genérico.
function ensureGitignoreEntries() {
    const gitignorePath = path.join(REPO_ROOT, '.gitignore');
    let content = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
    const linesToEnsure = ['.env.e2e', 'tests/e2e/artifacts/'];
    const existingLines = content.split(/\r?\n/);
    const missing = linesToEnsure.filter(function (l) { return existingLines.indexOf(l) === -1; });
    if (missing.length === 0) return;
    if (content.length && content.charAt(content.length - 1) !== '\n') content += '\n';
    content += '\n# scripts/provision-e2e-users.js — guard explicito (defensa en profundidad)\n';
    missing.forEach(function (l) { content += l + '\n'; });
    fs.writeFileSync(gitignorePath, content, 'utf8');
    console.log('(.gitignore actualizado con: ' + missing.join(', ') + ')');
}

function writeE2EEnvFile(passwordsByEnvKey) {
    const lines = [
        '# Contrasenas de los 4 usuarios de prueba E2E — generado por scripts/provision-e2e-users.js',
        '# NUNCA commitear este archivo (ya esta en .gitignore).',
        ''
    ];
    E2E_USERS.forEach(function (u) {
        lines.push(u.envKey + '=' + passwordsByEnvKey[u.envKey]);
    });
    fs.writeFileSync(E2E_ENV_PATH, lines.join('\n') + '\n', 'utf8');
}

async function findProfileByEmail(client, email) {
    const res = await client.from('profiles').select('id, role, active').eq('email', email).maybeSingle();
    if (res.error) throw new Error('Error buscando profile de ' + email + ': ' + res.error.message);
    return res.data || null;
}

// Tras admin.createUser(), el trigger handle_new_user crea la fila en
// profiles de forma asíncrona respecto a la respuesta HTTP del admin API —
// se espera con un pequeño retry en vez de asumir que ya existe.
async function waitForProfile(client, email, attempts, delayMs) {
    for (let i = 0; i < attempts; i++) {
        const profile = await findProfileByEmail(client, email);
        if (profile) return profile;
        await new Promise(function (resolve) { setTimeout(resolve, delayMs); });
    }
    return null;
}

async function provisionUser(client, user, existingE2EEnv, newPasswords, report) {
    const existingProfile = await findProfileByEmail(client, user.email);
    const hasStoredPassword = !!existingE2EEnv[user.envKey];

    if (existingProfile) {
        // Usuario ya existe (auth + profile). Corrige rol/estado si hace falta.
        if (existingProfile.role !== user.role) {
            const upd = await client.from('profiles').update({ role: user.role }).eq('id', existingProfile.id).select().single();
            if (upd.error) throw new Error('Error actualizando rol de ' + user.email + ': ' + upd.error.message);
        }
        if (existingProfile.active === false) {
            const act = await client.from('profiles').update({ active: true }).eq('id', existingProfile.id).select().single();
            if (act.error) throw new Error('Error reactivando ' + user.email + ': ' + act.error.message);
        }

        if (hasStoredPassword) {
            // No rota contraseña — se reusa la que ya está en .env.e2e.
            report.push({ email: user.email, role: user.role, action: 'ya existia, password conocida (sin cambios)' });
            return;
        }

        // Existe pero no conocemos su contraseña (.env.e2e ausente o
        // incompleto) -> hay que resetearla, no hay forma de leer la actual.
        const newPassword = generateStrongPassword();
        const resetRes = await client.auth.admin.updateUserById(existingProfile.id, { password: newPassword, email_confirm: true });
        if (resetRes.error) throw new Error('Error reseteando password de ' + user.email + ': ' + resetRes.error.message);
        newPasswords[user.envKey] = newPassword;
        report.push({ email: user.email, role: user.role, action: 'ya existia, password desconocida -> reseteada' });
        return;
    }

    // No existe -> crear desde cero.
    const newPassword = generateStrongPassword();
    const createRes = await client.auth.admin.createUser({
        email: user.email,
        password: newPassword,
        email_confirm: true,
        user_metadata: { name: 'E2E ' + user.role }
    });
    if (createRes.error) {
        throw new Error('Error creando usuario ' + user.email + ': ' + createRes.error.message);
    }
    newPasswords[user.envKey] = newPassword;

    const profile = await waitForProfile(client, user.email, 10, 400);
    if (!profile) {
        throw new Error('Usuario ' + user.email + ' se creo en auth pero su profile no aparecio tras esperar (trigger handle_new_user no corrio a tiempo).');
    }
    if (profile.role !== user.role) {
        const upd = await client.from('profiles').update({ role: user.role }).eq('id', profile.id).select().single();
        if (upd.error) throw new Error('Error asignando rol a ' + user.email + ': ' + upd.error.message);
    }
    report.push({ email: user.email, role: user.role, action: 'creado nuevo' });
}

async function main() {
    console.log('=== Provision de usuarios E2E (Sprint E2E) ===\n');

    const env = loadMainEnv();
    const { createClient } = require('@supabase/supabase-js');
    const client = createClient(env.url, env.key, { auth: { persistSession: false, autoRefreshToken: false } });

    ensureGitignoreEntries();

    const existingE2EEnv = loadEnvFile(E2E_ENV_PATH);
    const newPasswords = {};
    const report = [];

    for (let i = 0; i < E2E_USERS.length; i++) {
        await provisionUser(client, E2E_USERS[i], existingE2EEnv, newPasswords, report);
    }

    if (Object.keys(newPasswords).length > 0) {
        const merged = Object.assign({}, existingE2EEnv, newPasswords);
        writeE2EEnvFile(merged);
        console.log('.env.e2e actualizado (' + Object.keys(newPasswords).length + ' password(s) nueva(s) o rotada(s)).\n');
    } else {
        console.log('.env.e2e sin cambios (todas las contrasenas ya eran conocidas).\n');
    }

    console.log('=== Reporte ===');
    report.forEach(function (r) {
        console.log('  ' + r.email.padEnd(32) + ' rol=' + r.role.padEnd(11) + ' ' + r.action);
    });
    console.log('\n' + report.length + '/4 usuarios listos.');
}

main().catch(function (err) {
    console.error('\nERROR FATAL: ' + (err && err.message ? err.message : err));
    process.exit(1);
});
