window.Mazelab = window.Mazelab || {};

(function () {
    const BASE = '/api/db';
    let isConnected = false;

    async function testConnection() {
        try {
            const res = await fetch(BASE + '/ventas?limit=1');
            isConnected = res.ok;
            return isConnected;
        } catch {
            isConnected = false;
            return false;
        }
    }

    async function fetchAll(table) {
        try {
            const res = await fetch(BASE + '/' + table);
            if (!res.ok) { console.error('DB fetch ' + table + ':', res.status); return []; }
            const data = await res.json();
            return Array.isArray(data) ? data : (data.rows || data.data || []);
        } catch (e) {
            console.error('DB fetch ' + table + ':', e);
            return [];
        }
    }

    // Variante estricta de fetchAll para distinguir "tabla vacia" de
    // "fallo de conexion" (bug C-5). A diferencia de fetchAll, NO traga el
    // error: en exito devuelve el array (vacio o no), y en !res.ok o
    // excepcion de red LANZA un Error. Solo la usa init() para decidir
    // honestamente si hay conexion. No tocar fetchAll: muchos callers
    // asumen que siempre devuelve array.
    async function fetchAllStrict(table) {
        const res = await fetch(BASE + '/' + table);
        if (!res.ok) {
            const errText = await res.text().catch(function () { return String(res.status); });
            throw new Error('Error al leer "' + table + '" (HTTP ' + res.status + '): ' + errText);
        }
        const data = await res.json();
        return Array.isArray(data) ? data : (data.rows || data.data || []);
    }

    async function insert(table, record) {
        const res = await fetch(BASE + '/' + table, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(record)
        });
        if (!res.ok) {
            const errText = await res.text().catch(function () { return String(res.status); });
            throw new Error('Error al guardar en ' + table + ' (HTTP ' + res.status + '): ' + errText);
        }
        return await res.json();
    }

    async function update(table, id, updates) {
        // Bug C-1: antes devolvia null en !res.ok o en excepcion, tragandose
        // el fallo. Una factura podia "marcarse pagada" en la UI aunque el
        // PATCH fallara contra el backend. Ahora LANZA igual que insert(),
        // para que los try/catch de los flujos financieros (que ya existen)
        // capturen el error y avisen al usuario.
        try {
            const res = await fetch(BASE + '/' + table + '/' + id, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });
            if (!res.ok) {
                const errText = await res.text().catch(function () { return String(res.status); });
                throw new Error('Error al actualizar en ' + table + ' (HTTP ' + res.status + '): ' + errText);
            }
            return await res.json();
        } catch (e) {
            console.error('DB update ' + table + ':', e);
            throw e;
        }
    }

    async function remove(table, id) {
        // Bug C-1: antes devolvia false en fallo, tragandose el error.
        // Ahora LANZA para que los callers (que envuelven en try/catch)
        // detecten que el DELETE no se aplico en el backend.
        try {
            const res = await fetch(BASE + '/' + table + '/' + id, { method: 'DELETE' });
            if (!res.ok) {
                const errText = await res.text().catch(function () { return String(res.status); });
                throw new Error('Error al eliminar en ' + table + ' (HTTP ' + res.status + '): ' + errText);
            }
            return true;
        } catch (e) {
            console.error('DB delete ' + table + ':', e);
            throw e;
        }
    }

    async function upsertMany(table, records) {
        const BATCH_SIZE = 100;
        const results = [];
        for (let i = 0; i < records.length; i += BATCH_SIZE) {
            const batch = records.slice(i, i + BATCH_SIZE);
            const res = await fetch(BASE + '/' + table + '/upsert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(batch)
            });
            if (!res.ok) {
                const errText = await res.text().catch(function () { return String(res.status); });
                console.error('DB upsert ' + table + ':', res.status, errText);
                throw new Error('Error al importar "' + table + '" (lote ' + Math.floor(i / BATCH_SIZE + 1) + '): HTTP ' + res.status + ' — ' + errText);
            }
            const data = await res.json().catch(function () { return []; });
            if (Array.isArray(data)) results.push(...data);
        }
        return results;
    }

    window.Mazelab.Supabase = {
        testConnection,
        isConnected: function () { return isConnected; },
        fetchAll,
        fetchAllStrict,
        insert,
        update,
        remove,
        upsertMany
    };
})();
