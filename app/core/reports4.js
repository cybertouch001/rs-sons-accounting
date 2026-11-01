
// R&S Sons Accounting - MIS, banking, TDS, depreciation, payroll, audit, dashboard
const U = require('./util');
const { VTYPES } = require('./company');
const { C, P } = require('./reports1');
const r2 = U.r2;

P.cashFlow = function (f = {}) {
  const { from, to } = this.periodDefaults(f);
  const cb = this.ledgers({ groupNames: ['Cash-in-Hand', 'Bank Accounts', 'Bank OD A/c'] }).map(l => l.id);
  const open = r2(cb.reduce((s, id) => s + this.ledgerBalance(id, this.dayBefore(from)), 0)), close = r2(cb.reduce((s, id) => s + this.ledgerBalance(id, to), 0));
  const rows = this.all(`SELECT l.group_id, SUM(e2.cr - e2.dr) AS amt FROM entries e2 JOIN vouchers v ON v.id=e2.voucher_id JOIN ledgers l ON l.id=e2.ledger_id
     WHERE v.status='active' AND v.date BETWEEN ? AND ? AND e2.ledger_id NOT IN (${cb.join(',') || -1}) AND v.id IN (SELECT voucher_id FROM entries WHERE ledger_id IN (${cb.join(',') || -1})) GROUP BY l.group_id`, [from, to]);
  const inflow = [], outflow = [];
  for (const r of rows) { const g = this.groupPrimary(r.group_id); const sub = this.get('SELECT name FROM groups WHERE id=?', [r.group_id]).name; const name = g.name === sub ? g.name : `${sub} (${g.name})`; const a = r2(r.amt); if (a > 0) inflow.push({ name, amt: a }); else if (a < 0) outflow.push({ name, amt: -a }); }
  const ti = r2(inflow.reduce((s, x) => s + x.amt, 0)), tout = r2(outflow.reduce((s, x) => s + x.amt, 0));
  const out = [{ name: 'Opening Cash & Bank Balance', amt: open, _b: true }, { name: 'Cash Inflows', _b: true }, ...inflow.map(x => ({ ...x, _l: 1 })), { name: 'Total Inflow', amt: ti, _b: true }, { name: 'Cash Outflows', _b: true }, ...outflow.map(x => ({ ...x, _l: 1 })), { name: 'Total Outflow', amt: tout, _b: true }, { name: 'Net Cash Flow', amt: r2(ti - tout), _b: true }, { name: 'Closing Cash & Bank Balance', amt: close, _b: true }];
  return { title: 'Cash Flow Statement', subtitle: `${U.fmtDate(from)} to ${U.fmtDate(to)}`, columns: [C('name', 'Particulars'), C('amt', 'Amount (₹)', 'amt')], rows: out, meta: { open, close, ti, tout } };
};
P.ratios = function (f = {}) {
  const { from, to } = this.periodDefaults(f);
  const B = this.balances(from, to); const d = this.plData(from, to, B);
  const gsum = n => { const g = this.groupByName(n); const ids = this.groupDescendants(g.id); return r2(Object.values(B.led).filter(l => ids.includes(l.group_id) && l.id !== B.plId).reduce((s, l) => s + l.bal, 0)); };
  const plLed = B.led[B.plId] || { bal: 0 };
  const ca = r2(gsum('Current Assets') + d.cs), cl = r2(-gsum('Current Liabilities')), debt = r2(-gsum('Loans (Liability)'));
  const cap = r2(-gsum('Capital Account') - plLed.bal + B.priorProfit + d.np);
  const debtors = gsum('Sundry Debtors'), creditors = r2(-gsum('Sundry Creditors')), sales = d.sales.total, purch = d.purch.total;
  const days = Math.max(1, U.daysBetween(from, to) + 1);
  const q = (a, b) => b ? r2(a / b) : null;
  const rows = [
    { name: 'Current Ratio (Current Assets / Current Liabilities)', val: q(ca, cl), note: `${U.inr(ca)} / ${U.inr(cl)}` },
    { name: 'Quick Ratio ((CA − Stock) / CL)', val: q(ca - d.cs, cl), note: '' },
    { name: 'Working Capital (₹)', val: r2(ca - cl), note: '' },
    { name: 'Debt–Equity Ratio', val: q(debt, cap), note: `${U.inr(debt)} / ${U.inr(cap)}` },
    { name: 'Gross Profit %', val: q(d.gp * 100, sales), note: `GP ${U.inr(d.gp)} on sales ${U.inr(sales)}` },
    { name: 'Net Profit %', val: q(d.np * 100, sales), note: `NP ${U.inr(d.np)}` },
    { name: 'Stock Turnover (times)', val: q(sales - d.gp, (d.os + d.cs) / 2), note: 'Cost of goods sold / average stock' },
    { name: 'Debtors Collection Period (days)', val: q(debtors * days, sales), note: '' },
    { name: 'Creditors Payment Period (days)', val: q(creditors * days, purch), note: '' },
    { name: 'Return on Capital Employed %', val: q(d.np * 100, cap + debt), note: '' },
  ];
  return { title: 'Ratio Analysis', subtitle: `${U.fmtDate(from)} to ${U.fmtDate(to)}`, columns: [C('name', 'Ratio'), C('val', 'Value', 'num'), C('note', 'Working')], rows };
};
P.budgetReport = function (f = {}) {
  const { from, to } = this.periodDefaults(f); const fy = U.fyOf(from).label;
  const B = this.balances(from, to);
  const rows = this.all('SELECT b.*, l.name FROM budgets b JOIN ledgers l ON l.id=b.ledger_id WHERE b.fy=? ORDER BY l.name', [fy]).map(b => {
    const led = B.led[b.ledger_id]; const actual = r2(Math.abs(led ? led.bal : 0)); const v = r2(b.amount - actual);
    return { name: b.name, budget: b.amount, actual, variance: v, pct: b.amount ? r2(actual * 100 / b.amount) : null, _warn: actual > b.amount, _drill: { r: 'ledgerStatement', a: { ledger_id: b.ledger_id, from, to } } }; });
  return { title: 'Budget vs Actual (FY ' + fy + ')', subtitle: `${U.fmtDate(from)} to ${U.fmtDate(to)} · set budgets in Masters › Budgets`, columns: [C('name', 'Ledger'), C('budget', 'Budget (₹)', 'amt'), C('actual', 'Actual (₹)', 'amt'), C('variance', 'Variance (₹)', 'amt'), C('pct', '% Used', 'num')], rows };
};
P.budgets = function (fy) { return this.all('SELECT b.*, l.name FROM budgets b JOIN ledgers l ON l.id=b.ledger_id WHERE b.fy=? ORDER BY l.name', [fy]); };
P.saveBudget = function (fy, ledgerId, amount) { this.tx(() => { if (!Number(amount)) this.run('DELETE FROM budgets WHERE fy=? AND ledger_id=?', [fy, ledgerId]); else this.run('INSERT OR REPLACE INTO budgets (fy, ledger_id, amount) VALUES (?,?,?)', [fy, ledgerId, Number(amount)]); this.audit('update', 'budget', ledgerId, 'Budget ' + fy + ' ₹' + amount); }); };
P.costCentreReport = function (f = {}) {
  const { from, to } = this.periodDefaults(f);
  const rows = this.all(`SELECT c.name AS cc, c.category, l.name AS ledger, SUM(e.dr) AS dr, SUM(e.cr) AS cr FROM entries e JOIN vouchers v ON v.id=e.voucher_id JOIN cost_centres c ON c.id=e.cost_centre_id JOIN ledgers l ON l.id=e.ledger_id WHERE v.status='active' AND v.date BETWEEN ? AND ? GROUP BY c.id, l.id ORDER BY c.name, l.name`, [from, to])
    .map(r => ({ ...r, dr: r2(r.dr) || null, cr: r2(r.cr) || null, net: r2(r.dr - r.cr) }));
  return { title: 'Cost Centre Report', subtitle: `${U.fmtDate(from)} to ${U.fmtDate(to)}`, columns: [C('cc', 'Cost Centre'), C('category', 'Category'), C('ledger', 'Ledger'), C('dr', 'Debit', 'amt'), C('cr', 'Credit', 'amt'), C('net', 'Net (Dr +)', 'amt')], rows };
};
P.brs = function (f = {}) {
  const banks = this.ledgers({ groupNames: ['Bank Accounts', 'Bank OD A/c'] });
  const l = this.ledger(f.ledger_id || (banks[0] && banks[0].id)); if (!l) throw new Error('Create a bank ledger first (group "Bank Accounts")');
  const to = f.to || U.today();
  const books = this.ledgerBalance(l.id, to);
  const es = this.all(`SELECT e.id, e.dr, e.cr, e.bank_date, v.date, v.number, v.vtype, v.cheque_no, v.id AS vid FROM entries e JOIN vouchers v ON v.id=e.voucher_id WHERE e.ledger_id=? AND v.status='active' AND v.date<=? ${f.all ? '' : 'AND (e.bank_date IS NULL OR e.bank_date>?)'} ORDER BY v.date`, f.all ? [l.id, to] : [l.id, to, to]);
  let unDr = 0, unCr = 0;
  const rows = es.map(e => { const un = !e.bank_date || e.bank_date > to; if (un) { unDr += e.dr; unCr += e.cr; } return { entry_id: e.id, date: e.date, part: this.oppositeName(e.vid, l.id), vtype: VTYPES[e.vtype].name, number: e.number, cheque: e.cheque_no || '', dr: e.dr || null, cr: e.cr || null, bank_date: e.bank_date || '', _edit: 'bank_date', _drill: { voucher: e.vid } }; });
  const bank = r2(books - unDr + unCr);
  return { title: 'Bank Reconciliation: ' + l.name, subtitle: `as on ${U.fmtDate(to)} · Balance as per books ${U.drcr(books)} · Not yet in bank: deposits ${U.inr(unDr)}, withdrawals ${U.inr(unCr)} · Balance as per bank ${U.drcr(bank)}`,
    columns: [C('date', 'Date', 'date'), C('part', 'Particulars'), C('vtype', 'Vch Type'), C('number', 'Vch No.'), C('cheque', 'Cheque No.'), C('dr', 'Deposit (Dr)', 'amt'), C('cr', 'Withdrawal (Cr)', 'amt'), C('bank_date', 'Bank Date', 'date')], rows,
    meta: { books, bank, unDr: r2(unDr), unCr: r2(unCr), ledger_id: l.id } };
};
P.setBankDate = function (entryId, d) { this.tx(() => { this.run('UPDATE entries SET bank_date=? WHERE id=?', [d || null, entryId]); this.audit('update', 'bank_date', entryId, 'Bank date ' + (d || 'cleared')); }); };
P.tdsReport = function (f = {}) {
  const { from, to } = this.periodDefaults(f); const kind = f.kind || 'TDS';
  const tl = this.all('SELECT id, name, tds_section, tax_rate FROM ledgers WHERE tax_type=?' + (kind === 'TDS' ? " OR tax_type='TDS_SAL'" : ''), [kind]);
  const rows = [];
  for (const t of tl) for (const e of this.all(`SELECT e.cr, e.dr, v.date, v.number, v.vtype, v.id AS vid FROM entries e JOIN vouchers v ON v.id=e.voucher_id WHERE e.ledger_id=? AND v.status='active' AND v.date BETWEEN ? AND ? ORDER BY v.date`, [t.id, from, to])) {
    const party = this.get(`SELECT l.name, l.pan FROM entries e JOIN ledgers l ON l.id=e.ledger_id WHERE e.voucher_id=? AND e.ledger_id<>? ORDER BY CASE WHEN l.pan IS NOT NULL THEN 0 ELSE 1 END, (e.dr+e.cr) DESC LIMIT 1`, [e.vid, t.id]) || {};
    const dep = e.dr > 0;
    rows.push({ date: e.date, number: e.number, vtype: VTYPES[e.vtype].name, ledger: t.name, section: t.tds_section || '', party: dep ? '(deposited to Govt.)' : party.name, pan: dep ? '' : (party.pan || ''), deducted: e.cr || null, paid: e.dr || null, _drill: { voucher: e.vid } });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  const ded = r2(rows.reduce((s, r) => s + (r.deducted || 0), 0)), paid = r2(rows.reduce((s, r) => s + (r.paid || 0), 0));
  return { title: kind + ' Register', subtitle: `${U.fmtDate(from)} to ${U.fmtDate(to)} · balance payable ₹${U.inr(ded - paid)}`, columns: [C('date', 'Date', 'date'), C('number', 'Vch No.'), C('vtype', 'Type'), C('ledger', kind + ' Ledger'), C('section', 'Section'), C('party', 'Party'), C('pan', 'PAN'), C('deducted', kind === 'TDS' ? 'Deducted' : 'Collected', 'amt'), C('paid', 'Deposited', 'amt')], rows,
    foot: { party: 'Total', deducted: ded, paid } };
};
P.depreciationChart = function (f = {}) {
  const fy = U.fyOf(f.to || U.today()); const from = fy.start, to = fy.end; const bb = this.setting('books_begin');
  const half = U.addDays(fy.start, 183);
  const rows = [];
  for (const a of this.ledgers({ groupName: 'Fixed Assets' })) {
    const open = from <= bb ? a.opening : this.ledgerBalance(a.id, this.dayBefore(from));
    const m = this.all(`SELECT v.date, e.dr, e.cr, v.narration FROM entries e JOIN vouchers v ON v.id=e.voucher_id WHERE e.ledger_id=? AND v.status='active' AND v.date BETWEEN ? AND ?`, [a.id, from, to]);
    const isDep = (x) => (x.narration || '').startsWith('Depreciation for FY');
    const addFull = r2(m.filter(x => x.dr && x.date < half).reduce((s, x) => s + x.dr, 0)), addHalf = r2(m.filter(x => x.dr && x.date >= half).reduce((s, x) => s + x.dr, 0));
    const sold = r2(m.filter(x => x.cr && !isDep(x)).reduce((s, x) => s + x.cr, 0)); const posted = r2(m.filter(x => x.cr && isDep(x)).reduce((s, x) => s + x.cr, 0));
    const rate = a.dep_rate || 0;
    const dep = r2(Math.max(0, open + addFull - sold) * rate / 100 + addHalf * rate / 200);
    if (!open && !addFull && !addHalf) continue;
    rows.push({ name: a.name, rate, open, addFull, addHalf, sold, dep, posted, closing: r2(open + addFull + addHalf - sold - dep), ledger_id: a.id, _drill: { r: 'ledgerStatement', a: { ledger_id: a.id, from, to } } });
  }
  return { title: 'Depreciation Chart FY ' + fy.label + ' (WDV, Income-tax Act)', subtitle: 'Assets put to use on/after ' + U.fmtDate(half) + ' get half-rate depreciation. Set the rate % in each Fixed Asset ledger.',
    columns: [C('name', 'Asset'), C('rate', 'Rate %', 'num'), C('open', 'Opening WDV', 'amt'), C('addFull', 'Additions ≥180 days', 'amt'), C('addHalf', 'Additions <180 days', 'amt'), C('sold', 'Sold / Deleted', 'amt'), C('dep', 'Depreciation', 'amt'), C('posted', 'Already Posted', 'amt'), C('closing', 'Closing WDV', 'amt')], rows,
    foot: { name: 'Total', dep: r2(rows.reduce((s, r) => s + r.dep, 0)), posted: r2(rows.reduce((s, r) => s + r.posted, 0)) }, meta: { fy: fy.label, to } };
};
P.postDepreciation = function (f = {}) {
  const ch = this.depreciationChart(f); const lines = []; let total = 0;
  for (const r of ch.rows) { const amt = r2(r.dep - r.posted); if (amt > 0.005) { lines.push({ ledger_id: r.ledger_id, cr: amt }); total += amt; } }
  if (!lines.length) throw new Error('Nothing to post: depreciation already posted or no rates set in Fixed Asset ledgers');
  lines.unshift({ ledger_id: this.ledgerByTax('DEP').id, dr: r2(total) });
  return this.saveVoucher({ vtype: 'JRN', date: ch.meta.to, narration: 'Depreciation for FY ' + ch.meta.fy + ' (WDV)', lines });
};

// ---------------- Payroll ----------------
P.payrollCompute = function (month) {
  const emps = this.all('SELECT * FROM employees WHERE active=1 ORDER BY name');
  return emps.map(e => {
    const gross = r2(e.basic + e.hra + e.da + e.other_allow);
    const pfWage = Math.min(15000, e.basic + e.da);
    const pf = e.pf_applicable ? r2(pfWage * 0.12) : 0, pfEr = pf;
    const esiOn = e.esi_applicable && gross <= 21000;
    const esi = esiOn ? Math.ceil(gross * 0.0075) : 0, esiEr = esiOn ? Math.ceil(gross * 0.0325) : 0;
    const pt = e.pt || 0, tds = e.tds || 0;
    return { id: e.id, name: e.name, designation: e.designation || '', basic: e.basic, hra: e.hra, da: e.da, other: e.other_allow, gross, pf, esi, pt, tds, deductions: r2(pf + esi + pt + tds), net: r2(gross - pf - esi - pt - tds), pfEr, esiEr };
  });
};
P.payrollProcess = function (month, date) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Month must be YYYY-MM');
  if (this.get('SELECT id FROM payroll_runs WHERE month=?', [month])) throw new Error('Salary for ' + month + ' is already processed. Delete that run first to redo it.');
  const rows = this.payrollCompute(month); if (!rows.length) throw new Error('No active employees. Add employees in Payroll › Employees.');
  const s = k => r2(rows.reduce((a, r) => a + r[k], 0));
  const L = t => this.ledgerByTax(t).id;
  const lines = [{ ledger_id: L('SALARY'), dr: s('gross') }];
  if (s('pfEr')) lines.push({ ledger_id: L('PF_ER'), dr: s('pfEr') });
  if (s('esiEr')) lines.push({ ledger_id: L('ESI_ER'), dr: s('esiEr') });
  if (s('pf') + s('pfEr')) lines.push({ ledger_id: L('PF_PAY'), cr: r2(s('pf') + s('pfEr')) });
  if (s('esi') + s('esiEr')) lines.push({ ledger_id: L('ESI_PAY'), cr: r2(s('esi') + s('esiEr')) });
  if (s('pt')) lines.push({ ledger_id: L('PT_PAY'), cr: s('pt') });
  if (s('tds')) lines.push({ ledger_id: L('TDS_SAL'), cr: s('tds') });
  lines.push({ ledger_id: L('SAL_PAY'), cr: s('net') });
  const d = date || (() => { const [y, m] = month.split('-').map(Number); const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return `${month}-${String(last).padStart(2, '0')}`; })();
  const res = this.saveVoucher({ vtype: 'JRN', date: d, narration: 'Salary for ' + month + ' (' + rows.length + ' employees)', lines });
  this.tx(() => { this.insert('payroll_runs', { month, voucher_id: res.id, data_json: JSON.stringify(rows), created_at: this.now() }); });
  return res;
};
P.payrollRuns = function () { return this.all('SELECT p.id, p.month, p.voucher_id, v.number, v.total, p.created_at FROM payroll_runs p LEFT JOIN vouchers v ON v.id=p.voucher_id ORDER BY month DESC'); };
P.payrollDelete = function (id) { const r = this.get('SELECT * FROM payroll_runs WHERE id=?', [id]); if (!r) return; if (r.voucher_id) this.deleteVoucher(r.voucher_id); this.tx(() => this.run('DELETE FROM payroll_runs WHERE id=?', [id])); };
P.salaryRegister = function (f = {}) {
  const run = f.month ? this.get('SELECT * FROM payroll_runs WHERE month=?', [f.month]) : this.get('SELECT * FROM payroll_runs ORDER BY month DESC LIMIT 1');
  const rows = run ? JSON.parse(run.data_json) : this.payrollCompute();
  const keys = ['basic', 'hra', 'da', 'other', 'gross', 'pf', 'esi', 'pt', 'tds', 'net', 'pfEr', 'esiEr']; const foot = { name: 'Total' }; for (const k of keys) foot[k] = r2(rows.reduce((s, r) => s + r[k], 0));
  return { title: 'Salary Register' + (run ? ' – ' + run.month : ' (preview, not processed)'), subtitle: 'PF 12% on Basic+DA (wage ceiling ₹15,000) · ESI 0.75% / 3.25% when gross ≤ ₹21,000',
    columns: [C('name', 'Employee'), C('designation', 'Designation'), C('basic', 'Basic', 'amt'), C('hra', 'HRA', 'amt'), C('da', 'DA', 'amt'), C('other', 'Other', 'amt'), C('gross', 'Gross', 'amt'), C('pf', 'PF (Emp)', 'amt'), C('esi', 'ESI (Emp)', 'amt'), C('pt', 'Prof. Tax', 'amt'), C('tds', 'TDS', 'amt'), C('net', 'Net Pay', 'amt'), C('pfEr', 'PF (Employer)', 'amt'), C('esiEr', 'ESI (Employer)', 'amt')], rows, foot };
};

