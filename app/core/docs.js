// R&S Sons Accounting - printable documents (HTML), shared by the desktop app and the server.
const PR = require('./print');
const { VTYPES } = require('./company');
const U = require('./util');
const ITRP = require('./itrprint');
async function docHtml(c, kind, id, opts = {}, QRCode) {
  const s = c.settings();
  if (kind === 'voucher') {
    const v = c.voucher(id); if (!v) throw new Error('Voucher not found');
    if (VTYPES[v.vtype].items) {
      let qr = null;
      if (QRCode && ['SAL', 'PFI', 'QTN'].includes(v.vtype) && s.upi_id && s.show_upi_qr !== '0' && v.total > 0) qr = await QRCode.toDataURL(`upi://pay?pa=${encodeURIComponent(s.upi_id)}&pn=${encodeURIComponent(s.name)}&am=${v.total.toFixed(2)}&cu=INR&tn=${encodeURIComponent('Inv ' + v.number)}`, { margin: 1, width: 220 });
      return { html: PR.invoiceHtml(v, s, { qr, copy: opts.copy }), name: `${VTYPES[v.vtype].name} ${v.number}` };
    }
    return { html: PR.accountVoucherHtml(v, s), name: `${VTYPES[v.vtype].name} ${v.number}` };
  }
  if (kind === 'cheque') { const v = c.voucher(id); return { html: PR.chequeHtml(v, s, opts), name: 'Cheque ' + v.number }; }
  if (kind === 'report') return { html: PR.reportHtml(opts.report, s, opts), name: opts.report.title };
  if (kind === 'labels') return { html: PR.labelsHtml(opts.items, s, opts), name: 'Barcode labels' };
  if (kind === 'reminder') { const p = c.ledger(id); const bills = c.pendingBills(id).filter(b => b.amount > 0); return { html: PR.reminderLetterHtml(p, bills, s), name: 'Payment reminder ' + p.name }; }
  if (kind === 'payslip') { const reg = c.salaryRegister({ month: opts.month }); const row = reg.rows.find(r => r.id === id); return { html: PR.payslipHtml(row, opts.month, s), name: 'Payslip ' + row.name + ' ' + opts.month }; }
  if (kind === 'itr') { const r = c.itrCompute(opts.args || {}); return { html: ITRP.itrHtml(r, s), name: `Income Tax Computation ${r.ay ? 'AY ' + r.ay : 'TY ' + r.fy} ${s.name || ''}`.trim() }; }
  throw new Error('Unknown document');
}
function shareText(c, vid) {
  const v = c.voucher(vid); const s = c.settings(); const p = v.party_id ? c.ledger(v.party_id) : {};
  const text = `Dear ${v.party_name || 'Customer'},\n${VTYPES[v.vtype].name} ${v.number} dated ${U.fmtDate(v.date)} for ₹${U.inr(v.total)} from ${s.name}.${s.upi_id ? '\nPay via UPI: ' + s.upi_id : ''}\nThank you.`;
  const ph = String(p.phone || '').replace(/\D/g, ''); const num = ph.length === 10 ? '91' + ph : ph;
  return { text, whatsapp: `https://wa.me/${num}?text=${encodeURIComponent(text)}`, mailto: `mailto:${encodeURIComponent(p.email || '')}?subject=${encodeURIComponent(VTYPES[v.vtype].name + ' ' + v.number + ' - ' + s.name)}&body=${encodeURIComponent(text + '\n\n(PDF attached)')}` };
}
module.exports = { docHtml, shareText };
