'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./helpers');
const { createLauncher } = require('../src/core/launcher');
const { satisfies } = require('../src/core/semver');
const { downloadFile } = require('../src/core/util');
const { openZip } = require('../src/core/zip');

const secure = { encrypt: (s) => Buffer.from(s), decrypt: (b) => b.toString() };

async function setup(t, { ids = ['1.21.11', '1.20.1'], owns = true, starlitJar = true } = {}) {
  const srv = await h.fakeServer({ owns });
  h.setupManifestAndTools(srv, ids);
  const root = h.tmp();
  const bundled = h.tmp('starlit-bundle-');
  if (starlitJar) {
    const jar = h.modJar({ id: 'starlit', version: '0.1.0', name: 'Starlit', depends: { minecraft: '~1.21.11', 'fabric-api': '*' } });
    fs.writeFileSync(path.join(bundled, 'starlit-0.1.0.jar'), jar);
    fs.writeFileSync(path.join(bundled, 'registry.json'), JSON.stringify({ builds: [{ file: 'starlit-0.1.0.jar', sha1: h.sha1(jar) }] }));
  }
  const events = [];
  const L = createLauncher({ root, secure, starlitDirs: [bundled], emit: (c, p) => events.push([c, p]), endpoints: srv.endpoints });
  await L.init();
  await L.settings.update({ clientId: 'client-123', maxRamMb: 1024 });
  t.after(async () => { await srv.close(); fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(bundled, { recursive: true, force: true }); });
  return { srv, L, root, events };
}

async function login(L) {
  let code;
  const acc = await L.auth.login((c) => { code = c; });
  return { acc, code };
}

const waitIdle = (events) => new Promise((resolve) => {
  const iv = setInterval(() => {
    const last = [...events].reverse().find((e) => e[0] === 'state');
    if (last && last[1].state === 'idle' && last[1].exitCode !== undefined) { clearInterval(iv); resolve(last[1]); }
  }, 20);
});

test('semver ranges used by fabric.mod.json', () => {
  assert.ok(satisfies('1.21.11', '~1.21.11'));
  assert.ok(!satisfies('1.20.1', '~1.21.11'));
  assert.ok(satisfies('1.21.11', '>=1.20 <1.22'));
  assert.ok(!satisfies('1.21.11', '>=1.20 <1.21'));
  assert.ok(satisfies('1.20.1', ['1.20.1', '1.21']));
  assert.ok(satisfies('1.21.4', '1.21.x'));
  assert.ok(!satisfies('1.21.11', '1.21'));
});

test('zip reader handles deflate and stored entries', () => {
  const f = path.join(h.tmp(), 'x.zip');
  fs.writeFileSync(f, h.makeZip({ 'one.txt': 'hello deflate '.repeat(50), 'two.txt': 'stored' }));
  const z = openZip(f);
  assert.equal(z.read('one.txt').toString(), 'hello deflate '.repeat(50));
  assert.equal(z.read('two.txt').toString(), 'stored');
});

test('version list only contains releases from 1.14 to 1.21.11', async (t) => {
  const { L } = await setup(t);
  const { versions } = await L.listVersions();
  assert.deepEqual(versions.map((v) => v.id), ['1.21.11', '1.20.1', '1.14']);
});

test('download rejects wrong hash and leaves no file behind', async (t) => {
  const { srv } = await setup(t);
  const url = srv.addFile('/x.bin', 'hello');
  const dest = path.join(h.tmp(), 'x.bin');
  await assert.rejects(downloadFile(url, dest, { sha1: '0'.repeat(40) }), /mismatch/);
  assert.ok(!fs.existsSync(dest) && !fs.existsSync(`${dest}.part`));
  assert.equal(await downloadFile(url, dest, { sha1: h.sha1(Buffer.from('hello')) }), true);
  assert.equal(await downloadFile(url, dest, { sha1: h.sha1(Buffer.from('hello')) }), false, 'second call must skip');
});

test('login with device code stores an encrypted account and reports licence', async (t) => {
  const { L, root } = await setup(t);
  const { acc, code } = await login(L);
  assert.equal(code.userCode, 'ABCD-1234');
  assert.equal(acc.name, 'Steve');
  assert.equal(acc.owns, true);
  const raw = fs.readFileSync(path.join(root, 'accounts.bin')).toString();
  assert.ok(raw.includes('MCTOKEN'), 'store contains token (test secure store is identity)');
  await L.auth.logout();
  assert.equal(await L.auth.getAccount(), null);
});

