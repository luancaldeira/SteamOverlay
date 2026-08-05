'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onState: (cb) => {
    const listener = (_e, s) => cb(s);
    ipcRenderer.on('state', listener);
    return () => ipcRenderer.removeListener('state', listener);
  },
  enableDebug: () => ipcRenderer.invoke('enableDebug'),
  retry: () => ipcRenderer.invoke('retry'),
  openSteamFolder: () => ipcRenderer.send('openSteamFolder'),
  hide: () => ipcRenderer.send('hide'),
  quit: () => ipcRenderer.send('quit'),
});
