'use strict';
// Controlador en memoria: implementa el MISMO contrato que el controlador de SQL Server
// (CRUD genérico + sp_RegistrarCompra / sp_RegistrarVenta / sp_AnularVenta) para ejecutar las
// pruebas automatizadas sin una instancia de SQL Server. Los datos se pierden al detener el proceso.
// NO es un sustituto de la base de datos: el despliegue real usa mssql.js.
const { TABLES } = require('./schema');
const { business, notFound, unique, fk } = require('./errors');

const pad = (n) => String(n).padStart(2, '0');
const today = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const nowStr = (d = new Date()) => `${today(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const digits = (s, n) => /^[0-9]+$/.test(s) && (n == null || s.length === n);

// Réplica de las restricciones CHECK del script SQL.
const CHECKS = {
  Cliente: (r) => {
    const ok = r.tipo_documento === 'DNI' ? digits(r.numero_documento, 8)
      : r.tipo_documento === 'RUC' ? digits(r.numero_documento, 11)
      : r.numero_documento.length >= 4 && r.numero_documento.length <= 15;
    return ok ? null : 'El número de documento no cumple el formato del tipo indicado.';
  },
  Proveedor: (r) => (digits(r.ruc) ? null : 'El RUC solo admite dígitos.'),
  Medicamento: (r) => (r.precio_venta >= 0 ? null : 'El precio no puede ser negativo.'),
  Receta: (r) => (r.fecha_vencimiento >= r.fecha_emision ? null : 'La fecha de vencimiento no puede ser anterior a la emisión.'),
  Lote: (r) => (r.stock_actual >= 0 && r.stock_minimo >= 0 ? null : 'Las existencias no pueden ser negativas.'),
};

class MemoryStore {
  constructor() {
    this.kind = 'memory';
    this.data = {}; this.ids = {};
    for (const t of Object.keys(TABLES)) { this.data[t] = []; this.ids[t] = 0; }
    this.seqBoleta = 0; this.seqFactura = 0;
  }
  async ping() { return true; }
  async close() {}

  _clone(r) { return r ? { ...r } : r; }

  async list(table, filter = {}) {
    const keys = Object.keys(filter);
    return this.data[table].filter((r) => keys.every((k) => r[k] === filter[k])).map((r) => this._clone(r));
  }
  async get(table, id) {
    return this._clone(this.data[table].find((r) => r[TABLES[table].pk] === Number(id))) || null;
  }
  _checkFk(table, row) {
    for (const [c, d] of Object.entries(TABLES[table].cols)) {
      if (d.fk && row[c] != null && !this.data[d.fk].some((x) => x[TABLES[d.fk].pk] === row[c]))
        throw fk(`Referencia inexistente en ${d.fk} (${c}).`);
    }
  }
  _checkUnique(table, row, selfId) {
    const pk = TABLES[table].pk;
    for (const u of TABLES[table].unique) {
      if (u.cols.some((c) => row[c] == null)) continue;
      const dup = this.data[table].some((x) => x[pk] !== selfId && u.cols.every((c) => String(x[c]).toLowerCase() === String(row[c]).toLowerCase()));
      if (dup) throw unique(`Ya existe un registro con ${u.label}.`);
    }
  }
  _checkRow(table, row) {
    if (CHECKS[table]) { const m = CHECKS[table](row); if (m) throw business(m); }
  }
  _insert(table, input) {
    const def = TABLES[table]; const row = {};
    for (const [c, d] of Object.entries(def.cols)) {
      if (d.auto && d.t !== 'dt') continue;
      if (d.computed) continue;
      row[c] = input[c] !== undefined ? input[c] : (d.def !== undefined ? d.def : null);
    }
    if (def.cols.fecha && def.cols.fecha.auto && row.fecha == null) row.fecha = nowStr();
    this._checkFk(table, row); this._checkUnique(table, row); this._checkRow(table, row);
    row[def.pk] = ++this.ids[table];
    if (def.cols.subtotal) row.subtotal = Math.round(row.cantidad * (row.costo_unitario ?? row.precio_unitario) * 100) / 100;
    this.data[table].push(row);
    return this._clone(row);
  }
  async insert(table, input) { return this._insert(table, input); }
  async update(table, id, patch) {
    const pk = TABLES[table].pk;
    const row = this.data[table].find((r) => r[pk] === Number(id));
    if (!row) throw notFound();
    const next = { ...row, ...patch };
    this._checkFk(table, next); this._checkUnique(table, next, row[pk]); this._checkRow(table, next);
    Object.assign(row, next);
    return this._clone(row);
  }
  async remove(table, id) {
    const pk = TABLES[table].pk;
    const idx = this.data[table].findIndex((r) => r[pk] === Number(id));
    if (idx < 0) throw notFound();
    for (const [t, d] of Object.entries(TABLES))
      for (const [c, cd] of Object.entries(d.cols))
        if (cd.fk === table && this.data[t].some((r) => r[c] === Number(id)))
          throw fk('No se puede eliminar: existen registros relacionados.');
    this.data[table].splice(idx, 1);
  }

  _audit(usuario_id, accion, entidad, entidad_id, detalle, ip) {
    this._insert('AuditoriaOperacion', { usuario_id, accion, entidad, entidad_id, detalle: detalle && detalle.slice(0, 500), ip: ip || null });
  }
  _mov(lote_id, usuario_id, tipo, cantidad, compra_id, venta_id) {
    // Réplica de los índices únicos filtrados UX_Mov_*: un movimiento por operación y lote.
    const dup = this.data.MovimientoStock.some((m) => m.tipo === tipo && m.lote_id === lote_id &&
      (tipo === 'ENTRADA_COMPRA' ? m.compra_id === compra_id : m.venta_id === venta_id));
    if (dup) throw unique('Movimiento duplicado para la operación y el lote.');
    this._insert('MovimientoStock', { lote_id, usuario_id, tipo, cantidad, compra_id: compra_id ?? null, venta_id: venta_id ?? null });
  }
  _activeUser(id) { const u = this.data.Usuario.find((x) => x.usuario_id === id); return u && u.activo ? u : null; }

  // === sp_RegistrarCompra ===
  async registrarCompra({ proveedorId, usuarioId, numeroDocumento, items, ip }) {
    const prov = this.data.Proveedor.find((p) => p.proveedor_id === proveedorId && p.activo);
    if (!prov) throw business('Proveedor inexistente o inactivo.', 50004);
    if (!this._activeUser(usuarioId)) throw business('Usuario inexistente o inactivo.', 50005);
    if (!String(numeroDocumento || '').trim()) throw business('Se requiere numero de documento.', 50006);
    if (!items.length) throw business('La compra debe incluir al menos un lote.', 50001);
    if (items.some((i) => !(i.cantidad > 0) || i.costo_unitario < 0)) throw business('Cantidad o costo no valido.', 50002);
    if (this.data.Compra.some((c) => c.proveedor_id === proveedorId && c.numero_documento === numeroDocumento))
      throw business('Ya existe una compra con ese documento para el proveedor.', 50008);
    const lotes = items.map((i) => this.data.Lote.find((l) => l.lote_id === i.lote_id));
    if (lotes.some((l) => !l)) throw business('Existen lotes inexistentes.', 50003);
    if (lotes.some((l) => l.fecha_vencimiento < today())) throw business('No se puede ingresar stock a un lote vencido.', 50007);
    const total = Math.round(items.reduce((a, i) => a + Math.round(i.cantidad * i.costo_unitario * 100), 0)) / 100;
    const compra = this._insert('Compra', { proveedor_id: proveedorId, usuario_id: usuarioId, numero_documento: numeroDocumento, total });
    for (const i of items) {
      this._insert('DetalleCompra', { compra_id: compra.compra_id, lote_id: i.lote_id, cantidad: i.cantidad, costo_unitario: i.costo_unitario });
      this.data.Lote.find((l) => l.lote_id === i.lote_id).stock_actual += i.cantidad;
      this._mov(i.lote_id, usuarioId, 'ENTRADA_COMPRA', i.cantidad, compra.compra_id, null);
    }
    this._audit(usuarioId, 'COMPRA_REGISTRADA', 'Compra', compra.compra_id, `Documento ${numeroDocumento}; total S/ ${total}`, ip);
    return { compra_id: compra.compra_id };
  }

  // === sp_RegistrarVenta ===
  async registrarVenta({ clienteId, usuarioId, recetaId = null, tipoComprobante, items, ip }) {
    if (!items.length) throw business('La venta debe contener al menos un lote.', 50011);
    if (items.some((i) => !(i.cantidad > 0))) throw business('La cantidad debe ser mayor que cero.', 50012);
    if (!['BOLETA', 'FACTURA'].includes(tipoComprobante)) throw business('Tipo de comprobante no valido.', 50013);
    const cliente = this.data.Cliente.find((c) => c.cliente_id === clienteId);
    if (!cliente) throw business('Cliente inexistente.', 50014);
    if (!this._activeUser(usuarioId)) throw business('Usuario inexistente o inactivo.', 50015);
    if (tipoComprobante === 'FACTURA' && cliente.tipo_documento !== 'RUC') throw business('La factura requiere un cliente identificado con RUC.', 50023);
    const hoy = today();
    const lotes = items.map((i) => this.data.Lote.find((l) => l.lote_id === i.lote_id));
    if (lotes.some((l) => !l)) throw business('Existen lotes inexistentes.', 50016);
    const meds = lotes.map((l) => this.data.Medicamento.find((m) => m.medicamento_id === l.medicamento_id));
    if (meds.some((m) => !m.activo)) throw business('La venta incluye un medicamento inactivo.', 50019);
    if (lotes.some((l) => l.fecha_vencimiento < hoy)) throw business('No se pueden vender lotes vencidos.', 50020);
    if (lotes.some((l, k) => l.stock_actual < items[k].cantidad)) throw business('La cantidad supera las existencias disponibles del lote.', 50021);
    if (recetaId != null) {
      const r = this.data.Receta.find((x) => x.receta_id === recetaId);
      if (!r || r.cliente_id !== clienteId || r.estado !== 'VALIDA' || r.fecha_emision > hoy || r.fecha_vencimiento < hoy)
        throw business('Receta no valida, no vigente o de otro cliente.', 50017);
    } else if (meds.some((m) => m.requiere_receta)) throw business('Se requiere registrar receta para alguno de los productos.', 50018);
    const total = Math.round(items.reduce((a, i, k) => a + Math.round(i.cantidad * meds[k].precio_venta * 100), 0)) / 100;
    const nro = tipoComprobante === 'BOLETA' ? ++this.seqBoleta : ++this.seqFactura;
    const numero = (tipoComprobante === 'BOLETA' ? 'B001-' : 'F001-') + String(nro).padStart(6, '0');
    const venta = this._insert('Venta', { cliente_id: clienteId, usuario_id: usuarioId, receta_id: recetaId, tipo_comprobante: tipoComprobante, numero_comprobante: numero, estado: 'CONFIRMADA', total });
    items.forEach((i, k) => {
      this._insert('DetalleVenta', { venta_id: venta.venta_id, lote_id: i.lote_id, cantidad: i.cantidad, precio_unitario: meds[k].precio_venta });
      lotes[k].stock_actual -= i.cantidad;
      this._mov(i.lote_id, usuarioId, 'SALIDA_VENTA', i.cantidad, null, venta.venta_id);
    });
    this._audit(usuarioId, 'VENTA_REGISTRADA', 'Venta', venta.venta_id, `Comprobante ${numero}; total S/ ${total}`, ip);
    return { venta_id: venta.venta_id, numero_comprobante: numero };
  }

  // === sp_AnularVenta ===
  async anularVenta({ ventaId, usuarioId, motivo, ip }) {
    if (!String(motivo || '').trim()) throw business('Se requiere el motivo de la anulacion.', 50034);
    const u = this._activeUser(usuarioId);
    const rol = u && this.data.Rol.find((r) => r.rol_id === u.rol_id);
    if (!rol || rol.nombre !== 'Administrador') throw business('Solo un administrador activo puede anular ventas.', 50033);
    const v = this.data.Venta.find((x) => x.venta_id === ventaId);
    if (!v) throw business('La venta no existe.', 50031);
    if (v.estado !== 'CONFIRMADA') throw business('La venta ya esta anulada.', 50032);
    for (const d of this.data.DetalleVenta.filter((x) => x.venta_id === ventaId)) {
      this.data.Lote.find((l) => l.lote_id === d.lote_id).stock_actual += d.cantidad;
      this._mov(d.lote_id, usuarioId, 'REVERSO_VENTA', d.cantidad, null, ventaId);
    }
    Object.assign(v, { estado: 'ANULADA', fecha_anulacion: nowStr(), usuario_anulacion_id: usuarioId, motivo_anulacion: motivo });
    this._audit(usuarioId, 'VENTA_ANULADA', 'Venta', ventaId, String(motivo).slice(0, 500), ip);
    return { venta_id: ventaId };
  }
}

module.exports = { MemoryStore };
