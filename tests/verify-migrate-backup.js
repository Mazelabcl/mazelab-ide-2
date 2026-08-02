// Verificación del fix round del Lote M1-C (Sprint M1) sobre
// scripts/migrate-backup.js — revisión adversarial del commit ffd3dfb.
// Corre con: node tests/verify-migrate-backup.js
//
// Cubre los 6 hallazgos del fix round:
//   I-1  Conteos contra el archivo (dry-run informativo + corrida real con
//        printFileVsRemoteSummary: remoto >= archivo, extras = info no fallo).
//   I-2  parseArgs con allowlist estricta (--dry-run/--verify-only/--write) —
//        flags hostiles (--dryrun, --dry-run=true, -dry-run, --DRY-RUN, sin
//        flags) quedan en "unknown", nunca escalan a corrida real.
//   M-1  castField rechaza strings que Number() castearía en silencio
//        (hex, "Infinity", exponencial, digitos fuera de rango).
//   M-3  requireCredentials revienta si SUPABASE_SERVICE_KEY < 100 chars.
//   M-5  assertCastListsPresent revienta si las listas NUMERIC/BIGINT vienen
//        vacías o a una tabla de negocio le falta la entrada.
//   M-6b assertTableOrderMatchesBackupTables revienta si TABLE_ORDER y
//        BACKUP_TABLES no tienen el mismo conjunto de tablas.
//
// No requiere red ni .env — todo lo que toca Supabase queda fuera de esta
// suite (se verificó a mano: dry-run real contra el respaldo del 25-jul,
// flags hostiles vía CLI, y el guard de key truncada con un .env de prueba).
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const SCRIPT_PATH = path.join(REPO, 'scripts', 'migrate-backup.js');
const MB = require(SCRIPT_PATH);

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

function assertThrows(fn, matcher, msg) {
    let threw = false, err = null;
    try { fn(); } catch (e) { threw = true; err = e; }
    assert.ok(threw, msg || 'se esperaba que lanzara, pero no lo hizo');
    if (matcher) assert.ok(matcher.test(err.message), 'mensaje no matchea ' + matcher + ': "' + err.message + '"');
    return err;
}

// Directorio temporal propio (no toca el repo ni el scratchpad de la sesión —
// esta suite debe poder correr en cualquier máquina/CI).
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mazelab-migrate-test-'));

function writeFixtureBackup(overrides) {
    const base = {
        ventas: [], facturas: [], costos: [], servicios: [],
        personal: [], clientes: [], equipos: [], cotizaciones: []
    };
    const data = Object.assign(base, overrides || {});
    const file = path.join(TMP_DIR, 'fixture-' + Math.random().toString(36).slice(2) + '.json');
    fs.writeFileSync(file, JSON.stringify(data));
    return file;
}

console.log('=== Verificación fix round Lote M1-C (migrate-backup.js) ===\n');

// ============================================================================
// M-1 — castField: regex estricta antes de Number(), nunca Infinity/hex en
// silencio.
// ============================================================================

t('(M-1) castField: decimal simple se castea a Number', function () {
    const r = MB.castField('150000.75', false);
    assert.strictEqual(r.castable, true);
    assert.strictEqual(r.changed, true);
    assert.strictEqual(r.value, 150000.75);
});

t('(M-1) castField: entero negativo se castea a Number', function () {
    const r = MB.castField('-42', false);
    assert.strictEqual(r.castable, true);
    assert.strictEqual(r.value, -42);
});

t('(M-1) castField: string vacia -> null (comportamiento preexistente intacto)', function () {
    const r = MB.castField('', false);
    assert.strictEqual(r.castable, true);
    assert.strictEqual(r.value, null);
    assert.strictEqual(r.emptyToNull, true);
});

t('(M-1) castField: null pasa intacto', function () {
    const r = MB.castField(null, false);
    assert.strictEqual(r.castable, true);
    assert.strictEqual(r.value, null);
    assert.strictEqual(r.changed, false);
});

t('(M-1) castField: number nativo pasa intacto sin recastear', function () {
    const r = MB.castField(42, false);
    assert.strictEqual(r.castable, true);
    assert.strictEqual(r.value, 42);
    assert.strictEqual(r.changed, false);
});

t('(M-1) castField: "0x1F" (hex) se reporta NO casteable, nunca 31 en silencio', function () {
    const r = MB.castField('0x1F', false);
    assert.strictEqual(r.castable, false);
    assert.ok(/no es numerico/.test(r.reason));
});

t('(M-1) castField: "Infinity" se reporta NO casteable, nunca Infinity en silencio', function () {
    const r = MB.castField('Infinity', false);
    assert.strictEqual(r.castable, false);
});

