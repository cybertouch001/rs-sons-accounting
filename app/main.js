
// R&S Sons Accounting - Electron main process
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeImage, nativeTheme, net } = require('electron');
const path = require('path'), fs = require('fs'), crypto = require('crypto'), os = require('os');
const APP_NAME = 'R&S Sons Accounting'; // default display name; the admin can rename the app (Admin Settings) — see appName()
const VERSION = require('./package.json').version;
let SQL, win, dataDir, sys;

// ---------------- startup safety: crash log + friendly error instead of a silent exit ----------------
// Log folder: Documents\RS Sons Accounting\Logs (same folder the app keeps its data in). If Documents is
// missing/redirected/unwritable (OneDrive, roaming profiles, locked-down PCs) we fall back to
// %APPDATA%\R&S Sons Accounting\logs, then the temp folder — logging must never be the thing that crashes.
function safeGetPath(name) { try { return app.getPath(name); } catch (_) { return null; } }
function canWrite(dir) { try { fs.mkdirSync(dir, { recursive: true }); const t = path.join(dir, '.rs_write_test'); fs.writeFileSync(t, 'ok'); fs.unlinkSync(t); return true; } catch (_) { return false; } }
function pickDataDir() {
  if (process.env.RS_DATA_DIR) return process.env.RS_DATA_DIR;
  const cands = [];
  const docs = safeGetPath('documents'); if (docs) cands.push(path.join(docs, 'RS Sons Accounting'));
  if (process.env.USERPROFILE) cands.push(path.join(process.env.USERPROFILE, 'Documents', 'RS Sons Accounting'));
  const ud = safeGetPath('userData'); if (ud) cands.push(path.join(ud, 'Data'));
  cands.push(path.join(os.homedir(), 'RS Sons Accounting'));
  for (const c of cands) if (canWrite(c)) return c;
  throw new Error('Could not find a folder where R&S Sons Accounting is allowed to save data.\nTried:\n' + cands.join('\n'));
}
let startupLogFile = null;
function startupLog(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  const tryDirs = [];
  if (startupLogFile) tryDirs.push(path.dirname(startupLogFile));
  try { if (typeof dataDir === 'string' && dataDir) tryDirs.push(path.join(dataDir, 'Logs')); } catch (_) {}
  if (process.env.RS_DATA_DIR) tryDirs.push(path.join(process.env.RS_DATA_DIR, 'Logs'));
  const docs = safeGetPath('documents'); if (docs) tryDirs.push(path.join(docs, 'RS Sons Accounting', 'Logs'));
  const ud = safeGetPath('userData'); if (ud) tryDirs.push(path.join(ud, 'logs'));
  tryDirs.push(os.tmpdir());
  for (const d of tryDirs) { try { fs.mkdirSync(d, { recursive: true }); const f = path.join(d, 'startup.log'); try { if (fs.statSync(f).size > 512 * 1024) fs.renameSync(f, f + '.old'); } catch (_) {} fs.appendFileSync(f, line); startupLogFile = f; return f; } catch (_) {} }
  return null;
}
let fatalShown = false;
function fatal(where, err) {
  const msg = (err && (err.stack || err.message)) || String(err);
  const f = startupLog(`FATAL in ${where}: ${msg}`);
  if (fatalShown) return; fatalShown = true;
  try {
    dialog.showErrorBox(APP_NAME + ' could not start',
      `Sorry, ${APP_NAME} hit a problem while ${where}.\n\n${(err && err.message) || err}\n\n` +
      (f ? `Details were saved in:\n${f}\n\n` : '') +
      'Your company data is safe — it is not deleted. Please restart the app; if it keeps happening, send the log file above to support.');
  } catch (_) {}
  try { app.exit(1); } catch (_) { process.exit(1); }
}
process.on('uncaughtException', (e) => { startupLog('uncaughtException: ' + (e && e.stack || e)); if (!win) fatal('starting up', e); else logError(e); });
process.on('unhandledRejection', (e) => { startupLog('unhandledRejection: ' + (e && e.stack || e)); if (!win) fatal('starting up', e); else logError(e); });
startupLog(`starting ${APP_NAME} ${VERSION} · electron ${process.versions.electron} · ${process.platform} ${os.release()} ${process.arch}` + (process.env.PORTABLE_EXECUTABLE_DIR ? ' · portable' : '') + ` · exe ${process.execPath}`);
// An accounting app needs no GPU; software rendering avoids the blank/white window and GPU-process crashes
// seen on old Windows PCs with bad graphics drivers (and inside VMs / Wine).
if (process.env.RS_GPU !== '1') { try { app.disableHardwareAcceleration(); } catch (_) {} }

let initSqlJs, XLSX, QRCode, core, PR, U, ADM;
try {
  initSqlJs = require('sql.js'); XLSX = require('xlsx'); QRCode = require('qrcode');
  core = require('./core'); PR = require('./core/print'); U = core.util; ADM = require('./core/admin');
} catch (e) { fatal('loading its program files (the installation may be damaged — please reinstall)', e); }

