// R&S Sons Accounting v2.0 - Income-tax computation from the books (individual / HUF / partnership firm).
// Business income comes from the Profit & Loss (or presumptive 44AD / 44ADA), TDS from the TDS Receivable ledger,
// advance tax from ledgers named "Advance Tax" / "Self Assessment Tax". Old vs new regime side by side.
// This prepares the computation and the figures for the ITR form; the return itself is filed on the e-filing portal
// (direct filing from software is allowed only for registered e-Return Intermediaries).
const U = require('./util');
const { Company } = require('./company');
const R = require('./taxrules');
const r2 = U.r2;
const P = Company.prototype;
const round10 = x => Math.round(x / 10) * 10;          // s.288A / 288B: income and tax rounded to nearest ₹10
const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
const pos = v => Math.max(0, num(v));

function fyLabel(start) { const y = +start.slice(0, 4); return `${y}-${String(y + 1).slice(2)}`; }

P.itrProfile = function (fy) { const r = this.get('SELECT data_json, updated_by, updated_at FROM itr_profiles WHERE fy=?', [fy]); return r ? Object.assign(JSON.parse(r.data_json || '{}'), { _updated_by: r.updated_by, _updated_at: r.updated_at }) : {}; };
P.saveItrProfile = function (fy, data) {
  if (!/^\d{4}-\d{2}$/.test(fy || '')) throw new Error('Financial year missing');
  const clean = JSON.parse(JSON.stringify(data || {})); delete clean._updated_by; delete clean._updated_at;
  this.tx(() => { this.run('INSERT OR REPLACE INTO itr_profiles (fy, data_json, updated_by, updated_at) VALUES (?,?,?,?)', [fy, JSON.stringify(clean), this.user, this.now()]); this.audit('update', 'itr', 0, 'Income tax details saved for FY ' + fy); });
  return this.itrProfile(fy);
};
P.taxRules = function (fy) { const r = R.rules(fy); return { fy, ay: r.ay, label: r.label, law: r.law, status: R.VERIFY[fy] || 'unverified', sources: r.sources, years: Object.keys(R.FY) }; };

// Figures the books already know for the year.
P.itrBooks = function (fy) {
  const start = `${fy.slice(0, 4)}-04-01`, end = `${+fy.slice(0, 4) + 1}-03-31`;
  const pl = this.plData(start, end);
  const sumLed = (where, p, col) => r2(num(this.val(`SELECT SUM(e.${col}) FROM entries e JOIN vouchers v ON v.id=e.voucher_id JOIN ledgers l ON l.id=e.ledger_id WHERE v.status='active' AND v.date BETWEEN ? AND ? AND (${where})`, [start, end, ...p])));
  const cashIds = this.ledgers({ groupNames: ['Cash-in-Hand'] }).map(l => l.id);
  const cashIn = cashIds.length ? r2(num(this.val(`SELECT SUM(e.dr) FROM entries e JOIN vouchers v ON v.id=e.voucher_id WHERE v.status='active' AND v.vtype IN ('SAL','RCT') AND v.date BETWEEN ? AND ? AND e.ledger_id IN (${cashIds.join(',')})`, [start, end]))) : 0;
  const tdsDr = sumLed("l.tax_type='TDSR'", [], 'dr'), tdsCr = sumLed("l.tax_type='TDSR'", [], 'cr');
  const adv = this.all(`SELECT v.date, e.dr AS amount, l.name FROM entries e JOIN vouchers v ON v.id=e.voucher_id JOIN ledgers l ON l.id=e.ledger_id WHERE v.status='active' AND v.date BETWEEN ? AND ? AND e.dr>0 AND (LOWER(l.name) LIKE '%advance tax%' OR LOWER(l.name) LIKE '%self assessment%' OR LOWER(l.name) LIKE '%self-assessment%') ORDER BY v.date`, [start, end]);
  const itExp = sumLed("(LOWER(l.name) LIKE '%income tax%' AND LOWER(l.name) NOT LIKE '%advance%' AND LOWER(l.name) NOT LIKE '%refund%' AND l.group_id IN (SELECT id FROM groups WHERE nature='E'))", [], 'dr');
  const turnover = r2(pl.sales.total);
  return { fy, from: start, to: end, netProfit: pl.np, grossProfit: pl.gp, turnover, otherIncomeInBooks: r2(pl.iInc.total + pl.dInc.total), cashReceipts: Math.min(cashIn, Math.max(turnover, 0) * 1.18), tdsReceivable: tdsDr, tdsReceivableAdjusted: tdsCr, advanceTax: adv.filter(a => !/self/i.test(a.name)).map(a => ({ date: a.date, amount: a.amount })), selfAssessment: r2(adv.filter(a => /self/i.test(a.name)).reduce((s, a) => s + a.amount, 0)), incomeTaxInPL: itExp,
    settings: (() => { const s = this.settings(); return { name: s.name, pan: s.pan, gstin: s.gstin }; })() };
};

