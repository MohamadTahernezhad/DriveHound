'use strict';
// Quarantine: move items to another drive for N days, restorable, then purged automatically.
// Space on the source drive is freed immediately; nothing is lost until expiry.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { copyTree, removeTree, treeStats, driveOf, freeSpace } = require('./fsops');

function createQuarantine(dataDir, guard) {
  const indexFile = path.join(dataDir, 'quarantine-index.json');

  async function readIndex() {
    try { return JSON.parse(await fsp.readFile(indexFile, 'utf8')); } catch { return { batches: [] }; }
  }
  async function writeIndex(idx) {
    await fsp.mkdir(dataDir, { recursive: true });
    await fsp.writeFile(indexFile, JSON.stringify(idx, null, 1));
  }

  // items: [{ path, size }], targetDrive: 'D:'
  async function add(items, targetDrive, days = 7, onProgress) {
    if (!/^[A-Z]:$/i.test(targetDrive)) throw new Error('invalid-drive');
    targetDrive = targetDrive.toUpperCase();
    const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex');
    const root = path.join(targetDrive + '\\', 'DriveHound-Quarantine', id);
    const batch = { id, root, created: Date.now(), expires: Date.now() + days * 86400000, items: [] };
    const results = [];
    let n = 0;
    for (const it of items) {
      const reason = guard.deleteReason(it.path);
      if (reason) { results.push({ path: it.path, ok: false, error: 'forbidden:' + reason }); continue; }
      if (driveOf(it.path) === targetDrive) { results.push({ path: it.path, ok: false, error: 'same-drive' }); continue; }
      let st;
      try { st = await fsp.lstat(it.path); } catch { results.push({ path: it.path, ok: false, error: 'missing' }); continue; }
      const stats = st.isDirectory() ? await treeStats(it.path) : { size: st.size, files: 1 };
      if (freeSpace(targetDrive) < stats.size * 1.05 + 50 * 1048576) { results.push({ path: it.path, ok: false, error: 'no-space-on-target' }); continue; }
      const stored = path.join(root, String(++n), path.basename(it.path));
      try {
        await copyTree(it.path, stored, (p) => onProgress && onProgress({ ...p, item: it.path }));
        const verify = st.isDirectory() ? await treeStats(stored) : { size: (await fsp.stat(stored)).size, files: 1 };
        if (verify.size !== stats.size || verify.files !== stats.files) throw Object.assign(new Error('verify-failed'), { code: 'EVERIFY' });
      } catch (e) {
        await removeTree(path.join(root, String(n)));
        results.push({ path: it.path, ok: false, error: e.code || e.message });
        continue;
      }
      const acc = await removeTree(it.path);
      const entry = { orig: it.path, stored, size: stats.size, files: stats.files, isDir: st.isDirectory(), partial: acc.failed > 0 };
      batch.items.push(entry);
      results.push({ path: it.path, ok: true, freed: acc.freed, quarantined: true, partial: entry.partial, failed: acc.failed });
    }
    if (batch.items.length) {
      await fsp.writeFile(path.join(root, 'manifest.json'), JSON.stringify(batch, null, 1));
      const idx = await readIndex();
      idx.batches.push({ id, root, created: batch.created, expires: batch.expires });
      await writeIndex(idx);
    }
    return { batch: batch.items.length ? batch : null, results };
  }

  async function list() {
    const idx = await readIndex();
    const out = [];
    for (const b of idx.batches) {
      try {
        const m = JSON.parse(await fsp.readFile(path.join(b.root, 'manifest.json'), 'utf8'));
        out.push(m);
      } catch { out.push({ ...b, items: [], missing: true }); }
    }
    return out.sort((a, b) => b.created - a.created);
  }

  async function updateManifest(batch) {
    await fsp.writeFile(path.join(batch.root, 'manifest.json'), JSON.stringify(batch, null, 1));
  }

  async function findBatch(id) {
    if (!/^[\w-]{10,80}$/.test(id)) throw new Error('invalid-id');
    const idx = await readIndex();
    const b = idx.batches.find((x) => x.id === id);
    if (!b) throw new Error('not-found');
    return JSON.parse(await fsp.readFile(path.join(b.root, 'manifest.json'), 'utf8'));
  }

  // Restore one item (by stored path) or the whole batch.
  async function restore(id, storedPath) {
    const batch = await findBatch(id);
    const targets = batch.items.filter((i) => !i.restored && (!storedPath || i.stored === storedPath));
    const results = [];
    for (const it of targets) {
      let dest = it.orig;
      if (fs.existsSync(dest)) dest = dest + ' (restored ' + new Date().toISOString().slice(0, 10) + ')';
      try {
        await copyTree(it.stored, dest);
        await removeTree(path.dirname(it.stored));
        it.restored = Date.now(); it.restoredTo = dest;
        results.push({ path: it.orig, ok: true, restoredTo: dest });
      } catch (e) {
        results.push({ path: it.orig, ok: false, error: e.code || e.message });
      }
    }
    await updateManifest(batch);
    if (batch.items.every((i) => i.restored)) await purgeBatch(id, true);
    return results;
  }

  async function purgeBatch(id, keepIndexCheck) {
    const idx = await readIndex();
    const b = idx.batches.find((x) => x.id === id);
    if (!b) return false;
    // only ever delete inside a DriveHound-Quarantine folder (or DiskInsight-Quarantine from the old name)
    if (!/\\(?:DriveHound|DiskInsight)-Quarantine\\[\w-]+$/i.test(b.root)) throw new Error('refusing-purge');
    await removeTree(b.root);
    await fsp.rmdir(path.dirname(b.root)).catch(() => {});      // remove DriveHound-Quarantine when empty
    idx.batches = idx.batches.filter((x) => x.id !== id);
    await writeIndex(idx);
    return !keepIndexCheck || true;
  }

  async function purgeExpired() {
    const idx = await readIndex();
    const now = Date.now();
    let purged = 0;
    for (const b of idx.batches.filter((x) => x.expires < now)) { await purgeBatch(b.id); purged++; }
    return purged;
  }

  return { add, list, restore, purgeBatch, purgeExpired };
}

module.exports = { createQuarantine };
