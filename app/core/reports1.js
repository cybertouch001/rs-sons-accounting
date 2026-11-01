
// R&S Sons Accounting - reports (financial, inventory, GST, MIS)
const U = require('./util');
const { Company, VTYPES } = require('./company');
const r2 = U.r2;
const C = (k, label, t = 'text', extra = {}) => Object.assign({ k, label, t }, extra);
const P = Company.prototype;

P.periodDefaults = function (f = {}) { const fy = U.fyOf(f.to || f.from || U.today()); return { from: f.from || fy.start, to: f.to || fy.end }; };
P.dayBefore = function (d) { return U.addDays(d, -1); };

// ---------------- stock valuation ----------------
P.stockMoves = function (to, from) {
  return this.all(`SELECT vi.item_id, vi.qty, vi.rate, vi.taxable, vi.direction, vi.godown_id, vi.batch_no, vi.exp_date, v.vtype, v.date, v.id AS voucher_id, v.number
    FROM vitems vi JOIN vouchers v ON v.id=vi.voucher_id WHERE v.status='active' AND vi.direction<>0 AND v.date<=? ${from ? 'AND v.date>=?' : ''} ORDER BY v.date, v.id`, from ? [to, from] : [to]);
};
P.stockValuation = function (asOf, itemIds, method) {
  method = method || this.setting('stock_method') || 'AVG';
  const items = this.all(`SELECT id, name, opening_qty, opening_rate, purchase_rate, item_type FROM items ${itemIds ? 'WHERE id IN (' + itemIds.map(Number).join(',') + ')' : ''}`);
  const res = {};
  for (const it of items) res[it.id] = { id: it.id, name: it.name, service: it.item_type === 'Service', qty: it.opening_qty || 0, inQty: it.opening_qty || 0, inVal: r2((it.opening_qty || 0) * (it.opening_rate || 0)), lots: it.opening_qty ? [{ q: it.opening_qty, r: it.opening_rate || 0 }] : [], last: it.opening_rate || it.purchase_rate || 0, fallback: it.purchase_rate || it.opening_rate || 0 };
  const bb = this.setting('books_begin');
  const moves = asOf < bb ? [] : this.stockMoves(asOf);
  for (const m of moves) {
    const s = res[m.item_id]; if (!s) continue;
    const q = m.qty * m.direction; s.qty = U.r3(s.qty + q);
    if (m.vtype === 'PUR' || ((m.vtype === 'STJ' || m.vtype === 'PRD') && m.direction > 0)) {
      const val = m.vtype === 'PUR' ? m.taxable : r2(m.qty * m.rate); s.inQty += m.qty; s.inVal += val; s.lots.push({ q: m.qty, r: m.qty ? val / m.qty : 0 }); if (m.qty) s.last = val / m.qty;
    } else if (m.vtype === 'DBN') { s.inQty -= m.qty; s.inVal -= m.taxable; }
  }
  for (const id in res) {
    const s = res[id]; let rate;
    if (method === 'FIFO') {
      let need = Math.max(0, s.qty), val = 0;
      for (let i = s.lots.length - 1; i >= 0 && need > 0; i--) { const t = Math.min(need, s.lots[i].q); val += t * s.lots[i].r; need -= t; }
      if (need > 0) val += need * (s.fallback || 0);
      rate = s.qty > 0 ? val / s.qty : (s.inQty > 0 ? s.inVal / s.inQty : s.fallback);
    } else if (method === 'LAST') rate = s.last || s.fallback;
    else rate = s.inQty > 0.0005 ? s.inVal / s.inQty : s.fallback;
    s.rate = r2(rate || 0);
    s.value = s.service ? 0 : r2(Math.max(0, s.qty) * (rate || 0));
    delete s.lots;
  }
  return res;
};
P.stockValue = function (asOf) { let t = 0; const v = this.stockValuation(asOf); for (const k in v) t += v[k].value; return r2(t); };
P.openingStockOriginal = function () { return r2(this.val("SELECT COALESCE(SUM(opening_qty*opening_rate),0) FROM items WHERE item_type<>'Service'") || 0); };

// ---------------- ledger balances for a period ----------------
P.balances = function (from, to) {
  const bb = this.setting('books_begin');
  const inclOpen = from <= bb;
  const rows = this.all(`SELECT l.id, l.name, l.group_id, l.opening, l.tax_type, g.nature,
     COALESCE((SELECT SUM(e.dr) FROM entries e JOIN vouchers v ON v.id=e.voucher_id WHERE e.ledger_id=l.id AND v.status='active' AND v.date<=?),0) AS dr_to,
     COALESCE((SELECT SUM(e.cr) FROM entries e JOIN vouchers v ON v.id=e.voucher_id WHERE e.ledger_id=l.id AND v.status='active' AND v.date<=?),0) AS cr_to,
     COALESCE((SELECT SUM(e.dr-e.cr) FROM entries e JOIN vouchers v ON v.id=e.voucher_id WHERE e.ledger_id=l.id AND v.status='active' AND v.date<?),0) AS before
     FROM ledgers l JOIN groups g ON g.id=l.group_id`, [to, to, from]);
  const out = {}; let priorIE = 0;
  for (const r of rows) {
    const isPL = r.nature === 'I' || r.nature === 'E';
    let bal;
    if (isPL) { bal = r2(r.dr_to - r.cr_to - r.before + (inclOpen ? r.opening : 0)); priorIE += r.before + (inclOpen ? 0 : r.opening); }
    else bal = r2(r.opening + r.dr_to - r.cr_to);
    out[r.id] = { id: r.id, name: r.name, group_id: r.group_id, nature: r.nature, tax_type: r.tax_type, bal, opening: isPL ? (inclOpen ? r.opening : 0) : r2(r.opening + r.before) };
  }
  const os0 = this.openingStockOriginal();
  const osFrom = from <= bb ? os0 : this.stockValue(this.dayBefore(from));
  const priorProfit = r2(-priorIE + osFrom - os0);
  const pl = Object.values(out).find(x => x.tax_type === 'PL');
  return { led: out, priorProfit, osFrom, os0, plId: pl && pl.id };
};
P.groupTree = function () {
  const groups = this.all('SELECT * FROM groups ORDER BY sort, name');
  const byParent = {}; for (const g of groups) (byParent[g.parent_id || 0] = byParent[g.parent_id || 0] || []).push(g);
  return { groups, byParent };
};

