// v2.1 Windows app: the local "Connecting…" and "No internet" pages shown while the online login cannot load.
(function () {
  const q = new URLSearchParams(location.search); const S = window.rsShell; const $ = id => document.getElementById(id);
  const server = q.get('server') || (S && S.server) || '';
  if ($('srv')) $('srv').textContent = 'Server: ' + server.replace(/^https?:\/\//, '');
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  if (S && S.viewerLock) { ['off'].forEach(id => { const el = $(id); if (el) el.style.display = 'none'; }); const s = $('s'); if (s) s.innerHTML = s.innerHTML.replace(/<br>[^<]*Offline[^<]*$/i, ''); }   // v2.2 view-only PC
  on('retry', () => { $('t').textContent = 'Connecting…'; S && S.retry(); });
  on('off', () => S && S.offline());
  if (/connecting\.html$/.test(location.pathname)) {
    // still here after a while = the server is slow to answer (waking up) — say so, offer Retry / Offline
    setTimeout(() => { $('t').textContent = 'Server is waking up…'; $('s').textContent = 'The first time can take 10–30 seconds. Please wait — the app is not stuck.'; }, 6000);
    setTimeout(() => { $('b').classList.remove('hidden'); }, 20000);
  } else {
    const code = Number(q.get('code') || 0); const desc = q.get('desc') || '';
    if (navigator.onLine && code && !/INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NETWORK_CHANGED|ADDRESS_UNREACHABLE/.test(desc)) {
      $('t').textContent = '⚠ Could not reach the server';
      $('s').innerHTML = 'Could not reach the server (' + desc.replace(/[<>&]/g, '') + '). Please press Retry in a little while.<br>Your data is safe on the server. To work without internet, open Offline mode.';
    }
    // auto-retry: when the internet comes back, and every 15 s while the PC says it is online
    window.addEventListener('online', () => S && S.retry());
    setInterval(() => { if (navigator.onLine && S) S.retry(); }, 15000);
  }
})();
