
// R&S Sons Accounting - shared utilities (Node + browser)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RSUtil = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const STATES = [
    ['01','Jammu and Kashmir'],['02','Himachal Pradesh'],['03','Punjab'],['04','Chandigarh'],['05','Uttarakhand'],
    ['06','Haryana'],['07','Delhi'],['08','Rajasthan'],['09','Uttar Pradesh'],['10','Bihar'],['11','Sikkim'],
    ['12','Arunachal Pradesh'],['13','Nagaland'],['14','Manipur'],['15','Mizoram'],['16','Tripura'],['17','Meghalaya'],
    ['18','Assam'],['19','West Bengal'],['20','Jharkhand'],['21','Odisha'],['22','Chhattisgarh'],['23','Madhya Pradesh'],
    ['24','Gujarat'],['26','Dadra and Nagar Haveli and Daman and Diu'],['27','Maharashtra'],['29','Karnataka'],
    ['30','Goa'],['31','Lakshadweep'],['32','Kerala'],['33','Tamil Nadu'],['34','Puducherry'],
    ['35','Andaman and Nicobar Islands'],['36','Telangana'],['37','Andhra Pradesh'],['38','Ladakh'],['97','Other Territory']
  ];
  const stateName = c => (STATES.find(s => s[0] === String(c).padStart(2,'0')) || [null, ''])[1];
  const stateCode = n => { if (!n) return ''; const s = STATES.find(s => s[1].toLowerCase() === String(n).toLowerCase() || s[0] === String(n)); return s ? s[0] : ''; };
  const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const r3 = n => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
  function inr(n, dec = 2) {
    n = Number(n) || 0; const neg = n < 0; n = Math.abs(n);
    let [i, f] = n.toFixed(dec).split('.');
    let last3 = i.slice(-3), rest = i.slice(0, -3);
    if (rest) last3 = ',' + last3;
    rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    return (neg ? '-' : '') + rest + last3 + (dec ? '.' + f : '');
  }
  function drcr(n) { n = r2(n); if (!n) return '0.00'; return inr(Math.abs(n)) + (n > 0 ? ' Dr' : ' Cr'); }
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function two(n) { return n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : ''); }
  function three(n) { const h = Math.floor(n / 100), r = n % 100; return (h ? ones[h] + ' Hundred' + (r ? ' ' : '') : '') + (r ? two(r) : ''); }
  function intWords(n) {
    if (n === 0) return 'Zero';
    let out = [];
    const crore = Math.floor(n / 10000000); n %= 10000000;
    const lakh = Math.floor(n / 100000); n %= 100000;
    const thousand = Math.floor(n / 1000); n %= 1000;
    if (crore) out.push(intWords(crore) + ' Crore');
    if (lakh) out.push(two(lakh) + ' Lakh');
    if (thousand) out.push(two(thousand) + ' Thousand');
    if (n) out.push(three(n));
    return out.join(' ');
  }
  function amountInWords(amt) {
    amt = r2(Math.abs(Number(amt) || 0));
    const rupees = Math.floor(amt), paise = Math.round((amt - rupees) * 100);
    let s = 'Rupees ' + intWords(rupees);
    if (paise) s += ' and ' + two(paise) + ' Paise';
    return s + ' Only';
  }
  function fmtDate(d) { if (!d) return ''; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}-${m}-${y}`; }
  function fmtDateLong(d) { if (!d) return ''; const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; const [y, m, dd] = String(d).slice(0,10).split('-'); return `${dd}-${M[+m-1]}-${y}`; }
  function today() { const d = new Date(); const z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; }
  function fyOf(dateStr) { const [y, m] = dateStr.split('-').map(Number); const s = m >= 4 ? y : y - 1; return { start: `${s}-04-01`, end: `${s + 1}-03-31`, label: `${s}-${String((s + 1) % 100).padStart(2, '0')}` }; }
  function daysBetween(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); }
  function addDays(d, n) { const t = new Date(Date.parse(d) + n * 86400000); return t.toISOString().slice(0, 10); }
  const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
  function gstinChecksum(g) {
    const cs = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'; let sum = 0;
    for (let i = 0; i < 14; i++) { const v = cs.indexOf(g[i]); const p = v * (i % 2 ? 2 : 1); sum += Math.floor(p / 36) + (p % 36); }
    return cs[(36 - (sum % 36)) % 36];
  }
  function validGSTIN(g) { if (!g) return true; g = String(g).toUpperCase().trim(); return GSTIN_RE.test(g) && gstinChecksum(g) === g[14]; }
  const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  return { STATES, stateName, stateCode, r2, r3, inr, drcr, amountInWords, fmtDate, fmtDateLong, today, fyOf, daysBetween, addDays, validGSTIN, gstinChecksum, PAN_RE, esc };
});
