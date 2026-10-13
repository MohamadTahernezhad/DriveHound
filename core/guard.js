'use strict';
// Path safety guard — the last line of defence for every destructive operation
// (delete, quarantine, move, compress). Pure module: no Electron, fully unit-tested.

const path = require('path');
const fs = require('fs');
const os = require('os');

function defaultEnv() {
  return {
    WINDIR: process.env.WINDIR || 'C:\\Windows',
    SYSTEMDRIVE: process.env.SystemDrive || 'C:',
    PROGRAMFILES: process.env.ProgramFiles || 'C:\\Program Files',
    PROGRAMFILES86: process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    PROGRAMDATA: process.env.ProgramData || 'C:\\ProgramData',
    USERPROFILE: process.env.USERPROFILE || os.homedir(),
    APPDATA: process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    LOCALAPPDATA: process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
    PUBLIC: process.env.PUBLIC || 'C:\\Users\\Public',
    TEMP: os.tmpdir(),
  };
}

// Normalise a user/renderer supplied path into an absolute, canonical Windows path.
// Rejects device paths, UNC, NT namespaces, ADS and control characters.
function canonical(p) {
  if (typeof p !== 'string' || !p || p.length > 32000) throw new Error('invalid-path');
  if (/[\u0000-\u001f]/.test(p)) throw new Error('invalid-path');
  let s = p.replace(/\//g, '\\');
  if (/^\\\\[?.]\\/.test(s)) throw new Error('device-path');       // \\?\C:\  \\.\C:
  if (/^\\\\/.test(s)) throw new Error('network-path');              // \\server\share
  if (/^[a-zA-Z]:$/.test(s)) return s.toUpperCase() + '\\';           // "C:" is drive-relative; treat as the root
  if (!/^[a-zA-Z]:\\/.test(s)) throw new Error('not-absolute');
  const rest = s.slice(2);
  if (rest.includes(':')) throw new Error('alternate-stream');       // file.txt:stream
  s = path.win32.resolve(s);
  // Windows silently strips trailing dots/spaces from each segment: "C:\Windows." == "C:\Windows"
  s = s.split('\\').map((seg, i) => (i === 0 ? seg : seg.replace(/[. ]+$/, ''))).join('\\');
  if (s.length > 3) s = s.replace(/\\+$/, '');
  return s;
}

// Resolve 8.3 short names (C:\PROGRA~1) and junctions to the real long path when the path exists.
function realOrSelf(p) {
  try { return fs.realpathSync.native(p); } catch { return p; }
}

const low = (p) => p.toLowerCase().replace(/\\+$/, '');
function isUnder(p, base) { const a = low(p), b = low(base); return !!b && (a === b || a.startsWith(b + '\\')); }

function createGuard(env = defaultEnv(), extra = {}) {
  const E = env;
  const userProfileRoot = path.win32.dirname(E.USERPROFILE);
  const knownUserFolders = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Videos', 'Music', 'OneDrive', 'Favorites', 'Contacts', 'Saved Games', 'Searches', 'Links', '3D Objects', 'AppData']
    .map((f) => path.win32.join(E.USERPROFILE, f));

  // Folders that may never be the *target* of deletion themselves (their contents may be).
  const exactBlock = [
    E.WINDIR, E.PROGRAMFILES, E.PROGRAMFILES86, E.PROGRAMDATA, userProfileRoot, E.USERPROFILE, E.APPDATA, E.LOCALAPPDATA,
    path.win32.join(E.USERPROFILE, 'AppData', 'LocalLow'), path.win32.join(E.LOCALAPPDATA, 'Packages'), path.win32.join(E.LOCALAPPDATA, 'Programs'),
    path.win32.join(E.LOCALAPPDATA, 'Temp'), path.win32.join(E.WINDIR, 'Temp'), E.PUBLIC, ...knownUserFolders,
  ];
  // Inside Windows only these areas are touchable.
  const winAllowed = ['Temp', 'SystemTemp', 'SoftwareDistribution\\Download', 'Logs', 'Panther', 'Minidump', 'LiveKernelReports', 'MEMORY.DMP', 'Prefetch']
    .map((s) => path.win32.join(E.WINDIR, s));
  const rootSystem = new Set(['pagefile.sys', 'hiberfil.sys', 'swapfile.sys', 'dumpstack.log', 'dumpstack.log.tmp', 'system volume information', '$recycle.bin', 'recovery', 'boot', 'bootmgr', 'bootnxt', 'efi', 'config.msi', '$mft', '$logfile', '$volume', '$attrdef', '$bitmap', '$boot', '$badclus', '$secure', '$upcase', '$extend']);
  const selfPaths = (extra.selfPaths || []).filter(Boolean);

  // Returns null when allowed, or a short reason code.
  function deleteReason(input) {
    let p;
    try { p = canonical(input); } catch (e) { return e.message; }
    if (/^[a-zA-Z]:\\?$/.test(p)) return 'drive-root';
    for (const cand of new Set([p, realOrSelf(p)])) {
      const lp = low(cand);
      if (/^[a-z]:$/.test(lp)) return 'drive-root';
      if (exactBlock.some((b) => low(b) === lp)) return 'protected-folder';
      if (isUnder(cand, E.WINDIR) && !winAllowed.some((a) => isUnder(cand, a))) return 'windows';
      if (isUnder(cand, path.win32.join(E.PROGRAMFILES, 'WindowsApps'))) return 'windowsapps';
      const segs = lp.split('\\');
      if (segs.length === 2 && rootSystem.has(segs[1])) return 'system-file';
      if (segs.length >= 2 && segs[1] === 'system volume information') return 'system-file';
      if (segs.length >= 2 && segs[1] === 'recovery') return 'system-file';
      for (const s of selfPaths) if (isUnder(s, cand) || isUnder(cand, s)) return 'self';
    }
    return null;
  }

  // Moving/relocating is stricter: nothing from Windows, Program Files or a profile root.
  function moveReason(input) {
    const r = deleteReason(input);
    if (r) return r;
    const p = canonical(input);
    if (isUnder(p, E.WINDIR)) return 'windows';
    if (isUnder(p, E.PROGRAMFILES) || isUnder(p, E.PROGRAMFILES86)) return 'program-files';
    if (isUnder(p, E.PROGRAMDATA) && low(path.win32.dirname(p)) === low(E.PROGRAMDATA)) return 'programdata-root-child';
    return null;
  }

  // Compression: never inside Windows (use CompactOS), never on files that are written in place.
  function compressReason(input) {
    let p;
    try { p = canonical(input); } catch (e) { return e.message; }
    if (/^[a-zA-Z]:\\?$/.test(p)) return 'drive-root';
    if (isUnder(p, E.WINDIR)) return 'windows';
    if (exactBlock.some((b) => low(b) === low(p))) return 'protected-folder';
    return null;
  }

  return { deleteReason, moveReason, compressReason, canonical, isUnder, env: E };
}

module.exports = { createGuard, canonical, isUnder, defaultEnv };
