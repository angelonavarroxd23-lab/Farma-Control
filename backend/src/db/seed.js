'use strict';
// Datos de demostración del controlador en memoria: equivalentes a la sección 08 del script SQL
// (mismas credenciales de PRUEBA, medicamentos, lotes, recetas y operaciones de ejemplo).
const { hashPassword } = require('../auth/password');
const { todayStr, addDays } = require('../services/inventario');

const DEMO_USERS = [
  ['Ana Administradora', 'admin@farmacontrol.local', 'Admin#2026Fc', 1],
  ['Carlos Cajero', 'cajero@farmacontrol.local', 'Cajero#2026Fc', 2],
  ['Alicia Almacenera', 'almacen@farmacontrol.local', 'Almacen#2026Fc', 3],
  ['Quimica Quispe', 'quimico@farmacontrol.local', 'Quimico#2026Fc', 4],
];

async function seedMemory(store) {
  const hoy = todayStr();
  for (const [nombre, descripcion] of [
    ['Administrador', 'Gestiona usuarios, reportes, anulaciones y configuracion'], ['Cajero', 'Registra ventas y clientes'],
    ['Almacenero', 'Recepciona compras, lotes y proveedores'], ['Quimico farmaceutico', 'Verifica recetas y supervisa medicamentos']])
    await store.insert('Rol', { nombre, descripcion });
  for (const [nombres, correo, clave, rol_id] of DEMO_USERS)
    await store.insert('Usuario', { rol_id, nombres, correo, hash_contrasena: hashPassword(clave), activo: true });
  for (const nombre of ['Analgesicos', 'Antialergicos', 'Antibioticos', 'Cuidado personal']) await store.insert('Categoria', { nombre });
  const meds = [
    [1, 'MED-001', 'Paracetamol 500 mg', 'Paracetamol', 'Caja x 20 tabletas', 8.5, false], [2, 'MED-002', 'Cetirizina 10 mg', 'Cetirizina', 'Caja x 10 tabletas', 12.9, false],
    [4, 'MED-003', 'Alcohol en gel 250 ml', null, 'Frasco 250 ml', 9.9, false], [3, 'MED-004', 'Amoxicilina 500 mg', 'Amoxicilina', 'Caja x 21 capsulas', 21.5, true],
    [4, 'MED-005', 'Suero fisiologico 500 ml', 'Cloruro de sodio', 'Bolsa 500 ml', 7.2, false], [1, 'MED-006', 'Ibuprofeno 400 mg', 'Ibuprofeno', 'Caja x 10 tabletas', 11, false],
    [2, 'MED-007', 'Loratadina 10 mg', 'Loratadina', 'Caja x 10 tabletas', 6.8, false], [3, 'MED-008', 'Azitromicina 500 mg', 'Azitromicina', 'Caja x 3 tabletas', 24.9, true]];
  for (const [categoria_id, sku, nombre, principio_activo, presentacion, precio_venta, requiere_receta] of meds)
    await store.insert('Medicamento', { categoria_id, sku, nombre, principio_activo, presentacion, precio_venta, requiere_receta, activo: true });
  const lotes = [[1, 'P-2401', 600, 15], [1, 'P-2402', 20, 15], [2, 'C-1822', 500, 20], [3, 'AG-830', 300, 12], [4, 'AM-705', 240, 10],
    [5, 'SF-401', 400, 12], [6, 'IB-310', 365, 10], [7, 'LO-114', 700, 10], [8, 'AZ-220', 180, 5]];
  for (const [medicamento_id, codigo_lote, dias, stock_minimo] of lotes)
    await store.insert('Lote', { medicamento_id, codigo_lote, fecha_vencimiento: addDays(hoy, dias), stock_actual: 0, stock_minimo });
  const L = Object.fromEntries((await store.list('Lote')).map((l) => [l.codigo_lote, l.lote_id]));
  await store.insert('Cliente', { tipo_documento: 'DNI', numero_documento: '12345678', nombre_razon_social: 'Maria Torres', telefono: '999 111 222' });
  await store.insert('Cliente', { tipo_documento: 'DNI', numero_documento: '45678912', nombre_razon_social: 'Luis Paredes', telefono: '988 333 444' });
  await store.insert('Cliente', { tipo_documento: 'RUC', numero_documento: '20600000003', nombre_razon_social: 'Clinica Los Andes SAC (ficticia)', telefono: '014 555 000' });
  await store.insert('Proveedor', { ruc: '20600000001', razon_social: 'Distribuidora Salud Peru SAC (ficticio)', contacto: 'Area comercial', telefono: '014 100 100', activo: true });
  await store.insert('Proveedor', { ruc: '20600000002', razon_social: 'Logistica Medica Andina SAC (ficticio)', contacto: 'Area comercial', telefono: '014 200 200', activo: true });
  await store.insert('Receta', { cliente_id: 1, numero_receta: 'REC-00041', nombre_prescriptor: 'Dr. Carlos Rios (ficticio)', fecha_emision: addDays(hoy, -3), fecha_vencimiento: addDays(hoy, 27), estado: 'VALIDA', observacion: 'Receta vigente de demostracion' });
  await store.insert('Receta', { cliente_id: 2, numero_receta: 'REC-00012', nombre_prescriptor: 'Dra. Rosa Medina (ficticia)', fecha_emision: addDays(hoy, -60), fecha_vencimiento: addDays(hoy, -30), estado: 'VALIDA', observacion: 'Receta vencida de demostracion' });

  await store.registrarCompra({ proveedorId: 1, usuarioId: 3, numeroDocumento: 'FAC-2026-0001', items: [
    ['P-2401', 120, 4.2], ['P-2402', 30, 4.2], ['C-1822', 24, 7], ['AG-830', 60, 4.8], ['AM-705', 40, 12], ['SF-401', 8, 3.5], ['IB-310', 50, 6], ['AZ-220', 8, 14]]
    .map(([c, cantidad, costo_unitario]) => ({ lote_id: L[c], cantidad, costo_unitario })) });
  await store.registrarVenta({ clienteId: 1, usuarioId: 2, tipoComprobante: 'BOLETA', items: [{ lote_id: L['P-2401'], cantidad: 2 }, { lote_id: L['C-1822'], cantidad: 4 }] });
  await store.registrarVenta({ clienteId: 1, usuarioId: 2, recetaId: 1, tipoComprobante: 'BOLETA', items: [{ lote_id: L['AM-705'], cantidad: 2 }] });
  const v = await store.registrarVenta({ clienteId: 2, usuarioId: 2, tipoComprobante: 'BOLETA', items: [{ lote_id: L['IB-310'], cantidad: 3 }] });
  await store.anularVenta({ ventaId: v.venta_id, usuarioId: 1, motivo: 'Anulacion de demostracion' });
  await store.update('Lote', L['SF-401'], { fecha_vencimiento: addDays(hoy, -5) }); // lote vencido tras recibirse
}

module.exports = { seedMemory, DEMO_USERS };
