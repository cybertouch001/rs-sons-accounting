// R&S Sons Accounting - hosted multi-user server on Cloudflare Workers (rs-sons-accounting.sites.tab.bot).
// Same API code as the self-hosted Node server (lib/service.js). Storage:
//   D1 (SQLite)  : users, sessions, companies list, branding, admin log, login rate-limit
//   R2 (objects) : one SQLite file per company, read and written with sql.js; every save is a compare-and-swap on the
//                  file's ETag, so if two users save at the same moment one save is retried on top of the other — never lost.
// Static: landing page + downloads (chunk-joined) + the web app under /app/.
import initSqlJs from './vendor/sql-asm-worker.js';
import * as XLSX from 'xlsx';
import QRCode from 'qrcode';
import { pbkdf2 as noblePbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';
const core = require('../app/core');
const { SysStore } = require('./lib/sysstore');
const { createService } = require('./lib/service');
import { DOWNLOADS, ADMIN_BOOTSTRAP, VERSION } from './worker-config.js';
import { lineReader } from './lib/mailer.js';

let SQLp = null; const getSQL = () => (SQLp = SQLp || initSqlJs());
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const enc = new TextEncoder();
const CR = {
  async pbkdf2(pw, saltHex, iter) {
    if (iter <= 100000) { const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']); return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(saltHex), iterations: iter }, key, 256)); }
    return hex(noblePbkdf2(nobleSha256, enc.encode(pw), enc.encode(saltHex), { c: iter, dkLen: 32 }));   // v1.1 users (120k rounds), re-hashed after login
  },
  randomHex: n => hex(crypto.getRandomValues(new Uint8Array(n))),
  randomToken: () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  sha256Hex: async s => hex(await crypto.subtle.digest('SHA-256', enc.encode(String(s)))),
  safeEqual: (a, b) => { a = String(a); b = String(b); if (a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; },
  toB64: bytes => { const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); },
  fromB64: s => { const b = atob(String(s)); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; },
  utf8: s => enc.encode(s),
};
// rows changed + schema version: equal before and after a write = the write changed nothing (null = unknown → always upload)
function totalChanges(db) { try { const a = db.exec('SELECT total_changes()'), b = db.exec('PRAGMA schema_version'); return a[0].values[0][0] + ':' + b[0].values[0][0]; } catch (_) { return null; } }
class D1Driver { constructor(db) { this.db = db; } async all(sql, p) { return (await this.db.prepare(sql).bind(...(p || [])).all()).results || []; } async run(sql, p) { const r = await this.db.prepare(sql).bind(...(p || [])).run(); return { changes: r.meta && r.meta.changes || 0 }; } }

// ---- company files in R2 with compare-and-swap writes ----
class R2CompanyStore {
  constructor(bucket) { this.b = bucket; this.cache = new Map(); this.locks = new Map(); }
  key(id) { if (!/^c[a-z0-9]+$/.test(id)) throw new Error('Bad company id'); return `companies/${id}.rsdb`; }
  lock(id, fn) { const prev = this.locks.get(id) || Promise.resolve(); const next = prev.catch(() => {}).then(fn); this.locks.set(id, next.catch(() => {})); return next; }
  async load(id, force) {
    const SQL = await getSQL(); const k = this.key(id); const c = this.cache.get(id);
    // v2.1: a file checked against R2 in the last 300 ms (e.g. the calls of one batch) is not checked again
    if (c && !force && Date.now() - (c.checked || 0) < 300) return c;
    if (c && !force) { const h = await this.b.head(k); if (h && h.etag === c.etag) { c.checked = Date.now(); return c; } }
    const o = await this.b.get(k); if (!o) throw new Error('Company file is missing on the server');
    const db = new SQL.Database(new Uint8Array(await o.arrayBuffer()));
    const comp = new core.Company(db, 'admin'); comp.migrate();
    if (c) { try { c.db.close(); } catch (_) {} }
    const e = { db, comp, etag: o.etag, checked: Date.now() }; this.cache.set(id, e); return e;
  }
  read(id, fn) { return this.lock(id, async () => { const e = await this.load(id); e.comp._txDepth = 0; return fn(e.comp); }); }
  write(id, fn) {
    return this.lock(id, async () => {
      for (let attempt = 0; attempt < 6; attempt++) {
        const e = await this.load(id, attempt > 0);
        const before = totalChanges(e.db);
        e.db.run('BEGIN'); e.comp._txDepth = 1; let r;
        try { r = fn(e.comp); e.db.run('COMMIT'); } catch (err) { try { e.db.run('ROLLBACK'); } catch (_) {} e.comp._txDepth = 0; throw err; }
        e.comp._txDepth = 0;
        if (before !== null && totalChanges(e.db) === before) return r;      // v2.1: nothing changed (e.g. opening a company with no recurring entry due) → no upload
        const bytes = e.db.export();      // note: export() resets sql.js prepared statements; the engine prepares per call
        const put = await this.b.put(this.key(id), bytes, { onlyIf: { etagMatches: e.etag } });
        if (put) { e.etag = put.etag; return r; }
        this.cache.delete(id); try { e.db.close(); } catch (_) {}         // someone else saved first: reload and apply again
      }
      throw new Error('The server is busy saving other changes to this company. Please try again.');
    });
  }
  async create(id, info, user) { const SQL = await getSQL(); const db = new SQL.Database(); core.Company.create(db, info, user); await this.b.put(this.key(id), db.export()); db.close(); }
  async importBytes(id, bytes) {
    const SQL = await getSQL(); let db; try { db = new SQL.Database(bytes); } catch (_) { throw new Error('File is damaged or not an R&S Sons company file'); }
    let name; try { const c = new core.Company(db); name = c.setting('name'); if (!name) throw new Error(); c.migrate(); } catch (_) { db.close(); throw new Error('File is damaged or not an R&S Sons company file'); }
    await this.b.put(this.key(id), db.export()); db.close(); return name;
  }
  async exportBytes(id) { const o = await this.b.get(this.key(id)); if (!o) throw new Error('Company file missing'); return new Uint8Array(await o.arrayBuffer()); }
  async size(id) { const h = await this.b.head(this.key(id)); return h ? h.size : 0; }
  async remove(id) { const o = await this.b.get(this.key(id)); if (o) await this.b.put(`backups/${id}/deleted_${Date.now()}.rsdb`, await o.arrayBuffer()); await this.b.delete(this.key(id)); this.cache.delete(id); }
  async dailyBackup(id, keep = 30) {
    const k = `backups/${id}/auto_${new Date().toISOString().slice(0, 10)}.rsdb`; if (await this.b.head(k)) return false;
    const o = await this.b.get(this.key(id)); if (!o) return false; await this.b.put(k, await o.arrayBuffer());
    const l = await this.b.list({ prefix: `backups/${id}/auto_` }); const ks = l.objects.map(x => x.key).sort(); while (ks.length > keep) await this.b.delete(ks.shift());
    return true;
  }
  async listBackups(id) { const l = await this.b.list({ prefix: `backups/${id}/` }); return l.objects.map(o => ({ file: o.key.split('/').pop(), size: o.size })).sort((a, b) => b.file.localeCompare(a.file)); }
}

// v2.2: outgoing TCP for the OTP mailer (SMTP over TLS: 465, or 587 + STARTTLS)
function cfSock(s) {
  const w = s.writable.getWriter(); const r = s.readable.getReader(); const te = new TextEncoder();
  return { readLine: lineReader(async () => { const x = await r.read(); return x.done ? null : x.value; }), write: (str) => w.write(te.encode(str)),
    startTls: async () => { w.releaseLock(); r.releaseLock(); return cfSock(s.startTls()); }, close: () => { try { s.close(); } catch (_) {} } };
}
async function netOpen(host, port, mode) { const { connect } = await import('cloudflare:sockets'); const s = connect({ hostname: host, port: Number(port) }, { secureTransport: mode === 'ssl' ? 'on' : mode === 'none' ? 'off' : 'starttls', allowHalfOpen: false }); if (s.opened) await s.opened; return cfSock(s); }

let PROBE = null;
async function mailProbe() {
  if (PROBE && Date.now() - PROBE.t < 600000) return PROBE.r;
  const t0 = Date.now(); let r;
  try { const s = await netOpen('smtp.gmail.com', 465, 'ssl'); const g = await Promise.race([s.readLine(), new Promise((_, j) => setTimeout(() => j(new Error('no greeting in 10 s')), 10000))]); try { await s.write('QUIT\r\n'); } catch (_) {} s.close(); r = { ok: /^220/.test(g || ''), smtp: 'smtp.gmail.com:465', greeting: String(g || '').slice(0, 24), ms: Date.now() - t0 }; }
  catch (e) { r = { ok: false, smtp: 'smtp.gmail.com:465', error: String(e && e.message || e).slice(0, 200), ms: Date.now() - t0 }; }
  PROBE = { t: Date.now(), r }; return r;
}
let SVC = null;
function service(env) {
  if (SVC) return SVC;
  const sys = new SysStore(new D1Driver(env.DB)); const store = new R2CompanyStore(env.FILES);
  // v2.2: before the first schema change, a full copy of the system tables is written to R2 (backups/_system/)
  sys.onMigrate = async (dump) => { await env.FILES.put(`backups/_system/pre-${VERSION}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, new TextEncoder().encode(JSON.stringify(dump))); };
  SVC = { sys, svc: createService({ sys, store, crypto: CR, XLSX, QRCode, version: VERSION, netOpen, dataLabel: 'Hosted server (rs-sons-accounting.sites.tab.bot)' }) };
  return SVC;
}
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'same-origin', 'Strict-Transport-Security': 'max-age=31536000' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src 'self' blob: data:; frame-ancestors 'self'; base-uri 'none'; form-action 'self'";
const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: Object.assign({ 'content-type': 'application/json', 'cache-control': 'no-store' }, SEC, extra) });
function cookieOf(req, name) { const h = req.headers.get('cookie') || ''; for (const part of h.split(';')) { const [k, ...v] = part.trim().split('='); if (k === name) return decodeURIComponent(v.join('=')); } return null; }

async function serveDownload(env, req, d) {
  // big files are stored as ~900 KB parts and joined here as one stream (same bytes as the original file)
  const headers = Object.assign({ 'content-type': d.type || 'application/octet-stream', 'content-disposition': `attachment; filename="${d.name}"`, 'content-length': String(d.size), 'cache-control': 'public, max-age=3600' }, SEC);
  if (req.method === 'HEAD') return new Response(null, { headers });
  const { readable, writable } = new FixedLengthStream(d.size);
  (async () => { for (const p of d.parts) { const r = await env.ASSETS.fetch(new Request(new URL(p, req.url))); if (!r.ok) { await writable.abort('part missing'); return; } await r.body.pipeTo(writable, { preventClose: true }); } await writable.close(); })();
  return new Response(readable, { headers });
}

let BOOTED = false;   // checked once per isolate: the admin is created only when no user exists
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url); const p = url.pathname;
    if (p === '/api/health') return json({ ok: true, app: 'rs-sons-accounting', version: VERSION, mode: 'hosted' });
    if (p === '/api/health/mail') return json(await mailProbe());   // v2.2: can this server reach Gmail's mail server? (fixed host, no login, cached 10 min)
    if (p === '/api/call') {
      if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
      if (req.headers.get('x-rs-client') !== '1' || !/application\/json/.test(req.headers.get('content-type') || '')) return json({ ok: false, error: 'Bad request' }, 403);
      const len = Number(req.headers.get('content-length') || 0); if (len > 60 * 1048576) return json({ ok: false, error: 'Upload too large' }, 413);
      const { sys, svc } = service(env);
      if (ADMIN_BOOTSTRAP && !BOOTED) { await svc.bootstrapAdmin(ADMIN_BOOTSTRAP.username, ADMIN_BOOTSTRAP.pw, true); BOOTED = true; }
      let body; try { body = await req.json(); } catch (_) { return json({ ok: false, error: 'Bad JSON' }, 400); }
      try {
        const r = await svc.handle({ token: cookieOf(req, 'rs_sid'), method: body.m, args: body.a, ip: req.headers.get('cf-connecting-ip') || '', ua: req.headers.get('user-agent') || '', defer: ctx && typeof ctx.waitUntil === 'function' ? p => ctx.waitUntil(p) : null });
        const h = {};
        if (r.setToken) h['set-cookie'] = `rs_sid=${r.setToken}; HttpOnly; Secure; Path=/; SameSite=Strict; Max-Age=${r.cookieMaxAge || 604800}`;
        if (r.clearToken) h['set-cookie'] = 'rs_sid=; HttpOnly; Secure; Path=/; SameSite=Strict; Max-Age=0';
        return json({ ok: true, data: r.data === undefined ? null : r.data }, 200, h);
      } catch (e) { if (!e.code && /^(TypeError|ReferenceError|RangeError|SyntaxError)$/.test(e.name)) console.log('api error', body && body.m, e && e.stack || e); return json({ ok: false, error: e.message || String(e), code: e.code || 'error' }, e.status || 400); }
    }
    if (p.startsWith('/api/')) return json({ ok: false, error: 'Not found' }, 404);
    const d = DOWNLOADS[p]; if (d) return serveDownload(env, req, d);
    if (p.startsWith('/parts/')) return new Response('Not found', { status: 404 });
    if (p === '/app') return Response.redirect(url.origin + '/app/', 302);
    const r = await env.ASSETS.fetch(req);
    if (p.startsWith('/app/') || p.startsWith('/assets/') || p.startsWith('/core/')) { const h = new Headers(r.headers); for (const [k, v] of Object.entries(SEC)) h.set(k, v); h.set('content-security-policy', CSP); if (p.endsWith('.html') || p.endsWith('/')) h.set('cache-control', 'no-cache'); return new Response(r.body, { status: r.status, headers: h }); }
    return r;
  },
};
