// R&S Sons Accounting v2.0 - automation screens: Income Tax (ITR), GSTR-2B match, bank statement import, recurring vouchers, due dates.
'use strict';
const ledgerSource = (filter) => () => (APP.cache.ledgers || []).filter(filter || (() => true)).map(l => ({ id: l.id, label: l.name, sub: l.group_name }));
function drillRows(el, rep) { $$('#rtbl tbody tr', el).forEach(tr => { const r = rep.rows[+tr.dataset.i]; if (r && r._drill && r._drill.voucher) { tr.classList.add('drill'); tr.ondblclick = tr.onclick = (e) => { if (e.target.closest('button,select,input')) return; go('voucher', { id: r._drill.voucher }); }; } }); }
const pill = (s) => { const c = { 'Matched': 'green', 'matched': 'green', 'Mismatch': 'red', 'Missing in books': 'red', 'Missing in 2B': 'orange', 'unmatched': 'orange' }[s] || ''; return `<span class="pill ${c}">${esc(s)}</span>`; };

// ---------------- Income Tax computation ----------------
SCREENS.itr = async (el, p) => {
  const fyStart = (APP.fy || U.fyOf(APP.date)).start; const fyDefault = `${fyStart.slice(0, 4)}-${String(+fyStart.slice(0, 4) + 1).slice(2)}`;
  let info; try { info = await C('taxRules', p.fy || fyDefault); } catch (e) { info = await C('taxRules', '2025-26'); toast(e.message, 'err'); }
  const fy = info.fy; const prof = await C('itrProfile', fy); const bk = await C('itrBooks', fy);
  const B = prof.business || {}, S = prof.salary || {}, H = prof.house || {}, O = prof.other || {}, D = prof.deductions || {}, T = prof.taxes || {};
  const v = { taxpayer: prof.taxpayer || 'individual', age: prof.age || 'below60', regime: prof.regime || 'auto', method: B.method || 'books', turnover: B.turnover ?? '', cashReceipts: B.cashReceipts ?? '', declared: B.declared ?? '',
    adjustments: (B.adjustments || []).map(x => `${x.label} = ${x.amount}`).join('\n'), salGross: S.gross ?? '', salEx: S.exemptions ?? '', salPT: S.professionalTax ?? '', houseType: H.type || 'none', rent: H.rent ?? '', mtax: H.municipalTax ?? '', hint: H.interest ?? '',
    sav: O.savingsInterest ?? '', fd: O.fdInterest ?? '', div: O.dividend ?? '', oth: O.others ?? '', c80C: D.c80C ?? '', c80CCD1B: D.c80CCD1B ?? '', c80CCD2: D.c80CCD2 ?? '', d80Ds: D.d80D_self ?? '', d80Dp: D.d80D_parents ?? '', parentsSenior: prof.parentsSenior ? 1 : 0, d80G: D.d80G ?? '', dOth: D.others ?? '',
    tds: T.tds ?? '', tcs: T.tcs ?? '', adv: T.advance ?? '', sat: T.selfAssessment ?? '' };
  const F = [
    { section: 'Taxpayer' }, { k: 'taxpayer', label: 'Type', type: 'select', options: [['individual', 'Individual (proprietor)'], ['huf', 'HUF'], ['firm', 'Partnership firm (not LLP)']] }, { k: 'age', label: 'Age', type: 'select', options: [['below60', 'Below 60'], ['senior', '60 to 80'], ['superSenior', '80 and above']] },
    { k: 'regime', label: 'Regime', type: 'select', options: [['auto', 'Auto — pick the lower tax'], ['new', 'New regime (default)'], ['old', 'Old regime']] },
    { section: `Business income · books: turnover ₹${inr(bk.turnover, 0)}, net profit ₹${inr(bk.netProfit, 0)}` },
    { k: 'method', label: 'Method', type: 'select', options: [['books', 'As per books (P&L)'], ['44AD', 'Presumptive 44AD (business)'], ['44ADA', 'Presumptive 44ADA (profession)']] },
    { k: 'turnover', label: 'Turnover (blank = from books)', type: 'number', ph: String(bk.turnover) }, { k: 'cashReceipts', label: 'Of which received in cash (blank = estimate)', type: 'number', ph: String(bk.cashReceipts) }, { k: 'declared', label: 'Declare higher income (optional)', type: 'number' },
    { k: 'adjustments', label: 'Adjustments to book profit (one per line: Label = +amount / -amount)', type: 'textarea', w: 4, rows: 2, ph: 'Income tax debited in P&L = 25000\nDepreciation difference = -4000' },
    { section: 'Salary / house property' }, { k: 'salGross', label: 'Gross salary', type: 'number' }, { k: 'salEx', label: 'Exempt allowances (old regime: HRA etc.)', type: 'number' }, { k: 'salPT', label: 'Professional tax', type: 'number' },
    { k: 'houseType', label: 'House property', type: 'select', options: [['none', 'None'], ['self', 'Self-occupied (home loan)'], ['letout', 'Let out (rented)']] }, { k: 'rent', label: 'Annual rent received', type: 'number' }, { k: 'mtax', label: 'Municipal tax paid', type: 'number' }, { k: 'hint', label: 'Home-loan interest', type: 'number' },
    { section: 'Other income (not in books)' }, { k: 'sav', label: 'Savings bank interest', type: 'number' }, { k: 'fd', label: 'FD / RD interest', type: 'number' }, { k: 'div', label: 'Dividend', type: 'number' }, { k: 'oth', label: 'Any other income', type: 'number' },
    { section: 'Deductions (most only in old regime)' }, { k: 'c80C', label: '80C (PPF, LIC, ELSS…)', type: 'number' }, { k: 'c80CCD1B', label: '80CCD(1B) NPS own', type: 'number' }, { k: 'c80CCD2', label: '80CCD(2) employer NPS', type: 'number' },
    { k: 'd80Ds', label: '80D mediclaim self/family', type: 'number' }, { k: 'd80Dp', label: '80D mediclaim parents', type: 'number' }, { k: 'parentsSenior', label: 'Parents are senior citizens', type: 'check' }, { k: 'd80G', label: '80G donations (eligible)', type: 'number' }, { k: 'dOth', label: 'Other deductions', type: 'number' },
    { section: `Taxes already paid · books: TDS ₹${inr(bk.tdsReceivable, 0)}, advance tax ₹${inr(bk.advanceTax.reduce((s, a) => s + a.amount, 0), 0)}` },
    { k: 'tds', label: 'TDS (blank = TDS Receivable ledger)', type: 'number', ph: String(bk.tdsReceivable) }, { k: 'tcs', label: 'TCS', type: 'number' }, { k: 'adv', label: 'Advance tax (blank = "Advance Tax" ledger)', type: 'number' }, { k: 'sat', label: 'Self-assessment tax', type: 'number' },
  ];
  const years = info.years.map(y => `<option value="${y}" ${y === fy ? 'selected' : ''}>${+y.slice(0, 4) >= 2026 ? 'Tax year ' + y : `FY ${y} (AY ${+y.slice(0, 4) + 1}-${String(+y.slice(0, 4) + 2).slice(2)})`}</option>`).join('');
  el.innerHTML = `<h2 class="title">Income Tax Computation <small>${esc(info.label)} · ${esc(info.law)}</small><span style="flex:1"></span><select id="itfy">${years}</select></h2>
    <div class="alert ${info.status === 'verified' ? 'green' : ''}" style="cursor:default">${info.status === 'verified' ? '✔ Tax rates for this year checked against official sources.' : '⚠ Rates for this year are not yet confirmed — check before filing.'} The software prepares the computation, a PDF and an Excel sheet of what to enter in the return. Filing itself is done on the income-tax e-filing portal (direct filing from software is allowed only for government-registered e-Return Intermediaries).</div>
    <div class="card"><div class="form" id="itf">${formHtml(F, v)}</div>
    <div class="toolbar"><button class="btn primary" id="itc">Calculate <kbd>Ctrl+Enter</kbd></button>${can('operator') ? '<button class="btn" id="its">Save details</button>' : ''}<button class="btn" id="itp">PDF / Print</button><button class="btn" id="itx">Excel sheet for filing</button>${prof._updated_at ? `<span style="color:var(--muted);font-size:12px">saved by ${esc(prof._updated_by)} · ${esc(prof._updated_at)}</span>` : ''}</div></div>
    <div id="itout"></div>`;
  bindForm($('#itf', el), F, v);
  const num = x => x === '' || x == null ? undefined : Number(x);
  const collect = () => { const f = readForm($('#itf', el), F); const raw = k => { const e = $('#f_' + k, el); return e ? e.value : ''; };
    const adj = String(f.adjustments || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => { const m = l.match(/^(.*?)[=:]\s*([+-]?[\d,.]+)\s*$/); if (!m) throw new Error('Adjustment line must look like "Label = 5000" or "Label = -5000": ' + l); return { label: m[1].trim(), amount: Number(m[2].replace(/,/g, '')) }; });
    return { taxpayer: f.taxpayer, age: f.age, regime: f.regime, parentsSenior: !!f.parentsSenior,
      business: { method: f.method, turnover: num(raw('turnover')), cashReceipts: num(raw('cashReceipts')), declared: num(raw('declared')), adjustments: adj },
      salary: { gross: num(raw('salGross')), exemptions: num(raw('salEx')), professionalTax: num(raw('salPT')) }, house: { type: f.houseType, rent: num(raw('rent')), municipalTax: num(raw('mtax')), interest: num(raw('hint')) },
      other: { savingsInterest: num(raw('sav')), fdInterest: num(raw('fd')), dividend: num(raw('div')), others: num(raw('oth')) },
      deductions: { c80C: num(raw('c80C')), c80CCD1B: num(raw('c80CCD1B')), c80CCD2: num(raw('c80CCD2')), d80D_self: num(raw('d80Ds')), d80D_parents: num(raw('d80Dp')), d80G: num(raw('d80G')), others: num(raw('dOth')) },
      taxes: { tds: num(raw('tds')), tcs: num(raw('tcs')), advance: num(raw('adv')), selfAssessment: num(raw('sat')) } }; };
  const show = async () => {
    try {
      const r = await C('itrCompute', { fy, profile: collect() }); const n = r.regimes.new, o = r.regimes.old, b = r.result;
      const row = (l, k, f) => `<tr><td>${l}</td><td class="r">${n ? (f || inr)(n[k]) : '—'}</td><td class="r">${o ? (f || inr)(o[k]) : '—'}</td></tr>`;
      $('#itout', el).innerHTML = `${r.warnings.map(w => `<div class="alert red" style="cursor:default">⚠ ${esc(w)}</div>`).join('')}
      <div class="kpis"><div class="kpi"><div class="l">Business income (${esc(r.method === 'books' ? 'books' : r.method)})</div><div class="v">₹ ${inr(r.business.income, 0)}</div><div class="s">turnover ₹ ${inr(r.business.turnover, 0)}</div></div>
        <div class="kpi t"><div class="l">Total income (${r.choice} regime)</div><div class="v">₹ ${inr(b.taxable, 0)}</div><div class="s">Suggested form: ${esc(r.form)}</div></div>
        <div class="kpi o"><div class="l">Total tax</div><div class="v">₹ ${inr(b.total, 0)}</div><div class="s">paid ₹ ${inr(r.taxesPaid.total, 0)}</div></div>
        <div class="kpi ${b.balance > 0 ? 'r' : 'g'}"><div class="l">${b.balance > 0 ? 'Tax payable' : 'Refund'}</div><div class="v">₹ ${inr(Math.abs(b.balance), 0)}</div><div class="s">${b.balance > 0 ? 'pay before filing (challan 280)' : 'after filing'}</div></div></div>
      <div class="card"><h3 style="margin-top:0">Old vs new regime</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th class="r">New regime</th><th class="r">Old regime</th></tr></thead><tbody>
        ${row('Gross total income', 'gti')}${row('Deductions', 'dedTotal')}${row('Total income', 'taxable')}${row('Tax at slab rates', 'slabTax')}${row('Rebate u/s ' + esc(r.sections.rebate), 'rebate')}${row('Marginal relief (rebate)', 'marginal87A')}${row('Surcharge', 'surcharge')}${row('Cess 4%', 'cess')}${row('<b>Total tax</b>', 'total')}${row('Taxes paid', 'paid')}${row('<b>Payable (+) / refund (−)</b>', 'balance')}
      </tbody></table></div><div style="font-size:12px;color:var(--muted);margin-top:6px">${r.notes.map(x => '• ' + esc(x)).join('<br>')}</div></div>`;
    } catch (e) { fail(e); }
  };
  $('#itc', el).onclick = show; el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.ctrlKey) show(); });
  if ($('#its', el)) $('#its', el).onclick = async () => { try { await C('saveItrProfile', fy, collect()); toast('Income tax details saved', 'ok'); } catch (e) { fail(e); } };
  $('#itp', el).onclick = async () => { try { await C('saveItrProfile', fy, collect()).catch(() => {}); await api('doc.pdf', 'itr', 0, { args: { fy, profile: collect() } }); } catch (e) { fail(e); } };
  $('#itx', el).onclick = async () => { try { const s = await C('itrSheet', { fy, profile: collect() }); const r = await api('export.excelBook', s.sheets, s.name); if (r) toast('Excel saved: ' + (r.file || ''), 'ok'); } catch (e) { fail(e); } };
  $('#itfy', el).onchange = () => go('itr', { fy: $('#itfy', el).value }, true);
  show();
};

