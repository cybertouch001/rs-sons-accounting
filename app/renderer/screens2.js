
// R&S Sons Accounting - screens: items, other masters, company, users, utilities, payroll
'use strict';
const GST_RATES = [0, 0.1, 0.25, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40];
SCREENS.itemList = async (el) => {
  const c = await loadCache(true);
  const val = await C('stockValuation', APP.date);
  listScreen(el, { title: 'Stock Items', rows: c.items.map(i => ({ ...i, stock: val[i.id] ? val[i.id].qty : 0 })), onNew: () => go('itemEdit', {}), onOpen: r => go('itemEdit', { id: r.id }),
    cols: [{ k: 'name', label: 'Item' }, { k: 'group_name', label: 'Group' }, { k: 'hsn', label: 'HSN/SAC' }, { k: 'gst_rate', label: 'GST %', r: 1 }, { k: 'unit_name', label: 'Unit' }, { k: 'sale_rate', label: 'Sale Rate', r: 1, f: r => inr(r.sale_rate) }, { k: 'mrp', label: 'MRP', r: 1, f: r => r.mrp ? inr(r.mrp) : '' }, { k: 'stock', label: 'Stock', r: 1, f: r => r.item_type === 'Service' ? '<span class="pill grey">service</span>' : `<span class="${r.stock < (r.min_stock || 0) ? 'neg' : ''}">${U.r3(r.stock)}</span>` }, { k: 'barcode', label: 'Barcode' }],
    searchKeys: ['name', 'group_name', 'hsn', 'barcode', 'code', 'alias', 'brand'], extra: '<button class="btn" id="ilab">Barcode Labels</button><button class="btn" id="ist">Stock Summary</button>' });
  $('#ilab').onclick = () => go('labels'); $('#ist').onclick = () => go('report', { r: 'stockSummary' });
};
SCREENS.itemEdit = async (el, p) => {
  const c = await loadCache(); const it = p.id ? await C('item', p.id) : { unit_id: (c.units.find(u => u.name === 'Nos') || {}).id, group_id: (c.igroups[0] || {}).id, gst_rate: 18, item_type: 'Goods' };
  const fields = [
    { section: 'Item' }, { k: 'name', label: 'Item Name', req: true, w: 2 }, { k: 'alias', label: 'Alias / Print name' }, { k: 'code', label: 'Item Code / SKU' },
    { k: 'item_type', label: 'Type', type: 'select', options: [['Goods', 'Goods (stock maintained)'], ['Service', 'Service / non-inventory']] }, { k: 'group_id', label: 'Item Group', type: 'select', options: c.igroups.map(x => [x.id, x.name]) },
    { k: 'unit_id', label: 'Unit', type: 'select', options: c.units.map(x => [x.id, x.name + (x.uqc ? ' (' + x.uqc + ')' : '')]) }, { k: 'brand', label: 'Brand' },
    { section: 'GST' }, { k: 'hsn', label: 'HSN / SAC Code', help: '4–8 digits' }, { k: 'gst_rate', label: 'GST Rate %', type: 'select', options: GST_RATES.map(r => [r, r + '%']) }, { k: 'cess_rate', label: 'Cess %', type: 'number' }, { k: 'barcode', label: 'Barcode (EAN/UPC)' },
    { section: 'Rates' }, { k: 'sale_rate', label: 'Sale Rate (excl. GST)', type: 'number' }, { k: 'purchase_rate', label: 'Purchase Rate', type: 'number' }, { k: 'mrp', label: 'MRP', type: 'number' }, { k: 'margin', label: 'Sale rate = purchase + margin %', type: 'number', help: 'Optional helper' },
    { section: 'Stock' }, { k: 'opening_qty', label: 'Opening Qty', type: 'number' }, { k: 'opening_rate', label: 'Opening Rate', type: 'number' }, { k: 'opening_godown_id', label: 'Opening Godown', type: 'select', options: c.godowns.map(x => [x.id, x.name]) }, { k: 'batch_wise', label: 'Track batch / expiry', type: 'check' },
    { k: 'min_stock', label: 'Minimum / Reorder Level', type: 'number' }, { k: 'max_stock', label: 'Maximum Level', type: 'number' }, { k: 'description', label: 'Description (prints on invoice)', w: 2 },
  ];
  el.innerHTML = `<h2 class="title">${p.id ? 'Alter' : 'Create'} Stock Item</h2><div class="card"><div class="form">${formHtml(fields, it)}</div></div>
   <div class="actions">${p.id ? `<button class="btn" id="ild">Item Ledger</button>${can('admin') ? '<button class="btn danger" id="idel">Delete</button>' : ''}` : ''}<span style="flex:1"></span><button class="btn" id="ic">Cancel</button><button class="btn primary" id="is">Save <kbd>Ctrl+S</kbd></button></div>`;
  bindForm(el, fields, it);
  $('#f_margin').onchange = () => { const m = Number($('#f_margin').value), pr = Number($('#f_purchase_rate').value); if (m && pr) $('#f_sale_rate').value = U.r2(pr * (1 + m / 100)); };
  $$('input,select', el).forEach(x => x.addEventListener('input', () => APP.current.dirty = true));
  const save = async () => { try { const v = readForm(el, fields); delete v.margin; v.gst_rate = Number(v.gst_rate); if (p.id) v.id = p.id; const id = await C('saveItem', v); toast('Item saved', 'ok'); APP.current.dirty = false; await loadCache(true); if (p.onSaved) p.onSaved(id); back(); } catch (e) { fail(e); } };
  $('#is').onclick = save; $('#ic').onclick = back;
  if ($('#idel')) $('#idel').onclick = async () => { if (await confirmBox('Delete item?', 'Delete', true)) { try { await C('deleteItem', p.id); await loadCache(true); APP.current.dirty = false; back(); } catch (e) { fail(e); } } };
  if ($('#ild')) $('#ild').onclick = () => go('report', { r: 'itemLedger', a: { item_id: p.id } });
  APP.current.keys = e => { if (e.ctrlKey && e.key.toLowerCase() === 's') { save(); return true; } }; $('#f_name').focus();
};