function surchargeWithRelief(tax, income, bands, slabFn) {
  // highest band crossed; marginal relief: (tax + surcharge) may not exceed tax at the threshold + income above the threshold
  let rate = 0, thr = 0; for (const [t, r] of bands) if (income > t) { rate = r; thr = t; }
  if (!rate) return { surcharge: 0, relief: 0, rate: 0 };
  const sc = tax * rate;
  let prevRate = 0; for (const [t, r] of bands) if (t < thr) prevRate = r;
  const atThr = slabFn(thr) * (1 + prevRate);
  const relief = Math.max(0, tax + sc - (atThr + (income - thr)));
  return { surcharge: Math.max(0, sc - relief), relief, rate };
}

P.itrCompute = function (args = {}) {
  const fy = args.fy || fyLabel(U.fyOf(U.today()).start);
  const rules = R.rules(fy);
  const prof = Object.assign({}, this.itrProfile(fy), args.profile || {});
  const bk = this.itrBooks(fy);
  const T = prof.taxpayer || 'individual'; const age = prof.age || 'below60';
  const notes = [], warns = [];
  // ---------- business / profession ----------
  const B = prof.business || {}; const method = B.method || 'books';
  const turnover = B.turnover != null && B.turnover !== '' ? num(B.turnover) : bk.turnover;
  const cash = B.cashReceipts != null && B.cashReceipts !== '' ? Math.min(num(B.cashReceipts), turnover) : Math.min(bk.cashReceipts, turnover);
  const digital = r2(Math.max(0, turnover - cash));
  const adj = (B.adjustments || []).filter(a => a && num(a.amount)); const adjTotal = r2(adj.reduce((s, a) => s + num(a.amount), 0));
  let business = 0, bpLines = [];
  const cashShare = turnover > 0 ? cash / turnover : 0;
  if (method === '44AD') {
    const lim = cashShare <= 0.05 ? rules.p44AD.limitLowCash : rules.p44AD.limit;
    const min = r2(digital * rules.p44AD.rateDigital + cash * rules.p44AD.rateCash);
    business = Math.max(min, num(B.declared));
    bpLines.push(['Turnover / gross receipts (from books' + (B.turnover ? ', edited' : '') + ')', turnover], ['  received by bank / digital', digital], ['  received in cash', cash],
      [`Presumptive income u/s ${rules.sections.presumptiveBusiness}: ${rules.p44AD.rateDigital * 100}% of digital + ${rules.p44AD.rateCash * 100}% of cash`, min]);
    if (num(B.declared) > min) bpLines.push(['Income declared (higher than presumptive)', num(B.declared)]);
    if (turnover > lim) warns.push(`Turnover ₹${U.inr(turnover)} is above the ${rules.sections.presumptiveBusiness} limit of ₹${U.inr(lim)}${cashShare <= 0.05 ? ' (cash receipts ≤ 5%)' : ''}. Use books (regular) method; tax audit may apply.`);
    if (T === 'firm' && /llp/i.test(prof.name || '')) warns.push('An LLP cannot use 44AD.');
    if (business < min) warns.push('Declaring less than presumptive income needs books + tax audit.');
  } else if (method === '44ADA') {
    const lim = cashShare <= 0.05 ? rules.p44ADA.limitLowCash : rules.p44ADA.limit;
    const min = r2(turnover * rules.p44ADA.rate);
    business = Math.max(min, num(B.declared));
    bpLines.push(['Gross receipts from profession', turnover], [`Presumptive income u/s ${rules.sections.presumptiveProfession}: ${rules.p44ADA.rate * 100}% of receipts`, min]);
    if (num(B.declared) > min) bpLines.push(['Income declared (higher than presumptive)', num(B.declared)]);
    if (turnover > lim) warns.push(`Receipts ₹${U.inr(turnover)} are above the ${rules.sections.presumptiveProfession} limit of ₹${U.inr(lim)}.`);
  } else {
    business = r2(bk.netProfit + adjTotal);
    bpLines.push(['Net profit as per Profit & Loss account', bk.netProfit]);
    for (const a of adj) bpLines.push([(num(a.amount) > 0 ? 'Add: ' : 'Less: ') + (a.label || 'adjustment'), num(a.amount)]);
    if (bk.incomeTaxInPL > 0 && !adj.some(a => /income.?tax/i.test(a.label || ''))) warns.push(`₹${U.inr(bk.incomeTaxInPL)} of income tax is debited in P&L — add it back (not deductible).`);
    if (turnover > 10000000) notes.push('Turnover above ₹1 crore: check tax audit (s.44AB) — limit is ₹10 crore if cash receipts and payments are each ≤ 5%.');
  }
  business = r2(business);
  // ---------- other heads ----------
  const S = prof.salary || {}; const H = prof.house || {}; const O = prof.other || {}; const D = prof.deductions || {}; const TX = prof.taxes || {};
  const salGross = pos(S.gross);
  const otherSrc = r2(pos(O.savingsInterest) + pos(O.fdInterest) + pos(O.dividend) + pos(O.others));
  const hpCalc = (regime) => {
    if (H.type === 'letout') { const nav = Math.max(0, pos(H.rent) - pos(H.municipalTax)); const v = r2(nav - nav * 0.30 - pos(H.interest)); return regime === 'new' ? Math.max(0, v) : Math.max(v, -rules.deductions.hp24b); }
    if (H.type === 'self') return regime === 'new' ? 0 : -Math.min(pos(H.interest), rules.deductions.hp24b);
    return 0;
  };
  const regimeCalc = (regime) => {
    const RG = regime === 'new' ? rules.newRegime : rules.oldRegime; const L = [];
    if (regime === 'new' && T === 'firm') return null;
    const sal = salGross > 0 ? r2(Math.max(0, salGross - Math.min(RG.stdDeduction, salGross) - (regime === 'old' ? pos(S.exemptions) + Math.min(pos(S.professionalTax), 2500) : 0))) : 0;
    const hp = r2(hpCalc(regime));
    let bus = business, oth = otherSrc, hpv = hp;
    // set-off: business loss against other heads except salary; house property loss (old regime) up to ₹2 lakh
    let cfBusiness = 0; if (bus < 0) { const absorb = Math.min(-bus, Math.max(0, oth + Math.max(0, hpv))); cfBusiness = r2(-bus - absorb); oth = r2(oth - Math.min(absorb, oth)); bus = 0; }
    const gti = r2(Math.max(0, sal + Math.max(hpv, -(sal + oth + bus)) + bus + oth));
    // deductions
    const dd = []; const cap = (k, v, lim) => { const x = Math.min(pos(v), lim == null ? Infinity : lim); if (x > 0) dd.push([k, x]); };
    if (regime === 'old' && T !== 'firm') {
      const lim = rules.deductions;
      cap('80C (PPF, LIC, ELSS, principal of home loan, etc.)', D.c80C, lim.c80C);
      cap('80CCD(1B) NPS own contribution', D.c80CCD1B, lim.c80CCD1B);
      cap('80D health insurance (self & family)', D.d80D_self, age === 'below60' ? lim.d80D_self : lim.d80D_self_senior);
      cap('80D health insurance (parents)', D.d80D_parents, prof.parentsSenior ? lim.d80D_parents_senior : lim.d80D_parents);
      if (age === 'below60' || T === 'huf') cap('80TTA savings bank interest', pos(O.savingsInterest), lim.tta80);
      else cap('80TTB interest on deposits (senior citizen)', pos(O.savingsInterest) + pos(O.fdInterest), lim.ttb80);
      cap('80G donations (eligible amount)', D.d80G); cap('Other deductions', D.others);
    }
    if (T !== 'firm') cap('80CCD(2) employer contribution to NPS', D.c80CCD2);
    const dedTotal = r2(Math.min(gti, dd.reduce((s, x) => s + x[1], 0)));
    const ti = round10(Math.max(0, gti - dedTotal));
    // tax
    let tax, slabsFn, rebate = 0;
    if (T === 'firm') { tax = ti * rules.firm.rate; slabsFn = x => x * rules.firm.rate; }
    else { const slabs = regime === 'new' ? RG.slabs : RG.slabs[T === 'huf' ? 'below60' : age]; slabsFn = x => R.slabTax(x, slabs); tax = slabsFn(ti); }
    tax = r2(tax);
    let marginal87A = 0;
    if (T === 'individual' && prof.resident !== false) {
      if (ti <= RG.rebateLimit) rebate = Math.min(tax, RG.rebateMax);
      else if (regime === 'new' && tax > ti - RG.rebateLimit) { marginal87A = r2(tax - (ti - RG.rebateLimit)); }   // marginal relief just above ₹12 lakh (new regime)
    }
    const afterRebate = r2(tax - rebate - marginal87A);
    const sc = surchargeWithRelief(afterRebate, ti, T === 'firm' ? rules.firm.surcharge : RG.surcharge, slabsFn);
    const cess = r2((afterRebate + sc.surcharge) * rules.cess);
    const total = r2(afterRebate + sc.surcharge + cess);
    return { regime, salary: sal, house: hp, business: bus, businessLossCF: cfBusiness, other: oth, gti, deductions: dd, dedTotal, taxable: ti, slabTax: tax, rebate: r2(rebate), marginal87A, surcharge: r2(sc.surcharge), surchargeRelief: r2(sc.relief), cess, total };
  };
  const res = { new: regimeCalc('new'), old: regimeCalc('old') };
  // ---------- taxes paid ----------
  const tds = TX.tds != null && TX.tds !== '' ? num(TX.tds) : bk.tdsReceivable;
  const tcs = pos(TX.tcs);
  const adv = TX.advance != null && TX.advance !== '' ? num(TX.advance) : r2(bk.advanceTax.reduce((s, a) => s + a.amount, 0));
  const sat = TX.selfAssessment != null && TX.selfAssessment !== '' ? num(TX.selfAssessment) : bk.selfAssessment;
  const paid = r2(tds + tcs + adv + sat);
  for (const k of ['new', 'old']) if (res[k]) { const x = res[k]; x.paid = paid; x.balance = round10(x.total - paid); }
  let choice = prof.regime && prof.regime !== 'auto' ? prof.regime : (res.new && (!res.old || res.new.total <= res.old.total) ? 'new' : 'old');
  if (T === 'firm') choice = 'old';
  const best = res[choice];
  if (res.new && res.old && T !== 'firm') notes.push(`New regime tax ₹${U.inr(res.new.total)} · Old regime tax ₹${U.inr(res.old.total)} → ${res.new.total <= res.old.total ? 'new' : 'old'} regime is lower by ₹${U.inr(Math.abs(res.new.total - res.old.total))}.`);
  if (T !== 'firm' && business > 0) notes.push('With business income, moving from the new regime to the old one needs Form 10-IEA before the due date, and coming back is allowed only once.');
  notes.push('Interest u/s 234A/234B/234C and late fee u/s 234F are not calculated here — the e-filing portal / utility computes them.');
  if (res.old && res.old.businessLossCF) warns.push(`Business loss ₹${U.inr(res.old.businessLossCF)} cannot be set off this year; it is carried forward (file the return by the due date to keep it).`);
  // ITR form suggestion (resident individual/HUF/firm)
  let form = 'ITR-3';
  if (T === 'firm') form = method === 'books' ? 'ITR-5' : 'ITR-4 (Sugam)';
  else if (method !== 'books' && best && best.taxable <= 5000000) form = 'ITR-4 (Sugam)';
  if (T !== 'firm' && method !== 'books' && best && best.taxable > 5000000) notes.push('Total income above ₹50 lakh: ITR-4 cannot be used; file ITR-3.');
  if (T === 'huf' && method === '44ADA') warns.push('An HUF cannot use 44ADA (presumptive for professionals) — only individuals and firms.');
  if (!rules.ay) notes.push(rules.forms + '.');
  const audit = prof.audit != null ? !!prof.audit : String(this.setting('tax_audit') || '0') === '1';
  const dd = rules.dueDates; notes.push(`Due date to file: ${U.fmtDate(audit ? dd.itrAudit : (business > 0 ? dd.itrNonAudit : dd.itrOther))}${audit ? ' (audit case)' : business > 0 ? ' (business/profession, no audit)' : ''}; belated return up to ${U.fmtDate(dd.belated)}.`);
  return { sections: rules.sections, fy, ay: rules.ay, label: rules.label, law: rules.law, rulesStatus: R.VERIFY[fy] || 'unverified', taxpayer: T, age, method, form, books: bk, profile: prof,
    business: { method, turnover, cash, digital, income: business, lines: bpLines, adjustments: adj }, otherSources: otherSrc,
    taxesPaid: { tds, tcs, advance: adv, selfAssessment: sat, total: paid, advanceList: bk.advanceTax },
    regimes: res, choice, result: best, notes, warnings: warns, sources: rules.sources };
};

