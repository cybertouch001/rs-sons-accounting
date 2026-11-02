// R&S Sons Accounting v2.2 — view-only users, live updates between users, email OTP login.
// Loaded after the other screen files; it hooks into app.js (go, buildNav, paintLoginExtras, utilities) without changing them.
'use strict';
(function () {
  const isViewer = () => !!(APP.user && APP.user.role === 'viewer');
  const RO_TITLE = 'View only — you can view, print and share, but not edit';
  function setViewMode() { document.body.classList.toggle('viewonly', isViewer()); }

  // ---------------------------------------------------------------- 1. VIEW-ONLY USERS ----------------------------------------------------------------
  // Screens a viewer never opens (setup, admin, data entry). The server refuses every write from a viewer anyway (HTTP 403).
  const VIEWER_BLOCKED = new Set(['backup', 'restore', 'autoBackups', 'dataFolder', 'users', 'adminSettings', 'emailOtp', 'otpSelf', 'importExport', 'sql', 'companyEdit', 'bankImport', 'physicalStock',
    'reminders', 'budgets', 'priceListEdit', 'bomEdit', 'labels', 'reminderLetters', 'recurring', 'orderMenu', 'stockMenu']);
  function viewerMayOpen(name, params) {
    if (!isViewer()) return true;
    if (VIEWER_BLOCKED.has(name)) return false;
    if (name === 'voucher' && !(params && params.id)) return false;   // a viewer can open a saved voucher to read it, never a new one
    if ((name === 'ledgerEdit' || name === 'itemEdit' || name === 'groupEdit') && !(params && params.id)) return false;
    return true;
  }
  const _go = go;
  go = function (name, params = {}, replace = false) {
    if (!viewerMayOpen(name, params)) { toast('👁 ' + RO_TITLE + ' (View only)', 'err'); return; }
    return _go(name, params, replace);
  };
  // Navigation for a viewer: only reading screens
  const _buildNav = buildNav;
  buildNav = function () {
    _buildNav(); setViewMode();
    if (!isViewer()) { addAdminLinks(); return; }
    $$('#nav a').forEach(a => { let p = {}; try { p = JSON.parse(a.dataset.p || '{}'); } catch (_) {} if (!viewerMayOpen(a.dataset.go, p)) a.remove(); });
    $$('#nav .sec').forEach(s => { let n = s.nextElementSibling; let any = false; while (n && !n.classList.contains('sec')) { if (n.tagName === 'A') any = true; n = n.nextElementSibling; } if (!any) s.remove(); });
    $('#status').innerHTML = `<span class="ro-pill">👁 View only</span><span><b>Ctrl+F</b> Find voucher</span><span><b>Alt+B</b> Day Book</span><span><b>Alt+R</b> Reports</span><span><b>Ctrl+P</b> Print</span><span><b>Esc</b> Back</span><span style="flex:1"></span><span id="sinfo"></span>`;
  };
  function addAdminLinks() {
    if (!can('admin') || !APP.info || !APP.info.server) return;
    const nav = $('#nav'); if ($('#nav a[data-go=emailOtp]')) return;
    const a = document.createElement('a'); a.dataset.go = 'emailOtp'; a.dataset.p = '{}'; a.innerHTML = '<span>📧 Email (OTP & reset)</span><kbd></kbd>'; a.onclick = () => go('emailOtp', {});
    nav.appendChild(a);
  }
  const _setTop = setTop;
  setTop = function () { _setTop(); if (isViewer()) { $('#tuser').innerHTML = `${esc(APP.user.username)} <span class="ro-pill">👁 view only</span>`; const si = $('#sinfo'); if (si) si.textContent = ''; } };
  // Utilities for a viewer: only personal things
  const _util = SCREENS.utilities;
  SCREENS.utilities = (el, p) => {
    if (!isViewer()) { _util(el, p); if (APP.info && APP.info.server && can('operator')) { const g = $('.menu-grid', el); if (g) { g.insertAdjacentHTML('beforeend', `<div class="mi" tabindex="0" data-s="otpSelf" data-p='{}'><b>Login OTP & backup codes</b><span>Email OTP status · backup codes in case the email does not arrive</span></div>`); bindMenu(el); } } return; }
    el.innerHTML = '<h2 class="title">Utilities <small>👁 view only</small></h2>' + menuGrid([['Change Password', 'Change your password', 'changePw', {}], ['Help & Shortcuts', '', 'help', {}], ['About', '', 'about', {}]]);
    bindMenu(el);
  };
  // Lock everything that writes, on every screen and dialog, the moment it is drawn
  const WRITE_ACTS = new Set(['save', 'savenew', 'saveprint', 'dup', 'recur', 'opt', 'cancel', 'reg', 'del', 'convert']);
  const WRITE_IDS = new Set(['lsave', 'ldel', 'gs', 'gdel', 'is', 'idel', 'sdel', 'cs', 'lnew', 'its', 'g2i', 'g2d', 'bki', 'bkm', 'rcp', 'rdep', 'cnew', 'crestore', 'cdemo', 'cadmin', 'uimp']);
  const SAFE_RE = /^\s*(cancel\s*\(|cancel$|back|close|no\b|ok$|calculate|pdf|print|excel|share|whatsapp|email$|statement|register|payslips|search|show|go\b|refresh|export|e-invoice|e-way|view|open|next|prev|logout|download|📄|🖨|⬇|📤)/i;
  const WRITE_RE = /^\s*(\+|➕|×|✕|save|delete|remove|create|post\b|import|restore|duplicate|make |un-?match|auto-?match|alter|new\b|add\b|process|cancel voucher|mark|update|apply|upload|set\b|lock|clear|reset|generate|run\b|edit|change|convert|tick|reconcile)/i;
  const EDIT_SCREENS = new Set(['voucher', 'ledgerEdit', 'groupEdit', 'itemEdit', 'priceListEdit', 'bomEdit', 'budgets', 'companyEdit', 'itr', 'payroll', 'physicalStock', 'reminders']);
  const LOCK_DIALOG_RE = /^(alter|create|new|edit|add|make|post|import|recurring|set|change)/i;
  function isWriteBtn(b) {
    if (b.dataset.roOk) return false;
    if (b.dataset.a && WRITE_ACTS.has(b.dataset.a)) return true;
    if (b.id && WRITE_IDS.has(b.id)) return true;
    if (b.dataset.del || b.dataset.cv || b.dataset.um) return true;
    const t = (b.textContent || '').trim();
    if (SAFE_RE.test(t)) return false;
    return WRITE_RE.test(t);
  }
  function lockEl(el) { if (el.classList.contains('ro-off')) return; el.classList.add('ro-off'); el.disabled = true; el.setAttribute('aria-disabled', 'true'); el.title = RO_TITLE; el.tabIndex = -1; }
  function lockRoot(root, inputsToo) {
    $$('button, .btn, [data-a]', root).forEach(b => { if (isWriteBtn(b)) lockEl(b); });
    if (inputsToo) $$('input, select, textarea', root).forEach(i => { if (i.closest('.toolbar') && !i.closest('.card .form') || i.id === 'ls' || i.dataset.roOk) return; if (i.type === 'checkbox' || i.type === 'radio' || i.tagName === 'SELECT') i.disabled = true; else i.readOnly = true; i.classList.add('ro-in'); i.tabIndex = -1; });
  }
  function sweep() {
    if (!isViewer()) return;
    const main = $('#main'); const scr = APP.current && APP.current.name;
    if (main && !$('#app').classList.contains('hidden')) { lockRoot(main, EDIT_SCREENS.has(scr)); if (EDIT_SCREENS.has(scr)) { const sm = $('h2.title small', main); if (sm && !sm.dataset.ro) { sm.dataset.ro = '1'; sm.textContent = '👁 View only'; } } }
    const box = $('#modalBox'); if (box && !$('#modal').classList.contains('hidden')) { const h = $('h3', box); lockRoot(box, !!(h && LOCK_DIALOG_RE.test(h.textContent.trim()))); if (h && LOCK_DIALOG_RE.test(h.textContent.trim())) $$('[data-a=ok], .btn.primary', box).forEach(lockEl); }
    const cc = $('#compCard'); if (cc && !$('#companies').classList.contains('hidden')) lockRoot(cc, false);
  }
  let sweepQ = false;
  const mo = new MutationObserver(() => { if (!isViewer() || sweepQ) return; sweepQ = true; Promise.resolve().then(() => { sweepQ = false; sweep(); }); });
  ['main', 'modalBox', 'compCard'].forEach(id => { const el = document.getElementById(id); if (el) mo.observe(el, { childList: true, subtree: true }); });
  // clicks and keys that would write are stopped before the screen sees them
  document.addEventListener('click', e => {
    if (!isViewer()) return; const t = e.target.closest && e.target.closest('.ro-off, [data-s=voucher], [data-go=voucher], [data-s=physicalStock], [data-s=bankImport]');
    if (!t) return; if (t.matches('[data-s], [data-go]')) { let p = {}; try { p = JSON.parse(t.dataset.p || '{}'); } catch (_) {} if (viewerMayOpen(t.dataset.s || t.dataset.go, p)) return; }
    e.preventDefault(); e.stopImmediatePropagation(); toast('👁 ' + RO_TITLE, 'err');
  }, true);
  window.addEventListener('keydown', e => {
    if (!isViewer()) return; const k = (e.key || '').toLowerCase();
    const bad = (e.ctrlKey && (k === 's' || (k === 'a' && !/input|textarea/i.test((e.target && e.target.tagName) || '')) || k === 'delete')) || (e.altKey && (k === 'c' || k === 'd' || k === '2' || k === 'n'));
    if (bad) { e.preventDefault(); e.stopImmediatePropagation(); toast('👁 ' + RO_TITLE, 'err'); }
  }, true);

  // A device where a viewer logs in keeps only the plain login (no "offline mode", no storage choices)
  function deviceIsViewOnly() { try { return localStorage.getItem('rs.viewOnlyDevice') === '1'; } catch (_) { return false; } }
  window.rsAfterLogin = function (u) {
    const vo = !!(u && u.role === 'viewer'); setViewMode();
    try { localStorage.setItem('rs.viewOnlyDevice', vo ? '1' : '0'); } catch (_) {}
    const sh = window.rsShell || (window.rs && window.rs.shell); if (sh && typeof sh.setViewerLock === 'function') sh.setViewerLock(vo).catch(() => {});
  };
  const _ple = paintLoginExtras;
  paintLoginExtras = function () {
    _ple();
    if (!deviceIsViewOnly()) return;
    ['lmode', 'lalt', 'lserver'].forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('hidden'); });
  };
  const _showLogin = showLogin;
  showLogin = async function (...a) { if (window.rsLiveStop) window.rsLiveStop(); document.body.classList.remove('viewonly'); return _showLogin(...a); };
  const _show = showCompanies;
  showCompanies = async function () {
    await _show(); setViewMode();
    if (isViewer()) { const d = $('#compCard .brand div div'); if (d) d.textContent = `Logged in as ${APP.user.username} · 👁 view only`; }
  };

  // ---------------------------------------------------------------- 2. LIVE UPDATES ----------------------------------------------------------------
  // While a company is open, the app asks the server every 3 s (15 s when the window is in the background) "anything saved since #N?".
  // Another user's save refreshes the open list / report / dashboard at once and shows who saved what.
  const LIVE = { seq: null, company: null, timer: null, busy: false, log: [], unread: 0, pending: false };
  const AUTO_REFRESH = new Set(['dashboard', 'report', 'ledgerList', 'itemList', 'groupList', 'simpleList', 'voucherList', 'pendingOrders', 'dueDates', 'recurring', 'gstr2b', 'bankImport', 'reportsMenu']);
  const VERB = { new: 'saved', edit: 'edited', delete: 'deleted' };
  function liveOn() { return !!(APP.info && APP.info.server && window.rs && window.rs.api); }
  window.rsLiveStart = function () {
    window.rsLiveStop(); if (!liveOn()) return;
    LIVE.seq = null; LIVE.company = APP.info.company && APP.info.company.id; LIVE.log = []; LIVE.unread = 0; paintBell(); tick();
  };
  window.rsLiveStop = function () { clearTimeout(LIVE.timer); LIVE.timer = null; LIVE.seq = null; hideBanner(); };
  async function tick() {
    clearTimeout(LIVE.timer); LIVE.timer = null;
    if ($('#app').classList.contains('hidden') || !liveOn()) return;
    let fast = false;
    if (!LIVE.busy) {
      LIVE.busy = true;
      try {
        const r = await api('sync.poll', LIVE.seq);
        if (LIVE.seq == null || r.company !== LIVE.company) { LIVE.seq = r.seq; LIVE.company = r.company; }
        else if (r.items && r.items.length) { LIVE.seq = r.seq; const others = r.items.filter(x => !x.mine); if (others.length) onChanges(others); fast = !!r.more; }
      } catch (e) { if (e && (e.code === 'auth' || e.code === 'must_change')) return; }
      finally { LIVE.busy = false; }
    }
    if ($('#app').classList.contains('hidden')) return;
    LIVE.timer = setTimeout(tick, fast ? 300 : (document.hidden ? 15000 : 3000));
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && LIVE.timer) { clearTimeout(LIVE.timer); tick(); } });
  function sentence(x) { return `${x.byName || x.by} ${VERB[x.kind] || 'updated'} ${x.label}`; }
  function onChanges(items) {
    items.forEach(x => LIVE.log.unshift(Object.assign({ seen: new Date() }, x))); LIVE.log = LIVE.log.slice(0, 30); LIVE.unread += items.length; paintBell();
    items.slice(-3).forEach(x => liveToast('🔔 ' + sentence(x)));
    if (items.length > 3) liveToast(`🔔 +${items.length - 3} more changes`);
    systemNotify(items);
    if (items.some(x => x.label === 'Company settings')) refreshCompany().catch(() => {});
    refreshScreen();
  }
  function liveToast(msg) { const d = document.createElement('div'); d.className = 'live'; d.textContent = msg; $('#toast').appendChild(d); setTimeout(() => d.remove(), 6000); }
  function systemNotify(items) {
    const text = items.length === 1 ? sentence(items[0]) : `${sentence(items[items.length - 1])} (+${items.length - 1} more)`;
    const title = (APP.settings && APP.settings.name) || appName();
    try { if (window.rs && window.rs.android && typeof window.rs.android.notify === 'function') { window.rs.android.notify(title, text); return; } } catch (_) {}
    try { if ((document.hidden || !document.hasFocus()) && 'Notification' in window && Notification.permission === 'granted') new Notification(title, { body: text, tag: 'rs-live', icon: brandImg() }); } catch (_) {}
  }
  async function refreshScreen() {
    invalidate();
    const cur = APP.current; const name = cur && cur.name;
    if (!name) return;
    if (isModal() || cur.dirty || !AUTO_REFRESH.has(name) || (document.activeElement && /input|textarea|select/i.test(document.activeElement.tagName) && document.activeElement.closest('#main') && document.activeElement.id !== 'ls')) { showBanner(); return; }
    const main = $('#main'); const y = main.scrollTop; const q = $('#ls') ? $('#ls').value : '';
    try { await render(); } catch (_) {}
    main.scrollTop = y; if (q && $('#ls')) { $('#ls').value = q; $('#ls').dispatchEvent(new Event('input')); }
    hideBanner();
  }
  function showBanner() {
    let b = $('#liveBanner'); if (!b) { b = document.createElement('div'); b.id = 'liveBanner'; b.innerHTML = '<span>🔄 Another user changed this data</span><button class="btn sm primary" data-ro-ok="1">Refresh</button><button class="btn sm" data-ro-ok="1">✕</button>'; document.body.appendChild(b);
      const [r, x] = $$('button', b); r.onclick = async () => { if (APP.current && APP.current.dirty && !(await confirmBox('Your changes on this screen are not saved yet. Refresh anyway?', 'Refresh'))) return; APP.current.dirty = false; hideBanner(); invalidate(); try { await render(); } catch (_) {} }; x.onclick = hideBanner; }
    b.classList.remove('hidden');
  }
  function hideBanner() { const b = $('#liveBanner'); if (b) b.classList.add('hidden'); }
  function paintBell() {
    const top = $('#top'); if (!top) return; let b = $('#tbell');
    if (!b) { b = document.createElement('button'); b.className = 'tbtn'; b.id = 'tbell'; b.title = 'Changes by other users'; b.dataset.roOk = '1'; const before = $('#ttheme'); top.insertBefore(b, before); b.onclick = showLog; }
    b.classList.toggle('hidden', !liveOn());
    b.innerHTML = '🔔' + (LIVE.unread ? `<span class="badge">${LIVE.unread > 9 ? '9+' : LIVE.unread}</span>` : '');
    if (!b.dataset.np && 'Notification' in window && Notification.permission === 'default' && !(window.rs && window.rs.android)) { b.dataset.np = '1'; b.addEventListener('click', () => { try { Notification.requestPermission(); } catch (_) {} }, { once: true }); }
  }
  function showLog() {
    LIVE.unread = 0; paintBell();
    modal(`<h3>🔔 Live changes <small style="font-weight:400;color:var(--muted)">saves by other users in this company</small></h3><div style="max-height:55vh;overflow:auto">${LIVE.log.length ? LIVE.log.map(x => `<div style="padding:6px 2px;border-bottom:1px solid var(--line)"><b>${esc(x.byName || x.by)}</b> ${esc(VERB[x.kind] || 'updated')} ${esc(x.label)}<div style="font-size:11px;color:var(--muted)">${new Date(x.at).toLocaleString()}</div></div>`).join('') : '<p style="color:var(--muted)">No changes yet. When another user saves something in this company it shows here, and your screen refreshes by itself.</p>'}</div><div class="actions"><button class="btn primary" data-a="no">OK</button></div>`, (box, close) => { $('[data-a=no]', box).onclick = () => close(null); });
  }

  // ---------------------------------------------------------------- 3. EMAIL OTP LOGIN ----------------------------------------------------------------
  window.rsOtpStep = function (ch) {
    return new Promise(resolve => {
      const card = $('.login-card'); const form = $('#loginForm'); form.classList.add('hidden'); ['lmode', 'lalt', 'lserver', 'lhint'].forEach(id => { const el = document.getElementById(id); if (el) el.dataset.wasHidden = el.classList.contains('hidden') ? '1' : ''; el && el.classList.add('hidden'); });
      let box = $('#otpBox'); if (box) box.remove();
      box = document.createElement('div'); box.id = 'otpBox'; box.className = 'otp-box';
      box.innerHTML = `<div class="otp-h">📧 Email OTP</div>
        <div class="otp-s" id="otps"></div>
        <form id="otpForm" autocomplete="off"><div class="fld"><label id="otpl">6-digit OTP</label><input id="otpc" inputmode="numeric" autocomplete="one-time-code" maxlength="9" placeholder="______" style="font-size:22px;letter-spacing:6px;text-align:center"></div>
        <div class="err" id="otperr"></div>
        <button class="btn primary lbtn" id="otpok" type="submit">Verify & Login</button></form>
        <div class="otp-links"><a href="#" id="otpre">Resend code</a><span>·</span><a href="#" id="otpbk">Backup code</a><span>·</span><a href="#" id="otpback">← Back</a></div>
        <div class="otp-help">No mail? Check the Spam / Promotions folder. Valid for 10 minutes · after 5 wrong tries, log in again.</div>`;
      card.insertBefore(box, $('#lconn'));
      const st = { ch: ch.challenge, wait: ch.resendIn || 30, backup: false, timer: null };
      const sub = () => { $('#otps').innerHTML = ch.mailFailed ? `<span style="color:var(--red)">${esc(ch.error || 'The code email could not be sent.')}</span>` : `Code sent to: <b>${esc(ch.sentTo)}</b>`; };
      sub(); if (ch.mailFailed) $('#otperr').textContent = '';
      const tickWait = () => { clearInterval(st.timer); const a = $('#otpre'); const draw = () => { if (st.wait > 0) { a.textContent = `Resend (${st.wait}s)`; a.classList.add('off'); } else { a.textContent = 'Resend code'; a.classList.remove('off'); } }; draw(); st.timer = setInterval(() => { st.wait--; draw(); if (st.wait <= 0) clearInterval(st.timer); }, 1000); };
      tickWait();
      const done = (v) => { clearInterval(st.timer); box.remove(); form.classList.remove('hidden'); ['lmode', 'lalt', 'lserver', 'lhint'].forEach(id => { const el = document.getElementById(id); if (el && !el.dataset.wasHidden) el.classList.remove('hidden'); }); if (!v) { $('#lp').value = ''; paintLoginExtras(); $('#lp').focus(); } resolve(v); };
      $('#otpForm').addEventListener('submit', async e => {
        e.preventDefault(); const b = $('#otpok'); if (b.disabled) return; const code = $('#otpc').value.trim(); $('#otperr').textContent = '';
        if (!code) { $('#otperr').textContent = st.backup ? 'Enter a backup code' : 'Enter the 6-digit code from the email'; return; }
        b.disabled = true; const l = b.innerHTML; b.innerHTML = '<span class="spin"></span> Checking…';
        try { const u = await api('auth.verifyOtp', st.ch, code); done(u); }
        catch (err) { $('#otperr').textContent = err.message || String(err); $('#otpc').select(); if (err.code === 'otp_expired') setTimeout(() => done(null), 2500); }
        finally { b.disabled = false; b.innerHTML = l; }
      });
      $('#otpre').onclick = async e => { e.preventDefault(); if (st.wait > 0) return; $('#otperr').textContent = '';
        try { const r = await api('auth.resendOtp', st.ch); ch.mailFailed = false; ch.sentTo = r.sentTo; sub(); st.wait = r.resendIn || 30; tickWait(); toast('New code sent', 'ok'); }
        catch (err) { $('#otperr').textContent = err.message || String(err); if (err.code === 'otp_expired') setTimeout(() => done(null), 2500); } };
      $('#otpbk').onclick = e => { e.preventDefault(); st.backup = !st.backup; $('#otpl').textContent = st.backup ? 'Backup code (XXXX-XXXX)' : '6-digit OTP'; const i = $('#otpc'); i.value = ''; i.inputMode = st.backup ? 'text' : 'numeric'; i.placeholder = st.backup ? 'ABCD-EFGH' : '______'; i.style.letterSpacing = st.backup ? '2px' : '6px'; $('#otpbk').textContent = st.backup ? 'Email OTP' : 'Backup code'; i.focus(); };
      $('#otpback').onclick = e => { e.preventDefault(); done(null); };
      $('#otpc').addEventListener('input', () => { const v = $('#otpc').value; if (!st.backup && /^\d{6}$/.test(v)) $('#otpForm').requestSubmit ? $('#otpForm').requestSubmit() : $('#otpok').click(); });
      setTimeout(() => $('#otpc').focus(), 60);
    });
  };

  // Admin › Email OTP: which Gmail sends the codes, test mail, OTP on/off for everyone, who has an email
  SCREENS.emailOtp = async (el) => {
    if (!can('admin')) { el.innerHTML = '<h2 class="title">Email OTP</h2><div class="card">Only an admin can change this.</div>'; return; }
    const m = await api('mail.get');
    const F = [{ k: 'provider', label: 'Email service', type: 'select', options: [['gmail', 'Gmail (recommended)'], ['zoho', 'Zoho Mail'], ['outlook', 'Outlook / Office 365'], ['brevo', 'Brevo SMTP'], ['smtp', 'Other SMTP server']] },
      { k: 'user', label: 'Gmail address (codes are sent from it)', ph: 'yourname@gmail.com', w: 2 },
      { k: 'pass', label: m.hasPass ? 'App Password (saved ✔ — leave blank to keep it)' : 'Gmail App Password (16 letters)', type: 'password', w: 2, ph: m.hasPass ? '•••• •••• •••• ••••' : 'abcd efgh ijkl mnop' },
      { k: 'fromName', label: 'Sender name', ph: appName(), w: 2 },
      { k: 'host', label: 'SMTP host (Other only)', ph: 'smtp.example.com' }, { k: 'port', label: 'Port', type: 'number', ph: '465 / 587' }, { k: 'secure', label: 'Security', type: 'select', options: [['ssl', 'SSL (465)'], ['starttls', 'STARTTLS (587)']] }];
    const noEmail = m.users.filter(u => u.active && !u.email);
    el.innerHTML = `<h2 class="title">📧 Email settings — login OTP & password reset <small>${m.otpEnabled ? '<span class="pill">ON</span>' : '<span class="pill grey">OFF</span>'}</small></h2>
      <div class="card"><h3 style="margin-top:0">1. Which Gmail sends the codes</h3>
        <p class="adm-help">Your normal Gmail password does <b>not</b> work here. Google Account → <b>Security</b> → turn <b>2-Step Verification</b> ON → <b>App passwords</b> → name it "R&S Accounting" → enter the 16-letter password you get here. It is kept only in your server's database (nowhere else, never shown to anyone). The same mail is used for login codes and for "Forgot password?" reset codes.</p>
        <div class="form" id="mf">${formHtml(F, Object.assign({}, m, { pass: '', port: m.port || '' }))}</div>
        <div class="toolbar"><button class="btn primary" id="msave">Save</button><input id="mto" placeholder="Send the test mail to (blank = your email)" style="width:260px"><button class="btn" id="mtest">✉ Send test mail</button>
        <span style="font-size:12px;${m.testedOk ? 'color:var(--green)' : 'color:var(--muted)'}">${m.testedOk ? '✔ Last test OK ' + esc((m.testedAt || '').replace('T', ' ').slice(0, 16)) : (m.lastError ? '✖ ' + esc(m.lastError) : 'Not tested yet')}</span></div></div>
      <div class="card"><h3 style="margin-top:0">2. Login OTP on / off for everyone</h3>
        <p class="adm-help">When ON: every user who has an email and the "Ask for an email OTP at login" tick must enter a 6-digit code from the email after the password (valid 10 minutes, 5 tries). Users without an email log in with the password only.<br><b>If email stops working:</b> turn it OFF here (everyone logs in with the password only), or turn OTP off for one user in Users & Roles. Admins should keep backup codes from "Login OTP & backup codes" (Utilities).</p>
        <div class="toolbar"><button class="btn ${m.otpEnabled ? '' : 'primary'}" id="motp">${m.otpEnabled ? 'Turn OTP OFF' : 'Turn OTP ON'}</button>${m.testedOk ? '' : '<span style="font-size:12px;color:var(--muted)">Send a successful test mail first</span>'}</div></div>
      <div class="card"><h3 style="margin-top:0">3. User emails</h3>
        <table class="mini"><tr><th>User</th><th>Role</th><th>Email</th><th>OTP</th></tr>${m.users.map(u => `<tr><td>${esc(u.username)}</td><td>${esc(u.role)}</td><td>${u.email ? esc(u.email) + (u.verified ? ' ✔' : '') : '<span style="color:var(--muted)">— none</span>'}</td><td>${!u.email ? 'no email' : u.otp ? (m.otpEnabled ? 'ON' : 'ready') : 'off (for this user)'}</td></tr>`).join('')}</table>
        ${noEmail.length ? `<p class="adm-help">${noEmail.length} user(s) have no email — they get no login code and cannot use "Forgot password?". To add one: Utilities › Users & Roles › open the user › Email.</p>` : ''}
        <div class="toolbar"><button class="btn" id="musers">Open Users & Roles</button></div></div>`;
    bindForm($('#mf'), F, m);
    const showFor = () => { const pv = $('#f_provider').value; ['host', 'port', 'secure'].forEach(k => { const f = $('#f_' + k); if (f) f.closest('.fld').classList.toggle('hidden', pv !== 'smtp'); }); $('label[for=f_user]').textContent = pv === 'gmail' ? 'Gmail address (codes are sent from it)' : 'Email login / username'; $('label[for=f_pass]').textContent = (m.hasPass ? 'Password / App Password (saved ✔ — leave blank to keep it)' : (pv === 'gmail' ? 'Gmail App Password (16 letters)' : 'Password / App Password')); };
    $('#f_provider').onchange = showFor; showFor();
    $('#msave').onclick = () => withBusy($('#msave'), async () => { const v = readForm($('#mf'), F); await api('mail.save', v); toast('Saved. Now press "Send test mail".', 'ok'); render(); });
    $('#mtest').onclick = () => withBusy($('#mtest'), async () => { const r = await api('mail.test', $('#mto').value.trim()); toast('✔ Test mail sent to ' + r.to + ' — check the inbox (or spam)', 'ok'); render(); });
    $('#motp').onclick = () => withBusy($('#motp'), async () => { await api('otp.setEnabled', !m.otpEnabled); toast(m.otpEnabled ? 'Email OTP is OFF' : 'Email OTP is ON', 'ok'); render(); });
    $('#musers').onclick = () => go('users', {});
  };
  // Each user (not viewers): OTP status + backup codes for the day the email does not arrive
  SCREENS.otpSelf = async (el) => {
    const i = await api('auth.otpInfo');
    el.innerHTML = `<h2 class="title">Login OTP & backup codes</h2><div class="card">
      <p>Email: <b>${i.email ? esc(i.email) : '— (the admin has not set an email)'}</b><br>Login OTP: <b>${i.otpOn ? 'ON' : 'OFF'}</b>${!i.globalOn ? ' (the admin has not turned Email OTP on)' : (!i.userOtp ? ' (off for you)' : '')}</p>
      <p class="adm-help">Backup codes: if the code email ever does not arrive, you can log in with a backup code instead — or use one in "Forgot password?" to set a new password. Each code works only once. Making new codes cancels the old ones. Keep them somewhere safe (phone notes / paper).</p>
      <p>Backup codes left: <b>${i.backupLeft}</b></p>
      <div class="toolbar"><button class="btn primary" id="bkgen">Make new backup codes</button></div><div id="bkout"></div></div>`;
    $('#bkgen').onclick = async () => {
      const v = await promptBox('Confirm your password', [{ k: 'pw', label: 'Your password', type: 'password', w: 2 }]); if (!v) return;
      try { const codes = await api('auth.backupCodes', v.pw); $('#bkout').innerHTML = `<div class="alert green" style="cursor:default">Write these 8 codes down now — they will not be shown again:<pre style="font-size:16px;letter-spacing:1px">${codes.map(esc).join('\n')}</pre></div>`; } catch (e) { fail(e); }
    };
  };
})();