const S = { user: null, company: null, companyId: null, dirty: false, failed: {} };
let saveTimer = null;

// ---------------- storage ----------------
function paths() {
  return { sys: path.join(dataDir, 'system.json'), companies: path.join(dataDir, 'Companies'), backups: path.join(dataDir, 'Backups'), pdf: path.join(dataDir, 'PDF'), exports: path.join(dataDir, 'Exports'), logs: path.join(dataDir, 'Logs') };
}
function ensureDirs() { for (const p of Object.values(paths())) if (!p.endsWith('.json')) fs.mkdirSync(p, { recursive: true }); }
function atomicWrite(file, data) {
  const tmp = file + '.tmp'; fs.writeFileSync(tmp, data);
  // Windows: antivirus / search indexer / cloud sync can briefly lock the target and make rename fail (EPERM/EBUSY)
  for (let i = 0; i < 5; i++) { try { fs.renameSync(tmp, file); return; } catch (e) { if (!/EPERM|EBUSY|EACCES/.test(e.code || '') || i === 4) { try { fs.copyFileSync(tmp, file); fs.unlinkSync(tmp); return; } catch (_) { throw e; } } const t = Date.now() + 60 * (i + 1); while (Date.now() < t) { /* brief wait */ } } }
}
function loadSys() {
  const f = paths().sys;
  if (fs.existsSync(f)) { try { sys = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { fs.copyFileSync(f, f + '.corrupt-' + Date.now()); sys = null; } }
  if (!sys) sys = { users: [], companies: [], created: new Date().toISOString() };
  if (!sys.users.length) { const u = makeUser('admin', 'admin', 'admin'); u.mustChange = true; sys.users.push(u); saveSys(); }
  if (!sys.branding || typeof sys.branding !== 'object') sys.branding = {};
  if (!Array.isArray(sys.adminLog)) sys.adminLog = [];
  try { PR.setAppName(appName()); } catch (_) {}
  try { nativeTheme.themeSource = themeSetting(); } catch (_) {}
}

// ---------------- branding & admin settings (app name, icon, theme) ----------------
function appName() { return (sys && sys.branding && sys.branding.appName) || APP_NAME; }
function themeSetting() { const t = sys && sys.branding && sys.branding.theme; return ['light', 'dark', 'system'].includes(t) ? t : 'light'; }
function brandingDir() { return path.join(dataDir, 'Branding'); }
function builtinIconFile(id) { const f = path.join(__dirname, 'assets', 'icons', String(id).replace(/[^a-z0-9_-]/gi, '') + '.png'); return fs.existsSync(f) ? f : null; }
// The icon the window/taskbar and the in-app logo should show right now (custom → built-in → shipped default).
function currentIconFile() {
  const ic = sys && sys.branding && sys.branding.icon;
  if (ic && ic.kind === 'custom') { const f = path.join(brandingDir(), 'custom-icon.png'); if (fs.existsSync(f)) return f; }
  if (ic && ic.kind === 'builtin') { const f = builtinIconFile(ic.id); if (f) return f; }
  return null;
}
function windowIcon() { const f = currentIconFile(); if (f) { const img = nativeImage.createFromPath(f); if (!img.isEmpty()) return img; } return iconPath(); }
function iconDataUrl() { const f = currentIconFile(); return f ? 'data:image/png;base64,' + fs.readFileSync(f).toString('base64') : null; }
function adminLog(action, detail) { sys.adminLog.push({ at: new Date().toISOString(), user: S.user ? S.user.username : '', action, detail }); if (sys.adminLog.length > 300) sys.adminLog = sys.adminLog.slice(-300); }
function windowTitle() { const m = S.companyId && sys.companies.find(c => c.id === S.companyId); return m ? `${appName()} — ${m.name}` : appName(); }
function applyBranding() {
  try { PR.setAppName(appName()); } catch (_) {}
  if (win && !win.isDestroyed()) { try { win.setTitle(windowTitle()); } catch (_) {} try { const ic = windowIcon(); if (ic) win.setIcon(ic); } catch (e) { logError(e); } }
}
// Read an image the admin picked (PNG / JPG / ICO / BMP), crop to a centred square and store a 256×256 PNG.
function decodeIco(buf) {
  if (buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) return null;
  const n = buf.readUInt16LE(4); let best = null;
  for (let i = 0; i < n; i++) { const o = 6 + i * 16; const w = buf[o] || 256, h = buf[o + 1] || 256, size = buf.readUInt32LE(o + 8), off = buf.readUInt32LE(o + 12); if (!best || w * h > best.w * best.h) best = { w, h, size, off }; }
  if (!best) return null;
  const data = buf.slice(best.off, best.off + best.size);
  if (data.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return nativeImage.createFromBuffer(data);
  // classic BMP/DIB entry: support 32-bit BGRA (what modern .ico files carry)
  const hs = data.readUInt32LE(0), w = data.readInt32LE(4), h2 = data.readInt32LE(8), bpp = data.readUInt16LE(14), h = Math.abs(h2) / 2;
  if (bpp !== 32) return null;
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) data.copy(px, y * w * 4, hs + (h - 1 - y) * w * 4, hs + (h - y) * w * 4);
  return nativeImage.createFromBitmap(px, { width: w, height: h });
}
function importIconImage(file) {
  const ext = path.extname(file).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.ico', '.bmp'].includes(ext)) throw new Error('Please choose a PNG, JPG or ICO image');
  const st = fs.statSync(file); if (st.size > 10 * 1024 * 1024) throw new Error('Image is too big (max 10 MB)');
  let img = nativeImage.createFromPath(file);
  if (img.isEmpty() && ext === '.ico') img = decodeIco(fs.readFileSync(file)) || img;
  if (!img || img.isEmpty()) throw new Error('Could not read this image. Please choose a PNG or JPG file.');
  const { width, height } = img.getSize(); if (width < 16 || height < 16) throw new Error('Image is too small (at least 16×16 pixels)');
  const side = Math.min(width, height);
  if (width !== height) img = img.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side });
  img = img.resize({ width: 256, height: 256, quality: 'best' });
  const png = img.toPNG(); if (!png || png.length < 100) throw new Error('Could not convert this image');
  fs.mkdirSync(brandingDir(), { recursive: true }); atomicWrite(path.join(brandingDir(), 'custom-icon.png'), png);
  return { width, height, bytes: png.length };
}
function adminInfo() {
  const ic = sys.branding.icon || { kind: 'default' };
  return { appName: appName(), defaultName: APP_NAME, isDefaultName: !sys.branding.appName, theme: themeSetting(), icon: { kind: ic.kind || 'default', id: ic.id || null, file: ic.file || null }, iconUrl: iconDataUrl(),
    builtins: ADM.BUILTIN_ICONS.map(b => ({ ...b, url: (f => f ? 'data:image/png;base64,' + fs.readFileSync(f).toString('base64') : null)(builtinIconFile(b.id)) })),
    username: S.user && S.user.username, log: sys.adminLog.slice(-40).reverse() };
}
function saveSys() { atomicWrite(paths().sys, JSON.stringify(sys, null, 1)); }
function hash(pw, salt) { return crypto.pbkdf2Sync(String(pw), salt, 120000, 32, 'sha256').toString('hex'); }
function makeUser(username, pw, role) { const salt = crypto.randomBytes(16).toString('hex'); return { username, salt, hash: hash(pw, salt), role, active: true, created: new Date().toISOString() }; }
function logError(err) { try { fs.mkdirSync(paths().logs, { recursive: true }); fs.appendFileSync(path.join(paths().logs, 'error.log'), `[${new Date().toISOString()}] ${err && err.stack || err}\n`); } catch (_) { startupLog('error: ' + (err && err.stack || err)); } }

