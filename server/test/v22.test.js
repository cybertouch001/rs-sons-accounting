// v2.2 server tests: view-only users (API 403), live updates between users, email OTP login. Run: node test/v22.test.js
'use strict';
const assert = require('assert'); const { spawn } = require('child_process'); const path = require('path'); const fs = require('fs'); const os = require('os'); const net = require('net');
const { DatabaseSync } = require('node:sqlite');
let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; console.log('  ✓ ' + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// ---- a tiny fake mail server on 127.0.0.1 (no encryption; the app allows that only for localhost) ----
function fakeSmtp() {
  const inbox = []; const st = { rejectAuth: false };
  const srv = net.createServer(s => {
    let mode = 'cmd', data = '', buf = '';
    s.write('220 fake.test ESMTP\r\n');
    s.on('data', d => { buf += d.toString('latin1'); let i;
      while ((i = buf.indexOf('\r\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (mode === 'data') { if (line === '.') { mode = 'cmd'; inbox.push(data); data = ''; s.write('250 2.0.0 OK queued as T' + inbox.length + '\r\n'); } else data += (line.startsWith('..') ? line.slice(1) : line) + '\r\n'; continue; }
        const c = line.slice(0, 4).toUpperCase();
        if (c === 'EHLO') s.write('250-fake.test\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n');
        else if (c === 'AUTH') { const ok = Buffer.from(line.split(' ')[2] || '', 'base64').toString() === '\u0000otp@fake.test\u0000app-pass-1234'; s.write(st.rejectAuth || !ok ? '535 5.7.8 Username and Password not accepted\r\n' : '235 2.7.0 Accepted\r\n'); }
        else if (c === 'MAIL' || c === 'RCPT') s.write('250 OK\r\n');
        else if (c === 'DATA') { mode = 'data'; s.write('354 go ahead\r\n'); }
        else if (c === 'QUIT') { s.write('221 bye\r\n'); s.end(); }
        else s.write('502 ?\r\n'); } });
    s.on('error', () => {});
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port, inbox, st })));
}
function textOf(raw) { const parts = raw.split(/\r\n--rs/); for (const p of parts) if (/text\/plain/.test(p)) { const b = p.split('\r\n\r\n')[1] || ''; return Buffer.from(b.replace(/\s+/g, ''), 'base64').toString('utf8'); } return ''; }
function codeIn(raw) { const m = textOf(raw).match(/(?:login|reset) code is:? (\d{6})/); return m && m[1]; }
function startServer(dir) {
  const port = 25000 + Math.floor(Math.random() * 3000);
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(port), DATA_DIR: dir, ADMIN_PASSWORD: 'Start#Pass2026' }, stdio: ['ignore', 'pipe', 'pipe'] });
  return { p, base: `http://127.0.0.1:${port}` };
}
function client(base) {
  let cookie = '';
  return { get cookie() { return cookie; },
    async call(m, ...a) { const r = await fetch(base + '/api/call', { method: 'POST', headers: { 'content-type': 'application/json', 'x-rs-client': '1', cookie }, body: JSON.stringify({ m, a }) }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; const j = await r.json(); if (!j.ok) { const e = new Error(j.error); e.code = j.code; e.status = r.status; throw e; } return j.data; } };
}
async function waitUp(base) { for (let i = 0; i < 80; i++) { try { const r = await fetch(base + '/api/health'); if (r.ok) return; } catch (_) {} await sleep(100); } throw new Error('server did not start'); }
async function rejects(p, code, status) { try { await p; } catch (e) { return (!code || e.code === code) && (!status || e.status === status); } return false; }
(async () => {
  const mail = await fakeSmtp();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-v22-')); const { p, base } = startServer(dir);
  try {
    await waitUp(base);
    const db = () => new DatabaseSync(path.join(dir, 'system.db'));
    console.log('\nv2.2 schema');
    const admin = client(base); await admin.call('auth.login', 'admin', 'Start#Pass2026'); await admin.call('auth.changePassword', 'Start#Pass2026', 'Kashi#Ganga2026');
    { const d = db(); const cols = d.prepare('PRAGMA table_info(users)').all().map(c => c.name); d.close(); ok(['email', 'otp', 'email_verified', 'backup_codes'].every(c => cols.includes(c)), 'users table has the new email / OTP columns'); }
    const co = await admin.call('company.create', { name: 'Live Test Co', state_code: '09', books_begin: '2026-04-01' });
    const PW = 'Ganga#Ghat2026';
    for (const [u, role, email] of [['viewer1', 'viewer', 'viewer1@x.test'], ['ramesh', 'operator', 'ramesh@x.test'], ['suresh', 'operator', '']]) await admin.call('users.save', { username: u, fullName: u === 'ramesh' ? 'Ramesh' : '', role, password: PW, mustChange: false, active: true, companies: '*', email, otp: true });
    const ul = await admin.call('users.list'); ok(ul.find(x => x.username === 'ramesh').email === 'ramesh@x.test' && ul.find(x => x.username === 'ramesh').otp === true, 'admin sets a user email + OTP flag');
    ok(await rejects(admin.call('users.save', { username: 'bad1', role: 'viewer', password: PW, email: 'not-an-email' })), 'a wrong email is refused');

    console.log('\nViewer = view only (server side)');
    const v = client(base); const vu = await v.call('auth.login', 'viewer1', PW); ok(vu.role === 'viewer' && !vu.otp && vu.emailOtp === true, 'viewer logs in (OTP is still off for everyone)');
    await v.call('company.open', co.id);
    ok((await v.call('c', 'ledgers')).length > 5 && (await v.call('c', 'trialBalance', { to: '2027-03-31' })), 'viewer can read ledgers and reports');
    ok(await rejects(v.call('c', 'saveLedger', { name: 'Hack', group_id: 1 }), 'forbidden', 403), 'viewer saving a ledger → HTTP 403');
    ok(await rejects(v.call('c', 'saveVoucher', { vtype: 'JRN', date: '2026-05-01', lines: [] }), 'forbidden', 403), 'viewer saving a voucher → HTTP 403');
    ok(await rejects(v.call('c', 'deleteVoucher', 1), 'forbidden', 403), 'viewer deleting → HTTP 403');
    ok(await rejects(v.call('company.saveSettings', { name: 'x' }), 'forbidden', 403) && await rejects(v.call('company.backup'), 'forbidden', 403) && await rejects(v.call('company.restore', { b64: 'AA' }), 'forbidden', 403), 'viewer: settings / backup / restore → 403');
    ok(await rejects(v.call('users.list'), 'forbidden', 403) && await rejects(v.call('mail.get'), 'forbidden', 403) && await rejects(v.call('company.create', { name: 'x' }), 'forbidden', 403) && await rejects(v.call('company.delete', co.id, true), 'forbidden', 403), 'viewer: users / email settings / company create+delete → 403');
    ok(await rejects(v.call('masters.importFile', { b64: 'AA' }), 'forbidden', 403) && await rejects(v.call('auth.backupCodes', PW), 'forbidden', 403), 'viewer: masters import / backup codes → 403');

    console.log('\nLive updates between two users on the same company');
    const r1 = client(base); const s1 = client(base); await r1.call('auth.login', 'ramesh', PW); await s1.call('auth.login', 'suresh', PW);
    await r1.call('company.open', co.id); await s1.call('company.open', co.id);
    const b0 = await s1.call('sync.poll', null); const vb = await v.call('sync.poll', null); ok(typeof b0.seq === 'number' && b0.company === co.id, 'poll without a number gives the starting point');
    const grp = (await r1.call('c', 'groups')).find(g => g.name === 'Sundry Debtors');
    const led = await r1.call('c', 'saveLedger', { name: 'Kashi Traders', group_id: grp.id });
    const sales = (await r1.call('c', 'ledgers')).find(l => l.group_name === 'Sales Accounts' || /^Sales/.test(l.name));
    const vch = await r1.call('c', 'saveVoucher', { vtype: 'JRN', date: '2026-05-02', narration: 'live test', lines: [{ ledger_id: led.id || led, dr: 1180, cr: 0 }, { ledger_id: sales.id, dr: 0, cr: 1180 }] });
    const t0 = Date.now(); const got = await s1.call('sync.poll', b0.seq); const ms = Date.now() - t0;
    ok(got.items.length === 2 && got.items[0].byName === 'Ramesh' && /Ledger "Kashi Traders"/.test(got.items[0].label) && got.items[0].kind === 'new' && !got.items[0].mine, 'other user sees "Ramesh … Ledger Kashi Traders … new"');
    ok(new RegExp('Journal #' + vch.number.replace(/[/]/g, '\\/')).test(got.items[1].label), 'voucher change label carries type + number: ' + got.items[1].label);
    ok((await v.call('sync.poll', vb.seq)).items.length === 2, 'the viewer gets the same live changes');
    const own = await r1.call('sync.poll', b0.seq); ok(own.items.every(x => x.mine), 'the saver\'s own changes are marked "mine" (no self-notification)');
    ok((await s1.call('sync.poll', got.seq)).items.length === 0, 'nothing new → empty answer');
    const co2 = await admin.call('company.create', { name: 'Other Co', state_code: '09', books_begin: '2026-04-01' }); await admin.call('company.open', co2.id); await admin.call('c', 'saveLedger', { name: 'Elsewhere', group_id: grp.id });
    ok((await s1.call('sync.poll', got.seq)).items.length === 0, 'a save in another company is not shown');
    await admin.call('company.open', co.id); await admin.call('c', 'deleteVoucher', vch.id);
    const del = await s1.call('sync.poll', got.seq); ok(del.items.length === 1 && del.items[0].kind === 'delete' && del.items[0].label.includes(vch.number), 'delete shows as "deleted" with the number');
    console.log('    (poll answered in ' + ms + ' ms)');

    console.log('\nEmail OTP');
    ok(await rejects(admin.call('otp.setEnabled', true)), 'OTP cannot be switched on before a successful test mail');
    ok(await rejects(admin.call('mail.save', { provider: 'smtp', host: 'mail.example.com', port: 587, secure: 'none', user: 'a@b.c', pass: 'x' })), 'no-encryption mail is refused for a non-local server');
    let mg = await admin.call('mail.save', { provider: 'smtp', host: '127.0.0.1', port: mail.port, secure: 'none', user: 'otp@fake.test', pass: 'app-pass-1234', fromName: 'R&S Test' });
    ok(mg.hasPass && !('pass' in mg) && !JSON.stringify(mg).includes('app-pass-1234'), 'saved password never comes back to the screen');
    const t = await admin.call('mail.test', 'admin@x.test'); ok(t.ok && mail.inbox.length === 1 && /To: <admin@x.test>/.test(mail.inbox[0]), 'test mail is delivered through SMTP');
    mg = await admin.call('otp.setEnabled', true); ok(mg.otpEnabled, 'OTP switched on');
    // login with OTP
    const r2 = client(base); const lr = await r2.call('auth.login', 'ramesh', PW, { remember: true });
    ok(lr.otp === true && lr.challenge && lr.sentTo === 'ra****@x.test' && !lr.mailFailed, 'password OK → OTP step, code sent to masked email');
    ok(!r2.cookie, 'no login cookie before the OTP');
    ok(await rejects(r2.call('company.list'), 'auth'), 'nothing works before the OTP');
    const m1 = mail.inbox[mail.inbox.length - 1]; const code1 = codeIn(m1); ok(/^\d{6}$/.test(code1) && /To: <ramesh@x.test>/.test(m1) && /Subject: =\?UTF-8\?B\?|Subject: \d{6}/.test(m1), 'OTP mail arrives at the user\'s email with a 6-digit code');
    ok(await rejects(r2.call('auth.verifyOtp', lr.challenge, code1 === '000000' ? '111111' : '000000'), 'otp_wrong'), 'wrong OTP is rejected');
    ok(await rejects(r2.call('auth.resendOtp', lr.challenge), 'otp_wait'), 'resend has a 30 s wait');
    const u2 = await r2.call('auth.verifyOtp', lr.challenge, code1); ok(u2.username === 'ramesh' && r2.cookie, 'right OTP → logged in');
    ok((await r2.call('company.list')).length >= 1, 'session works after OTP');
    ok(await rejects(client(base).call('auth.verifyOtp', lr.challenge, code1), 'otp_expired'), 'a used OTP cannot be used again');
    ok((await admin.call('users.list')).find(x => x.username === 'ramesh').emailVerified, 'email marked verified after the first OTP');
    // expiry
    const r3 = client(base); const l3 = await r3.call('auth.login', 'ramesh', PW); const c3 = codeIn(mail.inbox[mail.inbox.length - 1]);
    { const d = db(); d.prepare('UPDATE otp_challenges SET expires_at=?').run(Date.now() - 1000); d.close(); }
    ok(await rejects(r3.call('auth.verifyOtp', l3.challenge, c3), 'otp_expired'), 'expired OTP (10 min) is rejected even if the code is right');
    // 5 wrong tries kill the challenge
    const r4 = client(base); const l4 = await r4.call('auth.login', 'ramesh', PW); const c4 = codeIn(mail.inbox[mail.inbox.length - 1]); const wrong = c4 === '123456' ? '654321' : '123456';
    let last; for (let i = 0; i < 5; i++) { try { await r4.call('auth.verifyOtp', l4.challenge, wrong); } catch (e) { last = e; } }
    ok(last && last.code === 'otp_expired', '5 wrong OTPs → must log in again');
    ok(await rejects(r4.call('auth.verifyOtp', l4.challenge, c4), 'otp_expired'), '…and the right code no longer works for that attempt');
    { const d = db(); d.prepare("DELETE FROM login_attempts").run(); d.close(); }
    // resend
    const r5 = client(base); const l5 = await r5.call('auth.login', 'ramesh', PW); const c5a = codeIn(mail.inbox[mail.inbox.length - 1]);
    { const d = db(); d.prepare('UPDATE otp_challenges SET last_sent=?').run(Date.now() - 31000); d.close(); }
    const rs = await r5.call('auth.resendOtp', l5.challenge); const c5b = codeIn(mail.inbox[mail.inbox.length - 1]);
    ok(rs.sentTo === 'ra****@x.test' && c5b && c5b !== c5a || c5b === c5a, 'resend sends a new mail');
    if (c5a !== c5b) ok(await rejects(r5.call('auth.verifyOtp', l5.challenge, c5a), 'otp_wrong'), 'after resend the old code stops working');
    ok((await r5.call('auth.verifyOtp', l5.challenge, c5b)).username === 'ramesh', 'the new code logs in');
    // backup codes
    const codes = await r5.call('auth.backupCodes', PW); ok(codes.length === 8 && codes.every(c => /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(c)), '8 backup codes made');
    mail.st.rejectAuth = true;
    const r6 = client(base); const l6 = await r6.call('auth.login', 'ramesh', PW); ok(l6.otp && l6.mailFailed && /could not send/i.test(l6.error) && l6.hasBackup, 'mail server down → OTP step says the mail failed');
    ok((await r6.call('auth.verifyOtp', l6.challenge, codes[0].toLowerCase())).username === 'ramesh', 'a backup code logs in when the email does not arrive');
    const r7 = client(base); const l7 = await r7.call('auth.login', 'ramesh', PW); ok(await rejects(r7.call('auth.verifyOtp', l7.challenge, codes[0]), 'otp_wrong'), 'a backup code works only once');
    const lg = await admin.call('admin.log'); ok(lg.some(x => x.action === 'Login OTP email FAILED'), 'failed OTP mails are in the admin log');
    mail.st.rejectAuth = false;
    // the admin's ways out
    await admin.call('users.save', { username: 'ramesh', fullName: 'Ramesh', role: 'operator', active: true, companies: '*', email: 'ramesh@x.test', otp: false, mustChange: false });
    ok(!(await client(base).call('auth.login', 'ramesh', PW)).otp, 'admin turns OTP off for one user → password-only login');
    await admin.call('users.save', { username: 'ramesh', fullName: 'Ramesh', role: 'operator', active: true, companies: '*', email: 'ramesh@x.test', otp: true, mustChange: false });
    ok((await client(base).call('auth.login', 'ramesh', PW)).otp, '…and back on');
    ok(!(await client(base).call('auth.login', 'suresh', PW)).otp, 'a user without an email logs in with the password only');
    await admin.call('otp.setEnabled', false); ok(!(await client(base).call('auth.login', 'ramesh', PW)).otp, 'admin switches OTP off for everyone');
    await admin.call('otp.setEnabled', true);
    await admin.call('mail.save', { provider: 'smtp', host: '127.0.0.1', port: mail.port, secure: 'none', user: 'otp@fake.test', pass: 'changed-pass', fromName: 'R&S Test' });
    ok(!(await admin.call('mail.get')).otpEnabled, 'changing the mail login switches OTP off until a new test passes (no lock-out)');
    // new user setup: first login does the OTP, then the forced password change
    await admin.call('mail.save', { provider: 'smtp', host: '127.0.0.1', port: mail.port, secure: 'none', user: 'otp@fake.test', pass: 'app-pass-1234' }); await admin.call('mail.test', 'admin@x.test'); await admin.call('otp.setEnabled', true);
    await admin.call('users.save', { username: 'newbie', role: 'operator', password: PW, mustChange: true, active: true, companies: '*', email: 'newbie@x.test', otp: true });
    const n = client(base); const ln = await n.call('auth.login', 'newbie', PW); const nu = await n.call('auth.verifyOtp', ln.challenge, codeIn(mail.inbox[mail.inbox.length - 1]));
    ok(nu.mustChange === true, 'new user: email OTP first, then "set a new password"');
    console.log(`\nv2.2 server tests: ${pass} passed`);
  } catch (e) { console.error('FAILED:', e); process.exitCode = 1; }
  finally { p.kill(); mail.srv.close(); }
})();
