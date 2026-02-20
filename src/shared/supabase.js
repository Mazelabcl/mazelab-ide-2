window.Mazelab = window.Mazelab || {};

(function () {
    const SUPABASE_URL = 'https://dvrgltvicfkhlukwvdcr.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_pbSQgmfgt-DzOmYcjBn3Mw_WmB207Sj';

    let client = null;
    let isConnected = false;

    function getClient() {
        if (!client && window.supabase) {
            try {
                client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            } catch (e) {
                console.warn('Supabase client creation failed:', e);
            }
        }
        return client;
    }

    async function testConnection() {
        const sb = getClient();
        if (!sb) return false;
        try {
            const { error } = await sb.from('ventas').select('id', { count: 'exact', head: true });
            isConnected = !error;
            return isConnected;
        } catch {
            isConnected = false;
            return false;
        }
    }

    async function fetchAll(table) {
        const sb = getClient();
        if (!sb) return [];
        const { data, error } = await sb.from(table).select('*');
        if (error) { console.error(`Supabase fetch ${table}:`, error); return []; }
        return data || [];
    }

    async function insert(table, record) {
        const sb = getClient();
        if (!sb) return null;
        const { data, error } = await sb.from(table).insert(record).select().single();
        if (error) { console.error(`Supabase insert ${table}:`, error); return null; }
        return data;
    }

    async function update(table, id, updates) {
        const sb = getClient();
        if (!sb) return null;
        const { data, error } = await sb.from(table).update(updates).eq('id', id).select().single();
        if (error) { console.error(`Supabase update ${table}:`, error); return null; }
        return data;
    }

    async function remove(table, id) {
        const sb = getClient();
        if (!sb) return false;
        const { error } = await sb.from(table).delete().eq('id', id);
        if (error) { console.error(`Supabase delete ${table}:`, error); return false; }
        return true;
    }

    async function upsertMany(table, records) {
        const sb = getClient();
        if (!sb) return [];
        const { data, error } = await sb.from(table).upsert(records).select();
        if (error) { console.error(`Supabase upsert ${table}:`, error); return []; }
        return data || [];
    }

    window.Mazelab.Supabase = {
        getClient,
        testConnection,
        isConnected: () => isConnected,
        fetchAll,
        insert,
        update,
        remove,
        upsertMany
    };
})();
