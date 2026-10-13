'use strict';
// System maintenance: old driver packages, restore points / shadow storage, CompactOS & folder compression.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { run, ps, psJson, runElevated, openTerminal, isAdmin } = require('./exec');
const { parsePnputil, parseInfVersion, isOemInf } = require('./parsers');
const { treeStats } = require('./fsops');

const WINDIR = process.env.WINDIR || 'C:\\Windows';

// ───────── drivers ─────────
async function listDrivers() {
  const [enumR, inUseR] = await Promise.all([
    run('pnputil.exe', ['/enum-drivers'], { timeout: 60000 }),
    psJson('Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.InfName } | Select-Object -ExpandProperty InfName -Unique | ConvertTo-Json -Compress', 60000),
  ]);
  const pkgs = parsePnputil(enumR.stdout);
  const inUse = new Set((Array.isArray(inUseR.data) ? inUseR.data : inUseR.data ? [inUseR.data] : []).map((s) => String(s).toLowerCase()));

  // map packages to FileRepository folders by original name + DriverVer
  const repo = path.join(WINDIR, 'System32', 'DriverStore', 'FileRepository');
  let folders = [];
  try { folders = await fsp.readdir(repo); } catch { /* ignore */ }
  const byOrig = new Map();
  for (const f of folders) {
    const m = f.match(/^(.+\.inf)_[a-z0-9]+_[0-9a-f]{16}$/i);
    if (!m) continue;
    const k = m[1].toLowerCase();
    if (!byOrig.has(k)) byOrig.set(k, []);
    byOrig.get(k).push(f);
  }
  const folderInfo = new Map();
  async function infoFor(folder, orig) {
    if (folderInfo.has(folder)) return folderInfo.get(folder);
    const dir = path.join(repo, folder);
    let ver = { version: '', date: 0 };
    try { ver = parseInfVersion(await fsp.readFile(path.join(dir, orig), 'latin1')); } catch { /* ignore */ }
    const st = await treeStats(dir);
    const info = { dir, size: st.size, ...ver };
    folderInfo.set(folder, info);
    return info;
  }

  for (const p of pkgs) {
    p.inUse = inUse.has(p.published);
    p.size = 0; p.dir = '';
    for (const f of byOrig.get(p.original) || []) {
      const info = await infoFor(f, p.original);
      if (info.version === p.version) { p.size = info.size; p.dir = info.dir; break; }
    }
  }
  // within each original name, everything but the newest version is "old"
  const groups = new Map();
  for (const p of pkgs) { if (!groups.has(p.original)) groups.set(p.original, []); groups.get(p.original).push(p); }
  for (const list of groups.values()) {
    list.sort((a, b) => b.date - a.date || cmpVer(b.version, a.version));
    list.forEach((p, i) => { p.versions = list.length; p.isOld = i > 0; p.removable = p.isOld && !p.inUse; });
  }
  return pkgs;
}
function cmpVer(a, b) {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
  return 0;
}

// pnputil refuses to delete a package that a present device is using (no /force) — Windows itself enforces safety.
async function deleteDrivers(published) {
  const list = published.filter(isOemInf);
  if (!list.length) return [];
  const results = [];
  if (await isAdmin()) {
    for (const inf of list) { const r = await run('pnputil.exe', ['/delete-driver', inf], { timeout: 120000 }); results.push({ inf, ok: r.code === 0, out: r.stdout.slice(-300) }); }
    return results;
  }
  // one UAC prompt for the whole batch: a script that deletes each and writes results
  const out = path.join(require('os').tmpdir(), 'dh-drivers-' + Date.now() + '.txt');
  const script = list.map((inf) => `pnputil.exe /delete-driver ${inf} > NUL 2>&1 && echo ${inf} OK>> "${out}" || echo ${inf} FAIL>> "${out}"`).join(' & ');
  const r = await runElevated('cmd.exe', ['/c', script], { timeout: 600000 });
  let txt = '';
  try { txt = await fsp.readFile(out, 'utf8'); await fsp.unlink(out); } catch { /* none */ }
  for (const inf of list) results.push({ inf, ok: new RegExp(inf.replace('.', '\\.') + ' OK', 'i').test(txt), elevated: r.code !== 1223 });
  return results;
}

