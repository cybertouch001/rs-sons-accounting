// System database: users, sessions, companies list, branding, admin log, login rate-limit.
// Works on any async SQL driver with all(sql, params) and run(sql, params):
//   - self-hosted: node:sqlite file (store-node.js)   - hosted: Cloudflare D1 (worker.js)
'use strict';
const SYS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL COLLATE NOCASE, pw TEXT NOT NULL, role TEXT NOT NULL, active INTEGER DEFAULT 1, must_change INTEGER DEFAULT 0, companies TEXT DEFAULT '*', full_name TEXT, created_at TEXT, last_login TEXT, pw_changed TEXT)`,
  `CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, company_id TEXT, created_at INTEGER, last_seen INTEGER, expires_at INTEGER, ip TEXT, ua TEXT)`,
  `CREATE INDEX IF NOT EXISTS ix_sess_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS companies (id TEXT PRIMARY KEY, name TEXT NOT NULL, gstin TEXT, created_at TEXT, created_by TEXT, last_opened TEXT, restored_from TEXT)`,
  `CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)`,
  `CREATE TABLE IF NOT EXISTS admin_log (id INTEGER PRIMARY KEY, at TEXT, username TEXT, action TEXT, detail TEXT, ip TEXT)`,
  `CREATE TABLE IF NOT EXISTS login_attempts (k TEXT PRIMARY KEY, fails INTEGER DEFAULT 0, until INTEGER DEFAULT 0, last INTEGER DEFAULT 0)`,
];
class SysStore {
  constructor(driver) { this.d = driver; this.ready = null; }
  init() { if (!this.ready) this.ready = (async () => { for (const s of SYS_SCHEMA) await this.d.run(s, []); })(); return this.ready; }
  async all(sql, p = []) { await this.init(); return this.d.all(sql, p); }
  async get(sql, p = []) { return (await this.all(sql, p))[0] || null; }
  async run(sql, p = []) { await this.init(); return this.d.run(sql, p); }
  // users
  userByName(n) { return this.get('SELECT * FROM users WHERE username=? COLLATE NOCASE', [String(n || '')]); }
  userById(id) { return this.get('SELECT * FROM users WHERE id=?', [id]); }
  users() { return this.all('SELECT * FROM users ORDER BY username'); }
  async userCount() { const r = await this.get('SELECT COUNT(*) AS n FROM users'); return r ? Number(r.n) : 0; }
  async addUser(u) { await this.run('INSERT INTO users (username, pw, role, active, must_change, companies, full_name, created_at) VALUES (?,?,?,?,?,?,?,?)', [u.username, u.pw, u.role, u.active === false ? 0 : 1, u.must_change ? 1 : 0, u.companies || '*', u.full_name || null, new Date().toISOString()]); return this.userByName(u.username); }
  async updateUser(id, f) { const k = Object.keys(f); if (!k.length) return; await this.run(`UPDATE users SET ${k.map(x => x + '=?').join(',')} WHERE id=?`, [...k.map(x => f[x]), id]); }
  deleteUser(id) { return this.run('DELETE FROM users WHERE id=?', [id]); }
  // sessions
  addSession(s) { return this.run('INSERT INTO sessions (token_hash, user_id, company_id, created_at, last_seen, expires_at, ip, ua) VALUES (?,?,?,?,?,?,?,?)', [s.token_hash, s.user_id, null, s.now, s.now, s.expires_at, s.ip || '', (s.ua || '').slice(0, 200)]); }
  session(h) { return this.get('SELECT * FROM sessions WHERE token_hash=?', [h]); }
  touchSession(h, now, exp) { return this.run('UPDATE sessions SET last_seen=?, expires_at=? WHERE token_hash=?', [now, exp, h]); }
  setSessionCompany(h, cid) { return this.run('UPDATE sessions SET company_id=? WHERE token_hash=?', [cid, h]); }
  deleteSession(h) { return this.run('DELETE FROM sessions WHERE token_hash=?', [h]); }
  deleteUserSessions(uid, exceptHash) { return this.run('DELETE FROM sessions WHERE user_id=? AND token_hash<>?', [uid, exceptHash || '']); }
  purgeSessions(now) { return this.run('DELETE FROM sessions WHERE expires_at<?', [now]); }
  // companies
  companies() { return this.all('SELECT * FROM companies ORDER BY name'); }
  company(id) { return this.get('SELECT * FROM companies WHERE id=?', [id]); }
  addCompany(c) { return this.run('INSERT INTO companies (id, name, gstin, created_at, created_by, restored_from) VALUES (?,?,?,?,?,?)', [c.id, c.name, c.gstin || '', new Date().toISOString(), c.created_by || '', c.restored_from || null]); }
  updateCompany(id, f) { const k = Object.keys(f); return this.run(`UPDATE companies SET ${k.map(x => x + '=?').join(',')} WHERE id=?`, [...k.map(x => f[x]), id]); }
  deleteCompany(id) { return this.run('DELETE FROM companies WHERE id=?', [id]); }
  // key/value (branding etc.)
  async kv(k, dflt = null) { const r = await this.get('SELECT v FROM kv WHERE k=?', [k]); if (!r) return dflt; try { return JSON.parse(r.v); } catch (_) { return dflt; } }
  setKv(k, v) { return this.run('INSERT OR REPLACE INTO kv (k, v) VALUES (?,?)', [k, JSON.stringify(v)]); }
  // admin log
  log(username, action, detail, ip) { return this.run('INSERT INTO admin_log (at, username, action, detail, ip) VALUES (?,?,?,?,?)', [new Date().toISOString(), username || '', action, String(detail || '').slice(0, 500), ip || '']); }
  logs(n = 60) { return this.all('SELECT at, username AS user, action, detail, ip FROM admin_log ORDER BY id DESC LIMIT ?', [n]); }
  // login rate-limit
  attempt(k) { return this.get('SELECT * FROM login_attempts WHERE k=?', [k]); }
  setAttempt(k, fails, until, now) { return this.run('INSERT OR REPLACE INTO login_attempts (k, fails, until, last) VALUES (?,?,?,?)', [k, fails, until, now]); }
  clearAttempt(k) { return this.run('DELETE FROM login_attempts WHERE k=?', [k]); }
}
module.exports = { SysStore, SYS_SCHEMA };