// ---------------- GSTR-2B import + ITC match ----------------
SCREENS.gstr2b = async (el, p) => {
  const list = await C('gstr2bList');
  const period = p.period || (list[0] && list[0].period);
  el.innerHTML = `<h2 class="title">GSTR-2B ITC Reconciliation <small>matches the 2B JSON from the GST portal with your purchase bills</small></h2>
    <div class="toolbar">${can('operator') ? '<button class="btn primary" id="g2i">⬆ Import GSTR-2B JSON</button>' : ''}<select id="g2p">${list.map(x => `<option value="${x.period}" ${x.period === period ? 'selected' : ''}>${x.period} · ${x.docs} docs · by ${esc(x.imported_by)}</option>`).join('')}</select>
    <span class="sp"></span><button class="btn" id="g2x" ${period ? '' : 'disabled'}>Excel</button><button class="btn" id="g2pdf" ${period ? '' : 'disabled'}>PDF</button>${can('admin') && period ? '<button class="btn danger" id="g2d">Remove this 2B</button>' : ''}</div>
    <div class="alert" style="cursor:default">How to get it: GST portal › Returns › Returns Dashboard › GSTR-2B › select month › <b>Download JSON</b> (inside the ZIP). Purchase bills are matched by supplier GSTIN + invoice number (the "Supplier Inv. No." field of your purchase voucher), then taxable value and tax (₹1 tolerance).</div><div id="g2out"></div>`;
  if ($('#g2i', el)) $('#g2i', el).onclick = async () => {
    const f = await pickFile('.json,.zip'); if (!f) return;
    if (/\.zip$/i.test(f.name)) { toast('Please unzip first and choose the .json file inside', 'err'); return; }
    try { const text = new TextDecoder('utf-8').decode(Uint8Array.from(atob(f.b64), ch => ch.charCodeAt(0))); const r = await C('gstr2bImport', { json: text, file_name: f.name }); if (r.warning) toast(r.warning, 'err');
      toast(`GSTR-2B ${r.period}: ${r.docs} documents from ${r.suppliers} suppliers · ITC IGST ₹${inr(r.itc.igst)} CGST ₹${inr(r.itc.cgst)} SGST ₹${inr(r.itc.sgst)}`, 'ok'); go('gstr2b', { period: r.period }, true); } catch (e) { fail(e); }
  };
  $('#g2p', el).onchange = () => go('gstr2b', { period: $('#g2p', el).value }, true);
  if (!period) { $('#g2out', el).innerHTML = '<div class="card" style="color:var(--muted)">No GSTR-2B imported yet.</div>'; return; }
  const rep = await C('gstr2bRecon', { period }); const s = rep.summary;
  rep.rows.forEach(r => { r._status = r.status; });
  $('#g2out', el).innerHTML = `<div class="kpis"><div class="kpi g"><div class="l">Matched</div><div class="v">${s.matched}</div></div><div class="kpi r"><div class="l">Mismatch</div><div class="v">${s.mismatch}</div></div>
    <div class="kpi o"><div class="l">In 2B, missing in books</div><div class="v">${s.missingBooks}</div><div class="s">tax ₹ ${inr(s.taxMissingBooks, 0)} — enter these bills</div></div><div class="kpi r"><div class="l">In books, missing in 2B</div><div class="v">${s.missing2b}</div><div class="s">ITC at risk ₹ ${inr(s.taxMissing2b, 0)}</div></div>
    <div class="kpi t"><div class="l">ITC as per 2B vs books</div><div class="v">₹ ${inr(s.itc2b, 0)}</div><div class="s">books ₹ ${inr(s.itcBooks, 0)} · diff ₹ ${inr(s.diff, 0)}</div></div></div><div class="card">${repTable(rep)}</div>`;
  $$('#rtbl tbody tr', el).forEach(tr => { const r = rep.rows[+tr.dataset.i]; if (r) tr.firstElementChild.innerHTML = pill(r.status); });
  drillRows(el, rep);
  $('#g2x', el).onclick = () => api('export.excel', rep, rep.title).then(r => r && toast('Excel saved', 'ok')).catch(fail);
  $('#g2pdf', el).onclick = () => api('doc.pdf', 'report', 0, { report: rep, landscape: true }).catch(fail);
  if ($('#g2d', el)) $('#g2d', el).onclick = async () => { if (await confirmBox('Remove the imported GSTR-2B for ' + period + '? (Your purchase bills are not touched.)', 'Remove', true)) { await C('gstr2bDelete', period); go('gstr2b', {}, true); } };
};