t('(M-1) castField: "-Infinity" se reporta NO casteable', function () {
    const r = MB.castField('-Infinity', false);
    assert.strictEqual(r.castable, false);
});

t('(M-1) castField: "NaN" se reporta NO casteable', function () {
    const r = MB.castField('NaN', false);
    assert.strictEqual(r.castable, false);
});

t('(M-1) castField: notacion exponencial "1e10" se reporta NO casteable', function () {
    const r = MB.castField('1e10', false);
    assert.strictEqual(r.castable, false);
});

t('(M-1) castField: texto arbitrario "abc" se reporta NO casteable con id disponible via castRow', function () {
    const r = MB.castField('abc', false);
    assert.strictEqual(r.castable, false);
    assert.ok(/abc/.test(r.reason));
});

t('(M-1) castField: cadena de 400 digitos (Infinity al evaluar) se reporta NO casteable', function () {
    const hugeDigits = '9'.repeat(400);
    // Confirma la premisa: el string SI calza el regex numérico pero Number() da Infinity.
    assert.strictEqual(Number.isFinite(Number(hugeDigits)), false, 'la premisa del test asume que este string evalua a Infinity');
    const r = MB.castField(hugeDigits, false);
    assert.strictEqual(r.castable, false);
    assert.ok(/fuera de rango/.test(r.reason));
});

t('(M-1) castField: BIGINT que excede MAX_SAFE_INTEGER se preserva como string (comportamiento preexistente intacto)', function () {
    const big = '9007199254740993'; // MAX_SAFE_INTEGER + 2, string numerica valida
    const r = MB.castField(big, true);
    assert.strictEqual(r.castable, true);
    assert.strictEqual(r.keptAsString, true);
    assert.strictEqual(r.value, big);
});

t('(M-1) castRow: reporta el id de la fila para un campo no-casteable', function () {
    const row = { id: 'v-999', amount: '0x10' };
    const result = MB.castRow(row, ['amount'], []);
    const bad = result.report.find(function (r) { return r.field === 'amount'; });
    assert.ok(bad, 'debe reportar el campo amount');
    assert.strictEqual(bad.castable, false);
});

// ============================================================================
// I-2 — parseArgs: allowlist estricta. Ninguna variante hostil debe colarse
// como flag reconocida.
// ============================================================================

t('(I-2) parseArgs: --dry-run exacto se reconoce', function () {
    const p = MB.parseArgs(['backup.json', '--dry-run']);
    assert.strictEqual(!!p.flags['--dry-run'], true);
    assert.strictEqual(p.unknown.length, 0);
    assert.strictEqual(p.backupPath, 'backup.json');
});

t('(I-2) parseArgs: --write y --verify-only se reconocen', function () {
    assert.strictEqual(!!MB.parseArgs(['x.json', '--write']).flags['--write'], true);
    assert.strictEqual(!!MB.parseArgs(['--verify-only']).flags['--verify-only'], true);
});

['--dryrun', '--dry_run', '--DRY-RUN', '-dry-run', '--dry-run=true', '--verifyonly', '--Write', '--random-flag'].forEach(function (hostile) {
    t('(I-2) parseArgs: "' + hostile + '" queda en unknown, NO se reconoce como flag valida', function () {
        const p = MB.parseArgs(['backup.json', hostile]);
        assert.ok(p.unknown.indexOf(hostile) !== -1, 'debia quedar en unknown: ' + hostile);
        assert.strictEqual(Object.keys(p.flags).length, 0, 'no debia registrarse ninguna flag reconocida');
    });
});

t('(I-2) parseArgs: sin argumentos -> sin flags, sin unknown, sin backupPath', function () {
    const p = MB.parseArgs([]);
    assert.strictEqual(Object.keys(p.flags).length, 0);
    assert.strictEqual(p.unknown.length, 0);
    assert.strictEqual(p.backupPath, undefined);
});

t('(I-2) ALLOWED_FLAGS es exactamente [--dry-run, --verify-only, --write]', function () {
    assert.deepStrictEqual(MB.ALLOWED_FLAGS.slice().sort(), ['--dry-run', '--verify-only', '--write'].sort());
});

// ============================================================================
// I-2 (CLI end-to-end) — subprocess real: confirma que las flags hostiles y
// la ausencia de flags terminan en usage + exit 1 SIN tocar red (no hay
// timeout, no hay intento de conexión — el proceso muere antes de llegar ahí).
// ============================================================================

function runCli(args, timeoutMs) {
    return spawnSync(process.execPath, [SCRIPT_PATH].concat(args), {
        encoding: 'utf8',
        timeout: timeoutMs || 10000
    });
}

