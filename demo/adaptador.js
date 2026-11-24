'use strict';
// Demostración en GitHub Pages: ejecuta en el navegador la MISMA aplicación del servidor (app.js, rutas, controladores
// y modelos) con el almacén en memoria, e intercepta las llamadas fetch('/api/...') de la vista.
// No hay SQL Server: los datos viven en la pestaña y se reinician al recargar. La versión real usa models/mssql.js.
/* global window, __req, Response, sessionStorage */
(function () {
  const { createApp } = __req('app.js');
  const { MemoryStore } = __req('models/memory.js');
  const { seedMemory } = __req('models/seed.js');
  let secret = null;
  try { secret = sessionStorage.getItem('fc_demo_secret'); } catch { /* sin almacenamiento */ }
  if (!secret) { secret = __req('node:crypto').randomBytes(32).toString('hex'); try { sessionStorage.setItem('fc_demo_secret', secret); } catch { /* */ } }
  const cfg = { jwtSecret: secret, tokenTtlMinutes: 480, corsOrigin: '', serveFrontend: false };
  const ready = (async () => { const store = new MemoryStore(); await seedMemory(store); return createApp(store, cfg); })();
  const realFetch = window.fetch.bind(window);

  window.fetch = async function (input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;
    if (!/^\/api\//.test(url)) return realFetch(input, init);
    const handler = await ready;
    const headers = {}; Object.entries(init.headers || {}).forEach(([k, v]) => { headers[k.toLowerCase()] = v; });
    const listeners = {};
    const req = { method: init.method || 'GET', url, headers, socket: { remoteAddress: 'navegador' },
      on(ev, cb) { listeners[ev] = cb; if (ev === 'end') setTimeout(() => { if (init.body) listeners.data?.(Buffer.from(init.body)); cb(); }, 0); return req; },
      destroy() {} };
    return new Promise((resolve) => {
      const res = { _h: {}, setHeader(k, v) { this._h[k] = v; }, writeHead(s, h) { this.statusCode = s; Object.assign(this._h, h || {}); return this; },
        end(body) { resolve(new Response(this.statusCode === 204 ? null : (body ?? ''), { status: this.statusCode || 200, headers: this._h })); } };
      handler(req, res);
    });
  };
})();
