
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('rs', {
  api: async (method, ...args) => { const r = await ipcRenderer.invoke('api', method, args); if (!r.ok) throw new Error(r.error); return r.data; },
});