// ---------- simple masters ----------
const SIMPLE = {
  units: { title: 'Units of Measure', fields: [{ k: 'name', label: 'Unit Name', req: true }, { k: 'uqc', label: 'GST UQC', type: 'select', options: ['NOS', 'PCS', 'KGS', 'GMS', 'LTR', 'MLT', 'MTR', 'BOX', 'DOZ', 'PAC', 'SET', 'BAG', 'BTL', 'CTN', 'QTL', 'TON', 'SQM', 'SQF', 'UNT', 'OTH'] }, { k: 'decimals', label: 'Decimal places', type: 'number' }], cols: [{ k: 'name', label: 'Unit' }, { k: 'uqc', label: 'UQC' }, { k: 'decimals', label: 'Decimals', r: 1 }] },
  item_groups: { title: 'Item Groups', fields: [{ k: 'name', label: 'Group Name', req: true, w: 2 }], cols: [{ k: 'name', label: 'Item Group' }] },
  godowns: { title: 'Godowns / Locations', fields: [{ k: 'name', label: 'Godown Name', req: true, w: 2 }, { k: 'address', label: 'Address', w: 2 }], cols: [{ k: 'name', label: 'Godown' }, { k: 'address', label: 'Address' }] },
  price_lists: { title: 'Price Lists', fields: [{ k: 'name', label: 'Price List Name', req: true, w: 2 }], cols: [{ k: 'name', label: 'Price List' }], note: 'Open a price list to set item rates. Assign it to customers in their ledger.' },
  cost_centres: { title: 'Cost Centres', fields: [{ k: 'name', label: 'Cost Centre', req: true }, { k: 'category', label: 'Category', help: 'e.g. Department, Project' }], cols: [{ k: 'name', label: 'Cost Centre' }, { k: 'category', label: 'Category' }] },
  salesmen: { title: 'Salesmen / Agents', fields: [{ k: 'name', label: 'Name', req: true }, { k: 'phone', label: 'Phone' }, { k: 'commission_pct', label: 'Commission %', type: 'number' }], cols: [{ k: 'name', label: 'Name' }, { k: 'phone', label: 'Phone' }, { k: 'commission_pct', label: 'Commission %', r: 1 }] },
  boms: { title: 'Bill of Materials', cols: [{ k: 'name', label: 'BOM' }, { k: 'qty', label: 'Output Qty', r: 1 }, { k: 'notes', label: 'Notes' }] },
};
SCREENS.simpleList = async (el, p) => {
  const cfg = SIMPLE[p.t]; await loadCache(true); const rows = await C('list', p.t);
  const open = async (r) => {
    if (p.t === 'boms') return go('bomEdit', { id: r && r.id });
    if (p.t === 'price_lists' && r) return go('priceListEdit', { id: r.id, name: r.name });
    const v = await promptBox((r ? 'Alter ' : 'Create ') + cfg.title.replace(/s$/, ''), cfg.fields, r || {});
    if (!v) return; try { if (r) v.id = r.id; await C('saveSimple', p.t, v); toast('Saved', 'ok'); render(); } catch (e) { fail(e); }
  };
  listScreen(el, { title: cfg.title, rows, cols: cfg.cols, onNew: () => open(null), onOpen: open, extra: cfg.note ? `<span style="color:var(--muted);font-size:12px">${esc(cfg.note)}</span>` : '' });
  if (can('admin')) { $('.toolbar', el).insertAdjacentHTML('beforeend', '<button class="btn danger" id="sdel">Delete selected</button>'); $('#sdel').onclick = async () => { const tr = $('#lb tr.cur'); if (!tr) return; const r = rows.filter(x => true)[+tr.dataset.i]; if (r && await confirmBox('Delete "' + r.name + '"?', 'Delete', true)) { try { await C('deleteSimple', p.t, r.id); render(); } catch (e) { fail(e); } } }; }
};
SCREENS.priceListEdit = async (el, p) => {
  const c = await loadCache(true); const cur = await C('priceListItems', p.id); const map = Object.fromEntries(cur.map(x => [x.item_id, x]));
  el.innerHTML = `<h2 class="title">Price List: ${esc(p.name)}</h2><div class="toolbar"><input id="pls" placeholder="Search item"><span class="sp"></span><button class="btn primary" id="pls2">Save <kbd>Ctrl+S</kbd></button></div>
   <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Item</th><th class="r">Standard Rate</th><th class="r">Price-list Rate</th><th class="r">Discount %</th></tr></thead><tbody>${c.items.map(i => `<tr data-n="${esc(i.name.toLowerCase())}"><td>${esc(i.name)}</td><td class="r">${inr(i.sale_rate)}</td><td class="r"><input class="num" style="width:110px;text-align:right" data-i="${i.id}" data-f="rate" value="${map[i.id] ? map[i.id].rate : ''}"></td><td class="r"><input style="width:70px;text-align:right" data-i="${i.id}" data-f="disc" value="${map[i.id] ? map[i.id].disc_pct || '' : ''}"></td></tr>`).join('')}</tbody></table></div>`;
  $('#pls').oninput = () => { const q = $('#pls').value.toLowerCase(); $$('tbody tr', el).forEach(t => t.classList.toggle('hidden', !t.dataset.n.includes(q))); };
  const save = async () => { const rows = c.items.map(i => ({ item_id: i.id, rate: $(`input[data-i="${i.id}"][data-f=rate]`, el).value, disc_pct: $(`input[data-i="${i.id}"][data-f=disc]`, el).value })).filter(r => Number(r.rate)); try { await C('savePriceListItems', p.id, rows); toast('Price list saved (' + rows.length + ' items)', 'ok'); back(); } catch (e) { fail(e); } };
  $('#pls2').onclick = save; APP.current.keys = e => { if (e.ctrlKey && e.key.toLowerCase() === 's') { save(); return true; } };
};
SCREENS.bomEdit = async (el, p) => {
  const c = await loadCache(true); const b = p.id ? await C('bom', p.id) : { qty: 1, items: [] };
  const lines = (b.items || []).map(x => ({ ...x })); while (lines.length < 6) lines.push({});
  el.innerHTML = `<h2 class="title">${p.id ? 'Alter' : 'Create'} Bill of Materials</h2><div class="card"><div class="form"><div class="fld w2"><label>BOM Name *</label><input id="bn" value="${esc(b.name || '')}"></div><div class="fld"><label>Finished Item *</label><input id="bi" data-combo="1"></div><div class="fld"><label>Output Qty</label><input id="bq" type="number" value="${b.qty}"></div></div>
   <table class="grid" style="margin-top:8px"><tr><th>Component (raw material)</th><th style="width:140px">Qty per output</th></tr>${lines.map((l, i) => `<tr><td class="cell"><input data-i="${i}" class="bci" data-combo="1"></td><td class="cell"><input class="num bcq" data-i="${i}" type="number" value="${l.qty || ''}"></td></tr>`).join('')}</table></div>
   <div class="actions"><button class="btn" id="bc">Cancel</button><button class="btn primary" id="bs">Save</button></div>`;
  combo($('#bi'), { source: itemSrc() }); if (b.item_id) { const it = c.items.find(i => i.id === b.item_id); $('#bi').value = it.name; $('#bi').dataset.id = it.id; }
  $$('.bci', el).forEach((inp, i) => { combo(inp, { source: itemSrc() }); if (lines[i].item_id) { inp.value = lines[i].item_name; inp.dataset.id = lines[i].item_id; } });
  $('#bc').onclick = back; $('#bs').onclick = async () => { try { await C('saveBom', { id: p.id, name: $('#bn').value, item_id: +$('#bi').dataset.id, qty: +$('#bq').value, items: $$('.bci', el).map((inp, i) => ({ item_id: +inp.dataset.id || null, qty: +$$('.bcq', el)[i].value })) }); toast('BOM saved', 'ok'); back(); } catch (e) { fail(e); } };
};
SCREENS.budgets = async (el) => {
  const c = await loadCache(true); const fy = APP.fy.label; const cur = await C('budgets', fy); const map = Object.fromEntries(cur.map(b => [b.ledger_id, b.amount]));
  const leds = c.ledgers.filter(l => ['E', 'I'].includes(l.nature) || map[l.id]);
  el.innerHTML = `<h2 class="title">Budgets — FY ${esc(fy)} <small>yearly budget per income/expense ledger</small></h2><div class="toolbar"><span class="sp"></span><button class="btn" id="bva">Budget vs Actual</button><button class="btn primary" id="bsv">Save</button></div>
   <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Ledger</th><th>Group</th><th class="r">Budget (₹)</th></tr></thead><tbody>${leds.map(l => `<tr><td>${esc(l.name)}</td><td>${esc(l.group_name)}</td><td class="r"><input data-l="${l.id}" style="width:140px;text-align:right" value="${map[l.id] || ''}"></td></tr>`).join('')}</tbody></table></div>`;
  $('#bva').onclick = () => go('report', { r: 'budgetReport' });
  $('#bsv').onclick = async () => { try { for (const inp of $$('input[data-l]', el)) { const l = +inp.dataset.l; if ((map[l] || 0) !== (Number(inp.value) || 0)) await C('saveBudget', fy, l, Number(inp.value) || 0); } toast('Budgets saved', 'ok'); } catch (e) { fail(e); } };
};
SCREENS.importExport = (el) => {
  el.innerHTML = `<h2 class="title">Import / Export Masters (Excel)</h2><div class="card" style="max-width:780px"><p>Bulk-create customers, suppliers and items from Excel. Download the template, fill it, then import. Existing names are updated.</p>
   <div class="toolbar"><button class="btn" id="tpl">1. Download Template</button><button class="btn primary" id="imp">2. Import from Excel</button><button class="btn" id="exp">Export all Ledgers & Items</button></div><div id="impres"></div></div>`;
  $('#tpl').onclick = () => api('masters.template').then(r => r && toast('Template saved: ' + r.file, 'ok')).catch(fail);
  $('#exp').onclick = () => api('masters.export').then(r => r && toast('Exported: ' + r.file, 'ok')).catch(fail);
  $('#imp').onclick = async () => { try { const r = await api('masters.import'); if (!r) return; await loadCache(true); $('#impres').innerHTML = `<div class="alert green">Imported ${r.ledgers} ledgers and ${r.items} items.</div>${r.errors.map(e => `<div class="alert red">${esc(e)}</div>`).join('')}`; } catch (e) { fail(e); } };
};

