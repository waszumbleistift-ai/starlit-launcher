'use strict';
const fsp = require('node:fs/promises');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { fetchJson, downloadFile, pool, readJson, LauncherError } = require('./util');

function platformKey() {
  const a = process.arch;
  if (process.platform === 'win32') return a === 'ia32' ? 'windows-x86' : a === 'arm64' ? 'windows-arm64' : 'windows-x64';
  if (process.platform === 'darwin') return a === 'arm64' ? 'mac-os-arm64' : 'mac-os';
  return a === 'ia32' ? 'linux-i386' : 'linux';
}

function javaExe(dir) {
  if (process.platform === 'win32') return path.join(dir, 'bin', 'java.exe');
  if (process.platform === 'darwin') return path.join(dir, 'jre.bundle', 'Contents', 'Home', 'bin', 'java');
  return path.join(dir, 'bin', 'java');
}

/** Download Mojang's own Java runtime for this Minecraft version (component e.g. java-runtime-delta). */
async function ensureRuntime(ctx, component, progress) {
  const all = await fetchJson(ctx.endpoints.runtimeIndex);
  const entry = (((all || {})[platformKey()] || {})[component] || [])[0];
  if (!entry) throw new LauncherError(`Mojang offers no Java runtime "${component}" for ${platformKey()}.`, 'NO_RUNTIME');
  const dir = ctx.paths.runtimeDir(component);
  const marker = path.join(dir, `.installed-${entry.manifest.sha1}`);
  if (fs.existsSync(marker) && fs.existsSync(javaExe(dir))) return javaExe(dir);

  const manifest = await fetchJson(entry.manifest.url);
  const files = Object.entries(manifest.files || {});
  const work = [];
  for (const [rel, f] of files) {
    const target = path.join(dir, ...rel.split('/'));
    if (f.type === 'directory') await fsp.mkdir(target, { recursive: true });
    else if (f.type === 'file' && f.downloads && f.downloads.raw) work.push({ rel, target, f });
  }
  progress.phase('Java runtime', work.length, component);
  await pool(work, 8, async ({ target, f }) => {
    const raw = f.downloads.raw;
    await downloadFile(raw.url, target, { sha1: raw.sha1, size: raw.size });
    if (f.executable && process.platform !== 'win32') await fsp.chmod(target, 0o755);
    progress.tick(path.basename(target));
  });
  for (const e of await fsp.readdir(dir)) if (e.startsWith('.installed-')) await fsp.rm(path.join(dir, e), { force: true });
  await fsp.writeFile(marker, new Date().toISOString());
  return javaExe(dir);
}

function systemJavaMajor(exe) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try { child = spawn(exe, ['-version']); } catch { return resolve(0); }
    child.stderr.on('data', (d) => { out += d; });
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => resolve(0));
    child.on('close', () => {
      const m = out.match(/version "(\d+)(?:\.(\d+))?/);
      if (!m) return resolve(0);
      resolve(m[1] === '1' ? parseInt(m[2] || '8', 10) : parseInt(m[1], 10));
    });
  });
}

/** User override > Mojang runtime > java on PATH with a sufficient major version. */
async function resolveJava(ctx, resolved, settings, progress) {
  const need = (resolved.javaVersion && resolved.javaVersion.majorVersion) || 8;
  if (settings.javaPath) {
    if (!fs.existsSync(settings.javaPath)) throw new LauncherError(`Configured Java not found: ${settings.javaPath}`, 'NO_JAVA');
    const major = await systemJavaMajor(settings.javaPath);
    if (major && major < need) throw new LauncherError(`Minecraft needs Java ${need}, but the configured Java is version ${major}.`, 'JAVA_TOO_OLD');
    return { exe: settings.javaPath, major, source: 'custom' };
  }
  const component = (resolved.javaVersion && resolved.javaVersion.component) || 'jre-legacy';
  try {
    return { exe: await ensureRuntime(ctx, component, progress), major: need, source: 'mojang' };
  } catch (e) {
    const major = await systemJavaMajor('java');
    if (major >= need) return { exe: 'java', major, source: 'system' };
    throw e instanceof LauncherError ? e : new LauncherError(`Could not provide Java ${need}: ${e.message}`, 'NO_JAVA', e);
  }
}

module.exports = { ensureRuntime, resolveJava, platformKey, javaExe, systemJavaMajor };
