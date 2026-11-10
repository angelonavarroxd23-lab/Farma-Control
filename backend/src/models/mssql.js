'use strict';
// Controlador de SQL Server (paquete "mssql"). Todas las consultas están parametrizadas; los
// identificadores (tablas y columnas) provienen exclusivamente de schema.js, nunca de la entrada.
// Las operaciones críticas se delegan en los procedimientos almacenados transaccionales.
const { TABLES } = require('./schema');
const { AppError, business, notFound, unique, fk } = require('./errors');

const q = (id) => `[${id}]`;

function mapError(e) {
  if (e instanceof AppError) return e;
  const n = e.number ?? e.originalError?.info?.number;
  const msg = String(e.message || '');
  if (n === 2627 || n === 2601) {
    for (const def of Object.values(TABLES))
      for (const u of def.unique) if (msg.includes(u.name)) return unique(`Ya existe un registro con ${u.label}.`);
    if (/UX_Mov_/.test(msg)) return unique('Movimiento duplicado para la operación y el lote.');
    return unique('Ya existe un registro con el mismo valor único.');
  }
  if (n === 547) {
    if (/DELETE/i.test(msg) || /REFERENCE constraint/i.test(msg)) return fk('No se puede eliminar: existen registros relacionados.');
    if (/FOREIGN KEY/i.test(msg)) return fk('Referencia inexistente en una tabla relacionada.');
    return business('El dato no cumple una restricción de integridad (CHECK).', 547);
  }
  if (n >= 50000) return business(msg, n); // THROW de los procedimientos almacenados
  console.error('[mssql] error no controlado:', n, msg);
  return new AppError(500, 'INTERNAL', 'Error interno de base de datos.');
}

class MssqlStore {
  constructor(cfg) { this.kind = 'mssql'; this.cfg = cfg; this.sql = null; this.pool = null; }

