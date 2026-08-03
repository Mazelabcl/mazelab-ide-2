// Adaptador Supabase — Sprint M1, Lote M1-B.
// Reemplaza el REST /api/db (Express en Replit) por @supabase/supabase-js@2
// contra Postgres + RLS reales. Conserva EXACTAMENTE el contrato público del
// Sprint 1: mismas 6 funciones, mismos prefijos de error en español, misma
// semántica "lanza en error" (jamás null/[]-en-error — eso reintroduciría el
// sangrado silencioso que el Sprint 1 corrigió), upsert en lotes de 100
// secuenciales. El transporte cambia de fetch a supabase-js; el contrato
// externo que consume data-service.js no cambia.
window.Mazelab = window.Mazelab || {};
// Bootstrap de window.Mazelab.Modules: este es el primer script propio que
// carga (justo tras el CDN de supabase-js en index.html), antes que
// cualquier módulo (finance.js, sales.js, etc.). Cada módulo hace
// window.Mazelab.Modules.XModule = ... al cargar, así que el namespace debe
// existir aquí o el primer módulo revienta con "Cannot set properties of
// undefined". app.js ya no es quien inicializa esto (se reescribió en el
// Sprint M1) — por eso el bootstrap vive en el primer script de la cadena.
window.Mazelab.Modules = window.Mazelab.Modules || {};

