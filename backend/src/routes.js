'use strict';
const { Router } = require('./http/router');
const { toCsv } = require('./http/helpers');
const { AppError, validation, business, notFound } = require('./db/errors');
const { TABLES } = require('./db/schema');
const { hashPassword, verifyPassword, passwordPolicyError } = require('./auth/password');
const V = require('./services/validate');
const inv = require('./services/inventario');

const DUMMY_HASH = hashPassword('contraseña-ficticia-para-igualar-tiempos');
const attempts = new Map(); // limitador de intentos de acceso: clave ip|correo
const MAX_ATTEMPTS = 5, WINDOW_MS = 15 * 60 * 1000;

const pub = (u, roles) => ({ usuario_id: u.usuario_id, nombres: u.nombres, correo: u.correo, activo: u.activo, rol_id: u.rol_id, rol: roles.find((r) => r.rol_id === u.rol_id)?.nombre });
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

function buildRouter() {
  const r = new Router();
  const get = (p, perm, h) => r.add('GET', p, { perm }, h);
  const post = (p, perm, h) => r.add('POST', p, { perm }, h);
  const patch = (p, perm, h) => r.add('PATCH', p, { perm }, h);
  const del = (p, perm, h) => r.add('DELETE', p, { perm }, h);

  // ---------------- Público ----------------
  r.add('GET', '/api/health', { public: true }, async ({ store, config }) => {
    await store.ping();
    return { status: 'ok', driver: store.kind, hora_servidor: new Date().toISOString() };
  });

  r.add('POST', '/api/auth/login', { public: true }, async (ctx) => {
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
  });

  // ---------------- Sesión ----------------
  r.add('GET', '/api/auth/me', { auth: true }, async ({ user, store }) => pub(user, await store.list('Rol')));
  r.add('POST', '/api/auth/password', { auth: true }, async ({ user, store, body, audit }) => {
    if (!verifyPassword(String(body.actual || ''), user.hash_contrasena)) throw new AppError(401, 'AUTH', 'La contraseña actual no es correcta.');
    const err = passwordPolicyError(body.nueva); if (err) throw validation(err);
    await store.update('Usuario', user.usuario_id, { hash_contrasena: hashPassword(body.nueva) });
    await audit(user.usuario_id, 'CLAVE_CAMBIADA', 'Usuario', user.usuario_id, null);
    return { ok: true };
  });
  r.add('POST', '/api/auth/logout', { auth: true }, async ({ user, audit }) => { await audit(user.usuario_id, 'LOGOUT', 'Usuario', user.usuario_id, null); return { ok: true }; });

  // ---------------- Usuarios y roles ----------------
  get('/api/roles', 'usuarios:read', ({ store }) => store.list('Rol'));
  get('/api/usuarios', 'usuarios:read', async ({ store }) => {
    const roles = await store.list('Rol');
    return (await store.list('Usuario')).map((u) => pub(u, roles));
  });
  post('/api/usuarios', 'usuarios:write', async ({ store, body, user, audit }) => {
    const d = V.clean('Usuario', body, { allow: ['rol_id', 'nombres', 'correo'] });
    d.correo = d.correo.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.correo)) throw validation('Datos no válidos.', ['correo: formato no válido.']);
    const err = passwordPolicyError(body.contrasena); if (err) throw validation(err);
    const row = await store.insert('Usuario', { ...d, hash_contrasena: hashPassword(body.contrasena), activo: true });
    await audit(user.usuario_id, 'USUARIO_CREADO', 'Usuario', row.usuario_id, d.correo);
    return { status: 201, data: pub(row, await store.list('Rol')) };
  });
  patch('/api/usuarios/:id', 'usuarios:write', async ({ store, params, body, user, audit }) => {
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
  });

  // ---------------- Clientes ----------------
  get('/api/clientes', 'clientes:read', async ({ store, query }) => {
    let rows = await store.list('Cliente');
    if (query.q) rows = rows.filter((c) => includesCI(c.nombre_razon_social, query.q) || includesCI(c.numero_documento, query.q));
    return rows;
  });
  post('/api/clientes', 'clientes:write', async ({ store, body, user, audit }) => {
    const d = V.clean('Cliente', body); V.checkCliente(d);
    const row = await store.insert('Cliente', d);
    await audit(user.usuario_id, 'CLIENTE_CREADO', 'Cliente', row.cliente_id, `${d.tipo_documento} ${d.numero_documento}`);
    return { status: 201, data: row };
  });
  patch('/api/clientes/:id', 'clientes:write', async ({ store, params, body, user, audit }) => {
    const id = V.positiveInt(params.id, 'id'); const cur = await store.get('Cliente', id); if (!cur) throw notFound();
    const d = V.clean('Cliente', body, { partial: true }); V.checkCliente({ ...cur, ...d });
    const row = await store.update('Cliente', id, d);
    await audit(user.usuario_id, 'CLIENTE_MODIFICADO', 'Cliente', id, null);
    return row;
  });

  // ---------------- Proveedores ----------------
  get('/api/proveedores', 'proveedores:read', ({ store }) => store.list('Proveedor'));
  post('/api/proveedores', 'proveedores:write', async ({ store, body, user, audit }) => {
    const d = V.clean('Proveedor', body); V.checkProveedor(d);
    const row = await store.insert('Proveedor', { ...d, activo: d.activo ?? true });
    await audit(user.usuario_id, 'PROVEEDOR_CREADO', 'Proveedor', row.proveedor_id, d.ruc);
    return { status: 201, data: row };
  });
  patch('/api/proveedores/:id', 'proveedores:write', async ({ store, params, body, user, audit }) => {
    const id = V.positiveInt(params.id, 'id'); if (!(await store.get('Proveedor', id))) throw notFound();
    const d = V.clean('Proveedor', body, { partial: true }); V.checkProveedor(d);
    const row = await store.update('Proveedor', id, d);
    await audit(user.usuario_id, 'PROVEEDOR_MODIFICADO', 'Proveedor', id, null);
    return row;
  });

  // ---------------- Categorías ----------------
  get('/api/categorias', 'catalogo:read', ({ store }) => store.list('Categoria'));
  post('/api/categorias', 'catalogo:write', async ({ store, body, user, audit }) => {
    const d = V.clean('Categoria', body);
    const row = await store.insert('Categoria', d);
    await audit(user.usuario_id, 'CATEGORIA_CREADA', 'Categoria', row.categoria_id, d.nombre);
    return { status: 201, data: row };
  });
  patch('/api/categorias/:id', 'catalogo:write', async ({ store, params, body, user, audit }) => {
    const id = V.positiveInt(params.id, 'id');
    const row = await store.update('Categoria', id, V.clean('Categoria', body, { partial: true }));
    await audit(user.usuario_id, 'CATEGORIA_MODIFICADA', 'Categoria', id, null);
    return row;
  });
  del('/api/categorias/:id', 'catalogo:write', async ({ store, params, user, audit }) => {
    const id = V.positiveInt(params.id, 'id'); await store.remove('Categoria', id);
    await audit(user.usuario_id, 'CATEGORIA_ELIMINADA', 'Categoria', id, null);
    return { ok: true };
  });

  // ---------------- Medicamentos y lotes ----------------
  get('/api/medicamentos', 'catalogo:read', async ({ store, query }) => {
    const [meds, cats, lotes] = await Promise.all([store.list('Medicamento'), store.list('Categoria'), store.list('Lote')]);
    let rows = inv.resumenMedicamentos(meds, cats, lotes);
    if (query.q) rows = rows.filter((m) => includesCI(m.nombre, query.q) || includesCI(m.sku, query.q) || includesCI(m.principio_activo, query.q));
    if (query.categoria_id) rows = rows.filter((m) => m.categoria_id === Number(query.categoria_id));
    if (query.activo !== undefined) rows = rows.filter((m) => String(m.activo) === query.activo);
    return rows;
  });
  get('/api/medicamentos/:id', 'catalogo:read', async ({ store, params }) => {
    const id = V.positiveInt(params.id, 'id'); const m = await store.get('Medicamento', id); if (!m) throw notFound();
    const lotes = inv.enriquecerLotes(await store.list('Lote', { medicamento_id: id }), [m]);
    return { ...m, lotes };
  });
  post('/api/medicamentos', 'catalogo:write', async ({ store, body, user, audit }) => {
    const d = V.clean('Medicamento', body); V.checkMedicamento(d);
    const row = await store.insert('Medicamento', { ...d, requiere_receta: d.requiere_receta ?? false, activo: d.activo ?? true });
    await audit(user.usuario_id, 'MEDICAMENTO_CREADO', 'Medicamento', row.medicamento_id, d.sku);
    return { status: 201, data: row };
  });
  patch('/api/medicamentos/:id', 'catalogo:write', async ({ store, params, body, user, audit }) => {
    const id = V.positiveInt(params.id, 'id'); if (!(await store.get('Medicamento', id))) throw notFound();
    const d = V.clean('Medicamento', body, { partial: true }); V.checkMedicamento(d);
    const row = await store.update('Medicamento', id, d);
    await audit(user.usuario_id, 'MEDICAMENTO_MODIFICADO', 'Medicamento', id, Object.keys(d).join(','));
    return row;
  });

  get('/api/lotes', 'catalogo:read', async ({ store, query }) => {
    const [lotes, meds] = await Promise.all([store.list('Lote'), store.list('Medicamento')]);
    let rows = inv.enriquecerLotes(lotes, meds);
    if (query.medicamento_id) rows = rows.filter((l) => l.medicamento_id === Number(query.medicamento_id));
    if (query.alerta) rows = rows.filter((l) => l.alerta === query.alerta);
    if (query.q) rows = rows.filter((l) => includesCI(l.medicamento, query.q) || includesCI(l.sku, query.q) || includesCI(l.codigo_lote, query.q));
    if (query.disponibles === 'true') rows = rows.filter((l) => l.stock_actual > 0 && !l.vencido && l.medicamento_activo);
    return rows;
  });
  post('/api/lotes', 'catalogo:write', async ({ store, body, user, audit }) => {
    const d = V.clean('Lote', body, { allow: ['medicamento_id', 'codigo_lote', 'fecha_vencimiento', 'stock_minimo'] });
    if (d.fecha_vencimiento < inv.todayStr()) throw validation('Datos no válidos.', ['fecha_vencimiento: un lote nuevo no puede estar vencido.']);
    if (d.stock_minimo != null && d.stock_minimo < 0) throw validation('Datos no válidos.', ['stock_minimo: no puede ser negativo.']);
    const row = await store.insert('Lote', { ...d, stock_actual: 0, stock_minimo: d.stock_minimo ?? 5 }); // el stock solo cambia por compras/ventas
    await audit(user.usuario_id, 'LOTE_CREADO', 'Lote', row.lote_id, d.codigo_lote);
    return { status: 201, data: row };
  });
  patch('/api/lotes/:id', 'catalogo:write', async ({ store, params, body, user, audit }) => {
    const id = V.positiveInt(params.id, 'id'); if (!(await store.get('Lote', id))) throw notFound();
    const d = V.clean('Lote', body, { partial: true, allow: ['stock_minimo', 'fecha_vencimiento'] });
    if (d.stock_minimo != null && d.stock_minimo < 0) throw validation('Datos no válidos.', ['stock_minimo: no puede ser negativo.']);
    const row = await store.update('Lote', id, d);
    await audit(user.usuario_id, 'LOTE_MODIFICADO', 'Lote', id, Object.keys(d).join(','));
    return row;
  });

  // ---------------- Recetas ----------------
  const recetaView = (r, clientes, hoy) => ({ ...r, cliente: clientes.get(r.cliente_id)?.nombre_razon_social, vigente: r.estado === 'VALIDA' && r.fecha_emision <= hoy && r.fecha_vencimiento >= hoy });
  get('/api/recetas', 'recetas:read', async ({ store, query }) => {
    const hoy = inv.todayStr(); const clientes = byId(await store.list('Cliente'), 'cliente_id');
    let rows = (await store.list('Receta')).map((x) => recetaView(x, clientes, hoy));
    if (query.cliente_id) rows = rows.filter((x) => x.cliente_id === Number(query.cliente_id));
    if (query.vigentes === 'true') rows = rows.filter((x) => x.vigente);
    return rows;
  });
  post('/api/recetas', 'recetas:write', async ({ store, body, user, audit }) => {
    const d = V.clean('Receta', body, { allow: ['cliente_id', 'numero_receta', 'nombre_prescriptor', 'fecha_emision', 'fecha_vencimiento', 'observacion'] });
    V.checkReceta(d);
    if (!(await store.get('Cliente', d.cliente_id))) throw validation('Datos no válidos.', ['cliente_id: el cliente no existe.']);
    const row = await store.insert('Receta', { ...d, estado: 'VALIDA' });
    await audit(user.usuario_id, 'RECETA_REGISTRADA', 'Receta', row.receta_id, d.numero_receta);
    return { status: 201, data: row };
  });
  patch('/api/recetas/:id', 'recetas:write', async ({ store, params, body, user, audit }) => {
    const id = V.positiveInt(params.id, 'id'); if (!(await store.get('Receta', id))) throw notFound();
    const row = await store.update('Receta', id, V.clean('Receta', body, { partial: true, allow: ['estado', 'observacion'] }));
    await audit(user.usuario_id, 'RECETA_MODIFICADA', 'Receta', id, row.estado);
    return row;
  });

  // ---------------- Compras ----------------
  get('/api/compras', 'compras:read', async ({ store, query }) => {
    const [compras, provs, users] = await Promise.all([store.list('Compra'), store.list('Proveedor'), store.list('Usuario')]);
    const P = byId(provs, 'proveedor_id'), U = byId(users, 'usuario_id');
    return compras.filter((c) => inRange(c.fecha, query.desde, query.hasta)).reverse()
      .map((c) => ({ ...c, proveedor: P.get(c.proveedor_id)?.razon_social, usuario: U.get(c.usuario_id)?.nombres }));
  });
  get('/api/compras/:id', 'compras:read', async ({ store, params }) => {
    const id = V.positiveInt(params.id, 'id'); const c = await store.get('Compra', id); if (!c) throw notFound();
    const [det, lotes, meds, prov, usr] = await Promise.all([store.list('DetalleCompra', { compra_id: id }), store.list('Lote'), store.list('Medicamento'), store.get('Proveedor', c.proveedor_id), store.get('Usuario', c.usuario_id)]);
    const L = byId(inv.enriquecerLotes(lotes, meds), 'lote_id');
    return { ...c, proveedor: prov?.razon_social, usuario: usr?.nombres, detalle: det.map((d) => ({ ...d, codigo_lote: L.get(d.lote_id)?.codigo_lote, medicamento: L.get(d.lote_id)?.medicamento })) };
  });
  post('/api/compras', 'compras:create', async ({ store, body, user, ip, audit }) => {
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
  });

  // ---------------- Ventas ----------------
  get('/api/ventas', 'ventas:read', async ({ store, query }) => {
    const { desde, hasta } = checkPeriodo(query);
    const [ventas, clientes, users] = await Promise.all([store.list('Venta'), store.list('Cliente'), store.list('Usuario')]);
    const C = byId(clientes, 'cliente_id'), U = byId(users, 'usuario_id');
    return ventas.filter((v) => inRange(v.fecha, desde, hasta) && (!query.estado || v.estado === query.estado)).reverse()
      .map((v) => ({ ...v, cliente: C.get(v.cliente_id)?.nombre_razon_social, usuario: U.get(v.usuario_id)?.nombres }));
  });
  get('/api/ventas/:id', 'ventas:read', async ({ store, params }) => {
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
  });
  post('/api/ventas', 'ventas:create', async ({ store, body, user, ip }) => {
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
  });
  post('/api/ventas/:id/anular', 'ventas:anular', async ({ store, params, body, user, ip }) => {
    const id = V.positiveInt(params.id, 'id');
    const motivo = String(body.motivo || '').trim();
    if (!motivo) throw validation('Datos no válidos.', ['motivo: es obligatorio.']);
    if (motivo.length > 250) throw validation('Datos no válidos.', ['motivo: máximo 250 caracteres.']);
    return store.anularVenta({ ventaId: id, usuarioId: user.usuario_id, motivo, ip });
  });

  // ---------------- Movimientos y alertas ----------------
  async function kardex(store, q) {
    const { desde, hasta } = checkPeriodo(q);
    const [movs, lotes, meds, users] = await Promise.all([store.list('MovimientoStock'), store.list('Lote'), store.list('Medicamento'), store.list('Usuario')]);
    const L = byId(inv.enriquecerLotes(lotes, meds), 'lote_id'), U = byId(users, 'usuario_id');
    const ventas = byId(await store.list('Venta'), 'venta_id'), compras = byId(await store.list('Compra'), 'compra_id');
    return movs.filter((m) => inRange(m.fecha, desde, hasta) && (!q.lote_id || m.lote_id === Number(q.lote_id)) && (!q.tipo || m.tipo === q.tipo)).reverse()
      .map((m) => ({ ...m, codigo_lote: L.get(m.lote_id)?.codigo_lote, medicamento: L.get(m.lote_id)?.medicamento, sku: L.get(m.lote_id)?.sku, usuario: U.get(m.usuario_id)?.nombres,
        documento: m.venta_id ? ventas.get(m.venta_id)?.numero_comprobante : compras.get(m.compra_id)?.numero_documento }));
  }
  get('/api/movimientos', 'movimientos:read', async ({ store, query }) => (await kardex(store, query)).slice(0, Math.min(Number(query.limit) || 300, 1000)));
  get('/api/alertas', 'alertas:read', async ({ store }) => {
    const [lotes, meds] = await Promise.all([store.list('Lote'), store.list('Medicamento')]);
    const rows = inv.alertas(lotes, meds);
    const conteo = { VENCIDO: 0, AGOTADO: 0, POR_VENCER: 0, STOCK_BAJO: 0 };
    rows.forEach((a) => { conteo[a.alerta] += 1; });
    return { conteo, alertas: rows };
  });

  // ---------------- Panel y reportes ----------------
  get('/api/resumen', 'alertas:read', async ({ store, user, can }) => {
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
  });

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
  get('/api/reportes/resumen', 'reportes:read', async ({ store, query }) => {
    const { ok, anul, detOk, C, enr, ...rest } = await reporteVentas(store, query);
    const [lotes, meds] = await Promise.all([store.list('Lote'), store.list('Medicamento')]);
    const e = inv.enriquecerLotes(lotes, meds);
    return { ...rest, inventario: { lotes: e.length, unidades_vendibles: e.filter((l) => !l.vencido).reduce((a, l) => a + l.stock_actual, 0),
      unidades_vencidas: e.filter((l) => l.vencido).reduce((a, l) => a + l.stock_actual, 0),
      valor_venta_vendible: round2(e.filter((l) => !l.vencido).reduce((a, l) => a + l.stock_actual * l.precio_venta, 0)) } };
  });
  get('/api/reportes/ventas.csv', 'reportes:read', async ({ store, query }) => {
    const { ok, anul, C } = await reporteVentas(store, query);
    const rows = [...ok, ...anul].sort((a, b) => a.venta_id - b.venta_id).map((v) => [v.numero_comprobante, v.fecha, C.get(v.cliente_id)?.nombre_razon_social, v.tipo_comprobante, v.estado, v.total.toFixed(2)]);
    return { csv: toCsv(['comprobante', 'fecha', 'cliente', 'tipo', 'estado', 'total'], rows), filename: 'ventas.csv' };
  });
  get('/api/reportes/inventario.csv', 'reportes:read', async ({ store }) => {
    const [lotes, meds] = await Promise.all([store.list('Lote'), store.list('Medicamento')]);
    const rows = inv.enriquecerLotes(lotes, meds).map((l) => [l.sku, l.medicamento, l.codigo_lote, l.fecha_vencimiento, l.stock_actual, l.stock_minimo, l.precio_venta.toFixed(2), l.alerta || 'OK']);
    return { csv: toCsv(['sku', 'medicamento', 'lote', 'vencimiento', 'stock', 'stock_minimo', 'precio_venta', 'estado'], rows), filename: 'inventario.csv' };
  });
  get('/api/reportes/movimientos.csv', 'reportes:read', async ({ store, query }) => {
    const rows = (await kardex(store, query)).map((m) => [m.movimiento_id, m.fecha, m.tipo, m.sku, m.medicamento, m.codigo_lote, m.cantidad, m.documento, m.usuario]);
    return { csv: toCsv(['movimiento', 'fecha', 'tipo', 'sku', 'medicamento', 'lote', 'cantidad', 'documento', 'usuario'], rows), filename: 'movimientos.csv' };
  });

  // ---------------- Auditoría ----------------
  get('/api/auditoria', 'auditoria:read', async ({ store, query }) => {
    const users = byId(await store.list('Usuario'), 'usuario_id');
    let rows = (await store.list('AuditoriaOperacion')).reverse();
    if (query.accion) rows = rows.filter((a) => a.accion === query.accion);
    return rows.slice(0, Math.min(Number(query.limit) || 200, 1000)).map((a) => ({ ...a, usuario: a.usuario_id ? users.get(a.usuario_id)?.nombres : null }));
  });
  return r;
}

module.exports = { buildRouter };
