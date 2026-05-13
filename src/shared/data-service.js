window.Mazelab = window.Mazelab || {};

(function () {
    let useSupabase = false;
    let initialized = false;

    const TABLE_MAP = {
        services: 'servicios',
        staff: 'personal',
        clients: 'clientes',
        sales: 'ventas',
        receivables: 'facturas',
        payables: 'costos',
        bodega: 'equipos',
        cotizaciones: 'cotizaciones'
    };

    // ── In-memory cache ──────────────────────────────────────────────────
    // Avoids re-fetching the DB every vez que el usuario navega entre módulos.
    //
    // B-017 + FA-007 fix:
    //   - TTL bajado de 45s a 8s para entidades transaccionales
    //     (receivables, payables, sales, cotizaciones). Para entidades
    //     ~estaticas (services, staff, clients, bodega) se mantiene 45s.
    //   - BroadcastChannel('mazelab-data') notifica a otras pestañas
    //     cuando hay write, e invalida el cache local de ellas
    //     inmediatamente. Owner (Aldo) usa 1 sola pestaña hoy pero le
    //     dio acceso a Manu — escenario multi-tab sera real pronto.
    //
    // Razon del split:
    //   - 8s en transaccionales: balance entre frescura (vendedor edita
    //     una venta en una tab, ve el cambio en otra tab al instante via
    //     BroadcastChannel; si esa channel falla, cae al TTL corto y
    //     refresca en max 8s) y carga al backend (cada navegacion entre
    //     modulos no re-fetchea constantemente).
    //   - 45s en estaticas: clients/services/staff cambian pocas veces
    //     al dia. El BroadcastChannel cubre los casos de edicion.
    const _cache = {};
    const CACHE_TTL_TRANSACTIONAL = 8000;
    const CACHE_TTL_STATIC        = 45000;
    // Entidades que pueden cambiar frecuentemente (escrituras desde
    // multiples modulos / multiples usuarios).
    const TRANSACTIONAL_ENTITIES = new Set([
        'sales', 'receivables', 'payables', 'cotizaciones'
    ]);

    function getCacheTtl(entityType) {
        return TRANSACTIONAL_ENTITIES.has(entityType)
            ? CACHE_TTL_TRANSACTIONAL
            : CACHE_TTL_STATIC;
    }

    function invalidateCache(entityType) {
        delete _cache[entityType];
    }

    function invalidateAll() {
        Object.keys(_cache).forEach(k => delete _cache[k]);
    }

    // BroadcastChannel cross-tab — fallback a no-op si el navegador no
    // lo soporta (cubre Safari < 15.4). Sin esto el ERP sigue funcionando,
    // solo pierde la sincronizacion inmediata cross-tab (queda con el
    // TTL corto como fallback).
    let _bc = null;
    function initBroadcastChannel() {
        if (typeof BroadcastChannel === 'undefined') return;
        try {
            _bc = new BroadcastChannel('mazelab-data');
            _bc.onmessage = function (evt) {
                if (!evt || !evt.data) return;
                var msg = evt.data;
                if (msg.type === 'invalidate' && msg.entityType) {
                    // Otra tab escribio → invalida cache local.
                    delete _cache[msg.entityType];
                } else if (msg.type === 'invalidate-all') {
                    invalidateAll();
                }
            };
        } catch (e) {
            console.warn('DataService: BroadcastChannel init failed:', e);
            _bc = null;
        }
    }

    // Inicializa la channel al cargar el modulo (sin esperar init()).
    initBroadcastChannel();

    function broadcastInvalidate(entityType) {
        if (!_bc) return;
        try {
            _bc.postMessage({
                type: 'invalidate',
                entityType: entityType,
                ts: Date.now()
            });
        } catch (e) {
            // Channel cerrada o tab terminando. Sin retry — el TTL corto
            // cubre el caso.
        }
    }

    async function init() {
        if (initialized) return;
        try {
            const connected = await window.Mazelab.Supabase.testConnection();
            if (connected) {
                const salesData = await window.Mazelab.Supabase.fetchAll('ventas');
                if (salesData && salesData.length > 0) {
                    useSupabase = true;
                    console.log('DataService: Using Supabase (' + salesData.length + ' sales found)');
                } else {
                    const localSales = window.Mazelab.Storage.SalesService.getAll();
                    if (localSales.length > 0) {
                        useSupabase = false;
                        console.log('DataService: Supabase empty, using localStorage (' + localSales.length + ' local sales)');
                    } else {
                        useSupabase = true;
                        console.log('DataService: Both empty, defaulting to Supabase for new data');
                    }
                }
            } else {
                useSupabase = false;
                console.log('DataService: No Supabase connection, using localStorage');
            }
        } catch (e) {
            useSupabase = false;
            console.warn('DataService: Init error, using localStorage:', e);
        }
        initialized = true;
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
        // Serve from cache if fresh — TTL depende de tipo de entidad
        // (transaccional 8s vs estatica 45s).
        const cached = _cache[entityType];
        const ttl = getCacheTtl(entityType);
        if (cached && (Date.now() - cached.ts) < ttl) {
            return cached.data;
        }

        let result;
        if (useSupabase) {
            const table = TABLE_MAP[entityType];
            const data = await window.Mazelab.Supabase.fetchAll(table);
            if (data && data.length > 0) result = data;
        }
        if (!result) {
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

    async function create(entityType, record) {
        invalidateCache(entityType);
        broadcastInvalidate(entityType);
        if (useSupabase) {
            const table = TABLE_MAP[entityType];
            return await window.Mazelab.Supabase.insert(table, record);
        }
        const svc = getStorageService(entityType);
        return svc ? svc.create(record) : null;
    }

    async function update(entityType, id, updates) {
        invalidateCache(entityType);
        broadcastInvalidate(entityType);
        if (useSupabase) {
            const table = TABLE_MAP[entityType];
            return await window.Mazelab.Supabase.update(table, id, updates);
        }
        const svc = getStorageService(entityType);
        return svc ? svc.update(id, updates) : null;
    }

    async function remove(entityType, id) {
        invalidateCache(entityType);
        broadcastInvalidate(entityType);
        if (useSupabase) {
            const table = TABLE_MAP[entityType];
            return await window.Mazelab.Supabase.remove(table, id);
        }
        const svc = getStorageService(entityType);
        return svc ? svc.remove(id) : false;
    }

    async function importMany(entityType, records) {
        invalidateCache(entityType);
        broadcastInvalidate(entityType);
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
        isUsingSupabase: () => useSupabase
    };
})();
