'use strict';
// Low-level file operations used by delete / quarantine / move. No Electron dependency.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

// Tolerant recursive delete: never follows junctions/symlinks (removes the link only),
// keeps going past locked files and reports what was freed.
async function removeTree(p, acc = { freed: 0, files: 0, failed: 0 }) {
  let st;
  try { st = await fsp.lstat(p); } catch { return acc; }
  if (st.isSymbolicLink()) {
    // junction or symlink: remove the link itself, never the target
    try { await fsp.unlink(p); } catch { try { await fsp.rmdir(p); } catch (e) { acc.failed++; acc.lastError = e.code; } }
    return acc;
  }
  if (st.isDirectory()) {
    let entries = [];
    try { entries = await fsp.readdir(p); } catch (e) { acc.failed++; acc.lastError = e.code; return acc; }
    for (const e of entries) await removeTree(path.join(p, e), acc);
    try { await fsp.rmdir(p); } catch { /* not empty: locked children */ }
    return acc;
  }
  try {
    await fsp.unlink(p);
    acc.freed += st.size; acc.files++;
  } catch (e) {
    if (e.code === 'EPERM' || e.code === 'EACCES') {
      try { await fsp.chmod(p, 0o666); await fsp.unlink(p); acc.freed += st.size; acc.files++; return acc; } catch { /* fallthrough */ }
    }
    acc.failed++; acc.lastError = e.code;
  }
  return acc;
}

async function removeContents(dir, acc = { freed: 0, files: 0, failed: 0 }) {
  let entries = [];
  try { entries = await fsp.readdir(dir); } catch (e) { acc.failed++; acc.lastError = e.code; return acc; }
  for (const e of entries) await removeTree(path.join(dir, e), acc);
  return acc;
}

// Size + file count of a tree (no link following).
async function treeStats(p, acc = { size: 0, files: 0, dirs: 0, errors: 0 }, limit = Infinity) {
  let st;
  try { st = await fsp.lstat(p); } catch { acc.errors++; return acc; }
  if (st.isSymbolicLink()) return acc;
  if (!st.isDirectory()) { acc.size += st.size; acc.files++; return acc; }
  acc.dirs++;
  let entries = [];
  try { entries = await fsp.readdir(p); } catch { acc.errors++; return acc; }
  for (const e of entries) { if (acc.files > limit) break; await treeStats(path.join(p, e), acc, limit); }
  return acc;
}

// Recursive copy with progress, preserving timestamps. Refuses to copy links (would change semantics).
async function copyTree(src, dst, onProgress, state = { bytes: 0, files: 0, cancelled: false }) {
  const st = await fsp.lstat(src);
  if (st.isSymbolicLink()) throw Object.assign(new Error('contains-link: ' + src), { code: 'ELINK' });
  if (st.isDirectory()) {
    await fsp.mkdir(dst, { recursive: true });
    for (const e of await fsp.readdir(src)) {
      if (state.cancelled) throw Object.assign(new Error('cancelled'), { code: 'ECANCELLED' });
      await copyTree(path.join(src, e), path.join(dst, e), onProgress, state);
    }
    await fsp.utimes(dst, st.atime, st.mtime).catch(() => {});
  } else {
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    await fsp.copyFile(src, dst, fs.constants.COPYFILE_EXCL);
    await fsp.utimes(dst, st.atime, st.mtime).catch(() => {});
    state.bytes += st.size; state.files++;
    if (onProgress && state.files % 50 === 0) onProgress({ bytes: state.bytes, files: state.files });
  }
  return state;
}

function driveOf(p) { return path.win32.resolve(p).slice(0, 2).toUpperCase(); }

function freeSpace(drive) {
  try { const s = fs.statfsSync(drive + '\\'); return s.bavail * s.bsize; } catch { return 0; }
}

// Create a directory junction (no admin required).
function makeJunction(target, linkPath) {
  return fsp.symlink(target, linkPath, 'junction');
}

module.exports = { removeTree, removeContents, treeStats, copyTree, driveOf, freeSpace, makeJunction };
