// R&S Sons Accounting v2.4 — units master checks, duplicate supplier-bill warning, exception reports (duplicate bills, voucher number gaps).
'use strict';
const { Company } = require('./company');
const U = require('./util');
const P = Company.prototype;
const C = (k, label, t) => ({ k, label, t: t || 'text' });
const UQC = ['NOS', 'PCS', 'KGS', 'GMS', 'LTR', 'MLT', 'MTR', 'BOX', 'DOZ', 'PAC', 'SET', 'BAG', 'BTL', 'CTN', 'QTL', 'TON', 'SQM', 'SQF', 'UNT', 'OTH', 'BDL', 'BUN', 'CAN', 'CMS', 'GGK', 'GRS', 'KLR', 'KME', 'MTS', 'NOS', 'PRS', 'ROL', 'TBS', 'TGM', 'THD', 'TUB', 'UGS', 'YDS', 'CBM', 'CCM', 'SQY', 'BKL', 'DRM', 'GYD', 'MLS'];

// ---------- units: clear messages instead of database errors ----------
const _saveSimple = P.saveSimple;
P.saveSimple = function (table, obj) {
  if (table === 'units' && obj) {
    const name = String(obj.name == null ? '' : obj.name).trim().replace(/\s+/g, ' ');
    if (obj.name !== undefined || !obj.id) {
      if (!name) throw new Error('Unit name is required');
      if (name.length > 20) throw new Error('Unit name: at most 20 letters (e.g. Kg, Box, Carton)');
      const dup = this.get('SELECT id, name FROM units WHERE name=? COLLATE NOCASE AND id<>?', [name, obj.id || 0]);
      if (dup) throw new Error(`Unit "${dup.name}" already exists — choose it from the list`);
      obj = Object.assign({}, obj, { name });
    }
    if (obj.uqc !== undefined && obj.uqc !== null && obj.uqc !== '') { const q = String(obj.uqc).trim().toUpperCase(); if (!UQC.includes(q)) throw new Error('GST UQC must be one of the GST unit codes (e.g. NOS, KGS, BOX, OTH)'); obj.uqc = q; }
    if (obj.decimals !== undefined && obj.decimals !== '') { const d = Number(obj.decimals); if (!Number.isInteger(d) || d < 0 || d > 4) throw new Error('Decimal places: 0 to 4'); obj.decimals = d; }
  }
  return _saveSimple.call(this, table, obj);
};
const _deleteSimple = P.deleteSimple;
P.deleteSimple = function (table, id) {
  if (table === 'units') {
    const n = this.val('SELECT COUNT(*) FROM items WHERE unit_id=?', [id]);
    if (n) { const names = this.all('SELECT name FROM items WHERE unit_id=? ORDER BY name LIMIT 3', [id]).map(r => r.name); throw new Error(`This unit is used by ${n} item${n === 1 ? '' : 's'} (${names.join(', ')}${n > 3 ? ', …' : ''}) — change those items to another unit first`); }
  }
  return _deleteSimple.call(this, table, id);
};
// Units with how many items use each one (Units master screen)
P.unitsUsage = function () {
  return this.all('SELECT u.id, u.name, u.uqc, u.decimals, COUNT(i.id) AS items FROM units u LEFT JOIN items i ON i.unit_id=u.id GROUP BY u.id ORDER BY u.name');
};

