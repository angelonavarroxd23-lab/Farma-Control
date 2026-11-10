'use strict';
const inv = require('./inventario');
const { byId, inRange, round2, checkPeriodo } = require('./util');

/** Modelo de reportes: consultas agregadas sobre el almacén (kardex y ventas por periodo). */
async function kardex(store, q) {
  const { desde, hasta } = checkPeriodo(q);
  const [movs, lotes, meds, users] = await Promise.all([store.list('MovimientoStock'), store.list('Lote'), store.list('Medicamento'), store.list('Usuario')]);
  const L = byId(inv.enriquecerLotes(lotes, meds), 'lote_id'), U = byId(users, 'usuario_id');
  const ventas = byId(await store.list('Venta'), 'venta_id'), compras = byId(await store.list('Compra'), 'compra_id');
  return movs.filter((m) => inRange(m.fecha, desde, hasta) && (!q.lote_id || m.lote_id === Number(q.lote_id)) && (!q.tipo || m.tipo === q.tipo)).reverse()
    .map((m) => ({ ...m, codigo_lote: L.get(m.lote_id)?.codigo_lote, medicamento: L.get(m.lote_id)?.medicamento, sku: L.get(m.lote_id)?.sku, usuario: U.get(m.usuario_id)?.nombres,
      documento: m.venta_id ? ventas.get(m.venta_id)?.numero_comprobante : compras.get(m.compra_id)?.numero_documento }));
}

async function reporteVentas(store, q) {
  const { desde, hasta } = checkPeriodo(q);
  const [ventas, det, lotes, meds, clientes] = await Promise.all([store.list('Venta'), store.list('DetalleVenta'), store.list('Lote'), store.list('Medicamento'), store.list('Cliente')]);
  const enr = byId(inv.enriquecerLotes(lotes, meds), 'lote_id'), C = byId(clientes, 'cliente_id');
  const enPeriodo = ventas.filter((v) => inRange(v.fecha, desde, hasta));
  const ok = enPeriodo.filter((v) => v.estado === 'CONFIRMADA'), anul = enPeriodo.filter((v) => v.estado === 'ANULADA');
  const idsOk = new Set(ok.map((v) => v.venta_id));
  const detOk = det.filter((d) => idsOk.has(d.venta_id));
  const porDia = {}; ok.forEach((v) => { const k = v.fecha.slice(0, 10); (porDia[k] ||= { fecha: k, numero: 0, importe: 0 }); porDia[k].numero += 1; porDia[k].importe = round2(porDia[k].importe + v.total); });
  const top = {}; detOk.forEach((d) => { const m = enr.get(d.lote_id)?.medicamento || '(sin dato)'; (top[m] ||= { medicamento: m, unidades: 0, importe: 0 }); top[m].unidades += d.cantidad; top[m].importe = round2(top[m].importe + d.subtotal); });
  const importe = round2(ok.reduce((a, v) => a + v.total, 0));
  return { periodo: { desde, hasta }, ok, anul, detOk, C, enr,
    resumen: { ventas_confirmadas: ok.length, importe_total: importe, ticket_promedio: ok.length ? round2(importe / ok.length) : 0,
      unidades_vendidas: detOk.reduce((a, d) => a + d.cantidad, 0), ventas_anuladas: anul.length, importe_anulado: round2(anul.reduce((a, v) => a + v.total, 0)) },
    por_dia: Object.values(porDia).sort((a, b) => a.fecha.localeCompare(b.fecha)),
    top_productos: Object.values(top).sort((a, b) => b.unidades - a.unidades).slice(0, 10) };
}

module.exports = { kardex, reporteVentas };
