// R&S Sons Accounting - multi-user server API (transport independent).
// The same code runs in the self-hosted Node server (server.js) and in the hosted Cloudflare Worker (worker.js).
// Every request carries a session token; the user's role is checked HERE for every action (hiding a button is not the guard).
'use strict';
const core = require('../../app/core');
const PERMS = require('../../app/core/perms');
const ADM = require('../../app/core/admin');
const DOCS = require('../../app/core/docs');
const XB = require('../../app/core/exports');
const PR = require('../../app/core/print');
const MAIL = require('./mailer');
const U = core.util;

const APP_NAME = 'R&S Sons Accounting';
const PBKDF2_ITER = 100000;               // PBKDF2-SHA256, 100k rounds, 16-byte random salt per user
const IDLE_MS = 12 * 3600 * 1000;         // a session ends after 12 h without use
const MAX_MS = 7 * 24 * 3600 * 1000;      // and after 7 days in any case
// v2.1 "stay logged in" (the Windows / Android apps, or the web login's "remember me"): like a phone app, the login lasts
// 60 days without use and 180 days at most; Logout, a password change or the admin disabling the user ends it at once.
const LONG_IDLE_MS = 60 * 24 * 3600 * 1000;
const LONG_MAX_MS = 180 * 24 * 3600 * 1000;
const ROLES = ['admin', 'operator', 'viewer'];

class ApiError extends Error { constructor(msg, code, status) { super(msg); this.code = code || 'error'; this.status = status || 400; } }

