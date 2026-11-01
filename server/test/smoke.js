
const { spawn } = require('child_process'); const path = require('path'); const fs = require('fs'); const os = require('os');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-'));
const port = 18000 + Math.floor(Math.random() * 1000);
const p = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: port, DATA_DIR: dir, ADMIN_PASSWORD: 'Start#Pass2026' }, stdio: ['ignore', 'pipe', 'pipe'] });
p.stdout.on('data', d => process.stdout.write('[srv] ' + d)); p.stderr.on('data', d => process.stdout.write('[srv-err] ' + d));
let cookie = '';
async function call(m, ...a) { const r = await fetch(`http://127.0.0.1:${port}/api/call`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-rs-client': '1', cookie }, body: JSON.stringify({ m, a }) }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; const j = await r.json(); if (!j.ok) throw new Error(j.code + ': ' + j.error); return j.data; }
(async () => {
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/api/health`); break; } catch (_) { await new Promise(r => setTimeout(r, 100)); } }
  try {
    console.log(await call('app.info'));
    console.log(await call('auth.login', 'admin', 'Start#Pass2026'));
    try { await call('company.list'); } catch (e) { console.log('expected must_change:', e.message); }
    await call('auth.changePassword', 'Start#Pass2026', 'Better#Pass2026x');
    const ci = await call('company.create', { name: 'Test Traders', state_code: '09' });
    console.log('company', ci.id, Object.keys(ci.settings).length);
    console.log('ledgers', (await call('c', 'ledgers')).length);
    console.log('dash', Object.keys(await call('c', 'dashboard', {})).length);
    console.log('due', (await call('c', 'dueDates', {})).slice(0, 3));
    const st = await call('c', 'itrCompute', { fy: '2025-26' }); console.log('itr', st.result.total, st.form);
    const html = await call('doc.html', 'itr', 0, { args: { fy: '2025-26' } }); console.log('itr html', html.length);
    const f = await call('company.backup'); console.log('backup', f.__file.name, f.__file.size);
  } catch (e) { console.log('FAIL', e); }
  p.kill();
})();
