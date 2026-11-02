// R&S Sons Accounting v2.3 — "Forgot password?" on the login screen: a reset code goes to the user's registered email
// (10 minutes, one use, 5 tries; a backup code works too), then the user sets a new password. Online (hosted server) only.
'use strict';
(function () {
  const online = () => !!(window.rs && (window.rs.web || window.rs.android || window.rs.shell));   // the hosted server (not offline mode)
  const _ple = paintLoginExtras;
  paintLoginExtras = function () { _ple(); const l = $('#lforgot'); if (l) l.classList.toggle('hidden', !online()); };
  const HIDE = ['loginForm', 'lmode', 'lalt', 'lserver', 'lhint', 'lforgot'];
  function hideLogin() { HIDE.forEach(id => { const el = document.getElementById(id); if (el) { el.dataset.fpHidden = el.classList.contains('hidden') ? '1' : ''; el.classList.add('hidden'); } }); }
  function showLogin() { HIDE.forEach(id => { const el = document.getElementById(id); if (el && !el.dataset.fpHidden) el.classList.remove('hidden'); }); }
  function forgot() {
    const card = $('.login-card'); hideLogin(); $('#lerr').textContent = '';
    let box = $('#fpBox'); if (box) box.remove();
    box = document.createElement('div'); box.id = 'fpBox'; box.className = 'otp-box';
    card.insertBefore(box, $('#lconn'));
    const st = { user: ($('#lu').value || '').trim(), ch: null, wait: 0, timer: null, backup: false };
    const close = (msg) => { clearInterval(st.timer); box.remove(); showLogin(); paintLoginExtras(); if (msg) { $('#lu').value = st.user; $('#lp').value = ''; toast(msg, 'ok'); setTimeout(() => $('#lp').focus(), 60); } };
    function step1() {
      box.innerHTML = `<div class="otp-h">🔑 Forgot password</div>
        <div class="otp-s">Enter your username. A 6-digit reset code is sent to the email registered for that user.</div>
        <form id="fpForm1" autocomplete="off"><div class="fld"><label>Username</label><input id="fpu" autocapitalize="none" spellcheck="false" value="${esc(st.user)}"></div>
        <div class="err" id="fperr"></div><button class="btn primary lbtn" id="fpsend" type="submit">Send reset code</button></form>
        <div class="otp-links"><a href="#" id="fphave">I already have a code</a><span>·</span><a href="#" id="fpback">← Back to login</a></div>`;
      $('#fpback').onclick = e => { e.preventDefault(); close(); };
      $('#fphave').onclick = e => { e.preventDefault(); if (!st.ch) { $('#fperr').textContent = 'First send a reset code (each new code replaces the old one).'; return; } step2(); };
      $('#fpForm1').addEventListener('submit', async e => {
        e.preventDefault(); const b = $('#fpsend'); if (b.disabled) return; st.user = $('#fpu').value.trim(); $('#fperr').textContent = '';
        if (!st.user) { $('#fperr').textContent = 'Enter your username'; return; }
        b.disabled = true; const l = b.innerHTML; b.innerHTML = '<span class="spin"></span> Sending…';
        try { const r = await api('auth.forgotPassword', st.user); st.ch = r.challenge; st.res = r; st.wait = 60; step2(); }
        catch (err) { $('#fperr').textContent = err.message || String(err); }
        finally { b.disabled = false; b.innerHTML = l; }
      });
      setTimeout(() => $('#fpu').focus(), 60);
    }
    function step2() {
      const r = st.res || {};
      const head = r.sentTo ? `Reset code sent to <b>${esc(r.sentTo)}</b>. Check the inbox (and Spam).`
        : r.mailFailed ? `<span style="color:var(--red)">${esc(r.error || 'The reset email could not be sent.')}</span>`
        : 'If this username has an email registered, a reset code has been sent to it. No email? Ask your admin to set a new password for you (Utilities › Users & Roles).';
      box.innerHTML = `<div class="otp-h">🔑 Set a new password</div>
        <div class="otp-s" id="fps">${head}</div>
        <form id="fpForm2" autocomplete="off">
          <div class="fld"><label id="fpcl">Reset code from the email</label><input id="fpc" inputmode="numeric" autocomplete="one-time-code" maxlength="9" placeholder="______" style="font-size:22px;letter-spacing:6px;text-align:center"></div>
          <div class="fld"><label>New password</label><input id="fpn1" type="password" autocomplete="new-password"></div>
          <div class="fld"><label>Repeat new password</label><input id="fpn2" type="password" autocomplete="new-password"></div>
          <div class="otp-help" style="margin:0 0 6px">At least 8 characters with letters and numbers, e.g. <b>Kashi@2026</b>. Not the username.</div>
          <div class="err" id="fperr"></div><button class="btn primary lbtn" id="fpok" type="submit">Set new password</button></form>
        <div class="otp-links"><a href="#" id="fpre">Resend code</a><span>·</span><a href="#" id="fpbk">Use a backup code</a><span>·</span><a href="#" id="fpback">← Back to login</a></div>
        <div class="otp-help">The code is valid for 10 minutes and works once · 5 wrong tries cancel it. After the change, every device logs in again.</div>`;
      const tick = () => { clearInterval(st.timer); const a = $('#fpre'); const draw = () => { if (!a.isConnected) return clearInterval(st.timer); if (st.wait > 0) { a.textContent = `Resend (${st.wait}s)`; a.classList.add('off'); } else { a.textContent = 'Resend code'; a.classList.remove('off'); } }; draw(); st.timer = setInterval(() => { st.wait--; draw(); if (st.wait <= 0) clearInterval(st.timer); }, 1000); };
      tick();
      $('#fpback').onclick = e => { e.preventDefault(); close(); };
      $('#fpre').onclick = async e => { e.preventDefault(); if (st.wait > 0) return; $('#fperr').textContent = '';
        try { const x = await api('auth.forgotPassword', st.user); st.ch = x.challenge; st.res = x; st.wait = 60; step2(); if (x.sentTo) toast('New reset code sent', 'ok'); } catch (err) { $('#fperr').textContent = err.message || String(err); } };
      $('#fpbk').onclick = e => { e.preventDefault(); st.backup = !st.backup; const i = $('#fpc'); i.value = ''; i.inputMode = st.backup ? 'text' : 'numeric'; i.placeholder = st.backup ? 'ABCD-EFGH' : '______'; i.style.letterSpacing = st.backup ? '2px' : '6px';
        $('#fpcl').textContent = st.backup ? 'Backup code (XXXX-XXXX)' : 'Reset code from the email'; $('#fpbk').textContent = st.backup ? 'Use the email code' : 'Use a backup code'; i.focus(); };
      $('#fpForm2').addEventListener('submit', async e => {
        e.preventDefault(); const b = $('#fpok'); if (b.disabled) return; $('#fperr').textContent = '';
        const code = $('#fpc').value.trim(), n1 = $('#fpn1').value, n2 = $('#fpn2').value;
        if (!code) { $('#fperr').textContent = st.backup ? 'Enter a backup code' : 'Enter the 6-digit code from the email'; return; }
        if (!n1) { $('#fperr').textContent = 'Enter the new password'; return; }
        if (n1 !== n2) { $('#fperr').textContent = 'The two new passwords do not match'; return; }
        b.disabled = true; const l = b.innerHTML; b.innerHTML = '<span class="spin"></span> Saving…';
        try { const x = await api('auth.resetPassword', st.ch, code, n1, n2); if (x && x.username) st.user = x.username; close('Password changed — log in with your new password.'); }
        catch (err) { $('#fperr').textContent = err.message || String(err); if (err.code === 'reset_expired') { st.ch = null; setTimeout(step1, 2500); } }
        finally { if (b.isConnected) { b.disabled = false; b.innerHTML = l; } }
      });
      setTimeout(() => $('#fpc').focus(), 60);
    }
    step1();
  }
  window.rsForgotPassword = forgot;
  const lf = document.getElementById('lforgot'); if (lf) { lf.onclick = e => { e.preventDefault(); forgot(); }; lf.classList.toggle('hidden', !online()); }   // the login may already be on screen
})();
