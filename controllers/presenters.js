'use strict';
// Presentadores: dan forma pública a los datos (nunca exponen el hash de contraseña).
const pub = (u, roles) => ({ usuario_id: u.usuario_id, nombres: u.nombres, correo: u.correo, activo: u.activo, rol_id: u.rol_id, rol: roles.find((r) => r.rol_id === u.rol_id)?.nombre });

module.exports = { pub };
