'use strict';
const { buildRouter } = require('./routes');
const { json, send, readBody, serveStatic } = require('./http/helpers');
const { AppError } = require('./db/errors');
const { verify, sign } = require('./auth/token');
const { can } = require('./auth/permissions');

function createApp(store, config) {
  const router = buildRouter();

  async function audit(usuario_id, accion, entidad, entidad_id, detalle, ip) {
    try { await store.insert('AuditoriaOperacion', { usuario_id: usuario_id ?? null, accion, entidad, entidad_id: entidad_id ?? null, detalle: detalle ? String(detalle).slice(0, 500) : null, ip: ip || null }); }
    catch (e) { console.error('[auditoría] no se pudo registrar:', e.message); }
  }

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const ip = req.socket.remoteAddress || null;
    try {
      if (config.corsOrigin) {
        res.setHeader('Access-Control-Allow-Origin', config.corsOrigin);
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
        res.setHeader('Vary', 'Origin');
        if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      }
      if (!url.pathname.startsWith('/api/')) {
        if (config.serveFrontend && req.method === 'GET') return serveStatic(config.frontendDir, url.pathname, res);
        throw new AppError(404, 'NOT_FOUND', 'Ruta no encontrada.');
      }
      const { route, params, pathMatched } = router.match(req.method, url.pathname);
      if (!route) throw pathMatched ? new AppError(405, 'METHOD', 'Método no permitido.') : new AppError(404, 'NOT_FOUND', 'Ruta no encontrada.');

      let user = null;
      if (!route.public) {
        const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
        const claims = m && verify(m[1], config.jwtSecret);
        if (!claims) throw new AppError(401, 'AUTH', 'Sesión no válida o expirada. Inicie sesión.');
        const u = await store.get('Usuario', claims.sub);          // se consulta en cada petición: refleja bajas y cambios de rol
        if (!u || !u.activo) throw new AppError(401, 'AUTH', 'Usuario inexistente o inactivo.');
        const rol = (await store.get('Rol', u.rol_id))?.nombre;
        user = { ...u, rol };
        if (route.perm && !can(rol, route.perm)) {
          await audit(u.usuario_id, 'ACCESO_DENEGADO', 'API', null, `${req.method} ${url.pathname}`, ip);
          throw new AppError(403, 'FORBIDDEN', 'Su perfil no tiene permiso para esta operación.');
        }
      }
      const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : {};
      const query = Object.fromEntries(url.searchParams);
      const ctx = { req, res, store, config, params, query, body, user, ip, can, sign,
        audit: (uid, a, e, id, d) => audit(uid, a, e, id, d, ip) };
      const out = await route.handler(ctx);
      if (out && out.csv !== undefined) {
        return send(res, 200, out.csv, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${out.filename}"`, 'Cache-Control': 'no-store' });
      }
      if (out && out.status && out.data !== undefined) return json(res, out.status, out.data);
      return json(res, 200, out === undefined ? { ok: true } : out);
    } catch (e) {
      if (e instanceof AppError) return json(res, e.status, { error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}), ...(e.number ? { numero: e.number } : {}) } });
      console.error('[error]', req.method, url.pathname, e);
      return json(res, 500, { error: { code: 'INTERNAL', message: 'Error interno del servidor.' } });
    }
  };
}
module.exports = { createApp };
