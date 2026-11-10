/* FarmaControl — demostración para GitHub Pages. Generado por scripts/build-pages.js; no editar. */
(function(){
const __defs = {}, __cache = {}; window.__req = function (id) { if (window.__FC_SHIMS[id]) return window.__FC_SHIMS[id];
  if (__cache[id]) return __cache[id].exports; const module = { exports: {} }; __cache[id] = module; __defs[id](module, module.exports); return module.exports; };
__defs['app.js'] = function (module, exports) {
'use strict';
const { buildRouter } = __req('routes/index.js');
const { json, send, readBody, serveStatic } = __req('lib/http/helpers.js');
const { AppError } = __req('models/errors.js');
const { verify, sign } = __req('lib/auth/token.js');
const { can } = __req('lib/auth/permissions.js');

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

};
__defs['routes/index.js'] = function (module, exports) {
'use strict';
// Tabla de rutas: asocia método + URL + permiso con un método de controlador.
const { Router } = __req('lib/http/router.js');
const auditoria = __req('controllers/auditoriaController.js');
const auth = __req('controllers/authController.js');
const catalogo = __req('controllers/catalogoController.js');
const clientes = __req('controllers/clientesController.js');
const compras = __req('controllers/comprasController.js');
const inventario = __req('controllers/inventarioController.js');
const proveedores = __req('controllers/proveedoresController.js');
const recetas = __req('controllers/recetasController.js');
const reportes = __req('controllers/reportesController.js');
const usuarios = __req('controllers/usuariosController.js');
const ventas = __req('controllers/ventasController.js');

function buildRouter() {
  const r = new Router();
  const get = (p, perm, h) => r.add('GET', p, { perm }, h);
  const post = (p, perm, h) => r.add('POST', p, { perm }, h);
  const patch = (p, perm, h) => r.add('PATCH', p, { perm }, h);
  const del = (p, perm, h) => r.add('DELETE', p, { perm }, h);

  // ---------------- Público ----------------
  r.add('GET', '/api/health', { public: true }, auth.estadoServicio);
  r.add('POST', '/api/auth/login', { public: true }, auth.iniciarSesion);
  // ---------------- Sesión ----------------
  r.add('GET', '/api/auth/me', { auth: true }, auth.perfilActual);
  r.add('POST', '/api/auth/password', { auth: true }, auth.cambiarClave);
  r.add('POST', '/api/auth/logout', { auth: true }, auth.cerrarSesion);
  // ---------------- Usuarios y roles ----------------
  get('/api/roles', 'usuarios:read', usuarios.listarRoles);
  get('/api/usuarios', 'usuarios:read', usuarios.listarUsuarios);
  post('/api/usuarios', 'usuarios:write', usuarios.crearUsuarios);
  patch('/api/usuarios/:id', 'usuarios:write', usuarios.actualizarUsuarios);
  // ---------------- Clientes ----------------
  get('/api/clientes', 'clientes:read', clientes.listarClientes);
  post('/api/clientes', 'clientes:write', clientes.crearClientes);
  patch('/api/clientes/:id', 'clientes:write', clientes.actualizarClientes);
  // ---------------- Proveedores ----------------
  get('/api/proveedores', 'proveedores:read', proveedores.listarProveedores);
  post('/api/proveedores', 'proveedores:write', proveedores.crearProveedores);
  patch('/api/proveedores/:id', 'proveedores:write', proveedores.actualizarProveedores);
  // ---------------- Categorías ----------------
  get('/api/categorias', 'catalogo:read', catalogo.listarCategorias);
  post('/api/categorias', 'catalogo:write', catalogo.crearCategorias);
  patch('/api/categorias/:id', 'catalogo:write', catalogo.actualizarCategorias);
  del('/api/categorias/:id', 'catalogo:write', catalogo.eliminarCategorias);
  // ---------------- Medicamentos y lotes ----------------
  get('/api/medicamentos', 'catalogo:read', catalogo.listarMedicamentos);
  get('/api/medicamentos/:id', 'catalogo:read', catalogo.obtenerMedicamentos);
  post('/api/medicamentos', 'catalogo:write', catalogo.crearMedicamentos);
  patch('/api/medicamentos/:id', 'catalogo:write', catalogo.actualizarMedicamentos);
  get('/api/lotes', 'catalogo:read', catalogo.listarLotes);
  post('/api/lotes', 'catalogo:write', catalogo.crearLotes);
  patch('/api/lotes/:id', 'catalogo:write', catalogo.actualizarLotes);
  // ---------------- Recetas ----------------
  get('/api/recetas', 'recetas:read', recetas.listarRecetas);
  post('/api/recetas', 'recetas:write', recetas.crearRecetas);
  patch('/api/recetas/:id', 'recetas:write', recetas.actualizarRecetas);
  // ---------------- Compras ----------------
  get('/api/compras', 'compras:read', compras.listarCompras);
  get('/api/compras/:id', 'compras:read', compras.obtenerCompras);
  post('/api/compras', 'compras:create', compras.crearCompras);
  // ---------------- Ventas ----------------
  get('/api/ventas', 'ventas:read', ventas.listarVentas);
  get('/api/ventas/:id', 'ventas:read', ventas.obtenerVentas);
  post('/api/ventas', 'ventas:create', ventas.crearVentas);
  post('/api/ventas/:id/anular', 'ventas:anular', ventas.anularVentas);
  // ---------------- Movimientos y alertas ----------------
  get('/api/movimientos', 'movimientos:read', inventario.listarMovimientos);
  get('/api/alertas', 'alertas:read', inventario.listarAlertas);
  // ---------------- Panel y reportes ----------------
  get('/api/resumen', 'alertas:read', reportes.listarResumen);
  get('/api/reportes/resumen', 'reportes:read', reportes.listarReportesResumen);
  get('/api/reportes/ventas.csv', 'reportes:read', reportes.listarReportesVentasCsv);
  get('/api/reportes/inventario.csv', 'reportes:read', reportes.listarReportesInventarioCsv);
  get('/api/reportes/movimientos.csv', 'reportes:read', reportes.listarReportesMovimientosCsv);
  // ---------------- Auditoría ----------------
  get('/api/auditoria', 'auditoria:read', auditoria.listarAuditoria);
  return r;
}

module.exports = { buildRouter };

};
__defs['lib/http/router.js'] = function (module, exports) {
'use strict';
// Enrutador mínimo con parámetros de ruta (":id").
class Router {
  constructor() { this.routes = []; }
  add(method, pattern, opts, handler) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:([a-z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    this.routes.push({ method, re, keys, ...opts, handler });
  }
  match(method, pathname) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params = {}; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
    return { route: null, pathMatched };
  }
}
module.exports = { Router };

};
__defs['controllers/auditoriaController.js'] = function (module, exports) {
'use strict';
const { byId } = __req('models/util.js');

/** Controlador auditoria: recibe la petición ya autenticada, usa los modelos y devuelve la respuesta. */
const listarAuditoria = async ({ store, query }) => {
  const users = byId(await store.list('Usuario'), 'usuario_id');
  let rows = (await store.list('AuditoriaOperacion')).reverse();
  if (query.accion) rows = rows.filter((a) => a.accion === query.accion);
  return rows.slice(0, Math.min(Number(query.limit) || 200, 1000)).map((a) => ({ ...a, usuario: a.usuario_id ? users.get(a.usuario_id)?.nombres : null }));
};

module.exports = { listarAuditoria };

};
__defs['models/util.js'] = function (module, exports) {
'use strict';
const V = __req('models/validate.js');
const { validation } = __req('models/errors.js');

const byId = (rows, pk) => new Map(rows.map((r) => [r[pk], r]));
const inRange = (fecha, desde, hasta) => (!desde || fecha.slice(0, 10) >= desde) && (!hasta || fecha.slice(0, 10) <= hasta);
const round2 = (n) => Math.round(n * 100) / 100;
const includesCI = (hay, q) => String(hay ?? '').toLowerCase().includes(q.toLowerCase());

function checkPeriodo(q) {
  const desde = q.desde || null, hasta = q.hasta || null;
  for (const [n, v] of [['desde', desde], ['hasta', hasta]]) if (v && !V.isRealDate(v)) throw validation('Datos no válidos.', [`${n}: fecha no válida (AAAA-MM-DD).`]);
  if (desde && hasta && desde > hasta) throw validation('El periodo es inválido: la fecha inicial es posterior a la final.');
  return { desde, hasta };
}

module.exports = { byId, inRange, round2, includesCI, checkPeriodo };

};
__defs['models/validate.js'] = function (module, exports) {
'use strict';
// Validación de entradas en el servidor, guiada por el esquema (tipos, longitudes, enumeraciones).
const { TABLES } = __req('models/schema.js');
const { validation } = __req('models/errors.js');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (s) => { if (!DATE_RE.test(s)) return false; const d = new Date(`${s}T00:00:00Z`); return !isNaN(d) && d.toISOString().slice(0, 10) === s; };

function clean(table, input, { partial = false, allow } = {}) {
  const def = TABLES[table];
  const out = {}; const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw validation('El cuerpo de la petición debe ser un objeto JSON.');
  const fields = allow || Object.keys(def.cols).filter((c) => !def.cols[c].auto && !def.cols[c].ro && !def.cols[c].computed);
  for (const c of fields) {
    const d = def.cols[c];
    let v = input[c];
    if (v === undefined) { if (!partial && d.req) errors.push(`${c}: es obligatorio.`); continue; }
    if (typeof v === 'string') v = v.trim();
    if (v === '' || v === null) {
      if (d.req) errors.push(`${c}: es obligatorio.`); else out[c] = null;
      continue;
    }
    switch (d.t) {
      case 'int': case 'bigint':
        if (!Number.isInteger(Number(v)) || typeof v === 'boolean') { errors.push(`${c}: debe ser un entero.`); continue; }
        v = Number(v); break;
      case 'dec':
        if (isNaN(Number(v)) || typeof v === 'boolean') { errors.push(`${c}: debe ser numérico.`); continue; }
        v = Math.round(Number(v) * 100) / 100; break;
      case 'bit':
        if (typeof v === 'boolean') break;
        if (v === 1 || v === '1' || v === 'true') v = true; else if (v === 0 || v === '0' || v === 'false') v = false;
        else { errors.push(`${c}: debe ser verdadero o falso.`); continue; }
        break;
      case 'date':
        if (!isRealDate(v)) { errors.push(`${c}: fecha no válida (AAAA-MM-DD).`); continue; }
        break;
      default:
        if (typeof v !== 'string' && typeof v !== 'number') { errors.push(`${c}: texto no válido.`); continue; }
        v = String(v);
        if (d.max && v.length > d.max) { errors.push(`${c}: máximo ${d.max} caracteres.`); continue; }
        if (d.enum && !d.enum.includes(v)) { errors.push(`${c}: valor no permitido (${d.enum.join(', ')}).`); continue; }
    }
    out[c] = v;
  }
  if (errors.length) throw validation('Datos no válidos.', errors);
  return out;
}

// Reglas de formato específicas del dominio (replican los CHECK del script SQL).
const digits = (s, n) => /^[0-9]+$/.test(s) && (n == null || s.length === n);
function checkCliente(r) {
  const errs = [];
  if (r.tipo_documento === 'DNI' && !digits(r.numero_documento, 8)) errs.push('numero_documento: el DNI tiene 8 dígitos.');
  if (r.tipo_documento === 'RUC' && !digits(r.numero_documento, 11)) errs.push('numero_documento: el RUC tiene 11 dígitos.');
  if (['CE', 'OTR'].includes(r.tipo_documento) && (r.numero_documento.length < 4 || r.numero_documento.length > 15)) errs.push('numero_documento: entre 4 y 15 caracteres.');
  if (errs.length) throw validation('Datos no válidos.', errs);
}
function checkProveedor(r) { if (r.ruc !== undefined && !(digits(r.ruc, 11))) throw validation('Datos no válidos.', ['ruc: debe tener 11 dígitos.']); }
function checkMedicamento(r) { if (r.precio_venta !== undefined && r.precio_venta < 0) throw validation('Datos no válidos.', ['precio_venta: no puede ser negativo.']); }
function checkReceta(r) { if (r.fecha_emision && r.fecha_vencimiento && r.fecha_vencimiento < r.fecha_emision) throw validation('Datos no válidos.', ['fecha_vencimiento: no puede ser anterior a la emisión.']); }
const positiveInt = (v, name) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw validation('Datos no válidos.', [`${name}: debe ser un entero positivo.`]); return n; };

module.exports = { clean, isRealDate, checkCliente, checkProveedor, checkMedicamento, checkReceta, positiveInt };

};
__defs['models/schema.js'] = function (module, exports) {
'use strict';
// Metadatos del modelo físico (14 tablas). Se usan para: (1) validar entradas en el servidor,
// (2) construir sentencias SQL parametrizadas con identificadores de una lista cerrada
// (nunca derivados de la entrada del usuario) y (3) emular restricciones en el controlador de memoria.
// t: tipo | max: longitud | req: obligatorio | def: valor por defecto | auto: identidad
// ro: no escribible desde la API | ascii: VARCHAR/CHAR | enum | fk: tabla referenciada
const col = (t, o = {}) => ({ t, ...o });

const TABLES = {
  Rol: {
    pk: 'rol_id',
    cols: { rol_id: col('int', { auto: true }), nombre: col('str', { max: 40, req: true }), descripcion: col('str', { max: 180 }) },
    unique: [{ name: 'UQ_Rol_Nombre', cols: ['nombre'], label: 'el nombre del rol' }],
  },
  Usuario: {
    pk: 'usuario_id',
    cols: {
      usuario_id: col('int', { auto: true }), rol_id: col('int', { req: true, fk: 'Rol' }),
      nombres: col('str', { max: 120, req: true }), correo: col('str', { max: 160, req: true }),
      hash_contrasena: col('str', { max: 255, req: true, ro: true }), activo: col('bit', { def: true }),
    },
    unique: [{ name: 'UQ_Usuario_Correo', cols: ['correo'], label: 'el correo' }],
  },
  Cliente: {
    pk: 'cliente_id',
    cols: {
      cliente_id: col('int', { auto: true }),
      tipo_documento: col('str', { max: 3, req: true, ascii: true, enum: ['DNI', 'CE', 'RUC', 'OTR'] }),
      numero_documento: col('str', { max: 15, req: true, ascii: true }),
      nombre_razon_social: col('str', { max: 160, req: true }), telefono: col('str', { max: 20, ascii: true }),
    },
    unique: [{ name: 'UQ_Cliente_Doc', cols: ['tipo_documento', 'numero_documento'], label: 'el tipo y número de documento' }],
  },
  Proveedor: {
    pk: 'proveedor_id',
    cols: {
      proveedor_id: col('int', { auto: true }), ruc: col('str', { max: 11, req: true, ascii: true }),
      razon_social: col('str', { max: 180, req: true }), contacto: col('str', { max: 120 }),
      telefono: col('str', { max: 20, ascii: true }), activo: col('bit', { def: true }),
    },
    unique: [{ name: 'UQ_Proveedor_Ruc', cols: ['ruc'], label: 'el RUC' }],
  },
  Categoria: {
    pk: 'categoria_id',
    cols: { categoria_id: col('int', { auto: true }), nombre: col('str', { max: 90, req: true }) },
    unique: [{ name: 'UQ_Categoria_Nombre', cols: ['nombre'], label: 'el nombre de la categoría' }],
  },
  Medicamento: {
    pk: 'medicamento_id',
    cols: {
      medicamento_id: col('int', { auto: true }), categoria_id: col('int', { req: true, fk: 'Categoria' }),
      sku: col('str', { max: 30, req: true, ascii: true }), nombre: col('str', { max: 160, req: true }),
      principio_activo: col('str', { max: 160 }), presentacion: col('str', { max: 90, req: true }),
      precio_venta: col('dec', { req: true }), requiere_receta: col('bit', { def: false }), activo: col('bit', { def: true }),
    },
    unique: [{ name: 'UQ_Medicamento_Sku', cols: ['sku'], label: 'el SKU' }],
  },
  Receta: {
    pk: 'receta_id',
    cols: {
      receta_id: col('int', { auto: true }), cliente_id: col('int', { req: true, fk: 'Cliente' }),
      numero_receta: col('str', { max: 50, req: true, ascii: true }), nombre_prescriptor: col('str', { max: 160, req: true }),
      fecha_emision: col('date', { req: true }), fecha_vencimiento: col('date', { req: true }),
      estado: col('str', { max: 12, ascii: true, def: 'VALIDA', enum: ['VALIDA', 'ANULADA'] }), observacion: col('str', { max: 250 }),
    },
    unique: [{ name: 'UQ_Receta_Numero', cols: ['numero_receta'], label: 'el número de receta' }],
  },
  Lote: {
    pk: 'lote_id',
    cols: {
      lote_id: col('int', { auto: true }), medicamento_id: col('int', { req: true, fk: 'Medicamento' }),
      codigo_lote: col('str', { max: 60, req: true }), fecha_vencimiento: col('date', { req: true }),
      stock_actual: col('int', { def: 0, ro: true }), stock_minimo: col('int', { def: 5 }),
    },
    unique: [{ name: 'UQ_Lote_Codigo', cols: ['medicamento_id', 'codigo_lote'], label: 'el código de lote para ese medicamento' }],
  },
  Compra: {
    pk: 'compra_id',
    cols: {
      compra_id: col('int', { auto: true }), proveedor_id: col('int', { fk: 'Proveedor' }), usuario_id: col('int', { fk: 'Usuario' }),
      fecha: col('dt', { auto: true }), numero_documento: col('str', { max: 40, ascii: true }), total: col('dec'),
    },
    unique: [{ name: 'UQ_Compra_Documento', cols: ['proveedor_id', 'numero_documento'], label: 'el documento para ese proveedor' }],
  },
  DetalleCompra: {
    pk: 'detalle_compra_id',
    cols: {
      detalle_compra_id: col('int', { auto: true }), compra_id: col('int', { fk: 'Compra' }), lote_id: col('int', { fk: 'Lote' }),
      cantidad: col('int'), costo_unitario: col('dec'), subtotal: col('dec', { computed: true }),
    },
    unique: [],
  },
  Venta: {
    pk: 'venta_id',
    cols: {
      venta_id: col('int', { auto: true }), cliente_id: col('int', { fk: 'Cliente' }), usuario_id: col('int', { fk: 'Usuario' }),
      receta_id: col('int', { fk: 'Receta' }), fecha: col('dt', { auto: true }),
      tipo_comprobante: col('str', { max: 10, ascii: true }), numero_comprobante: col('str', { max: 30, ascii: true }),
      estado: col('str', { max: 12, ascii: true }), total: col('dec'), fecha_anulacion: col('dt'),
      usuario_anulacion_id: col('int', { fk: 'Usuario' }), motivo_anulacion: col('str', { max: 250 }),
    },
    unique: [{ name: 'UQ_Venta_Comprobante', cols: ['tipo_comprobante', 'numero_comprobante'], label: 'el comprobante' }],
  },
  DetalleVenta: {
    pk: 'detalle_venta_id',
    cols: {
      detalle_venta_id: col('int', { auto: true }), venta_id: col('int', { fk: 'Venta' }), lote_id: col('int', { fk: 'Lote' }),
      cantidad: col('int'), precio_unitario: col('dec'), subtotal: col('dec', { computed: true }),
    },
    unique: [],
  },
  MovimientoStock: {
    pk: 'movimiento_id',
    cols: {
      movimiento_id: col('bigint', { auto: true }), lote_id: col('int', { fk: 'Lote' }), usuario_id: col('int', { fk: 'Usuario' }),
      compra_id: col('int', { fk: 'Compra' }), venta_id: col('int', { fk: 'Venta' }),
      tipo: col('str', { max: 18, ascii: true }), cantidad: col('int'), fecha: col('dt', { auto: true }),
    },
    unique: [],
  },
  AuditoriaOperacion: {
    pk: 'auditoria_id',
    cols: {
      auditoria_id: col('bigint', { auto: true }), usuario_id: col('int', { fk: 'Usuario' }),
      accion: col('str', { max: 40, ascii: true, req: true }), entidad: col('str', { max: 40, ascii: true, req: true }),
      entidad_id: col('int'), detalle: col('str', { max: 500 }), ip: col('str', { max: 45, ascii: true }), fecha: col('dt', { auto: true }),
    },
    unique: [],
  },
};

module.exports = { TABLES };

};
__defs['models/errors.js'] = function (module, exports) {
'use strict';
// Errores de dominio compartidos por los controladores de datos (SQL Server y memoria).
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;   // código HTTP
    this.code = code;       // VALIDATION | UNIQUE | FK | CHECK | BUSINESS | NOT_FOUND | AUTH | FORBIDDEN | RATE_LIMIT
    this.details = details;
  }
}
const validation = (msg, details) => new AppError(400, 'VALIDATION', msg, details);
const business = (msg, number) => Object.assign(new AppError(422, 'BUSINESS', msg), { number });
const notFound = (msg = 'Recurso no encontrado.') => new AppError(404, 'NOT_FOUND', msg);
const unique = (msg) => new AppError(409, 'UNIQUE', msg);
const fk = (msg) => new AppError(409, 'FK', msg);
module.exports = { AppError, validation, business, notFound, unique, fk };

};
__defs['controllers/authController.js'] = function (module, exports) {
'use strict';
const { AppError, validation } = __req('models/errors.js');
const { hashPassword, verifyPassword, passwordPolicyError } = __req('lib/auth/password.js');
const { pub } = __req('controllers/presenters.js');

/** Controlador auth: recibe la petición ya autenticada, usa los modelos y devuelve la respuesta. */
const DUMMY_HASH = hashPassword('contraseña-ficticia-para-igualar-tiempos');
const attempts = new Map(); // limitador de intentos de acceso: clave ip|correo
const MAX_ATTEMPTS = 5, WINDOW_MS = 15 * 60 * 1000;

const estadoServicio = async ({ store, config }) => {
  await store.ping();
  return { status: 'ok', driver: store.kind, hora_servidor: new Date().toISOString() };
};

const iniciarSesion = async (ctx) => {
  const { store, body, ip, audit, config } = ctx;
  const correo = String(body.correo || '').trim().toLowerCase();
  const clave = String(body.contrasena || '');
  if (!correo || !clave) throw validation('Ingrese correo y contraseña.');
  const key = `${ip}|${correo}`; const now = Date.now();
  const rec = attempts.get(key);
  if (rec && rec.count >= MAX_ATTEMPTS && now - rec.first < WINDOW_MS)
    throw new AppError(429, 'RATE_LIMIT', 'Demasiados intentos fallidos. Espere 15 minutos.');
  const user = (await store.list('Usuario', { correo }))[0];
  const ok = verifyPassword(clave, user ? user.hash_contrasena : DUMMY_HASH) && user && user.activo;
  if (!ok) {
    const cur = rec && now - rec.first < WINDOW_MS ? rec : { count: 0, first: now };
    cur.count += 1; attempts.set(key, cur);
    await audit(user ? user.usuario_id : null, 'LOGIN_FALLIDO', 'Usuario', user ? user.usuario_id : null, `Correo: ${correo.slice(0, 120)}`);
    throw new AppError(401, 'AUTH', 'Credenciales incorrectas o usuario inactivo.');
  }
  attempts.delete(key);
  const roles = await store.list('Rol');
  const token = ctx.sign({ sub: user.usuario_id }, config.jwtSecret, config.tokenTtlMinutes * 60);
  await audit(user.usuario_id, 'LOGIN_OK', 'Usuario', user.usuario_id, null);
  return { token, usuario: pub(user, roles), expira_en_minutos: config.tokenTtlMinutes };
};

const perfilActual = async ({ user, store }) => pub(user, await store.list('Rol'));

const cambiarClave = async ({ user, store, body, audit }) => {
  if (!verifyPassword(String(body.actual || ''), user.hash_contrasena)) throw new AppError(401, 'AUTH', 'La contraseña actual no es correcta.');
  const err = passwordPolicyError(body.nueva); if (err) throw validation(err);
  await store.update('Usuario', user.usuario_id, { hash_contrasena: hashPassword(body.nueva) });
  await audit(user.usuario_id, 'CLAVE_CAMBIADA', 'Usuario', user.usuario_id, null);
  return { ok: true };
};

const cerrarSesion = async ({ user, audit }) => { await audit(user.usuario_id, 'LOGOUT', 'Usuario', user.usuario_id, null); return { ok: true }; };

module.exports = { estadoServicio, iniciarSesion, perfilActual, cambiarClave, cerrarSesion };

};
__defs['lib/auth/password.js'] = function (module, exports) {
'use strict';
// Hash de contraseñas con scrypt (módulo crypto de Node; sin dependencias externas).
// Formato almacenado: scrypt$N$r$p$<sal base64>$<hash base64>
const crypto = __req('node:crypto');

const N = 16384, R = 8, P = 1, KEYLEN = 64;

function hashPassword(plain, saltBuf) {
  const salt = saltBuf || crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(plain), salt, KEYLEN, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64'), dk.toString('base64')].join('$');
}

function verifyPassword(plain, stored) {
  try {
    const [alg, n, r, p, saltB64, hashB64] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const dk = crypto.scryptSync(String(plain), Buffer.from(saltB64, 'base64'), expected.length,
      { N: +n, r: +r, p: +p });
    return dk.length === expected.length && crypto.timingSafeEqual(dk, expected);
  } catch { return false; }
}

// Política mínima de contraseña para altas y cambios de clave.
function passwordPolicyError(plain) {
  const s = String(plain || '');
  if (s.length < 10) return 'La contraseña debe tener al menos 10 caracteres.';
  if (!/[a-z]/.test(s) || !/[A-Z]/.test(s) || !/[0-9]/.test(s))
    return 'La contraseña debe combinar mayúsculas, minúsculas y números.';
  return null;
}

module.exports = { hashPassword, verifyPassword, passwordPolicyError };

};
__defs['controllers/presenters.js'] = function (module, exports) {
'use strict';
// Presentadores: dan forma pública a los datos (nunca exponen el hash de contraseña).
const pub = (u, roles) => ({ usuario_id: u.usuario_id, nombres: u.nombres, correo: u.correo, activo: u.activo, rol_id: u.rol_id, rol: roles.find((r) => r.rol_id === u.rol_id)?.nombre });

module.exports = { pub };

};
__defs['controllers/catalogoController.js'] = function (module, exports) {
'use strict';
const { validation, notFound } = __req('models/errors.js');
const V = __req('models/validate.js');
const inv = __req('models/inventario.js');
const { includesCI } = __req('models/util.js');

/** Controlador catalogo: recibe la petición ya autenticada, usa los modelos y devuelve la respuesta. */
const listarCategorias = ({ store }) => store.list('Categoria');

const crearCategorias = async ({ store, body, user, audit }) => {
  const d = V.clean('Categoria', body);
  const row = await store.insert('Categoria', d);
  await audit(user.usuario_id, 'CATEGORIA_CREADA', 'Categoria', row.categoria_id, d.nombre);
  return { status: 201, data: row };
};

const actualizarCategorias = async ({ store, params, body, user, audit }) => {
  const id = V.positiveInt(params.id, 'id');
  const row = await store.update('Categoria', id, V.clean('Categoria', body, { partial: true }));
  await audit(user.usuario_id, 'CATEGORIA_MODIFICADA', 'Categoria', id, null);
  return row;
};

const eliminarCategorias = async ({ store, params, user, audit }) => {
  const id = V.positiveInt(params.id, 'id'); await store.remove('Categoria', id);
  await audit(user.usuario_id, 'CATEGORIA_ELIMINADA', 'Categoria', id, null);
  return { ok: true };
};

const listarMedicamentos = async ({ store, query }) => {
  const [meds, cats, lotes] = await Promise.all([store.list('Medicamento'), store.list('Categoria'), store.list('Lote')]);
  let rows = inv.resumenMedicamentos(meds, cats, lotes);
  if (query.q) rows = rows.filter((m) => includesCI(m.nombre, query.q) || includesCI(m.sku, query.q) || includesCI(m.principio_activo, query.q));
  if (query.categoria_id) rows = rows.filter((m) => m.categoria_id === Number(query.categoria_id));
  if (query.activo !== undefined) rows = rows.filter((m) => String(m.activo) === query.activo);
  return rows;
};

const obtenerMedicamentos = async ({ store, params }) => {
  const id = V.positiveInt(params.id, 'id'); const m = await store.get('Medicamento', id); if (!m) throw notFound();
  const lotes = inv.enriquecerLotes(await store.list('Lote', { medicamento_id: id }), [m]);
  return { ...m, lotes };
};

const crearMedicamentos = async ({ store, body, user, audit }) => {
  const d = V.clean('Medicamento', body); V.checkMedicamento(d);
  const row = await store.insert('Medicamento', { ...d, requiere_receta: d.requiere_receta ?? false, activo: d.activo ?? true });
  await audit(user.usuario_id, 'MEDICAMENTO_CREADO', 'Medicamento', row.medicamento_id, d.sku);
  return { status: 201, data: row };
};

const actualizarMedicamentos = async ({ store, params, body, user, audit }) => {
  const id = V.positiveInt(params.id, 'id'); if (!(await store.get('Medicamento', id))) throw notFound();
  const d = V.clean('Medicamento', body, { partial: true }); V.checkMedicamento(d);
  const row = await store.update('Medicamento', id, d);
  await audit(user.usuario_id, 'MEDICAMENTO_MODIFICADO', 'Medicamento', id, Object.keys(d).join(','));
  return row;
};

const listarLotes = async ({ store, query }) => {
  const [lotes, meds] = await Promise.all([store.list('Lote'), store.list('Medicamento')]);
  let rows = inv.enriquecerLotes(lotes, meds);
  if (query.medicamento_id) rows = rows.filter((l) => l.medicamento_id === Number(query.medicamento_id));
  if (query.alerta) rows = rows.filter((l) => l.alerta === query.alerta);
  if (query.q) rows = rows.filter((l) => includesCI(l.medicamento, query.q) || includesCI(l.sku, query.q) || includesCI(l.codigo_lote, query.q));
  if (query.disponibles === 'true') rows = rows.filter((l) => l.stock_actual > 0 && !l.vencido && l.medicamento_activo);
  return rows;
};

const crearLotes = async ({ store, body, user, audit }) => {
  const d = V.clean('Lote', body, { allow: ['medicamento_id', 'codigo_lote', 'fecha_vencimiento', 'stock_minimo'] });
  if (d.fecha_vencimiento < inv.todayStr()) throw validation('Datos no válidos.', ['fecha_vencimiento: un lote nuevo no puede estar vencido.']);
  if (d.stock_minimo != null && d.stock_minimo < 0) throw validation('Datos no válidos.', ['stock_minimo: no puede ser negativo.']);
  const row = await store.insert('Lote', { ...d, stock_actual: 0, stock_minimo: d.stock_minimo ?? 5 }); // el stock solo cambia por compras/ventas
  await audit(user.usuario_id, 'LOTE_CREADO', 'Lote', row.lote_id, d.codigo_lote);
  return { status: 201, data: row };
};

const actualizarLotes = async ({ store, params, body, user, audit }) => {
  const id = V.positiveInt(params.id, 'id'); if (!(await store.get('Lote', id))) throw notFound();
  const d = V.clean('Lote', body, { partial: true, allow: ['stock_minimo', 'fecha_vencimiento'] });
  if (d.stock_minimo != null && d.stock_minimo < 0) throw validation('Datos no válidos.', ['stock_minimo: no puede ser negativo.']);
  const row = await store.update('Lote', id, d);
  await audit(user.usuario_id, 'LOTE_MODIFICADO', 'Lote', id, Object.keys(d).join(','));
  return row;
};

module.exports = { listarCategorias, crearCategorias, actualizarCategorias, eliminarCategorias, listarMedicamentos, obtenerMedicamentos, crearMedicamentos, actualizarMedicamentos, listarLotes, crearLotes, actualizarLotes };

};
__defs['models/inventario.js'] = function (module, exports) {
'use strict';
// Reglas de lectura de inventario compartidas por todos los controladores de datos:
// estado de lote, alertas y existencias agregadas por medicamento.
const pad = (n) => String(n).padStart(2, '0');
const todayStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 864e5);

