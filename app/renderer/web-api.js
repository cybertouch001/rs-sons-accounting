// R&S Sons Accounting - browser bridge. In the desktop app (local mode) window.rs already exists (preload) and this file does nothing.
// In a browser (or the desktop app connected to a server) every screen call goes to the server's /api/call with the login cookie.
(function () {
  'use strict';
  if (window.rs) return;
  const BASE = new URL('..', location.href).pathname.replace(/\/app\/?$/, '/');   // site root (the app lives in /app/)
  const API = BASE + 'api/call';
  async function call(m, args) {
    let r;
    try { r = await fetch(API, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-rs-client': '1' }, body: JSON.stringify({ m, a: args || [] }) }); }
    catch (e) { throw new Error('Cannot reach the server. Check your internet connection and try again.'); }
    let j; try { j = await r.json(); } catch (_) { throw new Error(r.status === 413 ? 'File is too large to upload' : 'Server error (' + r.status + '). Please try again.'); }
    if (!j.ok) {
      if (j.code === 'auth' && m !== 'auth.login' && m !== 'app.info') { setTimeout(() => location.reload(), 1500); }
      const e = new Error(j.error || 'Error'); e.code = j.code; throw e;
    }
    return j.data;
  }
  function b64ToBytes(b64) { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  function download(f) {
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
      ov.innerHTML = '<div class="dv-bar"><b class="dv-t"></b><span style="flex:1"></span><button class="btn primary dv-p">🖨 Print / Save as PDF</button><button class="btn dv-c">Close (Esc)</button></div><iframe class="dv-f" title="Document"></iframe>';
      document.body.appendChild(ov);
      ov.querySelector('.dv-c').onclick = () => { ov.classList.add('hidden'); ov.querySelector('.dv-f').srcdoc = ''; };
      ov.querySelector('.dv-p').onclick = () => { const f = ov.querySelector('.dv-f'); try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { alert('Printing is blocked here. Use the browser menu › Print.'); } };
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && !ov.classList.contains('hidden')) { e.stopPropagation(); ov.querySelector('.dv-c').click(); } }, true);
    }
    ov.querySelector('.dv-t').textContent = title || 'Document';
    const f = ov.querySelector('.dv-f'); f.onload = null;
    if (autoPrint) f.onload = () => { setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (_) {} }, 300); f.onload = null; };
    f.srcdoc = html; ov.classList.remove('hidden');
  }
  function resizeIcon(dataUrl) {
    return new Promise((res, rej) => { const img = new Image(); img.onload = () => { const s = Math.min(img.width, img.height); const c = document.createElement('canvas'); c.width = c.height = 256; c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 256, 256); res(c.toDataURL('image/png')); }; img.onerror = () => rej(new Error('Could not read this image')); img.src = dataUrl; });
  }
  async function api(m, ...a) {
    switch (m) {
      case 'doc.pdf': case 'doc.print': { const d = await call('doc.named', a); showDoc(d.html, d.name, m === 'doc.print'); return { file: d.name + '.pdf', viewer: true }; }
      case 'doc.share': { const s = await call('doc.shareText', [a[1]]); const d = await call('doc.named', ['voucher', a[1], {}]); showDoc(d.html, d.name + ' — use "Save as PDF", then attach it', false); window.open(a[0] === 'whatsapp' ? s.whatsapp : s.mailto, '_blank', 'noopener'); return { file: d.name }; }
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
  window.rs = { api, web: true, pickFile, showDoc, download };
})();
