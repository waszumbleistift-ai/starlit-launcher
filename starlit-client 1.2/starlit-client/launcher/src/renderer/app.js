'use strict';
(function () {
  const api = window.api;
  const S = {
    page: 'play', versions: [], offline: false, filter: '', settings: {}, account: null, mods: [], modsFor: null,
    theme: null, presets: {}, saved: [], state: 'idle', progress: null, logs: [], notices: [], login: null, starlit: null, dataDir: '', busy: false,
  };

  // ---------- helpers ----------
  const ICONS = {
    play: '<path d="M8 5v14l11-7z"/>', mods: '<path d="M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8"/>',
    account: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
    appearance: '<path d="M12 3a9 9 0 100 18c1.5 0 2-1 1.5-2s-.5-2 1-2H17a4 4 0 004-4c0-5-4-10-9-10z"/><circle cx="7.5" cy="11" r=".8"/><circle cx="10" cy="7" r=".8"/><circle cx="15" cy="7.5" r=".8"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  };
  function icon(name) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
    svg.innerHTML = ICONS[name]; // static, trusted markup
    return svg;
  }
  /** Safe DOM builder: strings become text nodes, never HTML. */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'checked' || k === 'disabled' || k === 'value') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }
  async function call(name, ...args) {
    const r = await api.invoke(name, ...args);
    if (!r.ok) throw Object.assign(new Error(r.error.message), { code: r.error.code });
    return r.data;
  }
  function toast(msg, kind = '') {
    const t = h('div', { class: `toast ${kind}` }, msg);
    document.getElementById('toasts').append(t);
    setTimeout(() => t.remove(), kind === 'error' ? 9000 : 4500);
  }
  const fail = (e) => toast(e.message || String(e), 'error');
  const selected = () => S.settings.selectedVersion;

  // ---------- chrome ----------
  const PAGES = [['play', 'Play'], ['mods', 'Mods'], ['account', 'Account'], ['appearance', 'Appearance'], ['settings', 'Settings']];
  const SUB = {
    play: 'Pick a version, press play', mods: `Fabric mods for Minecraft ${''}`, account: 'Your Microsoft sign-in', appearance: 'Colours, themes and effects \u2013 shared with the in-game mod', settings: 'Memory, Java and launcher options',
  };

  function renderRail() {
    const rail = document.getElementById('rail');
    rail.replaceChildren(
      h('div', { class: 'brand' }, h('i', {}, '✦'), h('span', {}, 'Starlit')),
      ...PAGES.map(([id, label]) => h('button', { class: 'nav', 'aria-current': S.page === id ? 'page' : null, onclick: () => go(id) }, icon(id), h('span', {}, label))),
      h('div', { class: 'spacer' }),
      h('div', { class: 'railfoot' }, 'Launcher 0.1.0'),
    );
  }
  function renderTop() {
    const titles = { play: 'Play', mods: 'Mods', account: 'Account', appearance: 'Appearance', settings: 'Settings' };
    const sub = S.page === 'mods' ? `Fabric mods for Minecraft ${selected()}` : SUB[S.page];
    document.getElementById('pagetitle').replaceChildren(titles[S.page], h('small', {}, sub));
    const a = S.account;
    document.getElementById('chip').replaceChildren(
      h('div', { class: 'chip', role: 'button', tabindex: 0, onclick: () => go('account'), onkeydown: (e) => { if (e.key === 'Enter') go('account'); } },
        h('div', { class: 'avatar' }, a ? a.name[0].toUpperCase() : '?'),
        h('div', {}, a ? a.name : 'Sign in', h('small', {}, a ? 'Minecraft: Java Edition' : 'Microsoft account'))));
  }
  function go(page) {
    S.page = page; renderRail(); renderTop(); renderView();
    if (page === 'mods') loadMods();
  }

  // ---------- play ----------
  function playPage() {
    const v = selected();
    const list = S.versions.filter((x) => x.id.includes(S.filter.trim()));
    const running = S.state === 'running', preparing = S.state === 'preparing';
    const info = S.versions.find((x) => x.id === v);
    const picker = h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('div', {}, h('h3', {}, 'Minecraft version'),
        h('div', { class: 'muted' }, S.versions.length ? `${S.versions.length} releases, 1.14 – 1.21.11` : 'Loading versions…')),
      S.offline ? h('span', { class: 'badge warn' }, 'offline list') : null),
      h('div', {}, h('input', { type: 'search', placeholder: 'Filter, e.g. 1.20', value: S.filter, 'aria-label': 'Filter versions',
        oninput: (e) => { S.filter = e.target.value; const l = document.getElementById('vlist'); if (l) l.replaceWith(versionList()); } })),
      versionList());
    function versionList() {
      const l = S.versions.filter((x) => x.id.includes(S.filter.trim()));
      return h('div', { class: 'vlist', id: 'vlist', role: 'group', 'aria-label': 'Versions' }, l.map((x) =>
        h('button', { class: 'vbtn', 'aria-pressed': x.id === selected() ? 'true' : 'false', title: x.installed ? 'Installed' : 'Will be downloaded',
          onclick: () => pickVersion(x.id) }, x.id, x.installed ? h('span', { class: 'dot' }) : null)));
    }
    void list;

    const sl = S.starlit;
    const starlitLine = sl == null ? '' : sl.available
      ? h('span', { class: 'badge ok' }, `Starlit ${sl.version} included`)
      : h('span', { class: 'badge warn' }, 'No Starlit build for this version');
    const box = h('div', { class: 'card playbox' },
      h('div', { class: 'muted' }, 'Selected'),
      h('div', { class: 'hero-v' }, h('h3', { class: 'hero-title' }, `Minecraft ${v}`)),
      h('div', { class: 'row' }, info && info.installed ? h('span', { class: 'badge ok' }, 'Installed') : h('span', { class: 'badge' }, 'Download on first start'),
        S.settings.useFabric ? h('span', { class: 'badge' }, 'Fabric') : h('span', { class: 'badge' }, 'Vanilla'), starlitLine),
      h('div', { class: 'gap' }),
      h('button', { class: `bigplay ${running ? 'stop' : ''}`, id: 'playbtn', disabled: preparing, onclick: running ? () => call('stop').catch(fail) : play },
        running ? 'STOP' : preparing ? 'STARTING…' : 'PLAY'),
      progressBox());
    const hero = h('div', { class: 'hero' }, h('h1', {}, 'Lilac lights, pouring through the sky.'), h('p', {}, 'One launcher for Minecraft 1.14 to 1.21.11, Fabric and Starlit.'));
    const consoleBox = h('div', { class: 'card' }, h('div', { class: 'row between' }, h('h3', {}, 'Console'),
      h('button', { class: 'btn', onclick: () => call('logs:folder').catch(fail) }, 'Open logs folder')),
      h('div', { class: 'console', id: 'console', role: 'log' }, S.logs.slice(-300).join('\n') || 'Output of the game appears here.'));
    return h('div', {}, hero, h('div', { class: 'playgrid' }, picker, box), consoleBox);
  }
  function progressBox() {
    const p = S.progress;
    const wrap = h('div', { id: 'progress' });
    if (S.state === 'preparing' && p) {
      const pct = p.total ? Math.min(100, Math.round((p.done / p.total) * 100)) : 100;
      const bar = h('i', {}); bar.style.width = `${pct}%`;
      wrap.append(h('div', { class: 'muted' }, `Step ${p.step}/${p.steps}: ${p.stepName}`),
        h('div', { class: 'bar' }, bar),
        h('div', { class: 'muted' }, `${p.phase}${p.label ? ' – ' + p.label : ''}${p.total ? ` (${p.done}/${p.total})` : ''}`),
        h('div', { class: 'steps' }, Array.from({ length: p.steps }, (_, i) => h('i', { class: i + 1 < p.step ? 'done' : i + 1 === p.step ? 'on' : '' }))));
    } else if (S.state === 'running') wrap.append(h('div', { class: 'muted' }, 'Minecraft is running.'));
    for (const n of S.notices) wrap.append(h('div', { class: 'notice' }, n));
    return wrap;
  }
  function updateProgress() {
    const old = document.getElementById('progress');
    if (old) old.replaceWith(progressBox());
  }
  async function pickVersion(id) {
    S.settings = await call('settings:set', { selectedVersion: id }).catch((e) => { fail(e); return S.settings; });
    S.starlit = null; renderTop(); renderView(); refreshStarlit();
  }
  async function refreshStarlit() {
    try { S.starlit = await call('starlit:status', selected()); } catch { S.starlit = null; }
    if (S.page === 'play') renderView();
  }
  async function play() {
    S.logs = []; S.notices = []; S.progress = null;
    try { await call('play', selected()); } catch (e) {
      fail(e);
      if (e.code === 'NOT_SIGNED_IN' || e.code === 'NO_LICENCE' || e.code === 'LOGIN_EXPIRED') go('account');
    }
  }

  // ---------- mods ----------
  async function loadMods() {
    try { S.mods = await call('mods:list', selected()); S.modsFor = selected(); } catch (e) { fail(e); }
    if (S.page === 'mods') renderView();
  }
  function modsPage() {
    const mc = selected();
    const head = h('div', { class: 'row between' },
      h('div', { class: 'muted' }, `Stored separately for Minecraft ${mc}. Mods for other versions are never loaded.`),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => call('mods:folder', mc).catch(fail) }, 'Open folder'),
        h('button', { class: 'btn primary', onclick: importMods }, 'Add mods…')));
    const rows = S.mods.length ? S.mods.map(modRow) : [h('div', { class: 'card empty' }, 'No mods yet. Add Fabric .jar files, or press Play once to install Fabric API and Starlit.')];
    return h('div', {}, head, h('div', { class: 'gap' }), ...rows);
  }
  function modRow(m) {
    const bad = m.issues.some((i) => i.level === 'error');
    const row = h('div', { class: `mod ${m.enabled ? '' : 'off'}` },
      h('div', { class: 'grow' },
        h('div', {}, h('span', { class: 'name' }, m.name), ' ', m.version ? h('span', { class: 'badge' }, m.version) : null, ' ',
          m.minecraft != null ? h('span', { class: `badge ${bad ? 'bad' : ''}` }, `MC ${[].concat(m.minecraft).join(' | ')}`) : null, ' ',
          m.managed ? h('span', { class: 'badge ok' }, 'Included') : null),
        m.description ? h('div', { class: 'muted' }, m.description) : null,
        ...m.issues.map((i) => h('div', { class: `issue ${i.level}` }, i.text))),
      h('button', { class: 'toggle', role: 'switch', 'aria-checked': m.enabled ? 'true' : 'false', 'aria-label': `Enable ${m.name}`,
        onclick: () => toggleMod(m) }),
      m.managed ? null : h('button', { class: 'btn danger', onclick: () => removeMod(m) }, 'Remove'));
    return row;
  }
  async function importMods() {
    try {
      const r = await call('mods:import', selected());
      for (const m of r.imported) { toast(`Added ${m.name}`, 'ok'); for (const w of m.warnings) toast(w); }
      for (const e of r.errors) toast(e, 'error');
    } catch (e) { fail(e); }
    loadMods();
  }
  async function toggleMod(m) { try { await call('mods:toggle', selected(), m.file, !m.enabled); } catch (e) { fail(e); } loadMods(); }
  async function removeMod(m) {
    if (!confirm(`Remove ${m.name}? The file will be deleted.`)) return;
    try { await call('mods:remove', selected(), m.file); } catch (e) { fail(e); }
    loadMods();
  }

  // ---------- account ----------
  function accountPage() {
    const a = S.account;
    if (a) {
      return h('div', {}, h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'avatar' }, a.name[0].toUpperCase()),
        h('div', { class: 'grow' }, h('h3', {}, a.name), h('div', { class: 'muted' }, a.uuid)),
        h('span', { class: 'badge ok' }, 'Java Edition licence verified'),
        h('button', { class: 'btn danger', onclick: async () => { await call('auth:logout').catch(fail); S.account = null; renderTop(); renderView(); } }, 'Sign out'))),
      h('div', { class: 'card muted' }, 'Tokens are stored encrypted with your operating system (Windows DPAPI). Your password never reaches this app.'));
    }
    const lg = S.login;
    const needId = !S.settings.clientId;
    return h('div', {},
      h('div', { class: 'card' }, h('h3', {}, 'Sign in with Microsoft'),
        h('p', { class: 'muted' }, 'A browser tab opens on microsoft.com. Enter the code shown here and approve. No password is typed into this launcher.'),
        lg ? h('div', {}, h('div', { class: 'code' }, lg.userCode), h('p', { class: 'muted' }, `Enter it at ${lg.url} – waiting for you to finish…`),
          h('button', { class: 'btn', onclick: () => call('auth:cancel') }, 'Cancel'))
          : h('button', { class: 'btn primary', disabled: needId || S.busy, onclick: login }, S.busy ? 'Starting…' : 'Sign in'),
        needId ? h('div', { class: 'notice' }, 'First enter your Azure application (client) ID under Settings → Account setup.') : null),
      h('div', { class: 'card' }, h('h3', {}, 'Why a client ID?'),
        h('p', { class: 'muted' }, 'Microsoft only allows the Minecraft login for apps registered by their developer and approved by Mojang. Register one for this launcher once (see README, section "Microsoft login").')));
  }
  async function login() {
    S.busy = true; renderView();
    try { S.account = await call('auth:login'); toast(`Signed in as ${S.account.name}`, 'ok'); }
    catch (e) { if (e.code !== 'CANCELLED') fail(e); }
    S.busy = false; S.login = null; renderTop(); renderView();
  }


  // ---------- appearance ----------
  const TH = window.StarlitTheme;
  function applyTheme(t) {
    const r = TH.resolve(t);
    for (const [k, v] of Object.entries(TH.cssVars(r))) document.documentElement.style.setProperty(k, v);
    if (window.StarlitSky) {
      window.StarlitSky.set({ primary: r.colors.primary, secondary: r.colors.secondary, accent: r.colors.accent, background: r.colors.background, intensity: r.effects.aurora });
    }
  }
  let themeTimer;
  function commitTheme(t, { rerender = false } = {}) {
    S.theme = TH.sanitize(t);
    applyTheme(S.theme);
    clearTimeout(themeTimer);
    themeTimer = setTimeout(() => call('theme:set', S.theme).catch(fail), 250);
    if (rerender) renderView();
  }
  const swatch = (c) => `linear-gradient(135deg, ${c.primary}, ${c.secondary} 55%, ${c.accent})`;
  function appearancePage() {
    const t = S.theme || TH.preset('aurora');
    const base = TH.PRESETS[t.base] || TH.PRESETS.aurora;

    const presets = h('div', { class: 'card' }, h('h3', {}, 'Presets'),
      h('div', { class: 'muted' }, 'Start from a preset, then adjust any colour. Editing a colour switches to Custom.'),
      h('div', { class: 'presets' },
        ...Object.entries(TH.PRESETS).map(([id, p]) => {
          const b = h('button', { class: 'preset', 'aria-pressed': t.preset === id ? 'true' : 'false', onclick: () => commitTheme(TH.preset(id), { rerender: true }) }, h('i', {}), p.label);
          b.firstChild.style.background = swatch(p.colors);
          return b;
        }),
        (() => {
          const b = h('button', { class: 'preset', 'aria-pressed': t.preset === 'custom' ? 'true' : 'false', onclick: () => commitTheme({ ...t, preset: 'custom', name: 'Custom' }, { rerender: true }) }, h('i', {}), 'Custom');
          b.firstChild.style.background = swatch(t.colors);
          return b;
        })()));

    const hexInputs = {}, pickers = {};
    function setColor(key, hex) { commitTheme({ ...S.theme, preset: 'custom', name: S.theme.preset === 'custom' ? S.theme.name : 'Custom', colors: { ...S.theme.colors, [key]: hex } }); }
    function row(key) {
      const [label, hint] = TH.LABELS[key];
      const picker = h('input', { type: 'color', class: 'picker', value: S.theme.colors[key], 'aria-label': `${label} colour picker` });
      const hex = h('input', { type: 'text', class: 'hex', value: S.theme.colors[key].toUpperCase(), maxlength: 7, spellcheck: 'false', 'aria-label': `${label} hex value` });
      picker.addEventListener('input', () => { hex.value = picker.value.toUpperCase(); hex.classList.remove('invalid'); setColor(key, picker.value); updateChips(); });
      hex.addEventListener('input', () => {
        const v = TH.normalizeHex(hex.value);
        if (!v) { hex.classList.add('invalid'); return; }
        hex.classList.remove('invalid'); picker.value = v; setColor(key, v); updateChips();
      });
      hex.addEventListener('blur', () => { hex.value = S.theme.colors[key].toUpperCase(); hex.classList.remove('invalid'); });
      const reset = h('button', { class: 'btn small', title: `Reset to ${base.label}`, 'aria-label': `Reset ${label}`, onclick: () => { const v = base.colors[key]; picker.value = v; hex.value = v.toUpperCase(); hex.classList.remove('invalid'); setColor(key, v); updateChips(); } }, '↺');
      hexInputs[key] = hex; pickers[key] = picker;
      return h('div', { class: 'field colour' }, h('label', {}, label, h('small', {}, hint)), h('div', { class: 'row' }, picker, hex, reset));
    }
    function updateChips() {
      document.querySelectorAll('.preset').forEach((b) => b.setAttribute('aria-pressed', b.lastChild.textContent === 'Custom' ? 'true' : 'false'));
      const cust = [...document.querySelectorAll('.preset')].find((b) => b.lastChild.textContent === 'Custom');
      if (cust) cust.firstChild.style.background = swatch(S.theme.colors);
    }
    const colours = h('div', { class: 'card' }, h('h3', {}, 'Colours'),
      ...TH.GROUPS.map((g) => h('div', { class: 'group' }, h('div', { class: 'grouptitle' }, g.label), ...g.keys.map(row))));

    const effects = h('div', { class: 'card' }, h('h3', {}, 'Effects'),
      ...TH.EFFECT_KEYS.map((k) => {
        const [label, hint] = TH.EFFECT_LABELS[k];
        const out = h('span', { class: 'badge' }, `${S.theme.effects[k]}%`);
        const r = h('input', { type: 'range', min: 0, max: 100, step: 1, 'aria-label': label,
          oninput: (e) => { out.textContent = `${e.target.value}%`; commitTheme({ ...S.theme, preset: 'custom', name: S.theme.preset === 'custom' ? S.theme.name : 'Custom', effects: { ...S.theme.effects, [k]: Number(e.target.value) } }); updateChips(); } });
        r.value = S.theme.effects[k];
        return h('div', { class: 'field' }, h('label', {}, label, h('small', {}, hint)), h('div', { class: 'row' }, r, out));
      }));

    const preview = h('div', { class: 'card' }, h('h3', {}, 'Live preview'),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn primary' }, 'Primary button'), h('button', { class: 'btn' }, 'Neutral button'),
        h('button', { class: 'toggle', role: 'switch', 'aria-checked': 'true', 'aria-label': 'sample on' }), h('button', { class: 'toggle', role: 'switch', 'aria-checked': 'false', 'aria-label': 'sample off' }),
        h('span', { class: 'badge ok' }, 'Enabled'), h('span', { class: 'badge' }, 'Muted')),
      (() => { const bar = h('i', {}); bar.style.width = '62%'; return h('div', { class: 'bar' }, bar); })());

    const nameIn = h('input', { type: 'text', placeholder: 'Theme name', maxlength: 40, 'aria-label': 'Theme name', value: S.theme.preset === 'custom' && !['Custom'].includes(S.theme.name) ? S.theme.name : '' });
    const saveBtn = h('button', { class: 'btn primary', onclick: async () => {
      try { const r = await call('theme:save', nameIn.value, S.theme); S.saved = r.saved; S.theme = r.theme; applyTheme(S.theme); toast(`Saved theme "${r.theme.name}"`, 'ok'); renderView(); } catch (e) { fail(e); } } }, 'Save');
    const saved = h('div', { class: 'card' }, h('h3', {}, 'My themes'),
      h('div', { class: 'row' }, nameIn, saveBtn),
      S.saved.length ? h('div', { class: 'savedlist' }, ...S.saved.map((x) => {
        const sw = h('i', { class: 'sw' }); sw.style.background = swatch(x.colors);
        return h('div', { class: 'saved' }, sw, h('span', { class: 'grow' }, x.name),
          h('button', { class: 'btn small', onclick: async () => { try { commitTheme(await call('theme:load', x.name), { rerender: true }); } catch (e) { fail(e); } } }, 'Load'),
          h('button', { class: 'btn small danger', onclick: async () => { if (!confirm(`Delete theme "${x.name}"?`)) return; try { S.saved = await call('theme:delete', x.name); renderView(); } catch (e) { fail(e); } } }, 'Delete'));
      })) : h('div', { class: 'muted' }, 'No saved themes yet. Name the current look and press Save.'),
      h('div', { class: 'gap' }),
      h('button', { class: 'btn', onclick: () => commitTheme(TH.preset(t.base || 'aurora'), { rerender: true }) }, `Reset to ${base.label} defaults`),
      h('div', { class: 'muted note' }, 'The in-game Starlit menu uses the same colours. Changes appear in a running game within a second.'));

    return h('div', {}, presets, h('div', { class: 'playgrid wide' }, h('div', {}, colours), h('div', {}, preview, h('div', { class: 'gap' }), effects, h('div', { class: 'gap' }), saved)));
  }

  // ---------- settings ----------
  function settingsPage() {
    const st = S.settings;
    const save = async (patch) => { try { S.settings = await call('settings:set', patch); } catch (e) { fail(e); } };
    const toggle = (key) => h('button', { class: 'toggle', role: 'switch', 'aria-checked': st[key] ? 'true' : 'false', onclick: async (e) => { await save({ [key]: !st[key] }); e.currentTarget.setAttribute('aria-checked', st[key] ? 'true' : 'false'); } });
    const ramOut = h('span', { class: 'badge' }, `${(st.maxRamMb / 1024).toFixed(1)} GB`);
    const ram = h('input', { type: 'range', min: 1024, max: 16384, step: 512, value: st.maxRamMb, 'aria-label': 'Memory',
      oninput: (e) => { ramOut.textContent = `${(e.target.value / 1024).toFixed(1)} GB`; }, onchange: (e) => save({ maxRamMb: Number(e.target.value) }) });
    ram.value = st.maxRamMb;
    const text = (key, ph) => h('input', { type: 'text', placeholder: ph, value: st[key] || '', spellcheck: 'false', onchange: (e) => save({ [key]: e.target.value }) });
    const f = (label, hint, ctl) => h('div', { class: 'field' }, h('label', {}, label, h('small', {}, hint)), ctl);
    return h('div', {},
      h('div', { class: 'card' }, h('h3', {}, 'Game'),
        f('Memory', 'Maximum RAM for Minecraft', h('div', { class: 'row' }, ram, ramOut)),
        f('Extra JVM arguments', 'Advanced, space separated', text('jvmArgs', '-XX:+UseG1GC')),
        f('Java path', 'Leave empty to use Mojang\'s runtime (recommended)', text('javaPath', 'auto')),
        f('Use Fabric', 'Needed for mods, including Starlit', toggle('useFabric')),
        f('Load Starlit', 'Adds the Starlit mod when a build exists for the version', toggle('useStarlit')),
        f('Sky renderer hook (experimental)', 'Lets the Sky module tint the sky. Off = safe; try A or B only if Sky has no effect. Untested for 1.21.11.',
          (() => { const sel = h('select', { 'aria-label': 'Sky hook', onchange: (e) => save({ skyHooks: e.target.value }) },
            ...[['off', 'Off'], ['a', 'Variant A'], ['b', 'Variant B']].map(([v, l]) => h('option', { value: v }, l)));
            sel.value = st.skyHooks || 'off'; return sel; })()),
        f('Keep launcher open', 'Otherwise it minimises when the game starts', toggle('keepLauncherOpen'))),
      h('div', { class: 'card' }, h('h3', {}, 'Account setup'),
        f('Azure client ID', 'Application (client) ID of your registered app', text('clientId', '00000000-0000-0000-0000-000000000000'))),
      h('div', { class: 'card muted' }, `Data folder: ${S.dataDir}`));
  }

  function renderView() {
    const view = document.getElementById('view');
    const page = { play: playPage, mods: modsPage, account: accountPage, appearance: appearancePage, settings: settingsPage }[S.page]();
    view.replaceChildren(page);
    const c = document.getElementById('console'); if (c) c.scrollTop = c.scrollHeight;
  }

  // ---------- events ----------
  api.onEvent((channel, p) => {
    if (channel === 'progress') { S.progress = p; updateProgress(); }
    else if (channel === 'log') {
      S.logs.push(p); if (S.logs.length > 2000) S.logs.splice(0, 500);
      const c = document.getElementById('console');
      if (c) { c.append(document.createTextNode((c.textContent === 'Output of the game appears here.' ? '' : '\n') + p)); if (c.textContent.startsWith('Output of the game appears here.')) c.textContent = p; c.scrollTop = c.scrollHeight; }
    } else if (channel === 'notice') { S.notices.push(p); updateProgress(); }
    else if (channel === 'state') {
      S.state = p.state; if (p.state !== 'preparing') S.progress = null;
      if (S.page === 'play') renderView();
      if (p.state === 'idle' && p.exitCode === 0) toast('Minecraft closed.');
    } else if (channel === 'error') toast(p.message, 'error');
    else if (channel === 'login-code') { S.login = p; if (S.page === 'account') renderView(); }
  });

  async function boot() {
    applyTheme(TH.preset('aurora'));
    renderRail(); renderTop(); renderView();
    try {
      const st = await call('app:state');
      S.settings = st.settings; S.account = st.account; S.state = st.state; S.dataDir = st.dataDir;
      renderTop(); renderView();
      try {
        const th = await call('theme:get');
        S.theme = th.theme; S.saved = th.saved; S.presets = th.presets; applyTheme(S.theme);
      } catch (e) { fail(e); }
      const v = await call('versions:list');
      S.versions = v.versions; S.offline = v.offline;
      if (!S.versions.some((x) => x.id === S.settings.selectedVersion) && S.versions[0]) S.settings = await call('settings:set', { selectedVersion: S.versions[0].id });
      renderTop(); renderView(); refreshStarlit();
    } catch (e) { fail(e); }
  }
  boot();
})();
