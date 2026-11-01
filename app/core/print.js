
// R&S Sons Accounting - printable documents (invoice, reports, cheque, labels, letters)
const U = require('./util');
const { VTYPES } = require('./schema');
const esc = U.esc, inr = U.inr;
let APP = 'R&S Sons Accounting';
// Display name is admin-configurable (Admin Settings → App name); set by the main process at startup and on change.
function setAppName(n) { APP = String(n || 'R&S Sons Accounting'); }
function getAppName() { return APP; }

const BASE_CSS = `
*{box-sizing:border-box} :root{color-scheme:light only} html{background:#fff} body{background:#fff;font-family:"Segoe UI",Arial,sans-serif;color:#111;margin:0;font-size:11px}
.page{padding:10mm 10mm 8mm} table{border-collapse:collapse;width:100%} td,th{padding:3px 5px;vertical-align:top}
.b{font-weight:600} .r{text-align:right} .c{text-align:center} .muted{color:#555} .small{font-size:9.5px}
.box{border:1px solid #333} .grid td,.grid th{border:1px solid #333} .grid th{background:#eef2f7;font-weight:600}
.foot{margin-top:6px;font-size:9px;color:#666;text-align:center;border-top:1px solid #ccc;padding-top:3px}
`;

function companyHeader(s, title, right) {
  const addr = [s.address, s.city, s.pincode ? '- ' + s.pincode : '', U.stateName(s.state_code)].filter(Boolean).join(', ');
  return `<table class="box" style="border-bottom:none"><tr>
    <td style="width:62%;padding:8px">${s.logo ? `<img src="${s.logo}" style="height:46px;float:left;margin-right:10px">` : ''}
      <div style="font-size:18px;font-weight:700;color:#0b3a6e">${esc(s.mailing_name || s.name)}</div>
      <div>${esc(addr)}</div>
      <div>${s.gstin ? '<b>GSTIN:</b> ' + esc(s.gstin) + ' &nbsp; ' : ''}${s.pan ? '<b>PAN:</b> ' + esc(s.pan) + ' &nbsp; ' : ''}<b>State:</b> ${esc(U.stateName(s.state_code))} (${esc(s.state_code)})</div>
      <div>${s.phone ? 'Ph: ' + esc(s.phone) + ' &nbsp; ' : ''}${s.email ? 'Email: ' + esc(s.email) : ''}${s.website ? ' &nbsp; ' + esc(s.website) : ''}</div></td>
    <td style="text-align:right;padding:8px"><div style="font-size:17px;font-weight:700;letter-spacing:1px">${esc(title)}</div>${right || ''}</td></tr></table>`;
}

function invoiceTitle(v, s) {
  if (v.vtype === 'SAL') return s.gst_registered === '0' ? 'BILL OF SUPPLY' : 'TAX INVOICE';
  return { PUR: 'PURCHASE VOUCHER', CRN: 'CREDIT NOTE', DBN: 'DEBIT NOTE', SOR: 'SALES ORDER', POR: 'PURCHASE ORDER', QTN: 'QUOTATION', PFI: 'PROFORMA INVOICE', DCH: 'DELIVERY CHALLAN', GRN: 'GOODS RECEIPT NOTE', STJ: 'STOCK JOURNAL', PRD: 'PRODUCTION VOUCHER' }[v.vtype] || VTYPES[v.vtype].name.toUpperCase();
}

