#!/usr/bin/env node
// Migración re-ejecutable de un respaldo JSON (dump del Postgres de Replit) a
// Supabase — Sprint M1, Lote M1-C.
//
// Uso:
//   node scripts/migrate-backup.js <ruta-al-backup.json> [--dry-run]
//   node scripts/migrate-backup.js --verify-only
//
// Ver scripts/README.md para el detalle de los 3 modos.
//
// Fuente de verdad de tipos: este script NO mantiene su propia lista de
// campos NUMERIC/BIGINT — la reusa vía require directo de
// tests/verify-schema-sql.js (que la deriva parseando supabase/schema.sql).
// Si el schema cambia, este script queda sincronizado automáticamente.
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const ENV_PATH = path.join(REPO_ROOT, '.env');

const schemaInfo = require(path.join(REPO_ROOT, 'tests', 'verify-schema-sql.js'));
const NUMERIC_FIELDS_BY_TABLE = schemaInfo.NUMERIC_FIELDS_BY_TABLE;
const BIGINT_FIELDS_BY_TABLE = schemaInfo.BIGINT_FIELDS_BY_TABLE;
const BACKUP_TABLES = schemaInfo.BACKUP_TABLES; // ['ventas','facturas','costos','servicios','personal','clientes','equipos','cotizaciones']

// Orden de escritura: referencias lógicas primero. No hay FKs reales en el
// esquema (todas las tablas son independientes, sin REFERENCES entre sí),
// pero el orden documenta la intención — catálogos antes que movimientos.
const TABLE_ORDER = ['clientes', 'servicios', 'personal', 'equipos', 'ventas', 'facturas', 'costos', 'cotizaciones'];

const BATCH_SIZE = 100;

// Conteos esperados del respaldo real (mazelab-backup-2026-07-25.json).
// Duplica a mano el mismo objeto "expected" de tests/verify-schema-sql.js
// (esa lista de NUMERIC/BIGINT sí se reusa por require directo — este objeto
// de conteos no está exportado allá, así que se repite aquí; si el respaldo
// de origen cambia de tamaño, actualizar ambos lugares).
const EXPECTED_COUNTS = {
    ventas: 992,
    facturas: 1150,
    costos: 3615,
    servicios: 70,
    personal: 2,
    clientes: 599,
    equipos: 2,
    cotizaciones: 16
};

// ============================================================================
// Parser de .env — sin dependencias (no dotenv). El archivo lo crea el dueño
// a mano con Bloc de notas en Windows, así que debe tolerar:
//   - BOM UTF-8 al inicio del archivo (Notepad lo agrega por defecto).
//   - Fin de línea CRLF (\r\n).
//   - Espacios alrededor de la clave, del "=" y del valor.
//   - Comillas simples o dobles envolviendo el valor (opcional).
//   - Líneas vacías y comentarios ("# ...").
// ============================================================================
function parseEnvFile(filePath) {
    const raw = fs.readFileSync(filePath);
    let text = raw.toString('utf8');
    // BOM UTF-8: al decodificar como utf8, el BOM queda como el carácter
    // U+FEFF al inicio del string — quitarlo antes de partir en líneas.
    if (text.charCodeAt(0) === 0xFEFF) {
        text = text.slice(1);
    }

    const out = {};
    text.split(/\r?\n/).forEach(function (line) {
        const trimmedLine = line.trim();
        if (trimmedLine === '' || trimmedLine.indexOf('#') === 0) return;

        const eqIdx = trimmedLine.indexOf('=');
        if (eqIdx === -1) return; // línea sin "=" — se ignora, no es un KEY=VALUE válido

        const key = trimmedLine.slice(0, eqIdx).trim();
        let value = trimmedLine.slice(eqIdx + 1).trim();
        if (value.length >= 2) {
            const first = value.charAt(0);
            const last = value.charAt(value.length - 1);
            if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) {
                value = value.slice(1, -1);
            }
        }
        if (key !== '') out[key] = value;
    });
    return out;
}

