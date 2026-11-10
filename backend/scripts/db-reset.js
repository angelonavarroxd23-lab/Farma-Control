'use strict';
// BORRA la base FarmaControlBD y la recrea desde cero con los datos de demostración (solo desarrollo).
// Uso: npm run db:reset -- --confirmar      (cierre antes el backend para liberar conexiones)
const fs = require('node:fs'); const path = require('node:path');
const { conectar } = require('./db-lib');
if (!process.argv.includes('--confirmar')) { console.error('Esta acción ELIMINA la base de datos. Repita con: npm run db:reset -- --confirmar'); process.exit(2); }
(async () => {
  const dir = path.join(__dirname, '..', '..', 'database'); const { pool } = await conectar('master'); let n = 0;
  for (const f of ['FarmaControl_Reset.sql', 'FarmaControl_Database.sql']) {
    for (const b of fs.readFileSync(path.join(dir, f), 'utf8').split(/^\s*GO\s*(?:--.*)?$/im).map((x) => x.trim()).filter(Boolean)) {
      try { await pool.request().batch(b); n++; } catch (e) { console.error(`Error en ${f}: ${e.message}`); await pool.close(); process.exit(1); }
    }
  }
  await pool.close(); console.log(`Base recreada desde cero (${n} lotes ejecutados). Ejecute "npm run db:check".`);
})().catch((e) => { console.error('db:reset falló:', e.message); process.exit(1); });
