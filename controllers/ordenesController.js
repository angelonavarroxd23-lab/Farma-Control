'use strict';
const { validation, notFound, business } = require('../models/errors');
const V = require('../models/validate');
const inv = require('../models/inventario');
const { byId } = require('../models/util');

/** Controlador de reposición: sugerencias a partir del inventario y órdenes de reposición a proveedores (BN-04). */
const sugerencias = async ({ store }) => {
  const [meds, lotes, provs, ordenes, det] = await Promise.all([store.list('Medicamento'), store.list('Lote'), store.list('Proveedor'), store.list('OrdenReposicion'), store.list('DetalleOrdenReposicion')]);
  const P = byId(provs, 'proveedor_id');
  const pendientes = new Map(ordenes.filter((o) => o.estado === 'PENDIENTE').map((o) => [o.orden_id, o]));
  const enOrden = new Map(); // medicamento_id -> orden pendiente que ya lo solicita
  for (const d of det) if (pendientes.has(d.orden_id)) enOrden.set(d.medicamento_id, { orden_id: d.orden_id, cantidad: d.cantidad_solicitada });
  return inv.sugerenciasReposicion(meds, lotes).map((s) => ({ ...s, proveedor: P.get(s.proveedor_id)?.razon_social || null, orden_pendiente: enOrden.get(s.medicamento_id) || null }));
};

const listarOrdenes = async ({ store, query }) => {
  const [ordenes, provs, users, det] = await Promise.all([store.list('OrdenReposicion'), store.list('Proveedor'), store.list('Usuario'), store.list('DetalleOrdenReposicion')]);
  const P = byId(provs, 'proveedor_id'), U = byId(users, 'usuario_id');
  return ordenes.filter((o) => !query.estado || o.estado === query.estado).reverse().map((o) => {
    const ds = det.filter((d) => d.orden_id === o.orden_id);
    return { ...o, proveedor: P.get(o.proveedor_id)?.razon_social, usuario: U.get(o.usuario_id)?.nombres, items: ds.length, unidades: ds.reduce((a, d) => a + d.cantidad_solicitada, 0) };
  });
};

const obtenerOrdenes = async ({ store, params }) => {
  const id = V.positiveInt(params.id, 'id'); const o = await store.get('OrdenReposicion', id); if (!o) throw notFound();
  const [det, meds, prov, usr] = await Promise.all([store.list('DetalleOrdenReposicion', { orden_id: id }), store.list('Medicamento'), store.get('Proveedor', o.proveedor_id), store.get('Usuario', o.usuario_id)]);
  const M = byId(meds, 'medicamento_id');
  return { ...o, proveedor: prov?.razon_social, usuario: usr?.nombres, detalle: det.map((d) => ({ ...d, medicamento: M.get(d.medicamento_id)?.nombre, sku: M.get(d.medicamento_id)?.sku, presentacion: M.get(d.medicamento_id)?.presentacion })) };
};

const crearOrdenes = async ({ store, body, user, audit }) => {
  const errs = []; const proveedorId = Number(body.proveedor_id);
  if (!Number.isInteger(proveedorId) || proveedorId <= 0) errs.push('proveedor_id: es obligatorio.');
  const obs = body.observacion == null ? null : String(body.observacion).trim() || null;
  if (obs && obs.length > 250) errs.push('observacion: máximo 250 caracteres.');
  if (!Array.isArray(body.items) || !body.items.length) errs.push('items: agregue al menos un medicamento.');
  const items = [];
  for (const [k, it] of (Array.isArray(body.items) ? body.items : []).entries()) {
    const medicamento_id = Number(it?.medicamento_id), cantidad_solicitada = Number(it?.cantidad);
    if (!Number.isInteger(medicamento_id) || medicamento_id <= 0) errs.push(`items[${k}].medicamento_id: no válido.`);
    if (!Number.isInteger(cantidad_solicitada) || cantidad_solicitada <= 0 || cantidad_solicitada > 1000000) errs.push(`items[${k}].cantidad: entero positivo.`);
    items.push({ medicamento_id, cantidad_solicitada });
  }
  if (new Set(items.map((i) => i.medicamento_id)).size !== items.length) errs.push('items: un medicamento solo puede aparecer una vez por orden.');
  if (errs.length) throw validation('Datos no válidos.', errs);
  const prov = await store.get('Proveedor', proveedorId);
  if (!prov) throw validation('Datos no válidos.', ['proveedor_id: el proveedor no existe.']);
  if (!prov.activo) throw business('El proveedor está inactivo.', 50046);
  for (const i of items) {
    const m = await store.get('Medicamento', i.medicamento_id);
    if (!m) throw validation('Datos no válidos.', [`medicamento_id ${i.medicamento_id}: el medicamento no existe.`]);
    if (!m.activo) throw business(`El medicamento ${m.nombre} está inactivo.`, 50047);
  }
  const orden = await store.insert('OrdenReposicion', { proveedor_id: proveedorId, usuario_id: user.usuario_id, estado: 'PENDIENTE', observacion: obs });
  try { for (const i of items) await store.insert('DetalleOrdenReposicion', { orden_id: orden.orden_id, ...i }); }
  catch (e) { // compensación: no deja una orden a medias
    for (const d of await store.list('DetalleOrdenReposicion', { orden_id: orden.orden_id })) await store.remove('DetalleOrdenReposicion', d.detalle_orden_id).catch(() => {});
    await store.remove('OrdenReposicion', orden.orden_id).catch(() => {});
    throw e;
  }
  await audit(user.usuario_id, 'ORDEN_REPOSICION_CREADA', 'OrdenReposicion', orden.orden_id, `${prov.razon_social}; ${items.length} medicamento(s)`);
  return { status: 201, data: await obtenerOrdenes({ store, params: { id: orden.orden_id } }) };
};

const anularOrdenes = async ({ store, params, user, audit }) => {
  const id = V.positiveInt(params.id, 'id'); const o = await store.get('OrdenReposicion', id); if (!o) throw notFound();
  if (o.estado !== 'PENDIENTE') throw business('Solo se puede anular una orden pendiente.', 50048);
  const row = await store.update('OrdenReposicion', id, { estado: 'ANULADA' });
  await audit(user.usuario_id, 'ORDEN_REPOSICION_ANULADA', 'OrdenReposicion', id, null);
  return row;
};

module.exports = { sugerencias, listarOrdenes, obtenerOrdenes, crearOrdenes, anularOrdenes };
