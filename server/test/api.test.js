// Server API tests (self-hosted Node server + hosted Worker code path): node test/api.test.js
'use strict';
const assert = require('assert'); const { spawn } = require('child_process'); const path = require('path'); const fs = require('fs'); const os = require('os'); const crypto = require('crypto');
let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; console.log('  ✓ ' + m); };
async function rejects(p, re, m) { try { await p; } catch (e) { assert.ok(re.test(e.message) || re.test(e.code || ''), m + ' — got: ' + e.message); pass++; console.log('  ✓ ' + m); return e; } assert.fail(m + ' — did not fail'); }
function startServer(extraEnv = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-api-')); const port = 19000 + Math.floor(Math.random() * 3000);
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(port), DATA_DIR: dir, ADMIN_PASSWORD: 'Start#Pass2026', ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
  return { p, dir, port, base: `http://127.0.0.1:${port}`, log: () => out };
}
function client(base) {
  let cookie = '';
  return { get cookie() { return cookie; }, set cookie(v) { cookie = v; },
    async call(m, ...a) { const r = await fetch(base + '/api/call', { method: 'POST', headers: { 'content-type': 'application/json', 'x-rs-client': '1', cookie }, body: JSON.stringify({ m, a }) }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; const j = await r.json(); if (!j.ok) { const e = new Error(j.error); e.code = j.code; e.status = r.status; throw e; } return j.data; } };
}
async function waitUp(base) { for (let i = 0; i < 80; i++) { try { const r = await fetch(base + '/api/health'); if (r.ok) return; } catch (_) {} await new Promise(r => setTimeout(r, 100)); } throw new Error('server did not start'); }

async function v1Files() {
  // a company file + system.json exactly like the v1.1 desktop app writes them (sql.js export, PBKDF2-SHA256 120k user hashes)
  const initSqlJs = require(path.join(__dirname, '..', '..', 'app', 'node_modules', 'sql.js'));
  const { Company } = require('../../app/core'); const SQL = await initSqlJs(); const db = new SQL.Database();
  const c = Company.create(db, { name: 'Old Desktop Traders', state_code: '09', books_begin: '2026-04-01' }, 'admin');
  const cash = c.ledgerByName('Cash').id; const sales = c.ledgerByName('Sales Account').id;
  c.saveVoucher({ vtype: 'RCT', date: '2026-06-01', lines: [{ ledger_id: cash, dr: 1234, cr: 0 }, { ledger_id: sales, dr: 0, cr: 1234 }] });
  db.run("DROP TABLE IF EXISTS itr_profiles"); // look like a v1.1 file (no v2 tables)
  const bytes = Buffer.from(db.export());
  const salt = crypto.randomBytes(16).toString('hex');
  const sys = { users: [{ username: 'munim', salt, hash: crypto.pbkdf2Sync('Old#Munim2025', salt, 120000, 32, 'sha256').toString('hex'), role: 'operator', active: true }], companies: [] };
  return { bytes, sys };
}

async function scenario(label, mk, opts = {}) {
  console.log(`\n${label}`);
  const admin = mk(), op = mk(), viewer = mk(), other = mk();
  // ---- login, password rules, rate limit ----
  await rejects(admin.call('company.list'), /log in/i, 'no session → refused');
  const u = await admin.call('auth.login', 'admin', 'Start#Pass2026'); ok(u.mustChange, 'bootstrap admin must change password');
  await rejects(admin.call('company.list'), /new password/i, 'before changing it, other actions are blocked');
  await admin.call('auth.changePassword', 'Start#Pass2026', 'Ganga#River2026'); ok(true, 'password changed');
  for (let i = 0; i < 5; i++) await rejects(other.call('auth.login', 'admin', 'wrong' + i), /wrong username or password/i, `wrong password #${i + 1} refused`);
  await rejects(other.call('auth.login', 'admin', 'Ganga#River2026'), /too many/i, 'after 5 wrong tries even the right password is locked out for a while');
  // ---- users & roles ----
  const c1 = await admin.call('company.create', { name: 'Shiv Traders', state_code: '09', books_begin: '2026-04-01' });
  const c2 = await admin.call('company.create', { name: 'Private Co', state_code: '09' });
  await admin.call('users.save', { username: 'ravi', role: 'operator', password: 'Kashi#Strong2026', mustChange: false, companies: [c1.id] });
  await admin.call('users.save', { username: 'seema', role: 'viewer', password: 'Ghat#Viewer2026', mustChange: false });
  await op.call('auth.login', 'ravi', 'Kashi#Strong2026'); await viewer.call('auth.login', 'seema', 'Ghat#Viewer2026');
  const opList = await op.call('company.list'); ok(opList.length === 1 && opList[0].id === c1.id, 'operator sees only the company given to him');
  await rejects(op.call('company.open', c2.id), /access/i, 'operator cannot open a company not given to him');
  await op.call('company.open', c1.id); await viewer.call('company.open', c1.id); await admin.call('company.open', c1.id);
  await rejects(op.call('users.list'), /not allowed/i, 'operator cannot list users');
  await rejects(op.call('company.create', { name: 'X' }), /not allowed/i, 'operator cannot create companies');
  await rejects(viewer.call('c', 'saveLedger', { name: 'Hack', group_id: 1 }), /not allowed/i, 'viewer cannot create a ledger');
  ok((await viewer.call('c', 'trialBalance', {})).rows.length >= 0, 'viewer can read reports');
  await rejects(op.call('c', 'sqlQuery', 'select 1'), /not allowed/i, 'operator cannot run the admin SQL tool');
  await rejects(op.call('c', 'dropEverything'), /unknown action/i, 'unknown actions refused');
  // ---- two users at the same time ----
  const L = await admin.call('c', 'ledgers'); const cash = L.find(l => l.name === 'Cash').id;
  const g = (await admin.call('c', 'groups')).find(x => x.name === 'Indirect Expenses').id;
  const exp = await admin.call('c', 'saveLedger', { name: 'Misc Office Exp', group_id: g });
  const jobs = []; for (let i = 0; i < 10; i++) jobs.push((i % 2 ? admin : op).call('c', 'saveVoucher', { vtype: 'PMT', date: '2026-10-15', narration: 'parallel ' + i, lines: [{ ledger_id: cash, dr: 0, cr: 100 + i }, { ledger_id: exp, dr: 100 + i, cr: 0 }] }));
  const res = await Promise.all(jobs);
  const nums = res.map(r => r.number); ok(new Set(nums).size === 10, `10 saves at the same moment by 2 users → 10 vouchers, no number used twice (${nums.slice(0, 3).join(', ')}…)`);
  const tot = (await viewer.call('c', 'ledgerBalance', exp, '2027-03-31')); ok(Math.abs(tot - 1045) < 0.01, 'all 10 amounts are in the books (₹1,045)');
  const v = await op.call('c', 'voucher', res[0].id); const vb = await admin.call('c', 'voucher', res[0].id);
  const toInput = x => ({ id: x.id, vtype: x.vtype, date: x.date, narration: x.narration, base_rev: x.rev || 0, lines: x.entries.map(e => ({ ledger_id: e.ledger_id, dr: e.dr, cr: e.cr })) });
  const a1 = toInput(v); a1.narration = 'ravi edit'; await op.call('c', 'saveVoucher', a1);
  const b1 = toInput(vb); b1.narration = 'admin edit';
  await rejects(admin.call('c', 'saveVoucher', b1), /changed by ravi/i, 'same voucher edited by two users: the later save is refused and names ravi');
  ok((await admin.call('c', 'voucher', res[0].id)).narration === 'ravi edit', "ravi's edit was not overwritten");
  // ---- audit trail ----
  const au = await admin.call('c', 'auditLog', {}); const users = new Set(au.rows.map(r => r.user || r.username));
  ok(users.has('ravi') && users.has('admin'), 'audit trail records which user made each change (ravi, admin)');
  const alog = await admin.call('admin.log'); ok(alog.some(x => x.action === 'Login failed') && alog.some(x => x.action === 'User created'), 'server log has failed logins and user changes');
  // ---- deactivation & password reset end sessions ----
  await admin.call('users.save', { username: 'seema', role: 'viewer', active: false, companies: '*' });
  await rejects(viewer.call('c', 'trialBalance', {}), /log in/i, 'deactivated user is logged out immediately');
  // ---- backup / restore / v1.1 import ----
  const bk = await admin.call('company.backup', c1.id); ok(bk.__file.size > 10000 && /\.rsbak$/.test(bk.__file.name), 'backup download (.rsbak) works');
  const rs = await admin.call('company.restore', { name: 'shiv.rsbak', b64: bk.__file.b64 }); ok(/Restored/.test(rs.name), 'backup restores as a new company');
  const { bytes, sys } = await v1Files();
  const imp = await admin.call('company.restore', { name: 'Old Desktop Traders_backup.rsbak', b64: bytes.toString('base64') }); ok(imp.name === 'Old Desktop Traders', 'v1.1 desktop backup imported into the server');
  await admin.call('company.open', imp.id); const db = await admin.call('c', 'dayBook', { from: '2026-04-01', to: '2027-03-31' }); ok(db.rows.length === 1, 'its voucher is there after import');
  const ui = await admin.call('users.importV1', JSON.stringify(sys)); ok(ui.added.join() === 'munim', 'v1.1 users imported from system.json');
  const old = mk(); const lu = await old.call('auth.login', 'munim', 'Old#Munim2025'); ok(lu.username === 'munim', 'v1.1 user logs in with the old password (re-hashed on login)');
  await rejects(admin.call('company.restore', { name: 'x.rsbak', b64: Buffer.from('hello world, not sqlite').toString('base64') }), /not an R&S/i, 'non-company file refused');
  // ---- automation over the API ----
  await admin.call('company.open', c1.id);
  const due = await viewer.call ? await admin.call('c', 'dueDates', {}) : []; ok(Array.isArray(due) && due.length > 0, 'due dates via API');
  const itr = await admin.call('c', 'itrCompute', { fy: '2025-26', profile: { business: { method: '44AD' } } }); ok(itr.ay === '2026-27', 'ITR computation via API');
  const html = await admin.call('doc.html', 'itr', 0, { args: { fy: '2025-26' } }); ok(/COMPUTATION OF TOTAL INCOME/.test(html), 'ITR computation document via API');
  const sheet = await admin.call('c', 'itrSheet', { fy: '2025-26' }); const x = await admin.call('export.excelBook', sheet.sheets, sheet.name); ok(x.__file.size > 3000, 'ITR Excel filing sheet via API');
  // ---- logout ----
  await op.call('auth.logout'); await rejects(op.call('company.list'), /log in/i, 'after logout the session is gone');
  if (opts.extra) await opts.extra({ admin, mk, c1 });
}

(async () => {
  // 1) self-hosted Node server
  const s = startServer(); try { await waitUp(s.base);
    await scenario('Self-hosted server (node server.js, SQLite files)', () => client(s.base), { extra: async () => {
      const r = await fetch(s.base + '/api/call', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ m: 'app.info', a: [] }) }); ok(r.status === 403, 'request without the app header refused (CSRF guard)');
      const st = await fetch(s.base + '/app/'); ok(st.ok && /R&amp;S Sons Accounting/.test(await st.text()), 'web app served at /app/');
      const tr = await fetch(s.base + '/app/../server.js'); ok(tr.status === 404, 'no path traversal to server files');
      const sec = await fetch(s.base + '/core/company.js'); ok(sec.status === 404, 'engine source not served (only the two browser files)');
      ok(fs.existsSync(path.join(s.dir, 'system.db')) && fs.readdirSync(path.join(s.dir, 'companies')).length >= 3, 'data is in real SQLite files under DATA_DIR');
      const raw = fs.readFileSync(path.join(s.dir, 'system.db')).toString('latin1'); ok(!raw.includes('Ganga#River2026') && !raw.includes('Kashi#Strong2026'), 'no plaintext password in the database file');
    } });
  } finally { s.p.kill(); }
  // CLI backup / restore / reset-password
  console.log('\nServer command line');
  const s2 = startServer(); let pw;
  try { await waitUp(s2.base); const a = client(s2.base); await a.call('auth.login', 'admin', 'Start#Pass2026'); await a.call('auth.changePassword', 'Start#Pass2026', 'Ganga#River2026'); await a.call('company.create', { name: 'CLI Co', state_code: '09' }); } finally { s2.p.kill(); }
  const run = (args) => require('child_process').execFileSync(process.execPath, [path.join(__dirname, '..', 'server.js'), ...args], { env: { ...process.env, DATA_DIR: s2.dir }, encoding: 'utf8' });
  const bdir = path.join(s2.dir, 'bk1'); const o1 = run(['backup', bdir]); ok(/1 companies/.test(o1) && fs.existsSync(path.join(bdir, 'system.db')), 'node server.js backup → folder with users + companies');
  fs.rmSync(path.join(s2.dir, 'companies'), { recursive: true }); const o2 = run(['restore', bdir]); ok(/Restored/.test(o2) && fs.readdirSync(path.join(s2.dir, 'companies')).length === 1, 'node server.js restore brings them back');
  const o3 = run(['reset-password', 'admin']); pw = (o3.match(/: (\S+)\n/) || [])[1]; ok(!!pw, 'node server.js reset-password prints a new one-time password');
  const s3 = startServer(); s3.p.kill(); // (port check only)
  // 2) hosted Worker code path (bundled exactly as deployed, D1/R2 replaced by local fakes)
  const tmp = path.join(os.tmpdir(), 'rs-worker-test.mjs'); const boot = path.join(os.tmpdir(), 'rs-boot.json');
  const salt = crypto.randomBytes(16).toString('hex'); fs.writeFileSync(boot, JSON.stringify({ username: 'admin', pw: `pbkdf2-sha256$100000$${salt}$${crypto.pbkdf2Sync('Start#Pass2026', salt, 100000, 32, 'sha256').toString('hex')}` }));
  require('child_process').execFileSync(process.execPath, [path.join(__dirname, '..', 'build-worker.mjs'), tmp, '', boot], { stdio: 'ignore' });
  const H = require('./worker-harness'); const W = await H(tmp);
  await scenario('Hosted server code (Cloudflare Worker bundle, D1 + R2 fakes)', () => W.client(), { extra: async ({ admin, c1 }) => {
    // a second "isolate" (separate copy of the code) saving to the same company at the same time: compare-and-swap keeps both
    const W2mod = await import(tmp + '?second=' + Date.now()); const env = W.env;
    const cl2 = (() => { let cookie = admin.cookie; return { async call(m, ...a) { const r = await W2mod.default.fetch(new Request('https://x.test/api/call', { method: 'POST', headers: { 'content-type': 'application/json', 'x-rs-client': '1', cookie }, body: JSON.stringify({ m, a }) }), env, {}); const j = await r.json(); if (!j.ok) throw new Error(j.error); return j.data; } }; })();
    const L = await admin.call('c', 'ledgers'); const cash = L.find(l => l.name === 'Cash').id; const exp = L.find(l => l.name === 'Misc Office Exp').id;
    env.FILES.delay = 15;
    const both = await Promise.all([0, 1, 2, 3].map(i => (i % 2 ? cl2 : admin).call('c', 'saveVoucher', { vtype: 'PMT', date: '2026-10-20', lines: [{ ledger_id: cash, dr: 0, cr: 7 }, { ledger_id: exp, dr: 7, cr: 0 }] })));
    env.FILES.delay = 0;
    ok(new Set(both.map(b => b.number)).size === 4, 'two server copies saving the same company at once: 4 vouchers, distinct numbers (compare-and-swap retry)');
    const t = await admin.call('c', 'ledgerBalance', exp, '2027-03-31'); ok(Math.abs(t - (1045 + 28)) < 0.01, 'and every amount is saved (nothing lost)');
  } });
  console.log(`\nserver tests: ${pass} passed`);
  process.exit(0);
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
