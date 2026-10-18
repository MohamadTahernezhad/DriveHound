'use strict';
/* Event wiring and startup. Loaded last so every view function exists. */
/* global state, api, K, Filters, icon, esc, t, T, P, fmtNum, fmtBytes, reg, getItem, cls, lowerP, baseName, modal, closeModal, toast, errText,
   confirmDelete, runAction, askAI, startScan, pickDrive, rememberTarget, setView, renderView, renderAll, renderChrome, applyLang, applyTheme,
   openDrawer, closeDrawer, findNodeChain, exportReport, saveSettings, analyze, updateProgress, selectedItems, cleanupGroups, $, $$,
   renderDupes, dupAct, dupBulk, loadContainers, renderContainers, loadSystem, renderSystem,
   moveFlow, compressFlow, loadMove, renderMove, loadHistory, renderHistory, renderSettings, renderExplorer, renderFiles, renderChanges, renderCleanup, renderApps,
   refreshView, RELOAD, stale, debounce, drillInto, checkForUpdate, updateModal, startUpdateDownload, installUpdateNow */

const settingSet = (path, value) => {
  const parts = path.split('.');
  let o = state.settings;
  for (const p of parts.slice(0, -1)) { o[p] = o[p] || {}; o = o[p]; }
  o[parts[parts.length - 1]] = value;
};

