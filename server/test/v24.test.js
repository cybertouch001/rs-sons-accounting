// v2.4 server tests (hosted Worker code path, fake D1/R2): units create/dup/delete-if-unused, logged-in devices list,
// log out a device, log out all devices, remove user (deactivate / delete) kills every session at once, kick reason, deploy ops,
// duplicate supplier bill warning, number-gap report, sessions migration of an old (v2.3) sessions table.
// Run: node test/v24.test.js   (builds /tmp/worker-v24.mjs first)
'use strict';
const assert = require('assert'); const path = require('path'); const fs = require('fs'); const cp = require('child_process'); const crypto = require('crypto');
let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; console.log('  ✓ ' + m); };
const hash = pw => { const salt = crypto.randomBytes(16).toString('hex'); return `pbkdf2-sha256$100000$${salt}$${crypto.pbkdf2Sync(pw, salt, 100000, 32, 'sha256').toString('hex')}`; };
const UA = { win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) rs-sons-accounting/2.4.0 Chrome/126.0.6478.234 Electron/31.7.7 Safari/537.36',
  droid: 'Mozilla/5.0 (Linux; Android 14; SM-A145F Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36 RSSonsAndroid/2.3.0',
  web: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' };
(async () => {
  const dir = fs.mkdtempSync('/tmp/rs24t-'); const ops = path.join(dir, 'ops.json'); const boot = path.join(dir, 'boot.json');
  fs.writeFileSync(boot, JSON.stringify({ username: 'admin', pw: hash('Start#Pass2026') }));
  fs.writeFileSync(ops, JSON.stringify([{ id: 'op-test-1', kind: 'provision_user', username: 'tmp_tester', pw: hash('Tmp#Tester2026x'), role: 'admin', expires: Date.now() + 3600000, note: 'unit test' },
    { id: 'op-test-old', kind: 'provision_user', username: 'tmp_old', pw: hash('Tmp#Tester2026x'), role: 'admin', expires: Date.now() - 1000 }]));
  const out = path.join(dir, 'w.mjs');
  cp.execFileSync(process.execPath, [path.join(__dirname, '..', 'build-worker.mjs'), out, '', boot, '-', ops], { stdio: 'pipe' });
  const mod = await import(out);
  const H = require('./worker-harness'); void H;
  const { DatabaseSync } = require('node:sqlite');
  class FakeD1 { constructor(d) { this.d = d || new DatabaseSync(':memory:'); } prepare(sql) { const d = this.d; return { bind(...p) { return { async all() { return { results: d.prepare(sql).all(...p) }; }, async run() { const r = d.prepare(sql).run(...p); return { meta: { changes: Number(r.changes) } }; } }; } }; } }
  class FakeR2 { constructor() { this.m = new Map(); this.n = 0; }
    async head(k) { const o = this.m.get(k); return o ? { etag: o.etag, size: o.b.length } : null; }
    async get(k) { const o = this.m.get(k); return o ? { etag: o.etag, size: o.b.length, arrayBuffer: async () => o.b.slice().buffer } : null; }
    async put(k, b, opt = {}) { const o = this.m.get(k); if (opt.onlyIf && opt.onlyIf.etagMatches && (!o || o.etag !== opt.onlyIf.etagMatches)) return null; const u = b instanceof Uint8Array ? b : new Uint8Array(b); const e = { b: u.slice(), etag: 'e' + (++this.n) }; this.m.set(k, e); return { etag: e.etag }; }
    async delete(k) { this.m.delete(k); } async list({ prefix }) { return { objects: [...this.m.keys()].filter(k => k.startsWith(prefix)).map(k => ({ key: k, size: this.m.get(k).b.length })) }; } }
  globalThis.FixedLengthStream = class { constructor() { const ts = new TransformStream(); this.readable = ts.readable; this.writable = ts.writable; } };
  // an OLD (v2.3) sessions table with a live session in it: the v2.4 columns must be added without losing it
  const raw = new DatabaseSync(':memory:');
  raw.exec("CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, company_id TEXT, created_at INTEGER, last_seen INTEGER, expires_at INTEGER, ip TEXT, ua TEXT)");
  raw.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?)').run('oldhash'.padEnd(64, '0'), 99, null, Date.now(), Date.now(), Date.now() + 3600000, '1.2.3.4', UA.droid);
  const env = { DB: new FakeD1(raw), FILES: new FakeR2(), ASSETS: { fetch: async () => new Response('asset') } };
  const worker = mod.default;
  const mk = (ua, device, cf) => { let cookie = ''; return { get cookie() { return cookie; }, set cookie(v) { cookie = v; },
    async call(m, ...a) { const req = new Request('https://x.test/api/call', { method: 'POST', headers: { 'content-type': 'application/json', 'x-rs-client': '1', cookie, 'user-agent': ua || UA.web, 'x-rs-device': device || '' }, body: JSON.stringify({ m, a }) }); if (cf) Object.defineProperty(req, 'cf', { value: cf });
      const r = await worker.fetch(req, env, {}); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; const j = await r.json(); if (!j.ok) { const e = new Error(j.error); e.code = j.code; throw e; } return j.data; } }; };
  const admin = mk(UA.web, '', { city: 'Varanasi', region: 'Uttar Pradesh', country: 'IN' });
  await admin.call('auth.login', 'admin', 'Start#Pass2026'); await admin.call('auth.changePassword', 'Start#Pass2026', 'Better#Pass2026x');
  const cols = raw.prepare('PRAGMA table_info(sessions)').all().map(c => c.name);
  ok(['client', 'device', 'geo'].every(c => cols.includes(c)) && raw.prepare("SELECT COUNT(*) n FROM sessions WHERE token_hash LIKE 'oldhash%'").get().n === 1, 'old sessions table migrated (3 columns added, old session kept)');
  ok([...env.FILES.m.keys()].some(k => k.startsWith('backups/_system/pre-2.4.0')), 'system tables copied to R2 before the migration');
  // deploy ops
  const tmp = mk(); await tmp.call('auth.login', 'tmp_tester', 'Tmp#Tester2026x'); ok(true, 'deploy op created the temporary test admin (not expired)');
  let e1 = null; try { await mk().call('auth.login', 'tmp_old', 'Tmp#Tester2026x'); } catch (e) { e1 = e; } ok(e1 && e1.code === 'bad_login', 'an expired provision op does nothing');
  const log = await admin.call('admin.log'); ok(log.some(l => /Temporary test user created/.test(l.action)), 'deploy op is written to the admin log');
  // company + units
  const co = await admin.call('company.create', { name: 'Unit Test Co', state_code: '09' });
  await admin.call('users.save', { username: 'ravi', role: 'operator', password: 'Kashi#Strong2026', mustChange: false, companies: [co.id] });
  const pc = mk(UA.win, encodeURIComponent(JSON.stringify({ app: 'desktop', name: 'SHOP-PC', os: 'Windows 11' })), { city: 'Varanasi', country: 'IN' });
  const ph = mk(UA.droid, encodeURIComponent(JSON.stringify({ app: 'android', name: 'Samsung SM-A145F' })), { city: 'Lucknow', region: 'Uttar Pradesh', country: 'IN' });
  await pc.call('auth.login', 'ravi', 'Kashi#Strong2026', { remember: true }); await ph.call('auth.login', 'ravi', 'Kashi#Strong2026', { remember: true });
  await pc.call('company.open', co.id); await ph.call('company.open', co.id);
  const uid = await pc.call('c', 'saveSimple', 'units', { name: 'Carton', uqc: 'ctn', decimals: 0 });
  ok(typeof uid === 'number', 'operator creates a unit "Carton" (UQC lower-case accepted → CTN)');
  const unitsPh = await ph.call('c', 'list', 'units'); ok(unitsPh.some(u => u.id === uid && u.uqc === 'CTN'), 'the new unit is in the unit list for the other user/device at once');
  let e2 = null; try { await ph.call('c', 'saveSimple', 'units', { name: ' carton ' }); } catch (e) { e2 = e; } ok(e2 && /already exists/.test(e2.message), 'duplicate unit name refused with a clear message: ' + (e2 && e2.message));
  let e3 = null; try { await ph.call('c', 'saveSimple', 'units', { name: 'X', uqc: 'ZZZ' }); } catch (e) { e3 = e; } ok(e3 && /UQC/.test(e3.message), 'bad GST UQC refused');
  const grp = (await pc.call('c', 'list', 'item_groups'))[0]; const it = await pc.call('c', 'saveItem', { name: 'Serum Carton', unit_id: uid, group_id: grp && grp.id, gst_rate: 18, item_type: 'Goods' });
  const usage = await pc.call('c', 'unitsUsage'); ok(usage.find(u => u.id === uid).items === 1, 'units usage shows 1 item on Carton');
  let e4 = null; try { await admin.call('company.open', co.id); await admin.call('c', 'deleteSimple', 'units', uid); } catch (e) { e4 = e; } ok(e4 && /used by 1 item/.test(e4.message), 'a unit in use cannot be deleted: ' + (e4 && e4.message));
  const u2 = await admin.call('c', 'saveSimple', 'units', { name: 'Pair', uqc: 'PRS' }); await admin.call('c', 'deleteSimple', 'units', u2); ok(!(await admin.call('c', 'list', 'units')).some(u => u.id === u2), 'an unused unit can be deleted (admin)');
  let e5 = null; try { await pc.call('c', 'deleteSimple', 'units', uid); } catch (e) { e5 = e; } ok(e5 && e5.code === 'forbidden', 'operator cannot delete a unit (admin only)');
  void it;
  // devices
  const all = await admin.call('sessions.list', 'all'); const rs = all.sessions.filter(s => s.username === 'ravi');
  ok(rs.length === 2, 'admin sees ravi logged in on 2 devices');
  const d = rs.find(s => s.client === 'desktop'), a = rs.find(s => s.client === 'android');
  ok(d && d.device === 'SHOP-PC' && d.clientLabel === 'Windows app' && /Windows/.test(d.os) && d.place === 'Varanasi, IN', 'desktop session: SHOP-PC · Windows app · ' + (d && d.os) + ' · ' + (d && d.place));
  ok(a && a.device === 'Samsung SM-A145F' && a.clientLabel === 'Android app' && a.os === 'Android 14' && a.place === 'Lucknow, Uttar Pradesh, IN' && a.stayLoggedIn, 'android session: ' + (a && [a.device, a.clientLabel, a.os, a.place].join(' · ')));
  ok(all.sessions.find(s => s.username === 'admin' && s.current), 'admin\'s own session marked "this device"');
  const mine = await ph.call('sessions.list', 'mine'); ok(mine.sessions.length === 2 && mine.sessions.filter(s => s.current).length === 1, 'a user sees own 2 devices (one marked current)');
  let e6 = null; try { await ph.call('sessions.list', 'all'); } catch (e) { e6 = e; } ok(e6 && e6.code === 'forbidden', 'a non-admin cannot list everyone\'s devices');
  let e7 = null; try { await ph.call('sessions.revoke', all.sessions.find(s => s.username === 'admin').id); } catch (e) { e7 = e; } ok(e7 && e7.code === 'forbidden', 'a non-admin cannot log out someone else\'s device');
  // UA-only detection for an old v2.3 Android app (no device header)
  const old = mk(UA.droid, ''); await old.call('auth.login', 'admin', 'Better#Pass2026x');
  const oldS = (await admin.call('sessions.list', 'all')).sessions.find(s => s.username === 'admin' && s.client === 'android');
  ok(oldS && oldS.device === 'SM-A145F' && oldS.appVer === '2.3.0', 'old Android app recognised from its user-agent: ' + (oldS && oldS.device + ' v' + oldS.appVer));
  // a desktop app whose user-agent carries no version: name / OS / version come from the app's device header and are kept with the session
  const pc2 = mk('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.234 Electron/31.7.7 Safari/537.36', encodeURIComponent(JSON.stringify({ app: 'desktop', name: 'OFFICE-PC', os: 'Windows 11', v: '2.4.0' })));
  await pc2.call('auth.login', 'admin', 'Better#Pass2026x');
  const pcS = (await admin.call('sessions.list', 'all')).sessions.find(s => s.device === 'OFFICE-PC');
  ok(pcS && pcS.os === 'Windows 11' && pcS.appVer === '2.4.0' && pcS.clientLabel === 'Windows app', 'desktop header kept: ' + (pcS && [pcS.device, pcS.os, pcS.appVer].join(' · ')));
  await pc2.call('auth.logout');
  await admin.call('sessions.revoke', oldS.id);
  let e8 = null; try { await old.call('company.list'); } catch (e) { e8 = e; } ok(e8 && e8.code === 'auth' && /logged this device out from another device/.test(e8.message), 'own device logged out from another device: refused at once and told why is refused at once and told why: ' + (e8 && e8.message));
  // admin logs out ONE device of ravi → only that one dies
  await admin.call('sessions.revoke', a.id);
  let e9 = null; try { await ph.call('sync.poll', 0); } catch (e) { e9 = e; } ok(e9 && e9.code === 'auth' && /The admin \(admin\) logged you out of this device/.test(e9.message), 'admin logs out ravi\'s phone → refused: ' + (e9 && e9.message));
  ok(await pc.call('auth.ping'), 'ravi\'s PC is still logged in');
  // log in again on the phone; admin removes (deactivates) ravi → both die
  await ph.call('auth.login', 'ravi', 'Kashi#Strong2026'); await ph.call('company.open', co.id);
  const t0 = Date.now(); const rm = await admin.call('users.remove', 'ravi', 'deactivate');
  ok(rm.loggedOut === 2, 'remove user (deactivate) logged out 2 devices');
  let ea = null, eb = null; try { await pc.call('sync.poll', 0); } catch (e) { ea = e; } try { await ph.call('auth.ping'); } catch (e) { eb = e; }
  ok(ea && eb && ea.code === 'auth' && eb.code === 'auth' && /deactivated by the admin/.test(eb.message), `both devices refused on their next call (${Date.now() - t0} ms): "${eb && eb.message}"`);
  let ec = null; try { await mk().call('auth.login', 'ravi', 'Kashi#Strong2026'); } catch (e) { ec = e; } ok(ec && ec.code === 'bad_login', 'deactivated user cannot log in again');
  ok((await admin.call('users.list')).find(u => u.username === 'ravi').active === false, 'ravi is kept as a deactivated user');
  await admin.call('users.save', { username: 'ravi', role: 'operator', active: true, companies: [co.id] }); await pc.call('auth.login', 'ravi', 'Kashi#Strong2026');
  ok(await pc.call('auth.ping'), 'switched on again → can log in');
  const rm2 = await admin.call('users.remove', 'ravi', 'delete'); ok(rm2.loggedOut === 1 && !(await admin.call('users.list')).some(u => u.username === 'ravi'), 'remove user (delete) → user gone, its device logged out');
  let ed = null; try { await admin.call('users.remove', 'admin', 'delete'); } catch (e) { ed = e; } ok(ed && /yourself/.test(ed.message), 'admin cannot remove itself');
  const hist = await admin.call('sessions.loginHistory'); ok(hist.some(h => /User removed \(deactivated\)/.test(h.action)) && hist.some(h => /^Login/.test(h.action) && /Android app/.test(h.detail)), 'login history lists logins (with device) and removals');
  // log out all devices of a user (keeps the admin's own current one)
  const b2 = mk(UA.web); await b2.call('auth.login', 'admin', 'Better#Pass2026x');
  const ra = await admin.call('sessions.revokeUser', 'admin'); ok(ra.loggedOut >= 1, 'log out all my other devices: ' + ra.loggedOut);
  ok(await admin.call('auth.ping'), 'the device doing it stays logged in');
  let ee = null; try { await b2.call('auth.ping'); } catch (e) { ee = e; } ok(ee && ee.code === 'auth', 'the other admin device is logged out');
  // duplicate supplier bill + number gaps
  await admin.call('company.open', co.id);
  const L = await admin.call('c', 'ledgers'); const sc = (await admin.call('c', 'groups')).find(g => g.name === 'Sundry Creditors');
  const sup = await admin.call('c', 'saveLedger', { name: 'Kashi Packaging', group_id: sc.id, state_code: '09' });
  const item = (await admin.call('c', 'items'))[0];
  const pur = ref => admin.call('c', 'saveVoucher', { vtype: 'PUR', date: '2026-10-10', party_id: sup, ref_no: ref, items: [{ item_id: item.id, qty: 2, rate: 100, gst_rate: 18 }] });
  const p1 = await pur('KP/101'); ok(!(p1.warnings || []).some(w => /duplicate/i.test(w)), 'first supplier bill KP/101: no warning');
  const p2 = await pur('kp-101'); ok((p2.warnings || []).some(w => /Possible duplicate/.test(w)), 'same bill no. again (kp-101) → warning: ' + (p2.warnings || []).join(' | '));
  const dup = await admin.call('c', 'dupBills', { from: '2026-04-01', to: '2027-03-31' }); ok(dup.rows.length === 2, 'Duplicate Bills report lists both bills');
  const cash = L.find(l => l.name === 'Cash').id, rent = L.find(l => l.name === 'Rent').id;
  const pm = []; for (let i = 0; i < 4; i++) pm.push(await admin.call('c', 'saveVoucher', { vtype: 'PMT', date: '2026-10-1' + i, lines: [{ ledger_id: cash, dr: 0, cr: 10 }, { ledger_id: rent, dr: 10, cr: 0 }] }));
  await admin.call('c', 'deleteVoucher', pm[1].id);
  const gaps = await admin.call('c', 'numberGaps', { to: '2026-11-01' }); const g = gaps.rows.find(r => r.vtype === 'Payment');
  ok(g && g.missingCount === 1 && g.missing === pm[1].number, 'Number Gaps report finds the deleted payment number ' + (g && g.missing));
  console.log(`\nv2.4: ${pass} checks passed`);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
