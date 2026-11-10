'use strict';
const { notFound } = require('../models/errors');
const V = require('../models/validate');
const { includesCI } = require('../models/util');

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
