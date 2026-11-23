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

/** Ordena lotes vendibles por medicamento y vencimiento (FEFO) y marca como sugerido el primero de cada medicamento. */
function ordenarFefo(lotes) {
  const sorted = [...lotes].sort((a, b) => String(a.medicamento).localeCompare(String(b.medicamento)) || a.medicamento_id - b.medicamento_id || a.fecha_vencimiento.localeCompare(b.fecha_vencimiento) || a.lote_id - b.lote_id);
  const visto = new Set();
  return sorted.map((l) => { const sugerido = !visto.has(l.medicamento_id); visto.add(l.medicamento_id); return { ...l, fefo_sugerido: sugerido }; });
}

/**
 * Sugerencias de reposición por medicamento activo: existencias vendibles (lotes no vencidos) frente a la suma de
 * sus mínimos. Se sugiere reponer cuando vendible <= mínimo. Proveedor sugerido: habitual o el del último lote.
 */
function sugerenciasReposicion(meds, lotes, hoy = todayStr()) {
  const out = [];
  for (const m of meds.filter((x) => x.activo)) {
    const ls = lotes.filter((l) => l.medicamento_id === m.medicamento_id);
    const vigentes = ls.filter((l) => l.fecha_vencimiento >= hoy);
    const vendible = vigentes.reduce((a, l) => a + l.stock_actual, 0);
    const minimo = vigentes.length ? vigentes.reduce((a, l) => a + l.stock_minimo, 0) : 5;
    if (vendible > minimo) continue;
    const ultimo = [...ls].reverse().find((l) => l.proveedor_id);
    out.push({
      medicamento_id: m.medicamento_id, sku: m.sku, medicamento: m.nombre, presentacion: m.presentacion, stock_vendible: vendible, stock_minimo_total: minimo,
      cantidad_sugerida: Math.max(minimo * 2 - vendible, minimo), proveedor_id: m.proveedor_id || ultimo?.proveedor_id || null,
      motivo: vendible === 0 ? (ls.some((l) => l.stock_actual > 0 && l.fecha_vencimiento < hoy) ? 'SIN_STOCK_VENDIBLE_POR_VENCIMIENTO' : 'AGOTADO') : 'STOCK_BAJO',
    });
  }
  return out.sort((a, b) => a.stock_vendible - b.stock_vendible || a.medicamento.localeCompare(b.medicamento));
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

module.exports = { estadoLote, enriquecerLotes, ordenarFefo, sugerenciasReposicion, alertas, resumenMedicamentos, todayStr, addDays, DIAS_ALERTA };
