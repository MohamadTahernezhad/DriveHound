'use strict';
// More libuv threads = more parallel stat() calls while scanning (must be set before any fs use)
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '32';

const { app, BrowserWindow, ipcMain, shell, nativeTheme, clipboard, dialog, Tray, Menu, Notification, nativeImage, safeStorage, session, protocol, net } = require('electron');
const { pathToFileURL } = require('url');

// The UI is served from a private app:// origin (not file://): gives a real origin for CSP 'self'
// and lets the file:// protocol stay unprivileged (fuse grantFileProtocolExtraPrivileges = false).
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true } }]);
const APP_URL = 'app://bundle/renderer/index.html';
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const crypto = require('crypto');
const { Worker } = require('worker_threads');
const { spawn } = require('child_process');

const { createGuard, defaultEnv } = require('./core/guard');
const X = require('./core/exec');
const { V, check } = require('./core/validate');
const SYS = require('./core/system');
const { deletePaths } = require('./core/delete');
const { createQuarantine } = require('./core/quarantine');
const { createHistory } = require('./core/history');
const { createMover, wslMove } = require('./core/move');
const CONT = require('./core/containers');
const TOOLS = require('./core/system-tools');
const { linkDuplicates } = require('./core/dupes-ops');
const AI = require('./core/ai');
const { createAI } = AI;
const { createKeyStore } = require('./core/keystore');
const { createMonitor } = require('./core/monitor');
const SHELLMENU = require('./core/shellmenu');
const { buildHtml } = require('./core/report');
const Compare = require('./shared/compare');
const Knowledge = require('./shared/knowledge');

const ENV = defaultEnv();
const DEV = !app.isPackaged;
// dev-only: isolated profile for automated tests
if (DEV && process.env.DH_USERDATA) app.setPath('userData', process.env.DH_USERDATA);
else migrateProfile();
const dataDir = () => path.join(app.getPath('userData'), 'data');

let win = null, tray = null;

// small rotating error log (userData/data/logs/main.log) — never contains file contents or keys
function log(...a) {
  try {
    const dir = path.join(app.getPath('userData'), 'data', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'main.log');
    try { if (fs.statSync(f).size > 1024 * 1024) fs.renameSync(f, f + '.1'); } catch { /* new */ }
    fs.appendFileSync(f, new Date().toISOString() + ' ' + a.map((x) => (x instanceof Error ? x.stack : typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n');
  } catch { /* ignore */ }
}
process.on('uncaughtException', (e) => log('uncaught', e));
process.on('unhandledRejection', (e) => log('unhandled', e));
let isAdmin = false;
let scanJob = null;            // { worker, root, quiet }
let dupesWorker = null;
let quitting = false;
let pendingAnalyze = null;

// ───────────────────────── settings ─────────────────────────
const DEFAULT_SETTINGS = {
  lang: 'fa', theme: 'dark', delMode: 'trash', scanEngine: 'auto',
  quarantineDrive: null, quarantineDays: 7,
  monitor: { enabled: true, intervalMin: 30, thresholdGB: 5, lowFreePct: 10, weekly: true },
  closeToTray: true, startAtLogin: false,
  ai: { mask: true, children: true, consentedFor: null, providers: [], activeId: null },
  userRules: [], protectedPaths: [], hiddenPaths: [], filterPresets: {}, recentTargets: [], drive: null,
};
let settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

function sanitizeSettings(input) {
  const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  const src = input && typeof input === 'object' ? input : {};
  if (['fa', 'en'].includes(src.lang)) s.lang = src.lang;
  if (['dark', 'light'].includes(src.theme)) s.theme = src.theme;
  if (['trash', 'permanent', 'quarantine'].includes(src.delMode)) s.delMode = src.delMode;
  if (['auto', 'walk', 'mft'].includes(src.scanEngine)) s.scanEngine = src.scanEngine;
  if (typeof src.quarantineDrive === 'string' && /^[A-Z]:$/i.test(src.quarantineDrive)) s.quarantineDrive = src.quarantineDrive.toUpperCase();
  if (Number.isFinite(src.quarantineDays)) s.quarantineDays = Math.min(90, Math.max(1, Math.round(src.quarantineDays)));
  const m = src.monitor || {};
  s.monitor = {
    enabled: m.enabled !== false,
    intervalMin: Number.isFinite(m.intervalMin) ? Math.min(1440, Math.max(10, Math.round(m.intervalMin))) : 30,
    thresholdGB: Number.isFinite(m.thresholdGB) ? Math.min(500, Math.max(1, m.thresholdGB)) : 5,
    lowFreePct: Number.isFinite(m.lowFreePct) ? Math.min(50, Math.max(1, m.lowFreePct)) : 10,
    weekly: m.weekly !== false,
  };
  s.closeToTray = src.closeToTray !== false;
  s.startAtLogin = !!src.startAtLogin;
  const a = src.ai || {};
  const providers = [];
  for (const p of Array.isArray(a.providers) ? a.providers.slice(0, 20) : []) {
    try { const v = AI.validateProvider(p); if (!providers.some((x) => x.id === v.id)) providers.push(v); } catch { /* drop invalid */ }
  }
  const activeId = providers.some((p) => p.id === a.activeId) ? a.activeId : (providers[0] ? providers[0].id : null);
  s.ai = { mask: a.mask !== false, children: a.children !== false, consentedFor: typeof a.consentedFor === 'string' && providers.some((p) => p.id === a.consentedFor) ? a.consentedFor : null, providers, activeId };
  s.userRules = (Array.isArray(src.userRules) ? src.userRules : []).slice(0, 300).map(Knowledge.validateUserRule).filter(Boolean);
  const pathList = (l) => (Array.isArray(l) ? l : []).filter((p) => typeof p === 'string' && /^[a-zA-Z]:\\/.test(p) && p.length < 1000).slice(0, 500);
  s.protectedPaths = pathList(src.protectedPaths);
  s.hiddenPaths = pathList(src.hiddenPaths);
  if (src.filterPresets && typeof src.filterPresets === 'object' && JSON.stringify(src.filterPresets).length < 200000) s.filterPresets = src.filterPresets;
  s.recentTargets = pathList(src.recentTargets).slice(0, 10);
  if (typeof src.drive === 'string' && /^[a-zA-Z]:(\\.*)?$/.test(src.drive) && src.drive.length < 1000) s.drive = src.drive;
  return s;
}
async function loadSettings() {
  try { settings = sanitizeSettings(JSON.parse(await fsp.readFile(path.join(dataDir(), 'settings.json'), 'utf8'))); } catch { settings = sanitizeSettings({}); }
}
async function saveSettings() {
  await fsp.mkdir(dataDir(), { recursive: true });
  await fsp.writeFile(path.join(dataDir(), 'settings.json'), JSON.stringify(settings, null, 1));
}

// ───────────────────────── core services ─────────────────────────
let guard, quarantine, history, mover, ai, keyStore, monitor;
function buildGuard() {
  const base = createGuard(ENV, { selfPaths: [app.getAppPath(), DEV ? null : process.resourcesPath, app.getPath('userData')] });
  // user-protected paths are refused on top of the built-in rules
  const userProt = () => settings.protectedPaths || [];
  const wrap = (fn) => (p) => {
    const r = fn(p);
    if (r) return r;
    try { const c = base.canonical(p); if (userProt().some((u) => base.isUnder(c, u) || base.isUnder(u, c))) return 'user-protected'; } catch (e) { return e.message; }
    return null;
  };
  guard = { ...base, deleteReason: wrap(base.deleteReason), moveReason: wrap(base.moveReason), compressReason: wrap(base.compressReason) };
}

// Every operation that changes the disk is logged here, so this is also where the UI learns its data may be stale.
async function recordHistory(entry) { try { await history.add(entry); } catch (e) { console.error('history', e); } send('ops:changed', entry.op); }

// ───────────────────────── scanning ─────────────────────────
const targetKey = (root) => {
  const r = root.replace(/[\\/]+$/, '');
  if (/^[a-zA-Z]:$/.test(r)) return r[0].toUpperCase();
  return 'F-' + crypto.createHash('sha1').update(r.toLowerCase()).digest('hex').slice(0, 16);
};
const scanDir = (root) => path.join(dataDir(), 'scans', targetKey(root));

async function writeJSON(file, data) { await fsp.mkdir(path.dirname(file), { recursive: true }); await fsp.writeFile(file, JSON.stringify(data)); }
async function readJSON(file, fb) { try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return fb; } }

async function saveScan(result) {
  const dir = scanDir(result.root);
  await writeJSON(path.join(dir, 'last.json'), result);
  const snap = {
    ts: result.finishedAt, root: result.root, stats: result.stats, engine: result.engine,
    folders: result.folders.filter((f) => f.s >= 50 * 1024 * 1024).map((f) => [f.p, f.s]),
    files: result.topFiles.slice(0, 400).map((f) => [f.p, f.s]),
  };
  await writeJSON(path.join(dir, 'snapshots', snap.ts + '.json'), snap);
  const files = (await fsp.readdir(path.join(dir, 'snapshots'))).filter((f) => f.endsWith('.json')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - 20))) await fsp.unlink(path.join(dir, 'snapshots', f)).catch(() => {});
}

