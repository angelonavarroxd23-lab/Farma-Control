'use strict';
// Verifica la conexión y la estructura esperada: 14 tablas, 19 FK, procedimientos, vistas, índices filtrados y datos iniciales.
const { conectar, config } = require('./db-lib');
const TABLAS = ['Rol', 'Usuario', 'AuditoriaOperacion', 'Cliente', 'Proveedor', 'Categoria', 'Medicamento', 'Receta', 'Lote', 'Compra', 'DetalleCompra', 'Venta', 'DetalleVenta', 'MovimientoStock'];
const SPS = ['sp_RegistrarCompra', 'sp_RegistrarVenta', 'sp_AnularVenta'];
const VISTAS = ['vw_StockMedicamento', 'vw_AlertasLote', 'vw_VentasDiarias', 'vw_Kardex', 'vw_VentaDetalle'];
const IDX = ['UX_Mov_Entrada', 'UX_Mov_Salida', 'UX_Mov_Reverso'];
let fallos = 0;
const ok = (c, m, extra = '') => { console.log(`${c ? '  OK ' : 'FALLA'}  ${m}${extra ? ' — ' + extra : ''}`); if (!c) fallos++; };

(async () => {
  const { pool } = await conectar();
  const q = async (t) => (await pool.request().query(t)).recordset;
  const [info] = await q("SELECT @@SERVERNAME s, DB_NAME() d, SUSER_SNAME() u, CAST(SERVERPROPERTY('Edition') AS nvarchar(100)) e, CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(50)) v");
  console.log(`Conectado a ${info.s} · base ${info.d} · usuario ${info.u} · ${info.e} ${info.v} · auth ${config.db.auth}\n`);
  const names = async (sql) => new Set((await q(sql)).map((r) => r.n));
  const t = await names("SELECT name n FROM sys.tables"); ok(TABLAS.every((x) => t.has(x)) && t.size === 14, 'Tablas', `${TABLAS.filter((x) => t.has(x)).length}/14 esperadas, ${t.size} existentes`);
  const [fk] = await q('SELECT COUNT(*) c FROM sys.foreign_keys'); ok(fk.c === 19, 'Claves foráneas', `${fk.c}/19`);
  const [ck] = await q('SELECT COUNT(*) c FROM sys.check_constraints'); ok(ck.c > 0, 'Restricciones CHECK', String(ck.c));
  const p = await names("SELECT name n FROM sys.procedures"); ok(SPS.every((x) => p.has(x)), 'Procedimientos almacenados', SPS.filter((x) => p.has(x)).join(', '));
  const v = await names("SELECT name n FROM sys.views"); ok(VISTAS.every((x) => v.has(x)), 'Vistas', `${VISTAS.filter((x) => v.has(x)).length}/${VISTAS.length}`);
  const i = await names("SELECT name n FROM sys.indexes WHERE has_filter = 1"); ok(IDX.every((x) => i.has(x)), 'Índices únicos filtrados (sin movimientos duplicados)');
  const [tr] = await q('SELECT COUNT(*) c FROM sys.triggers WHERE is_ms_shipped = 0'); ok(tr.c === 0, 'Sin triggers (decisión AD-06)', String(tr.c));
  const [u] = await q('SELECT COUNT(*) c FROM dbo.Usuario WHERE activo = 1'); ok(u.c >= 4, 'Usuarios de demostración activos', String(u.c));
  const [m] = await q('SELECT COUNT(*) c FROM dbo.Medicamento'); ok(m.c > 0, 'Medicamentos cargados', String(m.c));
  const [d] = await q(`SELECT COUNT(*) c FROM dbo.Lote l WHERE l.stock_actual <> ISNULL((SELECT SUM(CASE WHEN m.tipo IN ('ENTRADA_COMPRA','REVERSO_VENTA') THEN m.cantidad ELSE -m.cantidad END) FROM dbo.MovimientoStock m WHERE m.lote_id = l.lote_id), 0)`).catch(() => [{ c: -1 }]);
  ok(d.c === 0, 'Stock de cada lote = suma de sus movimientos', d.c < 0 ? 'consulta no aplicable' : `${d.c} diferencias`);
  await pool.close();
  console.log(fallos ? `\n${fallos} verificación(es) fallida(s).` : '\nTodas las verificaciones pasaron.');
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('db:check falló:', e.message); process.exit(1); });
