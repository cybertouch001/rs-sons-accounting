// R&S Sons Accounting - tiny SMTP client for the login OTP mails (v2.2).
// Works in the hosted Cloudflare Worker (TCP sockets) and in the self-hosted Node server (net/tls): the caller passes an
// opener, open(host, port, mode) -> socket { write(str), readLine(), startTls(), close() }, mode = 'ssl' (port 465) or 'starttls' (587)
// ('none' = no encryption, allowed only for a relay on the same machine: localhost / 127.0.0.1).
// Settings (host, user, app password) are saved by the admin in Admin Settings and live only in the server's database.
'use strict';
const enc = new TextEncoder();
function b64utf8(s) { const u = enc.encode(String(s)); let bin = ''; for (let i = 0; i < u.length; i += 32768) bin += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(bin); }
function wrap76(s) { return s.replace(/.{1,76}/g, '$&\r\n'); }
function hdrWord(s) { s = String(s || ''); return /^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + b64utf8(s) + '?='; }
function cleanAddr(a) { a = String(a || '').trim(); if (!/^[^\s@<>"',;:]+@[^\s@<>"',;:]+\.[^\s@<>"',;:]+$/.test(a)) throw new Error('Email address is not valid: ' + a); return a; }
const PRESETS = { gmail: { host: 'smtp.gmail.com', port: 465, secure: 'ssl' }, outlook: { host: 'smtp.office365.com', port: 587, secure: 'starttls' }, zoho: { host: 'smtp.zoho.in', port: 465, secure: 'ssl' }, brevo: { host: 'smtp-relay.brevo.com', port: 587, secure: 'starttls' } };

function buildMessage(cfg, msg) {
  const from = cleanAddr(cfg.from || cfg.user); const to = cleanAddr(msg.to);
  const boundary = 'rs' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const dom = from.split('@')[1];
  const lines = [
    `From: ${cfg.fromName ? '"' + hdrWord(String(cfg.fromName).replace(/"/g, '')) + '" ' : ''}<${from}>`,
    `To: <${to}>`,
    `Subject: ${hdrWord(msg.subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}@${dom}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '', `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(b64utf8(msg.text || '')),
  ];
  if (msg.html) lines.push(`--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(b64utf8(msg.html)));
  lines.push(`--${boundary}--`, '');
  return { from, to, data: lines.join('\r\n') };
}

async function smtpSend(open, cfg, msg, opts = {}) {
  const p = Object.assign({}, PRESETS[cfg.provider] || {}, cfg.host ? { host: cfg.host } : {}, cfg.port ? { port: Number(cfg.port) } : {}, cfg.secure ? { secure: cfg.secure } : {});
  if (!p.host || !p.port) throw new Error('Email server (SMTP host/port) is not set');
  if (!cfg.user || !cfg.pass) throw new Error('Email login (username / app password) is not set');
  const m = buildMessage(cfg, msg); const trace = [];
  const timeoutMs = opts.timeoutMs || 20000;
  let sock = null; let timer;
  const run = async () => {
    sock = await open(p.host, p.port, p.secure === 'starttls' ? 'starttls' : p.secure === 'none' ? 'none' : 'ssl');
    const reply = async () => {   // one (possibly multi-line) SMTP reply
      const lines = []; for (;;) { const l = await sock.readLine(); if (l == null) throw new Error('Email server closed the connection'); lines.push(l); if (!/^\d{3}-/.test(l)) break; }
      const code = Number(lines[lines.length - 1].slice(0, 3)); trace.push(lines[lines.length - 1].slice(0, 120)); return { code, lines };
    };
    const cmd = async (c, want, label) => { await sock.write(c + '\r\n'); const r = await reply(); if (!want.includes(r.code)) { const e = new Error(`${label || c.split(' ')[0]}: ${r.lines.join(' ').slice(0, 200)}`); e.smtpCode = r.code; throw e; } return r; };
    let r = await reply(); if (r.code !== 220) throw new Error('Email server greeting: ' + r.lines.join(' ').slice(0, 200));
    let ehlo = await cmd('EHLO rs-sons-accounting', [250], 'EHLO');
    if (p.secure === 'starttls') { await cmd('STARTTLS', [220]); sock = await sock.startTls(); ehlo = await cmd('EHLO rs-sons-accounting', [250], 'EHLO'); }
    const caps = ehlo.lines.join(' ').toUpperCase();
    if (caps.includes('AUTH') && /AUTH[ =][^\r\n]*PLAIN/.test(caps)) await cmd('AUTH PLAIN ' + b64utf8('\u0000' + cfg.user + '\u0000' + cfg.pass), [235], 'Login (AUTH)');
    else { await cmd('AUTH LOGIN', [334], 'Login (AUTH)'); await cmd(b64utf8(cfg.user), [334], 'Login (AUTH user)'); await cmd(b64utf8(cfg.pass), [235], 'Login (AUTH password)'); }
    await cmd(`MAIL FROM:<${m.from}>`, [250], 'Sender');
    await cmd(`RCPT TO:<${m.to}>`, [250, 251], 'Recipient');
    await cmd('DATA', [354]);
    const body = m.data.replace(/\r\n\./g, '\r\n..');
    const fin = await cmd(body + '\r\n.', [250], 'Send');
    try { await sock.write('QUIT\r\n'); } catch (_) {}
    return { ok: true, id: (fin.lines[fin.lines.length - 1] || '').slice(4, 120), trace };
  };
  try {
    return await Promise.race([run(), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('Email server did not answer in time')), timeoutMs); })]);
  } catch (e) { e.trace = trace; throw e; }
  finally { clearTimeout(timer); try { if (sock) sock.close(); } catch (_) {} }
}

// a line reader over any byte stream reader (used by both openers)
function lineReader(readChunk) {
  let buf = ''; const dec = new TextDecoder();
  return async function readLine() {
    for (;;) { const i = buf.indexOf('\n'); if (i >= 0) { const l = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1); return l; }
      const c = await readChunk(); if (c == null) { if (buf) { const l = buf; buf = ''; return l; } return null; } buf += typeof c === 'string' ? c : dec.decode(c, { stream: true }); }
  };
}
module.exports = { smtpSend, buildMessage, lineReader, PRESETS, cleanAddr };
