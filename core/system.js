'use strict';
// System context (installed apps, services, processes, startup, PATH), deep inspection and drive listing.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { ps, psQuote } = require('./exec');

const low = (p) => path.resolve(p).toLowerCase().replace(/[\\/]+$/, '');
const isUnder = (p, base) => { try { const a = low(p), b = low(base); return a === b || a.startsWith(b + '\\'); } catch { return false; } };

function exeFromCommand(cmd) {
  if (!cmd) return null;
  cmd = String(cmd).trim();
  let m = cmd.match(/^"([^"]+)"/);
  if (m) return m[1];
  m = cmd.match(/^(.+?\.(exe|com|bat|cmd|dll))\b/i);
  return m ? m[1] : cmd.split(' ')[0];
}

let sysCache = null, sysCacheAt = 0, sysPending = null;
async function getSystemContext(force) {
  if (!force && sysCache && Date.now() - sysCacheAt < 120000) return sysCache;
  if (sysPending) return sysPending;
  sysPending = (async () => {
    const script = `
$apps = Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -and -not $_.SystemComponent -and -not $_.ParentKeyName -and $_.ReleaseType -notmatch 'Update|Hotfix' } |
  Select-Object DisplayName,DisplayVersion,Publisher,InstallLocation,EstimatedSize,UninstallString,InstallDate,DisplayIcon,PSChildName
$svc = Get-CimInstance Win32_Service -ErrorAction SilentlyContinue | Select-Object Name,DisplayName,PathName,State
$proc = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath } | Select-Object Name,ExecutablePath,ProcessId
$run = foreach ($k in 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run') {
  $p = Get-ItemProperty $k -ErrorAction SilentlyContinue
  if ($p) { $p.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } | ForEach-Object { [pscustomobject]@{ Name = $_.Name; Cmd = [string]$_.Value } } }
}
$path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
[pscustomobject]@{ apps = @($apps); services = @($svc); processes = @($proc); run = @($run); path = $path } | ConvertTo-Json -Depth 3 -Compress`;
    const r = await ps(script, 90000);
    let data = { apps: [], services: [], processes: [], run: [], path: '' };
    try { data = JSON.parse(r.stdout.trim()); } catch { /* keep empty */ }
    const ctx = {
      apps: (data.apps || []).map((a) => ({
        name: String(a.DisplayName), version: a.DisplayVersion ? String(a.DisplayVersion) : '', publisher: a.Publisher ? String(a.Publisher) : '',
        location: a.InstallLocation ? String(a.InstallLocation).replace(/^"|"$/g, '').replace(/[\\/]+$/, '') : '',
        estKB: Number(a.EstimatedSize) || 0, uninstall: a.UninstallString ? String(a.UninstallString) : '', date: a.InstallDate ? String(a.InstallDate) : '',
        icon: a.DisplayIcon ? String(a.DisplayIcon).replace(/^"|"$/g, '').replace(/,\s*-?\d+$/, '').replace(/^"|"$/g, '') : '',
        id: a.PSChildName ? String(a.PSChildName) : '',
      })),
      services: (data.services || []).map((s) => ({ name: s.Name, display: s.DisplayName, exe: exeFromCommand(s.PathName), state: s.State })),
      processes: (data.processes || []).map((p) => ({ name: p.Name, exe: p.ExecutablePath, pid: p.ProcessId })),
      run: (data.run || []).map((x) => ({ name: x.Name, exe: exeFromCommand(x.Cmd), cmd: x.Cmd })),
      path: String(data.path || '').split(';').map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/%([^%]+)%/g, (_, k) => process.env[k] || _)),
    };
    const seen = new Set();
    ctx.apps = ctx.apps.filter((a) => { const k = a.name + '|' + a.version; if (seen.has(k)) return false; seen.add(k); return true; });
    sysCache = ctx; sysCacheAt = Date.now(); sysPending = null;
    return ctx;
  })();
  return sysPending;
}

// Running processes whose executable lives under a folder
async function processesUnder(dir) {
  const ctx = await getSystemContext(true);
  return ctx.processes.filter((p) => p.exe && isUnder(p.exe, dir));
}

const PROJECT_MARKERS = [
  ['package.json', 'Node.js'], ['pubspec.yaml', 'Flutter / Dart'], ['composer.json', 'PHP / Composer'], ['Cargo.toml', 'Rust'],
  ['pyproject.toml', 'Python'], ['requirements.txt', 'Python'], ['manage.py', 'Django'], ['build.gradle', 'Android / Gradle'], ['build.gradle.kts', 'Android / Gradle'],
  ['pom.xml', 'Java / Maven'], ['go.mod', 'Go'], ['Gemfile', 'Ruby'], ['artisan', 'Laravel'], ['ProjectSettings', 'Unity'], ['.git', 'Git repository'],
];

