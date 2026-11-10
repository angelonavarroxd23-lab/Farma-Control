'use strict';
const inv = require('../models/inventario');
const { kardex } = require('../models/reportes');

/** Controlador inventario: recibe la petición ya autenticada, usa los modelos y devuelve la respuesta. */
const listarMovimientos = async ({ store, query }) => (await kardex(store, query)).slice(0, Math.min(Number(query.limit) || 300, 1000));

const listarAlertas = async ({ store }) => {
  const [lotes, meds] = await Promise.all([store.list('Lote'), store.list('Medicamento')]);
  const rows = inv.alertas(lotes, meds);
  const conteo = { VENCIDO: 0, AGOTADO: 0, POR_VENCER: 0, STOCK_BAJO: 0 };
  rows.forEach((a) => { conteo[a.alerta] += 1; });
  return { conteo, alertas: rows };
};

module.exports = { listarMovimientos, listarAlertas };
