'use strict';
const fsp = require('node:fs/promises');
const fs = require('node:fs');
const path = require('node:path');
const { openZip } = require('./zip');
const { satisfies } = require('./semver');
const { LauncherError } = require('./util');

const BUILTIN_DEPS = new Set(['fabricloader', 'minecraft', 'java', 'fabric-loader']);

function readMeta(jarFile) {
  try {
    const zip = openZip(jarFile);
    if (!zip.has('fabric.mod.json')) return { error: 'Not a Fabric mod (fabric.mod.json missing)' };
    const meta = JSON.parse(zip.read('fabric.mod.json').toString('utf8').replace(/^﻿/, ''));
    return { meta };
  } catch (e) {
    return { error: `Unreadable jar: ${e.message}` };
  }
}

function toList(v) { return v == null ? [] : Array.isArray(v) ? v : [v]; }

/** Lists the mods of one instance, including enabled state and problems. */
async function listMods(ctx, mc) {
  const dir = ctx.paths.modsDir(mc);
  await fsp.mkdir(dir, { recursive: true });
  const files = (await fsp.readdir(dir)).filter((f) => /\.jar(\.disabled)?$/i.test(f));
  const mods = [];
  for (const file of files) {
    const full = path.join(dir, file);
    const enabled = !/\.disabled$/i.test(file);
    const { meta, error } = readMeta(full);
    const st = await fsp.stat(full);
    const mod = {
      file, enabled, size: st.size, managed: /^starlit\.jar(\.disabled)?$/i.test(file),
      id: meta && meta.id, name: (meta && (meta.name || meta.id)) || file.replace(/\.jar(\.disabled)?$/i, ''),
      version: meta && meta.version, description: meta && meta.description,
      minecraft: meta && meta.depends && meta.depends.minecraft,
      depends: (meta && meta.depends) || {},
      provides: (meta && meta.provides) || [],
      issues: [],
    };
    if (error) mod.issues.push({ level: 'error', code: 'INVALID', text: error });
    else if (meta.depends && meta.depends.minecraft !== undefined && !satisfies(mc, meta.depends.minecraft)) {
      mod.compatible = false;
      mod.issues.push({
        level: 'error', code: 'MC_VERSION',
        text: `Needs Minecraft ${toList(meta.depends.minecraft).join(' or ')}, this instance is ${mc}.`,
      });
    } else mod.compatible = !error;
    mods.push(mod);
  }
  // dependency check among enabled mods
  const provided = new Set(BUILTIN_DEPS);
  for (const m of mods) if (m.enabled && m.id) { provided.add(m.id); for (const p of toList(m.provides)) provided.add(typeof p === 'string' ? p : p.id); }
  for (const m of mods) {
    if (!m.enabled || !m.id) continue;
    for (const dep of Object.keys(m.depends)) {
      if (!provided.has(dep)) m.issues.push({ level: 'warn', code: 'MISSING_DEP', text: `Requires "${dep}", which is not installed or is disabled.` });
    }
  }
  mods.sort((a, b) => a.name.localeCompare(b.name));
  return mods;
}

function safeName(file) {
  const base = path.basename(file);
  if (!/^[\w.\- +()\[\]]+$/.test(base)) return base.replace(/[^\w.\- +()\[\]]/g, '_');
  return base;
}

/** Import a jar from anywhere on disk into the instance. Rejects non-Fabric and wrong-version mods. */
async function importMod(ctx, mc, source) {
  if (!/\.jar$/i.test(source)) throw new LauncherError('Only .jar files can be imported.', 'BAD_FILE');
  const { meta, error } = readMeta(source);
  if (error) throw new LauncherError(`${path.basename(source)}: ${error}`, 'BAD_FILE');
  const warnings = [];
  if (meta.depends && meta.depends.minecraft !== undefined && !satisfies(mc, meta.depends.minecraft)) {
    throw new LauncherError(
      `${meta.name || meta.id} supports Minecraft ${toList(meta.depends.minecraft).join(' or ')} and cannot be used with ${mc}.`,
      'MC_VERSION');
  }
  const dir = ctx.paths.modsDir(mc);
  await fsp.mkdir(dir, { recursive: true });
  const dest = path.join(dir, safeName(source));
  if (fs.existsSync(dest) || fs.existsSync(`${dest}.disabled`)) throw new LauncherError('A mod with this file name is already installed.', 'EXISTS');
  await fsp.copyFile(source, dest);
  const all = await listMods(ctx, mc);
  const me = all.find((m) => m.file === path.basename(dest));
  if (me) for (const i of me.issues) warnings.push(i.text);
  return { file: path.basename(dest), id: meta.id, name: meta.name || meta.id, warnings };
}

function checkName(file) {
  if (file !== path.basename(file) || !/\.jar(\.disabled)?$/i.test(file)) throw new LauncherError('Invalid mod file name.', 'BAD_FILE');
}

async function setEnabled(ctx, mc, file, enabled) {
  checkName(file);
  const dir = ctx.paths.modsDir(mc);
  const cur = path.join(dir, file);
  const isOn = !/\.disabled$/i.test(file);
  if (isOn === enabled) return file;
  if (enabled) {
    const { meta } = readMeta(cur);
    if (meta && meta.depends && meta.depends.minecraft !== undefined && !satisfies(mc, meta.depends.minecraft)) {
      throw new LauncherError(`This mod does not support Minecraft ${mc} and cannot be enabled.`, 'MC_VERSION');
    }
  }
  const next = enabled ? file.replace(/\.disabled$/i, '') : `${file}.disabled`;
  await fsp.rename(cur, path.join(dir, next));
  return next;
}

async function removeMod(ctx, mc, file) {
  checkName(file);
  await fsp.rm(path.join(ctx.paths.modsDir(mc), file), { force: true });
}

/** Called before launch: disables enabled mods that cannot work with this Minecraft version. */
async function disableIncompatible(ctx, mc) {
  const disabled = [];
  for (const m of await listMods(ctx, mc)) {
    if (m.enabled && m.issues.some((i) => i.code === 'MC_VERSION')) {
      await setEnabledForce(ctx, mc, m.file);
      disabled.push(m.name);
    }
  }
  return disabled;
}
async function setEnabledForce(ctx, mc, file) {
  const dir = ctx.paths.modsDir(mc);
  await fsp.rename(path.join(dir, file), path.join(dir, `${file}.disabled`));
}

function hasMod(mods, id) {
  return mods.some((m) => m.enabled && (m.id === id || toList(m.provides).some((p) => (typeof p === 'string' ? p : p.id) === id)));
}

module.exports = { readMeta, listMods, importMod, setEnabled, removeMod, disableIncompatible, hasMod };
