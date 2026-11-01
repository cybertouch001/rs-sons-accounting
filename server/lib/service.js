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
const U = core.util;

const APP_NAME = 'R&S Sons Accounting';
const PBKDF2_ITER = 100000;               // PBKDF2-SHA256, 100k rounds, 16-byte random salt per user
const IDLE_MS = 12 * 3600 * 1000;         // a session ends after 12 h without use
const MAX_MS = 7 * 24 * 3600 * 1000;      // and after 7 days in any case
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
    if (Number(s.expires_at) < now || now - Number(s.created_at) > MAX_MS) { await sys.deleteSession(th); return null; }
    const u = await sys.userById(s.user_id); if (!u || !u.active) { await sys.deleteSession(th); return null; }
    if (now - Number(s.last_seen) > 60000) await sys.touchSession(th, now, now + IDLE_MS);
    return { th, s, u };
  }
  function pubUser(u) { return u && { username: u.username, role: u.role, mustChange: !!u.must_change, fullName: u.full_name || '' }; }
  function companiesOf(u) { if (!u.companies || u.companies === '*') return '*'; try { const a = JSON.parse(u.companies); return Array.isArray(a) ? a : '*'; } catch (_) { return '*'; } }
  function canSeeCompany(u, id) { const a = companiesOf(u); return a === '*' || a.includes(id); }

  async function handle(req) {
    // req: { token, method, args, ip, ua, now }
    const now = req.now || Date.now();
    const m = String(req.method || ''); const a = Array.isArray(req.args) ? req.args : [];
    const ctx = { ip: req.ip || '', ua: req.ua || '', now, out: {} };
    const sess = await loadSession(req.token, now);
    if (sess) { ctx.th = sess.th; ctx.user = sess.u; ctx.companyId = sess.s.company_id || null; }
    const h = H[m]; if (!h) throw new ApiError('Unknown API ' + m, 'unknown', 404);
    if (!PUBLIC.has(m) && !ctx.user) throw new ApiError('Please log in again (your session ended).', 'auth', 401);
    if (ctx.user && ctx.user.must_change && !PUBLIC.has(m) && !MUSTCHANGE_OK.has(m)) throw new ApiError('Please set a new password first.', 'must_change', 403);
    const data = await h(ctx, ...a);
    return { data, ...ctx.out };
  }
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

  const PUBLIC = new Set(['app.info', 'auth.login', 'auth.logout']);
  const MUSTCHANGE_OK = new Set(['auth.changePassword', 'admin.passwordStrength']);

  const H = {
    'app.info': async (ctx) => ({ firstRun: false, server: true, name: await appName(), defaultName: APP_NAME, theme: ADM.cleanTheme((await branding()).theme || 'light'), iconUrl: await iconUrl(), version: VERSION,
      dataDir: env.dataLabel || 'Server', platform: 'web', user: pubUser(ctx.user), company: ctx.user && ctx.companyId ? await companyInfo(ctx).catch(() => null) : null }),

    'auth.login': async (ctx, username, pw) => {
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
      for (const k of keys) await sys.clearAttempt(k);
      // re-hash old (v1.1, 120k) or weaker hashes to the current format
      if (!String(u.pw).startsWith(`pbkdf2-sha256$${PBKDF2_ITER}$`)) await sys.updateUser(u.id, { pw: await hashPassword(pw) });
      const token = CR.randomToken(); const th = await CR.sha256Hex(token);
      await sys.addSession({ token_hash: th, user_id: u.id, now: ctx.now, expires_at: ctx.now + IDLE_MS, ip: ctx.ip, ua: ctx.ua });
      await sys.updateUser(u.id, { last_login: new Date(ctx.now).toISOString() });
      await sys.log(u.username, 'Login', '', ctx.ip);
      if (Math.random() < 0.05) await sys.purgeSessions(ctx.now);
      ctx.out.setToken = token;
      return pubUser(u);
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
    'users.list': async (ctx) => { need(ctx, 'admin'); return (await sys.users()).map(u => ({ username: u.username, role: u.role, active: !!u.active, lastLogin: u.last_login || '', created: u.created_at, companies: companiesOf(u), mustChange: !!u.must_change, fullName: u.full_name || '' })); },
    'users.save': async (ctx, u) => {
      need(ctx, 'admin'); u = u || {};
      if (!u.username || !/^[\w.@-]{2,30}$/.test(u.username)) throw new ApiError('Username: 2–30 letters/numbers');
      if (!ROLES.includes(u.role)) throw new ApiError('Role must be admin, operator or viewer');
      if (u.password) { const chk = ADM.checkPassword(u.password, { username: u.username }); if (!chk.ok) throw new ApiError('Password: ' + chk.errors.join('; ')); }
      let comps = '*'; if (Array.isArray(u.companies)) comps = JSON.stringify(u.companies.map(String)); else if (u.companies && u.companies !== '*') throw new ApiError('Companies must be a list or *');
      const all = await sys.users(); let x = all.find(y => y.username.toLowerCase() === u.username.toLowerCase());
      if (!x) {
        if (!u.password) throw new ApiError('Password is required for a new user');
        ADM.validateUsername(u.username, all.map(y => y.username));
        await sys.addUser({ username: u.username, pw: await hashPassword(u.password), role: u.role, active: u.active !== false, must_change: u.mustChange !== false, companies: comps, full_name: u.fullName });
        await sys.log(ctx.user.username, 'User created', `${u.username} (${u.role})`, ctx.ip);
      } else {
        if (x.id === ctx.user.id && u.role !== 'admin') throw new ApiError('You cannot remove your own admin role');
        if (x.id === ctx.user.id && u.active === false) throw new ApiError('You cannot deactivate yourself');
        const f = { role: u.role, active: u.active === false ? 0 : 1, companies: comps };
        if (u.fullName !== undefined) f.full_name = u.fullName;
        if (u.password) { f.pw = await hashPassword(u.password); f.must_change = u.mustChange === false ? 0 : 1; }
        const others = all.filter(y => y.id !== x.id);
        if (!others.some(y => y.role === 'admin' && y.active) && !(f.role === 'admin' && f.active)) throw new ApiError('At least one active admin is required');
        await sys.updateUser(x.id, f);
        if (u.password || f.active === 0) await sys.deleteUserSessions(x.id, ctx.th);
        await sys.log(ctx.user.username, 'User changed', `${x.username}: role ${f.role}${f.active ? '' : ', deactivated'}${u.password ? ', password reset' : ''}`, ctx.ip);
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
      await sys.setSessionCompany(ctx.th, id); ctx.companyId = id;
      await sys.updateCompany(id, { last_opened: new Date(ctx.now).toISOString() });
      // operators/admins: post recurring vouchers marked "auto" that have fallen due (each due date is posted once, ever)
      if (PERMS.allowed(ctx.user.role, 'operator')) { try { await withCompany(ctx, 'write', c => c.runRecurring({ onlyAuto: true })); } catch (_) {} }
      try { await store.dailyBackup(id); } catch (_) {}
      return companyInfo(ctx);
    },
    'company.close': async (ctx) => { await sys.setSessionCompany(ctx.th, null); ctx.companyId = null; return true; },
    'company.info': async (ctx) => companyInfo(ctx),
    'company.saveSettings': async (ctx, s) => {
      need(ctx, 'admin'); const r = await withCompany(ctx, 'write', c => c.saveSettings(s));
      const f = {}; if (s.name) f.name = s.name; if (s.gstin !== undefined) f.gstin = s.gstin; if (Object.keys(f).length) await sys.updateCompany(ctx.companyId, f);
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
      return withCompany(ctx, role === 'viewer' ? 'read' : 'write', c => c[method](...args));
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
    'masters.importFile': async (ctx, f) => { need(ctx, 'operator'); const wb = XLSX.read(CR.fromB64(f.b64), { type: 'array' }); return withCompany(ctx, 'write', c => XB.importMasters(XLSX, c, wb)); },
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