// ---------------- Bank statement import + auto-match ----------------
SCREENS.bankImport = async (el, p) => {
  const c = await loadCache(true);
  const banks = c.ledgers.filter(l => underGroups(l, ['Bank Accounts', 'Bank OD A/c']));
  if (!banks.length) { el.innerHTML = '<h2 class="title">Bank Statement Import</h2><div class="card">Create your bank ledger first (Masters › Ledgers, group "Bank Accounts").</div>'; return; }
  const lid = +(p.ledger_id || banks[0].id); const status = p.status || 'unmatched';
  const rep = await C('bankLines', { ledger_id: lid, status });
  el.innerHTML = `<h2 class="title">Bank Statement Import <small>Excel / CSV from net banking → auto-match with your entries (BRS)</small></h2>
    <div class="toolbar"><select id="bkl">${banks.map(b => `<option value="${b.id}" ${b.id === lid ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
    <select id="bks">${[['unmatched', 'Not in books yet'], ['matched', 'Matched'], ['all', 'All lines']].map(([k, l]) => `<option value="${k}" ${k === status ? 'selected' : ''}>${l}</option>`).join('')}</select>
    ${can('operator') ? '<button class="btn primary" id="bki">⬆ Import statement</button><button class="btn" id="bkm">Auto-match again</button>' : ''}<span class="sp"></span><button class="btn" id="bkr">BRS report</button></div>
    <div class="alert" style="cursor:default">Matching: same amount, entry date up to 7 days before / 3 days after the bank date; a cheque / reference number in the narration decides ties. Matched entries get their bank date filled in, so the BRS updates itself. For lines not in the books, pick the party and click <b>Create</b> to post a Receipt / Payment.</div>
    <div class="card"><b>${esc(rep.subtitle)}</b>${repTable(rep)}</div>`;
  const tb = $$('#rtbl tbody tr', el);
  tb.forEach(tr => { const r = rep.rows[+tr.dataset.i]; if (!r) return; const tds = tr.children; tds[5].innerHTML = pill(r.status);
    if (r.status === 'unmatched' && can('operator')) { tds[7].innerHTML = `<input class="bkp" data-id="${r.id}" style="width:160px" placeholder="Party / expense…"> <button class="btn sm primary" data-cv="${r.id}">Create</button>`; const inp = tds[7].querySelector('input'); combo(inp, { source: ledgerSource(l => l.id !== lid) }); if (r.suggest_id) { inp.value = r.suggest; inp.dataset.id = r.suggest_id; } }
    if (r.status === 'matched' && can('operator')) tds[7].innerHTML = `<button class="btn sm" data-um="${r.id}">Un-match</button>`; });
  drillRows(el, rep);
  $$('[data-cv]', el).forEach(b => b.onclick = async (e) => { e.stopPropagation(); const inp = b.previousElementSibling; if (!inp.dataset.id) { toast('Pick the party / expense ledger first', 'err'); return; } await withBusy(b, async () => { const s = await C('bankCreateVoucher', +b.dataset.cv, { ledger_id: +inp.dataset.id }); toast(`${s.number} posted and matched`, 'ok'); render(); }); });
  $$('[data-um]', el).forEach(b => b.onclick = async (e) => { e.stopPropagation(); await C('bankUnmatch', +b.dataset.um); render(); });
  $('#bkl', el).onchange = () => go('bankImport', { ledger_id: +$('#bkl', el).value, status }, true);
  $('#bks', el).onchange = () => go('bankImport', { ledger_id: lid, status: $('#bks', el).value }, true);
  $('#bkr', el).onclick = () => go('report', { r: 'brs', a: { ledger_id: lid } });
  if ($('#bki', el)) $('#bki', el).onclick = async () => { const f = await pickFile('.xlsx,.xls,.csv'); if (!f) return; try { const rows = await api('file.rows', { name: f.name, b64: f.b64 }); const r = await C('bankImport', { ledger_id: lid, rows, file_name: f.name }); toast(`${r.added} new lines (${r.duplicates} already imported) · ${r.matched} auto-matched · ${U.fmtDate(r.from)} to ${U.fmtDate(r.to)}`, 'ok'); render(); } catch (e) { fail(e); } };
  if ($('#bkm', el)) $('#bkm', el).onclick = async () => { try { const n = await C('bankRematch', lid); toast(n + ' more lines matched', n ? 'ok' : ''); render(); } catch (e) { fail(e); } };
};

// ---------------- Recurring vouchers ----------------
async function recurringDialog(rec, voucherId) {
  const F = [{ k: 'name', label: 'Name', req: true, w: 2, ph: 'Shop rent / Internet bill / Salary advance' }, { k: 'frequency', label: 'Repeat', type: 'select', options: [['monthly', 'Every month'], ['quarterly', 'Every quarter'], ['yearly', 'Every year'], ['weekly', 'Every week']] },
    { k: 'day', label: 'On day of month', type: 'number' }, { k: 'start_date', label: 'First date', type: 'date', req: true }, { k: 'end_date', label: 'Stop after (optional)', type: 'date' },
    { k: 'auto_post', label: 'Post automatically when due (otherwise the dashboard asks)', type: 'check', w: 2 }, { k: 'active', label: 'Active', type: 'check', def: 1 }];
  const v = await promptBox(rec ? 'Recurring: ' + rec.name : 'Make this voucher recurring', F, rec || { frequency: 'monthly', day: +APP.date.slice(8, 10), start_date: U.addDays(APP.date, 1), active: 1 });
  if (!v) return false;
  try { await C('saveRecurring', Object.assign(v, { id: rec && rec.id, voucher_id: voucherId })); toast('Recurring entry saved', 'ok'); return true; } catch (e) { fail(e); return false; }
}
SCREENS.recurring = async (el) => {
  const rows = await C('recurringList'); const due = await C('recurringDue');
  listScreen(el, { title: 'Recurring Vouchers', rows, onOpen: async r => { if (can('operator') && await recurringDialog(r)) render(); },
    extra: `${can('operator') && due.length ? `<button class="btn primary" id="rcp">Post ${due.length} due now</button>` : ''}<span style="font-size:12px;color:var(--muted)">To add: open any voucher › "Make recurring"</span>`,
    cols: [{ k: 'name', label: 'Name' }, { k: 'vtype_name', label: 'Voucher' }, { k: 'party', label: 'Party / ledgers' }, { k: 'amount', label: 'Amount', f: r => r.amount ? inr(r.amount) : '' }, { k: 'frequency', label: 'Repeat', f: r => esc(r.frequency) + (r.frequency !== 'weekly' ? ' on ' + r.day : '') },
      { k: 'next_date', label: 'Next', f: r => r.next_date ? U.fmtDate(r.next_date) : '' }, { k: 'auto_post', label: 'Mode', f: r => r.auto_post ? 'Auto' : 'Ask' }, { k: 'active', label: 'Status', f: r => r.active ? (r.end_date && r.next_date > r.end_date ? '<span class="pill grey">Ended</span>' : '<span class="pill green">Active</span>') : '<span class="pill grey">Paused</span>' }] });
  if ($('#rcp', el)) $('#rcp', el).onclick = async () => { try { const r = await C('runRecurring', {}); toast(`${r.posted.length} vouchers posted${r.errors.length ? ' · ' + r.errors[0] : ''}`, r.errors.length ? 'err' : 'ok'); render(); } catch (e) { fail(e); } };
};

// ---------------- Due dates ----------------
SCREENS.dueDates = async (el) => {
  const ev = await C('dueDates', { days: 90, back: 10 }); const s = APP.settings;
  el.innerHTML = `<h2 class="title">Due Dates <small>next 90 days · ${s.gst_filing === 'qrmp' ? 'GST quarterly (QRMP)' : s.gst_filing === 'composition' ? 'GST composition' : 'GST monthly'} — change in Company Settings</small></h2>
    <div class="alert" style="cursor:default">Standard due dates from the GST and Income-tax rules. When the government extends a date, the portal date wins.</div>
    <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>In</th><th>What</th><th>For</th></tr></thead><tbody>${ev.map(e => `<tr class="${e.days < 0 ? 'warn' : ''}"><td>${U.fmtDate(e.date)}</td><td>${e.days < 0 ? `<span class="pill red">${-e.days} days ago</span>` : e.days === 0 ? '<span class="pill red">Today</span>' : e.days <= 5 ? `<span class="pill orange">${e.days} days</span>` : e.days + ' days'}</td><td><b>${esc(e.title)}</b></td><td>${esc(e.detail)}</td></tr>`).join('') || '<tr><td colspan="4">Nothing due.</td></tr>'}</tbody></table></div></div>`;
};
