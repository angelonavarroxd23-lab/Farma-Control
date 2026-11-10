'use strict';
// Tabla de rutas: asocia método + URL + permiso con un método de controlador.
const { Router } = require('./http/router');
const auditoria = require('./controllers/auditoriaController');
const auth = require('./controllers/authController');
const catalogo = require('./controllers/catalogoController');
const clientes = require('./controllers/clientesController');
const compras = require('./controllers/comprasController');
const inventario = require('./controllers/inventarioController');
const proveedores = require('./controllers/proveedoresController');
const recetas = require('./controllers/recetasController');
const reportes = require('./controllers/reportesController');
const usuarios = require('./controllers/usuariosController');
const ventas = require('./controllers/ventasController');

function buildRouter() {
  const r = new Router();
  const get = (p, perm, h) => r.add('GET', p, { perm }, h);
  const post = (p, perm, h) => r.add('POST', p, { perm }, h);
  const patch = (p, perm, h) => r.add('PATCH', p, { perm }, h);
  const del = (p, perm, h) => r.add('DELETE', p, { perm }, h);

  // ---------------- Público ----------------
  r.add('GET', '/api/health', { public: true }, auth.estadoServicio);
  r.add('POST', '/api/auth/login', { public: true }, auth.iniciarSesion);
  // ---------------- Sesión ----------------
  r.add('GET', '/api/auth/me', { auth: true }, auth.perfilActual);
  r.add('POST', '/api/auth/password', { auth: true }, auth.cambiarClave);
  r.add('POST', '/api/auth/logout', { auth: true }, auth.cerrarSesion);
  // ---------------- Usuarios y roles ----------------
  get('/api/roles', 'usuarios:read', usuarios.listarRoles);
  get('/api/usuarios', 'usuarios:read', usuarios.listarUsuarios);
  post('/api/usuarios', 'usuarios:write', usuarios.crearUsuarios);
  patch('/api/usuarios/:id', 'usuarios:write', usuarios.actualizarUsuarios);
  // ---------------- Clientes ----------------
  get('/api/clientes', 'clientes:read', clientes.listarClientes);
  post('/api/clientes', 'clientes:write', clientes.crearClientes);
  patch('/api/clientes/:id', 'clientes:write', clientes.actualizarClientes);
  // ---------------- Proveedores ----------------
  get('/api/proveedores', 'proveedores:read', proveedores.listarProveedores);
  post('/api/proveedores', 'proveedores:write', proveedores.crearProveedores);
  patch('/api/proveedores/:id', 'proveedores:write', proveedores.actualizarProveedores);
  // ---------------- Categorías ----------------
  get('/api/categorias', 'catalogo:read', catalogo.listarCategorias);
  post('/api/categorias', 'catalogo:write', catalogo.crearCategorias);
  patch('/api/categorias/:id', 'catalogo:write', catalogo.actualizarCategorias);
  del('/api/categorias/:id', 'catalogo:write', catalogo.eliminarCategorias);
  // ---------------- Medicamentos y lotes ----------------
  get('/api/medicamentos', 'catalogo:read', catalogo.listarMedicamentos);
  get('/api/medicamentos/:id', 'catalogo:read', catalogo.obtenerMedicamentos);
  post('/api/medicamentos', 'catalogo:write', catalogo.crearMedicamentos);
  patch('/api/medicamentos/:id', 'catalogo:write', catalogo.actualizarMedicamentos);
  get('/api/lotes', 'catalogo:read', catalogo.listarLotes);
  post('/api/lotes', 'catalogo:write', catalogo.crearLotes);
  patch('/api/lotes/:id', 'catalogo:write', catalogo.actualizarLotes);
  // ---------------- Recetas ----------------
  get('/api/recetas', 'recetas:read', recetas.listarRecetas);
  post('/api/recetas', 'recetas:write', recetas.crearRecetas);
  patch('/api/recetas/:id', 'recetas:write', recetas.actualizarRecetas);
  // ---------------- Compras ----------------
  get('/api/compras', 'compras:read', compras.listarCompras);
  get('/api/compras/:id', 'compras:read', compras.obtenerCompras);
  post('/api/compras', 'compras:create', compras.crearCompras);
  // ---------------- Ventas ----------------
  get('/api/ventas', 'ventas:read', ventas.listarVentas);
  get('/api/ventas/:id', 'ventas:read', ventas.obtenerVentas);
  post('/api/ventas', 'ventas:create', ventas.crearVentas);
  post('/api/ventas/:id/anular', 'ventas:anular', ventas.anularVentas);
  // ---------------- Movimientos y alertas ----------------
  get('/api/movimientos', 'movimientos:read', inventario.listarMovimientos);
  get('/api/alertas', 'alertas:read', inventario.listarAlertas);
  // ---------------- Panel y reportes ----------------
  get('/api/resumen', 'alertas:read', reportes.listarResumen);
  get('/api/reportes/resumen', 'reportes:read', reportes.listarReportesResumen);
  get('/api/reportes/ventas.csv', 'reportes:read', reportes.listarReportesVentasCsv);
  get('/api/reportes/inventario.csv', 'reportes:read', reportes.listarReportesInventarioCsv);
  get('/api/reportes/movimientos.csv', 'reportes:read', reportes.listarReportesMovimientosCsv);
  // ---------------- Auditoría ----------------
  get('/api/auditoria', 'auditoria:read', auditoria.listarAuditoria);
  return r;
}

module.exports = { buildRouter };
