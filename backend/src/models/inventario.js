'use strict';
// Reglas de lectura de inventario compartidas por todos los controladores de datos:
// estado de lote, alertas y existencias agregadas por medicamento.
const pad = (n) => String(n).padStart(2, '0');
const todayStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 864e5);

const DIAS_ALERTA = 30;

// Prioridad idéntica a la vista dbo.vw_AlertasLote.
function estadoLote(l, hoy = todayStr()) {
  if (l.stock_actual > 0 && l.fecha_vencimiento < hoy) return 'VENCIDO';
  if (l.stock_actual === 0 && l.fecha_vencimiento >= hoy) return 'AGOTADO';
  if (l.stock_actual > 0 && l.fecha_vencimiento <= addDays(hoy, DIAS_ALERTA)) return 'POR_VENCER';
  if (l.stock_actual > 0 && l.stock_actual <= l.stock_minimo) return 'STOCK_BAJO';
  return null;
}

function enriquecerLotes(lotes, meds, hoy = todayStr()) {
  const byId = new Map(meds.map((m) => [m.medicamento_id, m]));
  return lotes.map((l) => {
    const m = byId.get(l.medicamento_id) || {};
    return {
      ...l, sku: m.sku, medicamento: m.nombre, presentacion: m.presentacion, precio_venta: m.precio_venta,
      requiere_receta: !!m.requiere_receta, medicamento_activo: !!m.activo,
      dias_para_vencer: daysBetween(hoy, l.fecha_vencimiento), vencido: l.fecha_vencimiento < hoy, alerta: estadoLote(l, hoy),
    };
  });
}

function alertas(lotes, meds, hoy = todayStr()) {
  return enriquecerLotes(lotes, meds, hoy).filter((l) => l.alerta && l.medicamento_activo)
    .sort((a, b) => ORDEN[a.alerta] - ORDEN[b.alerta] || a.fecha_vencimiento.localeCompare(b.fecha_vencimiento));
}
const ORDEN = { VENCIDO: 0, AGOTADO: 1, POR_VENCER: 2, STOCK_BAJO: 3 };

function resumenMedicamentos(meds, cats, lotes, hoy = todayStr()) {
  const catById = new Map(cats.map((c) => [c.categoria_id, c.nombre]));
  return meds.map((m) => {
    const ls = lotes.filter((l) => l.medicamento_id === m.medicamento_id);
    return {
      ...m, categoria: catById.get(m.categoria_id),
      stock_vendible: ls.filter((l) => l.fecha_vencimiento >= hoy).reduce((a, l) => a + l.stock_actual, 0),
      stock_vencido: ls.filter((l) => l.fecha_vencimiento < hoy).reduce((a, l) => a + l.stock_actual, 0),
      lotes: ls.length,
    };
  });
}

module.exports = { estadoLote, enriquecerLotes, alertas, resumenMedicamentos, todayStr, addDays, DIAS_ALERTA };
