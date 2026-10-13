// Advanced, reusable filter system for every list view.
// Query syntax in the search box:  words  -exclude  "exact phrase"  ext:mp4,mkv  >1gb  <500mb
//                                  newer:7d  older:1y  is:safe|caution|user|danger  path:projects
'use strict';
/* global I18N, icon, esc */

const Filters = (() => {
  const views = new Map();
  let openPop = null;                       // "key:name" of the open dropdown
  const MB = 1048576, GB = 1073741824;

  const T = (fa, en) => (I18N.lang === 'fa' ? fa : en);
  const num = (n) => new Intl.NumberFormat(I18N.lang === 'fa' ? 'fa-IR' : 'en-US', { maximumFractionDigits: 1 }).format(n);
  const sizeLabel = (b) => (b >= GB ? num(b / GB) + ' GB' : num(b / MB) + ' MB');

  function blankState(defs) {
    return {
      q: '', multi: Object.fromEntries((defs.multi || []).map((m) => [m.key, new Set()])),
      sizeMin: 0, sizeMax: 0, ageMode: 'any', ageDays: 0, toggles: new Set(),
      sort: defs.sort ? { ...defs.sort.default } : null,
    };
  }

  function create(key, defs, onChange) {
    const prev = views.get(key);
    const st = prev ? prev.st : blankState(defs);
    // new multi groups added after first creation
    for (const m of defs.multi || []) if (!st.multi[m.key]) st.multi[m.key] = new Set();
    views.set(key, { defs, st, onChange });
    return { bar: (o) => bar(key, o), apply: (rows) => apply(key, rows), head: (cols) => head(key, cols), state: st };
  }

  // ───────── query language ─────────
  function parseSize(s) {
    const m = String(s).match(/^([\d.]+)\s*(b|kb|mb|gb|tb)?$/i);
    if (!m) return null;
    return parseFloat(m[1]) * ({ b: 1, kb: 1024, mb: MB, gb: GB, tb: GB * 1024 }[(m[2] || 'mb').toLowerCase()]);
  }
  function parseAge(s) {
    const m = String(s).match(/^(\d+)\s*(d|w|m|y)?$/i);
    if (!m) return null;
    return Number(m[1]) * ({ d: 1, w: 7, m: 30, y: 365 }[(m[2] || 'd').toLowerCase()]);
  }
  function parseQuery(q) {
    const out = { terms: [], excl: [], ext: null, min: 0, max: 0, newer: 0, older: 0, is: null, path: [] };
    const tokens = String(q || '').match(/-?"[^"]*"|\S+/g) || [];
    for (let tok of tokens) {
      const neg = tok.startsWith('-') && tok.length > 1;
      if (neg) tok = tok.slice(1);
      tok = tok.replace(/^"|"$/g, '');
      const low = tok.toLowerCase();
      let m;
      if ((m = low.match(/^ext:(.+)$/))) { out.ext = new Set(m[1].split(',').map((e) => e.replace(/^\./, '')).filter(Boolean)); continue; }
      if ((m = low.match(/^>(.+)$/)) && parseSize(m[1]) != null) { out.min = parseSize(m[1]); continue; }
      if ((m = low.match(/^<(.+)$/)) && parseSize(m[1]) != null) { out.max = parseSize(m[1]); continue; }
      if ((m = low.match(/^newer:(.+)$/)) && parseAge(m[1]) != null) { out.newer = parseAge(m[1]); continue; }
      if ((m = low.match(/^older:(.+)$/)) && parseAge(m[1]) != null) { out.older = parseAge(m[1]); continue; }
      if ((m = low.match(/^is:(.+)$/))) { out.is = new Set(m[1].split(',')); continue; }
      if ((m = low.match(/^path:(.+)$/))) { out.path.push(m[1]); continue; }
      if (!low) continue;
      (neg ? out.excl : out.terms).push(low);
    }
    return out;
  }

  // ───────── filtering ─────────
  function apply(key, rows) {
    const v = views.get(key);
    if (!v) return rows;
    const { defs, st } = v;
    const q = parseQuery(st.q);
    const now = Date.now();
    const sizeOf = defs.size ? defs.size.acc : null;
    const ageOf = defs.age ? defs.age.acc : null;
    const minS = Math.max(st.sizeMin || 0, q.min || 0), maxS = st.sizeMax || q.max || 0;
    const res = rows.filter((r) => {
      if (q.terms.length || q.excl.length || q.path.length) {
        const txt = (defs.text ? defs.text(r) : '').toLowerCase();
        for (const t of q.terms) if (!txt.includes(t)) return false;
        for (const t of q.excl) if (txt.includes(t)) return false;
        for (const t of q.path) if (!txt.includes(t)) return false;
      }
      if (q.ext && defs.ext) { const e = (defs.ext(r) || '').toLowerCase(); if (!q.ext.has(e)) return false; }
      if (q.is && defs.safety && !q.is.has(defs.safety(r))) return false;
      if (sizeOf && (minS || maxS)) { const s = sizeOf(r) || 0; if (minS && s < minS) return false; if (maxS && s > maxS) return false; }
      if (ageOf) {
        const t = ageOf(r) || 0, days = (now - t) / 86400000;
        if (st.ageMode === 'newer' && st.ageDays && !(t && days <= st.ageDays)) return false;
        if (st.ageMode === 'older' && st.ageDays && !(t && days >= st.ageDays)) return false;
        if (q.newer && !(t && days <= q.newer)) return false;
        if (q.older && !(t && days >= q.older)) return false;
      }
      for (const m of defs.multi || []) {
        const sel = st.multi[m.key];
        if (sel && sel.size) { const val = m.acc(r); const vals = Array.isArray(val) ? val : [val]; if (!vals.some((x) => sel.has(String(x)))) return false; }
      }
      for (const tg of defs.toggles || []) if (st.toggles.has(tg.key) && !tg.test(r)) return false;
      return true;
    });
    if (st.sort && defs.sort) {
      const opt = defs.sort.options.find((o) => o.k === st.sort.k) || defs.sort.options[0];
      const dir = st.sort.dir || -1;
      res.sort((a, b) => {
        const x = opt.acc(a), y = opt.acc(b);
        if (typeof x === 'string' || typeof y === 'string') return dir * String(x ?? '').localeCompare(String(y ?? ''), I18N.lang === 'fa' ? 'fa' : 'en');
        return dir * ((x || 0) - (y || 0));
      });
    }
    return res;
  }

  function activeCount(key) {
    const { defs, st } = views.get(key);
    let n = 0;
    if (st.q.trim()) n++;
    for (const m of defs.multi || []) if (st.multi[m.key] && st.multi[m.key].size) n++;
    if (st.sizeMin || st.sizeMax) n++;
    if (st.ageMode !== 'any' && st.ageDays) n++;
    n += st.toggles.size;
    return n;
  }

  // ───────── rendering ─────────
  function pop(key, name, btnHtml, bodyHtml, active) {
    const id = key + ':' + name;
    return `<div class="fwrap"><button class="fbtn ${active ? 'on' : ''} ${openPop === id ? 'open' : ''}" data-act="f-pop" data-fk="${key}" data-n="${name}">${btnHtml}${icon('chevronR', 12, 'fchev')}</button>
      ${openPop === id ? `<div class="fpop">${bodyHtml}</div>` : ''}</div>`;
  }

  function bar(key, opts = {}) {
    const v = views.get(key);
    const { defs, st } = v;
    const parts = [];
    if (defs.search !== false) {
      parts.push(`<label class="search-box fsearch">${icon('search', 15)}<input class="input" id="fq-${key}" data-fk="${key}" placeholder="${esc(defs.placeholder || T('جستجو… (ext:mp4  >1gb  -node_modules  older:90d)', 'Search… (ext:mp4  >1gb  -node_modules  older:90d)'))}" value="${esc(st.q)}" autocomplete="off" spellcheck="false">
        <span class="fhelp" title="${esc(T('نحو جستجو: کلمه، -حذف، "عبارت دقیق"، ext:mp4,mkv، >1gb، <500mb، newer:7d، older:1y، is:safe، path:...', 'Syntax: words, -exclude, "exact phrase", ext:mp4,mkv, >1gb, <500mb, newer:7d, older:1y, is:safe, path:...'))}">${icon('help', 14)}</span></label>`);
    }
    for (const m of defs.multi || []) {
      const sel = st.multi[m.key];
      const body = `<div class="fopts">${m.options.map((o) => `<label class="fopt"><input type="checkbox" data-act="f-multi" data-fk="${key}" data-m="${m.key}" data-v="${esc(o.v)}" ${sel.has(String(o.v)) ? 'checked' : ''}>${o.icon ? icon(o.icon, 14) : ''}${o.color ? `<span class="cat-dot" style="--c:${o.color}"></span>` : ''}<span>${esc(o.label)}</span>${o.count != null ? `<em>${num(o.count)}</em>` : ''}</label>`).join('')}</div>
        <div class="fpop-foot"><button class="btn ghost xs" data-act="f-multi-all" data-fk="${key}" data-m="${m.key}">${T('همه', 'All')}</button><button class="btn ghost xs" data-act="f-multi-none" data-fk="${key}" data-m="${m.key}">${T('هیچ', 'None')}</button></div>`;
      parts.push(pop(key, 'm-' + m.key, `${m.icon ? icon(m.icon, 14) : ''}<span>${esc(m.label)}</span>${sel.size ? `<b class="fcount">${num(sel.size)}</b>` : ''}`, body, sel.size > 0));
    }
    if (defs.size) {
      const presets = defs.size.presets || [0, 10 * MB, 100 * MB, GB, 10 * GB];
      const body = `<div class="fpresets">${presets.map((p) => `<button class="fchip ${st.sizeMin === p && !st.sizeMax ? 'on' : ''}" data-act="f-size" data-fk="${key}" data-min="${p}">${p ? '≥ ' + sizeLabel(p) : T('همه حجم‌ها', 'Any size')}</button>`).join('')}</div>
        <div class="frange"><label>${T('حداقل', 'Min')}<input class="input sm" type="number" min="0" step="any" id="fmin-${key}" value="${st.sizeMin ? +(st.sizeMin / MB).toFixed(1) : ''}" placeholder="MB"></label>
        <label>${T('حداکثر', 'Max')}<input class="input sm" type="number" min="0" step="any" id="fmax-${key}" value="${st.sizeMax ? +(st.sizeMax / MB).toFixed(1) : ''}" placeholder="MB"></label>
        <button class="btn primary xs" data-act="f-size-custom" data-fk="${key}">${T('اعمال', 'Apply')}</button></div>`;
      const lbl = st.sizeMin || st.sizeMax ? (st.sizeMin ? '≥' + sizeLabel(st.sizeMin) : '') + (st.sizeMax ? ' ≤' + sizeLabel(st.sizeMax) : '') : T('حجم', 'Size');
      parts.push(pop(key, 'size', `${icon('disk', 14)}<span>${esc(lbl)}</span>`, body, !!(st.sizeMin || st.sizeMax)));
    }
    if (defs.age) {
      const items = [['any', 0, T('هر زمان', 'Any time')], ['newer', 1, T('۲۴ ساعت اخیر', 'Last 24 h')], ['newer', 7, T('۷ روز اخیر', 'Last 7 days')], ['newer', 30, T('۳۰ روز اخیر', 'Last 30 days')],
        ['older', 90, T('قدیمی‌تر از ۳ ماه', 'Older than 3 months')], ['older', 180, T('قدیمی‌تر از ۶ ماه', 'Older than 6 months')], ['older', 365, T('قدیمی‌تر از ۱ سال', 'Older than 1 year')], ['older', 730, T('قدیمی‌تر از ۲ سال', 'Older than 2 years')]];
      const cur = items.find(([m, d]) => m === st.ageMode && d === st.ageDays);
      const body = `<div class="flist">${items.map(([m, d, l]) => `<button class="fli ${st.ageMode === m && st.ageDays === d ? 'on' : ''}" data-act="f-age" data-fk="${key}" data-m="${m}" data-d="${d}">${st.ageMode === m && st.ageDays === d ? icon('check', 13) : '<i></i>'}${esc(l)}</button>`).join('')}</div>
        <div class="frange"><select class="input sm" id="fage-m-${key}"><option value="newer">${T('جدیدتر از', 'Newer than')}</option><option value="older" ${st.ageMode === 'older' ? 'selected' : ''}>${T('قدیمی‌تر از', 'Older than')}</option></select>
        <input class="input sm" type="number" min="1" id="fage-d-${key}" value="${st.ageDays || ''}" placeholder="${T('روز', 'days')}"><button class="btn primary xs" data-act="f-age-custom" data-fk="${key}">${T('اعمال', 'Apply')}</button></div>`;
      parts.push(pop(key, 'age', `${icon('clock', 14)}<span>${esc(st.ageMode !== 'any' && st.ageDays ? (cur ? cur[2] : (st.ageMode === 'newer' ? '≤ ' : '≥ ') + num(st.ageDays) + T(' روز', 'd')) : (defs.age.label || T('زمان', 'Age')))}</span>`, body, st.ageMode !== 'any' && !!st.ageDays));
    }
    for (const tg of defs.toggles || []) {
      parts.push(`<button class="fchip ${st.toggles.has(tg.key) ? 'on' : ''}" data-act="f-toggle" data-fk="${key}" data-t="${tg.key}">${tg.icon ? icon(tg.icon, 14) : ''}${esc(tg.label)}</button>`);
    }
    if (defs.sort) {
      parts.push(`<div class="fsort"><select class="input sm" data-act-change="f-sort-sel" data-fk="${key}">${defs.sort.options.map((o) => `<option value="${o.k}" ${st.sort && st.sort.k === o.k ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
        <button class="icon-btn" data-act="f-sort-dir" data-fk="${key}" title="${T('جهت مرتب‌سازی', 'Sort direction')}">${icon(st.sort && st.sort.dir > 0 ? 'arrowUp' : 'arrowDown', 15)}</button></div>`);
    }
    if (defs.presets !== false && opts.presets !== false) {
      const list = (window.state && window.state.settings.filterPresets && window.state.settings.filterPresets[key]) || [];
      const body = `<div class="flist">${list.map((p, i) => `<div class="fli preset"><button data-act="f-preset-load" data-fk="${key}" data-i="${i}">${icon('filter', 13)}${esc(p.name)}</button><button class="icon-btn xs" data-act="f-preset-del" data-fk="${key}" data-i="${i}">${icon('x', 12)}</button></div>`).join('') || `<div class="muted" style="padding:8px 10px;font-size:12px">${T('هنوز فیلتری ذخیره نشده', 'No saved filters yet')}</div>`}</div>
        <div class="frange"><input class="input sm" id="fpn-${key}" placeholder="${T('نام فیلتر', 'Filter name')}" maxlength="40"><button class="btn primary xs" data-act="f-preset-save" data-fk="${key}">${icon('save', 12)}${T('ذخیره', 'Save')}</button></div>`;
      parts.push(pop(key, 'presets', `${icon('save', 14)}<span>${T('فیلترهای ذخیره‌شده', 'Saved filters')}</span>`, body, false));
    }
    const n = activeCount(key);
    const pills = n ? `<div class="fpills">${pillsHtml(key)}<button class="btn ghost xs" data-act="f-clear" data-fk="${key}">${icon('x', 12)}${T('پاک کردن همه', 'Clear all')}</button>${opts.count != null ? `<span class="muted num" style="margin-inline-start:auto;font-size:12px">${opts.count}</span>` : ''}</div>` : (opts.count != null ? `<div class="fpills"><span class="muted num" style="font-size:12px">${opts.count}</span></div>` : '');
    return `<div class="fbar" data-fbar="${key}">${parts.join('')}</div>${pills}`;
  }

  function pillsHtml(key) {
    const { defs, st } = views.get(key);
    const out = [];
    const pill = (label, act, extra = '') => `<span class="fpill">${esc(label)}<button data-act="${act}" data-fk="${key}" ${extra}>${icon('x', 11)}</button></span>`;
    if (st.q.trim()) out.push(pill('“' + st.q.trim() + '”', 'f-clear-q'));
    for (const m of defs.multi || []) for (const val of st.multi[m.key] || []) {
      const o = m.options.find((x) => String(x.v) === val);
      out.push(pill(m.label + ': ' + (o ? o.label : val), 'f-multi-rm', `data-m="${m.key}" data-v="${esc(val)}"`));
    }
    if (st.sizeMin || st.sizeMax) out.push(pill((st.sizeMin ? '≥ ' + sizeLabel(st.sizeMin) : '') + (st.sizeMax ? ' ≤ ' + sizeLabel(st.sizeMax) : ''), 'f-size-rm'));
    if (st.ageMode !== 'any' && st.ageDays) out.push(pill((st.ageMode === 'newer' ? T('جدیدتر از ', 'Newer than ') : T('قدیمی‌تر از ', 'Older than ')) + num(st.ageDays) + T(' روز', ' days'), 'f-age-rm'));
    for (const tg of defs.toggles || []) if (st.toggles.has(tg.key)) out.push(pill(tg.label, 'f-toggle', `data-t="${tg.key}"`));
    return out.join('');
  }

  // sortable column header
  function head(key, cols) {
    const v = views.get(key);
    const st = v && v.st;
    return `<div class="list-head">${cols.map((c) => {
      if (!c.sk || !st || !st.sort) return `<span>${c.label || ''}</span>`;
      const on = st.sort.k === c.sk;
      return `<button class="sorth ${on ? 'on' : ''}" data-act="f-sort-col" data-fk="${key}" data-sk="${c.sk}">${c.label}${on ? icon(st.sort.dir > 0 ? 'arrowUp' : 'arrowDown', 12) : ''}</button>`;
    }).join('')}</div>`;
  }

  // ───────── events ─────────
  function changed(key, keepFocus) {
    const v = views.get(key);
    if (!v) return;
    const focus = keepFocus ? document.activeElement && document.activeElement.id : null;
    const caret = focus && document.activeElement.selectionStart;
    v.onChange && v.onChange();
    if (focus) { const el = document.getElementById(focus); if (el) { el.focus(); try { el.setSelectionRange(caret, caret); } catch { /* not text */ } } }
  }
  function serial(st) { return { q: st.q, multi: Object.fromEntries(Object.entries(st.multi).map(([k, s]) => [k, [...s]])), sizeMin: st.sizeMin, sizeMax: st.sizeMax, ageMode: st.ageMode, ageDays: st.ageDays, toggles: [...st.toggles], sort: st.sort }; }
  function deserial(st, o) {
    st.q = o.q || ''; for (const k of Object.keys(st.multi)) st.multi[k] = new Set((o.multi && o.multi[k]) || []);
    st.sizeMin = o.sizeMin || 0; st.sizeMax = o.sizeMax || 0; st.ageMode = o.ageMode || 'any'; st.ageDays = o.ageDays || 0;
    st.toggles = new Set(o.toggles || []); if (o.sort) st.sort = o.sort;
  }

  const ACTS = {
    'f-pop': (k, el) => { const id = k + ':' + el.dataset.n; openPop = openPop === id ? null : id; changed(k); },
    'f-multi': (k, el) => { const s = views.get(k).st.multi[el.dataset.m]; if (el.checked) s.add(el.dataset.v); else s.delete(el.dataset.v); changed(k); },
    'f-multi-all': (k, el) => { const m = views.get(k).defs.multi.find((x) => x.key === el.dataset.m); views.get(k).st.multi[m.key] = new Set(m.options.map((o) => String(o.v))); changed(k); },
    'f-multi-none': (k, el) => { views.get(k).st.multi[el.dataset.m] = new Set(); changed(k); },
    'f-multi-rm': (k, el) => { views.get(k).st.multi[el.dataset.m].delete(el.dataset.v); changed(k); },
    'f-size': (k, el) => { const st = views.get(k).st; st.sizeMin = Number(el.dataset.min); st.sizeMax = 0; openPop = null; changed(k); },
    'f-size-custom': (k) => { const st = views.get(k).st; const a = parseFloat(document.getElementById('fmin-' + k).value), b = parseFloat(document.getElementById('fmax-' + k).value); st.sizeMin = a > 0 ? a * MB : 0; st.sizeMax = b > 0 ? b * MB : 0; openPop = null; changed(k); },
    'f-size-rm': (k) => { const st = views.get(k).st; st.sizeMin = 0; st.sizeMax = 0; changed(k); },
    'f-age': (k, el) => { const st = views.get(k).st; st.ageMode = el.dataset.m; st.ageDays = Number(el.dataset.d); openPop = null; changed(k); },
    'f-age-custom': (k) => { const st = views.get(k).st; const d = parseInt(document.getElementById('fage-d-' + k).value, 10); if (d > 0) { st.ageMode = document.getElementById('fage-m-' + k).value; st.ageDays = d; } openPop = null; changed(k); },
    'f-age-rm': (k) => { const st = views.get(k).st; st.ageMode = 'any'; st.ageDays = 0; changed(k); },
    'f-toggle': (k, el) => { const s = views.get(k).st.toggles; if (s.has(el.dataset.t)) s.delete(el.dataset.t); else s.add(el.dataset.t); changed(k); },
    'f-sort-dir': (k) => { const st = views.get(k).st; st.sort.dir = -(st.sort.dir || -1); changed(k); },
    'f-sort-col': (k, el) => { const st = views.get(k).st; if (st.sort.k === el.dataset.sk) st.sort.dir = -(st.sort.dir || -1); else st.sort = { k: el.dataset.sk, dir: -1 }; changed(k); },
    'f-clear': (k) => { const v = views.get(k); const keepSort = v.st.sort; Object.assign(v.st, blankState(v.defs)); v.st.sort = keepSort; changed(k); },
    'f-clear-q': (k) => { views.get(k).st.q = ''; changed(k); },
    'f-preset-save': (k) => {
      const name = (document.getElementById('fpn-' + k).value || '').trim().slice(0, 40);
      if (!name) return;
      const s = window.state.settings;
      s.filterPresets = s.filterPresets || {};
      s.filterPresets[k] = (s.filterPresets[k] || []).filter((p) => p.name !== name).concat([{ name, state: serial(views.get(k).st) }]).slice(-20);
      window.api.setSettings(s);
      openPop = null; changed(k);
    },
    'f-preset-load': (k, el) => { const p = window.state.settings.filterPresets[k][+el.dataset.i]; if (p) deserial(views.get(k).st, p.state); openPop = null; changed(k); },
    'f-preset-del': (k, el) => { const s = window.state.settings; s.filterPresets[k].splice(+el.dataset.i, 1); window.api.setSettings(s); changed(k); },
  };

  function onClick(e) {
    const el = e.target.closest('[data-act^="f-"]');
    if (el && el.dataset.fk && ACTS[el.dataset.act] && views.has(el.dataset.fk)) {
      if (el.tagName !== 'INPUT') e.preventDefault();
      e.stopPropagation();
      ACTS[el.dataset.act](el.dataset.fk, el);
      return true;
    }
    // click outside an open popover closes it
    if (openPop && !e.target.closest('.fpop') && !e.target.closest('.fbtn')) { const k = openPop.split(':')[0]; openPop = null; changed(k); }
    return false;
  }
  let qTimer = null;
  function onInput(e) {
    const el = e.target;
    if (el.id && el.id.startsWith('fq-') && views.has(el.dataset.fk)) {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => { views.get(el.dataset.fk).st.q = el.value; changed(el.dataset.fk, true); }, 220);
      return true;
    }
    return false;
  }
  function onChange(e) {
    const el = e.target;
    if (el.dataset.actChange === 'f-sort-sel' && views.has(el.dataset.fk)) { const st = views.get(el.dataset.fk).st; st.sort = { k: el.value, dir: st.sort ? st.sort.dir : -1 }; changed(el.dataset.fk); return true; }
    return false;
  }
  function onKey(e) {
    if (e.key === 'Escape' && openPop) { const k = openPop.split(':')[0]; openPop = null; changed(k); return true; }
    return false;
  }

  return { create, apply, bar, head, parseQuery, onClick, onInput, onChange, onKey, isOpen: () => !!openPop };
})();
