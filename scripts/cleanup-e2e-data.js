#!/usr/bin/env node
// Limpieza de datos de prueba del banco de experimentos E2E (Sprint E2E).
//
// Convención: cualquier fila creada por un experimento E2E debe traer el
// prefijo "E2E-TEST-" en su campo de nombre/identificador de negocio
// (eventName, name/nombre, clientName o codigo, según la tabla). Este script
// borra, vía service key, toda fila de las 8 tablas de negocio que calce esa
// convención. Hoy (recién creada la infraestructura E2E) no debería
// encontrar ninguna — reporta "0 filas E2E encontradas" sin error en ese
// caso, no es una falla.
//
// Uso:
//   node scripts/cleanup-e2e-data.js
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const ENV_PATH = path.join(REPO_ROOT, '.env');

const { parseEnvFile } = require('./lib/env.js');

const MIN_SERVICE_KEY_LENGTH = 100; // ver misma nota en provision-e2e-users.js

const PREFIX = 'E2E-TEST-';

// Por tabla: qué columnas de nombre/identificador de negocio revisar en
// busca del prefijo E2E-TEST- (ver supabase/schema.sql para las columnas
// reales de cada tabla — se listan las de tipo "nombre visible", no PKs ni
// campos técnicos).
const TABLES = [
    { table: 'ventas', columns: ['eventName', 'clientName'] },
    { table: 'facturas', columns: ['eventName', 'clientName'] },
    { table: 'costos', columns: ['eventName', 'clientName'] },
    { table: 'servicios', columns: ['name', 'nombre'] },
    { table: 'personal', columns: ['name', 'nombre'] },
    { table: 'clientes', columns: ['name', 'nombre'] },
    { table: 'equipos', columns: ['nombre'] },
    { table: 'cotizaciones', columns: ['codigo', 'eventName', 'clientName'] }
];

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
    if (missing.length) throw new Error('Falta(n) variable(s) en .env: ' + missing.join(', '));
    if (key.length < MIN_SERVICE_KEY_LENGTH) {
        throw new Error('SUPABASE_SERVICE_KEY parece truncada (largo=' + key.length + ').');
    }
    return { url: url, key: key };
}

async function cleanupTable(client, table, columns) {
    // .like.<valor> por columna, unidas con OR — PostgREST usa "%" como
    // comodín (igual que SQL LIKE), y el prefijo no trae caracteres que
    // necesiten escape para ese filtro.
    const orFilter = columns.map(function (col) { return col + '.like.' + PREFIX + '%'; }).join(',');

    const selectRes = await client.from(table).select('id').or(orFilter);
    if (selectRes.error) {
        throw new Error('Error buscando filas E2E en "' + table + '": ' + selectRes.error.message);
    }
    const ids = (selectRes.data || []).map(function (r) { return r.id; });
    if (ids.length === 0) {
        return { table: table, found: 0, deleted: 0 };
    }

    const delRes = await client.from(table).delete().in('id', ids);
    if (delRes.error) {
        throw new Error('Error borrando filas E2E en "' + table + '" (' + ids.length + ' fila(s)): ' + delRes.error.message);
    }
    return { table: table, found: ids.length, deleted: ids.length };
}

async function main() {
    console.log('=== Limpieza de datos E2E (prefijo "' + PREFIX + '") ===\n');

    const env = loadMainEnv();
    const { createClient } = require('@supabase/supabase-js');
    const client = createClient(env.url, env.key, { auth: { persistSession: false, autoRefreshToken: false } });

    const results = [];
    for (let i = 0; i < TABLES.length; i++) {
        const r = await cleanupTable(client, TABLES[i].table, TABLES[i].columns);
        results.push(r);
        console.log('  ' + r.table.padEnd(14) + ' encontradas=' + r.found + '  borradas=' + r.deleted);
    }

    const totalFound = results.reduce(function (acc, r) { return acc + r.found; }, 0);
    console.log('');
    if (totalFound === 0) {
        console.log('0 filas E2E encontradas.');
    } else {
        console.log(totalFound + ' fila(s) E2E encontradas y borradas en total.');
    }
}

main().catch(function (err) {
    console.error('\nERROR FATAL: ' + (err && err.message ? err.message : err));
    process.exit(1);
});