test('login fails clearly without client id and without licence', async (t) => {
  const a = await setup(t);
  await a.L.settings.update({ clientId: '' });
  await assert.rejects(login(a.L), (e) => e.code === 'NO_CLIENT_ID');
  const b = await setup(t, { owns: false });
  await assert.rejects(login(b.L), (e) => e.code === 'NO_LICENCE');
});

test('play without being signed in is refused', async (t) => {
  const { L } = await setup(t);
  await assert.rejects(L.play('1.21.11'), (e) => e.code === 'NOT_SIGNED_IN');
  assert.equal(L.state(), 'idle');
});

test('play 1.21.11 end to end: install, fabric, starlit, fake java receives correct command', async (t) => {
  const { L, root, events, srv } = await setup(t);
  await login(L);
  const res = await L.play('1.21.11');
  assert.ok(res.pid > 0);
  const end = await waitIdle(events);
  assert.equal(end.exitCode, 0);

  const lines = events.filter((e) => e[0] === 'log').map((e) => e[1]);
  const args = lines.filter((l) => l.startsWith('ARG:')).map((l) => l.slice(4));
  assert.ok(args.includes('-Xmx1024M'));
  assert.ok(args.includes('net.fabricmc.loader.impl.launch.knot.KnotClient'), 'fabric main class used');
  assert.equal(args[args.indexOf('--username') + 1], 'Steve');
  assert.equal(args[args.indexOf('--accessToken') + 1], 'MCTOKEN');
  assert.equal(args[args.indexOf('--version') + 1], 'fabric-loader-0.99.0-1.21.11');
  assert.ok(!args.includes('--width'), 'custom resolution feature is off');
  const cp = args[args.indexOf('-cp') + 1];
  assert.ok(cp.includes('liba-1.0.jar') && cp.includes('fabric-loader-0.99.0.jar') && cp.includes('1.21.11.jar'));
  assert.ok(!cp.includes('winonly'), 'windows-only library must be excluded on this OS');
  assert.ok(args.some((a) => a.startsWith('-Dlog4j.configurationFile=')));
  const nat = args.find((a) => a.startsWith('-Djava.library.path=')).split('=')[1];
  assert.ok(fs.existsSync(path.join(nat, 'libfoo.so')) && !fs.existsSync(path.join(nat, 'MANIFEST.MF')), 'natives extracted, excludes honoured');

  // files on disk
  assert.ok(fs.existsSync(path.join(root, 'versions', '1.21.11', '1.21.11.jar')));
  const mods = await L.listMods('1.21.11');
  assert.deepEqual(mods.map((m) => m.id).sort(), ['fabric-api', 'starlit']);
  // token never printed in the logged command line
  assert.ok(!lines.find((l) => l.startsWith('Command:')).includes('MCTOKEN'));

  // second start must not download anything again
  const before = srv.state.hits.filter((x) => x.startsWith('GET /client') || x.startsWith('GET /assets') || x.startsWith('GET /vlibs')).length;
  events.length = 0;
  await L.play('1.21.11');
  await waitIdle(events);
  const after = srv.state.hits.filter((x) => x.startsWith('GET /client') || x.startsWith('GET /assets') || x.startsWith('GET /vlibs')).length;
  assert.equal(after, before, 'no repeated downloads');
});

test('1.20.1 starts without Starlit because no compatible build exists', async (t) => {
  const { L, events } = await setup(t);
  await login(L);
  const r = await L.play('1.20.1');
  await waitIdle(events);
  assert.ok(r.notices.some((n) => /No Starlit build for Minecraft 1.20.1/.test(n)));
  const mods = await L.listMods('1.20.1');
  assert.ok(!mods.some((m) => m.id === 'starlit'));
});

