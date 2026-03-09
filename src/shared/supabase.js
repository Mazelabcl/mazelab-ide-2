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
        try {
            const res = await fetch(BASE + '/' + table + '/' + id, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });
            if (!res.ok) { console.error('DB update ' + table + ':', res.status); return null; }
            return await res.json();
        } catch (e) {
            console.error('DB update ' + table + ':', e);
            return null;
        }
    }

    async function remove(table, id) {
        try {
            const res = await fetch(BASE + '/' + table + '/' + id, { method: 'DELETE' });
            if (!res.ok) { console.error('DB delete ' + table + ':', res.status); return false; }
            return true;
        } catch (e) {
            console.error('DB delete ' + table + ':', e);
            return false;
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
        insert,
        update,
        remove,
        upsertMany
    };
})();
