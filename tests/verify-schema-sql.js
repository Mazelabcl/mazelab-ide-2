// Verificación Lote M1-A (Sprint M1) — parsea supabase/schema.sql y lo valida
// contra el respaldo real de PostgreSQL (mazelab-backup-2026-07-25.json).
//
// Corre con:  node tests/verify-schema-sql.js
// Ruta del respaldo: por defecto C:\Users\aldot\Downloads\mazelab-backup-2026-07-25.json,
// override con --backup=<ruta> o variable de entorno MAZELAB_BACKUP_PATH.
//
// Chequea:
//   (a) Las 10 tablas (8 de negocio + profiles + config) están en schema.sql.
//   (b) Toda columna que aparece en CUALQUIER fila del respaldo real existe
//       en el DDL de su tabla, con el nombre exacto (case-sensitive, citado).
//   (c) ENABLE ROW LEVEL SECURITY presente para las 10 tablas.
//   (d) Cero políticas ni grants que otorguen acceso a `anon`.
//   (e) Los campos NUMERIC del schema quedan expuestos vía module.exports
//       para que el script de migración (Lote M1-C) los reuse al castear
//       string -> number antes de insertar.
//
// También es requireable como módulo: `require('./verify-schema-sql')` da
// { NUMERIC_FIELDS_BY_TABLE, BIGINT_FIELDS_BY_TABLE, TABLES, parseSchema }
// sin ejecutar el runner (el runner solo corre si se invoca directamente).
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const SCHEMA_PATH = path.join(REPO, 'supabase', 'schema.sql');

const DEFAULT_BACKUP_PATH = 'C:\\Users\\aldot\\Downloads\\mazelab-backup-2026-07-25.json';

function resolveBackupPath() {
    const argFlag = process.argv.find(function (a) { return a.indexOf('--backup=') === 0; });
    if (argFlag) return argFlag.slice('--backup='.length);
    if (process.env.MAZELAB_BACKUP_PATH) return process.env.MAZELAB_BACKUP_PATH;
    return DEFAULT_BACKUP_PATH;
}

// Las 8 tablas de negocio del respaldo real (TABLA JSON -> tabla Postgres,
// son el mismo nombre) + las 2 tablas nuevas que schema.sql agrega sin
// respaldo (profiles/config no existen en el JSON, se validan aparte).
const BACKUP_TABLES = ['ventas', 'facturas', 'costos', 'servicios', 'personal', 'clientes', 'equipos', 'cotizaciones'];
const NEW_TABLES = ['profiles', 'config'];
const ALL_TABLES = BACKUP_TABLES.concat(NEW_TABLES);

// --------------------------------------------------------------------------
// Parser de schema.sql (regex-based, no es un parser SQL general — asume el
// formato que este mismo repo escribe: un CREATE TABLE por bloque, una
// columna citada por línea dentro del bloque).
// --------------------------------------------------------------------------
function parseSchema(sqlText) {
    const tables = {}; // tableName -> { columns: { colName: type }, raw }
    const tableRe = /CREATE TABLE IF NOT EXISTS public\.(\w+)\s*\(\r?\n([\s\S]*?)\r?\n\);/g;
    let m;
    while ((m = tableRe.exec(sqlText))) {
        const tableName = m[1];
        const body = m[2];
        const columns = {};
        body.split(/\r?\n/).forEach(function (line) {
            const colMatch = line.match(/^\s*"(\w+)"\s+([A-Za-z]+)/);
            if (colMatch) {
                columns[colMatch[1]] = colMatch[2].toUpperCase();
            }
        });
        tables[tableName] = { columns: columns, raw: m[0] };
    }

    const rlsEnabled = {};
    const rlsRe = /ALTER TABLE public\.(\w+)\s+ENABLE ROW LEVEL SECURITY/g;
    while ((m = rlsRe.exec(sqlText))) {
        rlsEnabled[m[1]] = true;
    }

    const policyBlocks = sqlText.match(/CREATE POLICY[\s\S]*?;/g) || [];
    const grantBlocks = sqlText.match(/GRANT[\s\S]*?;/g) || [];

    return { tables: tables, rlsEnabled: rlsEnabled, policyBlocks: policyBlocks, grantBlocks: grantBlocks };
}

