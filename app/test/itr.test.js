// ITR computation tests with hand-checked numbers: node test/itr.test.js
const assert = require('assert');
const initSqlJs = require('sql.js');
const { Company } = require('../core');
let pass = 0; const eq = (a, b, m) => { assert.strictEqual(a, b, m + ` (got ${a}, expected ${b})`); pass++; console.log('  ✓ ' + m); };
(async () => {
  const SQL = await initSqlJs(); const db = new SQL.Database();
  const c = Company.create(db, { name: 'ITR Test', state_code: '09', books_begin: '2025-04-01', pan: 'ABCDE1234F' }, 'admin');
  let books = {};
  c.itrBooks = (fy) => Object.assign({ fy, netProfit: 0, turnover: 0, cashReceipts: 0, tdsReceivable: 0, advanceTax: [], selfAssessment: 0, incomeTaxInPL: 0, settings: {} }, books);
  const run = (profile, b = {}) => { books = b; return c.itrCompute({ fy: '2025-26', profile }); };

  console.log('New regime (FY 2025-26 / AY 2026-27)');
  let r = run({ business: { method: 'books' }, deductions: { c80C: 150000, d80D_self: 25000 }, taxes: { tds: 20000 } }, { netProfit: 1400000, turnover: 9000000 });
  eq(r.regimes.new.taxable, 1400000, 'book profit ₹14,00,000 → total income ₹14,00,000');
  eq(r.regimes.new.slabTax, 90000, 'slab tax: 5% of 4L + 10% of 4L + 15% of 2L = ₹90,000');
  eq(r.regimes.new.total, 93600, 'with 4% cess = ₹93,600');
  eq(r.regimes.old.taxable, 1225000, 'old regime: 14L − 80C 1.5L − 80D 25k = ₹12,25,000');
  eq(r.regimes.old.total, 187200, 'old regime tax 12,500 + 1,00,000 + 67,500 = 1,80,000 + cess = ₹1,87,200');
  eq(r.choice, 'new', 'auto picks the lower (new) regime');
  eq(r.result.balance, 73600, 'TDS ₹20,000 → ₹73,600 payable');

  r = run({ business: { method: 'books' } }, { netProfit: 1200000 });
  eq(r.regimes.new.slabTax, 60000, '₹12,00,000 → slab tax ₹60,000');
  eq(r.regimes.new.total, 0, 'rebate u/s 87A makes it nil at ₹12 lakh');
  r = run({ business: { method: 'books' } }, { netProfit: 1210000 });
  eq(r.regimes.new.slabTax, 61500, '₹12,10,000 → slab tax ₹61,500');
  eq(r.regimes.new.marginal87A, 51500, 'marginal relief ₹51,500 (tax limited to the ₹10,000 above 12 lakh)');
  eq(r.regimes.new.total, 10400, 'tax ₹10,000 + cess ₹400 = ₹10,400');
  r = run({ business: { method: 'books' } }, { netProfit: 5100000 });
  eq(r.regimes.new.slabTax, 1110000, '₹51,00,000 → slab tax ₹11,10,000');
  eq(r.regimes.new.surcharge, 70000, 'surcharge 10% (₹1,11,000) cut to ₹70,000 by marginal relief at ₹50 lakh');
  eq(r.regimes.new.total, 1227200, 'total ₹11,80,000 + cess ₹47,200 = ₹12,27,200');

  console.log('Presumptive 44AD / 44ADA');
  r = run({ business: { method: '44AD', cashReceipts: 0 }, other: { fdInterest: 50000 } }, { turnover: 5000000 });
  eq(r.business.income, 300000, '44AD: ₹50 lakh all digital × 6% = ₹3,00,000');
  eq(r.regimes.new.gti, 350000, '+ FD interest ₹50,000 = GTI ₹3,50,000');
  eq(r.result.total, 0, 'no tax below ₹4 lakh (new regime)');
  eq(r.form, 'ITR-4 (Sugam)', 'suggests ITR-4');
  r = run({ business: { method: '44AD', cashReceipts: 3000000 } }, { turnover: 10000000 });
  eq(r.business.income, 660000, '44AD: ₹30L cash × 8% + ₹70L digital × 6% = ₹6,60,000');
  eq(r.warnings.length, 0, '₹1 crore turnover with 30% cash is within the ₹2 crore limit');
  r = run({ business: { method: '44AD', cashReceipts: 2500000 } }, { turnover: 25000000 });
  assert.ok(r.warnings.some(w => /above the 44AD limit/.test(w))); pass++; console.log('  ✓ ₹2.5 crore with 10% cash → warned (over ₹2 crore limit)');
  r = run({ business: { method: '44AD', cashReceipts: 500000 } }, { turnover: 25000000 });
  eq(r.warnings.filter(w => /44AD limit/.test(w)).length, 0, '₹2.5 crore with cash ≤ 5% → within the ₹3 crore limit');
  r = run({ business: { method: '44ADA' } }, { turnover: 4000000 });
  eq(r.business.income, 2000000, '44ADA: 50% of ₹40 lakh = ₹20,00,000');
  eq(r.regimes.new.total, 208000, 'tax ₹2,00,000 + cess ₹8,000 = ₹2,08,000');

  console.log('Old regime slabs, senior citizen, firm');
  r = run({ age: 'senior', regime: 'old', business: { method: 'books' } }, { netProfit: 600000 });
  eq(r.regimes.old.total, 31200, 'senior, old regime ₹6 lakh: 5% of 2L + 20% of 1L = ₹30,000 + cess = ₹31,200');
  eq(r.regimes.new.total, 0, 'same income in new regime: rebate → nil');
  eq(r.choice, 'old', 'regime forced to old when chosen');
  r = run({ regime: 'old', business: { method: 'books' } }, { netProfit: 500000 });
  eq(r.regimes.old.total, 0, 'old regime ₹5 lakh: ₹12,500 tax fully rebated (87A)');
  r = run({ taxpayer: 'firm', business: { method: 'books', adjustments: [{ label: 'Income tax debited', amount: 50000 }] } }, { netProfit: 950000 });
  eq(r.business.income, 1000000, 'firm: book profit 9.5L + income tax added back 50k = ₹10,00,000');
  eq(r.result.total, 312000, 'firm: 30% = ₹3,00,000 + cess = ₹3,12,000');
  eq(r.regimes.new, null, 'firm: no new-regime slabs');

  console.log('Other heads');
  r = run({ salary: { gross: 900000 }, business: { method: 'books' } }, { netProfit: 0 });
  eq(r.regimes.new.salary, 825000, 'salary ₹9 lakh − standard deduction ₹75,000 (new)');
  eq(r.regimes.old.salary, 850000, 'salary ₹9 lakh − standard deduction ₹50,000 (old)');
  r = run({ house: { type: 'self', interest: 250000 }, business: { method: 'books' } }, { netProfit: 1000000 });
  eq(r.regimes.old.house, -200000, 'self-occupied home-loan interest capped at ₹2 lakh (old)');
  eq(r.regimes.new.house, 0, 'no home-loan loss in new regime');
  r = run({ business: { method: 'books' }, other: { savingsInterest: 15000 }, regime: 'old' }, { netProfit: 800000 });
  eq(r.regimes.old.dedTotal, 10000, '80TTA capped at ₹10,000');
  const bk = { netProfit: 1000000, tdsReceivable: 12000, advanceTax: [{ date: '2025-12-10', amount: 30000 }] };
  r = run({ business: { method: 'books' } }, bk);
  eq(r.taxesPaid.total, 42000, 'TDS from ledger + advance tax from ledger = ₹42,000');
  eq(r.result.balance, round10(r.result.total - 42000), 'balance rounded to ₹10 (s.288B)');

  console.log('Tax year 2026-27 (Income-tax Act 2025)');
  books = { netProfit: 1400000 }; const r27 = c.itrCompute({ fy: '2026-27', profile: { business: { method: 'books' } } });
  eq(r27.regimes.new.total, 93600, 'same ₹14 lakh case under the new Act: ₹93,600 (slabs unchanged)');
  assert.ok(/Income-tax Act, 2025/.test(r27.law) && r27.notes.some(n => /not released yet/.test(n)) && r27.notes.some(n => /31\/08\/2027|31-08-2027|31 Aug 2027/.test(n))); pass++; console.log('  ✓ labelled under the 2025 Act, forms-not-released note, due date 31 Aug 2027');
  books = { turnover: 4000000 }; const h = c.itrCompute({ fy: '2025-26', profile: { taxpayer: 'huf', business: { method: '44ADA' } } });
  assert.ok(h.warnings.some(w => /HUF cannot use 44ADA/.test(w))); pass++; console.log('  ✓ HUF + 44ADA warned');

  console.log('Sheet + PDF');
  const sh = c.itrSheet({ fy: '2025-26', profile: { business: { method: '44AD' } } });
  assert.ok(sh.sheets[0].rows.some(x => /44AD/.test(x[2] || ''))); pass++; console.log('  ✓ Excel filing sheet maps 44AD figures to Schedule BP');
  const html = require('../core/itrprint').itrHtml(c.itrCompute({ fy: '2025-26' }), c.settings());
  assert.ok(/COMPUTATION OF TOTAL INCOME/.test(html) && /does not file the return/.test(html)); pass++; console.log('  ✓ printable computation renders with the filing limit stated');
  assert.throws(() => c.itrCompute({ fy: '2019-20' }), /not in this version/); pass++; console.log('  ✓ unknown year refused (no guessed rates)');
  console.log(`\nITR tests: ${pass} passed`);
})().catch(e => { console.error(e); process.exit(1); });
function round10(x) { return Math.round(x / 10) * 10; }
