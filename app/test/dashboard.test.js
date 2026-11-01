
// Dashboard vs reports consistency, on ONE data state (the app's own demo company).
// node test/dashboard.test.js
const assert = require('assert');
const initSqlJs = require('sql.js');
const { util: U } = require('../core');
const buildDemo = require('./demo-harness');
let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; console.log('  ✓ ' + m); };
const eq = (a, b, m) => { assert.ok(Math.abs(a - b) < 0.011, `${m}: ${a} != ${b}`); pass++; console.log(`  ✓ ${m} (${U.inr(a)})`); };
const row = (rep, name, side) => { const r = rep.rows.find(x => (side === 'L' ? x.lp : x.rp) === name); return r ? (side === 'L' ? r.la : r.ra) : 0; };
const tbRow = (tb, name) => { const r = tb.rows.find(x => x.name === name); return r ? (r.dr || 0) - (r.cr || 0) : 0; };

function checkState(c, label) {
  console.log(`\n[${label}]`);
  const today = U.today(); const fy = U.fyOf(today);
  const d = c.dashboard({});
  const bs = c.balanceSheet({ to: today });
  const pl = c.profitLoss({ from: fy.start, to: today });
  const tb = c.trialBalance({ from: fy.start, to: today });
  const rec = c.outstanding({ kind: 'receivable', to: today });
  const recD = c.outstanding({ kind: 'receivable', to: today, detail: true });
  const pay = c.outstanding({ kind: 'payable', to: today });
  ok(tb.meta.balanced, 'Trial Balance tallies');
  ok(bs.meta.balanced && Math.abs(bs.meta.openingDiff) < 0.01, 'Balance Sheet balances with no opening difference');
  eq(d.netProfit, pl.meta.netProfit, 'dashboard net profit = P&L net profit');
  eq(d.netProfit, bs.meta.netProfit, 'dashboard net profit = Balance Sheet current-period profit');
  eq(d.grossProfit, pl.meta.grossProfit, 'dashboard gross profit = P&L gross profit');
  eq(d.closingStock, pl.meta.closingStock, 'dashboard closing stock = P&L closing stock');
  eq(d.cash, row(bs, 'Cash-in-Hand', 'R'), 'dashboard cash = Balance Sheet Cash-in-Hand');
  eq(d.cash, tbRow(tb, 'Cash-in-Hand'), 'dashboard cash = Trial Balance Cash-in-Hand');
  const cb = c.cashBook({ from: fy.start, to: today });
  if (cb.meta && cb.meta.closing !== undefined) eq(d.cash, cb.meta.closing, 'dashboard cash = Cash Book closing');
  eq(d.bankTotal, row(bs, 'Bank Accounts', 'R'), 'dashboard bank = Balance Sheet Bank Accounts');
  eq(d.bankTotal, tbRow(tb, 'Bank Accounts'), 'dashboard bank = Trial Balance Bank Accounts');
  eq(d.receivables, row(bs, 'Sundry Debtors', 'R'), 'dashboard receivables = Balance Sheet Sundry Debtors');
  eq(d.receivables, tbRow(tb, 'Sundry Debtors'), 'dashboard receivables = Trial Balance Sundry Debtors');
  eq(d.receivables, rec.meta.total, 'dashboard receivables = Outstanding (ageing) total');
  eq(d.receivables, recD.foot.pending, 'dashboard receivables = Bill-wise outstanding total');
  eq(d.payables, row(bs, 'Sundry Creditors', 'L'), 'dashboard payables = Balance Sheet Sundry Creditors');
  eq(d.payables, -tbRow(tb, 'Sundry Creditors'), 'dashboard payables = Trial Balance Sundry Creditors');
  eq(d.payables, pay.meta.total, 'dashboard payables = Payables outstanding total');
  eq(d.sales, pl.meta.sales, 'dashboard net sales = P&L Sales Accounts');
  eq(d.overdueAmt, rec.meta.overdue, 'dashboard overdue = Outstanding report overdue');
  ok(d.overdue === rec.meta.overdueCount, `dashboard overdue bill count = Outstanding report count (${d.overdue})`);
  // overdue can never exceed what customers actually owe
  let grossOwed = 0;
  for (const p of c.ledgers({ groupName: 'Sundry Debtors' })) { const b = c.ledgerBalance(p.id, today); if (b > 0) grossOwed += b; }
  ok(d.overdueAmt <= grossOwed + 0.01, `overdue ₹${U.inr(d.overdueAmt)} ≤ receivables gross ₹${U.inr(grossOwed)}`);
  const od = c.overdueSummary('receivable', today);
  for (const p of od.parties) ok(p.amount <= c.ledgerBalance(p.id, today) + 0.01, `${p.name}: overdue ₹${U.inr(p.amount)} ≤ its balance ₹${U.inr(c.ledgerBalance(p.id, today))}`);
  // bill-wise pending sums equal each party's ledger balance
  for (const p of c.ledgers({ groupName: 'Sundry Debtors' }).concat(c.ledgers({ groupName: 'Sundry Creditors' }))) if (p.bill_wise) {
    const s = U.r2(c.pendingBills(p.id, today).reduce((t, b) => t + b.amount, 0));
    assert.ok(Math.abs(s - c.ledgerBalance(p.id, today)) < 0.011, `${p.name} bills ${s} != balance ${c.ledgerBalance(p.id, today)}`);
  }
  pass++; console.log('  ✓ every party: bill-wise pending total = ledger balance');
  return d;
}

