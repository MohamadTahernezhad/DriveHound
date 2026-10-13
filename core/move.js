'use strict';
// Relocate folders to another drive without breaking anything.
// Pipeline: guard → rename source (proves nothing holds it open & freezes writes) → copy → verify
//           → junction at the old path (+ official env var for known tools) → delete old copy.
// Any failure rolls back to the original state. Every move is recorded and reversible.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { copyTree, removeTree, treeStats, driveOf, freeSpace, makeJunction } = require('./fsops');
const { ps, psQuote, run } = require('./exec');

const E = () => ({ U: process.env.USERPROFILE, L: process.env.LOCALAPPDATA, A: process.env.APPDATA });

// Known tools: default location + the env var the tool officially honours
function presets() {
  const { U, L } = E();
  return [
    { id: 'avd', name: 'Android emulators (AVD)', path: path.join(U, '.android', 'avd'), env: 'ANDROID_AVD_HOME', procs: ['emulator.exe', 'qemu-system-x86_64.exe', 'qemu-system-x86_64-headless.exe'] },
    { id: 'gradle', name: 'Gradle home', path: path.join(U, '.gradle'), env: 'GRADLE_USER_HOME', procs: ['java.exe', 'studio64.exe'] },
    { id: 'pub', name: 'Dart / Flutter pub cache', path: path.join(L, 'Pub', 'Cache'), env: 'PUB_CACHE', procs: ['dart.exe', 'flutter.exe'] },
    { id: 'npm', name: 'npm cache', path: path.join(L, 'npm-cache'), env: 'npm_config_cache', procs: ['node.exe'] },
    { id: 'nuget', name: 'NuGet packages', path: path.join(U, '.nuget', 'packages'), env: 'NUGET_PACKAGES', procs: ['dotnet.exe', 'devenv.exe'] },
    { id: 'pip', name: 'pip cache', path: path.join(L, 'pip', 'cache'), env: 'PIP_CACHE_DIR', procs: ['python.exe', 'pip.exe'] },
    { id: 'ollama', name: 'Ollama models', path: path.join(U, '.ollama', 'models'), env: 'OLLAMA_MODELS', procs: ['ollama.exe', 'ollama app.exe'] },
    { id: 'hf', name: 'HuggingFace cache', path: path.join(U, '.cache', 'huggingface'), env: 'HF_HOME', procs: ['python.exe'] },
    { id: 'gradle-sdk', name: 'Android SDK', path: path.join(L, 'Android', 'Sdk'), env: 'ANDROID_HOME', procs: ['adb.exe', 'emulator.exe', 'studio64.exe'], note: 'android-sdk' },
  ];
}

const isEnvName = (s) => /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(s);

async function getUserEnv(name) {
  if (!isEnvName(name)) throw new Error('invalid-env');
  const r = await ps(`[Environment]::GetEnvironmentVariable(${psQuote(name)}, 'User')`, 20000);
  return r.stdout.trim() || null;
}
async function setUserEnv(name, value) {
  if (!isEnvName(name)) throw new Error('invalid-env');
  const v = value == null ? '$null' : psQuote(value);
  const r = await ps(`[Environment]::SetEnvironmentVariable(${psQuote(name)}, ${v}, 'User')`, 30000);
  return r.code === 0;
}

