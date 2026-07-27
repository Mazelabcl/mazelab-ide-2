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
        // Lanza en error de red o de servidor — un array vacío devuelto aquí antes se
        // trataba como "sin datos legítimo" y disparaba fallback silencioso a localStorage.
        const res = await fetch(BASE + '/' + table);
        if (!res.ok) {
            const errText = await res.text().catch(function () { return String(res.status); });
            throw new Error('Error al leer ' + table + ' (HTTP ' + res.status + '): ' + errText);
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
        // Mismo patrón que insert(): lanza en vez de devolver null — un null se
        // interpretaba en llamadores como "no pasó nada" en vez de un error real.
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
    }

    async function remove(table, id) {
        // Mismo patrón que insert(): lanza en vez de devolver false.
        const res = await fetch(BASE + '/' + table + '/' + id, { method: 'DELETE' });
        if (!res.ok) {
            const errText = await res.text().catch(function () { return String(res.status); });
            throw new Error('Error al eliminar en ' + table + ' (HTTP ' + res.status + '): ' + errText);
        }
        return true;
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
        insert,
        update,
        remove,
        upsertMany
    };
})();
