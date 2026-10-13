'use strict';
// Deletion pipeline: every item passes the guard; supports Recycle Bin, permanent, contents-only and quarantine.

const fs = require('fs');
const fsp = fs.promises;
const { removeTree, removeContents } = require('./fsops');

/**
 * @param items  [{ path, size, contents }]
 * @param mode   'trash' | 'permanent' | 'quarantine'
 * @param deps   { guard, trashItem(path), quarantine, quarantineDrive, quarantineDays, onProgress }
 */
async function deletePaths(items, mode, deps) {
  const { guard, trashItem, quarantine, onProgress } = deps;
  const results = [];
  const toQuarantine = [];
  let done = 0;
  for (const item of items) {
    const p = item.path;
    const reason = guard.deleteReason(p);
    if (reason) { results.push({ path: p, ok: false, error: 'forbidden:' + reason }); onProgress && onProgress({ done: ++done, total: items.length }); continue; }
    if (!fs.existsSync(p)) { results.push({ path: p, ok: false, error: 'missing' }); onProgress && onProgress({ done: ++done, total: items.length }); continue; }
    try {
      if (item.contents) {
        // a folder that must stay (Temp, caches): empty it, never trash/quarantine it as a whole
        const st = await fsp.lstat(p);
        if (!st.isDirectory() || st.isSymbolicLink()) throw Object.assign(new Error('not-a-folder'), { code: 'ENOTDIR' });
        const acc = await removeContents(p);
        results.push({ path: p, ok: true, freed: acc.freed, files: acc.files, failed: acc.failed });
      } else if (mode === 'quarantine') {
        toQuarantine.push(item);
        continue;
      } else if (mode === 'trash') {
        await trashItem(p);
        results.push({ path: p, ok: true, freed: item.size || 0, trashed: true });
      } else {
        const acc = await removeTree(p);
        results.push({ path: p, ok: acc.failed === 0 || acc.freed > 0, freed: acc.freed, files: acc.files, failed: acc.failed, error: acc.failed ? acc.lastError : undefined });
      }
    } catch (e) {
      results.push({ path: p, ok: false, error: e.code || String(e.message || e) });
    }
    onProgress && onProgress({ done: ++done, total: items.length });
  }
  if (toQuarantine.length) {
    const r = await quarantine.add(toQuarantine, deps.quarantineDrive, deps.quarantineDays || 7,
      () => onProgress && onProgress({ done, total: items.length, copying: true }));
    results.push(...r.results);
    onProgress && onProgress({ done: items.length, total: items.length });
  }
  return results;
}

module.exports = { deletePaths };
