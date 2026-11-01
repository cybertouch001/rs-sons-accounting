
// R&S Sons Accounting - screens: dashboard, menus, masters
'use strict';
function menuGrid(items) { return `<div class="menu-grid">${items.map(([l, d, s, p]) => `<div class="mi" tabindex="0" data-s="${s}" data-p='${esc(JSON.stringify(p || {}))}'><b>${esc(l)}</b><span>${esc(d)}</span></div>`).join('')}</div>`; }
function bindMenu(el) { $$('.mi', el).forEach(m => { const f = () => go(m.dataset.s, JSON.parse(m.dataset.p)); m.onclick = f; m.onkeydown = e => { if (e.key === 'Enter') f(); }; }); const f = $('.mi', el); if (f) f.focus(); }
function barChart(data, keys, colors = ['#1d5fa8', '#e0a526', '#0f8b8d']) {
  if (!data.length) return '<div style="color:var(--muted);padding:30px;text-align:center">No data yet</div>';
  const W = 640, H = 210, pad = 46, max = Math.max(1, ...data.flatMap(d => keys.map(k => Math.abs(d[k] || 0))));
  const bw = (W - pad - 10) / data.length; const bar = Math.max(3, (bw - 6) / keys.length);
  let s = `<svg viewBox="0 0 ${W} ${H + 24}" class="chart">`;
  for (let i = 0; i <= 4; i++) { const y = 8 + (H - 8) * i / 4; const v = max * (1 - i / 4); s += `<line x1="${pad}" x2="${W}" y1="${y}" y2="${y}" stroke="#e6ebf1"/><text x="${pad - 4}" y="${y + 3}" font-size="9" text-anchor="end" fill="#789">${v >= 1e5 ? (v / 1e5).toFixed(1) + 'L' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'k' : v.toFixed(0)}</text>`; }
  data.forEach((d, i) => { keys.forEach((k, j) => { const v = Math.max(0, d[k] || 0); const h = (H - 8) * v / max; s += `<rect x="${pad + i * bw + 3 + j * bar}" y="${H - h}" width="${bar - 1}" height="${h}" fill="${colors[j]}" rx="2"><title>${esc(d.label)}: ₹${inr(v)}</title></rect>`; });
    s += `<text x="${pad + i * bw + bw / 2}" y="${H + 13}" font-size="9" text-anchor="middle" fill="#567">${esc(String(d.label).slice(0, 12))}</text>`; });
  return s + '</svg>' + `<div style="display:flex;gap:14px;font-size:11.5px;justify-content:center">${keys.map((k, j) => `<span><span style="display:inline-block;width:10px;height:10px;background:${colors[j]};border-radius:2px"></span> ${esc(k)}</span>`).join('')}</div>`;
}

