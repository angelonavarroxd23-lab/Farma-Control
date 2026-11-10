'use strict';
const { validation, notFound } = require('../models/errors');
const V = require('../models/validate');
const inv = require('../models/inventario');
const { byId } = require('../models/util');

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
