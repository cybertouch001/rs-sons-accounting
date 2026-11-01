// v2.1 end-to-end test of the Windows app's ONLINE (login-first) mode against a real hosted server. Runs only with RS_E2E=1.
//   RS_E2E_PHASE=first : login screen, wrong password, login, TEST company, sales invoice by keyboard, PDF, Excel, wait for the phone's entry
//   RS_E2E_PHASE=again : reopen = still logged in; Logout; Offline mode opens the PC's own files; back to Online
//   RS_E2E_PHASE=down  : server unreachable → the "no internet" page with Retry / Offline mode (no freeze, no blank window)
//   RS_E2E_PHASE=slow  : server slow to answer → "Connecting…" then "Server jag raha hai…" (waking up) instead of a frozen window
const fs = require('fs'), path = require('path');
module.exports = ({ app, getWin, sysRef }) => {
  const out = process.env.RS_E2E_OUT || '/tmp/rs-e2e-cloud'; fs.mkdirSync(out, { recursive: true });
  const phase = process.env.RS_E2E_PHASE || 'first';
  const U = process.env.RS_TEST_USER, P = process.env.RS_TEST_PW, NONCE = process.env.RS_E2E_NONCE || 'nonce';
  const results = { phase, checks: [], errors: [] };
  const L = (...a) => console.log('[e2e]', a.join(' '));
  const check = (ok, msg) => { results.checks.push({ ok: !!ok, msg }); L(ok ? 'PASS' : 'FAIL', msg); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const W = () => getWin();
  const js = code => W().webContents.executeJavaScript(code, true);
  const shot = async name => { await sleep(400); const img = await W().webContents.capturePage(); fs.writeFileSync(path.join(out, phase + '-' + name + '.png'), img.toPNG()); L('shot', name); };
  const key = async (keyCode, modifiers = []) => { const w = W(); w.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); if (keyCode.length === 1 && !modifiers.includes('control')) w.webContents.sendInputEvent({ type: 'char', keyCode, modifiers }); w.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await sleep(40); };
  const type = async (text) => { for (const ch of text) await key(ch); await sleep(300); };
  const until = async (code, ms = 30000, step = 250) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await js(code)) return Date.now() - t; } catch (_) {} await sleep(step); } return -1; };
  const url = () => W().webContents.getURL();
  const finish = async () => { results.done = new Date().toISOString(); fs.writeFileSync(path.join(out, phase + '-result.json'), JSON.stringify(results, null, 1)); const n = results.checks.filter(c => c.ok).length; L('DONE', `${n}/${results.checks.length}`, 'errors:', results.errors.length); setTimeout(() => app.exit(0), 300); };
  const run = async () => {
    try {
      if (phase === 'down') {
        const t = Date.now(); while (Date.now() - t < 30000 && !/offline\.html/.test(url())) await sleep(250);
        check(/offline\.html/.test(url()), 'server unreachable → the app shows its own "no internet / server not reachable" page (' + (Date.now() - t) + ' ms)');
        await sleep(600); await shot('unreachable');
        const txt = await js(`document.body.innerText`);
        check(/Retry/.test(txt) && /Offline mode/.test(txt), 'page offers Retry and Offline mode');
        await js(`document.getElementById('off').click()`); await sleep(2500);
        check(await until(`!!document.querySelector('#loginForm') && !document.querySelector('#login').classList.contains('hidden') && !!(window.rs && !window.rs.web)`, 15000) >= 0, 'Offline mode button opens the local (this PC) login');
        check(sysRef().mode === 'local', 'mode remembered as offline'); await shot('offline-login');
        return finish();
      }
      if (phase === 'slow') {
        // (page JS cannot be read while the slow navigation is pending — executeJavaScript would wait for it — so URL + screenshots)
        await sleep(2500);
        check(/connecting\.html/.test(url()) && W().isVisible(), 'slow server: the window is shown at once with the app\'s "Connecting…" page (not blank / frozen)');
        await shot('connecting');
        await sleep(5500);
        check(/connecting\.html/.test(url()), 'still waiting at 8 s: the "Server jag raha hai…" (waking up) text is on that page (see screenshot)');
        await shot('waking-up');
        const w = await until(`!!document.querySelector('#loginForm')`, 40000);
        check(w >= 0, 'when the server answers, the login opens by itself');
        await shot('login-after-slow');
        return finish();
      }
      // ---- login screen ----
      const t0 = await until(`!!document.querySelector('#loginForm') && !document.querySelector('#login').classList.contains('hidden') && !!window.rsShell`, 40000);
      if (phase === 'again') {
        const inside = await until(`!document.querySelector('#companies').classList.contains('hidden') || !document.querySelector('#app').classList.contains('hidden')`, 30000);
        check(inside >= 0, 'reopened app: still logged in (no password asked) — like a phone app');
        await shot('still-logged-in');
        // Logout → login screen with the last user filled in
        if (!(await js(`document.querySelector('#app').classList.contains('hidden')`))) await js(`document.querySelector('#tlogout').click()`); else await js(`document.querySelector('#clogout').click()`);
        const lo = await until(`!document.querySelector('#login').classList.contains('hidden')`, 20000);
        check(lo >= 0, 'Logout → login screen');
        check(await js(`document.querySelector('#lu').value`) === U, 'last username remembered (password never stored)');
        await shot('after-logout');
        // Offline mode → this PC's own files, unchanged
        await js(`document.querySelector('#loffline').click()`);
        const lok = await until(`!!(window.rs && !window.rs.web) && !document.querySelector('#login').classList.contains('hidden')`, 20000);
        check(lok >= 0, 'Offline mode link opens the local login (sirf is PC pe)');
        check(await js(`!document.querySelector('#lserver').classList.contains('hidden') && /Online/.test(document.querySelector('#lserver').textContent)`), 'local login offers "☁ Online login" back');
        await shot('offline-mode-login');
        if (process.env.RS_LOCAL_PW) {
          await js(`document.querySelector('#lu').value='admin'; document.querySelector('#lp').value=${JSON.stringify(process.env.RS_LOCAL_PW)}; document.querySelector('#loginForm').requestSubmit();`);
          const cs = await until(`!document.querySelector('#companies').classList.contains('hidden') && document.querySelectorAll('.comp-row b').length > 0`, 20000);
          const names = await js(`[...document.querySelectorAll('.comp-row b')].map(b=>b.textContent)`);
          check(cs >= 0 && names.length >= 1, 'local company data intact after the update: ' + names.join(', '));
          await shot('offline-local-companies');
          await js(`document.querySelector('#clogout').click()`); await until(`!document.querySelector('#login').classList.contains('hidden')`, 10000);
        }
        await js(`document.querySelector('#lserver').click()`);
        const back = await until(`!!window.rsShell && !!document.querySelector('#loginForm') && !document.querySelector('#login').classList.contains('hidden')`, 30000);
        check(back >= 0 && sysRef().mode === 'cloud', '"☁ Online login" switches back to the online login');
        await shot('back-online');
        return finish();
      }
      check(t0 >= 0, `app opens straight on the online login (${t0} ms)`);
      const info = await js(`({ mode: document.querySelector('#lmode').innerText, alt: document.querySelector('#lalt').innerText, rem: document.querySelector('#lremw').classList.contains('hidden'), srv: document.querySelector('#lserver').classList.contains('hidden') })`);
      check(/Online/.test(info.mode) && /Offline mode/.test(info.alt) && /Advanced/.test(info.alt), 'login shows Online + "Offline mode (sirf is PC pe)" + "Advanced: apna server"');
      check(info.rem && info.srv, 'no "connect to server" step, no remember box (the app always stays logged in)');
      await shot('login');
      // wrong password
      await js(`document.querySelector('#lu').value=${JSON.stringify(U)}; document.querySelector('#lp').value='wrong-pass-123'; document.querySelector('#loginForm').requestSubmit();`);
      await until(`!!document.querySelector('#lerr').textContent`, 20000);
      const err = await js(`document.querySelector('#lerr').textContent`);
      check(/Galat username ya password/.test(err) && /Wrong username or password/.test(err), 'wrong password → Hindi + English message: ' + err);
      await shot('wrong-password');
      // login
      const tl = Date.now();
      await js(`document.querySelector('#lp').value=${JSON.stringify(P)}; document.querySelector('#loginForm').requestSubmit();`);
      const cl = await until(`!document.querySelector('#companies').classList.contains('hidden') && document.querySelectorAll('.comp-row').length>0`, 30000);
      check(cl >= 0, `login → company list in ${Date.now() - tl} ms`);
      const comps = await js(`[...document.querySelectorAll('.comp-row b')].map(b=>b.textContent)`);
      check(comps.length === 1 && /TEST/.test(comps[0]), 'test user sees only the TEST company: ' + comps.join(', '));
      await shot('companies');
      const to = Date.now(); await js(`document.querySelector('.comp-row').click()`);
      const dk = await until(`document.querySelectorAll('.kpi').length>0`, 30000);
      check(dk >= 0, `company opens → dashboard in ${Date.now() - to} ms`);
      await sleep(800); await shot('dashboard');
      // sales invoice by keyboard (same form as offline mode)
      await js(`go('voucher',{vtype:'SAL'})`); await until(`!!document.querySelector('#vparty')`, 15000); await sleep(600);
      await js(`document.querySelector('#vparty').focus()`); await type('Sync Party'); await key('Return'); await sleep(700);
      await js(`document.querySelector('#ig .it').focus()`); await type('Sync Item'); await key('Return'); await sleep(900);
      await js(`{const q=document.querySelector('#ig tbody tr .q'); q.value='3'; q.dispatchEvent(new Event('input',{bubbles:true}));}`); await sleep(300);
      await js(`{const n=document.querySelector('#vnarr'); if(n){n.value='from-desktop-${NONCE}'; n.dispatchEvent(new Event('input',{bubbles:true}));}}`);
      await shot('invoice-entry');
      const before = (await js(`rs.api('c','vouchers',{vtype:'SAL'})`)).length;
      const ts = Date.now(); await key('S', ['control']);
      let last = null; for (let i = 0; i < 80 && !last; i++) { await sleep(150); const vs = await js(`rs.api('c','vouchers',{vtype:'SAL'})`).catch(() => []); if (vs.length > before) last = vs[vs.length - 1]; }
      results.saveMs = Date.now() - ts;
      const v = last && await js(`rs.api('c','voucher',${last && last.id})`);
      check(v && v.party_name === 'Sync Party' && v.items.length === 1 && v.total > 0, `sales invoice ${v && v.number} saved on the server (seen back within ${results.saveMs} ms, includes the read-back) (total ₹${v && v.total})`);
      results.invoice = v && { id: v.id, number: v.number, total: v.total };
      fs.writeFileSync(path.join(out, 'desktop-invoice.json'), JSON.stringify(results.invoice));
      // real PDF file + Excel file from online mode
      const pdf = await js(`rs.api('doc.pdf','voucher',${v.id},{})`);
      const pdfOk = pdf && pdf.file && fs.existsSync(pdf.file) && fs.statSync(pdf.file).size > 10000 && fs.readFileSync(pdf.file).slice(0, 5).toString() === '%PDF-';
      check(pdfOk, 'invoice PDF made on this PC: ' + (pdf && pdf.file) + ' ' + (pdfOk ? fs.statSync(pdf.file).size + ' bytes' : ''));
      if (pdfOk) fs.copyFileSync(pdf.file, path.join(out, 'online-invoice.pdf'));
      const xl = await js(`rs.api('masters.export')`);
      const xlOk = xl && xl.file && fs.existsSync(xl.file) && fs.readFileSync(xl.file).slice(0, 2).toString() === 'PK';
      check(xlOk, 'Excel export saved: ' + (xl && xl.file));
      await js(`go('voucher',{id:${v.id}})`); await sleep(1500); await shot('invoice-saved');
      // wait for the phone's entry (made on Android by the test runner) and show it here
      const wait = Number(process.env.RS_E2E_WAIT || 0) * 1000;
      if (wait) {
        L('waiting for the Android entry', NONCE);
        let found = null; const tw = Date.now();
        while (!found && Date.now() - tw < wait) { await sleep(3000); const vs = await js(`rs.api('c','vouchers',{vtype:'RCT'})`).catch(() => []); for (const x of vs) { const full = await js(`rs.api('c','voucher',${x.id})`).catch(() => null); if (full && (full.narration || '').includes('from-android-' + NONCE)) { found = full; break; } } }
        check(!!found, found ? `entry made on the phone is here on the PC: ${found.vtype} ${found.number} ₹${found.total} (${Math.round((Date.now() - tw) / 1000)} s after waiting started)` : 'entry made on the phone did NOT arrive');
        if (found) { await js(`go('report',{r:'dayBook'})`); await sleep(2500); await shot('daybook-with-phone-entry'); }
      }
      return finish();   // quit WITHOUT logout: the next start must still be logged in
    } catch (e) { results.errors.push(String(e && e.stack || e)); L('ERROR', e && e.stack || e); return finish(); }
  };
  run();
};
