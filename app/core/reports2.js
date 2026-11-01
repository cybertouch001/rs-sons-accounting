
// R&S Sons Accounting - P&L, Balance Sheet, books, registers
const U = require('./util');
const { VTYPES } = require('./company');
const { C, P } = require('./reports1');
const r2 = U.r2;

P.plData = function (from, to, B) {
  B = B || this.balances(from, to);
  const { byParent } = this.groupTree();
  const groupTotal = (gid) => { const ids = this.groupDescendants(gid); let t = 0; for (const l of Object.values(B.led)) if (ids.includes(l.group_id)) t += l.bal; return r2(t); };
  const lines = (gname, sign) => {
    const g = this.groupByName(gname); const out = [];
    for (const c of (byParent[g.id] || [])) { const t = groupTotal(c.id) * sign; if (Math.abs(t) > 0.005) out.push({ name: c.name, amt: r2(t), _l: 1, _drill: { r: 'groupSummary', a: { group_id: c.id, from, to } } }); }
    for (const l of Object.values(B.led).filter(l => l.group_id === g.id).sort((a, b) => a.name.localeCompare(b.name))) { const t = r2(l.bal * sign); if (Math.abs(t) > 0.005) out.push({ name: l.name, amt: t, _l: 1, _drill: { r: 'ledgerStatement', a: { ledger_id: l.id, from, to } } }); }
    return { total: r2(groupTotal(g.id) * sign), lines: out, name: gname, id: g.id };
  };
  const sales = lines('Sales Accounts', -1), dInc = lines('Direct Incomes', -1), purch = lines('Purchase Accounts', 1), dExp = lines('Direct Expenses', 1);
  const iInc = lines('Indirect Incomes', -1), iExp = lines('Indirect Expenses', 1);
  const os = B.osFrom, cs = this.stockValue(to);
  const gp = r2(sales.total + dInc.total + cs - os - purch.total - dExp.total);
  const np = r2(gp + iInc.total - iExp.total);
  return { sales, dInc, purch, dExp, iInc, iExp, os, cs, gp, np };
};
function tFormat(left, right) {
  const rows = []; const n = Math.max(left.length, right.length);
  for (let i = 0; i < n; i++) { const l = left[i] || {}, r = right[i] || {};
    rows.push({ lp: l.name || '', la: l.amt === undefined ? null : l.amt, rp: r.name || '', ra: r.amt === undefined ? null : r.amt, _li: l._l || 0, _ri: r._l || 0, _ldrill: l._drill, _rdrill: r._drill }); }
  return rows;
}
P.profitLoss = function (f = {}) {
  const { from, to } = this.periodDefaults(f);
  const d = this.plData(from, to);
  const grp = (x) => (Math.abs(x.total) > 0.005 || x.lines.length) ? [{ name: x.name, amt: x.total, _drill: { r: 'groupSummary', a: { group_id: x.id, from, to } } }, ...x.lines] : [];
  const L = [{ name: 'Opening Stock', amt: d.os, _drill: { r: 'stockSummary', a: { from, to } } }, ...grp(d.purch), ...grp(d.dExp)];
  const R = [...grp(d.sales), ...grp(d.dInc), { name: 'Closing Stock', amt: d.cs, _drill: { r: 'stockSummary', a: { from, to } } }];
  if (d.gp >= 0) L.push({ name: 'Gross Profit c/o', amt: d.gp }); else R.push({ name: 'Gross Loss c/o', amt: -d.gp });
  const sumTop = a => r2(a.filter(x => !x._l).reduce((s, x) => s + (x.amt || 0), 0));
  const t1 = Math.max(sumTop(L), sumTop(R));
  const L2 = [], R2 = [];
  if (d.gp >= 0) R2.push({ name: 'Gross Profit b/f', amt: d.gp }); else L2.push({ name: 'Gross Loss b/f', amt: -d.gp });
  L2.push(...grp(d.iExp)); R2.push(...grp(d.iInc));
  if (d.np >= 0) L2.push({ name: 'Net Profit', amt: d.np }); else R2.push({ name: 'Net Loss', amt: -d.np });
  const t2 = Math.max(sumTop(L2), sumTop(R2));
  const rows = [...tFormat(L, R), { lp: 'Total', la: t1, rp: 'Total', ra: t1, _total: true }, { lp: '', rp: '' }, ...tFormat(L2, R2), { lp: 'Total', la: t2, rp: 'Total', ra: t2, _total: true }];
  return { title: 'Profit & Loss A/c', subtitle: `${U.fmtDate(from)} to ${U.fmtDate(to)}`, tformat: true,
    columns: [C('lp', 'Particulars (Dr)'), C('la', 'Amount (₹)', 'amt'), C('rp', 'Particulars (Cr)'), C('ra', 'Amount (₹)', 'amt')], rows,
    meta: { grossProfit: d.gp, netProfit: d.np, openingStock: d.os, closingStock: d.cs, sales: d.sales.total, purchases: d.purch.total, tradingTotal: t1 } };
};
P.balanceSheet = function (f = {}) {
  const to = f.to || U.fyOf(U.today()).end; const fy = U.fyOf(to); const bb = this.setting('books_begin');
  const from = fy.start < bb ? bb : fy.start;
  const B = this.balances(from, to);
  const d = this.plData(from, to, B);
  const { byParent } = this.groupTree();
  const gt = gid => { const ids = this.groupDescendants(gid); let t = 0; for (const l of Object.values(B.led)) if (ids.includes(l.group_id) && l.id !== B.plId) t += l.bal; return r2(t); };
  const side = (nature, sign) => {
    const out = [];
    for (const g of (byParent[0] || []).filter(g => g.nature === nature)) {
      let t = r2(gt(g.id) * sign); const sub = [];
      for (const c of (byParent[g.id] || [])) { let ct = r2(gt(c.id) * sign); if (c.name === 'Stock-in-Hand') ct = r2(ct + d.cs); if (Math.abs(ct) > 0.005) sub.push({ name: c.name, amt: ct, _l: 1, _drill: c.name === 'Stock-in-Hand' ? { r: 'stockSummary', a: { from, to } } : { r: 'groupSummary', a: { group_id: c.id, from, to } } }); }
      for (const l of Object.values(B.led).filter(l => l.group_id === g.id && l.id !== B.plId)) { const lt = r2(l.bal * sign); if (Math.abs(lt) > 0.005) sub.push({ name: l.name, amt: lt, _l: 1, _drill: { r: 'ledgerStatement', a: { ledger_id: l.id, from, to } } }); }
      if (g.name === 'Current Assets') t = r2(t + d.cs);
      if (Math.abs(t) > 0.005 || sub.length) out.push({ name: g.name, amt: t, _drill: { r: 'groupSummary', a: { group_id: g.id, from, to } } }, ...sub);
    }
    return out;
  };
  const Lside = side('L', -1), Aside = side('A', 1);
  const plLed = B.led[B.plId] || { bal: 0 };
  const plOpening = r2(-plLed.bal + B.priorProfit);
  Lside.push({ name: 'Profit & Loss A/c', amt: r2(plOpening + d.np), _drill: { r: 'profitLoss', a: { from, to } } }, { name: 'Opening Balance', amt: plOpening, _l: 1 }, { name: 'Current Period', amt: d.np, _l: 1, _drill: { r: 'profitLoss', a: { from, to } } });
  const sum = a => r2(a.filter(x => !x._l).reduce((s, x) => s + x.amt, 0));
  let lt = sum(Lside), at = sum(Aside);
  const diff = r2(at - lt);
  if (Math.abs(diff) > 0.005) { if (diff > 0) { Lside.push({ name: 'Difference in Opening Balances', amt: diff }); lt = r2(lt + diff); } else { Aside.push({ name: 'Difference in Opening Balances', amt: -diff }); at = r2(at - diff); } }
  const rows = [...tFormat(Lside, Aside), { lp: 'Total', la: lt, rp: 'Total', ra: at, _total: true }];
  return { title: 'Balance Sheet', subtitle: `as at ${U.fmtDate(to)}`, tformat: true,
    columns: [C('lp', 'Liabilities'), C('la', 'Amount (₹)', 'amt'), C('rp', 'Assets'), C('ra', 'Amount (₹)', 'amt')], rows,
    meta: { liabilities: lt, assets: at, balanced: Math.abs(lt - at) < 0.01, openingDiff: diff, netProfit: d.np } };
};

