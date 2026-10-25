'use strict';
const fsp = require('node:fs/promises');
const fs = require('node:fs');
const path = require('node:path');
const { satisfies, cmp, parse } = require('./semver');
const { readMeta } = require('./mods');
const { sha1File, readJson, LauncherError } = require('./util');

/**
 * The Starlit mod is built per Minecraft version. registry.json lists the builds the launcher knows:
 *   { "builds": [ { "file": "starlit-0.1.0-mc1.21.11.jar", "version": "0.1.0", "sha1": "..." } ] }
 * Which Minecraft versions a build supports is read from the jar's own fabric.mod.json, never trusted from the registry.
 */
async function loadRegistry(dirs) {
  const builds = [];
  for (const dir of dirs) {
    const reg = await readJson(path.join(dir, 'registry.json'), { builds: [] });
    for (const b of reg.builds || []) builds.push({ ...b, dir });
  }
  return builds;
}

async function findBuild(dirs, mc) {
  const candidates = [];
  for (const b of await loadRegistry(dirs)) {
    const file = path.join(b.dir, b.file);
    if (!fs.existsSync(file)) continue;
    const { meta } = readMeta(file);
    if (!meta || meta.id !== 'starlit') continue;
    const range = meta.depends && meta.depends.minecraft;
    if (!satisfies(mc, range)) continue;
    if (b.sha1 && (await sha1File(file)) !== b.sha1.toLowerCase()) {
      throw new LauncherError(`Checksum mismatch for ${b.file}. The file was modified; rebuild it or remove it from registry.json.`, 'HASH');
    }
    candidates.push({ file, version: meta.version, range });
  }
  candidates.sort((a, b) => cmp(parse(b.version), parse(a.version)));
  return candidates[0] || null;
}

/** Puts the matching Starlit build into the instance (as starlit.jar) or removes a stale one. */
async function sync(ctx, mc, dirs) {
  const modsDir = ctx.paths.modsDir(mc);
  await fsp.mkdir(modsDir, { recursive: true });
  const target = path.join(modsDir, 'starlit.jar');
  const build = await findBuild(dirs, mc);
  if (!build) {
    await fsp.rm(target, { force: true });
    return { status: 'none', message: `No Starlit build for Minecraft ${mc}. Starting without it.` };
  }
  // respect "disabled" state chosen by the user
  const disabled = `${target}.disabled`;
  const dest = fs.existsSync(disabled) ? disabled : target;
  let same = false;
  if (fs.existsSync(dest)) same = (await sha1File(dest)) === (await sha1File(build.file));
  if (!same) await fsp.copyFile(build.file, dest);
  return { status: 'ok', version: build.version, enabled: dest === target };
}

async function available(dirs) {
  const out = [];
  for (const b of await loadRegistry(dirs)) {
    const file = path.join(b.dir, b.file);
    if (!fs.existsSync(file)) continue;
    const { meta } = readMeta(file);
    if (meta && meta.id === 'starlit') out.push({ file: b.file, version: meta.version, minecraft: meta.depends && meta.depends.minecraft });
  }
  return out;
}

module.exports = { findBuild, sync, available, loadRegistry };