['--dryrun', '--dry-run=true', '-dry-run', '--DRY-RUN'].forEach(function (hostile) {
    t('(I-2 CLI) "' + hostile + '" con ruta de backup -> exit 1, usage, sin tocar red', function () {
        const res = runCli(['algun-backup.json', hostile]);
        assert.strictEqual(res.status, 1, 'exit code debia ser 1, salida: ' + (res.stdout || '') + (res.stderr || ''));
        const out = (res.stdout || '') + (res.stderr || '');
        assert.ok(/desconocida/.test(out), 'debe reportar flag desconocida');
        assert.ok(/Uso:/.test(out), 'debe imprimir usage');
        assert.ok(!/fetch failed|ECONNREFUSED|supabase\.co/i.test(out), 'no debe haber evidencia de intento de red');
    });
});

t('(I-2 CLI) sin ninguna flag -> exit 1, usage, "no hay modo por defecto"', function () {
    const res = runCli(['algun-backup.json']);
    assert.strictEqual(res.status, 1);
    const out = (res.stdout || '') + (res.stderr || '');
    assert.ok(/no hay modo por defecto/i.test(out));
    assert.ok(/Uso:/.test(out));
});

t('(I-2 CLI) --dry-run y --write juntos -> exit 1, excluyentes entre si', function () {
    const res = runCli(['algun-backup.json', '--dry-run', '--write']);
    assert.strictEqual(res.status, 1);
    const out = (res.stdout || '') + (res.stderr || '');
    assert.ok(/excluyentes/i.test(out));
});

// ============================================================================
// M-5 — assertCastListsPresent: nunca debe correr en verde sin listas de cast.
// ============================================================================

t('(M-5) assertCastListsPresent: con el schema.sql real del repo, NO revienta', function () {
    MB.assertCastListsPresent(); // usa las listas reales derivadas de supabase/schema.sql
});

t('(M-5) assertCastListsPresent: con mapas totalmente vacios (schema.sql ausente/no parseable), revienta', function () {
    assertThrows(function () { MB.assertCastListsPresent({}, {}); }, /No se pudo derivar/);
});

t('(M-5) assertCastListsPresent: si a una tabla de negocio le falta la entrada, revienta con esa tabla nombrada', function () {
    const fakeNumeric = { ventas: ['amount'], facturas: [], costos: [], servicios: [], personal: [], clientes: [], equipos: [] }; // falta "cotizaciones"
    const fakeBigint = { ventas: ['boardOrder'], facturas: [], costos: [], servicios: [], personal: [], clientes: [], equipos: [], cotizaciones: [] };
    assertThrows(function () { MB.assertCastListsPresent(fakeNumeric, fakeBigint); }, /cotizaciones/);
});

// ============================================================================
// M-6b — assertTableOrderMatchesBackupTables: mismo conjunto de tablas.
// ============================================================================

t('(M-6b) assertTableOrderMatchesBackupTables: con TABLE_ORDER/BACKUP_TABLES reales del repo, NO revienta', function () {
    MB.assertTableOrderMatchesBackupTables();
});

t('(M-6b) assertTableOrderMatchesBackupTables: revienta si falta una tabla en TABLE_ORDER', function () {
    const order = ['clientes', 'servicios', 'personal', 'equipos', 'ventas', 'facturas', 'costos']; // falta cotizaciones
    const backup = ['clientes', 'servicios', 'personal', 'equipos', 'ventas', 'facturas', 'costos', 'cotizaciones'];
    assertThrows(function () { MB.assertTableOrderMatchesBackupTables(order, backup); }, /no tienen el mismo conjunto/);
});

t('(M-6b) assertTableOrderMatchesBackupTables: revienta si TABLE_ORDER trae una tabla que no esta en BACKUP_TABLES', function () {
    const order = ['clientes', 'servicios', 'personal', 'equipos', 'ventas', 'facturas', 'costos', 'tabla_fantasma'];
    const backup = ['clientes', 'servicios', 'personal', 'equipos', 'ventas', 'facturas', 'costos', 'cotizaciones'];
    assertThrows(function () { MB.assertTableOrderMatchesBackupTables(order, backup); }, /no tienen el mismo conjunto/);
});

// ============================================================================
// M-3 — requireCredentials: guard de key truncada.
// ============================================================================

t('(M-3) requireCredentials: sin .env -> revienta (comportamiento preexistente intacto)', function () {
    assertThrows(function () { MB.requireCredentials({ exists: false }); }, /No se encontro el archivo \.env/);
});

t('(M-3) requireCredentials: faltan claves -> revienta (comportamiento preexistente intacto)', function () {
    assertThrows(function () { MB.requireCredentials({ exists: true, url: undefined, key: undefined }); }, /Falta\(n\) variable/);
});

