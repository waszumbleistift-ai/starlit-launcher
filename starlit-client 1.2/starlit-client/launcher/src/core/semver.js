'use strict';
/**
 * Small matcher for the version ranges used in fabric.mod.json "depends"
 * (e.g. "1.21.11", "~1.21.11", ">=1.20 <1.22", "1.21.x", "*", ["1.20", "1.21"]).
 */
function parse(v) {
  const core = String(v).trim().replace(/^[v=]+/, '').split(/[-+]/)[0];
  return core.split('.').map((x) => (x === 'x' || x === 'X' || x === '*' ? NaN : parseInt(x, 10) || 0));
}
function cmp(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
function comparator(version, token) {
  const v = parse(version);
  token = token.trim();
  if (!token || token === '*' || token === 'x') return true;
  let m;
  if ((m = token.match(/^(>=|<=|>|<|=)\s*(.+)$/))) {
    const c = cmp(v, parse(m[2]));
    return { '>=': c >= 0, '<=': c <= 0, '>': c > 0, '<': c < 0, '=': c === 0 }[m[1]];
  }
  if ((m = token.match(/^~\s*(.+)$/))) {
    const base = parse(m[1]);
    const upper = base.length >= 2 ? [base[0], base[1] + 1, 0] : [base[0] + 1, 0, 0];
    return cmp(v, base) >= 0 && cmp(v, upper) < 0;
  }
  if ((m = token.match(/^\^\s*(.+)$/))) {
    const base = parse(m[1]);
    return cmp(v, base) >= 0 && cmp(v, [base[0] + 1, 0, 0]) < 0;
  }
  const parts = parse(token);
  if (parts.some(Number.isNaN)) {
    const idx = parts.findIndex(Number.isNaN);
    const lower = parts.slice(0, idx);
    const upper = lower.slice();
    if (upper.length) upper[upper.length - 1] += 1; else return true;
    return cmp(v, lower) >= 0 && cmp(v, upper) < 0;
  }
  return cmp(v, parts) === 0;
}
function satisfies(version, range) {
  if (range == null) return true;
  if (Array.isArray(range)) return range.length === 0 || range.some((r) => satisfies(version, r));
  return String(range).split('||').some((alt) => alt.trim().split(/\s+(?![<>=~^]*\d)|\s+(?=[<>=~^])/).filter(Boolean)
    .every((tok) => comparator(version, tok)));
}
module.exports = { satisfies, parse, cmp };
