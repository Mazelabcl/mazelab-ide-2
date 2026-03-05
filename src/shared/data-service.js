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
        payables: 'costos'
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
            payables: window.Mazelab.Storage.PayablesService
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
        if (useSupabase) {
            const table = TABLE_MAP[entityType];
            return await window.Mazelab.Supabase.insert(table, record);
        }
        const svc = getStorageService(entityType);
        return svc ? svc.create(record) : null;
    }

    async function update(entityType, id, updates) {
        invalidateCache(entityType);
        if (useSupabase) {
            const table = TABLE_MAP[entityType];
            return await window.Mazelab.Supabase.update(table, id, updates);
        }
        const svc = getStorageService(entityType);
        return svc ? svc.update(id, updates) : null;
    }

    async function remove(entityType, id) {
        invalidateCache(entityType);
        if (useSupabase) {
            const table = TABLE_MAP[entityType];
            return await window.Mazelab.Supabase.remove(table, id);
        }
        const svc = getStorageService(entityType);
        return svc ? svc.remove(id) : false;
    }

    async function importMany(entityType, records) {
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
        isUsingSupabase: () => useSupabase
    };
})();
