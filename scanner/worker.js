// Disk scanner — runs inside a worker_thread so the UI stays responsive.
// Walks a directory tree with bounded concurrency, aggregates folder sizes,
// and collects the largest files, recently-added files and extension stats.
'use strict';

const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFileSync } = require('child_process');

const opts = Object.assign({
  root: 'C:\\',
  concurrency: 48,
  keepDirMin: 2 * 1024 * 1024,      // folders smaller than this are folded into "other"
  keepFileMin: 2 * 1024 * 1024,     // files smaller than this are not kept per-folder
  maxChildren: 300,
  maxFilesPerDir: 60,
  topFiles: 1500,
  recentDays: 30,
  recentFileMin: 5 * 1024 * 1024,
}, workerData || {});

const now = Date.now();
const recentCutoff = now - opts.recentDays * 86400000;
const weekCutoff = now - 7 * 86400000;

let cancelled = false;
parentPort.on('message', (m) => { if (m === 'cancel') cancelled = true; });

const stats = { files: 0, dirs: 0, bytes: 0, errors: 0, current: '' };
const seenLinks = new Set();          // hard-linked files are counted once (WinSxS etc.)
const bigFiles = [];                  // candidates for "largest files"
const recentFiles = [];               // candidates for "recently added"
const extStats = new Map();           // ext -> [bytes, count]
const deniedDirs = [];
const unstatable = [];                // files that refused stat (pagefile.sys and friends)

function makeNode(name, parent) {
  return { n: name, p: parent, s: 0, f: 0, d: 0, r7: 0, r30: 0, m: 0, c: [], files: [], err: 0 };
}

function fullPath(node) {
  const parts = [];
  let cur = node;
  while (cur) { parts.push(cur.n); cur = cur.p; }
  parts.reverse();
  return path.join(...parts);
}

function recordFile(dirNode, dirPath, name, st) {
  if (st.nlink > 1 && st.ino) {
    const key = st.dev + ':' + st.ino;
    if (seenLinks.has(key)) return;
    seenLinks.add(key);
  }
  const size = st.size;
  const t = Math.max(st.mtimeMs || 0, st.birthtimeMs || 0);
  dirNode.s += size;
  dirNode.f += 1;
  if (t > dirNode.m) dirNode.m = t;
  if (t >= recentCutoff) dirNode.r30 += size;
  if (t >= weekCutoff) dirNode.r7 += size;
  stats.files++;
  stats.bytes += size;

  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  const e = extStats.get(ext);
  if (e) { e[0] += size; e[1]++; } else extStats.set(ext, [size, 1]);

  const dp = () => (typeof dirPath === 'function' ? dirPath() : dirPath);
  if (size >= opts.keepFileMin) {
    dirNode.files.push({ n: name, s: size, m: t });
    if (bigFiles.length < 200000) bigFiles.push({ p: path.join(dp(), name), s: size, m: t });
  }
  if (t >= recentCutoff && size >= opts.recentFileMin) {
    recentFiles.push({ p: path.join(dp(), name), s: size, m: t });
  }
}

async function scanDir(node, dirPath, queue) {
  let entries;
  try {
    entries = await fsp.readdir(dirPath, { withFileTypes: true });
  } catch (e) {
    node.err = 1;
    stats.errors++;
    if (e.code === 'EPERM' || e.code === 'EACCES') deniedDirs.push(dirPath);
    return;
  }
  stats.dirs++;
  stats.current = dirPath;
  const fileStats = [];
  for (const ent of entries) {
    if (ent.isSymbolicLink()) continue;                 // junctions & symlinks: never follow
    if (ent.isDirectory()) {
      const child = makeNode(ent.name, node);
      node.c.push(child);
      queue.push([child, path.join(dirPath, ent.name)]);
    } else {
      fileStats.push(ent.name);
    }
  }
  // stat files in chunks to keep the libuv pool busy without flooding memory
  const CHUNK = 64;
  for (let i = 0; i < fileStats.length; i += CHUNK) {
    const slice = fileStats.slice(i, i + CHUNK);
    const results = await Promise.all(slice.map((nm) =>
      fsp.lstat(path.join(dirPath, nm)).then((st) => [nm, st], (err) => [nm, null, err])));
    for (const [nm, st] of results) {
      if (st) recordFile(node, dirPath, nm, st);
      else { stats.errors++; unstatable.push([node, dirPath, nm]); }
    }
  }
}

