'use strict';
// Adaptadores para ejecutar en el NAVEGADOR el mismo código del servidor (solo para la demostración de GitHub Pages).
// Sustituyen a los módulos de Node.js: Buffer, crypto (SHA-256/HMAC), fs y path.
/* global window */
(function (G) {
  // ---------- Buffer mínimo ----------
  const enc = new TextEncoder(), dec = new TextDecoder();
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function toB64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 3) {
      const n = (u8[i] << 16) | ((u8[i + 1] ?? 0) << 8) | (u8[i + 2] ?? 0);
      s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < u8.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < u8.length ? B64[n & 63] : '=');
    }
    return s;
  }
  function fromB64(s) {
    s = String(s).replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
    const out = []; let buf = 0, bits = 0;
    for (const ch of s) { buf = (buf << 6) | B64.indexOf(ch); bits += 6; if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); } }
    return out;
  }
  class Buffer extends Uint8Array {
    static from(v, encoding) {
      if (typeof v === 'string') {
        if (encoding === 'base64' || encoding === 'base64url') return new Buffer(fromB64(v));
        if (encoding === 'hex') return new Buffer(v.match(/../g)?.map((h) => parseInt(h, 16)) || []);
        return new Buffer(enc.encode(v));
      }
      return new Buffer(v);
    }
    static isBuffer(v) { return v instanceof Buffer; }
    static byteLength(s) { return typeof s === 'string' ? enc.encode(s).length : s.length; }
    static concat(list) { const n = list.reduce((a, b) => a + b.length, 0); const out = new Buffer(n); let o = 0; for (const b of list) { out.set(b, o); o += b.length; } return out; }
    toString(encoding) {
      if (encoding === 'base64') return toB64(this);
      if (encoding === 'base64url') return toB64(this).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      if (encoding === 'hex') return [...this].map((b) => b.toString(16).padStart(2, '0')).join('');
      return dec.decode(this);
    }
  }

  // ---------- SHA-256 y HMAC (síncronos) ----------
  const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  function sha256(data) {
    const l = data.length, bl = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(bl);
    m.set(data); m[l] = 0x80; const dv = new DataView(m.buffer);
    dv.setUint32(bl - 4, (l * 8) >>> 0); dv.setUint32(bl - 8, Math.floor((l * 8) / 2 ** 32));
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]), W = new Uint32Array(64);
    const r = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < bl; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) W[i] = (W[i - 16] + (r(W[i - 15], 7) ^ r(W[i - 15], 18) ^ (W[i - 15] >>> 3)) + W[i - 7] + (r(W[i - 2], 17) ^ r(W[i - 2], 19) ^ (W[i - 2] >>> 10))) >>> 0;
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
        const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    const out = new Buffer(32); const ov = new DataView(out.buffer); H.forEach((v, i) => ov.setUint32(i * 4, v)); return out;
  }
  const bytes = (v) => (typeof v === 'string' ? enc.encode(v) : v);
  function hmac(key, msg) {
    let k = bytes(key); if (k.length > 64) k = sha256(k);
    const ip = new Uint8Array(64 + msg.length), op = new Uint8Array(96);
    for (let i = 0; i < 64; i++) { ip[i] = (k[i] || 0) ^ 0x36; op[i] = (k[i] || 0) ^ 0x5c; }
    ip.set(msg, 64); op.set(sha256(ip), 64); return sha256(op);
  }
  const crypto = {
    randomBytes: (n) => { const b = new Buffer(n); G.crypto.getRandomValues(b); return b; },
    createHmac: (_alg, key) => { const parts = []; const h = { update: (d) => { parts.push(bytes(d)); return h; }, digest: (e) => { const r = hmac(key, Buffer.concat(parts.map((p) => Buffer.from(p)))); return e ? r.toString(e) : r; } }; return h; },
    // Demostración: derivación HMAC-SHA256 iterada en lugar de scrypt (no disponible de forma síncrona en el navegador).
    scryptSync: (pw, salt, keylen) => {
      let u = hmac(bytes(String(pw)), Buffer.concat([Buffer.from(salt), Buffer.from([0, 0, 0, 1])]));
      for (let i = 0; i < 200; i++) u = hmac(bytes(String(pw)), u);
      const out = new Buffer(keylen); for (let i = 0; i < keylen; i++) out[i] = u[i % 32]; return out;
    },
    timingSafeEqual: (a, b) => { let d = a.length ^ b.length; for (let i = 0; i < Math.min(a.length, b.length); i++) d |= a[i] ^ b[i]; return d === 0; },
  };
  G.Buffer = Buffer;
  G.__FC_SHIMS = { 'node:crypto': crypto, 'node:fs': {}, 'node:path': { sep: '/', resolve: (...a) => a.join('/'), extname: () => '' } };
})(window);
