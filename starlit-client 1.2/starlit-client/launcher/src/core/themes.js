'use strict';
const fsp = require('node:fs/promises');
const path = require('node:path');
const T = require('../shared/theme');
const { readJson, writeJsonAtomic, LauncherError } = require('./util');

/**
 * Theme service. The raw theme lives in config.json; every change also writes the resolved colours to
 * <root>/shared/theme.json, which the in-game mod reads (path passed as -Dstarlit.theme=...).
 * The mod polls that file, so changes show up in a running game without a restart.
 */
function createThemes(paths, settings) {
  const dir = path.join(paths.root, 'themes');
  const sharedFile = path.join(paths.root, 'shared', 'theme.json');
  const slug = (name) => String(name).trim();
  const validName = (n) => /^[\w][\w .\-]{0,39}$/.test(n);

  async function writeShared(theme) {
    const r = T.resolve(theme);
    await writeJsonAtomic(sharedFile, { version: 1, name: r.name, preset: r.preset, colors: r.colors, onPrimary: r.onPrimary, effects: r.effects });
  }

  const api = {
    sharedFile,
    presets: () => Object.fromEntries(Object.keys(T.PRESETS).map((id) => [id, T.preset(id)])),
    current: () => T.sanitize(settings.get().theme),
    async set(theme) {
      const clean = T.sanitize(theme);
      await settings.update({ theme: clean });
      await writeShared(clean);
      return clean;
    },
    async ensureShared() { await writeShared(api.current()); return sharedFile; },
    async list() {
      try {
        const files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.json'));
        const out = [];
        for (const f of files) {
          const t = await readJson(path.join(dir, f), null);
          if (t && t.name) out.push({ name: t.name, colors: T.sanitize(t).colors });
        }
        return out.sort((a, b) => a.name.localeCompare(b.name));
      } catch { return []; }
    },
    async save(name, theme) {
      name = slug(name);
      if (!validName(name)) throw new LauncherError('Theme names may use letters, numbers, spaces, "-", "_" and ".", up to 40 characters.', 'BAD_NAME');
      const clean = { ...T.sanitize({ ...theme, preset: 'custom' }), name, preset: 'custom' };
      await writeJsonAtomic(path.join(dir, `${name.toLowerCase().replace(/ /g, '_')}.json`), clean);
      return clean;
    },
    async load(name) {
      name = slug(name);
      if (!validName(name)) throw new LauncherError('Invalid theme name.', 'BAD_NAME');
      const t = await readJson(path.join(dir, `${name.toLowerCase().replace(/ /g, '_')}.json`), null);
      if (!t) throw new LauncherError(`Theme "${name}" was not found.`, 'NOT_FOUND');
      return T.sanitize(t);
    },
    async remove(name) {
      name = slug(name);
      if (!validName(name)) throw new LauncherError('Invalid theme name.', 'BAD_NAME');
      await fsp.rm(path.join(dir, `${name.toLowerCase().replace(/ /g, '_')}.json`), { force: true });
    },
  };
  return api;
}

module.exports = { createThemes };