function helperPath() {
  return DEV ? path.join(__dirname, 'native', 'mftscan.exe') : path.join(process.resourcesPath, 'native', 'mftscan.exe');
}

// Run the MFT reader (elevated if needed). Resolves { ok, file, ms } or { ok:false, error }
async function runMft(letter, onProgress) {
  const exe = helperPath();
  if (!fs.existsSync(exe)) return { ok: false, error: 'no-helper' };
  const dir = path.join(app.getPath('temp'), 'drivehound');
  await fsp.mkdir(dir, { recursive: true });
  const out = path.join(dir, 'mft-' + letter + '-' + crypto.randomBytes(6).toString('hex') + '.bin');
  const t0 = Date.now();
  let code;
  if (isAdmin) {
    code = await new Promise((resolve) => {
      const c = spawn(exe, [letter, out], { windowsHide: true });
      c.stderr.on('data', (d) => { for (const l of String(d).split(/\r?\n/)) { const m = l.match(/^P (\d+) (\d+)/); if (m) onProgress(+m[1], +m[2]); } });
      c.on('error', () => resolve(2));
      c.on('exit', (cd) => resolve(cd));
    });
  } else {
    const poll = setInterval(async () => {
      try { const [a, b] = (await fsp.readFile(out + '.progress', 'utf8')).split(' ').map(Number); onProgress(a, b); } catch { /* not yet */ }
    }, 300);
    const r = await X.runElevated(exe, [letter, out], { timeout: 900000 });
    clearInterval(poll);
    code = r.code;
  }
  await fsp.unlink(out + '.progress').catch(() => {});
  if (code === 0 && fs.existsSync(out)) return { ok: true, file: out, ms: Date.now() - t0 };
  await fsp.unlink(out).catch(() => {});
  return { ok: false, error: code === 1223 ? 'uac-declined' : code === 5 ? 'access-denied' : code === 3 ? 'not-ntfs' : 'mft-failed-' + code };
}

async function pickEngine(root, requested) {
  const isDrive = /^[a-zA-Z]:\\?$/.test(root);
  if (!isDrive) return 'walk';
  const want = requested || settings.scanEngine;
  const drives = await SYS.listDrives(ENV.SYSTEMDRIVE);
  const d = drives.find((x) => x.letter.toUpperCase() === root.slice(0, 2).toUpperCase());
  if (!d || d.fs !== 'NTFS') return 'walk';
  if (want === 'mft') return 'mft';
  if (want === 'auto' && isAdmin) return 'mft';
  return 'walk';
}