const ACTS = {
  // navigation & scanning
  'pick-drive': (el) => pickDrive(el.dataset.drive),
  scan: (el, e) => { e.stopPropagation(); const d = el.dataset.drive || state.drive; rememberTarget(d); startScan(d); },
  'scan-turbo': (el, e) => { e.stopPropagation(); startScan(el.dataset.drive, 'mft'); },
  'scan-folder': async () => { const p = await api.pickFolder(); if (p) { rememberTarget(p); startScan(p); } },
  'forget-target': (el, e) => { e.stopPropagation(); state.settings.recentTargets = state.settings.recentTargets.filter((x) => x !== el.dataset.p); saveSettings().then(renderView); },
  'cancel-scan': async () => { await api.cancelScan(); state.scanning = false; renderView(); },
  go: (el) => setView(el.dataset.view),
  open: (el, e) => { if (e.target.closest('[data-act="toggle-sel"],[data-act="run-action"]')) return; const it = getItem(el.dataset.id); if (it) openDrawer(it); },
  'relaunch-admin': async () => { const ok = await api.relaunchAdmin(); if (!ok) toast(t('act_failed'), 'err'); },
  report: (el) => exportReport(el.dataset.f),
  more: (el) => { state.limits[el.dataset.k] = (state.limits[el.dataset.k] || 150) + 300; renderView(); },

  // explorer
  colorby: (el) => { state.explorer.colorBy = el.dataset.m; renderExplorer(); },
  crumb: (el) => { state.explorer.stack = state.explorer.stack.slice(0, +el.dataset.i + 1); renderExplorer(); },
  up: () => { if (state.explorer.stack.length > 1) { state.explorer.stack.pop(); renderExplorer(); } },
  'drill-to': (el) => drillInto(getItem(el.dataset.id)),
  // e.detail > 1: the second click of a double-click must not open the next folder too
  drill: (el, e) => { if (e.detail > 1) return; const it = getItem(el.dataset.id); if (it) drillInto(it); },

  // files / changes
  'export-files': async () => {
    const all = state.result.topFiles.map((x) => ({ x, c: cls(x.p, false) }));
    const rows = Filters.apply('files', all);
    const csv = ['path,size_bytes,size,status,type,modified'].concat(rows.map(({ x, c }) => [x.p, x.s, fmtBytes(x.s), P(K.SAFETY[c.safety]), P(c.t), x.m ? new Date(x.m).toISOString() : ''].map((v) => `"${String(v).replace(/"/g, '""').replace(/^[=+\-@]/, "'$&")}"`).join(','))).join('\r\n');
    const p = await api.exportFile('largest-files.csv', csv);
    if (p) toast(esc(p), 'ok');
  },
  'ch-tab': (el) => { state.changes.tab = el.dataset.t; renderChanges(); },

  // cleanup
  'toggle-sel': (el, e) => { e.stopPropagation(); const it = getItem(el.dataset.id); if (el.checked) state.cleanup.selected.add(it.path); else state.cleanup.selected.delete(it.path); renderCleanup(); },
  'sel-all-safe': () => { for (const i of cleanupGroups((l) => Filters.apply('cleanup', l)).safe) state.cleanup.selected.add(i.path); renderCleanup(); },
  'sel-clear': () => { state.cleanup.selected.clear(); renderCleanup(); },
  'clean-selected': () => { const items = selectedItems().map((i) => ({ ...i, contents: i.isDir && i.c.mode === 'contents' })); if (items.length) confirmDelete(items); },
  'run-action': (el, e) => { e.stopPropagation(); runAction(el.dataset.a, el.dataset.id ? getItem(el.dataset.id) : null); },

  // drawer
  'close-drawer': () => closeDrawer(),
  'close-modal': () => closeModal(),
  'delete-one': (el) => { const it = getItem(el.dataset.id); confirmDelete([{ ...it, c: cls(it.path, it.isDir), contents: el.dataset.contents === '1' }]); },
  reveal: (el) => api.reveal(getItem(el.dataset.id).path),
  'reveal-path': (el) => api.open(el.dataset.p),
  copy: (el) => { api.copy(getItem(el.dataset.id).path); toast(t('copied'), 'info', 1600); },
  'ask-ai': (el) => askAI(getItem(el.dataset.id)),
  'toggle-protect': async (el) => {
    const p = getItem(el.dataset.id).path;
    const list = state.settings.protectedPaths || [];
    state.settings.protectedPaths = list.some((x) => lowerP(x) === lowerP(p)) ? list.filter((x) => lowerP(x) !== lowerP(p)) : list.concat([p]);
    await saveSettings(); openDrawer(getItem(el.dataset.id));
  },
  'toggle-hide': async (el) => {
    const p = getItem(el.dataset.id).path;
    const list = state.settings.hiddenPaths || [];
    state.settings.hiddenPaths = list.some((x) => lowerP(x) === lowerP(p)) ? list.filter((x) => lowerP(x) !== lowerP(p)) : list.concat([p]);
    await saveSettings(); openDrawer(getItem(el.dataset.id)); renderChrome();
  },
  'move-item': (el) => { const it = getItem(el.dataset.id); closeDrawer(); state.moveView.tab = 'move'; setView('move'); setTimeout(() => moveFlow(it.path), 300); },
  'compress-item': (el) => compressFlow(getItem(el.dataset.id).path, false),

  // apps
  'apps-refresh': async () => { state.apps.list = null; await api.sysContext(true); renderApps(); },
  uninstall: (el) => {
    const a = getItem(el.dataset.id);
    const m = modal(`<div class="modal-head">${icon('trash', 20)}<h3>${t('uninstall')}: ${esc(a.name)}</h3><button class="icon-btn" data-act="close-modal">${icon('x', 18)}</button></div>
      <div class="modal-body"><p style="margin:0">${esc(a.publisher)} ${esc(a.version)}</p><div style="margin-top:10px"><code>${esc(a.uninstall)}</code></div></div>
      <div class="modal-foot"><button class="btn ghost" data-act="close-modal">${t('cancel')}</button><button class="btn danger" id="unGo">${icon('trash', 14)}${t('uninstall')}</button></div>`);
    $('#unGo', m).addEventListener('click', async () => { try { await api.uninstall(a.id); toast(t('act_started'), 'info'); } catch (e) { toast(errText(e), 'err'); } closeModal(); });
  },

  // duplicates
  'dup-add-root': async () => { const p = await api.pickFolder(); if (p && !state.dupes.roots.includes(p)) { state.dupes.roots.push(p); renderDupes(); } },
  'dup-add-drive': (el) => { const p = el.dataset.d + '\\'; if (!state.dupes.roots.includes(p)) { state.dupes.roots.push(p); renderDupes(); } },
  'dup-rm-root': (el) => { state.dupes.roots.splice(+el.dataset.i, 1); renderDupes(); },
  'dup-start': async () => {
    const S = state.dupes;
    S.minMB = Number($('#dupMin').value) || 10; S.exclude = $('#dupEx').value || '';
    if (!S.roots.length) return;
    S.running = true; S.progress = null; S.result = null; S.keep = new Map(); S.limit = 60;
    renderDupes();
    try { await api.dupes.start({ roots: S.roots, minSize: S.minMB * 1048576, exclude: S.exclude.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 50) }); } catch (e) { S.running = false; toast(errText(e), 'err'); renderDupes(); }
  },
  'dup-cancel': async () => { await api.dupes.cancel(); state.dupes.running = false; renderDupes(); },
  'dup-more': () => { state.dupes.limit += 100; renderDupes(); },
  'dup-keep': (el, e) => { e.stopPropagation(); state.dupes.keep.set(el.dataset.h, el.dataset.p); renderDupes(); },
  'dup-link': (el) => dupAct(getItem(el.dataset.id), 'link'),
  'dup-delete': (el) => dupAct(getItem(el.dataset.id), 'delete'),
  'dup-bulk-link': () => dupBulk('link'),
  'dup-bulk-delete': () => dupBulk('delete'),

  // docker & wsl
  'cont-reload': () => loadContainers(),
  'cont-tab': (el) => { state.containers.tab = el.dataset.t; renderContainers(); },
  'dk-prune': async (el) => {
    const w = el.dataset.w;
    try { const r = await api.docker.prune(w); toast(r.ok ? t('act_done') : esc(r.out), r.ok ? 'ok' : 'err', 6000); } catch (e) { toast(errText(e), 'err'); }
    loadContainers();
  },
  'dk-rm': (el) => {
    const { k, v, n } = el.dataset;
    const m = modal(`<div class="modal-head">${icon('trash', 20)}<h3>${T('حذف از Docker', 'Remove from Docker')}</h3><button class="icon-btn" data-act="close-modal">${icon('x', 18)}</button></div>
      <div class="modal-body"><b>${esc(n)}</b>${k === 'volume' ? `<div class="callout bad" style="margin-top:10px">${icon('alert', 16)}<span>${T('داده‌های این والیوم برای همیشه پاک می‌شود.', 'This volume’s data will be lost permanently.')}</span></div><label class="ack"><input type="checkbox" id="dkAck">${t('m_ack')}</label>` : ''}</div>
      <div class="modal-foot"><button class="btn ghost" data-act="close-modal">${t('cancel')}</button><button class="btn danger" id="dkGo" ${k === 'volume' ? 'disabled' : ''}>${icon('trash', 14)}${t('m_confirm')}</button></div>`);
    const ack = $('#dkAck', m); if (ack) ack.addEventListener('change', () => { $('#dkGo', m).disabled = !ack.checked; });
    $('#dkGo', m).addEventListener('click', async () => {
      closeModal();
      try { const r = await api.docker.remove(k, [v]); toast(r[0].ok ? t('act_done') : esc(r[0].error), r[0].ok ? 'ok' : 'err', 6000); } catch (e) { toast(errText(e), 'err'); }
      loadContainers();
    });
  },
  'wsl-shutdown': async () => { await api.wsl.shutdown(); toast(t('act_done')); loadContainers(); },
  'wsl-term': async (el) => { await api.wsl.terminate(el.dataset.n); loadContainers(); },
  'wsl-compact': (el) => { const d = getItem(el.dataset.id); runAction('compactVhdx', { path: d.vhd }); },
  'wsl-move': async (el) => {
    const dir = await api.move.pickTarget();
    if (!dir) return;
    toast(T('در حال انتقال توزیع… (ممکن است چند دقیقه طول بکشد)', 'Moving distro… (may take minutes)'), 'info', 6000);
    try { const r = await api.wsl.move(el.dataset.n, dir); toast(r.code === 0 ? t('act_done') : esc(r.stderr || r.stdout || 'failed'), r.code === 0 ? 'ok' : 'err', 8000); } catch (e) { toast(errText(e), 'err'); }
    loadContainers();
  },

  // system tools
  'sys-tab': (el) => { state.system.tab = el.dataset.t; renderSystem(); },
  'drv-sel': (el, e) => { e.stopPropagation(); const s = state.system.selected; if (el.checked) s.add(el.dataset.v); else s.delete(el.dataset.v); renderSystem(); },
  'drv-sel-all': () => { for (const d of Filters.apply('drivers', state.system.drivers || [])) if (d.removable) state.system.selected.add(d.published); renderSystem(); },
  'drv-delete': () => {
    const sel = (state.system.drivers || []).filter((d) => state.system.selected.has(d.published) && d.removable);
    const m = modal(`<div class="modal-head">${icon('cpu', 20)}<h3>${T('حذف درایورهای قدیمی', 'Remove old drivers')}</h3><button class="icon-btn" data-act="close-modal">${icon('x', 18)}</button></div>
      <div class="modal-body"><div class="m-list">${sel.map((d) => `<div class="m-item"><span>${esc(d.original)} <span class="muted ltr">${esc(d.version)}</span></span><span class="num">${fmtBytes(d.size, true)}</span><span class="ltr muted">${esc(d.published)}</span></div>`).join('')}</div>
        <div class="callout">${icon('shield', 16)}<span>${T('ویندوز حذف درایورهای در حال استفاده را رد می‌کند. یک پنجره UAC برای کل عملیات باز می‌شود.', 'Windows refuses to remove drivers in use. One UAC prompt covers the whole batch.')}</span></div></div>
      <div class="modal-foot"><button class="btn ghost" data-act="close-modal">${t('cancel')}</button><button class="btn danger" id="drvGo">${icon('trash', 14)}${t('m_confirm')}</button></div>`);
    $('#drvGo', m).addEventListener('click', async () => {
      closeModal();
      try { const r = await api.drivers.remove(sel.map((d) => d.published)); const ok = r.filter((x) => x.ok).length; toast(`${fmtNum(ok)} / ${fmtNum(r.length)} ${T('حذف شد', 'removed')}`, ok ? 'ok' : 'err', 7000); } catch (e) { toast(errText(e), 'err'); }
      state.system.selected = new Set(); state.system.drivers = null; loadSystem('drivers');
    });
  },
  'rp-del-oldest': async (el) => { const r = await api.restorePts.deleteOldest(el.dataset.d); toast(r.code === 0 ? t('act_done') : t('act_failed'), r.code === 0 ? 'ok' : 'err'); state.system.restore = null; loadSystem('restore'); },
  'rp-resize': async (el) => { const pct = Number($('#rp-pct-' + el.dataset.d[0]).value); const r = await api.restorePts.resize(el.dataset.d, pct); toast(r.code === 0 ? t('act_done') : t('act_failed'), r.code === 0 ? 'ok' : 'err'); state.system.restore = null; loadSystem('restore'); },
  compactos: async (el) => { await api.compact.setOs(el.dataset.on === '1'); toast(t('act_started'), 'info'); },

  // move / compress
  'mv-tab': (el) => { state.moveView.tab = el.dataset.t; renderMove(); },
  'mv-target': (el) => { state.moveView.targetDrive = el.dataset.d; renderMove(); },
  'mv-preset': (el) => { const p = state.moveView.status.presets.find((x) => x.id === el.dataset.id); if (p) moveFlow(p.path, p.id, p.env); },
  'mv-custom': async () => { const p = await api.pickFolder(); if (p) moveFlow(p); },
  'mv-restore': async (el) => {
    const m = modal(`<div class="modal-head">${icon('undo', 20)}<h3>${T('برگرداندن به جای قبلی', 'Move back')}</h3><button class="icon-btn" data-act="close-modal">${icon('x', 18)}</button></div>
      <div class="modal-body">${T('داده‌ها به محل اصلی برمی‌گردند، Junction حذف و متغیر محیطی به حالت قبل برمی‌گردد. برنامه‌های مرتبط را ببندید.', 'Data is copied back, the junction removed and the environment variable restored. Close related apps.')}</div>
      <div class="modal-foot"><button class="btn ghost" data-act="close-modal">${t('cancel')}</button><button class="btn primary" id="mrGo">${icon('undo', 14)}${t('run')}</button></div>`);
    $('#mrGo', m).addEventListener('click', async () => {
      closeModal();
      const ov = opOverlay(T('در حال برگرداندن…', 'Restoring…'));
      const off = api.onOpProgress((p) => { if (p.op === 'move' && p.total) ov.update(`${fmtBytes(p.bytes || 0)} / ${fmtBytes(p.total)}`, (p.bytes || 0) / p.total); });
      try { await api.move.restore(el.dataset.id); toast(t('act_done')); } catch (e) { toast(errText(e), 'err', 8000); }
      off(); ov.close(); state.drives = await api.drives(); state.moveView.status = null; loadMove();
    });
  },
  'cmp-run': (el) => compressFlow(el.dataset.p, false),
  'cmp-undo': (el) => compressFlow(el.dataset.p, true),
  'cmp-custom': async () => { const p = await api.pickFolder(); if (p) compressFlow(p, false); },

  // history & quarantine
  'hist-tab': (el) => { state.hist.tab = el.dataset.t; renderHistory(); },
  'hist-reload': () => { state.hist.list = null; renderHistory(); },
  'q-restore': async (el) => { try { const r = await api.quarantine.restore(el.dataset.id); toast(`${fmtNum(r.filter((x) => x.ok).length)} ${T('بازگردانی شد', 'restored')}`); } catch (e) { toast(errText(e), 'err'); } state.hist.list = null; renderHistory(); },
  'q-restore-one': async (el) => { try { const r = await api.quarantine.restore(el.dataset.id, el.dataset.p); toast(r[0] && r[0].ok ? T('بازگردانی شد: ', 'Restored: ') + esc(r[0].restoredTo) : t('act_failed'), r[0] && r[0].ok ? 'ok' : 'err'); } catch (e) { toast(errText(e), 'err'); } state.hist.list = null; renderHistory(); },
  'q-purge': (el) => {
    const m = modal(`<div class="modal-head">${icon('trash', 20)}<h3>${T('حذف دائمی از قرنطینه', 'Purge from quarantine')}</h3><button class="icon-btn" data-act="close-modal">${icon('x', 18)}</button></div>
      <div class="modal-body">${T('این موارد برای همیشه پاک می‌شوند و دیگر قابل بازگشت نیستند.', 'These items will be deleted forever and cannot be restored.')}</div>
      <div class="modal-foot"><button class="btn ghost" data-act="close-modal">${t('cancel')}</button><button class="btn danger" id="qpGo">${icon('trash', 14)}${t('m_confirm')}</button></div>`);
    $('#qpGo', m).addEventListener('click', async () => { closeModal(); try { await api.quarantine.purge(el.dataset.id); toast(t('act_done')); } catch (e) { toast(errText(e), 'err'); } state.hist.list = null; renderHistory(); });
  },

  // settings
  set: async (el) => {
    settingSet(el.dataset.k, el.dataset.v);
    await saveSettings();
    if (el.dataset.k === 'theme') applyTheme();
    renderAll();
  },
  'set-bool': async (el) => {
    if (el.dataset.k === '__shell') {
      try { state.settingsUi.shell = await api.shellMenu.set(el.checked); toast(t('act_done')); } catch (e) { toast(errText(e), 'err'); }
      renderSettings(); return;
    }
    settingSet(el.dataset.k, el.checked);
    await saveSettings(); renderSettings();
  },
  'mon-check': async () => { await api.monitor.check(); state.freeHist = null; toast(t('act_done')); },
  'ai-add': async () => { if (await providerEditor(null)) { state.settingsUi.ai = null; renderSettings(); } },
  'ai-edit': async (el) => {
    const st = await api.ai.status();
    const p = st.providers.find((x) => x.id === el.dataset.id);
    if (p) { await providerEditor(p); state.settingsUi.ai = null; renderSettings(); }
  },
  'ai-active': async (el) => { state.settingsUi.ai = await api.ai.setActive(el.dataset.id); state.settings = await api.getSettings(); renderSettings(); },
  'ai-test': async (el) => {
    toast(T('در حال تست اتصال…', 'Testing connection…'), 'info', 2500);
    try { const r = await api.ai.test(el.dataset.id); toast(T('اتصال برقرار است · ', 'Connected · ') + esc(r.model) + ' · ' + fmtNum(r.ms) + ' ms', 'ok', 6000); }
    catch (e) { toast(esc(AI_ERR(errText(e))), 'err', 7000); }
  },
  'ai-del': (el) => {
    const m = modal(`<div class="modal-head">${icon('trash', 20)}<h3>${T('حذف سرویس هوش مصنوعی', 'Remove AI provider')}</h3><button class="icon-btn" data-act="close-modal">${icon('x', 18)}</button></div>
      <div class="modal-body">${T('تنظیمات و کلید API این سرویس پاک می‌شود.', 'Its settings and API key will be deleted.')}</div>
      <div class="modal-foot"><button class="btn ghost" data-act="close-modal">${t('cancel')}</button><button class="btn danger" id="aiDelGo">${icon('trash', 14)}${t('m_confirm')}</button></div>`);
    $('#aiDelGo', m).addEventListener('click', async () => { closeModal(); state.settingsUi.ai = await api.ai.deleteProvider(el.dataset.id); state.settings = await api.getSettings(); renderSettings(); });
  },
  'rule-add': async () => {
    const r = { id: 'r' + Date.now().toString(36), match: $('#rMatch').value, pattern: $('#rPattern').value.trim(), safety: $('#rSafety').value, title: $('#rTitle').value.trim(), note: $('#rNote').value.trim() };
    if (!K.validateUserRule(r)) { toast(T('الگو نامعتبر است (مسیر باید با درایو یا %ENV% شروع شود؛ پسوند فقط حروف و عدد)', 'Invalid pattern (paths start with a drive or %ENV%; extensions are letters/digits)'), 'err', 6000); return; }
    state.settings.userRules = (state.settings.userRules || []).concat([r]);
    await saveSettings(); renderSettings(); toast(t('act_done'));
  },
  'rule-del': async (el) => { state.settings.userRules.splice(+el.dataset.i, 1); await saveSettings(); renderSettings(); },
  'prot-add': async () => { const p = await api.pickFolder(); if (p) { state.settings.protectedPaths = (state.settings.protectedPaths || []).concat([p]); await saveSettings(); renderSettings(); } },
  'prot-del': async (el) => { state.settings.protectedPaths.splice(+el.dataset.i, 1); await saveSettings(); renderSettings(); },
  'hide-del': async (el) => { state.settings.hiddenPaths.splice(+el.dataset.i, 1); await saveSettings(); renderSettings(); },
  // updates
  'upd-check': () => checkForUpdate(false),
  'upd-open': () => updateModal(),
  'upd-download': () => startUpdateDownload(),
  'upd-install': () => installUpdateNow(),
  'upd-page': () => api.update.openPage(),
};

