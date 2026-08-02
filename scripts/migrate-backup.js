#!/usr/bin/env node
// Migración re-ejecutable de un respaldo JSON (dump del Postgres de Replit) a
// Supabase — Sprint M1, Lote M1-C.
//
// Uso:
//   node scripts/migrate-backup.js <ruta-al-backup.json> --dry-run
//   node scripts/migrate-backup.js <ruta-al-backup.json> --write
//   node scripts/migrate-backup.js --verify-only
//
// No hay modo por defecto: una de las 3 flags de arriba es obligatoria, y son
// una allowlist estricta (cualquier otra flag, o ninguna, sale con usage +
// exit 1 sin tocar la red). Ver scripts/README.md para el detalle de los 3
// modos.
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

// Largo mínimo plausible de un JWT service_role de Supabase. Un valor bajo
// este umbral casi siempre significa que la key quedó cortada al pegarla en
// el .env (ej. Notepad partió la línea, o se pegó solo una porción). No es
// una validación de formato JWT completa — solo un guard barato contra el
// caso más común de "la migración falla con un error de auth confuso".
const MIN_SERVICE_KEY_LENGTH = 100;

// Baseline INFORMATIVO del respaldo del 25-jul-2026 (mazelab-backup-2026-07-25.json).
// Duplica a mano el mismo objeto "expected" de tests/verify-schema-sql.js
// (esa lista de NUMERIC/BIGINT sí se reusa por require directo — este objeto
// de conteos no está exportado allá, así que se repite aquí).
//
// IMPORTANTE: esto NUNCA es criterio de pass/fail. El pass/fail real es
// siempre contra rows.length del archivo que se está procesando en la
// corrida actual (ver runDryRun y printFileVsRemoteSummary) — un respaldo
// fresco de cutover con más filas que este baseline es el resultado
// ESPERADO del negocio siguiendo operando, no un error. Este objeto solo
// sirve para mostrar cuánto creció/decreció la base respecto al 25-jul,
// ej. "ventas: 995 en el archivo (baseline 25-jul: 992, +3)".
const BASELINE_COUNTS = {
    ventas: 992,
    facturas: 1150,
    costos: 3615,
    servicios: 70,
    personal: 2,
    clientes: 599,
    equipos: 2,
    cotizaciones: 16
};

// Nota informativa "N en el archivo (baseline 25-jul: M, +/-diff)" para un
// conteo real de filas leídas del archivo — nunca determina pass/fail.
function baselineNote(table, fileCount) {
    const baseline = BASELINE_COUNTS[table];
    if (baseline === undefined) return 'sin baseline registrado para esta tabla';
    const diff = fileCount - baseline;
    const diffLabel = diff === 0 ? 'sin cambio' : (diff > 0 ? '+' + diff : String(diff));
    return 'baseline 25-jul: ' + baseline + ', ' + diffLabel;
}

