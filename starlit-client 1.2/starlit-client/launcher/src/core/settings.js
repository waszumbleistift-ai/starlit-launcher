'use strict';
const { readJson, writeJsonAtomic } = require('./util');

const DEFAULTS = {
  clientId: '',
  selectedVersion: '1.21.11',
  maxRamMb: 4096,
  jvmArgs: '',
  javaPath: '',
  useFabric: true,
  useStarlit: true,
  keepLauncherOpen: true,
  windowWidth: 0,
  windowHeight: 0,
  installedMods: {},
  theme: null,
  skyHooks: 'off',
};

function createSettings(paths) {
  let data = null;
  const api = {
    async load() {
      data = { ...DEFAULTS, ...(await readJson(paths.config, {})) };
      return api.get();
    },
    get() { return { ...DEFAULTS, ...(data || {}) }; },
    async update(patch) {
      if (!data) await api.load();
      const clean = {};
      for (const k of Object.keys(DEFAULTS)) if (k in patch) clean[k] = patch[k];
      if ('skyHooks' in clean && !['off', 'a', 'b'].includes(clean.skyHooks)) clean.skyHooks = 'off';
      if ('maxRamMb' in clean) clean.maxRamMb = Math.max(512, Math.min(65536, Math.round(Number(clean.maxRamMb) || DEFAULTS.maxRamMb)));
      if ('clientId' in clean) clean.clientId = String(clean.clientId).trim();
      data = { ...data, ...clean };
      await writeJsonAtomic(paths.config, data);
      return api.get();
    },
  };
  return api;
}

module.exports = { createSettings, DEFAULTS };
