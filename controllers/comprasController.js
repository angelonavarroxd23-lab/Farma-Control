'use strict';
const { validation, notFound, business } = require('../models/errors');
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

/** Valida un lote nuevo declarado dentro de la compra: { medicamento_id, codigo_lote, fecha_vencimiento, stock_minimo? }. */
function validarNuevoLote(n, k, errs) {
  const medicamento_id = Number(n?.medicamento_id); const codigo = String(n?.codigo_lote ?? '').trim();
  const venc = String(n?.fecha_vencimiento ?? ''); const min = n?.stock_minimo === undefined || n?.stock_minimo === '' || n?.stock_minimo === null ? 5 : Number(n.stock_minimo);
  if (!Number.isInteger(medicamento_id) || medicamento_id <= 0) errs.push(`items[${k}].nuevo_lote.medicamento_id: no válido.`);
  if (!codigo) errs.push(`items[${k}].nuevo_lote.codigo_lote: es obligatorio.`); else if (codigo.length > 60) errs.push(`items[${k}].nuevo_lote.codigo_lote: máximo 60 caracteres.`);
  if (!V.isRealDate(venc)) errs.push(`items[${k}].nuevo_lote.fecha_vencimiento: fecha no válida (AAAA-MM-DD).`);
  else if (venc < inv.todayStr()) errs.push(`items[${k}].nuevo_lote.fecha_vencimiento: un lote nuevo no puede estar vencido.`);
  if (!Number.isInteger(min) || min < 0 || min > 100000) errs.push(`items[${k}].nuevo_lote.stock_minimo: entero mayor o igual a 0.`);
  return { medicamento_id, codigo_lote: codigo, fecha_vencimiento: venc, stock_minimo: min };
}

/**
 * Registra una compra. Cada línea referencia un lote existente (lote_id) o declara un lote nuevo (nuevo_lote),
 * que se crea en la misma operación con stock 0 y recibe sus unidades por la compra. Opcionalmente cierra una
 * orden de reposición PENDIENTE del mismo proveedor (orden_id).
 * Los lotes nuevos se crean antes del procedimiento de compra; si este falla se eliminan (compensación).
 */
const crearCompras = async ({ store, body, user, ip, audit }) => {
  const errs = [];
  const proveedorId = Number(body.proveedor_id);
  if (!Number.isInteger(proveedorId) || proveedorId <= 0) errs.push('proveedor_id: es obligatorio.');
  const doc = String(body.numero_documento || '').trim();
  if (!doc) errs.push('numero_documento: es obligatorio.'); else if (doc.length > 40) errs.push('numero_documento: máximo 40 caracteres.');
  const ordenId = body.orden_id === undefined || body.orden_id === null || body.orden_id === '' ? null : Number(body.orden_id);
  if (ordenId !== null && (!Number.isInteger(ordenId) || ordenId <= 0)) errs.push('orden_id: no válido.');
  if (!Array.isArray(body.items) || !body.items.length) errs.push('items: agregue al menos un lote.');
  const items = [];
  for (const [k, it] of (Array.isArray(body.items) ? body.items : []).entries()) {
    const cantidad = Number(it?.cantidad), costo = Number(it?.costo_unitario);
    const nuevo = it?.nuevo_lote ? validarNuevoLote(it.nuevo_lote, k, errs) : null;
    const lote_id = nuevo ? null : Number(it?.lote_id);
    if (!nuevo && (!Number.isInteger(lote_id) || lote_id <= 0)) errs.push(`items[${k}].lote_id: no válido (o indique nuevo_lote).`);
    if (!Number.isInteger(cantidad) || cantidad <= 0 || cantidad > 1000000) errs.push(`items[${k}].cantidad: entero positivo.`);
    if (!(costo >= 0) || costo > 1e7) errs.push(`items[${k}].costo_unitario: debe ser mayor o igual a 0.`);
    items.push({ lote_id, nuevo, cantidad, costo_unitario: round2(costo) });
  }
  const ids = items.filter((i) => i.lote_id).map((i) => i.lote_id);
  if (new Set(ids).size !== ids.length) errs.push('items: un lote solo puede aparecer una vez por compra.');
  const claves = items.filter((i) => i.nuevo).map((i) => `${i.nuevo.medicamento_id}|${i.nuevo.codigo_lote.toLowerCase()}`);
  if (new Set(claves).size !== claves.length) errs.push('items: un lote nuevo no puede repetirse en la compra.');
  if (errs.length) throw validation('Datos no válidos.', errs);

  let orden = null;
  if (ordenId !== null) {
    orden = await store.get('OrdenReposicion', ordenId);
    if (!orden) throw validation('Datos no válidos.', ['orden_id: la orden de reposición no existe.']);
    if (orden.estado !== 'PENDIENTE') throw business('La orden de reposición no está pendiente.', 50043);
    if (orden.proveedor_id !== proveedorId) throw business('La orden de reposición pertenece a otro proveedor.', 50044);
  }
  for (const i of items.filter((x) => x.nuevo)) {
    const m = await store.get('Medicamento', i.nuevo.medicamento_id);
    if (!m) throw validation('Datos no válidos.', ['nuevo_lote.medicamento_id: el medicamento no existe.']);
    if (!m.activo) throw business('No se puede crear un lote de un medicamento inactivo.', 50045);
  }

  const creados = [];
  let res;
  try {
    for (const i of items.filter((x) => x.nuevo)) {
      const l = await store.insert('Lote', { ...i.nuevo, stock_actual: 0, proveedor_id: proveedorId });
      i.lote_id = l.lote_id; creados.push(l);
    }
    res = await store.registrarCompra({ proveedorId, usuarioId: user.usuario_id, numeroDocumento: doc, ip,
      items: items.map(({ lote_id, cantidad, costo_unitario }) => ({ lote_id, cantidad, costo_unitario })) });
  } catch (e) {
    for (const l of creados) await store.remove('Lote', l.lote_id).catch(() => {}); // compensación: sin lotes huérfanos
    throw e;
  }

  // Efectos posteriores (no deshacen la compra ya registrada; si fallan se informan en "advertencias").
  const advertencias = [];
  try {
    for (const l of creados) await audit(user.usuario_id, 'LOTE_CREADO', 'Lote', l.lote_id, `${l.codigo_lote} (desde compra #${res.compra_id})`);
    for (const i of items) {
      const lote = await store.get('Lote', i.lote_id);
      if (lote && lote.proveedor_id !== proveedorId) await store.update('Lote', lote.lote_id, { proveedor_id: proveedorId });
      const m = lote && await store.get('Medicamento', lote.medicamento_id);
      if (m && m.proveedor_id == null) await store.update('Medicamento', m.medicamento_id, { proveedor_id: proveedorId });
    }
  } catch (e) { advertencias.push(`No se pudo actualizar el proveedor de los lotes: ${e.message}`); }
  if (orden) {
    try {
      await store.update('OrdenReposicion', orden.orden_id, { estado: 'RECIBIDA', compra_id: res.compra_id });
      await audit(user.usuario_id, 'ORDEN_RECIBIDA', 'OrdenReposicion', orden.orden_id, `Compra #${res.compra_id}`);
    } catch (e) { advertencias.push(`La compra se registró, pero no se pudo cerrar la orden #${orden.orden_id}: ${e.message}`); }
  }
  return { status: 201, data: { ...res, lotes_creados: creados.map((l) => l.lote_id), orden_id: orden ? orden.orden_id : null, advertencias } };
};

module.exports = { listarCompras, obtenerCompras, crearCompras };