// Returns a promise with the result; UI events only when !quiet
function scan(root, { engine, quiet = false } = {}) {
  return new Promise(async (resolve, reject) => {
    if (scanJob) { scanJob.worker && scanJob.worker.postMessage('cancel'); scanJob.cancelled = true; }
    const job = { root, quiet, worker: null, cancelled: false };
    scanJob = job;
    const send = (ch, data) => { if (!quiet && scanJob === job) win?.webContents.send(ch, data); };
    const eng = await pickEngine(root, engine);
    let workerData = { root, concurrency: quiet ? 8 : 48 };
    if (eng === 'mft') {
      send('scan:progress', { phase: 'mft', files: 0, dirs: 0, bytes: 0, elapsed: 0, current: '' });
      const t0 = Date.now();
      const r = await runMft(root[0].toUpperCase(), (a, b) => send('scan:progress', { phase: 'mft', mftDone: a, mftTotal: b, files: a, dirs: 0, bytes: 0, elapsed: Date.now() - t0, current: '' }));
      if (job.cancelled) { if (r.file) fsp.unlink(r.file).catch(() => {}); return; }
      if (r.ok) workerData = { root, mftFile: r.file, helperMs: r.ms };
      else send('scan:notice', { kind: 'mft-fallback', error: r.error });
    }
    const w = new Worker(path.join(__dirname, 'scanner', 'worker.js'), { workerData });
    job.worker = w;
    w.on('message', async (m) => {
      if (scanJob !== job && m.type !== 'cancelled') return;
      if (m.type === 'progress') send('scan:progress', m.stats);
      else if (m.type === 'done') {
        // notify the UI *before* clearing the job: send() only delivers for the current job
        if (workerData.mftFile) fsp.unlink(workerData.mftFile).catch(() => {});
        try { await saveScan(m.result); } catch (e) { log('save failed', e); }
        send('scan:done', m.result);
        if (scanJob === job) scanJob = null;
        if (quiet) win?.webContents.send('scan:background', { root });
        w.terminate();
        resolve(m.result);
      } else if (m.type === 'cancelled') { send('scan:cancelled'); w.terminate(); resolve(null); }
      else if (m.type === 'error') { log('scan error', m.message); send('scan:error', m.message); if (scanJob === job) scanJob = null; w.terminate(); reject(new Error(m.message)); }
    });
    w.on('error', (e) => { log('scan worker error', e); if (scanJob === job) { send('scan:error', String(e)); scanJob = null; } reject(e); });
  });
}

// Background investigation for the monitor: scan quietly, compare with the previous snapshot
async function investigate(letter) {
  if (scanJob) return null;                       // never interrupt the user's own scan
  const root = letter + '\\';
  const dir = path.join(scanDir(root), 'snapshots');
  const before = (await fsp.readdir(dir).catch(() => [])).filter((f) => f.endsWith('.json')).sort();
  const prev = before.length ? await readJSON(path.join(dir, before[before.length - 1]), null) : null;
  const result = await scan(root, { quiet: true });
  if (!result || !prev) return null;
  const chosen = Compare.compare(result.folders.filter((f) => f.s >= 50 * 1048576).map((f) => [f.p, f.s]), prev.folders, 300 * 1048576);
  Knowledge.init(ENV);
  return chosen.filter((c) => c.own > 0).slice(0, 3).map((c) => {
    const k = Knowledge.classify(c.p, true);
    return { path: c.p, own: c.own, title: k.t[settings.lang] || k.t.en };
  });
}

// ───────────────────────── built-in actions ─────────────────────────
async function cleanTemp() {
  const targets = [ENV.TEMP, path.join(ENV.LOCALAPPDATA, 'Temp')];
  if (isAdmin) targets.push(path.join(ENV.WINDIR, 'Temp'));
  const { removeContents } = require('./core/fsops');
  const acc = { freed: 0, files: 0, failed: 0 };
  const done = new Set();
  for (const t of targets) { const k = t.toLowerCase(); if (done.has(k)) continue; done.add(k); await removeContents(t, acc); }
  return { code: 0, freed: acc.freed, files: acc.files, failed: acc.failed };
}

async function compactVhdx(file) {
  if (!file || !/\.(vhdx|vhd)$/i.test(file) || /["&|<>^%]/.test(file) || !fs.existsSync(file)) return { code: 1, error: 'invalid-vhdx' };
  const script = path.join(app.getPath('temp'), 'drivehound-compact-' + crypto.randomBytes(4).toString('hex') + '.txt');
  await fsp.writeFile(script, `select vdisk file="${file}"\r\nattach vdisk readonly\r\ncompact vdisk\r\ndetach vdisk\r\nexit\r\n`);
  return X.openTerminal(`wsl --shutdown & diskpart /s "${script}" & echo. & echo Done. & pause`, { elevated: true, admin: isAdmin });
}

const term = (cmd, elevated) => X.openTerminal(cmd, { elevated, admin: isAdmin });
const ACTIONS = {
  emptyRecycleBin: async () => { const r = await X.ps('Clear-RecycleBin -Force -ErrorAction SilentlyContinue', 120000); return { code: 0, error: r.error }; },
  cleanTemp,
  diskCleanup: () => X.launch('cleanmgr.exe', ['/d', ENV.SYSTEMDRIVE]),
  storageSense: () => shell.openExternal('ms-settings:storagesense').then(() => ({ code: 0 })),
  dismCleanup: () => term('Dism.exe /Online /Cleanup-Image /AnalyzeComponentStore && Dism.exe /Online /Cleanup-Image /StartComponentCleanup', true),
  hibernateOff: () => X.runElevated('powercfg.exe', ['-h', 'off']),
  hibernateReduced: () => X.runElevated('powercfg.exe', ['/h', '/type', 'reduced']),
  openVirtualMemory: () => X.launch(path.join(ENV.WINDIR, 'System32', 'SystemPropertiesPerformance.exe')),
  systemProtection: () => X.launch(path.join(ENV.WINDIR, 'System32', 'SystemPropertiesProtection.exe')),
  openApps: () => shell.openExternal('ms-settings:appsfeatures').then(() => ({ code: 0 })),
  openIndexing: () => X.launch('control.exe', ['srchadmin.dll']),
  dockerPrune: () => term('docker system df && echo. && docker system prune -a && echo. && docker system df'),
  compactVhdx: (arg) => compactVhdx(arg),
  npmCacheClean: () => term('npm cache clean --force && npm cache verify'),
  pipPurge: () => term('pip cache purge'),
  nugetClean: () => term('dotnet nuget locals all --clear'),
  condaClean: () => term('conda clean --all -y'),
  pubCacheClean: () => term('dart pub cache clean'),
  goClean: () => term('go clean -modcache -cache'),
};

// ───────────────────────── IPC plumbing ─────────────────────────
function rendererUrlOk(event) {
  try {
    const url = event.senderFrame && event.senderFrame.url;
    if (!url) return false;
    const u = new URL(url);
    return u.protocol === 'app:' && u.host === 'bundle' && u.pathname === '/renderer/index.html';
  } catch { return false; }
}
function handle(channel, validators, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!rendererUrlOk(event)) { log('rejected IPC sender', channel, event.senderFrame && event.senderFrame.url); throw new Error('forbidden-sender'); }
    const clean = check(args, validators);
    return fn(...clean);
  });
}
const send = (ch, data) => win && !win.isDestroyed() && win.webContents.send(ch, data);

