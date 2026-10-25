'use strict';
const http = require('node:http');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');
const sha512 = (b) => crypto.createHash('sha512').update(b).digest('hex');

/** Writes a valid zip. entries: {name: string|Buffer}. First entry deflated, rest stored (covers both readers). */
function makeZip(entries) {
  const parts = [], central = [];
  let offset = 0, i = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.from(content);
    const method = i++ % 2 === 0 ? 8 : 0;
    const comp = method === 8 ? zlib.deflateRawSync(data) : data;
    const nameB = Buffer.from(name);
    const crc = zlib.crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameB.length, 26);
    parts.push(lh, nameB, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameB.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameB);
    offset += 30 + nameB.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(i, 8); end.writeUInt16LE(i, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

function modJar(meta) { return makeZip({ 'fabric.mod.json': JSON.stringify({ schemaVersion: 1, ...meta }), 'a.txt': 'x' }); }

function tmp(prefix = 'starlit-test-') { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

/** In-process fake of Mojang, Fabric, Modrinth, Microsoft, Xbox and Minecraft services. */
async function fakeServer(opts = {}) {
  const files = new Map();   // path -> Buffer
  const jsons = new Map();   // path -> object
  const state = { tokenCalls: 0, owns: opts.owns !== false, hits: [], xboxHeaders: [], xsts: null, breakHash: new Set() };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    state.hits.push(`${req.method} ${url.pathname}`);
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.method === 'POST') {
        if (url.pathname === '/ms/devicecode') return send(200, { device_code: 'DC', user_code: 'ABCD-1234', verification_uri: 'https://microsoft.com/link', expires_in: 60, interval: 0.01 });
        if (url.pathname === '/ms/token') {
          const p = new URLSearchParams(body);
          if (p.get('grant_type') === 'refresh_token') return send(200, { access_token: 'MS2', refresh_token: 'RT2' });
          state.tokenCalls++;
          return state.tokenCalls < 2 ? send(400, { error: 'authorization_pending' }) : send(200, { access_token: 'MS', refresh_token: 'RT' });
        }
        if (url.pathname === '/xbl' || url.pathname === '/xsts') {
          state.xboxHeaders.push([url.pathname, req.headers['x-xbl-contract-version']]);
          if (req.headers['x-xbl-contract-version'] !== '1') return send(400, { Message: 'missing contract version' });
        }
        if (url.pathname === '/xbl') return send(200, { Token: 'XBL', DisplayClaims: { xui: [{ uhs: 'UHS' }] } });
        if (url.pathname === '/xsts') return state.xsts ? send(state.xsts.status, state.xsts.body) : send(200, { Token: 'XSTS' });
        if (url.pathname === '/mclogin') { const ok = JSON.parse(body).identityToken === 'XBL3.0 x=UHS;XSTS'; return send(ok ? 200 : 401, { access_token: 'MCTOKEN', expires_in: 86400 }); }
      }
      if (url.pathname === '/mcent') return send(200, { items: state.owns ? [{ name: 'game_minecraft' }] : [] });
      if (url.pathname === '/mcprofile') return state.owns ? send(200, { id: 'abcdef0123456789abcdef0123456789', name: 'Steve', skins: [] }) : send(404, { error: 'NOT_FOUND' });
      if (jsons.has(url.pathname)) return send(200, jsons.get(url.pathname));
      if (files.has(url.pathname)) { res.writeHead(200); return res.end(files.get(url.pathname)); }
      res.writeHead(404); res.end('nope');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = {
    base, state, files, jsons,
    addFile(p, buf) { files.set(p, Buffer.from(buf)); return `${base}${p}`; },
    addJson(p, obj) { jsons.set(p, obj); return `${base}${p}`; },
    endpoints: {
      versionManifest: `${base}/manifest.json`, runtimeIndex: `${base}/runtime/all.json`, assetsBase: `${base}/assets`,
      librariesBase: `${base}/libs/`, fabricMeta: `${base}/fabric`, modrinth: `${base}/modrinth`,
      msDevice: `${base}/ms/devicecode`, msToken: `${base}/ms/token`, xblAuth: `${base}/xbl`, xstsAuth: `${base}/xsts`,
      mcLogin: `${base}/mclogin`, mcEntitlements: `${base}/mcent`, mcProfile: `${base}/mcprofile`,
    },
    close: () => new Promise((r) => { server.closeAllConnections && server.closeAllConnections(); server.close(r); }),
  };
  return api;
}

/** Registers a complete fake Minecraft version (+ the Fabric/runtime pieces) on the server. */
function addMinecraft(srv, id, { javaComponent = 'java-runtime-fake' } = {}) {
  const client = Buffer.from(`client-jar-${id}`);
  const lib = Buffer.from('lib-a');
  const winOnly = Buffer.from('lib-win');
  const nativeZip = makeZip({ 'libfoo.so': 'ELF', 'META-INF/MANIFEST.MF': 'x' });
  const assetA = Buffer.from('asset-a'), assetB = Buffer.from('asset-b');
  const logCfg = Buffer.from('<Configuration/>');
  const libUrl = srv.addFile(`/vlibs/${id}/a.jar`, lib);
  srv.addFile(`/vlibs/${id}/win.jar`, winOnly);
  const nativeUrl = srv.addFile(`/vlibs/${id}/natives-linux.jar`, nativeZip);
  const clientUrl = srv.addFile(`/client/${id}.jar`, client);
  srv.addFile(`/assets/${sha1(assetA).slice(0, 2)}/${sha1(assetA)}`, assetA);
  srv.addFile(`/assets/${sha1(assetB).slice(0, 2)}/${sha1(assetB)}`, assetB);
  const logUrl = srv.addFile(`/log/${id}.xml`, logCfg);
  const index = { objects: { 'a.txt': { hash: sha1(assetA), size: assetA.length }, 'b.txt': { hash: sha1(assetB), size: assetB.length }, 'c.txt': { hash: sha1(assetA), size: assetA.length } } };
  const indexUrl = srv.addJson(`/index/${id}.json`, index);
  const vjson = {
    id, type: 'release', mainClass: 'net.minecraft.client.main.Main',
    javaVersion: { component: javaComponent, majorVersion: 21 },
    assetIndex: { id: `idx-${id}`, url: indexUrl, sha1: sha1(Buffer.from(JSON.stringify(index))), size: Buffer.byteLength(JSON.stringify(index)) },
    downloads: { client: { url: clientUrl, sha1: sha1(client), size: client.length } },
    logging: { client: { argument: '-Dlog4j.configurationFile=${path}', file: { id: `log-${id}.xml`, url: logUrl, sha1: sha1(logCfg), size: logCfg.length } } },
    libraries: [
      { name: 'org.example:liba:1.0', downloads: { artifact: { path: 'org/example/liba/1.0/liba-1.0.jar', url: libUrl, sha1: sha1(lib), size: lib.length } } },
      { name: 'org.example:winonly:1.0', rules: [{ action: 'allow', os: { name: 'windows' } }],
        downloads: { artifact: { path: 'org/example/winonly/1.0/winonly-1.0.jar', url: `${srv.base}/vlibs/${id}/win.jar`, sha1: sha1(winOnly), size: winOnly.length } } },
      { name: 'org.example:nat:1.0', natives: { linux: 'natives-linux', windows: 'natives-windows' }, extract: { exclude: ['META-INF/'] },
        downloads: { classifiers: { 'natives-linux': { path: 'org/example/nat/1.0/nat-1.0-natives-linux.jar', url: nativeUrl, sha1: sha1(nativeZip), size: nativeZip.length } } } },
    ],
    arguments: {
      game: ['--username', '${auth_player_name}', '--version', '${version_name}', '--gameDir', '${game_directory}',
        '--assetsDir', '${assets_root}', '--assetIndex', '${assets_index_name}', '--uuid', '${auth_uuid}', '--accessToken', '${auth_access_token}',
        { rules: [{ action: 'allow', features: { has_custom_resolution: true } }], value: ['--width', '${resolution_width}'] }],
      jvm: ['-Djava.library.path=${natives_directory}', '-Dlauncher=${launcher_name}', '-cp', '${classpath}'],
    },
  };
  const url = srv.addJson(`/versions/${id}.json`, vjson);
  const raw = JSON.stringify(vjson);
  return { id, url, sha1: sha1(Buffer.from(raw)), vjson };
}

function setupManifestAndTools(srv, ids, { badClientHash = false } = {}) {
  const entries = ids.map((id) => addMinecraft(srv, id));
  srv.addJson('/manifest.json', {
    versions: [
      { id: '26.1', type: 'release', url: `${srv.base}/versions/26.1.json`, sha1: 'x', releaseTime: '2026' },
      { id: '25w01a', type: 'snapshot', url: 'x', sha1: 'x', releaseTime: '2025' },
      ...entries.map((e) => ({ id: e.id, type: 'release', url: e.url, sha1: e.sha1, releaseTime: '2025' })),
      { id: '1.14', type: 'release', url: 'x', sha1: 'x', releaseTime: '2019' },
      { id: '1.8.9', type: 'release', url: 'x', sha1: 'x', releaseTime: '2015' },
    ],
  });
  // fake Java runtime = shell script that prints its arguments
  const script = Buffer.from('#!/bin/sh\nfor a in "$@"; do echo "ARG:$a"; done\nexit 0\n');
  const javaUrl = srv.addFile('/runtime/java', script);
  const manifest = { files: { bin: { type: 'directory' }, 'bin/java': { type: 'file', executable: true, downloads: { raw: { url: javaUrl, sha1: sha1(script), size: script.length } } } } };
  const manifestUrl = srv.addJson('/runtime/manifest.json', manifest);
  srv.addJson('/runtime/all.json', {
    linux: { 'java-runtime-fake': [{ manifest: { url: manifestUrl, sha1: sha1(Buffer.from(JSON.stringify(manifest))), size: 1 }, version: { name: '1' } }] },
    'windows-x64': { 'java-runtime-fake': [] },
  });
  // Fabric
  const loaderLib = Buffer.from('fabric-loader-jar');
  srv.addFile('/fabricmaven/net/fabricmc/fabric-loader/0.99.0/fabric-loader-0.99.0.jar', loaderLib);
  for (const id of ids) {
    srv.addJson(`/fabric/v2/versions/loader/${id}`, [{ loader: { version: '0.99.0', stable: true } }]);
    srv.addJson(`/fabric/v2/versions/loader/${id}/0.99.0/profile/json`, {
      id: `fabric-loader-0.99.0-${id}`, inheritsFrom: id, type: 'release', mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
      arguments: { game: [], jvm: ['-DFabricMcEmu= net.minecraft.client.main.Main '] },
      libraries: [{ name: 'net.fabricmc:fabric-loader:0.99.0', url: `${srv.base}/fabricmaven/`, sha1: sha1(loaderLib), size: loaderLib.length }],
    });
    const api = modJar({ id: 'fabric-api', version: '0.1', name: 'Fabric API' });
    const apiUrl = srv.addFile(`/cdn/fabric-api-${id}.jar`, api);
    srv.addJson(`/modrinth/v2/project/fabric-api/version`, [{ version_type: 'release', version_number: '0.1', files: [{ primary: true, filename: `fabric-api-${id}.jar`, url: apiUrl, size: api.length, hashes: { sha512: sha512(api), sha1: sha1(api) } }] }]);
  }
  return entries;
}

module.exports = { makeZip, modJar, fakeServer, addMinecraft, setupManifestAndTools, tmp, sha1, sha512 };
