'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { createLauncher } = require('../core/launcher');

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let launcher = null;

const secure = {
  encrypt(text) {
    if (safeStorage.isEncryptionAvailable()) return Buffer.concat([Buffer.from('E1:'), safeStorage.encryptString(text)]);
    return Buffer.concat([Buffer.from('P0:'), Buffer.from(text)]); // no OS keystore available: plain fallback
  },
  decrypt(buf) {
    const tag = buf.subarray(0, 3).toString();
    if (tag === 'E1:') return safeStorage.decryptString(buf.subarray(3));
    if (tag === 'P0:') return buf.subarray(3).toString();
    throw new Error('unknown account file format');
  },
};

const emit = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send('ev', channel, payload); };

function wrap(fn) {
  return async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; } catch (e) {
      return { ok: false, error: { message: e.message || String(e), code: e.code || 'ERROR' } };
    }
  };
}

const MC_RE = /^\d+\.\d+(\.\d+)?$/;
const needMc = (v) => { if (!MC_RE.test(String(v))) throw new Error('Invalid Minecraft version'); return String(v); };

function allowedLoginUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && /(^|\.)(microsoft\.com|live\.com|microsoftonline\.com)$/.test(x.hostname);
  } catch { return false; }
}

function registerIpc() {
  const L = launcher;
  const h = (name, fn) => ipcMain.handle(name, wrap(fn));
  h('app:state', async () => ({
    settings: L.settings.get(), account: await L.auth.getAccount(), state: L.state(), dataDir: L.paths.root,
  }));
  h('versions:list', () => L.listVersions());
  h('settings:set', (patch) => L.settings.update(patch || {}));
  h('starlit:status', async (mc) => {
    const b = await L.starlitFor(needMc(mc));
    return b ? { available: true, version: b.version } : { available: false };
  });
  h('auth:login', async () => {
    const acc = await L.auth.login((c) => {
      emit('login-code', c);
      if (allowedLoginUrl(c.url)) shell.openExternal(c.url);
    });
    return acc;
  });
  h('auth:cancel', () => L.auth.cancelLogin());
  h('auth:logout', () => L.auth.logout());
  h('play', async (mc) => {
    const r = await L.play(needMc(mc));
    if (!L.settings.get().keepLauncherOpen && win) win.minimize();
    return r;
  });
  h('stop', () => L.stop());
  h('mods:list', (mc) => L.listMods(needMc(mc)));
  h('mods:import', async (mc) => {
    needMc(mc);
    const r = await dialog.showOpenDialog(win, {
      title: 'Import Fabric mods', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Mod files', extensions: ['jar'] }],
    });
    if (r.canceled) return { imported: [], errors: [] };
    const imported = [], errors = [];
    for (const f of r.filePaths) {
      try { imported.push(await L.importMod(mc, f)); } catch (e) { errors.push(e.message); }
    }
    return { imported, errors };
  });
  h('mods:toggle', (mc, file, on) => L.setModEnabled(needMc(mc), String(file), !!on));
  h('mods:remove', (mc, file) => L.removeMod(needMc(mc), String(file)));
  h('mods:folder', async (mc) => { const d = L.paths.modsDir(needMc(mc)); fs.mkdirSync(d, { recursive: true }); await shell.openPath(d); });
  h('theme:get', async () => ({ theme: L.themes.current(), presets: L.themes.presets(), saved: await L.themes.list() }));
  h('theme:set', (t) => L.themes.set(t));
  h('theme:save', async (name, t) => { const r = await L.themes.save(name, t); return { theme: r, saved: await L.themes.list() }; });
  h('theme:load', (name) => L.themes.load(name));
  h('theme:delete', async (name) => { await L.themes.remove(name); return L.themes.list(); });
  h('logs:folder', async () => { fs.mkdirSync(L.paths.logs, { recursive: true }); await shell.openPath(L.paths.logs); });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1120, height: 720, minWidth: 820, minHeight: 540, backgroundColor: '#0b0614', show: false,
    title: 'Starlit Launcher', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenu(null);
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  const dirs = [app.isPackaged ? path.join(process.resourcesPath, 'starlit-mods') : path.join(__dirname, '..', '..', 'starlit-mods')];
  launcher = createLauncher({ root: path.join(app.getPath('userData'), 'data'), secure, starlitDirs: dirs, emit });
  await launcher.init();
  registerIpc();
  createWindow();
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => { if (launcher) launcher.stop(); app.quit(); });