function registerIpc() {
  handle('env:get', [], async () => ({ env: ENV, isAdmin, version: app.getVersion(), locale: app.getLocale(), dev: DEV, hasHelper: fs.existsSync(helperPath()) }));
  handle('drives:list', [], () => SYS.listDrives(ENV.SYSTEMDRIVE));

  // scanning
  handle('scan:start', [V.path(), V.optStr(8)], async (target, engine) => {
    if (engine && !['auto', 'walk', 'mft'].includes(engine)) throw new Error('invalid-engine');
    const root = /^[a-zA-Z]:\\?$/.test(target) ? target.slice(0, 2) + '\\' : guard.canonical(target);
    if (!fs.existsSync(root)) throw new Error('missing');
    log('scan:start', root, engine || settings.scanEngine);
    scan(root, { engine }).catch((e) => log('scan failed', e));
    return true;
  });
  handle('scan:cancel', [], () => { if (scanJob) { scanJob.cancelled = true; scanJob.worker && scanJob.worker.postMessage('cancel'); } scanJob = null; return true; });
  handle('scan:last', [V.path()], (root) => readJSON(path.join(scanDir(root), 'last.json'), null));
  handle('scan:pickFolder', [], async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('snapshots:list', [V.path()], async (root) => {
    const files = (await fsp.readdir(path.join(scanDir(root), 'snapshots')).catch(() => [])).filter((f) => /^\d+\.json$/.test(f)).sort().reverse();
    return files.map((f) => Number(f.replace('.json', '')));
  });
  handle('snapshots:get', [V.path(), V.num(0, 1e14)], (root, ts) => readJSON(path.join(scanDir(root), 'snapshots', Math.floor(ts) + '.json'), null));

  // knowledge helpers
  handle('markers:check', [V.arr(V.path(), 5000)], (paths) => SYS.checkMarkers(paths));
  handle('inspect', [V.path()], (p) => SYS.inspect(p, guard));
  handle('sys:context', [V.bool()], (force) => SYS.getSystemContext(force));

  // files
  handle('fs:delete', [V.arr(V.obj({ path: V.path(), size: V.optNum(0, 1e16), contents: V.bool() }), 5000), V.oneOf('trash', 'permanent', 'quarantine')], async (items, mode) => {
    if (mode === 'quarantine' && !settings.quarantineDrive) throw new Error('no-quarantine-drive');
    const res = await deletePaths(items, mode, {
      guard, trashItem: (p) => shell.trashItem(p), quarantine, quarantineDrive: settings.quarantineDrive, quarantineDays: settings.quarantineDays,
      onProgress: (p) => send('delete:progress', p),
    });
    const ok = res.filter((r) => r.ok);
    await recordHistory({ op: 'delete', mode, count: items.length, okCount: ok.length, bytes: ok.reduce((a, b) => a + (b.freed || 0), 0), items: res.slice(0, 200).map((r) => ({ path: r.path, ok: r.ok, freed: r.freed || 0, error: r.error })) });
    return res;
  });
  handle('fs:forbidden', [V.path()], (p) => guard.deleteReason(p));
  // lstat only (no reads): an unreadable path still counts as existing
  handle('fs:exists', [V.arr(V.path(), 5000)], (paths) => Promise.all(paths.map((p) => fsp.lstat(p).then(() => true, (e) => e.code !== 'ENOENT' && e.code !== 'ENOTDIR'))));
  handle('shell:reveal', [V.path()], (p) => { shell.showItemInFolder(p); return true; });
  // opens folders only — never launches files
  handle('shell:open', [V.path()], async (p) => {
    const st = await fsp.stat(p).catch(() => null);
    if (st && st.isDirectory()) return shell.openPath(p);
    shell.showItemInFolder(p); return '';
  });
  handle('clipboard:write', [V.str(40000)], (t) => { clipboard.writeText(t); return true; });

  handle('action:run', [V.match(/^[a-zA-Z]{3,40}$/), V.optPath()], async (id, arg) => {
    const fn = ACTIONS[id];
    if (!fn) throw new Error('unknown-action');
    const r = await fn(arg);
    await recordHistory({ op: 'action', action: id, arg: arg || null, code: r && r.code, bytes: (r && r.freed) || 0 });
    return r;
  });

  // apps
  handle('app:icon', [V.path()], async (p) => {
    if (!/\.(exe|ico|dll)$/i.test(p) || !fs.existsSync(p)) return null;
    try { return (await app.getFileIcon(p, { size: 'normal' })).toDataURL(); } catch { return null; }
  });
  // the uninstall command is looked up in main from the registry — never taken from the renderer
  handle('app:uninstall', [V.str(400)], async (appId) => {
    const ctx = await SYS.getSystemContext();
    const a = ctx.apps.find((x) => x.id === appId);
    if (!a || !a.uninstall) throw new Error('not-found');
    let cmd = a.uninstall.trim();
    if (!cmd.startsWith('"')) { const m = cmd.match(/^(.+?\.exe)(.*)$/i); if (m && m[1].includes(' ')) cmd = '"' + m[1] + '"' + m[2]; }
    const c = spawn('cmd.exe', ['/c', 'start', '""', cmd], { detached: true, windowsVerbatimArguments: true, stdio: 'ignore' });
    c.unref();
    await recordHistory({ op: 'uninstall', app: a.name, version: a.version });
    return { code: 0 };
  });
  handle('app:relaunchAdmin', [], async () => {
    const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
    const args = DEV ? [app.getAppPath()] : [];
    const argList = args.length ? ' -ArgumentList ' + args.map((a) => X.psQuote('"' + a + '"')).join(',') : '';
    // The elevated copy starts while this one is still running: free the single-instance lock first,
    // otherwise it finds us, hands over and exits, and then we quit too — leaving no window at all.
    app.releaseSingleInstanceLock();
    const r = await X.ps(`try { Start-Process ${X.psQuote(exe)}${argList} -Verb RunAs; exit 0 } catch { exit 1223 }`, 30000);
    if (r.code === 0) { quitting = true; setTimeout(() => app.quit(), 300); }
    else app.requestSingleInstanceLock();      // UAC cancelled: stay the single instance
    return r.code === 0;
  });

  // settings
  handle('settings:get', [], () => settings);
  handle('settings:set', [V.json(400000)], async (s) => {
    const before = settings;
    settings = sanitizeSettings(s);
    await saveSettings();
    if (before.startAtLogin !== settings.startAtLogin) applyLoginItem();
    if (JSON.stringify(before.monitor) !== JSON.stringify(settings.monitor)) monitor.start();
    if (before.lang !== settings.lang) buildTray();
    return settings;
  });
  handle('window:overlay', [V.match(/^#[0-9a-fA-F]{6,8}$/), V.match(/^#[0-9a-fA-F]{6,8}$/)], (c, s) => { try { win.setTitleBarOverlay({ color: c, symbolColor: s }); } catch { /* ignore */ } return true; });
  handle('export:save', [V.str(200), V.str(50 * 1024 * 1024)], async (name, content) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: name.replace(/[\\/:*?"<>|]/g, '_'), filters: [{ name: 'CSV', extensions: ['csv'] }, { name: 'JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return false;
    await fsp.writeFile(r.filePath, '﻿' + content, 'utf8');
    return r.filePath;
  });
  handle('report:export', [V.json(5e6), V.oneOf('html', 'pdf')], exportReport);

  // quarantine & history
  handle('quarantine:list', [], () => quarantine.list());
  handle('quarantine:restore', [V.match(/^[\w-]{10,80}$/), V.optPath()], async (id, stored) => { const r = await quarantine.restore(id, stored); await recordHistory({ op: 'restore', id, items: r }); return r; });
  handle('quarantine:purge', [V.match(/^[\w-]{10,80}$/)], async (id) => { const r = await quarantine.purgeBatch(id); await recordHistory({ op: 'purge', id }); return r; });
  handle('history:list', [], () => history.list());

  // duplicates
  handle('dupes:start', [V.obj({ roots: V.arr(V.path(), 20), minSize: V.num(1, 1e13), exclude: V.arr(V.str(200), 50) })], (o) => {
    o.roots = o.roots.filter((r) => fs.existsSync(r));
    if (!o.roots.length) throw new Error('missing');
    if (dupesWorker) dupesWorker.postMessage('cancel');
    const w = new Worker(path.join(__dirname, 'scanner', 'dupes.js'), { workerData: o });
    dupesWorker = w;
    w.on('message', (m) => {
      if (dupesWorker !== w) return;
      if (m.type === 'progress') send('dupes:progress', m.stats);
      else if (m.type === 'done') { dupesWorker = null; send('dupes:done', m.result); w.terminate(); }
      else if (m.type === 'cancelled') { send('dupes:cancelled'); w.terminate(); }
      else if (m.type === 'error') { dupesWorker = null; send('dupes:error', m.message); w.terminate(); }
    });
    return true;
  });
  handle('dupes:cancel', [], () => { if (dupesWorker) dupesWorker.postMessage('cancel'); dupesWorker = null; return true; });
  handle('dupes:link', [V.path(), V.arr(V.path(), 1000)], async (keeper, dupes) => {
    const r = await linkDuplicates(keeper, dupes, guard);
    await recordHistory({ op: 'hardlink', keeper, items: r, bytes: r.reduce((a, b) => a + (b.freed || 0), 0) });
    return r;
  });

  // docker & wsl
  handle('docker:info', [], () => CONT.dockerInfo());
  handle('docker:remove', [V.oneOf('image', 'container', 'volume'), V.arr(V.str(300), 500)], async (kind, ids) => { const r = await CONT.dockerRemove(kind, ids); await recordHistory({ op: 'docker-remove', kind, items: r }); return r; });
  handle('docker:prune', [V.oneOf('build', 'dangling', 'containers')], async (what) => { const r = await CONT.dockerPrune(what); await recordHistory({ op: 'docker-prune', what, ok: r.ok }); return r; });
  handle('wsl:info', [], () => CONT.wslInfo());
  handle('wsl:shutdown', [], () => CONT.wslShutdown());
  handle('wsl:terminate', [V.str(64)], (n) => CONT.wslTerminate(n));
  handle('wsl:move', [V.str(64), V.path()], async (n, dir) => { const r = await wslMove(n, dir, guard); await recordHistory({ op: 'wsl-move', name: n, dir, code: r.code }); return r; });

  // system tools
  handle('drivers:list', [], () => TOOLS.listDrivers());
  handle('drivers:delete', [V.arr(V.match(/^oem\d{1,5}\.inf$/i), 300)], async (infs) => { const r = await TOOLS.deleteDrivers(infs); await recordHistory({ op: 'driver-delete', items: r }); return r; });
  handle('restore:info', [], () => TOOLS.restoreInfo());
  handle('restore:deleteOldest', [V.match(/^[A-Z]:$/i)], async (d) => { const r = await TOOLS.deleteOldestShadow(d.toUpperCase()); await recordHistory({ op: 'shadow-delete', drive: d, code: r.code }); return r; });
  handle('restore:resize', [V.match(/^[A-Z]:$/i), V.num(1, 50)], async (d, pct) => { const r = await TOOLS.resizeShadowStorage(d.toUpperCase(), pct); await recordHistory({ op: 'shadow-resize', drive: d, pct, code: r.code }); return r; });
  handle('compact:state', [], () => TOOLS.compactOsState());
  handle('compact:setOs', [V.bool()], async (en) => { const r = await TOOLS.setCompactOs(en, isAdmin); await recordHistory({ op: 'compactos', enable: en }); return r; });
  handle('compact:risk', [V.path()], (p) => TOOLS.compressionRisk(p));
  handle('compact:folder', [V.path(), V.bool()], async (p, decompress) => {
    const reason = guard.compressReason(p);
    if (reason) throw new Error('forbidden:' + reason);
    const needsAdmin = guard.isUnder(p, ENV.PROGRAMFILES) || guard.isUnder(p, ENV.PROGRAMFILES86) || guard.isUnder(p, ENV.PROGRAMDATA);
    const r = await TOOLS.compressFolder(guard.canonical(p), decompress, isAdmin, needsAdmin);
    await recordHistory({ op: decompress ? 'decompress' : 'compress', path: p });
    return r;
  });

  // move to another drive
  handle('move:status', [], () => mover.status());
  handle('move:pickTarget', [], async () => { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
  handle('move:procs', [V.path()], (p) => SYS.processesUnder(p));
  handle('move:run', [V.obj({ source: V.path(), targetBase: V.path(), envVar: V.optStr(64), presetId: V.optStr(32) })], async (o) => {
    const rec = await mover.move(o, (p) => send('op:progress', { op: 'move', ...p }));
    await recordHistory({ op: 'move', source: rec.source, target: rec.target, bytes: rec.size, envVar: rec.envVar });
    return rec;
  });
  handle('move:restore', [V.match(/^[0-9a-f-]{36}$/)], async (id) => {
    const r = await mover.restore(id, (p) => send('op:progress', { op: 'move', ...p }));
    await recordHistory({ op: 'move-restore', id, restored: r.restored });
    return r;
  });

  // AI
  const aiStatus = () => ({
    providers: settings.ai.providers.map((p) => ({ ...p, hasKey: keyStore.has(p.id), needsKey: AI.needsKey(p) })),
    activeId: settings.ai.activeId, encryption: keyStore.available(),
  });
  const activeProvider = () => settings.ai.providers.find((p) => p.id === settings.ai.activeId) || null;
  handle('ai:status', [], aiStatus);
  handle('ai:saveProvider', [V.obj({ id: V.optStr(40), name: V.str(60), type: V.oneOf(...AI.TYPES), baseUrl: V.optStr(300), model: V.str(120), key: V.optStr(400) })], async (o) => {
    let id = o.id;
    if (!id) {
      const slug = o.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || o.type;
      id = slug; let n = 2;
      while (settings.ai.providers.some((p) => p.id === id)) id = slug + '-' + n++;
    } else if (!settings.ai.providers.some((p) => p.id === id)) throw new Error('not-found');
    const prov = AI.validateProvider({ id, name: o.name, type: o.type, baseUrl: o.baseUrl, model: o.model });
    if (o.key) keyStore.set(id, AI.validateKey(prov.type, o.key));
    else if (AI.needsKey(prov) && !keyStore.has(id)) throw new Error('key-required');
    const list = settings.ai.providers.filter((p) => p.id !== id);
    const idx = settings.ai.providers.findIndex((p) => p.id === id);
    list.splice(idx >= 0 ? idx : list.length, 0, prov);
    settings.ai.providers = list;
    if (!settings.ai.activeId) settings.ai.activeId = id;
    if (settings.ai.consentedFor === id) settings.ai.consentedFor = null;     // endpoint may have changed → ask again
    await saveSettings();
    return { ...aiStatus(), savedId: id };
  });
  handle('ai:deleteProvider', [V.match(/^[a-z0-9][a-z0-9-]{0,39}$/)], async (id) => {
    settings.ai.providers = settings.ai.providers.filter((p) => p.id !== id);
    keyStore.clear(id);
    if (settings.ai.activeId === id) settings.ai.activeId = settings.ai.providers[0] ? settings.ai.providers[0].id : null;
    if (settings.ai.consentedFor === id) settings.ai.consentedFor = null;
    await saveSettings();
    return aiStatus();
  });
  handle('ai:setActive', [V.match(/^[a-z0-9][a-z0-9-]{0,39}$/)], async (id) => {
    if (!settings.ai.providers.some((p) => p.id === id)) throw new Error('not-found');
    settings.ai.activeId = id;
    await saveSettings();
    return aiStatus();
  });
  handle('ai:consent', [V.match(/^[a-z0-9][a-z0-9-]{0,39}$/)], async (id) => {
    if (!settings.ai.providers.some((p) => p.id === id)) throw new Error('not-found');
    settings.ai.consentedFor = id;
    await saveSettings();
    return true;
  });
  handle('ai:test', [V.match(/^[a-z0-9][a-z0-9-]{0,39}$/)], async (id) => {
    const p = settings.ai.providers.find((x) => x.id === id);
    if (!p) throw new Error('not-found');
    return ai.test(p);
  });
  const aiTarget = V.obj({ target: V.path(), isDir: V.bool(), size: V.optNum(0, 1e16), files: V.optNum(0, 1e10), kbTitle: V.optStr(200) });
  async function aiPayload(t) {
    let version = null;
    if (!t.isDir && /\.(exe|dll|sys)$/i.test(t.target)) { const info = await SYS.inspect(t.target, guard).catch(() => null); version = info && info.version; }
    return ai.buildPayload({ ...t, version }, { lang: settings.lang, mask: settings.ai.mask, children: settings.ai.children });
  }
  handle('ai:preview', [aiTarget], aiPayload);
  handle('ai:explain', [aiTarget], async (t) => {
    const p = activeProvider();
    if (!p) throw new Error('no-provider');
    if (settings.ai.consentedFor !== p.id) throw new Error('consent-required');
    return ai.explain(p, await aiPayload(t));
  });

  // monitor, shell menu, updates
  handle('monitor:history', [V.num(1, 120)], (days) => monitor.samples(days));
  handle('monitor:check', [], async () => { await monitor.tick(true); return true; });
  handle('shellmenu:status', [], () => SHELLMENU.isInstalled());
  handle('shellmenu:set', [V.bool()], async (on) => {
    if (!on) return !(await SHELLMENU.uninstall());
    return SHELLMENU.install({ exe: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath, appPath: DEV ? app.getAppPath() : null });
  });
  handle('update:check', [], checkUpdates);
  handle('update:download', [], downloadUpdate);
  handle('update:install', [], installUpdate);
  handle('update:openPage', [], () => shell.openExternal(RELEASES_URL).then(() => true));
}

// ───────────────────────── report ─────────────────────────
async function exportReport(data, format) {
  // font embedded as a data URL: the exported HTML is self-contained and needs no file:// access
  const font = await fsp.readFile(path.join(__dirname, 'renderer', 'fonts', 'Vazirmatn.woff2'));
  const html = buildHtml(data, 'data:font/woff2;base64,' + font.toString('base64'));
  const ext = format === 'pdf' ? 'pdf' : 'html';
  const r = await dialog.showSaveDialog(win, { defaultPath: 'disk-report-' + new Date().toISOString().slice(0, 10) + '.' + ext, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  if (r.canceled || !r.filePath) return false;
  if (format === 'html') { await fsp.writeFile(r.filePath, html, 'utf8'); return r.filePath; }
  const tmp = path.join(app.getPath('temp'), 'dh-report-' + crypto.randomBytes(4).toString('hex') + '.html');
  await fsp.writeFile(tmp, html, 'utf8');
  const pw = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } });
  try {
    await pw.loadFile(tmp);
    const pdf = await pw.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { marginType: 'default' } });
    await fsp.writeFile(r.filePath, pdf);
  } finally { pw.destroy(); fsp.unlink(tmp).catch(() => {}); }
  return r.filePath;
}

// ───────────────────────── updates ─────────────────────────
const RELEASES_URL = 'https://github.com/MohamadTahernezhad/DriveHound/releases/latest';
let updater = null;
let update = { phase: 'idle' };   // idle → downloading → ready; the download keeps running while the window is hidden
function getUpdater() {
  if (DEV) return null;
  if (process.env.PORTABLE_EXECUTABLE_FILE) return null;                                     // portable exe: the updater would install a second, NSIS copy
  if (!fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) return null;     // no publish target configured at build time
  if (updater) return updater;
  try {
    const u = require('electron-updater').autoUpdater;
    u.autoDownload = false;
    u.on('download-progress', (p) => send('update:progress', { percent: p.percent, transferred: p.transferred, total: p.total, speed: p.bytesPerSecond }));
    u.on('error', (e) => log('update error', e));
    updater = u;
    return u;
  } catch (e) { log('updater unavailable', e); return null; }
}
const updErr = (e) => String((e && e.message) || e).split('\n')[0].slice(0, 300);
async function checkUpdates() {
  const base = { current: app.getVersion(), portable: !!process.env.PORTABLE_EXECUTABLE_FILE };
  const u = getUpdater();
  if (!u) return { ...base, configured: false };
  if (update.phase !== 'idle') return { ...base, configured: true, available: true, ...update.info, phase: update.phase };
  try {
    const r = await u.checkForUpdates();
    const i = (r && r.updateInfo) || {};
    const notes = Array.isArray(i.releaseNotes) ? i.releaseNotes.map((n) => n.note || '').join('\n') : i.releaseNotes;
    update.info = { version: i.version, date: i.releaseDate ? Date.parse(i.releaseDate) : null, notes: String(notes || '').slice(0, 100000) };
    return { ...base, configured: true, available: !!(r && r.isUpdateAvailable), ...update.info, phase: update.phase };
  } catch (e) { log('update check failed', e); return { ...base, configured: true, error: updErr(e) }; }
}
// resolves when the installer is fully downloaded and verified; a second call joins the running download
async function downloadUpdate() {
  const u = getUpdater();
  if (!u) throw new Error('not-configured');
  if (update.phase === 'ready') return true;
  if (update.phase !== 'downloading') {
    if (!update.info) await u.checkForUpdates();
    update.phase = 'downloading';
    update.job = u.downloadUpdate().then(
      () => { update.phase = 'ready'; send('update:ready', update.info); },
      (e) => { update.phase = 'idle'; throw new Error(updErr(e)); });
  }
  await update.job;
  return true;
}
function installUpdate() {
  const u = getUpdater();
  if (!u || update.phase !== 'ready') return false;
  quitting = true;
  setImmediate(() => u.quitAndInstall(true, true));   // silent install into the same folder, then start the new version
  return true;
}

// ───────────────────────── tray, notifications, login item ─────────────────────────
const T = (fa, en) => (settings.lang === 'fa' ? fa : en);
function fmtGB(b) { return (b / 1024 ** 3).toFixed(1) + ' GB'; }

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  else { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
}

function buildTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')).resize({ width: 16, height: 16 });
  if (!tray) { tray = new Tray(img); tray.on('click', showWindow); }
  tray.setToolTip('DriveHound');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: T('باز کردن برنامه', 'Open DriveHound'), click: showWindow },
    { label: T('اسکن درایو ' + ENV.SYSTEMDRIVE, 'Scan ' + ENV.SYSTEMDRIVE), click: () => { showWindow(); setTimeout(() => send('app:analyze', ENV.SYSTEMDRIVE + '\\'), 600); } },
    { label: T('بررسی فوری فضا', 'Check space now'), click: () => monitor.tick(true) },
    { type: 'checkbox', label: T('پایش خودکار', 'Background monitoring'), checked: settings.monitor.enabled, click: async (mi) => { settings.monitor.enabled = mi.checked; await saveSettings(); monitor.start(); } },
    { type: 'separator' },
    { label: T('خروج', 'Quit'), click: () => { quitting = true; app.quit(); } },
  ]));
}

