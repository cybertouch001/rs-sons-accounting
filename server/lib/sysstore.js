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
  // v2.3: "Forgot password?" — one row per reset code sent by email (only hashes are stored; 10 minutes, 5 tries, one use)
  `CREATE TABLE IF NOT EXISTS pw_resets (id_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, code_hash TEXT, created_at INTEGER, expires_at INTEGER, attempts INTEGER DEFAULT 0, ip TEXT, mail_ok INTEGER DEFAULT 1)`,
  `CREATE INDEX IF NOT EXISTS ix_pwr_user ON pw_resets(user_id, created_at)`,
  // v2.4: a device the admin (or the user) logged out — remembered for 7 days so that device can show WHY it was logged out
  `CREATE TABLE IF NOT EXISTS session_kicks (token_hash TEXT PRIMARY KEY, user_id INTEGER, at INTEGER, by_user TEXT, reason TEXT)`,
  // v2.4: one-time deploy operations (e.g. a temporary test user) — each id runs once, ever
  `CREATE TABLE IF NOT EXISTS deploy_ops (id TEXT PRIMARY KEY, at TEXT, kind TEXT, detail TEXT)`,
];
// v2.2 columns added to an existing users table (old rows keep working: no email = no OTP)
const USER_COLS = [['email', 'TEXT'], ['otp', 'INTEGER DEFAULT 1'], ['email_verified', 'INTEGER DEFAULT 0'], ['backup_codes', 'TEXT']];
// v2.4 columns added to an existing sessions table (old sessions keep working; their device is read from the user-agent)
const SESS_COLS = [['client', 'TEXT'], ['device', 'TEXT'], ['geo', 'TEXT']];
const SCHEMA_VERSION = 24;
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
      const scols = (await this.d.all('PRAGMA table_info(sessions)', [])).map(c => c.name);
      const smissing = SESS_COLS.filter(([n]) => !scols.includes(n));
      if (smissing.length) {
        if (this.onMigrate) {   // v2.4: same full copy of the system tables before the sessions table changes
          try { const dump = { at: new Date().toISOString(), reason: 'v2.4 sessions columns', tables: {} }; for (const t of ['users', 'companies', 'kv', 'admin_log']) dump.tables[t] = await this.d.all(`SELECT * FROM ${t}`, []); await this.onMigrate(dump); } catch (e) { try { console.log('pre-migration copy failed', e && e.message); } catch (_) {} }
        }
        for (const [n, t] of smissing) { try { await this.d.run(`ALTER TABLE sessions ADD COLUMN ${n} ${t}`, []); } catch (e) { if (!/duplicate column/i.test(String(e && e.message))) throw e; } }
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
  addSession(s) { return this.run('INSERT INTO sessions (token_hash, user_id, company_id, created_at, last_seen, expires_at, ip, ua, client, device, geo) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [s.token_hash, s.user_id, null, s.now, s.now, s.expires_at, s.ip || '', (s.ua || '').slice(0, 300), s.client || '', (s.device || '').slice(0, 80), (s.geo || '').slice(0, 80)]); }
  session(h) { return this.get('SELECT * FROM sessions WHERE token_hash=?', [h]); }
  touchSession(h, now, exp) { return this.run('UPDATE sessions SET last_seen=?, expires_at=? WHERE token_hash=?', [now, exp, h]); }
  setSessionCompany(h, cid) { return this.run('UPDATE sessions SET company_id=? WHERE token_hash=?', [cid, h]); }
  deleteSession(h) { return this.run('DELETE FROM sessions WHERE token_hash=?', [h]); }
  deleteUserSessions(uid, exceptHash) { return this.run('DELETE FROM sessions WHERE user_id=? AND token_hash<>?', [uid, exceptHash || '']); }
  // v2.4 logged-in devices
  allSessions() { return this.all('SELECT s.*, u.username, u.full_name, u.role, u.active FROM sessions s LEFT JOIN users u ON u.id=s.user_id ORDER BY s.last_seen DESC', []); }
  userSessions(uid) { return this.all('SELECT * FROM sessions WHERE user_id=? ORDER BY last_seen DESC', [uid]); }
  sessionByPublicId(pid) { return this.get('SELECT * FROM sessions WHERE substr(token_hash,1,16)=?', [String(pid || '').slice(0, 16)]); }
  setSessionDevice(h, f) { const k = Object.keys(f); if (!k.length) return; return this.run(`UPDATE sessions SET ${k.map(x => x + '=?').join(',')} WHERE token_hash=?`, [...k.map(x => f[x]), h]); }
  async kickSessions(rows, by, reason, now) {
    for (const r of rows) { await this.run('INSERT OR REPLACE INTO session_kicks (token_hash, user_id, at, by_user, reason) VALUES (?,?,?,?,?)', [r.token_hash, r.user_id, now, by || '', String(reason || '').slice(0, 200)]); await this.run('DELETE FROM sessions WHERE token_hash=?', [r.token_hash]); }
    if (Math.random() < 0.2) await this.run('DELETE FROM session_kicks WHERE at<?', [now - 7 * 86400000]);
    return rows.length;
  }
  kick(h) { return this.get('SELECT * FROM session_kicks WHERE token_hash=?', [h]); }
  deployOp(id) { return this.get('SELECT * FROM deploy_ops WHERE id=?', [id]); }
  addDeployOp(id, kind, detail) { return this.run('INSERT OR IGNORE INTO deploy_ops (id, at, kind, detail) VALUES (?,?,?,?)', [id, new Date().toISOString(), kind, String(detail || '').slice(0, 300)]); }
  loginHistory(n = 100, username) { return username ? this.all("SELECT at, username AS user, action, detail, ip FROM admin_log WHERE (action LIKE 'Login%' OR action LIKE 'Logout%' OR action LIKE 'Device%' OR action LIKE 'User removed%') AND username=? COLLATE NOCASE ORDER BY id DESC LIMIT ?", [username, n])
    : this.all("SELECT at, username AS user, action, detail, ip FROM admin_log WHERE action LIKE 'Login%' OR action LIKE 'Logout%' OR action LIKE 'Device%' OR action LIKE 'User removed%' ORDER BY id DESC LIMIT ?", [n]); }
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
  // v2.3 password reset by email
  addReset(r) { return this.run('INSERT INTO pw_resets (id_hash, user_id, code_hash, created_at, expires_at, attempts, ip, mail_ok) VALUES (?,?,?,?,?,?,?,?)', [r.id_hash, r.user_id, r.code_hash, r.now, r.expires_at, 0, r.ip || '', r.mail_ok ? 1 : 0]); }
  reset(h) { return this.get('SELECT * FROM pw_resets WHERE id_hash=?', [h]); }
  updateReset(h, f) { const k = Object.keys(f); return this.run(`UPDATE pw_resets SET ${k.map(x => x + '=?').join(',')} WHERE id_hash=?`, [...k.map(x => f[x]), h]); }
  deleteReset(h) { return this.run('DELETE FROM pw_resets WHERE id_hash=?', [h]); }
  deleteUserResets(uid) { return this.run('DELETE FROM pw_resets WHERE user_id=?', [uid]); }
  invalidateUserResets(uid) { return this.run("UPDATE pw_resets SET expires_at=0, code_hash='' WHERE user_id=?", [uid]); }   // kept (for the hourly count) but unusable
  async recentResets(uid, since) { const r = await this.get('SELECT COUNT(*) AS n FROM pw_resets WHERE user_id=? AND created_at>?', [uid, since]); return r ? Number(r.n) : 0; }
  purgeResets(before) { return this.run('DELETE FROM pw_resets WHERE created_at<?', [before]); }
}
module.exports = { SysStore, SYS_SCHEMA };