// ---------------- Trial balance ----------------
P.trialBalance = function (f = {}) {
  const { from, to } = this.periodDefaults(f);
  const detailed = f.detailed !== false && f.detailed !== 'false';
  const B = this.balances(from, to);
  const { byParent } = this.groupTree();
  const ledByGroup = {}; for (const l of Object.values(B.led)) (ledByGroup[l.group_id] = ledByGroup[l.group_id] || []).push(l);
  const balOf = l => l.id === B.plId ? r2(l.bal - B.priorProfit) : l.bal;
  const gTotal = g => { let t = 0; for (const l of (ledByGroup[g.id] || [])) t += balOf(l); for (const c of (byParent[g.id] || [])) t += gTotal(c); return r2(t); };
  const gHas = g => (ledByGroup[g.id] || []).some(l => Math.abs(balOf(l)) > 0.005) || (byParent[g.id] || []).some(gHas);
  const rows = []; let tdr = 0, tcr = 0;
  const addGroup = (g, lvl) => {
    if (!gHas(g)) return;
    const t = gTotal(g);
    rows.push({ name: g.name, dr: t > 0 ? t : null, cr: t < 0 ? -t : null, _b: lvl === 0, _l: lvl, _drill: { r: 'groupSummary', a: { group_id: g.id, from, to } } });
    if (lvl === 0) { if (t > 0) tdr += t; else tcr -= t; }
    if (!detailed) return;
    for (const c of (byParent[g.id] || [])) addGroup(c, lvl + 1);
    for (const l of (ledByGroup[g.id] || []).sort((a, b) => a.name.localeCompare(b.name))) { const b = balOf(l); if (Math.abs(b) < 0.005) continue; rows.push({ name: l.name, dr: b > 0 ? b : null, cr: b < 0 ? -b : null, _l: lvl + 1, _drill: { r: 'ledgerStatement', a: { ledger_id: l.id, from, to } } }); }
  };
  for (const g of (byParent[0] || [])) addGroup(g, 0);
  if (B.osFrom) { rows.push({ name: 'Opening Stock', dr: B.osFrom, _b: true, _l: 0, _drill: { r: 'stockSummary', a: { from, to } } }); tdr += B.osFrom; }
  const diff = r2(tdr - tcr);
  if (Math.abs(diff) > 0.005) { rows.push({ name: 'Difference in Opening Balances', dr: diff < 0 ? -diff : null, cr: diff > 0 ? diff : null, _b: true, _warn: true }); if (diff < 0) tdr -= diff; else tcr += diff; }
  return { title: 'Trial Balance', subtitle: `${U.fmtDate(from)} to ${U.fmtDate(to)}`, columns: [C('name', 'Particulars'), C('dr', 'Debit (₹)', 'amt'), C('cr', 'Credit (₹)', 'amt')], rows,
    foot: { name: 'Grand Total', dr: r2(tdr), cr: r2(tcr) }, meta: { balanced: Math.abs(r2(tdr) - r2(tcr)) < 0.01, diff } };
};
P.groupSummary = function (f = {}) {
  const { from, to } = this.periodDefaults(f);
  const g = this.get('SELECT * FROM groups WHERE id=?', [f.group_id]); if (!g) throw new Error('Group not found');
  const B = this.balances(from, to); const { byParent } = this.groupTree();
  const rows = []; let tdr = 0, tcr = 0;
  const balOf = l => l.id === B.plId ? r2(l.bal - B.priorProfit) : l.bal;
  const sumG = gid => { const ids = this.groupDescendants(gid); let t = 0; for (const l of Object.values(B.led)) if (ids.includes(l.group_id)) t += balOf(l); return r2(t); };
  for (const c of (byParent[g.id] || [])) { const t = sumG(c.id); if (Math.abs(t) < 0.005) continue; rows.push({ name: c.name, dr: t > 0 ? t : null, cr: t < 0 ? -t : null, _b: true, _drill: { r: 'groupSummary', a: { group_id: c.id, from, to } } }); }
  for (const l of Object.values(B.led).filter(l => l.group_id === g.id).sort((a, b) => a.name.localeCompare(b.name))) { const b = balOf(l); if (Math.abs(b) < 0.005) continue; rows.push({ name: l.name, dr: b > 0 ? b : null, cr: b < 0 ? -b : null, _drill: { r: 'ledgerStatement', a: { ledger_id: l.id, from, to } } }); }
  for (const r of rows) { tdr += r.dr || 0; tcr += r.cr || 0; }
  return { title: 'Group Summary: ' + g.name, subtitle: `${U.fmtDate(from)} to ${U.fmtDate(to)}`, columns: [C('name', 'Particulars'), C('dr', 'Debit (₹)', 'amt'), C('cr', 'Credit (₹)', 'amt')], rows, foot: { name: 'Total', dr: r2(tdr), cr: r2(tcr) } };
};
module.exports = { C, P };