function buildNumericFieldsByTable(parsed) {
    const numeric = {};
    const bigint = {};
    Object.keys(parsed.tables).forEach(function (t) {
        const cols = parsed.tables[t].columns;
        numeric[t] = Object.keys(cols).filter(function (c) { return cols[c] === 'NUMERIC'; });
        bigint[t] = Object.keys(cols).filter(function (c) { return cols[c] === 'BIGINT'; });
    });
    return { numeric: numeric, bigint: bigint };
}

// --------------------------------------------------------------------------
// Union de campos reales del respaldo (recorre TODAS las filas).
// --------------------------------------------------------------------------
function unionFieldsFromBackup(backupData) {
    const result = {};
    BACKUP_TABLES.forEach(function (table) {
        const rows = backupData[table] || [];
        const fields = new Set();
        rows.forEach(function (row) {
            Object.keys(row).forEach(function (k) { fields.add(k); });
        });
        result[table] = fields;
    });
    return result;
}

// Lista esperada de campos NUMERIC por tabla, derivada a mano del mismo
// análisis fila-por-fila del respaldo que produjo schema.sql (ver comentario
// de cabecera de supabase/schema.sql). Sirve como cross-check: si alguien
// edita schema.sql y desmarca/olvida un campo monetario, esta prueba lo
// detecta en vez de fallar en silencio en el Lote M1-C.
const EXPECTED_NUMERIC_FIELDS = {
    ventas: ['amount', 'boardColumn', 'comisionPct', 'costAmount', 'jornadas', 'refundAmount', 'utility'],
    facturas: ['amount', 'amountPaid', 'invoicedAmount', 'montoFacturado', 'montoNeto', 'monto_venta', 'paymentTerms', 'pendingAmount'],
    costos: ['amount', 'amountPaid'],
    servicios: ['costo_base_estimado', 'duracion_default', 'precio_base'],
    personal: [],
    clientes: ['plazo_pago'],
    equipos: [],
    cotizaciones: ['descuento', 'descuentoPct', 'subtotal', 'totalNeto', 'validezDias', 'version']
};

// --------------------------------------------------------------------------
// Runner
// --------------------------------------------------------------------------
let pass = 0, fail = 0;
function t(name, fn) {
    try {
        fn();
        pass++;
        console.log('  OK  ' + name);
    } catch (e) {
        fail++;
        console.error('FAIL  ' + name + ' — ' + (e && e.message ? e.message : e));
    }
}
function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'assertion failed');
}