function companyFile(id) { return path.join(paths().companies, id + '.rsdb'); }
function scheduleSave() { S.dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(flush, 300); }
function flush() { clearTimeout(saveTimer); if (S.company && S.dirty) { atomicWrite(companyFile(S.companyId), Buffer.from(S.company.db.export())); S.dirty = false; } }
function autoBackup(id) {
  try {
    const dir = path.join(paths().backups, id); fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `auto_${U.today()}.rsdb`); if (!fs.existsSync(f) && fs.existsSync(companyFile(id))) fs.copyFileSync(companyFile(id), f);
    const all = fs.readdirSync(dir).filter(x => x.startsWith('auto_')).sort(); while (all.length > 15) fs.unlinkSync(path.join(dir, all.shift()));
  } catch (e) { logError(e); }
}
function openCompany(id) {
  closeCompany();
  const meta = sys.companies.find(c => c.id === id); if (!meta) throw new Error('Company not found');
  const bytes = fs.readFileSync(companyFile(id));
  const db = new SQL.Database(bytes);
  const c = new core.Company(db, S.user.username); c.migrate();
  c.onChange = scheduleSave;
  S.company = c; S.companyId = id; meta.lastOpened = new Date().toISOString(); saveSys();
  autoBackup(id);
  if (win) win.setTitle(windowTitle());
  return companyInfo();
}
function closeCompany() { if (S.company) { flush(); try { S.company.db.close(); } catch (_) {} } S.company = null; S.companyId = null; if (win) win.setTitle(appName()); }
function companyInfo() { if (!S.company) return null; const s = S.company.settings(); return { id: S.companyId, settings: s, fyList: S.company.fyList(), vtypes: core.VTYPES }; }
function need(role) {
  if (!S.user) throw new Error('Please log in');
  const rank = { viewer: 0, operator: 1, admin: 2 };
  if (rank[S.user.role] < rank[role]) throw new Error(`Your user role (${S.user.role}) is not allowed to do this. Ask the admin.`);
}
function needCompany() { if (!S.company) throw new Error('No company is open'); return S.company; }

