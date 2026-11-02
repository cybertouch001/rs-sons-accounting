// Node opener for the OTP mailer (self-hosted server): plain TLS on 465, or STARTTLS on 587.
'use strict';
const net = require('net'); const tls = require('tls');
const { lineReader } = require('./mailer');
function wrapNode(s, host) {
  const q = []; let waiters = []; let ended = false;
  const done = () => { ended = true; const w = waiters; waiters = []; w.forEach(f => f(null)); };
  s.on('data', d => { if (waiters.length) waiters.shift()(d); else q.push(d); }); s.on('end', done); s.on('close', done); s.on('error', done);
  const readChunk = () => q.length ? Promise.resolve(q.shift()) : ended ? Promise.resolve(null) : new Promise(r => waiters.push(r));
  return {
    readLine: lineReader(readChunk),
    write: (str) => new Promise((res, rej) => s.write(str, e => e ? rej(e) : res())),
    startTls: () => new Promise((res, rej) => { s.removeAllListeners('data'); s.removeAllListeners('end'); s.removeAllListeners('close'); s.removeAllListeners('error'); const t = tls.connect({ socket: s, servername: host }, () => res(wrapNode(t, host))); t.once('error', rej); }),
    close: () => { try { s.destroy(); } catch (_) {} },
  };
}
function openNode(host, port, mode) {
  return new Promise((res, rej) => {
    if (mode === 'none' && !/^(localhost|127\.0\.0\.1|::1)$/.test(host)) return rej(new Error('Unencrypted email is only allowed to a relay on this computer'));
    const s = mode === 'ssl' ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    const ok = () => { s.removeListener('error', rej); res(wrapNode(s, host)); };
    s.once(mode === 'ssl' ? 'secureConnect' : 'connect', ok); s.once('error', rej);
  });
}
module.exports = { openNode };
