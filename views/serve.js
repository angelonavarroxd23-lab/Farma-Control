'use strict';
// Servidor estático opcional para ejecutar el frontend por separado (puerto 5173).
// Requiere que el backend tenga CORS_ORIGIN=http://localhost:5173 y que js/config.js apunte a la API.
const http = require('node:http'); const fs = require('node:fs'); const path = require('node:path');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const port = Number(process.env.FRONTEND_PORT || 5173);
http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (rel === '/') rel = '/index.html';
  const file = path.resolve(__dirname, '.' + rel);
  if (!file.startsWith(__dirname + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (e, d) => { if (e) { res.writeHead(404); return res.end('No encontrado'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(d); });
}).listen(port, () => console.log(`Frontend en http://localhost:${port}`));
