'use strict';
// Versión 2.1: receta con detalle registrada en caja, lote y proveedor creados desde la compra,
// FEFO en la venta y órdenes de reposición a proveedores. Se ejecuta con ambos controladores de datos.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./helpers');
let t;
before(async () => { t = await boot(); });
after(async () => { await t.close(); });

const venta = async (cliente, items, extra = {}, rol = 'cajero') => t.call('POST', '/api/ventas', { cliente_id: cliente.cliente_id, tipo_comprobante: 'BOLETA', items, ...extra }, await t.login(rol));
const receta = async (cli, items, rol = 'cajero', extra = {}) => t.call('POST', '/api/recetas', { cliente_id: cli.cliente_id, numero_receta: t.uid('REC'), nombre_prescriptor: 'Dr. Prueba', fecha_emision: t.addDays(-1), fecha_vencimiento: t.addDays(20), items, ...extra }, await t.login(rol));
const detalle = async (id) => (await t.call('GET', `/api/recetas/${id}`, undefined, await t.login('quimico'))).data;
const lotesDe = async (m) => (await t.call('GET', `/api/lotes?medicamento_id=${m.medicamento_id}`, undefined, await t.login('admin'))).data;

// ---------- Receta con detalle (registrada desde caja) ----------
test('REC-02 la receta se registra con su detalle y muestra saldo pendiente por medicamento', async () => {
  const m = await t.crearMedicamento({ receta: true }); const cli = await t.crearCliente();
  const r = await receta(cli, [{ medicamento_id: m.medicamento_id, cantidad: 3, indicaciones: '1 cada 8 horas' }]);
  assert.equal(r.status, 201); assert.equal(r.data.detalle.length, 1);
  const d = await detalle(r.data.receta_id);
  assert.equal(d.detalle[0].cantidad, 3); assert.equal(d.detalle[0].dispensado, 0); assert.equal(d.detalle[0].pendiente, 3);
  assert.equal(d.detalle[0].indicaciones, '1 cada 8 horas'); assert.equal(d.vigente, true);
});
test('REC-03 detalle inválido: cantidad no positiva, medicamento inexistente o repetido → 400 y no se guarda la receta', async () => {
  const m = await t.crearMedicamento({ receta: true }); const cli = await t.crearCliente(); const num = t.uid('REC');
  for (const items of [[{ medicamento_id: m.medicamento_id, cantidad: 0 }], [{ medicamento_id: 999999, cantidad: 1 }], [{ medicamento_id: m.medicamento_id, cantidad: 1 }, { medicamento_id: m.medicamento_id, cantidad: 2 }], 'x'])
    assert.equal((await receta(cli, items, 'cajero', { numero_receta: num })).status, 400);
  assert.equal((await receta(cli, [{ medicamento_id: m.medicamento_id, cantidad: 1 }], 'cajero', { numero_receta: num })).status, 201); // el número no quedó consumido
});
test('REC-04 una receta sin detalle (registro antiguo) sigue aceptándose', async () => {
  const cli = await t.crearCliente(); const r = await receta(cli, undefined);
  assert.equal(r.status, 201); assert.deepEqual(r.data.detalle, []);
});