function notify(ev) {
  if (!Notification.isSupported()) return;
  let title = '', body = '';
  if (ev.kind === 'growth') {
    title = T(`درایو ${ev.drive} ${fmtGB(ev.drop)} پر شد`, `Drive ${ev.drive} lost ${fmtGB(ev.drop)}`);
    body = ev.cause && ev.cause.length ? T('بیشترین علت: ', 'Main cause: ') + ev.cause.map((c) => `${c.title} (+${fmtGB(c.own)})`).join('، ') : T('برای دیدن جزئیات کلیک کنید', 'Click to see what changed');
  } else if (ev.kind === 'low') {
    title = T(`فضای درایو ${ev.drive} کم است`, `Drive ${ev.drive} is almost full`);
    body = T(`فقط ${fmtGB(ev.free)} آزاد مانده`, `Only ${fmtGB(ev.free)} free`);
  } else if (ev.kind === 'weekly') {
    title = T('گزارش هفتگی فضای دیسک', 'Weekly disk report');
    body = ev.changes.map((c) => `${c.drive} ${c.change > 0 ? '−' : '+'}${fmtGB(Math.abs(c.change))} (${fmtGB(c.free)} ${T('آزاد', 'free')})`).join(' · ');
  }
  const n = new Notification({ title, body, icon: path.join(__dirname, 'assets', 'icon.png') });
  n.on('click', () => { showWindow(); setTimeout(() => send('app:nav', { view: 'changes', drive: ev.drive }), 500); });
  n.show();
  send('monitor:alert', ev);
}

