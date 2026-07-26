// Tests de src/shared/money.js — correr con: node tests/money.test.js
const assert = require('assert');
const M = require('../src/shared/money.js');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  OK  ' + name); }
    catch (e) { fail++; console.error('FAIL  ' + name + ' — ' + e.message); }
}

// ---- Retención BH (tabla SII Ley 21.133, por año de emisión) ----
t('tasa 2024 = 13,75%', () => assert.strictEqual(M.bhRetentionRate('2024-06-15'), 0.1375));
t('tasa 2025 = 14,5%',  () => assert.strictEqual(M.bhRetentionRate('2025-06-15'), 0.145));
t('tasa 2026 = 15,25%', () => assert.strictEqual(M.bhRetentionRate('2026-06-15'), 0.1525));
t('tasa 2027 = 16%',    () => assert.strictEqual(M.bhRetentionRate('2027-06-15'), 0.16));
t('tasa 2028+ = 17%',   () => assert.strictEqual(M.bhRetentionRate('2029-01-01'), 0.17));
t('sin fecha usa año actual', () => assert.strictEqual(typeof M.bhRetentionRate(null), 'number'));

// retención = líquido × tasa/(1−tasa), redondeada a peso
t('retención de 1.000.000 líquido en 2026 = 179.941', () =>
    assert.strictEqual(M.bhRetencion(1000000, '2026-05-01'), 179941));
t('retención de 1.000.000 líquido en 2025 = 169.591', () =>
    assert.strictEqual(M.bhRetencion(1000000, '2025-05-01'), 169591));
t('costo empresa BH = líquido + retención', () =>
    assert.strictEqual(M.bhCostoEmpresa(1000000, '2026-05-01'), 1179941));

// ---- IVA crédito de factura proveedor (monto ingresado = total con IVA) ----
t('IVA crédito de 1.190.000 = 190.000', () => assert.strictEqual(M.ivaCredito(1190000), 190000));
t('neto de 1.190.000 = 1.000.000',      () => assert.strictEqual(M.facturaNeto(1190000), 1000000));
t('IVA crédito de 595.000 = 95.000',    () => assert.strictEqual(M.ivaCredito(595000), 95000));

// ---- Costo empresa por ítem (para utilidad de comisiones) ----
t('costo empresa factura = neto', () => assert.strictEqual(M.costoEmpresaItem('factura', 1190000, '2026-05-01'), 1000000));
t('costo empresa BH = bruto',     () => assert.strictEqual(M.costoEmpresaItem('bh', 1000000, '2026-05-01'), 1179941));
t('costo empresa otros = crudo',  () => assert.strictEqual(M.costoEmpresaItem('efectivo', 400000, '2026-05-01'), 400000));

// ---- parseAmountCL (formato chileno) ----
t('"45.000" → 45000',       () => assert.strictEqual(M.parseAmountCL('45.000'), 45000));
t('"1.500" → 1500',         () => assert.strictEqual(M.parseAmountCL('1.500'), 1500));
t('"1.234.567" → 1234567',  () => assert.strictEqual(M.parseAmountCL('1.234.567'), 1234567));
t('"$ 1.500" → 1500',       () => assert.strictEqual(M.parseAmountCL('$ 1.500'), 1500));
t('"123,45" → 123.45',      () => assert.strictEqual(M.parseAmountCL('123,45'), 123.45));
t('"1.234,5" → 1234.5',     () => assert.strictEqual(M.parseAmountCL('1.234,5'), 1234.5));
t('"12.34" → 12.34 (2 decimales = decimal)', () => assert.strictEqual(M.parseAmountCL('12.34'), 12.34));
t('"#REF!" → 0',            () => assert.strictEqual(M.parseAmountCL('#REF!'), 0));
t('"" → 0',                 () => assert.strictEqual(M.parseAmountCL(''), 0));
t('null → 0',               () => assert.strictEqual(M.parseAmountCL(null), 0));
t('número directo pasa',    () => assert.strictEqual(M.parseAmountCL(45000), 45000));

// ---- Regla del día 20: IVA declarado ----
// factura de junio 2026: se paga el 20 de julio; es "mío" recién desde el 21
t('junio visto el 19-jul → NO declarado', () =>
    assert.strictEqual(M.ivaDeclarado(2026, 6, new Date(2026, 6, 19, 12)), false));
