// v2.2 desktop (online mode) check: a view-only login locks this PC's offline / own-server choices. Runs only with RS_E2E=1.
const fs = require('fs'), path = require('path');
module.exports = ({ app, getWin, sysRef }) => {
  const out = process.env.RS_E2E_OUT || '/tmp/rs-e2e-v22'; fs.mkdirSync(out, { recursive: true });
  const R = { checks: [] }; const check = (ok, msg) => { R.checks.push({ ok: !!ok, msg }); console.log('[e2e]', ok ? 'PASS' : 'FAIL', msg); };
  const sleep = ms => new Promise(r => setTimeout(r, ms)); const js = code => getWin().webContents.executeJavaScript(code, true);
  const until = async (code, ms = 40000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await js(code)) return true; } catch (_) {} await sleep(300); } return false; };
  const shot = async n => { await sleep(500); fs.writeFileSync(path.join(out, n + '.png'), (await getWin().webContents.capturePage()).toPNG()); };
  (async () => {
    try {
      await sleep(3000);
      check(await until("!!document.getElementById('loginForm') && !document.getElementById('login').classList.contains('hidden') && !!window.rsShell"), 'online login screen loads from the server with the desktop bridge');
      check(await js("!!document.getElementById('loffline') && document.getElementById('lalt').offsetParent !== null"), 'before any viewer: "Offline mode (sirf is PC pe)" link is shown');
      await shot('1-login-normal');
      await js(`document.getElementById('lu').value='${process.env.RS_TEST_USER}'; document.getElementById('lp').value='${process.env.RS_TEST_PW}'; document.getElementById('lbtn').click(); true`);
      check(await until("!document.getElementById('companies').classList.contains('hidden')"), 'viewer logs in on the desktop app');
      await sleep(1000);
      check(sysRef().viewerLock === true, 'the PC remembers it is a view-only device (saved in system.json)');
      check(await js("document.body.classList.contains('viewonly')"), 'screen is in view-only mode');
      await js("document.querySelector('.comp-row').click(); true"); await until("!document.getElementById('app').classList.contains('hidden')"); await sleep(1500); await shot('2-viewer-desktop');
      check(await js("![...document.querySelectorAll('#nav a')].some(a=>/Sales Invoice|Company Settings|Bank Statement Import/.test(a.textContent))"), 'desktop viewer nav has no entry / setup screens');
      const off = await js("rsShell.offline().then(()=>'switched').catch(e=>e.message)"); check(/View-only/.test(off), 'offline mode is refused by the app itself: ' + off.slice(-60));
      const srv = await js("rsShell.setServer('https://example.com').then(()=>'changed').catch(e=>e.message)"); check(/View-only/.test(srv), 'changing the server is refused: ' + srv.slice(-60));
      await js("api('auth.logout').then(()=>showLogin()); true"); await sleep(2500);
      check(await js("['lmode','lalt','lserver'].every(id=>{const e=document.getElementById(id); return !e || e.offsetParent===null})"), 'after logout the login screen shows no offline / server / storage choices');
      await shot('3-login-viewer-device');
      // the connecting / no-internet pages hide Offline + Advanced too
      await getWin().loadFile(path.join(__dirname, '..', 'renderer', 'offline.html'), { query: { server: 'x', code: '-106', desc: 'ERR_INTERNET_DISCONNECTED' } }); await sleep(1500);
      check(await js("['off','adv'].every(id=>{const e=document.getElementById(id); return !e || getComputedStyle(e).display==='none'})"), 'no-internet page: Offline / Advanced buttons hidden on a view-only PC');
      await shot('4-offline-page-viewer');
    } catch (e) { check(false, 'error ' + (e && e.stack || e)); }
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(R, null, 1)); console.log('[e2e] DONE', R.checks.filter(c => c.ok).length + '/' + R.checks.length); app.exit(0);
  })();
};