const DIAS_ALERTA = 30;

// Prioridad idéntica a la vista dbo.vw_AlertasLote.
function estadoLote(l, hoy = todayStr()) {
  if (l.stock_actual > 0 && l.fecha_vencimiento < hoy) return 'VENCIDO';
  if (l.stock_actual === 0 && l.fecha_vencimiento >= hoy) return 'AGOTADO';
  if (l.stock_actual > 0 && l.fecha_vencimiento <= addDays(hoy, DIAS_ALERTA)) return 'POR_VENCER';
  if (l.stock_actual > 0 && l.stock_actual <= l.stock_minimo) return 'STOCK_BAJO';
  return null;
}

function enriquecerLotes(lotes, meds, hoy = todayStr()) {
  const byId = new Map(meds.map((m) => [m.medicamento_id, m]));
  return lotes.map((l) => {
    const m = byId.get(l.medicamento_id) || {};
    return {
      ...l, sku: m.sku, medicamento: m.nombre, presentacion: m.presentacion, precio_venta: m.precio_venta,
      requiere_receta: !!m.requiere_receta, medicamento_activo: !!m.activo,
      dias_para_vencer: daysBetween(hoy, l.fecha_vencimiento), vencido: l.fecha_vencimiento < hoy, alerta: estadoLote(l, hoy),
    };
  });
}

