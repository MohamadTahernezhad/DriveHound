'use strict';
/* global Knowledge, Compare, I18N, CAT_ICON, icon, Charts, Filters, api */

const K = window.Knowledge;
const t = (k, v) => I18N.t(k, v);
const P = (o) => I18N.pick(o);
const T = (fa, en) => (I18N.lang === 'fa' ? fa : en);
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ───────────────────────── state ─────────────────────────
const state = {
  env: null, isAdmin: false, version: '', dev: false, hasHelper: false,
  settings: { lang: 'fa', theme: 'dark', delMode: 'trash', ai: {}, monitor: {}, userRules: [], protectedPaths: [], hiddenPaths: [], filterPresets: {}, recentTargets: [] },
  drives: [], drive: null,
  scanning: false, progress: null,
  result: null, derived: null,
  view: 'dashboard',
  explorer: { stack: [], colorBy: 'category' },
  changes: { tab: 'hot', snaps: [], snapTs: null, snap: null },
  cleanup: { selected: new Set() },
  apps: { list: null, loading: false },
  deleted: new Set(),
  drawerItem: null,
  aiAnswers: new Map(),
  freeHist: null,
  limits: {},
};
window.state = state;

// ───────────────────────── groups / safety meta ─────────────────────────
const GROUPS = {
  system: { c: 'var(--c1)', hex: ['#2a78d6', '#3987e5'], fa: 'سیستم ویندوز', en: 'Windows system', icon: 'windows' },
  apps: { c: 'var(--c2)', hex: ['#eb6834', '#d95926'], fa: 'برنامه‌ها', en: 'Programs', icon: 'grid' },
  vm: { c: 'var(--c3)', hex: ['#1baf7a', '#199e70'], fa: 'ماشین مجازی و Docker', en: 'VMs & containers', icon: 'box' },
  dev: { c: 'var(--c4)', hex: ['#eda100', '#c98500'], fa: 'ابزار برنامه‌نویسی', en: 'Developer tools', icon: 'code' },
  cache: { c: 'var(--c5)', hex: ['#e87ba4', '#d55181'], fa: 'کش، موقت و مرورگر', en: 'Caches, temp & browsers', icon: 'layers' },
  user: { c: 'var(--c6)', hex: ['#008300', '#008300'], fa: 'شخصی و رسانه', en: 'Personal & media', icon: 'user' },
  appdata: { c: 'var(--c7)', hex: ['#4a3aa7', '#9085e9'], fa: 'داده برنامه‌ها', en: 'App data', icon: 'folderTree' },
  other: { c: 'var(--c-other)', hex: ['#a3a7c0', '#5d6283'], fa: 'سایر', en: 'Other', icon: 'folder' },
};
const CAT2GROUP = { system: 'system', apps: 'apps', vm: 'vm', dev: 'dev', cache: 'cache', temp: 'cache', browser: 'cache', user: 'user', media: 'user', backup: 'user', appdata: 'appdata', ai: 'other', games: 'other', other: 'other' };
const SAFETY_ICON = { safe: 'shieldCheck', caution: 'alert', danger: 'lock', user: 'user', unknown: 'help' };
const SAFETY_RANK = { safe: 0, caution: 1, user: 2, unknown: 2, danger: 3 };
const SAFETY_KEYS = ['safe', 'caution', 'user', 'danger', 'unknown'];
const TERMINAL_ACTIONS = new Set(['dismCleanup', 'dockerPrune', 'compactVhdx', 'npmCacheClean', 'pipPurge', 'nugetClean', 'condaClean', 'pubCacheClean', 'goClean']);
const GENERAL_TOOLS = ['emptyRecycleBin', 'cleanTemp', 'diskCleanup', 'dismCleanup', 'hibernateOff', 'hibernateReduced', 'systemProtection', 'storageSense'];
const groupOf = (c) => CAT2GROUP[c.cat] || 'other';
const SERIES = ['var(--c1)', 'var(--c2)', 'var(--c3)'];