// ---------- company ----------
SCREENS.companyEdit = async (el) => {
  const s = await C('settings');
  const extra = [{ section: 'Voucher Numbering (prefix; number continues per financial year)' }, ...Object.keys(APP.info.company.vtypes).map(k => ({ k: 'prefix_' + k, label: vtName(k) + ' prefix' })),
    { section: 'Advanced' }, { k: 'stock_method', label: 'Stock Valuation', type: 'select', options: [['AVG', 'Weighted Average'], ['FIFO', 'FIFO'], ['LAST', 'Last Purchase Rate']] }, { k: 'invoice_copies', label: 'Invoice copy label', type: 'select', options: ['ORIGINAL FOR RECIPIENT', 'DUPLICATE FOR TRANSPORTER', 'TRIPLICATE FOR SUPPLIER', ''] },
    { k: 'lock_date', label: 'Lock books up to (no edits on/before)', type: 'date' }, { k: 'cheque_offset_x', label: 'Cheque print X offset (mm)', type: 'number' }, { k: 'cheque_offset_y', label: 'Cheque print Y offset (mm)', type: 'number' }, { k: 'declaration', label: 'Invoice declaration text', w: 2 }];
  const fields = [...COMPANY_FIELDS, ...extra];
  el.innerHTML = `<h2 class="title">Company Settings <small>${can('admin') ? '' : '(view only — admin can change)'}</small></h2><div class="card"><div class="form">${formHtml(fields, s)}</div></div><div class="actions"><button class="btn" id="cc">Cancel</button>${can('admin') ? '<button class="btn primary" id="cs">Save <kbd>Ctrl+S</kbd></button>' : ''}</div>`;
  bindForm(el, fields, s);
  $('#f_gstin').onchange = () => { const g = $('#f_gstin').value.toUpperCase().trim(); if (g.length >= 2) $('#f_state_code').value = g.slice(0, 2); if (g.length >= 12 && !$('#f_pan').value) $('#f_pan').value = g.slice(2, 12); };
  $('#cc').onclick = back;
  const save = async () => { try { const v = readForm(el, fields); await api('company.saveSettings', v); await refreshCompany(); toast('Company settings saved', 'ok'); back(); } catch (e) { fail(e); } };
  if ($('#cs')) $('#cs').onclick = save; APP.current.keys = e => { if (e.ctrlKey && e.key.toLowerCase() === 's' && can('admin')) { save(); return true; } };
};