function alertas(lotes, meds, hoy = todayStr()) {
  return enriquecerLotes(lotes, meds, hoy).filter((l) => l.alerta && l.medicamento_activo)
    .sort((a, b) => ORDEN[a.alerta] - ORDEN[b.alerta] || a.fecha_vencimiento.localeCompare(b.fecha_vencimiento));
}
const ORDEN = { VENCIDO: 0, AGOTADO: 1, POR_VENCER: 2, STOCK_BAJO: 3 };

function resumenMedicamentos(meds, cats, lotes, hoy = todayStr()) {
  const catById = new Map(cats.map((c) => [c.categoria_id, c.nombre]));
  return meds.map((m) => {
    const ls = lotes.filter((l) => l.medicamento_id === m.medicamento_id);
    return {
      ...m, categoria: catById.get(m.categoria_id),
      stock_vendible: ls.filter((l) => l.fecha_vencimiento >= hoy).reduce((a, l) => a + l.stock_actual, 0),
      stock_vencido: ls.filter((l) => l.fecha_vencimiento < hoy).reduce((a, l) => a + l.stock_actual, 0),
      lotes: ls.length,
    };
  });
}

module.exports = { estadoLote, enriquecerLotes, alertas, resumenMedicamentos, todayStr, addDays, DIAS_ALERTA };

};
__defs['controllers/clientesController.js'] = function (module, exports) {
'use strict';
const { notFound } = __req('models/errors.js');
const V = __req('models/validate.js');
const { includesCI } = __req('models/util.js');

/** Controlador clientes: recibe la petición ya autenticada, usa los modelos y devuelve la respuesta. */
const listarClientes = async ({ store, query }) => {
  let rows = await store.list('Cliente');
  if (query.q) rows = rows.filter((c) => includesCI(c.nombre_razon_social, query.q) || includesCI(c.numero_documento, query.q));
  return rows;
};

const crearClientes = async ({ store, body, user, audit }) => {
  const d = V.clean('Cliente', body); V.checkCliente(d);
  const row = await store.insert('Cliente', d);
  await audit(user.usuario_id, 'CLIENTE_CREADO', 'Cliente', row.cliente_id, `${d.tipo_documento} ${d.numero_documento}`);
  return { status: 201, data: row };
};

const actualizarClientes = async ({ store, params, body, user, audit }) => {
  const id = V.positiveInt(params.id, 'id'); const cur = await store.get('Cliente', id); if (!cur) throw notFound();
  const d = V.clean('Cliente', body, { partial: true }); V.checkCliente({ ...cur, ...d });
  const row = await store.update('Cliente', id, d);
  await audit(user.usuario_id, 'CLIENTE_MODIFICADO', 'Cliente', id, null);
  return row;
};

module.exports = { listarClientes, crearClientes, actualizarClientes };

};
__defs['controllers/comprasController.js'] = function (module, exports) {
'use strict';
const { validation, notFound } = __req('models/errors.js');
const V = __req('models/validate.js');
const inv = __req('models/inventario.js');
const { byId, inRange, round2 } = __req('models/util.js');

/** Controlador compras: recibe la petición ya autenticada, usa los modelos y devuelve la respuesta. */
const listarCompras = async ({ store, query }) => {
  const [compras, provs, users] = await Promise.all([store.list('Compra'), store.list('Proveedor'), store.list('Usuario')]);
  const P = byId(provs, 'proveedor_id'), U = byId(users, 'usuario_id');
  return compras.filter((c) => inRange(c.fecha, query.desde, query.hasta)).reverse()
    .map((c) => ({ ...c, proveedor: P.get(c.proveedor_id)?.razon_social, usuario: U.get(c.usuario_id)?.nombres }));
};

const obtenerCompras = async ({ store, params }) => {
  const id = V.positiveInt(params.id, 'id'); const c = await store.get('Compra', id); if (!c) throw notFound();
  const [det, lotes, meds, prov, usr] = await Promise.all([store.list('DetalleCompra', { compra_id: id }), store.list('Lote'), store.list('Medicamento'), store.get('Proveedor', c.proveedor_id), store.get('Usuario', c.usuario_id)]);
  const L = byId(inv.enriquecerLotes(lotes, meds), 'lote_id');
  return { ...c, proveedor: prov?.razon_social, usuario: usr?.nombres, detalle: det.map((d) => ({ ...d, codigo_lote: L.get(d.lote_id)?.codigo_lote, medicamento: L.get(d.lote_id)?.medicamento })) };
};

const crearCompras = async ({ store, body, user, ip, audit }) => {
  const errs = [];
  const proveedorId = Number(body.proveedor_id);
  if (!Number.isInteger(proveedorId) || proveedorId <= 0) errs.push('proveedor_id: es obligatorio.');
  const doc = String(body.numero_documento || '').trim();
  if (!doc) errs.push('numero_documento: es obligatorio.'); else if (doc.length > 40) errs.push('numero_documento: máximo 40 caracteres.');
  if (!Array.isArray(body.items) || !body.items.length) errs.push('items: agregue al menos un lote.');
  const items = [];
  for (const [k, it] of (Array.isArray(body.items) ? body.items : []).entries()) {
    const lote_id = Number(it?.lote_id), cantidad = Number(it?.cantidad), costo = Number(it?.costo_unitario);
    if (!Number.isInteger(lote_id) || lote_id <= 0) errs.push(`items[${k}].lote_id: no válido.`);
    if (!Number.isInteger(cantidad) || cantidad <= 0 || cantidad > 1000000) errs.push(`items[${k}].cantidad: entero positivo.`);
    if (!(costo >= 0) || costo > 1e7) errs.push(`items[${k}].costo_unitario: debe ser mayor o igual a 0.`);
    items.push({ lote_id, cantidad, costo_unitario: round2(costo) });
  }
  if (new Set(items.map((i) => i.lote_id)).size !== items.length) errs.push('items: un lote solo puede aparecer una vez por compra.');
  if (errs.length) throw validation('Datos no válidos.', errs);
  const res = await store.registrarCompra({ proveedorId, usuarioId: user.usuario_id, numeroDocumento: doc, items, ip });
  return { status: 201, data: res };
};

module.exports = { listarCompras, obtenerCompras, crearCompras };

};
__defs['controllers/inventarioController.js'] = function (module, exports) {
'use strict';
const inv = __req('models/inventario.js');
const { kardex } = __req('models/reportes.js');

/** Controlador inventario: recibe la petición ya autenticada, usa los modelos y devuelve la respuesta. */
const listarMovimientos = async ({ store, query }) => (await kardex(store, query)).slice(0, Math.min(Number(query.limit) || 300, 1000));

const listarAlertas = async ({ store }) => {
  const [lotes, meds] = await Promise.all([store.list('Lote'), store.list('Medicamento')]);
  const rows = inv.alertas(lotes, meds);
  const conteo = { VENCIDO: 0, AGOTADO: 0, POR_VENCER: 0, STOCK_BAJO: 0 };
  rows.forEach((a) => { conteo[a.alerta] += 1; });
  return { conteo, alertas: rows };
};

module.exports = { listarMovimientos, listarAlertas };

};
__defs['models/reportes.js'] = function (module, exports) {
'use strict';
const inv = __req('models/inventario.js');
const { byId, inRange, round2, checkPeriodo } = __req('models/util.js');

/** Modelo de reportes: consultas agregadas sobre el almacén (kardex y ventas por periodo). */
async function kardex(store, q) {
  const { desde, hasta } = checkPeriodo(q);
  const [movs, lotes, meds, users] = await Promise.all([store.list('MovimientoStock'), store.list('Lote'), store.list('Medicamento'), store.list('Usuario')]);
  const L = byId(inv.enriquecerLotes(lotes, meds), 'lote_id'), U = byId(users, 'usuario_id');
  const ventas = byId(await store.list('Venta'), 'venta_id'), compras = byId(await store.list('Compra'), 'compra_id');
  return movs.filter((m) => inRange(m.fecha, desde, hasta) && (!q.lote_id || m.lote_id === Number(q.lote_id)) && (!q.tipo || m.tipo === q.tipo)).reverse()
    .map((m) => ({ ...m, codigo_lote: L.get(m.lote_id)?.codigo_lote, medicamento: L.get(m.lote_id)?.medicamento, sku: L.get(m.lote_id)?.sku, usuario: U.get(m.usuario_id)?.nombres,
      documento: m.venta_id ? ventas.get(m.venta_id)?.numero_comprobante : compras.get(m.compra_id)?.numero_documento }));
}

async function reporteVentas(store, q) {
  const { desde, hasta } = checkPeriodo(q);
  const [ventas, det, lotes, meds, clientes] = await Promise.all([store.list('Venta'), store.list('DetalleVenta'), store.list('Lote'), store.list('Medicamento'), store.list('Cliente')]);
  const enr = byId(inv.enriquecerLotes(lotes, meds), 'lote_id'), C = byId(clientes, 'cliente_id');
  const enPeriodo = ventas.filter((v) => inRange(v.fecha, desde, hasta));
  const ok = enPeriodo.filter((v) => v.estado === 'CONFIRMADA'), anul = enPeriodo.filter((v) => v.estado === 'ANULADA');
  const idsOk = new Set(ok.map((v) => v.venta_id));
  const detOk = det.filter((d) => idsOk.has(d.venta_id));
  const porDia = {}; ok.forEach((v) => { const k = v.fecha.slice(0, 10); (porDia[k] ||= { fecha: k, numero: 0, importe: 0 }); porDia[k].numero += 1; porDia[k].importe = round2(porDia[k].importe + v.total); });
  const top = {}; detOk.forEach((d) => { const m = enr.get(d.lote_id)?.medicamento || '(sin dato)'; (top[m] ||= { medicamento: m, unidades: 0, importe: 0 }); top[m].unidades += d.cantidad; top[m].importe = round2(top[m].importe + d.subtotal); });
  const importe = round2(ok.reduce((a, v) => a + v.total, 0));
  return { periodo: { desde, hasta }, ok, anul, detOk, C, enr,
    resumen: { ventas_confirmadas: ok.length, importe_total: importe, ticket_promedio: ok.length ? round2(importe / ok.length) : 0,
      unidades_vendidas: detOk.reduce((a, d) => a + d.cantidad, 0), ventas_anuladas: anul.length, importe_anulado: round2(anul.reduce((a, v) => a + v.total, 0)) },
    por_dia: Object.values(porDia).sort((a, b) => a.fecha.localeCompare(b.fecha)),
    top_productos: Object.values(top).sort((a, b) => b.unidades - a.unidades).slice(0, 10) };
}

module.exports = { kardex, reporteVentas };

};
__defs['controllers/proveedoresController.js'] = function (module, exports) {
'use strict';
const { notFound } = __req('models/errors.js');
const V = __req('models/validate.js');

/** Controlador proveedores: recibe la petición ya autenticada, usa los modelos y devuelve la respuesta. */
const listarProveedores = ({ store }) => store.list('Proveedor');

const crearProveedores = async ({ store, body, user, audit }) => {
  const d = V.clean('Proveedor', body); V.checkProveedor(d);
  const row = await store.insert('Proveedor', { ...d, activo: d.activo ?? true });
  await audit(user.usuario_id, 'PROVEEDOR_CREADO', 'Proveedor', row.proveedor_id, d.ruc);
  return { status: 201, data: row };
};

const actualizarProveedores = async ({ store, params, body, user, audit }) => {
  const id = V.positiveInt(params.id, 'id'); if (!(await store.get('Proveedor', id))) throw notFound();
  const d = V.clean('Proveedor', body, { partial: true }); V.checkProveedor(d);
  const row = await store.update('Proveedor', id, d);
  await audit(user.usuario_id, 'PROVEEDOR_MODIFICADO', 'Proveedor', id, null);
  return row;
};

module.exports = { listarProveedores, crearProveedores, actualizarProveedores };

};
__defs['controllers/recetasController.js'] = function (module, exports) {
'use strict';
const { validation, notFound } = __req('models/errors.js');
const V = __req('models/validate.js');
const inv = __req('models/inventario.js');
const { byId } = __req('models/util.js');

/** Controlador recetas: recibe la petición ya autenticada, usa los modelos y devuelve la respuesta. */
const recetaView = (r, clientes, hoy) => ({ ...r, cliente: clientes.get(r.cliente_id)?.nombre_razon_social, vigente: r.estado === 'VALIDA' && r.fecha_emision <= hoy && r.fecha_vencimiento >= hoy });

const listarRecetas = async ({ store, query }) => {
  const hoy = inv.todayStr(); const clientes = byId(await store.list('Cliente'), 'cliente_id');
  let rows = (await store.list('Receta')).map((x) => recetaView(x, clientes, hoy));
  if (query.cliente_id) rows = rows.filter((x) => x.cliente_id === Number(query.cliente_id));
  if (query.vigentes === 'true') rows = rows.filter((x) => x.vigente);
  return rows;
};

const crearRecetas = async ({ store, body, user, audit }) => {
  const d = V.clean('Receta', body, { allow: ['cliente_id', 'numero_receta', 'nombre_prescriptor', 'fecha_emision', 'fecha_vencimiento', 'observacion'] });
  V.checkReceta(d);
  if (!(await store.get('Cliente', d.cliente_id))) throw validation('Datos no válidos.', ['cliente_id: el cliente no existe.']);
  const row = await store.insert('Receta', { ...d, estado: 'VALIDA' });
  await audit(user.usuario_id, 'RECETA_REGISTRADA', 'Receta', row.receta_id, d.numero_receta);
  return { status: 201, data: row };
};

const actualizarRecetas = async ({ store, params, body, user, audit }) => {
  const id = V.positiveInt(params.id, 'id'); if (!(await store.get('Receta', id))) throw notFound();
  const row = await store.update('Receta', id, V.clean('Receta', body, { partial: true, allow: ['estado', 'observacion'] }));
  await audit(user.usuario_id, 'RECETA_MODIFICADA', 'Receta', id, row.estado);
  return row;
};

module.exports = { listarRecetas, crearRecetas, actualizarRecetas };

};
__defs['controllers/reportesController.js'] = function (module, exports) {
'use strict';
const inv = __req('models/inventario.js');
const { toCsv } = __req('lib/http/helpers.js');
const { round2 } = __req('models/util.js');
const { kardex, reporteVentas } = __req('models/reportes.js');

/** Controlador reportes: recibe la petición ya autenticada, usa los modelos y devuelve la respuesta. */
const listarResumen = async ({ store, user, can }) => {
  const [lotes, meds, clientes] = await Promise.all([store.list('Lote'), store.list('Medicamento'), store.list('Cliente')]);
  const al = inv.alertas(lotes, meds); const hoy = inv.todayStr();
  const out = { medicamentos_activos: meds.filter((m) => m.activo).length, clientes: clientes.length,
    alertas: { VENCIDO: al.filter((a) => a.alerta === 'VENCIDO').length, AGOTADO: al.filter((a) => a.alerta === 'AGOTADO').length,
      POR_VENCER: al.filter((a) => a.alerta === 'POR_VENCER').length, STOCK_BAJO: al.filter((a) => a.alerta === 'STOCK_BAJO').length },
    alertas_recientes: al.slice(0, 5) };
  if (can(user.rol, 'ventas:read')) {
    const ventas = (await store.list('Venta')).filter((v) => v.fecha.slice(0, 10) === hoy);
    const ok = ventas.filter((v) => v.estado === 'CONFIRMADA');
    out.ventas_hoy = { numero: ok.length, importe: round2(ok.reduce((a, v) => a + v.total, 0)), anuladas: ventas.length - ok.length };
  }
  return out;
};

const listarReportesResumen = async ({ store, query }) => {
  const { ok, anul, detOk, C, enr, ...rest } = await reporteVentas(store, query);
  const [lotes, meds] = await Promise.all([store.list('Lote'), store.list('Medicamento')]);
  const e = inv.enriquecerLotes(lotes, meds);
  return { ...rest, inventario: { lotes: e.length, unidades_vendibles: e.filter((l) => !l.vencido).reduce((a, l) => a + l.stock_actual, 0),
    unidades_vencidas: e.filter((l) => l.vencido).reduce((a, l) => a + l.stock_actual, 0),
    valor_venta_vendible: round2(e.filter((l) => !l.vencido).reduce((a, l) => a + l.stock_actual * l.precio_venta, 0)) } };
};

const listarReportesVentasCsv = async ({ store, query }) => {
  const { ok, anul, C } = await reporteVentas(store, query);
  const rows = [...ok, ...anul].sort((a, b) => a.venta_id - b.venta_id).map((v) => [v.numero_comprobante, v.fecha, C.get(v.cliente_id)?.nombre_razon_social, v.tipo_comprobante, v.estado, v.total.toFixed(2)]);
  return { csv: toCsv(['comprobante', 'fecha', 'cliente', 'tipo', 'estado', 'total'], rows), filename: 'ventas.csv' };
};

const listarReportesInventarioCsv = async ({ store }) => {
  const [lotes, meds] = await Promise.all([store.list('Lote'), store.list('Medicamento')]);
  const rows = inv.enriquecerLotes(lotes, meds).map((l) => [l.sku, l.medicamento, l.codigo_lote, l.fecha_vencimiento, l.stock_actual, l.stock_minimo, l.precio_venta.toFixed(2), l.alerta || 'OK']);
  return { csv: toCsv(['sku', 'medicamento', 'lote', 'vencimiento', 'stock', 'stock_minimo', 'precio_venta', 'estado'], rows), filename: 'inventario.csv' };
};

const listarReportesMovimientosCsv = async ({ store, query }) => {
  const rows = (await kardex(store, query)).map((m) => [m.movimiento_id, m.fecha, m.tipo, m.sku, m.medicamento, m.codigo_lote, m.cantidad, m.documento, m.usuario]);
  return { csv: toCsv(['movimiento', 'fecha', 'tipo', 'sku', 'medicamento', 'lote', 'cantidad', 'documento', 'usuario'], rows), filename: 'movimientos.csv' };
};

module.exports = { listarResumen, listarReportesResumen, listarReportesVentasCsv, listarReportesInventarioCsv, listarReportesMovimientosCsv };

};
__defs['lib/http/helpers.js'] = function (module, exports) {
'use strict';
const fs = __req('node:fs');
const path = __req('node:path');
const { AppError, validation } = __req('models/errors.js');

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

};
__defs['controllers/usuariosController.js'] = function (module, exports) {
'use strict';
const { validation, business, notFound } = __req('models/errors.js');
const { hashPassword, passwordPolicyError } = __req('lib/auth/password.js');
const V = __req('models/validate.js');
const { pub } = __req('controllers/presenters.js');

/** Controlador usuarios: recibe la petición ya autenticada, usa los modelos y devuelve la respuesta. */
const listarRoles = ({ store }) => store.list('Rol');

const listarUsuarios = async ({ store }) => {
  const roles = await store.list('Rol');
  return (await store.list('Usuario')).map((u) => pub(u, roles));
};

const crearUsuarios = async ({ store, body, user, audit }) => {
  const d = V.clean('Usuario', body, { allow: ['rol_id', 'nombres', 'correo'] });
  d.correo = d.correo.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.correo)) throw validation('Datos no válidos.', ['correo: formato no válido.']);
  const err = passwordPolicyError(body.contrasena); if (err) throw validation(err);
  const row = await store.insert('Usuario', { ...d, hash_contrasena: hashPassword(body.contrasena), activo: true });
  await audit(user.usuario_id, 'USUARIO_CREADO', 'Usuario', row.usuario_id, d.correo);
  return { status: 201, data: pub(row, await store.list('Rol')) };
};

