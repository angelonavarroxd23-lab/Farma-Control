'use strict';
// Matriz de permisos por perfil (RF-01). Se aplica en el servidor en cada petición.
const A = 'Administrador', C = 'Cajero', W = 'Almacenero', Q = 'Quimico farmaceutico';
const PERMISSIONS = {
  'clientes:read': [A, C, W, Q], 'clientes:write': [A, C],
  'proveedores:read': [A, W], 'proveedores:write': [A, W],
  'catalogo:read': [A, C, W, Q], 'catalogo:write': [A, W],
  'recetas:read': [A, C, Q], 'recetas:write': [A, Q],
  'ventas:read': [A, C, Q], 'ventas:create': [A, C], 'ventas:anular': [A],
  'compras:read': [A, W], 'compras:create': [A, W],
  'movimientos:read': [A, W, Q],
  'alertas:read': [A, C, W, Q],
  'reportes:read': [A],
  'usuarios:read': [A], 'usuarios:write': [A],
  'auditoria:read': [A],
};
const can = (rol, perm) => (PERMISSIONS[perm] || []).includes(rol);
module.exports = { PERMISSIONS, can };