// ───────── restore points & shadow storage ─────────
async function restoreInfo() {
  if (!(await isAdmin())) return { admin: false };
  const r = await psJson(`
$st = Get-CimInstance Win32_ShadowStorage -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ used=$_.UsedSpace; alloc=$_.AllocatedSpace; max=$_.MaxSpace; volume=[string]$_.Volume } }
$sc = Get-CimInstance Win32_ShadowCopy -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ id=$_.ID; created=[string]$_.InstallDate; volume=$_.VolumeName } }
$rp = Get-ComputerRestorePoint -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ seq=$_.SequenceNumber; desc=$_.Description; created=[string]$_.CreationTime } }
$vols = Get-CimInstance Win32_Volume -ErrorAction SilentlyContinue | Where-Object { $_.DriveLetter } | ForEach-Object { [pscustomobject]@{ letter=$_.DriveLetter; id=$_.DeviceID; cap=$_.Capacity } }
[pscustomobject]@{ storage=@($st); shadows=@($sc); points=@($rp); volumes=@($vols) } | ConvertTo-Json -Depth 4 -Compress`, 60000);
  const d = r.data || {};
  const vols = (d.volumes || []);
  const letterOf = (v) => { const m = String(v || '').match(/DeviceID="?([^"]+)"?/); const id = m ? m[1].replace(/\\\\/g, '\\') : ''; const f = vols.find((x) => x.id === id || String(v).includes(String(x.id).replace(/\\/g, '\\\\'))); return f ? f.letter : '?'; };
  return {
    admin: true,
    storage: (d.storage || []).map((s) => ({ used: +s.used, alloc: +s.alloc, max: +s.max, drive: letterOf(s.volume), cap: (vols.find((v) => v.letter === letterOf(s.volume)) || {}).cap || 0 })),
    shadows: (d.shadows || []).map((s) => ({ id: s.id, created: s.created, drive: (vols.find((v) => v.id === s.volume) || {}).letter || '?' })),
    points: (d.points || []).map((p) => ({ seq: p.seq, desc: p.desc, created: p.created })),
  };
}

async function deleteOldestShadow(drive) {
  if (!/^[A-Z]:$/i.test(drive)) throw new Error('invalid-drive');
  return runElevated('vssadmin.exe', ['delete', 'shadows', '/for=' + drive, '/oldest', '/quiet']);
}
async function resizeShadowStorage(drive, percent) {
  if (!/^[A-Z]:$/i.test(drive)) throw new Error('invalid-drive');
  const pct = Math.round(Number(percent));
  if (!(pct >= 1 && pct <= 50)) throw new Error('invalid-percent');
  return runElevated('vssadmin.exe', ['resize', 'shadowstorage', '/for=' + drive, '/on=' + drive, '/maxsize=' + pct + '%']);
}

// ───────── compression ─────────
async function compactOsState() {
  const r = await run('compact.exe', ['/CompactOS:query'], { timeout: 60000 });
  // output is localized; the only stable signal is whether the word for "not" appears is unreliable,
  // so we use the WMI-free registry value instead.
  const reg = await run('reg.exe', ['query', 'HKLM\\SYSTEM\\Setup', '/v', 'Compact']);
  const on = /Compact\s+REG_DWORD\s+0x1/i.test(reg.stdout);
  return { enabled: on, raw: r.stdout.trim().split(/\r?\n/).slice(-3).join(' ') };
}
function setCompactOs(enable, admin) {
  return openTerminal('compact.exe /CompactOS:' + (enable ? 'always' : 'never'), { elevated: true, admin });
}
// LZX-compress (or decompress) a folder in a visible console so progress is visible.
function compressFolder(dir, decompress, admin, needsAdmin) {
  if (/["&|<>^%]/.test(dir)) throw new Error('unsafe-path');
  const cmd = decompress ? `compact.exe /u /s:"${dir}" /a /i /q /exe:lzx` : `compact.exe /c /s:"${dir}" /a /i /q /exe:lzx`;
  return openTerminal(cmd + ' & echo. & echo Done. & pause', { elevated: needsAdmin, admin });
}

// Files that are written in place should never be compressed
async function compressionRisk(dir) {
  const risky = [];
  async function walk(d, depth) {
    if (depth > 6 || risky.length > 10) return;
    let ents = [];
    try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.isSymbolicLink()) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p, depth + 1);
      else if (/\.(vhdx?|vmdk|vdi|qcow2|avhdx|mdf|ldf|ibd|sqlite|db|pst|ost|edb)$/i.test(e.name)) risky.push(p);
    }
  }
  await walk(dir, 0);
  return risky;
}

module.exports = { listDrivers, deleteDrivers, restoreInfo, deleteOldestShadow, resizeShadowStorage, compactOsState, setCompactOs, compressFolder, compressionRisk };