// Some locked system files (pagefile.sys, hiberfil.sys, swapfile.sys) refuse stat().
// Ask the OS via FindFirstFile (cmd's dir) for their size instead.
function resolveUnstatable() {
  for (const [node, dirPath, nm] of unstatable.slice(0, 50)) {
    try {
      const out = execFileSync('cmd.exe', ['/d', '/c', 'dir', '/a', '/-c', path.join(dirPath, nm)],
        { encoding: 'utf8', windowsHide: true, timeout: 5000 });
      const line = out.split(/\r?\n/).find((l) => l.toLowerCase().includes(nm.toLowerCase()) && /\s\d+\s/.test(l));
      if (!line) continue;
      const m = line.match(/\s(\d{1,16})\s+\S/);
      if (!m) continue;
      const size = Number(m[1]);
      recordFile(node, dirPath, nm, { size, nlink: 1, mtimeMs: 0, birthtimeMs: 0 });
      stats.errors--;
    } catch (_) { /* ignore */ }
  }
}

function aggregate(root) {
  // iterative post-order: children before parents
  const order = [];
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    order.push(n);
    for (const c of n.c) stack.push(c);
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const n = order[i];
    for (const c of n.c) {
      n.s += c.s; n.f += c.f; n.d += 1 + c.d;
      n.r7 += c.r7; n.r30 += c.r30;
      if (c.m > n.m) n.m = c.m;
      if (c.err) n.err = Math.max(n.err, 1);
    }
  }
}

// Collect folders whose recent growth is large (but avoid listing every ancestor:
// report the deepest folder that still holds most of its parent's recent bytes).
function growthHotspots(root) {
  const MIN = 150 * 1024 * 1024;
  const out = [];
  // post-order: a folder is reported when the recent bytes not already explained
  // by reported descendants are still significant
  const order = [];
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (n.r30 < MIN) continue;
    order.push(n);
    for (const c of n.c) stack.push(c);
  }
  const claimed = new Map();
  for (let i = order.length - 1; i >= 0; i--) {
    const n = order[i];
    let childClaim = 0, childClaim7 = 0;
    for (const c of n.c) { const cc = claimed.get(c); if (cc) { childClaim += cc[0]; childClaim7 += cc[1]; } }
    const own = n.r30 - childClaim;
    if (own >= MIN && n.p != null) {
      out.push({ p: fullPath(n), r7: n.r7, r30: n.r30, own, own7: n.r7 - childClaim7, s: n.s, f: n.f });
      claimed.set(n, [n.r30, n.r7]);
    } else {
      claimed.set(n, [childClaim, childClaim7]);
    }
  }
  out.sort((a, b) => b.own - a.own);
  return out.slice(0, 80);
}

// Flat list of all folders >= threshold, used for rule matching (caches, node_modules…)
function flatFolders(root, min) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (n.s < min) continue;
    out.push({ p: fullPath(n), s: n.s, f: n.f, m: n.m, r30: n.r30 });
    for (const c of n.c) stack.push(c);
  }
  return out;
}

function prune(n) {
  n.c.sort((a, b) => b.s - a.s);
  const kept = [];
  let otherS = 0, otherF = 0, otherCount = 0;
  for (const c of n.c) {
    if (c.s >= opts.keepDirMin && kept.length < opts.maxChildren) kept.push(c);
    else { otherS += c.s; otherF += c.f; otherCount++; }
  }
  n.files.sort((a, b) => b.s - a.s);
  const files = n.files.slice(0, opts.maxFilesPerDir);
  const out = {
    n: n.n, s: n.s, f: n.f, d: n.d, m: n.m, r7: n.r7, r30: n.r30, e: n.err,
    c: kept.map(prune),
    fl: files,
  };
  if (otherCount) out.o = { s: otherS, f: otherF, k: otherCount };
  return out;
}

