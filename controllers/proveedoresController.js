'use strict';
const { notFound } = require('../models/errors');
const V = require('../models/validate');

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
