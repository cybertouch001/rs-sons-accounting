
// R&S Sons Accounting - invoice/voucher line calculation (shared by engine and screen)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RSCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  function calcVoucher(v, opts) {
    opts = opts || {};
    const inter = !!v.is_inter, inclusive = !!v.tax_inclusive, billDisc = Number(v.bill_disc_pct) || 0;
    const noTax = !!opts.noTax;
    const t = { gross: 0, discount: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, qty: 0 };
    for (const l of (v.items || [])) {
      const qty = Number(l.qty) || 0; let rate = Number(l.rate) || 0;
      const gst = noTax ? 0 : (Number(l.gst_rate) || 0), cessR = noTax ? 0 : (Number(l.cess_rate) || 0);
      if (inclusive && (gst + cessR)) rate = rate / (1 + (gst + cessR) / 100);
      const gross = r2(qty * rate);
      let disc = Number(l.disc_pct) ? r2(gross * Number(l.disc_pct) / 100) : r2(Number(l.disc_amt) || 0);
      let taxable = gross - disc;
      if (billDisc) { const bd = r2(taxable * billDisc / 100); disc = r2(disc + bd); taxable = taxable - bd; }
      taxable = r2(taxable);
      let cgst = 0, sgst = 0, igst = 0;
      if (inter) igst = r2(taxable * gst / 100); else { cgst = r2(taxable * gst / 200); sgst = cgst; }
      const cess = r2(taxable * cessR / 100);
      Object.assign(l, { disc_amt: disc, taxable, cgst, sgst, igst, cess, amount: r2(taxable + cgst + sgst + igst + cess), gross });
      t.gross += gross; t.discount += disc; t.taxable += taxable; t.cgst += cgst; t.sgst += sgst; t.igst += igst; t.cess += cess; t.qty += qty;
    }
    for (const k in t) t[k] = r2(t[k]);
    const before = r2(t.taxable + t.cgst + t.sgst + t.igst + t.cess);
    t.round_off = opts.roundOff === false ? 0 : r2(Math.round(before) - before);
    if (opts.manualRound != null && opts.manualRound !== '') t.round_off = r2(Number(opts.manualRound));
    t.total = r2(before + t.round_off);
    t.tax = r2(t.cgst + t.sgst + t.igst + t.cess);
    return t;
  }
  return { calcVoucher, r2 };
});