// ---------- Venta contra el detalle de la receta ----------
test('VEN-09 la venta respeta el detalle: medicamento no prescrito y exceso de saldo se rechazan sin tocar el stock', async () => {
  const med = await t.crearMedicamento({ receta: true }), otro = await t.crearMedicamento({ receta: true });
  const l = await t.crearLote(med, { stock: 20 }), lo = await t.crearLote(otro, { stock: 20 });
  const cli = await t.crearCliente(); const rec = await receta(cli, [{ medicamento_id: med.medicamento_id, cantidad: 3 }]);
  const id = rec.data.receta_id;
  const noPrescrito = await venta(cli, [{ lote_id: lo.lote_id, cantidad: 1 }], { receta_id: id });
  assert.equal(noPrescrito.status, 422); assert.match(noPrescrito.data.error?.message || noPrescrito.data.message || JSON.stringify(noPrescrito.data), /no prescribe/i);
  assert.equal((await venta(cli, [{ lote_id: l.lote_id, cantidad: 4 }], { receta_id: id })).status, 422); // 4 > 3
  assert.equal(await t.stockDe(l), 20); assert.equal(await t.stockDe(lo), 20);
  assert.equal((await venta(cli, [{ lote_id: l.lote_id, cantidad: 2 }], { receta_id: id })).status, 201);
  assert.equal((await detalle(id)).detalle[0].pendiente, 1);
  assert.equal((await venta(cli, [{ lote_id: l.lote_id, cantidad: 2 }], { receta_id: id })).status, 422); // saldo 1
  assert.equal((await venta(cli, [{ lote_id: l.lote_id, cantidad: 1 }], { receta_id: id })).status, 201);
  assert.equal((await detalle(id)).detalle[0].pendiente, 0);
  assert.equal(await t.stockDe(l), 17);
});
test('VEN-10 anular la venta devuelve el saldo a la receta; los productos sin receta no consumen saldo', async () => {
  const med = await t.crearMedicamento({ receta: true }), libre = await t.crearMedicamento();
  const l = await t.crearLote(med, { stock: 10 }), ll = await t.crearLote(libre, { stock: 10 });
  const cli = await t.crearCliente(); const id = (await receta(cli, [{ medicamento_id: med.medicamento_id, cantidad: 2 }])).data.receta_id;
  const v = await venta(cli, [{ lote_id: l.lote_id, cantidad: 2 }, { lote_id: ll.lote_id, cantidad: 5 }], { receta_id: id });
  assert.equal(v.status, 201); assert.equal((await detalle(id)).detalle[0].pendiente, 0);
  assert.equal((await t.call('POST', `/api/ventas/${v.data.venta_id}/anular`, { motivo: 'prueba' }, await t.login('admin'))).status, 200);
  assert.equal((await detalle(id)).detalle[0].pendiente, 2);
});
test('VEN-11 con receta de detalle, la receta de otro cliente o sin receta se sigue rechazando', async () => {
  const med = await t.crearMedicamento({ receta: true }); const l = await t.crearLote(med, { stock: 5 });
  const a = await t.crearCliente(), b = await t.crearCliente(); const id = (await receta(a, [{ medicamento_id: med.medicamento_id, cantidad: 2 }])).data.receta_id;
  assert.equal((await venta(b, [{ lote_id: l.lote_id, cantidad: 1 }], { receta_id: id })).status, 422);
  assert.equal((await venta(a, [{ lote_id: l.lote_id, cantidad: 1 }])).status, 422);
  assert.equal(await t.stockDe(l), 5);
});
test('VEN-12 una receta sin detalle conserva la regla anterior (basta que esté vigente y sea del cliente)', async () => {
  const med = await t.crearMedicamento({ receta: true }); const l = await t.crearLote(med, { stock: 5 });
  const cli = await t.crearCliente(); const id = (await receta(cli, undefined)).data.receta_id;
  assert.equal((await venta(cli, [{ lote_id: l.lote_id, cantidad: 3 }], { receta_id: id })).status, 201);
});

// ---------- FEFO ----------
test('FEF-01 los lotes vendibles salen ordenados por vencimiento y se sugiere el que vence primero', async () => {
  const m = await t.crearMedicamento(); const tarde = await t.crearLote(m, { dias: 300, stock: 5 }); const pronto = await t.crearLote(m, { dias: 90, stock: 5 }); const medio = await t.crearLote(m, { dias: 150, stock: 5 });
  const r = (await t.call('GET', `/api/lotes?disponibles=true&medicamento_id=${m.medicamento_id}`, undefined, await t.login('cajero'))).data;
  assert.deepEqual(r.map((x) => x.lote_id), [pronto.lote_id, medio.lote_id, tarde.lote_id]);
  assert.deepEqual(r.map((x) => x.fefo_sugerido), [true, false, false]);
});