function createMover(dataDir, guard) {
  const file = path.join(dataDir, 'moves.json');
  const read = async () => { try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return []; } };
  const write = async (list) => { await fsp.mkdir(dataDir, { recursive: true }); await fsp.writeFile(file, JSON.stringify(list, null, 1)); };

  async function status() {
    const list = await read();
    const out = [];
    const ps0 = presets();
    for (const p of ps0) {
      let size = 0, exists = false, linked = false, linkTarget = null;
      try {
        const st = await fsp.lstat(p.path);
        exists = true;
        linked = st.isSymbolicLink();
        if (linked) linkTarget = await fsp.readlink(p.path).catch(() => null);
      } catch { /* missing */ }
      const envVal = p.env ? await getUserEnv(p.env).catch(() => null) : null;
      out.push({ ...p, exists, linked, linkTarget, envVal, size });
    }
    return { presets: out, moves: list };
  }

  // targetBase e.g. "D:\DriveHound-Moved"
  async function move({ source, targetBase, envVar, presetId }, onProgress) {
    const src = guard.canonical(source);
    const reason = guard.moveReason(src);
    if (reason) throw Object.assign(new Error('forbidden:' + reason), { code: 'EFORBIDDEN' });
    const st = await fsp.lstat(src).catch(() => null);
    if (!st) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    if (st.isSymbolicLink()) throw Object.assign(new Error('already-linked'), { code: 'ELINKED' });
    if (!st.isDirectory()) throw Object.assign(new Error('not-a-folder'), { code: 'ENOTDIR' });

    const base = guard.canonical(targetBase);
    if (driveOf(base) === driveOf(src)) throw Object.assign(new Error('same-drive'), { code: 'ESAMEDRIVE' });
    if (guard.isUnder(base, src)) throw Object.assign(new Error('target-inside-source'), { code: 'EINSIDE' });
    if (envVar && !isEnvName(envVar)) throw new Error('invalid-env');
    const slug = src.slice(3).replace(/[\\:]+/g, '_').replace(/[^\w.\- ]+/g, '').slice(-120);
    const target = path.join(base, slug);
    if (fs.existsSync(target) && (await fsp.readdir(target)).length) throw Object.assign(new Error('target-not-empty'), { code: 'EEXIST' });

    const stats = await treeStats(src);
    if (freeSpace(driveOf(base)) < stats.size * 1.05 + 200 * 1048576) throw Object.assign(new Error('no-space-on-target'), { code: 'ENOSPC' });

    const tmp = src + '.di-moving-' + crypto.randomBytes(3).toString('hex');
    // 1) rename: fails immediately if any process has a file open inside
    try { await fsp.rename(src, tmp); } catch (e) { throw Object.assign(new Error('in-use'), { code: 'EBUSY', cause: e.code }); }
    let junctionMade = false;
    try {
      onProgress && onProgress({ phase: 'copy', bytes: 0, total: stats.size });
      await copyTree(tmp, target, (p) => onProgress && onProgress({ phase: 'copy', ...p, total: stats.size }));
      onProgress && onProgress({ phase: 'verify' });
      const v = await treeStats(target);
      if (v.size !== stats.size || v.files !== stats.files) throw Object.assign(new Error('verify-failed'), { code: 'EVERIFY' });
      await makeJunction(target, src);
      junctionMade = true;
      // the junction must resolve to the copied data
      const probe = await fsp.realpath(src);
      if (probe.toLowerCase() !== (await fsp.realpath(target)).toLowerCase()) throw Object.assign(new Error('junction-check-failed'), { code: 'EJUNCTION' });
    } catch (e) {
      // rollback
      if (junctionMade) await fsp.unlink(src).catch(() => fsp.rmdir(src).catch(() => {}));
      await removeTree(target);
      await fsp.rename(tmp, src).catch(() => {});
      throw e;
    }
    let prevEnv = null;
    if (envVar) { prevEnv = await getUserEnv(envVar).catch(() => null); await setUserEnv(envVar, target); }
    onProgress && onProgress({ phase: 'cleanup' });
    const del = await removeTree(tmp);
    const rec = { id: crypto.randomUUID(), date: Date.now(), source: src, target, envVar: envVar || null, prevEnv, presetId: presetId || null, size: stats.size, files: stats.files, leftover: del.failed ? tmp : null };
    const list = await read(); list.push(rec); await write(list);
    return rec;
  }

  async function restore(id, onProgress) {
    const list = await read();
    const rec = list.find((m) => m.id === id);
    if (!rec) throw new Error('not-found');
    const st = await fsp.lstat(rec.source).catch(() => null);
    if (!st || !st.isSymbolicLink()) throw Object.assign(new Error('source-not-a-junction'), { code: 'ENOTLINK' });
    const real = (await fsp.realpath(rec.source)).toLowerCase();
    if (real !== (await fsp.realpath(rec.target)).toLowerCase()) throw Object.assign(new Error('junction-points-elsewhere'), { code: 'EMISMATCH' });
    const stats = await treeStats(rec.target);
    if (freeSpace(driveOf(rec.source)) < stats.size * 1.05 + 200 * 1048576) throw Object.assign(new Error('no-space-on-source'), { code: 'ENOSPC' });
    const back = rec.source + '.di-restoring-' + crypto.randomBytes(3).toString('hex');
    await copyTree(rec.target, back, (p) => onProgress && onProgress({ phase: 'copy', ...p, total: stats.size }));
    const v = await treeStats(back);
    if (v.size !== stats.size || v.files !== stats.files) { await removeTree(back); throw Object.assign(new Error('verify-failed'), { code: 'EVERIFY' }); }
    await fsp.unlink(rec.source).catch(() => fsp.rmdir(rec.source));          // removes the junction only
    await fsp.rename(back, rec.source);
    if (rec.envVar) await setUserEnv(rec.envVar, rec.prevEnv);
    await removeTree(rec.target);
    await write(list.filter((m) => m.id !== id));
    return { ok: true, restored: rec.source };
  }

  return { status, move, restore, presets };
}

// Official WSL distro relocation (WSL 2.x)
async function wslMove(name, targetDir, guard) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.\-]{0,63}$/.test(name)) throw new Error('invalid-name');
  if (/^docker-desktop/.test(name)) throw new Error('use-docker-settings');
  const dir = guard.canonical(targetDir);
  await run('wsl.exe', ['--shutdown'], { timeout: 60000 });
  return run('wsl.exe', ['--manage', name, '--move', dir], { timeout: 3600000 });
}

module.exports = { createMover, presets, wslMove, getUserEnv, setUserEnv };
