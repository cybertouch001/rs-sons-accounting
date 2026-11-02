// v2.3 server tests: "Forgot password?" by email (10 min, one use, 5 tries, rate limits), backup-code reset, viewer still 403.
// Run: node test/v23.test.js
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
function codeIn(raw) { const m = textOf(raw).match(/OTP hai: (\d{6})/); return m && m[1]; }
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
function resetCodeIn(raw) { const m = textOf(raw).match(/reset code is: (\d{6})/); return m && m[1]; }
(async () => {
  const mail = await fakeSmtp();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-v23-')); const { p, base } = startServer(dir);
  try {
    await waitUp(base);
    const db = () => new DatabaseSync(path.join(dir, 'system.db'));
    const admin = client(base); await admin.call('auth.login', 'admin', 'Start#Pass2026'); await admin.call('auth.changePassword', 'Start#Pass2026', 'Kashi#Ganga2026');
    const co = await admin.call('company.create', { name: 'Reset Test Co', state_code: '09', books_begin: '2026-04-01' });
    const PW = 'Ganga#Ghat2026';
    for (const [u, role, email] of [['viewer1', 'viewer', 'viewer1@x.test'], ['ramesh', 'operator', 'ramesh@x.test'], ['suresh', 'operator', '']]) await admin.call('users.save', { username: u, fullName: u === 'ramesh' ? 'Ramesh' : '', role, password: PW, mustChange: false, active: true, companies: '*', email, otp: true });

    console.log('\nForgot password — email not set up yet');
    { const d = db(); const t = d.prepare("SELECT name FROM sqlite_master WHERE name='pw_resets'").all(); d.close(); ok(t.length === 1, 'pw_resets table exists'); }
    const a0 = client(base); const f0 = await a0.call('auth.forgotPassword', 'ramesh');
    ok(f0.challenge && f0.mailFailed && /not set up yet/i.test(f0.error) && !f0.sentTo, 'no mail settings → clear "not set up yet" answer, nothing sent');
    ok(await rejects(a0.call('auth.resetPassword', f0.challenge, '123456', 'New#Pass2026', 'New#Pass2026'), 'reset_wrong'), 'no email code exists → any 6-digit code is wrong');

    console.log('\nForgot password — by email');
    await admin.call('mail.save', { provider: 'smtp', host: '127.0.0.1', port: mail.port, secure: 'none', user: 'otp@fake.test', pass: 'app-pass-1234', fromName: 'R&S Test' });
    await admin.call('mail.test', 'admin@x.test');
    const n0 = mail.inbox.length;
    const c1 = client(base);
    ok(await rejects(c1.call('auth.forgotPassword', 'ramesh'), 'reset_wait', 429), 'a second code within 60 s is refused (resend wait)');
    { const d = db(); d.prepare('UPDATE pw_resets SET created_at = created_at - 120000').run(); d.close(); }
    const f1 = await c1.call('auth.forgotPassword', 'ramesh');
    ok(f1.challenge && f1.sentTo === 'ra****@x.test' && !f1.mailFailed, 'code sent to the masked registered email');
    const m1 = mail.inbox[mail.inbox.length - 1]; const code1 = resetCodeIn(m1);
    ok(mail.inbox.length === n0 + 1 && /To: <ramesh@x.test>/.test(m1) && /^\d{6}$/.test(code1 || ''), 'reset mail arrives at the user email with a 6-digit code');
    ok(!/[\u0900-\u097F]/.test(textOf(m1)) && !/\b(aapka|karein|hai|nahi)\b/i.test(textOf(m1)), 'reset mail is English only');
    { const d = db(); const r = d.prepare('SELECT * FROM pw_resets').all(); d.close(); ok(r.filter(x => x.expires_at > 0).length === 1 && !JSON.stringify(r).includes(code1) && !JSON.stringify(r).includes(f1.challenge), 'only hashes are stored (no code, no challenge)'); }
    const live = client(base); await live.call('auth.login', 'ramesh', PW, { remember: true });
    ok(await rejects(c1.call('auth.resetPassword', f1.challenge, code1, 'short', 'short')), 'weak new password is refused');
    ok(await rejects(c1.call('auth.resetPassword', f1.challenge, code1, 'Varuna#Ghat2026', 'Other#Ghat2026')), 'mismatched new passwords are refused');
    ok(await rejects(c1.call('auth.resetPassword', f1.challenge, code1 === '000000' ? '111111' : '000000', 'Varuna#Ghat2026', 'Varuna#Ghat2026'), 'reset_wrong'), 'wrong code is refused');
    const rr = await c1.call('auth.resetPassword', f1.challenge, code1, 'Varuna#Ghat2026', 'Varuna#Ghat2026');
    ok(rr.ok && rr.username === 'ramesh' && !c1.cookie, 'right code → password changed (no login cookie given)');
    ok(await rejects(c1.call('auth.resetPassword', f1.challenge, code1, 'Assi#Ghat2026', 'Assi#Ghat2026'), 'reset_expired'), 'the same code cannot be used twice');
    ok(await rejects(live.call('company.list'), 'auth', 401), 'the user\'s other sessions were logged out');
    ok(await rejects(client(base).call('auth.login', 'ramesh', PW), 'bad_login'), 'old password no longer works');
    ok((await client(base).call('auth.login', 'ramesh', 'Varuna#Ghat2026')).username === 'ramesh', 'new password works');
    ok(/password was changed/i.test(mail.inbox[mail.inbox.length - 1]) || /changed/.test(textOf(mail.inbox[mail.inbox.length - 1])), 'a "your password was changed" notice is emailed');

    console.log('\nExpiry, tries, rate limits');
    { const d = db(); d.prepare('DELETE FROM pw_resets').run(); d.close(); }
    const f2 = await client(base).call('auth.forgotPassword', 'ramesh'); const code2 = resetCodeIn(mail.inbox[mail.inbox.length - 1]);
    { const d = db(); d.prepare('UPDATE pw_resets SET expires_at = ?').run(Date.now() - 1000); d.close(); }
    ok(await rejects(client(base).call('auth.resetPassword', f2.challenge, code2, 'Assi#Ghat2026', 'Assi#Ghat2026'), 'reset_expired'), 'a code older than 10 minutes is refused');
    { const d = db(); d.prepare('DELETE FROM pw_resets').run(); d.close(); }
    const f3 = await client(base).call('auth.forgotPassword', 'ramesh'); const code3 = resetCodeIn(mail.inbox[mail.inbox.length - 1]);
    const wrong = code3 === '000000' ? '111111' : '000000'; let last = null;
    for (let i = 0; i < 5; i++) { try { await client(base).call('auth.resetPassword', f3.challenge, wrong, 'Assi#Ghat2026', 'Assi#Ghat2026'); } catch (e) { last = e.code; } }
    ok(last === 'reset_expired' && await rejects(client(base).call('auth.resetPassword', f3.challenge, code3, 'Assi#Ghat2026', 'Assi#Ghat2026'), 'reset_expired'), '5 wrong tries cancel the code (even the right one fails after)');
    for (let i = 0; i < 3; i++) { const d = db(); d.prepare('UPDATE pw_resets SET created_at = created_at - 120000').run(); d.close(); try { await client(base).call('auth.forgotPassword', 'ramesh'); } catch (_) {} }
    { const d = db(); d.prepare('UPDATE pw_resets SET created_at = created_at - 120000').run(); d.close(); }
    ok(await rejects(client(base).call('auth.forgotPassword', 'ramesh'), 'reset_limit', 429), 'at most 4 reset codes per user per hour');
    const unk = await client(base).call('auth.forgotPassword', 'nobody-here');
    ok(unk.challenge && !unk.sentTo && !unk.mailFailed, 'unknown username gets the same neutral answer');
    const ns = await client(base).call('auth.forgotPassword', 'suresh');
    ok(ns.mailFailed && /no email is registered/i.test(ns.error), 'user without email: told to ask the admin / use a backup code');
    let ipLimited = false; for (let i = 0; i < 14; i++) { try { await client(base).call('auth.forgotPassword', 'nobody' + i); } catch (e) { if (e.code === 'reset_limit') { ipLimited = true; break; } } }
    ok(ipLimited, 'requests from one network are limited per hour');
    { const d = db(); d.prepare("DELETE FROM login_attempts WHERE k LIKE 'fp-ip:%'").run(); d.close(); }

    console.log('\nBackup code instead of the email code');
    const sc = client(base); await sc.call('auth.login', 'suresh', PW); const codes = await sc.call('auth.backupCodes', PW);
    { const d = db(); d.prepare('UPDATE pw_resets SET created_at = created_at - 120000').run(); d.close(); }
    const fs1 = await client(base).call('auth.forgotPassword', 'suresh'); ok(fs1.hasBackup, 'answer says the user has backup codes');
    const rb = await client(base).call('auth.resetPassword', fs1.challenge, codes[0], 'Manikarnika#2026', 'Manikarnika#2026');
    ok(rb.ok && (await client(base).call('auth.login', 'suresh', 'Manikarnika#2026')).username === 'suresh', 'backup code resets the password');
    { const d = db(); d.prepare("UPDATE pw_resets SET created_at = created_at - 120000").run(); d.close(); }
    const fs2 = await client(base).call('auth.forgotPassword', 'suresh');
    ok(await rejects(client(base).call('auth.resetPassword', fs2.challenge, codes[0], 'Dashashwamedh#26', 'Dashashwamedh#26'), 'reset_wrong'), 'a used backup code does not work again');

    console.log('\nAdmin can reset too; viewer stays view-only');
    { const d = db(); d.prepare('DELETE FROM pw_resets').run(); d.close(); }
    await admin.call('users.save', { username: 'admin', role: 'admin', email: 'boss@x.test', otp: true, active: true, companies: '*' }).catch(() => {});
    const ul = await admin.call('users.list'); const adm = ul.find(x => x.username === 'admin');
    if (!adm.email) { const d = db(); d.prepare("UPDATE users SET email='boss@x.test' WHERE username='admin'").run(); d.close(); }
    const fa = await client(base).call('auth.forgotPassword', 'admin'); const ca = resetCodeIn(mail.inbox[mail.inbox.length - 1]);
    ok(fa.sentTo === 'bo**@x.test' && /^\d{6}$/.test(ca || ''), 'admin gets a reset code by email');
    ok((await client(base).call('auth.resetPassword', fa.challenge, ca, 'Boss#Varanasi26', 'Boss#Varanasi26')).ok && (await client(base).call('auth.login', 'admin', 'Boss#Varanasi26')).role === 'admin', 'admin password reset by email works end to end');
    const v = client(base); await v.call('auth.login', 'viewer1', PW); await v.call('company.open', co.id);
    ok(await rejects(v.call('c', 'saveLedger', { name: 'Hack', group_id: 1 }), 'forbidden', 403) && await rejects(v.call('c', 'deleteVoucher', 1), 'forbidden', 403) && await rejects(v.call('company.saveSettings', { name: 'X' }), 'forbidden', 403), 'viewer writes → HTTP 403');
    const vch = (await v.call('c', 'vouchers', {}))[0];
    ok(typeof (await v.call('doc.named', 'report', 0, { report: { title: 'Trial Balance', columns: [{ k: 'a', label: 'A' }], rows: [{ a: 1 }] } })).html === 'string', 'viewer can open a report document (PDF viewer)');
    ok(await rejects(client(base).call('auth.forgotPassword', ''), null), 'empty username is refused');
    console.log(`\nv2.3 server tests: ${pass} passed`);
  } catch (e) { console.error('FAILED:', e); process.exitCode = 1; }
  finally { p.kill(); mail.srv.close(); }
})();
