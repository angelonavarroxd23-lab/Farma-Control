'use strict';
const { validation, notFound } = require('../models/errors');
const V = require('../models/validate');
const inv = require('../models/inventario');
const { byId, inRange, round2 } = require('../models/util');

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