test('mods are kept per version and incompatible ones are rejected or disabled', async (t) => {
  const { L, root } = await setup(t);
  const dir = h.tmp();
  const ok = path.join(dir, 'good.jar');
  const bad = path.join(dir, 'old.jar');
  const notFabric = path.join(dir, 'forge.jar');
  const needsDep = path.join(dir, 'dep.jar');
  fs.writeFileSync(ok, h.modJar({ id: 'good', version: '1.0', name: 'Good', depends: { minecraft: '>=1.21' } }));
  fs.writeFileSync(bad, h.modJar({ id: 'old', version: '1.0', name: 'Old', depends: { minecraft: '1.20.1' } }));
  fs.writeFileSync(notFabric, h.makeZip({ 'mods.toml': 'x' }));
  fs.writeFileSync(needsDep, h.modJar({ id: 'dep', version: '1', depends: { 'some-lib': '*', minecraft: '*' } }));

  await L.importMod('1.21.11', ok);
  await assert.rejects(L.importMod('1.21.11', bad), (e) => e.code === 'MC_VERSION');
  await assert.rejects(L.importMod('1.21.11', notFabric), (e) => e.code === 'BAD_FILE');
  await L.importMod('1.20.1', bad); // fine in its own version
  assert.ok(fs.existsSync(path.join(root, 'instances', '1.20.1', 'mods', 'old.jar')));
  assert.ok(!fs.existsSync(path.join(root, 'instances', '1.21.11', 'mods', 'old.jar')));

  const imp = await L.importMod('1.21.11', needsDep);
  assert.ok(imp.warnings.some((w) => /some-lib/.test(w)));

  // disable / enable / remove
  assert.equal(await L.setModEnabled('1.21.11', 'good.jar', false), 'good.jar.disabled');
  let list = await L.listMods('1.21.11');
  assert.equal(list.find((m) => m.id === 'good').enabled, false);
  assert.equal(await L.setModEnabled('1.21.11', 'good.jar.disabled', true), 'good.jar');
  await L.removeMod('1.21.11', 'dep.jar');
  list = await L.listMods('1.21.11');
  assert.ok(!list.some((m) => m.id === 'dep'));

  // a wrong-version jar smuggled into the folder is disabled at launch time, never loaded
  fs.copyFileSync(bad, path.join(root, 'instances', '1.21.11', 'mods', 'old.jar'));
  await login(L);
  const r = await L.play('1.21.11');
  assert.ok(r.notices.some((n) => /Disabled mods.*Old/.test(n)));
  assert.ok(fs.existsSync(path.join(root, 'instances', '1.21.11', 'mods', 'old.jar.disabled')));
  // path traversal is refused
  await assert.rejects(L.removeMod('1.21.11', '../../config.json'), (e) => e.code === 'BAD_FILE');
});

test('offline start works from cached files', async (t) => {
  const { L, srv, events } = await setup(t);
  await login(L);
  await L.play('1.21.11');
  await waitIdle(events);
  // kill the server connection: point to a dead port
  L.ctx.endpoints.versionManifest = 'http://127.0.0.1:1/x';
  L.ctx.endpoints.fabricMeta = 'http://127.0.0.1:1';
  events.length = 0;
  const r = await L.play('1.21.11');
  await waitIdle(events);
  assert.ok(r.notices.some((n) => /Offline/.test(n)));
});

// ---------------------------------------------------------------- themes
const TH = require('../src/shared/theme');

test('theme: hex validation, fallbacks and clamping', () => {
  assert.equal(TH.normalizeHex('ABC'), '#aabbcc');
  assert.equal(TH.normalizeHex('#AaBbCc'), '#aabbcc');
  for (const bad of ['', '#12345', 'zzzzzz', '#1234567', null, 42, 'rgb(1,2,3)']) assert.equal(TH.normalizeHex(bad), null);
  const t = TH.sanitize({ preset: 'crimson', colors: { primary: 'nope', text: '#fff' }, effects: { glow: 999, aurora: -5, gradient: 'x' } });
  assert.equal(t.colors.primary, TH.PRESETS.crimson.colors.primary, 'invalid colour falls back to the preset colour');
  assert.equal(t.colors.text, '#ffffff');
  assert.equal(t.effects.glow, 100); assert.equal(t.effects.aurora, 0); assert.equal(t.effects.gradient, 100);
  for (const k of TH.KEYS) assert.ok(TH.normalizeHex(t.colors[k]), k);
  assert.deepEqual(TH.sanitize(null).colors, TH.PRESETS.aurora.colors);
  assert.deepEqual(Object.keys(TH.PRESETS), ['midnight', 'aurora', 'crimson', 'emerald']);
});

test('theme: accent intensity 0 desaturates, 100 keeps colours', () => {
  const full = TH.resolve({ preset: 'aurora' });
  assert.equal(full.colors.primary, TH.PRESETS.aurora.colors.primary);
  const grey = TH.resolve({ preset: 'aurora', effects: { accentIntensity: 0 } }).colors.primary;
  const [r, g, b] = TH.hexToRgb(grey);
  assert.ok(Math.abs(r - g) <= 1 && Math.abs(g - b) <= 1);
});