(async () => {
  const SQL = await initSqlJs();
  const c = await buildDemo(SQL);
  const today = U.today();
  const d1 = checkState(c, 'demo company as created');
  // the screenshot bug: 50,000 on-account receipt from Delhi Pharma was ignored by the overdue alert
  eq(d1.unadjustedCredits, 50000, 'on-account receipt recognised as unadjusted credit');
  const delhi = c.ledgerByName('Delhi Pharma Distributors');
  const odDelhi = c.overdueSummary('receivable', today).parties.find(p => p.id === delhi.id);
  eq(odDelhi ? odDelhi.amount : 0, c.ledgerBalance(delhi.id, today), 'Delhi Pharma overdue is net of its ₹50,000 advance');
  ok(d1.overdueAmt <= d1.receivables + 0.01, `overdue (₹${U.inr(d1.overdueAmt)}) no longer exceeds receivables (₹${U.inr(d1.receivables)})`);

  // more entries: an on-account credit note, an on-account payment to a supplier, an advance from a customer larger than the dues
  const items = c.items(); const serum = items.find(i => /Serum/.test(i.name));
  const kashi = c.ledgerByName('Kashi Medical Store'), ganga = c.ledgerByName('Ganga Beauty Parlour'), sup = c.ledgerByName('Ganga Chemicals Pvt Ltd');
  const bank = c.ledgerByName('SBI Current A/c'), cash = c.ledgerByName('Cash');
  c.saveVoucher({ vtype: 'CRN', date: today, party_id: kashi.id, narration: 'Rate difference, not against a bill', items: [{ item_id: serum.id, qty: 2, rate: 450 }] });
  c.saveVoucher({ vtype: 'PMT', date: today, pay_mode: 'Cash', lines: [{ ledger_id: sup.id, dr: 5000, bill: { type: 'onacc' } }, { ledger_id: cash.id, cr: 5000 }] });
  c.saveVoucher({ vtype: 'RCT', date: today, pay_mode: 'UPI', lines: [{ ledger_id: bank.id, dr: 20000 }, { ledger_id: ganga.id, cr: 20000, bill: { type: 'onacc' } }] });
  const d2 = checkState(c, 'after on-account credit note, supplier advance, customer over-payment');
  ok(c.ledgerBalance(ganga.id, today) < 0, 'Ganga Beauty Parlour now has a credit (advance) balance');
  ok(!c.overdueSummary('receivable', today).parties.some(p => p.id === ganga.id), 'a customer in advance has nothing overdue');
  ok(d2.overdueAmt < d1.overdueAmt, 'overdue went down after the credits');

  // a voucher dated after today must not make the dashboard disagree with itself
  const next = U.addDays(today, 3);
  if (U.fyOf(next).start === U.fyOf(today).start) {
    c.saveVoucher({ vtype: 'PMT', date: next, pay_mode: 'Cash', lines: [{ ledger_id: c.ledgerByName('Rent').id, dr: 1000 }, { ledger_id: cash.id, cr: 1000 }] });
    checkState(c, 'with a post-dated voucher after today');
  }
  console.log(`\n${pass} dashboard consistency checks passed`);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
