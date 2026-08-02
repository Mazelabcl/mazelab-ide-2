// Helper compartido para "mazelab_company_info" (Sprint M1, Lote M1-D).
// Antes vivía SOLO en localStorage. Ahora vive en la tabla `config` (fila
// id/key = 'company_info', value = JSONB con los datos de la empresa), con
// localStorage como espejo de compatibilidad y como fallback en la transición
// (filas que aún no existen en la base) y en modo ?localdev=1 (donde
// DataService no tiene un ConfigService de storage.js — ver nota en preload()).
//
// Contrato:
//   - getCompanyInfo(): Promise<object> — lee de la base (o localStorage si la
//     fila no existe todavía), cachea en memoria.
//   - getCompanyInfoSync(): object — getter sincrónico sobre la cache en
//     memoria. Requiere que preload() haya corrido antes (se llama desde
//     initApp, después de DataService.init()). settings.js, finance.js y
//     cotizador.js lo usan porque leen company_info dentro de renders
//     sincrónicos (no pueden await una promesa a mitad de un render() que
//     devuelve un string de HTML). Si preload() nunca corrió, cae a leer
//     localStorage directo para no romper el primer render.
//   - saveCompanyInfo(obj): Promise<object> — guarda en memoria + localStorage
//     de inmediato (no depende de la red), e intenta upsert a la base en
//     background. Si el upsert falla (sin conexión, modo solo lectura), el
//     espejo en localStorage ya quedó guardado — no se pierde el dato del
//     usuario, se reintentará sincronizar en el próximo save.
window.Mazelab = window.Mazelab || {};

(function () {
    'use strict';

    var STORAGE_KEY = 'mazelab_company_info';
    var CONFIG_KEY = 'company_info';

    var _cache = null;   // último valor conocido (objeto plano)
    var _loaded = false; // true una vez que preload()/saveCompanyInfo() corrió al menos una vez

    function readLocalStorage() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        } catch (e) {
            return {};
        }
    }

    function writeLocalStorage(obj) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(obj || {}));
        } catch (e) {
            // localStorage no disponible o cuota excedida — no bloquear el flujo,
            // el valor sigue vivo en _cache para esta sesión.
        }
    }

    function findConfigRow(rows) {
        if (!Array.isArray(rows)) return null;
        for (var i = 0; i < rows.length; i++) {
            if (rows[i] && rows[i].key === CONFIG_KEY) return rows[i];
        }
        return null;
    }

    // Carga async desde DataService (entidad 'config'), con fallback a
    // localStorage si la fila no existe aún (transición) o si la consulta
    // falla (sin conexión, modo solo lectura, o localdev sin ConfigService
    // de storage.js — getStorageService('config') no existe deliberadamente,
    // ver Lote M1-D: TABLE_MAP se tocó, storage.js no).
    function preload() {
        var DS = window.Mazelab.DataService;
        var fetchPromise = (DS && DS.getAll) ? DS.getAll('config') : Promise.resolve([]);
        return fetchPromise
            .then(function (rows) {
                var row = findConfigRow(rows);
                _cache = (row && row.value) ? row.value : readLocalStorage();
                _loaded = true;
                return _cache;
            })
            .catch(function () {
                _cache = readLocalStorage();
                _loaded = true;
                return _cache;
            });
    }

    function getCompanyInfo() {
        if (_loaded) return Promise.resolve(_cache);
        return preload();
    }

    function getCompanyInfoSync() {
        if (_loaded) return _cache;
        return readLocalStorage();
    }

    function saveCompanyInfo(obj) {
        var value = obj || {};
        _cache = value;
        _loaded = true;
        writeLocalStorage(value); // espejo inmediato, no depende de la red

        var DS = window.Mazelab.DataService;
        if (!DS || !DS.getAll) return Promise.resolve(value);

        return DS.getAll('config')
            .then(function (rows) {
                var existing = findConfigRow(rows);
                if (existing) {
                    return DS.update('config', existing.id, { value: value });
                }
                return DS.create('config', { id: CONFIG_KEY, key: CONFIG_KEY, value: value });
            })
            .catch(function (e) {
                // Sin conexión o solo lectura: el espejo en localStorage ya quedó
                // guardado arriba — se sincroniza a la base la próxima vez que
                // haya conexión y el usuario vuelva a guardar.
                console.warn('No se pudo guardar company_info en la base de datos:', e && e.message);
            })
            .then(function () { return value; });
    }

    window.Mazelab.CompanyInfo = {
        preload: preload,
        getCompanyInfo: getCompanyInfo,
        getCompanyInfoSync: getCompanyInfoSync,
        saveCompanyInfo: saveCompanyInfo
    };
})();
