
const H = require('./worker-harness');
(async () => {
  const { client, env } = await H('/tmp/worker-test.mjs');
  const a = client(), b = client();
  console.log(await a.call('app.info'));
  console.log(await a.call('auth.login', 'admin', 'Start#Pass2026'));
  await a.call('auth.changePassword', 'Start#Pass2026', 'Better#Pass2026x');
  const ci = await a.call('company.create', { name: 'Cloud Traders', state_code: '09' });
  console.log('company', ci.id);
  await a.call('users.save', { username: 'ravi', role: 'operator', password: 'Kashi#Strong2026', mustChange: false });
  await b.call('auth.login', 'ravi', 'Kashi#Strong2026');
  await b.call('company.open', ci.id);
  const cash = (await a.call('c', 'ledgers')).find(l => l.name === 'Cash').id;
  const grp = (await a.call('c', 'groups')).find(g => g.name === 'Indirect Expenses').id;
  const exp = await a.call('c', 'saveLedger', { name: 'Shop Rent Test', group_id: grp });
  env.FILES.delay = 20;
  const jobs = []; for (let i = 0; i < 6; i++) jobs.push((i % 2 ? a : b).call('c', 'saveVoucher', { vtype: 'PMT', date: '2026-10-0' + (i + 1), lines: [{ ledger_id: cash, dr: 0, cr: 100 + i }, { ledger_id: exp, dr: 100 + i, cr: 0 }] }));
  const res = await Promise.all(jobs); console.log('numbers', res.map(r => r.number));
  const db = await a.call('c', 'dayBook', { from: '2026-10-01', to: '2026-10-31' }); console.log('daybook rows', db.rows.length);
  try { await b.call('c', 'deleteVoucher', res[0].id); console.log('BAD: operator deleted'); } catch (e) { console.log('denied ok:', e.code, e.message); }
  const au = await a.call('c', 'auditLog', {}); console.log('audit users', [...new Set(au.rows.map(r => r.user || r.username))]);
  const f = await a.call('export.excel', db, 'Day book'); console.log('xlsx', f.__file.size);
  const html = await a.call('doc.html', 'voucher', res[0].id); console.log('voucher html', html.length);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
