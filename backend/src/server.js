'use strict';
const http = require('node:http');
const { config, validateConfig } = require('./config');
const { createApp } = require('./app');

async function createStore(cfg) {
  if (cfg.driver === 'memory') {
    const { MemoryStore } = require('./db/memory');
    const { seedMemory } = require('./db/seed');
    const store = new MemoryStore();
    await seedMemory(store);
    return store;
  }
  const { MssqlStore } = require('./db/mssql');
  return new MssqlStore(cfg.db).connect();
}

async function start(cfg = config) {
  const errs = validateConfig(cfg);
  if (errs.length) { errs.forEach((m) => console.error('Configuración: ' + m)); throw new Error('Configuración incompleta. Revise backend/.env (vea .env.example).'); }
  const store = await createStore(cfg);
  const server = http.createServer(createApp(store, cfg));
  await new Promise((resolve) => server.listen(cfg.port, resolve));
  const addr = server.address();
  console.log(`FarmaControl API en http://localhost:${addr.port} (base de datos: ${store.kind})`);
  return { server, store, port: addr.port, close: async () => { await new Promise((r) => server.close(r)); await store.close(); } };
}

if (require.main === module) {
  start().catch((e) => { console.error(e.message); process.exit(1); });
}
module.exports = { start, createStore };
