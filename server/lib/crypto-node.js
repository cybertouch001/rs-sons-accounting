// Password hashing and tokens for the Node server (node:crypto).
'use strict';
const crypto = require('crypto');
module.exports = {
  pbkdf2: (pw, saltHex, iter) => new Promise((res, rej) => crypto.pbkdf2(String(pw), saltHex, iter, 32, 'sha256', (e, k) => e ? rej(e) : res(k.toString('hex')))),
  randomHex: n => crypto.randomBytes(n).toString('hex'),
  randomToken: () => crypto.randomBytes(32).toString('base64url'),
  sha256Hex: async s => crypto.createHash('sha256').update(String(s)).digest('hex'),
  safeEqual: (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); },
  toB64: bytes => Buffer.from(bytes).toString('base64'),
  fromB64: s => Buffer.from(String(s), 'base64'),
  utf8: s => Buffer.from(s, 'utf8'),
};
