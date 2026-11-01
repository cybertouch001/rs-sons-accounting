
// R&S Sons Accounting - inventory & outstanding reports
const U = require('./util');
const { VTYPES } = require('./company');
const { C, P } = require('./reports1');
const r2 = U.r2;

P.stockSummary = function (f = {}) {
  const { from, to } = this.periodDefaults(f);
  const bb = this.setting('books_begin');
  const op = from <= bb ? null : this.stockValuation(this.dayBefore(from));
  const cl = this.stockValuation(to);
  const mv = this.stockMoves(to, from);
  const items = this.all("SELECT i.id, i.name, i.opening_qty, i.opening_rate, u.name AS unit, g.name AS grp, i.min_stock FROM items i LEFT JOIN units u ON u.id=i.unit_id LEFT JOIN item_groups g ON g.id=i.group_id WHERE i.item_type<>'Service' ORDER BY g.name, i.name");
  const rows = []; const T = { ov: 0, iv: 0, outv: 0, cv: 0 };
  for (const it of items) {
    const o = op ? op[it.id] : { qty: it.opening_qty || 0, value: r2((it.opening_qty || 0) * (it.opening_rate || 0)) };
    const c = cl[it.id];
    let iq = 0, iv = 0, oq = 0;
    for (const m of mv) { if (m.item_id !== it.id) continue; if (m.direction > 0) { iq += m.qty; iv += m.vtype === 'PUR' ? m.taxable : m.vtype === 'CRN' ? m.qty * c.rate : m.qty * m.rate; } else oq += m.qty; }
    iv = r2(iv); const outv = r2(o.value + iv - c.value);
    if (!o.qty && !iq && !oq && !c.qty) continue;
    rows.push({ grp: it.grp || '', name: it.name, unit: it.unit || '', oq: U.r3(o.qty), ov: o.value, iq: U.r3(iq), iv, outq: U.r3(oq), outv, cq: c.qty, rate: c.rate, cv: c.value, _warn: it.min_stock && c.qty < it.min_stock, _drill: { r: 'itemLedger', a: { item_id: it.id, from, to } } });
    T.ov += o.value; T.iv += iv; T.outv += outv; T.cv += c.value;
  }
  return { title: 'Stock Summary', subtitle: `${U.fmtDate(from)} to ${U.fmtDate(to)} · valuation: ${{ AVG: 'Weighted Average', FIFO: 'FIFO', LAST: 'Last Purchase Rate' }[this.setting('stock_method') || 'AVG']}`,
    columns: [C('grp', 'Group'), C('name', 'Item'), C('unit', 'Unit'), C('oq', 'Op. Qty', 'qty'), C('ov', 'Op. Value', 'amt'), C('iq', 'In Qty', 'qty'), C('iv', 'In Value', 'amt'), C('outq', 'Out Qty', 'qty'), C('outv', 'Out Value (cost)', 'amt'), C('cq', 'Closing Qty', 'qty'), C('rate', 'Rate', 'amt'), C('cv', 'Closing Value', 'amt')],
    rows, foot: { name: 'Total', ov: r2(T.ov), iv: r2(T.iv), outv: r2(T.outv), cv: r2(T.cv) } };
};
P.itemLedger = function (f = {}) {
  const it = this.item(f.item_id); if (!it) throw new Error('Select an item');
  const { from, to } = this.periodDefaults(f); const bb = this.setting('books_begin');
  const o = from <= bb ? { qty: it.opening_qty || 0 } : this.stockValuation(this.dayBefore(from), [it.id])[it.id];
  let bal = o.qty;
  const mv = this.all(`SELECT vi.*, v.date, v.vtype, v.number, v.id AS vid, p.name AS party, g.name AS godown FROM vitems vi JOIN vouchers v ON v.id=vi.voucher_id LEFT JOIN ledgers p ON p.id=v.party_id LEFT JOIN godowns g ON g.id=vi.godown_id WHERE vi.item_id=? AND v.status='active' AND vi.direction<>0 AND v.date BETWEEN ? AND ? ORDER BY v.date, v.id`, [it.id, from, to]);
  const rows = [{ part: 'Opening Balance', bal: U.r3(bal), _b: true }];
  for (const m of mv) { bal = U.r3(bal + m.qty * m.direction); rows.push({ date: m.date, part: m.party || (m.vtype === 'STJ' ? 'Stock Journal' : m.vtype === 'PRD' ? 'Production' : ''), vtype: VTYPES[m.vtype].name, number: m.number, godown: m.godown, batch: m.batch_no || '', inq: m.direction > 0 ? m.qty : null, outq: m.direction < 0 ? m.qty : null, rate: m.rate, bal, _drill: { voucher: m.vid } }); }
  rows.push({ part: 'Closing Balance', bal, _b: true });
  return { title: 'Stock Item Ledger: ' + it.name, subtitle: `${it.unit_name || ''} · HSN ${it.hsn || '-'} · ${U.fmtDate(from)} to ${U.fmtDate(to)}`,
    columns: [C('date', 'Date', 'date'), C('part', 'Particulars'), C('vtype', 'Vch Type'), C('number', 'Vch No.'), C('godown', 'Godown'), C('batch', 'Batch'), C('inq', 'Inward', 'qty'), C('outq', 'Outward', 'qty'), C('rate', 'Rate', 'amt'), C('bal', 'Balance Qty', 'qty')], rows };
};
P.godownStock = function (f = {}) {
  const to = f.to || U.today();
  const rows = this.all(`SELECT i.name AS item, g.name AS godown, SUM(q) AS qty FROM (
      SELECT item_id, godown_id, qty*direction AS q FROM vitems vi JOIN vouchers v ON v.id=vi.voucher_id WHERE v.status='active' AND vi.direction<>0 AND v.date<=?
      UNION ALL SELECT id, opening_godown_id, opening_qty FROM items WHERE opening_qty<>0) x JOIN items i ON i.id=x.item_id LEFT JOIN godowns g ON g.id=x.godown_id
      WHERE i.item_type<>'Service' GROUP BY i.id, g.id HAVING ABS(SUM(q))>0.0001 ORDER BY g.name, i.name`, [to]).map(r => ({ ...r, qty: U.r3(r.qty) }));
  return { title: 'Godown-wise Stock', subtitle: 'as on ' + U.fmtDate(to), columns: [C('godown', 'Godown'), C('item', 'Item'), C('qty', 'Quantity', 'qty')], rows };
};
P.batchStock = function (f = {}) {
  const to = f.to || U.today();
  const rows = this.all(`SELECT i.name AS item, vi.batch_no AS batch, MAX(vi.mfg_date) AS mfg, MAX(vi.exp_date) AS exp, SUM(vi.qty*vi.direction) AS qty FROM vitems vi JOIN vouchers v ON v.id=vi.voucher_id JOIN items i ON i.id=vi.item_id
     WHERE v.status='active' AND vi.direction<>0 AND v.date<=? AND vi.batch_no IS NOT NULL AND vi.batch_no<>'' GROUP BY i.id, vi.batch_no HAVING ABS(SUM(vi.qty*vi.direction))>0.0001 ORDER BY exp, i.name`, [to])
    .map(r => { const days = r.exp ? U.daysBetween(to, r.exp) : null; return { ...r, qty: U.r3(r.qty), days, status: days == null ? '' : days < 0 ? 'EXPIRED' : days <= 90 ? 'Expiring soon' : 'OK', _warn: days != null && days <= 90 }; });
  return { title: 'Batch-wise Stock & Expiry', subtitle: 'as on ' + U.fmtDate(to), columns: [C('item', 'Item'), C('batch', 'Batch No.'), C('mfg', 'Mfg Date', 'date'), C('exp', 'Expiry Date', 'date'), C('qty', 'Qty', 'qty'), C('days', 'Days to Expiry', 'num'), C('status', 'Status')], rows };
};
P.reorderReport = function (f = {}) {
  const to = f.to || U.today(); const v = this.stockValuation(to);
  const rows = this.all("SELECT i.id, i.name, i.min_stock, i.max_stock, u.name AS unit FROM items i LEFT JOIN units u ON u.id=i.unit_id WHERE i.item_type<>'Service' AND (i.min_stock>0 OR i.max_stock>0) ORDER BY i.name")
    .map(i => { const q = v[i.id].qty; return { name: i.name, unit: i.unit, stock: q, min: i.min_stock, max: i.max_stock, order: i.min_stock && q < i.min_stock ? U.r3((i.max_stock || i.min_stock) - q) : null, status: q <= 0 ? 'OUT OF STOCK' : i.min_stock && q < i.min_stock ? 'Reorder' : i.max_stock && q > i.max_stock ? 'Excess' : 'OK', _warn: !!(i.min_stock && q < i.min_stock), _drill: { r: 'itemLedger', a: { item_id: i.id } } }; });
  return { title: 'Reorder Level / Min-Max Stock', subtitle: 'as on ' + U.fmtDate(to), columns: [C('name', 'Item'), C('unit', 'Unit'), C('stock', 'In Stock', 'qty'), C('min', 'Min Level', 'qty'), C('max', 'Max Level', 'qty'), C('order', 'Suggested Order', 'qty'), C('status', 'Status')], rows };
};
P.slowMoving = function (f = {}) {
  const to = f.to || U.today(); const v = this.stockValuation(to);
  const rows = this.all("SELECT i.id, i.name, (SELECT MAX(v.date) FROM vitems vi JOIN vouchers v ON v.id=vi.voucher_id WHERE vi.item_id=i.id AND v.vtype='SAL' AND v.status='active' AND v.date<=?) AS last_sale FROM items i WHERE i.item_type<>'Service'", [to])
    .filter(r => v[r.id].qty > 0).map(r => { const days = r.last_sale ? U.daysBetween(r.last_sale, to) : null; return { name: r.name, qty: v[r.id].qty, value: v[r.id].value, last: r.last_sale || '', days, status: days == null ? 'Never sold' : days > 180 ? 'Dead stock' : days > 60 ? 'Slow moving' : 'Moving', _warn: days == null || days > 60, _drill: { r: 'itemLedger', a: { item_id: r.id } } }; })
    .sort((a, b) => (b.days == null ? 1e9 : b.days) - (a.days == null ? 1e9 : a.days));
  return { title: 'Slow-moving / Dead Stock', subtitle: 'as on ' + U.fmtDate(to), columns: [C('name', 'Item'), C('qty', 'Stock Qty', 'qty'), C('value', 'Stock Value', 'amt'), C('last', 'Last Sale', 'date'), C('days', 'Days since sale', 'num'), C('status', 'Status')], rows };
};
P.itemAnalysis = function (f = {}) {
  const { from, to } = this.periodDefaults(f); const side = f.side || 'sale';
  const types = side === 'sale' ? ['SAL', 'CRN'] : ['PUR', 'DBN'];
  const val = this.stockValuation(to);
  const rows = this.all(`SELECT i.id, i.name, u.name AS unit, SUM(CASE WHEN v.vtype=? THEN vi.qty ELSE -vi.qty END) AS qty, SUM(CASE WHEN v.vtype=? THEN vi.taxable ELSE -vi.taxable END) AS value
     FROM vitems vi JOIN vouchers v ON v.id=vi.voucher_id JOIN items i ON i.id=vi.item_id LEFT JOIN units u ON u.id=i.unit_id WHERE v.status='active' AND v.vtype IN (?,?) AND v.date BETWEEN ? AND ? GROUP BY i.id ORDER BY value DESC`, [types[0], types[0], types[0], types[1], from, to])
    .map(r => { const o = { name: r.name, unit: r.unit, qty: U.r3(r.qty), value: r2(r.value), avg: r.qty ? r2(r.value / r.qty) : 0, _drill: { r: 'itemLedger', a: { item_id: r.id, from, to } } };
      if (side === 'sale') { const svc = val[r.id] && val[r.id].service; o.cost = svc ? 0 : r2(r.qty * (val[r.id] ? val[r.id].rate : 0)); o.profit = r2(o.value - o.cost); o.margin = o.value ? r2(o.profit * 100 / o.value) : 0; } return o; });
  const cols = [C('name', 'Item'), C('unit', 'Unit'), C('qty', 'Qty', 'qty'), C('value', 'Value (₹)', 'amt'), C('avg', 'Avg Rate', 'amt')];
  if (side === 'sale') cols.push(C('cost', 'Cost (₹)', 'amt'), C('profit', 'Gross Profit', 'amt'), C('margin', 'Margin %', 'num'));
  const foot = { name: 'Total', value: r2(rows.reduce((s, r) => s + r.value, 0)) }; if (side === 'sale') { foot.cost = r2(rows.reduce((s, r) => s + r.cost, 0)); foot.profit = r2(foot.value - foot.cost); foot.margin = foot.value ? r2(foot.profit * 100 / foot.value) : 0; }
  return { title: side === 'sale' ? 'Item-wise Sales & Profitability' : 'Item-wise Purchase Analysis', subtitle: `${U.fmtDate(from)} to ${U.fmtDate(to)}`, columns: cols, rows, foot, chart: { x: 'name', series: ['value'], limit: 10 } };
};
P.partyAnalysis = function (f = {}) {
  const { from, to } = this.periodDefaults(f); const side = f.side || 'sale';
  const types = side === 'sale' ? ['SAL', 'CRN'] : ['PUR', 'DBN'];
  const rows = this.all(`SELECT p.id, p.name, p.gstin, COUNT(CASE WHEN v.vtype=? THEN 1 END) AS bills, SUM(CASE WHEN v.vtype=? THEN v.taxable ELSE -v.taxable END) AS taxable, SUM(CASE WHEN v.vtype=? THEN v.total ELSE -v.total END) AS total
    FROM vouchers v JOIN ledgers p ON p.id=v.party_id WHERE v.status='active' AND v.vtype IN (?,?) AND v.date BETWEEN ? AND ? GROUP BY p.id ORDER BY total DESC`, [types[0], types[0], types[0], types[0], types[1], from, to])
    .map(r => ({ name: r.name, gstin: r.gstin || '', bills: r.bills, taxable: r2(r.taxable), total: r2(r.total), _drill: { r: 'ledgerStatement', a: { ledger_id: r.id, from, to } } }));
  return { title: side === 'sale' ? 'Party-wise Sales' : 'Party-wise Purchase', subtitle: `${U.fmtDate(from)} to ${U.fmtDate(to)}`, chart: { x: 'name', series: ['total'], limit: 10 },
    columns: [C('name', 'Party'), C('gstin', 'GSTIN'), C('bills', 'Bills', 'num'), C('taxable', 'Taxable (₹)', 'amt'), C('total', 'Total incl. GST (₹)', 'amt')], rows,
    foot: { name: 'Total', taxable: r2(rows.reduce((s, r) => s + r.taxable, 0)), total: r2(rows.reduce((s, r) => s + r.total, 0)) } };
};
P.salesmanReport = function (f = {}) {
  const { from, to } = this.periodDefaults(f);
  const rows = this.all(`SELECT s.name, s.commission_pct AS pct, COUNT(v.id) AS bills, SUM(CASE WHEN v.vtype='SAL' THEN v.taxable ELSE -v.taxable END) AS sales FROM vouchers v JOIN salesmen s ON s.id=v.salesman_id WHERE v.status='active' AND v.vtype IN ('SAL','CRN') AND v.date BETWEEN ? AND ? GROUP BY s.id ORDER BY sales DESC`, [from, to])
    .map(r => ({ ...r, sales: r2(r.sales), commission: r2(r.sales * (r.pct || 0) / 100) }));
  return { title: 'Salesman-wise Sales & Commission', subtitle: `${U.fmtDate(from)} to ${U.fmtDate(to)}`, columns: [C('name', 'Salesman'), C('bills', 'Bills', 'num'), C('sales', 'Net Sales (₹)', 'amt'), C('pct', 'Commission %', 'num'), C('commission', 'Commission (₹)', 'amt')], rows,
    foot: { name: 'Total', sales: r2(rows.reduce((s, r) => s + r.sales, 0)), commission: r2(rows.reduce((s, r) => s + r.commission, 0)) } };
};
P.outstanding = function (f = {}) {
  const kind = f.kind || 'receivable'; const asOf = f.to || U.today();
  const grp = kind === 'receivable' ? 'Sundry Debtors' : 'Sundry Creditors'; const sign = kind === 'receivable' ? 1 : -1;
  const rows = []; const B = { b0: 0, b30: 0, b60: 0, b90: 0, b180: 0, total: 0 }; const byParty = [];
  for (const p of this.ledgers({ groupName: grp })) {
    let bills;
    if (p.bill_wise) bills = this.pendingBills(p.id, asOf);
    else { const bal = this.ledgerBalance(p.id, asOf); bills = Math.abs(bal) > 0.005 ? [{ ref: 'Balance (not bill-wise)', date: asOf, due: asOf, amount: bal, billAmount: bal }] : []; }
    if (!bills.length) continue;
    const pr = { name: p.name, phone: p.phone || '', b0: 0, b30: 0, b60: 0, b90: 0, b180: 0, total: 0, limit: p.credit_limit || null, _drill: { r: 'ledgerStatement', a: { ledger_id: p.id } } };
    for (const b of bills) {
      const amt = r2(b.amount * sign); const age = b.date ? Math.max(0, U.daysBetween(f.byDue && b.due ? b.due : b.date, asOf)) : 0;
      const k = age <= 30 ? 'b0' : age <= 60 ? 'b30' : age <= 90 ? 'b60' : age <= 180 ? 'b90' : 'b180';
      pr[k] = r2(pr[k] + amt); pr.total = r2(pr.total + amt);
      const overdue = b.due ? U.daysBetween(b.due, asOf) : 0;
      rows.push({ party: p.name, ref: b.ref, date: b.date || '', due: b.due || '', billAmt: r2(b.billAmount * sign), pending: amt, age, overdue: overdue > 0 ? overdue : null, _warn: overdue > 0 && amt > 0, _drill: { r: 'ledgerStatement', a: { ledger_id: p.id } } });
    }
    if (Math.abs(pr.total) < 0.005) continue;
    pr._warn = !!(pr.limit && pr.total > pr.limit);
    byParty.push(pr); for (const k in B) B[k] = r2(B[k] + pr[k]);
  }
  const title = (kind === 'receivable' ? 'Receivables' : 'Payables');
  const od = this.overdueSummary(kind, asOf);
  const odNote = od.count ? ` · overdue ₹${U.inr(od.amount, 0)} in ${od.count} bill${od.count > 1 ? 's' : ''}` + (od.credits > 0.005 ? ` (after ₹${U.inr(od.credits, 0)} on-account / unadjusted credit)` : '') : '';
  const meta = { total: B.total, overdue: od.amount, overdueCount: od.count, overdueGross: od.gross, unadjusted: od.credits };
  if (f.detail) return { title: title + ' – Bill-wise Outstanding', subtitle: 'as on ' + U.fmtDate(asOf) + odNote, meta, columns: [C('party', 'Party'), C('ref', 'Bill / Ref'), C('date', 'Bill Date', 'date'), C('due', 'Due Date', 'date'), C('billAmt', 'Bill Amount', 'amt'), C('pending', 'Pending (₹)', 'amt'), C('age', 'Age (days)', 'num'), C('overdue', 'Overdue by', 'num')], rows, foot: { party: 'Total', pending: B.total } };
  byParty.sort((a, b) => b.total - a.total);
  return { title: title + ' – Ageing Analysis', subtitle: 'as on ' + U.fmtDate(asOf) + (f.byDue ? ' (by due date)' : ' (by bill date)') + odNote, meta, chart: { x: 'name', series: ['total'], limit: 10 },
    columns: [C('name', 'Party'), C('phone', 'Phone'), C('b0', '0-30 days', 'amt'), C('b30', '31-60', 'amt'), C('b60', '61-90', 'amt'), C('b90', '91-180', 'amt'), C('b180', '> 180', 'amt'), C('total', 'Total (₹)', 'amt'), C('limit', 'Credit Limit', 'amt')], rows: byParty, foot: Object.assign({ name: 'Total' }, B) };
};
P.interestReport = function (f = {}) {
  const asOf = f.to || U.today(); const defRate = Number(f.rate) || 18;
  const rows = [];
  for (const p of this.ledgers({ groupName: 'Sundry Debtors' })) {
    if (!p.bill_wise) continue; const rate = p.interest_rate || defRate;
    for (const b of this.pendingBills(p.id, asOf)) { if (b.onacc || b.amount <= 0) continue; const od = U.daysBetween(b.due || b.date, asOf); if (od <= 0) continue;
      rows.push({ party: p.name, ref: b.ref, date: b.date, due: b.due, pending: b.amount, days: od, rate, interest: r2(b.amount * rate / 100 * od / 365), _drill: { r: 'ledgerStatement', a: { ledger_id: p.id } } }); }
  }
  return { title: 'Interest on Overdue Receivables', subtitle: `as on ${U.fmtDate(asOf)} · default ${defRate}% p.a. (party rate overrides)`, columns: [C('party', 'Party'), C('ref', 'Bill'), C('date', 'Bill Date', 'date'), C('due', 'Due Date', 'date'), C('pending', 'Pending', 'amt'), C('days', 'Days Overdue', 'num'), C('rate', 'Rate %', 'num'), C('interest', 'Interest (₹)', 'amt')], rows,
    foot: { party: 'Total', pending: r2(rows.reduce((s, r) => s + r.pending, 0)), interest: r2(rows.reduce((s, r) => s + r.interest, 0)) } };
};
