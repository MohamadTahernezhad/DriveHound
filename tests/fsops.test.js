'use strict';
// Integration tests on real temporary files (and drive D: for cross-drive features when present).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Worker } = require('worker_threads');
const { createGuard, defaultEnv } = require('../core/guard');
const { deletePaths } = require('../core/delete');
const { createQuarantine } = require('../core/quarantine');
const { createMover } = require('../core/move');
const { linkDuplicates } = require('../core/dupes-ops');
const { removeTree, treeStats } = require('../core/fsops');
const { createHistory } = require('../core/history');

const guard = createGuard(defaultEnv());
const BASE = path.join(os.tmpdir(), 'dh-tests-' + process.pid + '-' + crypto.randomBytes(3).toString('hex'));
const OTHER = fs.existsSync('D:\\') ? path.join('D:\\', 'dh-tests-' + process.pid) : null;
const mk = (p, bytes, fill) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.alloc(bytes, fill == null ? 7 : fill)); return p; };
const DATA = path.join(BASE, '_data');

test.after(async () => {
  // remove any quarantine batches this run created on the other drive, even if a test failed midway
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(DATA, 'quarantine-index.json'), 'utf8'));
    for (const b of idx.batches) if (/\\DriveHound-Quarantine\\[\w-]+$/i.test(b.root)) await removeTree(b.root);
    for (const b of idx.batches) fs.rmdirSync(path.dirname(b.root), { recursive: false });
  } catch { /* nothing to clean */ }
  await removeTree(BASE);
  if (OTHER) await removeTree(OTHER);
});

test('delete: permanent, contents-only, forbidden and missing', async () => {
  const a = mk(path.join(BASE, 'del', 'a', 'f1.bin'), 5000);
  mk(path.join(BASE, 'del', 'c', 'inner', 'f2.bin'), 3000);
  mk(path.join(BASE, 'del', 'c', 'keep.txt'), 10);
  const res = await deletePaths([
    { path: path.dirname(a) }, { path: path.join(BASE, 'del', 'c'), contents: true },
    { path: process.env.WINDIR }, { path: 'C:\\' }, { path: path.join(BASE, 'nope') },
  ], 'permanent', { guard });
  assert.equal(res[0].ok, true); assert.equal(res[0].freed, 5000);
  assert.equal(res[1].ok, true); assert.equal(res[1].freed, 3010);
  assert.ok(fs.existsSync(path.join(BASE, 'del', 'c')), 'contents mode keeps the folder');
  assert.equal(fs.readdirSync(path.join(BASE, 'del', 'c')).length, 0);
  assert.match(res[2].error, /^forbidden:/);
  assert.match(res[3].error, /^forbidden:drive-root/);
  assert.equal(res[4].error, 'missing');
});

test('delete never follows a junction into its target', async () => {
  const target = path.join(BASE, 'jt', 'real');
  mk(path.join(target, 'precious.txt'), 100);
  const link = path.join(BASE, 'jt', 'link');
  fs.symlinkSync(target, link, 'junction');
  const res = await deletePaths([{ path: link }], 'permanent', { guard });
  assert.equal(res[0].ok, true);
  assert.ok(!fs.existsSync(link), 'link removed');
  assert.ok(fs.existsSync(path.join(target, 'precious.txt')), 'target untouched');
});

test('contents mode refuses files and links', async () => {
  const f = mk(path.join(BASE, 'cm', 'file.txt'), 10);
  const res = await deletePaths([{ path: f, contents: true }], 'permanent', { guard });
  assert.equal(res[0].ok, false);
  assert.ok(fs.existsSync(f));
});

test('history log records and reads back', async () => {
  const h = createHistory(DATA);
  await h.add({ op: 'delete', bytes: 5 });
  await h.add({ op: 'move', bytes: 7 });
  const list = await h.list();
  assert.equal(list.length, 2);
  assert.equal(list[0].op, 'move');
});

