'use strict';
const { validation, notFound } = require('../models/errors');
const V = require('../models/validate');
const inv = require('../models/inventario');
const { includesCI } = require('../models/util');

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
