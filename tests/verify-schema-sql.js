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

// --------------------------------------------------------------------------
// Parser de politicas: extrae nombre + roles de USING/WITH CHECK de un bloque
// CREATE POLICY. No es un parser SQL general — hace matching de parentesis
// balanceados (no un regex ingenuo) porque el contenido real tiene parentesis
// anidados, ej. USING ((SELECT public.get_role()) IN ('a', 'b')).
// --------------------------------------------------------------------------
function extractParenAfter(text, keywordRegex) {
    const m = keywordRegex.exec(text);
    if (!m) return null;
    let i = m.index + m[0].length;
    while (i < text.length && text[i] !== '(') i++;
    if (text[i] !== '(') return null;
    let depth = 0;
    const start = i;
    for (; i < text.length; i++) {
        if (text[i] === '(') depth++;
        else if (text[i] === ')') {
            depth--;
            if (depth === 0) return text.slice(start + 1, i);
        }
    }
    return null;
}

// Devuelve 'any' (USING/WITH CHECK true, sin gating por rol), un array de
// roles ordenado (de un IN (...) o un = 'rol'), o null si no reconoce el patron.
function parsePolicyRoles(clauseText) {
    const trimmed = clauseText.trim();
    if (/^true$/i.test(trimmed)) return 'any';
    const inMatch = trimmed.match(/IN\s*\(([^)]*)\)/i);
    if (inMatch) {
        return inMatch[1].split(',').map(function (s) {
            return s.trim().replace(/^'|'$/g, '');
        }).sort();
    }
    const eqMatch = trimmed.match(/=\s*'([^']*)'/);
    if (eqMatch) return [eqMatch[1]];
    return null;
}

function parsePolicyBlock(block) {
    const nameMatch = block.match(/CREATE POLICY\s+"([^"]+)"/);
    const name = nameMatch ? nameMatch[1] : '(sin nombre)';
    const result = { name: name };
    const usingContent = extractParenAfter(block, /\bUSING\s*/i);
    const checkContent = extractParenAfter(block, /\bWITH\s+CHECK\s*/i);
    if (usingContent !== null) result.USING = parsePolicyRoles(usingContent);
    if (checkContent !== null) result['WITH CHECK'] = parsePolicyRoles(checkContent);
    return result;
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