// change events (selects)
const CHANGE = {
  'set-qdrive': async (el) => { state.settings.quarantineDrive = el.value || null; if (!el.value && state.settings.delMode === 'quarantine') state.settings.delMode = 'trash'; await saveSettings(); renderSettings(); },
  'set-qdays': async (el) => { state.settings.quarantineDays = Number(el.value); await saveSettings(); },
  'set-num': async (el) => { settingSet(el.dataset.k, Number(el.value)); await saveSettings(); },
};

// a click anywhere outside the details panel closes it (except clicks that open another item, and dialogs it opened)
const KEEPS_DRAWER = '#drawer, #modalRoot, .toasts, .op-overlay, #treemap, [data-act="open"], [data-act="drill"]';
document.addEventListener('click', (e) => {
  if (state.drawerItem && e.target.isConnected && !e.target.closest(KEEPS_DRAWER)) closeDrawer();
  if (Filters.onClick(e)) return;
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = ACTS[el.dataset.act];
  if (fn) { try { const r = fn(el, e); if (r && r.catch) r.catch((err) => toast(errText(err), 'err')); } catch (err) { toast(errText(err), 'err'); } }
});
document.addEventListener('input', (e) => { Filters.onInput(e); });
document.addEventListener('change', (e) => {
  if (Filters.onChange(e)) return;
  const el = e.target;
  if (el.dataset && el.dataset.actChange && CHANGE[el.dataset.actChange]) CHANGE[el.dataset.actChange](el);
  if (el.id === 'dupStrategy') { state.dupes.strategy = el.value; state.dupes.keep = new Map(); renderDupes(); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r')) { e.preventDefault(); if ($('#modalRoot').hidden) refreshView(); return; }
  if (Filters.onKey(e)) return;
  if (e.key === 'Escape') { if (!$('#modalRoot').hidden) closeModal(); else closeDrawer(); }
  if (e.key === 'Backspace' && state.view === 'explorer' && !/input|select|textarea/i.test(document.activeElement.tagName)) ACTS.up();
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { const q = document.querySelector('.view.active .fsearch input'); if (q) { e.preventDefault(); q.focus(); q.select(); } }
});
$$('.nav-item, #settingsBtn').forEach((n) => n.addEventListener('click', () => setView(n.dataset.view)));
$('#langToggle').addEventListener('click', async () => { state.settings.lang = state.settings.lang === 'fa' ? 'en' : 'fa'; await saveSettings(); renderAll(); if (state.drawerItem) openDrawer(state.drawerItem); });
$('#themeToggle').addEventListener('click', async () => { state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark'; await saveSettings(); applyTheme(); renderView(); });
$('#adminPill').addEventListener('click', () => { if (!state.isAdmin) ACTS['relaunch-admin'](); });
$('#refreshBtn').addEventListener('click', () => refreshView());
$('#updatePill').addEventListener('click', () => updateModal());
let resizeT = null;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (['explorer', 'dashboard'].includes(state.view)) renderView(); }, 200); });