// ============================================================================
// Parser de .env — sin dependencias (no dotenv). Extraído a scripts/lib/env.js
// en el Sprint E2E para que provision-e2e-users.js y cleanup-e2e-data.js usen
// el mismo parser (ver ese archivo para el detalle de qué formatos tolera:
// BOM UTF-8, CRLF, comillas opcionales, comentarios). Se re-exporta aquí
// tal cual (mismo nombre, mismo comportamiento) para no romper a quien ya
// hace require('./migrate-backup.js').parseEnvFile.
// ============================================================================
const parseEnvFile = require('./lib/env.js').parseEnvFile;

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
    if (env.key.length < MIN_SERVICE_KEY_LENGTH) {
        throw new Error(
            'SUPABASE_SERVICE_KEY parece truncada o incompleta (largo=' + env.key.length +
            ' caracteres, se esperaban al menos ' + MIN_SERVICE_KEY_LENGTH + ').\n' +
            'Revisa que el .env tenga la key completa en UNA sola linea (sin saltos de linea en\n' +
            'medio) y que el archivo este guardado en UTF-8 (no Unicode/UTF-16) — en Notepad,\n' +
            '"Guardar como" > elegir "UTF-8" en el desplegable de codificacion.'
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
// Un string solo se considera numérico si calza EXACTO con este patrón:
// entero o decimal, signo opcional al inicio. Esto rechaza explícitamente
// "Infinity", "NaN", notación exponencial ("1e10"), hex ("0x1F"), y
// cualquier otro string que Number(...) castearía silenciosamente a algo
// que no es el numero que el string representa a simple vista.
const NUMERIC_STRING_RE = /^-?\d+(\.\d+)?$/;

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

    if (!NUMERIC_STRING_RE.test(trimmed)) {
        // No calza el patron numerico estricto (M-1): puede ser texto
        // arbitrario, "Infinity"/"NaN", notacion exponencial, o hex — todos
        // casos donde Number(...) castearia sin avisar. Se reporta como
        // no-casteable en vez de dejar pasar un valor silenciosamente raro.
        return { value: rawValue, changed: false, castable: false, reason: 'no es numerico ("' + rawValue + '")' };
    }

    const n = Number(trimmed);
    if (!Number.isFinite(n)) {
        // Defensivo: un string de muchos digitos que SI calza el regex
        // (ej. una cadena de 400 digitos) puede evaluar a Infinity en
        // Number(). Nunca se debe castear a Infinity en silencio.
        return { value: rawValue, changed: false, castable: false, reason: 'valor fuera de rango numerico ("' + rawValue + '")' };
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

        // I-1: el conteo de filas es SIEMPRE informativo contra el baseline
        // del 25-jul — nunca determina pass/fail. Un respaldo fresco con mas
        // filas (negocio siguio operando) es el resultado esperado, no un
        // error. Lo unico que sí falla el dry-run por tabla es tener valores
        // no-casteables.
        if (notCastable.length) allOk = false;

        console.log('--- ' + table + ' ---');
        console.log('  filas: ' + rows.length + ' en el archivo (' + baselineNote(table, rows.length) + ')');
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
        console.log('OK — 8 tablas presentes en el respaldo, cero valores no casteables.');
        console.log('(Los conteos de arriba son informativos contra el baseline del 25-jul — no son criterio de pass/fail: un respaldo con mas filas que el baseline es normal y esperado.)');
    } else {
        console.log('HAY PROBLEMAS — revisar el detalle de arriba (tablas faltantes y/o valores no casteables) antes de correr la migracion real.');
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

// I-1 — Resumen final de la corrida real: archivo procesado vs Supabase.
// Éxito = "todas las filas del archivo estan en la base", es decir conteo
// remoto >= filas del archivo, POR TABLA. Si el remoto tiene MAS filas que
// el archivo (datos que no vienen en este respaldo — normal si la app
// siguio recibiendo escrituras), se informa como nota, nunca como fallo.
// Solo falla si el remoto tiene MENOS filas que el archivo (upsert
// incompleto / fila que no llego).
function printFileVsRemoteSummary(fileCounts, remoteCounts) {
    console.log('\n=== Resumen final (archivo procesado vs Supabase) ===');
    let allOk = true;
    const extraNotes = [];
    TABLE_ORDER.forEach(function (table) {
        const fileCount = fileCounts[table];
        const remote = remoteCounts[table];
        const ok = remote >= fileCount;
        if (!ok) allOk = false;

        let statusLabel;
        if (!ok) {
            statusLabel = '!! FALTAN ' + (fileCount - remote) + ' !!';
        } else if (remote > fileCount) {
            statusLabel = 'OK (+' + (remote - fileCount) + ' extra)';
            extraNotes.push(table + ': +' + (remote - fileCount) + ' filas adicionales en la base (no vienen en este respaldo)');
        } else {
            statusLabel = 'OK';
        }

        console.log(
            '  ' + table.padEnd(14) + ' archivo=' + String(fileCount).padStart(5) +
            '  en-base=' + String(remote).padStart(5) +
            '  ' + statusLabel
        );
    });

    if (extraNotes.length) {
        console.log('\nInformativo — filas adicionales en la base que no vienen en este respaldo (NO es un fallo):');
        extraNotes.forEach(function (n) { console.log('  ' + n); });
    }

    console.log(allOk
        ? '\nOK — todas las filas del archivo procesado estan en Supabase (conteo remoto >= filas del archivo, en cada tabla).'
        : '\nFALTAN FILAS — el conteo remoto es menor al del archivo en al menos una tabla (ver detalle arriba). Revisar errores de upsert.');
    return allOk;
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
    const fileCounts = {};

    for (let t = 0; t < TABLE_ORDER.length; t++) {
        const table = TABLE_ORDER[t];
        const rows = Array.isArray(data[table]) ? data[table] : [];
        fileCounts[table] = rows.length;
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

    console.log('\nMigracion de datos completa. Verificando conteos remotos contra el archivo procesado...');
    const remoteCounts = await getRemoteCounts(client, TABLE_ORDER);
    return printFileVsRemoteSummary(fileCounts, remoteCounts);
}

// ============================================================================
// --verify-only: solo cuenta filas remotas, sin escribir nada. No recibe un
// archivo de respaldo (por diseño — ver README), asi que no hay "filas del
// archivo" contra las cuales comparar. Por eso es puramente INFORMATIVO
// (lista los conteos remotos junto al baseline del 25-jul como referencia) y
// nunca falla por diferencia de conteos — I-1 elimino ese pass/fail
// hardcodeado precisamente porque un negocio que sigue operando siempre va
// a tener mas filas que el baseline, y eso no es un error.
async function runVerifyOnly(env) {
    requireCredentials(env);
    console.log('=== Verificacion de conteos remotos (--verify-only, sin escritura) ===\n');
    console.log('Proyecto: ' + env.url + '\n');
    const client = createServiceClient(env);
    const counts = await getRemoteCounts(client, TABLE_ORDER);

    console.log('=== Conteos en Supabase (informativo, referencia baseline 25-jul) ===');
    TABLE_ORDER.forEach(function (table) {
        console.log('  ' + table.padEnd(14) + ' en-base=' + String(counts[table]).padStart(5) + '  (baseline 25-jul=' + BASELINE_COUNTS[table] + ')');
    });
    console.log('\n--verify-only no recibe un archivo de respaldo, asi que no hay "filas esperadas" contra las');
    console.log('cuales comparar — esto es solo un listado informativo de lo que hay hoy en Supabase.');
    console.log('Para confirmar que un respaldo especifico quedo completo en la base, usa --write con ese');
    console.log('archivo: la corrida real SI compara archivo vs remoto al final (ver printFileVsRemoteSummary).');
    return true;
}

// ============================================================================
// CLI
// ============================================================================
function printUsage() {
    console.log([
        'Uso:',
        '  node scripts/migrate-backup.js <ruta-al-backup.json> --dry-run',
        '  node scripts/migrate-backup.js <ruta-al-backup.json> --write',
        '  node scripts/migrate-backup.js --verify-only',
        '',
        'No hay modo por defecto: se requiere EXACTAMENTE una de las 3 flags de arriba. Cualquier otra',
        'flag (variantes como --dryrun, --dry_run, --DRY-RUN, -dry-run, --dry-run=true, etc.) es',
        'desconocida y termina en este mismo mensaje de uso, con exit code 1 — nunca escala a una',
        'corrida real por accidente.',
        '',
        'Modos:',
        '  --dry-run      Solo valida el respaldo y castea en memoria — NUNCA toca la red. No requiere',
        '                 .env. Requiere la ruta al respaldo.',
        '  --write        Corrida real: castea y hace upsert de las 8 tablas contra Supabase (lotes de',
        '                 100, por id), y al final compara el conteo remoto contra las filas del archivo',
        '                 procesado. Requiere .env con SUPABASE_URL y SUPABASE_SERVICE_KEY, y la ruta al',
        '                 respaldo.',
        '  --verify-only  Solo lista los conteos remotos actuales (informativo, junto al baseline del',
        '                 25-jul) — sin escribir nada. Requiere .env, no requiere la ruta al respaldo.'
    ].join('\n'));
}

// I-2 — Allowlist estricta. Cualquier flag que no calce EXACTO con una de
// estas 3 queda en "unknown" y el CLI corta con usage + exit 1 antes de
// llegar a ningun modo. Esto es lo que evita que "--dryrun", "--dry_run",
// "--DRY-RUN", "-dry-run" o "--dry-run=true" (que hoy NO calzan con
// "--dry-run" exacto) terminen silenciosamente disparando una corrida real.
const ALLOWED_FLAGS = ['--dry-run', '--verify-only', '--write'];

function parseArgs(argv) {
    const flags = {};
    const positionals = [];
    const unknown = [];
    argv.forEach(function (a) {
        if (a.charAt(0) === '-') {
            if (ALLOWED_FLAGS.indexOf(a) !== -1) flags[a] = true;
            else unknown.push(a);
        } else {
            positionals.push(a);
        }
    });
    return { flags: flags, backupPath: positionals[0], unknown: unknown };
}

// M-6b — Invariante de arranque: TABLE_ORDER (el orden de escritura de este
// script) y BACKUP_TABLES (derivado de tests/verify-schema-sql.js a partir
// de supabase/schema.sql) deben tener exactamente el mismo conjunto de
// tablas. Si alguien agrega/quita una tabla de negocio en un lugar y se
// olvida del otro, esto debe fallar ruidoso en vez de migrar 7 de 8 tablas
// en silencio. Acepta overrides solo para poder testear el caso negativo.
function assertTableOrderMatchesBackupTables(tableOrder, backupTables) {
    tableOrder = tableOrder || TABLE_ORDER;
    backupTables = backupTables || BACKUP_TABLES;
    const a = tableOrder.slice().sort();
    const b = backupTables.slice().sort();
    const same = a.length === b.length && a.every(function (v, i) { return v === b[i]; });
    if (!same) {
        throw new Error(
            'TABLE_ORDER y BACKUP_TABLES no tienen el mismo conjunto de tablas.\n' +
            '  TABLE_ORDER:   ' + tableOrder.join(', ') + '\n' +
            '  BACKUP_TABLES: ' + backupTables.join(', ') + '\n' +
            'Si se agrego o quito una tabla de negocio, actualiza TABLE_ORDER en migrate-backup.js para que calce.'
        );
    }
}

// M-5 — Invariante de arranque: si NUMERIC_FIELDS_BY_TABLE o
// BIGINT_FIELDS_BY_TABLE vienen vacios (supabase/schema.sql ausente o no
// parseable — ver tests/verify-schema-sql.js, que devuelve {} en ese caso),
// el script NUNCA debe seguir y correr en verde sin castear ningun campo.
// Corre en TODOS los modos, incluido --dry-run. Acepta overrides solo para
// poder testear el caso negativo sin tocar el schema.sql real del repo.
function assertCastListsPresent(numericMap, bigintMap) {
    numericMap = numericMap || NUMERIC_FIELDS_BY_TABLE;
    bigintMap = bigintMap || BIGINT_FIELDS_BY_TABLE;

    if (Object.keys(numericMap).length === 0 || Object.keys(bigintMap).length === 0) {
        throw new Error(
            'No se pudo derivar NUMERIC_FIELDS_BY_TABLE/BIGINT_FIELDS_BY_TABLE desde supabase/schema.sql\n' +
            '(el archivo no existe o no se pudo parsear). Sin esta lista el script no puede castear ningun\n' +
            'campo numerico de forma segura — abortando en vez de correr en verde sin castear nada.\n' +
            'Verifica que supabase/schema.sql exista en la raiz del repo con el formato esperado\n' +
            '(CREATE TABLE IF NOT EXISTS public.<tabla> (...);).'
        );
    }

    const missingTables = BACKUP_TABLES.filter(function (t) {
        return !Array.isArray(numericMap[t]) || !Array.isArray(bigintMap[t]);
    });
    if (missingTables.length) {
        throw new Error(
            'supabase/schema.sql no define (o no se pudieron parsear las columnas de) estas tablas: ' +
            missingTables.join(', ') + '.\n' +
            'Sin la definicion de columnas no se puede saber que campos castear a Number para esas tablas — abortando.'
        );
    }
}

function handleFatal(err) {
    console.error('\nERROR FATAL: ' + (err && err.message ? err.message : err));
    process.exit(1);
}

async function main() {
    const parsed = parseArgs(process.argv.slice(2));

    // I-2: flag desconocida -> usage + exit 1, sin tocar red ni archivo.
    if (parsed.unknown.length) {
        console.error('ERROR: flag(s) desconocida(s): ' + parsed.unknown.join(', ') + '\n');
        printUsage();
        process.exit(1);
        return;
    }

    const dryRun = !!parsed.flags['--dry-run'];
    const verifyOnly = !!parsed.flags['--verify-only'];
    const write = !!parsed.flags['--write'];
    const modeCount = (dryRun ? 1 : 0) + (verifyOnly ? 1 : 0) + (write ? 1 : 0);

    if (modeCount > 1) {
        console.error('ERROR: --dry-run, --verify-only y --write son excluyentes entre si (se recibio mas de uno).\n');
        printUsage();
        process.exit(1);
        return;
    }

    // I-2: no hay modo por defecto. Sin ninguna flag -> usage + exit 1.
    if (modeCount === 0) {
        console.error('ERROR: falta especificar un modo (--dry-run, --write o --verify-only). No hay modo por defecto.\n');
        printUsage();
        process.exit(1);
        return;
    }

    // M-6b / M-5: invariantes del script. Corren en TODOS los modos, antes
    // de tocar archivo o red — si fallan, el error es claro y el proceso
    // sale con codigo 1 en vez de seguir y castear (o no castear) en silencio.
    assertTableOrderMatchesBackupTables();
    assertCastListsPresent();

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

    // write (corrida real)
    if (!parsed.backupPath) {
        console.error('ERROR: --write requiere la ruta al backup.\n');
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
    requireCredentials: requireCredentials,
    castField: castField,
    castRow: castRow,
    validateBackupStructure: validateBackupStructure,
    runDryRun: runDryRun,
    printFileVsRemoteSummary: printFileVsRemoteSummary,
    baselineNote: baselineNote,
    parseArgs: parseArgs,
    ALLOWED_FLAGS: ALLOWED_FLAGS,
    assertTableOrderMatchesBackupTables: assertTableOrderMatchesBackupTables,
    assertCastListsPresent: assertCastListsPresent,
    MIN_SERVICE_KEY_LENGTH: MIN_SERVICE_KEY_LENGTH,
    BASELINE_COUNTS: BASELINE_COUNTS,
    TABLE_ORDER: TABLE_ORDER
};

if (require.main === module) {
    main().catch(handleFatal);
}
