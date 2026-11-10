'use strict';
const { byId } = require('../models/util');

/** Controlador auditoria: recibe la petición ya autenticada, usa los modelos y devuelve la respuesta. */
const listarAuditoria = async ({ store, query }) => {
  const users = byId(await store.list('Usuario'), 'usuario_id');
  let rows = (await store.list('AuditoriaOperacion')).reverse();
  if (query.accion) rows = rows.filter((a) => a.accion === query.accion);
  return rows.slice(0, Math.min(Number(query.limit) || 200, 1000)).map((a) => ({ ...a, usuario: a.usuario_id ? users.get(a.usuario_id)?.nombres : null }));
};

module.exports = { listarAuditoria };
