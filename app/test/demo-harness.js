
// Shared: build the exact demo company the app's "Create Demo Company" button builds, in plain Node.
const fs = require('fs'), path = require('path'), vm = require('vm');
const { Company, util: U } = require('../core');
module.exports = async function buildDemo(SQL) {
  const db = new SQL.Database();
  const g = s => s + U.gstinChecksum(s);
  const c = Company.create(db, { name: 'R&S Sons Demo Traders', address: 'Shop 12, Godowlia Market', city: 'Varanasi', pincode: '221001', state_code: '09', gstin: g('09AAJFR1234K1Z'), pan: 'AAJFR1234K', phone: '0542-2400000', email: 'demo@example.com', books_begin: U.fyOf(U.today()).start, bank_name: 'State Bank of India', bank_acc: '00000012345678', bank_ifsc: 'SBIN0000001', upi_id: 'demo@sbi' }, 'admin');
  const C = async (m, ...a) => { if (typeof c[m] !== 'function') throw new Error('no method ' + m); return c[m](...a); };
  const APP = { cache: {} };
  const loadCache = async () => { Object.assign(APP.cache, { ledgers: c.ledgers(), items: c.items(), groups: c.groups(), units: c.list('units') }); return APP.cache; };
  const window = {};
  const ctx = vm.createContext({ window, U, C, APP, loadCache, console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'demo.js'), 'utf8'), ctx);
  await window.seedDemo();
  return c;
};
