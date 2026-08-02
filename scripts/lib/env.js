// Parser de archivos .env — sin dependencias (no dotenv). Extraído de
// scripts/migrate-backup.js (Sprint M1, Lote M1-C) a este módulo compartido
// en el Sprint E2E, para que migrate-backup.js, provision-e2e-users.js y
// cleanup-e2e-data.js usen el mismo parser en vez de copias divergentes.
//
// El archivo lo crea el dueño a mano con Bloc de notas en Windows, así que
// debe tolerar:
//   - BOM UTF-8 al inicio del archivo (Notepad lo agrega por defecto).
//   - Fin de línea CRLF (\r\n).
//   - Espacios alrededor de la clave, del "=" y del valor.
//   - Comillas simples o dobles envolviendo el valor (opcional).
//   - Líneas vacías y comentarios ("# ...").
'use strict';

const fs = require('fs');

function parseEnvFile(filePath) {
    const raw = fs.readFileSync(filePath);
    let text = raw.toString('utf8');
    // BOM UTF-8: al decodificar como utf8, el BOM queda como el carácter
    // U+FEFF al inicio del string — quitarlo antes de partir en líneas.
    if (text.charCodeAt(0) === 0xFEFF) {
        text = text.slice(1);
    }

    const out = {};
    text.split(/\r?\n/).forEach(function (line) {
        const trimmedLine = line.trim();
        if (trimmedLine === '' || trimmedLine.indexOf('#') === 0) return;

        const eqIdx = trimmedLine.indexOf('=');
        if (eqIdx === -1) return; // línea sin "=" — se ignora, no es un KEY=VALUE válido

        const key = trimmedLine.slice(0, eqIdx).trim();
        let value = trimmedLine.slice(eqIdx + 1).trim();
        if (value.length >= 2) {
            const first = value.charAt(0);
            const last = value.charAt(value.length - 1);
            if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) {
                value = value.slice(1, -1);
            }
        }
        if (key !== '') out[key] = value;
    });
    return out;
}

// Wrapper conveniente para los scripts nuevos (provision/cleanup E2E): si el
// archivo no existe, devuelve {} en vez de lanzar — a diferencia del loadEnv()
// específico de migrate-backup.js (que devuelve la forma {exists,url,key} y
// es SUPABASE-específico), este es genérico para cualquier .env plano.
function loadEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return {};
    return parseEnvFile(filePath);
}

module.exports = {
    parseEnvFile: parseEnvFile,
    loadEnvFile: loadEnvFile
};
