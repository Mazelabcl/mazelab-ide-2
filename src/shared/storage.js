window.Mazelab = window.Mazelab || {};

(function () {
    const KEYS = {
        services: 'mazelab_services',
        staff: 'mazelab_staff',
        clients: 'mazelab_clients',
        sales: 'mazelab_sales',
        receivables: 'mazelab_receivables',
        payables: 'mazelab_payables'
    };

    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    }

    function getAll(key) {
        try {
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : [];
        } catch {
            return [];
        }
    }

    function saveAll(key, items) {
        localStorage.setItem(key, JSON.stringify(items));
    }

    function getById(key, id) {
        return getAll(key).find(item => item.id === id) || null;
    }

    function create(key, record) {
        const items = getAll(key);
        record.id = record.id || generateId();
        record.createdAt = record.createdAt || new Date().toISOString();
        items.push(record);
        saveAll(key, items);
        return record;
    }

    function update(key, id, updates) {
        const items = getAll(key);
        const idx = items.findIndex(item => item.id === id);
        if (idx === -1) return null;
        items[idx] = { ...items[idx], ...updates, updatedAt: new Date().toISOString() };
        saveAll(key, items);
        return items[idx];
    }

    function remove(key, id) {
        const items = getAll(key);
        const filtered = items.filter(item => item.id !== id);
        if (filtered.length === items.length) return false;
        saveAll(key, filtered);
        return true;
    }

    function importMany(key, records) {
        const existing = getAll(key);
        const merged = [...existing];
        records.forEach(record => {
            record.id = record.id || generateId();
            record.createdAt = record.createdAt || new Date().toISOString();
            const existingIdx = merged.findIndex(e => e.id === record.id);
            if (existingIdx >= 0) {
                merged[existingIdx] = { ...merged[existingIdx], ...record };
            } else {
                merged.push(record);
            }
        });
        saveAll(key, merged);
        return merged;
    }

    function clearAll(key) {
        localStorage.removeItem(key);
    }

    function hasData(key) {
        return getAll(key).length > 0;
    }

    // Build service-specific CRUD
    function createService(storageKey) {
        return {
            getAll: () => getAll(storageKey),
            getById: (id) => getById(storageKey, id),
            create: (record) => create(storageKey, record),
            update: (id, updates) => update(storageKey, id, updates),
            remove: (id) => remove(storageKey, id),
            importMany: (records) => importMany(storageKey, records),
            clearAll: () => clearAll(storageKey),
            hasData: () => hasData(storageKey)
        };
    }

    window.Mazelab.Storage = {
        KEYS,
        generateId,
        ServicesService: createService(KEYS.services),
        StaffService: createService(KEYS.staff),
        ClientsService: createService(KEYS.clients),
        SalesService: createService(KEYS.sales),
        ReceivablesService: createService(KEYS.receivables),
        PayablesService: createService(KEYS.payables)
    };
})();