// Rows for an Excel "ITR filling sheet": what to type where on the e-filing portal.
P.itrSheet = function (args = {}) {
  const r = this.itrCompute(args); const b = r.result; const s = this.settings();
  const rows = [['Income Tax Computation — ' + r.label], [s.name || '', 'PAN', s.pan || ''], ['Regime', r.choice === 'new' ? 'New (s.115BAC)' : 'Old', 'Suggested form', r.form], [],
    ['Head / item', 'Amount (₹)', 'Where it goes in the return']];
  const add = (k, v, w) => rows.push([k, v == null ? '' : v, w || '']);
  if (r.method === '44AD') { add('Gross turnover — received by bank / digital', r.business.digital, 'Schedule BP › 44AD › E1a'); add('Gross turnover — any other mode (cash)', r.business.cash, 'Schedule BP › 44AD › E1b'); add('Presumptive income u/s 44AD', r.business.income, 'Schedule BP › 44AD › E2 / E3'); }
  else if (r.method === '44ADA') { add('Gross receipts (profession)', r.business.turnover, 'Schedule BP › 44ADA › E4'); add('Presumptive income u/s 44ADA', r.business.income, 'Schedule BP › 44ADA › E5 / E6'); }
  else { add('Net profit as per P&L', r.books.netProfit, 'Schedule BP › 1 (Profit before tax as per P&L)'); for (const a of r.business.adjustments) add(a.label, a.amount, 'Schedule BP add-backs / deductions'); add('Profits and gains of business', r.business.income, 'Schedule BP › A38 (approx.)'); add('Turnover (for Part A-P&L / no-account case)', r.business.turnover, 'Part A — P&L / Trading account'); }
  add('Income from salary (after standard deduction)', b.salary, 'Schedule S'); add('Income from house property', b.house, 'Schedule HP'); add('Income from other sources', b.other, 'Schedule OS');
  add('Gross total income', b.gti, 'Part B-TI'); for (const [k, v] of b.deductions) add('Deduction ' + k, v, 'Schedule VI-A'); add('Total income (rounded)', b.taxable, 'Part B-TI › Total income');
  add('Tax on total income', b.slabTax, 'Part B-TTI'); add('Rebate u/s 87A', b.rebate, 'Part B-TTI'); if (b.marginal87A) add('Marginal relief (87A, new regime)', b.marginal87A, 'Part B-TTI'); add('Surcharge', b.surcharge, 'Part B-TTI'); add('Health & education cess 4%', b.cess, 'Part B-TTI'); add('Total tax liability', b.total, 'Part B-TTI');
  add('TDS (from TDS Receivable ledger / 26AS)', r.taxesPaid.tds, 'Schedule TDS2 — match with Form 26AS / AIS'); add('TCS', r.taxesPaid.tcs, 'Schedule TCS'); add('Advance tax', r.taxesPaid.advance, 'Schedule IT'); add('Self-assessment tax', r.taxesPaid.selfAssessment, 'Schedule IT');
  add(b.balance >= 0 ? 'Tax payable' : 'Refund due', Math.abs(b.balance), b.balance >= 0 ? 'Pay via e-Pay Tax (challan 280, minor head 300) before filing' : 'Refund — check bank account is pre-validated');
  rows.push([]); for (const n of r.warnings) rows.push(['⚠ ' + n]); for (const n of r.notes) rows.push(['• ' + n]);
  rows.push([], ['Interest 234A/B/C and fee 234F are not included. Verify every figure with Form 26AS / AIS before filing.']);
  const cmp = [['Item', 'New regime', 'Old regime']]; const n = r.regimes.new || {}, o = r.regimes.old || {};
  for (const [k, lbl] of [['gti', 'Gross total income'], ['dedTotal', 'Deductions'], ['taxable', 'Total income'], ['slabTax', 'Tax'], ['rebate', 'Rebate 87A'], ['marginal87A', 'Marginal relief'], ['surcharge', 'Surcharge'], ['cess', 'Cess'], ['total', 'Total tax'], ['paid', 'Taxes paid'], ['balance', 'Payable (+) / Refund (−)']]) cmp.push([lbl, n[k] == null ? '' : n[k], o[k] == null ? '' : o[k]]);
  return { name: `ITR sheet ${r.label} ${s.name || ''}`.trim(), sheets: [{ name: 'Computation', rows }, { name: 'Old vs New', rows: cmp }] };
};
module.exports = { round10, surchargeWithRelief };