const actualizarUsuarios = async ({ store, params, body, user, audit }) => {
  const id = V.positiveInt(params.id, 'id');
  const cur = await store.get('Usuario', id); if (!cur) throw notFound();
  const d = V.clean('Usuario', body, { partial: true, allow: ['rol_id', 'nombres', 'activo'] });
  if (body.contrasena !== undefined) { const err = passwordPolicyError(body.contrasena); if (err) throw validation(err); d.hash_contrasena = hashPassword(body.contrasena); }
  if (d.activo === false && id === user.usuario_id) throw business('No puede desactivar el perfil que está en uso.');
  const roles = await store.list('Rol');
  const adminId = roles.find((x) => x.nombre === 'Administrador')?.rol_id;
  const users = await store.list('Usuario');
  const adminsActivos = users.filter((u) => u.rol_id === adminId && u.activo && u.usuario_id !== id).length;
  const quedaraAdmin = (d.rol_id ?? cur.rol_id) === adminId && (d.activo ?? cur.activo);
  if (cur.rol_id === adminId && cur.activo && !quedaraAdmin && adminsActivos === 0) throw business('Debe existir al menos un administrador activo.');
  const row = await store.update('Usuario', id, d);
  await audit(user.usuario_id, 'USUARIO_MODIFICADO', 'Usuario', id, Object.keys(d).filter((k) => k !== 'hash_contrasena').join(','));
  return pub(row, roles);
};

