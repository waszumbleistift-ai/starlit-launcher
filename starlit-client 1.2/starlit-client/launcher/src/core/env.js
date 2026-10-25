'use strict';
const os = require('node:os');

function currentEnv(features = {}) {
  const osName = { win32: 'windows', darwin: 'osx', linux: 'linux' }[process.platform] || process.platform;
  const arch = { ia32: 'x86', x64: 'x86_64', arm64: 'arm64' }[process.arch] || process.arch;
  return { os: osName, arch, osVersion: os.release(), features };
}

function ruleMatches(rule, env) {
  if (rule.os) {
    if (rule.os.name && rule.os.name !== env.os) return false;
    if (rule.os.arch && rule.os.arch !== env.arch) return false;
    if (rule.os.version && !new RegExp(rule.os.version).test(env.osVersion)) return false;
  }
  if (rule.features) {
    for (const [k, v] of Object.entries(rule.features)) if (!!env.features[k] !== !!v) return false;
  }
  return true;
}

/** Mojang rule semantics: no rules = allowed; otherwise last matching rule wins, default deny. */
function allowed(rules, env) {
  if (!rules || !rules.length) return true;
  let ok = false;
  for (const r of rules) if (ruleMatches(r, env)) ok = r.action === 'allow';
  return ok;
}

module.exports = { currentEnv, allowed, ruleMatches };
