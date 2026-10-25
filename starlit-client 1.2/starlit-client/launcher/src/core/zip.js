'use strict';
/** Minimal read-only ZIP support (stored + deflate) - enough for mod jars and natives jars. */
const fs = require('node:fs');
const zlib = require('node:zlib');

function readEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt zip directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, { name, method, csize, usize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntry(buf, e) {
  if (buf.readUInt32LE(e.offset) !== 0x04034b50) throw new Error('corrupt zip entry');
  const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
  const raw = buf.subarray(start, start + e.csize);
  if (e.method === 0) return Buffer.from(raw);
  if (e.method === 8) return zlib.inflateRawSync(raw);
  throw new Error(`unsupported zip compression ${e.method}`);
}

function openZip(file) {
  const buf = fs.readFileSync(file);
  const entries = readEntries(buf);
  return {
    names: () => [...entries.keys()],
    has: (n) => entries.has(n),
    read: (n) => { const e = entries.get(n); if (!e) throw new Error(`${n} not in archive`); return readEntry(buf, e); },
  };
}

module.exports = { openZip };