module.exports = { listarRoles, listarUsuarios, crearUsuarios, actualizarUsuarios };

};
__defs['controllers/ventasController.js'] = function (module, exports) {
'use strict';
const { validation, notFound } = __req('models/errors.js');
const V = __req('models/validate.js');
const inv = __req('models/inventario.js');
const { byId, inRange, checkPeriodo } = __req('models/util.js');

/** Controlador ventas: recibe la petición ya autenticada, usa los modelos y devuelve la respuesta. */
const listarVentas = async ({ store, query }) => {
  const { desde, hasta } = checkPeriodo(query);
  const [ventas, clientes, users] = await Promise.all([store.list('Venta'), store.list('Cliente'), store.list('Usuario')]);
  const C = byId(clientes, 'cliente_id'), U = byId(users, 'usuario_id');
  return ventas.filter((v) => inRange(v.fecha, desde, hasta) && (!query.estado || v.estado === query.estado)).reverse()
    .map((v) => ({ ...v, cliente: C.get(v.cliente_id)?.nombre_razon_social, usuario: U.get(v.usuario_id)?.nombres }));
};

const obtenerVentas = async ({ store, params }) => {
  const id = V.positiveInt(params.id, 'id'); const v = await store.get('Venta', id); if (!v) throw notFound();
  const [det, lotes, meds, cli, usr, rec, anula] = await Promise.all([
    store.list('DetalleVenta', { venta_id: id }), store.list('Lote'), store.list('Medicamento'),
    store.get('Cliente', v.cliente_id), store.get('Usuario', v.usuario_id),
    v.receta_id ? store.get('Receta', v.receta_id) : null, v.usuario_anulacion_id ? store.get('Usuario', v.usuario_anulacion_id) : null]);
  const L = byId(inv.enriquecerLotes(lotes, meds), 'lote_id');
  return {
    ...v, establecimiento: 'Farmacia Vida Sana (ficticia)', aviso: 'Constancia interna de demostración. No es un comprobante tributario válido ante SUNAT.',
    cliente: cli, usuario: usr?.nombres, receta: rec ? { numero_receta: rec.numero_receta, nombre_prescriptor: rec.nombre_prescriptor } : null,
    usuario_anulacion: anula?.nombres || null,
    detalle: det.map((d) => ({ ...d, codigo_lote: L.get(d.lote_id)?.codigo_lote, medicamento: L.get(d.lote_id)?.medicamento, sku: L.get(d.lote_id)?.sku, vencimiento: L.get(d.lote_id)?.fecha_vencimiento })),
  };
};

const crearVentas = async ({ store, body, user, ip }) => {
  const errs = [];
  const clienteId = Number(body.cliente_id);
  if (!Number.isInteger(clienteId) || clienteId <= 0) errs.push('cliente_id: es obligatorio.');
  const tipo = String(body.tipo_comprobante || 'BOLETA');
  if (!['BOLETA', 'FACTURA'].includes(tipo)) errs.push('tipo_comprobante: BOLETA o FACTURA.');
  const recetaId = body.receta_id === undefined || body.receta_id === null || body.receta_id === '' ? null : Number(body.receta_id);
  if (recetaId !== null && (!Number.isInteger(recetaId) || recetaId <= 0)) errs.push('receta_id: no válido.');
  if (!Array.isArray(body.items) || !body.items.length) errs.push('items: agregue al menos un producto.');
  const items = [];
  for (const [k, it] of (Array.isArray(body.items) ? body.items : []).entries()) {
    const lote_id = Number(it?.lote_id), cantidad = Number(it?.cantidad);
    if (!Number.isInteger(lote_id) || lote_id <= 0) errs.push(`items[${k}].lote_id: no válido.`);
    if (!Number.isInteger(cantidad) || cantidad <= 0) errs.push(`items[${k}].cantidad: entero positivo.`);
    items.push({ lote_id, cantidad });
  }
  if (new Set(items.map((i) => i.lote_id)).size !== items.length) errs.push('items: un lote solo puede aparecer una vez por venta.');
  if (errs.length) throw validation('Datos no válidos.', errs);
  const res = await store.registrarVenta({ clienteId, usuarioId: user.usuario_id, recetaId, tipoComprobante: tipo, items, ip });
  return { status: 201, data: res };
};

const anularVentas = async ({ store, params, body, user, ip }) => {
  const id = V.positiveInt(params.id, 'id');
  const motivo = String(body.motivo || '').trim();
  if (!motivo) throw validation('Datos no válidos.', ['motivo: es obligatorio.']);
  if (motivo.length > 250) throw validation('Datos no válidos.', ['motivo: máximo 250 caracteres.']);
  return store.anularVenta({ ventaId: id, usuarioId: user.usuario_id, motivo, ip });
};

module.exports = { listarVentas, obtenerVentas, crearVentas, anularVentas };

};
__defs['lib/auth/token.js'] = function (module, exports) {
'use strict';
// Tokens firmados HS256 (JWT) con el módulo crypto de Node.
const crypto = __req('node:crypto');
const b64u = (b) => Buffer.from(b).toString('base64url');

function sign(payload, secret, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSeconds };
  const data = `${b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64u(JSON.stringify(body))}`;
  return `${data}.${crypto.createHmac('sha256', secret).update(data).digest('base64url')}`;
}

