// Runner de las suites de verificacion del Sprint 1. Ejecuta cada archivo como
// proceso Node independiente (mismo aislamiento que cuando se corrian a mano),
// junta el resumen "<N> OK, <M> FAIL" que cada harness imprime y calcula el
// resultado global. Correr con: npm test  o  node tests/run-all.js
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');

const SUITES = [
    'money.test.js',
    'verify-finance-round2.js',
    'verify-cbis.js',
    'verify-o1o2.js',
    'verify-lote-e.js',
    'verify-e-fixes.js',
    'verify-lote-f.js',
    'adv-round2.js'
];

const SUMMARY_RE = /(\d+)\s*OK,\s*(\d+)\s*FAIL/;

let overallOk = true;
const rows = [];

SUITES.forEach(function (file) {
    const full = path.join(__dirname, file);
    const res = spawnSync(process.execPath, [full], { encoding: 'utf8' });
    const output = (res.stdout || '') + (res.stderr || '');
    const match = output.match(SUMMARY_RE);

    if (res.error) {
        overallOk = false;
        rows.push({ file: file, status: 'FAIL', detail: 'no se pudo ejecutar: ' + res.error.message });
        console.log('FAIL  ' + file + '  (no se pudo ejecutar: ' + res.error.message + ')');
        return;
    }

    if (!match) {
        overallOk = false;
        rows.push({ file: file, status: 'FAIL', detail: 'sin resumen OK/FAIL — salida cruda abajo' });
        console.log('FAIL  ' + file + '  (no se encontro resumen "N OK, M FAIL" en la salida)');
        console.log(output.split('\n').slice(-15).join('\n'));
        return;
    }

    const okCount = Number(match[1]);
    const failCount = Number(match[2]);
    const status = failCount === 0 ? 'OK' : 'FAIL';
    if (failCount !== 0) overallOk = false;

    rows.push({ file: file, status: status, detail: okCount + ' OK, ' + failCount + ' FAIL' });
    console.log((status === 'OK' ? 'OK    ' : 'FAIL  ') + file + '  (' + okCount + ' OK, ' + failCount + ' FAIL)');

    if (status === 'FAIL') {
        // Mostrar las lineas FAIL individuales para diagnostico rapido
        output.split('\n').filter(function (l) { return /FAIL/.test(l); }).forEach(function (l) {
            console.log('        ' + l.trim());
        });
    }
});

console.log('\n=== Resumen ===');
rows.forEach(function (r) {
    console.log((r.status === 'OK' ? 'OK    ' : 'FAIL  ') + r.file + '  —  ' + r.detail);
});
console.log(overallOk ? '\nTodas las suites verdes.' : '\nHay suites con fallas — revisar arriba.');

process.exit(overallOk ? 0 : 1);
