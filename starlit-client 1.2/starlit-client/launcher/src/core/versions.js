'use strict';
const fsp = require('node:fs/promises');
const fs = require('node:fs');
const path = require('node:path');
const { fetchJson, downloadFile, pool, readJson, writeJsonAtomic, mavenPath, LauncherError } = require('./util');
const { allowed, currentEnv } = require('./env');
const { cmp, parse } = require('./semver');
const { openZip } = require('./zip');

/** Supported range: Fabric does not exist below 1.14, 1.21.11 is the newest target. */
const MIN_VERSION = '1.14';
const MAX_VERSION = '1.21.11';

function inSupportedRange(id) {
  return /^\d+\.\d+(\.\d+)?$/.test(id) && cmp(parse(id), parse(MIN_VERSION)) >= 0 && cmp(parse(id), parse(MAX_VERSION)) <= 0;
}

async function fetchManifest(ctx) {
  const cacheFile = path.join(ctx.paths.cache, 'version_manifest_v2.json');
  try {
    const m = await fetchJson(ctx.endpoints.versionManifest);
    await writeJsonAtomic(cacheFile, m);
    return { manifest: m, offline: false };
  } catch (e) {
    const cached = await readJson(cacheFile, null);
    if (cached) return { manifest: cached, offline: true };
    throw new LauncherError('Could not load the Minecraft version list. Check your internet connection.', 'NETWORK', e);
  }
}

async function listVersions(ctx) {
  const { manifest, offline } = await fetchManifest(ctx);
  const versions = manifest.versions
    .filter((v) => v.type === 'release' && inSupportedRange(v.id))
    .sort((a, b) => cmp(parse(b.id), parse(a.id)))
    .map((v) => ({
      id: v.id, releaseTime: v.releaseTime, url: v.url, sha1: v.sha1,
      installed: fs.existsSync(ctx.paths.versionJson(v.id)) && fs.existsSync(ctx.paths.versionJar(v.id)),
    }));
  return { versions, offline };
}

function libraryFiles(versionJson, env) {
  const map = new Map();
  for (const lib of versionJson.libraries || []) {
    if (!allowed(lib.rules, env)) continue;
    const [group, artifact, , classifier] = lib.name.split(':');
    const baseUrl = lib.url || null;
    const downloads = lib.downloads || {};
    const item = { name: lib.name, classpath: null, native: null };

    if (lib.natives) {
      const cls = lib.natives[env.os] && lib.natives[env.os].replace('${arch}', env.arch === 'x86' ? '32' : '64');
      const nat = cls && downloads.classifiers && downloads.classifiers[cls];
      if (cls && nat) item.native = { ...nat, exclude: (lib.extract && lib.extract.exclude) || ['META-INF/'] };
      if (downloads.artifact) item.classpath = downloads.artifact;
    } else if (downloads.artifact) {
      item.classpath = downloads.artifact;
    } else {
      const rel = mavenPath(lib.name);
      item.classpath = { path: rel, url: (baseUrl || '') + rel, sha1: lib.sha1, size: lib.size, needsBase: !baseUrl };
    }
    if (!item.classpath && !item.native) continue;
    map.set(`${group}:${artifact}:${classifier || ''}:${lib.natives ? 'n' : ''}`, item);
  }
  return [...map.values()];
}

function merge(parent, child) {
  const out = { ...parent, ...child };
  out.libraries = [...(parent.libraries || []), ...(child.libraries || [])];
  const pa = parent.arguments || {}, ca = child.arguments || {};
  if (parent.arguments || child.arguments) {
    out.arguments = { game: [...(pa.game || []), ...(ca.game || [])], jvm: [...(pa.jvm || []), ...(ca.jvm || [])] };
  }
  out.assetIndex = child.assetIndex || parent.assetIndex;
  out.assets = child.assets || parent.assets;
  out.downloads = child.downloads || parent.downloads;
  out.javaVersion = child.javaVersion || parent.javaVersion;
  out.logging = child.logging || parent.logging;
  out.clientJarId = parent.clientJarId || parent.id;
  return out;
}

async function loadResolved(ctx, id) {
  const json = await readJson(ctx.paths.versionJson(id), null);
  if (!json) throw new LauncherError(`Version ${id} is not installed.`, 'NOT_INSTALLED');
  if (!json.inheritsFrom) return { ...json, clientJarId: json.jar || json.id };
  return merge(await loadResolved(ctx, json.inheritsFrom), json);
}

