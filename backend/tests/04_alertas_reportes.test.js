'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./helpers');
let t;
before(async () => { t = await boot(); });
after(async () => { await t.close(); });

const alertaDe = async (l) => ((await t.call('GET', '/api/alertas', undefined, await t.login('quimico'))).data.alertas.find((a) => a.lote_id === l.lote_id) || {}).alerta || null;

test('ALE-01 las alertas reflejan el estado real: agotado, stock bajo, por vencer y vencido', async () => {
  const m = await t.crearMedicamento();
  const agotado = await t.crearLote(m, { dias: 200, minimo: 5 });
  const bajo = await t.crearLote(m, { dias: 200, minimo: 10, stock: 8 });
  const porVencer = await t.crearLote(m, { dias: 10, minimo: 1, stock: 20 });
  const normal = await t.crearLote(m, { dias: 200, minimo: 5, stock: 50 });
  const vencido = await t.crearLote(m, { dias: 200, minimo: 5, stock: 12 });
  await t.call('PATCH', `/api/lotes/${vencido.lote_id}`, { fecha_vencimiento: t.addDays(-3) }, await t.login('almacen'));
  assert.equal(await alertaDe(agotado), 'AGOTADO'); assert.equal(await alertaDe(bajo), 'STOCK_BAJO');
  assert.equal(await alertaDe(porVencer), 'POR_VENCER'); assert.equal(await alertaDe(vencido), 'VENCIDO');
  assert.equal(await alertaDe(normal), null);
});
test('ALE-02 una venta que agota o baja el stock actualiza la alerta; una compra la retira', async () => {
  const m = await t.crearMedicamento(); const l = await t.crearLote(m, { dias: 200, minimo: 10, stock: 30 }); const c = await t.crearCliente();
  assert.equal(await alertaDe(l), null);
  await t.call('POST', '/api/ventas', { cliente_id: c.cliente_id, tipo_comprobante: 'BOLETA', items: [{ lote_id: l.lote_id, cantidad: 22 }] }, await t.login('cajero'));
  assert.equal(await alertaDe(l), 'STOCK_BAJO');
  await t.call('POST', '/api/ventas', { cliente_id: c.cliente_id, tipo_comprobante: 'BOLETA', items: [{ lote_id: l.lote_id, cantidad: 8 }] }, await t.login('cajero'));
  assert.equal(await alertaDe(l), 'AGOTADO');
  await t.comprar(l, 40); assert.equal(await alertaDe(l), null);
});
test('ALE-03 el conteo de alertas coincide con la lista', async () => {
  const r = (await t.call('GET', '/api/alertas', undefined, await t.login('cajero'))).data;
  const suma = Object.values(r.conteo).reduce((a, b) => a + b, 0);
  assert.equal(suma, r.alertas.length);
});
test('REP-01 el reporte excluye ventas anuladas y calcula ticket promedio y unidades', async () => {
  const admin = await t.login('admin'); const hoy = t.addDays(0);
  const m = await t.crearMedicamento({ precio: 10 }); const l = await t.crearLote(m, { stock: 50 }); const c = await t.crearCliente();
  const antes = (await t.call('GET', `/api/reportes/resumen?desde=${hoy}&hasta=${hoy}`, undefined, admin)).data.resumen;
  const v1 = (await t.call('POST', '/api/ventas', { cliente_id: c.cliente_id, tipo_comprobante: 'BOLETA', items: [{ lote_id: l.lote_id, cantidad: 3 }] }, await t.login('cajero'))).data;
  const v2 = (await t.call('POST', '/api/ventas', { cliente_id: c.cliente_id, tipo_comprobante: 'BOLETA', items: [{ lote_id: l.lote_id, cantidad: 2 }] }, await t.login('cajero'))).data;
  await t.call('POST', `/api/ventas/${v2.venta_id}/anular`, { motivo: 'prueba' }, admin);
  const des = (await t.call('GET', `/api/reportes/resumen?desde=${hoy}&hasta=${hoy}`, undefined, admin)).data.resumen;
  assert.equal(des.ventas_confirmadas - antes.ventas_confirmadas, 1);
  assert.equal(Math.round((des.importe_total - antes.importe_total) * 100) / 100, 30);
  assert.equal(des.unidades_vendidas - antes.unidades_vendidas, 3);
  assert.equal(des.ventas_anuladas - antes.ventas_anuladas, 1);
});
test('REP-02 un periodo invertido o mal formado se rechaza', async () => {
  const admin = await t.login('admin');
  assert.equal((await t.call('GET', '/api/reportes/resumen?desde=2026-12-31&hasta=2026-01-01', undefined, admin)).status, 400);
  assert.equal((await t.call('GET', '/api/reportes/resumen?desde=ayer', undefined, admin)).status, 400);
});
test('REP-03 exportación CSV: tipo de contenido, BOM y neutralización de fórmulas', async () => {
  const cajero = await t.login('cajero'); const admin = await t.login('admin');
  const m = await t.crearMedicamento(); const l = await t.crearLote(m, { stock: 5 });
  const peligroso = await t.call('POST', '/api/clientes', { tipo_documento: 'DNI', numero_documento: t.digits(8), nombre_razon_social: '=HYPERLINK("http://x")' }, cajero);
  await t.call('POST', '/api/ventas', { cliente_id: peligroso.data.cliente_id, tipo_comprobante: 'BOLETA', items: [{ lote_id: l.lote_id, cantidad: 1 }] }, cajero);
  const r = await fetch(`${t.base}/api/reportes/ventas.csv`, { headers: { Authorization: `Bearer ${admin}` } });
  assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/csv/);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.deepEqual([...buf.subarray(0, 3)], [0xEF, 0xBB, 0xBF], 'BOM UTF-8 para que Excel muestre las tildes');
  const csv = buf.toString('utf8').slice(1);
  assert.ok(csv.startsWith('comprobante,fecha,cliente,tipo,estado,total'));
  assert.ok(csv.includes(`"'=HYPERLINK(""http://x"")"`), 'la celda con fórmula debe ir precedida de apóstrofo');
  for (const f of ['inventario', 'movimientos']) assert.equal((await fetch(`${t.base}/api/reportes/${f}.csv`, { headers: { Authorization: `Bearer ${admin}` } })).status, 200);
  assert.equal((await fetch(`${t.base}/api/reportes/ventas.csv`, { headers: { Authorization: `Bearer ${cajero}` } })).status, 403);
});
test('AUD-01 la auditoría registra accesos y operaciones y solo la consulta el administrador', async () => {
  const admin = await t.login('admin'); const c = await t.crearCliente();
  const m = await t.crearMedicamento(); const l = await t.crearLote(m, { stock: 5 });
  const v = (await t.call('POST', '/api/ventas', { cliente_id: c.cliente_id, tipo_comprobante: 'BOLETA', items: [{ lote_id: l.lote_id, cantidad: 1 }] }, await t.login('cajero'))).data;
  await t.call('POST', `/api/ventas/${v.venta_id}/anular`, { motivo: 'auditoría' }, admin);
  await t.call('POST', '/api/auth/login', { correo: 'cajero@farmacontrol.local', contrasena: 'mala-' + Date.now() });
  const aud = (await t.call('GET', '/api/auditoria?limit=1000', undefined, admin)).data;
  const acc = new Set(aud.map((a) => a.accion));
  for (const a of ['LOGIN_OK', 'LOGIN_FALLIDO', 'VENTA_REGISTRADA', 'VENTA_ANULADA', 'COMPRA_REGISTRADA', 'CLIENTE_CREADO']) assert.ok(acc.has(a), `falta ${a}`);
  const reg = aud.find((a) => a.accion === 'VENTA_REGISTRADA' && a.entidad_id === v.venta_id);
  assert.equal(reg.usuario, 'Carlos Cajero');
  assert.equal((await t.call('GET', '/api/auditoria', undefined, await t.login('cajero'))).status, 403);
});
test('PAN-01 el panel de resumen incluye alertas y, según el perfil, las ventas del día', async () => {
  const a = (await t.call('GET', '/api/resumen', undefined, await t.login('admin'))).data;
  assert.ok(a.ventas_hoy && typeof a.ventas_hoy.importe === 'number'); assert.ok(a.alertas);
  const w = (await t.call('GET', '/api/resumen', undefined, await t.login('almacen'))).data;
  assert.equal(w.ventas_hoy, undefined);
});