function invoiceHtml(v, s, opts = {}) {
  const T = VTYPES[v.vtype]; const inter = !!v.is_inter;
  const copy = opts.copy || (v.vtype === 'SAL' ? (s.invoice_copies || 'ORIGINAL FOR RECIPIENT') : '');
  const cust = { name: v.buyer_name || v.party_name || '', gstin: v.buyer_gstin || v.party_gstin || '', addr: v.buyer_address || [v.party_address, v.party_city, v.party_pincode].filter(Boolean).join(', '), phone: v.party_phone || '', state: v.place_of_supply || v.party_state || '' };
  const partyLabel = T.side === 'purchase' ? 'Supplier (Bill From)' : 'Bill To (Buyer)';
  const right = `<div class="small" style="margin-top:4px">${esc(copy)}</div>`;
  const meta = [['Invoice No.', v.number], ['Date', U.fmtDateLong(v.date)], v.ref_no ? [v.vtype === 'PUR' ? 'Supplier Inv No.' : 'Ref / PO No.', v.ref_no + (v.ref_date ? ' dt ' + U.fmtDate(v.ref_date) : '')] : null,
    v.orig_ref ? ['Against Invoice', v.orig_ref] : null, v.due_date ? ['Due Date', U.fmtDateLong(v.due_date)] : null, ['Place of Supply', cust.state ? U.stateName(cust.state) + ' (' + cust.state + ')' : '-'],
    v.rcm ? ['Reverse Charge', 'Yes'] : ['Reverse Charge', 'No'], v.eway_no ? ['e-Way Bill No.', v.eway_no] : null, v.vehicle_no ? ['Vehicle No.', v.vehicle_no] : null, v.transport ? ['Transport', v.transport] : null, v.salesman_name ? ['Salesman', v.salesman_name] : null].filter(Boolean);
  const hasDisc = v.items.some(i => i.disc_amt); const showTax = v.vtype !== 'DCH' && v.vtype !== 'STJ' && v.vtype !== 'PRD' && s.gst_registered !== '0';
  const showBatch = v.items.some(i => i.batch_no || i.exp_date);
  let rows = '';
  v.items.forEach((i, n) => {
    rows += `<tr><td class="c">${n + 1}</td><td><b>${esc(i.item_name)}</b>${i.descr ? '<div class="small muted">' + esc(i.descr) + '</div>' : ''}${showBatch && (i.batch_no || i.exp_date) ? `<div class="small muted">Batch ${esc(i.batch_no || '-')}${i.exp_date ? ' · Exp ' + U.fmtDate(i.exp_date) : ''}</div>` : ''}</td>
      <td class="c">${esc(i.hsn || '')}</td><td class="r">${U.r3(i.qty)} ${esc(i.unit_name || '')}</td><td class="r">${inr(i.rate)}</td>
      ${hasDisc ? `<td class="r">${i.disc_amt ? inr(i.disc_amt) : ''}${i.disc_pct ? '<div class="small muted">' + i.disc_pct + '%</div>' : ''}</td>` : ''}
      <td class="r">${inr(i.taxable)}</td>
      ${showTax ? (inter ? `<td class="r">${i.gst_rate}%</td><td class="r">${inr(i.igst)}</td>` : `<td class="r">${i.gst_rate / 2}%</td><td class="r">${inr(i.cgst)}</td><td class="r">${i.gst_rate / 2}%</td><td class="r">${inr(i.sgst)}</td>`) : ''}
      <td class="r b">${inr(showTax ? i.amount : i.taxable)}</td></tr>`;
  });
  const minRows = Math.max(0, 8 - v.items.length); for (let k = 0; k < minRows; k++) rows += `<tr style="height:18px"><td></td><td></td><td></td><td></td><td></td>${hasDisc ? '<td></td>' : ''}<td></td>${showTax ? (inter ? '<td></td><td></td>' : '<td></td><td></td><td></td><td></td>') : ''}<td></td></tr>`;
  const qtyTotal = U.r3(v.items.reduce((a, i) => a + i.qty, 0));
  const head = `<tr><th style="width:24px">#</th><th>Description of Goods / Services</th><th>HSN/SAC</th><th>Qty</th><th>Rate (₹)</th>${hasDisc ? '<th>Disc.</th>' : ''}<th>Taxable Value</th>
    ${showTax ? (inter ? '<th>IGST %</th><th>IGST ₹</th>' : '<th>CGST %</th><th>CGST ₹</th><th>SGST %</th><th>SGST ₹</th>') : ''}<th>Amount (₹)</th></tr>`;
  const totRow = `<tr class="b" style="background:#f6f8fb"><td></td><td class="r">Total</td><td></td><td class="r">${qtyTotal}</td><td></td>${hasDisc ? `<td class="r">${inr(v.discount)}</td>` : ''}<td class="r">${inr(v.taxable)}</td>
    ${showTax ? (inter ? `<td></td><td class="r">${inr(v.igst)}</td>` : `<td></td><td class="r">${inr(v.cgst)}</td><td></td><td class="r">${inr(v.sgst)}</td>`) : ''}<td class="r">${inr(showTax ? v.taxable + v.cgst + v.sgst + v.igst + v.cess : v.taxable)}</td></tr>`;
  // HSN summary
  const hsn = new Map();
  for (const i of v.items) { const k = (i.hsn || '-') + '|' + i.gst_rate; const h = hsn.get(k) || { hsn: i.hsn || '-', rate: i.gst_rate, taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0 }; for (const x of ['taxable', 'cgst', 'sgst', 'igst', 'cess']) h[x] = U.r2(h[x] + i[x]); hsn.set(k, h); }
  const hsnTable = showTax ? `<table class="grid" style="margin-top:6px"><tr><th>HSN/SAC</th><th>Taxable Value</th>${inter ? '<th>IGST Rate</th><th>IGST Amt</th>' : '<th>CGST Rate</th><th>CGST Amt</th><th>SGST Rate</th><th>SGST Amt</th>'}${v.cess ? '<th>Cess</th>' : ''}<th>Total Tax</th></tr>
    ${[...hsn.values()].map(h => `<tr><td>${esc(h.hsn)}</td><td class="r">${inr(h.taxable)}</td>${inter ? `<td class="r">${h.rate}%</td><td class="r">${inr(h.igst)}</td>` : `<td class="r">${h.rate / 2}%</td><td class="r">${inr(h.cgst)}</td><td class="r">${h.rate / 2}%</td><td class="r">${inr(h.sgst)}</td>`}${v.cess ? `<td class="r">${inr(h.cess)}</td>` : ''}<td class="r">${inr(h.cgst + h.sgst + h.igst + h.cess)}</td></tr>`).join('')}
    <tr class="b"><td>Total</td><td class="r">${inr(v.taxable)}</td>${inter ? `<td></td><td class="r">${inr(v.igst)}</td>` : `<td></td><td class="r">${inr(v.cgst)}</td><td></td><td class="r">${inr(v.sgst)}</td>`}${v.cess ? `<td class="r">${inr(v.cess)}</td>` : ''}<td class="r">${inr(v.cgst + v.sgst + v.igst + v.cess)}</td></tr></table>` : '';
  const summary = [['Taxable Amount', v.taxable], ...(showTax ? (inter ? [['IGST', v.igst]] : [['CGST', v.cgst], ['SGST', v.sgst]]) : []), v.cess ? ['Cess', v.cess] : null, v.round_off ? ['Round Off', v.round_off] : null].filter(Boolean);
  const total = showTax ? v.total : v.taxable;
  const bank = s.bank_name || s.bank_acc ? `<div class="b">Bank Details</div><div>${esc(s.bank_name || '')}${s.bank_branch ? ', ' + esc(s.bank_branch) : ''}</div><div>A/c No: ${esc(s.bank_acc || '')}</div><div>IFSC: ${esc(s.bank_ifsc || '')}</div>${s.upi_id ? '<div>UPI: ' + esc(s.upi_id) + '</div>' : ''}` : '';
  const qr = opts.qr ? `<div class="c"><img src="${opts.qr}" style="width:92px;height:92px"><div class="small">Scan to pay ₹${inr(total)}</div></div>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(invoiceTitle(v, s))} ${esc(v.number)}</title><style>${BASE_CSS}
    @page{size:A4;margin:0} .grid td{border-top:none;border-bottom:none} .grid tr:first-child th{border-top:1px solid #333} .items tr:last-child td{border-bottom:1px solid #333}</style></head><body><div class="page">
  ${v.status === 'cancelled' ? '<div style="position:fixed;top:40%;left:18%;font-size:90px;color:rgba(200,0,0,.15);transform:rotate(-25deg);font-weight:800">CANCELLED</div>' : ''}
  ${companyHeader(s, invoiceTitle(v, s), right)}
  <table class="box"><tr><td style="width:55%;border-right:1px solid #333;padding:6px">
      <div class="muted small">${partyLabel}</div><div style="font-size:13px" class="b">${esc(cust.name)}</div><div>${esc(cust.addr)}</div>
      ${cust.gstin ? '<div><b>GSTIN:</b> ' + esc(cust.gstin) + '</div>' : '<div class="muted">Unregistered</div>'}${cust.state ? '<div><b>State:</b> ' + esc(U.stateName(cust.state)) + ' (' + esc(cust.state) + ')</div>' : ''}${cust.phone ? '<div>Ph: ' + esc(cust.phone) + '</div>' : ''}
      ${v.ship_to ? '<div style="margin-top:4px" class="muted small">Ship To</div><div>' + esc(v.ship_to) + '</div>' : ''}</td>
    <td style="padding:6px"><table>${meta.map(m => `<tr><td class="muted" style="padding:1px 4px">${esc(m[0])}</td><td class="b" style="padding:1px 4px">${esc(m[1])}</td></tr>`).join('')}</table></td></tr></table>
  <table class="grid items">${head}${rows}${totRow}</table>
  <table class="box" style="border-top:none"><tr><td style="width:60%;border-right:1px solid #333;padding:6px">
     <div class="muted small">Amount in words</div><div class="b">${esc(U.amountInWords(total))}</div>
     ${v.narration ? '<div style="margin-top:4px"><span class="muted small">Narration:</span> ' + esc(v.narration) + '</div>' : ''}</td>
    <td style="padding:6px"><table>${summary.map(x => `<tr><td>${x[0]}</td><td class="r">${inr(x[1])}</td></tr>`).join('')}<tr style="font-size:14px" class="b"><td style="border-top:1px solid #333">Grand Total</td><td class="r" style="border-top:1px solid #333">₹ ${inr(total)}</td></tr></table></td></tr></table>
  ${hsnTable}
  <table class="box" style="margin-top:6px"><tr><td style="width:36%;border-right:1px solid #333;padding:6px">${bank}</td><td style="width:20%;border-right:1px solid #333;padding:6px">${qr}</td>
    <td style="padding:6px"><div class="b small">Terms & Conditions</div><div class="small" style="white-space:pre-line">${esc(s.terms || '')}</div></td></tr>
    <tr><td colspan="2" style="border-top:1px solid #333;padding:6px" class="small muted">${s.declaration ? esc(s.declaration) : 'We declare that this invoice shows the actual price of the goods/services described and that all particulars are true and correct.'}</td>
    <td style="border-top:1px solid #333;padding:6px;text-align:right;height:62px">For <b>${esc(s.mailing_name || s.name)}</b>${s.signature ? `<div><img src="${s.signature}" style="height:34px"></div>` : '<div style="height:30px"></div>'}<div>Authorised Signatory</div></td></tr></table>
  <div class="foot">This is a computer generated document. &nbsp;·&nbsp; Generated by ${esc(APP)}</div></div></body></html>`;
}