t('(M-3) requireCredentials: key corta (< 100 chars) -> revienta con mensaje de "truncada"', function () {
    const shortKey = 'short-key-truncated'; // 19 chars
    assert.ok(shortKey.length < MB.MIN_SERVICE_KEY_LENGTH);
    assertThrows(
        function () { MB.requireCredentials({ exists: true, url: 'https://x.supabase.co', key: shortKey }); },
        /truncada/
    );
});

t('(M-3) requireCredentials: key con largo plausible (>= 100 chars) NO revienta por el guard de largo', function () {
    const longKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' + 'x'.repeat(150) + '.firma-fake';
    assert.ok(longKey.length >= MB.MIN_SERVICE_KEY_LENGTH);
    MB.requireCredentials({ exists: true, url: 'https://x.supabase.co', key: longKey }); // no debe lanzar
});

// ============================================================================
// I-1 — printFileVsRemoteSummary: éxito = remoto >= archivo, por tabla. Extra
// en la base = informativo, nunca fallo. Faltante = fallo real.
// ============================================================================

t('(I-1) printFileVsRemoteSummary: conteos exactos -> OK', function () {
    const fileCounts = { clientes: 599, servicios: 70, personal: 2, equipos: 2, ventas: 992, facturas: 1150, costos: 3615, cotizaciones: 16 };
    const remoteCounts = Object.assign({}, fileCounts);
    assert.strictEqual(MB.printFileVsRemoteSummary(fileCounts, remoteCounts), true);
});

t('(I-1) printFileVsRemoteSummary: remoto CON MAS filas que el archivo -> sigue OK (informativo, no fallo)', function () {
    const fileCounts = { clientes: 599, servicios: 70, personal: 2, equipos: 2, ventas: 995, facturas: 1150, costos: 3615, cotizaciones: 16 };
    const remoteCounts = Object.assign({}, fileCounts, { ventas: 998 }); // +3 filas que no vienen en este respaldo
    assert.strictEqual(MB.printFileVsRemoteSummary(fileCounts, remoteCounts), true, 'un respaldo fresco con MAS filas en la base nunca debe reportarse como fallo (I-1)');
});

t('(I-1) printFileVsRemoteSummary: remoto CON MENOS filas que el archivo -> FALLA (upsert incompleto real)', function () {
    const fileCounts = { clientes: 599, servicios: 70, personal: 2, equipos: 2, ventas: 992, facturas: 1150, costos: 3615, cotizaciones: 16 };
    const remoteCounts = Object.assign({}, fileCounts, { ventas: 990 }); // faltan 2 filas de verdad
    assert.strictEqual(MB.printFileVsRemoteSummary(fileCounts, remoteCounts), false);
});

// ============================================================================
// I-1 — runDryRun: el pass/fail es SIEMPRE contra rows.length del archivo,
// nunca contra BASELINE_COUNTS. Este es el regression test central del
// hallazgo: un respaldo con MUCHAS menos (o más) filas que el baseline del
// 25-jul debe seguir dando dry-run OK si no hay valores no-casteables.
// ============================================================================

t('(I-1) runDryRun: fixture con conteo MUY distinto al baseline (992 -> 1 fila) sigue dando OK', function () {
    const file = writeFixtureBackup({ ventas: [{ id: 'v-fixture-1', amount: '150000.5' }] });
    const ok = MB.runDryRun(file);
    assert.strictEqual(ok, true, 'un conteo de archivo distinto al baseline NUNCA debe fallar el dry-run por si solo');
});

t('(I-1) runDryRun: fixture con conteo MAYOR al baseline (992 -> 995) sigue dando OK', function () {
    const rows = [];
    for (let i = 0; i < 995; i++) rows.push({ id: 'v-' + i, amount: String(1000 + i) });
    const file = writeFixtureBackup({ ventas: rows });
    const ok = MB.runDryRun(file);
    assert.strictEqual(ok, true, 'un respaldo de cutover con MAS filas que el baseline (negocio siguio operando) no debe reportarse como fallo');
});

t('(M-1 + dry-run) runDryRun: un valor no-casteable SI hace fallar el dry-run', function () {
    const file = writeFixtureBackup({ ventas: [{ id: 'v-bad', amount: '0x1F' }] });
    const ok = MB.runDryRun(file);
    assert.strictEqual(ok, false, 'un valor no-casteable debe seguir fallando el dry-run (esto NO cambio con I-1)');
});

t('(I-1) runDryRun: tabla faltante en el respaldo sigue fallando (estructura, no conteo)', function () {
    const file = writeFixtureBackup();
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete raw.cotizaciones;
    fs.writeFileSync(file, JSON.stringify(raw));
    const ok = MB.runDryRun(file);
    assert.strictEqual(ok, false, 'la ausencia estructural de una tabla debe seguir siendo un fallo');
});

console.log('\n' + pass + ' OK, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
