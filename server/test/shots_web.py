
import asyncio, json, os, subprocess, sys, time, tempfile, socket, urllib.request
from playwright.async_api import async_playwright
SRV = '/home/user/work/rs-sons-v2/server'; OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
data = tempfile.mkdtemp(prefix='rsshots-')
log = open(os.path.join(data, 'server.log'), 'w')
proc = subprocess.Popen(['node', 'server.js'], cwd=SRV, env=dict(os.environ, PORT=str(port), DATA_DIR=data, ADMIN_PASSWORD='Start#Pass2026'), stdout=log, stderr=log, start_new_session=True)
base = f'http://127.0.0.1:{port}'
SETUP = """async () => {
  const C = (m, ...a) => rs.api('c', m, ...a);
  const L = await C('ledgers'); const byId = Object.fromEntries(L.map(l => [l.id, l]));
  // GSTR-2B for a month built from the demo purchase bills: most match, one amount differs, one bill missing, one extra supplier invoice
  let db, prev = -1, same = 0; for (let k = 0; k < 120; k++) { db = await C('dayBook', { from: '2026-04-01', to: '2027-03-31' }); if (db.rows.length && db.rows.length === prev) { if (++same >= 3) break; } else same = 0; prev = db.rows.length; await new Promise(r => setTimeout(r, 1000)); }
  const pur = db.rows.filter(r => /^(PUR|Purchase)/.test(String(r.vtype)));
  if (!pur.length) return 'no PUR rows; sample ' + JSON.stringify(db.rows.slice(0, 2));
  let month = null, docs = [];
  for (const r of pur) { const v = await C('voucher', r._drill.voucher); if (!v || !v.party_id) continue; const p = byId[v.party_id]; if (!p || !p.gstin) continue; const m = v.date.slice(0, 7); if (!month) month = m; if (m !== month) continue; docs.push({ v, p }); }
  if (!docs.length) { const v = await C('voucher', pur[0]._drill.voucher); return 'no purchases: n=' + db.rows.length + ' pur=' + pur.length + ' sample=' + JSON.stringify(pur[0]).slice(0, 300) + ' v=' + JSON.stringify(v && { party_id: v.party_id, keys: Object.keys(v) }).slice(0, 600) + ' party=' + JSON.stringify(v && byId[v.party_id]).slice(0, 200); }
  const b2b = {}; let i = 0;
  for (const { v, p } of docs) { i++; if (i === 2) continue; const igst = v.entries.filter(e => /IGST/i.test(byId[e.ledger_id]?.name || '')).reduce((s, e) => s + e.dr, 0); const cgst = v.entries.filter(e => /CGST/i.test(byId[e.ledger_id]?.name || '')).reduce((s, e) => s + e.dr, 0); const sgst = v.entries.filter(e => /SGST/i.test(byId[e.ledger_id]?.name || '')).reduce((s, e) => s + e.dr, 0);
    const tax = igst + cgst + sgst; let tx = Math.round((v.total - tax - (v.round_off || 0)) * 100) / 100; if (i === 3) tx += 500;
    (b2b[p.gstin] = b2b[p.gstin] || { ctin: p.gstin, trdnm: p.name.toUpperCase(), inv: [] }).inv.push({ inum: v.ref_no || v.number, dt: v.date.split('-').reverse().join('-'), val: v.total, pos: '09', rev: 'N', itcavl: 'Y', items: [{ num: 1, rt: 18, txval: tx, igst, cgst, sgst, cess: 0 }] }); }
  const first = Object.values(b2b)[0]; first.inv.push({ inum: 'X/991', dt: month.split('-').reverse().join('-').replace(/^/, '28-'), val: 5900, pos: '09', rev: 'N', itcavl: 'Y', items: [{ num: 1, rt: 18, txval: 5000, cgst: 450, sgst: 450 }] });
  first.inv[first.inv.length - 1].dt = '28-' + month.slice(5, 7) + '-' + month.slice(0, 4);
  const j = { data: { gstin: (await C('settings')).gstin, rtnprd: month.slice(5, 7) + month.slice(0, 4), docdata: { b2b: Object.values(b2b) } } };
  await C('gstr2bImport', { json: JSON.stringify(j), file_name: 'GSTR2B.json' });
  // bank statement from the bank book of the same month + two lines not in the books
  const bank = L.find(l => l.group_name === 'Bank Accounts');
  const bb = await C('ledgerStatement', { ledger_id: bank.id, from: month + '-01', to: month + '-28' });
  const rows = [['Txn Date', 'Description', 'Ref No./Cheque No.', 'Debit', 'Credit', 'Balance']];
  for (const r of bb.rows.filter(r => r.date && (r.dr || r.cr))) rows.push([r.date.split('-').reverse().join('/'), 'NEFT ' + (r.particulars || r.account || ''), r.number || '', r.cr || '', r.dr || '', '']);
  rows.push(['27/' + month.slice(5, 7) + '/' + month.slice(0, 4), 'UPI/' + (L.find(l => /Debtors/.test(l.group_name || ''))?.name || 'CUSTOMER') + '/PAYMENT', 'UPI4471', '', '2360', '']);
  rows.push(['28/' + month.slice(5, 7) + '/' + month.slice(0, 4), 'SMS CHARGES QTR', '', '17.70', '', '']);
  const im = await C('bankImport', { ledger_id: bank.id, rows, file_name: 'statement.xlsx' });
  return JSON.stringify({ month, docs: docs.length, bank: im });
}"""
async def main():
    try:
        for _ in range(50):
            try: urllib.request.urlopen(base + '/api/health', timeout=1); break
            except Exception: time.sleep(0.1)
        async with async_playwright() as pw:
            b = await pw.chromium.launch()
            ctx = await b.new_context(viewport={'width': 1366, 'height': 800}, device_scale_factor=1)
            page = await ctx.new_page(); errs = []
            page.on('pageerror', lambda e: errs.append(str(e))); page.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
            await page.goto(base + '/app/'); await page.wait_for_selector('#loginForm', state='visible')
            await page.screenshot(path=f'{OUT}/web-login.png')
            await page.fill('#lu', 'admin'); await page.fill('#lp', 'Start#Pass2026'); await page.click('#loginForm button[type=submit]')
            await page.wait_for_selector('#f_n1'); await page.fill('#f_n1', 'Kashi#Ganga2026'); await page.fill('#f_n2', 'Kashi#Ganga2026'); await page.click('#modalBox [data-a=ok]')
            await page.wait_for_selector('#cdemo', state='visible'); await page.click('#cdemo')
            await page.wait_for_selector('#app:not(.hidden)', timeout=120000); await page.wait_for_timeout(1500)
            print('setup', await page.evaluate(SETUP))
            await page.evaluate("render()"); await page.wait_for_timeout(1200)
            await page.evaluate("go('dashboard',{})"); await page.wait_for_timeout(1500); await page.screenshot(path=f'{OUT}/web-dashboard.png')
            for name in ['itr', 'gstr2b', 'bankImport', 'dueDates']:
                await page.evaluate(f"go('{name}', {{}})"); await page.wait_for_timeout(1800)
                if name == 'itr':
                    await page.evaluate("document.querySelector('#itout').scrollIntoView()"); await page.wait_for_timeout(300)
                await page.screenshot(path=f'{OUT}/web-{name}.png')
            await page.evaluate("go('users', {})"); await page.wait_for_timeout(1000); await page.screenshot(path=f'{OUT}/web-users.png')
            ph = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
            cookies = await ctx.cookies(); await ph.add_cookies(cookies)
            p2 = await ph.new_page(); p2.on('pageerror', lambda e: errs.append('phone: ' + str(e)))
            await p2.goto(base + '/app/'); await p2.wait_for_selector('#app:not(.hidden)', timeout=30000); await p2.wait_for_timeout(1500)
            await p2.screenshot(path=f'{OUT}/phone-dashboard.png')
            await p2.click('#tmenu'); await p2.wait_for_timeout(500); await p2.screenshot(path=f'{OUT}/phone-menu.png')
            await p2.evaluate("document.querySelector('#nav').classList.remove('open'); go('itr', {})"); await p2.wait_for_timeout(1800); await p2.screenshot(path=f'{OUT}/phone-itr.png')
            print('errors', errs)
            await b.close()
    finally:
        os.killpg(proc.pid, 15)
asyncio.run(main())
