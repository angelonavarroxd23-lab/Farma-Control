'use strict';
const { notFound, fk } = require('../models/errors');
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

// Elimina un cliente solo si no tiene ventas ni recetas: el historial de ventas, recetas y movimientos
// debe conservarse para la trazabilidad, así que en ese caso se rechaza con 409 y un mensaje claro.
const eliminarClientes = async ({ store, params, user, audit }) => {
  const id = V.positiveInt(params.id, 'id'); const cur = await store.get('Cliente', id); if (!cur) throw notFound();
  const ventas = (await store.list('Venta', { cliente_id: id })).length;
  const recetas = (await store.list('Receta', { cliente_id: id })).length;
  if (ventas || recetas) {
    const partes = [ventas ? `${ventas} venta(s)` : null, recetas ? `${recetas} receta(s)` : null].filter(Boolean).join(' y ');
    throw fk(`No se puede eliminar a ${cur.nombre_razon_social}: tiene ${partes} registradas y se conservan para el historial. Puede editar sus datos si es necesario.`);
  }
  await store.remove('Cliente', id);
  await audit(user.usuario_id, 'CLIENTE_ELIMINADO', 'Cliente', id, `${cur.tipo_documento} ${cur.numero_documento} · ${String(cur.nombre_razon_social).slice(0, 120)}`);
  return { ok: true };
};

module.exports = { listarClientes, crearClientes, actualizarClientes, eliminarClientes };
