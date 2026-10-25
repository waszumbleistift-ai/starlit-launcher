'use strict';
const path = require('node:path');
const fs = require('node:fs');

/** All on-disk locations of the launcher, derived from a single root folder. */
function createPaths(root) {
  const p = {
    root,
    config: path.join(root, 'config.json'),
    accounts: path.join(root, 'accounts.bin'),
    versions: path.join(root, 'versions'),
    libraries: path.join(root, 'libraries'),
    assets: path.join(root, 'assets'),
    runtime: path.join(root, 'runtime'),
    logs: path.join(root, 'logs'),
    cache: path.join(root, 'cache'),
    instances: path.join(root, 'instances'),
    versionDir: (id) => path.join(root, 'versions', id),
    versionJson: (id) => path.join(root, 'versions', id, `${id}.json`),
    versionJar: (id) => path.join(root, 'versions', id, `${id}.jar`),
    nativesDir: (id) => path.join(root, 'versions', id, 'natives'),
    instanceDir: (mc) => path.join(root, 'instances', mc),
    modsDir: (mc) => path.join(root, 'instances', mc, 'mods'),
    libraryFile: (rel) => path.join(root, 'libraries', ...rel.split('/')),
    runtimeDir: (component) => path.join(root, 'runtime', component),
  };
  p.ensure = () => {
    for (const d of [p.root, p.versions, p.libraries, p.assets, p.runtime, p.logs, p.cache, p.instances]) {
      fs.mkdirSync(d, { recursive: true });
    }
  };
  return p;
}

module.exports = { createPaths };