// ---------- Lote y proveedor desde la compra ----------
test('COM-09 la compra crea el lote nuevo, le ingresa las unidades y registra su proveedor', async () => {
  const m = await t.crearMedicamento(); const p = await t.proveedor(); const tk = await t.login('almacen'); const codigo = t.uid('NL');
  const r = await t.call('POST', '/api/compras', { proveedor_id: p.proveedor_id, numero_documento: t.uid('F'), items: [{ nuevo_lote: { medicamento_id: m.medicamento_id, codigo_lote: codigo, fecha_vencimiento: t.addDays(200), stock_minimo: 7 }, cantidad: 25, costo_unitario: 2 }] }, tk);
  assert.equal(r.status, 201); assert.equal(r.data.lotes_creados.length, 1); assert.deepEqual(r.data.advertencias, []);
  const l = (await lotesDe(m)).find((x) => x.codigo_lote === codigo);
  assert.equal(l.stock_actual, 25); assert.equal(l.stock_minimo, 7); assert.equal(l.proveedor_id, p.proveedor_id); assert.equal(l.proveedor, p.razon_social);
  const med = (await t.call('GET', `/api/medicamentos/${m.medicamento_id}`, undefined, tk)).data; assert.equal(med.proveedor_id, p.proveedor_id); // proveedor habitual si no tenía
  const aud = (await t.call('GET', '/api/auditoria?limit=200', undefined, await t.login('admin'))).data;
  assert.ok((aud.rows || aud).some((a) => a.accion === 'LOTE_CREADO' && String(a.detalle).includes(codigo)));
});
test('COM-10 una compra puede mezclar lotes existentes y nuevos; el proveedor del lote existente se actualiza', async () => {
  const m = await t.crearMedicamento(); const viejo = await t.crearLote(m, { stock: 3 }); const p = await t.proveedor(); const tk = await t.login('almacen');
  const r = await t.call('POST', '/api/compras', { proveedor_id: p.proveedor_id, numero_documento: t.uid('F'), items: [{ lote_id: viejo.lote_id, cantidad: 10, costo_unitario: 1 }, { nuevo_lote: { medicamento_id: m.medicamento_id, codigo_lote: t.uid('NL'), fecha_vencimiento: t.addDays(100) }, cantidad: 4, costo_unitario: 1.5 }] }, tk);
  assert.equal(r.status, 201);
  const ls = await lotesDe(m); assert.equal(ls.length, 2);
  assert.equal(ls.find((x) => x.lote_id === viejo.lote_id).stock_actual, 13); assert.ok(ls.every((x) => x.proveedor_id === p.proveedor_id));
});
test('COM-06 lote nuevo inválido (vencido, repetido, medicamento inexistente) → rechazo y sin lotes huérfanos', async () => {
  const m = await t.crearMedicamento(); const existente = await t.crearLote(m); const p = await t.proveedor(); const tk = await t.login('almacen');
  const compra = (nl, extra = {}) => t.call('POST', '/api/compras', { proveedor_id: p.proveedor_id, numero_documento: t.uid('F'), items: [{ nuevo_lote: nl, cantidad: 1, costo_unitario: 1 }], ...extra }, tk);
  assert.equal((await compra({ medicamento_id: m.medicamento_id, codigo_lote: t.uid('NL'), fecha_vencimiento: t.addDays(-1) })).status, 400);
  assert.equal((await compra({ medicamento_id: 999999, codigo_lote: t.uid('NL'), fecha_vencimiento: t.addDays(30) })).status, 400);
  assert.equal((await compra({ medicamento_id: m.medicamento_id, codigo_lote: existente.codigo_lote, fecha_vencimiento: t.addDays(30) })).status, 409);
  assert.equal((await lotesDe(m)).length, 1);
});
test('COM-07 si la compra falla (documento repetido) el lote nuevo creado en la operación se elimina', async () => {
  const m = await t.crearMedicamento(); const l = await t.crearLote(m); const p = await t.proveedor(); const tk = await t.login('almacen'); const doc = t.uid('F');
  assert.equal((await t.call('POST', '/api/compras', { proveedor_id: p.proveedor_id, numero_documento: doc, items: [{ lote_id: l.lote_id, cantidad: 1, costo_unitario: 1 }] }, tk)).status, 201);
  const r = await t.call('POST', '/api/compras', { proveedor_id: p.proveedor_id, numero_documento: doc, items: [{ nuevo_lote: { medicamento_id: m.medicamento_id, codigo_lote: t.uid('NL'), fecha_vencimiento: t.addDays(60) }, cantidad: 5, costo_unitario: 1 }] }, tk);
  assert.equal(r.status, 422); assert.equal((await lotesDe(m)).length, 1);
});
test('COM-08 el proveedor se puede crear y asignar como habitual del medicamento', async () => {
  const m = await t.crearMedicamento(); const p = await t.proveedor(); const tk = await t.login('almacen');
  const r = await t.call('PATCH', `/api/medicamentos/${m.medicamento_id}`, { proveedor_id: p.proveedor_id }, tk);
  assert.equal(r.status, 200); assert.equal(r.data.proveedor_id, p.proveedor_id);
  assert.equal((await t.call('PATCH', `/api/medicamentos/${m.medicamento_id}`, { proveedor_id: 999999 }, tk)).status, 409);
});