  // Construye la configuración del pool según DB_AUTH. No hay conmutación silenciosa: si la conexión falla,
  // se lanza un error con el motivo y el servidor no arranca.
  static poolConfig(c) {
    const common = { pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }, requestTimeout: 15000 };
    if (c.auth === 'windows') {
      const server = c.port ? `${c.server},${c.port}` : c.server;
      const cs = `Driver={${c.odbcDriver}};Server=${server};Database=${c.database};Trusted_Connection=Yes;` +
        `Encrypt=${c.encrypt ? 'Yes' : 'No'};TrustServerCertificate=${c.trustServerCertificate ? 'Yes' : 'No'};`;
      return { ...common, connectionString: cs };
    }
    return { ...common, server: c.server, port: c.port || 1433, database: c.database, user: c.user, password: c.password,
      options: { encrypt: c.encrypt, trustServerCertificate: c.trustServerCertificate, enableArithAbort: true } };
  }

  async connect() {
    let sql;
    const win = this.cfg.auth === 'windows';
    try { sql = win ? require('mssql/msnodesqlv8') : require('mssql'); } catch {
      throw new Error(win ? 'Falta "msnodesqlv8" (autenticación de Windows). Ejecute "npm install" en backend.' : 'Falta la dependencia "mssql". Ejecute "npm install" en la carpeta backend.');
    }
    this.sql = sql;
    try {
      this.pool = await new sql.ConnectionPool(MssqlStore.poolConfig(this.cfg)).connect();
    } catch (e) {
      throw new Error(`No se pudo conectar a SQL Server (${this.cfg.server}, base ${this.cfg.database}, auth ${this.cfg.auth}): ${e.message}. ` +
        'El sistema NO cambia a otro almacenamiento. Revise backend/.env, que el servicio MSSQLSERVER esté iniciado y que haya ejecutado "npm run db:setup".');
    }
    return this;
  }

  _type(d) {
    const s = this.sql;
    switch (d.t) {
      case 'int': return s.Int;
      case 'bigint': return s.BigInt;
      case 'bit': return s.Bit;
      case 'dec': return s.Decimal(14, 2);
      case 'date': return s.Date;
      case 'dt': return s.DateTime2(0);
      default: return d.ascii ? s.VarChar(d.max || 255) : s.NVarChar(d.max || s.MAX);
    }
  }
  _in(d, v) {
    if (v == null) return null;
    if (d.t === 'date') return new Date(`${v}T00:00:00Z`);
    if (d.t === 'dt') return new Date(`${String(v).replace(' ', 'T')}Z`);
    if (d.t === 'bit') return v === true || v === 1 || v === '1';
    if (d.t === 'int' || d.t === 'dec' || d.t === 'bigint') return Number(v);
    return v;
  }
  _out(table, row) {
    if (!row) return row;
    const out = {};
    for (const [c, d] of Object.entries(TABLES[table].cols)) {
      let v = row[c];
      if (v === undefined) continue;
      if (v !== null) {
        if (d.t === 'date') v = new Date(v).toISOString().slice(0, 10);
        else if (d.t === 'dt') v = new Date(v).toISOString().slice(0, 19).replace('T', ' ');
        else if (d.t === 'bigint' || d.t === 'dec') v = Number(v);
        else if (d.t === 'bit') v = !!v;
      }
      out[c] = v;
    }
    return out;
  }
  _bind(req, table, obj, prefix = 'prm_') {
    const names = {};
    Object.keys(obj).forEach((c, i) => {
      const d = TABLES[table].cols[c];
      if (!d) throw new Error(`Columna no permitida: ${c}`);
      req.input(`${prefix}${i}`, this._type(d), this._in(d, obj[c]));
      names[c] = `@${prefix}${i}`;
    });
    return names;
  }
  async _run(fn) { try { return await fn(); } catch (e) { throw mapError(e); } }

  async ping() { await this.pool.request().query('SELECT 1 AS ok'); return true; }
  async close() { if (this.pool) await this.pool.close(); }

  async list(table, filter = {}) {
    return this._run(async () => {
      const req = this.pool.request();
      const keys = Object.keys(filter);
      const names = this._bind(req, table, Object.fromEntries(keys.filter((k) => filter[k] !== null).map((k) => [k, filter[k]])));
      const where = keys.map((k) => (filter[k] === null ? `${q(k)} IS NULL` : `${q(k)} = ${names[k]}`)).join(' AND ');
      const r = await req.query(`SELECT * FROM dbo.${q(table)}${where ? ' WHERE ' + where : ''} ORDER BY ${q(TABLES[table].pk)}`);
      return r.recordset.map((row) => this._out(table, row));
    });
  }
  async get(table, id) {
    return this._run(async () => {
      const r = await this.pool.request().input('id', this.sql.Int, Number(id))
        .query(`SELECT * FROM dbo.${q(table)} WHERE ${q(TABLES[table].pk)} = @id`);
      return r.recordset[0] ? this._out(table, r.recordset[0]) : null;
    });
  }
  async insert(table, input) {
    return this._run(async () => {
      const def = TABLES[table];
      const data = Object.fromEntries(Object.entries(input).filter(([c]) => def.cols[c] && !def.cols[c].computed && !(def.cols[c].auto && def.cols[c].t !== 'dt')));
      const req = this.pool.request();
      const names = this._bind(req, table, data);
      const cols = Object.keys(data);
      const sql = cols.length
        ? `INSERT INTO dbo.${q(table)} (${cols.map(q).join(',')}) OUTPUT INSERTED.* VALUES (${cols.map((c) => names[c]).join(',')})`
        : `INSERT INTO dbo.${q(table)} OUTPUT INSERTED.* DEFAULT VALUES`;
      const r = await req.query(sql);
      return this._out(table, r.recordset[0]);
    });
  }
  async update(table, id, patch) {
    return this._run(async () => {
      const cols = Object.keys(patch);
      if (!cols.length) return this.get(table, id);
      const req = this.pool.request().input('id', this.sql.Int, Number(id));
      const names = this._bind(req, table, patch);
      const r = await req.query(`UPDATE dbo.${q(table)} SET ${cols.map((c) => `${q(c)} = ${names[c]}`).join(', ')} OUTPUT INSERTED.* WHERE ${q(TABLES[table].pk)} = @id`);
      if (!r.recordset.length) throw notFound();
      return this._out(table, r.recordset[0]);
    });
  }
  async remove(table, id) {
    return this._run(async () => {
      const r = await this.pool.request().input('id', this.sql.Int, Number(id))
        .query(`DELETE FROM dbo.${q(table)} WHERE ${q(TABLES[table].pk)} = @id`);
      if (!r.rowsAffected[0]) throw notFound();
    });
  }

  _tvp(name, cols, rows) {
    const s = this.sql; const t = new s.Table(name);
    for (const [n, type] of cols) t.columns.add(n, type, { nullable: false });
    rows.forEach((r) => t.rows.add(...cols.map(([n]) => r[n])));
    return t;
  }

  async registrarCompra({ proveedorId, usuarioId, numeroDocumento, items, ip }) {
    return this._run(async () => {
      const s = this.sql;
      const tvp = this._tvp('dbo.TDetalleCompra', [['lote_id', s.Int], ['cantidad', s.Int], ['costo_unitario', s.Decimal(12, 2)]], items);
      const r = await this.pool.request()
        .input('ProveedorId', s.Int, proveedorId).input('UsuarioId', s.Int, usuarioId)
        .input('NumeroDocumento', s.VarChar(40), numeroDocumento).input('Items', tvp)
        .input('Ip', s.VarChar(45), ip || null).output('CompraId', s.Int)
        .execute('dbo.sp_RegistrarCompra');
      return { compra_id: r.output.CompraId };
    });
  }
  async registrarVenta({ clienteId, usuarioId, recetaId = null, tipoComprobante, items, ip }) {
    return this._run(async () => {
      const s = this.sql;
      const tvp = this._tvp('dbo.TDetalleVenta', [['lote_id', s.Int], ['cantidad', s.Int]], items);
      const r = await this.pool.request()
        .input('ClienteId', s.Int, clienteId).input('UsuarioId', s.Int, usuarioId)
        .input('RecetaId', s.Int, recetaId).input('TipoComprobante', s.VarChar(10), tipoComprobante)
        .input('Items', tvp).input('Ip', s.VarChar(45), ip || null)
        .output('VentaId', s.Int).output('NumeroComprobante', s.VarChar(30))
        .execute('dbo.sp_RegistrarVenta');
      return { venta_id: r.output.VentaId, numero_comprobante: r.output.NumeroComprobante };
    });
  }
  async anularVenta({ ventaId, usuarioId, motivo, ip }) {
    return this._run(async () => {
      const s = this.sql;
      await this.pool.request().input('VentaId', s.Int, ventaId).input('UsuarioId', s.Int, usuarioId)
        .input('Motivo', s.NVarChar(250), motivo).input('Ip', s.VarChar(45), ip || null)
        .execute('dbo.sp_AnularVenta');
      return { venta_id: ventaId };
    });
  }
}

module.exports = { MssqlStore };