function applyLoginItem() {
  if (DEV) return;
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  app.setLoginItemSettings({ openAtLogin: false, name: 'DiskInsight', path: exe });   // startup entry of the former name
  app.setLoginItemSettings({ openAtLogin: settings.startAtLogin, name: 'DriveHound', path: exe, args: ['--hidden'] });
}

// The app was called "Disk Insight" up to 2.1.0: bring its profile (settings, history, scans, AI keys) along once.
function migrateProfile() {
  const current = app.getPath('userData');
  const legacy = path.join(app.getPath('appData'), 'Disk Insight');
  if (!fs.existsSync(path.join(legacy, 'data'))) return;
  try { if (fs.readdirSync(current).length) return; } catch { /* not created yet */ }   // Electron creates userData empty before this runs
  try { fs.rmdirSync(current); } catch { /* not there */ }
  try { fs.renameSync(legacy, current); return; } catch { /* old version still running — copy what matters instead */ }
  try {
    fs.cpSync(path.join(legacy, 'data'), path.join(current, 'data'), { recursive: true });
    fs.copyFileSync(path.join(legacy, 'Local State'), path.join(current, 'Local State'));   // holds the key that decrypts saved AI keys
  } catch { /* start with a fresh profile */ }
}

// Re-registers the Explorer menu entry under the new name if the old one was installed.
async function migrateShellMenu() {
  if (await SHELLMENU.removeLegacy()) await SHELLMENU.install({ exe: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath, appPath: DEV ? app.getAppPath() : null });
}

