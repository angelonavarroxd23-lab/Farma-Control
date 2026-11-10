'use strict';
const { validation, notFound } = require('../models/errors');
const V = require('../models/validate');
const inv = require('../models/inventario');
const { byId, inRange, checkPeriodo } = require('../models/util');

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
