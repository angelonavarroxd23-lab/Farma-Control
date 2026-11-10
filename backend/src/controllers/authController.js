'use strict';
const { AppError, validation } = require('../models/errors');
const { hashPassword, verifyPassword, passwordPolicyError } = require('../auth/password');
const { pub } = require('./presenters');

/** Controlador auth: recibe la petición ya autenticada, usa los modelos y devuelve la respuesta. */
const DUMMY_HASH = hashPassword('contraseña-ficticia-para-igualar-tiempos');
const attempts = new Map(); // limitador de intentos de acceso: clave ip|correo
const MAX_ATTEMPTS = 5, WINDOW_MS = 15 * 60 * 1000;

const estadoServicio = async ({ store, config }) => {
  await store.ping();
  return { status: 'ok', driver: store.kind, hora_servidor: new Date().toISOString() };
};

const iniciarSesion = async (ctx) => {
  const { store, body, ip, audit, config } = ctx;
  const correo = String(body.correo || '').trim().toLowerCase();
  const clave = String(body.contrasena || '');
  if (!correo || !clave) throw validation('Ingrese correo y contraseña.');
  const key = `${ip}|${correo}`; const now = Date.now();
  const rec = attempts.get(key);
  if (rec && rec.count >= MAX_ATTEMPTS && now - rec.first < WINDOW_MS)
    throw new AppError(429, 'RATE_LIMIT', 'Demasiados intentos fallidos. Espere 15 minutos.');
  const user = (await store.list('Usuario', { correo }))[0];
  const ok = verifyPassword(clave, user ? user.hash_contrasena : DUMMY_HASH) && user && user.activo;
  if (!ok) {
    const cur = rec && now - rec.first < WINDOW_MS ? rec : { count: 0, first: now };
    cur.count += 1; attempts.set(key, cur);
    await audit(user ? user.usuario_id : null, 'LOGIN_FALLIDO', 'Usuario', user ? user.usuario_id : null, `Correo: ${correo.slice(0, 120)}`);
    throw new AppError(401, 'AUTH', 'Credenciales incorrectas o usuario inactivo.');
  }
  attempts.delete(key);
  const roles = await store.list('Rol');
  const token = ctx.sign({ sub: user.usuario_id }, config.jwtSecret, config.tokenTtlMinutes * 60);
  await audit(user.usuario_id, 'LOGIN_OK', 'Usuario', user.usuario_id, null);
  return { token, usuario: pub(user, roles), expira_en_minutos: config.tokenTtlMinutes };
};

const perfilActual = async ({ user, store }) => pub(user, await store.list('Rol'));

const cambiarClave = async ({ user, store, body, audit }) => {
  if (!verifyPassword(String(body.actual || ''), user.hash_contrasena)) throw new AppError(401, 'AUTH', 'La contraseña actual no es correcta.');
  const err = passwordPolicyError(body.nueva); if (err) throw validation(err);
  await store.update('Usuario', user.usuario_id, { hash_contrasena: hashPassword(body.nueva) });
  await audit(user.usuario_id, 'CLAVE_CAMBIADA', 'Usuario', user.usuario_id, null);
  return { ok: true };
};

const cerrarSesion = async ({ user, audit }) => { await audit(user.usuario_id, 'LOGOUT', 'Usuario', user.usuario_id, null); return { ok: true }; };

module.exports = { estadoServicio, iniciarSesion, perfilActual, cambiarClave, cerrarSesion };
