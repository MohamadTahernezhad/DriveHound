// Duplicate file finder (worker thread).
// Stage 1: group by size → Stage 2: partial hash (head+tail 64 KB) → Stage 3: full SHA-256.
// Hard links of the same physical file are not duplicates (deleting one frees nothing) and are merged.
'use strict';

const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const opts = Object.assign({ roots: [], minSize: 1024 * 1024, exclude: [], maxFiles: 3000000 }, workerData || {});
let cancelled = false;
parentPort.on('message', (m) => { if (m === 'cancel') cancelled = true; });

const DEFAULT_SKIP = new Set(['$recycle.bin', 'system volume information', 'winsxs', '$windows.~bt', '$windows.~ws', 'windows.old', 'node_modules', '.git']);
const exclude = (opts.exclude || []).map((s) => String(s).toLowerCase()).filter(Boolean);
const winDir = (process.env.WINDIR || 'C:\\Windows').toLowerCase();

const bySize = new Map();
const stats = { scanned: 0, candidates: 0, hashed: 0, phase: 'walk', current: '' };
let lastPost = 0;
function progress(force) {
  const now = Date.now();
  if (!force && now - lastPost < 250) return;
  lastPost = now;
  parentPort.postMessage({ type: 'progress', stats: { ...stats } });
}

async function walk(dir) {
  const stack = [dir];
  while (stack.length && !cancelled) {
    const d = stack.pop();
    if (d.toLowerCase() === winDir || d.toLowerCase().startsWith(winDir + '\\')) continue;
    let ents;
    try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch { continue; }
    stats.current = d;
    for (const e of ents) {
      if (e.isSymbolicLink()) continue;
      const p = path.join(d, e.name);
      const lp = p.toLowerCase();
      if (exclude.some((x) => lp.includes(x))) continue;
      if (e.isDirectory()) { if (!DEFAULT_SKIP.has(e.name.toLowerCase())) stack.push(p); continue; }
      if (!e.isFile()) continue;
      let st;
      try { st = await fsp.stat(p, { bigint: false }); } catch { continue; }
      stats.scanned++;
      if (st.size < opts.minSize) continue;
      let arr = bySize.get(st.size);
      if (!arr) bySize.set(st.size, (arr = []));
      arr.push({ p, m: st.mtimeMs, ino: st.dev + ':' + st.ino, nlink: st.nlink });
      if (stats.scanned > opts.maxFiles) return;
    }
    progress();
  }
}

async function hashPart(p, size) {
  const CH = 64 * 1024;
  const fh = await fsp.open(p, 'r');
  try {
    const h = crypto.createHash('sha1');
    const a = Buffer.alloc(Math.min(CH, size));
    await fh.read(a, 0, a.length, 0);
    h.update(a);
    if (size > CH * 2) { const b = Buffer.alloc(CH); await fh.read(b, 0, CH, size - CH); h.update(b); }
    h.update(String(size));
    return h.digest('hex');
  } finally { await fh.close(); }
}

function hashFull(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(p, { highWaterMark: 1024 * 1024 });
    s.on('data', (c) => { h.update(c); if (cancelled) s.destroy(new Error('cancelled')); });
    s.on('error', reject);
    s.on('end', () => resolve(h.digest('hex')));
  });
}

function groupBy(list, keyFn) {
  const m = new Map();
  for (const x of list) { const k = keyFn(x); if (k == null) continue; let a = m.get(k); if (!a) m.set(k, (a = [])); a.push(x); }
  return m;
}

async function run() {
  const t0 = Date.now();
  for (const r of opts.roots) { if (cancelled) break; await walk(r); }
  if (cancelled) return parentPort.postMessage({ type: 'cancelled' });

  // merge hard links: keep one entry per physical file
  const sizeGroups = [];
  for (const [size, arr] of bySize) {
    const uniq = [...groupBy(arr, (x) => x.ino).values()].map((g) => ({ ...g[0], links: g.length > 1 ? g.map((x) => x.p) : null }));
    if (uniq.length > 1) sizeGroups.push([size, uniq]);
  }
  stats.candidates = sizeGroups.reduce((a, [, g]) => a + g.length, 0);
  stats.phase = 'partial';
  progress(true);

  const groups = [];
  for (const [size, files] of sizeGroups) {
    if (cancelled) break;
    for (const f of files) { try { f.ph = await hashPart(f.p, size); } catch { f.ph = null; } stats.hashed++; progress(); }
    for (const pg of groupBy(files, (f) => f.ph).values()) {
      if (pg.length < 2) continue;
      stats.phase = 'full';
      for (const f of pg) { try { f.fh = size <= 128 * 1024 ? f.ph : await hashFull(f.p); } catch { f.fh = null; } progress(); }
      for (const [hash, fg] of groupBy(pg, (f) => f.fh)) {
        if (fg.length < 2) continue;
        groups.push({ hash, size, wasted: size * (fg.length - 1), files: fg.map((f) => ({ p: f.p, m: f.m, links: f.links })) });
      }
    }
  }
  if (cancelled) return parentPort.postMessage({ type: 'cancelled' });
  groups.sort((a, b) => b.wasted - a.wasted);
  parentPort.postMessage({ type: 'done', result: { groups, scanned: stats.scanned, elapsed: Date.now() - t0, roots: opts.roots, minSize: opts.minSize } });
}

run().catch((e) => parentPort.postMessage({ type: 'error', message: String(e && e.stack || e) }));
