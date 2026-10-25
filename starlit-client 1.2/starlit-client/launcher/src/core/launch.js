'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { allowed, currentEnv } = require('./env');
const { libraryFiles } = require('./versions');

const LAUNCHER_NAME = 'StarlitLauncher';
const LAUNCHER_VERSION = '0.1.0';

function expand(list, env, vars) {
  const sub = (s) => s.replace(/\$\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  const out = [];
  for (const a of list || []) {
    if (typeof a === 'string') { out.push(sub(a)); continue; }
    if (!allowed(a.rules, env)) continue;
    for (const v of Array.isArray(a.value) ? a.value : [a.value]) out.push(sub(v));
  }
  return out;
}

/** Builds the full command line. Pure function: no network, no disk writes. */
function buildCommand({ paths, resolved, session, javaExe, settings, nativesDir, gameDir, themeFile }) {
  const env = currentEnv({
    has_custom_resolution: !!(settings.windowWidth && settings.windowHeight),
  });
  const sep = process.platform === 'win32' ? ';' : ':';
  const cp = libraryFiles(resolved, env).filter((l) => l.classpath).map((l) => paths.libraryFile(l.classpath.path));
  cp.push(paths.versionJar(resolved.clientJarId));

  const vars = {
    auth_player_name: session.name,
    auth_uuid: session.uuid,
    auth_access_token: session.accessToken,
    auth_xuid: session.xuid || '',
    clientid: session.clientId || '',
    auth_session: `token:${session.accessToken}:${session.uuid}`,
    user_type: 'msa',
    user_properties: '{}',
    version_name: resolved.id,
    version_type: resolved.type === 'release' ? 'release' : (resolved.type || 'release'),
    game_directory: gameDir,
    assets_root: paths.assets,
    game_assets: paths.assets,
    assets_index_name: (resolved.assetIndex && resolved.assetIndex.id) || resolved.assets,
    natives_directory: nativesDir,
    library_directory: paths.libraries,
    classpath_separator: sep,
    classpath: cp.join(sep),
    launcher_name: LAUNCHER_NAME,
    launcher_version: LAUNCHER_VERSION,
    resolution_width: settings.windowWidth || 854,
    resolution_height: settings.windowHeight || 480,
  };

  let jvm;
  let game;
  if (resolved.arguments) {
    jvm = expand(resolved.arguments.jvm, env, vars);
    game = expand(resolved.arguments.game, env, vars);
  } else {
    jvm = [`-Djava.library.path=${nativesDir}`, '-cp', vars.classpath];
    game = (resolved.minecraftArguments || '').split(' ').filter(Boolean)
      .map((s) => s.replace(/\$\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)));
  }
  if (!jvm.includes('-cp') && !jvm.includes('-classpath')) jvm.push('-cp', vars.classpath);

  const logArg = resolved.logging && resolved.logging.client;
  if (logArg && logArg.argument && logArg.file) {
    jvm.push(logArg.argument.replace('${path}', path.join(paths.assets, 'log_configs', logArg.file.id)));
  }

  if (themeFile) jvm.push(`-Dstarlit.theme=${themeFile}`);
  if (['a', 'b'].includes(settings.skyHooks)) jvm.push(`-Dstarlit.skyhooks=${settings.skyHooks}`);

  const user = (settings.jvmArgs || '').match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  const args = [
    `-Xmx${settings.maxRamMb}M`, '-Xms256M',
    ...user.map((s) => s.replace(/^"|"$/g, '')),
    ...jvm, resolved.mainClass, ...game,
  ];
  return { command: javaExe, args, cwd: gameDir };
}

/** Starts the game; returns a handle with the child process and its log file. */
function start({ command, args, cwd }, { logFile, onLine, onExit }) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const log = fs.createWriteStream(logFile);
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const pipe = (stream) => {
    let buf = '';
    stream.on('data', (d) => {
      log.write(d);
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { onLine && onLine(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); }
    });
  };
  pipe(child.stdout); pipe(child.stderr);
  child.on('error', (e) => { log.end(); onExit && onExit(-1, e); });
  child.on('close', (code) => { log.end(); onExit && onExit(code); });
  return child;
}

/** Redacts the access token for display/logging. */
function redact(args, token) {
  return args.map((a) => (token && a.includes(token) ? a.split(token).join('***') : a));
}

module.exports = { buildCommand, start, redact, expand };
