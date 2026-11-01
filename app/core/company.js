
// R&S Sons Accounting - company engine (masters, vouchers, posting)
const U = require('./util');
const { calcVoucher } = require('./calc');
const { SCHEMA, SCHEMA_V2, DEFAULT_GROUPS, DEFAULT_LEDGERS, DEFAULT_UNITS, VTYPES } = require('./schema');
const r2 = U.r2;

class Company {
  constructor(db, user) { this.db = db; this.user = user || 'admin'; this.onChange = null; }

  // ---------- low-level ----------
  all(sql, p = []) { if (this.db.allRows) return this.db.allRows(sql, p); const st = this.db.prepare(sql); st.bind(p); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; }
  get(sql, p = []) { return this.all(sql, p)[0] || null; }
  val(sql, p = []) { const r = this.get(sql, p); return r ? Object.values(r)[0] : null; }
  run(sql, p = []) { this.db.run(sql, p); }
  lastId() { return this.val('SELECT last_insert_rowid() AS id'); }
  // Transactions nest: when the multi-user server already holds a write transaction around the whole request,
  // an inner tx() just runs inside it (the outer one commits or rolls back everything together).
  tx(fn) {
    if (this._txDepth) { this._txDepth++; try { const r = fn(); this.changed(); return r; } finally { this._txDepth--; } }
    this.db.run('BEGIN'); this._txDepth = 1;
    try { const r = fn(); this.db.run('COMMIT'); this._txDepth = 0; this.changed(); return r; } catch (e) { this._txDepth = 0; try { this.db.run('ROLLBACK'); } catch (_) {} throw e; }
  }
  changed() { if (this.onChange) this.onChange(); }
  now() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }
  insert(table, obj) {
    const keys = Object.keys(obj).filter(k => obj[k] !== undefined);
    this.run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, keys.map(k => obj[k] === '' ? null : obj[k]));
    return this.lastId();
  }
  update(table, id, obj) {
    const keys = Object.keys(obj).filter(k => obj[k] !== undefined && k !== 'id');
    if (!keys.length) return;
    this.run(`UPDATE ${table} SET ${keys.map(k => k + '=?').join(',')} WHERE id=?`, [...keys.map(k => obj[k] === '' ? null : obj[k]), id]);
  }
  audit(action, entity, id, summary, before, after) {
    this.run('INSERT INTO audit_log (ts, username, action, entity, entity_id, summary, before_json, after_json) VALUES (?,?,?,?,?,?,?,?)',
      [this.now(), this.user, action, entity, id, summary, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null]);
  }

  // ---------- setup ----------
  static create(db, info, user) {
    const c = new Company(db, user);
    db.run('PRAGMA foreign_keys = OFF');
    db.exec(SCHEMA); c.migrate();
    c.tx(() => {
      const s = Object.assign({
        name: 'My Company', mailing_name: '', address: '', city: '', pincode: '', state_code: '09', gstin: '', pan: '', phone: '', email: '', website: '',
        books_begin: U.fyOf(U.today()).start, gst_registered: '1', round_off: '1', bank_name: '', bank_acc: '', bank_ifsc: '', bank_branch: '', upi_id: '',
        terms: '1. Goods once sold will not be taken back.\n2. Interest @18% p.a. will be charged if payment is not made within due date.\n3. Subject to local jurisdiction.',
        stock_method: 'AVG', invoice_copies: 'ORIGINAL FOR RECIPIENT', show_upi_qr: '1', created_at: c.now(), version: '1'
      }, info || {});
      for (const k in VTYPES) if (s['prefix_' + k] == null) s['prefix_' + k] = VTYPES[k].prefix;
      for (const k in s) c.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', [k, s[k] == null ? '' : String(s[k])]);
      const gid = {};
      DEFAULT_GROUPS.forEach(([name, parent, nature, direct], i) => {
        gid[name] = c.insert('groups', { name, parent_id: parent ? gid[parent] : null, nature, direct, is_system: 1, sort: i });
      });
      for (const [name, g, extra] of DEFAULT_LEDGERS) c.insert('ledgers', Object.assign({ name, group_id: gid[g], is_system: 1, created_at: c.now() }, extra));
      for (const [name, uqc, d] of DEFAULT_UNITS) c.insert('units', { name, uqc, decimals: d });
      c.insert('godowns', { name: 'Main Location' });
      c.insert('item_groups', { name: 'General' });
      c.audit('create', 'company', 0, 'Company created: ' + s.name);
    });
    return c;
  }
  migrate() {
    this.db.exec(SCHEMA); this.db.exec(SCHEMA_V2);
    // v2.0: a revision number on vouchers lets two users editing the same voucher detect each other (no silent overwrite)
    const cols = this.all('PRAGMA table_info(vouchers)').map(r => r.name);
    if (!cols.includes('rev')) this.db.run('ALTER TABLE vouchers ADD COLUMN rev INTEGER DEFAULT 0');
  }

  // ---------- settings ----------
  settings() { const o = {}; for (const r of this.all('SELECT key, value FROM settings')) o[r.key] = r.value; return o; }
  setting(k) { return this.val('SELECT value FROM settings WHERE key=?', [k]); }
  saveSettings(obj) {
    if (obj.gstin && !U.validGSTIN(obj.gstin)) throw new Error('Company GSTIN is not valid (check digits / checksum).');
    this.tx(() => { for (const k in obj) this.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', [k, obj[k] == null ? '' : String(obj[k])]);
      this.audit('update', 'company', 0, 'Company settings changed', null, obj); });
    return this.settings();
  }
  fyList() {
    const bb = this.setting('books_begin'); const s0 = U.fyOf(bb).start;
    const maxD = this.val("SELECT MAX(date) FROM vouchers") || U.today();
    const last = U.fyOf(maxD > U.today() ? maxD : U.today()).start;
    const out = []; let y = +s0.slice(0, 4);
    while (`${y}-04-01` <= last) { out.push(U.fyOf(`${y}-04-01`)); y++; }
    return out.reverse();
  }

  // ---------- groups ----------
  groups() { return this.all('SELECT g.*, p.name AS parent FROM groups g LEFT JOIN groups p ON p.id=g.parent_id ORDER BY g.sort, g.name'); }
  groupByName(n) { return this.get('SELECT * FROM groups WHERE name=?', [n]); }
  groupDescendants(id) { const out = [id]; for (const g of this.all('SELECT id FROM groups WHERE parent_id=?', [id])) out.push(...this.groupDescendants(g.id)); return out; }
  groupPrimary(id) { let g = this.get('SELECT * FROM groups WHERE id=?', [id]); while (g && g.parent_id) g = this.get('SELECT * FROM groups WHERE id=?', [g.parent_id]); return g; }
  saveGroup(g) {
    if (!g.name || !g.name.trim()) throw new Error('Group name is required');
    return this.tx(() => {
      const parent = g.parent_id ? this.get('SELECT * FROM groups WHERE id=?', [g.parent_id]) : null;
      const row = { name: g.name.trim(), parent_id: parent ? parent.id : null, nature: parent ? parent.nature : (g.nature || 'A'), direct: parent ? parent.direct : (+g.direct || 0), sort: parent ? parent.sort : 100 };
      if (g.id) { const old = this.get('SELECT * FROM groups WHERE id=?', [g.id]); if (old.is_system) { delete row.parent_id; delete row.nature; delete row.direct; delete row.sort; }
        if (parent && this.groupDescendants(g.id).includes(parent.id)) throw new Error('A group cannot be placed under itself');
        this.update('groups', g.id, row); this.audit('update', 'group', g.id, 'Group ' + row.name, old, row); return g.id; }
      const id = this.insert('groups', row); this.audit('create', 'group', id, 'Group ' + row.name); return id;
    });
  }
  deleteGroup(id) {
    const g = this.get('SELECT * FROM groups WHERE id=?', [id]);
    if (!g) return; if (g.is_system) throw new Error('Pre-defined groups cannot be deleted');
    if (this.val('SELECT COUNT(*) FROM ledgers WHERE group_id=?', [id]) || this.val('SELECT COUNT(*) FROM groups WHERE parent_id=?', [id])) throw new Error('Group has ledgers or sub-groups; move them first');
    this.tx(() => { this.run('DELETE FROM groups WHERE id=?', [id]); this.audit('delete', 'group', id, 'Group ' + g.name, g); });
  }

  // ---------- ledgers ----------
  ledgers(filter = {}) {
    let sql = 'SELECT l.*, g.name AS group_name, g.nature FROM ledgers l JOIN groups g ON g.id=l.group_id';
    const w = [], p = [];
    if (filter.groupName) { const gr = this.groupByName(filter.groupName); const ids = gr ? this.groupDescendants(gr.id) : [-1]; w.push(`l.group_id IN (${ids.join(',')})`); }
    if (filter.groupNames) { let ids = []; for (const n of filter.groupNames) { const gr = this.groupByName(n); if (gr) ids.push(...this.groupDescendants(gr.id)); } w.push(`l.group_id IN (${ids.join(',') || -1})`); }
    if (filter.q) { w.push('(l.name LIKE ? OR l.alias LIKE ? OR l.gstin LIKE ? OR l.phone LIKE ?)'); p.push(...Array(4).fill('%' + filter.q + '%')); }
    if (w.length) sql += ' WHERE ' + w.join(' AND ');
    return this.all(sql + ' ORDER BY l.name', p);
  }
  ledger(id) { return this.get('SELECT l.*, g.name AS group_name, g.nature FROM ledgers l JOIN groups g ON g.id=l.group_id WHERE l.id=?', [id]); }
  ledgerByName(n) { return this.get('SELECT * FROM ledgers WHERE name=?', [n]); }
  ledgerByTax(t) { return this.get('SELECT * FROM ledgers WHERE tax_type=? ORDER BY id LIMIT 1', [t]); }
  isUnder(ledgerId, groupName) { const l = this.get('SELECT group_id FROM ledgers WHERE id=?', [ledgerId]); const g = this.groupByName(groupName); return !!(l && g && this.groupDescendants(g.id).includes(l.group_id)); }
  isParty(ledgerId) { return this.isUnder(ledgerId, 'Sundry Debtors') || this.isUnder(ledgerId, 'Sundry Creditors'); }
  saveLedger(l) {
    if (!l.name || !l.name.trim()) throw new Error('Ledger name is required');
    if (!l.group_id) throw new Error('Select a group for the ledger');
    if (l.gstin) { l.gstin = String(l.gstin).toUpperCase().trim(); if (!U.validGSTIN(l.gstin)) throw new Error('GSTIN ' + l.gstin + ' is not valid (format/checksum)'); if (!l.state_code) l.state_code = l.gstin.slice(0, 2); if (!l.pan) l.pan = l.gstin.slice(2, 12); }
    if (l.pan && !U.PAN_RE.test(String(l.pan).toUpperCase())) throw new Error('PAN must look like ABCDE1234F');
    const row = {}; const cols = ['name','alias','group_id','opening','gstin','state_code','address','city','pincode','phone','email','pan','contact_person','credit_limit','credit_days','bill_wise','tax_type','tax_rate','tds_section','bank_name','bank_acc','ifsc','price_list_id','msme','udyam','gst_reg_type','dep_rate','interest_rate','notes','active'];
    for (const c of cols) if (l[c] !== undefined) row[c] = l[c];
    row.name = row.name.trim(); if (row.pan) row.pan = row.pan.toUpperCase();
    for (const n of ['opening','credit_limit','credit_days','tax_rate','dep_rate','interest_rate']) if (row[n] !== undefined) row[n] = Number(row[n]) || 0;
    if (row.bill_wise === undefined && !l.id) row.bill_wise = (this.groupIsParty(l.group_id)) ? 1 : 0;
    return this.tx(() => {
      if (l.id) { const old = this.ledger(l.id); if (old.is_system) { delete row.tax_type; } this.update('ledgers', l.id, row); this.audit('update', 'ledger', l.id, 'Ledger ' + row.name, old, row); return l.id; }
      row.created_at = this.now(); const id = this.insert('ledgers', row); this.audit('create', 'ledger', id, 'Ledger ' + row.name); return id;
    });
  }
  groupIsParty(gid) { const d = this.groupByName('Sundry Debtors'), c = this.groupByName('Sundry Creditors'); return this.groupDescendants(d.id).includes(+gid) || this.groupDescendants(c.id).includes(+gid); }
  deleteLedger(id) {
    const l = this.ledger(id); if (!l) return;
    if (l.is_system) throw new Error('Pre-defined ledger "' + l.name + '" cannot be deleted');
    const n = this.val('SELECT COUNT(*) FROM entries WHERE ledger_id=?', [id]) + this.val('SELECT COUNT(*) FROM vouchers WHERE party_id=? OR sp_ledger_id=?', [id, id]);
    if (n) throw new Error('Ledger "' + l.name + '" is used in ' + n + ' voucher entries and cannot be deleted');
    this.tx(() => { this.run('DELETE FROM ledgers WHERE id=?', [id]); this.audit('delete', 'ledger', id, 'Ledger ' + l.name, l); });
  }

  // ---------- simple masters ----------
  list(table) {
    const allowed = ['units','item_groups','godowns','price_lists','cost_centres','salesmen','boms','employees','reminders'];
    if (!allowed.includes(table)) throw new Error('Unknown master');
    return this.all(`SELECT * FROM ${table} ORDER BY ${table === 'reminders' ? 'done, due_date' : 'name'}`);
  }
  saveSimple(table, obj) {
    const allowed = { units: ['name','uqc','decimals'], item_groups: ['name','parent_id'], godowns: ['name','address'], price_lists: ['name'], cost_centres: ['name','category'], salesmen: ['name','phone','commission_pct'],
      employees: ['name','designation','doj','pan','uan','esi_no','bank_acc','ifsc','basic','hra','da','other_allow','pf_applicable','esi_applicable','pt','tds','active'],
      reminders: ['due_date','title','notes','ledger_id','done'] };
    if (!allowed[table]) throw new Error('Unknown master');
    const row = {}; for (const c of allowed[table]) if (obj[c] !== undefined) row[c] = obj[c];
    if (table !== 'reminders' && (!row.name || !String(row.name).trim()) && !obj.id) throw new Error('Name is required');
    if (table === 'reminders' && !obj.id && !row.title) throw new Error('Title is required');
    return this.tx(() => {
      if (obj.id) { this.update(table, obj.id, row); this.audit('update', table, obj.id, table + ' ' + (row.name || row.title || obj.id)); return obj.id; }
      if (table === 'reminders') row.created_at = this.now();
      const id = this.insert(table, row); this.audit('create', table, id, table + ' ' + (row.name || row.title)); return id;
    });
  }
  deleteSimple(table, id) {
    const uses = { units: 'SELECT COUNT(*) FROM items WHERE unit_id=?', item_groups: 'SELECT COUNT(*) FROM items WHERE group_id=?', godowns: 'SELECT COUNT(*) FROM vitems WHERE godown_id=?',
      price_lists: 'SELECT COUNT(*) FROM ledgers WHERE price_list_id=?', cost_centres: 'SELECT COUNT(*) FROM entries WHERE cost_centre_id=?', salesmen: 'SELECT COUNT(*) FROM vouchers WHERE salesman_id=?',
      employees: 'SELECT 0', reminders: 'SELECT 0', boms: 'SELECT COUNT(*) FROM vouchers WHERE bom_id=?' };
    if (!uses[table]) throw new Error('Unknown master');
    if (this.val(uses[table], uses[table].includes('?') ? [id] : [])) throw new Error('This entry is in use and cannot be deleted');
    if (table === 'godowns' && this.val('SELECT COUNT(*) FROM godowns') <= 1) throw new Error('At least one godown is required');
    this.tx(() => { this.run(`DELETE FROM ${table} WHERE id=?`, [id]); if (table === 'boms') this.run('DELETE FROM bom_items WHERE bom_id=?', [id]); if (table === 'price_lists') this.run('DELETE FROM price_list_items WHERE price_list_id=?', [id]); this.audit('delete', table, id, table + ' #' + id); });
  }
  priceListItems(plId) { return this.all('SELECT p.*, i.name AS item_name, i.sale_rate FROM price_list_items p JOIN items i ON i.id=p.item_id WHERE p.price_list_id=? ORDER BY i.name', [plId]); }
  savePriceListItems(plId, rows) {
    this.tx(() => { this.run('DELETE FROM price_list_items WHERE price_list_id=?', [plId]);
      for (const r of rows) if (r.item_id && Number(r.rate)) this.run('INSERT INTO price_list_items (price_list_id, item_id, rate, disc_pct) VALUES (?,?,?,?)', [plId, r.item_id, Number(r.rate), Number(r.disc_pct) || 0]);
      this.audit('update', 'price_list', plId, 'Price list items (' + rows.length + ')'); });
  }
  bom(id) { const b = this.get('SELECT * FROM boms WHERE id=?', [id]); if (b) b.items = this.all('SELECT b.*, i.name AS item_name FROM bom_items b JOIN items i ON i.id=b.item_id WHERE bom_id=?', [id]); return b; }
  saveBom(b) {
    if (!b.name || !b.item_id) throw new Error('BOM name and finished item are required');
    const items = (b.items || []).filter(x => x.item_id && Number(x.qty) > 0);
    if (!items.length) throw new Error('Add at least one component');
    if (items.some(x => +x.item_id === +b.item_id)) throw new Error('Finished item cannot be its own component');
    return this.tx(() => {
      let id = b.id; const row = { name: b.name, item_id: b.item_id, qty: Number(b.qty) || 1, notes: b.notes || '' };
      if (id) this.update('boms', id, row); else id = this.insert('boms', row);
      this.run('DELETE FROM bom_items WHERE bom_id=?', [id]);
      for (const x of items) this.run('INSERT INTO bom_items (bom_id, item_id, qty) VALUES (?,?,?)', [id, x.item_id, Number(x.qty)]);
      this.audit(b.id ? 'update' : 'create', 'bom', id, 'BOM ' + b.name); return id;
    });
  }

  // ---------- items ----------
  items(filter = {}) {
    let sql = 'SELECT i.*, g.name AS group_name, u.name AS unit_name FROM items i LEFT JOIN item_groups g ON g.id=i.group_id LEFT JOIN units u ON u.id=i.unit_id';
    const p = []; if (filter.q) { sql += ' WHERE i.name LIKE ? OR i.alias LIKE ? OR i.code LIKE ? OR i.barcode = ? OR i.hsn LIKE ?'; p.push('%' + filter.q + '%', '%' + filter.q + '%', '%' + filter.q + '%', filter.q, filter.q + '%'); }
    return this.all(sql + ' ORDER BY i.name', p);
  }
  item(id) { return this.get('SELECT i.*, u.name AS unit_name FROM items i LEFT JOIN units u ON u.id=i.unit_id WHERE i.id=?', [id]); }
  saveItem(it) {
    if (!it.name || !it.name.trim()) throw new Error('Item name is required');
    const cols = ['name','alias','code','group_id','unit_id','item_type','hsn','gst_rate','cess_rate','sale_rate','purchase_rate','mrp','opening_qty','opening_rate','opening_godown_id','barcode','brand','min_stock','max_stock','batch_wise','description','active'];
    const row = {}; for (const c of cols) if (it[c] !== undefined) row[c] = it[c];
    row.name = row.name.trim();
    for (const n of ['gst_rate','cess_rate','sale_rate','purchase_rate','mrp','opening_qty','opening_rate','min_stock','max_stock']) if (row[n] !== undefined) row[n] = Number(row[n]) || 0;
    if (row.gst_rate !== undefined && ![0, 0.1, 0.25, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40].includes(row.gst_rate)) throw new Error('GST rate ' + row.gst_rate + '% is not a valid GST slab');
    if (row.hsn && !/^[0-9]{4,8}$/.test(String(row.hsn))) throw new Error('HSN/SAC code should be 4 to 8 digits');
    if (row.barcode) { const dup = this.get('SELECT id, name FROM items WHERE barcode=? AND id<>?', [row.barcode, it.id || 0]); if (dup) throw new Error('Barcode already used by item ' + dup.name); }
    return this.tx(() => {
      if (it.id) { const old = this.item(it.id); this.update('items', it.id, row); this.audit('update', 'item', it.id, 'Item ' + row.name, old, row); return it.id; }
      row.created_at = this.now(); if (!row.opening_godown_id) row.opening_godown_id = this.val('SELECT MIN(id) FROM godowns');
      const id = this.insert('items', row); this.audit('create', 'item', id, 'Item ' + row.name); return id;
    });
  }
  deleteItem(id) {
    const it = this.item(id); if (!it) return;
    const n = this.val('SELECT COUNT(*) FROM vitems WHERE item_id=?', [id]) + this.val('SELECT COUNT(*) FROM bom_items WHERE item_id=?', [id]) + this.val('SELECT COUNT(*) FROM boms WHERE item_id=?', [id]);
    if (n) throw new Error('Item "' + it.name + '" is used in ' + n + ' transactions/BOMs and cannot be deleted');
    this.tx(() => { this.run('DELETE FROM items WHERE id=?', [id]); this.run('DELETE FROM price_list_items WHERE item_id=?', [id]); this.audit('delete', 'item', id, 'Item ' + it.name, it); });
  }
  itemInfo(itemId, partyId, date) {
    const it = this.item(itemId); if (!it) return null;
    const val = this.stockValuation(date || '9999-12-31', [itemId])[itemId] || { qty: 0, value: 0, rate: 0 };
    const lastSale = partyId ? this.get(`SELECT vi.rate, v.date, v.number FROM vitems vi JOIN vouchers v ON v.id=vi.voucher_id WHERE vi.item_id=? AND v.party_id=? AND v.vtype='SAL' AND v.status='active' ORDER BY v.date DESC, v.id DESC LIMIT 1`, [itemId, partyId]) : null;
    const lastPur = this.get(`SELECT vi.rate, v.date, v.number, l.name AS party FROM vitems vi JOIN vouchers v ON v.id=vi.voucher_id LEFT JOIN ledgers l ON l.id=v.party_id WHERE vi.item_id=? AND v.vtype='PUR' AND v.status='active' ORDER BY v.date DESC, v.id DESC LIMIT 1`, [itemId]);
    let plRate = null;
    if (partyId) { const p = this.get('SELECT price_list_id FROM ledgers WHERE id=?', [partyId]); if (p && p.price_list_id) plRate = this.get('SELECT rate, disc_pct FROM price_list_items WHERE price_list_id=? AND item_id=?', [p.price_list_id, itemId]); }
    return { item: it, stock: val.qty, avgCost: val.rate, lastSale, lastPur, priceList: plRate };
  }

  // ---------- vouchers ----------
  nextNumber(vtype, date) {
    const fy = U.fyOf(date).label; const prefix = (this.setting('prefix_' + vtype) || '');
    const seq = (this.val('SELECT MAX(seq) FROM vouchers WHERE vtype=? AND fy=?', [vtype, fy]) || 0) + 1;
    return { seq, number: prefix + seq, fy };
  }
  placeIsInter(placeCode) { const cs = this.setting('state_code'); return !!(placeCode && cs && String(placeCode).padStart(2, '0') !== String(cs).padStart(2, '0')); }

  saveVoucher(input) {
    const v = JSON.parse(JSON.stringify(input));
    const T = VTYPES[v.vtype]; if (!T) throw new Error('Unknown voucher type');
    if (!v.date || !/^\d{4}-\d{2}-\d{2}$/.test(v.date)) throw new Error('Voucher date is required');
    const bb = this.setting('books_begin'); if (v.date < bb) throw new Error('Date is before books beginning (' + U.fmtDate(bb) + ')');
    const lock = this.setting('lock_date'); if (lock && v.date <= lock) throw new Error('Books are locked up to ' + U.fmtDate(lock) + '. Change lock date in Company settings.');
    const old = v.id ? this.voucher(v.id) : null;
    if (old && old.date <= (lock || '')) throw new Error('This voucher is in a locked period');
    if (v.id && !old) throw new Error('This voucher was deleted by another user. Close it and refresh.');
    if (old && v.base_rev != null && Number(v.base_rev) !== Number(old.rev || 0)) throw new Error(`This voucher was changed by ${old.updated_by || 'another user'} at ${old.updated_at || 'just now'} while you had it open. Close it, open it again and redo your change (nothing was overwritten).`);
    const status = v.status || 'active';
    const entries = []; let items = [];
    const party = v.party_id ? this.ledger(v.party_id) : null;

    if (T.items) {
      items = (v.items || []).filter(l => l.item_id && (Number(l.qty) || 0) !== 0);
      if (!items.length) throw new Error('Add at least one item line');
      for (const l of items) { const it = this.item(l.item_id); if (!it) throw new Error('Item not found'); l._it = it; if (l.gst_rate === undefined || l.gst_rate === null || l.gst_rate === '') l.gst_rate = it.gst_rate; if (l.cess_rate === undefined) l.cess_rate = it.cess_rate; if (!l.godown_id) l.godown_id = this.val('SELECT MIN(id) FROM godowns'); if (Number(l.qty) < 0) throw new Error('Quantity cannot be negative (use the return voucher instead)'); }
      if (['SAL','PUR','CRN','DBN','SOR','POR','QTN','PFI','DCH','GRN'].includes(v.vtype)) {
        if (!party) throw new Error(v.vtype === 'PUR' || v.vtype === 'DBN' || v.vtype === 'POR' || v.vtype === 'GRN' ? 'Select supplier / party (or Cash)' : 'Select customer / party (or Cash)');
        const pos = v.place_of_supply || party.state_code || this.setting('state_code');
        v.place_of_supply = String(pos).padStart(2, '0');
        v.is_inter = this.placeIsInter(v.place_of_supply) ? 1 : 0;
      }
      const noTax = ['STJ','PRD'].includes(v.vtype) || this.setting('gst_registered') === '0';
      if (v.vtype === 'PRD') this.prepareProduction(v, items);
      const t = calcVoucher({ items, is_inter: v.is_inter, tax_inclusive: v.tax_inclusive, bill_disc_pct: v.bill_disc_pct }, { noTax, roundOff: this.setting('round_off') !== '0' && !['STJ','PRD'].includes(v.vtype), manualRound: v.manual_round });
      Object.assign(v, { gross: t.gross, discount: t.discount, taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, cess: t.cess, round_off: t.round_off, total: t.total });
      if (['STJ','PRD'].includes(v.vtype)) { v.total = r2(items.filter(l => +l.direction > 0).reduce((s, l) => s + r2(l.qty * l.rate), 0)); for (const l of items) { if (!+l.direction) throw new Error('Each stock journal line must be marked In or Out'); l.amount = r2(l.qty * l.rate); l.taxable = l.amount; } }

      if (T.accounting) {
        const sp = v.sp_ledger_id ? this.ledger(v.sp_ledger_id) : this.ledgerByName({ SAL: 'Sales Account', CRN: 'Sales Return', PUR: 'Purchase Account', DBN: 'Purchase Return' }[v.vtype]);
        v.sp_ledger_id = sp.id;
        const sign = (v.vtype === 'SAL' || v.vtype === 'DBN') ? 1 : -1; // +1: party Dr
        const isSaleSide = T.side === 'sale';
        const tl = k => this.ledgerByTax(k + (isSaleSide ? '_OUT' : '_IN'));
        const rcm = v.vtype === 'PUR' || v.vtype === 'DBN' ? !!+v.rcm : false;
        const partyAmt = rcm ? r2(v.taxable + v.round_off) : v.total;
        const push = (lid, amt) => { amt = r2(amt); if (!amt) return; entries.push({ ledger_id: lid, dr: amt > 0 ? amt : 0, cr: amt < 0 ? -amt : 0 }); };
        push(party.id, sign * partyAmt);
        push(sp.id, -sign * v.taxable);
        if (v.cgst) push(tl('CGST').id, -sign * v.cgst);
        if (v.sgst) push(tl('SGST').id, -sign * v.sgst);
        if (v.igst) push(tl('IGST').id, -sign * v.igst);
        if (v.cess) push(tl('CESS').id, -sign * v.cess);
        if (rcm) push(this.ledgerByTax('RCM').id, sign * (v.cgst + v.sgst + v.igst + v.cess));
        if (v.round_off) push(this.ledgerByTax('ROUND').id, -sign * v.round_off);
        if (v.cost_centre_id) for (const e of entries) if (e.ledger_id === sp.id) e.cost_centre_id = v.cost_centre_id;
      }
    } else {
      const lines = (v.lines || []).filter(l => l.ledger_id && (Number(l.dr) || Number(l.cr)));
      if (lines.length < 2) throw new Error('Enter at least one debit and one credit line');
      for (const l of lines) { l.dr = r2(Number(l.dr) || 0); l.cr = r2(Number(l.cr) || 0); if (l.dr < 0 || l.cr < 0) throw new Error('Amounts cannot be negative'); if (l.dr && l.cr) throw new Error('A line cannot have both debit and credit'); }
      if (v.vtype === 'CNT') for (const l of lines) if (!this.isUnder(l.ledger_id, 'Cash-in-Hand') && !this.isUnder(l.ledger_id, 'Bank Accounts') && !this.isUnder(l.ledger_id, 'Bank OD A/c')) throw new Error('Contra voucher can only use Cash and Bank ledgers');
      if (v.vtype === 'RCT' && !lines.some(l => l.dr && this.isCashBank(l.ledger_id))) throw new Error('Receipt must debit a Cash or Bank ledger');
      if (v.vtype === 'PMT' && !lines.some(l => l.cr && this.isCashBank(l.ledger_id))) throw new Error('Payment must credit a Cash or Bank ledger');
      for (const l of lines) entries.push({ ledger_id: +l.ledger_id, dr: l.dr, cr: l.cr, cost_centre_id: l.cost_centre_id || null, line_narr: l.line_narr || null, bill: l.bill, bank_date: l.bank_date || null });
      v.total = r2(lines.reduce((s, l) => s + l.dr, 0));
      if (!v.party_id) { const pl = lines.find(l => this.isParty(l.ledger_id)) || lines.find(l => !this.isCashBank(l.ledger_id)); v.party_id = pl ? +pl.ledger_id : null; }
    }
    if (T.accounting) {
      const dr = r2(entries.reduce((s, e) => s + e.dr, 0)), cr = r2(entries.reduce((s, e) => s + e.cr, 0));
      if (Math.abs(dr - cr) > 0.005) throw new Error(`Debit (${U.inr(dr)}) and Credit (${U.inr(cr)}) totals do not match`);
    }
    // credit limit check (warning returned)
    const warnings = [];
    if (v.vtype === 'SAL' && party && party.credit_limit > 0) {
      const bal = this.ledgerBalance(party.id, '9999-12-31') - (old ? old.total : 0) + v.total;
      if (bal > party.credit_limit) warnings.push(`Credit limit of ${party.name} (₹${U.inr(party.credit_limit)}) exceeded: balance will be ₹${U.inr(bal)}`);
    }

    const fyInfo = U.fyOf(v.date);
    let id;
    this.tx(() => {
      const row = {
        vtype: v.vtype, date: v.date, party_id: v.party_id || null, sp_ledger_id: v.sp_ledger_id || null, place_of_supply: v.place_of_supply || null, is_inter: v.is_inter ? 1 : 0,
        ref_no: v.ref_no || null, ref_date: v.ref_date || null, narration: v.narration || null, gross: v.gross || 0, discount: v.discount || 0, taxable: v.taxable || 0,
        cgst: v.cgst || 0, sgst: v.sgst || 0, igst: v.igst || 0, cess: v.cess || 0, round_off: v.round_off || 0, total: v.total || 0, bill_disc_pct: Number(v.bill_disc_pct) || 0,
        tax_inclusive: v.tax_inclusive ? 1 : 0, rcm: v.rcm ? 1 : 0, status, due_date: v.due_date || (party && party.credit_days && ['SAL','PUR'].includes(v.vtype) ? U.addDays(v.date, party.credit_days) : null),
        salesman_id: v.salesman_id || null, cost_centre_id: v.cost_centre_id || null, orig_ref: v.orig_ref || null, linked_id: v.linked_id || null,
        cheque_no: v.cheque_no || null, cheque_date: v.cheque_date || null, pay_mode: v.pay_mode || null, transport: v.transport || null, vehicle_no: v.vehicle_no || null,
        distance: Number(v.distance) || null, eway_no: v.eway_no || null, buyer_name: v.buyer_name || null, buyer_gstin: v.buyer_gstin || null, buyer_address: v.buyer_address || null,
        ship_to: v.ship_to || null, bom_id: v.bom_id || null, attachment: v.attachment || null, extra: v.extra ? JSON.stringify(v.extra) : null,
      };
      if (old) {
        if (old.fy !== fyInfo.label || v.number !== old.number) { if (v.number && v.number !== old.number) { this.checkDupNumber(v.vtype, fyInfo.label, v.number, old.id); row.number = v.number; } }
        if (old.fy !== fyInfo.label) { const n = this.nextNumber(v.vtype, v.date); row.fy = n.fy; row.seq = n.seq; if (!v.number || v.number === old.number) row.number = n.number; }
        row.updated_by = this.user; row.updated_at = this.now(); row.rev = Number(old.rev || 0) + 1;
        this.update('vouchers', old.id, row);
        id = old.id;
        this.run('DELETE FROM entries WHERE voucher_id=?', [id]); this.run('DELETE FROM vitems WHERE voucher_id=?', [id]); this.run('DELETE FROM bill_refs WHERE voucher_id=?', [id]);
      } else {
        const n = this.nextNumber(v.vtype, v.date);
        if (v.number && v.number !== n.number) { this.checkDupNumber(v.vtype, n.fy, v.number, 0); row.number = v.number; } else row.number = n.number;
        Object.assign(row, { fy: n.fy, seq: n.seq, created_by: this.user, created_at: this.now() });
        id = this.insert('vouchers', row);
      }
      items.forEach((l, i) => {
        const dir = T.stock === 2 ? Math.sign(+l.direction) : T.stock;
        this.insert('vitems', { voucher_id: id, item_id: +l.item_id, qty: Number(l.qty), rate: Number(l.rate) || 0, disc_pct: Number(l.disc_pct) || 0, disc_amt: l.disc_amt || 0, taxable: l.taxable || 0,
          gst_rate: Number(l.gst_rate) || 0, cgst: l.cgst || 0, sgst: l.sgst || 0, igst: l.igst || 0, cess: l.cess || 0, amount: l.amount || 0, godown_id: l.godown_id || null,
          batch_no: l.batch_no || null, mfg_date: l.mfg_date || null, exp_date: l.exp_date || null, descr: l.descr || null, direction: dir, cost: Number(l.cost) || 0, sort: i });
      });
      entries.forEach((e, i) => {
        this.insert('entries', { voucher_id: id, ledger_id: e.ledger_id, dr: e.dr, cr: e.cr, cost_centre_id: e.cost_centre_id || null, line_narr: e.line_narr || null, bank_date: e.bank_date || null, sort: i });
      });
      // bill-wise references
      if (status === 'active' && T.accounting) {
        if (['SAL','PUR','CRN','DBN'].includes(v.vtype) && party && party.bill_wise) {
          const pe = entries.find(e => e.ledger_id === party.id); const amt = r2(pe.dr - pe.cr);
          const vno = this.val('SELECT number FROM vouchers WHERE id=?', [id]);
          const refName = (v.vtype === 'PUR') ? (v.ref_no || vno) : vno;
          if ((v.vtype === 'CRN' || v.vtype === 'DBN') && v.orig_ref) this.insert('bill_refs', { voucher_id: id, ledger_id: party.id, ref_type: 'agst', ref_name: v.orig_ref, amount: amt, date: v.date });
          else this.insert('bill_refs', { voucher_id: id, ledger_id: party.id, ref_type: 'new', ref_name: refName, amount: amt, date: v.date, due_date: row.due_date || v.date });
        }
        if (!T.items) for (const e of entries) {
          const led = this.get('SELECT bill_wise FROM ledgers WHERE id=?', [e.ledger_id]);
          if (!led || !led.bill_wise) continue;
          const b = e.bill || { type: 'onacc' }; const amt = r2(e.dr - e.cr);
          const vno = this.val('SELECT number FROM vouchers WHERE id=?', [id]);
          if (Array.isArray(b.allocs) && b.allocs.length) {
            let rem = amt; for (const a of b.allocs) { const aa = r2(Math.sign(amt) * Math.abs(Number(a.amount) || 0)); if (!aa) continue; this.insert('bill_refs', { voucher_id: id, ledger_id: e.ledger_id, ref_type: 'agst', ref_name: a.ref, amount: aa, date: v.date }); rem = r2(rem - aa); }
            if (Math.abs(rem) > 0.005) this.insert('bill_refs', { voucher_id: id, ledger_id: e.ledger_id, ref_type: 'onacc', ref_name: 'On Account', amount: rem, date: v.date });
          } else {
            const type = b.type || 'onacc';
            const name = type === 'agst' ? b.ref : type === 'new' ? (b.ref || vno) : type === 'advance' ? (b.ref || 'Adv-' + vno) : 'On Account';
            this.insert('bill_refs', { voucher_id: id, ledger_id: e.ledger_id, ref_type: type === 'advance' ? 'new' : type, ref_name: name, amount: amt, date: v.date, due_date: v.date });
          }
        }
      }
      const saved = this.voucher(id);
      this.audit(old ? 'update' : 'create', 'voucher', id, `${T.name} ${saved.number} dt ${U.fmtDate(v.date)} ₹${U.inr(saved.total)}`, old ? this.slim(old) : null, this.slim(saved));
    });
    return { id, number: this.val('SELECT number FROM vouchers WHERE id=?', [id]), rev: this.val('SELECT rev FROM vouchers WHERE id=?', [id]) || 0, warnings };
  }
  slim(v) { return { vtype: v.vtype, number: v.number, date: v.date, party: v.party_name, total: v.total, status: v.status, narration: v.narration, entries: (v.entries || []).map(e => [e.ledger_name, e.dr, e.cr]), items: (v.items || []).map(i => [i.item_name, i.qty, i.rate]) }; }
  checkDupNumber(vtype, fy, number, exceptId) { if (this.val('SELECT COUNT(*) FROM vouchers WHERE vtype=? AND fy=? AND number=? AND id<>?', [vtype, fy, number, exceptId])) throw new Error('Voucher number ' + number + ' already exists in this year'); }
  isCashBank(lid) { return this.isUnder(lid, 'Cash-in-Hand') || this.isUnder(lid, 'Bank Accounts') || this.isUnder(lid, 'Bank OD A/c'); }
  prepareProduction(v, items) {
    // finished line(s) direction +1, components -1. Cost finished = sum component cost
    const val = this.stockValuation(v.date);
    let cost = 0;
    for (const l of items) if (+l.direction < 0) { const r = (val[l.item_id] && val[l.item_id].rate) || l._it.purchase_rate || 0; l.rate = r2(r); cost += r2(l.qty * l.rate); }
    const fin = items.filter(l => +l.direction > 0); const fq = fin.reduce((s, l) => s + Number(l.qty), 0);
    for (const l of fin) l.rate = fq ? r2(cost / fq) : 0;
  }
  voucher(id) {
    const v = this.get(`SELECT v.*, p.name AS party_name, p.gstin AS party_gstin, p.state_code AS party_state, p.address AS party_address, p.city AS party_city, p.pincode AS party_pincode, p.phone AS party_phone, p.pan AS party_pan, p.email AS party_email, s.name AS sp_name, sm.name AS salesman_name, cc.name AS cost_centre_name
      FROM vouchers v LEFT JOIN ledgers p ON p.id=v.party_id LEFT JOIN ledgers s ON s.id=v.sp_ledger_id LEFT JOIN salesmen sm ON sm.id=v.salesman_id LEFT JOIN cost_centres cc ON cc.id=v.cost_centre_id WHERE v.id=?`, [id]);
    if (!v) return null;
    v.items = this.all('SELECT vi.*, i.name AS item_name, i.hsn, i.item_type, u.name AS unit_name, u.uqc, g.name AS godown_name, i.cess_rate FROM vitems vi JOIN items i ON i.id=vi.item_id LEFT JOIN units u ON u.id=i.unit_id LEFT JOIN godowns g ON g.id=vi.godown_id WHERE vi.voucher_id=? ORDER BY vi.sort', [id]);
    v.entries = this.all('SELECT e.*, l.name AS ledger_name FROM entries e JOIN ledgers l ON l.id=e.ledger_id WHERE e.voucher_id=? ORDER BY e.sort', [id]);
    v.bills = this.all('SELECT * FROM bill_refs WHERE voucher_id=?', [id]);
    for (const e of v.entries) { const b = v.bills.filter(b => b.ledger_id === e.ledger_id); if (b.length) e.bill = b.length === 1 ? { type: b[0].ref_type, ref: b[0].ref_name } : { allocs: b.filter(x => x.ref_type === 'agst').map(x => ({ ref: x.ref_name, amount: Math.abs(x.amount) })) }; }
    v.extra = v.extra ? JSON.parse(v.extra) : null;
    v.vtype_name = VTYPES[v.vtype].name;
    return v;
  }
  deleteVoucher(id) {
    const v = this.voucher(id); if (!v) return;
    const lock = this.setting('lock_date'); if (lock && v.date <= lock) throw new Error('This voucher is in a locked period');
    this.tx(() => { this.run('DELETE FROM entries WHERE voucher_id=?', [id]); this.run('DELETE FROM vitems WHERE voucher_id=?', [id]); this.run('DELETE FROM bill_refs WHERE voucher_id=?', [id]); this.run('DELETE FROM vouchers WHERE id=?', [id]);
      this.audit('delete', 'voucher', id, `${v.vtype_name} ${v.number} dt ${U.fmtDate(v.date)} ₹${U.inr(v.total)} deleted`, this.slim(v)); });
  }
  setVoucherStatus(id, status) {
    if (!['active','cancelled','optional'].includes(status)) throw new Error('Bad status');
    const v = this.voucher(id); if (!v) throw new Error('Voucher not found');
    const lock = this.setting('lock_date'); if (lock && v.date <= lock) throw new Error('This voucher is in a locked period');
    const inp = this.voucherToInput(v); inp.status = status; inp.id = id;
    if (status === 'cancelled') { this.tx(() => { this.run('UPDATE vouchers SET status=?, updated_by=?, updated_at=? WHERE id=?', ['cancelled', this.user, this.now(), id]); this.run('DELETE FROM bill_refs WHERE voucher_id=?', [id]); this.audit('cancel', 'voucher', id, `${v.vtype_name} ${v.number} cancelled`, this.slim(v)); }); return { id }; }
    return this.saveVoucher(inp);
  }
  voucherToInput(v) {
    return { id: v.id, vtype: v.vtype, date: v.date, number: v.number, party_id: v.party_id, sp_ledger_id: v.sp_ledger_id, place_of_supply: v.place_of_supply, ref_no: v.ref_no, ref_date: v.ref_date, narration: v.narration,
      bill_disc_pct: v.bill_disc_pct, tax_inclusive: v.tax_inclusive, rcm: v.rcm, status: v.status, due_date: v.due_date, salesman_id: v.salesman_id, cost_centre_id: v.cost_centre_id, orig_ref: v.orig_ref, linked_id: v.linked_id,
      cheque_no: v.cheque_no, cheque_date: v.cheque_date, pay_mode: v.pay_mode, transport: v.transport, vehicle_no: v.vehicle_no, distance: v.distance, eway_no: v.eway_no, buyer_name: v.buyer_name, ship_to: v.ship_to, bom_id: v.bom_id, extra: v.extra, attachment: v.attachment,
      manual_round: undefined,
      items: v.items.map(i => ({ item_id: i.item_id, qty: i.qty, rate: i.tax_inclusive ? i.rate : i.rate, disc_pct: i.disc_pct, disc_amt: i.disc_pct ? undefined : i.disc_amt, gst_rate: i.gst_rate, cess_rate: i.cess_rate, godown_id: i.godown_id, batch_no: i.batch_no, mfg_date: i.mfg_date, exp_date: i.exp_date, descr: i.descr, direction: i.direction, cost: i.cost })),
      lines: VTYPES[v.vtype].items ? [] : v.entries.map(e => ({ ledger_id: e.ledger_id, dr: e.dr, cr: e.cr, cost_centre_id: e.cost_centre_id, line_narr: e.line_narr, bill: e.bill, bank_date: e.bank_date })) };
  }
  duplicateVoucher(id, date) {
    const v = this.voucher(id); const inp = this.voucherToInput(v);
    delete inp.id; delete inp.number; inp.date = date || v.date; inp.status = 'active';
    if (inp.lines) for (const l of inp.lines) { if (l.bill && l.bill.type === 'agst') l.bill = { type: 'onacc' }; if (l.bill && l.bill.allocs) l.bill = { type: 'onacc' }; l.bank_date = null; }
    return this.saveVoucher(inp);
  }
  convertVoucher(id, toType) {
    const v = this.voucher(id); const inp = this.voucherToInput(v);
    delete inp.id; delete inp.number; inp.vtype = toType; inp.linked_id = id; inp.sp_ledger_id = null; inp.date = U.today() < v.date ? v.date : U.today();
    inp.narration = (v.narration ? v.narration + ' | ' : '') + 'Against ' + v.vtype_name + ' ' + v.number;
    return inp; // returned for editing on screen
  }
  vouchers(f = {}) {
    const w = ['1=1'], p = [];
    if (f.from) { w.push('v.date>=?'); p.push(f.from); } if (f.to) { w.push('v.date<=?'); p.push(f.to); }
    if (f.vtype) { const ts = String(f.vtype).split(','); w.push(`v.vtype IN (${ts.map(() => '?').join(',')})`); p.push(...ts); }
    if (f.party_id) { w.push('v.party_id=?'); p.push(f.party_id); }
    if (f.status) { w.push('v.status=?'); p.push(f.status); }
    if (f.q) { w.push('(v.number LIKE ? OR p.name LIKE ? OR v.narration LIKE ? OR v.ref_no LIKE ? OR CAST(v.total AS TEXT) LIKE ?)'); p.push(...Array(5).fill('%' + f.q + '%')); }
    return this.all(`SELECT v.id, v.vtype, v.number, v.date, v.total, v.taxable, v.cgst+v.sgst+v.igst+v.cess AS tax, v.status, v.narration, v.ref_no, p.name AS party_name, v.created_by
      FROM vouchers v LEFT JOIN ledgers p ON p.id=v.party_id WHERE ${w.join(' AND ')} ORDER BY v.date, v.id LIMIT ${Number(f.limit) || 5000}`, p);
  }
  pendingOrders(vtype, partyId) {
    const linkedFrom = this.all('SELECT linked_id FROM vouchers WHERE linked_id IS NOT NULL').map(r => r.linked_id);
    return this.all(`SELECT v.id, v.number, v.date, v.total, p.name AS party_name FROM vouchers v LEFT JOIN ledgers p ON p.id=v.party_id WHERE v.vtype=? AND v.status='active' ${partyId ? 'AND v.party_id=' + (+partyId) : ''} ORDER BY v.date`, [vtype])
      .filter(r => !linkedFrom.includes(r.id));
  }

  // ---------- balances ----------
  ledgerBalance(lid, to, from) {
    const l = this.get('SELECT opening FROM ledgers WHERE id=?', [lid]); if (!l) return 0;
    const m = this.get(`SELECT COALESCE(SUM(e.dr),0) AS dr, COALESCE(SUM(e.cr),0) AS cr FROM entries e JOIN vouchers v ON v.id=e.voucher_id WHERE e.ledger_id=? AND v.status='active' AND v.date<=? ${from ? 'AND v.date>=?' : ''}`, from ? [lid, to, from] : [lid, to]);
    return r2((from ? 0 : l.opening) + m.dr - m.cr);
  }
  pendingBills(lid, asOf) {
    asOf = asOf || '9999-12-31';
    const l = this.ledger(lid); if (!l) return [];
    const rows = this.all(`SELECT b.ref_name, b.ref_type, b.amount, COALESCE(b.date, v.date) AS date, b.due_date FROM bill_refs b LEFT JOIN vouchers v ON v.id=b.voucher_id WHERE b.ledger_id=? AND (v.id IS NULL OR (v.status='active' AND v.date<=?)) ORDER BY date`, [lid, asOf]);
    const map = new Map();
    if (l.opening && l.bill_wise) map.set('Opening Balance', { ref: 'Opening Balance', date: this.setting('books_begin'), due: this.setting('books_begin'), amount: l.opening, billAmount: l.opening });
    let onacc = 0, onaccDate = '';
    for (const r of rows) {
      if (r.ref_type === 'onacc') { onacc = r2(onacc + r.amount); if (r.date && r.date > onaccDate) onaccDate = r.date; continue; }
      let b = map.get(r.ref_name);
      if (!b) { b = { ref: r.ref_name, date: r.date, due: r.due_date || r.date, amount: 0, billAmount: 0 }; map.set(r.ref_name, b); }
      if (r.ref_type === 'new') { b.billAmount = r2(b.billAmount + r.amount); if (r.date < b.date) b.date = r.date; if (r.due_date) b.due = r.due_date; }
      b.amount = r2(b.amount + r.amount);
    }
    const out = [...map.values()].filter(b => Math.abs(b.amount) > 0.005);
    if (Math.abs(onacc) > 0.005) out.push({ ref: 'On Account', date: onaccDate, due: '', amount: onacc, billAmount: onacc, onacc: true });
    return out;
  }
}
module.exports = { Company, VTYPES };
