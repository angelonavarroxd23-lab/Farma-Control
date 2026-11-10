'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./helpers');
let t;
before(async () => { t = await boot(); });
after(async () => { await t.close(); });

const movs = async (lote) => (await t.call('GET', `/api/movimientos?lote_id=${lote.lote_id}&limit=1000`, undefined, await t.login('admin'))).data;
const venta = async (cliente, items, extra = {}, rol = 'cajero') => t.call('POST', '/api/ventas', { cliente_id: cliente.cliente_id, tipo_comprobante: 'BOLETA', items, ...extra }, await t.login(rol));
const ventasN = async () => (await t.call('GET', '/api/ventas', undefined, await t.login('admin'))).data.length;

test('COM-01 una compra incrementa el stock, calcula el total y registra ENTRADA_COMPRA con trazabilidad', async () => {
  const m = await t.crearMedicamento(); const l = await t.crearLote(m); const p = await t.proveedor(); const tk = await t.login('almacen');
  const r = await t.call('POST', '/api/compras', { proveedor_id: p.proveedor_id, numero_documento: t.uid('F'), items: [{ lote_id: l.lote_id, cantidad: 40, costo_unitario: 2.5 }] }, tk);
  assert.equal(r.status, 201);
  assert.equal(await t.stockDe(l), 40);
  const det = (await t.call('GET', `/api/compras/${r.data.compra_id}`, undefined, tk)).data;
  assert.equal(det.total, 100); assert.equal(det.detalle[0].subtotal, 100); assert.equal(det.detalle[0].codigo_lote, l.codigo_lote);
  const mv = await movs(l);
  assert.equal(mv.length, 1); assert.equal(mv[0].tipo, 'ENTRADA_COMPRA'); assert.equal(mv[0].compra_id, r.data.compra_id); assert.equal(mv[0].cantidad, 40);
});
test('COM-02 una compra con varios lotes actualiza cada uno', async () => {
  const m = await t.crearMedicamento(); const a = await t.crearLote(m), b = await t.crearLote(m); const p = await t.proveedor(); const tk = await t.login('almacen');
  const r = await t.call('POST', '/api/compras', { proveedor_id: p.proveedor_id, numero_documento: t.uid('F'), items: [{ lote_id: a.lote_id, cantidad: 10, costo_unitario: 1 }, { lote_id: b.lote_id, cantidad: 25, costo_unitario: 2 }] }, tk);
  assert.equal(r.status, 201); assert.equal(await t.stockDe(a), 10); assert.equal(await t.stockDe(b), 25);
});
test('COM-03 documento repetido del mismo proveedor se rechaza sin alterar el stock', async () => {
  const m = await t.crearMedicamento(); const l = await t.crearLote(m); const p = await t.proveedor(); const tk = await t.login('almacen'); const doc = t.uid('F');
  const body = { proveedor_id: p.proveedor_id, numero_documento: doc, items: [{ lote_id: l.lote_id, cantidad: 5, costo_unitario: 1 }] };
  assert.equal((await t.call('POST', '/api/compras', body, tk)).status, 201);
  const dup = await t.call('POST', '/api/compras', body, tk);
  assert.equal(dup.status, 422); assert.equal(await t.stockDe(l), 5); assert.equal((await movs(l)).length, 1);
});
test('COM-04 validaciones: cantidad cero, costo negativo, lotes repetidos o inexistentes, proveedor inactivo', async () => {
  const m = await t.crearMedicamento(); const l = await t.crearLote(m); const p = await t.proveedor(); const tk = await t.login('almacen');
  const mk = (items, extra = {}) => ({ proveedor_id: p.proveedor_id, numero_documento: t.uid('F'), items, ...extra });
  assert.equal((await t.call('POST', '/api/compras', mk([{ lote_id: l.lote_id, cantidad: 0, costo_unitario: 1 }]), tk)).status, 400);
  assert.equal((await t.call('POST', '/api/compras', mk([{ lote_id: l.lote_id, cantidad: 1, costo_unitario: -1 }]), tk)).status, 400);
  assert.equal((await t.call('POST', '/api/compras', mk([{ lote_id: l.lote_id, cantidad: 1, costo_unitario: 1 }, { lote_id: l.lote_id, cantidad: 2, costo_unitario: 1 }]), tk)).status, 400);
  assert.equal((await t.call('POST', '/api/compras', mk([{ lote_id: 99999999, cantidad: 1, costo_unitario: 1 }]), tk)).status, 422);
  assert.equal((await t.call('POST', '/api/compras', mk([]), tk)).status, 400);
  await t.call('PATCH', `/api/proveedores/${p.proveedor_id}`, { activo: false }, tk);
  assert.equal((await t.call('POST', '/api/compras', mk([{ lote_id: l.lote_id, cantidad: 1, costo_unitario: 1 }]), tk)).status, 422);
  assert.equal(await t.stockDe(l), 0);
});
test('COM-05 no se ingresa stock a un lote vencido', async () => {
  const m = await t.crearMedicamento(); const l = await t.crearLote(m); const tk = await t.login('almacen'); const p = await t.proveedor();
  await t.call('PATCH', `/api/lotes/${l.lote_id}`, { fecha_vencimiento: t.addDays(-2) }, tk);
  const r = await t.call('POST', '/api/compras', { proveedor_id: p.proveedor_id, numero_documento: t.uid('F'), items: [{ lote_id: l.lote_id, cantidad: 3, costo_unitario: 1 }] }, tk);
  assert.equal(r.status, 422); assert.match(r.data.error.message, /vencido/);
});
test('VEN-01 una venta descuenta stock, usa el precio del catálogo y numera la boleta', async () => {
  const m = await t.crearMedicamento({ precio: 12.5 }); const l = await t.crearLote(m, { stock: 20 }); const c = await t.crearCliente();
  const r = await venta(c, [{ lote_id: l.lote_id, cantidad: 3 }]);
  assert.equal(r.status, 201); assert.match(r.data.numero_comprobante, /^B001-\d{6}$/);
  assert.equal(await t.stockDe(l), 17);
  const det = (await t.call('GET', `/api/ventas/${r.data.venta_id}`, undefined, await t.login('cajero'))).data;
  assert.equal(det.total, 37.5); assert.equal(det.estado, 'CONFIRMADA'); assert.equal(det.detalle[0].subtotal, 37.5); assert.equal(det.detalle[0].precio_unitario, 12.5);
  const mv = await movs(l);
  assert.equal(mv.filter((x) => x.tipo === 'SALIDA_VENTA').length, 1); assert.equal(mv.find((x) => x.tipo === 'SALIDA_VENTA').venta_id, r.data.venta_id);
});
test('VEN-02 una venta no puede superar las existencias y no deja rastro (atomicidad)', async () => {
  const m = await t.crearMedicamento(); const l = await t.crearLote(m, { stock: 4 }); const c = await t.crearCliente();
  const antes = await ventasN(); const mAntes = (await movs(l)).length;
  const r = await venta(c, [{ lote_id: l.lote_id, cantidad: 5 }]);
  assert.equal(r.status, 422); assert.match(r.data.error.message, /existencias/);
  assert.equal(await t.stockDe(l), 4); assert.equal(await ventasN(), antes); assert.equal((await movs(l)).length, mAntes);
});
test('VEN-03 una venta con dos lotes donde uno falla revierte todo', async () => {
  const m = await t.crearMedicamento(); const ok = await t.crearLote(m, { stock: 10 }), corto = await t.crearLote(m, { stock: 1 }); const c = await t.crearCliente();
  const r = await venta(c, [{ lote_id: ok.lote_id, cantidad: 5 }, { lote_id: corto.lote_id, cantidad: 2 }]);
  assert.equal(r.status, 422); assert.equal(await t.stockDe(ok), 10); assert.equal(await t.stockDe(corto), 1);
});
test('VEN-04 no se venden lotes vencidos', async () => {
  const m = await t.crearMedicamento(); const l = await t.crearLote(m, { stock: 10 }); const c = await t.crearCliente();
  await t.call('PATCH', `/api/lotes/${l.lote_id}`, { fecha_vencimiento: t.addDays(-1) }, await t.login('almacen'));
  const r = await venta(c, [{ lote_id: l.lote_id, cantidad: 1 }]);
  assert.equal(r.status, 422); assert.match(r.data.error.message, /vencidos/); assert.equal(await t.stockDe(l), 10);
});
test('VEN-05 cantidades inválidas, lote repetido y lote inexistente', async () => {
  const m = await t.crearMedicamento(); const l = await t.crearLote(m, { stock: 10 }); const c = await t.crearCliente();
  assert.equal((await venta(c, [{ lote_id: l.lote_id, cantidad: 0 }])).status, 400);
  assert.equal((await venta(c, [{ lote_id: l.lote_id, cantidad: -2 }])).status, 400);
  assert.equal((await venta(c, [{ lote_id: l.lote_id, cantidad: 1.5 }])).status, 400);
  assert.equal((await venta(c, [{ lote_id: l.lote_id, cantidad: 1 }, { lote_id: l.lote_id, cantidad: 1 }])).status, 400);
  assert.equal((await venta(c, [{ lote_id: 99999999, cantidad: 1 }])).status, 422);
  assert.equal((await venta(c, [])).status, 400);
  assert.equal(await t.stockDe(l), 10);
});
test('VEN-06 un medicamento inactivo no puede venderse', async () => {
  const m = await t.crearMedicamento(); const l = await t.crearLote(m, { stock: 5 }); const c = await t.crearCliente();
  await t.call('PATCH', `/api/medicamentos/${m.medicamento_id}`, { activo: false }, await t.login('almacen'));
  assert.equal((await venta(c, [{ lote_id: l.lote_id, cantidad: 1 }])).status, 422);
});
test('VEN-07 medicamentos con receta: exige receta vigente, válida y del mismo cliente', async () => {
  const m = await t.crearMedicamento({ receta: true }); const l = await t.crearLote(m, { stock: 20 });
  const c = await t.crearCliente(), otro = await t.crearCliente(); const q = await t.login('quimico');
  const rec = async (cli, ini, fin) => (await t.call('POST', '/api/recetas', { cliente_id: cli.cliente_id, numero_receta: t.uid('REC'), nombre_prescriptor: 'Dr. Prueba', fecha_emision: t.addDays(ini), fecha_vencimiento: t.addDays(fin) }, q)).data;
  const items = [{ lote_id: l.lote_id, cantidad: 1 }];
  assert.match((await venta(c, items)).data.error.message, /receta/i, 'sin receta');
  const vigente = await rec(c, -2, 10), vencida = await rec(c, -40, -10), deOtro = await rec(otro, -2, 10), futura = await rec(c, 5, 15);
  assert.equal((await venta(c, items, { receta_id: vencida.receta_id })).status, 422, 'vencida');
  assert.equal((await venta(c, items, { receta_id: deOtro.receta_id })).status, 422, 'de otro cliente');
  assert.equal((await venta(c, items, { receta_id: futura.receta_id })).status, 422, 'aún no vigente');
  await t.call('PATCH', `/api/recetas/${vigente.receta_id}`, { estado: 'ANULADA' }, q);
  assert.equal((await venta(c, items, { receta_id: vigente.receta_id })).status, 422, 'anulada');
  await t.call('PATCH', `/api/recetas/${vigente.receta_id}`, { estado: 'VALIDA' }, q);
  assert.equal((await venta(c, items, { receta_id: vigente.receta_id })).status, 201, 'vigente');
  assert.equal(await t.stockDe(l), 19);
});
test('VEN-08 la factura exige un cliente con RUC', async () => {
  const m = await t.crearMedicamento(); const l = await t.crearLote(m, { stock: 5 }); const dni = await t.crearCliente('DNI'), ruc = await t.crearCliente('RUC');
  assert.equal((await venta(dni, [{ lote_id: l.lote_id, cantidad: 1 }], { tipo_comprobante: 'FACTURA' })).status, 422);
  const ok = await venta(ruc, [{ lote_id: l.lote_id, cantidad: 1 }], { tipo_comprobante: 'FACTURA' });
  assert.equal(ok.status, 201); assert.match(ok.data.numero_comprobante, /^F001-\d{6}$/);
});
test('ANU-01 anular repone el stock una sola vez y conserva el historial', async () => {
  const m = await t.crearMedicamento(); const l = await t.crearLote(m, { stock: 10 }); const c = await t.crearCliente();
  const v = (await venta(c, [{ lote_id: l.lote_id, cantidad: 4 }])).data; const admin = await t.login('admin');
  assert.equal(await t.stockDe(l), 6);
  const a = await t.call('POST', `/api/ventas/${v.venta_id}/anular`, { motivo: 'Error de digitación' }, admin);
  assert.equal(a.status, 200); assert.equal(await t.stockDe(l), 10);
  const det = (await t.call('GET', `/api/ventas/${v.venta_id}`, undefined, admin)).data;
  assert.equal(det.estado, 'ANULADA'); assert.equal(det.motivo_anulacion, 'Error de digitación'); assert.ok(det.fecha_anulacion); assert.equal(det.detalle.length, 1);
  const segunda = await t.call('POST', `/api/ventas/${v.venta_id}/anular`, { motivo: 'otra vez' }, admin);
  assert.equal(segunda.status, 422); assert.match(segunda.data.error.message, /anulada/);
  assert.equal(await t.stockDe(l), 10);
  const mv = await movs(l);
  assert.equal(mv.filter((x) => x.tipo === 'REVERSO_VENTA').length, 1); assert.equal(mv.filter((x) => x.tipo === 'SALIDA_VENTA').length, 1);
});
test('ANU-02 la anulación exige motivo y la venta debe existir', async () => {
  const admin = await t.login('admin');
  assert.equal((await t.call('POST', '/api/ventas/1/anular', {}, admin)).status, 400);
  assert.equal((await t.call('POST', '/api/ventas/99999999/anular', { motivo: 'x' }, admin)).status, 422);
});
test('CON-01 dos ventas simultáneas sobre las últimas unidades: solo una prospera y el stock nunca es negativo', async () => {
  const m = await t.crearMedicamento(); const l = await t.crearLote(m, { stock: 5 }); const c1 = await t.crearCliente(), c2 = await t.crearCliente();
  const rs = await Promise.all([venta(c1, [{ lote_id: l.lote_id, cantidad: 5 }]), venta(c2, [{ lote_id: l.lote_id, cantidad: 5 }])]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [201, 422]);
  assert.equal(await t.stockDe(l), 0);
});
test('CON-02 dos anulaciones simultáneas de la misma venta: se repone una sola vez', async () => {
  const m = await t.crearMedicamento(); const l = await t.crearLote(m, { stock: 8 }); const c = await t.crearCliente();
  const v = (await venta(c, [{ lote_id: l.lote_id, cantidad: 3 }])).data; const admin = await t.login('admin');
  const rs = await Promise.all([1, 2, 3].map(() => t.call('POST', `/api/ventas/${v.venta_id}/anular`, { motivo: 'concurrente' }, admin)));
  assert.equal(rs.filter((r) => r.status === 200).length, 1);
  assert.equal(await t.stockDe(l), 8);
  assert.equal((await movs(l)).filter((x) => x.tipo === 'REVERSO_VENTA').length, 1);
});
test('TRZ-01 el stock de cada lote coincide con entradas + reversos − salidas del historial', async () => {
  const m = await t.crearMedicamento(); const l = await t.crearLote(m, { stock: 30 }); const c = await t.crearCliente(); const admin = await t.login('admin');
  const v1 = (await venta(c, [{ lote_id: l.lote_id, cantidad: 7 }])).data; await venta(c, [{ lote_id: l.lote_id, cantidad: 2 }]);
  await t.call('POST', `/api/ventas/${v1.venta_id}/anular`, { motivo: 'prueba' }, admin); await t.comprar(l, 5);
  const saldo = (await movs(l)).reduce((a, x) => a + (x.tipo === 'SALIDA_VENTA' ? -x.cantidad : x.cantidad), 0);
  assert.equal(saldo, await t.stockDe(l)); assert.equal(saldo, 30 - 2 + 5);
});
test('PER-01 los datos son visibles desde una segunda instancia del servidor sobre la misma base (persistencia)', async () => {
  const c = await t.crearCliente();
  const { start } = require('../server');
  const cfg = { ...require('../config/config').config, driver: t.driver, port: 0, serveFrontend: false, corsOrigin: '', jwtSecret: process.env.JWT_SECRET || 'secreto-solo-para-pruebas-0123456789abcdef', tokenTtlMinutes: 5 };
  if (t.driver === 'memory') { // en memoria se comparte el almacén; con SQL Server se abre una conexión nueva
    const { createApp } = require('../app'); const http = require('node:http');
    const srv2 = http.createServer(createApp(t.srv.store, cfg)); await new Promise((r) => srv2.listen(0, r));
    const tk = await (await fetch(`http://127.0.0.1:${srv2.address().port}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo: t.USERS.cajero[0], contrasena: t.USERS.cajero[1] }) })).json();
    const lista = await (await fetch(`http://127.0.0.1:${srv2.address().port}/api/clientes?q=${c.numero_documento}`, { headers: { Authorization: `Bearer ${tk.token}` } })).json();
    srv2.close(); assert.equal(lista.length, 1);
  } else {
    const s2 = await start(cfg);
    const tk = await (await fetch(`http://127.0.0.1:${s2.port}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo: t.USERS.cajero[0], contrasena: t.USERS.cajero[1] }) })).json();
    const lista = await (await fetch(`http://127.0.0.1:${s2.port}/api/clientes?q=${c.numero_documento}`, { headers: { Authorization: `Bearer ${tk.token}` } })).json();
    await s2.close(); assert.equal(lista.length, 1);
  }
});
