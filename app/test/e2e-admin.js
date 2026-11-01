
// Admin Settings + theme + branding end-to-end test (Electron, Xvfb). Two phases on the same data folder:
//   RS_E2E_SCRIPT=e2e-admin.js RS_E2E_PHASE=1  → change everything, assert it, screenshots
//   RS_E2E_SCRIPT=e2e-admin.js RS_E2E_PHASE=2  → fresh app start: assert everything persisted
const fs = require('fs'), path = require('path');
const { nativeImage, nativeTheme, BrowserWindow } = require('electron');
module.exports = ({ win, H, S, app, dataDir }) => {
  const phase = process.env.RS_E2E_PHASE || '1';
  const out = process.env.RS_E2E_OUT || '/tmp/rs-e2e-admin'; fs.mkdirSync(out, { recursive: true });
  const log = []; const L = (...a) => { const s = a.join(' '); log.push(s); console.log('[e2e-admin]', s); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const js = code => win.webContents.executeJavaScript(code, true);
  const shot = async name => { await sleep(350); await js(`document.querySelectorAll('#toast div').forEach(d=>d.remove())`); win.webContents.invalidate(); await sleep(700); win.webContents.invalidate(); await sleep(300); const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(out, name + '.png'), img.toPNG()); L('shot', name); };
  const results = { phase, errors: [], checks: [] };
  const check = (ok, msg) => { results.checks.push({ ok: !!ok, msg }); L(ok ? 'PASS' : 'FAIL', msg); };
  const throwsMsg = async (fn) => { try { await fn(); return null; } catch (e) { return e.message || String(e); } };
  const uiLogin = async (u, p) => { await js(`showLogin()`); await sleep(500); await js(`document.querySelector('#lu').value=${JSON.stringify(u)}; document.querySelector('#lp').value=${JSON.stringify(p)}; document.querySelector('#loginForm').requestSubmit();`); await sleep(900); return js(`({ companies: !document.querySelector('#companies').classList.contains('hidden'), err: document.querySelector('#lerr').textContent })`); };
  const fill = (sel, v) => js(`{const e=document.querySelector(${JSON.stringify(sel)}); e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input',{bubbles:true}));}`);
  const click = sel => js(`document.querySelector(${JSON.stringify(sel)}).click()`);
  const bodyBg = () => js(`getComputedStyle(document.body).backgroundColor`);
  const lum = c => { const m = String(c).match(/\d+/g).map(Number); return (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]); };
  const NEWPW = 'Ganga#2027x', FIRSTPW = 'Kashi@2026', NEWUSER = 'rssons.owner', NAME = 'Kashi Traders Accounts';
  win.webContents.on('console-message', (e, level, msg) => { if (level >= 2) results.errors.push('console: ' + msg); });
  win.webContents.once('did-finish-load', async () => {
    try {
      await sleep(1200);
      if (phase === '1') {
        // first login + forced password change (new strength rule refuses a weak one)
        await js(`document.querySelector('#lp').value='admin'; document.querySelector('#loginForm').requestSubmit();`); await sleep(800);
        await js(`document.querySelector('#f_n1').value='abc12'; document.querySelector('#f_n2').value='abc12'; document.querySelector('[data-a=ok]').click();`); await sleep(600);
        const weakErr = await js(`(document.querySelector('#cperr')||{}).textContent||''`);
        check(/8 characters/.test(weakErr), 'forced first password change refuses a weak password: ' + weakErr);
        await js(`document.querySelector('#f_n1').value='${FIRSTPW}'; document.querySelector('#f_n2').value='${FIRSTPW}'; document.querySelector('[data-a=ok]').click();`); await sleep(900);
        check(await js(`!document.querySelector('#companies').classList.contains('hidden') && !!document.querySelector('#cadmin')`), 'admin sees "Admin Settings" on the company screen');
        // operator user: no admin section, and the main process refuses admin calls
        await H['users.save']({ username: 'op1', role: 'operator', password: 'Opera7or1', active: 1 });
        await js(`document.querySelector('#cdemo').click()`);
        for (let i = 0; i < 60; i++) { await sleep(500); if (await js(`!!document.querySelector('.kpis') && APP.cache.items && APP.cache.items.length>0`)) break; }
        await sleep(1200);
        check(await js(`[...document.querySelectorAll('#nav a')].some(a=>a.dataset.go==='adminSettings')`), 'admin sidebar has "Admin Settings"');
        const compId = S.companyId;
        let r = await uiLogin('op1', 'Opera7or1'); check(r.companies, 'operator logs in');
        check(await js(`!document.querySelector('#cadmin')`), 'operator: no Admin Settings button on company screen');
        await js(`openComp(${JSON.stringify(compId)})`); await sleep(1500);
        check(await js(`![...document.querySelectorAll('#nav a')].some(a=>a.dataset.go==='adminSettings') && ![...document.querySelectorAll('#nav a')].some(a=>/Admin/.test(a.textContent))`), 'operator: no Admin Settings in sidebar');
        await js(`go('utilities')`); await sleep(500); check(await js(`![...document.querySelectorAll('.mi')].some(m=>m.dataset.s==='adminSettings')`), 'operator: no Admin Settings in Utilities');
        await js(`go('adminSettings')`); await sleep(500); check(await js(`/Only an admin/.test(document.querySelector('#main').textContent)`), 'operator: opening the screen directly shows "only an admin"');
        const blocked = [];
        for (const [m, args] of [['admin.info', []], ['admin.setAppName', ['Hacked']], ['admin.setTheme', ['dark']], ['admin.setIcon', [{ kind: 'default' }]], ['admin.changeUsername', ['zzz', 'Opera7or1']], ['admin.changePassword', ['Opera7or1', 'Zz9zz9zz9', 'Zz9zz9zz9']]]) { const e = await throwsMsg(() => H[m](...args)); if (e && /not allowed/.test(e)) blocked.push(m); }
        check(blocked.length === 6, 'main process blocks all 6 admin actions for an operator: ' + blocked.join(', '));
        check(await js(`rs.api('admin.setAppName','Hacked').then(()=>'allowed',e=>e.message)`).then(m => /not allowed/.test(m)), 'operator: renderer API call to admin.setAppName refused');
        // back to admin
        r = await uiLogin('admin', FIRSTPW); check(r.companies, 'admin logs back in');
        await js(`openComp(${JSON.stringify(compId)})`); await sleep(1500);
        await js(`go('adminSettings')`); await sleep(900);
        check(await js(`!!document.querySelector('#apSave') && !!document.querySelector('#auSave') && !!document.querySelector('#anSave') && !!document.querySelector('#aiFile') && document.querySelectorAll('[data-theme-set]').length===3 && document.querySelectorAll('[data-icon]').length>=5`), 'Admin Settings screen shows password, username, app name, icon and theme sections');
        check(await js(`/shortcut icon/.test(document.querySelector('#main').textContent) && /reinstall/.test(document.querySelector('#main').textContent)`), 'icon help line explains the shortcut-icon limit');
        // ---- password change ----
        await fill('#apNew', 'abc'); await sleep(500); const lbl = await js(`document.querySelector('#apLbl').textContent`); check(/weak/i.test(lbl), 'strength meter flags a weak password: ' + lbl);
        await fill('#apNew', 'Ganga#2027x-Ghat'); await sleep(500); const lbl2 = await js(`document.querySelector('#apLbl').textContent`); check(/Strong|Good/.test(lbl2), 'strength meter rates a strong password: ' + lbl2);
        await fill('#apCur', 'wrongpass1'); await fill('#apNew', NEWPW); await fill('#apRep', NEWPW); await click('#apSave'); await sleep(700);
        check(/Current password is wrong/.test(await js(`document.querySelector('#apErr').textContent`)), 'password change refused with wrong current password');
        await fill('#apCur', FIRSTPW); await fill('#apRep', NEWPW + 'y'); await click('#apSave'); await sleep(700);
        check(/do not match/.test(await js(`document.querySelector('#apErr').textContent`)), 'password change refused when confirm does not match');
        await fill('#apNew', 'password123'); await fill('#apRep', 'password123'); await click('#apSave'); await sleep(700);
        check(/common/.test(await js(`document.querySelector('#apErr').textContent`)), 'password change refused for a common password');
        await fill('#apNew', NEWPW); await fill('#apRep', NEWPW); await click('#apSave'); await sleep(1200);
        check(await js(`!document.querySelector('#apErr') || document.querySelector('#apErr').textContent===''`), 'password changed via Admin Settings');
        // ---- username change ----
        await fill('#auNew', 'OP1'); await fill('#auPw', NEWPW); await click('#auSave'); await sleep(700);
        check(/already taken/.test(await js(`document.querySelector('#auErr').textContent`)), 'username change refused for an existing username (OP1 vs op1)');
        await fill('#auNew', NEWUSER); await fill('#auPw', FIRSTPW); await click('#auSave'); await sleep(700);
        check(/Current password is wrong/.test(await js(`document.querySelector('#auErr').textContent`)), 'username change refused with the old (replaced) password');
        await fill('#auNew', NEWUSER); await fill('#auPw', NEWPW); await click('#auSave'); await sleep(1200);
        check(await js(`APP.user.username===${JSON.stringify(NEWUSER)} && document.querySelector('#tuser').textContent.startsWith(${JSON.stringify(NEWUSER)})`), 'username changed; session updated in place (top bar shows new name, still logged in)');
        // ---- app name ----
        await fill('#anName', NAME); await click('#anSave'); await sleep(1200);
        check(win.getTitle().startsWith(NAME + ' — '), 'window title uses new app name: ' + win.getTitle());
        check(await js(`document.querySelector('#tappname').textContent===${JSON.stringify(NAME)} && document.title===${JSON.stringify(NAME)}`), 'sidebar header + document title use new name');
        const vid = await js(`rs.api('c','vouchers',{vtype:'SAL'}).then(r=>r[0].id)`);
        let inv = await H['doc.html']('voucher', vid, {});
        check(inv.includes('Generated by ' + NAME), 'invoice footer: "Generated by ' + NAME + '"');
        const pdf = await H['doc.pdf']('voucher', vid, { preview: false }); fs.copyFileSync(pdf.file, path.join(out, 'invoice-renamed.pdf')); check(pdf.size > 20000, 'invoice PDF with new name generated (' + pdf.size + ' bytes)');
        await js(`go('about')`); await sleep(500); check(await js(`document.querySelector('.about h2').textContent===${JSON.stringify(NAME)}`), 'About box shows new name');
        await js(`go('adminSettings')`); await sleep(800);
        await click('#anReset'); await sleep(1100);
        check(win.getTitle().startsWith('R&S Sons Accounting — ') && (await H['doc.html']('voucher', vid, {})).includes('Generated by R&amp;S Sons Accounting'), 'Reset to default restores title + invoice footer');
        await fill('#anName', NAME); await click('#anSave'); await sleep(1100);
        // ---- icon ----
        await click('[data-icon="rupee"]'); await sleep(1100);
        let ai = await H['admin.info'](); check(ai.icon.kind === 'builtin' && ai.icon.id === 'rupee' && /^data:image\/png/.test(await js(`document.querySelector('#top img.brand-img').getAttribute('src')`)), 'built-in icon applied to in-app logo');
        // custom image: a 400×300 JPEG (non-square → centre-cropped to 256×256 PNG)
        const W = 400, Hh = 300, px = Buffer.alloc(W * Hh * 4); for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4; px[o] = 40; px[o + 1] = 120 + (x % 100); px[o + 2] = 200; px[o + 3] = 255; }
        const jpg = path.join(out, 'kashi-logo.jpg'); const fx = path.join(__dirname, 'fixtures', 'sample-logo.jpg'); fs.writeFileSync(jpg, fs.existsSync(fx) ? fs.readFileSync(fx) : nativeImage.createFromBitmap(px, { width: W, height: Hh }).toJPEG(90));
        ai = await H['admin.setIcon']({ kind: 'file', path: jpg }); await js(`refreshBrand()`); await sleep(500);
        const cf = path.join(dataDir, 'Branding', 'custom-icon.png'); const sz = nativeImage.createFromPath(cf).getSize();
        check(ai.icon.kind === 'custom' && fs.existsSync(cf) && sz.width === 256 && sz.height === 256, `custom JPG icon (600×400, centre-cropped) stored as 256×256 PNG (${sz.width}×${sz.height})`);
        // .ico with a PNG entry and .ico with a classic 32-bit BMP entry
        const pngBuf = nativeImage.createFromBitmap(px, { width: W, height: Hh }).resize({ width: 64, height: 64 }).toPNG();
        const ico = (entry, w, h) => { const hd = Buffer.alloc(22); hd.writeUInt16LE(0, 0); hd.writeUInt16LE(1, 2); hd.writeUInt16LE(1, 4); hd[6] = w; hd[7] = h; hd.writeUInt16LE(1, 10); hd.writeUInt16LE(32, 12); hd.writeUInt32LE(entry.length, 14); hd.writeUInt32LE(22, 18); return Buffer.concat([hd, entry]); };
        const icoPng = path.join(out, 'png-entry.ico'); fs.writeFileSync(icoPng, ico(pngBuf, 64, 64));
        const e1 = await throwsMsg(() => H['admin.setIcon']({ kind: 'file', path: icoPng })); check(!e1, 'ICO (PNG entry) accepted' + (e1 ? ': ' + e1 : ''));
        const bw = 32, dib = Buffer.alloc(40 + bw * bw * 4 + bw * 4); dib.writeUInt32LE(40, 0); dib.writeInt32LE(bw, 4); dib.writeInt32LE(bw * 2, 8); dib.writeUInt16LE(1, 12); dib.writeUInt16LE(32, 14);
        for (let i = 0; i < bw * bw; i++) { dib[40 + i * 4] = 200; dib[41 + i * 4] = 80; dib[42 + i * 4] = 20; dib[43 + i * 4] = 255; }
        const icoBmp = path.join(out, 'bmp-entry.ico'); fs.writeFileSync(icoBmp, ico(dib, bw, bw));
        const e2 = await throwsMsg(() => H['admin.setIcon']({ kind: 'file', path: icoBmp })); check(!e2, 'ICO (32-bit BMP entry) accepted' + (e2 ? ': ' + e2 : ''));
        const bad = path.join(out, 'not-an-image.png'); fs.writeFileSync(bad, 'hello');
        const e3 = await throwsMsg(() => H['admin.setIcon']({ kind: 'file', path: bad })); check(/Could not read/.test(e3 || ''), 'a broken image file is refused with a clear message');
        const e4 = await throwsMsg(() => H['admin.setIcon']({ kind: 'file', path: path.join(out, 'results.txt') })); check(/PNG, JPG or ICO/.test(e4 || ''), 'non-image file type refused');
        ai = await H['admin.setIcon']({ kind: 'file', path: jpg }); await js(`refreshBrand()`); await sleep(400);
        check(await js(`[...document.querySelectorAll('img.brand-img')].every(i=>i.getAttribute('src').startsWith('data:image/png'))`), 'custom icon shown in sidebar logo');
        fs.writeFileSync(path.join(out, 'custom-icon-stored.png'), fs.readFileSync(cf));
        // ---- theme ----
        await js(`go('adminSettings')`); await sleep(1200);
        await shot('admin-settings');
        check(lum(await bodyBg()) > 200, 'light theme: light background ' + await bodyBg());
        await click('[data-theme-set="dark"]'); await sleep(700);
        check(await js(`document.documentElement.dataset.theme`) === 'dark' && lum(await bodyBg()) < 60 && nativeTheme.themeSource === 'dark', 'dark theme applied: background ' + await bodyBg());
        await shot('admin-settings-dark');
        await js(`go('dashboard')`); await sleep(1800); await shot('dark-dashboard');
        const kpiTxt = await js(`getComputedStyle(document.querySelector('.kpi .v')).color`), kpiBg = await js(`getComputedStyle(document.querySelector('.kpi')).backgroundColor`);
        check(lum(kpiTxt) - lum(kpiBg) > 100, `dark dashboard text readable (text ${kpiTxt} on ${kpiBg})`);
        await js(`go('report',{r:'balanceSheet',a:null})`); await sleep(1800); await shot('dark-report');
        const thc = await js(`(()=>{const td=[...document.querySelectorAll('#main td')].find(t=>t.textContent.trim().length>2 && t.offsetParent); return [getComputedStyle(td).color, getComputedStyle(document.querySelector('.tbl-wrap')||document.querySelector('#main .card')||document.body).backgroundColor]})()`);
        check(lum(thc[0]) - lum(thc[1]) > 100, `dark report rows readable (${thc[0]} on ${thc[1]})`);
        await js(`go('report',{r:'trialBalance',a:null})`); await sleep(1500); await shot('dark-trial-balance');
        await js(`go('voucher',{vtype:'SAL'})`); await sleep(1200); await shot('dark-sales-voucher');
        await js(`void confirmBox('Delete this voucher?','Delete',true)`); await sleep(500); await shot('dark-dialog');
        const mbg = await js(`getComputedStyle(document.querySelector('#modal .box')).backgroundColor`); check(lum(mbg) < 60, 'dark dialog background ' + mbg);
        await js(`closeModal(false)`); await sleep(200);
        // printed invoice stays light while the app is dark: render the invoice HTML like the PDF printer does
        inv = await H['doc.html']('voucher', vid, {});
        const pw = new BrowserWindow({ show: false, width: 900, height: 700, webPreferences: { javascript: false } });
        await pw.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(inv)); await sleep(500);
        const pimg = await pw.capturePage(); fs.writeFileSync(path.join(out, 'invoice-while-dark.png'), pimg.toPNG()); const bm = pimg.toBitmap(); const sw = pimg.getSize().width;
        let bright = 0, n = 0; for (let y = 5; y < 60; y += 5) for (let x = 5; x < sw - 5; x += 40) { const o = (y * sw + x) * 4; bright += (bm[o] + bm[o + 1] + bm[o + 2]) / 3; n++; }
        pw.destroy(); check(bright / n > 200, 'invoice print stays white while app theme is dark (avg brightness ' + (bright / n).toFixed(0) + ')');
        const pdf2 = await H['doc.pdf']('voucher', vid, { preview: false }); fs.copyFileSync(pdf2.file, path.join(out, 'invoice-dark-mode.pdf'));
        // System theme follows the OS (nativeTheme), then leave it on Dark for the restart test
        await js(`go('adminSettings')`); await sleep(800); await click('[data-theme-set="system"]'); await sleep(600);
        check(await js(`document.documentElement.dataset.theme`) === (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'), 'System theme follows OS setting (OS dark=' + nativeTheme.shouldUseDarkColors + ')');
        await click('[data-theme-set="dark"]'); await sleep(600);
        // admin log
        ai = await H['admin.info'](); const acts = ai.log.map(l => l.action);
        check(['Password changed', 'Username changed', 'App name changed', 'App icon changed', 'Theme changed'].every(a => acts.includes(a)), 'admin activity log records password, username, name, icon and theme changes');
        // old login details stop working
        await H['auth.logout']();
        check(/Wrong username or password/.test(await throwsMsg(() => H['auth.login'](NEWUSER, FIRSTPW)) || ''), 'old password no longer works');
        check(/Wrong username or password/.test(await throwsMsg(() => H['auth.login']('admin', NEWPW)) || ''), 'old username "admin" no longer works');
        check((await H['auth.login'](NEWUSER, NEWPW)).role === 'admin', 'new username + new password log in as admin');
        await H['auth.logout']();
        await js(`showLogin()`); await sleep(600);
        check(await js(`document.querySelector('#lname').textContent===${JSON.stringify(NAME)}`), 'login screen shows the new app name');
        await shot('dark-login');
      } else {
        // ---------- phase 2: fresh process, same data folder ----------
        check(await js(`document.documentElement.dataset.theme`) === 'dark', 'after restart: dark theme already on the login screen');
        check(await js(`document.querySelector('#lname').textContent===${JSON.stringify(NAME)}`) && win.getTitle() === NAME, 'after restart: app name on login screen + window title (' + win.getTitle() + ')');
        check(await js(`document.querySelector('#lhint').classList.contains('hidden') && document.querySelector('#lu').value===''`), 'after restart: "admin/admin" first-time hint hidden once the default login is gone');
        check(await js(`document.querySelector('#login img.brand-img').getAttribute('src').startsWith('data:image/png')`), 'after restart: custom icon on login screen');
        const r1 = await uiLogin('admin', 'Kashi@2026'); check(!r1.companies && /Wrong/.test(r1.err), 'after restart: old username/password refused');
        const r2 = await uiLogin(NEWUSER, NEWPW); check(r2.companies, 'after restart: new username + password log in');
        const ai = await H['admin.info'](); check(ai.icon.kind === 'custom' && ai.theme === 'dark' && ai.appName === NAME, 'after restart: icon custom, theme dark, name kept');
        await js(`rs.api('company.list').then(l=>openComp(l[0].id))`); await sleep(1800);
        const vid = await js(`rs.api('c','vouchers',{vtype:'SAL'}).then(r=>r[0].id)`); check((await H['doc.html']('voucher', vid, {})).includes('Generated by ' + NAME), 'after restart: invoice footer keeps new name');
        await shot('restart-dark-dashboard');
        await js(`go('adminSettings')`); await sleep(900); check(await js(`document.querySelector('[data-theme-set="dark"]').classList.contains('on') && document.querySelector('#anName').value===${JSON.stringify(NAME)}`), 'after restart: Admin Settings shows saved choices');
      }
    } catch (e) { results.errors.push('E2E exception: ' + (e.stack || e)); L('EXCEPTION', e.stack || e); }
    results.log = log; fs.writeFileSync(path.join(out, 'results-phase' + phase + '.json'), JSON.stringify(results, null, 1));
    L('DONE phase', phase, results.checks.filter(c => c.ok).length + '/' + results.checks.length, 'errors:', results.errors.length);
    setTimeout(() => app.exit(0), 500);
  });
};