async function findProject(p) {
  let cur = p;
  for (let i = 0; i < 10; i++) {
    let names = [];
    try { names = await fsp.readdir(cur); } catch { /* ignore */ }
    const lowerNames = new Set(names.map((n) => n.toLowerCase()));
    const types = [];
    for (const [m, t] of PROJECT_MARKERS) if (lowerNames.has(m.toLowerCase()) && !types.includes(t)) types.push(t);
    if (names.some((n) => /\.(sln|csproj)$/i.test(n))) types.push('.NET');
    if (types.length && cur !== p) {
      let name = path.basename(cur);
      try { const pk = JSON.parse(await fsp.readFile(path.join(cur, 'package.json'), 'utf8')); if (pk.name) name = String(pk.name); } catch { /* ignore */ }
      let lastTouched = 0;
      for (const n of names.slice(0, 200)) {
        if (['node_modules', 'build', '.dart_tool', 'vendor', 'target', '.git', '.gradle'].includes(n.toLowerCase())) continue;
        try { const s = await fsp.stat(path.join(cur, n)); lastTouched = Math.max(lastTouched, s.mtimeMs); } catch { /* ignore */ }
      }
      return { root: cur, name, types, lastTouched };
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

async function fileVersion(p) {
  const r = await ps(`$v=(Get-Item -LiteralPath ${psQuote(p)} -Force).VersionInfo; [pscustomobject]@{d=$v.FileDescription;c=$v.CompanyName;n=$v.ProductName;v=$v.FileVersion} | ConvertTo-Json -Compress`, 15000);
  try { const j = JSON.parse(r.stdout.trim()); return { description: j.d, company: j.c, product: j.n, version: j.v }; } catch { return null; }
}

async function inspect(p, guard) {
  const out = { path: p, exists: false };
  let st;
  try { st = await fsp.lstat(p); } catch (e) { out.error = e.code; return out; }
  out.exists = true;
  out.isDir = st.isDirectory();
  out.isLink = st.isSymbolicLink();
  if (out.isLink) out.linkTarget = await fsp.readlink(p).catch(() => null);
  out.size = st.size;
  out.mtime = st.mtimeMs; out.birthtime = st.birthtimeMs; out.atime = st.atimeMs;
  out.readonly = !(st.mode & 0o200);
  out.forbidden = guard.deleteReason(p);
  if (!out.isDir) {
    try { const fd = await fsp.open(p, 'r+'); await fd.close(); out.inUse = false; }
    catch (e) { out.inUse = e.code === 'EBUSY' ? true : null; }
    if (/\.(exe|dll|sys|msi|ocx|node)$/i.test(p)) out.version = await fileVersion(p);
  } else {
    try { const names = await fsp.readdir(p); out.childCount = names.length; out.children = names.slice(0, 12); } catch { out.childCount = null; }
  }
  out.project = await findProject(out.isDir ? p : path.dirname(p));
  const ctx = await getSystemContext();
  const isRel = (other) => !!other && (out.isDir ? isUnder(other, p) : low(other) === low(p));
  out.owners = {
    apps: ctx.apps.filter((a) => a.location && a.location.length > 3 && (isUnder(p, a.location) || isUnder(a.location, p))).map((a) => ({ name: a.name, publisher: a.publisher, location: a.location })),
    services: ctx.services.filter((s) => isRel(s.exe)).map((s) => ({ name: s.display || s.name, state: s.state, exe: s.exe })),
    processes: ctx.processes.filter((x) => isRel(x.exe)).map((x) => ({ name: x.name, pid: x.pid, exe: x.exe })),
    startup: ctx.run.filter((x) => isRel(x.exe)).map((x) => ({ name: x.name, exe: x.exe })),
    path: ctx.path.filter((x) => isUnder(x, p)),
  };
  return out;
}

async function checkMarkers(paths) {
  const out = {};
  const parentCache = new Map();
  for (const p of paths.slice(0, 3000)) {
    const parent = path.dirname(p);
    let names = parentCache.get(parent);
    if (!names) {
      try { names = (await fsp.readdir(parent)).filter((n) => /^(package\.json|pubspec\.yaml|composer\.json|cargo\.toml|pom\.xml|build\.gradle(\.kts)?|requirements\.txt|pyproject\.toml|setup\.py|pipfile|manage\.py|assets|projectsettings|.*\.(cs|vb|fs)proj)$/i.test(n)); }
      catch { names = []; }
      parentCache.set(parent, names);
    }
    const list = names.slice();
    if (fs.existsSync(path.join(p, 'pyvenv.cfg'))) list.push('>pyvenv.cfg');
    out[p] = list;
  }
  return out;
}

async function listDrives(systemDrive) {
  const r = await ps('Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,FileSystem,Size,FreeSpace,DriveType | ConvertTo-Json -Compress', 20000);
  let arr = [];
  try { arr = JSON.parse(r.stdout.trim()); if (!Array.isArray(arr)) arr = [arr]; } catch { /* fallback below */ }
  if (!arr.length) {
    for (const l of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      try { const s = fs.statfsSync(l + ':\\'); arr.push({ DeviceID: l + ':', Size: s.blocks * s.bsize, FreeSpace: s.bavail * s.bsize, DriveType: 3 }); } catch { /* none */ }
    }
  }
  return arr.filter((d) => d.Size > 0).map((d) => ({
    letter: String(d.DeviceID), label: d.VolumeName ? String(d.VolumeName) : '', fs: d.FileSystem ? String(d.FileSystem) : '', size: Number(d.Size), free: Number(d.FreeSpace),
    type: Number(d.DriveType), system: String(d.DeviceID).toUpperCase() === String(systemDrive).toUpperCase(),
  }));
}

module.exports = { getSystemContext, processesUnder, inspect, checkMarkers, listDrives, findProject, isUnder };