test('quarantine to another drive: add, list, restore, purge', { skip: !OTHER && 'no second drive' }, async () => {
  const q = createQuarantine(DATA, guard);
  const dir = path.join(BASE, 'q', 'folder');
  mk(path.join(dir, 'sub', 'x.bin'), 20000);
  mk(path.join(dir, 'y.bin'), 1000);
  const f = mk(path.join(BASE, 'q', 'single.bin'), 777);
  const r = await q.add([{ path: dir }, { path: f }, { path: 'C:\\Windows' }], 'D:', 7);
  assert.equal(r.results.filter((x) => x.ok).length, 2);
  assert.match(r.results[2].error, /forbidden/);
  assert.ok(!fs.existsSync(dir) && !fs.existsSync(f), 'originals removed');
  const list = await q.list();
  const batch = list.find((b) => b.id === r.batch.id);
  assert.equal(batch.items.length, 2);
  assert.ok(batch.root.startsWith('D:\\DriveHound-Quarantine\\'));
  const rr = await q.restore(batch.id);
  assert.ok(rr.every((x) => x.ok));
  assert.equal((await treeStats(dir)).size, 21000);
  assert.equal(fs.statSync(f).size, 777);
  assert.ok(!fs.existsSync(batch.root), 'batch folder removed after full restore');
});

test('quarantine refuses same-drive targets', async () => {
  const q = createQuarantine(DATA, guard);
  const f = mk(path.join(BASE, 'q2', 'a.bin'), 10);
  const r = await q.add([{ path: f }], path.parse(BASE).root.slice(0, 2), 7);
  assert.equal(r.results[0].error, 'same-drive');
  assert.ok(fs.existsSync(f));
});

test('move to another drive with junction, then restore', { skip: !OTHER && 'no second drive' }, async () => {
  const m = createMover(DATA, guard);
  const src = path.join(BASE, 'mv', 'cache');
  mk(path.join(src, 'a', 'b.bin'), 50000);
  mk(path.join(src, 'c.bin'), 1234);
  const rec = await m.move({ source: src, targetBase: OTHER });
  const st = fs.lstatSync(src);
  assert.ok(st.isSymbolicLink(), 'old path is now a junction');
  assert.equal(fs.readFileSync(path.join(src, 'c.bin')).length, 1234, 'data reachable through the junction');
  assert.ok(rec.target.startsWith(OTHER));
  assert.equal((await treeStats(rec.target)).size, 51234);
  await assert.rejects(m.move({ source: src, targetBase: OTHER }), /already-linked/);
  const back = await m.restore(rec.id);
  assert.ok(back.ok);
  assert.ok(!fs.lstatSync(src).isSymbolicLink(), 'real folder restored');
  assert.equal((await treeStats(src)).size, 51234);
  assert.ok(!fs.existsSync(rec.target), 'moved copy removed');
});

test('move refuses forbidden sources, same drive and busy folders', { skip: !OTHER && 'no second drive' }, async () => {
  const m = createMover(DATA, guard);
  await assert.rejects(m.move({ source: process.env.WINDIR + '\\Temp\\x', targetBase: OTHER }), /forbidden/);
  await assert.rejects(m.move({ source: process.env.ProgramFiles + '\\Common Files', targetBase: OTHER }), /forbidden:program-files/);
  const src = path.join(BASE, 'mv2', 'busy');
  mk(path.join(src, 'locked.bin'), 100);
  await assert.rejects(m.move({ source: src, targetBase: path.join(BASE, 'elsewhere') }), /same-drive/);
  // an open handle makes the rename fail → nothing is copied, nothing is lost
  const fd = fs.openSync(path.join(src, 'locked.bin'), 'r');
  try {
    await assert.rejects(m.move({ source: src, targetBase: OTHER }), /in-use/);
    assert.ok(fs.existsSync(path.join(src, 'locked.bin')));
  } finally { fs.closeSync(fd); }
});

test('hard-link duplicates: verifies content, frees space, keeps data', async () => {
  const dir = path.join(BASE, 'dup');
  const keep = mk(path.join(dir, 'keep.bin'), 100000, 1);
  const d1 = mk(path.join(dir, 'copy1.bin'), 100000, 1);
  const diff = mk(path.join(dir, 'different.bin'), 100000, 2);
  const r = await linkDuplicates(keep, [d1, diff, 'C:\\Windows\\notepad.exe'], guard);
  assert.equal(r[0].ok, true);
  assert.equal(r[1].error, 'content-changed');
  assert.ok(!r[2].ok);
  assert.equal(fs.statSync(d1).nlink, 2, 'copy is now a hard link');
  assert.equal(fs.readFileSync(d1)[0], 1);
  assert.equal(fs.readFileSync(diff)[0], 2, 'different file untouched');
});