function verify(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const expected = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  let given; try { given = Buffer.from(parts[2], 'base64url'); } catch { return null; }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return p.exp > Math.floor(Date.now() / 1000) ? p : null;
  } catch { return null; }
}
module.exports = { sign, verify };

};
__defs['lib/auth/permissions.js'] = function (module, exports) {
'use strict';
// Matriz de permisos por perfil (RF-01). Se aplica en el servidor en cada petición.
const A = 'Administrador', C = 'Cajero', W = 'Almacenero', Q = 'Quimico farmaceutico';
const PERMISSIONS = {
  'clientes:read': [A, C, W, Q], 'clientes:write': [A, C],
  'proveedores:read': [A, W], 'proveedores:write': [A, W],
  'catalogo:read': [A, C, W, Q], 'catalogo:write': [A, W],
  'recetas:read': [A, C, Q], 'recetas:write': [A, Q],
  'ventas:read': [A, C, Q], 'ventas:create': [A, C], 'ventas:anular': [A],
  'compras:read': [A, W], 'compras:create': [A, W],
  'movimientos:read': [A, W, Q],
  'alertas:read': [A, C, W, Q],
  'reportes:read': [A],
  'usuarios:read': [A], 'usuarios:write': [A],
  'auditoria:read': [A],
};
const can = (rol, perm) => (PERMISSIONS[perm] || []).includes(rol);
module.exports = { PERMISSIONS, can };

};
__defs['models/memory.js'] = function (module, exports) {
'use strict';
// Controlador en memoria: implementa el MISMO contrato que el controlador de SQL Server
// (CRUD genérico + sp_RegistrarCompra / sp_RegistrarVenta / sp_AnularVenta) para ejecutar las
// pruebas automatizadas sin una instancia de SQL Server. Los datos se pierden al detener el proceso.
// NO es un sustituto de la base de datos: el despliegue real usa mssql.js.
const { TABLES } = __req('models/schema.js');
const { business, notFound, unique, fk } = __req('models/errors.js');

const pad = (n) => String(n).padStart(2, '0');
const today = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const nowStr = (d = new Date()) => `${today(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const digits = (s, n) => /^[0-9]+$/.test(s) && (n == null || s.length === n);

// Réplica de las restricciones CHECK del script SQL.
const CHECKS = {
  Cliente: (r) => {
    const ok = r.tipo_documento === 'DNI' ? digits(r.numero_documento, 8)
      : r.tipo_documento === 'RUC' ? digits(r.numero_documento, 11)
      : r.numero_documento.length >= 4 && r.numero_documento.length <= 15;
    return ok ? null : 'El número de documento no cumple el formato del tipo indicado.';
  },
  Proveedor: (r) => (digits(r.ruc) ? null : 'El RUC solo admite dígitos.'),
  Medicamento: (r) => (r.precio_venta >= 0 ? null : 'El precio no puede ser negativo.'),
  Receta: (r) => (r.fecha_vencimiento >= r.fecha_emision ? null : 'La fecha de vencimiento no puede ser anterior a la emisión.'),
  Lote: (r) => (r.stock_actual >= 0 && r.stock_minimo >= 0 ? null : 'Las existencias no pueden ser negativas.'),
};

class MemoryStore {
  constructor() {
    this.kind = 'memory';
    this.data = {}; this.ids = {};
    for (const t of Object.keys(TABLES)) { this.data[t] = []; this.ids[t] = 0; }
    this.seqBoleta = 0; this.seqFactura = 0;
  }
  async ping() { return true; }
  async close() {}

  _clone(r) { return r ? { ...r } : r; }

  async list(table, filter = {}) {
    const keys = Object.keys(filter);
    return this.data[table].filter((r) => keys.every((k) => r[k] === filter[k])).map((r) => this._clone(r));
  }
  async get(table, id) {
    return this._clone(this.data[table].find((r) => r[TABLES[table].pk] === Number(id))) || null;
  }
  _checkFk(table, row) {
    for (const [c, d] of Object.entries(TABLES[table].cols)) {
      if (d.fk && row[c] != null && !this.data[d.fk].some((x) => x[TABLES[d.fk].pk] === row[c]))
        throw fk(`Referencia inexistente en ${d.fk} (${c}).`);
    }
  }
  _checkUnique(table, row, selfId) {
    const pk = TABLES[table].pk;
    for (const u of TABLES[table].unique) {
      if (u.cols.some((c) => row[c] == null)) continue;
      const dup = this.data[table].some((x) => x[pk] !== selfId && u.cols.every((c) => String(x[c]).toLowerCase() === String(row[c]).toLowerCase()));
      if (dup) throw unique(`Ya existe un registro con ${u.label}.`);
    }
  }
  _checkRow(table, row) {
    if (CHECKS[table]) { const m = CHECKS[table](row); if (m) throw business(m); }
  }
  _insert(table, input) {
    const def = TABLES[table]; const row = {};
    for (const [c, d] of Object.entries(def.cols)) {
      if (d.auto && d.t !== 'dt') continue;
      if (d.computed) continue;
      row[c] = input[c] !== undefined ? input[c] : (d.def !== undefined ? d.def : null);
    }
    if (def.cols.fecha && def.cols.fecha.auto && row.fecha == null) row.fecha = nowStr();
    this._checkFk(table, row); this._checkUnique(table, row); this._checkRow(table, row);
    row[def.pk] = ++this.ids[table];
    if (def.cols.subtotal) row.subtotal = Math.round(row.cantidad * (row.costo_unitario ?? row.precio_unitario) * 100) / 100;
    this.data[table].push(row);
    return this._clone(row);
  }
  async insert(table, input) { return this._insert(table, input); }
  async update(table, id, patch) {
    const pk = TABLES[table].pk;
    const row = this.data[table].find((r) => r[pk] === Number(id));
    if (!row) throw notFound();
    const next = { ...row, ...patch };
    this._checkFk(table, next); this._checkUnique(table, next, row[pk]); this._checkRow(table, next);
    Object.assign(row, next);
    return this._clone(row);
  }
  async remove(table, id) {
    const pk = TABLES[table].pk;
    const idx = this.data[table].findIndex((r) => r[pk] === Number(id));
    if (idx < 0) throw notFound();
    for (const [t, d] of Object.entries(TABLES))
      for (const [c, cd] of Object.entries(d.cols))
        if (cd.fk === table && this.data[t].some((r) => r[c] === Number(id)))
          throw fk('No se puede eliminar: existen registros relacionados.');
    this.data[table].splice(idx, 1);
  }

  _audit(usuario_id, accion, entidad, entidad_id, detalle, ip) {
    this._insert('AuditoriaOperacion', { usuario_id, accion, entidad, entidad_id, detalle: detalle && detalle.slice(0, 500), ip: ip || null });
  }
  _mov(lote_id, usuario_id, tipo, cantidad, compra_id, venta_id) {
    // Réplica de los índices únicos filtrados UX_Mov_*: un movimiento por operación y lote.
    const dup = this.data.MovimientoStock.some((m) => m.tipo === tipo && m.lote_id === lote_id &&
      (tipo === 'ENTRADA_COMPRA' ? m.compra_id === compra_id : m.venta_id === venta_id));
    if (dup) throw unique('Movimiento duplicado para la operación y el lote.');
    this._insert('MovimientoStock', { lote_id, usuario_id, tipo, cantidad, compra_id: compra_id ?? null, venta_id: venta_id ?? null });
  }
  _activeUser(id) { const u = this.data.Usuario.find((x) => x.usuario_id === id); return u && u.activo ? u : null; }

  // === sp_RegistrarCompra ===
  async registrarCompra({ proveedorId, usuarioId, numeroDocumento, items, ip }) {
    const prov = this.data.Proveedor.find((p) => p.proveedor_id === proveedorId && p.activo);
    if (!prov) throw business('Proveedor inexistente o inactivo.', 50004);
    if (!this._activeUser(usuarioId)) throw business('Usuario inexistente o inactivo.', 50005);
    if (!String(numeroDocumento || '').trim()) throw business('Se requiere numero de documento.', 50006);
    if (!items.length) throw business('La compra debe incluir al menos un lote.', 50001);
    if (items.some((i) => !(i.cantidad > 0) || i.costo_unitario < 0)) throw business('Cantidad o costo no valido.', 50002);
    if (this.data.Compra.some((c) => c.proveedor_id === proveedorId && c.numero_documento === numeroDocumento))
      throw business('Ya existe una compra con ese documento para el proveedor.', 50008);
    const lotes = items.map((i) => this.data.Lote.find((l) => l.lote_id === i.lote_id));
    if (lotes.some((l) => !l)) throw business('Existen lotes inexistentes.', 50003);
    if (lotes.some((l) => l.fecha_vencimiento < today())) throw business('No se puede ingresar stock a un lote vencido.', 50007);
    const total = Math.round(items.reduce((a, i) => a + Math.round(i.cantidad * i.costo_unitario * 100), 0)) / 100;
    const compra = this._insert('Compra', { proveedor_id: proveedorId, usuario_id: usuarioId, numero_documento: numeroDocumento, total });
    for (const i of items) {
      this._insert('DetalleCompra', { compra_id: compra.compra_id, lote_id: i.lote_id, cantidad: i.cantidad, costo_unitario: i.costo_unitario });
      this.data.Lote.find((l) => l.lote_id === i.lote_id).stock_actual += i.cantidad;
      this._mov(i.lote_id, usuarioId, 'ENTRADA_COMPRA', i.cantidad, compra.compra_id, null);
    }
    this._audit(usuarioId, 'COMPRA_REGISTRADA', 'Compra', compra.compra_id, `Documento ${numeroDocumento}; total S/ ${total}`, ip);
    return { compra_id: compra.compra_id };
  }

  // === sp_RegistrarVenta ===
  async registrarVenta({ clienteId, usuarioId, recetaId = null, tipoComprobante, items, ip }) {
    if (!items.length) throw business('La venta debe contener al menos un lote.', 50011);
    if (items.some((i) => !(i.cantidad > 0))) throw business('La cantidad debe ser mayor que cero.', 50012);
    if (!['BOLETA', 'FACTURA'].includes(tipoComprobante)) throw business('Tipo de comprobante no valido.', 50013);
    const cliente = this.data.Cliente.find((c) => c.cliente_id === clienteId);
    if (!cliente) throw business('Cliente inexistente.', 50014);
    if (!this._activeUser(usuarioId)) throw business('Usuario inexistente o inactivo.', 50015);
    if (tipoComprobante === 'FACTURA' && cliente.tipo_documento !== 'RUC') throw business('La factura requiere un cliente identificado con RUC.', 50023);
    const hoy = today();
    const lotes = items.map((i) => this.data.Lote.find((l) => l.lote_id === i.lote_id));
    if (lotes.some((l) => !l)) throw business('Existen lotes inexistentes.', 50016);
    const meds = lotes.map((l) => this.data.Medicamento.find((m) => m.medicamento_id === l.medicamento_id));
    if (meds.some((m) => !m.activo)) throw business('La venta incluye un medicamento inactivo.', 50019);
    if (lotes.some((l) => l.fecha_vencimiento < hoy)) throw business('No se pueden vender lotes vencidos.', 50020);
    if (lotes.some((l, k) => l.stock_actual < items[k].cantidad)) throw business('La cantidad supera las existencias disponibles del lote.', 50021);
    if (recetaId != null) {
      const r = this.data.Receta.find((x) => x.receta_id === recetaId);
      if (!r || r.cliente_id !== clienteId || r.estado !== 'VALIDA' || r.fecha_emision > hoy || r.fecha_vencimiento < hoy)
        throw business('Receta no valida, no vigente o de otro cliente.', 50017);
    } else if (meds.some((m) => m.requiere_receta)) throw business('Se requiere registrar receta para alguno de los productos.', 50018);
    const total = Math.round(items.reduce((a, i, k) => a + Math.round(i.cantidad * meds[k].precio_venta * 100), 0)) / 100;
    const nro = tipoComprobante === 'BOLETA' ? ++this.seqBoleta : ++this.seqFactura;
    const numero = (tipoComprobante === 'BOLETA' ? 'B001-' : 'F001-') + String(nro).padStart(6, '0');
    const venta = this._insert('Venta', { cliente_id: clienteId, usuario_id: usuarioId, receta_id: recetaId, tipo_comprobante: tipoComprobante, numero_comprobante: numero, estado: 'CONFIRMADA', total });
    items.forEach((i, k) => {
      this._insert('DetalleVenta', { venta_id: venta.venta_id, lote_id: i.lote_id, cantidad: i.cantidad, precio_unitario: meds[k].precio_venta });
      lotes[k].stock_actual -= i.cantidad;
      this._mov(i.lote_id, usuarioId, 'SALIDA_VENTA', i.cantidad, null, venta.venta_id);
    });
    this._audit(usuarioId, 'VENTA_REGISTRADA', 'Venta', venta.venta_id, `Comprobante ${numero}; total S/ ${total}`, ip);
    return { venta_id: venta.venta_id, numero_comprobante: numero };
  }

  // === sp_AnularVenta ===
  async anularVenta({ ventaId, usuarioId, motivo, ip }) {
    if (!String(motivo || '').trim()) throw business('Se requiere el motivo de la anulacion.', 50034);
    const u = this._activeUser(usuarioId);
    const rol = u && this.data.Rol.find((r) => r.rol_id === u.rol_id);
    if (!rol || rol.nombre !== 'Administrador') throw business('Solo un administrador activo puede anular ventas.', 50033);
    const v = this.data.Venta.find((x) => x.venta_id === ventaId);
    if (!v) throw business('La venta no existe.', 50031);
    if (v.estado !== 'CONFIRMADA') throw business('La venta ya esta anulada.', 50032);
    for (const d of this.data.DetalleVenta.filter((x) => x.venta_id === ventaId)) {
      this.data.Lote.find((l) => l.lote_id === d.lote_id).stock_actual += d.cantidad;
      this._mov(d.lote_id, usuarioId, 'REVERSO_VENTA', d.cantidad, null, ventaId);
    }
    Object.assign(v, { estado: 'ANULADA', fecha_anulacion: nowStr(), usuario_anulacion_id: usuarioId, motivo_anulacion: motivo });
    this._audit(usuarioId, 'VENTA_ANULADA', 'Venta', ventaId, String(motivo).slice(0, 500), ip);
    return { venta_id: ventaId };
  }
}

module.exports = { MemoryStore };

};
__defs['models/seed.js'] = function (module, exports) {
'use strict';
// Datos de demostración del controlador en memoria: equivalentes a la sección 08 del script SQL
// (mismas credenciales de PRUEBA, medicamentos, lotes, recetas y operaciones de ejemplo).
const { hashPassword } = __req('lib/auth/password.js');
const { todayStr, addDays } = __req('models/inventario.js');

const DEMO_USERS = [
  ['Ana Administradora', 'admin@farmacontrol.local', 'Admin#2026Fc', 1],
  ['Carlos Cajero', 'cajero@farmacontrol.local', 'Cajero#2026Fc', 2],
  ['Alicia Almacenera', 'almacen@farmacontrol.local', 'Almacen#2026Fc', 3],
  ['Quimica Quispe', 'quimico@farmacontrol.local', 'Quimico#2026Fc', 4],
];

async function seedMemory(store) {
  const hoy = todayStr();
  for (const [nombre, descripcion] of [
    ['Administrador', 'Gestiona usuarios, reportes, anulaciones y configuracion'], ['Cajero', 'Registra ventas y clientes'],
    ['Almacenero', 'Recepciona compras, lotes y proveedores'], ['Quimico farmaceutico', 'Verifica recetas y supervisa medicamentos']])
    await store.insert('Rol', { nombre, descripcion });
  for (const [nombres, correo, clave, rol_id] of DEMO_USERS)
    await store.insert('Usuario', { rol_id, nombres, correo, hash_contrasena: hashPassword(clave), activo: true });
  for (const nombre of ['Analgesicos', 'Antialergicos', 'Antibioticos', 'Cuidado personal']) await store.insert('Categoria', { nombre });
  const meds = [
    [1, 'MED-001', 'Paracetamol 500 mg', 'Paracetamol', 'Caja x 20 tabletas', 8.5, false], [2, 'MED-002', 'Cetirizina 10 mg', 'Cetirizina', 'Caja x 10 tabletas', 12.9, false],
    [4, 'MED-003', 'Alcohol en gel 250 ml', null, 'Frasco 250 ml', 9.9, false], [3, 'MED-004', 'Amoxicilina 500 mg', 'Amoxicilina', 'Caja x 21 capsulas', 21.5, true],
    [4, 'MED-005', 'Suero fisiologico 500 ml', 'Cloruro de sodio', 'Bolsa 500 ml', 7.2, false], [1, 'MED-006', 'Ibuprofeno 400 mg', 'Ibuprofeno', 'Caja x 10 tabletas', 11, false],
    [2, 'MED-007', 'Loratadina 10 mg', 'Loratadina', 'Caja x 10 tabletas', 6.8, false], [3, 'MED-008', 'Azitromicina 500 mg', 'Azitromicina', 'Caja x 3 tabletas', 24.9, true]];
  for (const [categoria_id, sku, nombre, principio_activo, presentacion, precio_venta, requiere_receta] of meds)
    await store.insert('Medicamento', { categoria_id, sku, nombre, principio_activo, presentacion, precio_venta, requiere_receta, activo: true });
  const lotes = [[1, 'P-2401', 600, 15], [1, 'P-2402', 20, 15], [2, 'C-1822', 500, 20], [3, 'AG-830', 300, 12], [4, 'AM-705', 240, 10],
    [5, 'SF-401', 400, 12], [6, 'IB-310', 365, 10], [7, 'LO-114', 700, 10], [8, 'AZ-220', 180, 5]];
  for (const [medicamento_id, codigo_lote, dias, stock_minimo] of lotes)
    await store.insert('Lote', { medicamento_id, codigo_lote, fecha_vencimiento: addDays(hoy, dias), stock_actual: 0, stock_minimo });
  const L = Object.fromEntries((await store.list('Lote')).map((l) => [l.codigo_lote, l.lote_id]));
  await store.insert('Cliente', { tipo_documento: 'DNI', numero_documento: '12345678', nombre_razon_social: 'Maria Torres', telefono: '999 111 222' });
  await store.insert('Cliente', { tipo_documento: 'DNI', numero_documento: '45678912', nombre_razon_social: 'Luis Paredes', telefono: '988 333 444' });
  await store.insert('Cliente', { tipo_documento: 'RUC', numero_documento: '20600000003', nombre_razon_social: 'Clinica Los Andes SAC (ficticia)', telefono: '014 555 000' });
  await store.insert('Proveedor', { ruc: '20600000001', razon_social: 'Distribuidora Salud Peru SAC (ficticio)', contacto: 'Area comercial', telefono: '014 100 100', activo: true });
  await store.insert('Proveedor', { ruc: '20600000002', razon_social: 'Logistica Medica Andina SAC (ficticio)', contacto: 'Area comercial', telefono: '014 200 200', activo: true });
  await store.insert('Receta', { cliente_id: 1, numero_receta: 'REC-00041', nombre_prescriptor: 'Dr. Carlos Rios (ficticio)', fecha_emision: addDays(hoy, -3), fecha_vencimiento: addDays(hoy, 27), estado: 'VALIDA', observacion: 'Receta vigente de demostracion' });
  await store.insert('Receta', { cliente_id: 2, numero_receta: 'REC-00012', nombre_prescriptor: 'Dra. Rosa Medina (ficticia)', fecha_emision: addDays(hoy, -60), fecha_vencimiento: addDays(hoy, -30), estado: 'VALIDA', observacion: 'Receta vencida de demostracion' });

  await store.registrarCompra({ proveedorId: 1, usuarioId: 3, numeroDocumento: 'FAC-2026-0001', items: [
    ['P-2401', 120, 4.2], ['P-2402', 30, 4.2], ['C-1822', 24, 7], ['AG-830', 60, 4.8], ['AM-705', 40, 12], ['SF-401', 8, 3.5], ['IB-310', 50, 6], ['AZ-220', 8, 14]]
    .map(([c, cantidad, costo_unitario]) => ({ lote_id: L[c], cantidad, costo_unitario })) });
  await store.registrarVenta({ clienteId: 1, usuarioId: 2, tipoComprobante: 'BOLETA', items: [{ lote_id: L['P-2401'], cantidad: 2 }, { lote_id: L['C-1822'], cantidad: 4 }] });
  await store.registrarVenta({ clienteId: 1, usuarioId: 2, recetaId: 1, tipoComprobante: 'BOLETA', items: [{ lote_id: L['AM-705'], cantidad: 2 }] });
  const v = await store.registrarVenta({ clienteId: 2, usuarioId: 2, tipoComprobante: 'BOLETA', items: [{ lote_id: L['IB-310'], cantidad: 3 }] });
  await store.anularVenta({ ventaId: v.venta_id, usuarioId: 1, motivo: 'Anulacion de demostracion' });
  await store.update('Lote', L['SF-401'], { fecha_vencimiento: addDays(hoy, -5) }); // lote vencido tras recibirse
}

module.exports = { seedMemory, DEMO_USERS };

};
})();