// ---------------- PDF / print helpers ----------------
async function htmlToPdf(html, opts = {}) {
  const w = new BrowserWindow({ show: false, webPreferences: { offscreen: false, javascript: false } });
  const tmp = path.join(os.tmpdir(), `rs_${Date.now()}_${Math.random().toString(36).slice(2)}.html`); fs.writeFileSync(tmp, html);
  try { await w.loadFile(tmp); return await w.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, landscape: !!opts.landscape }); }
  finally { w.destroy(); fs.unlink(tmp, () => {}); }
}
async function printHtml(html) {
  const w = new BrowserWindow({ show: false });
  const tmp = path.join(os.tmpdir(), `rs_print_${Date.now()}.html`); fs.writeFileSync(tmp, html); await w.loadFile(tmp);
  return new Promise(res => w.webContents.print({ silent: false, printBackground: true }, (ok, reason) => { w.destroy(); fs.unlink(tmp, () => {}); res({ printed: ok, reason }); }));
}
function previewPdf(file, title) {
  const w = new BrowserWindow({ width: 1000, height: 900, title: (title || 'Preview') + ' — ' + appName(), icon: windowIcon(), webPreferences: { plugins: true } });
  w.setMenuBarVisibility(false); w.loadFile(file);
}
function safeName(s) { return String(s).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80); }
async function docHtml(kind, id, opts = {}) { return DOCS.docHtml(needCompany(), kind, id, opts, QRCode); }

// ---------------- API ----------------
const { READ, WRITE, ADMIN } = require('./core/perms');
const DOCS = require('./core/docs'), XB = require('./core/exports');

