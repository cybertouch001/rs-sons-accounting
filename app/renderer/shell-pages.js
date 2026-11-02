// v2.1 Windows app: the local "Connecting…" and "No internet" pages shown while the online login cannot load.
(function () {
  const q = new URLSearchParams(location.search); const S = window.rsShell; const $ = id => document.getElementById(id);
  const server = q.get('server') || (S && S.server) || '';
  if ($('srv')) $('srv').textContent = 'Server: ' + server.replace(/^https?:\/\//, '');
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  if (S && S.viewerLock) { ['off', 'adv', 'advbox'].forEach(id => { const el = $(id); if (el) el.style.display = 'none'; }); const s = $('s'); if (s) s.innerHTML = s.innerHTML.replace(/<br>[^<]*Offline[^<]*$/i, ''); }   // v2.2 view-only PC
  on('retry', () => { $('t').textContent = 'Connecting… · जुड़ रहा है'; S && S.retry(); });
  on('off', () => S && S.offline());
  on('adv', () => { $('advbox').classList.toggle('hidden'); $('url').focus(); });
  on('advdef', () => S && S.resetServer());
  on('advok', async () => { $('adverr').textContent = 'Checking…'; try { await S.setServer($('url').value.trim()); } catch (e) { $('adverr').textContent = e.message.replace(/^Error invoking remote method 'shell': (Error: )?/, ''); } });
  if (/connecting\.html$/.test(location.pathname)) {
    // still here after a while = the server is slow to answer (waking up) — say so, offer Retry / Offline
    setTimeout(() => { $('t').textContent = 'Server jag raha hai… · Server is waking up'; $('s').textContent = 'Pehli baar 10-30 sec lag sakte hain. Please wait — app atki nahi hai.'; }, 6000);
    setTimeout(() => { $('b').classList.remove('hidden'); }, 20000);
  } else {
    const code = Number(q.get('code') || 0); const desc = q.get('desc') || '';
    if (navigator.onLine && code && !/INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NETWORK_CHANGED|ADDRESS_UNREACHABLE/.test(desc)) {
      $('t').textContent = '⚠ Server tak nahi pahunch paaye';
      $('s').innerHTML = 'Could not reach the server (' + desc.replace(/[<>&]/g, '') + '). Thodi der baad Retry karo.<br>Aapka data server pe safe hai. Bina internet kaam karna ho to Offline mode kholo.';
    }
    // auto-retry: when the internet comes back, and every 15 s while the PC says it is online
    window.addEventListener('online', () => S && S.retry());
    setInterval(() => { if (navigator.onLine && S) S.retry(); }, 15000);
  }
})();