// ───────── core events ─────────
api.onProgress((p) => { state.progress = p; if (state.view === 'dashboard') updateProgress(); });
api.onDone(async (r) => {
  state.scanning = false;
  state.result = r;
  await analyze();
  state.drives = await api.drives();
  state.freeHist = null;
  toast(`${t('scan')} ✓ ${fmtBytes(r.stats.bytes)} · ${fmtNum(r.stats.files)} ${t('files')} · ${r.engine === 'mft' ? 'MFT ' : ''}${Math.round(r.elapsed / 100) / 10}s`, 'ok', 6000);
  renderChrome(); renderView();
});
api.onCancelled(() => { state.scanning = false; renderView(); });
api.onError((msg) => { state.scanning = false; toast(esc(String(msg)).slice(0, 200), 'err', 8000); renderView(); });
api.onNotice((n) => {
  if (n.kind === 'mft-fallback') {
    const why = { 'uac-declined': T('اجازه ادمین داده نشد', 'admin permission was declined'), 'access-denied': T('دسترسی ادمین لازم است', 'admin rights required'), 'not-ntfs': T('درایو NTFS نیست', 'drive is not NTFS'), 'no-helper': T('ماژول توربو پیدا نشد', 'turbo module missing') }[n.error] || n.error;
    toast(T('اسکن توربو انجام نشد (', 'Turbo scan unavailable (') + esc(why) + T(') — اسکن عادی انجام می‌شود', ') — running a standard scan'), 'info', 7000);
  }
});
api.onBackgroundScan(async ({ root }) => {
  if (state.scanning || lowerP(root) !== lowerP(String(state.drive || '') + (/^[a-zA-Z]:$/.test(state.drive) ? '\\' : ''))) return;
  state.result = await api.lastScan(root); await analyze(); renderChrome(); if (['dashboard', 'changes'].includes(state.view)) renderView();
});
api.onDupesProgress((p) => { state.dupes.progress = p; if (state.view === 'dupes') renderDupes(); });
api.onDupesDone((r) => { state.dupes.running = false; state.dupes.result = r; if (state.view === 'dupes') renderDupes(); });
api.onDupesError((m) => { state.dupes.running = false; toast(esc(m).slice(0, 200), 'err'); renderDupes(); });
// requests that arrive before boot finished (command line / Explorer menu) are queued
let booted = false;
const pendingAnalyze = [];
function analyzeTarget(p) { rememberTarget(p); startScan(/^[a-zA-Z]:\\?$/.test(p) ? p.slice(0, 2) : p); }
api.onAnalyze((p) => { if (!p) return; if (booted) analyzeTarget(p); else pendingAnalyze.push(p); });
api.onNav((n) => { if (n.view === 'changes') state.changes.tab = 'compare'; setView(n.view); });
// an operation changed the disk (delete, tool, Docker, move…): mark cached views stale and refresh the current one
const refreshSoon = debounce(() => { if (booted) refreshView(true); }, 400);
api.onOpsChanged((op) => {
  for (const v of Object.keys(RELOAD)) if (v !== 'apps' || op === 'uninstall') stale.add(v);
  stale.delete('settings');
  refreshSoon();
});
api.onAlert((ev) => { state.freeHist = null; if (ev.kind === 'growth') toast(T(`درایو ${ev.drive} ناگهان ${fmtBytes(ev.drop)} پر شد`, `Drive ${ev.drive} suddenly lost ${fmtBytes(ev.drop)}`), 'info', 9000); });