const H = {
  'app.info': () => ({ canConnectServer: true, serverUrl: (sys && sys.lastServerUrl) || '', firstRun: !!(sys && sys.users.some(u => u.mustChange && u.username === 'admin')), name: appName(), defaultName: APP_NAME, theme: themeSetting(), iconUrl: iconDataUrl(), version: VERSION, dataDir, platform: process.platform, user: S.user && { username: S.user.username, role: S.user.role, mustChange: !!S.user.mustChange }, company: companyInfo() }),
  'auth.login': (username, pw) => {
    const key = String(username || '').toLowerCase(); const f = S.failed[key] || { n: 0, until: 0 };
    if (f.until > Date.now()) throw new Error(`Too many wrong attempts. Try again in ${Math.ceil((f.until - Date.now()) / 1000)} s.`);
    const u = sys.users.find(x => x.username.toLowerCase() === key && x.active);
    if (!u || hash(pw, u.salt) !== u.hash) { f.n++; if (f.n >= 5) { f.until = Date.now() + 60000; f.n = 0; } S.failed[key] = f; throw new Error('Wrong username or password'); }
    S.failed[key] = { n: 0, until: 0 }; S.user = u; u.lastLogin = new Date().toISOString(); saveSys();
    return { username: u.username, role: u.role, mustChange: !!u.mustChange };
  },
  'auth.logout': () => { closeCompany(); S.user = null; return true; },
  'auth.changePassword': (oldPw, newPw) => {
    if (!S.user) throw new Error('Not logged in'); if (hash(oldPw, S.user.salt) !== S.user.hash) throw new Error('Current password is wrong');
    const chk = ADM.checkPassword(newPw, { username: S.user.username, oldPw }); if (!chk.ok) throw new Error('New password: ' + chk.errors.join('; '));
    S.user.salt = crypto.randomBytes(16).toString('hex'); S.user.hash = hash(newPw, S.user.salt); delete S.user.mustChange; S.user.pwChanged = new Date().toISOString(); saveSys(); return true;
  },
  // ---- Admin Settings (admin role only — every handler re-checks the role here, the screen being hidden is not the guard) ----
  'admin.info': () => { need('admin'); return adminInfo(); },
  'admin.passwordStrength': (pw) => { if (!S.user) throw new Error('Please log in'); const c = ADM.checkPassword(pw, { username: S.user.username }); return { ok: c.ok, score: c.score, label: c.label, errors: c.errors }; },
  'admin.changePassword': (curPw, newPw, repeatPw) => {
    need('admin');
    if (hash(String(curPw || ''), S.user.salt) !== S.user.hash) throw new Error('Current password is wrong');
    if (String(newPw) !== String(repeatPw)) throw new Error('New password and confirm password do not match');
    const chk = ADM.checkPassword(newPw, { username: S.user.username, oldPw: curPw }); if (!chk.ok) throw new Error('New password: ' + chk.errors.join('; '));
    S.user.salt = crypto.randomBytes(16).toString('hex'); S.user.hash = hash(newPw, S.user.salt); delete S.user.mustChange; S.user.pwChanged = new Date().toISOString();
    adminLog('Password changed', `for user ${S.user.username}`); saveSys(); return true;
  },
  'admin.changeUsername': (newName, curPw) => {
    need('admin');
    if (hash(String(curPw || ''), S.user.salt) !== S.user.hash) throw new Error('Current password is wrong');
    const old = S.user.username;
    const n = ADM.validateUsername(newName, sys.users.map(u => u.username), old);
    S.user.username = n; if (S.company) S.company.user = n; delete S.failed[old.toLowerCase()];
    adminLog('Username changed', `${old} → ${n}`); saveSys();
    return { username: n, role: S.user.role, mustChange: !!S.user.mustChange };
  },
  'admin.setAppName': (name) => {
    need('admin'); const before = appName(); const n = ADM.cleanAppName(name);
    if (n === APP_NAME) delete sys.branding.appName; else sys.branding.appName = n;
    adminLog('App name changed', `${before} → ${appName()}`); saveSys(); applyBranding(); return adminInfo();
  },
  'admin.setTheme': (t) => {
    need('admin'); const before = themeSetting(); sys.branding.theme = ADM.cleanTheme(t); try { nativeTheme.themeSource = sys.branding.theme; } catch (_) {}
    if (before !== sys.branding.theme) adminLog('Theme changed', `${before} → ${sys.branding.theme}`); saveSys(); return { theme: sys.branding.theme };
  },
  'admin.setIcon': async (choice = {}) => {
    need('admin');
    if (choice.kind === 'default') { sys.branding.icon = { kind: 'default' }; adminLog('App icon changed', 'reset to default'); }
    else if (choice.kind === 'builtin') { if (!builtinIconFile(choice.id) || !ADM.BUILTIN_ICONS.some(b => b.id === choice.id)) throw new Error('Unknown built-in icon'); sys.branding.icon = choice.id === 'rs' ? { kind: 'default' } : { kind: 'builtin', id: choice.id }; adminLog('App icon changed', 'built-in: ' + choice.id); }
    else if (choice.kind === 'file') {
      let file = choice.path;
      if (!file) { const r = await dialog.showOpenDialog(win, { title: 'Choose an app icon (PNG, JPG or ICO)', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'ico', 'bmp'] }], properties: ['openFile'] }); if (r.canceled || !r.filePaths.length) return null; file = r.filePaths[0]; }
      const info = importIconImage(file); sys.branding.icon = { kind: 'custom', file: path.basename(file), at: new Date().toISOString() };
      adminLog('App icon changed', `custom image ${path.basename(file)} (${info.width}×${info.height})`);
    } else throw new Error('Choose an icon');
    saveSys(); applyBranding(); return adminInfo();
  },
  'users.list': () => { need('admin'); return sys.users.map(u => ({ username: u.username, role: u.role, active: u.active, lastLogin: u.lastLogin || '', created: u.created })); },
  'users.save': (u) => {
    need('admin'); if (!u.username || !/^[\w.@-]{2,30}$/.test(u.username)) throw new Error('Username: 2–30 letters/numbers');
    if (!['admin', 'operator', 'viewer'].includes(u.role)) throw new Error('Role must be admin, operator or viewer');
    let x = sys.users.find(y => y.username.toLowerCase() === u.username.toLowerCase());
    if (u.password) { const chk = ADM.checkPassword(u.password, { username: u.username }); if (!chk.ok) throw new Error('Password: ' + chk.errors.join('; ')); }
    if (!x) { if (!u.password) throw new Error('Password is required for a new user'); ADM.validateUsername(u.username, sys.users.map(y => y.username)); x = makeUser(u.username, u.password, u.role); sys.users.push(x); }
    else { if (x === S.user && u.role !== 'admin') throw new Error('You cannot remove your own admin role'); x.role = u.role; x.active = u.active !== false; if (u.password) { x.salt = crypto.randomBytes(16).toString('hex'); x.hash = hash(u.password, x.salt); } }
    if (!sys.users.some(y => y.role === 'admin' && y.active)) throw new Error('At least one active admin is required');
    saveSys(); return true;
  },
  'users.delete': (username) => { need('admin'); if (S.user.username === username) throw new Error('You cannot delete yourself'); sys.users = sys.users.filter(u => u.username !== username); if (!sys.users.some(y => y.role === 'admin')) throw new Error('At least one admin is required'); saveSys(); return true; },

  'company.list': () => { need('viewer'); return sys.companies.map(c => ({ ...c, size: fs.existsSync(companyFile(c.id)) ? fs.statSync(companyFile(c.id)).size : 0 })).sort((a, b) => (b.lastOpened || '').localeCompare(a.lastOpened || '')); },
  'company.create': (info) => {
    need('admin'); if (!info || !info.name || !info.name.trim()) throw new Error('Company name is required');
    if (info.gstin && !U.validGSTIN(info.gstin)) throw new Error('GSTIN is not valid');
    if (info.gstin) { info.gstin = info.gstin.toUpperCase(); info.state_code = info.gstin.slice(0, 2); if (!info.pan) info.pan = info.gstin.slice(2, 12); }
    const id = 'c' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
    const db = new SQL.Database(); core.Company.create(db, info, S.user.username);
    atomicWrite(companyFile(id), Buffer.from(db.export())); db.close();
    sys.companies.push({ id, name: info.name.trim(), gstin: info.gstin || '', created: new Date().toISOString() }); saveSys();
    return openCompany(id);
  },
  'company.open': (id) => { need('viewer'); return openCompany(id); },
  'company.close': () => { closeCompany(); return true; },
  'company.info': () => companyInfo(),
  'company.saveSettings': (s) => { need('admin'); const r = needCompany().saveSettings(s); const m = sys.companies.find(c => c.id === S.companyId); if (s.name) m.name = s.name; if (s.gstin !== undefined) m.gstin = s.gstin; saveSys(); flush(); if (win) win.setTitle(windowTitle()); return r; },
  'company.delete': async (id) => {
    need('admin'); if (S.companyId === id) closeCompany();
    const m = sys.companies.find(c => c.id === id); if (!m) return false;
    const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Cancel', 'Delete'], defaultId: 0, cancelId: 0, title: 'Delete company', message: `Delete company "${m.name}"?`, detail: 'A final backup copy is kept in the Backups folder.' });
    if (r.response !== 1) return false;
    const dir = path.join(paths().backups, id); fs.mkdirSync(dir, { recursive: true }); if (fs.existsSync(companyFile(id))) fs.renameSync(companyFile(id), path.join(dir, `deleted_${Date.now()}.rsdb`));
    sys.companies = sys.companies.filter(c => c.id !== id); saveSys(); return true;
  },
  'company.backup': async (id) => {
    need('operator'); id = id || S.companyId; const m = sys.companies.find(c => c.id === id); if (!m) throw new Error('Select a company');
    if (id === S.companyId) flush();
    const r = await dialog.showSaveDialog(win, { title: 'Backup company data', defaultPath: path.join(app.getPath('documents'), `${safeName(m.name)}_backup_${U.today()}.rsbak`), filters: [{ name: 'R&S Sons backup', extensions: ['rsbak'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.copyFileSync(companyFile(id), r.filePath); return { file: r.filePath, size: fs.statSync(r.filePath).size };
  },
  'company.restore': async () => {
    need('admin');
    const r = await dialog.showOpenDialog(win, { title: 'Restore company from backup', filters: [{ name: 'R&S Sons backup', extensions: ['rsbak', 'rsdb'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return restoreFrom(r.filePaths[0]);
  },
  'company.backupsList': () => { need('viewer'); const dir = path.join(paths().backups, S.companyId || ''); return S.companyId && fs.existsSync(dir) ? fs.readdirSync(dir).sort().reverse().map(f => ({ file: f, size: fs.statSync(path.join(dir, f)).size })) : []; },
  'company.openDataFolder': () => { shell.openPath(dataDir); return true; },

  'c': (method, ...args) => {
    const c = needCompany();
    if (READ.has(method)) need('viewer'); else if (WRITE.has(method)) need('operator'); else if (ADMIN.has(method)) need('admin'); else throw new Error('Unknown action ' + method);
    if (method === 'saveSettings') { return H['company.saveSettings'](...args); }
    c.user = S.user.username;
    return c[method](...args);
  },

  'doc.pdf': async (kind, id, opts = {}) => {
    const { html, name } = await docHtml(kind, id, opts);
    const pdf = await htmlToPdf(html, opts);
    const meta = sys.companies.find(c => c.id === S.companyId);
    const dir = path.join(paths().pdf, safeName(meta ? meta.name : 'Company')); fs.mkdirSync(dir, { recursive: true });
    let file = path.join(dir, safeName(name) + '.pdf');
    if (opts.saveAs) { const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), safeName(name) + '.pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] }); if (r.canceled) return null; file = r.filePath; }
    fs.writeFileSync(file, pdf);
    if (opts.preview !== false) previewPdf(file, name);
    return { file, size: pdf.length };
  },
  'doc.print': async (kind, id, opts = {}) => { const { html } = await docHtml(kind, id, opts); return printHtml(html); },
  'doc.html': async (kind, id, opts = {}) => (await docHtml(kind, id, opts)).html,
  'doc.share': async (channel, vid) => {
    const c = needCompany(); const v = c.voucher(vid); const s = c.settings(); const p = v.party_id ? c.ledger(v.party_id) : {};
    const r = await H['doc.pdf']('voucher', vid, { preview: false });
    const text = `Dear ${v.party_name || 'Customer'},\n${core.VTYPES[v.vtype].name} ${v.number} dated ${U.fmtDate(v.date)} for ₹${U.inr(v.total)} from ${s.name}.${s.upi_id ? '\nPay via UPI: ' + s.upi_id : ''}\nThank you.`;
    shell.showItemInFolder(r.file);
    if (channel === 'whatsapp') { const ph = String(p.phone || '').replace(/\D/g, ''); const num = ph.length === 10 ? '91' + ph : ph; shell.openExternal(`https://wa.me/${num}?text=${encodeURIComponent(text)}`); }
    else shell.openExternal(`mailto:${encodeURIComponent(p.email || '')}?subject=${encodeURIComponent(core.VTYPES[v.vtype].name + ' ' + v.number + ' - ' + s.name)}&body=${encodeURIComponent(text + '\n\n(PDF attached)')}`);
    return r;
  },
  'export.excel': async (rep, name) => saveFile(name || rep.title, 'xlsx', XB.reportBook(XLSX, rep)),
  'export.text': async (content, name, ext) => saveFile(name, ext || 'txt', Buffer.from(content, 'utf8')),
  'export.json': async (obj, name) => saveFile(name, 'json', Buffer.from(JSON.stringify(obj, null, 2), 'utf8')),
  'export.gstr1Excel': async (f) => saveFile(`GSTR-1 ${f.from} to ${f.to}`, 'xlsx', XB.gstr1Book(XLSX, needCompany(), f)),
  'export.excelBook': async (sheets, name) => { const wb = XLSX.utils.book_new(); for (const sh of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sh.rows), String(sh.name).slice(0, 30)); return saveFile(name, 'xlsx', Buffer.from(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))); },
  'masters.export': async () => saveFile('Masters ' + needCompany().setting('name'), 'xlsx', XB.mastersBook(XLSX, needCompany())),
  'masters.template': async () => saveFile('R&S Sons import template', 'xlsx', XB.templateBook(XLSX)),
  'masters.import': async (file) => {
    need('operator'); const c = needCompany();
    if (!file) { const r = await dialog.showOpenDialog(win, { title: 'Import ledgers & items from Excel', filters: [{ name: 'Excel', extensions: ['xlsx', 'xls', 'csv'] }], properties: ['openFile'] }); if (r.canceled) return null; file = r.filePaths[0]; }
    return XB.importMasters(XLSX, c, XLSX.read(fs.readFileSync(file)));
  },
  'file.rows': (f) => { if (!f || !f.b64) throw new Error('Choose a file'); return XB.sheetRows(XLSX, Buffer.from(f.b64, 'base64')); },
  'doc.named': async (kind, id, opts = {}) => docHtml(kind, id, opts),
  // v2.0: use a multi-user server instead of the files on this PC (Ctrl+Shift+L returns to local mode)
  'app.setServer': async (url) => {
    let u; try { u = new URL(String(url || '').trim()); } catch (_) { throw new Error('Enter the full address, e.g. https://example.com or http://192.168.1.10:8080'); }
    if (!/^https?:$/.test(u.protocol)) throw new Error('Address must start with https:// (or http:// on your own office network)');
    const base = u.origin + u.pathname.replace(/\/(app\/?)?$/, '').replace(/\/$/, '');
    let ok = false; try { const r = await net.fetch(base + '/api/health'); const j = await r.json(); ok = j && j.app === 'rs-sons-accounting'; } catch (_) {}
    if (!ok) throw new Error('No R&S Sons Accounting server answered at ' + base + '. Check the address and your internet.');
    closeCompany(); S.user = null; sys.serverUrl = base; sys.lastServerUrl = base; saveSys();
    setTimeout(() => { const old = win; createWindow(); if (old && !old.isDestroyed()) old.destroy(); }, 50);
    return true;
  },
  'shell.open': (p) => { if (!String(p).startsWith(dataDir) && !String(p).startsWith(app.getPath('documents'))) throw new Error('Not allowed'); return shell.openPath(p); },
  'shell.show': (p) => { shell.showItemInFolder(p); return true; },
  'shell.external': (url) => { if (!/^(https:|mailto:)/.test(url)) throw new Error('Not allowed'); shell.openExternal(url); return true; },
  'app.quit': () => { app.quit(); return true; },
};
function restoreFrom(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.slice(0, 15).toString() !== 'SQLite format 3') throw new Error('This is not an R&S Sons Accounting backup file');
  const db = new SQL.Database(bytes); let name;
  try { const c = new core.Company(db); name = c.setting('name'); if (!name) throw new Error(); } catch (e) { db.close(); throw new Error('Backup file is damaged or not a company file'); }
  db.close();
  let nm = name; if (sys.companies.some(c => c.name === nm)) nm = `${name} (Restored ${U.fmtDate(U.today())})`;
  const id = 'c' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
  fs.writeFileSync(companyFile(id), bytes); sys.companies.push({ id, name: nm, created: new Date().toISOString(), restoredFrom: path.basename(file) }); saveSys();
  return { id, name: nm };
}
async function saveFile(name, ext, buf) {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(paths().exports, safeName(name) + '.' + ext), filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, buf); return { file: r.filePath, size: buf.length };
}

ipcMain.handle('api', async (e, method, args) => {
  try { const h = H[method]; if (!h) throw new Error('Unknown API ' + method); return { ok: true, data: await h(...(args || [])) }; }
  catch (err) { if (!(err && err.message && !/^(TypeError|ReferenceError)/.test(err.name))) logError(err); return { ok: false, error: err && err.message || String(err) }; }
});

function iconPath() { const p = path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'); return fs.existsSync(p) ? p : undefined; }
function backToLocal(reason) {
  sys.serverUrl = null; saveSys(); startupLog('server mode off: ' + reason);
  const old = win; createWindow(); if (old && !old.isDestroyed()) old.destroy();
}
function createWindow() {
  const server = sys && sys.serverUrl;
  win = new BrowserWindow({ width: 1366, height: 820, minWidth: 1000, minHeight: 640, title: appName() + (server ? ' — ' + server : ''), icon: windowIcon(), show: false, backgroundColor: '#0b2545',
    webPreferences: server ? { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } : { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } });
  if (server) {
    // Multi-user mode: the window shows the server's web app (no access to this PC's files); everything is saved on the server.
    Menu.setApplicationMenu(null); win.once('ready-to-show', () => { win.maximize(); win.show(); });
    win.loadURL(server + '/app/').catch(() => {});
    win.webContents.setWindowOpenHandler(({ url }) => { if (/^(https:|mailto:)/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(server)) { e.preventDefault(); if (/^https:/.test(url)) shell.openExternal(url); } });
    win.webContents.on('did-fail-load', async (e, code, desc, url, isMain) => {
      if (!isMain || code === -3) return; startupLog(`server load failed ${code} ${desc}`);
      const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Try again', 'Work on this PC (local mode)', 'Close'], defaultId: 0, title: 'Server not reachable', message: 'Could not reach the server ' + server, detail: desc + '\nCheck the internet / office network. Your local company files on this PC are unchanged.' });
      if (r.response === 0) win.loadURL(server + '/app/').catch(() => {}); else if (r.response === 1) backToLocal('server unreachable'); else app.quit();
    });
    win.webContents.on('before-input-event', async (e, input) => { if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'l') { const r = await dialog.showMessageBox(win, { type: 'question', buttons: ['Cancel', 'Switch to local mode'], defaultId: 1, message: 'Stop using the server and work with company files on this PC?' }); if (r.response === 1) backToLocal('user'); } });
    win.on('page-title-updated', e => e.preventDefault());
    return;
  }
  Menu.setApplicationMenu(null);
  let shown = false;
  const showWin = () => { if (shown || !win || win.isDestroyed() || process.env.RS_HIDDEN) return; shown = true; win.maximize(); win.show(); };
  win.once('ready-to-show', showWin);
  setTimeout(() => { if (!shown && !process.env.RS_HIDDEN) { startupLog('ready-to-show did not arrive in 15 s — showing the window anyway'); showWin(); } }, 15000);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html')).catch(e => fatal('opening its main screen', e));
  win.on('page-title-updated', e => e.preventDefault()); // the title is owned here: "<app name> — <company>"
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('before-input-event', (e, input) => { if (input.key === 'F12' && input.control && input.shift) win.webContents.openDevTools({ mode: 'detach' }); });
  let crashes = 0;
  win.webContents.on('render-process-gone', (e, d) => {
    startupLog(`screen process ended: ${d.reason} (exit ${d.exitCode})`); try { flush(); } catch (_) {}
    if (d.reason === 'clean-exit' || !win || win.isDestroyed()) return;
    if (++crashes <= 2) { win.reload(); return; }
    fatal('showing its screens (the window stopped responding ' + crashes + ' times)', new Error('Renderer ' + d.reason));
  });
  win.webContents.on('did-fail-load', (e, code, desc) => startupLog(`did-fail-load ${code} ${desc}`));
  win.on('close', () => { try { flush(); } catch (err) { logError(err); dialog.showErrorBox(appName(), 'Could not save your latest changes: ' + err.message); } });
}
const gotLock = process.env.RS_E2E ? true : app.requestSingleInstanceLock();
if (!gotLock) { startupLog('another copy is already running — handing over to it'); app.quit(); }
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.commandLine.appendSwitch('lang', 'en-IN');
  app.on('child-process-gone', (e, d) => startupLog(`child process ${d.type} ended: ${d.reason} (exit ${d.exitCode})`));
  app.whenReady().then(async () => {
    let step = 'finding its data folder';
    try {
      dataDir = pickDataDir(); startupLog('data folder: ' + dataDir);
      step = 'preparing its data folder'; ensureDirs();
      step = 'reading users and companies'; loadSys();
      step = 'loading the database engine';
      const sqlDir = path.dirname(require.resolve('sql.js'));
      SQL = await initSqlJs({ locateFile: f => path.join(sqlDir, f) });
      step = 'opening its window'; createWindow();
      startupLog('started OK');
    } catch (e) { fatal(step, e); return; }
    if (process.env.RS_E2E) { const e2e = path.join(__dirname, 'test', process.env.RS_E2E_SCRIPT || 'e2e.js'); if (fs.existsSync(e2e)) require(e2e)({ win, H, S, app, dataDir, flush, htmlToPdf, docHtml }); }
  }).catch(e => fatal('starting up', e));
  app.on('before-quit', () => { try { flush(); } catch (e) { logError(e); } });
  app.on('window-all-closed', () => { try { flush(); } catch (e) { logError(e); } app.quit(); });
}