function loadEnv() {
    if (!fs.existsSync(ENV_PATH)) {
        return { exists: false, url: undefined, key: undefined };
    }
    const parsed = parseEnvFile(ENV_PATH);
    return { exists: true, url: parsed.SUPABASE_URL, key: parsed.SUPABASE_SERVICE_KEY };
}

// Lanza con instrucciones claras — se llama solo en los modos que sí
// necesitan red (corrida real y --verify-only). --dry-run nunca la invoca.
function requireCredentials(env) {
    if (!env.exists) {
        throw new Error(
            'No se encontro el archivo .env en la raiz del repo (' + ENV_PATH + ').\n' +
            'Crea un archivo llamado ".env" ahi (con Bloc de notas esta bien) con estas dos lineas:\n' +
            '  SUPABASE_URL=https://xxxx.supabase.co\n' +
            '  SUPABASE_SERVICE_KEY=<service_role key, NO la anon key>\n' +
            'La service_role key esta en el dashboard de Supabase: Project Settings > API > service_role.'
        );
    }
    const missing = [];
    if (!env.url) missing.push('SUPABASE_URL');
    if (!env.key) missing.push('SUPABASE_SERVICE_KEY');
    if (missing.length) {
        throw new Error(
            'Falta(n) variable(s) en .env: ' + missing.join(', ') + '.\n' +
            'El archivo debe tener exactamente estas claves (una por linea):\n' +
            '  SUPABASE_URL=https://xxxx.supabase.co\n' +
            '  SUPABASE_SERVICE_KEY=<service_role key>'
        );
    }
}

// ============================================================================
// Lectura y validación estructural del respaldo
// ============================================================================
function readBackupFile(backupPath) {
    if (!fs.existsSync(backupPath)) {
        throw new Error('No se encontro el archivo de respaldo: ' + backupPath);
    }
    let raw;
    try {
        raw = fs.readFileSync(backupPath, 'utf8');
    } catch (e) {
        throw new Error('No se pudo leer el archivo de respaldo "' + backupPath + '": ' + e.message);
    }
    let data;
    try {
        data = JSON.parse(raw);
    } catch (e) {
        throw new Error('El archivo de respaldo no es JSON valido: ' + e.message);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('El archivo de respaldo debe ser un objeto JSON con una clave (array de filas) por tabla.');
    }
    return data;
}

// Valida que las 8 tablas esperadas esten presentes como arrays.
function validateBackupStructure(data) {
    const missing = BACKUP_TABLES.filter(function (t) { return !Array.isArray(data[t]); });
    const extra = Object.keys(data).filter(function (k) { return BACKUP_TABLES.indexOf(k) === -1; });
    return { missing: missing, extra: extra };
}

// ============================================================================
// Cast de tipos: string numerica -> Number (o String si es BIGINT y excede
// Number.MAX_SAFE_INTEGER), null se preserva null, string vacia -> null.
// Los campos que no aparecen en NUMERIC_FIELDS_BY_TABLE/BIGINT_FIELDS_BY_TABLE
// (incluidos todos los JSONB) no se tocan.
// ============================================================================
function castField(rawValue, isBigint) {
    if (rawValue === null || rawValue === undefined) {
        return { value: rawValue, changed: false, castable: true };
    }
    if (typeof rawValue === 'number') {
        // Ya viene como numero (ej. jornadas, boardColumn, paymentTerms en el
        // respaldo real). Si es un BIGINT que ya perdio precision al pasar por
        // JSON.parse no hay forma de recuperarla aqui — se deja pasar tal cual.
        return { value: rawValue, changed: false, castable: true };
    }
    if (typeof rawValue !== 'string') {
        // Tipo inesperado (boolean/array/object) en un campo declarado
        // NUMERIC/BIGINT — no se castea, se reporta como no-casteable.
        return { value: rawValue, changed: false, castable: false, reason: 'tipo inesperado (' + typeof rawValue + ')' };
    }

    const trimmed = rawValue.trim();
    if (trimmed === '') {
        // Decision documentada (requisito del Lote M1-C): string vacia en un
        // campo numerico se preserva como null, no como 0 ni como string vacio
        // (que Postgres rechazaria en una columna NUMERIC/BIGINT).
        return { value: null, changed: true, castable: true, emptyToNull: true };
    }

    const n = Number(trimmed);
    if (Number.isNaN(n)) {
        return { value: rawValue, changed: false, castable: false, reason: 'no es numerico ("' + rawValue + '")' };
    }

    if (isBigint && !Number.isSafeInteger(n)) {
        // boardOrder es el unico caso (epoch-millis). En el respaldo real cabe
        // siempre en Number (13 digitos), pero si algun dato futuro excediera
        // Number.MAX_SAFE_INTEGER, se preserva como string en vez de perder
        // precision — Postgres/PostgREST castean un string numerico a BIGINT
        // sin problema.
        return { value: trimmed, changed: true, castable: true, keptAsString: true };
    }

    return { value: n, changed: true, castable: true };
}

