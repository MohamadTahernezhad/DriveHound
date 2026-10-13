// Snapshot comparison shared by the renderer (What changed → Compare) and the background monitor.
// Finds the deepest folders that explain each change, so parents are not double counted.
(function (root) {
  'use strict';
  const lowerP = (p) => String(p).toLowerCase().replace(/[\\/]+$/, '');

  // cur, prev: arrays of [path, size]; min: smallest change worth reporting (bytes)
  function compare(cur, prev, min) {
    min = min || 100 * 1048576;
    const curM = new Map(cur.map(([p, s]) => [lowerP(p), { p, s }]));
    const oldM = new Map(prev.map(([p, s]) => [lowerP(p), { p, s }]));
    const deltas = [];
    for (const [k, v] of curM) {
      const o = oldM.get(k);
      const d = v.s - (o ? o.s : 0);
      if ((o || v.s >= 50 * 1048576) && Math.abs(d) >= min) deltas.push({ k, p: v.p, d, now: v.s, isNew: !o });
    }
    for (const [k, v] of oldM) if (!curM.has(k) && v.s >= min) deltas.push({ k, p: v.p, d: -v.s, now: 0, gone: true });
    deltas.sort((a, b) => b.k.length - a.k.length);           // deepest first
    const chosen = [];
    for (const dlt of deltas) {
      // direct chosen descendants (not nested under another chosen descendant)
      const desc = chosen.filter((c) => c.k.startsWith(dlt.k + '\\'));
      const top = desc.filter((c) => !desc.some((o) => o !== c && c.k.startsWith(o.k + '\\')));
      const explained = top.reduce((a, b) => a + b.d, 0);
      const own = dlt.d - explained;
      if (Math.abs(own) >= min) chosen.push({ ...dlt, own });
    }
    return chosen.sort((a, b) => b.own - a.own);
  }

  const api = { compare };
  root.Compare = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