t('junio visto el 20-jul → NO declarado (el día 20 aún no es tuyo)', () =>
    assert.strictEqual(M.ivaDeclarado(2026, 6, new Date(2026, 6, 20, 18)), false));
t('junio visto el 21-jul → SÍ declarado', () =>
    assert.strictEqual(M.ivaDeclarado(2026, 6, new Date(2026, 6, 21, 0, 30)), true));
t('julio visto en julio → NO declarado', () =>
    assert.strictEqual(M.ivaDeclarado(2026, 7, new Date(2026, 6, 25)), false));
t('diciembre cruza año: dic-2025 visto 21-ene-2026 → SÍ', () =>
    assert.strictEqual(M.ivaDeclarado(2025, 12, new Date(2026, 0, 21, 1)), true));

// ---- CXC: pendiente por fila (separación de libros NC vs incidencia) ----
// F5: 1.500.000 + IVA con NC de 200.000 + IVA → pendiente 1.547.000
t('factura 1.5M con NC 200k → pendiente 1.547.000', () =>
    assert.strictEqual(M.pendienteFacturadoRow({ tipoDoc: 'F', facturadoNeto: 1500000, ncNeto: 200000, pagado: 0 }), 1547000));
t('factura sin NC, pago parcial', () =>
    assert.strictEqual(M.pendienteFacturadoRow({ tipoDoc: 'F', facturadoNeto: 1000000, ncNeto: 0, pagado: 500000 }), 690000));
t('la incidencia NO descuenta en fila facturada (eso lo hace la NC)', () =>
    assert.strictEqual(M.pendienteFacturadoRow({ tipoDoc: 'F', facturadoNeto: 1000000, ncNeto: 0, refundNeto: 200000, pagado: 0 }), 1190000));
t('exenta E resta NC sin IVA', () =>
    assert.strictEqual(M.pendienteFacturadoRow({ tipoDoc: 'E', facturadoNeto: 1000000, ncNeto: 200000, pagado: 0 }), 800000));
t('fila sin factura resta incidencia', () =>
    assert.strictEqual(M.pendienteSinFacturaRow({ neto: 1500000, refundNeto: 300000, pagado: 0 }), 1200000));

// ---- Lo que es mío por fila ----
t('NC nunca aporta', () => assert.strictEqual(M.mioRow({ tipoDoc: 'NC' }), 0));
t('sin factura: neto − incidencia', () =>
    assert.strictEqual(M.mioRow({ tipoDoc: 'F', tieneFactura: false, neto: 1500000, refundNeto: 300000, pagado: 0 }), 1200000));
t('facturada, IVA NO declarado: solo neto', () =>
    assert.strictEqual(M.mioRow({ tipoDoc: 'F', tieneFactura: true, facturadoNeto: 1000000, ncNeto: 0, pagado: 0, ivaDeclarado: false }), 1000000));
t('facturada, IVA declarado: total con IVA', () =>
    assert.strictEqual(M.mioRow({ tipoDoc: 'F', tieneFactura: true, facturadoNeto: 1000000, ncNeto: 0, pagado: 0, ivaDeclarado: true }), 1190000));
t('facturada con NC, IVA declarado', () =>
    assert.strictEqual(M.mioRow({ tipoDoc: 'F', tieneFactura: true, facturadoNeto: 1500000, ncNeto: 200000, pagado: 0, ivaDeclarado: true }), 1547000));

// ---- Comisión: % × utilidad × proporción cobrada ----
t('10% de utilidad 600k, cobrada la mitad → 30.000', () =>
    assert.strictEqual(M.comisionDevengada(10, 600000, 500000, 1000000), 30000));
t('10% de utilidad 600k, todo cobrado → 60.000', () =>
    assert.strictEqual(M.comisionDevengada(10, 600000, 1000000, 1000000), 60000));
t('nada cobrado → 0', () => assert.strictEqual(M.comisionDevengada(10, 600000, 0, 1000000), 0));
t('utilidad negativa → 0', () => assert.strictEqual(M.comisionDevengada(10, -50000, 1000000, 1000000), 0));
t('pct 0 → 0', () => assert.strictEqual(M.comisionDevengada(0, 600000, 1000000, 1000000), 0));

console.log('\n' + pass + ' OK, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