// ───────── boot ─────────
(async function boot() {
  const env = await api.env();
  state.env = env; state.isAdmin = env.isAdmin; state.version = env.version; state.dev = env.dev; state.hasHelper = env.hasHelper;
  state.settings = await api.getSettings();
  K.init(env.env);
  K.setUserRules(state.settings.userRules);
  applyLang(); applyTheme();
  renderChrome();
  state.drives = await api.drives();
  const sys = state.drives.find((d) => d.system) || state.drives[0];
  const saved = state.settings.drive;
  state.drive = saved && (state.drives.some((d) => d.letter === saved) || (state.settings.recentTargets || []).includes(saved)) ? saved : sys && sys.letter;
  if (state.drive) { state.result = await api.lastScan(state.drive.length === 2 ? state.drive + '\\' : state.drive); await analyze(); }
  renderAll();
  booted = true;
  if (pendingAnalyze.length) analyzeTarget(pendingAnalyze.pop());
  // quiet update check shortly after start, then every 6 hours (the app often lives in the tray)
  setTimeout(() => checkForUpdate(true), 8000);
  setInterval(() => checkForUpdate(true), 6 * 3600 * 1000);
})().catch((e) => { document.body.insertAdjacentHTML('beforeend', `<div class="toast err" style="position:fixed;bottom:20px;left:20px">${esc(String(e && e.message || e))}</div>`); });