// ---------------- Audit, verify, dashboard ----------------
P.auditLog = function (f = {}) {
  const { from, to } = this.periodDefaults(f);
  const rows = this.all(`SELECT * FROM audit_log WHERE substr(ts,1,10) BETWEEN ? AND ? ORDER BY id DESC LIMIT 5000`, [from, to]).map(a => ({ ts: a.ts, user: a.username, action: a.action.toUpperCase(), entity: a.entity, summary: a.summary, _audit: a.id, _drill: a.entity === 'voucher' && a.action !== 'delete' && this.get('SELECT id FROM vouchers WHERE id=?', [a.entity_id]) ? { voucher: a.entity_id } : null }));
  return { title: 'Audit Trail (Edit Log)', subtitle: `${U.fmtDate(from)} to ${U.fmtDate(to)} · every create / edit / delete is logged with old & new values; it cannot be switched off`, columns: [C('ts', 'Date & Time (UTC)'), C('user', 'User'), C('action', 'Action'), C('entity', 'Entity'), C('summary', 'Details')], rows };
};
P.verifyData = function () {
  const issues = [];
  for (const v of this.all("SELECT v.id, v.vtype, v.number, v.date, SUM(e.dr) AS dr, SUM(e.cr) AS cr FROM vouchers v JOIN entries e ON e.voucher_id=v.id GROUP BY v.id HAVING ABS(SUM(e.dr)-SUM(e.cr))>0.01"))
    issues.push({ type: 'Unbalanced voucher', detail: `${VTYPES[v.vtype].name} ${v.number} (${U.fmtDate(v.date)}): Dr ${v.dr} ≠ Cr ${v.cr}` });
  const n1 = this.val('SELECT COUNT(*) FROM entries WHERE voucher_id NOT IN (SELECT id FROM vouchers)'); if (n1) issues.push({ type: 'Orphan entries', detail: n1 + ' entries without a voucher' });
  const n2 = this.val('SELECT COUNT(*) FROM entries WHERE ledger_id NOT IN (SELECT id FROM ledgers)'); if (n2) issues.push({ type: 'Missing ledger', detail: n2 + ' entries point to deleted ledgers' });
  const n3 = this.val('SELECT COUNT(*) FROM vitems WHERE item_id NOT IN (SELECT id FROM items)'); if (n3) issues.push({ type: 'Missing item', detail: n3 + ' item lines point to deleted items' });
  for (const v of this.all("SELECT v.vtype, v.number FROM vouchers v WHERE v.vtype IN ('SAL','PUR','CRN','DBN','RCT','PMT','CNT','JRN') AND v.status='active' AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.voucher_id=v.id)")) issues.push({ type: 'Voucher without entries', detail: VTYPES[v.vtype].name + ' ' + v.number });
  const sv = this.stockValuation(U.today()); for (const k in sv) if (sv[k].qty < 0 && !sv[k].service) issues.push({ type: 'Negative stock', detail: `${sv[k].name}: ${sv[k].qty}` });
  for (const l of this.all("SELECT name, gstin FROM ledgers WHERE gstin IS NOT NULL AND gstin<>''")) if (!U.validGSTIN(l.gstin)) issues.push({ type: 'Invalid GSTIN', detail: `${l.name}: ${l.gstin}` });
  const tb = this.trialBalance({ from: U.fyOf(U.today()).start, to: U.fyOf(U.today()).end });
  if (Math.abs(tb.meta.diff) > 0.005) issues.push({ type: 'Opening balance difference', detail: 'Opening balances (incl. opening stock) differ by ₹' + U.inr(Math.abs(tb.meta.diff)) });
  const integrity = this.val('PRAGMA integrity_check');
  if (integrity !== 'ok') issues.push({ type: 'Database integrity', detail: integrity });
  return { ok: issues.length === 0, issues, checked: { vouchers: this.val('SELECT COUNT(*) FROM vouchers'), ledgers: this.val('SELECT COUNT(*) FROM ledgers'), items: this.val('SELECT COUNT(*) FROM items') } };
};
// Overdue bills, net of the party's unadjusted credits (on-account receipts/payments, credit/debit notes
// not set against a bill). Credits are applied to the party's oldest-due bills first (FIFO), so the
// overdue figure can never exceed what the party actually owes, and the dashboard and the outstanding
// report always show the same number.
P.overdueSummary = function (kind, asOf) {
  kind = kind || 'receivable'; asOf = asOf || U.today();
  const sign = kind === 'receivable' ? 1 : -1;
  const out = { count: 0, amount: 0, gross: 0, credits: 0, parties: [] };
  for (const p of this.ledgers({ groupName: kind === 'receivable' ? 'Sundry Debtors' : 'Sundry Creditors' })) {
    if (!p.bill_wise) continue;
    const bills = this.pendingBills(p.id, asOf).map(b => Object.assign({}, b, { amount: r2(b.amount * sign) }));
    let credit = r2(-bills.filter(b => b.amount < 0).reduce((s, b) => s + b.amount, 0));
    out.credits = r2(out.credits + credit);
    const owed = bills.filter(b => b.amount > 0).sort((a, b) => String(a.due || a.date || '').localeCompare(String(b.due || b.date || '')));
    let pc = 0, pa = 0;
    for (const b of owed) {
      const use = Math.min(credit, b.amount); credit = r2(credit - use); const left = r2(b.amount - use);
      const isOver = b.due && b.due < asOf;
      if (isOver) out.gross = r2(out.gross + b.amount);
      if (isOver && left > 0.005) { pc++; pa = r2(pa + left); }
    }
    if (pc) { out.count += pc; out.amount = r2(out.amount + pa); out.parties.push({ id: p.id, name: p.name, count: pc, amount: pa }); }
  }
  return out;
};
P.dashboard = function (f = {}) {
  const fy = U.fyOf(f.to || U.today()); const from = f.from || fy.start, to = f.to || fy.end; const today = U.today();
  const balAt = to < today ? to : today; // every figure on the dashboard is 'as on' this date
  const sumT = (t, k, a, b) => r2(this.val(`SELECT COALESCE(SUM(${k}),0) FROM vouchers WHERE vtype=? AND status='active' AND date BETWEEN ? AND ?`, [t, a, b]));
  const sales = r2(sumT('SAL', 'taxable', from, balAt) - sumT('CRN', 'taxable', from, balAt)), purchases = r2(sumT('PUR', 'taxable', from, balAt) - sumT('DBN', 'taxable', from, balAt));
  const todaySales = r2(sumT('SAL', 'total', today, today) - sumT('CRN', 'total', today, today));
  const cashL = this.ledgers({ groupName: 'Cash-in-Hand' }), bankL = this.ledgers({ groupNames: ['Bank Accounts', 'Bank OD A/c'] });
  const cash = r2(cashL.reduce((s, l) => s + this.ledgerBalance(l.id, balAt), 0));
  const banks = bankL.map(l => ({ name: l.name, bal: this.ledgerBalance(l.id, balAt) }));
  const sumGroup = n => r2(this.ledgers({ groupName: n }).reduce((s, l) => s + this.ledgerBalance(l.id, balAt), 0));
  const receivables = sumGroup('Sundry Debtors'), payables = r2(-sumGroup('Sundry Creditors'));
  const gstOut = r2(sumT('SAL', 'cgst+sgst+igst+cess', from, balAt) - sumT('CRN', 'cgst+sgst+igst+cess', from, balAt)), gstIn = r2(sumT('PUR', 'cgst+sgst+igst+cess', from, balAt) - sumT('DBN', 'cgst+sgst+igst+cess', from, balAt));
  const topItems = this.all(`SELECT i.name, SUM(vi.taxable) AS value, SUM(vi.qty) AS qty FROM vitems vi JOIN vouchers v ON v.id=vi.voucher_id JOIN items i ON i.id=vi.item_id WHERE v.vtype='SAL' AND v.status='active' AND v.date BETWEEN ? AND ? GROUP BY i.id ORDER BY value DESC LIMIT 5`, [from, balAt]);
  const topParties = this.all(`SELECT p.name, SUM(v.total) AS value FROM vouchers v JOIN ledgers p ON p.id=v.party_id WHERE v.vtype='SAL' AND v.status='active' AND v.date BETWEEN ? AND ? GROUP BY p.id ORDER BY value DESC LIMIT 5`, [from, balAt]);
  const monthly = this.monthlySummary({ from, to }).rows.map(r => ({ month: r.month, sales: r.sales, purchase: r.purchase }));
  const recent = this.all(`SELECT v.id, v.vtype, v.number, v.date, v.total, p.name AS party FROM vouchers v LEFT JOIN ledgers p ON p.id=v.party_id ORDER BY v.id DESC LIMIT 8`).map(v => ({ ...v, vtype_name: VTYPES[v.vtype].name }));
  const od = this.overdueSummary('receivable', balAt);
  const overdue = od.count, overdueAmt = od.amount;
  const reorder = this.reorderReport({ to: today }).rows.filter(r => r._warn).length;
  const reminders = this.all("SELECT * FROM reminders WHERE done=0 AND (due_date IS NULL OR due_date<=?) ORDER BY due_date LIMIT 8", [U.addDays(today, 7)]);
  const pl = this.plData(from, balAt); // same 'as on' date as cash/bank/receivables, so every KPI matches the reports as on that date
  const expiring = this.batchStock({ to: today }).rows.filter(r => r._warn).length;
  return { from, to, asOn: balAt, sales, purchases, todaySales, cash, banks, bankTotal: r2(banks.reduce((s, b) => s + b.bal, 0)), receivables, payables, gstOut, gstIn, gstNet: r2(gstOut - gstIn), topItems, topParties, monthly, recent, overdue, overdueAmt: r2(overdueAmt), overdueGross: od.gross, unadjustedCredits: od.credits, reorder, reminders, grossProfit: pl.gp, netProfit: pl.np, closingStock: pl.cs, expiring,
    counts: { vouchers: this.val('SELECT COUNT(*) FROM vouchers'), ledgers: this.val('SELECT COUNT(*) FROM ledgers'), items: this.val('SELECT COUNT(*) FROM items') } };
};
P.sqlQuery = function (sql) {
  const s = String(sql || '').trim().replace(/;+\s*$/, '');
  if (!/^(select|with|pragma table_info)\b/i.test(s) || /;/.test(s) || /\b(insert|update|delete|drop|alter|create|replace|attach|detach|vacuum|reindex)\b/i.test(s.replace(/'[^']*'/g, ''))) throw new Error('Only a single read-only SELECT query is allowed');
  const rows = this.all(s + (/\blimit\b/i.test(s) ? '' : ' LIMIT 2000'));
  const cols = rows.length ? Object.keys(rows[0]) : [];
  return { title: 'Query Result', subtitle: rows.length + ' rows', columns: cols.map(k => C(k, k, typeof rows[0][k] === 'number' ? 'num' : 'text')), rows };
};
