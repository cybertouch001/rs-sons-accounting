// R&S Sons Accounting v2.4 — (1) create a unit right from the item screen + Units master, (2) the admin can remove any user and
// every device of that user is logged out within seconds, (3) "Logged-in devices": which account is logged in on which device.
'use strict';
(function () {
  const online = () => !!(APP.info && APP.info.server);
  const UQC_LIST = ['NOS', 'PCS', 'KGS', 'GMS', 'LTR', 'MLT', 'MTR', 'BOX', 'DOZ', 'PAC', 'SET', 'BAG', 'BTL', 'CTN', 'QTL', 'TON', 'SQM', 'SQF', 'UNT', 'OTH'];
  const UNIT_FIELDS = [{ k: 'name', label: 'Unit name', req: true, ph: 'e.g. Carton, Kg, Pair' }, { k: 'uqc', label: 'GST UQC (unit code on GST returns)', type: 'select', options: UQC_LIST.map(x => [x, x]) }, { k: 'decimals', label: 'Decimal places in quantity (0–4)', type: 'number' }];
  function guessUqc(name) { const n = String(name || '').toLowerCase().replace(/[^a-z]/g, ''); const M = { nos: 'NOS', no: 'NOS', number: 'NOS', pcs: 'PCS', pc: 'PCS', piece: 'PCS', pieces: 'PCS', kg: 'KGS', kgs: 'KGS', kilo: 'KGS', gm: 'GMS', gms: 'GMS', gram: 'GMS', g: 'GMS', ltr: 'LTR', litre: 'LTR', liter: 'LTR', l: 'LTR', ml: 'MLT', mtr: 'MTR', meter: 'MTR', metre: 'MTR', m: 'MTR', box: 'BOX', boxes: 'BOX', dozen: 'DOZ', doz: 'DOZ', pack: 'PAC', packet: 'PAC', pkt: 'PAC', set: 'SET', bag: 'BAG', bottle: 'BTL', btl: 'BTL', carton: 'CTN', ctn: 'CTN', quintal: 'QTL', qtl: 'QTL', ton: 'TON', tonne: 'TON', sqm: 'SQM', sqft: 'SQF', unit: 'UNT', units: 'UNT' }; return M[n] || 'OTH'; }
  // The one place a new unit is made (item screen, Units master): returns the saved unit {id, name} or null
  async function createUnit(prefill) {
    const v = await promptBox('Create new unit', UNIT_FIELDS, { name: prefill || '', uqc: guessUqc(prefill), decimals: 0 });
    if (!v) return null;
    try {
      const id = await C('saveSimple', 'units', { name: String(v.name || '').trim(), uqc: v.uqc, decimals: Number(v.decimals) || 0 });
      const c = await loadCache(true); const u = (c.units || []).find(x => x.id === id) || { id, name: v.name };
      toast(`Unit "${u.name}" created — it is now in the Unit list for everyone in this company`, 'ok'); return u;
    } catch (e) { fail(e); return null; }
  }
  window.rsCreateUnit = createUnit;
  const unitLabel = x => x.name + (x.uqc ? ' (' + x.uqc + ')' : '');

  // ---------------------------------------------------------------- 1. UNITS ----------------------------------------------------------------
  // Item screen: the Unit drop-down keeps every unit AND ends with "+ Create new unit…"; a "+ New unit" link sits next to it too.
  const _itemEdit = SCREENS.itemEdit;
  SCREENS.itemEdit = async (el, p) => {
    await _itemEdit(el, p);
    const sel = $('#f_unit_id', el); if (!sel) return;
    const canCreate = can('operator');
    const fill = (selId) => { const c = APP.cache; sel.innerHTML = (c.units || []).map(x => `<option value="${x.id}" ${String(x.id) === String(selId) ? 'selected' : ''}>${esc(unitLabel(x))}</option>`).join('') + (canCreate ? '<option value="__new">+ Create new unit…</option>' : ''); };
    let last = sel.value; fill(last);
    if (!canCreate) return;
    const lab = sel.closest('.fld') && $('label', sel.closest('.fld'));
    if (lab) lab.insertAdjacentHTML('beforeend', ' <a href="#" id="unew" class="unew" title="Create a new unit">+ New unit</a>');
    const make = async () => { const u = await createUnit(''); if (u) { fill(u.id); last = String(u.id); APP.current.dirty = true; } else fill(last); sel.focus(); };
    sel.addEventListener('change', () => { if (sel.value === '__new') make(); else last = sel.value; });
    const a = $('#unew', el); if (a) a.onclick = e => { e.preventDefault(); make(); };
  };

  // Units master: list with how many items use each unit; create / alter / delete (delete only when no item uses it)
  SCREENS.units = async (el) => {
    let rows = await C('unitsUsage');
    const edit = async (r) => {
      if (!r) { const u = await createUnit(''); if (u) render(); return; }
      const v = await promptBox('Alter unit', UNIT_FIELDS, r); if (!v) return;
      try { await C('saveSimple', 'units', { id: r.id, name: String(v.name || '').trim(), uqc: v.uqc, decimals: Number(v.decimals) || 0 }); await loadCache(true); toast('Unit saved', 'ok'); render(); } catch (e) { fail(e); }
    };
    listScreen(el, { title: 'Units of Measure', rows, onNew: can('operator') ? () => edit(null) : null, onOpen: r => can('operator') ? edit(r) : null,
      cols: [{ k: 'name', label: 'Unit' }, { k: 'uqc', label: 'GST UQC' }, { k: 'decimals', label: 'Decimals', r: 1 }, { k: 'items', label: 'Used by items', r: 1, f: r => r.items ? String(r.items) : '<span style="color:var(--muted)">not used</span>' },
        { k: 'act', label: '', f: r => `<span class="uacts">${can('operator') ? `<button class="btn sm" data-ue="${r.id}">Edit</button>` : ''}${can('admin') ? `<button class="btn sm danger" data-ud="${r.id}" ${r.items ? 'disabled title="In use by ' + r.items + ' item(s) — cannot delete"' : ''}>Delete</button>` : ''}</span>` }],
      extra: '<span style="color:var(--muted);font-size:12px">New units also appear in the Unit list of every item. A unit used by an item cannot be deleted.</span>' });
    const tb = $('#lb', el);
    tb.addEventListener('click', async e => {
      const b = e.target.closest('button'); if (!b) return; e.stopPropagation();
      const r = rows.find(x => String(x.id) === (b.dataset.ue || b.dataset.ud)); if (!r) return;
      if (b.dataset.ue) return edit(r);
      if (b.dataset.ud && await confirmBox(`Delete unit "${r.name}"?`, 'Delete', true)) { try { await C('deleteSimple', 'units', r.id); await loadCache(true); toast('Unit deleted', 'ok'); render(); } catch (err) { fail(err); } }
    }, true);
  };

  // ---------------------------------------------------------------- 2+3. DEVICES / REMOVE USER ----------------------------------------------------------------
  const fmtT = ms => { if (!ms) return ''; const d = new Date(ms); return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }); };
  const ago = (ms, now) => { const s = Math.max(0, Math.round(((now || Date.now()) - ms) / 1000)); if (s < 90) return 'active now'; const m = Math.round(s / 60); if (m < 60) return m + ' min ago'; const h = Math.round(m / 60); if (h < 36) return h + ' h ago'; return Math.round(h / 24) + ' days ago'; };
  const ICON = { android: '📱', desktop: '💻', web: '🌐' };
  function devCell(s) { return `<div class="dv-name">${ICON[s.client] || '🌐'} <b>${esc(s.device || (s.client === 'android' ? 'Android phone' : s.client === 'desktop' ? 'Windows PC' : 'Browser'))}</b>${s.current ? ' <span class="pill">this device</span>' : ''}</div><div class="dv-sub">${esc(s.clientLabel)}${s.appVer ? ' ' + esc(s.appVer) : ''}${s.os ? ' · ' + esc(s.os) : ''}${s.stayLoggedIn ? ' · stays logged in' : ''}</div>`; }
  function sessRow(s, now, admin) {
    return `<tr><td>${devCell(s)}</td><td>${esc(s.ip || '—')}${s.place ? `<div class="dv-sub">${esc(s.place)}</div>` : ''}</td><td>${esc(fmtT(s.loginAt))}</td><td>${esc(ago(s.lastActive, now))}<div class="dv-sub">${esc(fmtT(s.lastActive))}</div></td>
      <td class="r">${s.current ? '<span style="color:var(--muted);font-size:12px">use Logout</span>' : `<button class="btn sm danger" data-ro-ok="1" data-out="${esc(s.id)}">Log out this device</button>`}</td></tr>`;
  }
  const TH = '<thead><tr><th>Device / app</th><th>IP address · approx. place</th><th>Logged in</th><th>Last active</th><th></th></tr></thead>';
  let devTimer = null;
  function autoRefresh(screen) { clearTimeout(devTimer); devTimer = setTimeout(() => { if (APP.current && APP.current.name === screen && !isModal() && !document.hidden) render(); else if (APP.current && APP.current.name === screen) autoRefresh(screen); }, 15000); }

  // Admin: every account, every device it is logged in on
  SCREENS.devices = async (el, p) => {
    if (!online()) { el.innerHTML = '<h2 class="title">Logged-in Devices</h2><div class="card">This works with the online server (Windows app online mode, Android app, web). In offline mode the company files are on this PC only.</div>'; return; }
    if (!can('admin')) return go('myDevices', {}, true);
    const [d, hist] = await Promise.all([api('sessions.list', 'all'), api('sessions.loginHistory')]);
    const by = {}; for (const s of d.sessions) (by[s.username] = by[s.username] || []).push(s);
    const users = d.users.slice().sort((a, b) => (by[b.username] ? 1 : 0) - (by[a.username] ? 1 : 0) || a.username.localeCompare(b.username));
    const q = (p && p.q) || '';
    const card = u => { const list = by[u.username] || []; const me = u.username.toLowerCase() === APP.user.username.toLowerCase();
      return `<div class="card dv-card" data-u="${esc(u.username)}"><div class="dv-head"><div><b style="font-size:15px">${esc(u.username)}</b>${u.fullName ? ' · ' + esc(u.fullName) : ''} <span class="pill grey">${esc(u.role)}</span>${u.active ? '' : ' <span class="pill red">deactivated</span>'}${me ? ' <span class="pill">you</span>' : ''}
        <div class="dv-sub">${list.length ? `Logged in on <b>${list.length}</b> device${list.length === 1 ? '' : 's'}` : 'Not logged in on any device'}${u.lastLogin ? ' · last login ' + esc(fmtT(Date.parse(u.lastLogin))) : ''}</div></div>
        <div class="dv-acts">${list.filter(s => !s.current).length ? `<button class="btn" data-ro-ok="1" data-all="${esc(u.username)}">Log out all devices</button>` : ''}${!me ? `<button class="btn danger" data-ro-ok="1" data-rm="${esc(u.username)}">Remove user…</button>` : ''}</div></div>
        ${list.length ? `<div class="tbl-wrap"><table class="tbl dv-tbl">${TH}<tbody>${list.map(s => sessRow(s, d.now, true)).join('')}</tbody></table></div>` : ''}</div>`; };
    el.innerHTML = `<h2 class="title">Logged-in Devices <small>${d.sessions.length} active login${d.sessions.length === 1 ? '' : 's'} · ${users.length} users</small></h2>
      <div class="toolbar"><input id="dvq" placeholder="Search user / device / IP…" style="width:260px" value="${esc(q)}"><button class="btn" data-ro-ok="1" id="dvr">↻ Refresh</button><span class="sp"></span><button class="btn" data-ro-ok="1" id="dvmine">My devices</button><button class="btn" id="dvusers">Users & Roles</button></div>
      <p class="adm-help">Which account is logged in on which phone / PC / browser. <b>Log out this device</b> ends that login at once; <b>Remove user</b> deactivates or deletes the user and logs out every device of that user — the app on those devices goes back to the login screen within a few seconds. Updates every 15 s.</p>
      <div id="dvlist">${users.map(card).join('')}</div>
      <div class="card"><h3 style="margin-top:0">Login history <small style="font-weight:normal;color:var(--muted)">latest ${hist.length} · logins, failed logins and log-outs</small></h3><div class="tbl-wrap" style="max-height:340px"><table class="tbl"><thead><tr><th>When</th><th>User</th><th>What</th><th>Device / details</th><th>IP</th></tr></thead><tbody>${hist.map(h => `<tr class="${/failed/i.test(h.action) ? 'warn' : ''}"><td>${esc(fmtT(Date.parse(h.at)))}</td><td>${esc(h.user)}</td><td>${esc(h.action)}</td><td class="wrap">${esc(h.detail || '')}</td><td>${esc(h.ip || '')}</td></tr>`).join('') || '<tr><td colspan="5" style="color:var(--muted)">No logins recorded yet</td></tr>'}</tbody></table></div></div>`;
    const filt = () => { const t = $('#dvq').value.toLowerCase(); $$('.dv-card', el).forEach(c => c.classList.toggle('hidden', !!t && !c.textContent.toLowerCase().includes(t))); };
    $('#dvq').oninput = filt; filt();
    $('#dvr').onclick = () => render(); $('#dvmine').onclick = () => go('myDevices'); $('#dvusers').onclick = () => go('users');
    el.onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.out) { if (!await confirmBox('Log out this device now? Whoever is using it must log in again.', 'Log out device', true)) return; return withBusy(b, async () => { await api('sessions.revoke', b.dataset.out); toast('Device logged out', 'ok'); render(); }); }
      if (b.dataset.all) { if (!await confirmBox(`Log out "${b.dataset.all}" on all devices now?`, 'Log out all', true)) return; return withBusy(b, async () => { const r = await api('sessions.revokeUser', b.dataset.all); toast(`${r.loggedOut} device${r.loggedOut === 1 ? '' : 's'} logged out`, 'ok'); render(); }); }
      if (b.dataset.rm) return removeUser(b.dataset.rm, d.users.find(x => x.username === b.dataset.rm), (by[b.dataset.rm] || []).length);
    };
    autoRefresh('devices');
  };
  // Remove a user: deactivate (can be undone in Users & Roles) or delete — both log the user out of every device at once
  async function removeUser(username, u, nDev) {
    const r = await modal(`<h3>Remove user "${esc(username)}"</h3>
      <p>${nDev ? `This user is logged in on <b>${nDev}</b> device${nDev === 1 ? '' : 's'}. ` : ''}Every device of this user is logged out at once, and the user cannot log in again.</p>
      <label class="rm-opt"><input type="radio" name="rmm" value="deactivate" checked> <b>Deactivate</b> — keep the user (and its name in the audit trail); you can switch it on again later in Users & Roles</label>
      <label class="rm-opt"><input type="radio" name="rmm" value="delete"> <b>Delete</b> — remove the user completely</label>
      <div class="actions"><button class="btn" data-a="no">Cancel</button><button class="btn danger" data-a="ok">Remove user</button></div>`,
      (box, close) => { $('[data-a=no]', box).onclick = () => close(null); $('[data-a=ok]', box).onclick = () => close(($('input[name=rmm]:checked', box) || {}).value || 'deactivate'); });
    if (!r) return;
    try { const x = await api('users.remove', username, r); toast(`${username} ${x.mode === 'delete' ? 'deleted' : 'deactivated'} · ${x.loggedOut} device${x.loggedOut === 1 ? '' : 's'} logged out`, 'ok'); render(); } catch (e) { fail(e); }
  }
  window.rsRemoveUser = removeUser;

  // Every user: my own devices (phone, PC, browser) — log out a lost phone from the PC
  SCREENS.myDevices = async (el) => {
    if (!online()) { el.innerHTML = '<h2 class="title">My Devices</h2><div class="card">This works with the online server only.</div>'; return; }
    const [d, hist] = await Promise.all([api('sessions.list', 'mine'), api('sessions.loginHistory')]);
    const others = d.sessions.filter(s => !s.current).length;
    el.innerHTML = `<h2 class="title">My Devices <small>${esc(APP.user.username)} · logged in on ${d.sessions.length} device${d.sessions.length === 1 ? '' : 's'}</small></h2>
      <div class="toolbar"><button class="btn" data-ro-ok="1" id="mdr">↻ Refresh</button>${others ? '<button class="btn danger" data-ro-ok="1" id="mdall">Log out all other devices</button>' : ''}<span class="sp"></span>${can('admin') ? '<button class="btn" data-ro-ok="1" id="mdadm">All users\' devices</button>' : ''}</div>
      <p class="adm-help">Where your account is logged in right now. Lost a phone, or used someone else's PC? Log that device out here. If you do not recognise a device, log it out and change your password.</p>
      <div class="card"><div class="tbl-wrap"><table class="tbl dv-tbl">${TH}<tbody>${d.sessions.map(s => sessRow(s, d.now, false)).join('')}</tbody></table></div></div>
      <div class="card"><h3 style="margin-top:0">My recent logins</h3><div class="tbl-wrap" style="max-height:300px"><table class="tbl"><thead><tr><th>When</th><th>What</th><th>Device / details</th><th>IP</th></tr></thead><tbody>${hist.map(h => `<tr class="${/failed/i.test(h.action) ? 'warn' : ''}"><td>${esc(fmtT(Date.parse(h.at)))}</td><td>${esc(h.action)}</td><td class="wrap">${esc(h.detail || '')}</td><td>${esc(h.ip || '')}</td></tr>`).join('')}</tbody></table></div></div>`;
    $('#mdr').onclick = () => render(); if ($('#mdadm')) $('#mdadm').onclick = () => go('devices');
    if ($('#mdall')) $('#mdall').onclick = async () => { if (!await confirmBox('Log out all your other devices?', 'Log out', true)) return; withBusy($('#mdall'), async () => { const r = await api('sessions.revokeUser', ''); toast(`${r.loggedOut} device${r.loggedOut === 1 ? '' : 's'} logged out`, 'ok'); render(); }); };
    el.onclick = async e => { const b = e.target.closest('button[data-out]'); if (!b) return; if (!await confirmBox('Log out this device now?', 'Log out device', true)) return; withBusy(b, async () => { await api('sessions.revoke', b.dataset.out); toast('Device logged out', 'ok'); render(); }); };
    autoRefresh('myDevices');
  };

  // Users & Roles: two more buttons — Logged-in devices, Remove user
  const _users = SCREENS.users;
  SCREENS.users = async (el, p) => {
    await _users(el, p);
    if (!online() || !can('admin')) return;
    const tb = $('.toolbar', el); if (!tb) return;
    tb.insertAdjacentHTML('beforeend', '<button class="btn" data-ro-ok="1" id="udev">🔌 Logged-in devices</button><button class="btn danger" id="urm">Remove user…</button>');
    $('#udev').onclick = () => go('devices');
    $('#urm').onclick = async () => {
      const list = await api('users.list'); const others = list.filter(u => u.username.toLowerCase() !== APP.user.username.toLowerCase());
      if (!others.length) return toast('There is no other user', 'err');
      const cur = $('#lb tr.cur', el); const sel = cur && el.__shown ? el.__shown[+cur.dataset.i] : null;
      const v = await promptBox('Remove which user?', [{ k: 'u', label: 'User', type: 'select', options: others.map(u => [u.username, u.username + (u.fullName ? ' — ' + u.fullName : '') + ' (' + u.role + (u.active ? '' : ', deactivated') + ')']) }], { u: sel && sel.username !== APP.user.username ? sel.username : others[0].username });
      if (!v) return; let n = 0; try { const d = await api('sessions.list', 'all'); n = d.sessions.filter(s => s.username === v.u).length; } catch (_) {}
      removeUser(v.u, others.find(u => u.username === v.u), n);
    };
  };

  // Utilities: "Logged-in Devices" (admin) and "My Devices" (everyone, viewers too)
  const _util = SCREENS.utilities;
  SCREENS.utilities = (el, p) => {
    _util(el, p);
    if (!online()) return;
    const g = $('.menu-grid', el); if (!g) return;
    const add = (s, t, d) => g.insertAdjacentHTML('afterbegin', `<div class="mi" tabindex="0" data-s="${s}" data-p='{}'><b>${t}</b><span>${d}</span></div>`);
    add('myDevices', 'My Devices', 'Where your account is logged in · log out a lost phone');
    if (can('admin')) add('devices', 'Logged-in Devices', 'Which user is logged in on which phone / PC · log out a device or remove a user');
    bindMenu(el);
  };

  // ---------------------------------------------------------------- "still logged in?" ----------------------------------------------------------------
  // With a company open the live-updates call (every 3 s) notices a logout; on the company list / other screens this ping does it.
  let pingT = null;
  function ping() {
    clearTimeout(pingT); pingT = null;
    if (!online() || !APP.user || !window.rs || !window.rs.api) return;
    const companyOpen = !!(APP.info.company && APP.info.company.id) && !$('#app').classList.contains('hidden');
    const next = () => { pingT = setTimeout(ping, document.hidden ? 20000 : 5000); };
    if (companyOpen) return next();
    api('auth.ping').then(next, e => { if (!(e && e.code === 'auth')) next(); });
  }
  const _after = window.rsAfterLogin;
  window.rsAfterLogin = function (u) { if (_after) _after(u); setTimeout(ping, 3000); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden && pingT) ping(); });
  setTimeout(() => { if (APP.user) ping(); }, 6000);

  // Login screen: say why this device was logged out (admin removed the user / logged out this device)
  const _ple = paintLoginExtras;
  paintLoginExtras = function () {
    _ple();
    let msg = ''; try { msg = sessionStorage.getItem('rs.authMsg') || ''; } catch (_) {}
    const e = $('#lerr'); if (!e) return;
    if (msg) { e.textContent = '🔒 ' + msg; e.classList.add('kick'); } else e.classList.remove('kick');
  };
  // first page load after the logout: the login screen may already be drawn before this file ran — paint the reason then too
  const paintKick = () => { const l = document.getElementById('login'); if (l && !l.classList.contains('hidden')) { let msg = ''; try { msg = sessionStorage.getItem('rs.authMsg') || ''; } catch (_) {} const e = $('#lerr'); if (msg && e && !e.textContent) { e.textContent = '🔒 ' + msg; e.classList.add('kick'); } } };
  [200, 800, 2000, 4000].forEach(t => setTimeout(paintKick, t));
  // the reason stays on the login screen until the next login attempt
  const lf = document.getElementById('loginForm');
  if (lf) lf.addEventListener('submit', () => { try { sessionStorage.removeItem('rs.authMsg'); } catch (_) {} const e = $('#lerr'); if (e) e.classList.remove('kick'); }, true);
})();
