'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./helpers');
let t;
before(async () => { t = await boot(); });
after(async () => { await t.close(); });

test('AUT-01 inicio de sesión válido devuelve token y no expone el hash', async () => {
  const r = await t.call('POST', '/api/auth/login', { correo: 'admin@farmacontrol.local', contrasena: 'Admin#2026Fc' });
  assert.equal(r.status, 200);
  assert.ok(r.data.token.split('.').length === 3);
  assert.equal(r.data.usuario.rol, 'Administrador');
  assert.equal(JSON.stringify(r.data).includes('hash'), false);
});
test('AUT-02 contraseña incorrecta devuelve 401 con mensaje genérico', async () => {
  const r = await t.call('POST', '/api/auth/login', { correo: 'cajero@farmacontrol.local', contrasena: 'incorrecta' });
  assert.equal(r.status, 401);
  assert.match(r.data.error.message, /Credenciales incorrectas/);
});
test('AUT-03 usuario inexistente recibe el mismo mensaje que contraseña errónea', async () => {
  const r = await t.call('POST', '/api/auth/login', { correo: 'nadie@farmacontrol.local', contrasena: 'Cualquiera#123' });
  assert.equal(r.status, 401);
  assert.match(r.data.error.message, /Credenciales incorrectas/);
});
test('AUT-04 una ruta protegida sin token responde 401', async () => {
  assert.equal((await t.call('GET', '/api/clientes')).status, 401);
});
test('AUT-05 un token manipulado es rechazado', async () => {
  const tk = await t.login('admin');
  const [h, p, s] = tk.split('.');
  const forged = `${h}.${Buffer.from(JSON.stringify({ sub: 1, exp: 9999999999 })).toString('base64url')}.${s}`;
  assert.equal((await t.call('GET', '/api/clientes', undefined, forged)).status, 401);
  assert.equal((await t.call('GET', '/api/clientes', undefined, 'basura')).status, 401);
});
test('AUT-06 tras cinco intentos fallidos se bloquea el acceso temporalmente (429)', async () => {
  const correo = `bloqueo-${Date.now()}@farmacontrol.local`;
  let last;
  for (let i = 0; i < 6; i++) last = await t.call('POST', '/api/auth/login', { correo, contrasena: 'mala' });
  assert.equal(last.status, 429);
});
test('AUT-07 matriz de permisos: operaciones fuera del perfil devuelven 403', async () => {
  const cajero = await t.login('cajero'), almacen = await t.login('almacen'), quimico = await t.login('quimico');
  assert.equal((await t.call('GET', '/api/usuarios', undefined, cajero)).status, 403);
  assert.equal((await t.call('POST', '/api/compras', { proveedor_id: 1, numero_documento: 'X', items: [] }, cajero)).status, 403);
  assert.equal((await t.call('POST', '/api/ventas', { cliente_id: 1, items: [] }, almacen)).status, 403);
  assert.equal((await t.call('POST', '/api/ventas/1/anular', { motivo: 'x' }, cajero)).status, 403);
  assert.equal((await t.call('GET', '/api/reportes/resumen', undefined, cajero)).status, 403);
  assert.equal((await t.call('GET', '/api/auditoria', undefined, quimico)).status, 403);
  assert.equal((await t.call('POST', '/api/medicamentos', {}, quimico)).status, 403);
  assert.equal((await t.call('GET', '/api/compras', undefined, cajero)).status, 403);
});
test('AUT-08 el administrador gestiona usuarios; la lista no expone hashes', async () => {
  const admin = await t.login('admin');
  const r = await t.call('GET', '/api/usuarios', undefined, admin);
  assert.equal(r.status, 200);
  assert.ok(r.data.length >= 4);
  assert.equal(JSON.stringify(r.data).includes('hash_contrasena'), false);
});
test('AUT-09 alta de usuario: política de contraseña, correo único y desactivación inmediata', async () => {
  const admin = await t.login('admin');
  const roles = (await t.call('GET', '/api/roles', undefined, admin)).data;
  const cajeroRol = roles.find((x) => x.nombre === 'Cajero').rol_id;
  const correo = `${t.uid('u').toLowerCase()}@farmacontrol.local`;
  assert.equal((await t.call('POST', '/api/usuarios', { nombres: 'Prueba', correo, rol_id: cajeroRol, contrasena: 'corta' }, admin)).status, 400);
  const ok = await t.call('POST', '/api/usuarios', { nombres: 'Prueba', correo, rol_id: cajeroRol, contrasena: 'Prueba#2026Ok' }, admin);
  assert.equal(ok.status, 201);
  assert.equal((await t.call('POST', '/api/usuarios', { nombres: 'Otra', correo, rol_id: cajeroRol, contrasena: 'Prueba#2026Ok' }, admin)).status, 409);
  const lg = await t.call('POST', '/api/auth/login', { correo, contrasena: 'Prueba#2026Ok' });
  assert.equal(lg.status, 200);
  const off = await t.call('PATCH', `/api/usuarios/${ok.data.usuario_id}`, { activo: false }, admin);
  assert.equal(off.status, 200);
  assert.equal((await t.call('GET', '/api/clientes', undefined, lg.data.token)).status, 401, 'el token de un usuario desactivado deja de valer');
  assert.equal((await t.call('POST', '/api/auth/login', { correo, contrasena: 'Prueba#2026Ok' })).status, 401);
});
test('AUT-10 no se puede desactivar el propio perfil ni al último administrador', async () => {
  const admin = await t.login('admin');
  const me = (await t.call('GET', '/api/auth/me', undefined, admin)).data;
  const r = await t.call('PATCH', `/api/usuarios/${me.usuario_id}`, { activo: false }, admin);
  assert.equal(r.status, 422);
});
test('AUT-11 cambio de contraseña propio exige la actual y la política', async () => {
  const admin = await t.login('admin');
  assert.equal((await t.call('POST', '/api/auth/password', { actual: 'mala', nueva: 'Nueva#2026Clave' }, admin)).status, 401);
  assert.equal((await t.call('POST', '/api/auth/password', { actual: 'Admin#2026Fc', nueva: 'debil' }, admin)).status, 400);
});
test('AUT-12 respuestas con cabeceras de seguridad y rutas inexistentes/métodos erróneos', async () => {
  const r = await t.call('GET', '/api/health');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await t.call('GET', '/api/no-existe', undefined, await t.login('admin'))).status, 404);
  assert.equal((await t.call('DELETE', '/api/clientes', undefined, await t.login('admin'))).status, 405);
});
test('AUT-13 cuerpos inválidos: JSON roto y tipo de contenido erróneo', async () => {
  const tk = await t.login('cajero');
  assert.equal((await t.call('POST', '/api/clientes', undefined, tk, { raw: '{no es json' })).status, 400);
  assert.equal((await t.call('POST', '/api/clientes', undefined, tk, { raw: 'x=1', headers: { 'Content-Type': 'text/plain' } })).status, 400);
});