function accountVoucherHtml(v, s) {
  const rows = v.entries.map(e => `<tr><td>${e.dr ? 'Dr' : 'Cr'}</td><td>${esc(e.ledger_name)}${e.line_narr ? '<div class="small muted">' + esc(e.line_narr) + '</div>' : ''}</td><td class="r">${e.dr ? inr(e.dr) : ''}</td><td class="r">${e.cr ? inr(e.cr) : ''}</td></tr>`).join('');
  const meta = `<div class="small">No. <b>${esc(v.number)}</b><br>Date <b>${U.fmtDateLong(v.date)}</b>${v.cheque_no ? '<br>Cheque/Ref <b>' + esc(v.cheque_no) + '</b>' : ''}${v.pay_mode ? '<br>Mode <b>' + esc(v.pay_mode) + '</b>' : ''}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS} @page{size:A4;margin:0}</style></head><body><div class="page">
    ${companyHeader(s, (VTYPES[v.vtype].name + ' Voucher').toUpperCase(), meta)}
    <table class="grid"><tr><th style="width:40px">Dr/Cr</th><th>Particulars</th><th style="width:120px">Debit (₹)</th><th style="width:120px">Credit (₹)</th></tr>${rows}
    <tr class="b"><td></td><td class="r">Total</td><td class="r">${inr(v.total)}</td><td class="r">${inr(v.total)}</td></tr></table>
    <div style="margin-top:6px"><span class="muted">Amount in words:</span> <b>${esc(U.amountInWords(v.total))}</b></div>
    ${v.narration ? '<div style="margin-top:4px"><span class="muted">Narration:</span> ' + esc(v.narration) + '</div>' : ''}
    <table style="margin-top:50px"><tr><td>Prepared by: ${esc(v.created_by || '')}</td><td class="c">Checked by</td><td class="r">Receiver's Signature / Authorised Signatory</td></tr></table>
    <div class="foot">Generated by ${esc(APP)}</div></div></body></html>`;
}

