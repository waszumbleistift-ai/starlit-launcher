'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createPaths } = require('./paths');
const { createEndpoints } = require('./endpoints');
const { createSettings } = require('./settings');
const { makeProgress, LauncherError } = require('./util');
const versions = require('./versions');
const java = require('./java');
const fabric = require('./fabric');
const mods = require('./mods');
const starlit = require('./starlit');
const launch = require('./launch');
const { createAuth } = require('./auth');
const { createThemes } = require('./themes');

/**
 * The launcher service. The UI (Electron) only talks to this object; it has no knowledge of
 * Minecraft internals. `emit(channel, payload)` delivers progress/log/state events.
 */
function createLauncher({ root, secure, starlitDirs = [], emit = () => {}, endpoints }) {
  const paths = createPaths(root);
  const ctx = { paths, endpoints: createEndpoints(endpoints) };
  const settings = createSettings(paths);
  const auth = createAuth(ctx, secure, () => settings.get().clientId);
  const themes = createThemes(paths, settings);
  const dirs = [path.join(root, 'starlit-mods'), ...starlitDirs];
  let child = null;
  let busy = false;
  let state = 'idle';

  const setState = (s, extra = {}) => { state = s; emit('state', { state: s, ...extra }); };
  const log = (line) => emit('log', line);

  function progressFor(step, steps, name) {
    return makeProgress((p) => emit('progress', { ...p, step, steps, stepName: name }));
  }

  async function findInstalledFabric(mc) {
    try {
      const names = await fsp.readdir(paths.versions);
      return names.filter((n) => n.startsWith('fabric-loader-') && n.endsWith(`-${mc}`)).sort().pop() || null;
    } catch { return null; }
  }

  async function play(mc) {
    if (busy) throw new LauncherError('Minecraft is already starting or running.', 'BUSY');
    busy = true;
    const notices = [];
    const steps = 6;
    try {
      setState('preparing');
      const cfg = settings.get();
      if (!versions.inSupportedRange(mc)) throw new LauncherError(`Minecraft ${mc} is not supported.`, 'UNSUPPORTED');
      paths.ensure();

      let p = progressFor(1, steps, 'Checking account');
      p.phase('Account', 1, 'Verifying licence');
      const session = await auth.session();
      p.tick();

      p = progressFor(2, steps, 'Minecraft files');
      const installed = fs.existsSync(paths.versionJson(mc)) && fs.existsSync(paths.versionJar(mc));
      try { await versions.installVersion(ctx, mc, p); } catch (e) {
        if (installed && e.code === 'NETWORK') notices.push(`Offline: using the installed files for ${mc}.`);
        else throw e;
      }

      let finalId = mc;
      let modsDir = null;
      if (cfg.useFabric) {
        p = progressFor(3, steps, 'Fabric');
        try { finalId = await fabric.installLoader(ctx, mc, p); } catch (e) {
          const existing = e.code === 'NETWORK' && await findInstalledFabric(mc);
          if (!existing) throw e;
          finalId = existing;
          notices.push('Offline: using the installed Fabric loader.');
        }

        p = progressFor(4, steps, 'Mods');
        modsDir = paths.modsDir(mc);
        await fsp.mkdir(modsDir, { recursive: true });
        if (cfg.useStarlit) {
          const r = await starlit.sync(ctx, mc, dirs);
          if (r.status === 'none') notices.push(r.message);
          else if (!r.enabled) notices.push('Starlit is installed but disabled in the mod list.');
        }
        const disabled = await mods.disableIncompatible(ctx, mc);
        if (disabled.length) notices.push(`Disabled mods that do not support Minecraft ${mc}: ${disabled.join(', ')}.`);
        let list = await mods.listMods(ctx, mc);
        if (list.some((m) => m.enabled) && !mods.hasMod(list, 'fabric-api')) {
          try { await fabric.installFabricApi(ctx, mc, modsDir, p); } catch (e) {
            if (list.some((m) => m.enabled && m.depends && m.depends['fabric-api'] !== undefined)) throw e;
            notices.push(`Fabric API could not be installed: ${e.message}`);
          }
          list = await mods.listMods(ctx, mc);
        }
        for (const m of list) for (const i of m.issues) if (m.enabled && i.level === 'warn') notices.push(`${m.name}: ${i.text}`);
      } else {
        progressFor(3, steps, 'Fabric').phase('Fabric', 0, 'Skipped (vanilla)');
        progressFor(4, steps, 'Mods').phase('Mods', 0, 'Skipped (vanilla)');
      }

      p = progressFor(5, steps, 'Java');
      const resolved = await versions.loadResolved(ctx, finalId);
      const jv = await java.resolveJava(ctx, resolved, cfg, p);
      const nativesDir = await versions.prepareNatives(ctx, resolved, finalId);

      p = progressFor(6, steps, 'Launch');
      p.phase('Launch', 1, `Starting Minecraft ${mc}`);
      const gameDir = paths.instanceDir(mc);
      await fsp.mkdir(gameDir, { recursive: true });
      const themeFile = await themes.ensureShared();
      const cmd = launch.buildCommand({ paths, resolved, session, javaExe: jv.exe, settings: cfg, nativesDir, gameDir, themeFile });
      log(`Java ${jv.major} (${jv.source}): ${jv.exe}`);
      log(`Profile: ${finalId}`);
      log(`Command: ${cmd.command} ${launch.redact(cmd.args, session.accessToken).join(' ')}`);
      for (const n of notices) emit('notice', n);

      const logFile = path.join(paths.logs, `latest-${mc}.log`);
      child = launch.start(cmd, {
        logFile,
        onLine: log,
        onExit: (code, err) => {
          child = null; busy = false;
          if (err) emit('error', { message: `Could not start Java: ${err.message}`, code: 'SPAWN' });
          else if (code !== 0) emit('error', { message: `Minecraft closed with exit code ${code}. See the log for details.`, code: 'CRASH' });
          setState('idle', { exitCode: code });
        },
      });
      p.tick();
      setState('running', { pid: child.pid, version: mc });
      return { pid: child.pid, notices, profile: finalId };
    } catch (e) {
      busy = false;
      setState('idle');
      throw e;
    }
  }

  return {
    paths, ctx, settings, auth, themes,
    async init() { paths.ensure(); await settings.load(); },
    state: () => state,
    listVersions: () => versions.listVersions(ctx),
    play,
    stop() { if (child) child.kill(); },
    listMods: (mc) => mods.listMods(ctx, mc),
    importMod: (mc, file) => mods.importMod(ctx, mc, file),
    setModEnabled: (mc, file, on) => mods.setEnabled(ctx, mc, file, on),
    removeMod: (mc, file) => mods.removeMod(ctx, mc, file),
    starlitBuilds: () => starlit.available(dirs),
    starlitFor: (mc) => starlit.findBuild(dirs, mc),
  };
}

module.exports = { createLauncher };