test('duplicate finder worker groups identical files and merges hard links', async () => {
  const dir = path.join(BASE, 'dupscan');
  mk(path.join(dir, 'a', 'x.bin'), 300000, 9);
  mk(path.join(dir, 'b', 'x-copy.bin'), 300000, 9);
  mk(path.join(dir, 'c', 'other.bin'), 300000, 8);
  mk(path.join(dir, 'small.bin'), 10, 9);
  fs.linkSync(path.join(dir, 'a', 'x.bin'), path.join(dir, 'a', 'x-hardlink.bin'));
  const result = await new Promise((resolve, reject) => {
    const w = new Worker(path.join(__dirname, '..', 'scanner', 'dupes.js'), { workerData: { roots: [dir], minSize: 1000, exclude: [] } });
    w.on('message', (m) => { if (m.type === 'done') { resolve(m.result); w.terminate(); } else if (m.type === 'error') reject(new Error(m.message)); });
    w.on('error', reject);
  });
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].files.length, 2, 'hard link is not counted as a duplicate');
  assert.equal(result.groups[0].wasted, 300000);
});

function runWorker(workerData) {
  return new Promise((resolve, reject) => {
    const w = new Worker(path.join(__dirname, '..', 'scanner', 'worker.js'), { workerData });
    w.on('message', (m) => { if (m.type === 'done') { resolve(m.result); w.terminate(); } else if (m.type === 'error') reject(new Error(m.message)); });
    w.on('error', reject);
  });
}

test('scan worker (walk): sizes, hard links counted once, junctions not followed', async () => {
  const root = path.join(BASE, 'scan');
  mk(path.join(root, 'big', 'a.bin'), 3 * 1024 * 1024);
  mk(path.join(root, 'big', 'b.bin'), 1024);
  mk(path.join(root, 'small', 'c.bin'), 2048);
  fs.linkSync(path.join(root, 'big', 'a.bin'), path.join(root, 'small', 'a-link.bin'));
  fs.symlinkSync(path.join(BASE, 'del'), path.join(root, 'junction'), 'junction');
  const r = await runWorker({ root });
  assert.equal(r.engine, 'walk');
  assert.equal(r.stats.bytes, 3 * 1024 * 1024 + 1024 + 2048);
  assert.equal(r.tree.s, r.stats.bytes);
  assert.ok(r.topFiles.some((f) => f.p.endsWith('a.bin') || f.p.endsWith('a-link.bin')));
});

test('scan worker (mft): builds the tree from the native listing format', async () => {
  // synthetic listing: root(5) → Users(30) → me(31) → big.bin ; orphan dir(40) with parent 999
  const recs = [
    [5, 5, 3, 0, '.'], [30, 5, 3, 0, 'Users'], [31, 30, 3, 0, 'me'], [32, 31, 1, 5 * 1024 * 1024, 'big.bin'],
    [33, 5, 1, 1000, 'root.txt'], [40, 999, 3, 0, 'orphan'], [41, 40, 1, 777, 'lost.bin'],
  ];
  const parts = [Buffer.from('DIMFT1', 'ascii')];
  const hdr = Buffer.alloc(8); hdr.writeUInt32LE(recs.length, 0); hdr.writeUInt32LE(5, 4); parts.push(hdr);
  const now = Date.now();
  for (const [idx, par, flags, size, name] of recs) {
    const nb = Buffer.from(name, 'utf16le');
    const b = Buffer.alloc(35);
    b.writeUInt32LE(idx, 0); b.writeUInt32LE(par, 4); b[8] = flags; b.writeBigInt64LE(BigInt(size), 9);
    b.writeDoubleLE(now, 17); b.writeDoubleLE(now, 25); b.writeUInt16LE(name.length, 33);
    parts.push(b, nb);
  }
  const file = path.join(BASE, 'synthetic.bin');
  fs.mkdirSync(BASE, { recursive: true });
  fs.writeFileSync(file, Buffer.concat(parts));
  const r = await runWorker({ root: 'Z:\\', mftFile: file });
  assert.equal(r.engine, 'mft');
  assert.equal(r.tree.s, 5 * 1024 * 1024 + 1000, 'orphans are excluded');
  assert.equal(r.tree.c[0].n, 'Users');
  assert.equal(r.topFiles[0].p, 'Z:\\Users\\me\\big.bin');
});
