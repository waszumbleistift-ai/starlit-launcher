#!/usr/bin/env node
'use strict';
/**
 * Registers a built Starlit jar with the launcher:
 *   node scripts/add-starlit-build.js path/to/starlit-0.1.0.jar
 * Copies it to starlit-mods/, reads the supported Minecraft range from its fabric.mod.json and records its SHA-1.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readMeta } = require('../src/core/mods');

const src = process.argv[2];
if (!src || !fs.existsSync(src)) { console.error('Usage: node scripts/add-starlit-build.js <starlit.jar>'); process.exit(1); }
const { meta, error } = readMeta(src);
if (error || meta.id !== 'starlit') { console.error(`Not a Starlit jar: ${error || 'mod id is ' + meta.id}`); process.exit(1); }
const mc = meta.depends && meta.depends.minecraft;
if (!mc) { console.error('The jar does not declare a Minecraft version in fabric.mod.json "depends".'); process.exit(1); }

const dir = path.join(__dirname, '..', 'starlit-mods');
fs.mkdirSync(dir, { recursive: true });
const file = path.basename(src);
fs.copyFileSync(src, path.join(dir, file));
const sha1 = crypto.createHash('sha1').update(fs.readFileSync(src)).digest('hex');
const regFile = path.join(dir, 'registry.json');
const reg = fs.existsSync(regFile) ? JSON.parse(fs.readFileSync(regFile, 'utf8')) : { builds: [] };
reg.builds = (reg.builds || []).filter((b) => b.file !== file);
reg.builds.push({ file, sha1 });
fs.writeFileSync(regFile, JSON.stringify(reg, null, 2));
console.log(`Registered ${file} (Starlit ${meta.version}, Minecraft ${JSON.stringify(mc)}, sha1 ${sha1})`);
