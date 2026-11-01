
// R&S Sons Accounting - GST returns (GSTR-1, GSTR-3B, HSN), e-invoice / e-way bill JSON
const U = require('./util');
const { C, P } = require('./reports1');
const r2 = U.r2;
const B2CL_LIMIT = 100000; // inter-state B2C invoices above Rs 1 lakh are B2CL (from 1 Aug 2024)

P.gstLines = function (from, to, types) {
  return this.all(`SELECT v.id AS vid, v.vtype, v.number, v.date, v.total, v.is_inter, v.place_of_supply AS pos, v.rcm, v.orig_ref, v.status,
     COALESCE(NULLIF(v.buyer_gstin,''), p.gstin) AS gstin, COALESCE(NULLIF(v.buyer_name,''), p.name) AS party, p.gst_reg_type,
     vi.gst_rate AS rate, vi.taxable, vi.cgst, vi.sgst, vi.igst, vi.cess, vi.qty, i.hsn, i.name AS item, i.item_type, u.uqc, u.name AS unit
     FROM vouchers v JOIN vitems vi ON vi.voucher_id=v.id JOIN items i ON i.id=vi.item_id LEFT JOIN units u ON u.id=i.unit_id LEFT JOIN ledgers p ON p.id=v.party_id
     WHERE v.status='active' AND v.vtype IN (${types.map(t => `'${t}'`).join(',')}) AND v.date BETWEEN ? AND ? ORDER BY v.date, v.seq`, [from, to]);
};
function aggInvoices(lines) {
  const m = new Map();
  for (const l of lines) {
    let inv = m.get(l.vid); if (!inv) { inv = { vid: l.vid, vtype: l.vtype, number: l.number, date: l.date, total: l.total, gstin: l.gstin || '', party: l.party, pos: l.pos, inter: l.is_inter, rcm: l.rcm, orig: l.orig_ref, rates: new Map() }; m.set(l.vid, inv); }
    let r = inv.rates.get(l.rate); if (!r) { r = { rate: l.rate, taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0 }; inv.rates.set(l.rate, r); }
    for (const k of ['taxable', 'cgst', 'sgst', 'igst', 'cess']) r[k] = r2(r[k] + l[k]);
  }
  return [...m.values()];
}
P.gstr1Data = function (f = {}) {
  const { from, to } = this.periodDefaults(f);
  const sl = this.gstLines(from, to, ['SAL']); const cl = this.gstLines(from, to, ['CRN']);
  const sInv = aggInvoices(sl.filter(l => l.rate > 0 || l.taxable)), cInv = aggInvoices(cl);
  const b2b = [], b2cl = [], b2csMap = new Map(), cdnr = [], cdnur = [], nil = { intraReg: 0, intraUnreg: 0, interReg: 0, interUnreg: 0 };
  const addB2cs = (inv, r, sign) => { const typ = inv.inter ? 'INTER' : 'INTRA'; const k = inv.pos + '|' + r.rate + '|' + typ; let a = b2csMap.get(k); if (!a) { a = { pos: inv.pos, rate: r.rate, type: typ, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 }; b2csMap.set(k, a); } for (const x of ['taxable', 'igst', 'cgst', 'sgst', 'cess']) a[x] = r2(a[x] + sign * r[x]); };
  for (const inv of sInv) for (const r of inv.rates.values()) {
    if (r.rate === 0) { const key = (inv.inter ? 'inter' : 'intra') + (inv.gstin ? 'Reg' : 'Unreg'); nil[key] = r2(nil[key] + r.taxable); continue; }
    const row = { gstin: inv.gstin, party: inv.party, number: inv.number, date: inv.date, value: inv.total, pos: inv.pos + '-' + U.stateName(inv.pos), rcm: inv.rcm ? 'Y' : 'N', rate: r.rate, taxable: r.taxable, igst: r.igst, cgst: r.cgst, sgst: r.sgst, cess: r.cess, _drill: { voucher: inv.vid } };
    if (inv.gstin) b2b.push(row); else if (inv.inter && inv.total > B2CL_LIMIT) b2cl.push(row); else addB2cs(inv, r, 1);
  }
  for (const inv of cInv) for (const r of inv.rates.values()) {
    if (r.rate === 0) continue;
    const row = { gstin: inv.gstin, party: inv.party, number: inv.number, date: inv.date, orig: inv.orig || '', value: inv.total, pos: inv.pos + '-' + U.stateName(inv.pos), type: 'C', rate: r.rate, taxable: r.taxable, igst: r.igst, cgst: r.cgst, sgst: r.sgst, cess: r.cess, _drill: { voucher: inv.vid } };
    if (inv.gstin) cdnr.push(row); else if (inv.inter && inv.total > B2CL_LIMIT) cdnur.push(row); else addB2cs(inv, r, -1);
  }
  // HSN summary (B2B and B2C separately as per GSTR-1 Table 12 from 2025)
  const hsnMap = new Map();
  for (const [lines, sign] of [[sl, 1], [cl, -1]]) for (const l of lines) {
    const typ = l.gstin ? 'B2B' : 'B2C'; const k = typ + '|' + (l.hsn || '') + '|' + l.rate + '|' + (l.uqc || 'OTH');
    let h = hsnMap.get(k); if (!h) { h = { type: typ, hsn: l.hsn || '', desc: l.item, uqc: l.item_type === 'Service' ? 'NA' : (l.uqc || 'OTH'), qty: 0, rate: l.rate, value: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 }; hsnMap.set(k, h); }
    h.qty = U.r3(h.qty + sign * l.qty); for (const x of ['taxable', 'igst', 'cgst', 'sgst', 'cess']) h[x] = r2(h[x] + sign * l[x]); h.value = r2(h.taxable + h.igst + h.cgst + h.sgst + h.cess);
  }
  // documents issued
  const docs = this.all(`SELECT vtype, MIN(number) AS first, MAX(number) AS last, COUNT(*) AS total, SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) AS cancelled, MIN(seq) AS s1, MAX(seq) AS s2 FROM vouchers WHERE vtype IN ('SAL','CRN','DCH') AND date BETWEEN ? AND ? GROUP BY vtype`, [from, to])
    .map(d => { const p = this.setting('prefix_' + d.vtype) || ''; return { nature: { SAL: 'Invoices for outward supply', CRN: 'Credit Note', DCH: 'Delivery Challan' }[d.vtype], from: p + d.s1, to: p + d.s2, total: d.total, cancelled: d.cancelled, net: d.total - d.cancelled }; });
  return { from, to, b2b, b2cl, b2cs: [...b2csMap.values()].map(x => ({ ...x, posName: x.pos + '-' + U.stateName(x.pos) })), cdnr, cdnur, hsn: [...hsnMap.values()].sort((a, b) => a.type.localeCompare(b.type) || a.hsn.localeCompare(b.hsn)), nil, docs };
};
P.gstr1 = function (f = {}) {
  const d = this.gstr1Data(f); const sec = f.section || 'summary';
  const sum = (a, k) => r2(a.reduce((s, x) => s + (x[k] || 0), 0));
  const tcols = [C('taxable', 'Taxable Value', 'amt'), C('igst', 'IGST', 'amt'), C('cgst', 'CGST', 'amt'), C('sgst', 'SGST/UTGST', 'amt'), C('cess', 'Cess', 'amt')];
  const foot = (a, label) => ({ [label]: 'Total', taxable: sum(a, 'taxable'), igst: sum(a, 'igst'), cgst: sum(a, 'cgst'), sgst: sum(a, 'sgst'), cess: sum(a, 'cess') });
  const sub = `${U.fmtDate(d.from)} to ${U.fmtDate(d.to)} · GSTIN ${this.setting('gstin') || '(not set)'}`;
  if (sec === 'b2b') return { title: 'GSTR-1 · 4A B2B Invoices', subtitle: sub, columns: [C('gstin', 'GSTIN of Recipient'), C('party', 'Receiver Name'), C('number', 'Invoice No.'), C('date', 'Date', 'date'), C('value', 'Invoice Value', 'amt'), C('pos', 'Place of Supply'), C('rcm', 'RCM'), C('rate', 'Rate %', 'num'), ...tcols], rows: d.b2b, foot: foot(d.b2b, 'gstin') };
  if (sec === 'b2cl') return { title: 'GSTR-1 · 5 B2C Large (inter-state > ₹1 lakh)', subtitle: sub, columns: [C('number', 'Invoice No.'), C('date', 'Date', 'date'), C('value', 'Invoice Value', 'amt'), C('pos', 'Place of Supply'), C('rate', 'Rate %', 'num'), ...tcols], rows: d.b2cl, foot: foot(d.b2cl, 'number') };
  if (sec === 'b2cs') return { title: 'GSTR-1 · 7 B2C Small', subtitle: sub, columns: [C('type', 'Supply Type'), C('posName', 'Place of Supply'), C('rate', 'Rate %', 'num'), ...tcols], rows: d.b2cs, foot: foot(d.b2cs, 'type') };
  if (sec === 'cdnr') return { title: 'GSTR-1 · 9B Credit/Debit Notes (Registered)', subtitle: sub, columns: [C('gstin', 'GSTIN'), C('party', 'Party'), C('number', 'Note No.'), C('date', 'Date', 'date'), C('orig', 'Against Invoice'), C('value', 'Note Value', 'amt'), C('pos', 'POS'), C('rate', 'Rate %', 'num'), ...tcols], rows: d.cdnr, foot: foot(d.cdnr, 'gstin') };
  if (sec === 'cdnur') return { title: 'GSTR-1 · 9B Credit/Debit Notes (Unregistered)', subtitle: sub, columns: [C('number', 'Note No.'), C('date', 'Date', 'date'), C('value', 'Note Value', 'amt'), C('pos', 'POS'), C('rate', 'Rate %', 'num'), ...tcols], rows: d.cdnur, foot: foot(d.cdnur, 'number') };
  if (sec === 'hsn') return { title: 'GSTR-1 · 12 HSN-wise Summary', subtitle: sub, columns: [C('type', 'B2B/B2C'), C('hsn', 'HSN/SAC'), C('desc', 'Description'), C('uqc', 'UQC'), C('qty', 'Total Qty', 'qty'), C('rate', 'Rate %', 'num'), C('value', 'Total Value', 'amt'), ...tcols], rows: d.hsn, foot: Object.assign(foot(d.hsn, 'type'), { value: sum(d.hsn, 'value') }) };
  if (sec === 'docs') return { title: 'GSTR-1 · 13 Documents Issued', subtitle: sub, columns: [C('nature', 'Nature of Document'), C('from', 'Sr. No. From'), C('to', 'Sr. No. To'), C('total', 'Total', 'num'), C('cancelled', 'Cancelled', 'num'), C('net', 'Net Issued', 'num')], rows: d.docs };
  const S = (name, a, sec2) => ({ name, count: a.length, taxable: sum(a, 'taxable'), igst: sum(a, 'igst'), cgst: sum(a, 'cgst'), sgst: sum(a, 'sgst'), cess: sum(a, 'cess'), _drill: { r: 'gstr1', a: { from: d.from, to: d.to, section: sec2 } } });
  const rows = [S('4A – B2B Invoices', d.b2b, 'b2b'), S('5 – B2C Large Invoices', d.b2cl, 'b2cl'), S('7 – B2C Small (net of credit notes)', d.b2cs, 'b2cs'), S('9B – Credit/Debit Notes (Registered)', d.cdnr, 'cdnr'), S('9B – Credit/Debit Notes (Unregistered)', d.cdnur, 'cdnur'),
    { name: '8 – Nil rated / Exempt supplies', count: '', taxable: r2(d.nil.intraReg + d.nil.intraUnreg + d.nil.interReg + d.nil.interUnreg) }, S('12 – HSN Summary', d.hsn, 'hsn'), { name: '13 – Documents Issued', count: d.docs.reduce((s, x) => s + x.total, 0), _drill: { r: 'gstr1', a: { from: d.from, to: d.to, section: 'docs' } } }];
  const net = (k) => r2(sum(d.b2b, k) + sum(d.b2cl, k) + sum(d.b2cs, k) - sum(d.cdnr, k) - sum(d.cdnur, k));
  return { title: 'GSTR-1 Summary', subtitle: sub + ' · click a section for details · Export JSON for the GST offline tool / portal upload', gstr1: true,
    columns: [C('name', 'Section'), C('count', 'Records', 'num'), ...tcols], rows, foot: { name: 'Net outward tax liability', taxable: net('taxable'), igst: net('igst'), cgst: net('cgst'), sgst: net('sgst'), cess: net('cess') } };
};
P.gstr1Json = function (f = {}) {
  const d = this.gstr1Data(f); const gstin = this.setting('gstin');
  const fp = d.to.slice(5, 7) + d.to.slice(0, 4); const dt = s => U.fmtDate(s);
  const itm = (r, i) => ({ num: i + 1, itm_det: { txval: r.taxable, rt: r.rate, iamt: r.igst, camt: r.cgst, samt: r.sgst, csamt: r.cess } });
  const group = (rows, key) => { const m = new Map(); for (const r of rows) { const k = key(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
  const j = { gstin, fp, version: 'GST3.2.1', hash: 'hash' };
  const b2b = []; for (const [ctin, rows] of group(d.b2b, r => r.gstin)) { const inv = []; for (const [num, rs] of group(rows, r => r.number)) inv.push({ inum: num, idt: dt(rs[0].date), val: rs[0].value, pos: rs[0].pos.slice(0, 2), rchrg: rs[0].rcm, inv_typ: 'R', itms: rs.map(itm) }); b2b.push({ ctin, inv }); }
  if (b2b.length) j.b2b = b2b;
  const b2cl = []; for (const [pos, rows] of group(d.b2cl, r => r.pos.slice(0, 2))) { const inv = []; for (const [num, rs] of group(rows, r => r.number)) inv.push({ inum: num, idt: dt(rs[0].date), val: rs[0].value, itms: rs.map(itm) }); b2cl.push({ pos, inv }); }
  if (b2cl.length) j.b2cl = b2cl;
  if (d.b2cs.length) j.b2cs = d.b2cs.map(x => ({ sply_ty: x.type, rt: x.rate, typ: 'OE', pos: x.pos, txval: x.taxable, iamt: x.igst, camt: x.cgst, samt: x.sgst, csamt: x.cess }));
  const cdnr = []; for (const [ctin, rows] of group(d.cdnr, r => r.gstin)) { const nt = []; for (const [num, rs] of group(rows, r => r.number)) nt.push({ ntty: 'C', nt_num: num, nt_dt: dt(rs[0].date), val: rs[0].value, pos: rs[0].pos.slice(0, 2), rchrg: 'N', inv_typ: 'R', itms: rs.map(itm) }); cdnr.push({ ctin, nt }); }
  if (cdnr.length) j.cdnr = cdnr;
  if (d.cdnur.length) { const nt = []; for (const [num, rs] of group(d.cdnur, r => r.number)) nt.push({ typ: 'B2CL', ntty: 'C', nt_num: num, nt_dt: dt(rs[0].date), val: rs[0].value, pos: rs[0].pos.slice(0, 2), itms: rs.map(itm) }); j.cdnur = nt; }
  const n = d.nil; if (n.intraReg + n.intraUnreg + n.interReg + n.interUnreg) j.nil = { inv: [{ sply_ty: 'INTRB2B', nil_amt: n.interReg, expt_amt: 0, ngsup_amt: 0 }, { sply_ty: 'INTRAB2B', nil_amt: n.intraReg, expt_amt: 0, ngsup_amt: 0 }, { sply_ty: 'INTRB2C', nil_amt: n.interUnreg, expt_amt: 0, ngsup_amt: 0 }, { sply_ty: 'INTRAB2C', nil_amt: n.intraUnreg, expt_amt: 0, ngsup_amt: 0 }] };
  const hsnRow = (h, i) => ({ num: i + 1, hsn_sc: h.hsn, desc: String(h.desc || '').slice(0, 30), uqc: h.uqc, qty: h.qty, rt: h.rate, txval: h.taxable, iamt: h.igst, camt: h.cgst, samt: h.sgst, csamt: h.cess });
  const hb2b = d.hsn.filter(h => h.type === 'B2B'), hb2c = d.hsn.filter(h => h.type === 'B2C');
  if (d.hsn.length) j.hsn = { hsn_b2b: hb2b.map(hsnRow), hsn_b2c: hb2c.map(hsnRow) };
  if (d.docs.length) j.doc_issue = { doc_det: d.docs.map((x, i) => ({ doc_num: i + 1, docs: [{ num: 1, from: x.from, to: x.to, totnum: x.total, cancel: x.cancelled, net_issue: x.net }] })) };
  return j;
};
P.gstr3b = function (f = {}) {
  const { from, to } = this.periodDefaults(f);
  const s = this.gstLines(from, to, ['SAL']), c = this.gstLines(from, to, ['CRN']), p = this.gstLines(from, to, ['PUR']), dn = this.gstLines(from, to, ['DBN']);
  const tot = (a, filt) => { const o = { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 }; for (const l of a) if (!filt || filt(l)) for (const k in o) o[k] = r2(o[k] + l[k]); return o; };
  const minus = (a, b) => { const o = {}; for (const k in a) o[k] = r2(a[k] - b[k]); return o; };
  const out = minus(tot(s, l => l.rate > 0), tot(c, l => l.rate > 0));
  const nilv = minus(tot(s, l => l.rate === 0), tot(c, l => l.rate === 0));
  const rcmIn = minus(tot(p, l => l.rcm), tot(dn, l => l.rcm));
  const itcOther = minus(tot(p, l => !l.rcm), tot(dn, l => !l.rcm));
  const itcRcm = rcmIn;
  const itc = { igst: r2(itcOther.igst + itcRcm.igst), cgst: r2(itcOther.cgst + itcRcm.cgst), sgst: r2(itcOther.sgst + itcRcm.sgst), cess: r2(itcOther.cess + itcRcm.cess) };
  // set-off as per section 49A/49B: IGST credit -> IGST, CGST, SGST; CGST -> CGST, IGST; SGST -> SGST, IGST
  let L = { igst: out.igst, cgst: out.cgst, sgst: out.sgst, cess: out.cess }, cr = Object.assign({}, itc);
  const use = (from2, to2) => { const u = Math.min(cr[from2], L[to2]); cr[from2] = r2(cr[from2] - u); L[to2] = r2(L[to2] - u); return u; };
  use('igst', 'igst'); use('igst', 'cgst'); use('igst', 'sgst'); use('cgst', 'cgst'); use('cgst', 'igst'); use('sgst', 'sgst'); use('sgst', 'igst'); use('cess', 'cess');
  const cash = { igst: r2(L.igst + rcmIn.igst), cgst: r2(L.cgst + rcmIn.cgst), sgst: r2(L.sgst + rcmIn.sgst), cess: r2(L.cess + rcmIn.cess) };
  // 3.2 inter-state supplies to unregistered persons by POS
  const unreg = {}; for (const [a, sg] of [[s, 1], [c, -1]]) for (const l of a) if (l.is_inter && !l.gstin && l.rate > 0) { const k = l.pos; unreg[k] = unreg[k] || { taxable: 0, igst: 0 }; unreg[k].taxable = r2(unreg[k].taxable + sg * l.taxable); unreg[k].igst = r2(unreg[k].igst + sg * l.igst); }
  const R = (sec, name, o, b) => Object.assign({ sec, name, _b: b }, o);
  const rows = [
    R('3.1', 'Details of outward supplies and inward supplies liable to reverse charge', {}, true),
    R('3.1(a)', 'Outward taxable supplies (other than zero rated, nil rated and exempted)', out),
    R('3.1(b)', 'Outward taxable supplies (zero rated)', { taxable: 0, igst: 0, cess: 0 }),
    R('3.1(c)', 'Other outward supplies (nil rated, exempted)', { taxable: nilv.taxable }),
    R('3.1(d)', 'Inward supplies (liable to reverse charge)', rcmIn),
    R('3.1(e)', 'Non-GST outward supplies', { taxable: 0 }),
    R('3.2', 'Inter-state supplies to unregistered persons (included in 3.1(a))', {}, true),
    ...Object.entries(unreg).map(([pos, o]) => R('', '  Place of supply ' + pos + '-' + U.stateName(pos), o)),
    R('4', 'Eligible ITC', {}, true),
    R('4(A)(3)', 'Inward supplies liable to reverse charge', itcRcm),
    R('4(A)(5)', 'All other ITC', itcOther),
    R('4(C)', 'Net ITC available (A) − (B)', itc, true),
    R('6.1', 'Payment of tax', {}, true),
    R('', 'Tax liability (other than reverse charge)', out),
    R('', 'Paid through ITC', { igst: r2(out.igst - L.igst), cgst: r2(out.cgst - L.cgst), sgst: r2(out.sgst - L.sgst), cess: r2(out.cess - L.cess) }),
    R('', 'Reverse charge tax (payable in cash)', { igst: rcmIn.igst, cgst: rcmIn.cgst, sgst: rcmIn.sgst, cess: rcmIn.cess }),
    R('', 'Tax payable in cash', cash, true),
    R('', 'ITC carried forward (unused)', cr),
  ];
  return { title: 'GSTR-3B Summary', subtitle: `${U.fmtDate(from)} to ${U.fmtDate(to)} · GSTIN ${this.setting('gstin') || '(not set)'} · prepared from your books, verify with GSTR-2B before filing`,
    columns: [C('sec', 'Table'), C('name', 'Nature of Supplies'), C('taxable', 'Taxable Value', 'amt'), C('igst', 'Integrated Tax', 'amt'), C('cgst', 'Central Tax', 'amt'), C('sgst', 'State/UT Tax', 'amt'), C('cess', 'Cess', 'amt')], rows,
    meta: { out, itc, cash, rcmIn, carry: cr, nil: nilv } };
};
P.gstr3bJson = function (f = {}) {
  const r = this.gstr3b(f); const m = r.meta; const { to } = this.periodDefaults(f);
  const t = o => ({ txval: o.taxable || 0, iamt: o.igst || 0, camt: o.cgst || 0, samt: o.sgst || 0, csamt: o.cess || 0 });
  return { gstin: this.setting('gstin'), ret_period: to.slice(5, 7) + to.slice(0, 4),
    sup_details: { osup_det: t(m.out), osup_zero: t({}), osup_nil_exmp: { txval: m.nil.taxable || 0 }, isup_rev: t(m.rcmIn), osup_nongst: { txval: 0 } },
    itc_elg: { itc_avl: [{ ty: 'ISRC', ...t(m.rcmIn) }, { ty: 'OTH', ...t({ igst: r2(m.itc.igst - m.rcmIn.igst), cgst: r2(m.itc.cgst - m.rcmIn.cgst), sgst: r2(m.itc.sgst - m.rcmIn.sgst), cess: r2(m.itc.cess - m.rcmIn.cess) }) }], itc_net: t(m.itc) } };
};
P.gstSummary = function (f = {}) {
  const { from, to } = this.periodDefaults(f);
  const rows = this.all("SELECT id, name, tax_type FROM ledgers WHERE tax_type IN ('CGST_OUT','SGST_OUT','IGST_OUT','CESS_OUT','CGST_IN','SGST_IN','IGST_IN','CESS_IN','RCM') ORDER BY tax_type").map(l => {
    const m = this.get("SELECT COALESCE(SUM(e.dr),0) AS dr, COALESCE(SUM(e.cr),0) AS cr FROM entries e JOIN vouchers v ON v.id=e.voucher_id WHERE e.ledger_id=? AND v.status='active' AND v.date BETWEEN ? AND ?", [l.id, from, to]);
    const close = this.ledgerBalance(l.id, to);
    return { name: l.name, dr: r2(m.dr) || null, cr: r2(m.cr) || null, net: r2(m.cr - m.dr), close: U.drcr(close), _drill: { r: 'ledgerStatement', a: { ledger_id: l.id, from, to } } }; });
  const out = r2(rows.filter(r => /Output/.test(r.name)).reduce((s, r) => s + r.net, 0)), inp = r2(-rows.filter(r => /Input/.test(r.name)).reduce((s, r) => s + r.net, 0));
  return { title: 'GST Ledger Summary', subtitle: `${U.fmtDate(from)} to ${U.fmtDate(to)} · Output ₹${U.inr(out)} − Input ₹${U.inr(inp)} = Net payable ₹${U.inr(out - inp)}`,
    columns: [C('name', 'GST Ledger'), C('dr', 'Debit (period)', 'amt'), C('cr', 'Credit (period)', 'amt'), C('net', 'Net Cr (+)', 'amt'), C('close', 'Closing Balance', 'text', { align: 'right' })], rows };
};
P.hsnLookup = function (q) { return this.all('SELECT DISTINCT hsn, name, gst_rate FROM items WHERE hsn LIKE ? LIMIT 20', [String(q) + '%']); };

// ---------------- e-Invoice (IRP schema 1.1) & e-Way Bill JSON ----------------
P.einvoiceJson = function (vid) {
  const v = this.voucher(vid); if (!v || !['SAL', 'CRN', 'DBN'].includes(v.vtype)) throw new Error('e-Invoice JSON is for sales invoices and credit/debit notes');
  const s = this.settings(); if (!s.gstin) throw new Error('Set your company GSTIN first (Company › Edit)');
  const buyerGstin = v.buyer_gstin || v.party_gstin; if (!buyerGstin) throw new Error('e-Invoice applies to B2B: the party has no GSTIN');
  const pin = x => Number(String(x || '').replace(/\D/g, '').slice(0, 6)) || 999999;
  const doc = { Version: '1.1', TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: v.rcm ? 'Y' : 'N', IgstOnIntra: 'N' },
    DocDtls: { Typ: v.vtype === 'SAL' ? 'INV' : v.vtype === 'CRN' ? 'CRN' : 'DBN', No: v.number, Dt: U.fmtDate(v.date).replace(/-/g, '/') },
    SellerDtls: { Gstin: s.gstin, LglNm: s.name, Addr1: (s.address || s.name).slice(0, 100), Loc: s.city || 'NA', Pin: pin(s.pincode), Stcd: s.state_code, Ph: s.phone || undefined, Em: s.email || undefined },
    BuyerDtls: { Gstin: buyerGstin, LglNm: v.buyer_name || v.party_name, Pos: v.place_of_supply, Addr1: (v.party_address || v.party_name).slice(0, 100), Loc: v.party_city || 'NA', Pin: pin(v.party_pincode), Stcd: buyerGstin.slice(0, 2) },
    ItemList: v.items.map((i, n) => ({ SlNo: String(n + 1), PrdDesc: i.item_name, IsServc: i.item_type === 'Service' ? 'Y' : 'N', HsnCd: i.hsn || '', Qty: i.qty, Unit: i.uqc || 'OTH', UnitPrice: r2(i.qty ? (i.taxable + i.disc_amt) / i.qty : i.rate), TotAmt: r2(i.taxable + i.disc_amt), Discount: i.disc_amt, AssAmt: i.taxable, GstRt: i.gst_rate, IgstAmt: i.igst, CgstAmt: i.cgst, SgstAmt: i.sgst, CesRt: i.cess_rate || 0, CesAmt: i.cess, TotItemVal: i.amount })),
    ValDtls: { AssVal: v.taxable, CgstVal: v.cgst, SgstVal: v.sgst, IgstVal: v.igst, CesVal: v.cess, RndOffAmt: v.round_off, TotInvVal: v.total } };
  if (v.vehicle_no || v.distance) doc.EwbDtls = { Distance: Number(v.distance) || 0, VehNo: v.vehicle_no || undefined, VehType: 'R', TransMode: '1' };
  return JSON.parse(JSON.stringify(doc));
};
P.ewayJson = function (vid) {
  const v = this.voucher(vid); if (!v || !['SAL', 'PUR', 'DCH', 'CRN', 'DBN'].includes(v.vtype)) throw new Error('e-Way bill JSON is for invoices, challans and returns');
  const s = this.settings(); if (!s.gstin) throw new Error('Set your company GSTIN first');
  const out = ['SAL', 'DCH', 'DBN'].includes(v.vtype);
  const pin = x => Number(String(x || '').replace(/\D/g, '').slice(0, 6)) || 0;
  const me = { gstin: s.gstin, name: s.name, addr: s.address || '', place: s.city || '', pin: pin(s.pincode), state: Number(s.state_code) };
  const them = { gstin: v.buyer_gstin || v.party_gstin || 'URP', name: v.buyer_name || v.party_name, addr: v.party_address || '', place: v.party_city || '', pin: pin(v.party_pincode), state: Number(v.place_of_supply || s.state_code) };
  const fromP = out ? me : them, toP = out ? them : me;
  const bill = { userGstin: s.gstin, supplyType: out ? 'O' : 'I', subSupplyType: v.vtype === 'DCH' ? 4 : v.vtype === 'CRN' || v.vtype === 'DBN' ? 7 : 1, docType: v.vtype === 'DCH' ? 'CHL' : v.vtype === 'CRN' ? 'CNT' : v.vtype === 'DBN' ? 'OTH' : 'INV',
    docNo: v.vtype === 'PUR' ? (v.ref_no || v.number) : v.number, docDate: U.fmtDate(v.date).replace(/-/g, '/'), transType: 1,
    fromGstin: fromP.gstin, fromTrdName: fromP.name, fromAddr1: fromP.addr.slice(0, 120), fromPlace: fromP.place, fromPincode: fromP.pin, fromStateCode: fromP.state, actualFromStateCode: fromP.state,
    toGstin: toP.gstin, toTrdName: toP.name, toAddr1: toP.addr.slice(0, 120), toPlace: toP.place, toPincode: toP.pin, toStateCode: toP.state, actualToStateCode: toP.state,
    totalValue: v.taxable, cgstValue: v.cgst, sgstValue: v.sgst, igstValue: v.igst, cessValue: v.cess, totInvValue: v.total, transMode: 1, transDistance: Number(v.distance) || 0, transporterName: v.transport || '', vehicleNo: (v.vehicle_no || '').replace(/\s/g, ''), vehicleType: 'R',
    itemList: v.items.map((i, n) => ({ itemNo: n + 1, productName: i.item_name, productDesc: i.descr || i.item_name, hsnCode: Number(i.hsn) || 0, quantity: i.qty, qtyUnit: i.uqc || 'OTH', taxableAmount: i.taxable, cgstRate: v.is_inter ? 0 : i.gst_rate / 2, sgstRate: v.is_inter ? 0 : i.gst_rate / 2, igstRate: v.is_inter ? i.gst_rate : 0, cessRate: i.cess_rate || 0 })) };
  return { version: '1.0.0621', billLists: [bill] };
};
