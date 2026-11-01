// R&S Sons Accounting v2.0 - automation: recurring vouchers, bank statement import + auto-match,
// GSTR-2B import + ITC reconciliation, statutory due-date calendar.
const U = require('./util');
const { Company, VTYPES } = require('./company');
const r2 = U.r2;
const C = (k, label, t = 'text', extra = {}) => Object.assign({ k, label, t }, extra);
const P = Company.prototype;
const pad = n => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();   // m = 1..12
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(Math.min(d, lastDay(y, m)))}`;
function addMonths(date, n, day) { let [y, m] = date.split('-').map(Number); m += n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return ymd(y, m, day || +date.slice(8, 10)); }

// ======================= RECURRING VOUCHERS =======================
function nextAfter(r, d) {
  if (r.frequency === 'weekly') return U.addDays(d, 7);
  const step = r.frequency === 'quarterly' ? 3 : r.frequency === 'yearly' ? 12 : 1;
  return addMonths(d, step, Number(r.day) || +d.slice(8, 10));
}
function firstDue(r) { const s = r.start_date; if (r.frequency === 'weekly') return s; const d = Number(r.day) || +s.slice(8, 10); const cand = ymd(+s.slice(0, 4), +s.slice(5, 7), d); return cand >= s ? cand : nextAfter(r, cand); }
P.recurringList = function () {
  return this.all('SELECT * FROM recurring ORDER BY active DESC, name').map(r => { const t = JSON.parse(r.template_json || '{}'); return Object.assign(r, { template_json: undefined, vtype_name: (VTYPES[r.vtype] || {}).name || r.vtype, amount: t._total || null, party: t._party || '' }); });
};
P.saveRecurring = function (r) {
  if (!r || !String(r.name || '').trim()) throw new Error('Give the recurring entry a name (e.g. "Shop rent")');
  if (!['monthly', 'quarterly', 'yearly', 'weekly'].includes(r.frequency || 'monthly')) throw new Error('Frequency must be monthly, quarterly, yearly or weekly');
  if (!r.start_date || !/^\d{4}-\d{2}-\d{2}$/.test(r.start_date)) throw new Error('Start date is required');
  const day = Math.max(1, Math.min(31, Number(r.day) || +r.start_date.slice(8, 10)));
  let tpl;
  if (r.voucher_id) {
    const v = this.voucher(r.voucher_id); if (!v) throw new Error('Template voucher not found');
    tpl = this.voucherToInput(v); delete tpl.id; delete tpl.number; tpl.status = 'active';
    if (tpl.lines) for (const l of tpl.lines) { if (l.bill && (l.bill.type === 'agst' || l.bill.allocs)) l.bill = { type: 'onacc' }; l.bank_date = null; }
    tpl._total = v.total; tpl._party = v.party_name || (v.entries || []).map(e => e.ledger_name).filter(Boolean).slice(0, 2).join(' / ');
  } else if (r.id) tpl = JSON.parse(this.val('SELECT template_json FROM recurring WHERE id=?', [r.id]) || 'null');
  if (!tpl) throw new Error('Choose the voucher to repeat');
  const row = { name: String(r.name).trim(), template_json: JSON.stringify(tpl), vtype: tpl.vtype, frequency: r.frequency || 'monthly', day, start_date: r.start_date, end_date: r.end_date || null, auto_post: r.auto_post ? 1 : 0, active: r.active === false || r.active === 0 ? 0 : 1 };
  return this.tx(() => {
    if (r.id) { const old = this.get('SELECT * FROM recurring WHERE id=?', [r.id]); if (!old) throw new Error('Not found');
      if (old.start_date !== row.start_date || old.frequency !== row.frequency || Number(old.day) !== day) row.next_date = firstDue(row);
      this.update('recurring', r.id, row); this.audit('update', 'recurring', r.id, 'Recurring ' + row.name); return r.id; }
    row.next_date = firstDue(row); row.created_by = this.user; row.created_at = this.now();
    const id = this.insert('recurring', row); this.audit('create', 'recurring', id, `Recurring ${row.name} (${row.frequency}) from ${U.fmtDate(row.start_date)}`); return id;
  });
};
P.deleteRecurring = function (id) { this.tx(() => { const r = this.get('SELECT name FROM recurring WHERE id=?', [id]); this.run('DELETE FROM recurring WHERE id=?', [id]); this.audit('delete', 'recurring', id, 'Recurring ' + (r && r.name)); }); return true; };
P.recurringDue = function (asOf) {
  asOf = asOf || U.today(); const out = [];
  for (const r of this.all('SELECT * FROM recurring WHERE active=1')) {
    let d = r.next_date || firstDue(r); let n = 0;
    while (d && d <= asOf && (!r.end_date || d <= r.end_date) && n < 60) { out.push({ id: r.id, name: r.name, due_date: d, vtype: r.vtype, auto_post: r.auto_post }); d = nextAfter(r, d); n++; }
  }
  return out.sort((a, b) => a.due_date.localeCompare(b.due_date));
};
// Posts every due occurrence (each recurring id + due date only once, ever). Returns what was posted / skipped.
P.runRecurring = function (opts = {}) {
  const asOf = opts.asOf || U.today(); const due = this.recurringDue(asOf).filter(d => (!opts.onlyAuto || d.auto_post) && (!opts.ids || opts.ids.includes(d.id)));
  const out = { posted: [], errors: [] };
  if (!due.length) return out;
  const lock = this.setting('lock_date') || '';
  for (const d of due) {
    const r = this.get('SELECT * FROM recurring WHERE id=?', [d.id]);
    if (this.get('SELECT id FROM recurring_log WHERE recurring_id=? AND due_date=?', [d.id, d.due_date])) { this.run('UPDATE recurring SET next_date=? WHERE id=?', [nextAfter(r, d.due_date), d.id]); continue; }
    try {
      if (d.due_date <= lock) throw new Error('date is in the locked period');
      const inp = JSON.parse(r.template_json); delete inp._total; delete inp._party; inp.date = d.due_date;
      inp.narration = (inp.narration ? inp.narration + ' | ' : '') + `Recurring: ${r.name}`;
      const s = this.saveVoucher(inp);
      this.tx(() => { this.insert('recurring_log', { recurring_id: d.id, due_date: d.due_date, voucher_id: s.id, posted_by: this.user, posted_at: this.now() }); this.run('UPDATE recurring SET next_date=?, last_run=?, runs=runs+1 WHERE id=?', [nextAfter(r, d.due_date), d.due_date, d.id]); });
      out.posted.push({ name: r.name, date: d.due_date, number: s.number, id: s.id });
    } catch (e) { out.errors.push(`${r.name} (${U.fmtDate(d.due_date)}): ${e.message}`); break; }
  }
  return out;
};

// ======================= BANK STATEMENT IMPORT =======================
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function parseDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000); return d.toISOString().slice(0, 10); } // Excel serial
  const s = String(v).trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return ymd(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[\/\-. ](\d{1,2})[\/\-. ](\d{2,4})/))) { let y = +m[3]; if (y < 100) y += 2000; if (+m[2] > 12) return null; return ymd(y, +m[2], +m[1]); }   // Indian banks: dd/mm/yyyy
  if ((m = s.match(/^(\d{1,2})[\/\-. ]?([A-Za-z]{3})[A-Za-z]*[\/\-. ,]*(\d{2,4})/))) { let y = +m[3]; if (y < 100) y += 2000; const mo = MON[m[2].toLowerCase()]; return mo ? ymd(y, mo, +m[1]) : null; }
  return null;
}
function num(v) { if (v == null || v === '') return 0; if (typeof v === 'number') return v; const s = String(v).replace(/[₹,\s]/g, '').replace(/(Cr|Dr)\.?$/i, ''); const n = parseFloat(s); return isFinite(n) ? n : 0; }
function detectColumns(rows) {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const h = rows[i].map(x => String(x || '').toLowerCase().replace(/\s+/g, ' ').trim()); const f = re => h.findIndex(x => re.test(x));
    const date = f(/^(txn |tran |transaction |value )?date|^date/); if (date < 0) continue;
    const wd = f(/withdraw|debit|^dr\b|paid out|money out/), dp = f(/deposit|credit|^cr\b|paid in|money in/);
    const amt = f(/^amount|txn amount|transaction amount/), typ = f(/dr ?\/ ?cr|cr ?\/ ?dr|^type$|debit ?\/ ?credit/);
    if ((wd < 0 || dp < 0) && !(amt >= 0)) continue;
    return { header: i, date, narr: f(/narration|description|particular|remark|details/), ref: f(/chq|cheque|ref/), wd, dp, amt, typ, bal: f(/balance/) };
  }
  throw new Error('Could not find the header row (need Date + Withdrawal/Debit + Deposit/Credit, or Date + Amount + Dr/Cr columns). Save the statement from net banking as Excel or CSV.');
}
P.bankImport = function (o = {}) {
  const led = this.ledger(o.ledger_id); if (!led) throw new Error('Choose the bank ledger');
  const rows = o.rows || []; const col = detectColumns(rows);
  const lines = [];
  for (const r of rows.slice(col.header + 1)) {
    const date = parseDate(r[col.date]); if (!date) continue;
    let w = 0, d = 0;
    if (col.wd >= 0 && col.dp >= 0) { w = Math.abs(num(r[col.wd])); d = Math.abs(num(r[col.dp])); }
    else { const a = num(r[col.amt]); const t = String(r[col.typ] || '').toLowerCase(); if (/^d|dr|debit|withdraw/.test(t) || (col.typ < 0 && a < 0)) w = Math.abs(a); else d = Math.abs(a); }
    if (!w && !d) continue;
    const narr = col.narr >= 0 ? String(r[col.narr] || '').trim().slice(0, 300) : ''; const ref = col.ref >= 0 ? String(r[col.ref] || '').trim().slice(0, 60) : '';
    const bal = col.bal >= 0 && r[col.bal] !== '' ? num(r[col.bal]) : null;
    lines.push({ date, narration: narr, ref, withdrawal: r2(w), deposit: r2(d), balance: bal });
  }
  if (!lines.length) throw new Error('No transactions found below the header row');
  const out = { lines: lines.length, added: 0, duplicates: 0, matched: 0, from: lines.reduce((a, l) => l.date < a ? l.date : a, lines[0].date), to: lines.reduce((a, l) => l.date > a ? l.date : a, lines[0].date) };
  this.tx(() => {
    const sid = this.insert('bank_statements', { ledger_id: led.id, file_name: String(o.file_name || '').slice(0, 120), from_date: out.from, to_date: out.to, imported_by: this.user, imported_at: this.now() });
    const seen = {};
    for (const l of lines) {
      let fp = [l.date, l.withdrawal, l.deposit, l.balance == null ? '' : l.balance, l.narration.slice(0, 60), l.ref].join('|');
      seen[fp] = (seen[fp] || 0) + 1; if (seen[fp] > 1) fp += '#' + seen[fp];       // two identical lines in one statement stay two lines
      if (this.get('SELECT id FROM bank_lines WHERE ledger_id=? AND fingerprint=?', [led.id, fp])) { out.duplicates++; continue; }
      this.insert('bank_lines', Object.assign({ stmt_id: sid, ledger_id: led.id, status: 'unmatched', fingerprint: fp }, l)); out.added++;
    }
    this.run('UPDATE bank_statements SET lines=? WHERE id=?', [out.added, sid]);
    out.matched = this.bankAutoMatch(led.id);
    this.audit('import', 'bank', sid, `Bank statement ${led.name}: ${out.added} lines (${out.duplicates} already imported), ${out.matched} auto-matched`);
  });
  return out;
};
// Match statement lines to book entries on the same bank ledger: same amount, voucher date 7 days before .. 3 days after
// the bank date; a cheque/reference number found in both decides ties. Only an unambiguous match is made.
P.bankAutoMatch = function (ledgerId) {
  let n = 0;
  const lines = this.all("SELECT * FROM bank_lines WHERE ledger_id=? AND status='unmatched' ORDER BY date", [ledgerId]);
  for (const l of lines) {
    const amt = l.deposit || l.withdrawal; const side = l.deposit ? 'dr' : 'cr';
    const cands = this.all(`SELECT e.id, e.voucher_id, v.date, v.cheque_no, v.ref_no, v.number FROM entries e JOIN vouchers v ON v.id=e.voucher_id
      WHERE e.ledger_id=? AND v.status='active' AND ABS(e.${side}-?)<0.005 AND v.date BETWEEN ? AND ? AND e.id NOT IN (SELECT entry_id FROM bank_lines WHERE entry_id IS NOT NULL)`, [ledgerId, amt, U.addDays(l.date, -7), U.addDays(l.date, 3)]);
    if (!cands.length) continue;
    const txt = (l.narration + ' ' + l.ref).toUpperCase();
    const byRef = cands.filter(c => [c.cheque_no, c.ref_no].some(x => x && String(x).length >= 3 && txt.includes(String(x).toUpperCase())));
    let pick = null;
    if (byRef.length === 1) pick = byRef[0];
    else if (cands.length === 1) pick = cands[0];
    else { const dd = c => Math.abs((new Date(c.date) - new Date(l.date)) / 86400000); const s = cands.slice().sort((a, b) => dd(a) - dd(b)); if (dd(s[0]) < dd(s[1])) pick = s[0]; }
    if (!pick) continue;
    this.run("UPDATE bank_lines SET entry_id=?, voucher_id=?, status='matched' WHERE id=?", [pick.id, pick.voucher_id, l.id]);
    this.run('UPDATE entries SET bank_date=? WHERE id=? AND bank_date IS NULL', [l.date, pick.id]);
    n++;
  }
  return n;
};
P.bankRematch = function (ledgerId) { return this.tx(() => this.bankAutoMatch(ledgerId)); };
P.bankStatements = function (ledgerId) { return this.all(`SELECT s.*, l.name AS ledger_name, (SELECT COUNT(*) FROM bank_lines b WHERE b.stmt_id=s.id AND b.status='matched') AS matched FROM bank_statements s JOIN ledgers l ON l.id=s.ledger_id ${ledgerId ? 'WHERE s.ledger_id=?' : ''} ORDER BY s.id DESC`, ledgerId ? [ledgerId] : []); };
P.bankSuggest = function (narr) {
  const t = ' ' + String(narr || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ') + ' ';
  if (/\b(CHG|CHARGES?|SMS ALERT|FEE|GST ON|AMC)\b/.test(t)) { const l = this.get("SELECT id, name FROM ledgers WHERE name LIKE '%Bank Charge%' LIMIT 1"); if (l) return l; }
  if (/\b(INT\.?|INTEREST) (PD|PAID|CREDIT|CR)?\b|\bINT CR\b|\bINTEREST\b/.test(t)) { const l = this.get("SELECT id, name FROM ledgers WHERE name LIKE '%Interest%Income%' OR name LIKE '%Bank Interest%' LIMIT 1"); if (l) return l; }
  let best = null, bestScore = 0;
  for (const l of this.all("SELECT l.id, l.name FROM ledgers l JOIN groups g ON g.id=l.group_id WHERE g.name IN ('Sundry Debtors','Sundry Creditors') OR g.parent_id IN (SELECT id FROM groups WHERE name IN ('Sundry Debtors','Sundry Creditors'))")) {
    const words = l.name.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length >= 4 && !['TRADERS', 'STORE', 'STORES', 'ENTERPRISES', 'PRIVATE', 'LIMITED', 'COMPANY', 'AGENCY', 'AGENCIES'].includes(w));
    const score = words.filter(w => t.includes(' ' + w + ' ') || t.includes(w)).length;
    if (score > bestScore) { bestScore = score; best = l; }
  }
  return best;
};
P.bankLines = function (f = {}) {
  const led = this.ledger(f.ledger_id); if (!led) throw new Error('Choose the bank ledger');
  const where = ['b.ledger_id=?']; const p = [led.id];
  if (f.stmt_id) { where.push('b.stmt_id=?'); p.push(f.stmt_id); }
  if (f.status && f.status !== 'all') { where.push('b.status=?'); p.push(f.status); }
  if (f.from) { where.push('b.date>=?'); p.push(f.from); } if (f.to) { where.push('b.date<=?'); p.push(f.to); }
  const rows = this.all(`SELECT b.*, v.number AS vno, v.vtype FROM bank_lines b LEFT JOIN vouchers v ON v.id=b.voucher_id WHERE ${where.join(' AND ')} ORDER BY b.date, b.id`, p).map(b => {
    const sug = b.status === 'unmatched' ? this.bankSuggest(b.narration) : null;
    return { id: b.id, date: b.date, narration: b.narration, ref: b.ref, withdrawal: b.withdrawal || null, deposit: b.deposit || null, balance: b.balance, status: b.status, voucher: b.vno ? `${VTYPES[b.vtype].short || b.vtype} ${b.vno}` : '', voucher_id: b.voucher_id, suggest_id: sug && sug.id, suggest: sug ? sug.name : '', _drill: b.voucher_id ? { voucher: b.voucher_id } : null };
  });
  const cnt = s => rows.filter(r => r.status === s).length;
  return { title: 'Bank statement lines: ' + led.name, subtitle: `${rows.length} lines · ${cnt('matched')} matched · ${cnt('unmatched')} not yet in books`, ledger_id: led.id,
    columns: [C('date', 'Date', 'date'), C('narration', 'Narration'), C('ref', 'Ref / Chq'), C('withdrawal', 'Withdrawal', 'amt'), C('deposit', 'Deposit', 'amt'), C('status', 'Status'), C('voucher', 'Voucher'), C('suggest', 'Suggested party')], rows };
};
P.bankMatch = function (lineId, entryId) {
  const l = this.get('SELECT * FROM bank_lines WHERE id=?', [lineId]); if (!l) throw new Error('Line not found');
  const e = this.get('SELECT e.*, v.status FROM entries e JOIN vouchers v ON v.id=e.voucher_id WHERE e.id=?', [entryId]); if (!e || e.ledger_id !== l.ledger_id) throw new Error('That entry is not on this bank ledger');
  const amt = l.deposit || l.withdrawal; if (Math.abs((l.deposit ? e.dr : e.cr) - amt) > 0.005) throw new Error('Amount / side does not match the bank line');
  this.tx(() => { this.run("UPDATE bank_lines SET entry_id=?, voucher_id=?, status='matched' WHERE id=?", [e.id, e.voucher_id, l.id]); this.run('UPDATE entries SET bank_date=? WHERE id=?', [l.date, e.id]); this.audit('update', 'bank', l.id, 'Bank line matched manually'); });
  return true;
};
P.bankUnmatch = function (lineId) {
  const l = this.get('SELECT * FROM bank_lines WHERE id=?', [lineId]); if (!l) throw new Error('Line not found');
  this.tx(() => { if (l.entry_id) this.run('UPDATE entries SET bank_date=NULL WHERE id=? AND bank_date=?', [l.entry_id, l.date]); this.run("UPDATE bank_lines SET entry_id=NULL, voucher_id=NULL, status='unmatched' WHERE id=?", [l.id]); this.audit('update', 'bank', l.id, 'Bank line un-matched'); });
  return true;
};
// Create the Receipt (deposit) / Payment (withdrawal) voucher for a bank line that is not in the books yet, and match it.
P.bankCreateVoucher = function (lineId, o = {}) {
  const l = this.get('SELECT * FROM bank_lines WHERE id=?', [lineId]); if (!l) throw new Error('Line not found');
  if (l.status === 'matched') throw new Error('Already matched');
  const party = this.ledger(o.ledger_id); if (!party) throw new Error('Choose the party / expense ledger for this line');
  const dep = l.deposit > 0; const amt = dep ? l.deposit : l.withdrawal;
  const s = this.saveVoucher({ vtype: dep ? 'RCT' : 'PMT', date: l.date, narration: o.narration || l.narration || '', pay_mode: 'Bank', cheque_no: l.ref || null,
    lines: [{ ledger_id: l.ledger_id, dr: dep ? amt : 0, cr: dep ? 0 : amt, bank_date: l.date }, { ledger_id: party.id, dr: dep ? 0 : amt, cr: dep ? amt : 0 }] });
  const e = this.get('SELECT id FROM entries WHERE voucher_id=? AND ledger_id=?', [s.id, l.ledger_id]);
  this.run("UPDATE bank_lines SET entry_id=?, voucher_id=?, status='matched' WHERE id=?", [e.id, s.id, l.id]);
  return s;
};
P.bankDeleteStatement = function (sid) {
  this.tx(() => { for (const l of this.all("SELECT * FROM bank_lines WHERE stmt_id=? AND entry_id IS NOT NULL", [sid])) this.run('UPDATE entries SET bank_date=NULL WHERE id=? AND bank_date=?', [l.entry_id, l.date]);
    this.run('DELETE FROM bank_lines WHERE stmt_id=?', [sid]); this.run('DELETE FROM bank_statements WHERE id=?', [sid]); this.audit('delete', 'bank', sid, 'Bank statement import removed'); });
  return true;
};

// ======================= GSTR-2B IMPORT + ITC RECONCILIATION =======================
const normInv = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(^|[A-Z])0+(?=\d)/g, '$1');   // 'MP-0055' = 'MP55', 'GC/101' = 'GC-101'
const d2b = s => { const m = String(s || '').match(/^(\d{2})-(\d{2})-(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : parseDate(s); };
function docTax(x) {   // 2B documents carry totals on the document and/or per rate in items[]
  const it = Array.isArray(x.items) && x.items.length ? x.items : null;
  const sum = k => r2(it ? it.reduce((s, i) => s + (+i[k] || 0), 0) : (+x[k] || 0));
  return { taxable: sum('txval'), igst: sum('igst'), cgst: sum('cgst'), sgst: sum('sgst'), cess: sum('cess') };
}
P.gstr2bImport = function (o = {}) {
  let j = o.json; if (typeof j === 'string') { try { j = JSON.parse(j); } catch (_) { throw new Error('This is not a JSON file. Download GSTR-2B from the GST portal: Returns › GSTR-2B › Download JSON.'); } }
  // the portal / API files wrap the payload ({"data":{"chksum":..,"data":{..}}}): find the object that holds "docdata"
  const find = (x, depth) => { if (!x || typeof x !== 'object' || depth > 5) return null; if (x.docdata || x.docData) return x; for (const k of Object.keys(x)) { const f = find(x[k], depth + 1); if (f) return f; } return null; };
  const d = find(j, 0); const dd = d && (d.docdata || d.docData);
  if (!d || !dd) throw new Error('Not a GSTR-2B JSON (no "docdata" section found)');
  const rp = String(d.rtnprd || o.period || ''); if (!/^\d{6}$/.test(rp)) throw new Error('Return period (rtnprd) missing in the file');
  const period = `${rp.slice(2)}-${rp.slice(0, 2)}`;   // MMYYYY -> YYYY-MM
  const docs = [];
  for (const s of dd.b2b || []) for (const inv of s.inv || []) docs.push(Object.assign({ kind: 'B2B', ctin: s.ctin, name: s.trdnm || '', num: inv.inum, date: d2b(inv.dt), value: +inv.val || 0, pos: inv.pos, rev: inv.rev, itc: inv.itcavl, reason: inv.rsn || '', ims: inv.imsStatus || '' }, docTax(inv)));
  for (const s of dd.b2ba || []) for (const inv of s.inv || []) docs.push(Object.assign({ kind: 'B2BA', ctin: s.ctin, name: s.trdnm || '', num: inv.inum, date: d2b(inv.dt), value: +inv.val || 0, pos: inv.pos, rev: inv.rev, itc: inv.itcavl, reason: inv.rsn || '', orig: inv.oinum }, docTax(inv)));
  for (const s of [...(dd.cdnr || []), ...(dd.cdnra || [])]) for (const nt of s.nt || []) { const t = docTax(nt); const sg = nt.typ === 'C' ? -1 : 1; docs.push({ kind: nt.typ === 'C' ? 'CDN-Credit' : 'CDN-Debit', ctin: s.ctin, name: s.trdnm || '', num: nt.ntnum, date: d2b(nt.dt), value: sg * (+nt.val || 0), pos: nt.pos, rev: nt.rev, itc: nt.itcavl, reason: nt.rsn || '', taxable: sg * t.taxable, igst: sg * t.igst, cgst: sg * t.cgst, sgst: sg * t.sgst, cess: sg * t.cess }); }
  const myGstin = String(this.setting('gstin') || '').toUpperCase();
  const warn = d.gstin && myGstin && d.gstin.toUpperCase() !== myGstin ? `This 2B is for GSTIN ${d.gstin}, but the company GSTIN is ${myGstin}.` : null;
  this.tx(() => {
    this.run('DELETE FROM gstr2b_imports WHERE period=?', [period]);
    const id = this.insert('gstr2b_imports', { period, gstin: d.gstin || '', file_name: String(o.file_name || '').slice(0, 120), docs: docs.length, data_json: JSON.stringify(docs), imported_by: this.user, imported_at: this.now() });
    this.audit('import', 'gstr2b', id, `GSTR-2B ${period}: ${docs.length} documents`);
  });
  const tot = k => r2(docs.reduce((s, x) => s + (x.itc === 'N' ? 0 : (x[k] || 0)), 0));
  return { period, docs: docs.length, suppliers: new Set(docs.map(x => x.ctin)).size, itc: { igst: tot('igst'), cgst: tot('cgst'), sgst: tot('sgst'), cess: tot('cess') }, warning: warn };
};
P.gstr2bList = function () { return this.all('SELECT id, period, gstin, file_name, docs, imported_by, imported_at FROM gstr2b_imports ORDER BY period DESC'); };
P.gstr2bDelete = function (period) { this.tx(() => { this.run('DELETE FROM gstr2b_imports WHERE period=?', [period]); this.audit('delete', 'gstr2b', 0, 'GSTR-2B ' + period + ' removed'); }); return true; };
P.gstr2bRecon = function (f = {}) {
  const imp = this.get('SELECT * FROM gstr2b_imports WHERE period=?', [f.period]) || this.get('SELECT * FROM gstr2b_imports ORDER BY period DESC LIMIT 1');
  if (!imp) throw new Error('Import a GSTR-2B JSON first (GST portal › Returns › GSTR-2B › Download JSON)');
  const period = imp.period; const pFrom = period + '-01', pTo = ymd(+period.slice(0, 4), +period.slice(5, 7), 31);
  const docs = JSON.parse(imp.data_json || '[]');
  const fy = U.fyOf(pFrom);
  const tol = f.tolerance != null ? +f.tolerance : 1;
  // books: purchases & debit notes with a registered supplier, whole FY (an invoice can be booked in a different month)
  const books = this.all(`SELECT v.id, v.vtype, v.date, v.number, v.ref_no, v.ref_date, v.orig_ref, v.taxable, v.igst, v.cgst, v.sgst, v.cess, v.total, v.rcm, UPPER(COALESCE(NULLIF(v.buyer_gstin,''), p.gstin)) AS gstin, p.name AS party
    FROM vouchers v LEFT JOIN ledgers p ON p.id=v.party_id WHERE v.status='active' AND v.vtype IN ('PUR','DBN') AND v.date BETWEEN ? AND ? AND COALESCE(NULLIF(v.buyer_gstin,''), p.gstin) IS NOT NULL AND COALESCE(NULLIF(v.buyer_gstin,''), p.gstin)<>''`, [fy.start, U.addDays(fy.end, 60)]);
  const key = (g, n) => String(g || '').toUpperCase() + '|' + normInv(n);
  const bk = {}; for (const b of books) { const k = key(b.gstin, b.ref_no || b.number); (bk[k] = bk[k] || []).push(b); }
  // other imported 2B periods (so "missing in 2B" ignores bills that appear in another month's 2B)
  const other = new Set(); for (const o of this.all('SELECT data_json FROM gstr2b_imports WHERE period<>?', [period])) for (const x of JSON.parse(o.data_json || '[]')) other.add(key(x.ctin, x.num));
  const used = new Set(); const rows = [];
  const tax = x => r2((x.igst || 0) + (x.cgst || 0) + (x.sgst || 0) + (x.cess || 0));
  for (const x of docs) {
    const isCN = x.kind.startsWith('CDN');
    const cands = (bk[key(x.ctin, x.num)] || []).filter(b => !used.has(b.id) && (isCN ? b.vtype === 'DBN' : b.vtype === 'PUR'));
    const sg = isCN && x.kind === 'CDN-Credit' ? -1 : 1;
    const row = { status: '', kind: x.kind, gstin: x.ctin, supplier: x.name, inv: x.num, date2b: x.date, taxable2b: x.taxable, tax2b: tax(x), itc: x.itc === 'N' ? 'No' : 'Yes', reason: x.reason || '', rev: x.rev === 'Y' ? 'RCM' : '' };
    if (!cands.length) { row.status = 'Missing in books'; row.note = 'Supplier filed it; not entered in your purchases'; rows.push(row); continue; }
    const b = cands[0]; used.add(b.id);
    Object.assign(row, { datebk: b.date, taxablebk: r2(sg * b.taxable), taxbk: r2(sg * tax(b)), voucher: b.number, _drill: { voucher: b.id } });
    const dT = r2(row.taxable2b - row.taxablebk), dX = r2(row.tax2b - row.taxbk);
    row.diff = dX;
    if (Math.abs(dT) <= tol && Math.abs(dX) <= tol) { row.status = 'Matched'; row.note = b.date.slice(0, 7) !== period ? `Booked in ${b.date.slice(0, 7)}` : ''; }
    else { row.status = 'Mismatch'; row.note = `Taxable differs by ${U.inr(dT)}, tax by ${U.inr(dX)}`; }
    rows.push(row);
  }
  for (const b of books) {
    if (used.has(b.id) || b.date < pFrom || b.date > pTo) continue;
    if (other.has(key(b.gstin, b.ref_no || b.number))) continue;
    const sg = b.vtype === 'DBN' ? -1 : 1;
    rows.push({ status: 'Missing in 2B', kind: b.vtype === 'DBN' ? 'Debit Note' : 'Purchase', gstin: b.gstin, supplier: b.party, inv: b.ref_no || b.number, datebk: b.date, taxablebk: r2(sg * b.taxable), taxbk: r2(sg * tax(b)), voucher: b.number, note: b.rcm ? 'Reverse charge bill (not in 2B B2B)' : 'Not in 2B: ITC at risk — ask supplier to file GSTR-1', _drill: { voucher: b.id } });
  }
  const order = { 'Mismatch': 0, 'Missing in books': 1, 'Missing in 2B': 2, 'Matched': 3 };
  rows.sort((a, b) => order[a.status] - order[b.status] || String(a.supplier).localeCompare(String(b.supplier)));
  const sum = (s, k) => r2(rows.filter(r => !s || r.status === s).reduce((t, r) => t + (r[k] || 0), 0));
  const cnt = s => rows.filter(r => r.status === s).length;
  const itc2b = r2(docs.filter(x => x.itc !== 'N' && x.rev !== 'Y').reduce((s, x) => s + tax(x), 0));
  const itcBooks = r2(books.filter(b => b.date >= pFrom && b.date <= pTo && !b.rcm).reduce((s, b) => s + (b.vtype === 'DBN' ? -1 : 1) * tax(b), 0));
  return { title: `GSTR-2B vs Purchase Books — ${period}`, subtitle: `${cnt('Matched')} matched · ${cnt('Mismatch')} mismatch · ${cnt('Missing in books')} missing in books · ${cnt('Missing in 2B')} missing in 2B · ITC as per 2B ₹${U.inr(itc2b)} vs books ₹${U.inr(itcBooks)}`,
    period, summary: { matched: cnt('Matched'), mismatch: cnt('Mismatch'), missingBooks: cnt('Missing in books'), missing2b: cnt('Missing in 2B'), itc2b, itcBooks, diff: r2(itc2b - itcBooks), taxMissingBooks: sum('Missing in books', 'tax2b'), taxMissing2b: sum('Missing in 2B', 'taxbk') },
    columns: [C('status', 'Status'), C('supplier', 'Supplier'), C('gstin', 'GSTIN'), C('inv', 'Invoice No.'), C('date2b', '2B Date', 'date'), C('datebk', 'Books Date', 'date'), C('taxable2b', 'Taxable (2B)', 'amt'), C('taxablebk', 'Taxable (Books)', 'amt'), C('tax2b', 'Tax (2B)', 'amt'), C('taxbk', 'Tax (Books)', 'amt'), C('itc', 'ITC avl'), C('note', 'Note')], rows };
};

// ======================= DUE DATES =======================
// Statutory calendar. The rules (dates, UP's QRMP group, etc.) live in taxrules.js with their sources.
P.dueDates = function (f = {}) {
  const R = require('./taxrules');
  const asOn = f.asOn || U.today(); const s = this.settings(); const days = f.days || 45;
  const from = U.addDays(asOn, -(f.back == null ? 7 : f.back)), to = U.addDays(asOn, days);
  const ev = R.dueEvents(from, to, { gst: s.gst_registered !== '0', filing: s.gst_filing || 'monthly', state: s.state_code || '09', tds: !!this.get("SELECT id FROM ledgers WHERE tax_type IN ('TDS','TDS_SAL') AND id IN (SELECT ledger_id FROM entries) LIMIT 1") || s.tds_applicable === '1', audit: s.tax_audit === '1' });
  return ev.map(e => Object.assign(e, { days: Math.round((new Date(e.date) - new Date(asOn)) / 86400000) }));
};
module.exports = { parseDate, detectColumns, normInv };
