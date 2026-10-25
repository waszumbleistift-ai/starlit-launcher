'use strict';
const fsp = require('node:fs/promises');
const path = require('node:path');
const { fetchJson, downloadFile, pool, writeJsonAtomic, readJson, LauncherError } = require('./util');
const { libraryFiles } = require('./versions');
const { currentEnv } = require('./env');

/** Installs the Fabric loader profile for a Minecraft version. Returns the profile id. */
async function installLoader(ctx, mc, progress) {
  const meta = ctx.endpoints.fabricMeta;
  progress.phase('Fabric loader', 1, mc);
  let list;
  try { list = await fetchJson(`${meta}/v2/versions/loader/${encodeURIComponent(mc)}`); } catch (e) {
    if (/HTTP 4\d\d/.test(e.message || '') || /HTTP 4\d\d/.test((e.cause && e.cause.message) || '')) {
      throw new LauncherError(`Fabric does not support Minecraft ${mc}.`, 'NO_FABRIC', e);
    }
    throw e;
  }
  const pick = (list || []).find((x) => x.loader && x.loader.stable) || (list || [])[0];
  if (!pick) throw new LauncherError(`Fabric does not support Minecraft ${mc}.`, 'NO_FABRIC');
  const lv = pick.loader.version;
  const id = `fabric-loader-${lv}-${mc}`;
  if (!(await readJson(ctx.paths.versionJson(id), null))) {
    const profile = await fetchJson(`${meta}/v2/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(lv)}/profile/json`);
    await writeJsonAtomic(ctx.paths.versionJson(id), profile);
  }
  const profile = await readJson(ctx.paths.versionJson(id), null);
  const files = libraryFiles(profile, currentEnv()).map((l) => l.classpath).filter(Boolean);
  progress.phase('Fabric libraries', files.length);
  await pool(files, 6, async (f) => {
    const url = f.needsBase ? ctx.endpoints.librariesBase + f.path : f.url;
    await downloadFile(url, ctx.paths.libraryFile(f.path), { sha1: f.sha1, size: f.size });
    progress.tick(path.basename(f.path));
  });
  return id;
}

/** Fetches the newest Fabric API build for this Minecraft version from Modrinth (hash-verified). */
async function installFabricApi(ctx, mc, modsDir, progress) {
  const q = `game_versions=${encodeURIComponent(JSON.stringify([mc]))}&loaders=${encodeURIComponent('["fabric"]')}`;
  progress.phase('Fabric API', 1, mc);
  const versions = await fetchJson(`${ctx.endpoints.modrinth}/v2/project/fabric-api/version?${q}`);
  const v = (versions || []).find((x) => x.version_type === 'release') || (versions || [])[0];
  if (!v) throw new LauncherError(`No Fabric API build found for Minecraft ${mc}.`, 'NO_FABRIC_API');
  const file = v.files.find((f) => f.primary) || v.files[0];
  const hash = file.hashes && (file.hashes.sha512 || file.hashes.sha1);
  const algo = file.hashes && file.hashes.sha512 ? 'sha512' : 'sha1';
  if (!hash) throw new LauncherError('Fabric API download has no checksum; refusing to install it.', 'NO_HASH');
  await fsp.mkdir(modsDir, { recursive: true });
  await downloadFile(file.url, path.join(modsDir, file.filename), { hash, hashAlgo: algo, size: file.size });
  progress.tick(file.filename);
  return { file: file.filename, version: v.version_number };
}

module.exports = { installLoader, installFabricApi };
