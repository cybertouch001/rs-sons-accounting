// v2.1 Windows app, online mode: the small, safe bridge the server's web app (and the app's own connecting / offline pages)
// may use — save a file, make a real PDF, switch to offline mode. Only the configured server's pages get it (checked again in main).
const { contextBridge, ipcRenderer } = require('electron');
let info = null; try { info = ipcRenderer.sendSync('shell-info'); } catch (_) {}
if (info) {
  const call = async (m, ...a) => { const r = await ipcRenderer.invoke('shell', m, a); if (!r.ok) throw new Error(r.error); return r.data; };
  contextBridge.exposeInMainWorld('rsShell', {
    desktop: true, version: info.version, server: info.server, custom: info.custom, defaultServer: info.defaultServer, viewerLock: !!info.viewerLock, setViewerLock: (on) => call('setViewerLock', !!on),
    offline: () => call('offline'), retry: () => call('retry'),
    saveFile: (name, mime, b64) => call('saveFile', name, mime, b64), savePdf: (html, name, silent) => call('savePdf', html, name, !!silent), savePdfAs: (html, name) => call('savePdfAs', html, name), print: (html) => call('print', html),
  });
}
