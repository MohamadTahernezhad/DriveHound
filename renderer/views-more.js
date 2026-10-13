'use strict';
/* Additional views: duplicates, Docker & WSL, system tools, move/compress, history & quarantine, settings */
/* global state, api, K, Filters, icon, esc, t, T, P, fmtNum, fmtBytes, fmtBytesShort, fmtPct, fmtAgo, fmtDate, badge, reg, getItem,
   baseName, dirName, lowerP, extOf, ptail, countBy, topValues, safetyOptions, cls, modal, closeModal, toast, opOverlay, errText,
   confirmDelete, runAction, saveSettings, renderView, VIEWS, $, $$, SAFETY_ICON, rootOf, isDeleted, GROUPS, groupOf */

state.dupes = { result: null, running: false, progress: null, roots: [], minMB: 10, exclude: '', keep: new Map(), strategy: 'oldest', limit: 60 };
state.containers = { tab: 'docker', docker: null, wsl: null, loading: false };
state.system = { tab: 'drivers', drivers: null, restore: null, compact: null, loading: false, selected: new Set() };
state.moveView = { tab: 'move', status: null, targetDrive: null, loading: false, risk: new Map() };
state.hist = { tab: 'history', list: null, quarantine: null };

const head = (title, sub, actions = '') => `<div class="page-head"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="head-actions">${actions}</div></div>`;
const tabs = (cur, list, act) => `<div class="tabs">${list.map(([k, l, ic]) => `<button class="tab ${cur === k ? 'on' : ''}" data-act="${act}" data-t="${k}">${icon(ic, 15)}${l}</button>`).join('')}</div>`;
const loading = (n = 6) => `<div class="card">${'<div class="skeleton"></div>'.repeat(n)}</div>`;
const sum = (arr, fn) => arr.reduce((a, b) => a + (fn(b) || 0), 0);
const otherDrives = (exclude) => state.drives.filter((d) => d.type === 3 && d.letter.toUpperCase() !== String(exclude || '').slice(0, 2).toUpperCase());

