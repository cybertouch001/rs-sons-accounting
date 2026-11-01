// R&S Sons Accounting - Excel builders, shared by the desktop app and the server. XLSX is passed in.
const U = require('./util');
function safeName(s) { return String(s).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80); }
function reportBook(XLSX, rep) {
  const rows = [[rep.title], [rep.subtitle || ''], [], rep.columns.map(c => c.label)];
  for (const r of rep.rows) rows.push(rep.columns.map(c => { const v = r[c.k]; return v == null ? '' : (c.t === 'date' && v ? U.fmtDate(v) : v); }));
  if (rep.foot) rows.push(rep.columns.map(c => rep.foot[c.k] == null ? '' : rep.foot[c.k]));
  const ws = XLSX.utils.aoa_to_sheet(rows); ws['!cols'] = rep.columns.map(c => ({ wch: c.t === 'amt' ? 15 : c.t === 'date' ? 11 : 24 }));
  rep.columns.forEach((c, ci) => { if (c.t === 'amt') for (let ri = 4; ri < rows.length; ri++) { const cell = ws[XLSX.utils.encode_cell({ r: ri, c: ci })]; if (cell && typeof cell.v === 'number') cell.z = '#,##,##0.00'; } });
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, safeName(rep.title).slice(0, 30).replace(/[\[\]*?:\/\\]/g, '') || 'Report');
  if (rep.extraSheets) for (const sh of rep.extraSheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([sh.columns.map(c => c.label), ...sh.rows.map(r => sh.columns.map(c => r[c.k] == null ? '' : r[c.k]))]), sh.name.slice(0, 30));
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}
function gstr1Book(XLSX, c, f) {
  const wb = XLSX.utils.book_new();
  for (const sec of ['summary', 'b2b', 'b2cl', 'b2cs', 'cdnr', 'cdnur', 'hsn', 'docs']) { const r = c.gstr1(Object.assign({}, f, { section: sec })); const rows = [r.columns.map(x => x.label), ...r.rows.map(row => r.columns.map(x => row[x.k] == null ? '' : (x.t === 'date' ? U.fmtDate(row[x.k]) : row[x.k])))]; if (r.foot) rows.push(r.columns.map(x => r.foot[x.k] == null ? '' : r.foot[x.k])); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sec.toUpperCase()); }
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}
function mastersBook(XLSX, c) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(c.ledgers().map(l => ({ Name: l.name, Group: l.group_name, 'Opening Balance (Dr+ / Cr-)': l.opening, GSTIN: l.gstin || '', 'State Code': l.state_code || '', Address: l.address || '', City: l.city || '', Pincode: l.pincode || '', Phone: l.phone || '', Email: l.email || '', PAN: l.pan || '', 'Credit Days': l.credit_days, 'Credit Limit': l.credit_limit }))), 'Ledgers');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(c.items().map(i => ({ Name: i.name, Group: i.group_name || '', Unit: i.unit_name || '', Type: i.item_type, HSN: i.hsn || '', 'GST Rate': i.gst_rate, 'Sale Rate': i.sale_rate, 'Purchase Rate': i.purchase_rate, MRP: i.mrp, 'Opening Qty': i.opening_qty, 'Opening Rate': i.opening_rate, Barcode: i.barcode || '', 'Min Stock': i.min_stock }))), 'Items');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}
function templateBook(XLSX) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Name', 'Group', 'Opening Balance (Dr+ / Cr-)', 'GSTIN', 'State Code', 'Address', 'City', 'Pincode', 'Phone', 'Email', 'PAN', 'Credit Days', 'Credit Limit'], ['Sharma Traders', 'Sundry Debtors', 5000, '', '09', 'Chowk', 'Varanasi', '221001', '9999999999', '', '', 30, 100000]]), 'Ledgers');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Name', 'Group', 'Unit', 'Type', 'HSN', 'GST Rate', 'Sale Rate', 'Purchase Rate', 'MRP', 'Opening Qty', 'Opening Rate', 'Barcode', 'Min Stock'], ['Sample Item', 'General', 'Nos', 'Goods', '33049990', 18, 100, 70, 120, 10, 70, '', 5]]), 'Items');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}
function importMasters(XLSX, c, wb) {
  const out = { ledgers: 0, items: 0, errors: [] };
  const sh = n => wb.Sheets[wb.SheetNames.find(x => x.toLowerCase() === n.toLowerCase())];
  const lsh = sh('Ledgers'), ish = sh('Items');
  if (!lsh && !ish) throw new Error('Excel must have a sheet named "Ledgers" or "Items" (download the template)');
  if (lsh) XLSX.utils.sheet_to_json(lsh).forEach((r, i) => {
    try { const g = c.groupByName(String(r.Group || '').trim()); if (!g) throw new Error('unknown group "' + r.Group + '"');
      const ex = c.ledgerByName(String(r.Name).trim());
      c.saveLedger({ id: ex ? ex.id : undefined, name: String(r.Name).trim(), group_id: g.id, opening: Number(r['Opening Balance (Dr+ / Cr-)'] || r.Opening || 0), gstin: r.GSTIN || '', state_code: r['State Code'] ? String(r['State Code']).padStart(2, '0') : '', address: r.Address || '', city: r.City || '', pincode: r.Pincode ? String(r.Pincode) : '', phone: r.Phone ? String(r.Phone) : '', email: r.Email || '', pan: r.PAN || '', credit_days: r['Credit Days'] || 0, credit_limit: r['Credit Limit'] || 0 });
      out.ledgers++; } catch (e) { out.errors.push(`Ledgers row ${i + 2}: ${e.message}`); } });
  if (ish) XLSX.utils.sheet_to_json(ish).forEach((r, i) => {
    try { let unit = c.list('units').find(u => u.name.toLowerCase() === String(r.Unit || 'Nos').toLowerCase()); const unitId = unit ? unit.id : c.saveSimple('units', { name: String(r.Unit), uqc: 'OTH' });
      let grp = c.list('item_groups').find(u => u.name.toLowerCase() === String(r.Group || 'General').toLowerCase()); const gid = grp ? grp.id : c.saveSimple('item_groups', { name: String(r.Group) });
      const ex = c.items().find(x => x.name.toLowerCase() === String(r.Name).trim().toLowerCase());
      c.saveItem({ id: ex ? ex.id : undefined, name: String(r.Name).trim(), group_id: gid, unit_id: unitId, item_type: r.Type === 'Service' ? 'Service' : 'Goods', hsn: r.HSN ? String(r.HSN) : '', gst_rate: Number(r['GST Rate'] || 0), sale_rate: r['Sale Rate'] || 0, purchase_rate: r['Purchase Rate'] || 0, mrp: r.MRP || 0, opening_qty: r['Opening Qty'] || 0, opening_rate: r['Opening Rate'] || 0, barcode: r.Barcode ? String(r.Barcode) : '', min_stock: r['Min Stock'] || 0 });
      out.items++; } catch (e) { out.errors.push(`Items row ${i + 2}: ${e.message}`); } });
  return out;
}
// Read any spreadsheet / CSV into an array of rows (first sheet) - used by bank statement and 2B Excel import.
function sheetRows(XLSX, bytes) { const wb = XLSX.read(bytes, { type: 'array', cellDates: false, raw: false }); const ws = wb.Sheets[wb.SheetNames[0]]; return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }); }
module.exports = { safeName, reportBook, gstr1Book, mastersBook, templateBook, importMasters, sheetRows };