function runVerification() {
    if (!fs.existsSync(SCHEMA_PATH)) {
        console.error('No se encontró supabase/schema.sql en ' + SCHEMA_PATH);
        process.exit(1);
    }
    const sqlText = fs.readFileSync(SCHEMA_PATH, 'utf8');
    const parsed = parseSchema(sqlText);
    const numericInfo = buildNumericFieldsByTable(parsed);

    const backupPath = resolveBackupPath();
    let backupData = null;
    let backupAvailable = false;
    if (fs.existsSync(backupPath)) {
        try {
            backupData = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
            backupAvailable = true;
        } catch (e) {
            console.error('No se pudo parsear el respaldo en ' + backupPath + ': ' + e.message);
        }
    } else {
        console.error('AVISO: no se encontró el respaldo real en ' + backupPath +
            ' — se omiten los checks (b)/(e) contra datos reales. Pasa --backup=<ruta> para apuntar a otro lugar.');
    }

    console.log('=== Verificación supabase/schema.sql ===\n');

    // (a) Las 10 tablas presentes
    t('(a) las 10 tablas están presentes en schema.sql', function () {
        const missing = ALL_TABLES.filter(function (tbl) { return !parsed.tables[tbl]; });
        assert(missing.length === 0, 'faltan tablas: ' + missing.join(', '));
        assert(Object.keys(parsed.tables).length === 10,
            'se esperaban exactamente 10 CREATE TABLE, se encontraron ' + Object.keys(parsed.tables).length +
            ' (' + Object.keys(parsed.tables).join(', ') + ')');
    });

    // (b) Cobertura de columnas del respaldo real
    if (backupAvailable) {
        const realFields = unionFieldsFromBackup(backupData);
        BACKUP_TABLES.forEach(function (table) {
            t('(b) ' + table + ': todas las columnas del respaldo existen en el DDL', function () {
                const schemaCols = parsed.tables[table] ? parsed.tables[table].columns : {};
                const missing = [];
                realFields[table].forEach(function (f) {
                    if (!Object.prototype.hasOwnProperty.call(schemaCols, f)) missing.push(f);
                });
                assert(missing.length === 0,
                    table + ' — columnas del respaldo ausentes en schema.sql: ' + missing.join(', '));
            });
        });

        t('(b) conteo de filas del respaldo coincide con lo esperado (992/1150/3615/70/2/599/2/16)', function () {
            const expected = { ventas: 992, facturas: 1150, costos: 3615, servicios: 70, personal: 2, clientes: 599, equipos: 2, cotizaciones: 16 };
            const diffs = [];
            Object.keys(expected).forEach(function (table) {
                const n = (backupData[table] || []).length;
                if (n !== expected[table]) diffs.push(table + ': esperado ' + expected[table] + ', real ' + n);
            });
            assert(diffs.length === 0, diffs.join(' | '));
        });
    } else {
        console.log('  SKIP  (b) checks contra el respaldo real (archivo no encontrado)');
    }

    // (c) RLS habilitado en las 10
    t('(c) ENABLE ROW LEVEL SECURITY presente en las 10 tablas', function () {
        const missing = ALL_TABLES.filter(function (tbl) { return !parsed.rlsEnabled[tbl]; });
        assert(missing.length === 0, 'sin RLS habilitado: ' + missing.join(', '));
    });

    // (d) Cero políticas/grants para anon
    t('(d) ninguna política CREATE POLICY otorga acceso a anon', function () {
        const offenders = parsed.policyBlocks.filter(function (block) { return /\bTO\s+anon\b/i.test(block); });
        assert(offenders.length === 0, offenders.length + ' política(s) con "TO anon": ' + offenders.join(' || '));
    });
    t('(d) ningún GRANT otorga privilegios a anon', function () {
        const offenders = parsed.grantBlocks.filter(function (block) { return /\bTO\s+anon\b/i.test(block); });
        assert(offenders.length === 0, offenders.length + ' GRANT(s) con "TO anon": ' + offenders.join(' || '));
    });

    // (e) NUMERIC fields cross-check contra la lista esperada (derivada a mano
    // del mismo análisis fila-por-fila que produjo schema.sql)
    Object.keys(EXPECTED_NUMERIC_FIELDS).forEach(function (table) {
        t('(e) ' + table + ': columnas NUMERIC del schema cubren los campos monetarios/porcentuales esperados', function () {
            const actual = numericInfo.numeric[table] || [];
            const missing = EXPECTED_NUMERIC_FIELDS[table].filter(function (f) { return actual.indexOf(f) === -1; });
            assert(missing.length === 0,
                table + ' — se esperaban NUMERIC y no lo son (o no existen) en schema.sql: ' + missing.join(', '));
        });
    });

    t('(e) boardOrder es BIGINT (único caso, epoch-millis)', function () {
        const big = numericInfo.bigint.ventas || [];
        assert(big.indexOf('boardOrder') !== -1, 'ventas."boardOrder" no está declarado BIGINT en schema.sql');
    });

    console.log('\n' + pass + ' OK, ' + fail + ' FAIL');
    return fail === 0;
}

module.exports = {
    parseSchema: parseSchema,
    buildNumericFieldsByTable: buildNumericFieldsByTable,
    NUMERIC_FIELDS_BY_TABLE: (function () {
        // Se recalcula perezosamente contra el schema.sql actual en disco,
        // para que M1-C siempre reuse la lista vigente sin re-implementar el parser.
        if (!fs.existsSync(SCHEMA_PATH)) return {};
        const parsed = parseSchema(fs.readFileSync(SCHEMA_PATH, 'utf8'));
        return buildNumericFieldsByTable(parsed).numeric;
    })(),
    BIGINT_FIELDS_BY_TABLE: (function () {
        if (!fs.existsSync(SCHEMA_PATH)) return {};
        const parsed = parseSchema(fs.readFileSync(SCHEMA_PATH, 'utf8'));
        return buildNumericFieldsByTable(parsed).bigint;
    })(),
    BACKUP_TABLES: BACKUP_TABLES,
    ALL_TABLES: ALL_TABLES
};

if (require.main === module) {
    const ok = runVerification();
    process.exit(ok ? 0 : 1);
}
