'use strict';
const { validation, notFound } = require('../models/errors');
const V = require('../models/validate');
const inv = require('../models/inventario');
const { byId } = require('../models/util');
const { detalleConSaldo } = require('../models/recetas');

/** Controlador recetas: recibe la petición ya autenticada, usa los modelos y devuelve la respuesta. */
const recetaView = (r, clientes, hoy) => ({ ...r, cliente: clientes.get(r.cliente_id)?.nombre_razon_social, vigente: r.estado === 'VALIDA' && r.fecha_emision <= hoy && r.fecha_vencimiento >= hoy });

const listarRecetas = async ({ store, query }) => {
  const hoy = inv.todayStr(); const clientes = byId(await store.list('Cliente'), 'cliente_id');
  let rows = (await store.list('Receta')).map((x) => recetaView(x, clientes, hoy));
  if (query.cliente_id) rows = rows.filter((x) => x.cliente_id === Number(query.cliente_id));
  if (query.vigentes === 'true') rows = rows.filter((x) => x.vigente);
  return rows;
};

const obtenerRecetas = async ({ store, params }) => {
  const id = V.positiveInt(params.id, 'id'); const r = await store.get('Receta', id); if (!r) throw notFound();
  const clientes = byId(await store.list('Cliente'), 'cliente_id');
  return { ...recetaView(r, clientes, inv.todayStr()), detalle: await detalleConSaldo(store, id) };
};

/** Valida el detalle opcional de la receta: [{ medicamento_id, cantidad, indicaciones }]. */
async function validarDetalle(store, raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw validation('Datos no válidos.', ['items: debe ser una lista de medicamentos.']);
  const errs = []; const out = [];
  for (const [k, it] of raw.entries()) {
    const medicamento_id = Number(it?.medicamento_id), cantidad = Number(it?.cantidad);
    const indicaciones = it?.indicaciones == null ? null : String(it.indicaciones).trim() || null;
    if (!Number.isInteger(medicamento_id) || medicamento_id <= 0) errs.push(`items[${k}].medicamento_id: no válido.`);
    else if (!(await store.get('Medicamento', medicamento_id))) errs.push(`items[${k}].medicamento_id: el medicamento no existe.`);
    if (!Number.isInteger(cantidad) || cantidad <= 0 || cantidad > 1000) errs.push(`items[${k}].cantidad: entero entre 1 y 1000.`);
    if (indicaciones && indicaciones.length > 250) errs.push(`items[${k}].indicaciones: máximo 250 caracteres.`);
    out.push({ medicamento_id, cantidad, indicaciones });
  }
  if (new Set(out.map((i) => i.medicamento_id)).size !== out.length) errs.push('items: un medicamento solo puede aparecer una vez en la receta.');
  if (errs.length) throw validation('Datos no válidos.', errs);
  return out;
}

const crearRecetas = async ({ store, body, user, audit }) => {
  const d = V.clean('Receta', body, { allow: ['cliente_id', 'numero_receta', 'nombre_prescriptor', 'fecha_emision', 'fecha_vencimiento', 'observacion'] });
  V.checkReceta(d);
  if (!(await store.get('Cliente', d.cliente_id))) throw validation('Datos no válidos.', ['cliente_id: el cliente no existe.']);
  const items = await validarDetalle(store, body.items);
  const row = await store.insert('Receta', { ...d, estado: 'VALIDA' });
  try { for (const it of items) await store.insert('DetalleReceta', { receta_id: row.receta_id, ...it }); }
  catch (e) { // compensación: no deja una receta a medias
    for (const x of await store.list('DetalleReceta', { receta_id: row.receta_id })) await store.remove('DetalleReceta', x.detalle_receta_id).catch(() => {});
    await store.remove('Receta', row.receta_id).catch(() => {});
    throw e;
  }
  await audit(user.usuario_id, 'RECETA_REGISTRADA', 'Receta', row.receta_id, `${d.numero_receta}; ${items.length} medicamento(s)`);
  return { status: 201, data: { ...row, detalle: await detalleConSaldo(store, row.receta_id) } };
};

const actualizarRecetas = async ({ store, params, body, user, audit }) => {
  const id = V.positiveInt(params.id, 'id'); if (!(await store.get('Receta', id))) throw notFound();
  const row = await store.update('Receta', id, V.clean('Receta', body, { partial: true, allow: ['estado', 'observacion'] }));
  await audit(user.usuario_id, 'RECETA_MODIFICADA', 'Receta', id, row.estado);
  return row;
};

module.exports = { listarRecetas, obtenerRecetas, crearRecetas, actualizarRecetas };