// ---------- duplicate supplier bill: the same supplier bill number entered twice ----------
function normRef(s) { return String(s || '').toUpperCase().replace(/[\s\-\/\\.]+/g, ''); }
const _saveVoucher = P.saveVoucher;
P.saveVoucher = function (v) {
  const r = _saveVoucher.call(this, v);
  try {
    if (v && (v.vtype === 'PUR' || v.vtype === 'DBN') && r && r.id) {
      const cur = this.get('SELECT id, vtype, party_id, ref_no, fy FROM vouchers WHERE id=?', [r.id]);
      if (cur && cur.party_id && normRef(cur.ref_no)) {
        const others = this.all("SELECT v.number, v.date, v.ref_no FROM vouchers v WHERE v.vtype=? AND v.party_id=? AND v.id<>? AND v.status<>'cancelled' AND v.ref_no IS NOT NULL", [cur.vtype, cur.party_id, cur.id]).filter(o => normRef(o.ref_no) === normRef(cur.ref_no));
        if (others.length) { r.warnings = r.warnings || []; r.warnings.push(`Possible duplicate: supplier bill no. ${cur.ref_no} of this party is already entered (${others.map(o => '#' + o.number + ' dt ' + U.fmtDate(o.date)).join(', ')})`); }
      }
    }
  } catch (_) {}
  return r;
};
// Report: supplier bills / debit notes entered more than once (same party + same bill number, spaces and dashes ignored)
P.dupBills = function (f = {}) {
  const from = f.from || '0000-01-01', to = f.to || '9999-12-31';
  const rows = this.all("SELECT v.id, v.vtype, v.number, v.date, v.ref_no, v.ref_date, v.total, v.party_id, l.name AS party FROM vouchers v LEFT JOIN ledgers l ON l.id=v.party_id WHERE v.vtype IN ('PUR','DBN','SAL') AND v.status<>'cancelled' AND v.party_id IS NOT NULL ORDER BY v.date, v.id");
  const groups = new Map();
  for (const r of rows) {
    const ref = r.vtype === 'SAL' ? null : normRef(r.ref_no); if (!ref) continue;
    const k = r.vtype + '|' + r.party_id + '|' + ref; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r);
  }
  // sales: the same party, same date and same amount twice is worth a look as well
  const sg = new Map();
  for (const r of rows) if (r.vtype === 'SAL') { const k = r.party_id + '|' + r.date + '|' + U.r2(r.total); if (!sg.has(k)) sg.set(k, []); sg.get(k).push(r); }
  const out = [];
  const push = (list, why) => { if (list.length < 2 || !list.some(x => x.date >= from && x.date <= to)) return; list.forEach((x, i) => out.push({ _drill: { voucher: x.id }, why: i ? '' : why, vtype: ({ PUR: 'Purchase', DBN: 'Debit Note', SAL: 'Sales' })[x.vtype], number: x.number, date: x.date, party: x.party, ref_no: x.ref_no || '', total: x.total, _warn: true })); };
  for (const list of groups.values()) push(list, 'Same supplier bill no. ' + list[0].ref_no + ' entered ' + list.length + ' times');
  for (const list of sg.values()) push(list, 'Same customer, same date, same amount (' + list.length + ' invoices)');
  return { title: 'Duplicate Bills Check', subtitle: `${U.fmtDate(from === '0000-01-01' ? '' : from)} to ${U.fmtDate(to === '9999-12-31' ? '' : to)} · purchase bills with the same supplier bill number, and sales invoices with the same customer, date and amount`,
    columns: [C('why', 'Why flagged'), C('vtype', 'Type'), C('number', 'No.'), C('date', 'Date', 'date'), C('party', 'Party'), C('ref_no', 'Supplier Bill No.'), C('total', 'Amount', 'amt')], rows: out };
};
// Report: missing numbers in each voucher series of a financial year (GST "documents issued" needs every number accounted for)
P.numberGaps = function (f = {}) {
  const fy = f.fy || U.fyOf(f.to || U.today()).label;
  const series = this.all("SELECT vtype, number, seq, status FROM vouchers WHERE fy=? ORDER BY vtype, seq", [fy]);
  const by = {}; for (const r of series) (by[r.vtype] = by[r.vtype] || []).push(r);
  const out = []; const VT = require('./schema').VTYPES;
  for (const [vt, list] of Object.entries(by)) {
    const nums = list.map(r => { const m = String(r.number || '').match(/^(.*?)(\d+)(\D*)$/); return m ? { pre: m[1], n: Number(m[2]), w: m[2].length, suf: m[3], st: r.status } : null; }).filter(Boolean);
    const bySeries = {}; for (const x of nums) (bySeries[x.pre + '|' + x.suf] = bySeries[x.pre + '|' + x.suf] || []).push(x);
    for (const [key, arr] of Object.entries(bySeries)) {
      arr.sort((a, b) => a.n - b.n); const [pre, suf] = key.split('|'); const fmt = (n, w) => pre + String(n).padStart(w, '0') + suf;
      const missing = []; for (let i = 1; i < arr.length; i++) for (let n = arr[i - 1].n + 1; n < arr[i].n && missing.length < 500; n++) missing.push(fmt(n, arr[i].w));
      const dups = arr.filter((x, i) => i && x.n === arr[i - 1].n).map(x => fmt(x.n, x.w));
      const cancelled = arr.filter(x => x.st === 'cancelled').length;
      out.push({ vtype: (VT[vt] && VT[vt].name) || vt, series: pre + '…' + suf, first: fmt(arr[0].n, arr[0].w), last: fmt(arr[arr.length - 1].n, arr[arr.length - 1].w), count: arr.length, cancelled, missingCount: missing.length, missing: missing.slice(0, 40).join(', ') + (missing.length > 40 ? ` … (+${missing.length - 40} more)` : ''), dups: dups.join(', '), _warn: missing.length > 0 || dups.length > 0 });
    }
  }
  return { title: 'Voucher Number Gaps', subtitle: `Financial year ${fy} · numbers missing in each series (a deleted voucher leaves a gap; a cancelled one keeps its number)`,
    columns: [C('vtype', 'Voucher Type'), C('series', 'Series'), C('first', 'First No.'), C('last', 'Last No.'), C('count', 'Vouchers', 'num'), C('cancelled', 'Cancelled', 'num'), C('missingCount', 'Missing', 'num'), C('missing', 'Missing numbers'), C('dups', 'Repeated numbers')], rows: out };
};
module.exports = {};