(function () {
    // Proyecto Supabase (URL + anon key públicos — la anon key SIEMPRE va
    // hardcodeada en el cliente, RLS es la barrera real de seguridad, no el
    // secreto de esta key).
    var SUPABASE_URL = 'https://xitbarrinioswpyjiwyc.supabase.co';
    var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhpdGJhcnJpbmlvc3dweWppd3ljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxMjAyOTUsImV4cCI6MjEwMDY5NjI5NX0.FY96VqqGCWr0csAaEqFBQ5-TZnFFQVFVRdzlGkLGawc';

    // Allowlist de tablas operables por el adaptador genérico (equivalente al
    // VALID_TABLES del Express retirado). RLS ya protege en el servidor, pero
    // el nombre de tabla llega del cliente — nunca confiar en input arbitrario
    // para construir la llamada a supabase-js.
    var VALID_TABLES = [
        'ventas', 'facturas', 'costos', 'servicios', 'personal',
        'clientes', 'equipos', 'cotizaciones', 'config'
    ];

    var BATCH_SIZE = 100;

    var _client = null;
    var isConnected = false;

    // Un solo cliente supabase-js en toda la app — auth.js reutiliza esta misma
    // instancia vía Supabase._client (dos clientes duplicarían sesiones/tokens
    // en localStorage). Creación perezosa: requerir este archivo en un entorno
    // sin el script del CDN cargado (p. ej. un harness de Node) NO debe lanzar
    // — solo lanza si efectivamente se invoca un método que necesita el cliente.
    function getClient() {
        if (_client) return _client;
        if (!window.supabase || typeof window.supabase.createClient !== 'function') {
            throw new Error('Supabase SDK no está cargado (falta el script @supabase/supabase-js del CDN).');
        }
        _client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        return _client;
    }

    function assertValidTable(table) {
        if (VALID_TABLES.indexOf(table) === -1) {
            throw new Error('Tabla no permitida: ' + table);
        }
    }

    async function testConnection() {
        // I3: un HEAD nunca ejecuta la query real contra Postgres — con RLS/
        // esquema roto puede devolver 200 igual (algunos proxies/CDNs delante
        // de PostgREST responden HEAD sin reenviarlo). Un GET real con
        // .limit(1) sí fuerza la ejecución completa: si la tabla/columna no
        // existe o RLS la bloquea de una forma que rompe la query, viene error.
        try {
            var client = getClient();
            var res = await client.from('ventas').select('id').limit(1);
            isConnected = !res.error;
            return isConnected;
        } catch (e) {
            isConnected = false;
            return false;
        }
    }

    // PostgREST (la API REST que expone Supabase) impone un máximo de filas por
    // respuesta — 1000 por defecto — y lo aplica en SILENCIO: una tabla con más
    // filas que el límite responde 200 OK con exactamente 1000 filas, sin error
    // y sin ningún indicador de truncamiento en el payload. Sin paginación
    // explícita vía .range(), fetchAll() devolvía solo las primeras 1000 filas
    // ordenadas por id — en producción esto truncó "facturas" (1150 filas) y
    // "costos" (3615 filas, ~72% invisible) sin que ningún error lo delatara,
    // inflando/rompiendo KPIs y dejando guards (p. ej. "no borrar venta con
    // costos") ciegos a los registros fuera de la primera página.
    var FETCH_PAGE_SIZE = 1000;

    async function fetchAll(table) {
        // Lanza en error de red o de servidor — un array vacío devuelto aquí antes se
        // trataba como "sin datos legítimo" y disparaba fallback silencioso a localStorage.
        assertValidTable(table);
        var client = getClient();
        var allRows = [];
        var from = 0;
        for (;;) {
            var to = from + FETCH_PAGE_SIZE - 1;
            var res = await client.from(table).select('*').order('id').range(from, to);
            if (res.error) {
                throw new Error('Error al leer ' + table + ': ' + res.error.message);
            }
            var page = res.data || [];
            allRows.push.apply(allRows, page);
            if (page.length < FETCH_PAGE_SIZE) break;
            from += FETCH_PAGE_SIZE;
        }
        return allRows;
    }

    async function insert(table, record) {
        assertValidTable(table);
        var client = getClient();
        var res = await client.from(table).insert(record).select().single();
        if (res.error) {
            throw new Error('Error al guardar en ' + table + ': ' + res.error.message);
        }
        return res.data;
    }

    async function update(table, id, updates) {
        // Mismo patrón que insert(): lanza en vez de devolver null — un null se
        // interpretaba en llamadores como "no pasó nada" en vez de un error real.
        // .single() lanza si la actualización afecta 0 filas (id inexistente) — es el
        // comportamiento correcto: un id que no existe debe fallar de forma visible.
        assertValidTable(table);
        var client = getClient();
        var res = await client.from(table).update(updates).eq('id', id).select().single();
        if (res.error) {
            throw new Error('Error al actualizar en ' + table + ': ' + res.error.message);
        }
        return res.data;
    }

    async function remove(table, id) {
        // Mismo patrón que insert(): lanza en vez de devolver false.
        // I4: un DELETE sin .select() devuelve 200/sin error incluso cuando RLS
        // filtra la fila y el borrado real afecta 0 filas — remove() reportaba
        // éxito de un borrado que nunca ocurrió. .select('id') pide de vuelta
        // las filas efectivamente borradas: si viene vacío, no se borró nada.
        assertValidTable(table);
        var client = getClient();
        var res = await client.from(table).delete().eq('id', id).select('id');
        if (res.error) {
            throw new Error('Error al eliminar en ' + table + ': ' + res.error.message);
        }
        if (!res.data || res.data.length === 0) {
            throw new Error('Error al eliminar en ' + table + ': el registro no existe o no tienes permiso');
        }
        return true;
    }

    async function upsertMany(table, records) {
        assertValidTable(table);
        var client = getClient();
        var results = [];
        for (var i = 0; i < records.length; i += BATCH_SIZE) {
            var batch = records.slice(i, i + BATCH_SIZE);
            var batchNum = Math.floor(i / BATCH_SIZE) + 1;
            var res = await client.from(table).upsert(batch, { onConflict: 'id' }).select();
            if (res.error) {
                console.error('DB upsert ' + table + ' (lote ' + batchNum + '):', res.error.message);
                throw new Error('Error al importar "' + table + '" (lote ' + batchNum + '): ' + res.error.message);
            }
            if (Array.isArray(res.data)) results.push.apply(results, res.data);
        }
        return results;
    }

    window.Mazelab.Supabase = {
        testConnection: testConnection,
        isConnected: function () { return isConnected; },
        fetchAll: fetchAll,
        insert: insert,
        update: update,
        remove: remove,
        upsertMany: upsertMany
    };

    // Cliente crudo expuesto para que auth.js (y solo auth.js) reutilice la misma
    // instancia para las llamadas .auth.* — getter perezoso: dispara la misma
    // creación memoizada que usan las funciones de arriba, nunca un segundo cliente.
    Object.defineProperty(window.Mazelab.Supabase, '_client', {
        get: function () { return getClient(); },
        enumerable: true
    });
})();
