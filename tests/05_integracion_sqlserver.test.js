'use strict';
// Pruebas de INTEGRACIÓN con SQL Server: además de la API, consultan directamente las tablas para demostrar que los datos
// quedan guardados en la base y que las reglas se aplican en la propia base (restricciones, índices, procedimientos).
// Solo se ejecutan con DB_DRIVER=mssql; con el controlador en memoria figuran como OMITIDAS (no como aprobadas).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./helpers');
const driver = (process.env.DB_DRIVER || 'memory').toLowerCase();
const skip = driver !== 'mssql' ? 'requiere DB_DRIVER=mssql (SQL Server)' : false;
let t, sql, pool;
before(async () => {
  if (skip) return;
  t = await boot();
  ({ conectar: global.__c } = require('../scripts/db-lib'));
  ({ sql, pool } = await global.__c());
}, { skip });
after(async () => { if (skip) return; await pool.close(); await t.close(); }, { skip });

const q = async (text, params = {}) => {
  const r = pool.request();
  for (const [k, [ty, v]] of Object.entries(params)) r.input(k, ty, v);
  return (await r.query(text)).recordset;
};
const venta = async (cliente, items, rol = 'cajero') => t.call('POST', '/api/ventas', { cliente_id: cliente.cliente_id, tipo_comprobante: 'BOLETA', items }, await t.login(rol));
const stockSql = async (l) => (await q('SELECT stock_actual s FROM dbo.Lote WHERE lote_id=@i', { i: [sql.Int, l.lote_id] }))[0].s;