// Castea todos los campos NUMERIC/BIGINT de una fila. Devuelve la fila
// casteada (copia superficial — los JSONB quedan intactos, se copian tal
// cual) + un reporte por campo tocado.
function castRow(row, numericFields, bigintFields) {
    const out = Object.assign({}, row);
    const report = [];
    numericFields.concat(bigintFields).forEach(function (field) {
        if (!Object.prototype.hasOwnProperty.call(row, field)) return; // campo ausente en esta fila — nada que castear
        const isBigint = bigintFields.indexOf(field) !== -1;
        const result = castField(row[field], isBigint);
        out[field] = result.value;
        report.push(Object.assign({ field: field }, result));
    });
    return { row: out, report: report };
}

// ============================================================================
// --dry-run: sin red. Valida estructura + castea en memoria + reporta.
// ============================================================================
function runDryRun(backupPath) {
    console.log('=== Migracion de respaldo -> Supabase (DRY RUN, sin red) ===\n');
    console.log('Respaldo: ' + backupPath + '\n');

    let data;
    try {
        data = readBackupFile(backupPath);
    } catch (e) {
        console.error('ERROR: ' + e.message);
        return false;
    }

    const structure = validateBackupStructure(data);
    let allOk = true;
    if (structure.missing.length) {
        allOk = false;
        console.error('ERROR: faltan tablas en el respaldo (se esperaban las 8): ' + structure.missing.join(', ') + '\n');
    }
    if (structure.extra.length) {
        console.log('AVISO: el respaldo trae claves no reconocidas (se ignoran): ' + structure.extra.join(', ') + '\n');
    }

    TABLE_ORDER.forEach(function (table) {
        const rows = Array.isArray(data[table]) ? data[table] : [];
        const numericFields = NUMERIC_FIELDS_BY_TABLE[table] || [];
        const bigintFields = BIGINT_FIELDS_BY_TABLE[table] || [];

        let castedCount = 0;
        const notCastable = [];
        rows.forEach(function (row) {
            const casted = castRow(row, numericFields, bigintFields);
            casted.report.forEach(function (r) {
                if (r.castable && r.changed) castedCount++;
                if (!r.castable) notCastable.push({ id: row.id, field: r.field, raw: row[r.field], reason: r.reason });
            });
        });

        const expected = EXPECTED_COUNTS[table];
        const countMatches = rows.length === expected;
        if (!countMatches) allOk = false;
        if (notCastable.length) allOk = false;

        console.log('--- ' + table + ' ---');
        console.log('  filas: ' + rows.length + ' (esperado ' + expected + ') ' + (countMatches ? 'OK' : '!! DIFF !!'));
        console.log('  campos casteados: ' + castedCount + ' (numero de campos NUMERIC/BIGINT convertidos exitosamente)');
        console.log('  valores no casteables: ' + notCastable.length);
        if (notCastable.length) {
            notCastable.slice(0, 20).forEach(function (n) {
                console.log('    id=' + n.id + ' campo=' + n.field + ' valor=' + JSON.stringify(n.raw) + ' (' + n.reason + ')');
            });
            if (notCastable.length > 20) console.log('    ... y ' + (notCastable.length - 20) + ' mas');
        }
        console.log('');
    });

    console.log('=== Resumen dry-run ===');
    if (allOk) {
        console.log('OK — 8 tablas, conteos esperados vs reales calzan, cero valores no casteables.');
    } else {
        console.log('HAY DIFERENCIAS — revisar el detalle de arriba antes de correr la migracion real.');
    }
    return allOk;
}

