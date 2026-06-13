window.Mazelab = window.Mazelab || {};

(function () {
    let useSupabase = false;
    let initialized = false;
    // Bug C-5: true cuando el ERP cayo a localStorage POR UN ERROR de
    // conexion (no por config intencional ni por tabla vacia legitima).
    // Cuando es true mostramos un banner rojo persistente avisando que los
    // cambios no se estan guardando en el servidor.
    let degradedMode = false;

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
        degradedMode = false;
        try {
            const connected = await window.Mazelab.Supabase.testConnection();
            if (!connected) {
                // No hay backend alcanzable. Puede ser config intencional
                // (primer uso / demo sin datos) o un backend caido con datos
                // previos (escenario peligroso de C-5). Distinguimos por la
                // presencia de datos locales: si ya hay datos, el ERP estuvo
                // en uso y la falta de conexion es sospechosa → banner. Si no
                // hay datos, es arranque limpio sin backend → modo local
                // silencioso (comportamiento previo).
                useSupabase = false;
                const localSalesNC = window.Mazelab.Storage.SalesService.getAll();
                if (localSalesNC && localSalesNC.length > 0) {
                    degradedMode = true;
                    console.error('DataService: Sin conexion pero hay datos locales previos, modo degradado');
                    showOfflineBanner();
                } else {
                    console.log('DataService: No Supabase connection, using localStorage');
                }
                initialized = true;
                return;
            }

            // testConnection dio OK. Ahora usamos fetchAllStrict para
            // distinguir error real (lanza) de tabla vacia (array vacio).
            // Antes fetchAll devolvia [] en ambos casos y el ERP caia a
            // localStorage en silencio ante un hipo de red (bug C-5).
            let salesData;
            try {
                salesData = await window.Mazelab.Supabase.fetchAllStrict('ventas');
            } catch (fetchErr) {
                // Caso (c): la conexion fallo de verdad despues de un
                // testConnection OK (hipo de red entre el ping y la lectura,
                // o error del backend en /ventas). NO es tabla vacia.
                // Caemos a modo local PERO marcamos modo degradado y
                // mostramos el banner: el owner debe saber que no se guarda.
                useSupabase = false;
                degradedMode = true;
                console.error('DataService: Connection failed reading ventas, degraded localStorage mode:', fetchErr);
                showOfflineBanner();
                initialized = true;
                return;
            }

            if (salesData && salesData.length > 0) {
                // Caso (a): conexion OK + datos → produccion normal.
                useSupabase = true;
                console.log('DataService: Using Supabase (' + salesData.length + ' sales found)');
            } else {
                // Caso (b): conexion OK + tabla ventas vacia (array vacio
                // valido). No es error. Comportamiento previo intacto, SIN
                // banner de degradado.
                const localSales = window.Mazelab.Storage.SalesService.getAll();
                if (localSales.length > 0) {
                    useSupabase = false;
                    console.log('DataService: Supabase empty, using localStorage (' + localSales.length + ' local sales)');
                } else {
                    useSupabase = true;
                    console.log('DataService: Both empty, defaulting to Supabase for new data');
                }
            }
        } catch (e) {
            // Red de seguridad: cualquier error inesperado fuera de las ramas
            // anteriores. Lo tratamos como degradado para no fingir que
            // guardamos en produccion cuando algo se rompio.
            useSupabase = false;
            degradedMode = true;
            console.warn('DataService: Init error, degraded localStorage mode:', e);
            showOfflineBanner();
        }
        initialized = true;
    }

    // Banner rojo persistente y muy visible para el modo sin conexion
    // forzado por error (bug C-5). Idempotente: si ya existe no lo duplica.
    function showOfflineBanner() {
        if (typeof document === 'undefined') return;
        try {
            if (document.getElementById('mz-offline-banner')) return;
            const banner = document.createElement('div');
            banner.id = 'mz-offline-banner';
            banner.setAttribute('role', 'alert');
            banner.style.cssText = [
                'position:fixed',
                'top:0',
                'left:0',
                'right:0',
                'z-index:2147483647',
                'background:#b91c1c',
                'color:#ffffff',
                'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
                'font-size:14px',
                'font-weight:600',
                'line-height:1.4',
                'text-align:center',
                'padding:12px 16px',
                'box-shadow:0 2px 8px rgba(0,0,0,0.35)',
                'letter-spacing:0.2px'
            ].join(';');
            banner.textContent = 'MODO SIN CONEXION A LA BASE DE DATOS. '
                + 'Tus cambios NO se estan guardando en el servidor. '
                + 'No ingreses datos hasta reconectar y recargar.';
            if (document.body) {
                document.body.insertBefore(banner, document.body.firstChild);
            } else {
                document.documentElement.appendChild(banner);
            }
        } catch (e) {
            console.error('DataService: no se pudo mostrar el banner offline:', e);
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
        isUsingSupabase: () => useSupabase,
        isDegraded: () => degradedMode
    };
})();