// ───────────────────────── window & security ─────────────────────────
function createWindow(hidden) {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1120, minHeight: 720,
    backgroundColor: settings.theme === 'light' ? '#f3f4fa' : '#0a0b14',
    titleBarStyle: 'hidden',
    titleBarOverlay: settings.theme === 'light' ? { color: '#eef0f8', symbolColor: '#2a2d4a', height: 45 } : { color: '#0c0d18', symbolColor: '#c9cdf5', height: 45 },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false,
      webSecurity: true, allowRunningInsecureContent: false, spellcheck: false, devTools: DEV,
      backgroundThrottling: !(DEV && process.env.DH_SHOT),      // dev screenshots of an occluded window need fresh frames
    },
  });
  win.removeMenu();
  win.loadURL(APP_URL);
  win.once('ready-to-show', () => { if (!hidden) win.show(); });
  win.on('close', (e) => {
    if (!quitting && settings.closeToTray) { e.preventDefault(); win.hide(); }
  });
  win.webContents.on('did-finish-load', () => { if (pendingAnalyze) { send('app:analyze', pendingAnalyze); pendingAnalyze = null; } });
  win.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) log('renderer error', e.message, (e.sourceId || '').split('/').pop() + ':' + e.lineNumber); });
  win.webContents.on('render-process-gone', (_e, d) => log('renderer gone', d));

  // dev-only visual test hook: DH_SHOT=<png> [DH_JS=<code>] — disabled in packaged builds
  if (DEV && process.env.DH_SHOT) {
    win.webContents.on('console-message', (e) => console.log('[renderer]', e.level, e.message, e.lineNumber || ''));
    win.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, Number(process.env.DH_WAIT || 3500)));
      if (process.env.DH_JS) { await win.webContents.executeJavaScript(process.env.DH_JS).catch((e) => console.error(e)); await new Promise((r) => setTimeout(r, Number(process.env.DH_WAIT2 || 1500))); }
      const img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.DH_SHOT, img.toPNG());
      quitting = true;
      app.quit();
    });
  }
}