// ═════════════════════════ duplicates ═════════════════════════
function renderDupes() {
  const el = $('#view-dupes');
  const S = state.dupes;
  if (!S.roots.length) S.roots = [state.env.env.USERPROFILE];
  const intro = T('فایل‌های کاملاً یکسان (با هش SHA-256 تأیید می‌شوند). هاردلینک‌ها تکراری حساب نمی‌شوند. می‌توانید نسخه‌های اضافه را حذف یا به هاردلینک تبدیل کنید تا فضا آزاد شود ولی همه مسیرها کار کنند.', 'Byte-identical files (verified with SHA-256). Hard links are not counted. Remove extra copies or turn them into hard links: space is freed and every path keeps working.');
  const setup = `<div class="card" style="margin-bottom:16px"><div class="card-head"><h3>${icon('search', 18)}${T('محدوده جستجو', 'Search scope')}</h3></div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">${S.roots.map((r, i) => `<span class="fpill">${esc(r)}<button data-act="dup-rm-root" data-i="${i}">${icon('x', 11)}</button></span>`).join('')}
      <button class="btn ghost xs" data-act="dup-add-root">${icon('folderPlus', 12)}${T('افزودن پوشه', 'Add folder')}</button>
      ${state.drives.filter((d) => d.type === 3).map((d) => `<button class="btn ghost xs" data-act="dup-add-drive" data-d="${esc(d.letter)}">${icon('disk', 12)}${esc(d.letter)}</button>`).join('')}</div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
      <label class="muted" style="font-size:12px">${T('حداقل حجم', 'Min size')} <select class="input sm" id="dupMin">${[1, 5, 10, 50, 100, 500].map((n) => `<option value="${n}" ${S.minMB === n ? 'selected' : ''}>${n} MB</option>`).join('')}</select></label>
      <input class="input sm" style="width:280px" id="dupEx" placeholder="${T('حذف از جستجو (با کاما): cache, .git, backup', 'Exclude (comma): cache, .git, backup')}" value="${esc(S.exclude)}">
      ${S.running ? `<button class="btn ghost" data-act="dup-cancel">${icon('stop', 14)}${t('cancel')}</button>` : `<button class="btn primary" data-act="dup-start">${icon('play', 14)}${T('جستجوی تکراری‌ها', 'Find duplicates')}</button>`}
    </div></div>`;
  if (S.running) {
    const p = S.progress || {};
    const phase = { walk: T('مرور فایل‌ها', 'Walking files'), partial: T('هش سریع', 'Quick hashing'), full: T('تأیید کامل SHA-256', 'Full SHA-256 verify') }[p.phase] || '…';
    el.innerHTML = head(t('nav_dupes'), intro) + setup + `<div class="card"><b>${phase}</b><div class="muted num" style="font-size:12px;margin:6px 0">${fmtNum(p.scanned || 0)} ${t('files')} · ${fmtNum(p.hashed || 0)} / ${fmtNum(p.candidates || 0)} ${T('هش شد', 'hashed')}</div>${ptail(p.current || '')}<div class="progress"><i style="width:${p.candidates ? Math.min(99, (p.hashed / p.candidates) * 100) : 4}%"></i></div></div>`;
    return;
  }
  if (!S.result) { el.innerHTML = head(t('nav_dupes'), intro) + setup; return; }
  const groups = S.result.groups.filter((g) => g.files.filter((f) => !isDeleted(f.p)).length > 1);
  const F = Filters.create('dupes', {
    text: (g) => g.files.map((f) => f.p).join('|'), ext: (g) => extOf(g.files[0].p),
    multi: [{ key: 'ext', label: T('پسوند', 'Extension'), icon: 'file', options: topValues(groups, (g) => extOf(g.files[0].p), 30).map(([v, n]) => ({ v, label: '.' + v, count: n })), acc: (g) => extOf(g.files[0].p) },
      { key: 'group', label: T('نوع', 'Type'), icon: 'layers', options: Object.keys(GROUPS).map((k) => ({ v: k, label: P(GROUPS[k]), color: GROUPS[k].c })), acc: (g) => groupOf(cls(g.files[0].p, false)) }],
    size: { acc: (g) => g.size }, age: { acc: (g) => Math.max(...g.files.map((f) => f.m)), label: t('col_modified') },
    toggles: [{ key: 'samefolder', label: T('در یک پوشه', 'Same folder'), icon: 'folder', test: (g) => new Set(g.files.map((f) => lowerP(dirName(f.p)))).size === 1 }],
    sort: { options: [{ k: 'wasted', label: T('فضای هدررفته', 'Wasted'), acc: (g) => g.wasted }, { k: 'size', label: t('col_size'), acc: (g) => g.size }, { k: 'count', label: T('تعداد نسخه', 'Copies'), acc: (g) => g.files.length }], default: { k: 'wasted', dir: -1 } },
  }, () => renderDupes());
  const rows = F.apply(groups);
  const wasted = sum(rows, (g) => g.wasted);
  el.innerHTML = head(t('nav_dupes'), intro) + setup + `
    <div class="stat-row"><div class="mini-stat"><b class="num">${fmtNum(rows.length)}</b><span>${T('گروه تکراری', 'duplicate groups')}</span></div>
      <div class="mini-stat"><b class="num">${fmtBytes(wasted)}</b><span>${T('فضای هدررفته', 'wasted space')}</span></div>
      <div class="mini-stat"><b class="num">${fmtNum(S.result.scanned)}</b><span>${T('فایل بررسی شد', 'files checked')} · ${fmtNum(Math.round(S.result.elapsed / 1000))}s</span></div>
      <label class="muted" style="font-size:12px;align-self:center">${T('نگه‌داشتن خودکار:', 'Auto-keep:')} <select class="input sm" id="dupStrategy">${[['oldest', T('قدیمی‌ترین', 'Oldest')], ['newest', T('جدیدترین', 'Newest')], ['shortest', T('کوتاه‌ترین مسیر', 'Shortest path')]].map(([v, l]) => `<option value="${v}" ${S.strategy === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <button class="btn ghost sm" data-act="dup-bulk-link" style="align-self:center">${icon('link', 14)}${T('هاردلینک همه (هم‌درایو)', 'Hard-link all (same drive)')}</button>
      <button class="btn danger sm" data-act="dup-bulk-delete" style="align-self:center">${icon('trash', 14)}${T('حذف همه نسخه‌های اضافه', 'Delete all extra copies')}</button></div>
    <div class="card" style="padding:12px">${F.bar({ count: fmtNum(rows.length) })}
      ${rows.slice(0, S.limit).map((g) => dupGroup(g)).join('') || `<div class="empty">${t('no_results')}</div>`}
      ${rows.length > S.limit ? `<div style="text-align:center;padding:10px"><button class="btn ghost sm" data-act="dup-more">${t('show_more')}</button></div>` : ''}</div>`;
}
function keeperOf(g) {
  const S = state.dupes;
  const files = g.files.filter((f) => !isDeleted(f.p));
  const chosen = S.keep.get(g.hash);
  if (chosen && files.some((f) => f.p === chosen)) return chosen;
  const sorted = files.slice().sort((a, b) => S.strategy === 'newest' ? b.m - a.m : S.strategy === 'shortest' ? a.p.length - b.p.length : a.m - b.m);
  return sorted[0].p;
}
function dupGroup(g) {
  const keep = keeperOf(g);
  const files = g.files.filter((f) => !isDeleted(f.p));
  const c = cls(files[0].p, false);
  const id = reg(g);
  return `<div class="group-card"><div class="gh"><span class="fi" style="--c:${GROUPS[groupOf(c)].c};width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:color-mix(in srgb,var(--c) 16%,transparent);color:var(--c)">${icon('copies', 15)}</span>
    <b>${esc(baseName(files[0].p))} <span class="muted num" style="font-weight:500">· ${fmtNum(files.length)} × ${fmtBytes(g.size)}</span></b>
    <span class="tag danger num">${T('هدر: ', 'wasted: ')}${fmtBytes(g.size * (files.length - 1))}</span>
    <button class="btn ghost xs" data-act="dup-link" data-id="${id}">${icon('link', 12)}${T('هاردلینک', 'Hard-link')}</button>
    <button class="btn ghost xs" data-act="dup-delete" data-id="${id}" style="color:var(--danger-t)">${icon('trash', 12)}${T('حذف بقیه', 'Delete others')}</button></div>
    ${files.map((f) => `<label class="dup-file ${f.p === keep ? 'keep' : ''}"><input type="radio" name="k-${esc(g.hash)}" data-act="dup-keep" data-h="${esc(g.hash)}" data-p="${esc(f.p)}" ${f.p === keep ? 'checked' : ''}>${ptail(f.p)}<span class="muted" style="font-size:11.5px">${fmtDate(f.m)}</span>${f.p === keep ? `<span class="tag safe">${icon('check', 11)}${T('نگه‌داشته می‌شود', 'kept')}</span>` : `<span class="tag">${T('اضافه', 'extra')}</span>`}</label>`).join('')}</div>`;
}
async function dupAct(g, how) {
  const keep = keeperOf(g);
  const extras = g.files.filter((f) => f.p !== keep && !isDeleted(f.p));
  if (how === 'delete') {
    confirmDelete(extras.map((f) => ({ path: f.p, size: g.size, isDir: false, c: cls(f.p, false) })));
  } else {
    const r = await api.dupes.link(keep, extras.map((f) => f.p));
    const ok = r.filter((x) => x.ok);
    toast(T('هاردلینک شد: ', 'Linked: ') + fmtNum(ok.length) + ' · ' + t('m_done', { s: fmtBytes(sum(ok, (x) => x.freed)) }) + (r.length - ok.length ? ' · ' + t('m_failed', { n: fmtNum(r.length - ok.length) }) + ' (' + esc(r.find((x) => !x.ok).error) + ')' : ''), ok.length ? 'ok' : 'err', 7000);
    g.files = g.files.filter((f) => f.p === keep || !ok.some((x) => x.path === f.p));
    renderDupes();
  }
}
async function dupBulk(how) {
  const S = state.dupes;
  const groups = Filters.apply('dupes', S.result.groups.filter((g) => g.files.filter((f) => !isDeleted(f.p)).length > 1));
  if (how === 'delete') {
    const items = groups.flatMap((g) => { const k = keeperOf(g); return g.files.filter((f) => f.p !== k && !isDeleted(f.p)).map((f) => ({ path: f.p, size: g.size, isDir: false, c: cls(f.p, false) })); });
    if (items.length) confirmDelete(items);
    return;
  }
  const ov = opOverlay(T('ساخت هاردلینک…', 'Creating hard links…'));
  let ok = 0, freed = 0, fail = 0;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i], k = keeperOf(g);
    ov.update(baseName(k), i / groups.length);
    const extras = g.files.filter((f) => f.p !== k && f.p.slice(0, 2).toUpperCase() === k.slice(0, 2).toUpperCase());
    if (!extras.length) continue;
    try { const r = await api.dupes.link(k, extras.map((f) => f.p)); for (const x of r) { if (x.ok) { ok++; freed += x.freed; } else fail++; } g.files = g.files.filter((f) => f.p === k || !r.some((x) => x.ok && x.path === f.p)); } catch { fail += extras.length; }
  }
  ov.close();
  toast(T('هاردلینک: ', 'Linked: ') + fmtNum(ok) + ' · ' + t('m_done', { s: fmtBytes(freed) }) + (fail ? ' · ' + t('m_failed', { n: fmtNum(fail) }) : ''), ok ? 'ok' : 'err', 7000);
  renderDupes();
}

// ═════════════════════════ Docker & WSL ═════════════════════════
async function loadContainers() {
  const S = state.containers;
  S.loading = true; renderContainers();
  const [d, w] = await Promise.all([api.docker.info().catch((e) => ({ available: false, error: errText(e) })), api.wsl.info().catch(() => ({ distros: [] }))]);
  S.docker = d; S.wsl = w; S.loading = false;
  if (state.view === 'containers') renderContainers();
}
function renderContainers() {
  const el = $('#view-containers');
  const S = state.containers;
  const intro = T('ایمیج‌ها، کانتینرها، والیوم‌ها و کش بیلد Docker، و دیسک‌های مجازی WSL — همه با حجم دقیق. حذف از اینجا با خود Docker انجام می‌شود، نه حذف دستی فایل.', 'Docker images, containers, volumes and build cache, plus WSL virtual disks — with exact sizes. Removal goes through Docker itself, never by deleting files.');
  const actions = `<button class="btn ghost sm" data-act="cont-reload">${icon('refresh', 14)}${T('بارگذاری مجدد', 'Reload')}</button>`;
  if (!S.docker && !S.loading) { loadContainers(); return; }
  if (S.loading) { el.innerHTML = head(t('nav_containers'), intro, actions) + loading(); return; }
  const tb = tabs(S.tab, [['docker', 'Docker', 'box'], ['wsl', 'WSL', 'terminal']], 'cont-tab');
  el.innerHTML = head(t('nav_containers'), intro, actions) + tb + (S.tab === 'docker' ? dockerHtml() : wslHtml());
}
function dockerHtml() {
  const d = state.containers.docker;
  if (!d.available) {
    return `<div class="callout warn">${icon('alert', 16)}<div><b>${d.installed === false ? T('Docker نصب نیست', 'Docker is not installed') : T('Docker Desktop در حال اجرا نیست', 'Docker Desktop is not running')}</b><div style="margin-top:4px">${T('Docker Desktop را باز کنید و «بارگذاری مجدد» را بزنید. دیسک مجازی Docker در تب WSL دیده می‌شود و حتی وقتی Docker خاموش است قابل فشرده‌سازی است.', 'Start Docker Desktop and press Reload. Docker’s virtual disk is listed in the WSL tab and can be compacted while Docker is stopped.')}</div><div class="path" style="margin-top:4px">${esc(d.error || '')}</div></div></div>`;
  }
  const imgs = d.images, cons = d.containers, vols = d.volumes;
  const bcSize = sum(d.buildCache, (b) => b.size);
  const FI = Filters.create('dk-img', {
    text: (i) => (i.ref || '') + ' ' + i.id,
    toggles: [{ key: 'dangling', label: T('بی‌نام (dangling)', 'Dangling'), icon: 'alert', test: (i) => i.dangling }, { key: 'unused', label: T('بدون کانتینر', 'Unused'), icon: 'xCircle', test: (i) => !i.inUse }],
    size: { acc: (i) => i.size }, sort: { options: [{ k: 'size', label: t('col_size'), acc: (i) => i.size }, { k: 'name', label: t('col_name'), acc: (i) => i.ref || 'zzz' }], default: { k: 'size', dir: -1 } },
  }, () => renderContainers());
  const FC = Filters.create('dk-con', {
    text: (c) => c.name + ' ' + c.image,
    multi: [{ key: 'state', label: T('وضعیت', 'State'), icon: 'activity', options: topValues(cons, (c) => c.state).map(([v, n]) => ({ v, label: v, count: n })), acc: (c) => c.state }],
    size: { acc: (c) => c.size }, sort: { options: [{ k: 'size', label: t('col_size'), acc: (c) => c.size }, { k: 'name', label: t('col_name'), acc: (c) => c.name }], default: { k: 'size', dir: -1 } },
  }, () => renderContainers());
  const FV = Filters.create('dk-vol', {
    text: (v) => v.name,
    toggles: [{ key: 'unused', label: T('استفاده‌نشده', 'Unused'), icon: 'xCircle', test: (v) => v.links === 0 }],
    size: { acc: (v) => v.size || 0 }, sort: { options: [{ k: 'size', label: t('col_size'), acc: (v) => v.size || 0 }, { k: 'name', label: t('col_name'), acc: (v) => v.name }], default: { k: 'size', dir: -1 } },
  }, () => renderContainers());
  const ri = FI.apply(imgs), rc = FC.apply(cons), rv = FV.apply(vols);
  return `<div class="stat-row">
      <div class="mini-stat"><b class="num">${fmtBytes(sum(imgs, (i) => i.size))}</b><span>${fmtNum(imgs.length)} ${T('ایمیج', 'images')}</span></div>
      <div class="mini-stat"><b class="num">${fmtBytes(sum(cons, (c) => c.size))}</b><span>${fmtNum(cons.length)} ${T('کانتینر', 'containers')}</span></div>
      <div class="mini-stat"><b class="num">${fmtBytes(sum(vols, (v) => v.size))}</b><span>${fmtNum(vols.length)} ${T('والیوم', 'volumes')}</span></div>
      <div class="mini-stat"><b class="num">${fmtBytes(bcSize)}</b><span>${T('کش بیلد', 'build cache')}</span></div></div>
    <div class="callout">${icon('info', 16)}<span>${T('بعد از حذف، فضای داخل دیسک مجازی Docker آزاد می‌شود ولی فایل docker_data.vhdx خودکار کوچک نمی‌شود. برای برگرداندن فضا به ویندوز، در تب WSL «فشرده‌سازی» را بزنید.', 'Removing frees space inside Docker’s virtual disk, but docker_data.vhdx does not shrink by itself. Use “Compact” in the WSL tab to give the space back to Windows.')}</span></div>
    <div class="tools" style="margin-bottom:16px">
      <div class="tool"><div class="tool-top"><span class="tool-ic">${icon('layers', 18)}</span><b>${T('کش بیلد', 'Build cache')} · ${fmtBytes(bcSize)}</b></div><p>${T('لایه‌های کش docker build. امن است.', 'docker build cache layers. Safe.')}</p><div class="tool-foot"><span></span><button class="btn ghost sm" data-act="dk-prune" data-w="build">${icon('broom', 12)}${t('run')}</button></div></div>
      <div class="tool"><div class="tool-top"><span class="tool-ic">${icon('box', 18)}</span><b>${T('ایمیج‌های بی‌نام', 'Dangling images')} · ${fmtNum(imgs.filter((i) => i.dangling).length)}</b></div><p>${T('ایمیج‌های بدون تگ که معمولاً باقیمانده بیلدهای قبلی‌اند.', 'Untagged leftovers of previous builds.')}</p><div class="tool-foot"><span></span><button class="btn ghost sm" data-act="dk-prune" data-w="dangling">${icon('broom', 12)}${t('run')}</button></div></div>
      <div class="tool"><div class="tool-top"><span class="tool-ic">${icon('stop', 18)}</span><b>${T('کانتینرهای متوقف', 'Stopped containers')} · ${fmtNum(cons.filter((c) => c.state !== 'running').length)}</b></div><p>${T('کانتینرهای خاموش (والیوم‌ها حفظ می‌شوند).', 'Stopped containers (volumes are kept).')}</p><div class="tool-foot"><span></span><button class="btn ghost sm" data-act="dk-prune" data-w="containers">${icon('broom', 12)}${t('run')}</button></div></div></div>
    <div class="card" style="margin-bottom:16px"><div class="card-head"><h3>${icon('box', 18)}${T('ایمیج‌ها', 'Images')}</h3></div>${FI.bar({ count: fmtNum(ri.length) })}
      <div class="list" style="--cols: minmax(0,1fr) 110px 110px 130px 90px">${FI.head([{ label: t('col_name'), sk: 'name' }, { label: t('col_size'), sk: 'size' }, { label: T('اختصاصی', 'Unique') }, { label: T('ساخته‌شده', 'Created') }, { label: '' }])}
      ${ri.map((i) => `<div class="row" style="cursor:default"><div class="row-name"><span class="fi" style="--c:var(--c3)">${icon('box', 16)}</span><span class="nm"><b>${esc(i.ref || '<none>')}</b><span class="sub ltr">${esc(i.id.replace('sha256:', '').slice(0, 12))} ${i.inUse ? '· ' + T('در حال استفاده', 'in use') : ''}</span></span></div>
        <span class="sz">${fmtBytes(i.size)}</span><span class="num muted">${i.unique != null ? fmtBytes(i.unique, true) : '—'}</span><span class="muted" style="font-size:12px">${esc(i.since || '')}</span>
        <span><button class="btn ghost xs" data-act="dk-rm" data-k="image" data-v="${esc(i.id)}" data-n="${esc(i.ref || i.id)}" ${i.inUse ? 'disabled title="' + esc(T('کانتینری از آن استفاده می‌کند', 'Used by a container')) + '"' : ''} style="color:var(--danger-t)">${icon('trash', 12)}</button></span></div>`).join('') || `<div class="empty">${t('no_results')}</div>`}</div></div>
    <div class="card" style="margin-bottom:16px"><div class="card-head"><h3>${icon('cpu', 18)}${T('کانتینرها', 'Containers')}</h3></div>${FC.bar({ count: fmtNum(rc.length) })}
      <div class="list" style="--cols: minmax(0,1fr) 110px 110px 150px 90px">${FC.head([{ label: t('col_name'), sk: 'name' }, { label: T('حجم نوشتنی', 'Writable'), sk: 'size' }, { label: T('مجازی', 'Virtual') }, { label: T('وضعیت', 'Status') }, { label: '' }])}
      ${rc.map((c) => `<div class="row" style="cursor:default"><div class="row-name"><span class="fi" style="--c:var(--c3)">${icon('cpu', 16)}</span><span class="nm"><b>${esc(c.name)}</b><span class="sub">${esc(c.image)}</span></span></div>
        <span class="sz">${fmtBytes(c.size)}</span><span class="num muted">${fmtBytes(c.virtual, true)}</span><span class="tag ${c.state === 'running' ? 'safe' : ''}">${esc(c.status)}</span>
        <span><button class="btn ghost xs" data-act="dk-rm" data-k="container" data-v="${esc(c.id)}" data-n="${esc(c.name)}" ${c.state === 'running' ? 'disabled' : ''} style="color:var(--danger-t)">${icon('trash', 12)}</button></span></div>`).join('') || `<div class="empty">${t('no_results')}</div>`}</div></div>
    <div class="card"><div class="card-head"><h3>${icon('archive', 18)}${T('والیوم‌ها', 'Volumes')}</h3></div>
      <div class="callout warn">${icon('alert', 16)}<span>${T('والیوم‌ها داده واقعی هستند (دیتابیس‌ها، آپلودها). حذف آن‌ها قابل بازگشت نیست.', 'Volumes hold real data (databases, uploads). Removing them cannot be undone.')}</span></div>${FV.bar({ count: fmtNum(rv.length) })}
      <div class="list" style="--cols: minmax(0,1fr) 110px 120px 90px">${FV.head([{ label: t('col_name'), sk: 'name' }, { label: t('col_size'), sk: 'size' }, { label: T('استفاده', 'Links') }, { label: '' }])}
      ${rv.map((v) => `<div class="row" style="cursor:default"><div class="row-name"><span class="fi" style="--c:var(--c3)">${icon('archive', 16)}</span><span class="nm"><b class="ltr">${esc(v.name)}</b><span class="sub">${esc(v.driver)}</span></span></div>
        <span class="sz">${v.size != null ? fmtBytes(v.size) : '—'}</span><span class="tag ${v.links ? 'safe' : ''}">${v.links == null ? '—' : v.links ? T('در حال استفاده', 'in use') : T('بدون استفاده', 'unused')}</span>
        <span><button class="btn ghost xs" data-act="dk-rm" data-k="volume" data-v="${esc(v.name)}" data-n="${esc(v.name)}" ${v.links ? 'disabled' : ''} style="color:var(--danger-t)">${icon('trash', 12)}</button></span></div>`).join('') || `<div class="empty">${t('no_results')}</div>`}</div></div>`;
}
function wslHtml() {
  const w = state.containers.wsl || { distros: [] };
  return `<div class="callout">${icon('info', 16)}<span>${T('هر توزیع WSL (و Docker) یک فایل vhdx دارد که با پاک کردن فایل‌های داخل لینوکس کوچک نمی‌شود. «فشرده‌سازی» فضای خالی را به ویندوز برمی‌گرداند (WSL خاموش می‌شود، نیاز به ادمین).', 'Each WSL distro (and Docker) lives in a vhdx that does not shrink when you delete files inside Linux. “Compact” returns the free space to Windows (shuts WSL down, needs admin).')}</span><button class="btn ghost sm" data-act="wsl-shutdown">${icon('power', 13)}${T('خاموش کردن WSL', 'Shut down WSL')}</button></div>
    <div class="card"><div class="list" style="--cols: minmax(0,1fr) 110px 110px 260px">
      <div class="list-head"><span>${t('col_name')}</span><span>${t('col_size')}</span><span>${T('وضعیت', 'State')}</span><span></span></div>
      ${w.distros.map((d) => { const id = reg(d); return `<div class="row" style="cursor:default"><div class="row-name"><span class="fi" style="--c:var(--c3)">${icon(d.dockerData || /^docker/.test(d.name) ? 'box' : 'terminal', 16)}</span><span class="nm"><b>${esc(d.name)} ${d.default ? `<span class="tag">${T('پیش‌فرض', 'default')}</span>` : ''}</b>${ptail(d.vhd || '—')}</span></div>
        <span class="sz">${d.size ? fmtBytes(d.size) : '—'}</span><span class="tag ${/running/i.test(d.state) ? 'safe' : ''}">${esc(d.state)} · WSL${d.version}</span>
        <span style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">${d.vhd ? `<button class="btn ghost xs" data-act="wsl-compact" data-id="${id}">${icon('compress', 12)}${T('فشرده‌سازی', 'Compact')}</button>` : ''}
          ${/running/i.test(d.state) && !d.dockerData ? `<button class="btn ghost xs" data-act="wsl-term" data-n="${esc(d.name)}">${icon('stop', 12)}${T('توقف', 'Stop')}</button>` : ''}
          ${!d.dockerData && !/^docker/.test(d.name) ? `<button class="btn ghost xs" data-act="wsl-move" data-n="${esc(d.name)}">${icon('move', 12)}${T('انتقال', 'Move')}</button>` : ''}</span></div>`; }).join('') || `<div class="empty">${T('هیچ توزیع WSL پیدا نشد', 'No WSL distros found')}</div>`}</div></div>`;
}

// ═════════════════════════ system tools ═════════════════════════
async function loadSystem(tab) {
  const S = state.system;
  S.loading = true; renderSystem();
  try {
    if (tab === 'drivers') S.drivers = await api.drivers.list();
    else if (tab === 'restore') S.restore = await api.restorePts.info();
    else S.compact = await api.compact.state();
  } catch (e) { toast(errText(e), 'err'); }
  S.loading = false;
  if (state.view === 'system') renderSystem();
}
function renderSystem() {
  const el = $('#view-system');
  const S = state.system;
  const intro = T('پاکسازی‌هایی که فقط با ابزار درست امن هستند: درایورهای قدیمی، نقاط بازگردانی و فشرده‌سازی سیستم.', 'Cleanups that are only safe with the right tool: old drivers, restore points and system compression.');
  const tb = tabs(S.tab, [['drivers', T('درایورهای قدیمی', 'Old drivers'), 'cpu'], ['restore', T('نقاط بازگردانی', 'Restore points'), 'history'], ['compact', T('Hibernate و CompactOS', 'Hibernate & CompactOS'), 'compress']], 'sys-tab');
  const data = S.tab === 'drivers' ? S.drivers : S.tab === 'restore' ? S.restore : S.compact;
  if (!data && !S.loading) { loadSystem(S.tab); return; }
  if (S.loading) { el.innerHTML = head(t('nav_system'), intro) + tb + loading(); return; }
  el.innerHTML = head(t('nav_system'), intro) + tb + (S.tab === 'drivers' ? driversHtml() : S.tab === 'restore' ? restoreHtml() : compactHtml());
}
function driversHtml() {
  const S = state.system;
  const all = S.drivers || [];
  const F = Filters.create('drivers', {
    text: (d) => [d.original, d.published, d.provider, d.cls].join(' '),
    multi: [{ key: 'cls', label: T('کلاس', 'Class'), icon: 'layers', options: topValues(all, (d) => d.cls, 30).map(([v, n]) => ({ v, label: v, count: n })), acc: (d) => d.cls },
      { key: 'prov', label: T('سازنده', 'Provider'), icon: 'user', options: topValues(all, (d) => d.provider, 30).map(([v, n]) => ({ v, label: v, count: n })), acc: (d) => d.provider }],
    toggles: [{ key: 'removable', label: T('فقط قابل حذف', 'Removable only'), icon: 'trash', test: (d) => d.removable }, { key: 'inuse', label: T('در حال استفاده', 'In use'), icon: 'lock', test: (d) => d.inUse }],
    size: { acc: (d) => d.size }, age: { acc: (d) => d.date, label: T('تاریخ درایور', 'Driver date') },
    sort: { options: [{ k: 'size', label: t('col_size'), acc: (d) => d.size }, { k: 'date', label: T('تاریخ', 'Date'), acc: (d) => d.date }, { k: 'name', label: t('col_name'), acc: (d) => d.original }], default: { k: 'size', dir: -1 } },
  }, () => renderSystem());
  const rows = F.apply(all);
  const removable = all.filter((d) => d.removable);
  const sel = all.filter((d) => S.selected.has(d.published));
  return `<div class="stat-row"><div class="mini-stat"><b class="num">${fmtNum(all.length)}</b><span>${T('بسته درایور', 'driver packages')}</span></div>
      <div class="mini-stat"><b class="num">${fmtBytes(sum(all, (d) => d.size))}</b><span>${T('حجم کل DriverStore', 'DriverStore total')}</span></div>
      <div class="mini-stat"><b class="num">${fmtBytes(sum(removable, (d) => d.size))}</b><span>${fmtNum(removable.length)} ${T('نسخه قدیمی قابل حذف', 'old removable versions')}</span></div>
      <button class="btn ghost sm" data-act="drv-sel-all" style="align-self:center">${icon('check', 14)}${T('انتخاب همه قدیمی‌ها', 'Select all old')}</button></div>
    <div class="callout">${icon('shield', 16)}<span>${T('فقط نسخه‌های قدیمی که دستگاهی از آن‌ها استفاده نمی‌کند قابل انتخاب‌اند. حذف با pnputil و بدون /force انجام می‌شود؛ یعنی خود ویندوز حذف درایور در حال استفاده را رد می‌کند.', 'Only old versions not used by any device can be selected. Removal uses pnputil without /force, so Windows itself refuses to remove a driver in use.')}</span></div>
    <div class="card" style="padding:12px 12px 8px">${F.bar({ count: fmtNum(rows.length) })}
      <div class="list" style="--cols: 26px minmax(0,1fr) 150px 110px 120px 150px">${F.head([{ label: '' }, { label: t('col_name'), sk: 'name' }, { label: T('نسخه', 'Version') }, { label: t('col_size'), sk: 'size' }, { label: T('تاریخ', 'Date'), sk: 'date' }, { label: t('col_status') }])}
      ${rows.map((d) => `<div class="row" style="cursor:default">${d.removable ? `<input type="checkbox" class="chk" data-act="drv-sel" data-v="${esc(d.published)}" ${S.selected.has(d.published) ? 'checked' : ''}>` : '<span></span>'}
        <div class="row-name"><span class="fi" style="--c:var(--c1)">${icon('cpu', 16)}</span><span class="nm"><b>${esc(d.original)} <span class="muted ltr" style="font-weight:500">(${esc(d.published)})</span></b><span class="sub">${esc(d.provider)} · ${esc(d.cls)} · ${fmtNum(d.versions)} ${T('نسخه', 'versions')}</span></span></div>
        <span class="num ltr" style="font-size:12px">${esc(d.version)}</span><span class="sz">${d.size ? fmtBytes(d.size) : '—'}</span><span class="muted" style="font-size:12px">${fmtDate(d.date)}</span>
        <span>${d.inUse ? `<span class="tag danger">${icon('lock', 11)}${T('در حال استفاده', 'in use')}</span>` : d.isOld ? `<span class="tag safe">${icon('trash', 11)}${T('قدیمی، قابل حذف', 'old, removable')}</span>` : `<span class="tag info">${T('جدیدترین', 'latest')}</span>`}</span></div>`).join('') || `<div class="empty">${t('no_results')}</div>`}</div></div>
    <div class="cl-bar"><div><div class="tot num">${fmtBytes(sum(sel, (d) => d.size))}</div><div class="muted" style="font-size:12px">${t('selected_n', { n: fmtNum(sel.length) })}</div></div><div style="flex:1"></div>
      <button class="btn primary" data-act="drv-delete" ${sel.length ? '' : 'disabled'}>${icon('trash', 16)}${T('حذف درایورهای انتخابی (UAC)', 'Remove selected drivers (UAC)')}</button></div>`;
}
function restoreHtml() {
  const r = state.system.restore || {};
  if (!r.admin) return `<div class="callout warn">${icon('lock', 16)}<span>${T('خواندن حجم نقاط بازگردانی و Shadow Copyها نیاز به دسترسی ادمین دارد.', 'Reading restore point and shadow copy sizes requires administrator rights.')}</span><button class="btn ghost sm" data-act="relaunch-admin">${t('admin_relaunch')}</button></div>
    <div class="tools"><div class="tool"><div class="tool-top"><span class="tool-ic">${icon('shield', 18)}</span><b>${esc(P(K.ACTIONS.systemProtection.t))}</b></div><p>${esc(P(K.ACTIONS.systemProtection.d))}</p><div class="tool-foot"><span></span><button class="btn ghost sm" data-act="run-action" data-a="systemProtection">${icon('play', 12)}${t('run')}</button></div></div></div>`;
  return `${(r.storage || []).map((s) => `<div class="card" style="margin-bottom:14px"><div class="card-head"><h3>${icon('disk', 18)}${T('درایو ', 'Drive ')}<bdi class="ltr">${esc(s.drive)}</bdi></h3></div>
      <div class="stat-row"><div class="mini-stat"><b class="num">${fmtBytes(s.used)}</b><span>${T('استفاده‌شده توسط Shadow Copy', 'Used by shadow copies')}</span></div>
        <div class="mini-stat"><b class="num">${fmtBytes(s.max)}</b><span>${T('سقف مجاز', 'Maximum allowed')}${s.cap ? ' · ' + fmtPct(s.max / s.cap) : ''}</span></div>
        <div class="mini-stat"><b class="num">${fmtNum((r.shadows || []).filter((x) => x.drive === s.drive).length)}</b><span>${T('Shadow Copy', 'shadow copies')}</span></div></div>
      <div class="bar ${s.max && s.used / s.max > 0.8 ? 'warn' : ''}" style="margin-bottom:12px"><i style="width:${s.max ? Math.min(100, (s.used / s.max) * 100) : 0}%"></i></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button class="btn ghost sm" data-act="rp-del-oldest" data-d="${esc(s.drive)}">${icon('trash', 13)}${T('حذف قدیمی‌ترین نقطه', 'Delete oldest point')}</button>
        <span class="muted" style="font-size:12px">${T('سقف جدید:', 'New max:')}</span><select class="input sm" id="rp-pct-${esc(s.drive[0])}">${[3, 5, 8, 10, 15, 20].map((p) => `<option value="${p}">${fmtNum(p)}%</option>`).join('')}</select>
        <button class="btn ghost sm" data-act="rp-resize" data-d="${esc(s.drive)}">${icon('check', 13)}${T('اعمال', 'Apply')}</button></div></div>`).join('') || `<div class="callout">${icon('info', 16)}<span>${T('هیچ فضای Shadow Copy فعالی پیدا نشد.', 'No shadow storage found.')}</span></div>`}
    <div class="card"><div class="card-head"><h3>${icon('history', 18)}${T('نقاط بازگردانی سیستم', 'System restore points')}</h3></div>
      <div class="list" style="--cols: 80px minmax(0,1fr) 200px"><div class="list-head"><span>#</span><span>${T('توضیح', 'Description')}</span><span>${T('تاریخ', 'Date')}</span></div>
      ${(r.points || []).map((p) => `<div class="row" style="cursor:default;min-height:40px"><span class="num">${esc(p.seq)}</span><span>${esc(p.desc)}</span><span class="muted" style="font-size:12px">${esc(p.created)}</span></div>`).join('') || `<div class="empty">${T('نقطه بازگردانی وجود ندارد', 'No restore points')}</div>`}</div></div>`;
}
function compactHtml() {
  const c = state.system.compact || {};
  const hib = state.result && state.result.topFiles.find((f) => /^[a-z]:\\hiberfil\.sys$/i.test(f.p));
  return `<div class="tools">
    <div class="tool"><div class="tool-top"><span class="tool-ic">${icon('compress', 18)}</span><b>CompactOS · ${c.enabled ? `<span class="tag safe">${T('فعال', 'On')}</span>` : `<span class="tag">${T('غیرفعال', 'Off')}</span>`}</b></div>
      <p>${T('فایل‌های خود ویندوز را به‌صورت شفاف فشرده می‌کند (معمولاً ۲ تا ۴ گیگ). روی SSD/CPU های امروزی کندی محسوسی ندارد. کاملاً برگشت‌پذیر است.', 'Transparently compresses Windows’ own files (usually 2–4 GB). No noticeable slowdown on modern SSD/CPU. Fully reversible.')}</p>
      <div class="tool-foot"><span class="tag admin">${icon('shield', 12)}${t('needs_admin')}</span><button class="btn ghost sm" data-act="compactos" data-on="${c.enabled ? 0 : 1}">${icon(c.enabled ? 'undo' : 'play', 12)}${c.enabled ? T('غیرفعال‌سازی', 'Disable') : T('فعال‌سازی', 'Enable')}</button></div></div>
    <div class="tool"><div class="tool-top"><span class="tool-ic">${icon('moon', 18)}</span><b>${esc(P(K.ACTIONS.hibernateOff.t))}${hib ? ' · ' + fmtBytes(hib.s) : ''}</b></div><p>${esc(P(K.ACTIONS.hibernateOff.d))}</p>
      <div class="tool-foot"><span class="tag admin">${icon('shield', 12)}${t('needs_admin')}</span><button class="btn ghost sm" data-act="run-action" data-a="hibernateOff">${icon('play', 12)}${t('run')}</button></div></div>
    <div class="tool"><div class="tool-top"><span class="tool-ic">${icon('moon', 18)}</span><b>${esc(P(K.ACTIONS.hibernateReduced.t))}</b></div><p>${esc(P(K.ACTIONS.hibernateReduced.d))}</p>
      <div class="tool-foot"><span class="tag admin">${icon('shield', 12)}${t('needs_admin')}</span><button class="btn ghost sm" data-act="run-action" data-a="hibernateReduced">${icon('play', 12)}${t('run')}</button></div></div>
    <div class="tool"><div class="tool-top"><span class="tool-ic">${icon('shield', 18)}</span><b>${esc(P(K.ACTIONS.dismCleanup.t))}</b></div><p>${esc(P(K.ACTIONS.dismCleanup.d))}</p>
      <div class="tool-foot"><span class="tag admin">${icon('shield', 12)}${t('needs_admin')}</span><button class="btn ghost sm" data-act="run-action" data-a="dismCleanup">${icon('play', 12)}${t('run')}</button></div></div></div>`;
}

// ═════════════════════════ free without deleting: move + compress ═════════════════════════
async function loadMove() {
  const S = state.moveView;
  S.loading = true; renderMove();
  try { S.status = await api.move.status(); } catch (e) { toast(errText(e), 'err'); S.status = { presets: [], moves: [] }; }
  S.loading = false;
  if (state.view === 'move') renderMove();
}
function folderSize(p) {
  if (!state.result) return null;
  const f = state.result.folders.find((x) => lowerP(x.p) === lowerP(p));
  return f ? f.s : null;
}
function renderMove() {
  const el = $('#view-move');
  const S = state.moveView;
  const intro = T('فضای درایو C را بدون حذف چیزی آزاد کنید: پوشه‌های حجیم به درایو دیگر منتقل می‌شوند و یک Junction جای آن‌ها ساخته می‌شود تا برنامه‌ها چیزی متوجه نشوند؛ یا پوشه‌ها به‌صورت شفاف فشرده می‌شوند.', 'Free drive C without deleting anything: big folders move to another drive with a junction left behind so apps notice nothing — or folders are transparently compressed.');
  const tb = tabs(S.tab, [['move', T('انتقال به درایو دیگر', 'Move to another drive'), 'move'], ['compress', T('فشرده‌سازی شفاف NTFS', 'Transparent NTFS compression'), 'compress']], 'mv-tab');
  if (S.tab === 'compress') { el.innerHTML = head(t('nav_move'), intro) + tb + compressHtml(); return; }
  if (!S.status && !S.loading) { loadMove(); return; }
  if (S.loading) { el.innerHTML = head(t('nav_move'), intro) + tb + loading(); return; }
  const sys = (state.env.env.SYSTEMDRIVE || 'C:').toUpperCase();
  const targets = otherDrives(sys);
  if (!S.targetDrive || !targets.some((d) => d.letter === S.targetDrive)) S.targetDrive = targets.length ? targets.slice().sort((a, b) => b.free - a.free)[0].letter : null;
  const st = S.status;
  el.innerHTML = head(t('nav_move'), intro) + tb + (targets.length ? `
    <div class="card" style="margin-bottom:16px;display:flex;gap:14px;align-items:center;flex-wrap:wrap">${icon('disk', 20)}<b>${T('درایو مقصد:', 'Target drive:')}</b>
      ${targets.map((d) => `<button class="fchip ${S.targetDrive === d.letter ? 'on' : ''}" data-act="mv-target" data-d="${esc(d.letter)}"><bdi class="ltr">${esc(d.letter)}</bdi> · ${fmtBytes(d.free, true)} ${t('free')}</button>`).join('')}
      <span class="muted" style="font-size:12px">${T('مسیر: ', 'Folder: ')}<bdi class="ltr">${esc((S.targetDrive || '') + '\\DriveHound-Moved')}</bdi></span>
      <button class="btn ghost sm" data-act="mv-custom" style="margin-inline-start:auto">${icon('folderPlus', 14)}${T('انتقال یک پوشه دلخواه…', 'Move any folder…')}</button></div>
    <div class="callout">${icon('shield', 16)}<span>${T('روند امن: ۱) تغییر نام پوشه مبدأ (اگر برنامه‌ای از آن استفاده کند، کار متوقف می‌شود) ۲) کپی ۳) مقایسه حجم و تعداد فایل‌ها ۴) ساخت Junction ۵) حذف نسخه قدیمی. در هر خطا همه چیز به حالت قبل برمی‌گردد و هر انتقال قابل بازگشت است.', 'Safe pipeline: 1) rename source (stops if any app is using it) 2) copy 3) verify size & file count 4) create junction 5) remove old copy. Any error rolls everything back, and every move is reversible.')}</span></div>
    <div class="card" style="margin-bottom:16px"><div class="card-head"><h3>${icon('rocket', 18)}${T('پوشه‌های شناخته‌شده ابزارها', 'Known tool folders')}</h3><span class="sub">${T('همراه با تنظیم متغیر محیطی رسمی هر ابزار', 'with each tool’s official environment variable')}</span></div>
      <div class="list" style="--cols: minmax(0,1fr) 110px 150px 170px">
        <div class="list-head"><span>${t('col_name')}</span><span>${t('col_size')}</span><span>${T('متغیر', 'Variable')}</span><span></span></div>
        ${st.presets.filter((p) => p.exists).map((p) => {
          const size = folderSize(p.path);
          const moved = st.moves.find((m) => lowerP(m.source) === lowerP(p.path));
          return `<div class="row" style="cursor:default"><div class="row-name"><span class="fi" style="--c:var(--c4)">${icon('folder', 16)}</span><span class="nm"><b>${esc(p.name)}</b>${ptail(p.linked ? p.path + '  →  ' + (p.linkTarget || '') : p.path)}</span></div>
            <span class="sz">${size != null ? fmtBytes(size) : '—'}</span><code>${esc(p.env)}</code>
            <span style="display:flex;justify-content:flex-end;gap:6px">${p.linked ? (moved ? `<span class="tag safe">${icon('check', 11)}${T('منتقل شده', 'moved')}</span><button class="btn ghost xs" data-act="mv-restore" data-id="${esc(moved.id)}">${icon('undo', 12)}${T('برگرداندن', 'Restore')}</button>` : `<span class="tag info">${icon('link', 11)}Junction</span>`) : `<button class="btn primary xs" data-act="mv-preset" data-id="${esc(p.id)}" ${S.targetDrive ? '' : 'disabled'}>${icon('move', 12)}${T('انتقال', 'Move')}</button>`}</span></div>`;
        }).join('') || `<div class="empty">${t('no_results')}</div>`}</div></div>
    <div class="card" style="margin-bottom:16px"><div class="card-head"><h3>${icon('box', 18)}Docker Desktop</h3></div>
      <p class="t2" style="margin:0;font-size:13px">${T('دیسک مجازی Docker را فقط از داخل خود Docker Desktop منتقل کنید: Settings ← Resources ← Advanced ← Disk image location. Docker خودش داده‌ها را امن جابه‌جا می‌کند. توزیع‌های WSL معمولی را از صفحه «Docker و WSL» با دستور رسمی wsl --manage منتقل کنید.', 'Move Docker’s virtual disk only from Docker Desktop itself: Settings → Resources → Advanced → Disk image location. Docker relocates the data safely. Move regular WSL distros from the “Docker & WSL” page with the official wsl --manage.')}</p></div>
    <div class="card"><div class="card-head"><h3>${icon('history', 18)}${T('انتقال‌های انجام‌شده', 'Completed moves')}</h3></div>
      <div class="list" style="--cols: minmax(0,1fr) 110px 140px 130px">
        <div class="list-head"><span>${t('col_path')}</span><span>${t('col_size')}</span><span>${T('تاریخ', 'Date')}</span><span></span></div>
        ${st.moves.map((m) => `<div class="row" style="cursor:default"><div class="row-name"><span class="fi" style="--c:var(--c1)">${icon('link', 16)}</span><span class="nm">${ptail(m.source)}${ptail('→ ' + m.target)}</span></div>
          <span class="sz">${fmtBytes(m.size)}</span><span class="muted" style="font-size:12px">${fmtDate(m.date, true)}</span>
          <span><button class="btn ghost xs" data-act="mv-restore" data-id="${esc(m.id)}">${icon('undo', 12)}${T('برگرداندن', 'Restore')}</button></span></div>`).join('') || `<div class="empty">${T('هنوز انتقالی انجام نشده', 'No moves yet')}</div>`}</div></div>`
    : `<div class="callout warn">${icon('alert', 16)}<span>${T('درایو دیگری برای انتقال پیدا نشد.', 'No other drive available.')}</span></div>`);
}
async function moveFlow(source, presetId, envVar) {
  const S = state.moveView;
  if (!S.targetDrive) { toast(T('درایو مقصد را انتخاب کنید', 'Choose a target drive'), 'err'); return; }
  const procs = await api.move.procs(source).catch(() => []);
  const size = folderSize(source);
  const m = modal(`<div class="modal-head">${icon('move', 20)}<h3>${T('انتقال به درایو ', 'Move to drive ')}${esc(S.targetDrive)}</h3><button class="icon-btn" data-act="close-modal">${icon('x', 18)}</button></div>
    <div class="modal-body">${ptail(source)}<div class="num" style="margin:8px 0;font-weight:700">${size != null ? fmtBytes(size) : ''}</div>
      ${procs.length ? `<div class="callout bad">${icon('xCircle', 16)}<span>${T('این برنامه‌ها از داخل این پوشه در حال اجرا هستند؛ قبل از ادامه ببندیدشان: ', 'These programs are running from this folder; close them first: ')}${procs.map((p) => esc(p.name)).join(', ')}</span></div>` : ''}
      <div class="callout">${icon('info', 16)}<span>${T('برنامه‌های مرتبط (Android Studio، IDE، شبیه‌ساز، ترمینال‌ها) را ببندید. اگر فایلی در حال استفاده باشد، انتقال شروع نمی‌شود و چیزی تغییر نمی‌کند.', 'Close related apps (Android Studio, IDEs, emulators, terminals). If any file is in use, the move does not start and nothing changes.')}</span></div>
      ${envVar ? `<div class="note">${icon('gear', 14)}<span>${T('متغیر محیطی کاربر ', 'User environment variable ')}<code>${esc(envVar)}</code>${T(' هم به مسیر جدید تنظیم می‌شود (برنامه‌های باز باید دوباره اجرا شوند).', ' is also set to the new location (running apps need a restart).')}</span></div>` : ''}</div>
    <div class="modal-foot"><button class="btn ghost" data-act="close-modal">${t('cancel')}</button><button class="btn primary" id="mvGo">${icon('move', 14)}${T('شروع انتقال', 'Start move')}</button></div>`);
  $('#mvGo', m).addEventListener('click', async () => {
    closeModal();
    const ov = opOverlay(T('در حال انتقال…', 'Moving…'));
    const off = api.onOpProgress((p) => { if (p.op !== 'move') return; ov.update(p.phase === 'copy' ? `${fmtBytes(p.bytes || 0)} / ${fmtBytes(p.total || 0)}` : p.phase === 'verify' ? T('بررسی صحت…', 'Verifying…') : T('پاکسازی نسخه قدیمی…', 'Removing old copy…'), p.total ? (p.bytes || 0) / p.total : null); });
    try {
      const rec = await api.move.run({ source, targetBase: S.targetDrive + '\\DriveHound-Moved', envVar: envVar || undefined, presetId: presetId || undefined });
      toast(T('منتقل شد: ', 'Moved: ') + fmtBytes(rec.size) + ' → ' + esc(rec.target), 'ok', 8000);
    } catch (e) {
      const msg = errText(e);
      toast(/in-use/.test(msg) ? T('یک برنامه از این پوشه استفاده می‌کند؛ آن را ببندید و دوباره امتحان کنید. چیزی تغییر نکرد.', 'An app is using this folder; close it and retry. Nothing was changed.') : msg, 'err', 9000);
    }
    off(); ov.close();
    state.drives = await api.drives();
    S.status = null; loadMove();
  });
}
function compressCandidates() {
  if (!state.result) return [];
  const want = new Set(['android-sdk', 'android-sysimg', 'flutter-sdk', 'steam-games', 'loc-apps', 'ai-models', 'vscode-ext']);
  const out = [];
  for (const f of state.result.folders) {
    if (f.s < 1024 ** 3) continue;
    const c = cls(f.p, true);
    if (!want.has(c.id)) continue;
    if (out.some((o) => lowerP(f.p).startsWith(lowerP(o.path) + '\\'))) continue;
    out.push({ path: f.p, size: f.s, c });
  }
  return out.slice(0, 40);
}
function compressHtml() {
  const S = state.moveView;
  const cand = compressCandidates();
  return `<div class="callout">${icon('info', 16)}<span>${T('فشرده‌سازی LZX ویندوز برای فایل‌هایی که زیاد نوشته نمی‌شوند (SDKها، بازی‌ها، IDEها) معمولاً ۳۰ تا ۵۰٪ صرفه‌جویی دارد. برنامه‌ها مثل قبل کار می‌کنند و هر زمان قابل برگشت است. هرگز روی دیسک‌های مجازی، دیتابیس‌ها یا خود ویندوز اعمال نکنید.', 'Windows LZX compression saves 30–50% on rarely-written files (SDKs, games, IDEs). Apps keep working and it is reversible anytime. Never use it on virtual disks, databases or Windows itself.')}</span><button class="btn ghost sm" data-act="cmp-custom">${icon('folderPlus', 14)}${T('پوشه دلخواه…', 'Any folder…')}</button></div>
    <div class="card"><div class="card-head"><h3>${icon('compress', 18)}${T('پیشنهادها از روی اسکن', 'Suggestions from your scan')}</h3></div>
      ${state.result ? `<div class="list" style="--cols: minmax(0,1fr) 110px 120px 210px"><div class="list-head"><span>${t('col_path')}</span><span>${t('col_size')}</span><span>${T('صرفه‌جویی تخمینی', 'Est. saving')}</span><span></span></div>
      ${cand.map((x) => { const risk = S.risk.get(x.path); return `<div class="row" style="cursor:default"><div class="row-name"><span class="fi" style="--c:${GROUPS[groupOf(x.c)].c}">${icon('folder', 16)}</span><span class="nm"><b>${esc(P(x.c.t))}</b>${ptail(x.path)}${risk && risk.length ? `<span class="sub" style="color:var(--caution-t)">${icon('alert', 11)} ${T('شامل فایل‌های پرنوشتن: ', 'Contains write-heavy files: ')}${esc(baseName(risk[0]))}</span>` : ''}</span></div>
        <span class="sz">${fmtBytes(x.size)}</span><span class="num muted">~${fmtBytes(x.size * 0.35, true)}</span>
        <span style="display:flex;gap:6px;justify-content:flex-end"><button class="btn primary xs" data-act="cmp-run" data-p="${esc(x.path)}">${icon('compress', 12)}${T('فشرده‌سازی', 'Compress')}</button><button class="btn ghost xs" data-act="cmp-undo" data-p="${esc(x.path)}">${icon('undo', 12)}${T('برگرداندن', 'Undo')}</button></span></div>`; }).join('') || `<div class="empty">${t('no_results')}</div>`}</div>` : `<div class="empty">${t('no_scan')}</div>`}</div>`;
}
async function compressFlow(p, decompress) {
  const risk = decompress ? [] : await api.compact.risk(p).catch(() => []);
  state.moveView.risk.set(p, risk);
  const m = modal(`<div class="modal-head">${icon('compress', 20)}<h3>${decompress ? T('حذف فشرده‌سازی', 'Remove compression') : T('فشرده‌سازی LZX', 'LZX compression')}</h3><button class="icon-btn" data-act="close-modal">${icon('x', 18)}</button></div>
    <div class="modal-body">${ptail(p)}
      ${risk.length ? `<div class="callout warn" style="margin-top:10px">${icon('alert', 16)}<span>${T('این پوشه فایل‌هایی دارد که مرتب نوشته می‌شوند (فشرده‌سازی آن‌ها را کند می‌کند): ', 'This folder has files that are written often (compression slows them): ')}${risk.slice(0, 4).map((x) => esc(baseName(x))).join(', ')}</span></div>` : ''}
      <div class="note">${icon('terminal', 14)}<span>${t('terminal_note')}</span></div></div>
    <div class="modal-foot"><button class="btn ghost" data-act="close-modal">${t('cancel')}</button><button class="btn primary" id="cmpGo">${icon('play', 14)}${t('run')}</button></div>`);
  $('#cmpGo', m).addEventListener('click', async () => {
    closeModal();
    try { await api.compact.folder(p, !!decompress); toast(t('act_started'), 'info'); } catch (e) { toast(errText(e), 'err'); }
  });
}

// ═════════════════════════ history & quarantine ═════════════════════════
const OP_LABEL = {
  delete: ['حذف', 'Delete', 'trash'], action: ['ابزار سیستمی', 'System tool', 'gear'], uninstall: ['حذف برنامه', 'Uninstall', 'grid'], restore: ['بازگردانی از قرنطینه', 'Restore', 'undo'],
  purge: ['پاکسازی قرنطینه', 'Purge quarantine', 'trash'], hardlink: ['هاردلینک تکراری‌ها', 'Hard-link duplicates', 'link'],
  'docker-remove': ['حذف از Docker', 'Docker remove', 'box'], 'docker-prune': ['Docker prune', 'Docker prune', 'box'], 'wsl-move': ['انتقال WSL', 'WSL move', 'move'],
  'driver-delete': ['حذف درایور', 'Driver removal', 'cpu'], 'shadow-delete': ['حذف Shadow Copy', 'Shadow copy delete', 'history'], 'shadow-resize': ['تغییر سقف Restore', 'Restore size', 'history'],
  compactos: ['CompactOS', 'CompactOS', 'compress'], compress: ['فشرده‌سازی', 'Compress', 'compress'], decompress: ['حذف فشرده‌سازی', 'Decompress', 'compress'],
  move: ['انتقال به درایو دیگر', 'Move to drive', 'move'], 'move-restore': ['برگرداندن انتقال', 'Undo move', 'undo'], 'quarantine-expired': ['انقضای قرنطینه', 'Quarantine expired', 'clock'],
};
async function loadHistory() {
  const S = state.hist;
  [S.list, S.quarantine] = await Promise.all([api.history().catch(() => []), api.quarantine.list().catch(() => [])]);
  if (state.view === 'history') renderHistory();
}
function renderHistory() {
  const el = $('#view-history');
  const S = state.hist;
  const intro = T('هر عملیاتی که DriveHound انجام می‌دهد (حذف، انتقال، فشرده‌سازی، ابزارها) اینجا ثبت می‌شود. موارد قرنطینه‌شده تا زمان انقضا قابل بازگشت هستند.', 'Every operation DriveHound performs (delete, move, compress, tools) is logged here. Quarantined items stay restorable until they expire.');
  if (!S.list) { el.innerHTML = head(t('nav_history'), intro) + loading(); loadHistory(); return; }
  const qItems = S.quarantine.flatMap((b) => (b.items || []).filter((i) => !i.restored));
  const tb = tabs(S.tab, [['history', T('تاریخچه عملیات', 'Operation history'), 'history'], ['quarantine', T('قرنطینه', 'Quarantine') + (qItems.length ? ` (${fmtNum(qItems.length)})` : ''), 'archive']], 'hist-tab');
  let body;
  if (S.tab === 'history') {
    const all = S.list;
    const F = Filters.create('history', {
      text: (h) => JSON.stringify(h),
      multi: [{ key: 'op', label: T('نوع عملیات', 'Operation'), icon: 'activity', options: topValues(all, (h) => h.op, 30).map(([v, n]) => ({ v, label: OP_LABEL[v] ? T(OP_LABEL[v][0], OP_LABEL[v][1]) : v, count: n })), acc: (h) => h.op }],
      age: { acc: (h) => h.ts, label: T('زمان', 'Time') }, size: { acc: (h) => h.bytes || 0 },
      sort: { options: [{ k: 'ts', label: T('زمان', 'Time'), acc: (h) => h.ts }, { k: 'bytes', label: T('فضای آزادشده', 'Freed'), acc: (h) => h.bytes || 0 }], default: { k: 'ts', dir: -1 } },
    }, () => renderHistory());
    const rows = F.apply(all);
    body = `<div class="stat-row"><div class="mini-stat"><b class="num">${fmtNum(all.length)}</b><span>${T('عملیات ثبت‌شده', 'operations logged')}</span></div><div class="mini-stat"><b class="num">${fmtBytes(sum(all, (h) => h.bytes))}</b><span>${T('کل فضای آزادشده', 'total space freed')}</span></div></div>
      <div class="card" style="padding:12px 12px 8px">${F.bar({ count: fmtNum(rows.length) })}
      <div class="list" style="--cols: minmax(0,1fr) 120px 170px">${F.head([{ label: T('عملیات', 'Operation') }, { label: T('آزادشده', 'Freed'), sk: 'bytes' }, { label: T('زمان', 'Time'), sk: 'ts' }])}
      ${rows.slice(0, 500).map((h) => { const L = OP_LABEL[h.op] || [h.op, h.op, 'activity']; const items = h.items || []; const firstPath = (items[0] && items[0].path) || h.path || h.source || h.root || h.app || h.action || ''; return `<div class="row" style="cursor:default">
        <div class="row-name"><span class="fi" style="--c:var(--c7)">${icon(L[2], 16)}</span><span class="nm"><b>${esc(T(L[0], L[1]))}${h.mode ? ' · ' + esc(h.mode) : ''}${h.count ? ' · ' + fmtNum(h.okCount ?? h.count) + '/' + fmtNum(h.count) : ''}</b>${firstPath ? ptail(String(firstPath)) : ''}${items.some((i) => i.ok === false) ? `<span class="sub" style="color:var(--danger-t)">${fmtNum(items.filter((i) => i.ok === false).length)} ${T('خطا', 'failed')}</span>` : ''}</span></div>
        <span class="sz">${h.bytes ? fmtBytes(h.bytes) : '—'}</span><span class="muted" style="font-size:12px">${fmtDate(h.ts, true)}</span></div>`; }).join('') || `<div class="empty">${t('no_results')}</div>`}</div></div>`;
  } else {
    body = S.quarantine.length ? S.quarantine.map((b) => {
      const live = (b.items || []).filter((i) => !i.restored);
      const days = Math.max(0, Math.ceil((b.expires - Date.now()) / 86400000));
      return `<div class="card" style="margin-bottom:14px"><div class="card-head"><div><h3>${icon('archive', 18)}${fmtDate(b.created, true)} <span class="muted num" style="font-weight:500">· ${fmtNum(live.length)} ${T('مورد', 'items')} · ${fmtBytes(sum(live, (i) => i.size))}</span></h3>
        <div class="sub">${ptail(b.root || '')} · ${b.missing ? T('پوشه قرنطینه پیدا نشد', 'quarantine folder missing') : T(`${fmtNum(days)} روز تا حذف خودکار`, `${days} days until automatic purge`)}</div></div>
        <div style="display:flex;gap:6px">${live.length ? `<button class="btn ghost sm" data-act="q-restore" data-id="${esc(b.id)}">${icon('undo', 13)}${T('بازگردانی همه', 'Restore all')}</button>` : ''}<button class="btn ghost sm" data-act="q-purge" data-id="${esc(b.id)}" style="color:var(--danger-t)">${icon('trash', 13)}${T('حذف دائمی الان', 'Purge now')}</button></div></div>
        <div class="list" style="--cols: minmax(0,1fr) 110px 120px">${live.map((i) => `<div class="row" style="cursor:default"><div class="row-name"><span class="fi" style="--c:var(--c7)">${icon(i.isDir ? 'folder' : 'file', 16)}</span><span class="nm"><b>${esc(baseName(i.orig))}</b>${ptail(i.orig)}</span></div><span class="sz">${fmtBytes(i.size)}</span>
          <span><button class="btn ghost xs" data-act="q-restore-one" data-id="${esc(b.id)}" data-p="${esc(i.stored)}">${icon('undo', 12)}${T('بازگردانی', 'Restore')}</button></span></div>`).join('') || `<div class="empty">${T('همه موارد بازگردانی شده‌اند', 'All items restored')}</div>`}</div></div>`;
    }).join('') : `<div class="card"><div class="empty">${icon('archive', 42)}<div>${state.settings.quarantineDrive ? T('قرنطینه خالی است.', 'Quarantine is empty.') : T('قرنطینه فعال نیست. در تنظیمات یک درایو قرنطینه (غیر از C) انتخاب کنید تا هنگام حذف، گزینه «قرنطینه» فعال شود.', 'Quarantine is off. Choose a quarantine drive (not C) in Settings to enable the “Quarantine” delete option.')}</div></div></div>`;
  }
  el.innerHTML = head(t('nav_history'), intro, `<button class="btn ghost sm" data-act="hist-reload">${icon('refresh', 14)}</button>`) + tb + body;
}

// ═════════════════════════ settings ═════════════════════════
state.settingsUi = { ai: null, shell: null, update: null };
async function renderSettings() {
  const el = $('#view-settings');
  const s = state.settings;
  const U = state.settingsUi;
  if (U.ai === null) { Promise.all([api.ai.status(), api.shellMenu.status()]).then(([a, sh]) => { U.ai = a; U.shell = sh; if (state.view === 'settings') renderSettings(); }); U.ai = false; }
  const sw = (key, on, extra = '') => `<label class="switch"><input type="checkbox" data-act="set-bool" data-k="${key}" ${on ? 'checked' : ''} ${extra}><span></span></label>`;
  const seg = (k, v, opts) => `<div class="seg-ctl">${opts.map(([val, l]) => `<button class="${String(v) === String(val) ? 'on' : ''}" data-act="set" data-k="${k}" data-v="${esc(val)}">${l}</button>`).join('')}</div>`;
  const drives = otherDrives(state.env.env.SYSTEMDRIVE);
  const m = s.monitor || {};
  el.innerHTML = head(t('nav_settings'), '') + `<div class="grid g-2">
    <div>
    <div class="card" style="margin-bottom:16px"><div class="card-head"><h3>${icon('gear', 18)}${T('عمومی', 'General')}</h3></div>
      <div class="set-row"><div><b>${t('set_lang')}</b><span>فارسی / English</span></div>${seg('lang', s.lang, [['fa', 'فارسی'], ['en', 'English']])}</div>
      <div class="set-row"><div><b>${t('set_theme')}</b></div>${seg('theme', s.theme, [['dark', icon('moon', 13) + ' ' + t('theme_dark')], ['light', icon('sun', 13) + ' ' + t('theme_light')]])}</div>
      <div class="set-row"><div><b>${t('set_delmode')}</b><span>${esc(s.delMode === 'trash' ? t('m_trash_note') : s.delMode === 'permanent' ? t('m_perm_note') : T('فضا فوراً آزاد و تا مدتی قابل بازگشت', 'Frees space now, restorable for a while'))}</span></div>${seg('delMode', s.delMode, [['trash', t('m_trash')], ['quarantine', T('قرنطینه', 'Quarantine')], ['permanent', t('m_perm')]])}</div>
      <div class="set-row"><div><b>${T('درایو قرنطینه', 'Quarantine drive')}</b><span>${T('موارد حذف‌شده به این درایو منتقل و بعد از مدت تعیین‌شده پاک می‌شوند.', 'Deleted items move here and are purged after the retention period.')}</span></div>
        <div style="display:flex;gap:6px;align-items:center"><select class="input sm" data-act-change="set-qdrive"><option value="">${T('غیرفعال', 'Off')}</option>${drives.map((d) => `<option value="${esc(d.letter)}" ${s.quarantineDrive === d.letter ? 'selected' : ''}>${esc(d.letter)} · ${fmtBytes(d.free, true)}</option>`).join('')}</select>
        <select class="input sm" data-act-change="set-qdays">${[3, 7, 14, 30].map((n) => `<option value="${n}" ${s.quarantineDays === n ? 'selected' : ''}>${fmtNum(n)} ${T('روز', 'days')}</option>`).join('')}</select></div></div>
      <div class="set-row"><div><b>${T('موتور اسکن', 'Scan engine')}</b><span>${T('توربو (MFT) جدول فایل‌های NTFS را مستقیم می‌خواند: چند ثانیه به‌جای یک دقیقه، نیازمند ادمین.', 'Turbo (MFT) reads the NTFS table directly: seconds instead of a minute, needs admin.')}</span></div>${seg('scanEngine', s.scanEngine, [['auto', T('خودکار', 'Auto')], ['walk', T('عادی', 'Standard')], ['mft', T('توربو', 'Turbo')]])}</div>
      <div class="set-row"><div><b>${T('بستن = رفتن به System Tray', 'Close to tray')}</b><span>${T('برای پایش خودکار در پس‌زمینه', 'Keeps background monitoring running')}</span></div>${sw('closeToTray', s.closeToTray)}</div>
      <div class="set-row"><div><b>${T('اجرا همراه ویندوز', 'Start with Windows')}</b><span>${T('مخفی در Tray اجرا می‌شود', 'Starts hidden in the tray')}</span></div>${sw('startAtLogin', s.startAtLogin, state.dev ? 'disabled' : '')}</div>
      <div class="set-row"><div><b>${T('منوی راست‌کلیک Explorer', 'Explorer right-click menu')}</b><span>${T('«<bdi>Analyze with DriveHound</bdi>» روی هر پوشه و درایو', '“Analyze with DriveHound” on any folder or drive')}</span></div>${sw('__shell', U.shell)}</div>
      <div class="set-row"><div><b>${t('set_admin')}</b><span>${t('admin_hint')}</span></div>${state.isAdmin ? `<span class="badge safe">${icon('shieldCheck', 13)}${t('admin_yes')}</span>` : `<button class="btn ghost sm" data-act="relaunch-admin">${icon('shield', 14)}${t('admin_relaunch')}</button>`}</div>
    </div>
    <div class="card" style="margin-bottom:16px"><div class="card-head"><h3>${icon('bell', 18)}${T('پایش خودکار و هشدار', 'Monitoring & alerts')}</h3><button class="btn ghost xs" data-act="mon-check">${icon('refresh', 12)}${T('بررسی الان', 'Check now')}</button></div>
      <div class="set-row"><div><b>${T('پایش فعال', 'Monitoring on')}</b><span>${T('فضای آزاد درایوها را دوره‌ای ثبت می‌کند و در صورت پر شدن ناگهانی، علت را پیدا و اعلان می‌دهد.', 'Samples free space periodically; on sudden growth it finds the cause and notifies you.')}</span></div>${sw('monitor.enabled', m.enabled)}</div>
      <div class="set-row"><div><b>${T('فاصله بررسی', 'Check interval')}</b></div><select class="input sm" data-act-change="set-num" data-k="monitor.intervalMin">${[15, 30, 60, 120, 360].map((n) => `<option value="${n}" ${m.intervalMin === n ? 'selected' : ''}>${fmtNum(n)} ${T('دقیقه', 'min')}</option>`).join('')}</select></div>
      <div class="set-row"><div><b>${T('آستانه هشدار رشد (۲۴ ساعت)', 'Growth alert threshold (24 h)')}</b></div><select class="input sm" data-act-change="set-num" data-k="monitor.thresholdGB">${[1, 2, 5, 10, 20].map((n) => `<option value="${n}" ${m.thresholdGB === n ? 'selected' : ''}>${fmtNum(n)} GB</option>`).join('')}</select></div>
      <div class="set-row"><div><b>${T('هشدار فضای کم', 'Low space warning')}</b></div><select class="input sm" data-act-change="set-num" data-k="monitor.lowFreePct">${[5, 10, 15, 20].map((n) => `<option value="${n}" ${m.lowFreePct === n ? 'selected' : ''}>&lt; ${fmtNum(n)}%</option>`).join('')}</select></div>
      <div class="set-row"><div><b>${T('گزارش هفتگی', 'Weekly report')}</b></div>${sw('monitor.weekly', m.weekly)}</div>
    </div>
    <div class="card"><div class="card-head"><h3>${icon('bot', 18)}${T('دستیار هوش مصنوعی', 'AI assistant')}</h3><button class="btn primary xs" data-act="ai-add">${icon('plus', 12)}${T('افزودن سرویس', 'Add provider')}</button></div>
      <p class="muted" style="margin:0 0 8px;font-size:12px">${T('Claude، OpenAI، Gemini، OpenRouter، Groq، DeepSeek، Mistral یا مدل محلی (Ollama / LM Studio) — هر سرویس سازگار با OpenAI. فقط مشخصات فایل ارسال می‌شود، نه محتوای آن.', 'Claude, OpenAI, Gemini, OpenRouter, Groq, DeepSeek, Mistral or a local model (Ollama / LM Studio) — any OpenAI-compatible service. Only file metadata is sent, never contents.')}</p>
      ${U.ai && U.ai.providers && U.ai.providers.length ? U.ai.providers.map((p) => { let host = 'api.anthropic.com'; if (p.baseUrl) { try { host = new URL(p.baseUrl).host; } catch { host = p.baseUrl; } } const on = U.ai.activeId === p.id; return `<div class="prov-row ${on ? 'on' : ''}">
        <button class="prov-radio" data-act="ai-active" data-id="${esc(p.id)}" title="${esc(T('استفاده از این سرویس', 'Use this provider'))}">${on ? icon('checkCircle', 18) : '<i></i>'}</button>
        <div class="prov-main"><b>${esc(p.name)}</b><span class="ltr">${esc(host)} · ${esc(p.model)}</span></div>
        <span class="tag ${p.needsKey ? (p.hasKey ? 'safe' : 'danger') : 'info'}">${icon(p.needsKey ? 'key' : 'cpu', 11)}${p.needsKey ? (p.hasKey ? T('کلید ذخیره شده', 'key saved') : T('بدون کلید', 'no key')) : T('محلی', 'local')}</span>
        <div class="prov-actions"><button class="icon-btn" data-act="ai-test" data-id="${esc(p.id)}" title="${esc(T('تست اتصال', 'Test connection'))}">${icon('zap', 15)}</button><button class="icon-btn" data-act="ai-edit" data-id="${esc(p.id)}" title="${esc(T('ویرایش', 'Edit'))}">${icon('gear', 15)}</button><button class="icon-btn" data-act="ai-del" data-id="${esc(p.id)}" title="${esc(T('حذف', 'Delete'))}" style="color:var(--danger-t)">${icon('trash', 15)}</button></div></div>`; }).join('') : `<div class="callout">${icon('info', 16)}<span>${T('هنوز سرویسی اضافه نشده است.', 'No provider added yet.')}</span></div>`}
      <div class="set-row"><div><b>${T('پنهان کردن نام کاربری در مسیرها', 'Hide user name in paths')}</b></div>${sw('ai.mask', s.ai.mask)}</div>
      <div class="set-row"><div><b>${T('ارسال نام زیرپوشه‌ها', 'Send child names')}</b><span>${T('دقت بیشتر؛ محتوای فایل‌ها هرگز ارسال نمی‌شود', 'Better accuracy; file contents are never sent')}</span></div>${sw('ai.children', s.ai.children)}</div>
    </div>
    </div>
    <div>
    <div class="card" style="margin-bottom:16px"><div class="card-head"><h3>${icon('filter', 18)}${T('قوانین شخصی', 'Custom rules')}</h3><span class="sub">${T('بر قوانین داخلی اولویت دارند', 'Override built-in rules')}</span></div>
      ${(s.userRules || []).map((r, i) => `<div class="rule-row"><span class="tag">${esc(r.match)}</span><code style="overflow:hidden;text-overflow:ellipsis">${esc(r.pattern)}</code>${badge(r.safety)}<span class="t2" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.title)}</span><button class="icon-btn xs" data-act="rule-del" data-i="${i}">${icon('x', 12)}</button></div>`).join('') || `<div class="muted" style="font-size:12.5px;padding:6px 0">${T('هنوز قانونی تعریف نشده.', 'No custom rules yet.')}</div>`}
      <div class="form-grid" style="margin-top:12px">
        <label>${T('نوع تطبیق', 'Match by')}<select class="input sm" id="rMatch" style="width:100%"><option value="path">${T('مسیر (%LOCALAPPDATA%/App/Cache یا D:/x/*)', 'Path (%LOCALAPPDATA%/App/Cache or D:/x/*)')}</option><option value="name">${T('نام پوشه/فایل', 'Folder/file name')}</option><option value="ext">${T('پسوند', 'Extension')}</option></select></label>
        <label>${T('الگو', 'Pattern')}<input class="input sm" id="rPattern" style="width:100%" maxlength="300"></label>
        <label>${T('وضعیت', 'Status')}<select class="input sm" id="rSafety" style="width:100%">${['safe', 'caution', 'user', 'danger'].map((x) => `<option value="${x}">${esc(P(K.SAFETY[x]))}</option>`).join('')}</select></label>
        <label>${T('عنوان', 'Title')}<input class="input sm" id="rTitle" style="width:100%" maxlength="120"></label>
        <label style="grid-column:1/-1">${T('توضیح', 'Note')}<input class="input sm" id="rNote" style="width:100%" maxlength="600"></label>
      </div><div style="text-align:end;margin-top:8px"><button class="btn primary sm" data-act="rule-add">${icon('plus', 13)}${T('افزودن قانون', 'Add rule')}</button></div></div>
    <div class="card" style="margin-bottom:16px"><div class="card-head"><h3>${icon('shieldPlus', 18)}${T('مسیرهای محافظت‌شده', 'Protected paths')}</h3><button class="btn ghost xs" data-act="prot-add">${icon('plus', 12)}${T('افزودن', 'Add')}</button></div>
      <p class="muted" style="margin:0 0 8px;font-size:12px">${T('DriveHound این مسیرها و هرچه داخلشان است را هرگز حذف، قرنطینه یا منتقل نمی‌کند (در هسته برنامه اعمال می‌شود).', 'DriveHound never deletes, quarantines or moves these paths or anything inside them (enforced in the core).')}</p>
      ${(s.protectedPaths || []).map((p, i) => `<div class="rule-row" style="grid-template-columns:minmax(0,1fr) 32px">${ptail(p)}<button class="icon-btn xs" data-act="prot-del" data-i="${i}">${icon('x', 12)}</button></div>`).join('') || `<div class="muted" style="font-size:12.5px">—</div>`}
      <div class="card-head" style="margin:14px 0 6px"><h3 style="font-size:13.5px">${icon('eyeOff', 16)}${T('پنهان از پیشنهادها', 'Hidden from suggestions')}</h3></div>
      ${(s.hiddenPaths || []).map((p, i) => `<div class="rule-row" style="grid-template-columns:minmax(0,1fr) 32px">${ptail(p)}<button class="icon-btn xs" data-act="hide-del" data-i="${i}">${icon('x', 12)}</button></div>`).join('') || `<div class="muted" style="font-size:12.5px">—</div>`}</div>
    <div class="card" style="margin-bottom:16px"><div class="card-head"><h3>${icon('download', 18)}${T('به‌روزرسانی', 'Updates')}</h3><span class="muted num">v${esc(state.version)}</span></div>
      <div class="set-row"><div><b>${T('بررسی نسخه جدید', 'Check for updates')}</b><span>${U.update ? esc(U.update) : T('آپدیت‌ها از مخزن رسمی انتشار دریافت و قبل از نصب با هش بررسی می‌شوند.', 'Updates come from the release feed and are hash-verified before install.')}</span></div><button class="btn ghost sm" data-act="upd-check">${icon('refresh', 13)}${T('بررسی', 'Check')}</button></div></div>
    <div class="card"><div class="card-head"><h3>${icon('info', 18)}${t('safety_legend')}</h3></div><div class="legend-safety">
      ${[['safe', 'cl_safe_sub'], ['caution', 'cl_caution_sub'], ['user', 'cl_user_sub'], ['danger', 'verdict_app']].map(([k, d]) => `<div>${badge(k)}<p>${t(d)}</p></div>`).join('')}
      </div><hr class="sep"><p class="t2" style="margin:0;font-size:13px">${t('about_text')}</p></div>
    </div></div>`;
}

Object.assign(VIEWS, { dupes: renderDupes, containers: renderContainers, system: renderSystem, move: renderMove, history: renderHistory, settings: renderSettings });
