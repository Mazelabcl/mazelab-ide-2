window.Mazelab = window.Mazelab || {};

(function () {
    // Default true: el servidor es la única fuente de verdad. Antes el default era
    // false, dejando una ventana en que un getAll() llamado ANTES de init() (o si
    // init() nunca corre) caía en silencio a localStorage. El modo localdev es la
    // ÚNICA vía para bajar esto a false, y lo hace explícitamente dentro de init().
    let useSupabase = true;
    let initialized = false;
    let readOnly = false;      // true si la conexión inicial falló o un fetchAll lanzó en runtime
    let localDevMode = false;  // true solo con ?localdev=1 en la URL

    const TABLE_MAP = {
        services: 'servicios',
        staff: 'personal',
        clients: 'clientes',
        sales: 'ventas',
        receivables: 'facturas',
        payables: 'costos',
        bodega: 'equipos',
        cotizaciones: 'cotizaciones',
        config: 'config'
    };

    // ── In-memory cache ──────────────────────────────────────────────────
    // Avoids re-fetching the DB every vez que el usuario navega entre módulos.
    // TTL: 45 segundos. Se invalida inmediatamente en cualquier write (create/update/remove/importMany).
    const _cache = {};
    const CACHE_TTL = 45000;

    function invalidateCache(entityType) {
        delete _cache[entityType];
    }

    function invalidateAll() {
        Object.keys(_cache).forEach(k => delete _cache[k]);
    }

    // Modo solo lectura: se activa si la conexión inicial falla o si un fetchAll
    // lanza en runtime (servidor caído a mitad de sesión). Bloquea create/update/remove
    // ANTES de tocar red — nunca más fallback silencioso a localStorage. No hay
    // auto-recuperación en caliente: si la conexión vuelve, basta con recargar la página.
    function markReadOnly() {
        if (readOnly) return;
        readOnly = true;
        var UI = (window.Mazelab && window.Mazelab.UI) || { showOfflineBanner: function () {} };
        UI.showOfflineBanner();
    }

    async function init() {
        if (initialized) return;
        initialized = true;

        // Escape de desarrollo explícito y NO silencioso: ?localdev=1 usa localStorage
        // con un banner naranja permanente. Nunca se entra a este modo por defecto ni
        // como fallback de un error — solo si el usuario lo pide en la URL.
        try {
            var params = new URLSearchParams(window.location.search);
            if (params.get('localdev') === '1') {
                useSupabase = false;
                localDevMode = true;
                var UILocal = (window.Mazelab && window.Mazelab.UI) || { showTestModeBanner: function () {} };
                UILocal.showTestModeBanner();
                console.warn('DataService: ?localdev=1 — modo prueba local, los datos viven SOLO en este navegador');
                return;
            }
        } catch (e) {
            // window.location no disponible (harness de Node) — seguir en modo servidor
        }

        // Fuera de localdev, el servidor es la única fuente de verdad — sin fallback
        // silencioso a localStorage si está vacío o si falla.
        useSupabase = true;
        try {
            const connected = await window.Mazelab.Supabase.testConnection();
            if (!connected) {
                console.error('DataService: sin conexión con la base de datos al iniciar');
                markReadOnly();
            }
        } catch (e) {
            console.error('DataService: error de conexión al iniciar:', e);
            markReadOnly();
        }
    }

    function getStorageService(entityType) {
        const serviceMap = {
            services: window.Mazelab.Storage.ServicesService,
            staff: window.Mazelab.Storage.StaffService,
            clients: window.Mazelab.Storage.ClientsService,
            sales: window.Mazelab.Storage.SalesService,
            receivables: window.Mazelab.Storage.ReceivablesService,
            payables: window.Mazelab.Storage.PayablesService,
            bodega: window.Mazelab.Storage.BodegaService,
            cotizaciones: window.Mazelab.Storage.CotizacionesService
        };
        return serviceMap[entityType];
    }

    async function getAll(entityType) {
        // Serve from cache if fresh
        const cached = _cache[entityType];
        if (cached && (Date.now() - cached.ts) < CACHE_TTL) {
            return cached.data;
        }

        let result;
        if (useSupabase) {
            const table = TABLE_MAP[entityType];
            try {
                const data = await window.Mazelab.Supabase.fetchAll(table);
                result = data; // un array vacío del servidor ES la verdad, no una señal de fallback
            } catch (e) {
                markReadOnly();
                throw e; // sin fallback silencioso — el llamador debe ver el error
            }
        } else {
            const svc = getStorageService(entityType);
            result = svc ? svc.getAll() : [];
        }

        _cache[entityType] = { data: result, ts: Date.now() };
        return result;
    }

    async function getById(entityType, id) {
        if (useSupabase) {
            const all = await getAll(entityType);
            return all.find(item => item.id === id) || null;
        }
        const svc = getStorageService(entityType);
        return svc ? svc.getById(id) : null;
    }

    // Estando en modo solo lectura, lanza ANTES de intentar cualquier red.
    function assertWritable() {
        if (readOnly) {
            throw new Error('Sin conexión con la base de datos — modo solo lectura');
        }
    }

    async function create(entityType, record) {
        assertWritable();
        invalidateCache(entityType);
        if (useSupabase) {
            const table = TABLE_MAP[entityType];
            return await window.Mazelab.Supabase.insert(table, record);
        }
        const svc = getStorageService(entityType);
        return svc ? svc.create(record) : null;
    }

    async function update(entityType, id, updates) {
        assertWritable();
        invalidateCache(entityType);
        if (useSupabase) {
            const table = TABLE_MAP[entityType];
            return await window.Mazelab.Supabase.update(table, id, updates);
        }
        const svc = getStorageService(entityType);
        return svc ? svc.update(id, updates) : null;
    }

    async function remove(entityType, id) {
        assertWritable();
        invalidateCache(entityType);
        if (useSupabase) {
            const table = TABLE_MAP[entityType];
            return await window.Mazelab.Supabase.remove(table, id);
        }
        const svc = getStorageService(entityType);
        return svc ? svc.remove(id) : false;
    }

    async function importMany(entityType, records) {
        // La escritura de mayor radio (upsertMany en lotes de 100, potencialmente
        // sobre miles de filas): debe respetar el modo solo lectura igual que
        // create/update/remove — sin esto, una importación llegaba a la red
        // mientras el banner decía "no se guardará".
        assertWritable();
        invalidateCache(entityType);
        if (useSupabase) {
            const table = TABLE_MAP[entityType];
            return await window.Mazelab.Supabase.upsertMany(table, records);
        }
        const svc = getStorageService(entityType);
        return svc ? svc.importMany(records) : [];
    }

    async function hasData(entityType) {
        const data = await getAll(entityType);
        return data.length > 0;
    }

    window.Mazelab.DataService = {
        init,
        getAll,
        getById,
        create,
        update,
        remove,
        importMany,
        hasData,
        invalidateCache,
        invalidateAll,
        isUsingSupabase: () => useSupabase,
        isLocalDev: () => localDevMode
    };
    // readOnly expuesto como propiedad boolean viva (no snapshot) — se lee en
    // cada acceso, así refleja el estado actual aunque cambie después del load.
    Object.defineProperty(window.Mazelab.DataService, 'readOnly', {
        get: function () { return readOnly; },
        enumerable: true
    });
})();
