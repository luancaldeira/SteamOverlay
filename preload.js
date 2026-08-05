'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onState: (cb) => {
    const listener = (_e, s) => cb(s);
    ipcRenderer.on('state', listener);
    return () => ipcRenderer.removeListener('state', listener);
  },
  getState: () => ipcRenderer.invoke('getState'),
  enableDebug: () => ipcRenderer.invoke('enableDebug'),
  retry: () => ipcRenderer.invoke('retry'),
  setSettings: (changes) => ipcRenderer.invoke('setSettings', changes),
  openSteamFolder: () => ipcRenderer.send('openSteamFolder'),
  openDataFolder: () => ipcRenderer.send('openDataFolder'),
  hide: () => ipcRenderer.send('hide'),
  quit: () => ipcRenderer.send('quit'),
});