SCREENS.dashboard = async (el) => {
  const d = await C('dashboard', fyRange());
  const s = APP.settings;
  const alerts = [];
  if (d.overdue) alerts.push(`<div class="alert red" data-go="report" data-p='${JSON.stringify({ r: 'outstanding', a: { kind: 'receivable', detail: true } })}'>⚠ ${d.overdue} customer bill${d.overdue > 1 ? 's' : ''} overdue — ₹${inr(d.overdueAmt, 0)} to collect${d.unadjustedCredits > 0.005 ? ` <small>(after ₹${inr(d.unadjustedCredits, 0)} on-account receipts)</small>` : ''}</div>`);
  if (d.reorder) alerts.push(`<div class="alert" data-go="report" data-p='${JSON.stringify({ r: 'reorderReport' })}'>📦 ${d.reorder} items below minimum stock — reorder needed</div>`);
  if (d.expiring) alerts.push(`<div class="alert" data-go="report" data-p='${JSON.stringify({ r: 'batchStock' })}'>⏳ ${d.expiring} batches expired or expiring within 90 days</div>`);
  if (!s.gstin && s.gst_registered !== '0') alerts.push(`<div class="alert" data-go="companyEdit" data-p='{}'>ℹ Add your company GSTIN in Company Settings to print proper tax invoices</div>`);
  for (const r of d.reminders) alerts.push(`<div class="alert green" data-go="reminders" data-p='{}'>🔔 ${esc(r.title)}${r.due_date ? ' — due ' + U.fmtDate(r.due_date) : ''}</div>`);
  try { const rd = await C('recurringDue'); if (rd.length) alerts.push(`<div class="alert" data-go="recurring" data-p='{}'>🔁 ${rd.length} recurring voucher${rd.length > 1 ? 's are' : ' is'} due (${esc(rd[0].name)}${rd.length > 1 ? '…' : ''}) — click to post</div>`); } catch (_) {}
  try { const dd = (await C('dueDates', { days: 10, back: 0 })).slice(0, 4); for (const e of dd) alerts.push(`<div class="alert ${e.days <= 3 ? 'red' : ''}" data-go="dueDates" data-p='{}'>📅 ${esc(e.title)} — ${e.days === 0 ? 'due today' : 'due ' + U.fmtDate(e.date) + ' (' + e.days + ' days)'} · ${esc(e.detail)}</div>`); } catch (_) {}
  if (!d.counts.vouchers) alerts.push(`<div class="alert green" data-go="help" data-p='{}'>👋 Welcome! Start with <b>Masters › Ledgers</b> (customers, suppliers, bank) and <b>Stock Items</b>, then press <b>F8</b> for a Sales Invoice. Press <b>Ctrl+H</b> for all shortcuts.</div>`);
  el.innerHTML = `<h2 class="title">Dashboard <small>${U.fmtDate(d.from)} to ${U.fmtDate(d.asOn)}</small><span style="flex:1"></span><button class="btn primary" id="qs">+ Sales Invoice <kbd>F8</kbd></button><button class="btn" id="qp">+ Purchase <kbd>F9</kbd></button><button class="btn" id="qr">+ Receipt <kbd>F6</kbd></button><button class="btn" id="qpay">+ Payment <kbd>F5</kbd></button></h2>
  <div class="kpis">
    <div class="kpi" data-go="report" data-p='${JSON.stringify({ r: 'register', a: { vtype: 'SAL' } })}'><div class="l">Sales (net, this FY)</div><div class="v">₹ ${inr(d.sales, 0)}</div><div class="s">Today ₹ ${inr(d.todaySales)}</div></div>
    <div class="kpi o" data-go="report" data-p='${JSON.stringify({ r: 'register', a: { vtype: 'PUR' } })}'><div class="l">Purchases (net)</div><div class="v">₹ ${inr(d.purchases, 0)}</div><div class="s">Gross profit ₹ ${inr(d.grossProfit, 0)}</div></div>
    <div class="kpi g" data-go="report" data-p='${JSON.stringify({ r: 'cashBook' })}'><div class="l">Cash + Bank</div><div class="v">₹ ${inr(d.cash + d.bankTotal, 0)}</div><div class="s">Cash ₹ ${inr(d.cash, 0)} · Bank ₹ ${inr(d.bankTotal, 0)}</div></div>
    <div class="kpi t" data-go="report" data-p='${JSON.stringify({ r: 'profitLoss', a: { from: d.from, to: d.asOn } })}'><div class="l">Net Profit (FY to date)</div><div class="v ${d.netProfit < 0 ? 'neg' : ''}">₹ ${inr(d.netProfit, 0)}</div><div class="s">Closing stock ₹ ${inr(d.closingStock, 0)}</div></div>
    <div class="kpi" data-go="report" data-p='${JSON.stringify({ r: 'outstanding', a: { kind: 'receivable' } })}'><div class="l">Receivables</div><div class="v">₹ ${inr(d.receivables, 0)}</div><div class="s">${d.overdue} bills overdue</div></div>
    <div class="kpi r" data-go="report" data-p='${JSON.stringify({ r: 'outstanding', a: { kind: 'payable' } })}'><div class="l">Payables</div><div class="v">₹ ${inr(d.payables, 0)}</div><div class="s">to suppliers</div></div>
    <div class="kpi o" data-go="report" data-p='${JSON.stringify({ r: 'gstr3b' })}'><div class="l">GST (Output − Input)</div><div class="v">₹ ${inr(d.gstNet, 0)}</div><div class="s">Out ₹ ${inr(d.gstOut, 0)} · In ₹ ${inr(d.gstIn, 0)}</div></div>
    <div class="kpi t" data-go="voucherList" data-p='{}'><div class="l">Records</div><div class="v">${d.counts.vouchers}</div><div class="s">${d.counts.ledgers} ledgers · ${d.counts.items} items</div></div>
  </div>
  ${alerts.length ? `<div class="card">${alerts.join('')}</div>` : ''}
  <div class="dgrid"><div class="card"><h3>Monthly Sales vs Purchase</h3>${barChart(d.monthly.map(m => ({ label: m.month, Sales: m.sales, Purchase: m.purchase })), ['Sales', 'Purchase'])}</div>
    <div class="card"><h3>Recent Vouchers</h3><table class="mini">${d.recent.map(v => `<tr data-v="${v.id}"><td>${U.fmtDate(v.date)}</td><td>${esc(v.vtype_name)} ${esc(v.number)}<div style="font-size:11px;color:var(--muted)">${esc(v.party || '')}</div></td><td class="r">${inr(v.total)}</td></tr>`).join('') || '<tr><td>No vouchers yet</td></tr>'}</table></div></div>
  <div class="dgrid3"><div class="card"><h3>Top Items (sales value)</h3><table class="mini">${d.topItems.map(i => `<tr><td>${esc(i.name)}</td><td class="r">${U.r3(i.qty)}</td><td class="r">₹ ${inr(i.value, 0)}</td></tr>`).join('') || '<tr><td>—</td></tr>'}</table></div>
    <div class="card"><h3>Top Customers</h3><table class="mini">${d.topParties.map(i => `<tr><td>${esc(i.name)}</td><td class="r">₹ ${inr(i.value, 0)}</td></tr>`).join('') || '<tr><td>—</td></tr>'}</table></div>
    <div class="card"><h3>Bank Balances</h3><table class="mini">${d.banks.map(b => `<tr><td>${esc(b.name)}</td><td class="r">${U.drcr(b.bal)}</td></tr>`).join('') || '<tr><td>No bank ledger yet</td></tr>'}<tr><td>Cash-in-hand</td><td class="r">${U.drcr(d.cash)}</td></tr></table></div></div>`;
  $$('[data-go]', el).forEach(k => k.onclick = () => go(k.dataset.go, JSON.parse(k.dataset.p || '{}')));
  $$('tr[data-v]', el).forEach(r => r.onclick = () => go('voucher', { id: +r.dataset.v }));
  $('#qs').onclick = () => go('voucher', { vtype: 'SAL' }); $('#qp').onclick = () => go('voucher', { vtype: 'PUR' }); $('#qr').onclick = () => go('voucher', { vtype: 'RCT' }); $('#qpay').onclick = () => go('voucher', { vtype: 'PMT' });
};

