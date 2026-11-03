// v2.4 desktop (online mode) check: the Windows app's device name reaches "Logged-in devices"; a removed user is sent back to login with the reason.
// Runs only with RS_E2E=1 RS_E2E_SCRIPT=e2e-v24.js RS_SERVER=<staging server> RS_TEST_USER / RS_TEST_PW (a user that will be removed) RS_E2E_OUT.
// The test driver removes the user from outside (admin API) after the app writes READY to RS_E2E_OUT/ready.
const fs = require('fs'), path = require('path');
module.exports = ({ app, getWin }) => {
  const out = process.env.RS_E2E_OUT || '/tmp/rs-e2e-v24'; fs.mkdirSync(out, { recursive: true });
  const R = { checks: [] }; const check = (ok, msg, extra) => { R.checks.push({ ok: !!ok, msg, extra }); console.log('[e2e]', ok ? 'PASS' : 'FAIL', msg, extra || ''); };
  const sleep = ms => new Promise(r => setTimeout(r, ms)); const js = code => getWin().webContents.executeJavaScript(code, true);
  const until = async (code, ms = 40000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await js(code)) return true; } catch (_) {} await sleep(300); } return false; };
  const shot = async n => { await sleep(600); fs.writeFileSync(path.join(out, n + '.png'), (await getWin().webContents.capturePage()).toPNG()); };
  (async () => {
    try {
      await sleep(2500);
      check(await until("!!document.getElementById('loginForm') && !document.getElementById('login').classList.contains('hidden') && !!window.rsShell"), 'online login screen loads with the desktop bridge');
      check(await js("typeof rsShell.deviceName === 'string' && rsShell.deviceName.length > 0"), 'desktop bridge exposes the PC name', await js('rsShell.deviceName + " / " + rsShell.osName'));
      await js(`document.getElementById('lu').value='${process.env.RS_TEST_USER}'; document.getElementById('lp').value='${process.env.RS_TEST_PW}'; document.getElementById('lbtn').click(); true`);
      check(await until("!document.getElementById('companies').classList.contains('hidden')"), 'user logs in on the desktop app');
      const mine = await js("rs.api('sessions.list','mine').then(r=>JSON.stringify(r))");
      check(/desktop|Windows app|PC/i.test(mine), 'My Devices lists this PC as the desktop app', mine.slice(0, 400));
      await shot('1-desktop-companies');
      fs.writeFileSync(path.join(out, 'ready'), String(Date.now()));
      const t0 = Date.now();
      const back = await until("!document.getElementById('login').classList.contains('hidden') && /deactivated|removed|logged out/i.test(document.getElementById('lerr').textContent)", 60000);
      let removedAt = 0; try { removedAt = Number(fs.readFileSync(path.join(out, 'removed'), 'utf8')); } catch (_) {}
      check(back, 'after the admin removes the user, the desktop app is back on the login screen with the reason', { seconds_after_remove: removedAt ? (Date.now() - removedAt) / 1000 : null, msg: await js("document.getElementById('lerr').textContent") });
      await shot('2-desktop-kicked-login');
    } catch (e) { check(false, 'crashed: ' + e.message); }
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(R, null, 1)); app.exit(0);
  })();
};