// Build the tree from the binary listing written by native/mftscan.exe
function buildFromMft(root) {
  const buf = fs.readFileSync(opts.mftFile);
  if (buf.toString('ascii', 0, 6) !== 'DIMFT1') throw new Error('bad mft listing');
  const count = buf.readUInt32LE(6);
  const rootIdx = buf.readUInt32LE(10);
  const recs = new Array(count);
  let off = 14;
  for (let i = 0; i < count; i++) {
    const idx = buf.readUInt32LE(off), parent = buf.readUInt32LE(off + 4), flags = buf[off + 8];
    const size = Number(buf.readBigInt64LE(off + 9));
    const mtime = buf.readDoubleLE(off + 17), ctime = buf.readDoubleLE(off + 25);
    const nlen = buf.readUInt16LE(off + 33);
    const name = buf.toString('utf16le', off + 35, off + 35 + nlen * 2);
    off += 35 + nlen * 2;
    recs[i] = { idx, parent, dir: (flags & 2) !== 0, size, mtime, ctime, name };
  }
  const dirs = new Map();
  dirs.set(rootIdx, root);
  for (const r of recs) if (r.dir && r.idx !== rootIdx) dirs.set(r.idx, makeNode(r.name, null));
  for (const r of recs) {
    if (!r.dir || r.idx === rootIdx) continue;
    const node = dirs.get(r.idx), par = dirs.get(r.parent);
    if (!par || par === node) continue;            // orphan: parent record gone — never reachable from root
    node.p = par; par.c.push(node);
  }
  // keep only directories whose parent chain reaches the root (guards against stale cycles)
  const reachable = new Set([root]);
  const stack = [root];
  while (stack.length) { const n = stack.pop(); for (const c of n.c) if (!reachable.has(c)) { reachable.add(c); stack.push(c); } }
  stats.dirs = reachable.size;
  for (const r of recs) {
    if (r.dir) continue;
    const par = dirs.get(r.parent);
    if (!par || !reachable.has(par)) continue;
    recordFile(par, () => fullPath(par), r.name, { size: r.size, nlink: 1, mtimeMs: r.mtime, birthtimeMs: r.ctime });
  }
}

async function run() {
  const root = makeNode(opts.root.replace(/[\\/]+$/, '') + '\\', null);
  if (opts.mftFile) {
    const t0m = Date.now();
    buildFromMft(root);
    aggregate(root);
    return finish(root, t0m - (opts.helperMs || 0), 'mft');
  }
  const queue = [[root, opts.root]];
  let active = 0;
  const t0 = Date.now();

  const progress = setInterval(() => {
    parentPort.postMessage({ type: 'progress', stats: { ...stats, elapsed: Date.now() - t0, queued: queue.length } });
  }, 200);

  await new Promise((resolve) => {
    const pump = () => {
      if (cancelled) { if (active === 0) resolve(); return; }
      while (active < opts.concurrency && queue.length) {
        const [node, p] = queue.pop();      // DFS keeps memory low
        active++;
        scanDir(node, p, queue).finally(() => { active--; pump(); });
      }
      if (active === 0 && queue.length === 0) resolve();
    };
    pump();
  });
  clearInterval(progress);

  if (cancelled) { parentPort.postMessage({ type: 'cancelled' }); return; }

  resolveUnstatable();
  aggregate(root);
  return finish(root, t0, 'walk');
}

function finish(root, t0, engine) {
  bigFiles.sort((a, b) => b.s - a.s);
  recentFiles.sort((a, b) => b.s - a.s);
  const exts = [...extStats.entries()].map(([e, [s, c]]) => ({ e, s, c })).sort((a, b) => b.s - a.s).slice(0, 80);

  const result = {
    root: opts.root,
    engine,
    finishedAt: Date.now(),
    elapsed: Date.now() - t0,
    stats: { files: stats.files, dirs: stats.dirs, bytes: stats.bytes, errors: stats.errors },
    deniedDirs: deniedDirs.slice(0, 200),
    deniedCount: deniedDirs.length,
    tree: prune(root),
    topFiles: bigFiles.slice(0, opts.topFiles),
    recentFiles: recentFiles.slice(0, 1000),
    hotspots: growthHotspots(root),
    folders: flatFolders(root, 20 * 1024 * 1024),
    exts,
  };
  parentPort.postMessage({ type: 'done', result });
}

run().catch((e) => parentPort.postMessage({ type: 'error', message: String(e && e.stack || e) }));
