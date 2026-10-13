// Runs inside the real renderer (via the dev-only DH_JS hook). Prints "PASS name" / "FAIL name: reason".
(async () => {
  const out = [];
  const ok = (name, cond, why = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ': ' + why)); out.push(cond); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const errors = [];
  window.addEventListener('error', (e) => errors.push(e.message));
  window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason && e.reason.message || e.reason)));
  const rejects = async (p) => { try { await p; return false; } catch { return true; } };

  // wait for boot
  for (let i = 0; i < 60 && !(state.drives && state.drives.length); i++) await sleep(250);
  ok('boot: drives loaded', state.drives.length > 0);

  // ── security: renderer isolation ──
  ok('isolation: no require', typeof window.require === 'undefined');
  ok('isolation: no process', typeof window.process === 'undefined');
  ok('isolation: no ipcRenderer on api', !('ipcRenderer' in window.api) && typeof window.api.invoke === 'undefined');
  ok('isolation: api object is frozen', Object.isFrozen(window.api) || (() => { try { window.api.delete = () => 1; return window.api.delete.toString().includes('invoke') || window.api.delete() !== 1; } catch { return true; } })());
  ok('network: renderer fetch to internet is blocked', await rejects(fetch('https://example.com/')));
  ok('origin: page is served from app://bundle', location.protocol === 'app:' && location.host === 'bundle');
  const st = async (u) => { try { return (await fetch(u)).status; } catch { return 'blocked'; } };
  ok('protocol: core source files are not served', (await st('app://bundle/core/guard.js')) !== 200 && (await st('app://bundle/main.js')) !== 200);
  ok('protocol: path traversal is refused', (await st('app://bundle/renderer/..%2F..%2Fmain.js')) !== 200 && (await st('app://bundle/renderer/%2e%2e/%2e%2e/package.json')) !== 200);
  ok('protocol: other hosts are refused', (await st('app://evil/renderer/index.html')) !== 200);
  ok('protocol: file:// outside the app is blocked', await rejects(fetch('file:///C:/Windows/win.ini')));
  ok('csp: inline script injection does not run', (() => { const d = document.createElement('div'); d.innerHTML = '<img src=x onerror="window.__xss1=1">'; document.body.appendChild(d); return true; })());
  await sleep(300);
  ok('csp: inline event handler blocked', window.__xss1 === undefined);

  // ── security: core refuses dangerous input ──
  const del = await window.api.delete([{ path: 'C:\\Windows', size: 1, contents: false }, { path: 'C:\\', size: 1, contents: false }, { path: 'C:\\Windows\\System32\\drivers', size: 1, contents: false }], 'permanent');
  ok('core: refuses deleting Windows / drive root / System32', del.every((r) => !r.ok && /forbidden/.test(r.error)), JSON.stringify(del));
  ok('core: rejects malformed delete args', await rejects(window.api.delete('C:\\x', 'permanent')));
  ok('core: rejects unknown delete mode', await rejects(window.api.delete([], 'shred')));
  ok('core: rejects relative paths', await rejects(window.api.inspect('..\\..\\Windows')));
  ok('core: rejects unknown action ids', await rejects(window.api.action('calc')));
  ok('core: rejects command-like action ids', await rejects(window.api.action('cleanTemp & calc')));
  ok('core: rejects injected driver names', await rejects(window.api.drivers.remove(['oem1.inf & calc'])));
  ok('core: rejects injected docker ids', (await window.api.docker.remove('image', ['abc; rm -rf /']).catch(() => [{ ok: false }]))[0].ok === false);
  ok('core: uninstall needs a real registry id', await rejects(window.api.uninstall('"C:\\Windows\\System32\\calc.exe"')));
  ok('core: rejects bad overlay colors', await rejects(window.api.overlay('red;}', '#fff')));
  const before = await window.api.getSettings();
  const s2 = await window.api.setSettings({ ...before, lang: 'xx', theme: '<script>', delMode: 'shred', protectedPaths: ['relative', 'C:\\ok'], userRules: [{ match: 'path', pattern: 'nope', safety: 'safe' }] });
  ok('core: settings are sanitized', s2.lang === 'fa' && s2.theme === 'dark' && s2.delMode === 'trash' && s2.protectedPaths.length === 1 && s2.userRules.length === 0, JSON.stringify(s2).slice(0, 200));
  await window.api.setSettings(before);
  ok('ai: non-local http endpoint refused', await rejects(window.api.ai.saveProvider({ name: 'x', type: 'openai', baseUrl: 'http://evil.example.com/v1', model: 'm' })));
  ok('ai: remote provider without key refused', await rejects(window.api.ai.saveProvider({ name: 'x', type: 'openai', baseUrl: 'https://api.example.com/v1', model: 'm' })));
  ok('ai: malformed key refused', await rejects(window.api.ai.saveProvider({ name: 'x', type: 'anthropic', model: 'claude-opus-5-5', key: 'not-a-key' })));
  ok('ai: unknown provider type refused', await rejects(window.api.ai.saveProvider({ name: 'x', type: 'shell', baseUrl: 'https://a.b/v1', model: 'm' })));
  const sv = await window.api.ai.saveProvider({ name: 'E2E Local', type: 'openai', baseUrl: 'http://127.0.0.1:9/v1', model: 'test-model' });
  ok('ai: local provider saved without key', sv.savedId && sv.providers.some((p) => p.id === sv.savedId && !p.needsKey));
  ok('ai: status never exposes keys', !JSON.stringify(await window.api.ai.status()).match(/sk-|key"\s*:\s*"/));
  const tgt = { target: 'C:\\Windows\\Temp', isDir: true, size: 1 };
  ok('ai: explain blocked until the user consents', /consent-required/.test(await window.api.ai.explain(tgt).then(() => '', (e) => String(e.message))));
  await window.api.ai.consent(sv.savedId);
  ok('ai: unreachable server reports a network error', /network/.test(await window.api.ai.explain(tgt).then(() => '', (e) => String(e.message))));
  const afterDel = await window.api.ai.deleteProvider(sv.savedId);
  ok('ai: provider deleted', !afterDel.providers.some((p) => p.id === sv.savedId));
  state.settings = await window.api.getSettings();
  ok('core: quarantine ids validated', await rejects(window.api.quarantine.purge('../../x')));
  ok('core: move restore id validated', await rejects(window.api.move.restore('..\\x')));

  // ── XSS through file names ──
  openDrawer({ path: 'C:\\Users\\x\\<img src=x onerror=window.__xss2=1>.txt', name: '<img src=x onerror=window.__xss2=1>.txt', isDir: false, size: 1 });
  await sleep(500);
  ok('xss: hostile file name rendered as text', !document.querySelector('#drawerBody img') && window.__xss2 === undefined);
  closeDrawer();

  // ── every view renders ──
  for (const v of Object.keys(VIEWS)) {
    const n = errors.length;
    setView(v);
    await sleep(v === 'apps' || v === 'containers' || v === 'system' || v === 'projects' ? 2500 : 600);
    const el = document.getElementById('view-' + v);
    ok('view renders: ' + v, el && el.classList.contains('active') && el.innerHTML.length > 100 && errors.length === n, errors.slice(n).join(' | '));
  }

  // ── filters ──
  if (state.result) {
    setView('files');
    await sleep(400);
    const total = state.result.topFiles.length;
    const input = document.querySelector('#fq-files');
    input.value = 'ext:vhdx'; input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(600);
    const expected = state.result.topFiles.filter((f) => /\.vhdx$/i.test(f.p)).length;
    const shown = document.querySelectorAll('#view-files .row').length;
    ok('filters: ext:vhdx query', shown === Math.min(expected, 150), `shown ${shown} expected ${expected}`);
    const input2 = document.querySelector('#fq-files');
    input2.value = '>1gb -docker'; input2.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(600);
    const exp2 = state.result.topFiles.filter((f) => f.s > 1024 ** 3 && !f.p.toLowerCase().includes('docker')).length;
    ok('filters: size + exclusion query', document.querySelectorAll('#view-files .row').length === Math.min(exp2, 150), 'expected ' + exp2);
    document.querySelector('[data-act="f-clear"][data-fk="files"]').click();
    await sleep(300);
    ok('filters: clear all', document.querySelectorAll('#view-files .row').length === Math.min(total, 150));
    document.querySelector('[data-act="f-sort-col"][data-fk="files"][data-sk="name"]').click();
    await sleep(300);
    const names = [...document.querySelectorAll('#view-files .row .nm b')].slice(0, 20).map((b) => b.textContent.toLowerCase());
    const sortedDesc = names.slice().sort((a, b) => b.localeCompare(a, 'fa'));
    ok('filters: sort by column', JSON.stringify(names) === JSON.stringify(sortedDesc));
    document.querySelector('[data-act="f-pop"][data-fk="files"][data-n="m-safety"]').click();
    await sleep(200);
    document.querySelector('[data-act="f-multi"][data-fk="files"][data-v="danger"]').click();     // a real click toggles it on
    await sleep(300);
    const rows = [...document.querySelectorAll('#view-files .row .badge')];
    ok('filters: multi-select status', rows.length > 0 && rows.every((b) => b.classList.contains('danger')), rows.length + ' rows');
    document.body.click();
    await sleep(200);
    const clr = document.querySelector('[data-act="f-clear"][data-fk="files"]');
    if (clr) clr.click();
    await sleep(200);
    // saved filter preset round trip
    const fi = document.querySelector('#fq-files');
    fi.value = 'ext:img'; fi.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(500);
    document.querySelector('[data-act="f-pop"][data-fk="files"][data-n="presets"]').click();
    await sleep(200);
    document.querySelector('#fpn-files').value = 'e2e-preset';
    document.querySelector('[data-act="f-preset-save"][data-fk="files"]').click();
    await sleep(400);
    const saved = (await window.api.getSettings()).filterPresets.files || [];
    ok('filters: preset saved to settings', saved.some((p) => p.name === 'e2e-preset' && p.state.q === 'ext:img'));
    const s = await window.api.getSettings();
    s.filterPresets.files = (s.filterPresets.files || []).filter((p) => p.name !== 'e2e-preset');
    state.settings = await window.api.setSettings(s);
    const clr2 = document.querySelector('[data-act="f-clear"][data-fk="files"]');
    if (clr2) clr2.click();
  }

  // ── a real scan through the UI, end to end (small read-only Windows folder) ──
  const scanTarget = state.env.env.WINDIR + '\\Web';
  const scanDone = new Promise((res) => { const off = window.api.onDone((r) => { off(); res(r); }); setTimeout(() => res(null), 90000); });
  startScan(scanTarget);
  const res = await scanDone;
  ok('scan: real scan completes and the result reaches the UI', !!res && res.root.toLowerCase() === scanTarget.toLowerCase() && res.stats.files > 0, res ? JSON.stringify(res.stats) : 'no scan:done event');
  // duplicate finder through the real IPC + worker path
  const dupDone = new Promise((r) => { const off = window.api.onDupesDone((x) => { off(); r(x); }); setTimeout(() => r(null), 90000); });
  // (the finder intentionally skips the Windows folder, so use a common non-system folder)
  await window.api.dupes.start({ roots: [state.env.env.PROGRAMFILES + '\\Common Files'], minSize: 1048576, exclude: [] });
  const dres = await dupDone;
  ok('dupes: search completes and returns a result', !!dres && Array.isArray(dres.groups) && dres.scanned > 0, dres ? 'scanned ' + dres.scanned : 'no dupes:done event');
  ok('dupes: missing folders are rejected', await rejects(window.api.dupes.start({ roots: ['C:\\no\\such\\folder-xyz'], minSize: 1, exclude: [] })));
  // monitoring sample is recorded
  await window.api.monitor.check();
  const hist = await window.api.monitor.history(1);
  ok('monitor: free-space sample recorded', hist.length > 0 && Object.keys(hist[hist.length - 1].d).length > 0);
  await sleep(1500);
  ok('scan: UI leaves the scanning state and shows the new result', !state.scanning && state.result && state.result.root === (res && res.root) && document.querySelector('#view-dashboard .kpis') !== null);

  ok('no uncaught renderer errors', errors.length === 0, errors.join(' | '));
  console.log('SUMMARY ' + out.filter(Boolean).length + '/' + out.length);
})();