test('SQL-01 la API trabaja sobre SQL Server real (motor, base y usuario)', { skip }, async () => {
  const h = (await t.call('GET', '/api/health')).data;
  assert.equal(h.driver ?? h.db ?? h.baseDeDatos, 'mssql');
  const [r] = await q("SELECT DB_NAME() d, CAST(SERVERPROPERTY('ProductMajorVersion') AS int) v");
  assert.equal(r.d, 'FarmaControlBD'); assert.ok(r.v >= 15, 'SQL Server 2019 o superior');
});
test('SQL-02 una compra deja Compra, DetalleCompra, MovimientoStock, Lote y Auditoría guardados en la base', { skip }, async () => {
  const m = await t.crearMedicamento(); const l = await t.crearLote(m); const p = await t.proveedor();
  const r = await t.call('POST', '/api/compras', { proveedor_id: p.proveedor_id, numero_documento: t.uid('F'), items: [{ lote_id: l.lote_id, cantidad: 30, costo_unitario: 2 }] }, await t.login('almacen'));
  assert.equal(r.status, 201);
  const id = r.data.compra_id;
  assert.equal((await q('SELECT total t FROM dbo.Compra WHERE compra_id=@i', { i: [sql.Int, id] }))[0].t, 60);
  assert.equal((await q('SELECT cantidad c FROM dbo.DetalleCompra WHERE compra_id=@i', { i: [sql.Int, id] }))[0].c, 30);
  assert.equal(await stockSql(l), 30);
  const mv = await q("SELECT tipo, cantidad, usuario_id FROM dbo.MovimientoStock WHERE compra_id=@i", { i: [sql.Int, id] });
  assert.equal(mv.length, 1); assert.equal(mv[0].tipo, 'ENTRADA_COMPRA'); assert.ok(mv[0].usuario_id > 0);
  assert.equal((await q("SELECT COUNT(*) c FROM dbo.AuditoriaOperacion WHERE accion='COMPRA_REGISTRADA' AND entidad='Compra' AND entidad_id=@i", { i: [sql.Int, id] }))[0].c, 1);
});
test('SQL-03 una venta descuenta el stock en la base y registra SALIDA_VENTA', { skip }, async () => {
  const m = await t.crearMedicamento({ precio: 12.5 }); const l = await t.crearLote(m, { stock: 20 }); const c = await t.crearCliente();
  const r = await venta(c, [{ lote_id: l.lote_id, cantidad: 6 }]); assert.equal(r.status, 201);
  const v = (await q('SELECT estado, total FROM dbo.Venta WHERE venta_id=@i', { i: [sql.Int, r.data.venta_id] }))[0];
  assert.equal(v.estado, 'CONFIRMADA'); assert.equal(Number(v.total), 75);
  assert.equal(await stockSql(l), 14);
  const mv = await q("SELECT cantidad FROM dbo.MovimientoStock WHERE venta_id=@i AND tipo='SALIDA_VENTA'", { i: [sql.Int, r.data.venta_id] });
  assert.equal(mv.length, 1); assert.equal(mv[0].cantidad, 6);
});
test('SQL-04 la anulación repone el stock una sola vez y guarda motivo, usuario y reverso', { skip }, async () => {
  const m = await t.crearMedicamento(); const l = await t.crearLote(m, { stock: 10 }); const c = await t.crearCliente();
  const v = (await venta(c, [{ lote_id: l.lote_id, cantidad: 4 }])).data; assert.equal(await stockSql(l), 6);
  const admin = await t.login('admin');
  assert.equal((await t.call('POST', `/api/ventas/${v.venta_id}/anular`, { motivo: 'integración SQL' }, admin)).status, 200);
  assert.equal(await stockSql(l), 10);
  const row = (await q('SELECT estado, motivo_anulacion mo, usuario_anulacion_id u FROM dbo.Venta WHERE venta_id=@i', { i: [sql.Int, v.venta_id] }))[0];
  assert.equal(row.estado, 'ANULADA'); assert.equal(row.mo, 'integración SQL'); assert.ok(row.u > 0);
  const again = await t.call('POST', `/api/ventas/${v.venta_id}/anular`, { motivo: 'otra vez' }, admin);
  assert.ok([409, 422].includes(again.status)); assert.equal(await stockSql(l), 10);
  assert.equal((await q("SELECT COUNT(*) c FROM dbo.MovimientoStock WHERE venta_id=@i AND tipo='REVERSO_VENTA'", { i: [sql.Int, v.venta_id] }))[0].c, 1);
});
test('SQL-05 el índice único filtrado de la base impide duplicar un movimiento', { skip }, async () => {
  const m = await t.crearMedicamento(); const l = await t.crearLote(m, { stock: 5 }); const c = await t.crearCliente();
  const v = (await venta(c, [{ lote_id: l.lote_id, cantidad: 1 }])).data;
  const uid = (await q("SELECT usuario_id u FROM dbo.Usuario WHERE correo='admin@farmacontrol.local'"))[0].u;
  await assert.rejects(q("INSERT dbo.MovimientoStock (lote_id, usuario_id, venta_id, tipo, cantidad) VALUES (@l,@u,@v,'SALIDA_VENTA',1)", { l: [sql.Int, l.lote_id], u: [sql.Int, uid], v: [sql.Int, v.venta_id] }), /UX_Mov_Salida|duplicate|duplic/i);
});
test('SQL-06 la restricción CHECK de la base impide stock negativo', { skip }, async () => {
  const m = await t.crearMedicamento(); const l = await t.crearLote(m, { stock: 2 });
  await assert.rejects(q('UPDATE dbo.Lote SET stock_actual = -1 WHERE lote_id=@i', { i: [sql.Int, l.lote_id] }), /CK_Lote_Stock|CHECK/i);
  assert.equal(await stockSql(l), 2);
});
test('SQL-07 sp_AnularVenta invocado directamente rechaza la segunda anulación sin alterar el stock', { skip }, async () => {
  const m = await t.crearMedicamento(); const l = await t.crearLote(m, { stock: 8 }); const c = await t.crearCliente();
  const v = (await venta(c, [{ lote_id: l.lote_id, cantidad: 3 }])).data;
  const uid = (await q("SELECT usuario_id u FROM dbo.Usuario WHERE correo='admin@farmacontrol.local'"))[0].u;
  const call = () => pool.request().input('VentaId', sql.Int, v.venta_id).input('UsuarioId', sql.Int, uid).input('Motivo', sql.NVarChar(250), 'directo').input('Ip', sql.VarChar(45), null).execute('dbo.sp_AnularVenta');
  await call(); assert.equal(await stockSql(l), 8);
  await assert.rejects(call()); assert.equal(await stockSql(l), 8);
});
test('SQL-08 integridad global: stock = suma de movimientos y sin movimientos duplicados', { skip }, async () => {
  const d = await q(`SELECT COUNT(*) c FROM dbo.Lote l WHERE l.stock_actual <> ISNULL((SELECT SUM(CASE WHEN m.tipo IN ('ENTRADA_COMPRA','REVERSO_VENTA') THEN m.cantidad ELSE -m.cantidad END) FROM dbo.MovimientoStock m WHERE m.lote_id = l.lote_id),0)`);
  assert.equal(d[0].c, 0);
  const dup = await q("SELECT COUNT(*) c FROM (SELECT venta_id, lote_id, tipo FROM dbo.MovimientoStock WHERE venta_id IS NOT NULL GROUP BY venta_id, lote_id, tipo HAVING COUNT(*) > 1) x");
  assert.equal(dup[0].c, 0);
});
test('SQL-09 contraseñas: solo hashes scrypt en la base, nunca texto plano', { skip }, async () => {
  const r = await q('SELECT hash_contrasena h FROM dbo.Usuario');
  assert.ok(r.length >= 4); for (const x of r) assert.match(x.h, /^scrypt\$/i, 'formato de hash scrypt');
});
test('SQL-10 vistas de reporte responden con datos reales', { skip }, async () => {
  for (const v of ['vw_StockMedicamento', 'vw_AlertasLote', 'vw_VentasDiarias', 'vw_Kardex', 'vw_VentaDetalle']) {
    const r = await q(`SELECT TOP 1 * FROM dbo.${v}`); assert.ok(Array.isArray(r), v);
  }
  assert.ok((await q('SELECT COUNT(*) c FROM dbo.vw_Kardex'))[0].c > 0);
});
test('SQL-11 sin conmutación silenciosa: si SQL Server no está disponible, el servidor no arranca', { skip }, async () => {
  const { start } = require('../server'); const { config } = require('../config/config');
  const cfg = { ...config, driver: 'mssql', port: 0, serveFrontend: false, jwtSecret: 'x'.repeat(40), db: { ...config.db, database: 'BaseQueNoExiste_FC' } };
  await assert.rejects(start(cfg), /No se pudo conectar a SQL Server[\s\S]*NO cambia a otro almacenamiento/);
});