// ───────────────────────── formatting ─────────────────────────
const locale = () => (I18N.lang === 'fa' ? 'fa-IR' : 'en-US');
function fmtNum(n, digits = 0) { return new Intl.NumberFormat(locale(), { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(n); }
function fmtBytes(b, short) {
  if (b == null || isNaN(b)) return '—';
  const neg = b < 0; b = Math.abs(b);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
  const d = i === 0 ? 0 : b >= 100 ? 0 : b >= 10 ? 1 : short ? 1 : 2;
  return (neg ? '−' : '') + fmtNum(b, d) + ' ' + units[i];
}
function fmtBytesShort(b) { const g = b / 1024 ** 3; return g >= 1 ? fmtNum(g, g >= 10 ? 0 : 1) + 'G' : fmtNum(b / 1048576, 0) + 'M'; }
function fmtPct(v) { return fmtNum(v * 100, v < 0.1 ? 1 : 0) + (I18N.lang === 'fa' ? '٪' : '%'); }
function fmtAgo(ms) {
  if (!ms || ms < 946684800000) return t('ago_unknown');
  const diff = (ms - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 45) return rtf.format(Math.round(diff / 86400), 'day');
  if (abs < 86400 * 400) return rtf.format(Math.round(diff / (86400 * 30)), 'month');
  return rtf.format(Math.round(diff / (86400 * 365)), 'year');
}
function fmtDate(ms, withTime) {
  if (!ms || ms < 946684800000) return '—';
  return new Date(ms).toLocaleString(locale(), withTime ? { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' } : { year: 'numeric', month: 'short', day: 'numeric' });
}
function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m ? `${fmtNum(m)}:${String(s % 60).padStart(2, '0')}` : `${fmtNum(s)}s`;
}
const baseName = (p) => { const s = String(p).replace(/[\\/]+$/, ''); const i = s.lastIndexOf('\\'); return i >= 0 ? s.slice(i + 1) || s : s; };
const dirName = (p) => { const i = p.replace(/[\\/]+$/, '').lastIndexOf('\\'); return i > 2 ? p.slice(0, i) : p.slice(0, 3); };
const joinPath = (a, b) => (a.endsWith('\\') ? a + b : a + '\\' + b);
const lowerP = (p) => String(p).toLowerCase().replace(/[\\/]+$/, '');
const extOf = (p) => { const b = baseName(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };
const ptail = (p) => `<span class="path ptail" title="${esc(p)}"><bdi>${esc(p)}</bdi></span>`;
const under = (p, base) => { const a = lowerP(p), b = lowerP(base); return a === b || a.startsWith(b + '\\'); };
const isDeleted = (p) => { for (const d of state.deleted) if (under(p, d)) return true; return false; };
const isHidden = (p) => (state.settings.hiddenPaths || []).some((h) => under(p, h));
const isProtectedByUser = (p) => (state.settings.protectedPaths || []).some((h) => under(p, h) || under(h, p));
const rootOf = (d) => (d && /^[a-zA-Z]:$/.test(d) ? d + '\\' : d);
const themeIdx = () => (state.settings.theme === 'light' ? 0 : 1);

function badge(safety) {
  const s = K.SAFETY[safety] ? safety : 'unknown';
  return `<span class="badge ${s}">${icon(SAFETY_ICON[s], 13)}${esc(P(K.SAFETY[s]))}</span>`;
}
const safetyOptions = (counts) => SAFETY_KEYS.map((s) => ({ v: s, label: P(K.SAFETY[s]), icon: SAFETY_ICON[s], count: counts ? counts[s] || 0 : undefined }));
const groupOptions = (counts) => Object.keys(GROUPS).map((g) => ({ v: g, label: P(GROUPS[g]), color: GROUPS[g].c, count: counts ? counts[g] || 0 : undefined }));
function countBy(rows, fn) { const m = {}; for (const r of rows) { const k = fn(r); m[k] = (m[k] || 0) + 1; } return m; }
function topValues(rows, fn, n = 25) { return Object.entries(countBy(rows, fn)).filter(([k]) => k).sort((a, b) => b[1] - a[1]).slice(0, n); }

// ───────────────────────── classification cache ─────────────────────────
let clsCache = new Map();
function cls(path, isDir) {
  const k = (isDir ? 'd' : 'f') + path;
  let c = clsCache.get(k);
  if (!c) { c = K.classify(path, isDir); clsCache.set(k, c); }
  return c;
}

// ───────────────────────── item registry (DOM → data) ─────────────────────────
let REG = new Map(), regSeq = 0;
function reg(item) { const id = 'i' + (++regSeq); REG.set(id, item); if (REG.size > 60000) { const first = REG.keys().next().value; REG.delete(first); } return id; }
const getItem = (id) => REG.get(id);

function fileIcon(item, c) {
  if (item.isDir) return CAT_ICON[c.cat] && c.source !== 'location' && c.source !== 'unknown' ? CAT_ICON[c.cat] : 'folder';
  const ext = extOf(item.path || '');
  if (['vhdx', 'vhd', 'qcow2', 'vmdk', 'vdi', 'img', 'iso'].includes(ext)) return 'box';
  if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) return 'film';
  if (['zip', 'rar', '7z', 'gz', 'tar', 'cab', 'jar'].includes(ext)) return 'archive';
  if (['exe', 'msi', 'dll', 'sys'].includes(ext)) return 'cpu';
  if (['log', 'etl', 'dmp', 'tmp'].includes(ext)) return 'clock';
  return 'file';
}

// ───────────────────────── tree helpers ─────────────────────────
function findNodeChain(path) {
  const root = state.result?.tree;
  if (!root) return null;
  const rootPath = root.n;
  if (lowerP(path) === lowerP(rootPath)) return [root];
  if (!lowerP(path).startsWith(lowerP(rootPath).replace(/\\$/, ''))) return null;
  const segs = path.slice(rootPath.length).split('\\').filter(Boolean);
  const chain = [root];
  let cur = root;
  for (const s of segs) {
    const ls = s.toLowerCase();
    const next = cur.c.find((c) => c.n.toLowerCase() === ls);
    if (!next) return null;
    chain.push(next); cur = next;
  }
  return chain;
}
function nodePath(chain) { let p = chain[0].n; for (let i = 1; i < chain.length; i++) p = joinPath(p, chain[i].n); return p; }
function removeFromTree(path, bytes, whole) {
  const own = findNodeChain(path);
  const parentChain = own ? own.slice(0, -1) : findNodeChain(dirName(path));
  const chain = own || parentChain;
  if (!chain) return;
  for (const n of chain) n.s = Math.max(0, n.s - bytes);
  if (whole) {
    const parent = own ? own[own.length - 2] : parentChain[parentChain.length - 1];
    if (!parent) return;
    const name = baseName(path).toLowerCase();
    parent.c = parent.c.filter((c) => c.n.toLowerCase() !== name);
    parent.fl = parent.fl.filter((f) => f.n.toLowerCase() !== name);
  }
}

// ───────────────────────── analysis ─────────────────────────
async function analyze() {
  const r = state.result;
  if (!r) { state.derived = null; return; }
  clsCache = new Map();
  K.setFolders(r.folders.map((f) => f.p));
  const cands = K.markerCandidates(r.folders.map((f) => f.p));
  if (cands.length) { try { K.setMarkers(await api.checkMarkers(cands)); } catch { /* ignore */ } clsCache = new Map(); }

  const cand = [];
  for (const f of r.folders) {
    const c = cls(f.p, true);
    if (c.source === 'rule' && c.id !== 'drive' && !c.container) cand.push({ path: f.p, size: f.s, isDir: true, mtime: f.m, r30: f.r30, files: f.f, c });
  }
  for (const f of r.topFiles) {
    const c = cls(f.p, false);
    if (c.source === 'rule' || c.source === 'ext') cand.push({ path: f.p, size: f.s, isDir: false, mtime: f.m, c });
  }
  cand.sort((a, b) => a.path.length - b.path.length);
  const kept = new Map();
  const items = [];
  for (const it of cand) {
    let anc = null;
    let cur = lowerP(it.path);
    while (true) {
      const k = cur.lastIndexOf('\\');
      if (k <= 2) break;
      cur = cur.slice(0, k);
      if (kept.has(cur)) { anc = kept.get(cur); break; }
    }
    if (anc && (anc.c.id === it.c.id || (anc.c.mode !== 'none' && SAFETY_RANK[anc.c.safety] <= SAFETY_RANK[it.c.safety]))) continue;
    it.parentItem = anc;
    kept.set(lowerP(it.path), it);
    items.push(it);
  }
  items.sort((a, b) => b.size - a.size);

  const acc = {};
  for (const g of Object.keys(GROUPS)) acc[g] = 0;
  const root = r.tree;
  const stack = [[root, root.n, null]];
  while (stack.length) {
    const [node, path, inh] = stack.pop();
    let g = inh;
    if (node !== root) { const c = cls(path, true); if (c.source === 'rule' && !c.container && !g) g = groupOf(c); }
    let own = node.s;
    for (const ch of node.c) { own -= ch.s; stack.push([ch, joinPath(path, ch.n), g]); }
    for (const f of node.fl) { own -= f.s; acc[g || groupOf(cls(joinPath(path, f.n), false))] += f.s; }
    if (own > 0) acc[g || (node === root ? 'other' : groupOf(cls(path, true)))] += own;
  }
  const cats = Object.entries(acc).filter(([, v]) => v > 0).map(([id, v]) => ({ id, value: v }));

  const pool = cand.filter((i) => !['user-folders', 'downloads'].includes(i.c.id)).sort((a, b) => b.size - a.size);
  const picked = [];
  for (const it of pool) {
    const lp = lowerP(it.path);
    const ancIdx = picked.findIndex((p) => lp.startsWith(lowerP(p.path) + '\\'));
    if (ancIdx >= 0) { if (it.size >= picked[ancIdx].size * 0.6) picked[ancIdx] = it; continue; }
    if (picked.some((p) => lowerP(p.path).startsWith(lp + '\\'))) continue;
    picked.push(it);
    if (picked.length >= 8) break;
  }
  picked.sort((a, b) => b.size - a.size);

  state.derived = { items, cats, diag: picked };
  recomputeReclaim();
  state.explorer.stack = [r.tree];
  state.cleanup.selected = new Set();
  state.changes.snap = null; state.changes.snapTs = null;
  state.deleted = new Set();
  REG = new Map();
}
function hasSafeAncestor(it) { let a = it.parentItem; while (a) { if (a.c.safety === 'safe' && a.c.mode !== 'none') return true; a = a.parentItem; } return false; }
function recomputeReclaim() {
  if (!state.derived) return;
  state.derived.reclaim = state.derived.items.filter((i) => i.c.safety === 'safe' && i.c.mode !== 'none' && !isDeleted(i.path) && !isHidden(i.path) && !hasSafeAncestor(i)).reduce((a, b) => a + b.size, 0);
}

// ───────────────────────── chrome ─────────────────────────
function applyLang() {
  I18N.lang = state.settings.lang;
  document.documentElement.lang = I18N.lang;
  document.documentElement.dir = I18N.lang === 'fa' ? 'rtl' : 'ltr';
  $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  $('#langLabel').textContent = I18N.lang === 'fa' ? 'EN' : 'فا';
}
function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme;
  $('#themeIcon').innerHTML = icon(state.settings.theme === 'dark' ? 'sun' : 'moon', 16);
  if (state.settings.theme === 'dark') api.overlay('#0c0d18', '#c9cdf5'); else api.overlay('#eef0f8', '#2a2d4a');
}
function renderChrome() {
  $$('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon, 18); });
  const pill = $('#adminPill');
  pill.className = 'admin-pill' + (state.isAdmin ? ' on' : '');
  pill.innerHTML = state.isAdmin ? `${icon('shieldCheck', 14)}${t('admin_yes')}` : `${icon('shield', 14)}${t('admin_no')} · <b>${t('admin_relaunch')}</b>`;
  pill.title = state.isAdmin ? '' : t('admin_hint');
  const d = state.drives.find((x) => x.letter === state.drive);
  const side = $('#sideDrive');
  if (d) {
    const used = d.size - d.free, pct = used / d.size;
    side.innerHTML = `<div style="display:flex;justify-content:space-between"><b>${icon('disk', 14)} <bdi class="ltr">${esc(d.letter)}</bdi></b><span class="num">${fmtPct(pct)}</span></div>
      <div class="bar ${pct > 0.95 ? 'crit' : pct > 0.85 ? 'warn' : ''}"><i style="width:${pct * 100}%"></i></div>
      <span class="num">${fmtBytes(d.free)} ${t('free')} ${t('of')} ${fmtBytes(d.size)}</span>`;
  } else if (state.drive) side.innerHTML = `<b>${icon('folder', 14)} ${esc(baseName(state.drive))}</b>`;
  else side.innerHTML = '';
  $('#titleDrive').innerHTML = state.result ? `${t('last_scan', { t: fmtAgo(state.result.finishedAt) })}${state.result.engine === 'mft' ? ' · <b>MFT</b>' : ''}` : '';
  const bc = $('#badgeCleanup');
  if (state.derived && state.derived.reclaim > 0) { bc.hidden = false; bc.textContent = fmtBytesShort(state.derived.reclaim); } else bc.hidden = true;
  const bch = $('#badgeChanges');
  const g7 = state.result?.tree?.r7 || 0;
  if (g7 > 1024 ** 3) { bch.hidden = false; bch.textContent = '+' + fmtBytesShort(g7); } else bch.hidden = true;
  $$('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.view === state.view));
  $('#settingsBtn').classList.toggle('active', state.view === 'settings');
}

const VIEWS = {};
function setView(v) {
  if (!VIEWS[v]) v = 'dashboard';
  state.view = v;
  $$('.view').forEach((el) => { el.classList.toggle('active', el.id === 'view-' + v); if (el.id === 'view-' + v) el.scrollTop = 0; });
  renderChrome();
  renderView(v);
}
function renderView(v = state.view) {
  const el = $('#view-' + v);
  const top = el ? el.scrollTop : 0;
  const r = VIEWS[v] && VIEWS[v]();
  if (r && r.then) r.then(() => { if (el) el.scrollTop = top; }); else if (el) el.scrollTop = top;
}
function renderAll() { applyLang(); renderChrome(); renderView(); }

// ───────────────────────── dashboard ─────────────────────────
function driveCards() {
  const folders = (state.settings.recentTargets || []).filter((p) => !/^[a-zA-Z]:\\?$/.test(p));
  return `<div class="drives">${state.drives.map((d) => {
    const used = d.size - d.free, pct = used / d.size;
    const tone = pct > 0.95 ? 'crit' : pct > 0.85 ? 'warn' : 'accent';
    const canTurbo = state.hasHelper && d.fs === 'NTFS';
    return `<div class="drive-card ${d.letter === state.drive ? 'selected' : ''}" data-act="pick-drive" data-drive="${esc(d.letter)}">
      <div class="drive-ring">${Charts.ring(pct, { size: 86, stroke: 9, tone })}<div class="ring-center"><div><b class="num">${fmtNum(Math.round(pct * 100))}${I18N.lang === 'fa' ? '٪' : '%'}</b><br><span>${t('used')}</span></div></div></div>
      <div class="drive-info">
        <div class="dl">${icon('disk', 17)} <bdi class="ltr">${esc(d.letter)}</bdi> <small>${esc(d.label || (d.system ? 'Windows' : ''))}${d.fs ? ' · ' + esc(d.fs) : ''}</small></div>
        <div class="ds num"><b>${fmtBytes(d.free)}</b> ${t('free')} ${t('of')} ${fmtBytes(d.size)}</div>
        <div class="bar ${tone === 'accent' ? '' : tone}"><i style="width:${pct * 100}%"></i></div>
        <div class="drive-actions">
          <button class="btn primary sm" data-act="scan" data-drive="${esc(d.letter)}" ${state.scanning ? 'disabled' : ''}>${icon('play', 13)}${state.result && d.letter === state.drive ? t('rescan') : t('scan')}</button>
          ${canTurbo ? `<button class="btn turbo sm" data-act="scan-turbo" data-drive="${esc(d.letter)}" ${state.scanning ? 'disabled' : ''} title="${esc(T('خواندن مستقیم جدول MFT — چند ثانیه، نیاز به ادمین', 'Reads the MFT directly — seconds, needs admin'))}">${icon('rocket', 13)}${T('توربو', 'Turbo')}</button>` : ''}
          ${pct > 0.9 ? `<span class="low-space">${icon('alert', 13)}${fmtBytes(d.free, true)}</span>` : ''}
        </div>
      </div></div>`;
  }).join('')}
  ${folders.map((f) => `<div class="drive-card folder ${f === state.drive ? 'selected' : ''}" data-act="pick-drive" data-drive="${esc(f)}"><div class="drive-ring">${icon('folder', 32)}</div>
    <div class="drive-info"><div class="dl">${esc(baseName(f))}</div>${ptail(f)}<div class="drive-actions"><button class="btn primary sm" data-act="scan" data-drive="${esc(f)}" ${state.scanning ? 'disabled' : ''}>${icon('play', 13)}${t('scan')}</button><button class="icon-btn" data-act="forget-target" data-p="${esc(f)}" title="${T('حذف از لیست', 'Remove')}">${icon('x', 14)}</button></div></div></div>`).join('')}
  <button class="drive-card" data-act="scan-folder" style="justify-content:center;border-style:dashed;color:var(--text-2)">${icon('folderPlus', 22)}<b>${T('اسکن یک پوشه', 'Scan a folder')}</b></button>
  </div>`;
}

function renderDashboard() {
  const el = $('#view-dashboard');
  if (state.scanning) { el.innerHTML = driveCards() + scanPanel(); updateProgress(); return; }
  if (!state.result) {
    el.innerHTML = driveCards() + `<div class="hero">
      <div><h2>${t('welcome_title')}</h2><p>${t('welcome_sub')}</p>
        <button class="btn primary" data-act="scan" data-drive="${esc(state.drive || '')}">${icon('play', 15)}${t('scan_drive', { d: esc(state.drive || '') })}</button>
        <div class="features">
          <div class="feature">${icon('zap', 17)}${t('feat1')}</div><div class="feature">${icon('shieldCheck', 17)}${t('feat2')}</div>
          <div class="feature">${icon('layers', 17)}${t('feat3')}</div><div class="feature">${icon('trendUp', 17)}${t('feat4')}</div>
        </div></div>
      <div class="hero-art"><div class="orb"><div class="core">${icon('disk', 42)}</div></div></div></div>
      <div class="card" style="margin-top:16px"><div class="card-head"><h3>${icon('activity', 18)}${T('روند فضای آزاد', 'Free space over time')}</h3></div><div id="freeChart"></div></div>`;
    renderFreeChart();
    return;
  }
  const r = state.result, d = state.derived;
  const total = r.tree.s;
  el.innerHTML = driveCards() + `
    ${!state.isAdmin && r.deniedCount ? `<div class="warn-strip">${icon('lock', 16)}<span>${t('denied_n', { n: fmtNum(r.deniedCount) })} — ${t('admin_hint')}</span><button class="btn ghost sm" data-act="relaunch-admin">${t('admin_relaunch')}</button></div>` : ''}
    <div class="kpis">
      <div class="kpi"><div class="k-ic">${icon('disk', 18)}</div><div class="k-val num">${fmtBytes(total)}</div><div class="k-lbl">${t('kpi_scanned')} · ${r.engine === 'mft' ? 'MFT' : fmtDuration(r.elapsed)}</div></div>
      <div class="kpi"><div class="k-ic">${icon('files', 18)}</div><div class="k-val num">${fmtNum(r.stats.files)}</div><div class="k-lbl">${t('kpi_files')} · ${fmtNum(r.stats.dirs)} ${t('folders')}</div></div>
      <div class="kpi k-safe clickable" data-act="go" data-view="cleanup"><div class="k-ic">${icon('sparkles', 18)}</div><div class="k-val num">${fmtBytes(d.reclaim)}</div><div class="k-lbl">${t('kpi_reclaim')}</div></div>
      <div class="kpi k-warn clickable" data-act="go" data-view="changes"><div class="k-ic">${icon('trendUp', 18)}</div><div class="k-val num">${fmtBytes(r.tree.r7)}</div><div class="k-lbl">${t('kpi_growth7')}</div></div>
      <div class="kpi clickable" data-act="go" data-view="changes"><div class="k-ic">${icon('activity', 18)}</div><div class="k-val num">${fmtBytes(r.tree.r30)}</div><div class="k-lbl">${t('kpi_growth30')}</div></div>
    </div>
    <div class="grid g-3-2" style="margin-bottom:16px">
      <div class="card"><div class="card-head"><h3>${icon('sparkles', 18)}${t('diag_title')}</h3><span class="sub">${t('diag_sub')}</span></div>
        <div>${d.diag.filter((x) => !isHidden(x.path) && !isDeleted(x.path)).map(diagRow).join('') || `<div class="empty">${t('no_results')}</div>`}</div></div>
      <div class="card"><div class="card-head"><h3>${icon('layers', 18)}${t('cat_title')}</h3></div><div class="donut-row"><div id="donut"></div><div class="legend" id="legend"></div></div></div>
    </div>
    <div class="grid g-2" style="margin-bottom:16px">
      <div class="card"><div class="card-head"><h3>${icon('folderTree', 18)}${t('top_title')}</h3><button class="btn ghost xs" data-act="go" data-view="explorer">${t('view_all')}</button></div>
        <div class="list" style="--cols: 1fr 90px 130px">${r.tree.c.slice(0, 8).map((n) => miniRow({ path: joinPath(r.tree.n, n.n), name: n.n, size: n.s, isDir: true, mtime: n.m, files: n.f, r30: n.r30 }, total)).join('')}</div></div>
      <div class="card"><div class="card-head"><h3>${icon('trendUp', 18)}${t('recent_title')}</h3><button class="btn ghost xs" data-act="go" data-view="changes">${t('view_all')}</button></div>
        <div class="list" style="--cols: 1fr 90px 130px">${r.hotspots.filter((h) => !isDeleted(h.p)).slice(0, 8).map((h) => growthMini(h)).join('') || `<div class="empty">${t('no_results')}</div>`}</div></div>
    </div>
    <div class="card"><div class="card-head"><h3>${icon('activity', 18)}${T('روند فضای آزاد (پایش خودکار)', 'Free space over time (monitoring)')}</h3>
      <div style="display:flex;gap:6px"><button class="btn ghost sm" data-act="report" data-f="html">${icon('fileText', 14)}${T('گزارش HTML', 'HTML report')}</button><button class="btn ghost sm" data-act="report" data-f="pdf">${icon('download', 14)}PDF</button></div></div><div id="freeChart"></div></div>`;

  const order = Object.keys(GROUPS);
  const items = d.cats.slice().sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)).map((c) => ({ id: c.id, value: c.value, color: GROUPS[c.id].c, label: P(GROUPS[c.id]), valueLabel: fmtBytes(c.value) }));
  const sum = items.reduce((a, b) => a + b.value, 0);
  Charts.donut($('#donut'), items, {
    size: 200, thickness: 24, center: esc(fmtBytes(sum, true)), sub: esc(t('kpi_scanned')),
    onHover: (it) => $$('#legend .legend-row').forEach((row) => row.classList.toggle('hl', it && row.dataset.id === it.id)),
  });
  $('#legend').innerHTML = items.slice().sort((a, b) => b.value - a.value).map((it) => `<div class="legend-row" data-id="${it.id}"><span class="cat-dot" style="--c:${it.color}"></span><span>${esc(it.label)}</span><span class="lv num">${fmtBytes(it.value, true)}</span><span class="lp num">${fmtPct(it.value / sum)}</span></div>`).join('');
  renderFreeChart();
}

async function renderFreeChart() {
  const box = $('#freeChart');
  if (!box) return;
  if (!state.freeHist) { try { state.freeHist = await api.monitor.history(30); } catch { state.freeHist = []; } }
  const hist = state.freeHist;
  const fixed = state.drives.filter((d) => d.type === 3).slice(0, 3);
  const series = fixed.map((d, i) => ({ label: d.letter, color: SERIES[i], points: hist.filter((h) => h.d[d.letter] != null).map((h) => ({ t: h.ts, v: h.d[d.letter] })) })).filter((s) => s.points.length);
  if (!series.length || series.every((s) => s.points.length < 2)) {
    box.innerHTML = `<div class="callout">${icon('info', 16)}<span>${T('پایش خودکار در حال جمع‌آوری داده است. هر چند دقیقه فضای آزاد درایوها ثبت می‌شود و اینجا نمودار آن را خواهید دید. اگر درایو یک‌دفعه پر شود، نوتیفیکیشن می‌گیرید.', 'Background monitoring is collecting data. Free space is sampled periodically and charted here. You get a notification if a drive suddenly fills up.')}</span></div>`;
    return;
  }
  const ok = Charts.line(box, series, { height: 220, rtl: I18N.lang === 'fa', yFormat: (v) => fmtBytes(v, true), xFormat: (tt, long) => new Date(tt).toLocaleDateString(locale(), long ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' } : { month: 'short', day: 'numeric' }) });
  if (ok && series.length > 1) box.insertAdjacentHTML('beforeend', `<div class="chart-legend">${series.map((s) => `<span><i class="cat-dot" style="--c:${s.color}"></i>${esc(s.label)} — ${T('فضای آزاد', 'free space')}</span>`).join('')}</div>`);
}

function diagRow(it) {
  const c = it.c, g = GROUPS[groupOf(c)];
  const recent = it.isDir ? (it.r30 > it.size * 0.5 && it.r30 > 5e8) : (it.mtime > Date.now() - 30 * 86400000);
  const id = reg(it);
  return `<div class="diag-item" data-act="open" data-id="${id}">
    <div class="diag-ic" style="--c:${g.c}">${icon(fileIcon(it, c), 20)}</div>
    <div class="diag-main"><div class="diag-title">${esc(P(c.t))} ${badge(c.safety)}</div>${ptail(it.path)}
      <div class="diag-hint">${icon('zap', 12)} ${esc(P(c.h))}</div></div>
    <div class="diag-side"><div class="diag-size num">${fmtBytes(it.size)}</div>${recent ? `<div class="diag-new">${icon('trendUp', 12)}${t('in_30d')}</div>` : ''}</div></div>`;
}
function miniRow(item, total) {
  const c = cls(item.path, item.isDir), g = GROUPS[groupOf(c)];
  const id = reg(item);
  return `<div class="row" data-act="open" data-id="${id}">
    <div class="row-name"><span class="fi" style="--c:${g.c}">${icon(fileIcon(item, c), 17)}</span><span class="nm"><b>${esc(item.name)}</b><span class="sub">${esc(P(c.t))}</span></span></div>
    <span class="sz">${fmtBytes(item.size)}</span>
    <div class="share"><div class="bar"><i style="width:${(item.size / total) * 100}%"></i></div><span class="num">${fmtPct(item.size / total)}</span></div></div>`;
}
function growthMini(h) {
  const c = cls(h.p, true), g = GROUPS[groupOf(c)];
  const id = reg({ path: h.p, name: baseName(h.p), size: h.s, isDir: true, r30: h.r30, r7: h.r7 });
  return `<div class="row" data-act="open" data-id="${id}">
    <div class="row-name"><span class="fi" style="--c:${g.c}">${icon(fileIcon({ isDir: true, path: h.p }, c), 17)}</span><span class="nm"><b>${esc(baseName(h.p))}</b>${ptail(h.p)}</span></div>
    <span class="sz" style="color:var(--caution-t)">+${fmtBytes(h.own)}</span>
    <span class="muted num" style="font-size:12px">${t('in_7d')}: ${fmtBytes(h.r7, true)}</span></div>`;
}

function scanPanel() {
  return `<div class="card scan-panel">
    <div class="radar"><div class="radar-core"><div><b class="num" id="spPct">0%</b><span id="spPhase">${t('scanning')}</span></div></div></div>
    <div><h2 style="margin:0 0 4px;font-size:22px;word-break:break-all">${t(/^[a-zA-Z]:$/.test(state.drive || '') ? 'scan_drive' : 'scan_folder', { d: esc(/^[a-zA-Z]:$/.test(state.drive || '') ? state.drive : baseName(state.drive || '')) })}</h2>
      <div class="scan-stats">
        <div class="scan-stat"><b class="num" id="spBytes">0</b><span>${t('scanned')}</span></div>
        <div class="scan-stat"><b class="num" id="spFiles">0</b><span>${t('kpi_files')}</span></div>
        <div class="scan-stat"><b class="num" id="spTime">0s</b><span>${t('elapsed')}</span></div>
      </div>
      <div class="scan-path"><div class="muted" style="font-size:11px;margin-bottom:2px">${t('current_path')}</div><span class="path ptail" id="spPath"><bdi></bdi></span></div>
      <div class="progress"><i id="spBar" style="width:0%"></i></div>
      <button class="btn ghost" data-act="cancel-scan">${icon('stop', 14)}${t('cancel')}</button></div></div>`;
}
function updateProgress() {
  const p = state.progress;
  if (!p || !$('#spBytes')) return;
  let pct;
  if (p.phase === 'mft') {
    pct = p.mftTotal ? Math.min(0.99, p.mftDone / p.mftTotal) : 0.02;
    $('#spPhase').textContent = T('خواندن MFT (توربو)…', 'Reading MFT (turbo)…');
    $('#spPath bdi').textContent = state.isAdmin ? '' : T('اگر پنجره UAC باز شد، اجازه دهید', 'Approve the UAC prompt if it appears');
    $('#spBytes').textContent = p.mftTotal ? fmtNum(p.mftDone) + ' / ' + fmtNum(p.mftTotal) : '…';
  } else {
    const d = state.drives.find((x) => x.letter === state.drive);
    const used = d ? d.size - d.free : 0;
    pct = used ? Math.min(0.99, p.bytes / used) : Math.min(0.95, (p.elapsed || 0) / 60000);
    $('#spPhase').textContent = t('scanning');
    $('#spBytes').textContent = fmtBytes(p.bytes);
    $('#spPath bdi').textContent = p.current || '';
  }
  $('#spPct').textContent = fmtNum(Math.round(pct * 100)) + (I18N.lang === 'fa' ? '٪' : '%');
  $('#spBar').style.width = pct * 100 + '%';
  $('#spFiles').textContent = fmtNum(p.files || 0);
  $('#spTime').textContent = fmtDuration(p.elapsed || 0);
}

// ───────────────────────── explorer ─────────────────────────
function explorerChildren(node, path) {
  const out = [];
  for (const ch of node.c) { const p = joinPath(path, ch.n); if (!isDeleted(p)) out.push({ name: ch.n, path: p, size: ch.s, isDir: true, node: ch, mtime: ch.m, files: ch.f, r30: ch.r30, r7: ch.r7 }); }
  for (const f of node.fl) { const p = joinPath(path, f.n); if (!isDeleted(p)) out.push({ name: f.n, path: p, size: f.s, isDir: false, mtime: f.m }); }
  return out;
}
function colorFor(item) {
  const mode = state.explorer.colorBy;
  if (item.other) return 'var(--c-other)';
  const c = cls(item.path, item.isDir);
  if (mode === 'safety') return ({ safe: 'var(--safe)', caution: 'var(--caution)', danger: 'var(--danger)', user: 'var(--user)', unknown: 'var(--c-other)' })[c.safety];
  if (mode === 'age') {
    const days = (Date.now() - (item.mtime || 0)) / 86400000;
    const mix = days < 7 ? 100 : days < 30 ? 75 : days < 180 ? 50 : days < 365 ? 32 : 18;
    return `color-mix(in srgb, var(--c1) ${mix}%, var(--c-other))`;
  }
  return GROUPS[groupOf(c)].c;
}
function explorerFilter(kids) {
  return Filters.create('explorer', {
    text: (r) => r.name, ext: (r) => (r.isDir ? '' : extOf(r.path)), safety: (r) => cls(r.path, r.isDir).safety,
    multi: [
      { key: 'safety', label: t('col_status'), icon: 'shield', options: safetyOptions(countBy(kids, (r) => cls(r.path, r.isDir).safety)), acc: (r) => cls(r.path, r.isDir).safety },
      { key: 'group', label: T('نوع', 'Type'), icon: 'layers', options: groupOptions(countBy(kids, (r) => groupOf(cls(r.path, r.isDir)))), acc: (r) => groupOf(cls(r.path, r.isDir)) },
      { key: 'kind', label: T('پوشه/فایل', 'Folder/file'), icon: 'folder', options: [{ v: 'dir', label: T('پوشه‌ها', 'Folders') }, { v: 'file', label: T('فایل‌ها', 'Files') }], acc: (r) => (r.isDir ? 'dir' : 'file') },
    ],
    size: { acc: (r) => r.size }, age: { acc: (r) => r.mtime, label: t('col_modified') },
    sort: { options: [{ k: 'size', label: t('col_size'), acc: (r) => r.size }, { k: 'name', label: t('col_name'), acc: (r) => r.name.toLowerCase() }, { k: 'mtime', label: t('col_modified'), acc: (r) => r.mtime || 0 }, { k: 'files', label: t('col_items'), acc: (r) => r.files || 0 }], default: { k: 'size', dir: -1 } },
  }, () => renderExplorer());
}
async function renderExplorer() {
  const el = $('#view-explorer');
  if (!state.result) { el.innerHTML = noScan(); return; }
  const stack = state.explorer.stack;
  const node = stack[stack.length - 1];
  const path = nodePath(stack);
  const kidsAll = explorerChildren(node, path);
  const cand = K.markerCandidates(kidsAll.filter((k) => k.isDir).map((k) => k.path));
  if (cand.length) { api.checkMarkers(cand).then((m) => { K.setMarkers(m); clsCache = new Map(); if (state.view === 'explorer') renderExplorer(); }); }
  const F = explorerFilter(kidsAll);
  const kids = F.apply(kidsAll);
  if (node.o && kids.length === kidsAll.length) kids.push({ other: true, size: node.o.s, count: node.o.k, files: node.o.f });

  const crumbs = stack.map((n, i) => `${i ? `<span class="crumb-sep">${icon('chevronR', 14)}</span>` : ''}<button class="crumb ${i === stack.length - 1 ? 'last' : ''}" data-act="crumb" data-i="${i}">${esc(n.n)}</button>`).join('');
  el.innerHTML = `<div class="page-head"><div><h1>${t('nav_explorer')}</h1></div>
    <div class="head-actions"><span class="muted" style="font-size:12px">${t('color_by')}</span>
      <div class="seg-ctl">${['category', 'safety', 'age'].map((m) => `<button class="${state.explorer.colorBy === m ? 'on' : ''}" data-act="colorby" data-m="${m}">${t(m === 'category' ? 'by_category' : m === 'safety' ? 'by_safety' : 'by_age')}</button>`).join('')}</div></div></div>
    <div class="crumbs">${stack.length > 1 ? `<button class="icon-btn" data-act="up" title="${t('up')}">${icon('arrowUp', 16)}</button>` : ''}${crumbs}
      <span class="muted num" style="margin-inline-start:auto;font-size:12.5px">${fmtBytes(node.s)} · ${fmtNum(node.f)} ${t('files')}</span></div>
    <div class="explorer-grid">
      <div class="card" style="padding:10px"><div class="treemap" id="treemap"></div></div>
      <div class="card" style="padding:12px 12px 8px">${F.bar({ count: fmtNum(kids.filter((k) => !k.other).length) + ' / ' + fmtNum(kidsAll.length) })}
        <div class="list" style="--cols: minmax(0,1fr) 110px 150px 90px 120px 130px">
          ${F.head([{ label: t('col_name'), sk: 'name' }, { label: t('col_size'), sk: 'size' }, { label: t('col_share') }, { label: t('col_items'), sk: 'files' }, { label: t('col_modified'), sk: 'mtime' }, { label: t('col_status') }])}
          ${kids.map((k) => explorerRow(k, node.s)).join('') || `<div class="empty">${t('no_results')}</div>`}
        </div></div></div>`;
  const tmItems = kids.map((k) => ({ ...k, value: k.size, label: esc(k.other ? t('other_items', { n: fmtNum(k.count) }) : k.name), sub: fmtBytes(k.size, true), color: colorFor(k) }));
  requestAnimationFrame(() => { const tm = $('#treemap'); if (!tm) return; Charts.treemap(tm, tmItems.slice().sort((a, b) => b.value - a.value), {
    rtl: I18N.lang === 'fa',
    onClick: (it) => { if (!it.other) openDrawer(it); },
    onDblClick: (it) => { if (it.isDir && it.node) { state.explorer.stack.push(it.node); renderExplorer(); } },
    tooltip: (e, it) => showTip(e, it && (it.other ? `<b>${t('other_items', { n: fmtNum(it.count) })}</b>${fmtBytes(it.size)}` :
      `<b>${esc(it.name)}</b>${fmtBytes(it.size)} · ${esc(P(cls(it.path, it.isDir).t))}<div style="margin-top:4px">${badge(cls(it.path, it.isDir).safety)}</div>`)),
  }); });
}
function explorerRow(k, total) {
  if (k.other) return `<div class="row row-other"><div class="row-name"><span class="fi" style="--c:var(--c-other)">${icon('layers', 16)}</span><span class="nm"><b>${t('other_items', { n: fmtNum(k.count) })}</b></span></div><span class="sz">${fmtBytes(k.size)}</span><div class="share"><div class="bar"><i style="width:${(k.size / total) * 100}%"></i></div></div><span class="num muted">${fmtNum(k.files || 0)}</span><span></span><span></span></div>`;
  const c = cls(k.path, k.isDir);
  const id = reg(k);
  const sel = state.drawerItem && state.drawerItem.path === k.path;
  return `<div class="row ${sel ? 'sel' : ''}" data-act="open" data-dbl="drill" data-id="${id}">
    <div class="row-name"><span class="fi" style="--c:${colorFor(k)}">${icon(fileIcon(k, c), 17)}</span><span class="nm"><b>${esc(k.name)}</b><span class="sub">${esc(P(c.t))}</span></span></div>
    <span class="sz">${fmtBytes(k.size)}</span>
    <div class="share"><div class="bar"><i style="width:${total ? (k.size / total) * 100 : 0}%"></i></div><span class="num">${fmtPct(total ? k.size / total : 0)}</span></div>
    <span class="num muted">${k.isDir ? fmtNum(k.files) : '—'}</span>
    <span class="muted" style="font-size:12px">${fmtAgo(k.mtime)}</span>
    <span>${badge(c.safety)}</span></div>`;
}

// ───────────────────────── largest files ─────────────────────────
function filesFilter(all) {
  return Filters.create('files', {
    text: (r) => r.x.p, ext: (r) => extOf(r.x.p), safety: (r) => r.c.safety,
    multi: [
      { key: 'safety', label: t('col_status'), icon: 'shield', options: safetyOptions(countBy(all, (r) => r.c.safety)), acc: (r) => r.c.safety },
      { key: 'group', label: T('نوع', 'Type'), icon: 'layers', options: groupOptions(countBy(all, (r) => groupOf(r.c))), acc: (r) => groupOf(r.c) },
      { key: 'ext', label: T('پسوند', 'Extension'), icon: 'file', options: topValues(all, (r) => extOf(r.x.p), 30).map(([e, n]) => ({ v: e, label: '.' + e, count: n })), acc: (r) => extOf(r.x.p) },
    ],
    size: { acc: (r) => r.x.s }, age: { acc: (r) => r.x.m, label: t('col_modified') },
    toggles: [{ key: 'deletable', label: T('فقط قابل حذف', 'Deletable only'), icon: 'trash', test: (r) => r.c.mode !== 'none' }, { key: 'hidden', label: T('نمایش پنهان‌شده‌ها', 'Show hidden'), icon: 'eyeOff', test: () => true }],
    sort: { options: [{ k: 'size', label: t('col_size'), acc: (r) => r.x.s }, { k: 'mtime', label: t('col_modified'), acc: (r) => r.x.m || 0 }, { k: 'name', label: t('col_name'), acc: (r) => baseName(r.x.p).toLowerCase() }, { k: 'safety', label: t('col_status'), acc: (r) => SAFETY_RANK[r.c.safety] }], default: { k: 'size', dir: -1 } },
  }, () => renderFiles());
}
function renderFiles() {
  const el = $('#view-files');
  if (!state.result) { el.innerHTML = noScan(); return; }
  const all = state.result.topFiles.filter((x) => !isDeleted(x.p)).map((x) => ({ x, c: cls(x.p, false) }));
  const F = filesFilter(all);
  const showHidden = F.state.toggles.has('hidden');
  const rows = F.apply(all).filter((r) => showHidden || !isHidden(r.x.p));
  const total = rows.reduce((a, b) => a + b.x.s, 0);
  const limit = state.limits.files || 150;
  el.innerHTML = `<div class="page-head"><div><h1>${t('nav_files')}</h1><p class="num">${fmtNum(rows.length)} · ${fmtBytes(total)}</p></div>
    <div class="head-actions"><button class="btn ghost sm" data-act="export-files">${icon('download', 14)}${t('export_csv')}</button></div></div>
    <div class="card" style="padding:12px 12px 8px">${F.bar({ count: fmtNum(rows.length) + ' / ' + fmtNum(all.length) })}
    <div class="list" style="--cols: minmax(0,1fr) 170px 110px 120px 130px">
      ${F.head([{ label: t('col_name'), sk: 'name' }, { label: t('file_type') }, { label: t('col_size'), sk: 'size' }, { label: t('col_modified'), sk: 'mtime' }, { label: t('col_status'), sk: 'safety' }])}
      ${rows.slice(0, limit).map(({ x, c }) => {
        const item = { path: x.p, name: baseName(x.p), size: x.s, isDir: false, mtime: x.m };
        const id = reg(item);
        return `<div class="row" data-act="open" data-id="${id}"><div class="row-name"><span class="fi" style="--c:${GROUPS[groupOf(c)].c}">${icon(fileIcon(item, c), 17)}</span><span class="nm"><b>${esc(item.name)}</b>${ptail(dirName(x.p))}</span></div>
          <span class="t2" style="font-size:12px">${esc(P(c.t))}</span><span class="sz">${fmtBytes(x.s)}</span><span class="muted" style="font-size:12px">${fmtAgo(x.m)}</span><span>${badge(c.safety)}</span></div>`;
      }).join('') || `<div class="empty">${t('no_results')}</div>`}
    </div>${rows.length > limit ? `<div style="text-align:center;padding:12px"><button class="btn ghost sm" data-act="more" data-k="files">${t('show_more')}</button></div>` : ''}</div>`;
}

// ───────────────────────── what changed ─────────────────────────
async function renderChanges() {
  const el = $('#view-changes');
  if (!state.result) { el.innerHTML = noScan(); return; }
  const ch = state.changes, r = state.result;
  const tabs = `<div class="tabs">${[['hot', 'ch_hotspots', 'trendUp'], ['files', 'ch_recent_files', 'files'], ['compare', 'ch_compare', 'activity']].map(([k, l, ic]) => `<button class="tab ${ch.tab === k ? 'on' : ''}" data-act="ch-tab" data-t="${k}">${icon(ic, 15)}${t(l)}</button>`).join('')}</div>`;
  let body = '';
  if (ch.tab === 'hot') {
    const all = r.hotspots.filter((h) => !isDeleted(h.p)).map((h) => ({ h, c: cls(h.p, true) }));
    const F = Filters.create('hot', {
      text: (x) => x.h.p, safety: (x) => x.c.safety,
      multi: [{ key: 'safety', label: t('col_status'), icon: 'shield', options: safetyOptions(countBy(all, (x) => x.c.safety)), acc: (x) => x.c.safety },
        { key: 'group', label: T('نوع', 'Type'), icon: 'layers', options: groupOptions(countBy(all, (x) => groupOf(x.c))), acc: (x) => groupOf(x.c) }],
      size: { acc: (x) => x.h.own7 || 0, presets: [0, 100 * 1048576, 1024 ** 3, 5 * 1024 ** 3] },
      sort: { options: [{ k: 'own7', label: t('in_7d'), acc: (x) => x.h.own7 || 0 }, { k: 'own', label: t('in_30d'), acc: (x) => x.h.own }, { k: 'size', label: t('col_size'), acc: (x) => x.h.s }], default: { k: 'own7', dir: -1 } },
    }, () => renderChanges());
    const list = F.apply(all).filter((x) => (x.h.own7 || 0) > 50 * 1048576 || F.state.sort.k !== 'own7');
    body = `<div class="card"><div class="card-head"><div><h3>${icon('trendUp', 18)}${t('ch_hotspots')}</h3><div class="sub" style="margin-top:4px">${t('ch_hot_sub')}</div></div></div>
      ${F.bar({ count: fmtNum(list.length) })}
      <div class="list" style="--cols: minmax(0,1fr) 120px 120px 110px 130px">
      ${F.head([{ label: t('col_path') }, { label: t('in_7d'), sk: 'own7' }, { label: t('in_30d'), sk: 'own' }, { label: t('col_size'), sk: 'size' }, { label: t('col_status') }])}
      ${list.map(({ h, c }) => {
        const id = reg({ path: h.p, name: baseName(h.p), size: h.s, isDir: true, r30: h.r30, r7: h.r7 });
        return `<div class="row" data-act="open" data-id="${id}"><div class="row-name"><span class="fi" style="--c:${GROUPS[groupOf(c)].c}">${icon(fileIcon({ isDir: true, path: h.p }, c), 17)}</span><span class="nm"><b>${esc(P(c.t))} · ${esc(baseName(h.p))}</b>${ptail(h.p)}</span></div>
          <span class="sz" style="color:${h.own7 > 0 ? 'var(--caution-t)' : 'inherit'}" title="${esc(fmtBytes(h.r7))}">+${fmtBytes(h.own7 || 0, true)}</span><span class="sz t2" title="${esc(fmtBytes(h.r30))}">+${fmtBytes(h.own, true)}</span><span class="num muted">${fmtBytes(h.s, true)}</span><span>${badge(c.safety)}</span></div>`;
      }).join('') || `<div class="empty">${t('no_results')}</div>`}</div></div>`;
  } else if (ch.tab === 'files') {
    const all = r.recentFiles.filter((x) => !isDeleted(x.p)).map((x) => ({ x, c: cls(x.p, false) }));
    const F = Filters.create('recent', {
      text: (y) => y.x.p, ext: (y) => extOf(y.x.p), safety: (y) => y.c.safety,
      multi: [{ key: 'safety', label: t('col_status'), icon: 'shield', options: safetyOptions(countBy(all, (y) => y.c.safety)), acc: (y) => y.c.safety },
        { key: 'ext', label: T('پسوند', 'Extension'), icon: 'file', options: topValues(all, (y) => extOf(y.x.p)).map(([e, n]) => ({ v: e, label: '.' + e, count: n })), acc: (y) => extOf(y.x.p) }],
      size: { acc: (y) => y.x.s }, age: { acc: (y) => y.x.m },
      sort: { options: [{ k: 'size', label: t('col_size'), acc: (y) => y.x.s }, { k: 'mtime', label: t('col_modified'), acc: (y) => y.x.m }], default: { k: 'size', dir: -1 } },
    }, () => renderChanges());
    const list = F.apply(all);
    body = `<div class="card">${F.bar({ count: fmtNum(list.length) })}<div class="list" style="--cols: minmax(0,1fr) 170px 110px 130px 130px">
      ${F.head([{ label: t('col_name') }, { label: t('file_type') }, { label: t('col_size'), sk: 'size' }, { label: t('col_modified'), sk: 'mtime' }, { label: t('col_status') }])}
      ${list.slice(0, 400).map(({ x, c }) => {
        const item = { path: x.p, name: baseName(x.p), size: x.s, isDir: false, mtime: x.m };
        const id = reg(item);
        return `<div class="row" data-act="open" data-id="${id}"><div class="row-name"><span class="fi" style="--c:${GROUPS[groupOf(c)].c}">${icon(fileIcon(item, c), 17)}</span><span class="nm"><b>${esc(item.name)}</b>${ptail(dirName(x.p))}</span></div>
          <span class="t2" style="font-size:12px">${esc(P(c.t))}</span><span class="sz">${fmtBytes(x.s)}</span><span style="font-size:12px;color:var(--caution-t)">${fmtAgo(x.m)}</span><span>${badge(c.safety)}</span></div>`;
      }).join('') || `<div class="empty">${t('no_results')}</div>`}</div></div>`;
  } else {
    body = await compareView();
  }
  el.innerHTML = `<div class="page-head"><div><h1>${t('nav_changes')}</h1><p>${t('ch_hot_sub')}</p></div></div>
    <div class="kpis" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi k-warn"><div class="k-ic">${icon('trendUp', 18)}</div><div class="k-val num">${fmtBytes(r.tree.r7)}</div><div class="k-lbl">${t('kpi_growth7')}</div></div>
      <div class="kpi"><div class="k-ic">${icon('activity', 18)}</div><div class="k-val num">${fmtBytes(r.tree.r30)}</div><div class="k-lbl">${t('kpi_growth30')}</div></div>
      <div class="kpi"><div class="k-ic">${icon('clock', 18)}</div><div class="k-val" style="font-size:16px">${fmtDate(r.finishedAt)}</div><div class="k-lbl">${t('last_scan', { t: fmtAgo(r.finishedAt) })}</div></div>
    </div>${tabs}${body}`;
  if (ch.tab === 'compare') { const s = $('#snapSel'); if (s) s.addEventListener('change', (e) => { ch.snapTs = Number(e.target.value); ch.snap = null; renderChanges(); }); }
}

async function compareView() {
  const ch = state.changes, r = state.result;
  const root = r.root;
  ch.snaps = (await api.snapshots(root)).filter((ts) => ts < r.finishedAt - 1000);
  if (!ch.snaps.length) return `<div class="card"><div class="empty">${icon('clock', 42)}<div>${t('ch_no_snap')}</div></div></div>`;
  if (!ch.snapTs || !ch.snaps.includes(ch.snapTs)) ch.snapTs = ch.snaps[0];
  if (!ch.snap || ch.snap.ts !== ch.snapTs) ch.snap = await api.snapshot(root, ch.snapTs);
  const prev = ch.snap;
  if (!prev) return '';
  const MIN = 100 * 1048576;
  const chosen = Compare.compare(r.folders.map((f) => [f.p, f.s]), prev.folders, MIN).map((x) => ({ ...x, c: cls(x.p, true) }));
  const F = Filters.create('compare', {
    text: (x) => x.p, safety: (x) => x.c.safety,
    multi: [{ key: 'safety', label: t('col_status'), icon: 'shield', options: safetyOptions(countBy(chosen, (x) => x.c.safety)), acc: (x) => x.c.safety }],
    toggles: [{ key: 'grew', label: T('فقط بزرگ‌شده‌ها', 'Growth only'), icon: 'trendUp', test: (x) => x.own > 0 }, { key: 'shrank', label: T('فقط کوچک‌شده‌ها', 'Shrink only'), icon: 'arrowDown', test: (x) => x.own < 0 }, { key: 'new', label: T('فقط جدیدها', 'New only'), icon: 'plus', test: (x) => x.isNew }],
    size: { acc: (x) => Math.abs(x.own), presets: [0, 100 * 1048576, 1024 ** 3, 5 * 1024 ** 3] },
    sort: { options: [{ k: 'own', label: t('col_growth'), acc: (x) => x.own }, { k: 'now', label: t('col_size'), acc: (x) => x.now }], default: { k: 'own', dir: -1 } },
  }, () => renderChanges());
  const list = F.apply(chosen);
  const net = r.stats.bytes - prev.stats.bytes;
  const fileOld = new Map(prev.files.map(([p, s]) => [lowerP(p), s]));
  const newFiles = r.topFiles.filter((f) => f.s >= MIN && (!fileOld.has(lowerP(f.p)) || f.s - fileOld.get(lowerP(f.p)) >= MIN)).slice(0, 30);
  return `<div class="card" style="margin-bottom:16px"><div class="card-head"><div><h3>${icon('activity', 18)}${t('ch_compare')}</h3><div class="sub" style="margin-top:4px">${t('ch_compare_sub')}</div></div>
      <div style="display:flex;gap:10px;align-items:center"><span class="muted">${t('ch_vs')}</span><select class="input" id="snapSel">${ch.snaps.map((ts) => `<option value="${ts}" ${ts === ch.snapTs ? 'selected' : ''}>${fmtDate(ts, true)} · ${fmtAgo(ts)}</option>`).join('')}</select></div></div>
    <div class="kpi ${net > 0 ? 'k-warn' : 'k-safe'}" style="margin-bottom:14px;display:flex;gap:14px;align-items:center"><div class="k-ic" style="margin:0">${icon(net > 0 ? 'trendUp' : 'check', 18)}</div><div><div class="k-val num">${net > 0 ? '+' : ''}${fmtBytes(net)}</div><div class="k-lbl">${t('ch_net')}</div></div></div>
    ${F.bar({ count: fmtNum(list.length) })}
    <div class="list" style="--cols: minmax(0,1fr) 130px 110px 130px">
      ${F.head([{ label: t('col_path') }, { label: t('col_growth'), sk: 'own' }, { label: t('col_size'), sk: 'now' }, { label: t('col_status') }])}
      ${list.slice(0, 100).map((x) => {
        const id = reg({ path: x.p, name: baseName(x.p), size: x.now, isDir: true });
        return `<div class="row" data-act="open" data-id="${id}"><div class="row-name"><span class="fi" style="--c:${GROUPS[groupOf(x.c)].c}">${icon(fileIcon({ isDir: true, path: x.p }, x.c), 17)}</span><span class="nm"><b>${esc(P(x.c.t))} · ${esc(baseName(x.p))} ${x.isNew ? `<span class="tag">${t('ch_new')}</span>` : ''}</b>${ptail(x.p)}</span></div>
        <span class="sz" style="color:${x.own > 0 ? 'var(--caution-t)' : 'var(--safe-t)'}">${x.own > 0 ? '+' : ''}${fmtBytes(x.own, true)}</span><span class="num muted">${fmtBytes(x.now, true)}</span><span>${badge(x.c.safety)}</span></div>`;
      }).join('') || `<div class="empty">${t('no_results')}</div>`}</div></div>
    ${newFiles.length ? `<div class="card"><div class="card-head"><h3>${icon('files', 18)}${t('ch_recent_files')}</h3></div><div class="list" style="--cols: minmax(0,1fr) 120px 130px">${newFiles.map((f) => {
      const c = cls(f.p, false); const item = { path: f.p, name: baseName(f.p), size: f.s, isDir: false, mtime: f.m }; const id = reg(item);
      return `<div class="row" data-act="open" data-id="${id}"><div class="row-name"><span class="fi" style="--c:${GROUPS[groupOf(c)].c}">${icon(fileIcon(item, c), 17)}</span><span class="nm"><b>${esc(item.name)}</b>${ptail(dirName(f.p))}</span></div><span class="sz">${fmtBytes(f.s)}</span><span>${badge(c.safety)}</span></div>`;
    }).join('')}</div></div>` : ''}`;
}

// ───────────────────────── smart cleanup ─────────────────────────
function cleanupGroups(filterFn) {
  const items = filterFn(state.derived.items.filter((i) => !isDeleted(i.path) && !isHidden(i.path)));
  const generic = new Set(['downloads', 'user-folders', 'onedrive', 'laragon-www', 'drive']);
  return {
    safe: items.filter((i) => i.c.safety === 'safe' && i.c.mode !== 'none'),
    tool: items.filter((i) => i.c.mode === 'none' && i.c.action && i.size > 50 * 1048576),
    caution: items.filter((i) => i.c.safety === 'caution' && i.c.mode !== 'none'),
    user: items.filter((i) => i.c.safety === 'user' && i.c.mode !== 'none' && !generic.has(i.c.id) && i.size > 50 * 1048576),
  };
}
function selectedItems() {
  const sel = state.cleanup.selected;
  const list = state.derived.items.filter((i) => sel.has(i.path) && !isDeleted(i.path));
  return list.filter((i) => !list.some((o) => o !== i && lowerP(i.path).startsWith(lowerP(o.path) + '\\')));
}
function renderCleanup() {
  const el = $('#view-cleanup');
  if (!state.result) { el.innerHTML = noScan(); return; }
  const base = state.derived.items.filter((i) => !isDeleted(i.path) && !isHidden(i.path));
  const F = Filters.create('cleanup', {
    text: (i) => i.path + ' ' + P(i.c.t), ext: (i) => (i.isDir ? '' : extOf(i.path)), safety: (i) => i.c.safety,
    multi: [{ key: 'group', label: T('نوع', 'Type'), icon: 'layers', options: groupOptions(countBy(base, (i) => groupOf(i.c))), acc: (i) => groupOf(i.c) },
      { key: 'kind', label: T('پوشه/فایل', 'Folder/file'), icon: 'folder', options: [{ v: 'dir', label: T('پوشه‌ها', 'Folders') }, { v: 'file', label: T('فایل‌ها', 'Files') }], acc: (i) => (i.isDir ? 'dir' : 'file') }],
    size: { acc: (i) => i.size }, age: { acc: (i) => i.mtime, label: t('col_modified') },
    toggles: [{ key: 'contents', label: T('فقط «پاک‌کردن محتویات»', '“Empty contents” only'), icon: 'broom', test: (i) => i.c.mode === 'contents' }, { key: 'recent', label: T('رشد اخیر', 'Grew recently'), icon: 'trendUp', test: (i) => (i.r30 || 0) > 100 * 1048576 || (i.mtime || 0) > Date.now() - 30 * 86400000 }],
    sort: { options: [{ k: 'size', label: t('col_size'), acc: (i) => i.size }, { k: 'name', label: t('col_name'), acc: (i) => P(i.c.t) }, { k: 'mtime', label: t('col_modified'), acc: (i) => i.mtime || 0 }], default: { k: 'size', dir: -1 } },
  }, () => renderCleanup());
  const g = cleanupGroups((list) => F.apply(list));
  const sum = (arr) => arr.reduce((a, b) => a + b.size, 0);
  const section = (key, title, sub, ic, list, selectable) => list.length ? `<div class="card cl-group"><div class="card-head"><div><h3>${icon(ic, 18)}${t(title)} <span class="muted num" style="font-weight:600">· ${fmtBytes(sum(list.filter((i) => !hasSafeAncestor(i))))} · ${fmtNum(list.length)}</span></h3><div class="sub" style="margin-top:3px">${t(sub)}</div></div>
      ${key === 'safe' ? `<div style="display:flex;gap:6px"><button class="btn ghost sm" data-act="sel-all-safe">${icon('check', 14)}${t('select_all_safe')}</button><button class="btn ghost sm" data-act="sel-clear">${t('clear_sel')}</button></div>` : ''}</div>
    <div class="list" style="--cols: ${selectable ? '26px ' : ''}minmax(0,1fr) 110px 130px 170px">${list.map((i) => cleanupRow(i, selectable)).join('')}</div></div>` : '';
  const usedActions = new Set(GENERAL_TOOLS);
  for (const i of state.derived.items) if (i.c.action) usedActions.add(i.c.action);
  const sel = selectedItems();
  el.innerHTML = `<div class="page-head"><div><h1>${t('nav_cleanup')}</h1><p>${t('cl_safe_sub')}</p></div></div>
    <div class="card" style="padding:12px 14px 4px;margin-bottom:16px">${F.bar({ count: fmtNum(g.safe.length + g.tool.length + g.caution.length + g.user.length) })}</div>
    ${section('safe', 'cl_safe', 'cl_safe_sub', 'shieldCheck', g.safe, true)}
    ${section('tool', 'cl_tool', 'cl_tool_sub', 'terminal', g.tool, false)}
    ${section('caution', 'cl_caution', 'cl_caution_sub', 'alert', g.caution, true)}
    ${section('user', 'cl_user', 'cl_user_sub', 'user', g.user, true)}
    <div class="card cl-group"><div class="card-head"><h3>${icon('gear', 18)}${t('cl_system')}</h3></div>
      <div class="tools">${[...usedActions].filter((a) => K.ACTIONS[a] && !['openVirtualMemory', 'openApps', 'openIndexing', 'compactVhdx'].includes(a)).map(toolCard).join('')}</div></div>
    <div class="cl-bar"><div><div class="tot num">${fmtBytes(sum(sel))}</div><div class="muted" style="font-size:12px">${t('selected_n', { n: fmtNum(sel.length) })}</div></div>
      <div style="flex:1"></div><button class="btn primary" data-act="clean-selected" ${sel.length ? '' : 'disabled'}>${icon('broom', 16)}${t('clean_selected')}</button></div>`;
}
function cleanupRow(i, selectable) {
  const id = reg(i);
  const c = i.c;
  const checked = state.cleanup.selected.has(i.path);
  const contents = c.mode === 'contents' && i.isDir;
  return `<div class="row ${checked ? 'sel' : ''}" data-act="open" data-id="${id}">
    ${selectable ? `<input type="checkbox" class="chk" data-act="toggle-sel" data-id="${id}" ${checked ? 'checked' : ''}>` : ''}
    <div class="row-name"><span class="fi" style="--c:${GROUPS[groupOf(c)].c}">${icon(fileIcon(i, c), 17)}</span><span class="nm"><b>${esc(P(c.t))} ${contents ? `<span class="tag">${t('contents_only')}</span>` : ''}</b>${ptail(i.path)}</span></div>
    <span class="sz">${fmtBytes(i.size)}</span><span>${badge(c.safety)}</span>
    <span>${c.action && K.ACTIONS[c.action] ? `<button class="btn ghost xs" data-act="run-action" data-a="${c.action}" data-id="${id}">${icon(K.ACTIONS[c.action].icon || 'zap', 13)}${esc(P(K.ACTIONS[c.action].t))}</button>` : ''}</span></div>`;
}
function toolCard(a) {
  const A = K.ACTIONS[a];
  return `<div class="tool"><div class="tool-top"><span class="tool-ic">${icon(A.icon || 'zap', 18)}</span><b>${esc(P(A.t))}</b></div><p>${esc(P(A.d))}</p>
    <div class="tool-foot">${A.admin ? `<span class="tag admin">${icon('shield', 12)}${t('needs_admin')}</span>` : '<span></span>'}<button class="btn ghost sm" data-act="run-action" data-a="${a}">${icon('play', 12)}${t('run')}</button></div></div>`;
}

// ───────────────────────── apps ─────────────────────────
const iconCache = new Map();
async function renderApps() {
  const el = $('#view-apps');
  const A = state.apps;
  if (!A.list && !A.loading) {
    A.loading = true;
    el.innerHTML = `<div class="page-head"><div><h1>${t('apps_title')}</h1><p>${t('apps_sub')}</p></div></div><div class="card">${'<div class="skeleton"></div>'.repeat(8)}</div>`;
    const ctx = await api.sysContext();
    A.list = ctx.apps; A.loading = false;
    if (state.view === 'apps') renderApps();
    return;
  }
  if (!A.list) return;
  const sizes = new Map((state.result?.folders || []).map((f) => [lowerP(f.p), f.s]));
  const all = A.list.map((a) => {
    let size = 0, measured = false;
    const lc = a.location ? cls(a.location, true) : null;
    if (a.location && state.result && lowerP(a.location).startsWith(lowerP(state.result.root)) && !lc.container && lc.cat !== 'system' && a.location.split(/[\\/]/).filter(Boolean).length >= 2) {
      const s = sizes.get(lowerP(a.location));
      if (s) { size = s; measured = true; } else { const ch = findNodeChain(a.location); if (ch) { size = ch[ch.length - 1].s; measured = true; } }
    }
    if (!measured) size = a.estKB * 1024;
    const date = /^\d{8}$/.test(a.date) ? new Date(+a.date.slice(0, 4), +a.date.slice(4, 6) - 1, +a.date.slice(6, 8)).getTime() : 0;
    return { ...a, size, measured, dateMs: date };
  });
  const F = Filters.create('apps', {
    text: (a) => a.name + ' ' + a.publisher + ' ' + a.location,
    multi: [{ key: 'pub', label: t('publisher'), icon: 'user', options: topValues(all, (a) => a.publisher || '—', 40).map(([p, n]) => ({ v: p, label: p, count: n })), acc: (a) => a.publisher || '—' }],
    size: { acc: (a) => a.size }, age: { acc: (a) => a.dateMs, label: T('تاریخ نصب', 'Install date') },
    toggles: [{ key: 'measured', label: T('فقط اندازه‌گیری‌شده', 'Measured only'), icon: 'check', test: (a) => a.measured }, { key: 'uninst', label: T('قابل حذف', 'Uninstallable'), icon: 'trash', test: (a) => !!a.uninstall }],
    sort: { options: [{ k: 'size', label: t('col_size'), acc: (a) => a.size }, { k: 'name', label: t('col_name'), acc: (a) => a.name.toLowerCase() }, { k: 'date', label: T('تاریخ نصب', 'Install date'), acc: (a) => a.dateMs }], default: { k: 'size', dir: -1 } },
  }, () => renderApps());
  const rows = F.apply(all);
  const total = rows.reduce((s, a) => s + a.size, 0);
  const maxS = Math.max(1, ...rows.map((a) => a.size));
  el.innerHTML = `<div class="page-head"><div><h1>${t('apps_title')}</h1><p>${t('apps_sub')}</p></div>
    <div class="head-actions"><button class="btn ghost sm" data-act="apps-refresh">${icon('refresh', 14)}</button></div></div>
    <div class="card" style="padding:12px 12px 8px">${F.bar({ count: fmtNum(rows.length) + ' · ' + fmtBytes(total, true) })}<div class="list" style="--cols: minmax(0,1fr) 110px 150px 130px 210px">
      ${F.head([{ label: t('col_name'), sk: 'name' }, { label: t('col_size'), sk: 'size' }, { label: t('col_share') }, { label: T('تاریخ نصب', 'Installed'), sk: 'date' }, { label: '' }])}
      ${rows.map((a) => {
        const id = reg(a);
        return `<div class="row" style="cursor:default"><div class="row-name"><span class="app-ic" data-icon-src="${esc(a.icon)}">${icon('grid', 16)}</span><span class="nm"><b>${esc(a.name)}</b><span class="sub">${esc(a.publisher)}${a.version ? ' · ' + esc(a.version) : ''}</span></span></div>
          <span><span class="sz">${a.size ? fmtBytes(a.size) : '—'}</span><br><span class="muted" style="font-size:10.5px">${a.size ? t(a.measured ? 'measured' : 'estimated') : ''}</span></span>
          <div class="share"><div class="bar"><i style="width:${(a.size / maxS) * 100}%"></i></div></div>
          <span class="muted" style="font-size:12px">${a.dateMs ? fmtDate(a.dateMs) : '—'}</span>
          <span style="display:flex;gap:6px;justify-content:flex-end">${a.location ? `<button class="btn ghost xs" data-act="reveal-path" data-p="${esc(a.location)}">${icon('external', 12)}${t('open_location')}</button>` : ''}
          ${a.uninstall ? `<button class="btn ghost xs" data-act="uninstall" data-id="${id}" style="color:var(--danger-t)">${icon('trash', 12)}${t('uninstall')}</button>` : ''}</span></div>`;
      }).join('') || `<div class="empty">${t('no_results')}</div>`}</div></div>`;
  for (const elx of $$('[data-icon-src]', el)) {
    const src = elx.dataset.iconSrc;
    if (!src || !/\.(exe|ico|dll)$/i.test(src)) continue;
    if (iconCache.has(src)) { const d = iconCache.get(src); if (d) elx.innerHTML = `<img src="${d}" alt="">`; continue; }
    api.icon(src).then((d) => { iconCache.set(src, d); if (d && /^data:image\/png;base64,/.test(d)) elx.innerHTML = `<img src="${d}" alt="">`; }).catch(() => {});
  }
}

function noScan() {
  return `<div class="empty" style="height:70%">${icon('disk', 42)}<div>${t('no_scan')}</div><button class="btn primary" data-act="scan" data-drive="${esc(state.drive || '')}">${icon('play', 14)}${t('scan_drive', { d: esc(state.drive || '') })}</button></div>`;
}

// ───────────────────────── drawer ─────────────────────────
function openDrawer(item) {
  state.drawerItem = item;
  const c = cls(item.path, item.isDir);
  const g = GROUPS[groupOf(c)];
  const ext = !item.isDir ? K.extInfo(item.name || baseName(item.path), I18N.lang) : null;
  const srcLine = c.source === 'rule' ? t('d_src_rule') : c.source === 'parent' ? t('d_src_parent', { p: baseName(c.via || '') }) : c.source === 'location' ? t('d_src_location') : c.source === 'ext' ? t('d_src_ext') : t('d_src_unknown');
  const contentsMode = item.isDir && c.mode === 'contents' && c.source === 'rule';
  const userProt = isProtectedByUser(item.path);
  const canDelete = c.mode !== 'none' && !userProt;
  const id = reg(item);
  const A = c.action && K.ACTIONS[c.action];
  const howIsCmd = /^[a-z][\w.-]* [\w-]/i.test(P(c.h)) && !/[؀-ۿ]/.test(P(c.h));
  const hidden = isHidden(item.path);
  const ai = state.aiAnswers.get(lowerP(item.path) + '|' + I18N.lang);
  $('#drawerBody').innerHTML = `
    <div class="d-top"><div class="d-ic" style="--c:${g.c}">${icon(fileIcon(item, c), 26)}</div>
      <div class="d-name"><h2>${esc(item.name || baseName(item.path))}</h2><div class="path">${esc(item.path)}</div></div>
      <button class="icon-btn" data-act="close-drawer">${icon('x', 18)}</button></div>
    <div class="d-size"><b class="num">${fmtBytes(item.size)}</b><span class="muted">${item.isDir && item.files != null ? fmtNum(item.files) + ' ' + t('files') : ext ? esc(ext) : ''}</span></div>
    <div class="d-verdict ${c.safety}"><span class="vi">${icon(SAFETY_ICON[c.safety] || 'help', 22)}</span><div><b>${esc(P(K.SAFETY[c.safety]))} — ${esc(P(c.t))}</b><span>${esc(srcLine)} · ${esc(P(GROUPS[groupOf(c)]))}</span></div></div>
    ${userProt ? `<div class="callout">${icon('shieldPlus', 16)}<span>${T('این مسیر را خودتان محافظت کرده‌اید؛ DriveHound آن را حذف یا منتقل نمی‌کند.', 'You protected this path; DriveHound will not delete or move it.')}</span></div>` : ''}
    <div class="d-sec"><h4>${icon('info', 14)}${t('d_what')}</h4><p>${esc(P(c.d))}</p></div>
    ${P(c.i) ? `<div class="d-sec"><h4>${icon('alert', 14)}${t('d_impact')}</h4><p>${esc(P(c.i))}</p></div>` : ''}
    ${P(c.h) ? `<div class="d-sec"><h4>${icon('zap', 14)}${t('d_how')}</h4><p>${howIsCmd ? `<code>${esc(P(c.h))}</code>` : esc(P(c.h))}</p>
      ${A ? `<div style="margin-top:10px"><button class="btn primary sm" data-act="run-action" data-a="${c.action}" data-id="${id}">${icon(A.icon || 'zap', 14)}${esc(P(A.t))}${A.admin ? ` <span class="tag admin" style="background:rgba(0,0,0,.2);color:#fff;border:0">${t('needs_admin')}</span>` : ''}</button></div>` : ''}</div>` : ''}
    <div id="aiBox">${ai ? aiCard(ai) : `<button class="btn ghost sm" data-act="ask-ai" data-id="${id}" style="margin:6px 0">${icon('bot', 15)}${T('از هوش مصنوعی بپرس', 'Ask AI')}</button>`}</div>
    <div class="d-sec"><h4>${icon('layers', 14)}${t('d_deps')}</h4><div id="depsBox"><div class="muted" style="font-size:12px">${t('d_checking')}</div><div class="skeleton"></div><div class="skeleton" style="width:70%"></div></div></div>
    <div class="d-actions">
      ${canDelete ? `<button class="btn ${c.safety === 'safe' ? 'safe' : 'danger'} sm" id="dDelete" data-act="delete-one" data-id="${id}" data-contents="${contentsMode ? 1 : 0}">${icon(contentsMode ? 'broom' : 'trash', 14)}${t(contentsMode ? 'empty_folder' : 'delete')}</button>` : `<span class="tag">${icon('lock', 12)}${t('delete_disabled')}</span>`}
      ${item.isDir && findNodeChain(item.path) ? `<button class="btn ghost sm" data-act="drill-to" data-id="${id}">${icon('folderTree', 14)}${t('open_folder')}</button>` : ''}
      ${item.isDir && !userProt && c.safety !== 'danger' ? `<button class="btn ghost sm" data-act="move-item" data-id="${id}">${icon('move', 14)}${T('انتقال به درایو دیگر', 'Move to another drive')}</button>` : ''}
      ${item.isDir && c.cat !== 'system' && c.safety !== 'danger' ? `<button class="btn ghost sm" data-act="compress-item" data-id="${id}">${icon('compress', 14)}${T('فشرده‌سازی NTFS', 'NTFS compress')}</button>` : ''}
      <button class="btn ghost sm" data-act="reveal" data-id="${id}">${icon('external', 14)}${t('reveal')}</button>
      <button class="btn ghost sm" data-act="copy" data-id="${id}">${icon('copy', 14)}${t('copy_path')}</button>
      <button class="btn ghost sm" data-act="toggle-protect" data-id="${id}">${icon('shieldPlus', 14)}${userProt ? T('برداشتن محافظت', 'Unprotect') : T('محافظت از این مسیر', 'Protect this path')}</button>
      <button class="btn ghost sm" data-act="toggle-hide" data-id="${id}">${icon('eyeOff', 14)}${hidden ? T('نمایش در پیشنهادها', 'Show in suggestions') : T('پنهان از پیشنهادها', 'Hide from suggestions')}</button>
    </div>`;
  $('#drawer').classList.add('open');
  $('#drawer').setAttribute('aria-hidden', 'false');
  $$('.row.sel').forEach((r) => r.classList.remove('sel'));
  $$(`.row[data-id="${CSS.escape(id)}"]`).forEach((r) => r.classList.add('sel'));
  loadDeps(item);
}

function aiCard(a) {
  if (a.error) return `<div class="callout bad">${icon('xCircle', 16)}<span>${esc(a.error)}</span></div>`;
  return `<div class="ai-card"><h5>${icon('bot', 16)}${T('پاسخ هوش مصنوعی', 'AI answer')}: ${esc(a.title)} ${badge(a.safety)} <span class="tag">${T('اطمینان', 'confidence')}: ${esc(a.confidence)}</span></h5>
    ${a.owner ? `<p><b>${T('متعلق به', 'Owner')}:</b> ${esc(a.owner)}</p>` : ''}
    <span class="k">${t('d_what')}</span><p>${esc(a.what)}</p>
    <span class="k">${t('d_impact')}</span><p>${esc(a.impact)}</p>
    <span class="k">${t('d_how')}</span><p>${esc(a.howto)}</p>
    <p class="muted" style="font-size:11px;margin-top:8px">${esc([a.provider, a.model].filter(Boolean).join(' · '))}${a.cached ? ' · ' + T('از حافظه', 'cached') : ''} · ${T('پاسخ هوش مصنوعی ممکن است اشتباه باشد؛ وابستگی‌ها را هم بررسی کنید.', 'AI answers can be wrong; check dependencies too.')}</p></div>`;
}

async function loadDeps(item) {
  let info;
  try { info = await api.inspect(item.path); } catch (e) { info = { exists: false, error: String(e.message || e) }; }
  if (state.drawerItem !== item) return;
  const box = $('#depsBox');
  if (!box) return;
  if (!info.exists) { box.innerHTML = `<div class="dep warn">${icon('alert')}<span>${esc(info.error || 'missing')}</span></div>`; return; }
  const o = info.owners || {};
  const deps = [];
  const busy = (o.processes?.length || 0) + (o.services?.length || 0) > 0 || info.inUse;
  if (info.isLink) deps.push(['info', 'link', T('این یک Junction/لینک است', 'This is a junction/link'), info.linkTarget || '']);
  if (o.processes?.length) deps.push(['bad', 'xCircle', t('dep_process'), o.processes.slice(0, 4).map((x) => `${x.name} (PID ${x.pid})`).join(', ')]);
  if (o.services?.length) deps.push(['bad', 'xCircle', t('dep_service'), o.services.slice(0, 4).map((x) => `${x.name} · ${x.state}`).join(', ')]);
  if (info.inUse) deps.push(['bad', 'lock', t('dep_inuse'), '']);
  if (o.startup?.length) deps.push(['warn', 'alert', t('dep_startup'), o.startup.map((x) => x.name).join(', ')]);
  if (o.path?.length) deps.push(['warn', 'alert', t('dep_path'), o.path.slice(0, 3).join('\n')]);
  if (o.apps?.length) deps.push(['warn', 'grid', t('dep_app'), o.apps.slice(0, 3).map((x) => x.name + (x.publisher ? ' — ' + x.publisher : '')).join(', ')]);
  if (info.project) deps.push(['info', 'code', `${t('dep_project')}: ${info.project.name} (${info.project.types.join(', ')})`, `${info.project.root}${info.project.lastTouched ? ' · ' + t('dep_project_touched', { t: fmtAgo(info.project.lastTouched) }) : ''}`]);
  if (info.forbidden) deps.push(['bad', 'lock', t('dep_protected'), info.forbidden]);
  if (!deps.length || deps.every((d) => d[0] === 'info')) deps.unshift(['ok', 'checkCircle', t('dep_none'), '']);
  let verdict = '';
  if (busy) verdict = `<div class="d-verdict danger" style="margin:0 0 10px"><span class="vi">${icon('xCircle', 18)}</span><div><b style="font-size:13px">${t('verdict_busy')}</b></div></div>`;
  else if (o.apps?.length && (cls(item.path, item.isDir).cat === 'apps')) verdict = `<div class="d-verdict caution" style="margin:0 0 10px"><span class="vi">${icon('alert', 18)}</span><div><b style="font-size:13px">${t('verdict_app')}</b></div></div>`;
  const facts = [];
  if (info.version && (info.version.description || info.version.company)) {
    if (info.version.description) facts.push([t('file_type'), esc(info.version.description) + (info.version.version ? ` <span class="muted ltr">${esc(info.version.version)}</span>` : '')]);
    if (info.version.company) facts.push([t('publisher'), esc(info.version.company)]);
  }
  facts.push([t('created'), `${fmtDate(info.birthtime)} <span class="muted">(${fmtAgo(info.birthtime)})</span>`]);
  facts.push([t('modified'), `${fmtDate(info.mtime)} <span class="muted">(${fmtAgo(info.mtime)})</span>`]);
  box.innerHTML = verdict + `<div class="deps">${deps.map(([k, ic, title, sub]) => `<div class="dep ${k}">${icon(ic)}<div>${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}</div></div>`).join('')}</div>
    <dl class="facts" style="margin-top:12px">${facts.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl>`;
  if (info.forbidden) { const b = $('#dDelete'); if (b) b.disabled = true; }
}
function closeDrawer() { state.drawerItem = null; $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true'); $$('.row.sel').forEach((r) => r.classList.remove('sel')); }

// ───────────────────────── modal / toast / tooltip / progress overlay ─────────────────────────
function modal(html, wide) {
  const root = $('#modalRoot');
  root.innerHTML = `<div class="modal" ${wide ? 'style="width:min(760px,94vw)"' : ''}>${html}</div>`;
  root.hidden = false;
  return root.firstElementChild;
}
function closeModal() { const r = $('#modalRoot'); r.hidden = true; r.innerHTML = ''; }
function toast(msg, kind = 'ok', ms = 4200) {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = icon(kind === 'ok' ? 'checkCircle' : kind === 'err' ? 'xCircle' : 'info', 18) + `<span>${msg}</span>`;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}
function showTip(e, html) {
  const tip = $('#tooltip');
  if (!e || !html) { tip.hidden = true; return; }
  tip.innerHTML = html; tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let x = e.clientX + 14, y = e.clientY + 14;
  if (x + w > innerWidth - 8) x = e.clientX - w - 14;
  if (y + h > innerHeight - 8) y = e.clientY - h - 14;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
function opOverlay(title) {
  let el = document.querySelector('.op-overlay');
  if (!el) { el = document.createElement('div'); el.className = 'op-overlay'; document.body.appendChild(el); }
  el.innerHTML = `<div class="op-box"><h3 style="margin:0 0 8px">${esc(title)}</h3><div class="muted num" id="opTxt" style="font-size:12.5px">…</div><div class="progress"><i id="opBar" style="width:3%"></i></div></div>`;
  return {
    update(txt, frac) { const a = $('#opTxt'), b = $('#opBar'); if (a) a.textContent = txt; if (b && frac != null) b.style.width = Math.max(3, Math.min(100, frac * 100)) + '%'; },
    close() { el.remove(); },
  };
}
function errText(e) { return esc(String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
function debounce(fn, ms) { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; }
async function saveSettings() {
  if (!state.env) return;                 // never persist before boot loaded the real settings
  state.settings = await api.setSettings(state.settings); K.setUserRules(state.settings.userRules); clsCache = new Map(); }

// ───────────────────────── deletion ─────────────────────────
function confirmDelete(items, after) {
  const total = items.reduce((a, b) => a + (b.size || 0), 0);
  const risky = items.some((i) => !i.c || i.c.safety !== 'safe');
  const hasContents = items.some((i) => i.contents);
  const qDrive = state.settings.quarantineDrive;
  let mode = state.settings.delMode === 'quarantine' && !qDrive ? 'trash' : state.settings.delMode;
  const m = modal(`<div class="modal-head">${icon('trash', 20)}<h3>${t('m_title')}</h3><button class="icon-btn" data-act="close-modal">${icon('x', 18)}</button></div>
    <div class="modal-body"><div class="num" style="font-weight:700">${t('m_items', { n: fmtNum(items.length), s: fmtBytes(total) })}</div>
      <div class="m-list">${items.map((i) => `<div class="m-item"><span style="min-width:0">${esc(i.c ? P(i.c.t) : baseName(i.path))}${i.contents ? ` <span class="tag">${t('contents_only')}</span>` : ''}${ptail(i.path)}</span><span class="num" style="font-weight:700">${fmtBytes(i.size || 0, true)}</span>${i.c ? badge(i.c.safety) : ''}</div>`).join('')}</div>
      <h4 style="margin:0 0 8px;font-size:13px">${t('m_mode')}</h4>
      <label class="radio-card ${mode === 'trash' ? 'on' : ''}" data-mode="trash"><input type="radio" name="dm" value="trash" ${mode === 'trash' ? 'checked' : ''}><div><b>${t('m_trash')}</b><span>${t('m_trash_note')}</span></div></label>
      <label class="radio-card ${mode === 'quarantine' ? 'on' : ''} ${qDrive ? '' : 'disabled'}" data-mode="quarantine" ${qDrive ? '' : 'style="opacity:.55"'}><input type="radio" name="dm" value="quarantine" ${mode === 'quarantine' ? 'checked' : ''} ${qDrive ? '' : 'disabled'}><div><b>${T('قرنطینه روی درایو ', 'Quarantine on drive ')}${esc(qDrive || '—')}</b><span>${qDrive ? T(`فضا فوراً آزاد می‌شود و تا ${fmtNum(state.settings.quarantineDays)} روز قابل بازگشت است.`, `Frees space now and stays restorable for ${state.settings.quarantineDays} days.`) : T('ابتدا در تنظیمات یک درایو قرنطینه انتخاب کنید.', 'Choose a quarantine drive in Settings first.')}</span></div></label>
      <label class="radio-card ${mode === 'permanent' ? 'on' : ''}" data-mode="permanent"><input type="radio" name="dm" value="permanent" ${mode === 'permanent' ? 'checked' : ''}><div><b>${t('m_perm')}</b><span>${t('m_perm_note')}</span></div></label>
      ${hasContents ? `<div class="note">${icon('info', 14)}<span>${t('m_contents_note')}</span></div>` : ''}
      <div class="note">${icon('info', 14)}<span>${t('m_close_apps')}</span></div>
      ${risky ? `<label class="ack" style="margin-top:12px"><input type="checkbox" id="ackBox">${t('m_ack')}</label>` : ''}
      <div id="delProgress"></div></div>
    <div class="modal-foot"><button class="btn ghost" data-act="close-modal">${t('cancel')}</button><button class="btn danger" id="delGo" ${risky ? 'disabled' : ''}>${icon('trash', 15)}${t('m_confirm')}</button></div>`);
  $$('.radio-card', m).forEach((rc) => rc.addEventListener('click', () => { if (rc.dataset.mode === 'quarantine' && !qDrive) return; mode = rc.dataset.mode; $$('.radio-card', m).forEach((x) => x.classList.toggle('on', x === rc)); }));
  const ack = $('#ackBox', m);
  if (ack) ack.addEventListener('change', () => { $('#delGo', m).disabled = !ack.checked; });
  $('#delGo', m).addEventListener('click', async () => {
    $('#delGo', m).disabled = true;
    $$('.radio-card,.ack', m).forEach((x) => (x.style.pointerEvents = 'none'));
    const prog = $('#delProgress', m);
    prog.innerHTML = `<div class="progress"><i style="width:2%"></i></div><div class="muted num" id="delTxt" style="font-size:12px">${t('m_working', { d: 0, t: fmtNum(items.length) })}</div>`;
    const off = api.onDeleteProgress(({ done, total: tt, copying }) => { const bar = $('.progress > i', prog); if (bar) bar.style.width = (done / tt) * 100 + '%'; const tx = $('#delTxt'); if (tx) tx.textContent = copying ? T('در حال انتقال به قرنطینه…', 'Copying to quarantine…') : t('m_working', { d: fmtNum(done), t: fmtNum(tt) }); });
    let res;
    try { res = await api.delete(items.map((i) => ({ path: i.path, size: i.size || 0, contents: !!i.contents })), mode); }
    catch (e) { off(); closeModal(); toast(errText(e), 'err'); return; }
    off();
    closeModal();
    afterDelete(items, res, mode);
    if (after) after(res);
  });
}

async function afterDelete(items, res, mode) {
  let freed = 0, failed = 0, locked = 0, trashed = false, quarantined = false;
  for (const r of res) {
    const it = items.find((i) => i.path === r.path);
    if (r.ok) {
      freed += r.freed || 0;
      locked += r.failed || 0;
      if (r.trashed) trashed = true;
      if (r.quarantined) quarantined = true;
      if (it) {
        if (it.contents) contentsCleared(it.path, r.freed || 0);
        else { state.deleted.add(lowerP(it.path)); removeFromTree(it.path, r.trashed ? (it.size || 0) : (r.failed ? r.freed : (it.size || 0)), !r.failed); }
        state.cleanup.selected.delete(it.path);
      }
    } else failed++;
  }
  recomputeReclaim();
  const parts = [t('m_done', { s: fmtBytes(freed) })];
  if (trashed) parts.push(t('m_trash_note'));
  if (quarantined) parts.push(T('در قرنطینه قابل بازگشت است', 'restorable from quarantine'));
  if (locked) parts.push(t('m_partial', { n: fmtNum(locked) }));
  if (failed) {
    const firstErr = res.find((r) => !r.ok);
    parts.push(t('m_failed', { n: fmtNum(failed) }) + (firstErr ? ' (' + esc(firstErr.error) + ')' : ''));
  }
  toast(parts.join(' · '), failed && !freed ? 'err' : 'ok', 8000);
  state.drives = await api.drives();
  state.freeHist = null;
  closeDrawer();
  renderChrome(); renderView();
}
function contentsCleared(path, bytes) {
  const chain = findNodeChain(path);
  const item = state.derived?.items.find((i) => i.path === path);
  if (item) { item.size = Math.max(0, item.size - bytes); if (item.size < 1048576) state.deleted.add(lowerP(path)); }
  if (chain) { for (const n of chain) n.s = Math.max(0, n.s - bytes); const last = chain[chain.length - 1]; last.c = []; last.fl = []; delete last.o; }
}

// ───────────────────────── actions ─────────────────────────
function runAction(id, item) {
  const A = K.ACTIONS[id];
  if (!A) return;
  const terminal = TERMINAL_ACTIONS.has(id);
  const m = modal(`<div class="modal-head">${icon(A.icon || 'zap', 20)}<h3>${esc(P(A.t))}</h3><button class="icon-btn" data-act="close-modal">${icon('x', 18)}</button></div>
    <div class="modal-body"><p style="margin-top:0">${esc(P(A.d))}</p>
      ${A.cmd ? `<div style="margin:10px 0"><code style="font-size:12.5px;padding:6px 10px;display:inline-block">${esc(id === 'compactVhdx' && item ? `diskpart → compact vdisk "${item.path}"` : A.cmd)}</code></div>` : ''}
      ${A.admin ? `<div class="note">${icon('shield', 14)}<span>${t('needs_admin')} (UAC)</span></div>` : ''}
      ${terminal ? `<div class="note">${icon('terminal', 14)}<span>${t('terminal_note')}</span></div>` : ''}
      ${id === 'compactVhdx' || id === 'dockerPrune' ? `<div class="warn-strip" style="margin-top:12px">${icon('alert', 16)}<span>${t('vhdx_warn')}</span></div>` : ''}
      <p class="muted" style="margin-bottom:0">${t('act_confirm')}</p></div>
    <div class="modal-foot"><button class="btn ghost" data-act="close-modal">${t('cancel')}</button><button class="btn primary" id="actGo">${icon('play', 14)}${t('run')}</button></div>`);
  $('#actGo', m).addEventListener('click', async () => {
    $('#actGo', m).disabled = true;
    let r;
    try { r = await api.action(id, item ? item.path : undefined); } catch (e) { closeModal(); toast(errText(e), 'err'); return; }
    closeModal();
    if (r && r.code === 0) {
      if (terminal) toast(t('act_started'), 'info');
      else toast(t('act_done') + (r.freed ? ' · ' + t('m_done', { s: fmtBytes(r.freed) }) : ''), 'ok');
      if (['emptyRecycleBin', 'hibernateOff', 'hibernateReduced'].includes(id)) state.derived?.items.filter((i) => (id === 'emptyRecycleBin' ? i.c.id === 'recycle' : i.c.id === 'hiberfil')).forEach((i) => state.deleted.add(lowerP(i.path)));
      setTimeout(async () => { state.drives = await api.drives(); renderChrome(); if (['dashboard', 'cleanup'].includes(state.view)) renderView(); }, 1200);
    } else toast(t('act_failed'), 'err');
  });
}

// ───────────────────────── AI (any provider) ─────────────────────────
// Presets only pre-fill the form; the user can point any preset (or "custom") at any compatible endpoint/model.
const AI_PRESETS = [
  { id: 'claude', name: 'Claude (Anthropic)', type: 'anthropic', baseUrl: '', model: 'claude-opus-5-5', keyHint: 'sk-ant-…', site: 'console.anthropic.com' },
  { id: 'openai', name: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1', model: '', keyHint: 'sk-…', site: 'platform.openai.com' },
  { id: 'gemini', name: 'Google Gemini', type: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: '', keyHint: 'AIza…', site: 'aistudio.google.com' },
  { id: 'openrouter', name: 'OpenRouter', type: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: '', keyHint: 'sk-or-…', site: 'openrouter.ai' },
  { id: 'groq', name: 'Groq', type: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: '', keyHint: 'gsk_…', site: 'console.groq.com' },
  { id: 'deepseek', name: 'DeepSeek', type: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: '', keyHint: 'sk-…', site: 'platform.deepseek.com' },
  { id: 'mistral', name: 'Mistral', type: 'openai', baseUrl: 'https://api.mistral.ai/v1', model: '', keyHint: '', site: 'console.mistral.ai' },
  { id: 'ollama', name: 'Ollama (local)', type: 'openai', baseUrl: 'http://localhost:11434/v1', model: '', keyHint: '', site: 'ollama.com' },
  { id: 'lmstudio', name: 'LM Studio (local)', type: 'openai', baseUrl: 'http://localhost:1234/v1', model: '', keyHint: '', site: 'lmstudio.ai' },
  { id: 'custom', name: 'OpenAI-compatible', type: 'openai', baseUrl: 'https://', model: '', keyHint: '', site: '' },
];
const AI_ERR = (msg) => {
  const m = String(msg);
  if (/invalid-api-key/.test(m)) return T('کلید API نامعتبر است یا دسترسی ندارد', 'Invalid API key or no access');
  if (/model-or-url-not-found/.test(m)) return T('آدرس سرویس یا نام مدل پیدا نشد', 'Endpoint or model not found');
  if (/rate-limited/.test(m)) return T('محدودیت تعداد درخواست؛ کمی بعد دوباره امتحان کنید', 'Rate limited; try again shortly');
  if (/network|timeout/.test(m)) return T('اتصال برقرار نشد (اینترنت یا سرور محلی را بررسی کنید)', 'Could not connect (check internet or the local server)');
  if (/https-required/.test(m)) return T('برای سرویس‌های غیرمحلی آدرس باید https باشد', 'Non-local endpoints must use https');
  if (/invalid-base-url|base-url-required|credentials-in-url/.test(m)) return T('آدرس سرویس معتبر نیست', 'Invalid endpoint URL');
  if (/invalid-model/.test(m)) return T('نام مدل معتبر نیست', 'Invalid model name');
  if (/invalid-key-format/.test(m)) return T('قالب کلید API معتبر نیست', 'Invalid API key format');
  if (/key-required|no-api-key/.test(m)) return T('این سرویس به کلید API نیاز دارد', 'This service needs an API key');
  if (/name-required/.test(m)) return T('یک نام وارد کنید', 'Enter a name');
  if (/refused/.test(m)) return T('سرویس به این درخواست پاسخ نداد', 'The service declined the request');
  if (/bad-response|truncated/.test(m)) return T('پاسخ مدل قابل فهم نبود؛ مدل دیگری امتحان کنید', 'The model answer could not be parsed; try another model');
  return m;
};

// Add / edit a provider. Resolves with the saved provider id (or null when cancelled).
function providerEditor(existing) {
  return new Promise((resolve) => {
    let ex = existing || null;
    let preset = ex ? (AI_PRESETS.find((p) => p.type === ex.type && p.baseUrl === ex.baseUrl) || AI_PRESETS.find((p) => p.id === (ex.type === 'anthropic' ? 'claude' : 'custom'))) : AI_PRESETS[0];
    let saved = null;
    const m = modal(`<div class="modal-head">${icon('bot', 20)}<h3>${ex ? T('ویرایش سرویس هوش مصنوعی', 'Edit AI provider') : T('افزودن سرویس هوش مصنوعی', 'Add AI provider')}</h3><button class="icon-btn" id="peX">${icon('x', 18)}</button></div>
      <div class="modal-body">
        <div class="callout">${icon('info', 16)}<span>${T('هر سرویسی که API سازگار با OpenAI دارد (یا Claude) قابل استفاده است؛ حتی مدل‌های محلی روی همین کامپیوتر (Ollama، LM Studio) که هیچ داده‌ای را از سیستم خارج نمی‌کنند.', 'Any service with an OpenAI-compatible API (or Claude) works — including local models on this PC (Ollama, LM Studio) that never send data off the machine.')}</span></div>
        <div class="form-grid">
          <label style="grid-column:1/-1">${T('الگوی آماده', 'Preset')}<select class="input sm" id="pePreset" style="width:100%">${AI_PRESETS.map((p) => `<option value="${p.id}" ${preset && preset.id === p.id ? 'selected' : ''}>${esc(p.id === 'custom' ? T('سرویس دلخواه سازگار با OpenAI', 'Custom OpenAI-compatible service') : p.name)}</option>`).join('')}</select></label>
          <label>${T('نام نمایشی', 'Display name')}<input class="input sm" id="peName" maxlength="60" style="width:100%"></label>
          <label>${T('نوع اتصال', 'Connection type')}<select class="input sm" id="peType" style="width:100%"><option value="anthropic">Anthropic (Claude SDK)</option><option value="openai">OpenAI-compatible</option></select></label>
          <label style="grid-column:1/-1">${T('آدرس API (Base URL)', 'API base URL')}<input class="input sm ltr" id="peUrl" maxlength="300" style="width:100%"></label>
          <label>${T('نام مدل', 'Model')}<input class="input sm ltr" id="peModel" maxlength="120" style="width:100%" placeholder="${esc(T('نام مدل طبق مستندات سرویس', 'model id from the provider docs'))}"></label>
          <label>${T('کلید API', 'API key')}<input class="input sm ltr" type="password" id="peKey" maxlength="400" style="width:100%" autocomplete="off"></label>
        </div>
        <div class="note" id="peHint">${icon('key', 14)}<span></span></div>
        <div id="peResult" style="margin-top:10px"></div>
      </div>
      <div class="modal-foot"><button class="btn ghost" id="peCancel">${t('cancel')}</button><button class="btn ghost" id="peTest">${icon('zap', 14)}${T('ذخیره و تست اتصال', 'Save & test')}</button><button class="btn primary" id="peSave">${icon('save', 14)}${T('ذخیره', 'Save')}</button></div>`, true);
    const $f = (id) => $('#' + id, m);
    function sync() {
      const type = $f('peType').value;
      const url = $f('peUrl').value;
      const local = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url);
      $f('peUrl').placeholder = type === 'anthropic' ? T('خالی = api.anthropic.com', 'empty = api.anthropic.com') : 'https://…/v1';
      $f('peKey').placeholder = ex && ex.hasKey ? T('بدون تغییر (ذخیره شده)', 'unchanged (saved)') : local ? T('لازم نیست', 'not needed') : (preset && preset.keyHint) || '';
      $('#peHint span', m).textContent = local ? T('مدل محلی: داده از کامپیوتر خارج نمی‌شود. سرور را قبلاً اجرا کرده باشید.', 'Local model: data stays on this PC. Make sure the server is running.')
        : (preset && preset.site ? T('کلید را از ', 'Get a key at ') + preset.site + T(' بگیرید. کلید با رمزنگاری ویندوز ذخیره می‌شود و به رابط کاربری برنمی‌گردد.', '. It is stored encrypted (Windows DPAPI) and never returned to the UI.') : T('کلید با رمزنگاری ویندوز ذخیره می‌شود.', 'The key is stored encrypted (Windows DPAPI).'));
    }
    function fill(p) { $f('peName').value = p.id === 'custom' ? '' : p.name; $f('peModel').value = p.model; $f('peType').value = p.type; $f('peUrl').value = p.baseUrl; sync(); }
    if (ex) { $f('peName').value = ex.name; $f('peType').value = ex.type; $f('peUrl').value = ex.baseUrl; $f('peModel').value = ex.model; sync(); } else fill(preset);
    $f('pePreset').addEventListener('change', (e) => { preset = AI_PRESETS.find((p) => p.id === e.target.value); fill(preset); });
    $f('peType').addEventListener('change', sync);
    $f('peUrl').addEventListener('input', sync);
    const done = (v) => { closeModal(); resolve(v); };
    $f('peX').addEventListener('click', () => done(saved));
    $f('peCancel').addEventListener('click', () => done(saved));
    async function save(andTest) {
      const box = $f('peResult');
      box.innerHTML = '<div class="skeleton"></div>';
      try {
        const st = await api.ai.saveProvider({ id: ex ? ex.id : undefined, name: $f('peName').value.trim(), type: $f('peType').value, baseUrl: $f('peUrl').value.trim() || undefined, model: $f('peModel').value.trim(), key: $f('peKey').value.trim() || undefined });
        saved = st.savedId;
        state.settings = await api.getSettings();
        ex = st.providers.find((p) => p.id === st.savedId);
        $f('peKey').value = '';
        sync();
        if (!andTest) { done(saved); toast(t('act_done')); return; }
        box.innerHTML = `<div class="muted" style="font-size:12px">${T('در حال تست…', 'Testing…')}</div>`;
        const r = await api.ai.test(st.savedId);
        box.innerHTML = `<div class="callout">${icon('checkCircle', 16)}<span>${T('اتصال برقرار است', 'Connected')} · ${esc(r.model)} · ${fmtNum(r.ms)} ms</span></div>`;
      } catch (e) { box.innerHTML = `<div class="callout bad">${icon('xCircle', 16)}<span>${esc(AI_ERR(errText(e)))}</span></div>`; }
    }
    $f('peSave').addEventListener('click', () => save(false));
    $f('peTest').addEventListener('click', () => save(true));
  });
}

async function askAI(item) {
  let st = await api.ai.status();
  if (!st.providers.length || !st.activeId) {
    const id = await providerEditor(null);
    if (!id) return;
    st = await api.ai.status();
  }
  const prov = st.providers.find((p) => p.id === st.activeId);
  const target = { target: item.path, isDir: !!item.isDir, size: item.size || 0, files: item.files ?? undefined, kbTitle: P(cls(item.path, item.isDir).t) };
  if (state.settings.ai.consentedFor !== prov.id) {
    const payload = await api.ai.preview(target);
    let host = 'api.anthropic.com';
    if (prov.baseUrl) { try { host = new URL(prov.baseUrl).host; } catch { host = prov.baseUrl; } }
    const m = modal(`<div class="modal-head">${icon('bot', 20)}<h3>${T('دقیقاً چه چیزی ارسال می‌شود؟', 'Exactly what will be sent?')}</h3><button class="icon-btn" data-act="close-modal">${icon('x', 18)}</button></div>
      <div class="modal-body"><p style="margin-top:0">${T('مقصد: ', 'Destination: ')}<b>${esc(prov.name)}</b> · <code>${esc(host)}</code> · <code>${esc(prov.model)}</code></p>
        <p>${T('فقط این اطلاعات ارسال می‌شود. محتوای هیچ فایلی خوانده یا ارسال نمی‌شود.', 'Only this is sent. No file contents are read or sent.')}</p>
        <pre class="payload">${esc(JSON.stringify(payload, null, 2))}</pre>
        <label class="fopt"><input type="checkbox" id="aiMask" ${state.settings.ai.mask ? 'checked' : ''}><span>${T('پنهان کردن نام کاربری در مسیر (%USERPROFILE%)', 'Hide my user name in paths (%USERPROFILE%)')}</span></label>
        <label class="fopt"><input type="checkbox" id="aiKids" ${state.settings.ai.children ? 'checked' : ''}><span>${T('ارسال نام زیرپوشه‌ها و فایل‌ها (دقت بیشتر)', 'Send names of children (better accuracy)')}</span></label></div>
      <div class="modal-foot"><button class="btn ghost" data-act="close-modal">${t('cancel')}</button><button class="btn primary" id="aiOk">${icon('play', 14)}${T('موافقم، ارسال کن', 'Agree & send')}</button></div>`, true);
    const refresh = async () => { state.settings.ai.mask = $('#aiMask', m).checked; state.settings.ai.children = $('#aiKids', m).checked; await saveSettings(); $('.payload', m).textContent = JSON.stringify(await api.ai.preview(target), null, 2); };
    $('#aiMask', m).addEventListener('change', refresh); $('#aiKids', m).addEventListener('change', refresh);
    $('#aiOk', m).addEventListener('click', async () => { await api.ai.consent(prov.id); state.settings = await api.getSettings(); closeModal(); askAI(item); });
    return;
  }
  const box = $('#aiBox');
  if (box && state.drawerItem === item) box.innerHTML = `<div class="ai-card"><h5>${icon('bot', 16)}${T('در حال پرسیدن از ', 'Asking ')}${esc(prov.name)}…</h5><div class="skeleton"></div><div class="skeleton" style="width:80%"></div></div>`;
  let ans;
  try { ans = await api.ai.explain(target); } catch (e) { ans = { error: AI_ERR(errText(e)) }; }
  if (!ans.error) state.aiAnswers.set(lowerP(item.path) + '|' + I18N.lang, ans);
  if (state.drawerItem === item && $('#aiBox')) $('#aiBox').innerHTML = aiCard(ans);
}

// ───────────────────────── scanning ─────────────────────────
async function startScan(target, engine) {
  if (state.scanning) return;
  state.drive = target;
  state.scanning = true;
  state.progress = { files: 0, dirs: 0, bytes: 0, elapsed: 0, current: '' };
  closeDrawer();
  setView('dashboard');
  try { await api.scan(rootOf(target), engine); }
  catch (e) { state.scanning = false; toast(errText(e), 'err'); renderView(); }
}
async function pickDrive(target) {
  if (state.scanning || target === state.drive) return;
  state.drive = target;
  state.result = await api.lastScan(rootOf(target));
  await analyze();
  state.settings.drive = target; saveSettings();
  closeDrawer();
  renderChrome(); renderView();
}
function rememberTarget(p) {
  if (/^[a-zA-Z]:\\?$/.test(p)) return;
  const list = (state.settings.recentTargets || []).filter((x) => lowerP(x) !== lowerP(p));
  list.unshift(p);
  state.settings.recentTargets = list.slice(0, 6);
  saveSettings();
}

// ───────────────────────── report ─────────────────────────
async function exportReport(format) {
  const r = state.result, d = state.derived;
  if (!r) return;
  const hex = (g) => GROUPS[g].hex[0];
  const sum = d.cats.reduce((a, b) => a + b.value, 0);
  const data = {
    lang: I18N.lang,
    title: T('گزارش فضای دیسک — ', 'Disk space report — ') + (state.drive || ''),
    subtitle: `${fmtDate(r.finishedAt, true)} · ${fmtNum(r.stats.files)} ${t('files')} · ${r.engine === 'mft' ? 'MFT' : fmtDuration(r.elapsed)}`,
    kpis: [{ label: t('kpi_scanned'), value: fmtBytes(r.tree.s) }, { label: t('kpi_reclaim'), value: fmtBytes(d.reclaim) }, { label: t('kpi_growth7'), value: fmtBytes(r.tree.r7) }, { label: t('kpi_growth30'), value: fmtBytes(r.tree.r30) }],
    labels: { diag: t('diag_title'), categories: t('cat_title'), growth: t('ch_hotspots'), cleanup: t('cl_safe'), files: t('nav_files'), item: t('col_name'), size: t('col_size'), status: t('col_status'), type: T('نوع', 'Type'), share: t('col_share'), path: t('col_path'), g7: t('in_7d'), g30: t('in_30d') },
    diag: d.diag.map((x) => ({ title: P(x.c.t), path: x.path, hint: P(x.c.h), sizeLabel: fmtBytes(x.size), safety: x.c.safety, safetyLabel: P(K.SAFETY[x.c.safety]) })),
    categories: d.cats.slice().sort((a, b) => b.value - a.value).map((c) => ({ label: P(GROUPS[c.id]), color: hex(c.id), sizeLabel: fmtBytes(c.value), pct: (c.value / sum) * 100, pctLabel: fmtPct(c.value / sum) })),
    growth: r.hotspots.slice(0, 15).map((h) => ({ title: P(cls(h.p, true).t), path: h.p, g7: '+' + fmtBytes(h.own7 || 0), g30: '+' + fmtBytes(h.own) })),
    cleanup: d.items.filter((i) => i.c.safety === 'safe' && i.c.mode !== 'none' && !isDeleted(i.path)).slice(0, 25).map((i) => ({ title: P(i.c.t), path: i.path, sizeLabel: fmtBytes(i.size), safety: 'safe', safetyLabel: P(K.SAFETY.safe) })),
    topFiles: r.topFiles.slice(0, 25).map((f) => { const c = cls(f.p, false); return { path: f.p, title: P(c.t), sizeLabel: fmtBytes(f.s), safety: c.safety, safetyLabel: P(K.SAFETY[c.safety]) }; }),
    footer: 'DriveHound ' + state.version + ' · ' + T('این گزارش به‌صورت آفلاین روی کامپیوتر شما ساخته شده است.', 'Generated offline on your PC.'),
  };
  try { const p = await api.exportReport(data, format); if (p) toast(esc(p), 'ok'); } catch (e) { toast(errText(e), 'err'); }
}

// ───────────────────────── view registry ─────────────────────────
Object.assign(VIEWS, { dashboard: renderDashboard, explorer: renderExplorer, files: renderFiles, changes: renderChanges, cleanup: renderCleanup, apps: renderApps });
