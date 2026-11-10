'use strict';
const { validation, business, notFound } = require('../models/errors');
const { hashPassword, passwordPolicyError } = require('../auth/password');
const V = require('../models/validate');
const { pub } = require('./presenters');

/** Controlador usuarios: recibe la petición ya autenticada, usa los modelos y devuelve la respuesta. */
const listarRoles = ({ store }) => store.list('Rol');

const listarUsuarios = async ({ store }) => {
  const roles = await store.list('Rol');
  return (await store.list('Usuario')).map((u) => pub(u, roles));
};

const crearUsuarios = async ({ store, body, user, audit }) => {
  const d = V.clean('Usuario', body, { allow: ['rol_id', 'nombres', 'correo'] });
  d.correo = d.correo.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.correo)) throw validation('Datos no válidos.', ['correo: formato no válido.']);
  const err = passwordPolicyError(body.contrasena); if (err) throw validation(err);
  const row = await store.insert('Usuario', { ...d, hash_contrasena: hashPassword(body.contrasena), activo: true });
  await audit(user.usuario_id, 'USUARIO_CREADO', 'Usuario', row.usuario_id, d.correo);
  return { status: 201, data: pub(row, await store.list('Rol')) };
};

const actualizarUsuarios = async ({ store, params, body, user, audit }) => {
  const id = V.positiveInt(params.id, 'id');
  const cur = await store.get('Usuario', id); if (!cur) throw notFound();
  const d = V.clean('Usuario', body, { partial: true, allow: ['rol_id', 'nombres', 'activo'] });
  if (body.contrasena !== undefined) { const err = passwordPolicyError(body.contrasena); if (err) throw validation(err); d.hash_contrasena = hashPassword(body.contrasena); }
  if (d.activo === false && id === user.usuario_id) throw business('No puede desactivar el perfil que está en uso.');
  const roles = await store.list('Rol');
  const adminId = roles.find((x) => x.nombre === 'Administrador')?.rol_id;
  const users = await store.list('Usuario');
  const adminsActivos = users.filter((u) => u.rol_id === adminId && u.activo && u.usuario_id !== id).length;
  const quedaraAdmin = (d.rol_id ?? cur.rol_id) === adminId && (d.activo ?? cur.activo);
  if (cur.rol_id === adminId && cur.activo && !quedaraAdmin && adminsActivos === 0) throw business('Debe existir al menos un administrador activo.');
  const row = await store.update('Usuario', id, d);
  await audit(user.usuario_id, 'USUARIO_MODIFICADO', 'Usuario', id, Object.keys(d).filter((k) => k !== 'hash_contrasena').join(','));
  return pub(row, roles);
};

module.exports = { listarRoles, listarUsuarios, crearUsuarios, actualizarUsuarios };
