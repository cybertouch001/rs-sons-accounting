#!/usr/bin/env node
// R&S Sons Accounting - multi-user server (self-hosted).  Needs Node.js 22 or newer.  No other installs needed.
//   node server.js                      start the server (http://localhost:8080)
//   node server.js backup [folder]      consistent copy of every database (safe while the server runs)
//   node server.js restore <folder>     put a backup back (stop the server first)
//   node server.js reset-password <user>   set a new random password for a user (prints it once)
//   node server.js import <file.rsbak>  add a v1.1 desktop company backup as a new company
// Settings come from environment variables (or a .env file next to this script): see .env.example
'use strict';
process.removeAllListeners('warning'); process.on('warning', w => { if (w.name !== 'ExperimentalWarning') console.warn(w.message); });
const fs = require('fs'), path = require('path'), http = require('http'), crypto = require('crypto');

// ---- config ----
(function loadDotEnv() { const f = path.join(__dirname, '.env'); if (!fs.existsSync(f)) return; for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } })();
const CFG = {
  port: Number(process.env.PORT || 8080), host: process.env.HOST || '0.0.0.0',
  dataDir: path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data')),
  adminUser: process.env.ADMIN_USER || 'admin', adminPassword: process.env.ADMIN_PASSWORD || '',
  trustProxy: /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || ''), maxBodyMb: Number(process.env.MAX_BODY_MB || 60),
  forceSecureCookie: /^(1|true|yes)$/i.test(process.env.COOKIE_SECURE || ''),
};
const [major] = process.versions.node.split('.').map(Number);
if (major < 22) { console.error(`Node.js 22 or newer is needed (this is ${process.versions.node}). Download the LTS from https://nodejs.org`); process.exit(1); }

const APP = path.resolve(__dirname, '..', 'app');
const XLSX = require('xlsx'); const QRCode = require('qrcode');
const { SysStore } = require('./lib/sysstore');
const { NodeSysDriver, NodeCompanyStore, openDb } = require('./lib/store-node');
const { createService } = require('./lib/service');
const CR = require('./lib/crypto-node');
const VERSION = require(path.join(APP, 'package.json')).version;

function makeService() {
  fs.mkdirSync(CFG.dataDir, { recursive: true });
  const sys = new SysStore(new NodeSysDriver(path.join(CFG.dataDir, 'system.db')));
  const store = new NodeCompanyStore(CFG.dataDir);
  const svc = createService({ sys, store, crypto: CR, XLSX, QRCode, version: VERSION, dataLabel: 'Server · ' + CFG.dataDir });
  return { sys, store, svc };
}