// ---------- Reposición ----------
test('ORD-01 sugerencias: aparecen los medicamentos agotados o bajo mínimo y no los abastecidos; proveedor habitual', async () => {
  const bajo = await t.crearMedicamento(); const lleno = await t.crearMedicamento(); const p = await t.proveedor(); const tk = await t.login('almacen');
  await t.crearLote(bajo, { stock: 3, minimo: 5 }); await t.crearLote(lleno, { stock: 100, minimo: 5 });
  await t.call('PATCH', `/api/medicamentos/${bajo.medicamento_id}`, { proveedor_id: p.proveedor_id }, tk);
  const s = (await t.call('GET', '/api/reposicion/sugerencias', undefined, tk)).data;
  const x = s.find((e) => e.medicamento_id === bajo.medicamento_id);
  assert.ok(x); assert.equal(x.proveedor_id, p.proveedor_id); assert.equal(x.motivo, 'STOCK_BAJO'); assert.equal(x.cantidad_sugerida, 7); // max(5*2-3, 5)
  assert.ok(!s.some((e) => e.medicamento_id === lleno.medicamento_id));
});
test('ORD-02 crear, listar y consultar una orden; validaciones y permisos', async () => {
  const m = await t.crearMedicamento(); const p = await t.proveedor(); const tk = await t.login('almacen');
  const body = { proveedor_id: p.proveedor_id, observacion: 'Urgente', items: [{ medicamento_id: m.medicamento_id, cantidad: 12 }] };
  assert.equal((await t.call('POST', '/api/ordenes', body, await t.login('cajero'))).status, 403);
  for (const bad of [{ ...body, items: [] }, { ...body, proveedor_id: 999999 }, { ...body, items: [{ medicamento_id: m.medicamento_id, cantidad: 0 }] }, { ...body, items: [{ medicamento_id: m.medicamento_id, cantidad: 1 }, { medicamento_id: m.medicamento_id, cantidad: 2 }] }])
    assert.ok([400].includes((await t.call('POST', '/api/ordenes', bad, tk)).status));
  const r = await t.call('POST', '/api/ordenes', body, tk);
  assert.equal(r.status, 201); assert.equal(r.data.estado, 'PENDIENTE'); assert.equal(r.data.detalle[0].cantidad_solicitada, 12); assert.equal(r.data.proveedor, p.razon_social);
  const lista = (await t.call('GET', '/api/ordenes?estado=PENDIENTE', undefined, tk)).data.find((o) => o.orden_id === r.data.orden_id);
  assert.equal(lista.items, 1); assert.equal(lista.unidades, 12);
  const s = (await t.call('GET', '/api/reposicion/sugerencias', undefined, tk)).data.find((e) => e.medicamento_id === m.medicamento_id);
  assert.equal(s.orden_pendiente.orden_id, r.data.orden_id); // ya solicitado
});
test('ORD-03 al registrar la compra asociada la orden pasa a RECIBIDA con su compra; no se reutiliza ni se anula', async () => {
  const m = await t.crearMedicamento(); const l = await t.crearLote(m); const p = await t.proveedor(); const tk = await t.login('almacen');
  const o = (await t.call('POST', '/api/ordenes', { proveedor_id: p.proveedor_id, items: [{ medicamento_id: m.medicamento_id, cantidad: 8 }] }, tk)).data;
  const compra = (extra) => t.call('POST', '/api/compras', { proveedor_id: p.proveedor_id, numero_documento: t.uid('F'), orden_id: o.orden_id, items: [{ lote_id: l.lote_id, cantidad: 8, costo_unitario: 1 }], ...extra }, tk);
  const otro = await t.proveedor();
  assert.equal((await compra({ proveedor_id: otro.proveedor_id })).status, 422); // orden de otro proveedor
  assert.equal(await t.stockDe(l), 0);
  const r = await compra(); assert.equal(r.status, 201); assert.equal(r.data.orden_id, o.orden_id);
  const det = (await t.call('GET', `/api/ordenes/${o.orden_id}`, undefined, tk)).data;
  assert.equal(det.estado, 'RECIBIDA'); assert.equal(det.compra_id, r.data.compra_id);
  assert.equal((await compra()).status, 422); // ya no está pendiente
  assert.equal((await t.call('POST', `/api/ordenes/${o.orden_id}/anular`, {}, tk)).status, 422);
  assert.equal(await t.stockDe(l), 8);
});
test('ORD-04 anular una orden pendiente; una orden anulada no se puede recibir', async () => {
  const m = await t.crearMedicamento(); const l = await t.crearLote(m); const p = await t.proveedor(); const tk = await t.login('almacen');
  const o = (await t.call('POST', '/api/ordenes', { proveedor_id: p.proveedor_id, items: [{ medicamento_id: m.medicamento_id, cantidad: 2 }] }, tk)).data;
  assert.equal((await t.call('POST', `/api/ordenes/${o.orden_id}/anular`, {}, tk)).status, 200);
  assert.equal((await t.call('POST', '/api/compras', { proveedor_id: p.proveedor_id, numero_documento: t.uid('F'), orden_id: o.orden_id, items: [{ lote_id: l.lote_id, cantidad: 2, costo_unitario: 1 }] }, tk)).status, 422);
  assert.equal((await t.call('GET', `/api/ordenes/${o.orden_id}`, undefined, tk)).data.estado, 'ANULADA');
});
