// Self-hosted storage: real SQLite files on disk (Node 22+ built-in node:sqlite, no native add-ons to compile).
//   <DATA_DIR>/system.db            users, sessions, companies list, branding, admin log
//   <DATA_DIR>/companies/<id>.rsdb  one SQLite file per company (same format as the v1.1 desktop app)
//   <DATA_DIR>/backups/<id>/...     automatic daily copies (VACUUM INTO = consistent snapshot) + deleted companies
// Writes run inside BEGIN IMMEDIATE ... COMMIT, so a request either saves completely or not at all.
// Node runs one request's database work at a time (the engine is synchronous), so two users saving at the
// same moment are applied one after the other; WAL mode + busy_timeout cover any outside reader (backup tools).
'use strict';
const fs = require('fs'), path = require('path');
const { DatabaseSync } = require('node:sqlite');
const core = require('../../app/core');

function norm(p) { return (p || []).map(v => v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v); }
class Adapter {   // gives node:sqlite the small sql.js-style surface the accounting engine uses
  constructor(db) { this.d = db; this.cache = new Map(); }
  st(sql) { let s = this.cache.get(sql); if (!s) { s = this.d.prepare(sql); if (this.cache.size > 400) this.cache.clear(); this.cache.set(sql, s); } return s; }
  allRows(sql, p) { return this.st(sql).all(...norm(p)).map(r => ({ ...r })); }
  run(sql, p) { if ((!p || !p.length) && /^\s*(BEGIN|COMMIT|ROLLBACK|PRAGMA|SAVEPOINT|RELEASE|CREATE|ALTER|DROP)/i.test(sql)) { this.d.exec(sql); return; } this.st(sql).run(...norm(p)); }
  exec(sql) { this.d.exec(sql); }
  prepare(sql) { const self = this; let rows = null, i = 0, cur = null, params = []; return { bind(p) { params = p || []; return true; }, step() { if (!rows) rows = self.allRows(sql, params); cur = rows[i++]; return !!cur; }, getAsObject() { return cur; }, free() {} }; }
  close() { this.cache.clear(); this.d.close(); }
}
function openDb(file) { const d = new DatabaseSync(file); d.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;'); return d; }

class NodeSysDriver {
  constructor(file) { this.a = new Adapter(openDb(file)); }
  async all(sql, p) { return this.a.allRows(sql, p || []); }
  async run(sql, p) { const r = this.a.st(sql).run(...norm(p || [])); return { changes: Number(r.changes || 0) }; }
}

class NodeCompanyStore {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'companies'); this.bdir = path.join(dataDir, 'backups'); this.open = new Map();
    fs.mkdirSync(this.dir, { recursive: true }); fs.mkdirSync(this.bdir, { recursive: true });
  }
  file(id) { if (!/^c[a-z0-9]+$/.test(id)) throw new Error('Bad company id'); return path.join(this.dir, id + '.rsdb'); }
  handle(id) {
    let h = this.open.get(id); if (h) return h;
    const f = this.file(id); if (!fs.existsSync(f)) throw new Error('Company file is missing on the server');
    const a = new Adapter(openDb(f)); const c = new core.Company(a, 'admin'); c.migrate();
    h = { a, c }; this.open.set(id, h); return h;
  }
  async read(id, fn) { const { c } = this.handle(id); c._txDepth = 0; return fn(c); }
  async write(id, fn) {
    const { a, c } = this.handle(id);
    a.exec('BEGIN IMMEDIATE'); c._txDepth = 1;
    try { const r = fn(c); a.exec('COMMIT'); return r; }
    catch (e) { try { a.exec('ROLLBACK'); } catch (_) {} throw e; }
    finally { c._txDepth = 0; }
  }
  async create(id, info, user) {
    const f = this.file(id); if (fs.existsSync(f)) throw new Error('Company already exists');
    const a = new Adapter(openDb(f)); core.Company.create(a, info, user); a.close();
  }
  async importBytes(id, bytes) {
    const f = this.file(id); const tmp = f + '.import';
    fs.writeFileSync(tmp, Buffer.from(bytes));
    let name;
    try { const a = new Adapter(new DatabaseSync(tmp)); try { const c = new core.Company(a); name = c.setting('name'); if (!name) throw new Error(); c.migrate(); } finally { a.close(); } }
    catch (e) { try { fs.unlinkSync(tmp); } catch (_) {} throw new Error('File is damaged or not an R&S Sons company file'); }
    fs.renameSync(tmp, f); return name;
  }
  snapshot(id, dest) { const { a } = this.handle(id); a.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`); }
  async exportBytes(id) { const tmp = path.join(this.bdir, `.export_${id}_${Date.now()}.rsdb`); try { this.snapshot(id, tmp); return fs.readFileSync(tmp); } finally { try { fs.unlinkSync(tmp); } catch (_) {} } }
  async size(id) { try { return fs.statSync(this.file(id)).size; } catch (_) { return 0; } }
  async remove(id) {
    const dir = path.join(this.bdir, id); fs.mkdirSync(dir, { recursive: true });
    try { this.snapshot(id, path.join(dir, `deleted_${Date.now()}.rsdb`)); } catch (_) {}
    const h = this.open.get(id); if (h) { try { h.a.close(); } catch (_) {} this.open.delete(id); }
    for (const ext of ['', '-wal', '-shm']) { try { fs.unlinkSync(this.file(id) + ext); } catch (_) {} }
  }
  async dailyBackup(id, keep = 30) {
    const dir = path.join(this.bdir, id); fs.mkdirSync(dir, { recursive: true });
    const name = `auto_${new Date().toISOString().slice(0, 10)}.rsdb`; const dest = path.join(dir, name);
    if (fs.existsSync(dest)) return false;
    this.snapshot(id, dest);
    const autos = fs.readdirSync(dir).filter(f => f.startsWith('auto_')).sort(); while (autos.length > keep) fs.unlinkSync(path.join(dir, autos.shift()));
    return true;
  }
  async listBackups(id) { const dir = path.join(this.bdir, id); return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.rsdb')).sort().reverse().map(f => ({ file: f, size: fs.statSync(path.join(dir, f)).size })) : []; }
  closeAll() { for (const [, h] of this.open) { try { h.a.close(); } catch (_) {} } this.open.clear(); }
}
module.exports = { NodeSysDriver, NodeCompanyStore, Adapter, openDb };