function reportHtml(rep, s, opts = {}) {
  const cols = rep.columns; const land = opts.landscape || cols.length > 7;
  const fmt = (c, v) => { if (v == null || v === '') return ''; if (c.t === 'amt') return inr(v); if (c.t === 'qty') return String(U.r3(v)); if (c.t === 'date') return U.fmtDate(v); return esc(v); };
  const align = c => (c.t === 'amt' || c.t === 'qty' || c.t === 'num' || c.align === 'right') ? 'r' : '';
  const body = rep.rows.map(r => {
    if (rep.tformat) return `<tr class="${r._total ? 'b tot' : ''}"><td style="padding-left:${5 + (r._li || 0) * 14}px" class="${r._li ? 'muted' : 'b'}">${esc(r.lp)}</td><td class="r ${r._li ? 'muted' : 'b'}">${r.la == null ? '' : inr(r.la)}</td><td style="padding-left:${5 + (r._ri || 0) * 14}px" class="${r._ri ? 'muted' : 'b'}">${esc(r.rp)}</td><td class="r ${r._ri ? 'muted' : 'b'}">${r.ra == null ? '' : inr(r.ra)}</td></tr>`;
    return `<tr class="${r._b ? 'b' : ''}">${cols.map((c, i) => `<td class="${align(c)}" style="${i === 0 && r._l ? 'padding-left:' + (5 + r._l * 14) + 'px' : ''}">${fmt(c, r[c.k])}</td>`).join('')}</tr>`;
  }).join('');
  const foot = rep.foot ? `<tr class="b tot">${cols.map(c => `<td class="${align(c)}">${fmt(c, rep.foot[c.k])}</td>`).join('')}</tr>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(rep.title)}</title><style>${BASE_CSS} @page{size:A4 ${land ? 'landscape' : 'portrait'};margin:10mm}
    .page{padding:0} table.rep th{background:#0b3a6e;color:#fff;font-weight:600;text-align:left;padding:4px 5px;border:1px solid #0b3a6e} table.rep td{border-bottom:1px solid #e3e6ea}
    table.rep tr.tot td{border-top:2px solid #333;border-bottom:2px solid #333;background:#f3f6fa} thead{display:table-header-group}</style></head><body><div class="page">
    <div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #0b3a6e;padding-bottom:4px;margin-bottom:6px">
      <div><div style="font-size:16px;font-weight:700;color:#0b3a6e">${esc(s.name)}</div><div class="small">${esc([s.address, s.city].filter(Boolean).join(', '))}${s.gstin ? ' · GSTIN ' + esc(s.gstin) : ''}</div></div>
      <div class="r"><div style="font-size:15px;font-weight:700">${esc(rep.title)}</div><div class="small muted">${esc(rep.subtitle || '')}</div></div></div>
    <table class="rep"><thead><tr>${cols.map(c => `<th class="${align(c)}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${body}${foot}</tbody></table>
    <div class="foot">Printed on ${U.fmtDate(U.today())} · Generated by ${esc(APP)}</div></div></body></html>`;
}

function chequeHtml(v, s, opts = {}) {
  // CTS-2010 standard cheque 203mm x 93mm; offsets (mm) adjustable in company settings
  const ox = Number(s.cheque_offset_x) || 0, oy = Number(s.cheque_offset_y) || 0;
  const payee = opts.payee || v.party_name || '';
  const amt = opts.amount || v.total; const d = U.fmtDate(v.cheque_date || v.date).replace(/-/g, '');
  const dateBoxes = d.split('').map((ch, i) => `<span style="position:absolute;left:${158 + ox + i * 5.1}mm;top:${8 + oy}mm;width:5mm;text-align:center">${ch}</span>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:203mm 93mm;margin:0} body{margin:0;font-family:Arial;font-size:13px} .c{position:absolute}</style></head><body>
   <div style="position:relative;width:203mm;height:93mm">${opts.ac !== false ? `<div class="c" style="left:${8 + ox}mm;top:${6 + oy}mm;border-top:1px solid #000;border-bottom:1px solid #000;transform:rotate(-20deg);font-size:10px;padding:1px 4px">A/C PAYEE ONLY</div>` : ''}
   ${dateBoxes}<div class="c" style="left:${20 + ox}mm;top:${22 + oy}mm;width:150mm">${esc(payee)}</div>
   <div class="c" style="left:${30 + ox}mm;top:${31 + oy}mm;width:125mm;line-height:8mm">${esc(U.amountInWords(amt).replace(/^Rupees /, ''))}</div>
   <div class="c" style="left:${163 + ox}mm;top:${38 + oy}mm;font-weight:bold">**${inr(amt)}/-</div>
   <div class="c" style="left:${145 + ox}mm;top:${62 + oy}mm;font-size:11px">For ${esc(s.name)}</div></div></body></html>`;
}

// ---- Code128-B barcode as SVG ----
const C128 = ['212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112'];
function code128Svg(text, h = 40) {
  text = String(text).replace(/[^\x20-\x7e]/g, '');
  const codes = [104]; for (const ch of text) codes.push(ch.charCodeAt(0) - 32);
  let sum = 104; codes.slice(1).forEach((c, i) => sum += c * (i + 1)); codes.push(sum % 103); codes.push(106);
  let x = 10, bars = '';
  for (const c of codes) { const p = C128[c]; for (let i = 0; i < p.length; i++) { const w = +p[i]; if (i % 2 === 0) bars += `<rect x="${x}" y="0" width="${w}" height="${h}"/>`; x += w; } }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x + 10} ${h}" width="100%" height="${h}" preserveAspectRatio="none">${bars}</svg>`;
}
function labelsHtml(items, s, opts = {}) {
  const cells = []; for (const it of items) for (let k = 0; k < (Number(it.copies) || 1); k++) cells.push(it);
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:8mm} body{font-family:Arial;margin:0} .g{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm}
   .l{border:1px dashed #bbb;padding:2mm;text-align:center;height:34mm;overflow:hidden} .n{font-size:10px;font-weight:bold;height:11px;overflow:hidden} .p{font-size:11px} .code{font-size:9px;letter-spacing:1px}</style></head><body><div class="g">
   ${cells.map(it => `<div class="l"><div style="font-size:8px;color:#555">${esc(s.name)}</div><div class="n">${esc(it.name)}</div>${code128Svg(it.barcode || it.code || String(it.id).padStart(8, '0'), 36)}<div class="code">${esc(it.barcode || it.code || String(it.id).padStart(8, '0'))}</div>
   <div class="p">${it.mrp ? '<b>MRP ₹' + inr(it.mrp) + '</b> ' : ''}${opts.showRate && it.sale_rate ? ' Our price ₹' + inr(it.sale_rate) : ''}</div></div>`).join('')}</div></body></html>`;
}
function reminderLetterHtml(party, bills, s) {
  const total = U.r2(bills.reduce((a, b) => a + b.amount, 0));
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS} @page{size:A4;margin:0} body{font-size:12.5px} .page{padding:18mm}</style></head><body><div class="page">
   ${companyHeader(s, 'PAYMENT REMINDER', '<div class="small">Date: ' + U.fmtDateLong(U.today()) + '</div>')}
   <p style="margin-top:18px">To,<br><b>${esc(party.name)}</b><br>${esc([party.address, party.city, party.pincode].filter(Boolean).join(', '))}</p>
   <p>Dear Sir/Madam,</p><p>This is a gentle reminder that the following bills are pending for payment as per our books of account:</p>
   <table class="grid"><tr><th>Bill No.</th><th>Bill Date</th><th>Due Date</th><th>Days Overdue</th><th>Pending Amount (₹)</th></tr>
   ${bills.map(b => `<tr><td>${esc(b.ref)}</td><td>${U.fmtDate(b.date)}</td><td>${U.fmtDate(b.due)}</td><td class="r">${b.due ? Math.max(0, U.daysBetween(b.due, U.today())) : ''}</td><td class="r">${inr(b.amount)}</td></tr>`).join('')}
   <tr class="b"><td colspan="4" class="r">Total</td><td class="r">${inr(total)}</td></tr></table>
   <p>Kindly arrange the payment of <b>₹${inr(total)}</b> (${esc(U.amountInWords(total))}) at the earliest. If you have already paid, please ignore this letter and share the payment details so that we can update our records.</p>
   ${s.bank_acc ? `<p>Bank: ${esc(s.bank_name || '')}, A/c ${esc(s.bank_acc)}, IFSC ${esc(s.bank_ifsc || '')}${s.upi_id ? ', UPI ' + esc(s.upi_id) : ''}</p>` : ''}
   <p style="margin-top:40px">Thanking you,<br>For <b>${esc(s.name)}</b><br><br><br>Authorised Signatory</p><div class="foot">Generated by ${esc(APP)}</div></div></body></html>`;
}
function payslipHtml(row, month, s) {
  const L = [['Basic', row.basic], ['HRA', row.hra], ['DA', row.da], ['Other Allowances', row.other]], D = [['Provident Fund', row.pf], ['ESI', row.esi], ['Professional Tax', row.pt], ['TDS', row.tds]];
  const n = Math.max(L.length, D.length); let body = ''; for (let i = 0; i < n; i++) body += `<tr><td>${L[i] ? L[i][0] : ''}</td><td class="r">${L[i] ? inr(L[i][1]) : ''}</td><td>${D[i] ? D[i][0] : ''}</td><td class="r">${D[i] ? inr(D[i][1]) : ''}</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS} @page{size:A4;margin:0} body{font-size:12px}</style></head><body><div class="page">${companyHeader(s, 'SALARY SLIP', '<div>' + esc(month) + '</div>')}
   <p><b>${esc(row.name)}</b> · ${esc(row.designation || '')}</p><table class="grid"><tr><th>Earnings</th><th>₹</th><th>Deductions</th><th>₹</th></tr>${body}
   <tr class="b"><td>Gross Earnings</td><td class="r">${inr(row.gross)}</td><td>Total Deductions</td><td class="r">${inr(row.deductions)}</td></tr></table>
   <p style="font-size:14px"><b>Net Pay: ₹${inr(row.net)}</b> (${esc(U.amountInWords(row.net))})</p><div class="foot">Generated by ${esc(APP)}</div></div></body></html>`;
}
module.exports = { BASE_CSS, companyHeader, invoiceHtml, accountVoucherHtml, reportHtml, chequeHtml, labelsHtml, code128Svg, reminderLetterHtml, payslipHtml, setAppName, getAppName, get APP() { return APP; } };
