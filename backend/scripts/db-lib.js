'use strict';
// Utilidades compartidas por db:check y db:setup (usan la misma configuración que la API).
const { config } = require('../src/config');
const { MssqlStore } = require('../src/db/mssql');

async function conectar(database) {
  const c = { ...config.db, database: database || config.db.database };
  const win = c.auth === 'windows';
  const sql = win ? require('mssql/msnodesqlv8') : require('mssql');
  const pool = await new sql.ConnectionPool({ ...MssqlStore.poolConfig(c), pool: { max: 1, min: 1 }, requestTimeout: 120000 }).connect();
  return { sql, pool };
}
module.exports = { conectar, config };
