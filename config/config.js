'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Lector mínimo de .env (sin dependencias). Las variables del entorno tienen prioridad.
function loadEnv() {
  const file = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|si)$/i.test(v));
const e = process.env;

const config = {
  port: Number(e.PORT || 3000),
  driver: (e.DB_DRIVER || 'mssql').toLowerCase(),
  db: {
    // auth: "sql" (usuario/contraseña, driver tedious) o "windows" (autenticación integrada, driver msnodesqlv8 + ODBC; sin contraseñas)
    auth: (e.DB_AUTH || 'sql').toLowerCase(), odbcDriver: e.DB_ODBC_DRIVER || 'ODBC Driver 18 for SQL Server',
    server: e.DB_SERVER || 'localhost', port: e.DB_PORT ? Number(e.DB_PORT) : null, database: e.DB_NAME || 'FarmaControlBD',
    user: e.DB_USER, password: e.DB_PASSWORD,
    encrypt: bool(e.DB_ENCRYPT, true), trustServerCertificate: bool(e.DB_TRUST_SERVER_CERT, true),
  },
  jwtSecret: e.JWT_SECRET,
  tokenTtlMinutes: Number(e.TOKEN_TTL_MINUTES || 480),
  serveFrontend: bool(e.SERVE_FRONTEND, true),
  corsOrigin: e.CORS_ORIGIN || '',
  frontendDir: path.join(__dirname, '..', 'views'),
};

function validateConfig(c = config) {
  const errs = [];
  if (!c.jwtSecret || c.jwtSecret.length < 32 || c.jwtSecret.startsWith('<'))
    errs.push('JWT_SECRET debe definirse con una cadena aleatoria de al menos 32 caracteres.');
  if (c.driver === 'mssql') {
    if (!['sql', 'windows'].includes(c.db.auth)) errs.push('DB_AUTH debe ser "sql" o "windows".');
    else if (c.db.auth === 'sql' && (!c.db.user || !c.db.password || String(c.db.password).startsWith('<')))
      errs.push('DB_USER y DB_PASSWORD deben configurarse en .env (no se incluyen credenciales en el código), o use DB_AUTH=windows.');
  } else if (c.driver !== 'memory') errs.push('DB_DRIVER debe ser "mssql" o "memory".');
  return errs;
}

module.exports = { config, validateConfig };
