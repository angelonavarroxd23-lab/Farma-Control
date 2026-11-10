'use strict';
// Hash de contraseñas con scrypt (módulo crypto de Node; sin dependencias externas).
// Formato almacenado: scrypt$N$r$p$<sal base64>$<hash base64>
const crypto = require('node:crypto');

const N = 16384, R = 8, P = 1, KEYLEN = 64;

function hashPassword(plain, saltBuf) {
  const salt = saltBuf || crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(plain), salt, KEYLEN, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64'), dk.toString('base64')].join('$');
}

function verifyPassword(plain, stored) {
  try {
    const [alg, n, r, p, saltB64, hashB64] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const dk = crypto.scryptSync(String(plain), Buffer.from(saltB64, 'base64'), expected.length,
      { N: +n, r: +r, p: +p });
    return dk.length === expected.length && crypto.timingSafeEqual(dk, expected);
  } catch { return false; }
}

// Política mínima de contraseña para altas y cambios de clave.
function passwordPolicyError(plain) {
  const s = String(plain || '');
  if (s.length < 10) return 'La contraseña debe tener al menos 10 caracteres.';
  if (!/[a-z]/.test(s) || !/[A-Z]/.test(s) || !/[0-9]/.test(s))
    return 'La contraseña debe combinar mayúsculas, minúsculas y números.';
  return null;
}

module.exports = { hashPassword, verifyPassword, passwordPolicyError };
