'use strict';
const V = require('./validate');
const { validation } = require('./errors');

const byId = (rows, pk) => new Map(rows.map((r) => [r[pk], r]));
const inRange = (fecha, desde, hasta) => (!desde || fecha.slice(0, 10) >= desde) && (!hasta || fecha.slice(0, 10) <= hasta);
const round2 = (n) => Math.round(n * 100) / 100;
const includesCI = (hay, q) => String(hay ?? '').toLowerCase().includes(q.toLowerCase());

function checkPeriodo(q) {
  const desde = q.desde || null, hasta = q.hasta || null;
  for (const [n, v] of [['desde', desde], ['hasta', hasta]]) if (v && !V.isRealDate(v)) throw validation('Datos no válidos.', [`${n}: fecha no válida (AAAA-MM-DD).`]);
  if (desde && hasta && desde > hasta) throw validation('El periodo es inválido: la fecha inicial es posterior a la final.');
  return { desde, hasta };
}

module.exports = { byId, inRange, round2, includesCI, checkPeriodo };
