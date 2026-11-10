'use strict';
const inv = require('../models/inventario');
const { toCsv } = require('../http/helpers');
const { round2 } = require('../models/util');
const { kardex, reporteVentas } = require('../models/reportes');

/** Controlador reportes: recibe la petición ya autenticada, usa los modelos y devuelve la respuesta. */
const listarResumen = async ({ store, user, can }) => {
  const [lotes, meds, clientes] = await Promise.all([store.list('Lote'), store.list('Medicamento'), store.list('Cliente')]);
  const al = inv.alertas(lotes, meds); const hoy = inv.todayStr();
  const out = { medicamentos_activos: meds.filter((m) => m.activo).length, clientes: clientes.length,
    alertas: { VENCIDO: al.filter((a) => a.alerta === 'VENCIDO').length, AGOTADO: al.filter((a) => a.alerta === 'AGOTADO').length,
      POR_VENCER: al.filter((a) => a.alerta === 'POR_VENCER').length, STOCK_BAJO: al.filter((a) => a.alerta === 'STOCK_BAJO').length },
    alertas_recientes: al.slice(0, 5) };
  if (can(user.rol, 'ventas:read')) {
    const ventas = (await store.list('Venta')).filter((v) => v.fecha.slice(0, 10) === hoy);
    const ok = ventas.filter((v) => v.estado === 'CONFIRMADA');
    out.ventas_hoy = { numero: ok.length, importe: round2(ok.reduce((a, v) => a + v.total, 0)), anuladas: ventas.length - ok.length };
  }
  return out;
};

const listarReportesResumen = async ({ store, query }) => {
  const { ok, anul, detOk, C, enr, ...rest } = await reporteVentas(store, query);
  const [lotes, meds] = await Promise.all([store.list('Lote'), store.list('Medicamento')]);
  const e = inv.enriquecerLotes(lotes, meds);
  return { ...rest, inventario: { lotes: e.length, unidades_vendibles: e.filter((l) => !l.vencido).reduce((a, l) => a + l.stock_actual, 0),
    unidades_vencidas: e.filter((l) => l.vencido).reduce((a, l) => a + l.stock_actual, 0),
    valor_venta_vendible: round2(e.filter((l) => !l.vencido).reduce((a, l) => a + l.stock_actual * l.precio_venta, 0)) } };
};

const listarReportesVentasCsv = async ({ store, query }) => {
  const { ok, anul, C } = await reporteVentas(store, query);
  const rows = [...ok, ...anul].sort((a, b) => a.venta_id - b.venta_id).map((v) => [v.numero_comprobante, v.fecha, C.get(v.cliente_id)?.nombre_razon_social, v.tipo_comprobante, v.estado, v.total.toFixed(2)]);
  return { csv: toCsv(['comprobante', 'fecha', 'cliente', 'tipo', 'estado', 'total'], rows), filename: 'ventas.csv' };
};

const listarReportesInventarioCsv = async ({ store }) => {
  const [lotes, meds] = await Promise.all([store.list('Lote'), store.list('Medicamento')]);
  const rows = inv.enriquecerLotes(lotes, meds).map((l) => [l.sku, l.medicamento, l.codigo_lote, l.fecha_vencimiento, l.stock_actual, l.stock_minimo, l.precio_venta.toFixed(2), l.alerta || 'OK']);
  return { csv: toCsv(['sku', 'medicamento', 'lote', 'vencimiento', 'stock', 'stock_minimo', 'precio_venta', 'estado'], rows), filename: 'inventario.csv' };
};

const listarReportesMovimientosCsv = async ({ store, query }) => {
  const rows = (await kardex(store, query)).map((m) => [m.movimiento_id, m.fecha, m.tipo, m.sku, m.medicamento, m.codigo_lote, m.cantidad, m.documento, m.usuario]);
  return { csv: toCsv(['movimiento', 'fecha', 'tipo', 'sku', 'medicamento', 'lote', 'cantidad', 'documento', 'usuario'], rows), filename: 'movimientos.csv' };
};

module.exports = { listarResumen, listarReportesResumen, listarReportesVentasCsv, listarReportesInventarioCsv, listarReportesMovimientosCsv };
