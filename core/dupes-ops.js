'use strict';
// Replace duplicate files with hard links to a kept copy (same volume only).
// Each pair is re-verified byte-for-byte via SHA-256 right before linking; failures roll back.

const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const path = require('path');
const { driveOf } = require('./fsops');

function sha256(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(p, { highWaterMark: 1024 * 1024 }).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

async function linkDuplicates(keeper, dupes, guard) {
  const results = [];
  let keepHash;
  try {
    const st = await fsp.lstat(keeper);
    if (!st.isFile()) throw new Error('keeper-not-file');
    keepHash = await sha256(keeper);
  } catch (e) { return dupes.map((d) => ({ path: d, ok: false, error: e.message })); }
  for (const d of dupes) {
    const reason = guard.deleteReason(d);
    if (reason) { results.push({ path: d, ok: false, error: 'forbidden:' + reason }); continue; }
    if (driveOf(d) !== driveOf(keeper)) { results.push({ path: d, ok: false, error: 'different-volume' }); continue; }
    if (path.resolve(d).toLowerCase() === path.resolve(keeper).toLowerCase()) { results.push({ path: d, ok: false, error: 'same-file' }); continue; }
    let st;
    try { st = await fsp.lstat(d); } catch { results.push({ path: d, ok: false, error: 'missing' }); continue; }
    try {
      if ((await sha256(d)) !== keepHash) { results.push({ path: d, ok: false, error: 'content-changed' }); continue; }
    } catch (e) { results.push({ path: d, ok: false, error: e.code || 'read-failed' }); continue; }
    const tmp = d + '.di-link-' + crypto.randomBytes(3).toString('hex');
    try {
      await fsp.rename(d, tmp);
      try {
        await fsp.link(keeper, d);
      } catch (e) { await fsp.rename(tmp, d).catch(() => {}); throw e; }
      await fsp.unlink(tmp);
      results.push({ path: d, ok: true, freed: st.size, linked: true });
    } catch (e) {
      results.push({ path: d, ok: false, error: e.code || e.message });
    }
  }
  return results;
}

module.exports = { linkDuplicates, sha256 };
