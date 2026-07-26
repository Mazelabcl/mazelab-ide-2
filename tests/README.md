# Tests — Sprint 1 "Detener el sangrado"

Suites de verificacion Node (sin browser real, jsdom donde hace falta) que
prueban el codigo REAL de `src/`, no una replica. Se corren contra el repo tal
como esta en disco — no hay build step.

## Como correr

Desde la raiz del repo:

```bash
npm install   # una sola vez, instala jsdom en node_modules/
npm test      # corre todas las suites en secuencia + resumen
```

o un archivo individual:

```bash
node tests/money.test.js
node tests/verify-lote-f.js
```

## Que es cada suite

- `money.test.js` — tests unitarios de `src/shared/money.js` (retencion BH,
  IVA credito, parser de montos chilenos, regla del dia 20, pendientes CXC,
  comision devengada). Es la fuente de verdad matematica del sprint.
- `verify-finance-round2.js` — carga `finance.js` real y ejecuta `computeKPIs`
  contra los casos B1/I1-I4/M1-M3 de la ronda 2 de revision.
- `verify-cbis.js` — carga `finance.js` real en jsdom y prueba los 4 fixes de
  la revision C-bis via API real y clicks DOM reales (popup, sort, factura
  parcial).
- `verify-o1o2.js` — casos O1/O2 de la revision de Opus (commit `5b48285`)
  sobre `finance.js` real en jsdom.
- `verify-lote-e.js` — carga `supabase.js` + `data-service.js` + `finance.js`
  reales con `fetch`/DOM mockeados (Tasks 6/7: persistencia honesta, sin
  fallback silencioso a localStorage).
- `verify-e-fixes.js` — hallazgos de la revision adversarial sobre
  `db17baa`/`e17ef86` (B1, I1-I5, M1-M2) sobre `payables.js`/`pagos.js`/
  `sales.js` reales.
- `verify-lote-f.js` — carga `dashboard.js` real y ejecuta
  `buildCommissionCard` con los 6 casos del plan (Task 8: comision por
  utilidad y proporcion cobrada).
- `adv-round2.js` — re-revision independiente de `bb732f4` sobre `sales.js`
  real (jsdom): orden de `populateDropdowns`, columna ID, filtro de columna,
  busqueda global.

## Fuera de este runner

`adv-lote-d.js` y `adv-param.js` (viven en el scratchpad del sprint, no en
este repo) quedan **fuera** de `run-all.js` a proposito: tienen 2 FAIL
pre-existentes conocidos (listeners acumulados al reabrir el modal de venta
varias veces) que son backlog, no regresiones de este sprint. Si se
versionan a futuro, documentar esos 2 FAIL esperados en vez de intentar
ponerlos en verde a la fuerza.

## Runner

`run-all.js` ejecuta cada suite como proceso Node independiente (mismo
aislamiento que correrlas a mano), busca la linea de resumen que cada harness
imprime (`"<N> OK, <M> FAIL"`) y calcula el resultado global. Exit code 0 solo
si todas las suites reportan 0 FAIL.