test('theme service: persists, shares a resolved file with the mod, saves/loads/deletes themes, blocks bad names', async (t) => {
  const { L, root } = await setup(t);
  assert.equal(L.themes.current().preset, 'aurora', 'default theme');
  const custom = { preset: 'custom', base: 'emerald', colors: { primary: '#123456', accent: 'nope!' }, effects: { glow: 10 } };
  const saved = await L.themes.set(custom);
  assert.equal(saved.colors.primary, '#123456');
  assert.equal(saved.colors.accent, TH.PRESETS.emerald.colors.accent, 'invalid value rejected');
  const shared = JSON.parse(fs.readFileSync(path.join(root, 'shared', 'theme.json'), 'utf8'));
  assert.equal(shared.version, 1);
  assert.equal(shared.colors.primary, '#123456'); assert.equal(shared.effects.glow, 0.1);
  // survives a restart
  const L2 = createLauncher({ root, secure, endpoints: {} });
  await L2.init();
  assert.equal(L2.themes.current().colors.primary, '#123456');
  // named themes
  await L.themes.save('Night Owl', saved);
  assert.deepEqual((await L.themes.list()).map((x) => x.name), ['Night Owl']);
  assert.equal((await L.themes.load('Night Owl')).colors.primary, '#123456');
  await assert.rejects(L.themes.save('../evil', saved), (e) => e.code === 'BAD_NAME');
  await assert.rejects(L.themes.load('..\\x'), (e) => e.code === 'BAD_NAME');
  await L.themes.remove('Night Owl');
  assert.deepEqual(await L.themes.list(), []);
});

test('game is started with -Dstarlit.theme pointing at the shared theme file', async (t) => {
  const { L, events, root } = await setup(t);
  await login(L);
  await L.themes.set(TH.preset('crimson'));
  await L.play('1.21.11');
  await waitIdle(events);
  const args = events.filter((e) => e[0] === 'log').map((e) => e[1]).filter((l) => l.startsWith('ARG:')).map((l) => l.slice(4));
  const prop = args.find((a) => a.startsWith('-Dstarlit.theme='));
  assert.equal(prop, `-Dstarlit.theme=${path.join(root, 'shared', 'theme.json')}`);
  assert.equal(JSON.parse(fs.readFileSync(prop.split('=')[1], 'utf8')).colors.primary, TH.PRESETS.crimson.colors.primary);
});

test('skyHooks setting: default off, validated, passed as -Dstarlit.skyhooks only when a|b', async (t) => {
  const { L, events } = await setup(t);
  await login(L);
  const argsOf = () => events.filter((e) => e[0] === 'log').map((e) => e[1]).filter((l) => l.startsWith('ARG:')).map((l) => l.slice(4));
  assert.equal(L.settings.get().skyHooks, 'off');
  await L.play('1.21.11'); await waitIdle(events);
  assert.ok(!argsOf().some((a) => a.startsWith('-Dstarlit.skyhooks')));
  await L.settings.update({ skyHooks: 'evil' });
  assert.equal(L.settings.get().skyHooks, 'off');
  await L.settings.update({ skyHooks: 'b' });
  events.length = 0;
  await L.play('1.21.11'); await waitIdle(events);
  assert.ok(argsOf().includes('-Dstarlit.skyhooks=b'));
});

test('Xbox and XSTS requests both send x-xbl-contract-version: 1', async (t) => {
  const { srv, L } = await setup(t);
  await login(L);
  assert.deepEqual(srv.state.xboxHeaders, [['/xbl', '1'], ['/xsts', '1']]);
});

test('Xbox errors give readable messages without leaking tokens', async (t) => {
  const { srv, L } = await setup(t);
  srv.state.xsts = { status: 401, body: { XErr: 2148916233, Message: 'secret-should-not-appear' } };
  await assert.rejects(login(L), (e) => e.code === 'LOGIN_FAILED' && /no Xbox profile/.test(e.message) && !/LEAK|secret/.test(e.message));
  srv.state.xsts = { status: 401, body: { XErr: 2148916238 } };
  await assert.rejects(login(L), (e) => /child account/.test(e.message));
  srv.state.xsts = { status: 401, body: { XErr: 123456789, Message: 'LEAK' } };
  await assert.rejects(login(L), (e) => /HTTP 401, Xbox error 123456789/.test(e.message) && !/LEAK|\bXBL\b|\bMS\b/.test(e.message));
  srv.state.xsts = { status: 500, body: {} };
  await assert.rejects(login(L), (e) => /HTTP 500|HTTP/.test(e.message));
});