SCREENS.orderMenu = (el) => { el.innerHTML = `<h2 class="title">Orders, Quotations & Challans</h2>` + menuGrid([['Sales Quotation', 'Quote prices to a customer · convert to invoice later', 'voucher', { vtype: 'QTN' }], ['Sales Order', 'Customer order · convert to invoice', 'voucher', { vtype: 'SOR' }], ['Proforma Invoice', 'Advance bill for payment, no accounting effect', 'voucher', { vtype: 'PFI' }], ['Delivery Challan', 'Goods sent without invoice · convert later', 'voucher', { vtype: 'DCH' }],
  ['Purchase Order', 'Order to supplier · convert to purchase', 'voucher', { vtype: 'POR' }], ['Goods Receipt Note', 'Goods received before bill', 'voucher', { vtype: 'GRN' }], ['Pending Sales Orders', 'Orders not yet invoiced', 'pendingOrders', { vtype: 'SOR' }], ['Pending Purchase Orders', 'POs not yet billed', 'pendingOrders', { vtype: 'POR' }],
  ['Pending Challans', 'Challans not yet invoiced', 'pendingOrders', { vtype: 'DCH' }], ['Pending Quotations', 'Quotations not converted', 'pendingOrders', { vtype: 'QTN' }]]); bindMenu(el); };
SCREENS.stockMenu = (el) => { el.innerHTML = `<h2 class="title">Inventory Vouchers</h2>` + menuGrid([['Stock Journal / Transfer', 'Move stock between godowns, write off breakage, adjust stock', 'voucher', { vtype: 'STJ' }], ['Production (BOM)', 'Consume raw materials and produce finished goods', 'voucher', { vtype: 'PRD' }], ['Physical Stock Verification', 'Enter counted stock, post the difference', 'physicalStock', {}], ['Bill of Materials', 'Define recipes / BOM', 'simpleList', { t: 'boms' }],
  ['Stock Summary', 'Quantity and value of all items', 'report', { r: 'stockSummary' }], ['Godown-wise Stock', 'Stock per location', 'report', { r: 'godownStock' }], ['Batch & Expiry', 'Batch-wise stock and expiry alerts', 'report', { r: 'batchStock' }], ['Barcode Labels', 'Print barcode / MRP labels', 'labels', {}]]); bindMenu(el); };
