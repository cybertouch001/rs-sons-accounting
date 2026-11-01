
// R&S Sons Accounting - company database schema & defaults
const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS groups (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL COLLATE NOCASE, parent_id INTEGER, nature TEXT NOT NULL, direct INTEGER DEFAULT 0, is_system INTEGER DEFAULT 0, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS ledgers (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL COLLATE NOCASE, alias TEXT, group_id INTEGER NOT NULL, opening REAL DEFAULT 0,
  gstin TEXT, state_code TEXT, address TEXT, city TEXT, pincode TEXT, phone TEXT, email TEXT, pan TEXT, contact_person TEXT,
  credit_limit REAL DEFAULT 0, credit_days INTEGER DEFAULT 0, bill_wise INTEGER DEFAULT 0, tax_type TEXT, tax_rate REAL DEFAULT 0, tds_section TEXT,
  bank_name TEXT, bank_acc TEXT, ifsc TEXT, price_list_id INTEGER, msme TEXT, udyam TEXT, gst_reg_type TEXT DEFAULT 'Regular',
  dep_rate REAL DEFAULT 0, interest_rate REAL DEFAULT 0, notes TEXT, is_system INTEGER DEFAULT 0, active INTEGER DEFAULT 1, created_at TEXT);
CREATE TABLE IF NOT EXISTS units (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL COLLATE NOCASE, uqc TEXT, decimals INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS item_groups (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL COLLATE NOCASE, parent_id INTEGER);
CREATE TABLE IF NOT EXISTS godowns (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL COLLATE NOCASE, address TEXT);
CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL COLLATE NOCASE, alias TEXT, code TEXT, group_id INTEGER, unit_id INTEGER,
  item_type TEXT DEFAULT 'Goods', hsn TEXT, gst_rate REAL DEFAULT 0, cess_rate REAL DEFAULT 0, sale_rate REAL DEFAULT 0, purchase_rate REAL DEFAULT 0, mrp REAL DEFAULT 0,
  opening_qty REAL DEFAULT 0, opening_rate REAL DEFAULT 0, opening_godown_id INTEGER, barcode TEXT, brand TEXT, min_stock REAL DEFAULT 0, max_stock REAL DEFAULT 0,
  batch_wise INTEGER DEFAULT 0, description TEXT, active INTEGER DEFAULT 1, created_at TEXT);
CREATE TABLE IF NOT EXISTS price_lists (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS price_list_items (price_list_id INTEGER, item_id INTEGER, rate REAL, disc_pct REAL DEFAULT 0, PRIMARY KEY (price_list_id, item_id));
CREATE TABLE IF NOT EXISTS cost_centres (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL COLLATE NOCASE, category TEXT);
CREATE TABLE IF NOT EXISTS salesmen (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL COLLATE NOCASE, phone TEXT, commission_pct REAL DEFAULT 0);
CREATE TABLE IF NOT EXISTS boms (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL COLLATE NOCASE, item_id INTEGER NOT NULL, qty REAL DEFAULT 1, notes TEXT);
CREATE TABLE IF NOT EXISTS bom_items (bom_id INTEGER, item_id INTEGER, qty REAL);
CREATE TABLE IF NOT EXISTS vouchers (id INTEGER PRIMARY KEY, vtype TEXT NOT NULL, fy TEXT, seq INTEGER, number TEXT, date TEXT NOT NULL,
  party_id INTEGER, sp_ledger_id INTEGER, place_of_supply TEXT, is_inter INTEGER DEFAULT 0, ref_no TEXT, ref_date TEXT, narration TEXT,
  gross REAL DEFAULT 0, discount REAL DEFAULT 0, taxable REAL DEFAULT 0, cgst REAL DEFAULT 0, sgst REAL DEFAULT 0, igst REAL DEFAULT 0, cess REAL DEFAULT 0,
  round_off REAL DEFAULT 0, total REAL DEFAULT 0, bill_disc_pct REAL DEFAULT 0, tax_inclusive INTEGER DEFAULT 0, rcm INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active', due_date TEXT, salesman_id INTEGER, cost_centre_id INTEGER, orig_ref TEXT, linked_id INTEGER,
  cheque_no TEXT, cheque_date TEXT, pay_mode TEXT, transport TEXT, vehicle_no TEXT, distance REAL, eway_no TEXT,
  buyer_name TEXT, buyer_gstin TEXT, buyer_address TEXT, ship_to TEXT, extra TEXT, bom_id INTEGER, attachment TEXT,
  created_by TEXT, created_at TEXT, updated_by TEXT, updated_at TEXT);
CREATE INDEX IF NOT EXISTS ix_v_date ON vouchers(date);
CREATE INDEX IF NOT EXISTS ix_v_type ON vouchers(vtype, fy);
CREATE TABLE IF NOT EXISTS entries (id INTEGER PRIMARY KEY, voucher_id INTEGER NOT NULL, ledger_id INTEGER NOT NULL, dr REAL DEFAULT 0, cr REAL DEFAULT 0,
  cost_centre_id INTEGER, line_narr TEXT, bank_date TEXT, sort INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS ix_e_led ON entries(ledger_id);
CREATE INDEX IF NOT EXISTS ix_e_v ON entries(voucher_id);
CREATE TABLE IF NOT EXISTS vitems (id INTEGER PRIMARY KEY, voucher_id INTEGER NOT NULL, item_id INTEGER NOT NULL, qty REAL DEFAULT 0, rate REAL DEFAULT 0,
  disc_pct REAL DEFAULT 0, disc_amt REAL DEFAULT 0, taxable REAL DEFAULT 0, gst_rate REAL DEFAULT 0, cgst REAL DEFAULT 0, sgst REAL DEFAULT 0, igst REAL DEFAULT 0,
  cess REAL DEFAULT 0, amount REAL DEFAULT 0, godown_id INTEGER, batch_no TEXT, mfg_date TEXT, exp_date TEXT, descr TEXT, direction INTEGER DEFAULT 0, cost REAL DEFAULT 0, sort INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS ix_vi_item ON vitems(item_id);
CREATE INDEX IF NOT EXISTS ix_vi_v ON vitems(voucher_id);
CREATE TABLE IF NOT EXISTS bill_refs (id INTEGER PRIMARY KEY, voucher_id INTEGER, ledger_id INTEGER NOT NULL, ref_type TEXT, ref_name TEXT, amount REAL, date TEXT, due_date TEXT);
CREATE INDEX IF NOT EXISTS ix_br ON bill_refs(ledger_id, ref_name);
CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY, ts TEXT, username TEXT, action TEXT, entity TEXT, entity_id INTEGER, summary TEXT, before_json TEXT, after_json TEXT);
CREATE TABLE IF NOT EXISTS budgets (id INTEGER PRIMARY KEY, fy TEXT, ledger_id INTEGER, amount REAL, UNIQUE(fy, ledger_id));
CREATE TABLE IF NOT EXISTS reminders (id INTEGER PRIMARY KEY, due_date TEXT, title TEXT, notes TEXT, ledger_id INTEGER, done INTEGER DEFAULT 0, created_at TEXT);
CREATE TABLE IF NOT EXISTS employees (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL COLLATE NOCASE, designation TEXT, doj TEXT, pan TEXT, uan TEXT, esi_no TEXT, bank_acc TEXT, ifsc TEXT,
  basic REAL DEFAULT 0, hra REAL DEFAULT 0, da REAL DEFAULT 0, other_allow REAL DEFAULT 0, pf_applicable INTEGER DEFAULT 1, esi_applicable INTEGER DEFAULT 0, pt REAL DEFAULT 0, tds REAL DEFAULT 0, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS payroll_runs (id INTEGER PRIMARY KEY, month TEXT UNIQUE, voucher_id INTEGER, data_json TEXT, created_at TEXT);
`;


// v2.0 tables (automation). Created on open for older company files too.
const SCHEMA_V2 = `
CREATE TABLE IF NOT EXISTS itr_profiles (fy TEXT PRIMARY KEY, data_json TEXT, updated_by TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS recurring (id INTEGER PRIMARY KEY, name TEXT NOT NULL, template_json TEXT NOT NULL, vtype TEXT, frequency TEXT DEFAULT 'monthly', day INTEGER DEFAULT 1,
  start_date TEXT, end_date TEXT, next_date TEXT, auto_post INTEGER DEFAULT 0, active INTEGER DEFAULT 1, last_run TEXT, runs INTEGER DEFAULT 0, created_by TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS recurring_log (id INTEGER PRIMARY KEY, recurring_id INTEGER, due_date TEXT, voucher_id INTEGER, posted_by TEXT, posted_at TEXT, UNIQUE(recurring_id, due_date));
CREATE TABLE IF NOT EXISTS bank_statements (id INTEGER PRIMARY KEY, ledger_id INTEGER NOT NULL, file_name TEXT, from_date TEXT, to_date TEXT, lines INTEGER DEFAULT 0, imported_by TEXT, imported_at TEXT);
CREATE TABLE IF NOT EXISTS bank_lines (id INTEGER PRIMARY KEY, stmt_id INTEGER, ledger_id INTEGER NOT NULL, date TEXT, narration TEXT, ref TEXT, withdrawal REAL DEFAULT 0, deposit REAL DEFAULT 0, balance REAL,
  entry_id INTEGER, voucher_id INTEGER, status TEXT DEFAULT 'unmatched', fingerprint TEXT, UNIQUE(ledger_id, fingerprint));
CREATE INDEX IF NOT EXISTS ix_bl ON bank_lines(ledger_id, date);
CREATE TABLE IF NOT EXISTS gstr2b_imports (id INTEGER PRIMARY KEY, period TEXT NOT NULL, gstin TEXT, file_name TEXT, docs INTEGER DEFAULT 0, data_json TEXT, imported_by TEXT, imported_at TEXT, UNIQUE(period));
`;

// [name, parent, nature, direct]
const DEFAULT_GROUPS = [
  ['Capital Account', null, 'L', 0], ['Reserves & Surplus', 'Capital Account', 'L', 0],
  ['Loans (Liability)', null, 'L', 0], ['Bank OD A/c', 'Loans (Liability)', 'L', 0], ['Secured Loans', 'Loans (Liability)', 'L', 0], ['Unsecured Loans', 'Loans (Liability)', 'L', 0],
  ['Current Liabilities', null, 'L', 0], ['Duties & Taxes', 'Current Liabilities', 'L', 0], ['Provisions', 'Current Liabilities', 'L', 0], ['Sundry Creditors', 'Current Liabilities', 'L', 0],
  ['Suspense A/c', null, 'L', 0],
  ['Fixed Assets', null, 'A', 0], ['Investments', null, 'A', 0],
  ['Current Assets', null, 'A', 0], ['Bank Accounts', 'Current Assets', 'A', 0], ['Cash-in-Hand', 'Current Assets', 'A', 0], ['Deposits (Asset)', 'Current Assets', 'A', 0],
  ['Loans & Advances (Asset)', 'Current Assets', 'A', 0], ['Stock-in-Hand', 'Current Assets', 'A', 0], ['Sundry Debtors', 'Current Assets', 'A', 0],
  ['Misc. Expenses (Asset)', null, 'A', 0],
  ['Sales Accounts', null, 'I', 1], ['Direct Incomes', null, 'I', 1], ['Indirect Incomes', null, 'I', 0],
  ['Purchase Accounts', null, 'E', 1], ['Direct Expenses', null, 'E', 1], ['Indirect Expenses', null, 'E', 0],
];
// [name, group, extra]
const DEFAULT_LEDGERS = [
  ['Cash', 'Cash-in-Hand', {}],
  ['Profit & Loss A/c', 'Reserves & Surplus', { tax_type: 'PL' }],
  ["Proprietor's Capital", 'Capital Account', {}],
  ['Sales Account', 'Sales Accounts', {}], ['Sales Return', 'Sales Accounts', {}],
  ['Purchase Account', 'Purchase Accounts', {}], ['Purchase Return', 'Purchase Accounts', {}],
  ['Output CGST', 'Duties & Taxes', { tax_type: 'CGST_OUT' }], ['Output SGST', 'Duties & Taxes', { tax_type: 'SGST_OUT' }],
  ['Output IGST', 'Duties & Taxes', { tax_type: 'IGST_OUT' }], ['Output Cess', 'Duties & Taxes', { tax_type: 'CESS_OUT' }],
  ['Input CGST', 'Duties & Taxes', { tax_type: 'CGST_IN' }], ['Input SGST', 'Duties & Taxes', { tax_type: 'SGST_IN' }],
  ['Input IGST', 'Duties & Taxes', { tax_type: 'IGST_IN' }], ['Input Cess', 'Duties & Taxes', { tax_type: 'CESS_IN' }],
  ['GST Payable on RCM', 'Duties & Taxes', { tax_type: 'RCM' }],
  ['TDS Payable', 'Duties & Taxes', { tax_type: 'TDS', tds_section: '194C', tax_rate: 1 }],
  ['TDS Receivable', 'Loans & Advances (Asset)', { tax_type: 'TDSR' }],
  ['TCS Payable', 'Duties & Taxes', { tax_type: 'TCS', tax_rate: 0.1 }],
  ['Round Off', 'Indirect Expenses', { tax_type: 'ROUND' }],
  ['Discount Allowed', 'Indirect Expenses', {}], ['Discount Received', 'Indirect Incomes', {}],
  ['Freight Inward', 'Direct Expenses', {}], ['Wages', 'Direct Expenses', {}],
  ['Salary', 'Indirect Expenses', { tax_type: 'SALARY' }], ['Rent', 'Indirect Expenses', {}], ['Electricity Charges', 'Indirect Expenses', {}],
  ['Telephone & Internet', 'Indirect Expenses', {}], ['Printing & Stationery', 'Indirect Expenses', {}], ['Office Expenses', 'Indirect Expenses', {}],
  ['Bank Charges', 'Indirect Expenses', {}], ['Depreciation', 'Indirect Expenses', { tax_type: 'DEP' }], ['Interest Paid', 'Indirect Expenses', {}],
  ['Employer PF Contribution', 'Indirect Expenses', { tax_type: 'PF_ER' }], ['Employer ESI Contribution', 'Indirect Expenses', { tax_type: 'ESI_ER' }],
  ['Interest Received', 'Indirect Incomes', {}], ['Commission Received', 'Indirect Incomes', {}],
  ['Salary Payable', 'Current Liabilities', { tax_type: 'SAL_PAY' }], ['PF Payable', 'Current Liabilities', { tax_type: 'PF_PAY' }],
  ['ESI Payable', 'Current Liabilities', { tax_type: 'ESI_PAY' }], ['Professional Tax Payable', 'Current Liabilities', { tax_type: 'PT_PAY' }],
  ['TDS on Salary Payable', 'Duties & Taxes', { tax_type: 'TDS_SAL', tds_section: '192' }],
  ['Suspense', 'Suspense A/c', {}],
];
const DEFAULT_UNITS = [['Nos', 'NOS', 0], ['Pcs', 'PCS', 0], ['Kg', 'KGS', 3], ['Gm', 'GMS', 3], ['Ltr', 'LTR', 3], ['Ml', 'MLT', 0], ['Mtr', 'MTR', 2], ['Box', 'BOX', 0], ['Dozen', 'DOZ', 0], ['Pack', 'PAC', 0], ['Set', 'SET', 0], ['Bag', 'BAG', 0], ['Hrs', 'OTH', 2]];

const VTYPES = {
  SAL: { name: 'Sales', short: 'Sales Invoice', items: true, accounting: true, stock: -1, side: 'sale', key: 'F8', prefix: 'INV/' },
  PUR: { name: 'Purchase', short: 'Purchase Bill', items: true, accounting: true, stock: 1, side: 'purchase', key: 'F9', prefix: 'PUR/' },
  CRN: { name: 'Credit Note', short: 'Sales Return (Credit Note)', items: true, accounting: true, stock: 1, side: 'sale', key: 'Ctrl+F8', prefix: 'CN/' },
  DBN: { name: 'Debit Note', short: 'Purchase Return (Debit Note)', items: true, accounting: true, stock: -1, side: 'purchase', key: 'Ctrl+F9', prefix: 'DN/' },
  RCT: { name: 'Receipt', short: 'Receipt', items: false, accounting: true, stock: 0, key: 'F6', prefix: 'RCT/' },
  PMT: { name: 'Payment', short: 'Payment', items: false, accounting: true, stock: 0, key: 'F5', prefix: 'PMT/' },
  CNT: { name: 'Contra', short: 'Contra', items: false, accounting: true, stock: 0, key: 'F4', prefix: 'CNT/' },
  JRN: { name: 'Journal', short: 'Journal', items: false, accounting: true, stock: 0, key: 'F7', prefix: 'JV/' },
  SOR: { name: 'Sales Order', short: 'Sales Order', items: true, accounting: false, stock: 0, side: 'sale', key: 'Alt+F5', prefix: 'SO/' },
  POR: { name: 'Purchase Order', short: 'Purchase Order', items: true, accounting: false, stock: 0, side: 'purchase', key: 'Alt+F4', prefix: 'PO/' },
  QTN: { name: 'Quotation', short: 'Sales Quotation', items: true, accounting: false, stock: 0, side: 'sale', key: 'Alt+F6', prefix: 'QT/' },
  PFI: { name: 'Proforma Invoice', short: 'Proforma Invoice', items: true, accounting: false, stock: 0, side: 'sale', key: '', prefix: 'PI/' },
  DCH: { name: 'Delivery Challan', short: 'Delivery Challan', items: true, accounting: false, stock: 0, side: 'sale', key: 'Alt+F8', prefix: 'DC/' },
  GRN: { name: 'Goods Receipt Note', short: 'Goods Receipt Note (GRN)', items: true, accounting: false, stock: 0, side: 'purchase', key: 'Alt+F9', prefix: 'GRN/' },
  STJ: { name: 'Stock Journal', short: 'Stock Journal / Transfer', items: true, accounting: false, stock: 2, key: 'Alt+F7', prefix: 'SJ/' },
  PRD: { name: 'Production', short: 'Production (BOM)', items: true, accounting: false, stock: 2, key: '', prefix: 'PRD/' },
};
module.exports = { SCHEMA, SCHEMA_V2, DEFAULT_GROUPS, DEFAULT_LEDGERS, DEFAULT_UNITS, VTYPES };
