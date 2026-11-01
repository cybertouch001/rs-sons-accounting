// R&S Sons Accounting - browser bridge. In the desktop app (local mode) window.rs already exists (preload) and this file does nothing.
// In a browser (or the desktop app connected to a server) every screen call goes to the server's /api/call with the login cookie.
(function () {
  'use strict';
  if (window.rs) return;
  // never run inside someone else's frame (click-jacking guard for the hosted web app)
  if (window.top !== window.self) { document.documentElement.style.display = 'none'; try { window.top.location = window.location.href; } catch (_) {} return; }
  const BASE = new URL('..', location.href).pathname.replace(/\/app\/?$/, '/');   // site root (the app lives in /app/)
  const API = BASE + 'api/call';
  const SHELL = window.rsShell || null;          // v2.1 Windows app (login-first, online mode)
  const DROID = window.RSAndroid || null;        // v2.1 Android app
  // ---- connection status bar: "Connecting…", "server waking up…", "no internet" (a slow first call never looks like a freeze) ----
  const NET = { pending: 0, since: 0, timer: null, offline: !navigator.onLine };
  function bar() {
    let b = document.getElementById('netbar');
    if (!b) { b = document.createElement('div'); b.id = 'netbar'; b.className = 'hidden'; b.setAttribute('role', 'status'); document.body.appendChild(b); }
    return b;
  }
  function paintNet() {
    const b = bar(); const slow = NET.pending ? Date.now() - NET.since : 0;
    let html = '', cls = '';
    if (NET.offline) { html = '📴 <b>Internet nahi hai</b> · No internet — jab internet aayega tab kaam chalega'; cls = 'off'; }
    else if (NET.pending && slow > 7000) { html = '<span class="spin"></span> <b>Server jag raha hai…</b> pehli baar 10-30 sec lag sakte hain · Server is waking up, please wait'; cls = 'slow'; }
    else if (NET.pending && slow > 1200) { html = '<span class="spin"></span> Connecting… · जुड़ रहा है'; cls = 'busy'; }
    b.className = html ? cls : 'hidden'; if (b.innerHTML !== html) b.innerHTML = html;
    document.documentElement.classList.toggle('net-busy', !!html && cls !== 'off');
  }
  function netStart() { if (!NET.pending++) NET.since = Date.now(); clearInterval(NET.timer); NET.timer = setInterval(paintNet, 400); }
  function netEnd() { NET.pending = Math.max(0, NET.pending - 1); if (!NET.pending) { clearInterval(NET.timer); NET.timer = null; } paintNet(); }
  window.addEventListener('offline', () => { NET.offline = true; paintNet(); });
  window.addEventListener('online', () => { NET.offline = false; paintNet(); });
  function netError(kind) {
    const e = new Error(kind === 'timeout' ? 'Server ne time par jawab nahi diya — dobara try karo. (The server took too long, please try again.)'
      : !navigator.onLine ? 'Internet nahi mil raha — internet check karke dobara try karo. (No internet connection.)'
      : 'Server tak nahi pahunch paaye — thodi der baad dobara try karo. (Cannot reach the server, please try again.)');
    e.code = kind; return e;
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const RETRY_OK = new Set(['app.info', 'company.list', 'auth.login']);   // safe to send again after a network failure
  async function send(m, args, tries) {
    let r; netStart();
    const ctl = window.AbortController ? new AbortController() : null; const to = ctl ? setTimeout(() => ctl.abort(), 90000) : null;
    try {
      try { r = await fetch(API, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-rs-client': '1' }, body: JSON.stringify({ m, a: args || [] }), signal: ctl ? ctl.signal : undefined }); }
      catch (e) {
        const kind = ctl && ctl.signal.aborted ? 'timeout' : 'network';
        if (kind === 'network' && RETRY_OK.has(m) && (tries || 0) < 2) { await sleep(1500 * ((tries || 0) + 1)); return send(m, args, (tries || 0) + 1); }
        throw netError(kind);
      }
      let j; try { j = await r.json(); } catch (_) { throw new Error(r.status === 413 ? 'File is too large to upload' : 'Server error (' + r.status + '). Please try again.'); }
      if (!j.ok) throw apiError(m, j);
      return j.data;
    } finally { if (to) clearTimeout(to); netEnd(); }
  }
  let authReload = false;
  function apiError(m, j) {
    if (j.code === 'auth' && m !== 'auth.login' && m !== 'app.info' && !authReload) { authReload = true; setTimeout(() => location.reload(), 1500); }
    const e = new Error(j.error || 'Error'); e.code = j.code; return e;
  }
  // ---- v2.1: calls made at the same moment go to the server as ONE request (a company opening = 10+ calls → 1 trip) ----
  const NOBATCH = new Set(['auth.login', 'auth.logout', 'auth.changePassword']);
  let Q = [], qTimer = null, batchOff = false;
  function call(m, args) {
    if (batchOff || NOBATCH.has(m) || bigArgs(args)) return send(m, args);
    return new Promise((res, rej) => { Q.push({ m, a: args || [], res, rej }); if (!qTimer) qTimer = setTimeout(flushQ, 0); });
  }
  function bigArgs(a) { try { return JSON.stringify(a || []).length > 200000; } catch (_) { return true; } }
  async function flushQ() {
    const q = Q; Q = []; qTimer = null;
    if (q.length === 1) { send(q[0].m, q[0].a).then(q[0].res, q[0].rej); return; }
    let out;
    try { out = await send('batch', q.map(x => [x.m, x.a])); }
    catch (e) {
      if (e.code === 'unknown') { batchOff = true; q.forEach(x => send(x.m, x.a).then(x.res, x.rej)); return; }   // an older server
      q.forEach(x => x.rej(e)); return;
    }
    q.forEach((x, i) => { const r = out[i] || { ok: false, error: 'No answer' }; if (r.ok) x.res(r.data); else x.rej(apiError(x.m, r)); });
  }
  function b64ToBytes(b64) { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  function download(f) {
    if (DROID && DROID.saveFile) {   // Android: saved in Downloads, then Open / Share
      let r = {}; try { r = JSON.parse(DROID.saveFile(f.name, f.mime || 'application/octet-stream', f.b64) || '{}'); } catch (e) { r = { error: e.message }; }
      if (r.error) throw new Error('File save nahi hui: ' + r.error);
      return { file: r.file || f.name, size: f.size, downloaded: true };
    }
    if (SHELL && SHELL.saveFile) return SHELL.saveFile(f.name, f.mime || 'application/octet-stream', f.b64).then(r => r ? { file: r.file, size: f.size } : null);
    const blob = new Blob([b64ToBytes(f.b64)], { type: f.mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = f.name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
    return { file: f.name, size: f.size, downloaded: true };
  }
  function pickFile(accept) {
    return new Promise(resolve => {
      const i = document.createElement('input'); i.type = 'file'; if (accept) i.accept = accept; i.style.display = 'none';
      i.onchange = () => { const f = i.files && i.files[0]; i.remove(); if (!f) return resolve(null); const rd = new FileReader(); rd.onload = () => resolve({ name: f.name, size: f.size, b64: String(rd.result).split(',')[1] || '', dataUrl: rd.result, file: f }); rd.onerror = () => resolve(null); rd.readAsDataURL(f); };
      document.body.appendChild(i); i.click();
      setTimeout(() => { if (document.body.contains(i) && !i.files.length) { /* user may still be choosing */ } }, 60000);
    });
  }
  // Document viewer: shows the printable page with "Print / Save as PDF" (the browser's print dialog makes the PDF; works on phones too)
  function showDoc(html, title, autoPrint) {
    let ov = document.getElementById('docview');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'docview';
      ov.innerHTML = '<div class="dv-bar"><b class="dv-t"></b><span style="flex:1"></span>' + (DROID && DROID.sharePdf ? '<button class="btn primary dv-s">📤 Share PDF</button>' : '') + '<button class="btn ' + (DROID && DROID.sharePdf ? '' : 'primary ') + 'dv-p">🖨 Print / Save as PDF</button><button class="btn dv-c">Close (Esc)</button></div><iframe class="dv-f" title="Document"></iframe>';
      document.body.appendChild(ov);
      if (ov.querySelector('.dv-s')) ov.querySelector('.dv-s').onclick = () => { const f = ov.querySelector('.dv-f'); DROID.sharePdf(f.srcdoc || '', ov.querySelector('.dv-t').textContent || 'Document', ''); };
      ov.querySelector('.dv-c').onclick = () => { ov.classList.add('hidden'); ov.querySelector('.dv-f').srcdoc = ''; };
      ov.querySelector('.dv-p').onclick = () => { const f = ov.querySelector('.dv-f'); if (DROID && DROID.printHtml) { DROID.printHtml(f.srcdoc || '', ov.querySelector('.dv-t').textContent || 'Document'); return; } try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { alert('Printing is blocked here. Use the browser menu › Print.'); } };
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && !ov.classList.contains('hidden')) { e.stopPropagation(); ov.querySelector('.dv-c').click(); } }, true);
    }
    ov.querySelector('.dv-t').textContent = title || 'Document';
    const f = ov.querySelector('.dv-f'); f.onload = null;
    if (autoPrint && DROID && DROID.printHtml) { DROID.printHtml(html, title || 'Document'); autoPrint = false; }
    if (autoPrint) f.onload = () => { setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (_) {} }, 300); f.onload = null; };
    f.srcdoc = html; ov.classList.remove('hidden');
  }
  function resizeIcon(dataUrl) {
    return new Promise((res, rej) => { const img = new Image(); img.onload = () => { const s = Math.min(img.width, img.height); const c = document.createElement('canvas'); c.width = c.height = 256; c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 256, 256); res(c.toDataURL('image/png')); }; img.onerror = () => rej(new Error('Could not read this image')); img.src = dataUrl; });
  }
  async function api(m, ...a) {
    switch (m) {
      case 'doc.pdf': case 'doc.print': if (SHELL && SHELL.savePdf) { const d = await call('doc.named', a); return m === 'doc.pdf' ? SHELL.savePdf(d.html, d.name) : SHELL.print(d.html); } // falls through
      case 'doc.webview': { const d = await call('doc.named', a); showDoc(d.html, d.name, m === 'doc.print'); return { file: d.name + '.pdf', viewer: true }; }
      case 'doc.share': { const s = await call('doc.shareText', [a[1]]); const d = await call('doc.named', ['voucher', a[1], {}]);
        if (SHELL && SHELL.savePdf) { const r = await SHELL.savePdf(d.html, d.name, true); window.open(a[0] === 'whatsapp' ? s.whatsapp : s.mailto, '_blank', 'noopener'); return r; }
        if (DROID && DROID.sharePdf) { DROID.sharePdf(d.html, d.name, s.text || ''); return { file: d.name + '.pdf', shared: true }; }   // phone: real PDF → share sheet (WhatsApp)
        showDoc(d.html, d.name + ' — use "Save as PDF", then attach it', false); window.open(a[0] === 'whatsapp' ? s.whatsapp : s.mailto, '_blank', 'noopener'); return { file: d.name }; }
      case 'masters.import': { const f = await pickFile('.xlsx,.xls,.csv'); if (!f) return null; return call('masters.importFile', [{ name: f.name, b64: f.b64 }]); }
      case 'company.restore': { const f = await pickFile('.rsbak,.rsdb'); if (!f) return null; return call('company.restore', [{ name: f.name, b64: f.b64 }]); }
      case 'company.delete': { const list = await call('company.list', []); const c = list.find(x => x.id === a[0]); if (!confirm(`Delete company "${c ? c.name : ''}"?\n\nA final backup copy is kept on the server.`)) return false; return call('company.delete', [a[0], true]); }
      case 'admin.setIcon': { const ch = a[0] || {}; if (ch.kind !== 'file') return call(m, a); const f = await pickFile('image/png,image/jpeg,image/bmp'); if (!f) return null; return call(m, [{ kind: 'file', name: f.name, dataUrl: await resizeIcon(f.dataUrl) }]); }
      case 'company.openDataFolder': case 'shell.open': case 'shell.show': return true;
      case 'shell.external': { const u = String(a[0] || ''); if (/^(https:|mailto:)/.test(u)) window.open(u, '_blank', 'noopener'); return true; }
      case 'app.quit': { try { await call('auth.logout', []); } catch (_) {} location.reload(); return true; }
      default: { const r = await call(m, a); if (r && r.__file) return download(r.__file); return r; }
    }
  }
  window.rs = { api, web: true, pickFile, showDoc, download, shell: SHELL, android: DROID, net: NET };
})();
