'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const UA = 'StarlitLauncher/0.1 (+local)';

class LauncherError extends Error {
  constructor(message, code = 'ERROR', cause) {
    super(message);
    this.name = 'LauncherError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn, { tries = 3, delay = 600, label = 'request' } = {}) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try { return await fn(i); } catch (e) {
      last = e;
      if (e && e.noRetry) break;
      if (i < tries) await sleep(delay * i);
    }
  }
  throw new LauncherError(`${label} failed after ${tries} attempts: ${last && last.message}`, 'NETWORK', last);
}

async function http(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { 'User-Agent': UA, ...(opts.headers || {}) } });
  return res;
}

async function fetchJson(url, opts = {}) {
  return withRetry(async () => {
    const res = await http(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} for ${url}`);
      if (res.status >= 400 && res.status < 500) err.noRetry = true;
      throw err;
    }
    return res.json();
  }, { label: `GET ${url}` });
}

async function sha1File(file) {
  const h = crypto.createHash('sha1');
  await pipeline(fs.createReadStream(file), h);
  return h.digest('hex');
}

async function fileOk(file, { sha1, size } = {}) {
  try {
    const st = await fsp.stat(file);
    if (!st.isFile()) return false;
    if (size != null && st.size !== size) return false;
    if (sha1) return (await sha1File(file)) === sha1.toLowerCase();
    return size != null ? true : st.size > 0;
  } catch { return false; }
}

/**
 * Download url -> dest. Skips when a valid file is already there, writes to
 * dest.part first, verifies size/sha1 and only then renames into place.
 */
async function hashFile(file, algo = 'sha1') {
  const h = crypto.createHash(algo);
  await pipeline(fs.createReadStream(file), h);
  return h.digest('hex');
}

async function validExisting(dest, { expected, hashAlgo, size, trustSize }) {
  try {
    const st = await fsp.stat(dest);
    if (!st.isFile()) return false;
    if (size != null && st.size !== size) return false;
    if (expected && !trustSize) return (await hashFile(dest, hashAlgo)) === expected.toLowerCase();
    return expected || size != null ? true : st.size > 0;
  } catch { return false; }
}

/**
 * Download url -> dest. Skips when a valid file is already there, writes to
 * dest.part first, verifies size/hash and only then renames into place.
 * Returns true when a download happened.
 */
async function downloadFile(url, dest, { sha1, size, hashAlgo = 'sha1', hash, trustSize = false } = {}) {
  const expected = hash || sha1;
  if (await validExisting(dest, { expected, hashAlgo, size, trustSize })) return false;
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  try {
    await withRetry(async () => {
      const res = await http(url);
      if (!res.ok || !res.body) {
        const err = new Error(`HTTP ${res.status} for ${url}`);
        if (res.status >= 400 && res.status < 500) err.noRetry = true;
        throw err;
      }
      const h = crypto.createHash(hashAlgo);
      const src = Readable.fromWeb(res.body);
      src.on('data', (c) => h.update(c));
      await pipeline(src, fs.createWriteStream(part));
      const got = h.digest('hex');
      const st = await fsp.stat(part);
      if (size != null && st.size !== size) {
        throw new Error(`size mismatch for ${path.basename(dest)} (expected ${size}, got ${st.size})`);
      }
      if (expected && got !== expected.toLowerCase()) {
        throw new Error(`${hashAlgo} mismatch for ${path.basename(dest)}`);
      }
      await fsp.rename(part, dest);
    }, { label: `download ${url}` });
  } catch (e) {
    await fsp.rm(part, { force: true });
    throw e;
  }
  return true;
}

async function pool(items, limit, worker) {
  let i = 0, firstError;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!firstError) {
      const idx = i++;
      if (idx >= items.length) return;
      try { await worker(items[idx], idx); } catch (e) { firstError = firstError || e; }
    }
  });
  await Promise.all(runners);
  if (firstError) throw firstError;
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return fallback; }
}

async function writeJsonAtomic(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2));
  await fsp.rename(tmp, file);
}

/** "net.fabricmc:fabric-loader:0.16.0[:classifier][@ext]" -> maven relative path */
function mavenPath(name) {
  let ext = 'jar';
  if (name.includes('@')) [name, ext] = name.split('@');
  const [group, artifact, version, classifier] = name.split(':');
  const file = `${artifact}-${version}${classifier ? '-' + classifier : ''}.${ext}`;
  return `${group.replace(/\./g, '/')}/${artifact}/${version}/${file}`;
}

/** Throttled progress reporting helper. */
function makeProgress(emit) {
  const state = { phase: '', label: '', done: 0, total: 0 };
  let last = 0;
  const push = (force) => {
    const now = Date.now();
    if (force || now - last > 80) { last = now; emit({ ...state }); }
  };
  return {
    phase(phase, total = 0, label = '') { state.phase = phase; state.total = total; state.done = 0; state.label = label; push(true); },
    tick(label) { state.done++; if (label) state.label = label; push(state.done >= state.total); },
    set(label) { state.label = label; push(true); },
    done() { push(true); },
  };
}

module.exports = {
  LauncherError, sleep, withRetry, http, fetchJson, sha1File, hashFile, fileOk, downloadFile,
  pool, readJson, writeJsonAtomic, mavenPath, makeProgress,
};
