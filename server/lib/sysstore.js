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
  // v2.2: live updates between users (one row per save) and the email OTP login step
  `CREATE TABLE IF NOT EXISTS changes (seq INTEGER PRIMARY KEY AUTOINCREMENT, company_id TEXT NOT NULL, at INTEGER, username TEXT, full_name TEXT, kind TEXT, label TEXT, sess TEXT)`,
  `CREATE INDEX IF NOT EXISTS ix_changes_co ON changes(company_id, seq)`,
  `CREATE TABLE IF NOT EXISTS otp_challenges (id_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, code_hash TEXT, created_at INTEGER, expires_at INTEGER, attempts INTEGER DEFAULT 0, sends INTEGER DEFAULT 1, last_sent INTEGER, remember INTEGER DEFAULT 0, ip TEXT, mail_ok INTEGER DEFAULT 1)`,
  `CREATE INDEX IF NOT EXISTS ix_otp_user ON otp_challenges(user_id, created_at)`,
];
// v2.2 columns added to an existing users table (old rows keep working: no email = no OTP)
const USER_COLS = [['email', 'TEXT'], ['otp', 'INTEGER DEFAULT 1'], ['email_verified', 'INTEGER DEFAULT 0'], ['backup_codes', 'TEXT']];
const SCHEMA_VERSION = 22;
class SysStore {
  constructor(driver) { this.d = driver; this.ready = null; }
  init() {
    if (!this.ready) this.ready = (async () => {
      for (const s of SYS_SCHEMA) await this.d.run(s, []);
      const cols = (await this.d.all('PRAGMA table_info(users)', [])).map(c => c.name);
      const missing = USER_COLS.filter(([n]) => !cols.includes(n));
      if (missing.length) {
        if (this.onMigrate) {   // keep a full copy of the system tables before the first change (never blocks the upgrade)
          try { const dump = { at: new Date().toISOString(), tables: {} }; for (const t of ['users', 'companies', 'kv', 'admin_log']) dump.tables[t] = await this.d.all(`SELECT * FROM ${t}`, []); await this.onMigrate(dump); } catch (e) { try { console.log('pre-migration copy failed', e && e.message); } catch (_) {} }
        }
        for (const [n, t] of missing) { try { await this.d.run(`ALTER TABLE users ADD COLUMN ${n} ${t}`, []); } catch (e) { if (!/duplicate column/i.test(String(e && e.message))) throw e; } }
        await this.d.run('INSERT OR REPLACE INTO kv (k, v) VALUES (?,?)', ['schema_version', JSON.stringify(SCHEMA_VERSION)]);
      }
    })().catch(e => { this.ready = null; throw e; });
    return this.ready;
  }
  async all(sql, p = []) { await this.init(); return this.d.all(sql, p); }
  async get(sql, p = []) { return (await this.all(sql, p))[0] || null; }
  async run(sql, p = []) { await this.init(); return this.d.run(sql, p); }
  // users
  userByName(n) { return this.get('SELECT * FROM users WHERE username=? COLLATE NOCASE', [String(n || '')]); }
  userById(id) { return this.get('SELECT * FROM users WHERE id=?', [id]); }
  users() { return this.all('SELECT * FROM users ORDER BY username'); }
  async userCount() { const r = await this.get('SELECT COUNT(*) AS n FROM users'); return r ? Number(r.n) : 0; }
  async addUser(u) { await this.run('INSERT INTO users (username, pw, role, active, must_change, companies, full_name, created_at, email, otp) VALUES (?,?,?,?,?,?,?,?,?,?)', [u.username, u.pw, u.role, u.active === false ? 0 : 1, u.must_change ? 1 : 0, u.companies || '*', u.full_name || null, new Date().toISOString(), u.email || null, u.otp === false ? 0 : 1]); return this.userByName(u.username); }
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
  // v2.2 live updates
  addChange(c) { return this.run('INSERT INTO changes (company_id, at, username, full_name, kind, label, sess) VALUES (?,?,?,?,?,?,?)', [c.company_id, c.at, c.username || '', c.full_name || '', c.kind || '', String(c.label || '').slice(0, 200), c.sess || '']); }
  changesSince(cid, seq, n = 50) { return this.all('SELECT seq, at, username, full_name, kind, label, sess FROM changes WHERE company_id=? AND seq>? ORDER BY seq LIMIT ?', [cid, seq, n]); }
  async lastChange(cid) { const r = await this.get('SELECT MAX(seq) AS s FROM changes WHERE company_id=?', [cid]); return r && r.s != null ? Number(r.s) : 0; }
  purgeChanges(before) { return this.run('DELETE FROM changes WHERE at<?', [before]); }
  // v2.2 email OTP
  addChallenge(c) { return this.run('INSERT INTO otp_challenges (id_hash, user_id, code_hash, created_at, expires_at, attempts, sends, last_sent, remember, ip, mail_ok) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [c.id_hash, c.user_id, c.code_hash, c.now, c.expires_at, 0, 1, c.now, c.remember ? 1 : 0, c.ip || '', c.mail_ok ? 1 : 0]); }
  challenge(h) { return this.get('SELECT * FROM otp_challenges WHERE id_hash=?', [h]); }
  updateChallenge(h, f) { const k = Object.keys(f); return this.run(`UPDATE otp_challenges SET ${k.map(x => x + '=?').join(',')} WHERE id_hash=?`, [...k.map(x => f[x]), h]); }
  deleteChallenge(h) { return this.run('DELETE FROM otp_challenges WHERE id_hash=?', [h]); }
  async recentChallenges(uid, since) { const r = await this.get('SELECT COUNT(*) AS n, COALESCE(SUM(sends),0) AS s FROM otp_challenges WHERE user_id=? AND created_at>?', [uid, since]); return r ? Number(r.s) : 0; }
  purgeChallenges(before) { return this.run('DELETE FROM otp_challenges WHERE expires_at<?', [before]); }
}
module.exports = { SysStore, SYS_SCHEMA };