function createService(env) {
  const { sys, store, crypto: CR, XLSX, QRCode } = env;
  const VERSION = env.version || '2.0.0';

  // ---------- passwords ----------
  async function hashPassword(pw) { const salt = CR.randomHex(16); return `pbkdf2-sha256$${PBKDF2_ITER}$${salt}$${await CR.pbkdf2(String(pw), salt, PBKDF2_ITER)}`; }
  async function verifyPassword(pw, stored) {
    const [alg, it, salt, h] = String(stored || '').split('$');
    if (alg !== 'pbkdf2-sha256' || !salt || !h) return false;
    const got = await CR.pbkdf2(String(pw), salt, Number(it));
    return CR.safeEqual(got, h);
  }
  // A v1.1 desktop user record (salt + hash, PBKDF2-SHA256 120k) keeps working: same algorithm, stored in the new format.
  function legacyHash(u) { return `pbkdf2-sha256$120000$${u.salt}$${u.hash}`; }

  // ---------- branding ----------
  async function branding() { return await sys.kv('branding', {}) || {}; }
  async function appName() { const b = await branding(); return b.appName || APP_NAME; }
  function builtinUrl(id) { return `../assets/icons/${id}.png`; }
  async function iconUrl() { const b = await branding(); const ic = b.icon || {}; if (ic.kind === 'custom' && b.iconData) return b.iconData; if (ic.kind === 'builtin' && ic.id) return builtinUrl(ic.id); return null; }

  // ---------- sessions ----------
  async function loadSession(token, now) {
    if (!token || typeof token !== 'string' || token.length < 20) return null;
    const th = await CR.sha256Hex(token);
    const s = await sys.session(th); if (!s) return null;
    const long = Number(s.expires_at) - Number(s.last_seen) > IDLE_MS + 60000;   // a "stay logged in" session
    if (Number(s.expires_at) < now || now - Number(s.created_at) > (long ? LONG_MAX_MS : MAX_MS)) { await sys.deleteSession(th); return null; }
    const u = await sys.userById(s.user_id); if (!u || !u.active) { await sys.deleteSession(th); return null; }
    if (now - Number(s.last_seen) > 60000) await sys.touchSession(th, now, now + (long ? LONG_IDLE_MS : IDLE_MS));
    return { th, s, u };
  }
  function pubUser(u) { return u && { username: u.username, role: u.role, mustChange: !!u.must_change, fullName: u.full_name || '', email: u.email || '', emailOtp: Number(u.otp) !== 0 }; }
  function companiesOf(u) { if (!u.companies || u.companies === '*') return '*'; try { const a = JSON.parse(u.companies); return Array.isArray(a) ? a : '*'; } catch (_) { return '*'; } }
  function canSeeCompany(u, id) { const a = companiesOf(u); return a === '*' || a.includes(id); }

  // ---------- v2.2 email OTP + live-update helpers ----------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const OTP_TTL_MS = 10 * 60000, OTP_TRIES = 5, OTP_RESEND_MS = 30000, OTP_MAX_SENDS = 5, OTP_HOURLY = 10;
  function maskEmail(e) { e = String(e || ''); const [a, d] = e.split('@'); if (!d) return e; return (a.length <= 2 ? a[0] + '*' : a.slice(0, 2) + '*'.repeat(Math.min(6, a.length - 2))) + '@' + d; }
  function backupList(u) { try { const a = JSON.parse(u.backup_codes || '[]'); return Array.isArray(a) ? a : []; } catch (_) { return []; } }
  async function otpRequired(u) {
    if (!u || !u.email || Number(u.otp) === 0) return false;
    const o = await sys.kv('otp', {}) || {}; if (!o.enabled) return false;
    const m = await sys.kv('mail', {}) || {}; return !!(m.user && m.pass && env.netOpen);
  }
  async function newCode() { return String(parseInt(CR.randomHex(4), 16) % 1000000).padStart(6, '0'); }
  async function sendMail(to, subject, text, html) {
    if (!env.netOpen) throw new ApiError('This server cannot send email');
    const m = await sys.kv('mail', {}) || {}; if (!m.user || !m.pass) throw new ApiError('Email (OTP) settings are not filled in Admin Settings');
    return MAIL.smtpSend(env.netOpen, Object.assign({ fromName: await appName() }, m, m.fromName ? {} : { fromName: await appName() }), { to, subject, text, html });
  }
  function mailHint(m, e) {
    const s = String(e && e.message || e);
    if (e && e.smtpCode === 535 || /AUTH|Username and Password not accepted|BadCredentials/i.test(s)) return (m.provider === 'gmail' ? 'Gmail ne login mana kiya — Gmail ka normal password nahi chalega: Google Account → Security → 2-Step Verification ON → App passwords se 16 letter ka App Password banakar daalein. ' : 'Email login galat hai (username / password). ') + '[' + s.slice(0, 160) + ']';
    if (/did not answer|closed|ECONN|connect|network/i.test(s)) return 'Email server se connect nahi hua (host/port check karein): ' + s.slice(0, 160);
    return 'Email nahi gaya: ' + s.slice(0, 200);
  }
  async function sendOtpMail(u, code, ctx) {
    const name = await appName(); const when = new Date(ctx.now + 5.5 * 3600000).toISOString().replace('T', ' ').slice(0, 16) + ' IST';
    const text = `Namaste ${u.full_name || u.username},\n\nAapka ${name} login OTP hai: ${code}\n\nYe 10 minute tak chalega. Ye code kisi ko mat batayein — hamari team kabhi OTP nahi maangti.\nAgar ye login aapne nahi kiya, to turant apna password badlein aur admin ko batayein.\n\nYour login code is ${code} (valid for 10 minutes).\n\nUser: ${u.username} · ${when}${ctx.ip ? ' · IP ' + ctx.ip : ''}\n— ${name}`;
    const html = `<div style="font-family:Arial,sans-serif;max-width:460px;margin:auto;padding:18px;border:1px solid #dde3ea;border-radius:10px"><div style="font-size:15px;color:#1f3a5f;font-weight:bold">${esc(name)}</div><p style="font-size:14px;color:#333">Namaste ${esc(u.full_name || u.username)}, aapka login OTP:</p><div style="font-size:32px;letter-spacing:8px;font-weight:bold;color:#0b7a75;margin:10px 0">${code}</div><p style="font-size:13px;color:#555">10 minute tak valid. Ye code kisi ko mat batayein.<br>Agar ye login aapne nahi kiya, to turant password badlein aur admin ko batayein.</p><p style="font-size:12px;color:#888">Your login code (valid 10 minutes). User: ${esc(u.username)} · ${when}${ctx.ip ? ' · IP ' + esc(ctx.ip) : ''}</p></div>`;
    return sendMail(u.email, `${code} — ${name} login OTP`, text, html);
  }
  async function startChallenge(ctx, u, remember) {
    if (await sys.recentChallenges(u.id, ctx.now - 3600000) >= OTP_HOURLY) throw new ApiError('Is ghante bahut OTP bheje gaye — 1 ghante baad try karein · Too many codes this hour, try later.', 'otp_limit', 429);
    const challenge = CR.randomToken(); const h = await CR.sha256Hex(challenge); const code = await newCode();
    let mailOk = 1, err = '';
    try { await sendOtpMail(u, code, ctx); } catch (e) { mailOk = 0; err = e.message || String(e); }
    await sys.addChallenge({ id_hash: h, user_id: u.id, code_hash: await CR.sha256Hex(h + ':' + code), now: ctx.now, expires_at: ctx.now + OTP_TTL_MS, remember, ip: ctx.ip, mail_ok: mailOk });
    if (Math.random() < 0.1) await sys.purgeChallenges(ctx.now - 2 * 3600000);
    await sys.log(u.username, mailOk ? 'Login OTP sent' : 'Login OTP email FAILED', mailOk ? maskEmail(u.email) : err.slice(0, 200), ctx.ip);
    return { otp: true, challenge, sentTo: maskEmail(u.email), expiresIn: OTP_TTL_MS / 1000, resendIn: OTP_RESEND_MS / 1000, tries: OTP_TRIES, hasBackup: backupList(u).length > 0,
      mailFailed: !mailOk, error: mailOk ? '' : 'OTP email nahi gaya · Could not send the email. Admin se kahein (Admin Settings → Email OTP), ya backup code use karein.' };
  }
  async function startSession(ctx, u, remember, how) {
    const token = CR.randomToken(); const th = await CR.sha256Hex(token);
    await sys.addSession({ token_hash: th, user_id: u.id, now: ctx.now, expires_at: ctx.now + (remember ? LONG_IDLE_MS : IDLE_MS), ip: ctx.ip, ua: ctx.ua });
    await Promise.all([sys.updateUser(u.id, { last_login: new Date(ctx.now).toISOString() }), sys.log(u.username, (remember ? 'Login (stay logged in)' : 'Login') + (how ? ' · ' + how : ''), '', ctx.ip),
      Math.random() < 0.05 ? sys.purgeSessions(ctx.now) : null]);
    ctx.out.setToken = token; ctx.out.cookieMaxAge = Math.round((remember ? LONG_MAX_MS : MAX_MS) / 1000);
    return pubUser(u);
  }
  const SIMPLE_NAMES = { units: 'Unit', godowns: 'Godown', item_groups: 'Item group', cost_centres: 'Cost centre', salesmen: 'Salesman', price_lists: 'Price list', boms: 'BOM', reminders: 'Note / reminder', employees: 'Employee', fixed_assets: 'Fixed asset' };
  const METHOD_LABELS = { duplicateVoucher: ['new', 'Voucher copy'], setVoucherStatus: ['edit', 'Voucher status'], setBankDate: ['edit', 'Bank date (BRS)'], saveBudget: ['edit', 'Budget'], postDepreciation: ['new', 'Depreciation journal'], payrollProcess: ['new', 'Payroll'],
    saveItrProfile: ['edit', 'ITR details'], gstr2bImport: ['new', 'GSTR-2B import'], bankImport: ['new', 'Bank statement import'], bankRematch: ['edit', 'Bank auto-match'], bankMatch: ['edit', 'Bank match'], bankUnmatch: ['edit', 'Bank un-match'], bankCreateVoucher: ['new', 'Voucher from bank line'],
    saveRecurring: ['edit', 'Recurring voucher'], runRecurring: ['new', 'Recurring vouchers posted'], savePriceListItems: ['edit', 'Price list rates'], saveBom: ['edit', 'BOM'], payrollDelete: ['delete', 'Payroll month'], gstr2bDelete: ['delete', 'GSTR-2B'], bankDeleteStatement: ['delete', 'Bank statement'], deleteRecurring: ['delete', 'Recurring voucher'], saveSettings: ['edit', 'Company settings'] };
  function nm(x) { return x && x.name ? ` "${String(x.name).slice(0, 60)}"` : ''; }
  function changeLabel(method, args, res, pre) {
    const a0 = args[0];
    try {
      if (method === 'saveVoucher') { const T = core.VTYPES[a0 && a0.vtype] || {}; return [a0 && a0.id ? 'edit' : 'new', `${T.short || 'Voucher'}${res && res.number ? ' #' + res.number : ''}`]; }
      if (method === 'deleteVoucher') return ['delete', pre ? `${pre.vtype_name || 'Voucher'} #${pre.number}` : 'Voucher'];
      if (method === 'saveLedger') return [a0 && a0.id ? 'edit' : 'new', 'Ledger' + nm(a0)];
      if (method === 'deleteLedger') return ['delete', 'Ledger' + nm(pre)];
      if (method === 'saveItem') return [a0 && a0.id ? 'edit' : 'new', 'Item' + nm(a0)];
      if (method === 'deleteItem') return ['delete', 'Item' + nm(pre)];
      if (method === 'saveGroup') return [a0 && a0.id ? 'edit' : 'new', 'Group' + nm(a0)];
      if (method === 'deleteGroup') return ['delete', 'Group'];
      if (method === 'saveSimple') return [args[1] && args[1].id ? 'edit' : 'new', (SIMPLE_NAMES[a0] || 'Master') + nm(args[1])];
      if (method === 'deleteSimple') return ['delete', SIMPLE_NAMES[a0] || 'Master'];
    } catch (_) {}
    const l = METHOD_LABELS[method]; return l || ['edit', method.replace(/([A-Z])/g, ' $1').toLowerCase()];
  }
  async function recordChange(ctx, kind, label) {
    if (!ctx.companyId || !ctx.user) return;
    const p = sys.addChange({ company_id: ctx.companyId, at: ctx.now, username: ctx.user.username, full_name: ctx.user.full_name || '', kind, label, sess: (ctx.th || '').slice(0, 12) })
      .then(() => Math.random() < 0.02 ? sys.purgeChanges(ctx.now - 3 * 86400000) : null).catch(() => {});
    if (ctx.defer) ctx.defer(p); else await p;
  }

  async function handle(req) {
    // req: { token, method, args, ip, ua, now }
    const now = req.now || Date.now();
    const m = String(req.method || ''); const a = Array.isArray(req.args) ? req.args : [];
    const ctx = { ip: req.ip || '', ua: req.ua || '', now, out: {}, defer: req.defer || null };
    const sess = await loadSession(req.token, now);
    if (sess) { ctx.th = sess.th; ctx.user = sess.u; ctx.companyId = sess.s.company_id || null; }
    // v2.1 'batch': several calls in ONE request (one session check, one trip over the internet). The web app sends the
    // calls a screen makes at the same moment (e.g. the 10 master lists when a company opens) this way. Each call is
    // checked exactly like a single call and answers on its own ({ ok, data } or { ok: false, error, code }), in order.
    if (m === 'batch') {
      if (a.length > 40) throw new ApiError('Too many calls in one batch');
      const out = [];
      for (const it of a) {
        const bm = String((it && it[0]) || ''); const ba = Array.isArray(it && it[1]) ? it[1] : [];
        try {
          if (bm === 'batch' || BATCH_NO.has(bm)) throw new ApiError('Not allowed in a batch: ' + bm);
          out.push({ ok: true, data: await runOne(ctx, bm, ba) });
        } catch (e) { out.push({ ok: false, error: e.message || String(e), code: e.code || 'error' }); }
      }
      return { data: out };
    }
    const data = await runOne(ctx, m, a);
    return { data, ...ctx.out };
  }
  async function runOne(ctx, m, a) {
    const h = H[m]; if (!h) throw new ApiError('Unknown API ' + m, 'unknown', 404);
    if (!PUBLIC.has(m) && !ctx.user) throw new ApiError('Please log in again (your session ended).', 'auth', 401);
    if (ctx.user && ctx.user.must_change && !PUBLIC.has(m) && !MUSTCHANGE_OK.has(m)) throw new ApiError('Please set a new password first.', 'must_change', 403);
    const r = await h(ctx, ...a);
    return r === undefined ? null : r;
  }
  const BATCH_NO = new Set(['auth.login', 'auth.logout', 'auth.changePassword', 'auth.verifyOtp', 'auth.resendOtp', 'mail.test']);   // these set/clear the login cookie
  function need(ctx, role) {
    if (!ctx.user) throw new ApiError('Please log in', 'auth', 401);
    if (!PERMS.allowed(ctx.user.role, role)) throw new ApiError(`Your user role (${ctx.user.role}) is not allowed to do this. Ask the admin.`, 'forbidden', 403);
  }
  function needCompanyId(ctx) { if (!ctx.companyId) throw new ApiError('No company is open', 'no_company'); if (!canSeeCompany(ctx.user, ctx.companyId)) throw new ApiError('You do not have access to this company', 'forbidden', 403); return ctx.companyId; }
  async function withCompany(ctx, mode, fn) {
    const id = needCompanyId(ctx);
    return store[mode === 'write' ? 'write' : 'read'](id, (c) => { c.user = ctx.user.username; return fn(c); });
  }
  async function companyInfo(ctx) {
    if (!ctx.companyId) return null;
    return withCompany(ctx, 'read', c => ({ id: ctx.companyId, settings: c.settings(), fyList: c.fyList(), vtypes: core.VTYPES }));
  }
  function file(name, ext, bytes, mime) { return { __file: { name: XB.safeName(name) + '.' + ext, mime: mime || 'application/octet-stream', b64: CR.toB64(bytes), size: bytes.length } }; }
  async function adminInfo(ctx) {
    const b = await branding(); const ic = b.icon || { kind: 'default' };
    return { appName: b.appName || APP_NAME, defaultName: APP_NAME, isDefaultName: !b.appName, theme: ADM.cleanTheme(b.theme || 'light'), icon: { kind: ic.kind || 'default', id: ic.id || null, file: ic.file || null }, iconUrl: await iconUrl(),
      builtins: ADM.BUILTIN_ICONS.map(x => ({ ...x, url: builtinUrl(x.id) })), username: ctx.user.username, log: await sys.logs(40), server: true };
  }
  function newCompanyId() { return 'c' + Date.now().toString(36) + CR.randomHex(2); }
  async function restoreBytes(ctx, bytes, origName) {
    const head = String.fromCharCode(...bytes.slice(0, 15));
    if (head !== 'SQLite format 3') throw new ApiError('This is not an R&S Sons Accounting backup / company file (.rsbak / .rsdb)');
    const id = newCompanyId();
    const name = await store.importBytes(id, bytes);   // validates it is a company file, migrates, returns its name
    let nm = name; const list = await sys.companies(); if (list.some(c => c.name === nm)) nm = `${name} (Restored ${U.fmtDate(U.today())})`;
    await sys.addCompany({ id, name: nm, created_by: ctx.user.username, restored_from: String(origName || '').slice(0, 120) });
    await sys.log(ctx.user.username, 'Company restored', `${nm} from ${origName || 'file'} (${bytes.length} bytes)`, ctx.ip);
    return { id, name: nm };
  }

  const PUBLIC = new Set(['app.info', 'auth.login', 'auth.logout', 'auth.verifyOtp', 'auth.resendOtp']);
  const MUSTCHANGE_OK = new Set(['auth.changePassword', 'admin.passwordStrength']);

  const H = {
    'app.info': async (ctx) => ({ firstRun: false, server: true, name: await appName(), defaultName: APP_NAME, theme: ADM.cleanTheme((await branding()).theme || 'light'), iconUrl: await iconUrl(), version: VERSION,
      dataDir: env.dataLabel || 'Server', platform: 'web', user: pubUser(ctx.user), company: ctx.user && ctx.companyId ? await companyInfo(ctx).catch(() => null) : null }),

    'auth.login': async (ctx, username, pw, opts) => {
      const remember = !!(opts && opts.remember);
      const uname = String(username || '').trim().toLowerCase().slice(0, 60);
      const keys = ['u:' + uname, 'ip:' + ctx.ip];
      for (const k of keys) { const at = await sys.attempt(k); if (at && Number(at.until) > ctx.now) throw new ApiError(`Too many wrong attempts. Try again in ${Math.ceil((Number(at.until) - ctx.now) / 1000)} s.`, 'rate_limited', 429); }
      const u = await sys.userByName(uname);
      const ok = u && u.active && await verifyPassword(pw, u.pw);
      if (!ok) {
        for (const k of keys) {
          const at = await sys.attempt(k) || { fails: 0 }; const fails = Number(at.fails || 0) + 1;
          const limit = k.startsWith('ip:') ? 20 : 5;          // 5 wrong passwords per username, 20 per network address
          const until = fails >= limit ? ctx.now + Math.min(15 * 60000, 60000 * Math.pow(2, Math.floor(fails / limit) - 1)) : 0;
          await sys.setAttempt(k, fails, until, ctx.now);
        }
        await sys.log(uname, 'Login failed', '', ctx.ip);
        throw new ApiError('Wrong username or password', 'bad_login', 401);
      }
      await Promise.all(keys.map(k => sys.clearAttempt(k)));
      // re-hash old (v1.1, 120k) or weaker hashes to the current format
      if (!String(u.pw).startsWith(`pbkdf2-sha256$${PBKDF2_ITER}$`)) await sys.updateUser(u.id, { pw: await hashPassword(pw) });
      // v2.2: email OTP step — the password was right, now a 6-digit code goes to the user's email; no session until it is entered
      if (await otpRequired(u)) return startChallenge(ctx, u, remember);
      return startSession(ctx, u, remember, '');
    },
    'auth.verifyOtp': async (ctx, challenge, code) => {
      const h = await CR.sha256Hex(String(challenge || '')); const ch = challenge ? await sys.challenge(h) : null;
      if (!ch) throw new ApiError('OTP ka samay khatam ho gaya — dobara login karein · Please log in again.', 'otp_expired', 401);
      if (Number(ch.expires_at) < ctx.now) { await sys.deleteChallenge(h); throw new ApiError('OTP expire ho gaya (10 minute) — dobara login karein · The code expired, please log in again.', 'otp_expired', 401); }
      const u = await sys.userById(ch.user_id); if (!u || !u.active) { await sys.deleteChallenge(h); throw new ApiError('User is not active', 'bad_login', 401); }
      const at = await sys.attempt('u:' + u.username.toLowerCase()); if (at && Number(at.until) > ctx.now) throw new ApiError(`Too many wrong attempts. Try again in ${Math.ceil((Number(at.until) - ctx.now) / 1000)} s.`, 'rate_limited', 429);
      const raw = String(code || '').trim(); const digits = raw.replace(/\D/g, '');
      let ok = false, how = 'OTP';
      if (/^\d{6}$/.test(digits) && raw.replace(/[\s-]/g, '') === digits) ok = (await CR.sha256Hex(h + ':' + digits)) === ch.code_hash;
      else { const bc = raw.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (bc.length === 8) { const list = backupList(u); const bh = await CR.sha256Hex(u.id + ':' + bc); const i = list.indexOf(bh); if (i >= 0) { list.splice(i, 1); await sys.updateUser(u.id, { backup_codes: JSON.stringify(list) }); ok = true; how = 'backup code'; } } }
      if (!ok) {
        const tries = Number(ch.attempts || 0) + 1; const left = OTP_TRIES - tries;
        const k = 'u:' + u.username.toLowerCase(); const a2 = await sys.attempt(k) || { fails: 0 }; const fails = Number(a2.fails || 0) + 1;
        await sys.setAttempt(k, fails, fails >= 5 ? ctx.now + Math.min(15 * 60000, 60000 * Math.pow(2, Math.floor(fails / 5) - 1)) : 0, ctx.now);
        await sys.log(u.username, 'Login OTP wrong', `try ${tries} of ${OTP_TRIES}`, ctx.ip);
        if (left <= 0) { await sys.deleteChallenge(h); throw new ApiError('Galat OTP — 5 baar galat ho gaya, dobara login karein · Wrong code too many times, please log in again.', 'otp_expired', 401); }
        await sys.updateChallenge(h, { attempts: tries });
        throw new ApiError(`Galat OTP · Wrong code (${left} ${left === 1 ? 'try' : 'tries'} left)`, 'otp_wrong', 401);
      }
      await sys.deleteChallenge(h); await sys.clearAttempt('u:' + u.username.toLowerCase());
      if (!Number(u.email_verified)) await sys.updateUser(u.id, { email_verified: 1 });
      return startSession(ctx, u, !!Number(ch.remember), how);
    },
    'auth.resendOtp': async (ctx, challenge) => {
      const h = await CR.sha256Hex(String(challenge || '')); const ch = challenge ? await sys.challenge(h) : null;
      if (!ch || Number(ch.expires_at) < ctx.now) throw new ApiError('OTP ka samay khatam ho gaya — dobara login karein · Please log in again.', 'otp_expired', 401);
      const wait = Math.ceil((Number(ch.last_sent) + OTP_RESEND_MS - ctx.now) / 1000); if (wait > 0) throw new ApiError(`${wait} second baad dobara bhej sakte hain · Wait ${wait} s to resend.`, 'otp_wait', 429);
      if (Number(ch.sends) >= OTP_MAX_SENDS) throw new ApiError('Bahut baar bheja ja chuka — thodi der baad dobara login karein · Too many resends, log in again later.', 'otp_limit', 429);
      const u = await sys.userById(ch.user_id); if (!u || !u.active || !u.email) throw new ApiError('User is not active', 'bad_login', 401);
      if (await sys.recentChallenges(u.id, ctx.now - 3600000) >= OTP_HOURLY) throw new ApiError('Is ghante bahut OTP bheje gaye — 1 ghante baad try karein · Too many codes this hour.', 'otp_limit', 429);
      const code = await newCode(); let mailOk = 1, err = '';
      try { await sendOtpMail(u, code, ctx); } catch (e) { mailOk = 0; err = e.message; }
      await sys.updateChallenge(h, { code_hash: await CR.sha256Hex(h + ':' + code), sends: Number(ch.sends) + 1, last_sent: ctx.now, expires_at: ctx.now + OTP_TTL_MS, mail_ok: mailOk });
      await sys.log(u.username, mailOk ? 'Login OTP re-sent' : 'Login OTP email FAILED', mailOk ? maskEmail(u.email) : err, ctx.ip);
      if (!mailOk) throw new ApiError('OTP email nahi gaya · Could not send the email: ' + err + '. Admin se kahein (Admin Settings → Email OTP), ya backup code use karein.', 'otp_mail_failed', 502);
      return { sentTo: maskEmail(u.email), expiresIn: OTP_TTL_MS / 1000, resendIn: OTP_RESEND_MS / 1000 };
    },
    'auth.backupCodes': async (ctx, pw) => {
      if (!ctx.user) throw new ApiError('Please log in', 'auth', 401); need(ctx, 'operator');
      if (!(await verifyPassword(pw, ctx.user.pw))) throw new ApiError('Password is wrong');
      const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const codes = [], hashes = [];
      for (let i = 0; i < 8; i++) { const hex = CR.randomHex(8); let c = ''; for (let j = 0; j < 8; j++) c += ALPH[parseInt(hex.slice(j * 2, j * 2 + 2), 16) % 32]; codes.push(c.slice(0, 4) + '-' + c.slice(4)); hashes.push(await CR.sha256Hex(ctx.user.id + ':' + c)); }
      await sys.updateUser(ctx.user.id, { backup_codes: JSON.stringify(hashes) }); await sys.log(ctx.user.username, 'Backup codes created', '8 new codes (old ones stop working)', ctx.ip);
      return codes;
    },
    'auth.otpInfo': async (ctx) => { if (!ctx.user) throw new ApiError('Please log in', 'auth', 401); const u = ctx.user; return { email: u.email ? maskEmail(u.email) : '', otpOn: await otpRequired(u), userOtp: Number(u.otp) !== 0, backupLeft: backupList(u).length, globalOn: !!(await sys.kv('otp', {})).enabled }; },

    // ---- v2.2 live updates: every save writes one row; open screens ask "anything new since #seq?" every few seconds ----
    'sync.poll': async (ctx, since) => {
      if (!ctx.user) throw new ApiError('Please log in', 'auth', 401);
      const cid = ctx.companyId; if (!cid || !canSeeCompany(ctx.user, cid)) return { seq: 0, items: [], company: null };
      if (since == null || since === '' || !Number.isFinite(Number(since))) return { seq: await sys.lastChange(cid), items: [], company: cid };
      const rows = await sys.changesSince(cid, Number(since)); const me = (ctx.th || '').slice(0, 12);
      return { company: cid, seq: rows.length ? Number(rows[rows.length - 1].seq) : Number(since), more: rows.length >= 50,
        items: rows.map(r => ({ seq: Number(r.seq), at: Number(r.at), by: r.username, byName: r.full_name || r.username, kind: r.kind, label: r.label, mine: r.sess === me })) };
    },

    // ---- v2.2 email (OTP) settings: the admin enters the Gmail address + App Password here; it is kept only in this server's database ----
    'mail.get': async (ctx) => {
      need(ctx, 'admin'); const m = await sys.kv('mail', {}) || {}; const o = await sys.kv('otp', {}) || {};
      const us = await sys.users();
      return { available: !!env.netOpen, provider: m.provider || 'gmail', host: m.host || '', port: m.port || '', secure: m.secure || '', user: m.user || '', from: m.from || '', fromName: m.fromName || '', hasPass: !!m.pass,
        testedOk: !!m.testedOk, testedAt: m.testedAt || '', lastError: m.lastError || '', otpEnabled: !!o.enabled, presets: MAIL.PRESETS,
        users: us.map(u => ({ username: u.username, role: u.role, email: u.email || '', otp: Number(u.otp) !== 0, verified: !!Number(u.email_verified), active: !!u.active })) };
    },
    'mail.save': async (ctx, s) => {
      need(ctx, 'admin'); s = s || {}; const old = await sys.kv('mail', {}) || {};
      const provider = ['gmail', 'outlook', 'zoho', 'brevo', 'smtp'].includes(s.provider) ? s.provider : 'gmail';
      const m = { provider, user: String(s.user || '').trim(), from: String(s.from || '').trim(), fromName: String(s.fromName || '').trim().slice(0, 60) };
      if (m.user && !/^\S+$/.test(m.user)) throw new ApiError('Email login (username) is not valid');
      if (provider === 'gmail') { if (m.user) MAIL.cleanAddr(m.user); }
      if (m.from) MAIL.cleanAddr(m.from);
      if (provider === 'smtp') { m.host = String(s.host || '').trim(); m.port = Number(s.port) || 587; m.secure = s.secure === 'ssl' ? 'ssl' : s.secure === 'none' ? 'none' : 'starttls'; if (!/^[a-z0-9.-]+$/i.test(m.host)) throw new ApiError('SMTP host is not valid'); if (m.secure === 'none' && !/^(localhost|127\.0\.0\.1)$/.test(m.host)) throw new ApiError('Bina encryption sirf isi computer ke relay (localhost) ke liye · No-encryption only for localhost'); if (m.port === 25) throw new ApiError('Port 25 is blocked on the hosted server — use 465 (SSL) or 587 (STARTTLS)'); }
      const pass = String(s.pass || '').replace(/\s+/g, provider === 'gmail' ? '' : ' ').trim();
      m.pass = pass || old.pass || '';
      const same = ['provider', 'user', 'host', 'port', 'secure', 'from'].every(k => String(m[k] || '') === String(old[k] || '')) && m.pass === old.pass;
      m.testedOk = same ? !!old.testedOk : false; m.testedAt = same ? old.testedAt || '' : ''; m.lastError = same ? old.lastError || '' : '';
      await sys.setKv('mail', m);
      if (!m.testedOk) { const o = await sys.kv('otp', {}) || {}; if (o.enabled) await sys.setKv('otp', { enabled: false, by: ctx.user.username, at: new Date(ctx.now).toISOString(), why: 'email settings changed' }); }
      await sys.log(ctx.user.username, 'Email (OTP) settings saved', `${provider} ${m.user}${pass ? ' (new app password)' : ''}`, ctx.ip);
      return H['mail.get'](ctx);
    },
    'mail.test': async (ctx, to) => {
      need(ctx, 'admin'); const m = await sys.kv('mail', {}) || {}; to = String(to || ctx.user.email || m.user || '').trim();
      if (!to) throw new ApiError('Test mail kis email pe bheje? Pehle apna email daalein.');
      MAIL.cleanAddr(to);
      try {
        const r = await sendMail(to, `${await appName()} — test mail ✔`, `Ye test mail hai. Email OTP ki settings sahi hain.\nThis is a test mail: the email (OTP) settings work.\n\n${await appName()}`, null);
        m.testedOk = true; m.testedAt = new Date(ctx.now).toISOString(); m.lastError = ''; await sys.setKv('mail', m);
        await sys.log(ctx.user.username, 'Test mail sent', maskEmail(to), ctx.ip);
        return { ok: true, to: maskEmail(to), id: r.id };
      } catch (e) {
        const msg = mailHint(m, e); m.testedOk = false; m.lastError = msg.slice(0, 300); await sys.setKv('mail', m);
        await sys.log(ctx.user.username, 'Test mail FAILED', msg.slice(0, 200), ctx.ip);
        throw new ApiError(msg, 'mail_failed', 502);
      }
    },
    'otp.setEnabled': async (ctx, on) => {
      need(ctx, 'admin'); const m = await sys.kv('mail', {}) || {};
      if (on && !m.testedOk) throw new ApiError('Pehle "Test mail bhejo" successful karein, tab OTP chalu hoga · Send a successful test mail first.');
      await sys.setKv('otp', { enabled: !!on, by: ctx.user.username, at: new Date(ctx.now).toISOString() });
      await sys.log(ctx.user.username, on ? 'Email OTP turned ON' : 'Email OTP turned OFF', on ? 'users with an email get a code at login' : 'logins need only the password', ctx.ip);
      return H['mail.get'](ctx);
    },
    'auth.logout': async (ctx) => { if (ctx.th) await sys.deleteSession(ctx.th); ctx.out.clearToken = true; return true; },
    'auth.changePassword': async (ctx, oldPw, newPw) => {
      const u = ctx.user; if (!(await verifyPassword(oldPw, u.pw))) throw new ApiError('Current password is wrong');
      const chk = ADM.checkPassword(newPw, { username: u.username, oldPw }); if (!chk.ok) throw new ApiError('New password: ' + chk.errors.join('; '));
      await sys.updateUser(u.id, { pw: await hashPassword(newPw), must_change: 0, pw_changed: new Date().toISOString() });
      await sys.deleteUserSessions(u.id, ctx.th);           // log out this user's other devices
      await sys.log(u.username, 'Password changed', 'own password', ctx.ip);
      return true;
    },

    // ---- admin settings ----
    'admin.info': async (ctx) => { need(ctx, 'admin'); return adminInfo(ctx); },
    'admin.passwordStrength': async (ctx, pw) => { const c = ADM.checkPassword(pw, { username: ctx.user.username }); return { ok: c.ok, score: c.score, label: c.label, errors: c.errors }; },
    'admin.changePassword': async (ctx, curPw, newPw, repeatPw) => {
      need(ctx, 'admin'); const u = ctx.user;
      if (!(await verifyPassword(curPw, u.pw))) throw new ApiError('Current password is wrong');
      if (String(newPw) !== String(repeatPw)) throw new ApiError('New password and confirm password do not match');
      const chk = ADM.checkPassword(newPw, { username: u.username, oldPw: curPw }); if (!chk.ok) throw new ApiError('New password: ' + chk.errors.join('; '));
      await sys.updateUser(u.id, { pw: await hashPassword(newPw), must_change: 0, pw_changed: new Date().toISOString() });
      await sys.deleteUserSessions(u.id, ctx.th);
      await sys.log(u.username, 'Password changed', `for user ${u.username}`, ctx.ip); return true;
    },
    'admin.changeUsername': async (ctx, newName, curPw) => {
      need(ctx, 'admin'); const u = ctx.user;
      if (!(await verifyPassword(curPw, u.pw))) throw new ApiError('Current password is wrong');
      const n = ADM.validateUsername(newName, (await sys.users()).map(x => x.username), u.username);
      await sys.updateUser(u.id, { username: n }); await sys.log(n, 'Username changed', `${u.username} → ${n}`, ctx.ip);
      return { username: n, role: u.role, mustChange: !!u.must_change };
    },
    'admin.setAppName': async (ctx, name) => {
      need(ctx, 'admin'); const b = await branding(); const before = b.appName || APP_NAME; const n = ADM.cleanAppName(name);
      if (n === APP_NAME) delete b.appName; else b.appName = n; await sys.setKv('branding', b);
      await sys.log(ctx.user.username, 'App name changed', `${before} → ${b.appName || APP_NAME}`, ctx.ip); return adminInfo(ctx);
    },
    'admin.setTheme': async (ctx, t) => { need(ctx, 'admin'); const b = await branding(); const before = b.theme || 'light'; b.theme = ADM.cleanTheme(t); await sys.setKv('branding', b); if (before !== b.theme) await sys.log(ctx.user.username, 'Theme changed', `${before} → ${b.theme}`, ctx.ip); return { theme: b.theme }; },
    'admin.setIcon': async (ctx, choice = {}) => {
      need(ctx, 'admin'); const b = await branding();
      if (choice.kind === 'default') { b.icon = { kind: 'default' }; delete b.iconData; }
      else if (choice.kind === 'builtin') { if (!ADM.BUILTIN_ICONS.some(x => x.id === choice.id)) throw new ApiError('Unknown built-in icon'); b.icon = choice.id === 'rs' ? { kind: 'default' } : { kind: 'builtin', id: choice.id }; delete b.iconData; }
      else if (choice.kind === 'file') {
        const d = String(choice.dataUrl || ''); if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(d) || d.length > 400000) throw new ApiError('Choose a PNG/JPG image (it is resized to 256×256 in your browser first)');
        b.icon = { kind: 'custom', file: String(choice.name || 'image').slice(0, 80), at: new Date().toISOString() }; b.iconData = d;
      } else throw new ApiError('Choose an icon');
      await sys.setKv('branding', b); await sys.log(ctx.user.username, 'App icon changed', b.icon.kind + (b.icon.id ? ' ' + b.icon.id : ''), ctx.ip); return adminInfo(ctx);
    },
    'admin.log': async (ctx) => { need(ctx, 'admin'); return sys.logs(200); },

    // ---- users & roles ----
    'users.list': async (ctx) => { need(ctx, 'admin'); return (await sys.users()).map(u => ({ username: u.username, role: u.role, active: !!u.active, lastLogin: u.last_login || '', created: u.created_at, companies: companiesOf(u), mustChange: !!u.must_change, fullName: u.full_name || '', email: u.email || '', otp: Number(u.otp) !== 0, emailVerified: !!Number(u.email_verified) })); },
    'users.save': async (ctx, u) => {
      need(ctx, 'admin'); u = u || {};
      if (!u.username || !/^[\w.@-]{2,30}$/.test(u.username)) throw new ApiError('Username: 2–30 letters/numbers');
      if (!ROLES.includes(u.role)) throw new ApiError('Role must be admin, operator or viewer');
      if (u.password) { const chk = ADM.checkPassword(u.password, { username: u.username }); if (!chk.ok) throw new ApiError('Password: ' + chk.errors.join('; ')); }
      let email; if (u.email !== undefined) { email = String(u.email || '').trim().toLowerCase(); if (email) { try { MAIL.cleanAddr(email); } catch (_) { throw new ApiError('Email is not valid'); } } }
      let comps = '*'; if (Array.isArray(u.companies)) comps = JSON.stringify(u.companies.map(String)); else if (u.companies && u.companies !== '*') throw new ApiError('Companies must be a list or *');
      const all = await sys.users(); let x = all.find(y => y.username.toLowerCase() === u.username.toLowerCase());
      if (!x) {
        if (!u.password) throw new ApiError('Password is required for a new user');
        ADM.validateUsername(u.username, all.map(y => y.username));
        await sys.addUser({ username: u.username, pw: await hashPassword(u.password), role: u.role, active: u.active !== false, must_change: u.mustChange !== false, companies: comps, full_name: u.fullName, email: email || null, otp: u.otp !== false });
        await sys.log(ctx.user.username, 'User created', `${u.username} (${u.role})`, ctx.ip);
      } else {
        if (x.id === ctx.user.id && u.role !== 'admin') throw new ApiError('You cannot remove your own admin role');
        if (x.id === ctx.user.id && u.active === false) throw new ApiError('You cannot deactivate yourself');
        const f = { role: u.role, active: u.active === false ? 0 : 1, companies: comps };
        if (u.fullName !== undefined) f.full_name = u.fullName;
        if (email !== undefined && email !== (x.email || '')) { f.email = email || null; f.email_verified = 0; }
        if (u.otp !== undefined) f.otp = u.otp === false || u.otp === 0 ? 0 : 1;
        if (u.password) { f.pw = await hashPassword(u.password); f.must_change = u.mustChange === false ? 0 : 1; }
        const others = all.filter(y => y.id !== x.id);
        if (!others.some(y => y.role === 'admin' && y.active) && !(f.role === 'admin' && f.active)) throw new ApiError('At least one active admin is required');
        await sys.updateUser(x.id, f);
        if (u.password || f.active === 0) await sys.deleteUserSessions(x.id, ctx.th);
        await sys.log(ctx.user.username, 'User changed', `${x.username}: role ${f.role}${f.active ? '' : ', deactivated'}${u.password ? ', password reset' : ''}${f.email !== undefined ? ', email ' + (f.email ? maskEmail(f.email) : 'removed') : ''}${f.otp !== undefined ? ', OTP ' + (f.otp ? 'on' : 'off') : ''}`, ctx.ip);
      }
      return true;
    },
    'users.delete': async (ctx, username) => {
      need(ctx, 'admin'); const x = await sys.userByName(username); if (!x) return false;
      if (x.id === ctx.user.id) throw new ApiError('You cannot delete yourself');
      const rest = (await sys.users()).filter(y => y.id !== x.id); if (!rest.some(y => y.role === 'admin' && y.active)) throw new ApiError('At least one active admin is required');
      await sys.deleteUserSessions(x.id, ''); await sys.deleteUser(x.id); await sys.log(ctx.user.username, 'User deleted', x.username, ctx.ip); return true;
    },
    // Import users from a v1.1 desktop "system.json" (same password hashes, so they keep their passwords)
    'users.importV1': async (ctx, sysJson) => {
      need(ctx, 'admin'); let j; try { j = typeof sysJson === 'string' ? JSON.parse(sysJson) : sysJson; } catch (_) { throw new ApiError('Not a valid system.json file'); }
      if (!j || !Array.isArray(j.users)) throw new ApiError('No users found in this file (choose the system.json from the old Data folder)');
      const out = { added: [], skipped: [] };
      for (const u of j.users) {
        if (!u.username || !u.salt || !u.hash || !/^[\w.@-]{2,30}$/.test(u.username)) { out.skipped.push(String(u.username || '?')); continue; }
        if (await sys.userByName(u.username)) { out.skipped.push(u.username + ' (already exists)'); continue; }
        await sys.addUser({ username: u.username, pw: legacyHash(u), role: ROLES.includes(u.role) ? u.role : 'viewer', active: u.active !== false, must_change: !!u.mustChange });
        out.added.push(u.username);
      }
      await sys.log(ctx.user.username, 'Users imported from v1.1', `added ${out.added.length}, skipped ${out.skipped.length}`, ctx.ip);
      return out;
    },

    // ---- companies ----
    'company.list': async (ctx) => {
      const list = (await sys.companies()).filter(c => canSeeCompany(ctx.user, c.id));
      const out = []; for (const c of list) out.push({ id: c.id, name: c.name, gstin: c.gstin, created: c.created_at, lastOpened: c.last_opened || '', size: await store.size(c.id).catch(() => 0) });
      return out.sort((a, b) => (b.lastOpened || '').localeCompare(a.lastOpened || ''));
    },
    'company.create': async (ctx, info) => {
      need(ctx, 'admin'); info = info || {}; if (!info.name || !String(info.name).trim()) throw new ApiError('Company name is required');
      if (info.gstin && !U.validGSTIN(info.gstin)) throw new ApiError('GSTIN is not valid');
      if (info.gstin) { info.gstin = info.gstin.toUpperCase(); info.state_code = info.gstin.slice(0, 2); if (!info.pan) info.pan = info.gstin.slice(2, 12); }
      const id = newCompanyId();
      await store.create(id, info, ctx.user.username);
      await sys.addCompany({ id, name: String(info.name).trim(), gstin: info.gstin || '', created_by: ctx.user.username });
      await sys.log(ctx.user.username, 'Company created', String(info.name).trim(), ctx.ip);
      return H['company.open'](ctx, id);
    },
    'company.open': async (ctx, id) => {
      const meta = await sys.company(id); if (!meta) throw new ApiError('Company not found');
      if (!canSeeCompany(ctx.user, id)) throw new ApiError('You do not have access to this company', 'forbidden', 403);
      await Promise.all([sys.setSessionCompany(ctx.th, id), sys.updateCompany(id, { last_opened: new Date(ctx.now).toISOString() })]); ctx.companyId = id;
      // operators/admins: post recurring vouchers marked "auto" that have fallen due (each due date is posted once, ever)
      if (PERMS.allowed(ctx.user.role, 'operator')) { try { await withCompany(ctx, 'write', c => c.runRecurring({ onlyAuto: true })); } catch (_) {} }
      const bk = Promise.resolve().then(() => store.dailyBackup(id)).catch(() => {});
      if (ctx.defer) ctx.defer(bk); else await bk;   // hosted: the daily copy is made after the answer is sent
      return companyInfo(ctx);
    },
    'company.close': async (ctx) => { await sys.setSessionCompany(ctx.th, null); ctx.companyId = null; return true; },
    'company.info': async (ctx) => companyInfo(ctx),
    'company.saveSettings': async (ctx, s) => {
      need(ctx, 'admin'); const r = await withCompany(ctx, 'write', c => c.saveSettings(s));
      const f = {}; if (s.name) f.name = s.name; if (s.gstin !== undefined) f.gstin = s.gstin; if (Object.keys(f).length) await sys.updateCompany(ctx.companyId, f);
      await recordChange(ctx, 'edit', 'Company settings');
      return r;
    },
    'company.delete': async (ctx, id, confirmed) => {
      need(ctx, 'admin'); if (!confirmed) throw new ApiError('Please confirm the delete');
      const m = await sys.company(id); if (!m) return false;
      await store.remove(id); await sys.deleteCompany(id);
      if (ctx.companyId === id) { await sys.setSessionCompany(ctx.th, null); ctx.companyId = null; }
      await sys.log(ctx.user.username, 'Company deleted', `${m.name} (a final backup copy is kept on the server)`, ctx.ip); return true;
    },
    'company.backup': async (ctx, id) => {
      need(ctx, 'operator'); id = id || ctx.companyId; const m = await sys.company(id); if (!m || !canSeeCompany(ctx.user, id)) throw new ApiError('Select a company');
      const bytes = await store.exportBytes(id);
      await sys.log(ctx.user.username, 'Backup downloaded', m.name, ctx.ip);
      return file(`${m.name}_backup_${U.today()}`, 'rsbak', bytes);
    },
    'company.restore': async (ctx, f) => {
      need(ctx, 'admin'); if (!f || !f.b64) throw new ApiError('Choose a backup file (.rsbak or .rsdb)');
      return restoreBytes(ctx, CR.fromB64(f.b64), f.name);
    },
    'company.backupsList': async (ctx) => { need(ctx, 'viewer'); return ctx.companyId ? store.listBackups(ctx.companyId) : []; },
    'company.openDataFolder': async () => true,

    // ---- all company actions (reports, vouchers, masters, automation) ----
    'c': async (ctx, method, ...args) => {
      const role = PERMS.roleFor(method); if (!role) throw new ApiError('Unknown action ' + method);
      need(ctx, role);
      if (method === 'saveSettings') return H['company.saveSettings'](ctx, ...args);
      if (role === 'viewer') return withCompany(ctx, 'read', c => c[method](...args));
      if (method === 'sqlQuery') return withCompany(ctx, 'write', c => c[method](...args));   // read-only SELECT (admin)
      let pre = null;
      const res = await withCompany(ctx, 'write', c => {
        try { if (method === 'deleteVoucher') pre = c.voucher(args[0]); else if (method === 'deleteLedger') pre = c.ledger(args[0]); else if (method === 'deleteItem') pre = c.item(args[0]); } catch (_) {}
        return c[method](...args);
      });
      const [kind, label] = changeLabel(method, args, res, pre); await recordChange(ctx, kind, label);
      return res;
    },

    // ---- documents & files (the browser shows / prints the HTML; "Save as PDF" in the print window makes the PDF) ----
    'doc.html': async (ctx, kind, id, opts = {}) => { PR.setAppName(await appName()); const d = await DOCS.docHtml(await companyFor(ctx), kind, id, opts, QRCode); return d.html; },
    'doc.named': async (ctx, kind, id, opts = {}) => { PR.setAppName(await appName()); return DOCS.docHtml(await companyFor(ctx), kind, id, opts, QRCode); },
    'doc.shareText': async (ctx, vid) => withCompany(ctx, 'read', c => DOCS.shareText(c, vid)),
    'export.excel': async (ctx, rep, name) => file(name || rep.title, 'xlsx', XB.reportBook(XLSX, rep)),
    'export.text': async (ctx, content, name, ext) => file(name, ext || 'txt', CR.utf8(String(content)), 'text/plain'),
    'export.json': async (ctx, obj, name) => file(name, 'json', CR.utf8(JSON.stringify(obj, null, 2)), 'application/json'),
    'export.gstr1Excel': async (ctx, f) => withCompany(ctx, 'read', c => file(`GSTR-1 ${f.from} to ${f.to}`, 'xlsx', XB.gstr1Book(XLSX, c, f))),
    'export.excelBook': async (ctx, sheets, name) => { const wb = XLSX.utils.book_new(); for (const sh of sheets || []) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sh.rows || []), String(sh.name || 'Sheet').slice(0, 30)); return file(name || 'Export', 'xlsx', new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))); },
    'masters.export': async (ctx) => withCompany(ctx, 'read', c => file('Masters ' + c.setting('name'), 'xlsx', XB.mastersBook(XLSX, c))),
    'masters.template': async () => file('R&S Sons import template', 'xlsx', XB.templateBook(XLSX)),
    'masters.importFile': async (ctx, f) => { need(ctx, 'operator'); const wb = XLSX.read(CR.fromB64(f.b64), { type: 'array' }); const r = await withCompany(ctx, 'write', c => XB.importMasters(XLSX, c, wb)); await recordChange(ctx, 'new', 'Masters import (Excel)'); return r; },
    'file.rows': async (ctx, f) => { if (!f || !f.b64) throw new ApiError('Choose a file'); return XB.sheetRows(XLSX, CR.fromB64(f.b64)); },
  };
  async function companyFor(ctx) {
    // documents only read; give them a read-only company object
    let out; await withCompany(ctx, 'read', c => { out = c; return null; });
    return out;
  }
  return { handle, H, ApiError, hashPassword, verifyPassword, async bootstrapAdmin(username, pwHashOrPlain, isHash) {
    if (await sys.userCount() > 0) return false;
    await sys.addUser({ username: username || 'admin', pw: isHash ? pwHashOrPlain : await hashPassword(pwHashOrPlain), role: 'admin', must_change: true });
    await sys.log('system', 'Admin account created', username || 'admin', ''); return true;
  } };
}
module.exports = { createService, ApiError };
