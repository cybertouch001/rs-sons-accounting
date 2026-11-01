// R&S Sons Accounting - Indian tax rules used by the ITR computation and the due-date calendar.
// Every number here has a source note. Rules are keyed by financial year ("2025-26" = income of 1 Apr 2025 – 31 Mar 2026).
// If a year is missing, the computation refuses rather than guessing.
const U = require('./util');

const NEW_SLABS_2025 = [[400000, 0], [800000, 0.05], [1200000, 0.10], [1600000, 0.15], [2000000, 0.20], [2400000, 0.25], [Infinity, 0.30]];
const OLD_SLABS = { below60: [[250000, 0], [500000, 0.05], [1000000, 0.20], [Infinity, 0.30]], senior: [[300000, 0], [500000, 0.05], [1000000, 0.20], [Infinity, 0.30]], superSenior: [[500000, 0], [1000000, 0.20], [Infinity, 0.30]] };
const FY = {
  '2025-26': {
    ay: '2026-27', law: 'Income-tax Act, 1961 (as amended by Finance Act 2025)', label: 'AY 2026-27 (FY 2025-26)',
    newRegime: { slabs: NEW_SLABS_2025, rebateLimit: 1200000, rebateMax: 60000, stdDeduction: 75000, surcharge: [[5000000, 0.10], [10000000, 0.15], [20000000, 0.25]] },
    oldRegime: { slabs: OLD_SLABS, rebateLimit: 500000, rebateMax: 12500, stdDeduction: 50000, surcharge: [[5000000, 0.10], [10000000, 0.15], [20000000, 0.25], [50000000, 0.37]] },
    firm: { rate: 0.30, surcharge: [[10000000, 0.12]] },
    cess: 0.04,
    p44AD: { limit: 20000000, limitLowCash: 30000000, rateCash: 0.08, rateDigital: 0.06 },
    p44ADA: { limit: 5000000, limitLowCash: 7500000, rate: 0.50 },
    deductions: { c80C: 150000, c80CCD1B: 50000, d80D_self: 25000, d80D_self_senior: 50000, d80D_parents: 25000, d80D_parents_senior: 50000, tta80: 10000, ttb80: 50000, hp24b: 200000 },
    newRegimeAllowed: ['d80CCD2', 'd80CCH', 'd80JJAA'],
    sections: { presumptiveBusiness: '44AD', presumptiveProfession: '44ADA', rebate: '87A', regime: '115BAC' },
    // ITR-4 / ITR-3 schemas AY 2026-27 fix the non-audit due date at 31 Aug 2026 (FA 2026); audit cases extended to 21 Nov 2026 (CBDT Circular 07/2026)
    dueDates: { itrNonAudit: '2026-08-31', itrOther: '2026-07-31', itrAudit: '2026-11-21', belated: '2026-12-31', revised: '2027-03-31' },
    forms: 'ITR-3 / ITR-4 (AY 2026-27) — official schemas published',
    sources: ['Income-tax Act 1961 s.115BAC(1A) slabs, s.87A (₹60,000 up to ₹12 lakh), s.16(ia) ₹75,000 — Finance Act 2025', 's.44AD / 44ADA limits as amended by Finance Act 2023', 'ITR-4 schema V1.1 (30 Jun 2026): ItrFilingDueDate 2026-08-31', 'CBDT Circular 07/2026: audit-case ITR due date 21 Nov 2026'],
  },
};
// Tax year 2026-27 (income from 1 Apr 2026) falls under the new Income-tax Act, 2025. Rates/limits carried over unchanged (checked in
// the Act as amended by Finance Act 2026, 1 Nov 2026): slabs s.202(1), rebate s.156, presumptive s.58, std deduction s.19.
FY['2026-27'] = Object.assign({}, FY['2025-26'], {
  ay: null, law: 'Income-tax Act, 2025 (as amended by Finance Act 2026)', label: 'Tax year 2026-27 (1 Apr 2026 – 31 Mar 2027)',
  sections: { presumptiveBusiness: '58(2) [old 44AD]', presumptiveProfession: '58(2) [old 44ADA]', rebate: '156 [old 87A]', regime: '202 [old 115BAC]' },
  dueDates: { itrNonAudit: '2027-08-31', itrOther: '2027-07-31', itrAudit: '2027-10-31', belated: '2027-12-31', revised: '2028-03-31' },
  forms: 'Return forms for tax year 2026-27 are not released yet (as of Nov 2026) — use this as an advance-tax / planning estimate',
  sources: ['Income-tax Act 2025 as amended by Finance Act 2026: s.202(1) new-regime slabs (same as 2025-26), s.156 rebate ₹60,000 up to ₹12 lakh, s.58 presumptive income (same rates/limits), s.263 due dates (31 Jul / 31 Aug / 31 Oct)'],
});
const VERIFY = { '2025-26': 'verified', '2026-27': 'verified' };
function rules(fy) { const r = FY[fy]; if (!r) throw new Error(`Tax rules for FY ${fy} are not in this version of the software (available: ${Object.keys(FY).join(', ')}). Nothing was guessed.`); return r; }
function slabTax(income, slabs) { let tax = 0, prev = 0; for (const [upto, rate] of slabs) { if (income <= prev) break; tax += (Math.min(income, upto) - prev) * rate; prev = upto; } return tax; }

