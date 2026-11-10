'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { AppError, validation } = require('../db/errors');

const MAX_BODY = 1024 * 1024; // 1 MB

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
};

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body) || typeof body === 'string';
  const payload = isBuf ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': isBuf ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...headers });
  res.end(payload);
}
const json = (res, status, body) => send(res, status, body, { 'Cache-Control': 'no-store' });

function readBody(req) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '');
    if (!type.includes('application/json')) return reject(validation('Content-Type debe ser application/json.'));
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new AppError(413, 'VALIDATION', 'Cuerpo demasiado grande.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!size) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(validation('JSON no válido.')); }
    });
    req.on('error', reject);
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8' };

function serveStatic(dir, urlPath, res) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.resolve(dir, '.' + rel);
  if (!file.startsWith(path.resolve(dir) + path.sep)) return json(res, 403, { error: { code: 'FORBIDDEN', message: 'Ruta no permitida.' } });
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 404, { error: { code: 'NOT_FOUND', message: 'Archivo no encontrado.' } });
    send(res, 200, data, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  });
}

// CSV seguro: escapa comillas y neutraliza fórmulas (=, +, -, @) para evitar inyección en hojas de cálculo.
function toCsv(headers, rows) {
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [headers.join(','), ...rows.map((r) => r.map(cell).join(','))].join('\r\n') + '\r\n';
}

module.exports = { send, json, readBody, serveStatic, toCsv, SECURITY_HEADERS };