// Matriz exacta de roles esperados por politica y clausula (USING / WITH
// CHECK). 'any' = sin gating por rol (USING/WITH CHECK true, cualquier
// authenticated). Si alguien agrega o quita un rol de una politica de
// escritura (o cambia una politica de lectura abierta a una con gating), esta
// prueba lo detecta explicitamente en vez de dejarlo pasar en silencio.
const EXPECTED_POLICY_MATRIX = {
    ventas_select_authenticated:       { USING: 'any' },
    ventas_write_comercial:            { USING: ['comercial', 'socio', 'superadmin'], 'WITH CHECK': ['comercial', 'socio', 'superadmin'] },
    ventas_update_operaciones:         { USING: ['operaciones'], 'WITH CHECK': ['operaciones'] },
    facturas_select_authenticated:     { USING: 'any' },
    facturas_write_comercial:          { USING: ['comercial', 'socio', 'superadmin'], 'WITH CHECK': ['comercial', 'socio', 'superadmin'] },
    cotizaciones_select_authenticated: { USING: 'any' },
    cotizaciones_write_comercial:      { USING: ['comercial', 'socio', 'superadmin'], 'WITH CHECK': ['comercial', 'socio', 'superadmin'] },
    costos_select_authenticated:       { USING: 'any' },
    costos_write_socios:               { USING: ['socio', 'superadmin'], 'WITH CHECK': ['socio', 'superadmin'] },
    servicios_all_authenticated:       { USING: 'any', 'WITH CHECK': 'any' },
    personal_all_authenticated:        { USING: 'any', 'WITH CHECK': 'any' },
    clientes_all_authenticated:        { USING: 'any', 'WITH CHECK': 'any' },
    equipos_all_authenticated:         { USING: 'any', 'WITH CHECK': 'any' },
    config_select_authenticated:       { USING: 'any' },
    config_write_socios:               { USING: ['socio', 'superadmin'], 'WITH CHECK': ['socio', 'superadmin'] },
    profiles_select_authenticated:     { USING: 'any' },
    profiles_update_superadmin:        { USING: ['superadmin'], 'WITH CHECK': ['superadmin'] }
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
    } else if (process.env.SKIP_BACKUP_CHECK === '1') {
        console.error('AVISO: no se encontró el respaldo real en ' + backupPath +
            ' — SKIP_BACKUP_CHECK=1 activo, se omiten intencionalmente los checks (b)/(e) contra datos reales.');
    } else {
        console.error('ERROR: no se encontró el respaldo real en ' + backupPath + '.');
        console.error('Este verificador requiere el respaldo para validar la cobertura de columnas (check b) y');
        console.error('el conteo de filas esperado contra datos reales — no se puede omitir en silencio.');
        console.error('Opciones: pasa --backup=<ruta> o la variable de entorno MAZELAB_BACKUP_PATH para apuntar');
        console.error('a otro lugar, o exporta SKIP_BACKUP_CHECK=1 para omitir esta verificación a propósito');
        console.error('(solo para máquinas que no tienen el respaldo — no usar por defecto).');
        process.exit(1);
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

    // (f) Matriz exacta de roles por política — falla si se agrega/quita un rol
    t('(f) matriz exacta de roles permitidos por política (USING / WITH CHECK)', function () {
        const found = {};
        parsed.policyBlocks.forEach(function (block) {
            const p = parsePolicyBlock(block);
            found[p.name] = p;
        });
        const errors = [];
        Object.keys(EXPECTED_POLICY_MATRIX).forEach(function (name) {
            const expected = EXPECTED_POLICY_MATRIX[name];
            const actual = found[name];
            if (!actual) { errors.push(name + ': política no encontrada en schema.sql'); return; }
            ['USING', 'WITH CHECK'].forEach(function (clause) {
                if (!(clause in expected)) return;
                const expRoles = expected[clause];
                const actRoles = actual[clause];
                if (expRoles === 'any') {
                    if (actRoles !== 'any') {
                        errors.push(name + '.' + clause + ': se esperaba acceso abierto (true), se encontró ' + JSON.stringify(actRoles));
                    }
                } else {
                    const a = Array.isArray(actRoles) ? actRoles.slice().sort() : null;
                    const e = expRoles.slice().sort();
                    if (!a || a.join('|') !== e.join('|')) {
                        errors.push(name + '.' + clause + ': se esperaban roles [' + e.join(', ') + '], se encontraron [' +
                            (a ? a.join(', ') : 'ninguno / patrón no reconocido') + ']');
                    }
                }
            });
        });
        Object.keys(found).forEach(function (name) {
            if (!EXPECTED_POLICY_MATRIX[name]) {
                errors.push(name + ': política presente en schema.sql pero no está en EXPECTED_POLICY_MATRIX (actualizar el verificador)');
            }
        });
        assert(errors.length === 0, errors.join(' || '));
    });

    // (g) Toda política declara "TO authenticated" explícito
    t('(g) toda CREATE POLICY declara "TO authenticated" (ni anon, ni public, ni ausente)', function () {
        const offenders = [];
        parsed.policyBlocks.forEach(function (block) {
            const nameMatch = block.match(/CREATE POLICY\s+"([^"]+)"/);
            const name = nameMatch ? nameMatch[1] : '(sin nombre)';
            if (/\bTO\s+anon\b/i.test(block)) { offenders.push(name + ': declara TO anon'); return; }
            if (/\bTO\s+public\b/i.test(block)) { offenders.push(name + ': declara TO public'); return; }
            if (!/\bTO\s+authenticated\b/i.test(block)) {
                offenders.push(name + ': no declara TO authenticated (la ausencia de TO implica PUBLIC en Postgres)');
            }
        });
        assert(offenders.length === 0, offenders.join(' || '));
    });

    // (h) Transacción completa + orden del trigger sobre auth.users
    t('(h) el archivo abre con BEGIN; y cierra con COMMIT;', function () {
        // La primera sentencia SQL real (ignorando líneas en blanco y
        // comentarios de cabecera "--") debe ser BEGIN;
        const lines = sqlText.split(/\r?\n/);
        let i = 0;
        while (i < lines.length && (lines[i].trim() === '' || lines[i].trim().indexOf('--') === 0)) i++;
        const firstStatement = lines.slice(i).join('\n').trim();
        assert(/^BEGIN\s*;/i.test(firstStatement), 'la primera sentencia SQL (ignorando comentarios) no es BEGIN;');

        const trimmed = sqlText.trim();
        assert(/COMMIT\s*;\s*$/i.test(trimmed), 'el archivo no cierra con COMMIT; (última sentencia)');
    });

    t('(h) el trigger on_auth_user_created (sobre auth.users) está después de los REVOKE', function () {
        const revokeIdx = sqlText.lastIndexOf('REVOKE');
        const triggerIdx = sqlText.indexOf('CREATE TRIGGER on_auth_user_created');
        assert(revokeIdx !== -1, 'no se encontró ningún REVOKE en schema.sql');
        assert(triggerIdx !== -1, 'no se encontró CREATE TRIGGER on_auth_user_created en schema.sql');
        assert(triggerIdx > revokeIdx, 'CREATE TRIGGER on_auth_user_created debe estar después del último REVOKE — es la sentencia más propensa a fallar (permisos sobre auth.users) y no debe dejar tablas con RLS a medio aplicar si falla');
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