SCREENS.mastersMenu = (el) => { el.innerHTML = `<h2 class="title">Masters</h2>` + menuGrid([['Ledgers / Parties', 'Customers, suppliers, bank, expenses', 'ledgerList', {}], ['Account Groups', 'Chart of accounts', 'groupList', {}], ['Stock Items', 'Products & services with HSN/GST', 'itemList', {}], ['Item Groups', 'Categories of items', 'simpleList', { t: 'item_groups' }],
  ['Units of Measure', 'Nos, Kg, Ltr… with GST UQC', 'simpleList', { t: 'units' }], ['Godowns / Locations', 'Warehouses and shops', 'simpleList', { t: 'godowns' }], ['Price Lists', 'Customer-wise / rate-wise pricing', 'simpleList', { t: 'price_lists' }], ['Cost Centres', 'Departments / projects', 'simpleList', { t: 'cost_centres' }],
  ['Salesmen / Agents', 'Commission %', 'simpleList', { t: 'salesmen' }], ['Bill of Materials', 'Recipes for production', 'simpleList', { t: 'boms' }], ['Budgets', 'Ledger-wise yearly budgets', 'budgets', {}], ['Import / Export Masters', 'Bulk create from Excel', 'importExport', {}]]); bindMenu(el); };
SCREENS.gstMenu = (el) => { el.innerHTML = `<h2 class="title">GST & Taxation</h2>` + menuGrid([['GSTR-1', 'Outward supplies: B2B, B2CL, B2CS, CDNR, HSN, docs · JSON & Excel', 'report', { r: 'gstr1' }], ['GSTR-3B', 'Monthly summary return with ITC set-off', 'report', { r: 'gstr3b' }], ['GST Ledger Summary', 'Output vs input tax ledgers', 'report', { r: 'gstSummary' }], ['GST Sales Register', 'Invoice-wise tax details', 'report', { r: 'register', a: { vtype: 'SAL' } }],
  ['GST Purchase Register', 'Bill-wise input tax', 'report', { r: 'register', a: { vtype: 'PUR' } }], ['Credit Note Register', 'Sales returns', 'report', { r: 'register', a: { vtype: 'CRN' } }], ['Debit Note Register', 'Purchase returns', 'report', { r: 'register', a: { vtype: 'DBN' } }], ['HSN-wise Summary', 'Table 12 of GSTR-1', 'report', { r: 'gstr1', a: { section: 'hsn' } }],
  ['GSTR-2B ITC Match', 'Import 2B JSON → matched / missing / mismatch with purchase bills', 'gstr2b', {}], ['Income Tax Computation (ITR)', 'From P&L: 44AD/44ADA, old vs new regime, TDS, PDF + filing sheet', 'itr', {}], ['Due Dates', 'GSTR-1, 3B, TDS, advance tax, ITR reminders', 'dueDates', {}],
  ['TDS Register', 'TDS deducted and deposited, section-wise', 'report', { r: 'tdsReport', a: { kind: 'TDS' } }], ['TCS Register', 'TCS collected', 'report', { r: 'tdsReport', a: { kind: 'TCS' } }], ['e-Invoice / e-Way Bill JSON', 'Open a sales invoice → e-Invoice JSON / e-Way JSON buttons', 'voucherList', { vtype: 'SAL' }], ['Duties & Taxes Ledgers', 'GST/TDS ledgers', 'ledgerList', { group: 'Duties & Taxes' }]]); bindMenu(el); };
SCREENS.bankingMenu = (el) => { el.innerHTML = `<h2 class="title">Banking</h2>` + menuGrid([['Bank Statement Import', 'Excel/CSV from net banking, auto-match, create missing entries', 'bankImport', {}], ['Bank Reconciliation (BRS)', 'Tick bank dates, balance as per bank', 'report', { r: 'brs' }], ['Bank Book', 'Bank ledger with running balance', 'report', { r: 'bankBook' }], ['Cash Book', 'Cash ledger', 'report', { r: 'cashBook' }], ['Cheque Printing', 'Open a Payment voucher → Print Cheque', 'voucherList', { vtype: 'PMT' }],
  ['Payment Reminder Letters', 'Print reminder for overdue customers', 'reminderLetters', {}], ['Interest on Overdue', 'Interest calculation on late payments', 'report', { r: 'interestReport' }], ['Cash Flow', 'Inflow and outflow by group', 'report', { r: 'cashFlow' }], ['Receivables Ageing', 'Who owes you, how old', 'report', { r: 'outstanding', a: { kind: 'receivable' } }]]); bindMenu(el); };