// ============================================================================
// Cliente Supabase (service key) — require perezoso: dry-run nunca llega
// aqui, asi que nunca depende de que @supabase/supabase-js este instalado.
// ============================================================================
function createServiceClient(env) {
    const { createClient } = require('@supabase/supabase-js');
    return createClient(env.url, env.key, {
        auth: { persistSession: false, autoRefreshToken: false }
    });
}

async function getRemoteCounts(client, tables) {
    const counts = {};
    for (let i = 0; i < tables.length; i++) {
        const table = tables[i];
        const res = await client.from(table).select('id', { count: 'exact', head: true });
        if (res.error) {
            throw new Error('Error al contar filas en "' + table + '": ' + res.error.message);
        }
        counts[table] = res.count;
    }
    return counts;
}

// Imprime la tabla resumen final (esperado vs en-base) y devuelve si calza.
function printCountsSummary(counts) {
    console.log('\n=== Resumen de conteos (esperado vs en Supabase) ===');
    let allMatch = true;
    TABLE_ORDER.forEach(function (table) {
        const expected = EXPECTED_COUNTS[table];
        const real = counts[table];
        const matches = real === expected;
        if (!matches) allMatch = false;
        console.log(
            '  ' + table.padEnd(14) + ' esperado=' + String(expected).padStart(5) +
            '  en-base=' + String(real).padStart(5) +
            '  ' + (matches ? 'OK' : '!! DIFF !!')
        );
    });
    console.log(allMatch ? '\nOK — todos los conteos calzan.' : '\nHAY DIFERENCIAS entre lo esperado y lo que hay en Supabase.');
    return allMatch;
}

// ============================================================================
// Corrida real: castea + upsert por id en lotes de 100, secuencial, tabla por
// tabla en TABLE_ORDER. Idempotente — correrlo N veces da los mismos
// conteos (upsert por "id", no insert).
// ============================================================================
async function runMigration(backupPath, env) {
    requireCredentials(env);
    console.log('=== Migracion de respaldo -> Supabase (CORRIDA REAL) ===\n');
    console.log('Respaldo: ' + backupPath);
    console.log('Proyecto: ' + env.url + '\n');

    const data = readBackupFile(backupPath);
    const structure = validateBackupStructure(data);
    if (structure.missing.length) {
        throw new Error('El respaldo no trae todas las tablas esperadas: faltan ' + structure.missing.join(', '));
    }

    const client = createServiceClient(env);

    for (let t = 0; t < TABLE_ORDER.length; t++) {
        const table = TABLE_ORDER[t];
        const rows = Array.isArray(data[table]) ? data[table] : [];
        const numericFields = NUMERIC_FIELDS_BY_TABLE[table] || [];
        const bigintFields = BIGINT_FIELDS_BY_TABLE[table] || [];
        const castedRows = rows.map(function (row) { return castRow(row, numericFields, bigintFields).row; });

        const totalBatches = Math.ceil(castedRows.length / BATCH_SIZE) || 0;
        console.log(table + ': ' + castedRows.length + ' filas, ' + totalBatches + ' lote(s)');

        for (let i = 0; i < castedRows.length; i += BATCH_SIZE) {
            const batch = castedRows.slice(i, i + BATCH_SIZE);
            const batchNum = Math.floor(i / BATCH_SIZE) + 1;
            const res = await client.from(table).upsert(batch, { onConflict: 'id' });
            if (res.error) {
                throw new Error('Error al migrar "' + table + '" (lote ' + batchNum + ' de ' + totalBatches + '): ' + res.error.message);
            }
            console.log('  lote ' + batchNum + '/' + totalBatches + ' OK (' + batch.length + ' filas)');
        }
    }

    console.log('\nMigracion de datos completa. Verificando conteos remotos...');
    const counts = await getRemoteCounts(client, TABLE_ORDER);
    return printCountsSummary(counts);
}

