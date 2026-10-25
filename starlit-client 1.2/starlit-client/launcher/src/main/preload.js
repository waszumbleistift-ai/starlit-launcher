'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const INVOKE = new Set([
  'app:state', 'versions:list', 'settings:set', 'starlit:status', 'auth:login', 'auth:cancel', 'auth:logout',
  'theme:get', 'theme:set', 'theme:save', 'theme:load', 'theme:delete', 'play', 'stop', 'mods:list', 'mods:import', 'mods:toggle', 'mods:remove', 'mods:folder', 'logs:folder',
]);

contextBridge.exposeInMainWorld('api', {
  invoke: (name, ...args) => {
    if (!INVOKE.has(name)) return Promise.resolve({ ok: false, error: { message: `Unknown call ${name}`, code: 'ERROR' } });
    return ipcRenderer.invoke(name, ...args);
  },
  onEvent: (cb) => { ipcRenderer.on('ev', (_e, channel, payload) => cb(channel, payload)); },
});
