'use strict';
// Tokens firmados HS256 (JWT) con el módulo crypto de Node.
const crypto = require('node:crypto');
const b64u = (b) => Buffer.from(b).toString('base64url');

function sign(payload, secret, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSeconds };
  const data = `${b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64u(JSON.stringify(body))}`;
  return `${data}.${crypto.createHmac('sha256', secret).update(data).digest('base64url')}`;
}

function verify(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const expected = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  let given; try { given = Buffer.from(parts[2], 'base64url'); } catch { return null; }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return p.exp > Math.floor(Date.now() / 1000) ? p : null;
  } catch { return null; }
}
module.exports = { sign, verify };