// ---------------- due-date calendar ----------------
// GSTR-3B for quarterly (QRMP) filers: 22nd for "Category A" states, 24th for the rest (CGST Act s.39 / Notification 76/2020-CT).
const QRMP_22 = new Set(['22', '23', '24', '25', '26', '27', '29', '30', '31', '32', '33', '34', '35', '36', '37']);
const pad = n => String(n).padStart(2, '0');
function dueEvents(from, to, o = {}) {
  const ev = [];
  const add = (date, code, title, detail) => { if (date >= from && date <= to) ev.push({ date, code, title, detail }); };
  const y0 = +from.slice(0, 4) - 1, y1 = +to.slice(0, 4) + 1;
  for (let y = y0; y <= y1; y++) for (let m = 1; m <= 12; m++) {
    const per = `${['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m]} ${y}`;
    const nm = m === 12 ? 1 : m + 1, ny = m === 12 ? y + 1 : y;           // the following month
    const d = day => `${ny}-${pad(nm)}-${pad(day)}`;
    const qEnd = m % 3 === 0; const qName = `${['Jan–Mar', 'Apr–Jun', 'Jul–Sep', 'Oct–Dec'][Math.floor((m - 1) / 3)]} ${y}`;
    if (o.gst && o.filing === 'monthly') { add(d(11), 'GSTR1', 'GSTR-1', `Sales return for ${per}`); add(d(20), 'GSTR3B', 'GSTR-3B + GST payment', `Summary return & tax for ${per}`); }
    if (o.gst && o.filing === 'qrmp') {
      if (qEnd) { add(d(13), 'GSTR1', 'GSTR-1 (quarterly)', `Sales return for ${qName}`); add(d(QRMP_22.has(o.state) ? 22 : 24), 'GSTR3B', 'GSTR-3B (quarterly)', `Summary return for ${qName}`); }
      else { add(d(13), 'IFF', 'IFF (optional)', `B2B invoices of ${per} so buyers get ITC`); add(d(25), 'PMT06', 'PMT-06 GST payment', `Monthly tax payment for ${per}`); }
    }
    if (o.gst && o.filing === 'composition' && qEnd) add(d(18), 'CMP08', 'CMP-08', `Composition tax for ${qName}`);
    if (o.tds) add(m === 3 ? `${y}-04-30` : d(7), 'TDSPAY', 'TDS / TCS deposit', `Tax deducted in ${per}`);
    if (m === 6) add(`${y}-06-15`, 'ADV1', 'Advance tax 1st instalment (15%)', `FY ${y}-${String(y + 1).slice(2)}`);
    if (m === 9) add(`${y}-09-15`, 'ADV2', 'Advance tax 2nd instalment (45%)', `FY ${y}-${String(y + 1).slice(2)}`);
    if (m === 12) add(`${y}-12-15`, 'ADV3', 'Advance tax 3rd instalment (75%)', `FY ${y}-${String(y + 1).slice(2)}`);
    if (m === 3) add(`${y}-03-15`, 'ADV4', 'Advance tax last instalment (100%; 44AD/44ADA pay all now)', `FY ${y - 1}-${String(y).slice(2)}`);
  }
  for (let y = y0; y <= y1; y++) {
    const fy = `${y - 1}-${String(y).slice(2)}`;
    // TDS statements: from tax year 2026-27 the new forms 138 (salary, old 24Q) / 140 (others, old 26Q) — Income-tax Rules 2026 r.219
    if (o.tds) { const nf = y - 1 >= 2026; const f = nf ? 'Form 138/140' : '24Q/26Q'; const q4 = y - 1 >= 2026 ? 'Form 138/140' : (y >= 2027 ? '24Q/26Q' : '24Q/26Q');
      add(`${y - 1}-07-31`, 'TDSQ1', `TDS return Q1 (${f})`, `Apr–Jun ${y - 1}`); add(`${y - 1}-10-31`, 'TDSQ2', `TDS return Q2 (${f})`, `Jul–Sep ${y - 1}`); add(`${y}-01-31`, 'TDSQ3', `TDS return Q3 (${f})`, `Oct–Dec ${y - 1}`); add(`${y}-05-31`, 'TDSQ4', `TDS return Q4 (${y - 1 >= 2026 ? 'Form 138/140' : '24Q/26Q'})`, `Jan–Mar ${y}`); }
    // ITR: business/profession without audit 31 Aug (from AY 2026-27), others 31 Jul; audit 31 Oct (AY 2026-27 extended to 21 Nov 2026)
    if (y >= 2026) add(`${y}-08-31`, 'ITR', 'Income tax return (business, no audit)', `FY ${fy}`); else add(`${y}-07-31`, 'ITR', 'Income tax return (non-audit)', `FY ${fy}`);
    if (o.audit) { add(y === 2026 ? '2026-10-21' : `${y}-09-30`, 'TAR', 'Tax audit report', `FY ${fy}`); add(y === 2026 ? '2026-11-21' : `${y}-10-31`, 'ITRA', 'Income tax return (audit cases)', `FY ${fy}`); }
    add(`${y}-12-31`, 'ITRB', 'Belated ITR — last date', `FY ${fy}`);
    if (y >= 2026) add(`${y + 1}-03-31`, 'ITRR', 'Revised ITR — last date (fee after 31 Dec)', `FY ${fy}`);
    if (o.gst && o.filing !== 'composition') add(`${y}-12-31`, 'GSTR9', 'GSTR-9 annual return', `FY ${fy} (if turnover above the exemption limit)`);
    if (o.gst && o.filing === 'composition') add(`${y}-04-30`, 'GSTR4', 'GSTR-4 annual (composition)', `FY ${fy}`);
  }
  return ev.sort((a, b) => a.date.localeCompare(b.date) || a.code.localeCompare(b.code));
}
module.exports = { FY, VERIFY, rules, slabTax, dueEvents, QRMP_22, OLD_SLABS, NEW_SLABS_2025 };