P.oppositeName = function (vid, lid) {
  const es = this.all('SELECT e.ledger_id, e.dr, e.cr, l.name, l.tax_type FROM entries e JOIN ledgers l ON l.id=e.ledger_id WHERE e.voucher_id=? ORDER BY e.sort', [vid]);
  const me = es.filter(e => e.ledger_id === lid); const myDr = me.reduce((s, e) => s + e.dr - e.cr, 0);
  const opp = es.filter(e => e.ledger_id !== lid && (myDr >= 0 ? e.cr > 0 : e.dr > 0));
  if (!opp.length) return '(as per details)';
  opp.sort((a, b) => (b.dr + b.cr) - (a.dr + a.cr));
  const major = opp.filter(o => !/(_IN|_OUT|ROUND|RCM)$/.test(o.tax_type || ''));
  return opp[0].name + (major.length > 1 ? ' (+' + (major.length - 1) + ' more)' : '');
};
P.dayBook = function (f = {}) {
  const from = f.from || U.today(), to = f.to || from;
  const vs = this.vouchers({ from, to, vtype: f.vtype, q: f.q, status: f.status });
  const rows = vs.map(v => ({ date: v.date, party: v.party_name || '', vtype: VTYPES[v.vtype].name, number: v.number, narration: v.narration || '', amount: v.total, status: v.status !== 'active' ? v.status.toUpperCase() : '', user: v.created_by, _drill: { voucher: v.id } }));
  return { title: 'Day Book', subtitle: `${U.fmtDate(from)} to ${U.fmtDate(to)}`, columns: [C('date', 'Date', 'date'), C('party', 'Particulars'), C('vtype', 'Vch Type'), C('number', 'Vch No.'), C('narration', 'Narration'), C('amount', 'Amount (₹)', 'amt'), C('status', 'Status'), C('user', 'User')], rows,
    foot: { party: rows.length + ' vouchers', amount: r2(vs.filter(v => v.status === 'active').reduce((s, v) => s + v.total, 0)) } };
};
P.ledgerStatement = function (f = {}) {
  const l = this.ledger(f.ledger_id); if (!l) throw new Error('Select a ledger');
  const { from, to } = this.periodDefaults(f);
  const B = this.balances(from, to); const lb = B.led[l.id];
  let open = lb.opening; if (l.id === B.plId) open = r2(open - B.priorProfit);
  const es = this.all(`SELECT e.*, v.date, v.vtype, v.number, v.narration, v.id AS vid, v.ref_no FROM entries e JOIN vouchers v ON v.id=e.voucher_id WHERE e.ledger_id=? AND v.status='active' AND v.date BETWEEN ? AND ? ORDER BY v.date, v.id`, [l.id, from, to]);
  let bal = open, tdr = 0, tcr = 0;
  const rows = [{ date: from, part: 'Opening Balance', dr: open > 0 ? open : null, cr: open < 0 ? -open : null, bal: U.drcr(open), _b: true }];
  for (const e of es) { bal = r2(bal + e.dr - e.cr); tdr += e.dr; tcr += e.cr;
    rows.push({ date: e.date, part: this.oppositeName(e.vid, l.id), vtype: VTYPES[e.vtype].name, number: e.number, narr: e.line_narr || e.narration || '', dr: e.dr || null, cr: e.cr || null, bal: U.drcr(bal), _drill: { voucher: e.vid } }); }
  rows.push({ part: 'Closing Balance', dr: bal > 0 ? bal : null, cr: bal < 0 ? -bal : null, bal: U.drcr(bal), _b: true });
  const addr = [l.address, l.city, l.pincode].filter(Boolean).join(', ');
  return { title: 'Ledger: ' + l.name, subtitle: `${l.group_name}${l.gstin ? ' · GSTIN ' + l.gstin : ''}${addr ? ' · ' + addr : ''} · ${U.fmtDate(from)} to ${U.fmtDate(to)}`,
    columns: [C('date', 'Date', 'date'), C('part', 'Particulars'), C('vtype', 'Vch Type'), C('number', 'Vch No.'), C('narr', 'Narration'), C('dr', 'Debit (₹)', 'amt'), C('cr', 'Credit (₹)', 'amt'), C('bal', 'Balance', 'text', { align: 'right' })],
    rows, foot: { part: 'Transactions total', dr: r2(tdr), cr: r2(tcr) }, meta: { opening: open, closing: bal, ledger: { id: l.id, name: l.name, email: l.email, phone: l.phone } } };
};
P.cashBook = function (f = {}) {
  const cash = this.ledgers({ groupName: 'Cash-in-Hand' }); const id = f.ledger_id || (cash[0] && cash[0].id);
  const r = this.ledgerStatement(Object.assign({}, f, { ledger_id: id })); r.title = 'Cash Book: ' + r.meta.ledger.name; return r;
};
P.bankBook = function (f = {}) {
  const banks = this.ledgers({ groupNames: ['Bank Accounts', 'Bank OD A/c'] }); const id = f.ledger_id || (banks[0] && banks[0].id);
  if (!id) throw new Error('No bank ledger yet. Create one under the "Bank Accounts" group (Alt+C → Ledger).');
  const r = this.ledgerStatement(Object.assign({}, f, { ledger_id: id })); r.title = 'Bank Book: ' + r.meta.ledger.name; return r;
};
P.register = function (f = {}) {
  const { from, to } = this.periodDefaults(f); const vt = f.vtype || 'SAL'; const T = VTYPES[vt];
  const vs = this.all(`SELECT v.*, p.name AS party_name, p.gstin FROM vouchers v LEFT JOIN ledgers p ON p.id=v.party_id WHERE v.vtype=? AND v.date BETWEEN ? AND ? ORDER BY v.date, v.seq`, [vt, from, to]);
  const rows = vs.map(v => ({ date: v.date, number: v.number, party: v.party_name, gstin: v.gstin || '', ref: v.ref_no || '', taxable: T.items ? v.taxable : null, cgst: v.cgst || null, sgst: v.sgst || null, igst: v.igst || null, cess: v.cess || null, total: v.total, status: v.status === 'active' ? '' : v.status.toUpperCase(), _drill: { voucher: v.id } }));
  const act = vs.filter(v => v.status === 'active'); const s = k => r2(act.reduce((a, v) => a + (v[k] || 0), 0));
  const cols = T.items ? [C('date', 'Date', 'date'), C('number', 'Vch No.'), C('party', 'Party'), C('gstin', 'GSTIN'), C('ref', 'Ref No.'), C('taxable', 'Taxable (₹)', 'amt'), C('cgst', 'CGST', 'amt'), C('sgst', 'SGST', 'amt'), C('igst', 'IGST', 'amt'), C('cess', 'Cess', 'amt'), C('total', 'Total (₹)', 'amt'), C('status', 'Status')]
    : [C('date', 'Date', 'date'), C('number', 'Vch No.'), C('party', 'Particulars'), C('ref', 'Ref No.'), C('total', 'Amount (₹)', 'amt'), C('status', 'Status')];
  return { title: T.name + ' Register', subtitle: `${U.fmtDate(from)} to ${U.fmtDate(to)}`, columns: cols, rows, foot: { party: act.length + ' vouchers', taxable: T.items ? s('taxable') : null, cgst: s('cgst'), sgst: s('sgst'), igst: s('igst'), cess: s('cess'), total: s('total') } };
};
P.monthlySummary = function (f = {}) {
  const { from, to } = this.periodDefaults(f);
  const m = this.all(`SELECT substr(v.date,1,7) AS ym, v.vtype, SUM(v.taxable) AS taxable, SUM(v.total) AS total, SUM(v.cgst+v.sgst+v.igst+v.cess) AS tax FROM vouchers v WHERE v.status='active' AND v.date BETWEEN ? AND ? GROUP BY ym, v.vtype`, [from, to]);
  const months = []; let d = from.slice(0, 7); while (d <= to.slice(0, 7)) { months.push(d); const [y, mm] = d.split('-').map(Number); d = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`; }
  const MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const g = (ym, t, k) => r2((m.find(x => x.ym === ym && x.vtype === t) || {})[k] || 0);
  const rows = months.map(ym => ({ month: MN[+ym.slice(5) - 1] + '-' + ym.slice(2, 4), sales: r2(g(ym, 'SAL', 'taxable') - g(ym, 'CRN', 'taxable')), purchase: r2(g(ym, 'PUR', 'taxable') - g(ym, 'DBN', 'taxable')),
    outTax: r2(g(ym, 'SAL', 'tax') - g(ym, 'CRN', 'tax')), inTax: r2(g(ym, 'PUR', 'tax') - g(ym, 'DBN', 'tax')), receipts: g(ym, 'RCT', 'total'), payments: g(ym, 'PMT', 'total') }));
  const foot = { month: 'Total' }; for (const k of ['sales','purchase','outTax','inTax','receipts','payments']) foot[k] = r2(rows.reduce((s, r) => s + r[k], 0));
  return { title: 'Monthly Business Summary', subtitle: `${U.fmtDate(from)} to ${U.fmtDate(to)}`, chart: { x: 'month', series: ['sales', 'purchase'] },
    columns: [C('month', 'Month'), C('sales', 'Net Sales (₹)', 'amt'), C('purchase', 'Net Purchase (₹)', 'amt'), C('outTax', 'Output GST', 'amt'), C('inTax', 'Input GST', 'amt'), C('receipts', 'Receipts', 'amt'), C('payments', 'Payments', 'amt')], rows, foot };
};
