'use strict';
// Docker & WSL management through their CLIs. IDs/names are validated before every call.

const fs = require('fs');
const path = require('path');
const { run, psJson } = require('./exec');
const { parseHumanSize, parseWslList, isDockerId, isDockerName, isWslName } = require('./parsers');

async function docker(args, timeout = 60000) { return run('docker', args, { timeout }); }

function jsonLines(txt) {
  return String(txt).split(/\r?\n/).filter((l) => l.trim().startsWith('{')).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

async function dockerInfo() {
  const v = await docker(['version', '--format', '{{json .}}'], 15000);
  if (v.code !== 0) {
    const installed = !/not recognized|ENOENT|cannot find/i.test(v.stderr + v.error);
    return { available: false, installed, running: false, error: (v.stderr || v.error || '').split('\n')[0] };
  }
  const [df, images, containers, volumes] = await Promise.all([
    docker(['system', 'df', '-v', '--format', '{{json .}}'], 120000),
    docker(['images', '-a', '--no-trunc', '--format', '{{json .}}']),
    docker(['ps', '-a', '--size', '--no-trunc', '--format', '{{json .}}'], 120000),
    docker(['volume', 'ls', '--format', '{{json .}}']),
  ]);
  let dfj = null;
  try { dfj = JSON.parse(df.stdout.trim().split(/\r?\n/)[0]); } catch { /* old docker: no json df */ }
  const volSizes = new Map();
  const imageShared = new Map();
  let buildCache = [];
  if (dfj) {
    for (const vv of dfj.Volumes || []) volSizes.set(vv.Name, parseHumanSize(vv.Size));
    for (const im of dfj.Images || []) imageShared.set(im.ID, { shared: parseHumanSize(im.SharedSize), unique: parseHumanSize(im.UniqueSize), containers: Number(im.Containers) || 0 });
    buildCache = (dfj.BuildCache || []).map((b) => ({ id: b.ID, type: b.CacheType, size: parseHumanSize(b.Size), inUse: b.InUse === 'true' || b.InUse === true, lastUsed: b.LastUsedAt, desc: b.Description }));
  }
  const containerList = jsonLines(containers.stdout).map((c) => {
    const m = String(c.Size || '').match(/^(.*?)\s*\(virtual\s+(.*?)\)/);
    return { id: c.ID, name: c.Names, image: c.Image, state: c.State, status: c.Status, created: c.CreatedAt, size: parseHumanSize(m ? m[1] : c.Size), virtual: parseHumanSize(m ? m[2] : 0) };
  });
  const usedImages = new Set(containerList.map((c) => c.image));
  const imageList = jsonLines(images.stdout).map((i) => {
    const sh = imageShared.get(i.ID) || imageShared.get(String(i.ID).replace(/^sha256:/, '').slice(0, 12)) || {};
    const ref = i.Repository === '<none>' ? null : i.Repository + ':' + i.Tag;
    return { id: i.ID, repo: i.Repository, tag: i.Tag, ref, created: i.CreatedAt, since: i.CreatedSince, size: parseHumanSize(i.Size), unique: sh.unique ?? null, containers: sh.containers ?? 0, dangling: i.Repository === '<none>', inUse: (sh.containers || 0) > 0 || (ref && usedImages.has(ref)) };
  });
  const volumeList = jsonLines(volumes.stdout).map((x) => ({ name: x.Name, driver: x.Driver, size: volSizes.get(x.Name) ?? null, links: null }));
  if (dfj) for (const vv of dfj.Volumes || []) { const t = volumeList.find((x) => x.name === vv.Name); if (t) t.links = Number(vv.Links) || 0; }
  return { available: true, running: true, version: (() => { try { return JSON.parse(v.stdout).Server.Version; } catch { return ''; } })(), images: imageList, containers: containerList, volumes: volumeList, buildCache };
}

async function dockerRemove(kind, ids) {
  const results = [];
  for (const id of ids) {
    let args;
    if (kind === 'image' && (isDockerId(id) || isDockerName(id))) args = ['rmi', id];
    else if (kind === 'container' && (isDockerId(id) || isDockerName(id))) args = ['rm', id];
    else if (kind === 'volume' && isDockerName(id)) args = ['volume', 'rm', id];
    else { results.push({ id, ok: false, error: 'invalid-id' }); continue; }
    const r = await docker(args, 120000);
    results.push({ id, ok: r.code === 0, error: r.code ? (r.stderr || r.error).split('\n')[0] : undefined });
  }
  return results;
}

async function dockerPrune(what) {
  const map = { build: ['builder', 'prune', '-f'], dangling: ['image', 'prune', '-f'], containers: ['container', 'prune', '-f'] };
  if (!map[what]) throw new Error('invalid-prune');
  const r = await docker(map[what], 600000);
  return { ok: r.code === 0, out: (r.stdout || r.stderr).slice(-500) };
}

// ───────── WSL ─────────
async function wslInfo() {
  const r = await run('wsl.exe', ['-l', '-v'], { encoding: 'buffer', timeout: 20000 });
  const raw = Buffer.isBuffer(r.stdout) ? r.stdout : Buffer.from(r.stdout || '');
  const txt = raw.includes(0) ? raw.toString('utf16le') : raw.toString('utf8');
  const distros = parseWslList(txt);
  const reg = await psJson(`Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss' -ErrorAction SilentlyContinue | ForEach-Object { $p = Get-ItemProperty $_.PSPath; [pscustomobject]@{ name=$p.DistributionName; base=$p.BasePath; vhd=$p.VhdFileName } } | ConvertTo-Json -Compress`, 20000);
  const regs = Array.isArray(reg.data) ? reg.data : reg.data ? [reg.data] : [];
  const local = process.env.LOCALAPPDATA || '';
  for (const d of distros) {
    const rg = regs.find((x) => x.name === d.name);
    let vhd = rg && rg.base ? path.join(String(rg.base).replace(/^\\\\\?\\/, ''), rg.vhd || 'ext4.vhdx') : '';
    if (d.name === 'docker-desktop' || d.name === 'docker-desktop-data') {
      const cand = [path.join(local, 'Docker', 'wsl', 'disk', 'docker_data.vhdx'), path.join(local, 'Docker', 'wsl', 'main', 'ext4.vhdx'), path.join(local, 'Docker', 'wsl', 'data', 'ext4.vhdx')];
      if (!vhd || !fs.existsSync(vhd)) vhd = cand.find((c) => fs.existsSync(c)) || vhd;
    }
    d.vhd = vhd;
    try { d.size = fs.statSync(vhd).size; } catch { d.size = 0; }
  }
  // docker_data.vhdx is not a distro of its own on recent Docker Desktop versions
  const dd = path.join(local, 'Docker', 'wsl', 'disk', 'docker_data.vhdx');
  if (fs.existsSync(dd) && !distros.some((d) => d.vhd && d.vhd.toLowerCase() === dd.toLowerCase())) {
    distros.push({ name: 'Docker data (docker_data.vhdx)', state: '—', version: 2, vhd: dd, size: fs.statSync(dd).size, dockerData: true });
  }
  return { available: r.code === 0 || distros.length > 0, distros };
}

async function wslShutdown() { return run('wsl.exe', ['--shutdown'], { timeout: 60000 }); }
async function wslTerminate(name) { if (!isWslName(name)) throw new Error('invalid-name'); return run('wsl.exe', ['--terminate', name], { timeout: 60000 }); }

module.exports = { dockerInfo, dockerRemove, dockerPrune, wslInfo, wslShutdown, wslTerminate };
