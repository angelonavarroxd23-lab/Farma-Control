'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./helpers');
let t;
before(async () => { t = await boot(); });
after(async () => { await t.close(); });

test('CLI-01 registrar cliente con DNI válido y recuperarlo por búsqueda', async () => {
  const tk = await t.login('cajero'); const dni = t.digits(8);
  const r = await t.call('POST', '/api/clientes', { tipo_documento: 'DNI', numero_documento: dni, nombre_razon_social: 'Cliente Prueba', telefono: '999000111' }, tk);
  assert.equal(r.status, 201);
  const q = await t.call('GET', `/api/clientes?q=${dni}`, undefined, tk);
  assert.equal(q.data.length, 1);
  assert.equal(q.data[0].nombre_razon_social, 'Cliente Prueba');
});
test('CLI-02 rechaza DNI de 7 dígitos, RUC de 10 y documentos con letras', async () => {
  const tk = await t.login('cajero');
  for (const [tipo, num] of [['DNI', t.digits(7)], ['RUC', t.digits(10)], ['DNI', '1234567A']])
    assert.equal((await t.call('POST', '/api/clientes', { tipo_documento: tipo, numero_documento: num, nombre_razon_social: 'X' }, tk)).status, 400, `${tipo} ${num}`);
});
test('CLI-03 rechaza documento duplicado (409) y permite el mismo número con otro tipo', async () => {
  const tk = await t.login('cajero'); const c = await t.crearCliente();
  assert.equal((await t.call('POST', '/api/clientes', { tipo_documento: 'DNI', numero_documento: c.numero_documento, nombre_razon_social: 'Dup' }, tk)).status, 409);
  assert.equal((await t.call('POST', '/api/clientes', { tipo_documento: 'CE', numero_documento: c.numero_documento, nombre_razon_social: 'Otro tipo' }, tk)).status, 201);
});
test('CLI-04 modificar cliente conserva la validación', async () => {
  const tk = await t.login('cajero'); const c = await t.crearCliente();
  const ok = await t.call('PATCH', `/api/clientes/${c.cliente_id}`, { telefono: '987654321' }, tk);
  assert.equal(ok.status, 200); assert.equal(ok.data.telefono, '987654321');
  assert.equal((await t.call('PATCH', `/api/clientes/${c.cliente_id}`, { numero_documento: '12' }, tk)).status, 400);
  assert.equal((await t.call('PATCH', '/api/clientes/999999', { telefono: '1' }, tk)).status, 404);
});
test('CLI-05 las entradas con comillas e instrucciones SQL se tratan como texto (sin inyección)', async () => {
  const tk = await t.login('cajero'); const nombre = "Robert'); DROP TABLE Cliente;--";
  const r = await t.call('POST', '/api/clientes', { tipo_documento: 'DNI', numero_documento: t.digits(8), nombre_razon_social: nombre }, tk);
  assert.equal(r.status, 201); assert.equal(r.data.nombre_razon_social, nombre);
  const q = await t.call('GET', `/api/clientes?q=${encodeURIComponent("' OR 1=1 --")}`, undefined, tk);
  assert.equal(q.status, 200); assert.equal(q.data.length, 0);
  assert.equal((await t.call('GET', '/api/clientes', undefined, tk)).status, 200);
});
test('MED-01 crear categoría y medicamento; SKU único; precio no negativo', async () => {
  const tk = await t.login('almacen');
  const cat = await t.call('POST', '/api/categorias', { nombre: t.uid('Cat') }, tk);
  assert.equal(cat.status, 201);
  assert.equal((await t.call('POST', '/api/categorias', { nombre: cat.data.nombre }, tk)).status, 409);
  const base = { categoria_id: cat.data.categoria_id, nombre: 'Med X', presentacion: 'Caja x 10', precio_venta: 5 };
  const sku = t.uid('SKU');
  assert.equal((await t.call('POST', '/api/medicamentos', { ...base, sku }, tk)).status, 201);
  assert.equal((await t.call('POST', '/api/medicamentos', { ...base, sku }, tk)).status, 409);
  assert.equal((await t.call('POST', '/api/medicamentos', { ...base, sku: t.uid('SKU'), precio_venta: -1 }, tk)).status, 400);
  assert.equal((await t.call('POST', '/api/medicamentos', { ...base, sku: t.uid('SKU'), categoria_id: 999999 }, tk)).status, 409);
});
test('MED-02 modificar medicamento, consultar por nombre/SKU/categoría y detalle con lotes', async () => {
  const tk = await t.login('almacen'); const m = await t.crearMedicamento({ precio: 7.5 }); const l = await t.crearLote(m);
  const up = await t.call('PATCH', `/api/medicamentos/${m.medicamento_id}`, { precio_venta: 8.25 }, tk);
  assert.equal(up.data.precio_venta, 8.25);
  const bySku = await t.call('GET', `/api/medicamentos?q=${m.sku}`, undefined, tk);
  assert.equal(bySku.data.length, 1);
  const det = await t.call('GET', `/api/medicamentos/${m.medicamento_id}`, undefined, tk);
  assert.equal(det.data.lotes.length, 1); assert.equal(det.data.lotes[0].codigo_lote, l.codigo_lote);
  assert.equal((await t.call('GET', `/api/medicamentos?categoria_id=${m.categoria_id}`, undefined, tk)).data.some((x) => x.medicamento_id === m.medicamento_id), true);
});
test('MED-03 una categoría con medicamentos no puede eliminarse (integridad referencial)', async () => {
  const tk = await t.login('almacen'); const m = await t.crearMedicamento();
  assert.equal((await t.call('DELETE', `/api/categorias/${m.categoria_id}`, undefined, tk)).status, 409);
});
test('LOT-01 un lote nuevo inicia en cero y no acepta fijar stock ni fechas vencidas', async () => {
  const tk = await t.login('almacen'); const m = await t.crearMedicamento();
  const r = await t.call('POST', '/api/lotes', { medicamento_id: m.medicamento_id, codigo_lote: t.uid('L'), fecha_vencimiento: t.addDays(100), stock_minimo: 3, stock_actual: 999 }, tk);
  assert.equal(r.status, 201); assert.equal(r.data.stock_actual, 0);
  assert.equal((await t.call('POST', '/api/lotes', { medicamento_id: m.medicamento_id, codigo_lote: t.uid('L'), fecha_vencimiento: t.addDays(-1) }, tk)).status, 400);
});
test('LOT-02 código de lote duplicado para el mismo medicamento → 409; stock no editable por PATCH', async () => {
  const tk = await t.login('almacen'); const m = await t.crearMedicamento(); const l = await t.crearLote(m);
  assert.equal((await t.call('POST', '/api/lotes', { medicamento_id: m.medicamento_id, codigo_lote: l.codigo_lote, fecha_vencimiento: t.addDays(50) }, tk)).status, 409);
  await t.call('PATCH', `/api/lotes/${l.lote_id}`, { stock_actual: 500, stock_minimo: 9 }, tk);
  assert.equal(await t.stockDe(l), 0);
});
test('REC-01 registrar receta; fechas coherentes; número único; solo químico/administrador', async () => {
  const q = await t.login('quimico'), c = await t.login('cajero'); const cli = await t.crearCliente();
  const body = { cliente_id: cli.cliente_id, numero_receta: t.uid('REC'), nombre_prescriptor: 'Dr. Prueba', fecha_emision: t.addDays(-1), fecha_vencimiento: t.addDays(20) };
  assert.equal((await t.call('POST', '/api/recetas', body, c)).status, 403);
  assert.equal((await t.call('POST', '/api/recetas', body, q)).status, 201);
  assert.equal((await t.call('POST', '/api/recetas', body, q)).status, 409);
  assert.equal((await t.call('POST', '/api/recetas', { ...body, numero_receta: t.uid('REC'), fecha_vencimiento: t.addDays(-5) }, q)).status, 400);
  const list = await t.call('GET', `/api/recetas?cliente_id=${cli.cliente_id}`, undefined, c);
  assert.equal(list.data.length, 1); assert.equal(list.data[0].vigente, true);
});