function registerAppProtocol() {
  const roots = ['renderer', 'shared'].map((d) => path.join(__dirname, d) + path.sep);
  protocol.handle('app', (req) => {
    try {
      const u = new URL(req.url);
      if (u.host !== 'bundle') return new Response('not found', { status: 404 });
      const file = path.normalize(path.join(__dirname, decodeURIComponent(u.pathname)));
      if (!roots.some((r) => file.startsWith(r))) return new Response('forbidden', { status: 403 });
      return net.fetch(pathToFileURL(file).toString());
    } catch { return new Response('bad request', { status: 400 }); }
  });
}

function hardenSessions() {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  // the renderer never talks to the network; block anything that is not a local file or data URL
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    let ok = /^(app|data|devtools):/i.test(details.url);
    // the app:// handler reads its own files via file:// — allow exactly those folders, nothing else
    if (!ok && /^file:/i.test(details.url)) {
      try {
        const f = path.normalize(require('url').fileURLToPath(details.url)).toLowerCase();
        ok = ['renderer', 'shared'].some((d) => f.startsWith((path.join(__dirname, d) + path.sep).toLowerCase()));
      } catch { ok = false; }
    }
    cb({ cancel: !ok });
  });
}

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (e) => e.preventDefault());
  contents.on('will-attach-webview', (e) => e.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

// ───────────────────────── lifecycle ─────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const a = SHELLMENU.parseArgs(argv);
    log('second-instance', a);
    showWindow();
    if (a.analyze && /^[a-zA-Z]:[\\/]/.test(a.analyze) && fs.existsSync(a.analyze)) send('app:analyze', a.analyze);
  });

  app.whenReady().then(async () => {
    nativeTheme.themeSource = 'dark';
    isAdmin = await X.isAdmin();
    await loadSettings();
    Knowledge.init(ENV);
    Knowledge.setUserRules(settings.userRules);
    buildGuard();
    history = createHistory(dataDir());
    quarantine = createQuarantine(dataDir(), guard);
    mover = createMover(dataDir(), guard);
    keyStore = createKeyStore(dataDir(), safeStorage);
    ai = createAI(dataDir(), keyStore);
    // v2.0 → v2.1: the single Claude key becomes a provider entry
    const legacyKey = keyStore.takeLegacy();
    if (legacyKey && !settings.ai.providers.some((p) => p.id === 'claude')) {
      try {
        keyStore.set('claude', legacyKey);
        settings.ai.providers.push({ id: 'claude', name: 'Claude (Anthropic)', type: 'anthropic', baseUrl: '', model: AI.DEFAULT_CLAUDE_MODEL });
        settings.ai.activeId = settings.ai.activeId || 'claude';
        await saveSettings();
      } catch (e) { log('legacy key migration failed', e); }
    }
    monitor = createMonitor({ dataDir: dataDir(), listDrives: () => SYS.listDrives(ENV.SYSTEMDRIVE), getSettings: () => settings, notify, investigate });
    registerAppProtocol();
    hardenSessions();
    registerIpc();
    const args = SHELLMENU.parseArgs(process.argv);
    log('start', { argv: process.argv.slice(1), args, admin: isAdmin });
    if (args.analyze && /^[a-zA-Z]:[\\/]/.test(args.analyze) && fs.existsSync(args.analyze)) pendingAnalyze = args.analyze;
    createWindow(args.hidden);
    buildTray();
    applyLoginItem();
    migrateShellMenu().catch((e) => log('shell menu migration failed', e));
    monitor.start();
    quarantine.purgeExpired().then((n) => n && recordHistory({ op: 'quarantine-expired', count: n })).catch(() => {});
    SYS.getSystemContext().catch(() => {});
  });

  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => { if (!settings.closeToTray) app.quit(); });
}
