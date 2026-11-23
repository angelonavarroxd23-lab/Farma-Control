'use strict';
// Reglas de receta compartidas por los controladores: detalle prescrito, cantidades ya dispensadas
// y verificación de una venta contra el detalle de la receta (independiente del motor de datos).
const { business } = require('./errors');

/** Cantidad ya dispensada por medicamento en ventas CONFIRMADAS asociadas a la receta. */
async function dispensado(store, recetaId) {
  const ventas = (await store.list('Venta', { receta_id: recetaId })).filter((v) => v.estado === 'CONFIRMADA');
  const out = new Map();
  if (!ventas.length) return out;
  const lotes = new Map((await store.list('Lote')).map((l) => [l.lote_id, l]));
  for (const v of ventas)
    for (const d of await store.list('DetalleVenta', { venta_id: v.venta_id })) {
      const med = lotes.get(d.lote_id)?.medicamento_id;
      out.set(med, (out.get(med) || 0) + d.cantidad);
    }
  return out;
}

/** Detalle de la receta con nombre del medicamento, cantidad dispensada y pendiente. */
async function detalleConSaldo(store, recetaId) {
  const [det, meds, usado] = await Promise.all([store.list('DetalleReceta', { receta_id: recetaId }), store.list('Medicamento'), dispensado(store, recetaId)]);
  const M = new Map(meds.map((m) => [m.medicamento_id, m]));
  return det.map((d) => {
    const m = M.get(d.medicamento_id) || {}; const dis = usado.get(d.medicamento_id) || 0;
    return { ...d, medicamento: m.nombre, sku: m.sku, presentacion: m.presentacion, requiere_receta: !!m.requiere_receta, dispensado: dis, pendiente: Math.max(d.cantidad - dis, 0) };
  });
}

/**
 * Si la receta tiene detalle, cada medicamento que exige receta debe figurar en él y la cantidad
 * de la venta no puede superar el saldo pendiente. Las recetas sin detalle (registros antiguos)
 * conservan la regla anterior. Lanza un error de negocio 422 si no se cumple.
 */
async function verificarVentaContraReceta(store, recetaId, items) {
  const detalle = await detalleConSaldo(store, recetaId);
  if (!detalle.length) return;
  const [lotes, meds] = await Promise.all([store.list('Lote'), store.list('Medicamento')]);
  const L = new Map(lotes.map((l) => [l.lote_id, l])); const M = new Map(meds.map((m) => [m.medicamento_id, m]));
  const pedido = new Map();
  for (const it of items) {
    const l = L.get(it.lote_id); if (!l) continue; // el procedimiento informa lotes inexistentes
    if (M.get(l.medicamento_id)?.requiere_receta) pedido.set(l.medicamento_id, (pedido.get(l.medicamento_id) || 0) + it.cantidad);
  }
  for (const [medId, cant] of pedido) {
    const d = detalle.find((x) => x.medicamento_id === medId);
    const nombre = M.get(medId).nombre;
    if (!d) throw business(`La receta no prescribe ${nombre}.`, 50041);
    if (cant > d.pendiente) throw business(`La receta permite ${d.pendiente} unidad(es) pendientes de ${nombre} y se intenta vender ${cant}.`, 50042);
  }
}

module.exports = { dispensado, detalleConSaldo, verificarVentaContraReceta };
