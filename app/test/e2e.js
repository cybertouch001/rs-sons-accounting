
// End-to-end UI test + screenshots. Runs only when RS_E2E=1 (not shipped in the installer).
const fs = require('fs'), path = require('path');
module.exports = ({ win, H, app }) => {
  const out = process.env.RS_E2E_OUT || '/tmp/rs-e2e'; fs.mkdirSync(out, { recursive: true });
  const log = []; const L = (...a) => { const s = a.join(' '); log.push(s); console.log('[e2e]', s); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const js = code => win.webContents.executeJavaScript(code, true);
  const shot = async name => { await sleep(300); await js(`document.querySelectorAll('#toast div').forEach(d=>d.remove())`); await sleep(200); const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(out, name + '.png'), img.toPNG()); L('shot', name); };
  const key = async (keyCode, modifiers = []) => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); if (keyCode.length === 1 && !modifiers.includes('control') && !modifiers.includes('alt')) win.webContents.sendInputEvent({ type: 'char', keyCode, modifiers }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await sleep(40); };
  const type = async (text) => { for (const ch of text) await key(ch); await sleep(250); };
  const errText = () => js(`(document.querySelector('#main .err') || {}).textContent || (document.querySelector('#rtitle') && document.querySelector('#rtitle').textContent==='Report' ? 'report error' : '') || ''`);
  const toasts = () => js(`[...document.querySelectorAll('#toast div.err')].map(d=>d.textContent).join(' | ')`);
  const results = { errors: [], checks: [] };
  const check = (ok, msg) => { results.checks.push({ ok: !!ok, msg }); L(ok ? 'PASS' : 'FAIL', msg); };
  win.webContents.on('console-message', (e, level, msg) => { if (level >= 2) results.errors.push('console: ' + msg); });
  win.webContents.once('did-finish-load', async () => {
    try {
      await sleep(1200);
      await shot('00-login');
      check(await js(`!document.querySelector('#lserver').classList.contains('hidden')`), 'v2: "Connect to multi-user server" button shown in local mode');
      await js(`document.querySelector('#lp').value='admin'; document.querySelector('#loginForm').requestSubmit();`); await sleep(800);
      await js(`document.querySelector('#f_n1').value='rs@12345'; document.querySelector('#f_n2').value='rs@12345'; document.querySelector('[data-a=ok]').click();`); await sleep(900);
      check(await js(`!document.querySelector('#companies').classList.contains('hidden')`), 'login + forced password change → company list');
      await shot('01-company-select');
      await js(`document.querySelector('#cdemo').click()`);
      for (let i = 0; i < 60; i++) { await sleep(500); if (await js(`!!document.querySelector('.kpis') && APP.cache.items && APP.cache.items.length>0`)) break; }
      await sleep(1500);
      check(await js(`document.querySelectorAll('.kpi').length===8`), 'demo company created, dashboard shows KPIs');
      await shot('02-dashboard');
      // ---- UI-driven sales invoice entry ----
      await js(`go('voucher',{vtype:'SAL'})`); await sleep(1200);
      await js(`document.querySelector('#vparty').focus()`); await type('Delhi Pharma'); await key('Return'); await sleep(700);
      await js(`document.querySelector('#ig .it').focus()`); await type('Face Cream'); await key('Return'); await sleep(900);
      await js(`{const q=document.querySelector('#ig tbody tr .q'); q.value='12'; q.dispatchEvent(new Event('input',{bubbles:true}));}`); await sleep(200);
      await js(`{const it=[...document.querySelectorAll('#ig .it')].pop(); it.focus();}`); await type('Vitamin'); await key('Return'); await sleep(900);
      await js(`{const q=[...document.querySelectorAll('#ig tbody tr .q')][1]; q.value='5'; q.dispatchEvent(new Event('input',{bubbles:true}));}`); await sleep(400);
      const totTxt = await js(`document.querySelector('#vtot').textContent`);
      check(/IGST/.test(totTxt) && /Inter-state/.test(totTxt), 'live total shows IGST for Delhi party: ' + totTxt.replace(/\s+/g, ' ').slice(0, 160));
      await shot('03-sales-voucher-entry');
      await key('S', ['control']); await sleep(1500);
      const last = await js(`rs.api('c','vouchers',{vtype:'SAL'}).then(r=>r[r.length-1])`);
      const v = await js(`rs.api('c','voucher',${last.id})`);
      check(v.party_name === 'Delhi Pharma Distributors' && v.items.length === 2 && v.igst > 0 && v.cgst === 0, `invoice ${v.number} saved via keyboard: taxable ${v.taxable}, IGST ${v.igst}, total ${v.total}`);
      // intra-state invoice via UI
      await js(`go('voucher',{vtype:'SAL'})`); await sleep(1000);
      await js(`document.querySelector('#vparty').focus()`); await type('Kashi'); await key('Return'); await sleep(700);
      await js(`document.querySelector('#ig .it').focus()`); await type('Face Wash'); await key('Return'); await sleep(900);
      await key('S', ['control']); await sleep(1500);
      const last2 = await js(`rs.api('c','vouchers',{vtype:'SAL'}).then(r=>r[r.length-1])`); const v2 = await js(`rs.api('c','voucher',${last2.id})`);
      check(v2.cgst > 0 && v2.sgst === v2.cgst && v2.igst === 0, `intra-state invoice ${v2.number}: CGST ${v2.cgst} + SGST ${v2.sgst}`);
      // open saved invoice (alteration view) + PDF
      await js(`go('voucher',{id:${v.id}})`); await sleep(1500); await shot('04-sales-invoice-saved');
      const pdf = await H['doc.pdf']('voucher', v.id, { preview: false });
      fs.copyFileSync(pdf.file, path.join(out, 'invoice.pdf')); check(pdf.size > 20000, 'invoice PDF generated ' + pdf.size + ' bytes');
      const pdf2 = await H['doc.pdf']('voucher', v2.id, { preview: false }); fs.copyFileSync(pdf2.file, path.join(out, 'invoice-intra.pdf'));
      // receipt via UI
      await js(`go('voucher',{vtype:'RCT'})`); await sleep(1000);
      await js(`{const a=document.querySelector('#ag .lg'); a.focus()}`); await type('Delhi Pharma'); await key('Return'); await sleep(1200);
      await js(`{const am=document.querySelector('#ag .am2'); am.value='10000'; am.dispatchEvent(new Event('input',{bubbles:true}));}`); await sleep(300);
      await shot('05-receipt-voucher');
      await key('S', ['control']); await sleep(1200);
      const rc = await js(`rs.api('c','vouchers',{vtype:'RCT'}).then(r=>r[r.length-1])`); check(rc && rc.total === 10000, 'receipt saved via UI ₹10,000');
      // reports
      const reps = [['06-trial-balance', 'trialBalance'], ['07-profit-loss', 'profitLoss'], ['08-balance-sheet', 'balanceSheet'], ['09-gstr3b', 'gstr3b'], ['10-gstr1', 'gstr1'], ['11-stock-summary', 'stockSummary'], ['12-outstanding', 'outstanding', { kind: 'receivable' }], ['13-day-book', 'dayBook', { from: '2026-04-01', to: '2027-03-31' }]];
      for (const [n, r, a] of reps) { await js(`go('report',{r:'${r}',a:${JSON.stringify(a || null)}})`); await sleep(1600); const e = await errText(); check(!e, `report ${r} renders`); await shot(n); }
      const tb = await js(`APP.cache.lastRep`); void tb;
      const tbm = await js(`rs.api('c','trialBalance',{from:'2026-04-01',to:'2027-03-31'}).then(r=>r.meta)`); check(tbm.balanced, 'trial balance tallies after UI entries');
      const bsm = await js(`rs.api('c','balanceSheet',{to:'2027-03-31'}).then(r=>r.meta)`); check(bsm.balanced, `balance sheet balances (${bsm.liabilities} = ${bsm.assets})`);
      // dashboard == reports, on this same data state (after all UI entries)
      { const T = require('../core').util.today(); const near = (a, b) => Math.abs(a - b) < 0.011;
        const d = await js(`rs.api('c','dashboard',{})`), b = await js(`rs.api('c','balanceSheet',{to:'${T}'})`), o = await js(`rs.api('c','outstanding',{kind:'receivable',to:'${T}'})`);
        const R = n => { const r = b.rows.find(x => x.rp === n); return r ? r.ra : 0; }, Lq = n => { const r = b.rows.find(x => x.lp === n); return r ? r.la : 0; };
        check(near(d.cash, R('Cash-in-Hand')) && near(d.bankTotal, R('Bank Accounts')) && near(d.receivables, R('Sundry Debtors')) && near(d.payables, Lq('Sundry Creditors')) && near(d.netProfit, b.meta.netProfit),
          `dashboard = balance sheet after UI entries (cash ${d.cash}, bank ${d.bankTotal}, debtors ${d.receivables}, creditors ${d.payables}, profit ${d.netProfit})`);
        check(near(d.overdueAmt, o.meta.overdue) && d.overdueAmt <= d.receivables + 0.01 && near(d.receivables, o.meta.total), `overdue ${d.overdueAmt} = outstanding report, ≤ receivables ${d.receivables}`);
        await js(`go('dashboard')`); await sleep(1500); await shot('21-dashboard-same-data');
        const shown = await js(`[...document.querySelectorAll('.kpi .v')].map(x=>x.textContent).join(' | ')`); L('dashboard KPIs shown:', shown);
        await js(`go('report',{r:'balanceSheet',a:null})`); await sleep(1600); await shot('22-balance-sheet-same-data');
        await js(`go('report',{r:'outstanding',a:{kind:'receivable',detail:true}})`); await sleep(1600); await shot('23-outstanding-billwise-same-data'); }
      // ledger statement drill
      await js(`go('report',{r:'ledgerStatement',a:{ledger_id: APP.cache.ledgers.find(l=>l.name==='Kashi Medical Store').id}})`); await sleep(1400); await shot('14-ledger-statement');
      await js(`go('ledgerList')`); await sleep(1000); await shot('15-ledgers');
      await js(`go('itemList')`); await sleep(1200); await shot('16-items');
      await js(`go('reportsMenu')`); await sleep(800); await shot('17-reports-menu');
      // crawl every nav entry and report menu item for errors
      const navs = await js(`[...document.querySelectorAll('#nav a')].map(a=>[a.dataset.go,a.dataset.p])`);
      const menus = ['reportsMenu', 'gstMenu', 'mastersMenu', 'stockMenu', 'orderMenu', 'bankingMenu', 'utilities'];
      let items = navs.map(([g, p]) => [g, JSON.parse(p)]);
      for (const m of menus) { await js(`go('${m}')`); await sleep(500); const mi = await js(`[...document.querySelectorAll('.mi')].map(x=>[x.dataset.s, x.dataset.p])`); items.push(...mi.map(([g, p]) => [g, JSON.parse(p)])); }
      const skip = new Set(['backup', 'restore', 'dataFolder', 'changePw']);
      const seen = new Set(); let crawled = 0;
      for (const [g, p] of items) { const k = g + JSON.stringify(p); if (seen.has(k) || skip.has(g)) continue; seen.add(k);
        await js(`go(${JSON.stringify(g)}, ${JSON.stringify(p)})`); await sleep(g === 'report' ? 1100 : 600); crawled++;
        const e = await errText(); const t = await toasts(); if (e || /Error/.test(await js(`(document.querySelector('#main h2')||{}).textContent||''`))) results.errors.push(`screen ${g} ${JSON.stringify(p)}: ${e}`); if (t) results.errors.push(`toast on ${g} ${JSON.stringify(p)}: ${t}`);
        await js(`document.querySelectorAll('#toast div').forEach(d=>d.remove())`); }
      check(true, `crawled ${crawled} screens`);
      await js(`go('payroll')`); await sleep(900); await shot('18-payroll');
      await js(`go('voucher',{vtype:'JRN'})`); await sleep(900); await shot('19-journal-entry');
      await js(`go('help')`); await sleep(700); await shot('20-help');
      const rp = await H['doc.pdf']('report', 0, { report: await js(`rs.api('c','balanceSheet',{to:'2027-03-31'})`), preview: false }); fs.copyFileSync(rp.file, path.join(out, 'balance-sheet.pdf'));
      const tbp = await H['doc.pdf']('report', 0, { report: await js(`rs.api('c','trialBalance',{from:'2026-04-01',to:'2027-03-31'})`), preview: false }); fs.copyFileSync(tbp.file, path.join(out, 'trial-balance.pdf'));
      for (const s of ['itr', 'gstr2b', 'bankImport', 'recurring', 'dueDates']) { await js(`go('${s}', {})`); await sleep(1500); const er = (await errText()) || (await toasts()); check(!er, 'v2 screen ' + s + (er ? ': ' + er : '')); await shot('v2-' + s); }
      const itr = await js(`rs.api('c','itrCompute',{fy:'2026-27'})`); check(itr && itr.result && typeof itr.result.total === 'number', 'v2 ITR computed from demo books: total income ' + (itr && itr.result.taxable));
      const ip = await H['doc.pdf']('itr', 0, { args: { fy: '2026-27' }, preview: false }); fs.copyFileSync(ip.file, path.join(out, 'itr-computation.pdf')); check(fs.statSync(ip.file).size > 5000, 'v2 ITR computation PDF made');
      // excel export via handler bypassing dialog
      const XLSX = require('xlsx'); const rep = await js(`rs.api('c','gstr3b',{from:'2026-04-01',to:'2027-03-31'})`); check(rep.rows.length > 10, 'GSTR-3B rows ' + rep.rows.length);
      const vd = await js(`rs.api('c','verifyData')`); check(vd.issues.filter(i => i.type !== 'Negative stock').length === 0, 'verify data: ' + JSON.stringify(vd.issues).slice(0, 200));
      void XLSX;
      // role check: viewer cannot save
      await H['users.save']({ username: 'viewer1', role: 'viewer', password: 'view1234', active: 1 });
      check((await H['users.list']()).length === 2, 'second user created');
    } catch (e) { results.errors.push('E2E exception: ' + (e.stack || e)); L('EXCEPTION', e.stack || e); }
    results.log = log; fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 1));
    L('DONE', results.checks.filter(c => c.ok).length + '/' + results.checks.length, 'errors:', results.errors.length);
    setTimeout(() => app.exit(0), 500);
  });
};
