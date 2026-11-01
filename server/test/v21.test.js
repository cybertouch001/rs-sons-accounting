// v2.1 server tests: batch calls, "stay logged in" sessions, no upload when nothing changed. Run: node test/v21.test.js
'use strict';
const assert = require('assert'); const { spawn } = require('child_process'); const path = require('path'); const fs = require('fs'); const os = require('os');
let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; console.log('  ✓ ' + m); };
function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-v21-')); const port = 22000 + Math.floor(Math.random() * 3000);
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(port), DATA_DIR: dir, ADMIN_PASSWORD: 'Start#Pass2026' }, stdio: ['ignore', 'pipe', 'pipe'] });
  return { p, base: `http://127.0.0.1:${port}` };
}
function client(base) {
  let cookie = '', lastSetCookie = '';
  return { get setCookie() { return lastSetCookie; },
    async call(m, ...a) { const r = await fetch(base + '/api/call', { method: 'POST', headers: { 'content-type': 'application/json', 'x-rs-client': '1', cookie }, body: JSON.stringify({ m, a }) }); const sc = r.headers.get('set-cookie'); if (sc) { lastSetCookie = sc; cookie = sc.split(';')[0]; } const j = await r.json(); if (!j.ok) { const e = new Error(j.error); e.code = j.code; throw e; } return j.data; } };
}
async function waitUp(base) { for (let i = 0; i < 80; i++) { try { const r = await fetch(base + '/api/health'); if (r.ok) return; } catch (_) {} await new Promise(r => setTimeout(r, 100)); } throw new Error('server did not start'); }
async function scenario(label, mk) {
  console.log('\n' + label);
  const a = mk();
  await a.call('auth.login', 'admin', 'Start#Pass2026');
  await a.call('auth.changePassword', 'Start#Pass2026', 'Kashi#Ganga2026');
  // batch: several calls, one request, each answered on its own
  const co = await a.call('company.create', { name: 'Batch Test Co', state_code: '09', books_begin: '2026-04-01' });
  const out = await a.call('batch', ['c', ['ledgers']], ['c', ['groups']], ['c', ['list', 'units']], ['company.list', []], ['c', ['noSuchMethod']], ['auth.login', ['admin', 'x']]);
  ok(Array.isArray(out) && out.length === 6, 'batch answers every call in order');
  ok(out[0].ok && out[0].data.length > 5 && out[1].ok && out[2].ok && out[3].ok && out[3].data.length === 1, 'batch: masters + company list come back');
  ok(!out[4].ok && /Unknown action/.test(out[4].error), 'batch: a bad call fails alone, the rest still answer');
  ok(!out[5].ok && /Not allowed in a batch/.test(out[5].error), 'batch: login is not allowed inside a batch');
  const anon = mk(); const ao = await anon.call('batch', ['company.list', []], ['app.info', []]);
  ok(!ao[0].ok && ao[0].code === 'auth' && ao[1].ok, 'batch without login: protected calls refused, public ones answer');
  // stay logged in
  const s1 = mk(); await s1.call('auth.login', 'admin', 'Kashi#Ganga2026');
  if (s1.setCookie) ok(/Max-Age=604800/.test(s1.setCookie), 'normal login cookie lasts 7 days');
  const s2 = mk(); await s2.call('auth.login', 'admin', 'Kashi#Ganga2026', { remember: true });
  if (s2.setCookie) ok(/Max-Age=15552000/.test(s2.setCookie), '"stay logged in" cookie lasts 180 days');
  ok((await s2.call('app.info')).user.username === 'admin', 'stay-logged-in session works');
  await s2.call('auth.logout'); let threw = false; try { await s2.call('company.list'); } catch (e) { threw = e.code === 'auth'; }
  ok(threw, 'Logout ends a stay-logged-in session at once');
  return co;
}
(async () => {
  const S = startServer(); try { await waitUp(S.base); await scenario('Self-hosted server', () => client(S.base)); } finally { S.p.kill(); }
  // hosted Worker code path with D1/R2 fakes: sessions in time, no-op writes
  console.log('\nHosted server code (Worker bundle, D1 + R2 fakes)');
  const out = path.join(os.tmpdir(), 'rs-worker-v21.mjs'); const boot = path.join(os.tmpdir(), 'rs-boot-v21.json'); const crypto = require('crypto');
  const salt = crypto.randomBytes(16).toString('hex'); fs.writeFileSync(boot, JSON.stringify({ username: 'admin', pw: `pbkdf2-sha256$100000$${salt}$${crypto.pbkdf2Sync('Start#Pass2026', salt, 100000, 32, 'sha256').toString('hex')}` }));
  require('child_process').execFileSync(process.execPath, [path.join(__dirname, '..', 'build-worker.mjs'), out, '', boot], { stdio: 'ignore' });
  const { env, client: mk } = await require('./worker-harness.js')(out);
  const co = await scenario('  (worker)', mk);
  const a = mk(); await a.call('auth.login', 'admin', 'Kashi#Ganga2026');
  await a.call('company.open', co.id);
  const puts0 = env.FILES.n; for (let i = 0; i < 3; i++) await a.call('company.open', co.id);
  ok(env.FILES.n === puts0, 'opening a company with nothing due uploads nothing (was: a full upload every open)');
  const cash = (await a.call('c', 'ledgers')).find(l => l.name === 'Cash').id; const sales = (await a.call('c', 'ledgers')).find(l => l.name === 'Sales Account').id;
  await a.call('c', 'saveVoucher', { vtype: 'RCT', date: '2026-06-01', lines: [{ ledger_id: cash, dr: 500, cr: 0 }, { ledger_id: sales, dr: 0, cr: 500 }] });
  ok(env.FILES.n === puts0 + 1, 'saving a voucher uploads exactly once');
  const b = mk(); await b.call('auth.login', 'admin', 'Kashi#Ganga2026'); await b.call('company.open', co.id);
  ok((await b.call('c', 'vouchers', {})).length === 1, 'a second device sees the saved voucher at once');
  // long session survives a day idle; normal one does not
  const db = env.DB.d; const now = Date.now();
  const sl = mk(); await sl.call('auth.login', 'admin', 'Kashi#Ganga2026', { remember: true });
  const sn = mk(); await sn.call('auth.login', 'admin', 'Kashi#Ganga2026');
  db.prepare('UPDATE sessions SET last_seen=last_seen-?, created_at=created_at-?, expires_at=expires_at-?').run(20 * 3600e3, 20 * 3600e3, 20 * 3600e3);
  let longOk = true; try { await sl.call('company.list'); } catch (_) { longOk = false; }
  let shortGone = false; try { await sn.call('company.list'); } catch (e) { shortGone = e.code === 'auth'; }
  ok(longOk, 'stay-logged-in session still valid after 20 h without use');
  ok(shortGone, 'normal session ended after 20 h without use (12 h rule kept)');
  console.log(`\nv2.1 server tests: ${pass} passed`);
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
