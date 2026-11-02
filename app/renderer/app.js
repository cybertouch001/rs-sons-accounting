
// R&S Sons Accounting - UI framework
'use strict';
const U = window.RSUtil, CALC = window.RSCalc;
const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = U.esc, inr = U.inr;
const APP = { info: null, company: null, settings: {}, user: null, fy: null, date: U.today(), stack: [], cache: {}, current: null };
const api = (m, ...a) => window.rs.api(m, ...a);
const C = (m, ...a) => window.rs.api('c', m, ...a);
const ROLE_RANK = { viewer: 0, operator: 1, admin: 2 };
const can = r => APP.user && ROLE_RANK[APP.user.role] >= ROLE_RANK[r];

// ---------- theme & branding (set by the admin in Admin Settings; applied on every screen) ----------
const DARK_MQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
function themeOverride() { try { return localStorage.getItem('rs.theme') || ''; } catch (_) { return ''; } }
function applyTheme(t) {
  APP.theme = t || 'light';
  const eff = themeOverride() || APP.theme;    // v2.1: this device's own dark / light choice (🌓) wins over the admin's default
  const dark = eff === 'dark' || (eff === 'system' && DARK_MQ && DARK_MQ.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
if (DARK_MQ && DARK_MQ.addEventListener) DARK_MQ.addEventListener('change', () => { if ((themeOverride() || APP.theme) === 'system') applyTheme(APP.theme); });
function toggleTheme() {
  const dark = document.documentElement.dataset.theme === 'dark';
  try { localStorage.setItem('rs.theme', dark ? 'light' : 'dark'); } catch (_) {}
  applyTheme(APP.theme); toast(dark ? 'Light mode' : 'Dark mode', 'ok');
}
function appName() { return (APP.info && APP.info.name) || 'R&S Sons Accounting'; }
function brandImg() { return (APP.info && APP.info.iconUrl) || '../assets/logo.png'; }
function applyBrand() {
  const n = appName(); document.title = n;
  const ln = $('#lname'); if (ln) ln.textContent = n; const tn = $('#tappname'); if (tn) tn.textContent = n;
  $$('img.brand-img').forEach(i => { if (i.getAttribute('src') !== brandImg()) i.setAttribute('src', brandImg()); });
  if (APP.info) applyTheme(APP.info.theme);
}
async function refreshBrand() { const u = APP.user; APP.info = await api('app.info'); if (u && !APP.info.user) APP.info.user = u; applyBrand(); }

// ---------- toast & modal ----------
function toast(msg, type = '') { const d = document.createElement('div'); d.className = type; d.textContent = msg; $('#toast').appendChild(d); setTimeout(() => d.remove(), type === 'err' ? 6500 : 3500); }
function fail(e) { toast(e && e.message ? e.message : String(e), 'err'); }
let modalResolve = null;
function modal(html, onMount) {
  $('#modalBox').innerHTML = html; $('#modal').classList.remove('hidden');
  return new Promise(res => { modalResolve = res; if (onMount) onMount($('#modalBox'), closeModal); const f = $('#modalBox input:not([type=hidden]),#modalBox select,#modalBox textarea,#modalBox button.primary'); if (f) setTimeout(() => f.focus(), 30); });
}
function closeModal(v) { $('#modal').classList.add('hidden'); $('#modalBox').innerHTML = ''; const r = modalResolve; modalResolve = null; if (r) r(v); }
function isModal() { return !$('#modal').classList.contains('hidden'); }
async function confirmBox(msg, okLabel = 'Yes', danger = false) {
  return modal(`<h3>Please confirm</h3><p style="font-size:14px">${esc(msg)}</p><div class="actions"><button class="btn" data-a="no">No (Esc)</button><button class="btn ${danger ? 'danger' : 'primary'}" data-a="yes">${esc(okLabel)}</button></div>`,
    (box, close) => { $('[data-a=no]', box).onclick = () => close(false); $('[data-a=yes]', box).onclick = () => close(true); setTimeout(() => $('[data-a=yes]', box).focus(), 40); });
}
async function promptBox(title, fields, values = {}) {
  return modal(`<h3>${esc(title)}</h3><div class="form" id="pf">${formHtml(fields, values)}</div><div class="actions"><button class="btn" data-a="no">Cancel</button><button class="btn primary" data-a="ok">OK</button></div>`,
    (box, close) => { bindForm(box, fields, values); $('[data-a=no]', box).onclick = () => close(null); const ok = () => { try { close(readForm(box, fields)); } catch (e) { fail(e); } }; $('[data-a=ok]', box).onclick = ok; box.addEventListener('keydown', e => { if (e.key === 'Enter' && e.ctrlKey) ok(); }); });
}

// ---------- combo (searchable dropdown) ----------
const COMBO = { input: null, items: [], idx: 0, opts: null };
function combo(input, opts) {
  input.setAttribute('autocomplete', 'off');
  const open = () => { COMBO.input = input; COMBO.opts = opts; filterCombo(); };
  input.addEventListener('focus', () => { if (!input.dataset.id || !input.value) open(); });
  input.addEventListener('input', () => { input.dataset.id = ''; open(); });
  input.addEventListener('blur', () => setTimeout(() => { if (COMBO.input === input && document.activeElement !== input) { autoPick(input, opts); hideCombo(); } }, 150));
  input.addEventListener('keydown', e => {
    if (COMBO.input !== input || $('#combo').classList.contains('hidden')) { if (e.key === 'ArrowDown') { open(); e.preventDefault(); } return; }
    if (e.key === 'ArrowDown') { COMBO.idx = Math.min(COMBO.items.length - 1, COMBO.idx + 1); drawCombo(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { COMBO.idx = Math.max(0, COMBO.idx - 1); drawCombo(); e.preventDefault(); }
    else if (e.key === 'Enter') { if (COMBO.items.length) { pickCombo(COMBO.idx); e.preventDefault(); e.stopPropagation(); } }
    else if (e.key === 'Escape') { hideCombo(); e.stopPropagation(); e.preventDefault(); }
    else if (e.key === 'Tab') { if (input.value && !input.dataset.id && COMBO.items.length) pickCombo(COMBO.idx); hideCombo(); }
  });
}
function comboSource(opts) { return typeof opts.source === 'function' ? opts.source() : opts.source; }
function filterCombo() {
  const input = COMBO.input, q = input.value.trim().toLowerCase(); const src = comboSource(COMBO.opts) || [];
  let items = q && !input.dataset.id ? src.filter(x => (x.label + ' ' + (x.sub || '') + ' ' + (x.key || '')).toLowerCase().includes(q)) : src.slice();
  if (q && !input.dataset.id) items.sort((a, b) => (a.label.toLowerCase().startsWith(q) ? 0 : 1) - (b.label.toLowerCase().startsWith(q) ? 0 : 1) || ((b.key || '') === q) - ((a.key || '') === q));
  COMBO.items = items.slice(0, 200); if (COMBO.opts.create) COMBO.items.push({ id: '__create', label: '+ Create new (Alt+C)', create: true });
  COMBO.idx = Math.max(0, COMBO.items.findIndex(x => String(x.id) === String(input.dataset.id))); drawCombo();
}
function drawCombo() {
  const box = $('#combo'); const r = COMBO.input.getBoundingClientRect();
  box.style.left = r.left + 'px'; box.style.width = Math.max(r.width, 300) + 'px';
  const below = window.innerHeight - r.bottom; box.style.top = (below > 220 ? r.bottom + 2 : Math.max(4, r.top - 302)) + 'px';
  box.innerHTML = COMBO.items.map((x, i) => `<div class="${i === COMBO.idx ? 'on' : ''} ${x.create ? 'create' : ''}" data-i="${i}"><span>${esc(x.label)}</span><small>${esc(x.sub || '')}</small></div>`).join('') || '<div><small>No match</small></div>';
  box.classList.remove('hidden');
  $$('div[data-i]', box).forEach(d => d.onmousedown = e => { e.preventDefault(); pickCombo(+d.dataset.i); });
  const on = $('.on', box); if (on) { if (on.offsetTop < box.scrollTop) box.scrollTop = on.offsetTop; else if (on.offsetTop + on.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = on.offsetTop + on.offsetHeight - box.clientHeight; }
}
async function pickCombo(i) {
  const x = COMBO.items[i]; const input = COMBO.input, opts = COMBO.opts; hideCombo(); if (!x) return;
  if (x.create) { const id = await opts.create(input.value); if (id) { input.dataset.id = id; const nx = (comboSource(opts) || []).find(y => String(y.id) === String(id)); input.value = nx ? nx.label : input.value; if (opts.onSelect) opts.onSelect(nx || { id }); } input.focus(); return; }
  input.value = x.label; input.dataset.id = x.id; if (opts.onSelect) opts.onSelect(x);
  focusNext(input);
}
function autoPick(input, opts) { if (!input.value) { input.dataset.id = ''; if (opts.onSelect) opts.onSelect(null); return; } if (input.dataset.id) return; const src = comboSource(opts) || []; const q = input.value.trim().toLowerCase(); const x = src.find(y => y.label.toLowerCase() === q || (y.key && y.key.toLowerCase() === q)) || (COMBO.items[0] && !COMBO.items[0].create && COMBO.items.filter(y => !y.create).length === 1 ? COMBO.items[0] : null); if (x) { input.value = x.label; input.dataset.id = x.id; if (opts.onSelect) opts.onSelect(x); } }
function hideCombo() { $('#combo').classList.add('hidden'); }
function focusNext(el) { const scope = el.closest('#modalBox') || $('#main'); const f = $$('input:not([disabled]):not([readonly]):not([type=hidden]),select:not([disabled]),textarea,button.primary', scope).filter(x => x.offsetParent !== null); const i = f.indexOf(el); if (i >= 0 && f[i + 1]) f[i + 1].focus(); }

// ---------- forms ----------
function fieldHtml(f, v) {
  const id = 'f_' + f.k; const val = v == null ? (f.def == null ? '' : f.def) : v; const cls = 'fld' + (f.w ? ' w' + f.w : '') + (f.type === 'check' ? ' chk' : '');
  let inp;
  if (f.type === 'select') inp = `<select id="${id}" data-k="${f.k}">${(f.options || []).map(o => { const [ov, ol] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(ov)}" ${String(ov) === String(val) ? 'selected' : ''}>${esc(ol)}</option>`; }).join('')}</select>`;
  else if (f.type === 'textarea') inp = `<textarea id="${id}" data-k="${f.k}" rows="${f.rows || 3}">${esc(val)}</textarea>`;
  else if (f.type === 'check') return `<div class="${cls}"><input type="checkbox" id="${id}" data-k="${f.k}" ${+val ? 'checked' : ''}><label for="${id}">${esc(f.label)}</label></div>`;
  else if (f.type === 'combo') inp = `<input id="${id}" data-k="${f.k}" data-combo="1" placeholder="${esc(f.ph || 'Type to search…')}">`;
  else inp = `<input id="${id}" data-k="${f.k}" type="${f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'password' ? 'password' : 'text'}" ${f.type === 'number' ? 'step="any"' : ''} value="${esc(val)}" ${f.ro ? 'readonly' : ''} placeholder="${esc(f.ph || '')}" ${f.upper ? 'style="text-transform:uppercase"' : ''}>`;
  return `<div class="${cls}"><label for="${id}">${esc(f.label)}${f.req ? ' *' : ''}</label>${inp}${f.help ? `<div class="help">${esc(f.help)}</div>` : ''}</div>`;
}
function formHtml(fields, values = {}) { return fields.map(f => f.section ? `<div class="w4" style="grid-column:1/-1;font-weight:700;color:var(--navy);margin-top:6px;border-bottom:1px solid var(--line);padding-bottom:2px">${esc(f.section)}</div>` : fieldHtml(f, values[f.k])).join(''); }
function bindForm(root, fields, values = {}) {
  for (const f of fields) if (f.type === 'combo') { const el = $('#f_' + f.k, root); combo(el, { source: f.source, onSelect: f.onSelect, create: f.create }); const src = comboSource(f) || []; const cur = src.find(x => String(x.id) === String(values[f.k] == null ? f.def : values[f.k])); if (cur) { el.value = cur.label; el.dataset.id = cur.id; } }
  $$('input,select,textarea', root).forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter' && el.tagName !== 'TEXTAREA' && !e.ctrlKey && !el.dataset.combo) { e.preventDefault(); focusNext(el); } }));
}
function readForm(root, fields) {
  const o = {};
  for (const f of fields) { if (f.section) continue; const el = $('#f_' + f.k, root); if (!el) continue;
    let v = f.type === 'check' ? (el.checked ? 1 : 0) : f.type === 'combo' ? (el.dataset.id || (el.value ? undefined : null)) : el.value;
    if (f.type === 'combo' && v === undefined) throw new Error(`"${el.value}" is not a valid ${f.label}. Pick from the list.`);
    if (f.type === 'number') v = v === '' ? 0 : Number(v);
    if (f.upper && typeof v === 'string') v = v.toUpperCase().trim();
    if (f.req && (v === '' || v == null)) { el.focus(); throw new Error(f.label + ' is required'); }
    o[f.k] = v; }
  return o;
}

// ---------- navigation ----------
const SCREENS = {};
function go(name, params = {}, replace = false) {
  hideCombo();
  if (APP.current && !replace) APP.stack.push(APP.current);
  APP.current = { name, params };
  render();
}
async function back() {
  if (isModal()) { closeModal(null); return; }
  if (APP.current && APP.current.dirty && !(await confirmBox('Discard unsaved changes on this screen?', 'Discard'))) return;
  const prev = APP.stack.pop(); if (!prev) { if (APP.current && APP.current.name !== 'dashboard') { APP.current = { name: 'dashboard', params: {} }; render(); } return; }
  APP.current = prev; render();
}
async function render() {
  const { name, params } = APP.current; const fn = SCREENS[name]; const main = $('#main');
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.go === name && (!a.dataset.p || a.dataset.p === JSON.stringify(params))));
  if (!fn) { main.innerHTML = `<div class="card">Screen not found: ${esc(name)}</div>`; return; }
  try { main.scrollTop = 0; await fn(main, params); } catch (e) { main.innerHTML = `<h2 class="title">Error</h2><div class="card err">${esc(e.message)}</div>`; }
}
function fyRange() { const fy = APP.fy || U.fyOf(APP.date); return { from: fy.start, to: fy.end }; }

// ---------- master caches ----------
async function loadCache(force) {
  if (!force && APP.cache.ledgers) return APP.cache;
  const [ledgers, items, groups, units, godowns, igroups, cc, salesmen, priceLists, boms] = await Promise.all([C('ledgers'), C('items'), C('groups'), C('list', 'units'), C('list', 'godowns'), C('list', 'item_groups'), C('list', 'cost_centres'), C('list', 'salesmen'), C('list', 'price_lists'), C('list', 'boms')]);
  Object.assign(APP.cache, { ledgers, items, groups, units, godowns, igroups, cc, salesmen, priceLists, boms });
  return APP.cache;
}
function invalidate() { APP.cache = {}; }
const groupOf = l => l.group_name;
function ledgerSrc(filter) { return () => (APP.cache.ledgers || []).filter(l => !filter || filter(l)).map(l => ({ id: l.id, label: l.name, sub: l.group_name + (l.gstin ? ' · ' + l.gstin : ''), key: l.alias || '' })); }
function itemSrc() { return () => (APP.cache.items || []).filter(i => i.active !== 0).map(i => ({ id: i.id, label: i.name, sub: `${i.hsn || ''} · ${i.gst_rate}% · ₹${inr(i.sale_rate)}`, key: (i.barcode || '') + ' ' + (i.code || '') + ' ' + (i.alias || '') })); }
function simpleSrc(list, sub) { return () => (APP.cache[list] || []).map(x => ({ id: x.id, label: x.name, sub: sub ? sub(x) : '' })); }
const groupNamesUnder = (root) => { const gs = APP.cache.groups || []; const r = gs.find(g => g.name === root); const out = new Set(); const walk = id => { const g = gs.find(x => x.id === id); if (!g) return; out.add(g.name); gs.filter(x => x.parent_id === id).forEach(x => walk(x.id)); }; if (r) walk(r.id); return out; };
function underGroups(l, roots) { return roots.some(r => groupNamesUnder(r).has(l.group_name)); }

// ---------- shell ----------
const NAV = [
  ['Dashboard', [['Dashboard', 'dashboard', {}, 'Alt+D']]],
  ['Transactions', [['Sales Invoice', 'voucher', { vtype: 'SAL' }, 'F8'], ['Purchase', 'voucher', { vtype: 'PUR' }, 'F9'], ['Receipt', 'voucher', { vtype: 'RCT' }, 'F6'], ['Payment', 'voucher', { vtype: 'PMT' }, 'F5'], ['Contra', 'voucher', { vtype: 'CNT' }, 'F4'], ['Journal', 'voucher', { vtype: 'JRN' }, 'F7'],
    ['Credit Note (Sales Ret.)', 'voucher', { vtype: 'CRN' }, 'Ctrl+F8'], ['Debit Note (Purch. Ret.)', 'voucher', { vtype: 'DBN' }, 'Ctrl+F9'], ['Recurring Vouchers', 'recurring', {}, ''], ['Orders & Challans', 'orderMenu', {}, ''], ['Stock Journal / Production', 'stockMenu', {}, ''], ['Find Vouchers', 'voucherList', {}, 'Ctrl+F']]],
  ['Masters', [['Ledgers / Parties', 'ledgerList', {}, 'Alt+L'], ['Stock Items', 'itemList', {}, 'Alt+I'], ['Account Groups', 'groupList', {}, ''], ['Other Masters', 'mastersMenu', {}, '']]],
  ['Reports', [['Day Book', 'report', { r: 'dayBook' }, 'Alt+B'], ['Ledger Statement', 'ledgerPick', {}, ''], ['Trial Balance', 'report', { r: 'trialBalance' }, 'Alt+T'], ['Profit & Loss', 'report', { r: 'profitLoss' }, 'Alt+P'], ['Balance Sheet', 'report', { r: 'balanceSheet' }, 'Alt+S'],
    ['Stock Summary', 'report', { r: 'stockSummary' }, ''], ['Outstanding', 'report', { r: 'outstanding', a: { kind: 'receivable' } }, 'Alt+O'], ['All Reports', 'reportsMenu', {}, 'Alt+R']]],
  ['GST & Tax', [['GSTR-1', 'report', { r: 'gstr1' }, ''], ['GSTR-3B', 'report', { r: 'gstr3b' }, ''], ['GSTR-2B ITC Match', 'gstr2b', {}, ''], ['Income Tax (ITR)', 'itr', {}, ''], ['Due Dates', 'dueDates', {}, ''], ['GST & TDS Menu', 'gstMenu', {}, '']]],
  ['Other', [['Payroll', 'payroll', {}, ''], ['Banking', 'bankingMenu', {}, ''], ['Bank Statement Import', 'bankImport', {}, ''], ['Utilities', 'utilities', {}, 'Alt+U'], ['Company Settings', 'companyEdit', {}, ''], ['Help & Shortcuts', 'help', {}, 'Ctrl+H']]],
];
const NAV_ADMIN = ['Admin', [['⚙ Admin Settings', 'adminSettings', {}, '']]];
function buildNav() {
  $('#nav').innerHTML = (can('admin') ? NAV.concat([NAV_ADMIN]) : NAV).map(([sec, items]) => `<div class="sec">${esc(sec)}</div>` + items.map(([l, s, p, k]) => `<a data-go="${s}" data-p='${esc(JSON.stringify(p))}'><span>${esc(l)}</span><kbd>${esc(k)}</kbd></a>`).join('')).join('');
  $$('#nav a').forEach(a => a.onclick = () => go(a.dataset.go, JSON.parse(a.dataset.p)));
  $('#status').innerHTML = `<span><b>F4</b> Contra</span><span><b>F5</b> Payment</span><span><b>F6</b> Receipt</span><span><b>F7</b> Journal</span><span><b>F8</b> Sales</span><span><b>F9</b> Purchase</span><span><b>Alt+C</b> Create master</span><span><b>Ctrl+S</b> Save</span><span><b>Ctrl+P</b> Print</span><span><b>Esc</b> Back</span><span style="flex:1"></span><span id="sinfo"></span>`;
}
function setTop() {
  const s = APP.settings; $('#tcname').innerHTML = `${esc(s.name || '')}<small>${s.gstin ? 'GSTIN ' + esc(s.gstin) : ''}</small>`;
  $('#tfy').innerHTML = (APP.info.company.fyList || []).map(f => `<option value="${f.start}" ${APP.fy && APP.fy.start === f.start ? 'selected' : ''}>${f.label}</option>`).join('');
  $('#tdate').value = APP.date; $('#tuser').textContent = `${APP.user.username} (${APP.user.role})`;
  $('#sinfo').textContent = `Data: ${APP.info.dataDir}`;
}
async function enterCompany(info) {
  invalidate(); const cacheP = loadCache(true);       // v2.1: app info + all master lists in one trip
  APP.info = await api('app.info'); APP.settings = info.settings;
  const fyl = info.fyList; APP.date = U.today(); APP.fy = fyl.find(f => f.start === U.fyOf(APP.date).start) || fyl[0];
  if (APP.fy && (APP.date < APP.fy.start || APP.date > APP.fy.end)) APP.date = APP.fy.end;
  $('#login').classList.add('hidden'); $('#companies').classList.add('hidden'); $('#app').classList.remove('hidden');
  applyBrand(); buildNav(); setTop(); APP.stack = []; APP.current = null; await cacheP; go('dashboard');
  if (window.rsLiveStart) window.rsLiveStart();     // v2.2: live updates from other users
}
async function refreshCompany() { const info = await api('company.info'); APP.settings = info.settings; APP.info.company = info; setTop(); }

// ---------- login & company select ----------
// v2.1 login-first: the same login screen serves the Windows app (online mode = the built-in hosted server, or offline mode
// = files on this PC), the Android app and the browser. Where it runs decides the small links under the form.
function loginCtx() { if (window.rs && window.rs.android) return 'android'; if (window.rs && window.rs.shell) return 'shell'; return APP.info && APP.info.server ? 'web' : 'local'; }
function lastUser() { try { return localStorage.getItem('rs.lastUser') || ''; } catch (_) { return ''; } }
function setConn(state, text) {
  const c = $('#lconn'); if (!c) return;
  c.classList.toggle('hidden', !state); c.dataset.state = state || '';
  $('#lconnt').textContent = text || ''; $('#lretry').classList.toggle('hidden', state !== 'fail');
  $('#lbtn').disabled = state === 'wait';
}
function paintLoginExtras() {
  const ctx = loginCtx(); const info = APP.info || {};
  const mode = $('#lmode'); const alt = $('#lalt'); const rem = $('#lremw'); const sb = $('#lserver');
  let modeHtml = '', altHtml = '';
  if (ctx === 'local') {
    modeHtml = '💻 <b>Offline mode</b> — sirf is PC pe · data on this PC only';
    altHtml = '<a href="#" id="ladv">Advanced: apna server</a>';
  } else if (ctx === 'shell') {
    const custom = window.rs.shell.custom;
    modeHtml = '☁ <b>Online</b> — ek baar login, data har jagah · login once, data everywhere' + (custom ? `<small>Server: ${esc(window.rs.shell.server || location.host)}</small>` : '');
    altHtml = '<a href="#" id="loffline">💻 Offline mode (sirf is PC pe)</a><span>·</span><a href="#" id="ladv">Advanced: apna server</a>' + (custom ? '<span>·</span><a href="#" id="ldefsrv">Default server pe wapas</a>' : '');
  } else if (ctx === 'android') {
    modeHtml = '☁ <b>Online</b> — ek baar login, data har jagah · login once, data everywhere';
  } else {
    modeHtml = '☁ Online · ' + esc(location.host);
    altHtml = '<a href="../" id="lapps">📲 Windows / Android app download</a>';
  }
  mode.innerHTML = modeHtml; mode.classList.toggle('hidden', !modeHtml);
  alt.innerHTML = altHtml; alt.classList.toggle('hidden', !altHtml);
  rem.classList.toggle('hidden', ctx !== 'web');
  if (sb) { sb.classList.toggle('hidden', ctx !== 'local' || !info.canConnectServer); sb.onclick = () => api('app.useCloud').catch(fail); }
  const on = (id, fn) => { const el = $('#' + id); if (el) el.onclick = e => { e.preventDefault(); fn(); }; };
  on('ladv', connectServerDialog);
  on('loffline', () => window.rs.shell.offline());
  on('ldefsrv', () => window.rs.shell.resetServer());
  const wm = $('#lweb'); if (wm) wm.classList.add('hidden');
}
async function showLogin(info, keepTyped) {
  APP.info = info || await api('app.info'); applyBrand();
  $('#app').classList.add('hidden'); $('#companies').classList.add('hidden'); $('#login').classList.remove('hidden');
  $('#lver').textContent = `Version ${APP.info.version}`; if (!keepTyped) $('#lp').value = ''; $('#lerr').textContent = ''; setConn(null);
  $('#lhint').classList.toggle('hidden', !APP.info.firstRun);
  if (APP.info.firstRun && !$('#lu').value) $('#lu').value = 'admin';
  paintLoginExtras();
  const typed = keepTyped && ($('#lp').value || document.activeElement === $('#lu') || document.activeElement === $('#lp'));
  if (!typed) {
    const lu = loginCtx() !== 'local' ? lastUser() : ''; if (lu && !APP.loginTouched && !APP.info.firstRun) $('#lu').value = lu;   // offline mode: unchanged (no remembered user)
    setTimeout(() => { if (!$('#lu').value) $('#lu').focus(); else $('#lp').focus(); }, 60);
  }
}
function loginErrorText(err) {
  const code = err && err.code;
  if (code === 'bad_login') return 'Galat username ya password. (Wrong username or password.)';
  if (code === 'rate_limited') return 'Bahut baar galat password — thoda ruko. ' + err.message;
  return (err && err.message) || String(err);
}
$('#lpeye').onclick = () => { const p = $('#lp'); p.type = p.type === 'password' ? 'text' : 'password'; p.focus(); };
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault(); if ($('#lbtn').disabled) return;
  $('#lerr').textContent = ''; APP.loginTouched = true;
  const u = $('#lu').value.trim(), p = $('#lp').value;
  if (!u || !p) { $('#lerr').textContent = 'Username aur password dono likho. (Enter username and password.)'; return; }
  const ctx = loginCtx(); const remember = ctx === 'shell' || ctx === 'android' || (ctx === 'web' && $('#lrem').checked);
  const btn = $('#lbtn'); const label = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Logging in…';
  try {
    let lr = await api('auth.login', u, p, { remember });
    if (lr && lr.otp) { btn.disabled = false; btn.innerHTML = label; lr = await window.rsOtpStep(lr); if (!lr) return; }   // v2.2: email OTP step
    APP.user = lr; APP.lastPw = p;
    if (loginCtx() !== 'local') { try { localStorage.setItem('rs.lastUser', APP.user.username); } catch (_) {} }
    if (window.rsAfterLogin) window.rsAfterLogin(APP.user);
    btn.disabled = false; btn.innerHTML = label;
    if (APP.user.mustChange) { const ok = await changePassword(true); APP.lastPw = null; if (!ok) { await api('auth.logout').catch(() => {}); return; } APP.user.mustChange = false; }
    APP.lastPw = null;
    await showCompanies();
  } catch (err) { $('#lerr').textContent = loginErrorText(err); }
  finally { btn.disabled = false; btn.innerHTML = label; }
});
async function connectServerDialog() {
  const shell = window.rs && window.rs.shell;
  const v = await promptBox('Advanced: apna server (your own server)', [{ k: 'url', label: 'Server address', w: 2, help: 'Sirf tab jab aapka apna R&S Sons server ho · e.g. http://192.168.1.10:8080 or https://accounts.example.com' }], { url: (shell ? (shell.custom ? shell.server : '') : APP.info.serverUrl) || '' });
  if (!v || !v.url) return;
  try { if (shell) await shell.setServer(v.url.trim()); else await api('app.setServer', v.url.trim()); } catch (e) { fail(e); }
}
// Android back button (and any "go back" request from the app shell): true = handled here, false = let the app close
window.rsBack = function () {
  const dv = document.getElementById('docview'); if (dv && !dv.classList.contains('hidden')) { const c = dv.querySelector('.dv-c'); if (c) c.click(); return true; }
  if (!$('#combo').classList.contains('hidden')) { hideCombo(); return true; }
  if (isModal()) { closeModal(null); return true; }
  if ($('#nav').classList.contains('open')) { $('#nav').classList.remove('open'); return true; }
  if (!$('#app').classList.contains('hidden')) {
    if (APP.stack.length || (APP.current && APP.current.name !== 'dashboard')) { back(); return true; }
    showCompanies(); return true;
  }
  return false;
};
// File picker usable from every screen (desktop and browser): resolves { name, size, b64, dataUrl, file } or null
function pickFile(accept) {
  if (window.rs && window.rs.pickFile) return window.rs.pickFile(accept);
  return new Promise(resolve => { const i = document.createElement('input'); i.type = 'file'; if (accept) i.accept = accept; i.style.display = 'none';
    i.onchange = () => { const f = i.files && i.files[0]; i.remove(); if (!f) return resolve(null); const rd = new FileReader(); rd.onload = () => resolve({ name: f.name, size: f.size, b64: String(rd.result).split(',')[1] || '', dataUrl: rd.result, file: f }); rd.readAsDataURL(f); };
    document.body.appendChild(i); i.click(); });
}
async function readTextFile(accept) { const f = await pickFile(accept); if (!f) return null; const bytes = Uint8Array.from(atob(f.b64), ch => ch.charCodeAt(0)); return { name: f.name, text: new TextDecoder('utf-8').decode(bytes), b64: f.b64 }; }
async function changePassword(force) {
  const r = await modal(`<h3>${force ? 'Set a new password' : 'Change password'}</h3>${force ? '<p>For security, please replace the default password.</p>' : ''}<p class="adm-help">At least 8 characters with letters and numbers, e.g. <b>Kashi@2026</b>. Not the username, not "admin123".</p><div class="form">${formHtml([{ k: 'old', label: 'Current password', type: 'password', w: 2 }, { k: 'n1', label: 'New password', type: 'password', w: 2 }, { k: 'n2', label: 'Repeat new password', type: 'password', w: 2 }])}</div><div class="err" id="cperr"></div><div class="actions"><button class="btn" data-a="no">Cancel</button><button class="btn primary" data-a="ok">Save</button></div>`,
    (box, close) => { if (force) $('#f_old', box).value = APP.lastPw || 'admin'; $('[data-a=no]', box).onclick = () => close(false); $('[data-a=ok]', box).onclick = async () => { const o = $('#f_old', box).value, a = $('#f_n1', box).value, b = $('#f_n2', box).value; if (a !== b) { $('#cperr', box).textContent = 'New passwords do not match'; return; } try { await api('auth.changePassword', o, a); toast('Password changed', 'ok'); close(true); } catch (e) { $('#cperr', box).textContent = e.message; } }; });
  return r;
}
async function showCompanies() {
  if (window.rsLiveStop) window.rsLiveStop();
  $('#login').classList.add('hidden'); $('#app').classList.add('hidden'); $('#companies').classList.remove('hidden');
  await api('company.close').catch(() => {});
  const list = await api('company.list'); APP.info = await api('app.info');
  const card = $('#compCard');
  applyBrand(); card.onkeydown = null;
  card.innerHTML = `<div class="brand"><img class="brand-img" src="${esc(brandImg())}"><div><h1>Select Company</h1><div>Logged in as ${esc(APP.user.username)} (${esc(APP.user.role)}) · data folder: ${esc(APP.info.dataDir)}</div></div></div>
    <div class="comp-list" id="clist">${list.length ? list.map((c, i) => `<div class="comp-row ${i === 0 ? 'sel' : ''}" data-id="${c.id}" tabindex="0"><div><b>${esc(c.name)}</b><div style="font-size:11.5px;color:var(--muted)">${c.gstin ? 'GSTIN ' + esc(c.gstin) + ' · ' : ''}${c.lastOpened ? 'last opened ' + U.fmtDate(c.lastOpened.slice(0, 10)) : 'never opened'} · ${(c.size / 1024).toFixed(0)} KB</div></div>${can('admin') ? `<button class="btn sm danger" data-del="${c.id}">Delete</button>` : ''}</div>`).join('') : '<div style="padding:20px;text-align:center;color:var(--muted)">No company yet. Create your first company to start.</div>'}</div>
    <div class="toolbar">${can('admin') ? '<button class="btn primary" id="cnew">+ Create Company <kbd>Alt+C</kbd></button><button class="btn" id="crestore">Restore from Backup</button><button class="btn" id="cdemo">Create Demo Company</button>' : ''}<span class="sp"></span>${can('admin') ? '<button class="btn" id="cadmin" title="Password, username, app name, icon, theme">⚙ Admin Settings</button>' : ''}<button class="btn" id="clogout">Logout</button>${APP.info.server ? '' : '<button class="btn" id="cquit">Exit</button>'}</div>`;
  // v2.1 Android: optional app lock with the phone's fingerprint / PIN
  const droid = window.rs && window.rs.android;
  if (droid && droid.lockState) {
    let st = {}; try { st = JSON.parse(droid.lockState() || '{}'); } catch (_) {}
    const tb = $('.toolbar', card); const b = document.createElement('button'); b.className = 'btn'; b.id = 'clock';
    const paintLock = on => { b.textContent = on ? '🔒 App lock: ON' : '🔓 App lock: OFF'; b.title = 'Fingerprint / phone PIN se app kholo'; };
    paintLock(!!st.on); b.onclick = () => droid.setLock(!/ON/.test(b.textContent));
    window.rsLockChanged = on => paintLock(!!on);
    tb.insertBefore(b, $('#clogout', card));
  }
  $$('.comp-row', card).forEach(r => { r.onclick = e => { if (e.target.dataset.del) return; openComp(r.dataset.id); }; r.onkeydown = e => { if (e.key === 'Enter') openComp(r.dataset.id); if (e.key === 'ArrowDown' && r.nextElementSibling) r.nextElementSibling.focus(); if (e.key === 'ArrowUp' && r.previousElementSibling) r.previousElementSibling.focus(); }; });
  $$('[data-del]', card).forEach(b => b.onclick = async e => { e.stopPropagation(); try { if (await api('company.delete', b.dataset.del)) showCompanies(); } catch (er) { fail(er); } });
  if ($('#cnew')) { $('#cnew').onclick = () => createCompanyDialog(); $('#crestore').onclick = async () => { try { const r = await api('company.restore'); if (r) { toast('Restored as "' + r.name + '"', 'ok'); showCompanies(); } } catch (e) { fail(e); } }; $('#cdemo').onclick = createDemo; }
  $('#clogout').onclick = async () => { await api('auth.logout'); APP.user = null; showLogin(); }; if ($('#cquit')) $('#cquit').onclick = () => api('app.quit');
  if ($('#cadmin')) $('#cadmin').onclick = () => { card.innerHTML = '<div class="toolbar"><button class="btn" id="cback">← Back to companies (Esc)</button></div><div id="admhost"></div>'; $('#cback').onclick = () => showCompanies(); card.onkeydown = e => { if (e.key === 'Escape' && !isModal()) showCompanies(); }; renderAdminSettings($('#admhost')); };
  const first = $('.comp-row', card); if (first) first.focus();
}
async function openComp(id) { try { const info = await api('company.open', id); await enterCompany(info); } catch (e) { fail(e); } }
const COMPANY_FIELDS = [
  { section: 'Company' }, { k: 'name', label: 'Company Name', req: true, w: 2 }, { k: 'mailing_name', label: 'Print Name (if different)', w: 2 },
  { k: 'address', label: 'Address', w: 2 }, { k: 'city', label: 'City' }, { k: 'pincode', label: 'PIN Code' },
  { k: 'state_code', label: 'State', type: 'select', options: U.STATES.map(s => [s[0], s[0] + ' - ' + s[1]]), def: '09' }, { k: 'phone', label: 'Phone' }, { k: 'email', label: 'Email' }, { k: 'website', label: 'Website' },
  { section: 'Tax' }, { k: 'gstin', label: 'GSTIN', upper: true, help: 'State is taken from GSTIN' }, { k: 'pan', label: 'PAN', upper: true }, { k: 'gst_registered', label: 'GST Registration', type: 'select', options: [['1', 'Regular (Tax Invoice)'], ['0', 'Unregistered / Composition (Bill of Supply)']], def: '1' },
  { k: 'gst_filing', label: 'GST return filing', type: 'select', options: [['monthly', 'Monthly GSTR-1 / 3B'], ['qrmp', 'Quarterly (QRMP)'], ['composition', 'Composition (CMP-08)']], def: 'monthly', help: 'Used for the due-date reminders' }, { k: 'tax_audit', label: 'Income-tax audit applies', type: 'select', options: [['0', 'No'], ['1', 'Yes (ITR due 31 Oct)']], def: '0' },
  { k: 'books_begin', label: 'Books Beginning From', type: 'date', req: true, def: U.fyOf(U.today()).start, help: 'Financial year: April–March' },
  { section: 'Bank & Invoice' }, { k: 'bank_name', label: 'Bank Name' }, { k: 'bank_acc', label: 'Account No.' }, { k: 'bank_ifsc', label: 'IFSC', upper: true }, { k: 'bank_branch', label: 'Branch' },
  { k: 'upi_id', label: 'UPI ID (for payment QR on invoice)', w: 2 }, { k: 'show_upi_qr', label: 'Print UPI payment QR on invoice', type: 'check', def: 1 }, { k: 'round_off', label: 'Round off invoice totals', type: 'check', def: 1 },
  { k: 'terms', label: 'Invoice Terms & Conditions', type: 'textarea', w: 4, def: '1. Goods once sold will not be taken back.\n2. Interest @18% p.a. will be charged if payment is not made within due date.\n3. Subject to local jurisdiction.' },
];
async function createCompanyDialog() {
  const vals = await promptBox('Create Company', COMPANY_FIELDS, {});
  if (!vals) return;
  try { const info = await api('company.create', vals); toast('Company created', 'ok'); await enterCompany(info); } catch (e) { fail(e); }
}
async function createDemo() {
  try {
    const info = await api('company.create', { name: 'R&S Sons Demo Traders', address: 'Shop 12, Godowlia Market', city: 'Varanasi', pincode: '221001', state_code: '09', gstin: (s => s + U.gstinChecksum(s))('09AAJFR1234K1Z'), pan: 'AAJFR1234K', phone: '0542-2400000', email: 'demo@example.com', books_begin: U.fyOf(U.today()).start, bank_name: 'State Bank of India', bank_acc: '00000012345678', bank_ifsc: 'SBIN0000001', upi_id: 'demo@sbi' });
    await enterCompany(info); await window.seedDemo(); await loadCache(true); toast('Demo company with sample entries ready', 'ok'); go('dashboard', {}, true);
  } catch (e) { fail(e); }
}

// ---------- keyboard ----------
const VKEYS = { F4: 'CNT', F5: 'PMT', F6: 'RCT', F7: 'JRN', F8: 'SAL', F9: 'PUR' };
document.addEventListener('keydown', async e => {
  if ($('#app').classList.contains('hidden')) { if (e.altKey && e.key.toLowerCase() === 'c' && $('#cnew')) { e.preventDefault(); createCompanyDialog(); } return; }
  const k = e.key;
  if (k === 'Escape') { if (!$('#combo').classList.contains('hidden')) return; e.preventDefault(); back(); return; }
  if (isModal()) return;
  if (!e.ctrlKey && !e.altKey && VKEYS[k]) { e.preventDefault(); go('voucher', { vtype: VKEYS[k] }); return; }
  if (e.ctrlKey && k === 'F8') { e.preventDefault(); go('voucher', { vtype: 'CRN' }); return; }
  if (e.ctrlKey && k === 'F9') { e.preventDefault(); go('voucher', { vtype: 'DBN' }); return; }
  if (k === 'F1') { e.preventDefault(); showCompanies(); return; }
  if (k === 'F2') { e.preventDefault(); $('#tdate').focus(); return; }
  if (e.ctrlKey && k.toLowerCase() === 'f') { e.preventDefault(); go('voucherList', {}); return; }
  if (e.ctrlKey && k.toLowerCase() === 'h') { e.preventDefault(); go('help'); return; }
  if (e.ctrlKey && k.toLowerCase() === 'k') { e.preventDefault(); quickSearch(); return; }
  if (e.altKey) {
    const m = { d: ['dashboard'], l: ['ledgerList'], i: ['itemList'], b: ['report', { r: 'dayBook' }], t: ['report', { r: 'trialBalance' }], p: ['report', { r: 'profitLoss' }], s: ['report', { r: 'balanceSheet' }], o: ['report', { r: 'outstanding', a: { kind: 'receivable' } }], r: ['reportsMenu'], u: ['utilities'] }[k.toLowerCase()];
    if (m && !(APP.current && APP.current.name === 'voucher' && ['p'].includes(k.toLowerCase()))) { e.preventDefault(); go(m[0], m[1] || {}); return; }
    if (k.toLowerCase() === 'c' && !(document.activeElement && document.activeElement.dataset.combo)) { e.preventDefault(); quickCreate(); return; }
  }
  if (APP.current && APP.current.keys) { const h = APP.current.keys(e); if (h) e.preventDefault(); }
});
async function quickCreate() {
  const r = await modal(`<h3>Create Master (Alt+C)</h3><div class="menu-grid">${[['Ledger / Party', 'ledgerEdit'], ['Stock Item', 'itemEdit'], ['Account Group', 'groupEdit'], ['Other masters', 'mastersMenu']].map(([l, s]) => `<div class="mi" tabindex="0" data-s="${s}"><b>${l}</b></div>`).join('')}</div>`,
    (box, close) => $$('.mi', box).forEach(m => { m.onclick = () => close(m.dataset.s); m.onkeydown = e => { if (e.key === 'Enter') close(m.dataset.s); }; }));
  if (r) go(r, {});
}
$('#tfy').onchange = () => { APP.fy = APP.info.company.fyList.find(f => f.start === $('#tfy').value); if (APP.date < APP.fy.start || APP.date > APP.fy.end) { APP.date = U.today() >= APP.fy.start && U.today() <= APP.fy.end ? U.today() : APP.fy.end; $('#tdate').value = APP.date; } render(); };
$('#tdate').onchange = () => { if (!$('#tdate').value) return; APP.date = $('#tdate').value; const fy = U.fyOf(APP.date); const f = APP.info.company.fyList.find(x => x.start === fy.start); if (f) { APP.fy = f; $('#tfy').value = f.start; } else toast('Date is outside the financial years of this company', 'err'); };
$('#tcomp').onclick = () => showCompanies();
// ---------- v2.1 quick search (🔍 / Ctrl+K): party, item, invoice no., amount, narration ----------
async function quickSearch() {
  if (!APP.info || !APP.info.company) return;
  await loadCache().catch(() => {});
  let seq = 0, timer = null;
  const vt = t => (APP.info.company.vtypes[t] || { name: t }).name;
  const r = await modal(`<h3>🔍 Search <small style="font-weight:400;color:var(--muted)">party · invoice no. · amount · item</small></h3>
    <div class="fld"><input id="qsq" placeholder="e.g. Sharma, INV/12, 4500" autocomplete="off" style="font-size:15px;padding:9px"></div>
    <div id="qsr" class="qs-res"><div class="qs-hint">Type at least 2 letters or digits</div></div>
    <div class="actions"><button class="btn" data-a="no">Close (Esc)</button></div>`, (box, close) => {
    $('[data-a=no]', box).onclick = () => close(null);
    const out = $('#qsr', box), inp = $('#qsq', box);
    const paint = (ledgers, items, vouchers, busy) => {
      const rows = [];
      for (const l of ledgers) rows.push(`<div class="qs-row" data-k="l" data-id="${l.id}"><span class="qs-t">👤 ${esc(l.name)}</span><small>${esc(l.group_name || '')}${l.gstin ? ' · ' + esc(l.gstin) : ''}</small></div>`);
      for (const i of items) rows.push(`<div class="qs-row" data-k="i" data-id="${i.id}"><span class="qs-t">📦 ${esc(i.name)}</span><small>₹${inr(i.sale_rate || 0)}${i.hsn ? ' · HSN ' + esc(i.hsn) : ''}</small></div>`);
      for (const v of vouchers) rows.push(`<div class="qs-row" data-k="v" data-id="${v.id}"><span class="qs-t">🧾 ${esc(vt(v.vtype))} ${esc(v.number || '')}</span><small>${U.fmtDate(v.date)} · ${esc(v.party_name || v.narration || '')} · ₹${inr(v.total)}</small></div>`);
      out.innerHTML = rows.join('') + (busy ? '<div class="qs-hint"><span class="spin"></span> Searching invoices…</div>' : rows.length ? '' : '<div class="qs-hint">Kuch nahi mila · nothing found</div>');
      $$('.qs-row', out).forEach(d => d.onclick = () => close({ k: d.dataset.k, id: +d.dataset.id }));
    };
    inp.oninput = () => {
      const q = inp.value.trim(); clearTimeout(timer); const my = ++seq;
      if (q.length < 2) { out.innerHTML = '<div class="qs-hint">Type at least 2 letters or digits</div>'; return; }
      const ql = q.toLowerCase();
      const ledgers = (APP.cache.ledgers || []).filter(l => (l.name + ' ' + (l.alias || '') + ' ' + (l.gstin || '') + ' ' + (l.phone || '')).toLowerCase().includes(ql)).slice(0, 8);
      const items = (APP.cache.items || []).filter(i => (i.name + ' ' + (i.code || '') + ' ' + (i.barcode || '') + ' ' + (i.alias || '')).toLowerCase().includes(ql)).slice(0, 5);
      paint(ledgers, items, [], true);
      timer = setTimeout(async () => {
        let vs = []; try { vs = await C('vouchers', { q: q.replace(/[₹,]/g, ''), limit: 400 }); } catch (_) {}
        if (my !== seq) return;
        vs = vs.slice(-25).reverse();     // newest first
        paint(ledgers, items, vs, false);
      }, 250);
    };
    inp.onkeydown = e => { if (e.key === 'Enter') { const f = $('.qs-row', out); if (f) f.click(); } };
  });
  if (!r) return;
  if (r.k === 'v') go('voucher', { id: r.id });
  else if (r.k === 'l') go('report', { r: 'ledgerStatement', a: { ledger_id: r.id } });
  else if (r.k === 'i') go('itemEdit', { id: r.id });
}
$('#tsearch').onclick = () => quickSearch();
$('#ttheme').onclick = () => toggleTheme();

$('#tmenu').onclick = (e) => { e.stopPropagation(); $('#nav').classList.toggle('open'); };
document.addEventListener('click', e => { const n = $('#nav'); if (n.classList.contains('open') && (!n.contains(e.target) || e.target.closest('a'))) n.classList.remove('open'); });
$('#tlogout').onclick = async () => { await api('auth.logout'); APP.user = null; showLogin(); };
document.addEventListener('scroll', e => { const b = $('#combo'); if (b.classList.contains('hidden') || b.contains(e.target) || e.target === b) return; if (COMBO.input && document.activeElement === COMBO.input) { const r = COMBO.input.getBoundingClientRect(); const below = window.innerHeight - r.bottom; b.style.left = r.left + 'px'; b.style.top = (below > 220 ? r.bottom + 2 : Math.max(4, r.top - 302)) + 'px'; } else hideCombo(); }, true);
window.addEventListener('resize', hideCombo);

// ---------- helpers ----------
function money(n) { n = Number(n) || 0; return `<span class="${n < 0 ? 'neg' : ''}">₹ ${inr(n)}</span>`; }
function vtName(t) { return APP.info.company.vtypes[t].name; }
async function withBusy(btn, fn) { const t = btn && btn.innerHTML; if (btn) { btn.disabled = true; btn.innerHTML = 'Working…'; } try { return await fn(); } catch (e) { fail(e); } finally { if (btn) { btn.disabled = false; btn.innerHTML = t; } } }
window.addEventListener('DOMContentLoaded', () => {});
// Start: an existing login (cookie / app session) goes straight back to where the user was. Online, the first call can be
// slow (no internet, or the server waking up) — the login card shows "Connecting…" with Retry instead of a blank window.
async function startApp() {
  let info = null;
  const online = !!(window.rs && window.rs.web);
  if (online) {
    $('#login').classList.remove('hidden'); paintLoginExtras(); setConn('wait', 'Connecting… · जुड़ रहा है');
    const slow = setTimeout(() => { if ($('#lconn').dataset.state === 'wait') setConn('wait', 'Server jag raha hai… pehli baar 10-30 sec lag sakte hain · Server is waking up'); }, 6000);
    try { info = await api('app.info'); } catch (e) { clearTimeout(slow); setConn('fail', e.message); $('#lretry').onclick = () => { setConn('wait', 'Connecting… · जुड़ रहा है'); startApp(); }; return; }
    clearTimeout(slow); setConn(null);
  }
  try {
    if (!info) info = await api('app.info');
    if (info.server && info.user && !info.user.mustChange) {
      APP.info = info; APP.user = info.user; if (window.rsAfterLogin) window.rsAfterLogin(APP.user);
      if (info.company) { try { await enterCompany(info.company); return; } catch (_) {} }
      await showCompanies(); return;
    }
  } catch (_) {}
  showLogin(info || undefined, true).catch(e => { setConn('fail', e.message); $('#lretry').onclick = () => startApp(); });
}
setTimeout(startApp, 0);