// ============================================================================
// --verify-only: solo cuenta filas remotas vs esperado, sin escribir nada.
// ============================================================================
async function runVerifyOnly(env) {
    requireCredentials(env);
    console.log('=== Verificacion de conteos remotos (--verify-only, sin escritura) ===\n');
    console.log('Proyecto: ' + env.url + '\n');
    const client = createServiceClient(env);
    const counts = await getRemoteCounts(client, TABLE_ORDER);
    return printCountsSummary(counts);
}

// ============================================================================
// CLI
// ============================================================================
function printUsage() {
    console.log([
        'Uso:',
        '  node scripts/migrate-backup.js <ruta-al-backup.json> [--dry-run]',
        '  node scripts/migrate-backup.js --verify-only',
        '',
        'Modos:',
        '  (sin flags)    Corrida real: castea y hace upsert de las 8 tablas contra Supabase (lotes de 100,',
        '                 por id), y al final verifica los conteos remotos vs esperados. Requiere .env con',
        '                 SUPABASE_URL y SUPABASE_SERVICE_KEY, y la ruta al respaldo.',
        '  --dry-run      Solo valida el respaldo y castea en memoria — NUNCA toca la red. No requiere .env.',
        '  --verify-only  Solo compara conteos remotos vs esperados (sin escribir). Requiere .env, no',
        '                 requiere la ruta al respaldo.'
    ].join('\n'));
}

function parseArgs(argv) {
    const flags = {};
    const positionals = [];
    argv.forEach(function (a) {
        if (a.indexOf('--') === 0) flags[a] = true;
        else positionals.push(a);
    });
    return { flags: flags, backupPath: positionals[0] };
}

function handleFatal(err) {
    console.error('\nERROR FATAL: ' + (err && err.message ? err.message : err));
    process.exit(1);
}

async function main() {
    const parsed = parseArgs(process.argv.slice(2));
    const dryRun = !!parsed.flags['--dry-run'];
    const verifyOnly = !!parsed.flags['--verify-only'];

    if (dryRun && verifyOnly) {
        console.error('ERROR: --dry-run y --verify-only son excluyentes entre si.');
        printUsage();
        process.exit(1);
        return;
    }

    if (dryRun) {
        if (!parsed.backupPath) {
            console.error('ERROR: --dry-run requiere la ruta al backup.\n');
            printUsage();
            process.exit(1);
            return;
        }
        const ok = runDryRun(parsed.backupPath);
        process.exit(ok ? 0 : 1);
        return;
    }

    const env = loadEnv();

    if (verifyOnly) {
        const ok = await runVerifyOnly(env);
        process.exit(ok ? 0 : 1);
        return;
    }

    if (!parsed.backupPath) {
        console.error('ERROR: falta la ruta al backup.\n');
        printUsage();
        process.exit(1);
        return;
    }

    const ok = await runMigration(parsed.backupPath, env);
    process.exit(ok ? 0 : 1);
}

module.exports = {
    parseEnvFile: parseEnvFile,
    loadEnv: loadEnv,
    castField: castField,
    castRow: castRow,
    validateBackupStructure: validateBackupStructure,
    EXPECTED_COUNTS: EXPECTED_COUNTS,
    TABLE_ORDER: TABLE_ORDER
};

if (require.main === module) {
    main().catch(handleFatal);
}