// ---- CLI commands ----
async function cli(cmd, args) {
  if (cmd === 'backup') {
    const out = path.resolve(args[0] || path.join(CFG.dataDir, 'backups', 'full_' + new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16)));
    fs.mkdirSync(path.join(out, 'companies'), { recursive: true });
    const snap = (src, dest) => { const d = openDb(src); try { d.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`); } finally { d.close(); } };
    snap(path.join(CFG.dataDir, 'system.db'), path.join(out, 'system.db'));
    const cdir = path.join(CFG.dataDir, 'companies'); let n = 0;
    for (const f of fs.existsSync(cdir) ? fs.readdirSync(cdir).filter(x => x.endsWith('.rsdb')) : []) { snap(path.join(cdir, f), path.join(out, 'companies', f)); n++; }
    fs.writeFileSync(path.join(out, 'BACKUP-INFO.txt'), `R&S Sons Accounting server backup\nCreated: ${new Date().toISOString()}\nVersion: ${VERSION}\nCompanies: ${n}\nRestore: node server.js restore "${out}"  (stop the server first)\n`);
    console.log(`Backup done: ${out}  (${n} companies + users)`); return;
  }
  if (cmd === 'restore') {
    const src = path.resolve(args[0] || ''); if (!fs.existsSync(path.join(src, 'system.db'))) { console.error('Give the backup folder that contains system.db'); process.exit(1); }
    const safety = path.join(CFG.dataDir, 'before-restore_' + Date.now()); fs.mkdirSync(safety, { recursive: true });
    for (const f of ['system.db', 'companies']) { const p = path.join(CFG.dataDir, f); if (fs.existsSync(p)) fs.renameSync(p, path.join(safety, f)); }
    for (const ext of ['-wal', '-shm']) { try { fs.renameSync(path.join(CFG.dataDir, 'system.db' + ext), path.join(safety, 'system.db' + ext)); } catch (_) {} }
    fs.copyFileSync(path.join(src, 'system.db'), path.join(CFG.dataDir, 'system.db'));
    fs.mkdirSync(path.join(CFG.dataDir, 'companies'), { recursive: true });
    for (const f of fs.readdirSync(path.join(src, 'companies'))) fs.copyFileSync(path.join(src, 'companies', f), path.join(CFG.dataDir, 'companies', f));
    console.log(`Restored from ${src}. The previous data was moved to ${safety}. Start the server again.`); return;
  }
  if (cmd === 'reset-password') {
    const { sys, svc } = makeService(); const u = await sys.userByName(args[0] || CFG.adminUser); if (!u) { console.error('No such user'); process.exit(1); }
    const pw = crypto.randomBytes(9).toString('base64url') + '7a!';
    await sys.updateUser(u.id, { pw: await svc.hashPassword(pw), must_change: 1, active: 1 }); await sys.deleteUserSessions(u.id, ''); await sys.log('console', 'Password reset from server console', u.username, '');
    console.log(`New password for ${u.username}: ${pw}\n(they must change it after logging in)`); return;
  }
  if (cmd === 'import') {
    const { sys, svc } = makeService(); const f = path.resolve(args[0] || ''); const bytes = fs.readFileSync(f);
    if (bytes.slice(0, 15).toString() !== 'SQLite format 3') { console.error('Not a company backup file'); process.exit(1); }
    const id = 'c' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
    const name = await makeService().store.importBytes(id, bytes); await sys.addCompany({ id, name, created_by: 'console', restored_from: path.basename(f) });
    console.log(`Imported "${name}" as a new company.`); return;
  }
  console.error('Unknown command. Use: backup | restore <folder> | reset-password <user> | import <file>'); process.exit(1);
}

// ---- HTTP server ----
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.json': 'application/json', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src 'self' blob: data:; frame-ancestors 'self'; base-uri 'none'; form-action 'self'" };
function staticFile(urlPath) {
  // /app/... = the same screens as the desktop app; /assets/... and two browser-safe engine files
  let p = decodeURIComponent(urlPath.split('?')[0]);
  if (p === '/app' || p === '/app/') p = '/app/index.html';
  let f = null;
  if (p.startsWith('/app/')) f = path.join(APP, 'renderer', p.slice(5));
  else if (p.startsWith('/assets/')) f = path.join(APP, 'assets', p.slice(8));
  else if (p === '/core/util.js' || p === '/core/calc.js') f = path.join(APP, p);
  else if (p === '/favicon.ico') f = path.join(APP, 'assets', 'icon.ico');
  if (!f) return null; f = path.normalize(f);
  if (!f.startsWith(APP + path.sep) || f.includes('..')) return null;
  try { const st = fs.statSync(f); if (!st.isFile()) return null; return f; } catch (_) { return null; }
}
function cookieOf(req, name) { const h = req.headers.cookie || ''; for (const part of h.split(';')) { const [k, ...v] = part.trim().split('='); if (k === name) return decodeURIComponent(v.join('=')); } return null; }
function clientIp(req) { if (CFG.trustProxy && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim(); return req.socket.remoteAddress || ''; }
function isHttps(req) { return CFG.forceSecureCookie || !!req.socket.encrypted || (CFG.trustProxy && String(req.headers['x-forwarded-proto'] || '').includes('https')); }
function send(res, status, body, headers = {}) { res.writeHead(status, Object.assign({}, SEC, headers)); res.end(body); }
function readBody(req, limit) { return new Promise((resolve, reject) => { let n = 0; const chunks = []; req.on('data', c => { n += c.length; if (n > limit) { reject(Object.assign(new Error('Upload too large'), { status: 413 })); req.destroy(); } else chunks.push(c); }); req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject); }); }

async function start() {
  const { sys, store, svc } = makeService();
  // first start: create the admin account
  if (await sys.userCount() === 0) {
    let pw = CFG.adminPassword, shown = false;
    if (!pw) { pw = crypto.randomBytes(9).toString('base64url') + '7a!'; shown = true; }
    await svc.bootstrapAdmin(CFG.adminUser, pw);
    if (shown) { const f = path.join(CFG.dataDir, 'FIRST-ADMIN-PASSWORD.txt'); fs.writeFileSync(f, `Username: ${CFG.adminUser}\nPassword: ${pw}\n\nLog in and change it, then delete this file.\n`, { mode: 0o600 }); console.log(`First start: admin account "${CFG.adminUser}" created. Its password is in ${f}`); }
    else console.log(`First start: admin account "${CFG.adminUser}" created with ADMIN_PASSWORD. Change it after the first login.`);
  }
  const srv = http.createServer(async (req, res) => {
    const url = req.url || '/';
    try {
      if (url === '/' || url === '/index.html') return send(res, 302, '', { Location: '/app/' });
      if (url.startsWith('/api/health')) return send(res, 200, JSON.stringify({ ok: true, app: 'rs-sons-accounting', version: VERSION, mode: 'self-hosted' }), { 'Content-Type': 'application/json' });
      if (url === '/api/call') {
        if (req.method !== 'POST') return send(res, 405, 'POST only');
        if (req.headers['x-rs-client'] !== '1' || !/application\/json/.test(req.headers['content-type'] || '')) return send(res, 403, JSON.stringify({ ok: false, error: 'Bad request' }), { 'Content-Type': 'application/json' });
        const body = JSON.parse((await readBody(req, CFG.maxBodyMb * 1048576)).toString('utf8') || '{}');
        const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
        try {
          const r = await svc.handle({ token: cookieOf(req, 'rs_sid'), method: body.m, args: body.a, ip: clientIp(req), ua: req.headers['user-agent'] || '' });
          const sec = isHttps(req) ? '; Secure' : '';
          if (r.setToken) headers['Set-Cookie'] = `rs_sid=${r.setToken}; HttpOnly; Path=/; SameSite=Strict; Max-Age=604800${sec}`;
          if (r.clearToken) headers['Set-Cookie'] = `rs_sid=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${sec}`;
          return send(res, 200, JSON.stringify({ ok: true, data: r.data === undefined ? null : r.data }), headers);
        } catch (e) {
          const status = e.status || 400; if (!e.code && /^(TypeError|ReferenceError|RangeError|SyntaxError)$/.test(e.name)) console.error(new Date().toISOString(), body.m, e && e.stack || e);
          return send(res, status, JSON.stringify({ ok: false, error: e.message || String(e), code: e.code || 'error' }), headers);
        }
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        const f = staticFile(url); if (!f) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
        const ext = path.extname(f).toLowerCase();
        return send(res, 200, req.method === 'HEAD' ? '' : fs.readFileSync(f), { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300' });
      }
      return send(res, 404, 'Not found');
    } catch (e) { console.error(e); try { send(res, e.status || 500, JSON.stringify({ ok: false, error: e.status === 413 ? 'Upload too large' : 'Server error' }), { 'Content-Type': 'application/json' }); } catch (_) {} }
  });
  srv.requestTimeout = 120000;
  srv.listen(CFG.port, CFG.host, () => console.log(`R&S Sons Accounting server ${VERSION} running: http://localhost:${CFG.port}/app/  (data: ${CFG.dataDir})`));
  // daily backup of every company at the first chance each day
  setInterval(async () => { try { for (const c of await sys.companies()) await store.dailyBackup(c.id); } catch (e) { console.error('auto backup:', e.message); } }, 3600 * 1000).unref();
  const stop = () => { console.log('Stopping…'); srv.close(); store.closeAll(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  return srv;
}

if (require.main === module) {
  const [cmd, ...args] = process.argv.slice(2);
  (cmd ? cli(cmd, args) : start()).catch(e => { console.error(e && e.stack || e); process.exit(1); });
}
module.exports = { start, CFG };
