'use strict';
// Ejecuta database/FarmaControl_Database.sql (separando lotes en "GO") con la conexión configurada en .env.
// Es equivalente a ejecutar el script en SSMS. Re-ejecutable: el script no duplica datos.
const fs = require('node:fs'); const path = require('node:path');
const { conectar } = require('./db-lib');

(async () => {
  const file = path.join(__dirname, '..', '..', 'database', 'FarmaControl_Database.sql');
  const batches = fs.readFileSync(file, 'utf8').split(/^\s*GO\s*(?:--.*)?$/im).map((b) => b.trim()).filter(Boolean);
  const { pool } = await conectar('master');
  let n = 0;
  for (const b of batches) {
    try { await pool.request().batch(b); n++; }
    catch (e) { console.error(`Error en el lote ${n + 1} del script: ${e.message}\n--- inicio del lote ---\n${b.slice(0, 300)}\n...`); await pool.close(); process.exit(1); }
  }
  await pool.close();
  console.log(`Script ejecutado: ${n} lotes sin errores (${path.basename(file)}). Ejecute "npm run db:check" para verificar.`);
})().catch((e) => { console.error('db:setup falló:', e.message); process.exit(1); });
