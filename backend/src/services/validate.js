'use strict';
// Validación de entradas en el servidor, guiada por el esquema (tipos, longitudes, enumeraciones).
const { TABLES } = require('../db/schema');
const { validation } = require('../db/errors');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (s) => { if (!DATE_RE.test(s)) return false; const d = new Date(`${s}T00:00:00Z`); return !isNaN(d) && d.toISOString().slice(0, 10) === s; };

function clean(table, input, { partial = false, allow } = {}) {
  const def = TABLES[table];
  const out = {}; const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw validation('El cuerpo de la petición debe ser un objeto JSON.');
  const fields = allow || Object.keys(def.cols).filter((c) => !def.cols[c].auto && !def.cols[c].ro && !def.cols[c].computed);
  for (const c of fields) {
    const d = def.cols[c];
    let v = input[c];
    if (v === undefined) { if (!partial && d.req) errors.push(`${c}: es obligatorio.`); continue; }
    if (typeof v === 'string') v = v.trim();
    if (v === '' || v === null) {
      if (d.req) errors.push(`${c}: es obligatorio.`); else out[c] = null;
      continue;
    }
    switch (d.t) {
      case 'int': case 'bigint':
        if (!Number.isInteger(Number(v)) || typeof v === 'boolean') { errors.push(`${c}: debe ser un entero.`); continue; }
        v = Number(v); break;
      case 'dec':
        if (isNaN(Number(v)) || typeof v === 'boolean') { errors.push(`${c}: debe ser numérico.`); continue; }
        v = Math.round(Number(v) * 100) / 100; break;
      case 'bit':
        if (typeof v === 'boolean') break;
        if (v === 1 || v === '1' || v === 'true') v = true; else if (v === 0 || v === '0' || v === 'false') v = false;
        else { errors.push(`${c}: debe ser verdadero o falso.`); continue; }
        break;
      case 'date':
        if (!isRealDate(v)) { errors.push(`${c}: fecha no válida (AAAA-MM-DD).`); continue; }
        break;
      default:
        if (typeof v !== 'string' && typeof v !== 'number') { errors.push(`${c}: texto no válido.`); continue; }
        v = String(v);
        if (d.max && v.length > d.max) { errors.push(`${c}: máximo ${d.max} caracteres.`); continue; }
        if (d.enum && !d.enum.includes(v)) { errors.push(`${c}: valor no permitido (${d.enum.join(', ')}).`); continue; }
    }
    out[c] = v;
  }
  if (errors.length) throw validation('Datos no válidos.', errors);
  return out;
}

// Reglas de formato específicas del dominio (replican los CHECK del script SQL).
const digits = (s, n) => /^[0-9]+$/.test(s) && (n == null || s.length === n);
function checkCliente(r) {
  const errs = [];
  if (r.tipo_documento === 'DNI' && !digits(r.numero_documento, 8)) errs.push('numero_documento: el DNI tiene 8 dígitos.');
  if (r.tipo_documento === 'RUC' && !digits(r.numero_documento, 11)) errs.push('numero_documento: el RUC tiene 11 dígitos.');
  if (['CE', 'OTR'].includes(r.tipo_documento) && (r.numero_documento.length < 4 || r.numero_documento.length > 15)) errs.push('numero_documento: entre 4 y 15 caracteres.');
  if (errs.length) throw validation('Datos no válidos.', errs);
}
function checkProveedor(r) { if (r.ruc !== undefined && !(digits(r.ruc, 11))) throw validation('Datos no válidos.', ['ruc: debe tener 11 dígitos.']); }
function checkMedicamento(r) { if (r.precio_venta !== undefined && r.precio_venta < 0) throw validation('Datos no válidos.', ['precio_venta: no puede ser negativo.']); }
function checkReceta(r) { if (r.fecha_emision && r.fecha_vencimiento && r.fecha_vencimiento < r.fecha_emision) throw validation('Datos no válidos.', ['fecha_vencimiento: no puede ser anterior a la emisión.']); }
const positiveInt = (v, name) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw validation('Datos no válidos.', [`${name}: debe ser un entero positivo.`]); return n; };

module.exports = { clean, isRealDate, checkCliente, checkProveedor, checkMedicamento, checkReceta, positiveInt };