// ---------- utilities ----------
SCREENS.utilities = (el) => {
  el.innerHTML = `<h2 class="title">Utilities</h2>` + menuGrid([['Backup Company', 'Save a .rsbak backup file (pen drive / Google Drive folder)', 'backup', {}], ['Restore Backup', 'Load a backup as a company', 'restore', {}], ['Auto Backups', 'Daily automatic copies (last 15 kept)', 'autoBackups', {}], ['Verify Data', 'Check integrity, balances, GSTINs, negative stock', 'verify', {}],
    ['Audit Trail (Edit Log)', 'All creations, edits and deletions', 'report', { r: 'auditLog' }], ['Users & Roles', 'Admin / Operator / Viewer logins', 'users', {}], ...(can('admin') ? [['Admin Settings', 'Password, username, app name, icon, theme', 'adminSettings', {}]] : []), ['Change Password', '', 'changePw', {}], ['Import / Export Masters', 'Excel', 'importExport', {}],
    ['Depreciation', 'Chart and auto posting (WDV)', 'report', { r: 'depreciationChart' }], ['Notes & Reminders', 'To-dos, follow-ups, due dates', 'reminders', {}], ['Query Executor', 'Read-only SQL on your data (admin)', 'sql', {}], ['Open Data Folder', 'Where company files are stored', 'dataFolder', {}],
    ['Help & Shortcuts', '', 'help', {}], ['About', '', 'about', {}]]);
  bindMenu(el);
};
SCREENS.backup = async (el) => { el.innerHTML = '<h2 class="title">Backup</h2><div class="card">Choose where to save the backup…</div>'; try { const r = await api('company.backup'); if (r) { toast('Backup saved: ' + r.file, 'ok'); el.innerHTML = `<h2 class="title">Backup</h2><div class="alert green">Backup saved to ${esc(r.file)} (${(r.size / 1024).toFixed(0)} KB). Keep a copy on a pen drive or cloud folder.</div>`; } else back(); } catch (e) { fail(e); } };
SCREENS.restore = async (el) => { el.innerHTML = '<h2 class="title">Restore</h2><div class="card">Choose a .rsbak file…</div>'; try { const r = await api('company.restore'); if (r) el.innerHTML = `<h2 class="title">Restore</h2><div class="alert green">Restored as company "${esc(r.name)}". Press F1 to open it.</div>`; else back(); } catch (e) { fail(e); back(); } };
SCREENS.autoBackups = async (el) => { const l = await api('company.backupsList'); el.innerHTML = `<h2 class="title">Automatic Backups <small>one copy per day when the company is opened · last 15 kept</small></h2><div class="card"><table class="mini">${l.map(f => `<tr><td>${esc(f.file)}</td><td class="r">${(f.size / 1024).toFixed(0)} KB</td></tr>`).join('') || '<tr><td>None yet</td></tr>'}</table><div class="toolbar" style="margin-top:10px"><button class="btn" id="odf">Open Data Folder</button></div></div>`; $('#odf').onclick = () => api('company.openDataFolder'); };
SCREENS.dataFolder = async (el) => { await api('company.openDataFolder'); el.innerHTML = `<h2 class="title">Data Folder</h2><div class="card">${esc(APP.info.dataDir)}</div>`; };
SCREENS.changePw = async (el) => { el.innerHTML = '<h2 class="title">Change Password</h2>'; await changePassword(false); back(); };
SCREENS.verify = async (el) => {
  const r = await C('verifyData');
  el.innerHTML = `<h2 class="title">Data Verification</h2><div class="card">${r.ok ? '<div class="alert green">✔ All checks passed. Vouchers balanced, references intact, database integrity OK.</div>' : r.issues.map(i => `<div class="alert ${i.type === 'Negative stock' ? '' : 'red'}"><b>${esc(i.type)}:</b>&nbsp;${esc(i.detail)}</div>`).join('')}
   <p style="color:var(--muted)">Checked ${r.checked.vouchers} vouchers, ${r.checked.ledgers} ledgers, ${r.checked.items} items.</p></div>`;
};
SCREENS.sql = async (el) => {
  el.innerHTML = `<h2 class="title">Query Executor <small>read-only SELECT · tables: vouchers, entries, vitems, ledgers, groups, items, bill_refs, audit_log</small></h2><div class="card"><textarea id="sq" rows="4" style="width:100%;font-family:Consolas,monospace">SELECT l.name, SUM(e.dr) AS debit, SUM(e.cr) AS credit FROM entries e JOIN ledgers l ON l.id=e.ledger_id GROUP BY l.id ORDER BY debit DESC</textarea><div class="toolbar"><button class="btn primary" id="sqr">Run (Ctrl+Enter)</button></div></div><div id="sqo"></div>`;
  const run = async () => { try { const rep = await C('sqlQuery', $('#sq').value); APP.cache.lastRep = rep; $('#sqo').innerHTML = repTable(rep); } catch (e) { fail(e); } };
  $('#sqr').onclick = run; $('#sq').onkeydown = e => { if (e.ctrlKey && e.key === 'Enter') run(); };
};
SCREENS.users = async (el) => {
  if (!can('admin')) { el.innerHTML = '<h2 class="title">Users</h2><div class="card">Only an admin can manage users.</div>'; return; }
  const list = await api('users.list'); const server = !!APP.info.server; const comps = server ? await api('company.list') : [];
  const edit = async (u) => {
    const F = [{ k: 'username', label: 'Username', req: true, ro: !!u }, ...(server ? [{ k: 'fullName', label: 'Full name (optional)' }] : []), { k: 'role', label: 'Role', type: 'select', options: [['operator', 'Operator — enter & edit vouchers/masters'], ['admin', 'Admin — everything incl. delete, settings, users'], ['viewer', 'Viewer — reports only']] }, { k: 'password', label: u ? 'New password (blank = unchanged)' : 'Password', type: 'password' },
      ...(server ? [{ k: 'access', label: 'Companies', type: 'select', options: [['*', 'All companies'], ['some', 'Only the ones I tick next']] }, { k: 'mustChange', label: 'Ask to change password at first login', type: 'check', def: 1 }] : []), { k: 'active', label: 'Active', type: 'check', def: 1 }];
    const v = await promptBox(u ? 'Alter user ' + u.username : 'Create user', F, u ? Object.assign({}, u, { access: Array.isArray(u.companies) ? 'some' : '*', mustChange: u.mustChange ? 1 : 0 }) : { role: 'operator', active: 1, access: '*', mustChange: 1 });
    if (!v) return;
    if (server) {
      if (v.access === 'some') { const cur = u && Array.isArray(u.companies) ? u.companies : [];
        const pick = await modal(`<h3>Companies for ${esc(v.username)}</h3><div style="max-height:50vh;overflow:auto">${comps.map(c => `<label style="display:block;padding:4px"><input type="checkbox" value="${esc(c.id)}" ${cur.includes(c.id) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('') || 'No companies yet'}</div><div class="actions"><button class="btn" data-a="no">Cancel</button><button class="btn primary" data-a="ok">OK</button></div>`, (box, close) => { $('[data-a=no]', box).onclick = () => close(null); $('[data-a=ok]', box).onclick = () => close($$('input:checked', box).map(i => i.value)); });
        if (!pick) return; v.companies = pick; } else v.companies = '*';
      v.mustChange = !!v.mustChange; delete v.access;
    }
    v.active = !!v.active;
    try { await api('users.save', v); toast('User saved', 'ok'); render(); } catch (e) { fail(e); }
  };
  const extra = server ? '<button class="btn" id="uimp">Import users from v1.1 (system.json)</button>' : '';
  listScreen(el, { title: 'Users & Roles', rows: list, onNew: () => edit(null), onOpen: edit, extra, cols: [{ k: 'username', label: 'User' }, ...(server ? [{ k: 'fullName', label: 'Name' }] : []), { k: 'role', label: 'Role' }, ...(server ? [{ k: 'companies', label: 'Companies', f: r => Array.isArray(r.companies) ? r.companies.length + ' selected' : 'All' }] : []), { k: 'active', label: 'Status', f: r => r.active ? 'Active' : '<span class="pill red">Disabled</span>' }, { k: 'lastLogin', label: 'Last login', f: r => esc((r.lastLogin || '').replace('T', ' ').slice(0, 16)) }] });
  if ($('#uimp', el)) $('#uimp', el).onclick = async () => { const f = await readTextFile('.json'); if (!f) return; try { const r = await api('users.importV1', f.text); toast(`Added ${r.added.length} users (${r.added.join(', ') || '—'}); skipped ${r.skipped.length}`, 'ok'); render(); } catch (e) { fail(e); } };
};
SCREENS.reminders = async (el) => {
  await loadCache(); const rows = await C('list', 'reminders');
  const edit = async (r) => { const v = await promptBox(r ? 'Edit note' : 'New note / reminder', [{ k: 'title', label: 'Title', req: true, w: 2 }, { k: 'due_date', label: 'Due date', type: 'date' }, { k: 'done', label: 'Done', type: 'check' }, { k: 'notes', label: 'Notes', type: 'textarea', w: 4 }], r || { due_date: APP.date }); if (!v) return; try { if (r) v.id = r.id; await C('saveSimple', 'reminders', v); render(); } catch (e) { fail(e); } };
  listScreen(el, { title: 'Notes & Reminders', rows, onNew: () => edit(null), onOpen: edit, cols: [{ k: 'due_date', label: 'Due', f: r => r.due_date ? U.fmtDate(r.due_date) : '' }, { k: 'title', label: 'Title' }, { k: 'notes', label: 'Notes' }, { k: 'done', label: 'Status', f: r => r.done ? '<span class="pill grey">Done</span>' : (r.due_date && r.due_date < U.today() ? '<span class="pill red">Overdue</span>' : '<span class="pill">Open</span>') }] });
};
SCREENS.labels = async (el) => {
  const c = await loadCache(true);
  el.innerHTML = `<h2 class="title">Barcode Labels <small>Code-128 · 4 per row on A4</small></h2><div class="toolbar"><label><input type="checkbox" id="lbr"> show sale rate</label><span class="sp"></span><button class="btn primary" id="lbp">Preview / PDF</button></div>
   <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Item</th><th>Barcode / Code</th><th class="r">MRP</th><th class="r">Copies</th></tr></thead><tbody>${c.items.filter(i => i.item_type !== 'Service').map(i => `<tr><td>${esc(i.name)}</td><td>${esc(i.barcode || i.code || '(auto: ' + String(i.id).padStart(8, '0') + ')')}</td><td class="r">${inr(i.mrp)}</td><td class="r"><input type="number" data-i="${i.id}" style="width:70px" value="0"></td></tr>`).join('')}</tbody></table></div>`;
  $('#lbp').onclick = async () => { const items = $$('input[data-i]', el).filter(x => +x.value > 0).map(x => ({ ...c.items.find(i => i.id === +x.dataset.i), copies: +x.value })); if (!items.length) return toast('Enter copies for at least one item', 'err'); try { await api('doc.pdf', 'labels', 0, { items, showRate: $('#lbr').checked }); } catch (e) { fail(e); } };
};
SCREENS.reminderLetters = async (el) => {
  const rep = await C('outstanding', { kind: 'receivable', to: APP.date });
  const c = await loadCache();
  el.innerHTML = `<h2 class="title">Payment Reminder Letters</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Customer</th><th>Phone</th><th class="r">Outstanding</th><th></th></tr></thead><tbody>${rep.rows.filter(r => r.total > 0).map(r => { const l = c.ledgers.find(x => x.name === r.name); return `<tr><td>${esc(r.name)}</td><td>${esc(r.phone)}</td><td class="r">${inr(r.total)}</td><td>${l && l.bill_wise ? `<button class="btn sm" data-l="${l.id}">Reminder PDF</button>` : '<span class="pill grey">not bill-wise</span>'}</td></tr>`; }).join('') || '<tr><td colspan="4">Nobody owes you anything 🎉</td></tr>'}</tbody></table></div>`;
  $$('button[data-l]', el).forEach(b => b.onclick = () => api('doc.pdf', 'reminder', +b.dataset.l).catch(fail));
};
SCREENS.pendingOrders = async (el, p) => {
  const rows = await C('pendingOrders', p.vtype);
  const to = { SOR: 'SAL', QTN: 'SAL', DCH: 'SAL', PFI: 'SAL', POR: 'PUR', GRN: 'PUR' }[p.vtype];
  listScreen(el, { title: 'Pending ' + vtName(p.vtype) + 's', rows, onOpen: r => go('voucher', { id: r.id }), cols: [{ k: 'date', label: 'Date', f: r => U.fmtDate(r.date) }, { k: 'number', label: 'No.' }, { k: 'party_name', label: 'Party' }, { k: 'total', label: 'Value', r: 1, f: r => inr(r.total) }, { k: 'id', label: '', f: r => `<button class="btn sm" data-cv="${r.id}">Convert → ${esc(vtName(to))}</button>` }] });
  $$('[data-cv]', el).forEach(b => b.onclick = async e => { e.stopPropagation(); const inp = await C('convertVoucher', +b.dataset.cv, to); go('voucher', { vtype: to, prefill: inp }); });
};
SCREENS.physicalStock = async (el) => {
  const c = await loadCache(true); const val = await C('stockValuation', APP.date);
  const items = c.items.filter(i => i.item_type !== 'Service');
  el.innerHTML = `<h2 class="title">Physical Stock Verification <small>as on ${U.fmtDate(APP.date)} — enter counted quantity; differences post as a Stock Journal (shortage/excess)</small></h2><div class="toolbar"><span class="sp"></span><button class="btn primary" id="psv">Post Differences</button></div>
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Item</th><th class="r">Book Stock</th><th class="r">Physical Count</th><th class="r">Difference</th><th class="r">Rate</th></tr></thead><tbody>${items.map(i => `<tr><td>${esc(i.name)}</td><td class="r">${U.r3(val[i.id].qty)}</td><td class="r"><input data-i="${i.id}" style="width:100px;text-align:right"></td><td class="r" id="pd${i.id}"></td><td class="r">${inr(val[i.id].rate)}</td></tr>`).join('')}</tbody></table></div>`;
  $$('input[data-i]', el).forEach(inp => inp.oninput = () => { const id = +inp.dataset.i; const d = inp.value === '' ? '' : U.r3(Number(inp.value) - val[id].qty); $('#pd' + id).innerHTML = d === '' ? '' : `<span class="${d < 0 ? 'neg' : ''}">${d > 0 ? '+' : ''}${d}</span>`; });
  $('#psv').onclick = async () => { const lines = $$('input[data-i]', el).filter(x => x.value !== '').map(x => { const id = +x.dataset.i; const d = U.r3(Number(x.value) - val[id].qty); return d ? { item_id: id, qty: Math.abs(d), rate: val[id].rate, direction: d > 0 ? 1 : -1 } : null; }).filter(Boolean);
    if (!lines.length) return toast('No differences to post', 'err'); try { const r = await C('saveVoucher', { vtype: 'STJ', date: APP.date, narration: 'Physical stock verification adjustment', items: lines }); toast('Posted Stock Journal ' + r.number, 'ok'); go('voucher', { id: r.id }, true); } catch (e) { fail(e); } };
};
SCREENS.voucherList = async (el, p) => {
  const r = fyRange();
  el.innerHTML = `<h2 class="title">Find Vouchers</h2><div class="toolbar"><input id="vq" placeholder="Search no., party, narration, amount…" style="width:300px"><select id="vt"><option value="">All types</option>${Object.entries(APP.info.company.vtypes).map(([k, t]) => `<option value="${k}" ${p.vtype === k ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
   <input type="date" id="vf" value="${r.from}"><input type="date" id="vto" value="${r.to}"><select id="vs"><option value="">Any status</option><option value="active">Active</option><option value="optional">Optional</option><option value="cancelled">Cancelled</option></select><button class="btn primary" id="vgo">Search</button></div><div id="vres"></div>`;
  const run = async () => { const rows = await C('vouchers', { q: $('#vq').value, vtype: $('#vt').value, from: $('#vf').value, to: $('#vto').value, status: $('#vs').value, limit: 2000 });
    $('#vres').innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Type</th><th>No.</th><th>Party / Particulars</th><th>Narration</th><th class="r">Amount</th><th>Status</th><th>By</th></tr></thead><tbody>${rows.map((v, i) => `<tr class="drill ${i === 0 ? 'cur' : ''}" data-v="${v.id}"><td>${U.fmtDate(v.date)}</td><td>${esc(vtName(v.vtype))}</td><td>${esc(v.number)}</td><td>${esc(v.party_name || '')}</td><td>${esc((v.narration || '').slice(0, 60))}</td><td class="r">${inr(v.total)}</td><td>${v.status === 'active' ? '' : `<span class="pill ${v.status === 'cancelled' ? 'red' : 'grey'}">${v.status}</span>`}</td><td>${esc(v.created_by || '')}</td></tr>`).join('') || '<tr><td colspan="8">No vouchers found</td></tr>'}</tbody></table></div>`;
    $$('#vres tr[data-v]').forEach(t => t.onclick = () => go('voucher', { id: +t.dataset.v })); };
  $('#vgo').onclick = run; $('#vq').onkeydown = e => { if (e.key === 'Enter') run(); }; $('#vt').onchange = run; await run(); $('#vq').focus();
};

// ---------- payroll ----------
SCREENS.payroll = async (el) => {
  const emps = await C('list', 'employees'); const runs = await C('payrollRuns');
  const m = APP.date.slice(0, 7);
  el.innerHTML = `<h2 class="title">Payroll</h2><div class="dgrid"><div class="card"><h3>Employees</h3><div class="toolbar"><button class="btn primary" id="pe">+ Add Employee</button></div><table class="mini"><tr style="font-weight:600"><td>Name</td><td>Designation</td><td class="r">Gross / month</td><td>PF</td><td>ESI</td></tr>${emps.map(e => `<tr data-e="${e.id}"><td>${esc(e.name)}</td><td>${esc(e.designation || '')}</td><td class="r">${inr(e.basic + e.hra + e.da + e.other_allow)}</td><td>${e.pf_applicable ? '✔' : ''}</td><td>${e.esi_applicable ? '✔' : ''}</td></tr>`).join('') || '<tr><td>No employees yet</td></tr>'}</table></div>
    <div class="card"><h3>Process Salary</h3><div class="fld"><label>Month</label><input type="month" id="pm" value="${m}"></div><div class="toolbar"><button class="btn" id="pprev">Preview Register</button><button class="btn primary" id="pproc">Process & Post Journal</button></div>
    <h3 style="margin-top:12px">Processed Months</h3><table class="mini">${runs.map(r => `<tr><td>${esc(r.month)}</td><td>${esc(r.number || '')}</td><td class="r">${inr(r.total || 0)}</td><td><button class="btn sm" data-reg="${esc(r.month)}">Register</button> <button class="btn sm" data-slip="${esc(r.month)}">Payslips</button> ${can('admin') ? `<button class="btn sm danger" data-del="${r.id}">Delete</button>` : ''}</td></tr>`).join('') || '<tr><td>None</td></tr>'}</table></div></div>
    <div class="card" style="font-size:12px;color:var(--muted)">PF: 12% employee + 12% employer on Basic+DA (capped at ₹15,000 wage). ESI: 0.75% employee + 3.25% employer when gross ≤ ₹21,000. Professional tax & TDS are fixed monthly amounts set per employee. Posting: Salary Dr, Employer PF/ESI Dr → PF/ESI/PT/TDS Payable Cr, Salary Payable Cr. Pay salaries with a Payment voucher against "Salary Payable".</div>`;
  const editE = async (e) => { const v = await promptBox(e ? 'Alter Employee' : 'Add Employee', [{ k: 'name', label: 'Name', req: true, w: 2 }, { k: 'designation', label: 'Designation' }, { k: 'doj', label: 'Date of joining', type: 'date' }, { k: 'basic', label: 'Basic', type: 'number' }, { k: 'hra', label: 'HRA', type: 'number' }, { k: 'da', label: 'DA', type: 'number' }, { k: 'other_allow', label: 'Other allowances', type: 'number' }, { k: 'pf_applicable', label: 'PF applicable', type: 'check', def: 1 }, { k: 'esi_applicable', label: 'ESI applicable', type: 'check' }, { k: 'pt', label: 'Professional tax / month', type: 'number' }, { k: 'tds', label: 'TDS / month', type: 'number' }, { k: 'pan', label: 'PAN', upper: true }, { k: 'uan', label: 'UAN (PF)' }, { k: 'esi_no', label: 'ESI No.' }, { k: 'bank_acc', label: 'Bank A/c' }, { k: 'ifsc', label: 'IFSC', upper: true }, { k: 'active', label: 'Active', type: 'check', def: 1 }], e || { pf_applicable: 1, active: 1 }); if (!v) return; try { if (e) v.id = e.id; await C('saveSimple', 'employees', v); render(); } catch (er) { fail(er); } };
  $('#pe').onclick = () => editE(null); $$('tr[data-e]', el).forEach(t => t.onclick = () => editE(emps.find(e => e.id === +t.dataset.e)));
  $('#pprev').onclick = () => go('report', { r: 'salaryRegister', a: { month: $('#pm').value } });
  $('#pproc').onclick = async () => { if (!await confirmBox('Process salary for ' + $('#pm').value + ' and post the salary journal?', 'Process')) return; try { const r = await C('payrollProcess', $('#pm').value); toast('Salary journal ' + r.number + ' posted', 'ok'); render(); } catch (e) { fail(e); } };
  $$('[data-reg]', el).forEach(b => b.onclick = () => go('report', { r: 'salaryRegister', a: { month: b.dataset.reg } }));
  $$('[data-slip]', el).forEach(b => b.onclick = async () => { const reg = await C('salaryRegister', { month: b.dataset.slip }); for (const row of reg.rows) await api('doc.pdf', 'payslip', row.id, { month: b.dataset.slip, preview: reg.rows.length === 1 }); toast('Payslips saved as PDF in the PDF folder', 'ok'); });
  $$('[data-del]', el).forEach(b => b.onclick = async () => { if (await confirmBox('Delete this salary run and its journal?', 'Delete', true)) { try { await C('payrollDelete', +b.dataset.del); render(); } catch (e) { fail(e); } } });
};

// ---------- help & about ----------
SCREENS.help = (el) => {
  const K = [['F8', 'Sales invoice'], ['F9', 'Purchase'], ['F6', 'Receipt'], ['F5', 'Payment'], ['F4', 'Contra (cash ↔ bank)'], ['F7', 'Journal'], ['Ctrl+F8', 'Credit note (sales return)'], ['Ctrl+F9', 'Debit note (purchase return)'], ['Alt+C', 'Create master (ledger / item) — also inside any search box'], ['Ctrl+S / Ctrl+A', 'Save voucher or master'], ['Ctrl+P', 'Print / PDF current voucher or report'], ['Esc', 'Back / close'], ['Ctrl+F', 'Find vouchers'], ['F1', 'Change company'], ['F2', 'Change working date'],
    ['Alt+D', 'Dashboard'], ['Alt+B', 'Day Book'], ['Alt+T', 'Trial Balance'], ['Alt+P', 'Profit & Loss'], ['Alt+S', 'Balance Sheet'], ['Alt+O', 'Outstanding'], ['Alt+R', 'All reports'], ['Alt+L', 'Ledgers'], ['Alt+I', 'Items'], ['Alt+U', 'Utilities'], ['↑ ↓ Enter', 'Move and drill down in any report'], ['Ctrl+Shift+F12', 'Developer console (support)']];
  el.innerHTML = `<h2 class="title">Help & Keyboard Shortcuts</h2><div class="dgrid"><div class="card"><table class="mini">${K.map(k => `<tr><td style="width:150px"><kbd>${esc(k[0])}</kbd></td><td>${esc(k[1])}</td></tr>`).join('')}</table></div>
   <div class="card"><h3>Quick start (Hinglish)</h3><ol style="line-height:1.7;padding-left:18px"><li><b>Company banao</b> — GSTIN daalo, state apne-aap set ho jayega.</li><li><b>Ledgers</b> (Alt+L): customers Sundry Debtors mein, suppliers Sundry Creditors mein, bank "Bank Accounts" mein.</li><li><b>Stock Items</b> (Alt+I): HSN, GST %, rate, opening stock.</li><li><b>F8</b> se Sales Invoice — party ka state alag ho to IGST, same state ho to CGST+SGST apne-aap.</li><li>Save (Ctrl+S) ke baad <b>PDF / Print</b> — invoice par HSN summary, amount in words, bank details, UPI QR.</li><li><b>F6 Receipt</b> mein bill select karo — outstanding apne-aap adjust.</li><li>Month end: <b>GSTR-1 / GSTR-3B</b> → JSON / Excel export.</li><li>Roz <b>Backup</b> (Utilities) pen drive ya Google Drive folder mein.</li></ol>
   <p style="color:var(--muted)">Voucher entry: party/item boxes mein type karke search karo, ↑↓ se chuno, Enter. Naya item/party wahin se "+ Create new" se bana sakte ho.</p></div></div>`;
};
SCREENS.about = (el) => { el.innerHTML = `<div class="card about"><img class="brand-img" src="${esc(brandImg())}"><h2 style="color:var(--navy);margin:8px 0 2px">${esc(appName())}</h2><div>Version ${esc(APP.info.version)}</div><p>GST accounting, inventory, billing and payroll for Indian businesses.<br>Works fully offline. Your data stays on this computer: ${esc(APP.info.dataDir)}</p><p style="color:var(--muted)">© 2026 R&amp;S Sons. All rights reserved.</p></div>`; };

// ---------- Admin Settings (admin only: password, username, app name, app icon, theme) ----------
// Every action is checked again in the main process (need('admin')), so hiding this screen is not the only guard.
SCREENS.adminSettings = async (el) => {
  if (!can('admin')) { el.innerHTML = '<h2 class="title">Admin Settings</h2><div class="card">Only an admin can open Admin Settings.</div>'; return; }
  await renderAdminSettings(el);
};
async function renderAdminSettings(el) {
  let A;
  try { A = await api('admin.info'); } catch (e) { el.innerHTML = `<h2 class="title">Admin Settings</h2><div class="card err">${esc(e.message)}</div>`; return; }
  const themeBtn = (t, label, sub, sw) => `<button data-theme-set="${t}" class="${A.theme === t ? 'on' : ''}"><div class="sw">${sw.map(c => `<i style="background:${c}"></i>`).join('')}</div><b>${label}</b><small>${sub}</small></button>`;
  const iconOn = id => (A.icon.kind === 'default' && id === 'rs') || (A.icon.kind === 'builtin' && A.icon.id === id);
  el.innerHTML = `<h2 class="title">⚙ Admin Settings <span class="admin-badge">ADMIN ONLY</span><small>Only users with the Admin role can see or change these</small></h2>
  <div class="adm-grid">
   <div class="card" id="admLogin"><h3>🔐 Login — username & password</h3>
     <div class="adm-cur"><div>Logged in as <b id="admUser">${esc(A.username)}</b> (admin)</div></div>
     <fieldset><legend>Change password</legend>
       <div class="fld"><label>Current password</label><input type="password" id="apCur" autocomplete="current-password"></div>
       <div class="fld"><label>New password</label><input type="password" id="apNew" autocomplete="new-password"><div class="pwm"><i id="apMeter"></i></div><div class="pwl" id="apLbl">At least 8 characters, letters + numbers</div></div>
       <div class="fld"><label>Confirm new password</label><input type="password" id="apRep" autocomplete="new-password"></div>
       <div class="err" id="apErr"></div><button class="btn primary" id="apSave">Change Password</button></fieldset>
     <fieldset><legend>Change username</legend>
       <div class="fld"><label>New username</label><input id="auNew" autocomplete="off" placeholder="e.g. rssons.admin"></div>
       <div class="fld"><label>Current password (to confirm it is you)</label><input type="password" id="auPw" autocomplete="current-password"></div>
       <div class="err" id="auErr"></div><button class="btn primary" id="auSave">Change Username</button>
       <p class="adm-help">You stay logged in. From next login use the new username.</p></fieldset>
   </div>
   <div>
   <div class="card"><h3>🏷 App name</h3>
     <div class="fld"><label>Name shown in the app</label><input id="anName" maxlength="60" value="${esc(A.appName)}"></div>
     <div class="toolbar"><button class="btn primary" id="anSave">Save Name</button><button class="btn" id="anReset" ${A.isDefaultName ? 'disabled' : ''}>Reset to default</button></div>
     <p class="adm-help">Used in the window title, login screen, sidebar header, About box and on printed invoices / PDFs ("Generated by ${esc(A.appName)}"). Default: ${esc(A.defaultName)}.</p></div>
   <div class="card"><h3>🖼 App icon</h3>
     <div class="adm-cur"><img id="aiCur" src="${esc(A.iconUrl || '../assets/logo.png')}" alt=""><div>Current icon: <b>${A.icon.kind === 'custom' ? 'your image' + (A.icon.file ? ' (' + esc(A.icon.file) + ')' : '') : A.icon.kind === 'builtin' ? esc((A.builtins.find(b => b.id === A.icon.id) || {}).label || A.icon.id) : 'default R&amp;S logo'}</b></div></div>
     <div class="icon-choices">${A.builtins.map(b => `<button data-icon="${b.id}" title="${esc(b.label)}" class="${iconOn(b.id) ? 'on' : ''}"><img src="${esc(b.url || '')}" alt="${esc(b.label)}"></button>`).join('')}</div>
     <div class="toolbar"><button class="btn primary" id="aiFile">Choose image from PC… (PNG / JPG / ICO)</button><button class="btn" id="aiReset" ${A.icon.kind === 'default' ? 'disabled' : ''}>Reset to default</button></div>
     <p class="adm-help">The window, taskbar and in-app logo change immediately. The desktop / Start-menu shortcut icon is set by Windows at install time, so it changes only after reinstalling.</p></div>
   <div class="card"><h3>🌓 Theme</h3>
     <div class="theme-choices">${themeBtn('light', 'Light', 'Bright, classic', ['#ffffff', '#eef2f6', '#0b2545'])}${themeBtn('dark', 'Dark', 'Easy on the eyes at night', ['#18222e', '#0f1620', '#5b9be6'])}${themeBtn('system', 'System', 'Follow Windows setting', ['#ffffff', '#18222e', '#1d5fa8'])}</div>
     <p class="adm-help">Applies to every screen for all users of this PC. Printed invoices and PDFs always stay white.</p></div>
   </div>
   <div class="card" style="grid-column:1/-1"><h3>📝 Admin activity</h3><table class="mini" id="admLog">${A.log.length ? A.log.map(l => `<tr><td style="width:150px">${esc(new Date(l.at).toLocaleString('en-IN'))}</td><td style="width:120px">${esc(l.user)}</td><td><b>${esc(l.action)}</b> — ${esc(l.detail || '')}</td></tr>`).join('') : '<tr><td style="color:var(--muted)">No admin changes yet</td></tr>'}</table></div>
  </div>`;
  const reload = () => renderAdminSettings(el);
  const after = async (msg) => { toast(msg, 'ok'); await refreshBrand(); if (!$('#app').classList.contains('hidden')) { setTop(); } await reload(); };
  // password strength meter (rules evaluated in the main process — same rules as the save)
  let pwT = null;
  $('#apNew', el).addEventListener('input', () => { clearTimeout(pwT); pwT = setTimeout(async () => { const v = $('#apNew', el).value; if (!v) { $('#apMeter', el).style.width = '0'; $('#apLbl', el).textContent = 'At least 8 characters, letters + numbers'; return; } const r = await api('admin.passwordStrength', v); const col = ['#c0392b', '#e05d2b', '#e0a526', '#4aa04a', '#1e8e3e'][r.score]; $('#apMeter', el).style.width = (20 + r.score * 20) + '%'; $('#apMeter', el).style.background = col; $('#apLbl', el).textContent = r.label + (r.errors.length ? ' — ' + r.errors.join('; ') : ''); }, 120); });
  $('#apSave', el).onclick = async () => { $('#apErr', el).textContent = ''; try { await api('admin.changePassword', $('#apCur', el).value, $('#apNew', el).value, $('#apRep', el).value); await after('Password changed. Use the new password next time you log in.'); } catch (e) { $('#apErr', el).textContent = e.message; } };
  $('#auSave', el).onclick = async () => { $('#auErr', el).textContent = ''; try { const u = await api('admin.changeUsername', $('#auNew', el).value, $('#auPw', el).value); APP.user = u; await after('Username changed to "' + u.username + '". Use it next time you log in.'); } catch (e) { $('#auErr', el).textContent = e.message; } };
  $('#anSave', el).onclick = async () => { try { await api('admin.setAppName', $('#anName', el).value); await after('App name saved'); } catch (e) { fail(e); } };
  $('#anReset', el).onclick = async () => { try { await api('admin.setAppName', null); await after('App name reset to default'); } catch (e) { fail(e); } };
  $$('[data-icon]', el).forEach(b => b.onclick = async () => { try { await api('admin.setIcon', { kind: 'builtin', id: b.dataset.icon }); await after('App icon changed'); } catch (e) { fail(e); } });
  $('#aiFile', el).onclick = async () => { try { const r = await api('admin.setIcon', { kind: 'file' }); if (r) await after('App icon changed to your image'); } catch (e) { fail(e); } };
  $('#aiReset', el).onclick = async () => { try { await api('admin.setIcon', { kind: 'default' }); await after('App icon reset to default'); } catch (e) { fail(e); } };
  $$('[data-theme-set]', el).forEach(b => b.onclick = async () => { try { const r = await api('admin.setTheme', b.dataset.themeSet); applyTheme(r.theme); APP.info.theme = r.theme; $$('[data-theme-set]', el).forEach(x => x.classList.toggle('on', x === b)); toast('Theme: ' + b.querySelector('b').textContent, 'ok'); } catch (e) { fail(e); } });
}