async function installVersion(ctx, id, progress) {
  const { paths, endpoints } = ctx;
  const { manifest } = await fetchManifest(ctx);
  const entry = manifest.versions.find((v) => v.id === id);
  if (!entry || !inSupportedRange(id)) throw new LauncherError(`Minecraft ${id} is not supported by this launcher.`, 'UNSUPPORTED');

  progress.phase('Version metadata', 1, id);
  await fsp.mkdir(paths.versionDir(id), { recursive: true });
  await downloadFile(entry.url, paths.versionJson(id), { sha1: entry.sha1 });
  const vjson = await readJson(paths.versionJson(id), null);
  if (!vjson) throw new LauncherError(`Metadata for ${id} is corrupt.`, 'CORRUPT');
  progress.tick();

  progress.phase('Game files', 1, 'minecraft.jar');
  const client = vjson.downloads && vjson.downloads.client;
  if (!client) throw new LauncherError(`Minecraft ${id} has no client download.`, 'CORRUPT');
  await downloadFile(client.url, paths.versionJar(id), { sha1: client.sha1, size: client.size });
  progress.tick();

  await installLibraries(ctx, vjson, progress);
  await installAssets(ctx, vjson, progress);
  return vjson;
}

async function installLibraries(ctx, vjson, progress) {
  const env = currentEnv();
  const files = [];
  for (const lib of libraryFiles(vjson, env)) {
    if (lib.classpath) files.push(lib.classpath);
    if (lib.native) files.push(lib.native);
  }
  progress.phase('Libraries', files.length);
  await pool(files, 8, async (f) => {
    const url = f.needsBase ? ctx.endpoints.librariesBase + f.path : f.url;
    await downloadFile(url, ctx.paths.libraryFile(f.path), { sha1: f.sha1, size: f.size });
    progress.tick(path.basename(f.path));
  });
}

async function installAssets(ctx, vjson, progress) {
  const idx = vjson.assetIndex;
  if (!idx) return;
  const indexFile = path.join(ctx.paths.assets, 'indexes', `${idx.id}.json`);
  progress.phase('Asset index', 1, idx.id);
  await downloadFile(idx.url, indexFile, { sha1: idx.sha1, size: idx.size });
  progress.tick();
  const index = await readJson(indexFile, null);
  if (!index || !index.objects) throw new LauncherError('Asset index is corrupt.', 'CORRUPT');
  const unique = new Map();
  for (const o of Object.values(index.objects)) unique.set(o.hash, o.size);
  const list = [...unique.entries()];
  progress.phase('Assets', list.length);
  await pool(list, 16, async ([hash, size]) => {
    const dest = path.join(ctx.paths.assets, 'objects', hash.slice(0, 2), hash);
    await downloadFile(`${ctx.endpoints.assetsBase}/${hash.slice(0, 2)}/${hash}`, dest, { sha1: hash, size, trustSize: true });
    progress.tick();
  });
  if (vjson.logging && vjson.logging.client && vjson.logging.client.file) {
    const f = vjson.logging.client.file;
    await downloadFile(f.url, path.join(ctx.paths.assets, 'log_configs', f.id), { sha1: f.sha1, size: f.size });
  }
}

/** Extract old-style natives (<= 1.18) into versions/<id>/natives. Skipped when up to date. */
async function prepareNatives(ctx, resolved, finalId) {
  const env = currentEnv();
  const natives = libraryFiles(resolved, env).filter((l) => l.native);
  const dir = ctx.paths.nativesDir(finalId);
  await fsp.mkdir(dir, { recursive: true });
  const stamp = natives.map((n) => n.native.sha1 || n.native.path).sort().join(',');
  const marker = path.join(dir, '.extracted');
  try { if ((await fsp.readFile(marker, 'utf8')) === stamp) return dir; } catch { /* extract */ }
  for (const n of natives) {
    const zip = openZip(ctx.paths.libraryFile(n.native.path));
    for (const name of zip.names()) {
      if (name.endsWith('/')) continue;
      if (n.native.exclude.some((ex) => name.startsWith(ex))) continue;
      const target = path.join(dir, path.basename(name));
      await fsp.writeFile(target, zip.read(name));
    }
  }
  await fsp.writeFile(marker, stamp);
  return dir;
}

module.exports = {
  MIN_VERSION, MAX_VERSION, inSupportedRange, listVersions, installVersion, installLibraries,
  libraryFiles, loadResolved, prepareNatives, merge, fetchManifest,
};
