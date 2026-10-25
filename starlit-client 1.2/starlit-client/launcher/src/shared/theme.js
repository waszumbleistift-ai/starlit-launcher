'use strict';
/*
 * Central theme definition shared by the launcher UI (browser), the launcher core (Node) and,
 * through the exported theme.json, the in-game mod. One structure, one set of colour names.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StarlitTheme = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const GROUPS = [
    { id: 'brand', label: 'Brand', keys: ['primary', 'secondary', 'accent'] },
    { id: 'surfaces', label: 'Surfaces', keys: ['background', 'panel', 'border'] },
    { id: 'text', label: 'Text', keys: ['text', 'muted'] },
    { id: 'controls', label: 'Controls', keys: ['button', 'buttonHover', 'on', 'off', 'selected'] },
  ];
  const LABELS = {
    primary: ['Primary', 'Main buttons, active navigation'],
    secondary: ['Secondary', 'Second colour of gradients'],
    accent: ['Accent', 'Focus rings, progress, highlights'],
    background: ['Background', 'Base of the sky and window'],
    panel: ['Panels & cards', 'Cards, sidebar, dialogs'],
    border: ['Borders', 'Outlines and divider lines'],
    text: ['Text', 'Headings and body text'],
    muted: ['Muted text', 'Hints and descriptions'],
    button: ['Button', 'Neutral button fill'],
    buttonHover: ['Button hover', 'Neutral button on hover'],
    on: ['Enabled', 'Switched on, success'],
    off: ['Disabled', 'Switched off tracks'],
    selected: ['Selected', 'Selected version / item'],
  };
  const KEYS = GROUPS.flatMap((g) => g.keys);

  const mk = (label, c, effects) => ({ label, colors: c, effects: { accentIntensity: 100, glow: 60, gradient: 100, aurora: 100, ...(effects || {}) } });
  const PRESETS = {
    midnight: mk('Midnight', {
      primary: '#3d7bff', secondary: '#6ea0ff', accent: '#38c8ff', background: '#050914', panel: '#0d1830', border: '#a8c0ff',
      text: '#eaf0ff', muted: '#8c9cc0', button: '#ffffff', buttonHover: '#ffffff', on: '#5be3b0', off: '#ffffff', selected: '#3d7bff',
    }, { glow: 45 }),
    aurora: mk('Aurora', {
      primary: '#b44cff', secondary: '#ff6fd8', accent: '#4fe0e8', background: '#0b0614', panel: '#180e2c', border: '#ffffff',
      text: '#f4effc', muted: '#a395c4', button: '#ffffff', buttonHover: '#ffffff', on: '#5be3b0', off: '#ffffff', selected: '#b44cff',
    }),
    crimson: mk('Crimson', {
      primary: '#ff3d57', secondary: '#ff8a5c', accent: '#ffb347', background: '#12060a', panel: '#240e14', border: '#ffc2cb',
      text: '#fdeff1', muted: '#c49aa2', button: '#ffd9de', buttonHover: '#ffd9de', on: '#7be39b', off: '#ffffff', selected: '#ff3d57',
    }),
    emerald: mk('Emerald', {
      primary: '#22d39a', secondary: '#7ae85f', accent: '#3de0d6', background: '#04120d', panel: '#0b2219', border: '#b8ffe0',
      text: '#ebfdf5', muted: '#8fc4af', button: '#d6ffee', buttonHover: '#d6ffee', on: '#a6ff6b', off: '#ffffff', selected: '#22d39a',
    }),
  };
  const PRESET_IDS = [...Object.keys(PRESETS), 'custom'];
  const EFFECT_KEYS = ['accentIntensity', 'glow', 'gradient', 'aurora'];
  const EFFECT_LABELS = {
    accentIntensity: ['Accent intensity', 'From grey to full colour'],
    glow: ['Glow', 'Soft light around active elements'],
    gradient: ['Gradient', 'How strongly the secondary colour blends in'],
    aurora: ['Sky effect', 'Brightness of the animated aurora background'],
  };

  /** "#abc", "abc", "#AABBCC" -> "#aabbcc"; anything else -> null */
  function normalizeHex(v) {
    if (typeof v !== 'string') return null;
    let s = v.trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(s)) s = s.split('').map((c) => c + c).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
    return `#${s.toLowerCase()}`;
  }
  const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const rgbToHex = (rgb) => `#${rgb.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')}`;
  const luminance = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];

  const clampNum = (v, lo, hi, def) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };

  /** Always returns a complete, valid theme. Invalid values fall back to the base preset. */
  function sanitize(input) {
    const t = input && typeof input === 'object' ? input : {};
    const preset = PRESET_IDS.includes(t.preset) ? t.preset : (t.colors ? 'custom' : 'aurora');
    const base = PRESETS[preset] || PRESETS[t.base && PRESETS[t.base] ? t.base : 'aurora'];
    const colors = {};
    for (const k of KEYS) colors[k] = normalizeHex(t.colors && t.colors[k]) || base.colors[k];
    const effects = {};
    for (const k of EFFECT_KEYS) effects[k] = Math.round(clampNum(t.effects && t.effects[k], 0, 100, base.effects[k]));
    const base2 = PRESETS[t.base] ? t.base : (PRESETS[preset] ? preset : 'aurora');
    return { name: typeof t.name === 'string' && t.name.trim() ? t.name.trim().slice(0, 40) : (PRESETS[preset] ? PRESETS[preset].label : 'Custom'), preset, base: base2, colors, effects };
  }

  function preset(id) {
    const p = PRESETS[id] || PRESETS.aurora;
    return sanitize({ name: p.label, preset: PRESETS[id] ? id : 'aurora', colors: p.colors, effects: p.effects });
  }

  /** Turns the stored theme into the colours actually shown (applies the accent intensity). */
  function resolve(theme) {
    const t = sanitize(theme);
    const k = t.effects.accentIntensity / 100;
    const colors = { ...t.colors };
    for (const key of ['primary', 'secondary', 'accent', 'selected']) {
      const rgb = hexToRgb(colors[key]);
      const l = luminance(rgb);
      colors[key] = rgbToHex(rgb.map((c) => l + (c - l) * k));
    }
    const onPrimary = luminance(hexToRgb(colors.primary)) > 165 ? '#12081f' : '#ffffff';
    return {
      name: t.name, preset: t.preset, colors, onPrimary,
      effects: { glow: t.effects.glow / 100, gradient: t.effects.gradient / 100, aurora: t.effects.aurora / 100 },
    };
  }

  /** Name -> CSS custom properties. Used by the launcher window. */
  function cssVars(resolved) {
    const c = resolved.colors;
    return {
      '--primary': c.primary, '--secondary': c.secondary, '--accent': c.accent, '--bg': c.background, '--panel': c.panel,
      '--line-c': c.border, '--text': c.text, '--muted': c.muted, '--button': c.button, '--button-hover': c.buttonHover,
      '--on': c.on, '--off': c.off, '--selected': c.selected, '--on-primary': resolved.onPrimary,
      '--glow': String(resolved.effects.glow), '--gradient': String(resolved.effects.gradient),
    };
  }

  return { GROUPS, LABELS, KEYS, PRESETS, PRESET_IDS, EFFECT_KEYS, EFFECT_LABELS, normalizeHex, hexToRgb, rgbToHex, sanitize, preset, resolve, cssVars };
});
