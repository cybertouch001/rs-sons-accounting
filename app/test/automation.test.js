// v2.0 automation tests: node test/automation.test.js
const assert = require('assert');
const initSqlJs = require('sql.js');
const { Company, util: U } = require('../core');
const R = require('../core/taxrules');
const g = s => s + U.gstinChecksum(s);
let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; console.log('  ✓ ' + m); };
(async () => {
  const SQL = await initSqlJs(); const db = new SQL.Database();
  const c = Company.create(db, { name: 'Auto Test', state_code: '09', gstin: g('09AAACR5055K1Z'), books_begin: '2026-04-01' }, 'admin');
  const grp = n => c.groupByName(n).id;
  const bank = c.saveLedger({ name: 'SBI Current', group_id: grp('Bank Accounts'), opening: 500000 });
  const rentL = c.saveLedger({ name: 'Shop Rent', group_id: grp('Indirect Expenses') });
  const cust = c.saveLedger({ name: 'Kashi Medical Store', group_id: grp('Sundry Debtors') });
  const sup = c.saveLedger({ name: 'Ganga Chemicals', group_id: grp('Sundry Creditors'), gstin: g('09AADCG7777Q1Z') });
  const sup2 = c.saveLedger({ name: 'Mumbai Packaging Co', group_id: grp('Sundry Creditors'), gstin: g('27AAFCM2222R1Z') });
  const nos = c.list('units').find(u => u.name === 'Nos').id;
  const item = c.saveItem({ name: 'Serum', unit_id: nos, hsn: '33049990', gst_rate: 18, purchase_rate: 100 });

  console.log('Recurring vouchers');
  const rentV = c.saveVoucher({ vtype: 'PMT', date: '2026-04-05', narration: 'April rent', lines: [{ ledger_id: bank, dr: 0, cr: 25000 }, { ledger_id: rentL, dr: 25000, cr: 0 }] });
  const rid = c.saveRecurring({ name: 'Shop rent', voucher_id: rentV.id, frequency: 'monthly', day: 5, start_date: '2026-05-01', auto_post: 1 });
  ok(c.recurringDue('2026-07-10').length === 3, 'monthly rent from May: due on 5 May, 5 Jun, 5 Jul by 10 Jul');
  let out = c.runRecurring({ asOf: '2026-07-10' });
  ok(out.posted.length === 3 && out.posted.map(p => p.date).join() === '2026-05-05,2026-06-05,2026-07-05', 'posted 3 payment vouchers on the right dates');
  ok(c.runRecurring({ asOf: '2026-07-10' }).posted.length === 0, 'running again posts nothing (each date only once)');
  ok(c.ledgerBalance(rentL, '2026-07-31') === 100000, 'rent ledger = 4 × ₹25,000');
  c.saveRecurring({ id: rid, name: 'Shop rent', frequency: 'monthly', day: 31, start_date: '2026-05-01', auto_post: 1 });
  ok(c.recurringList()[0].next_date === '2026-05-31', 'day 31 → last day of short months handled (31 May)');
  ok(c.runRecurring({ asOf: '2026-05-31' }).posted.length === 1, 'changed schedule posts the new due date');

  console.log('Bank statement import + auto-match');
  const rct = c.saveVoucher({ vtype: 'RCT', date: '2026-08-02', lines: [{ ledger_id: bank, dr: 11800, cr: 0 }, { ledger_id: cust, dr: 0, cr: 11800 }] });
  const pmt = c.saveVoucher({ vtype: 'PMT', date: '2026-08-04', cheque_no: '000451', lines: [{ ledger_id: bank, dr: 0, cr: 5000 }, { ledger_id: sup, dr: 5000, cr: 0 }] });
  const pmt2 = c.saveVoucher({ vtype: 'PMT', date: '2026-08-04', cheque_no: '000452', lines: [{ ledger_id: bank, dr: 0, cr: 5000 }, { ledger_id: sup2, dr: 5000, cr: 0 }] });
  const rows = [['State Bank of India'], ['Account Statement'], [], ['Txn Date', 'Value Date', 'Description', 'Ref No./Cheque No.', 'Debit', 'Credit', 'Balance'],
    ['03/08/2026', '03/08/2026', 'NEFT CR KASHI MEDICAL STORE', 'N123', '', '11,800.00', '1,00,000.00'],
    ['05-Aug-2026', '', 'CHQ PAID 000452 MUMBAI PACK', '000452', '5,000.00', '', '95,000.00'],
    ['06 Aug 2026', '', 'CHQ PAID 000451', '000451', '5000', '', '90,000.00'],
    ['07/08/2026', '', 'UPI/KASHI MEDICAL/PAYMENT', 'UPI99', '', '2,360.00', '92,360.00'],
    ['31/08/2026', '', 'SMS ALERT CHARGES', '', '17.70', '', '92,342.30'], ['', '', 'Closing balance', '', '', '', '']];
  let im = c.bankImport({ ledger_id: bank, rows, file_name: 'sbi-aug.xlsx' });
  ok(im.added === 5 && im.from === '2026-08-03' && im.to === '2026-08-31', 'SBI layout read: 5 lines, dd/mm/yyyy + dd-Mon-yyyy dates');
  ok(im.matched === 3, '3 lines auto-matched (receipt by amount; two ₹5,000 cheques told apart by cheque no.)');
  const bl = c.bankLines({ ledger_id: bank, status: 'all' });
  ok(bl.rows.find(r => r.ref === '000452').voucher_id === pmt2.id && bl.rows.find(r => r.ref === '000451').voucher_id === pmt.id, 'cheque 000452 → its own voucher, 000451 → its own voucher');
  ok(c.get('SELECT bank_date FROM entries WHERE voucher_id=? AND ledger_id=?', [rct.id, bank]).bank_date === '2026-08-03', 'matched entry gets bank date (BRS updated)');
  ok(c.bankImport({ ledger_id: bank, rows, file_name: 'again' }).duplicates === 5, 're-importing the same statement adds nothing (5 duplicates)');
  const un = bl.rows.find(r => r.ref === 'UPI99');
  ok(un.status === 'unmatched' && un.suggest_id === cust, 'unmatched UPI line suggests party "Kashi Medical Store" from narration');
  const cv = c.bankCreateVoucher(un.id, { ledger_id: cust });
  ok(c.voucher(cv.id).vtype === 'RCT' && c.voucher(cv.id).total === 2360, 'create Receipt ₹2,360 from the bank line');
  ok(c.bankLines({ ledger_id: bank, status: 'unmatched' }).rows.length === 1, 'only the bank-charge line is left unmatched');
  const amtRows = [['Date', 'Narration', 'Amount', 'Dr/Cr'], ['2026-09-01', 'INT CREDIT', '120.50', 'CR'], ['2026-09-02', 'ATM WDL', '2000', 'DR']];
  im = c.bankImport({ ledger_id: bank, rows: amtRows });
  ok(im.added === 2 && c.bankLines({ ledger_id: bank, status: 'unmatched', from: '2026-09-01' }).rows.find(r => r.withdrawal === 2000), 'single Amount + Dr/Cr column layout also read');
  assert.throws(() => c.bankImport({ ledger_id: bank, rows: [['foo', 'bar'], ['1', '2']] }), /header row/); ok(true, 'file without a header row is refused with a clear message');

  console.log('GSTR-2B import + reconciliation');
  const p1 = c.saveVoucher({ vtype: 'PUR', date: '2026-09-05', party_id: sup, ref_no: 'GC/101', items: [{ item_id: item, qty: 100, rate: 100 }] });          // 10,000 + 1,800 (CGST/SGST 900 each)
  const p2 = c.saveVoucher({ vtype: 'PUR', date: '2026-09-08', party_id: sup2, ref_no: 'MP-0055', items: [{ item_id: item, qty: 50, rate: 100 }] });          // 5,000 + IGST 900
  const p3 = c.saveVoucher({ vtype: 'PUR', date: '2026-09-20', party_id: sup, ref_no: 'GC/120', items: [{ item_id: item, qty: 10, rate: 100 }] });            // not in 2B
  const j = { data: { gstin: c.setting('gstin'), rtnprd: '092026', docdata: {
    b2b: [{ ctin: g('09AADCG7777Q1Z'), trdnm: 'GANGA CHEMICALS', inv: [{ inum: 'GC-101', dt: '05-09-2026', val: 11800, pos: '09', rev: 'N', itcavl: 'Y', items: [{ num: 1, rt: 18, txval: 10000, igst: 0, cgst: 900, sgst: 900, cess: 0 }] },
                                                                     { inum: 'GC/115', dt: '15-09-2026', val: 2360, pos: '09', rev: 'N', itcavl: 'Y', items: [{ num: 1, rt: 18, txval: 2000, cgst: 180, sgst: 180 }] }] },
          { ctin: g('27AAFCM2222R1Z'), trdnm: 'MUMBAI PACKAGING', inv: [{ inum: 'MP55', dt: '08-09-2026', val: 5900, pos: '09', rev: 'N', itcavl: 'Y', txval: 5500, igst: 990, cgst: 0, sgst: 0, cess: 0 }] }] } } };
  const imp = c.gstr2bImport({ json: JSON.stringify(j), file_name: 'GSTR2B_092026.json' });
  ok(imp.period === '2026-09' && imp.docs === 3 && imp.itc.cgst === 1080, 'imported 2B Sep 2026: 3 invoices, CGST ITC ₹1,080');
  const rec = c.gstr2bRecon({ period: '2026-09' });
  const st = inv => rec.rows.find(r => r.inv === inv).status;
  ok(st('GC-101') === 'Matched', '"GC-101" in 2B matched to purchase "GC/101" (invoice no. normalised)');
  ok(st('MP55') === 'Mismatch', '"MP55" vs books "MP-0055": found, but taxable 5,500 ≠ 5,000 → Mismatch');
  ok(st('GC/115') === 'Missing in books', 'GC/115 in 2B but not entered → Missing in books');
  ok(rec.rows.find(r => r.inv === 'GC/120').status === 'Missing in 2B', 'GC/120 in books but not in 2B → Missing in 2B (ITC at risk)');
  ok(rec.summary.itc2b === 3150 && rec.summary.itcBooks === 2880, 'ITC: 2B ₹3,150 (1,800 + 360 + 990) vs books ₹2,880 (1,800 + 900 + 180)');
  c.gstr2bImport({ json: j, file_name: 'again' }); ok(c.gstr2bList().length === 1, 're-import of same month replaces it');
  assert.throws(() => c.gstr2bImport({ json: '{"foo":1}' }), /GSTR-2B/); ok(true, 'non-2B JSON refused');

  console.log('Due dates');
  let ev = R.dueEvents('2026-11-01', '2026-12-31', { gst: true, filing: 'monthly', state: '09', tds: true });
  const has = (d, code) => ev.some(e => e.date === d && e.code === code);
  ok(has('2026-11-11', 'GSTR1') && has('2026-11-20', 'GSTR3B') && has('2026-11-07', 'TDSPAY') && has('2026-12-15', 'ADV3') && has('2026-12-31', 'GSTR9'), 'monthly filer: GSTR-1 11th, 3B 20th, TDS 7th, advance tax 15 Dec, GSTR-9 31 Dec');
  ev = R.dueEvents('2027-01-01', '2027-01-31', { gst: true, filing: 'qrmp', state: '09', tds: true });
  ok(ev.some(e => e.date === '2027-01-13' && e.code === 'GSTR1') && ev.some(e => e.date === '2027-01-24' && e.code === 'GSTR3B') && ev.some(e => e.date === '2027-01-31' && e.code === 'TDSQ3'), 'QRMP in UP: GSTR-1 13 Jan, GSTR-3B 24 Jan; TDS Q3 return 31 Jan');
  ev = R.dueEvents('2027-01-01', '2027-01-31', { gst: true, filing: 'qrmp', state: '27' });
  ok(ev.some(e => e.date === '2027-01-22' && e.code === 'GSTR3B'), 'QRMP in Maharashtra: GSTR-3B 22nd');
  ev = R.dueEvents('2027-04-01', '2027-04-30', { gst: false, tds: true });
  ok(ev.some(e => e.date === '2027-04-30' && e.code === 'TDSPAY'), 'TDS for March due 30 April');
  ok(c.dueDates({ asOn: '2026-11-01' }).every(e => typeof e.days === 'number'), 'company due-date list has days-left');

  console.log('Two users editing the same voucher');
  const v = c.voucher(p1.id);
  const inp = c.voucherToInput(v); inp.base_rev = v.rev || 0; inp.narration = 'edited by A';
  c.user = 'userA'; c.saveVoucher(inp);
  const inpB = c.voucherToInput(v); inpB.base_rev = v.rev || 0; inpB.narration = 'edited by B';
  c.user = 'userB';
  assert.throws(() => c.saveVoucher(inpB), /changed by userA/); ok(true, 'second save with the old revision is refused, naming who changed it');
  ok(c.voucher(p1.id).narration === 'edited by A', "first user's change is kept (nothing overwritten)");
  console.log(`\nautomation tests: ${pass} passed`);
})().catch(e => { console.error(e); process.exit(1); });
