'use strict';
// Lanzador multiplataforma: node scripts/run-tests.js [memory|mssql]
// Las suites se ejecutan EN SERIE: comparten la misma base de datos y varias pruebas comparan contadores globales.
const fs = require('node:fs'); const path = require('node:path'); const { spawnSync } = require('node:child_process');
const driver = process.argv[2] || process.env.DB_DRIVER || 'memory';
const dir = path.join(__dirname, '..', 'tests');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort().map((f) => path.join(dir, f));
console.log(`Ejecutando ${files.length} suites con el controlador: ${driver}`);
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=spec', ...files], { stdio: 'inherit', env: { ...process.env, DB_DRIVER: driver } });
process.exit(r.status ?? 1);