SCREENS.reportsMenu = (el) => {
  const R = (l, d, r, a) => [l, d, 'report', { r, a }];
  el.innerHTML = `<h2 class="title">All Reports <small>Every report: drill-down (Enter/click), search, Excel, PDF, Print</small></h2>
  <h3>Accounts</h3>` + menuGrid([R('Day Book', 'All vouchers of a period', 'dayBook'), ['Ledger Statement', 'Account-wise with running balance', 'ledgerPick', {}], R('Trial Balance', 'Group-wise / ledger-wise', 'trialBalance'), R('Profit & Loss A/c', 'Trading + P&L', 'profitLoss'), R('Balance Sheet', 'As on date', 'balanceSheet'), R('Cash Book', '', 'cashBook'), R('Bank Book', '', 'bankBook'), R('Cash Flow', '', 'cashFlow'), R('Ratio Analysis', 'Liquidity & profitability ratios', 'ratios'), R('Monthly Summary', 'Month-wise business', 'monthlySummary'), R('Budget vs Actual', '', 'budgetReport'), R('Cost Centre Report', '', 'costCentreReport')]) +
  `<h3 style="margin-top:14px">Registers</h3>` + menuGrid(['SAL', 'PUR', 'CRN', 'DBN', 'RCT', 'PMT', 'CNT', 'JRN', 'SOR', 'POR', 'QTN', 'DCH'].map(t => R(vtName(t) + ' Register', '', 'register', { vtype: t }))) +
  `<h3 style="margin-top:14px">Outstanding & Analysis</h3>` + menuGrid([R('Receivables Ageing', '', 'outstanding', { kind: 'receivable' }), R('Payables Ageing', '', 'outstanding', { kind: 'payable' }), R('Bill-wise Receivables', '', 'outstanding', { kind: 'receivable', detail: true }), R('Bill-wise Payables', '', 'outstanding', { kind: 'payable', detail: true }), R('Party-wise Sales', '', 'partyAnalysis', { side: 'sale' }), R('Party-wise Purchase', '', 'partyAnalysis', { side: 'purchase' }), R('Item-wise Sales & Profit', '', 'itemAnalysis', { side: 'sale' }), R('Item-wise Purchase', '', 'itemAnalysis', { side: 'purchase' }), R('Salesman Commission', '', 'salesmanReport'), R('Interest on Overdue', '', 'interestReport')]) +
  `<h3 style="margin-top:14px">Inventory</h3>` + menuGrid([R('Stock Summary', '', 'stockSummary'), ['Stock Item Ledger', 'Movement of one item', 'itemPick', {}], R('Godown-wise Stock', '', 'godownStock'), R('Batch & Expiry', '', 'batchStock'), R('Reorder Levels', '', 'reorderReport'), R('Slow / Dead Stock', '', 'slowMoving')]) +
  `<h3 style="margin-top:14px">Tax, Payroll & Control</h3>` + menuGrid([R('GSTR-1', '', 'gstr1'), R('GSTR-3B', '', 'gstr3b'), R('GST Ledger Summary', '', 'gstSummary'), R('TDS Register', '', 'tdsReport', { kind: 'TDS' }), R('Salary Register', '', 'salaryRegister'), R('Depreciation Chart', '', 'depreciationChart'), R('Audit Trail', 'Who changed what', 'auditLog')]);
  bindMenu(el);
};

