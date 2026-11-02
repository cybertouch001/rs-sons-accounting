// v2.3 desktop (online mode) check: English-only screens, no "own server" option, Forgot password link, PDF viewer for a viewer.
// Runs only with RS_E2E=1 RS_E2E_SCRIPT=e2e-v23.js RS_SERVER=<staging server> RS_TEST_USER / RS_TEST_PW (a viewer) RS_E2E_SAVE_DIR.
const fs = require('fs'), path = require('path');
module.exports = ({ app, getWin, SHELL }) => {
  const out = process.env.RS_E2E_OUT || '/tmp/rs-e2e-v23'; fs.mkdirSync(out, { recursive: true });
  const R = { checks: [] }; const check = (ok, msg) => { R.checks.push({ ok: !!ok, msg }); console.log('[e2e]', ok ? 'PASS' : 'FAIL', msg); };
  const sleep = ms => new Promise(r => setTimeout(r, ms)); const js = code => getWin().webContents.executeJavaScript(code, true);
  const until = async (code, ms = 40000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await js(code)) return true; } catch (_) {} await sleep(300); } return false; };
  const shot = async n => { await sleep(600); fs.writeFileSync(path.join(out, n + '.png'), (await getWin().webContents.capturePage()).toPNG()); };
  const HINDI = "/[\\u0900-\\u097F]|\\b(sirf|apna|karo|kiya|nahi|hai|jagah|baar|wapas|kholo|chalu)\\b/i";
  (async () => {
    try {
      await sleep(2500);
      check(await until("!!document.getElementById('loginForm') && !document.getElementById('login').classList.contains('hidden') && !!window.rsShell"), 'online login screen loads from the server with the desktop bridge');
      await sleep(800);
      check(await js(`!${HINDI}.test(document.body.innerText)`), 'login screen text is English only');
      check(await js("!document.getElementById('ladv') && !/apna server|own server|Advanced/i.test(document.body.innerText)"), 'no "Advanced: apna server" option');
      check(await js("/login once, data everywhere/.test(document.getElementById('lmode').textContent) && /Offline mode \\(this PC only\\)/.test(document.getElementById('lalt').textContent)"), 'login shows "Online — login once, data everywhere" and "Offline mode (this PC only)"');
      check(await js("document.getElementById('lforgot').offsetParent !== null"), '"Forgot password?" link is shown');
      check(await js("typeof rsShell.setServer === 'undefined' && typeof rsShell.resetServer === 'undefined' && typeof rsShell.savePdfAs === 'function'"), 'the desktop bridge has no server-change call; has Save PDF');
      check(SHELL.setServer === undefined && SHELL.info().custom === false, 'main process: no server change at all');
      await shot('1-desktop-login');
      await js(`document.getElementById('lu').value='${process.env.RS_TEST_USER}'; document.getElementById('lp').value='${process.env.RS_TEST_PW}'; document.getElementById('lbtn').click(); true`);
      check(await until("!document.getElementById('companies').classList.contains('hidden')"), 'viewer logs in on the desktop app');
      await js("[...document.querySelectorAll('.comp-row')].find(r=>/Staging Test Co/.test(r.textContent)).click(); true"); await until("!document.getElementById('app').classList.contains('hidden')"); await sleep(1500);
      check(await js(`!${HINDI}.test(document.body.innerText)`), 'dashboard text is English only'); await shot('2-desktop-viewer-dashboard');
      const vid = await js("rs.api('c','vouchers',{}).then(l=>(l.find(v=>/sales/i.test(v.vtype||''))||l[0]).id)");
      await js(`go('voucher',{id:${vid}}); true`); await sleep(2500); await shot('3-desktop-viewer-invoice');
      await js("[...document.querySelectorAll('#main button')].find(b=>/PDF/.test(b.textContent)).click(); true");
      check(await until("!document.getElementById('docview').classList.contains('hidden')", 20000), 'PDF / Preview opens the built-in document viewer');
      check(await js("[...document.querySelectorAll('#docview .dv-bar button')].map(b=>b.textContent).join('|') === '⬇ Download PDF|🖨 Print|📤 Share|✕ Close (Esc)'"), 'viewer sees Download PDF · Print · Share · Close'); await sleep(1500); await shot('4-desktop-viewer-pdf-viewer');
      await js("document.querySelector('#docview .dv-d').click(); true");
      check(await until("/PDF saved/.test(document.querySelector('#docview .dv-m').textContent)", 30000), 'Download PDF saves a real PDF file');
      const dir = process.env.RS_E2E_SAVE_DIR; const f = dir && fs.readdirSync(dir).find(x => x.endsWith('.pdf'));
      check(f && fs.readFileSync(path.join(dir, f)).slice(0, 5).toString() === '%PDF-', 'the saved file is a PDF: ' + f);
      await js("document.querySelector('#docview .dv-s').click(); true"); await sleep(3000);
      check(await js("/PDF saved/.test(document.querySelector('#docview .dv-sh').textContent) && !!document.querySelector('#docview .dv-sh [data-sh=wa]')"), 'Share saves the PDF and offers WhatsApp / Email'); await shot('5-desktop-viewer-share');
      const save = await js("rs.api('c','saveLedger',{name:'X',group_id:1}).then(()=>'SAVED').catch(e=>e.code)"); check(save === 'forbidden', 'viewer write from the desktop app → refused (403): ' + save);
      await getWin().loadFile(path.join(__dirname, '..', 'renderer', 'offline.html'), { query: { server: 'x', code: '-106', desc: 'ERR_INTERNET_DISCONNECTED' } }); await sleep(1200);
      check(await js(`!${HINDI}.test(document.body.innerText) && !document.getElementById('adv')`), 'no-internet page: English only, no Advanced button'); await shot('6-desktop-offline-page');
      await getWin().loadFile(path.join(__dirname, '..', 'renderer', 'connecting.html'), { query: { server: 'x' } }); await sleep(800);
      check(await js(`!${HINDI}.test(document.body.innerText) && /Connecting…/.test(document.body.innerText)`), 'connecting page: "Connecting…" in English only'); await shot('7-desktop-connecting');
    } catch (e) { check(false, 'error ' + (e && e.stack || e)); }
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(R, null, 1)); console.log('[e2e] DONE', R.checks.filter(c => c.ok).length + '/' + R.checks.length); app.exit(0);
  })();
};