// ---------- generic list ----------
function listScreen(el, { title, rows, cols, onOpen, onNew, extra = '', searchKeys }) {
  el.innerHTML = `<h2 class="title">${esc(title)} <small>${rows.length} records</small></h2><div class="toolbar"><input id="ls" placeholder="Search…" style="width:280px">${onNew ? '<button class="btn primary" id="lnew">+ New <kbd>Alt+C</kbd></button>' : ''}${extra}<span class="sp"></span><span style="color:var(--muted);font-size:12px">Enter = open · Esc = back</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr>${cols.map(c => `<th class="${c.r ? 'r' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody id="lb"></tbody></table></div>`;
  let cur = 0, shown = rows;
  const draw = () => { $('#lb').innerHTML = shown.map((r, i) => `<tr class="drill ${i === cur ? 'cur' : ''}" data-i="${i}">${cols.map(c => `<td class="${c.r ? 'r' : ''}">${c.f ? c.f(r) : esc(r[c.k] == null ? '' : r[c.k])}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" style="color:var(--muted);padding:16px">Nothing here yet${onNew ? ' — press Alt+C or “+ New”' : ''}</td></tr>`;
    $$('#lb tr[data-i]').forEach(t => t.onclick = () => onOpen(shown[+t.dataset.i])); };
  $('#ls').oninput = () => { const q = $('#ls').value.toLowerCase(); shown = rows.filter(r => (searchKeys || cols.map(c => c.k)).some(k => String(r[k] == null ? '' : r[k]).toLowerCase().includes(q))); cur = 0; draw(); };
  $('#ls').onkeydown = e => { if (e.key === 'ArrowDown') { cur = Math.min(shown.length - 1, cur + 1); draw(); e.preventDefault(); $('#lb tr.cur') && $('#lb tr.cur').scrollIntoView({ block: 'nearest' }); } else if (e.key === 'ArrowUp') { cur = Math.max(0, cur - 1); draw(); e.preventDefault(); $('#lb tr.cur') && $('#lb tr.cur').scrollIntoView({ block: 'nearest' }); } else if (e.key === 'Enter' && shown[cur]) onOpen(shown[cur]); };
  if (onNew) $('#lnew').onclick = onNew;
  APP.current.keys = e => { if (e.altKey && e.key.toLowerCase() === 'c' && onNew) { onNew(); return true; } };
  draw(); $('#ls').focus();
}

// ---------- ledgers ----------
SCREENS.ledgerList = async (el, p) => {
  const c = await loadCache(true);
  let rows = c.ledgers; if (p.group) { const set = groupNamesUnder(p.group); rows = rows.filter(l => set.has(l.group_name)); }
  const bal = {}; // lazy balances not computed here to stay fast
  listScreen(el, { title: 'Ledgers' + (p.group ? ' — ' + p.group : ''), rows, onNew: () => go('ledgerEdit', { group: p.group }), onOpen: r => go('ledgerEdit', { id: r.id }),
    cols: [{ k: 'name', label: 'Name' }, { k: 'group_name', label: 'Group' }, { k: 'gstin', label: 'GSTIN' }, { k: 'phone', label: 'Phone' }, { k: 'city', label: 'City' }, { k: 'opening', label: 'Opening Bal.', r: 1, f: r => r.opening ? U.drcr(r.opening) : '' }],
    searchKeys: ['name', 'group_name', 'gstin', 'phone', 'city', 'alias'], extra: '<button class="btn" id="lstmt">Statement of selected…</button>' });
  void bal; $('#lstmt').onclick = () => go('ledgerPick');
};
function ledgerFields(isParty, groupOpts) {
  return [
    { section: 'Basic' }, { k: 'name', label: 'Ledger Name', req: true, w: 2 }, { k: 'alias', label: 'Alias / Short name' }, { k: 'group_id', label: 'Under Group', type: 'select', options: groupOpts, req: true },
    { k: 'opening', label: 'Opening Balance (₹)', type: 'number', help: 'As on books beginning' }, { k: 'opening_side', label: 'Dr / Cr', type: 'select', options: [['Dr', 'Dr (asset / receivable)'], ['Cr', 'Cr (liability / payable)']] },
    { k: 'bill_wise', label: 'Maintain bill-by-bill (outstanding)', type: 'check', w: 2 },
    { section: 'GST & Contact' }, { k: 'gstin', label: 'GSTIN', upper: true, help: 'State & PAN auto-filled' }, { k: 'gst_reg_type', label: 'Registration Type', type: 'select', options: ['Regular', 'Composition', 'Unregistered', 'Consumer', 'SEZ', 'Overseas'] },
    { k: 'state_code', label: 'State (Place of Supply)', type: 'select', options: [['', '— same as company —'], ...U.STATES.map(s => [s[0], s[0] + ' - ' + s[1]])] }, { k: 'pan', label: 'PAN', upper: true },
    { k: 'address', label: 'Address', w: 2 }, { k: 'city', label: 'City' }, { k: 'pincode', label: 'PIN' }, { k: 'phone', label: 'Mobile / Phone' }, { k: 'email', label: 'Email' }, { k: 'contact_person', label: 'Contact Person' }, { k: 'msme', label: 'MSME Type', type: 'select', options: ['', 'Micro', 'Small', 'Medium'] },
    { k: 'udyam', label: 'UDYAM No.', upper: true },
    { section: 'Credit & Other' }, { k: 'credit_days', label: 'Credit Days', type: 'number' }, { k: 'credit_limit', label: 'Credit Limit (₹)', type: 'number' }, { k: 'interest_rate', label: 'Interest % p.a. on overdue', type: 'number' },
    { k: 'price_list_id', label: 'Price List', type: 'select', options: [['', '— none —'], ...(APP.cache.priceLists || []).map(x => [x.id, x.name])] },
    { k: 'bank_name', label: 'Bank Name' }, { k: 'bank_acc', label: 'Bank A/c No.' }, { k: 'ifsc', label: 'IFSC', upper: true }, { k: 'dep_rate', label: 'Depreciation % (fixed assets)', type: 'number' },
    { k: 'tds_section', label: 'TDS/TCS Section (tax ledgers)' }, { k: 'tax_rate', label: 'TDS/TCS Rate %', type: 'number' }, { k: 'notes', label: 'Notes', w: 2 },
  ];
}
SCREENS.ledgerEdit = async (el, p) => {
  const c = await loadCache(); const l = p.id ? await C('ledger', p.id) : { group_id: p.group ? (c.groups.find(g => g.name === p.group) || {}).id : (c.groups.find(g => g.name === 'Sundry Debtors') || {}).id, bill_wise: 1 };
  const groupOpts = c.groups.map(g => [g.id, g.name + (g.parent ? '  (' + g.parent + ')' : '')]);
  const vals = Object.assign({}, l, { opening: Math.abs(l.opening || 0), opening_side: (l.opening || 0) < 0 ? 'Cr' : 'Dr' });
  const fields = ledgerFields(true, groupOpts);
  el.innerHTML = `<h2 class="title">${p.id ? 'Alter Ledger' : 'Create Ledger'} ${l.is_system ? '<span class="pill grey">pre-defined</span>' : ''}</h2><div class="card"><div class="form">${formHtml(fields, vals)}</div></div>
   <div class="actions">${p.id ? `<button class="btn" id="lst">Statement</button>${can('admin') ? '<button class="btn danger" id="ldel">Delete</button>' : ''}${l.bill_wise ? '<button class="btn" id="lrem">Payment Reminder</button>' : ''}` : ''}<span style="flex:1"></span><button class="btn" id="lcancel">Cancel (Esc)</button><button class="btn primary" id="lsave">Save <kbd>Ctrl+S</kbd></button></div>`;
  bindForm(el, fields, vals);
  const gsel = $('#f_group_id'); const syncBW = () => { const g = c.groups.find(x => x.id === +gsel.value); if (!p.id && g) $('#f_bill_wise').checked = underGroups({ group_name: g.name }, ['Sundry Debtors', 'Sundry Creditors']); const nat = g && g.nature; if (!p.id) $('#f_opening_side').value = (nat === 'L' || nat === 'I') ? 'Cr' : 'Dr'; };
  gsel.onchange = syncBW; if (!p.id) syncBW();
  $('#f_gstin').onchange = () => { const g = $('#f_gstin').value.trim().toUpperCase(); if (g.length >= 2) { $('#f_state_code').value = g.slice(0, 2); if (g.length >= 12 && !$('#f_pan').value) $('#f_pan').value = g.slice(2, 12); } if (g && !U.validGSTIN(g)) toast('GSTIN looks invalid (check digit mismatch)', 'err'); };
  $$('input,select,textarea', el).forEach(x => x.addEventListener('input', () => APP.current.dirty = true));
  const save = async () => { try { const v = readForm(el, fields); v.opening = (v.opening_side === 'Cr' ? -1 : 1) * Math.abs(v.opening || 0); delete v.opening_side; v.price_list_id = v.price_list_id || null; if (p.id) v.id = p.id; const id = await C('saveLedger', v); toast('Ledger saved', 'ok'); APP.current.dirty = false; await loadCache(true); if (p.onSaved) p.onSaved(id); back(); } catch (e) { fail(e); } };
  $('#lsave').onclick = save; $('#lcancel').onclick = back;
  if ($('#ldel')) $('#ldel').onclick = async () => { if (await confirmBox('Delete ledger "' + l.name + '"?', 'Delete', true)) { try { await C('deleteLedger', p.id); toast('Deleted', 'ok'); await loadCache(true); APP.current.dirty = false; back(); } catch (e) { fail(e); } } };
  if ($('#lst')) $('#lst').onclick = () => go('report', { r: 'ledgerStatement', a: { ledger_id: p.id } });
  if ($('#lrem')) $('#lrem').onclick = () => api('doc.pdf', 'reminder', p.id).catch(fail);
  APP.current.keys = e => { if (e.ctrlKey && e.key.toLowerCase() === 's') { save(); return true; } };
  $('#f_name').focus();
};
SCREENS.ledgerPick = async (el) => {
  const c = await loadCache(true);
  el.innerHTML = `<h2 class="title">Ledger Statement</h2><div class="card" style="max-width:560px"><div class="fld"><label>Select Ledger</label><input id="lpk" data-combo="1" placeholder="Type name, GSTIN or phone"></div><div class="help" style="color:var(--muted)">Enter to open</div></div>`;
  combo($('#lpk'), { source: ledgerSrc(), onSelect: x => x && go('report', { r: 'ledgerStatement', a: { ledger_id: x.id } }, true) }); $('#lpk').focus();
};
SCREENS.itemPick = async (el) => {
  await loadCache(true);
  el.innerHTML = `<h2 class="title">Stock Item Ledger</h2><div class="card" style="max-width:560px"><div class="fld"><label>Select Item</label><input id="ipk" data-combo="1" placeholder="Name, code or barcode"></div></div>`;
  combo($('#ipk'), { source: itemSrc(), onSelect: x => x && go('report', { r: 'itemLedger', a: { item_id: x.id } }, true) }); $('#ipk').focus();
};

// ---------- groups ----------
SCREENS.groupList = async (el) => {
  const c = await loadCache(true);
  listScreen(el, { title: 'Account Groups', rows: c.groups, onNew: () => go('groupEdit', {}), onOpen: r => go('groupEdit', { id: r.id }),
    cols: [{ k: 'name', label: 'Group' }, { k: 'parent', label: 'Under', f: r => esc(r.parent || 'Primary') }, { k: 'nature', label: 'Nature', f: r => ({ A: 'Assets', L: 'Liabilities', I: 'Income', E: 'Expenses' }[r.nature]) + (r.direct ? ' (Direct)' : '') }, { k: 'is_system', label: 'Type', f: r => r.is_system ? '<span class="pill grey">pre-defined</span>' : '<span class="pill">user</span>' }] });
};
SCREENS.groupEdit = async (el, p) => {
  const c = await loadCache(); const g = p.id ? c.groups.find(x => x.id === p.id) : {};
  const fields = [{ k: 'name', label: 'Group Name', req: true, w: 2 }, { k: 'parent_id', label: 'Under', type: 'select', options: c.groups.filter(x => x.id !== p.id).map(x => [x.id, x.name]), req: true, w: 2 }];
  el.innerHTML = `<h2 class="title">${p.id ? 'Alter' : 'Create'} Group</h2><div class="card" style="max-width:700px"><div class="form">${formHtml(fields, g)}</div>${g.is_system ? '<p class="help">Pre-defined group: only the name can be changed.</p>' : ''}</div>
    <div class="actions" style="max-width:700px">${p.id && !g.is_system && can('admin') ? '<button class="btn danger" id="gdel">Delete</button>' : ''}<span style="flex:1"></span><button class="btn" id="gc">Cancel</button><button class="btn primary" id="gs">Save <kbd>Ctrl+S</kbd></button></div>`;
  bindForm(el, fields, g); if (g.is_system) $('#f_parent_id').disabled = true;
  const save = async () => { try { const v = readForm(el, fields); if (p.id) v.id = p.id; await C('saveGroup', v); toast('Group saved', 'ok'); await loadCache(true); back(); } catch (e) { fail(e); } };
  $('#gs').onclick = save; $('#gc').onclick = back; if ($('#gdel')) $('#gdel').onclick = async () => { if (await confirmBox('Delete group?', 'Delete', true)) { try { await C('deleteGroup', p.id); await loadCache(true); back(); } catch (e) { fail(e); } } };
  APP.current.keys = e => { if (e.ctrlKey && e.key.toLowerCase() === 's') { save(); return true; } }; $('#f_name').focus();
};
