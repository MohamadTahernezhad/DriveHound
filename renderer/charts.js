// Small dependency-free SVG/HTML charts: ring gauge, donut, squarified treemap
'use strict';

const Charts = (() => {
  const NS = 'http://www.w3.org/2000/svg';

  // Single-value usage ring (drive cards)
  function ring(pct, { size = 92, stroke = 9, tone = 'accent' } = {}) {
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const v = Math.max(0, Math.min(1, pct));
    return `<svg class="ring ring-${tone}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <defs><linearGradient id="rg-${tone}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--ring-a)"/><stop offset="1" stop-color="var(--ring-b)"/></linearGradient></defs>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--track)" stroke-width="${stroke}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="url(#rg-${tone})" stroke-width="${stroke}" stroke-linecap="round"
        stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - v)}" transform="rotate(-90 ${size / 2} ${size / 2})" class="ring-val"/>
    </svg>`;
  }

  // Donut with 2px surface gaps between segments. items: [{label, value, color, id}]
  function donut(el, items, { size = 210, thickness = 26, center = '', sub = '', onHover } = {}) {
    const total = items.reduce((a, b) => a + b.value, 0) || 1;
    const r = size / 2 - 4;
    const ri = r - thickness;
    const cx = size / 2, cy = size / 2;
    const gapAngle = 2 / r;                       // ≈2px gap on the outer edge
    let a0 = -Math.PI / 2;
    let paths = '';
    items.forEach((it, i) => {
      const frac = it.value / total;
      const a1 = a0 + frac * Math.PI * 2;
      if (frac > 0.002) {
        const s = a0 + gapAngle / 2, e = Math.max(s + 0.001, a1 - gapAngle / 2);
        const large = e - s > Math.PI ? 1 : 0;
        const p = (rad, ang) => `${cx + rad * Math.cos(ang)} ${cy + rad * Math.sin(ang)}`;
        const d = `M ${p(r, s)} A ${r} ${r} 0 ${large} 1 ${p(r, e)} L ${p(ri, e)} A ${ri} ${ri} 0 ${large} 0 ${p(ri, s)} Z`;
        paths += `<path d="${d}" fill="${it.color}" data-i="${i}" class="seg"/>`;
      }
      a0 = a1;
    });
    el.innerHTML = `<div class="donut-wrap" style="width:${size}px;height:${size}px">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${paths}</svg>
      <div class="donut-center"><div class="donut-val">${center}</div><div class="donut-sub">${sub}</div></div></div>`;
    const centerVal = el.querySelector('.donut-val');
    const centerSub = el.querySelector('.donut-sub');
    el.querySelectorAll('.seg').forEach((seg) => {
      seg.addEventListener('mouseenter', () => {
        const it = items[+seg.dataset.i];
        el.querySelectorAll('.seg').forEach((s) => s.classList.toggle('dim', s !== seg));
        centerVal.textContent = it.valueLabel;
        centerSub.textContent = it.label;
        onHover && onHover(it);
      });
      seg.addEventListener('mouseleave', () => {
        el.querySelectorAll('.seg').forEach((s) => s.classList.remove('dim'));
        centerVal.innerHTML = center; centerSub.innerHTML = sub;
        onHover && onHover(null);
      });
    });
  }

  // Squarified treemap layout. items: [{value, ...}] → adds x,y,w,h (in px)
  function squarify(items, x, y, w, h) {
    const total = items.reduce((a, b) => a + b.value, 0);
    if (!total || w <= 0 || h <= 0) return [];
    const scale = (w * h) / total;
    const nodes = items.filter((i) => i.value > 0).map((i) => ({ ...i, area: i.value * scale }));
    const out = [];
    let rect = { x, y, w, h };
    let row = [];
    const worst = (r, side) => {
      const s = r.reduce((a, b) => a + b.area, 0);
      let max = 0, min = Infinity;
      for (const n of r) { max = Math.max(max, n.area); min = Math.min(min, n.area); }
      return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
    };
    const layoutRow = (r) => {
      const s = r.reduce((a, b) => a + b.area, 0);
      if (rect.w >= rect.h) {
        const cw = s / rect.h;
        let cy = rect.y;
        for (const n of r) { const nh = n.area / cw; out.push({ ...n, x: rect.x, y: cy, w: cw, h: nh }); cy += nh; }
        rect = { x: rect.x + cw, y: rect.y, w: rect.w - cw, h: rect.h };
      } else {
        const ch = s / rect.w;
        let cx = rect.x;
        for (const n of r) { const nw = n.area / ch; out.push({ ...n, x: cx, y: rect.y, w: nw, h: ch }); cx += nw; }
        rect = { x: rect.x, y: rect.y + ch, w: rect.w, h: rect.h - ch };
      }
    };
    for (const n of nodes) {
      const side = Math.min(rect.w, rect.h);
      if (!row.length || worst(row.concat(n), side) <= worst(row, side)) row.push(n);
      else { layoutRow(row); row = [n]; }
    }
    if (row.length) layoutRow(row);
    return out;
  }

  // Render treemap into el. items: [{value, label, sub, color, key}]
  function treemap(el, items, { onClick, onDblClick, tooltip, rtl } = {}) {
    const w = el.clientWidth, h = el.clientHeight;
    const rects = squarify(items.slice(0, 160), 0, 0, w, h);
    el.innerHTML = rects.map((r, i) => {
      const left = rtl ? w - r.x - r.w : r.x;
      const big = r.w > 70 && r.h > 34;
      return `<div class="tm-cell" data-i="${i}" style="left:${left + 1}px;top:${r.y + 1}px;width:${Math.max(0, r.w - 2)}px;height:${Math.max(0, r.h - 2)}px;--c:${r.color}">
        ${big ? `<div class="tm-label"><b>${r.label}</b><span>${r.sub}</span></div>` : ''}</div>`;
    }).join('');
    el.querySelectorAll('.tm-cell').forEach((c) => {
      const it = rects[+c.dataset.i];
      c.addEventListener('click', () => onClick && onClick(it));
      c.addEventListener('dblclick', () => onDblClick && onDblClick(it));
      c.addEventListener('mousemove', (e) => tooltip && tooltip(e, it));
      c.addEventListener('mouseleave', () => tooltip && tooltip(null));
    });
  }

  // Line chart with crosshair + tooltip. series: [{ label, color, points: [{ t, v }] }]
  function line(el, series, { yFormat = (v) => v, xFormat = (t) => new Date(t).toLocaleDateString(), height = 220, rtl = false } = {}) {
    const W = el.clientWidth || 600, H = height;
    const pad = { l: 64, r: 16, t: 14, b: 26 };
    const all = series.flatMap((s) => s.points);
    if (all.length < 2) { el.innerHTML = ''; return false; }
    const t0 = Math.min(...all.map((p) => p.t)), t1 = Math.max(...all.map((p) => p.t));
    let v0 = Math.min(...all.map((p) => p.v)), v1 = Math.max(...all.map((p) => p.v));
    const span = v1 - v0 || v1 || 1;
    v0 = Math.max(0, v0 - span * 0.15); v1 = v1 + span * 0.15;
    const X = (t) => { const x = pad.l + ((t - t0) / (t1 - t0 || 1)) * (W - pad.l - pad.r); return rtl ? W - x : x; };
    const Y = (v) => pad.t + (1 - (v - v0) / (v1 - v0 || 1)) * (H - pad.t - pad.b);
    const ticks = 4;
    let grid = '';
    for (let i = 0; i <= ticks; i++) {
      const v = v0 + ((v1 - v0) * i) / ticks, y = Y(v);
      grid += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}" class="lc-grid"/><text x="${rtl ? W - pad.l + 8 : pad.l - 8}" y="${y + 4}" class="lc-axis" text-anchor="${rtl ? 'start' : 'end'}">${yFormat(v)}</text>`;
    }
    const xt = [t0, t0 + (t1 - t0) / 2, t1];
    for (const t of xt) grid += `<text x="${X(t)}" y="${H - 6}" class="lc-axis" text-anchor="middle">${xFormat(t)}</text>`;
    const paths = series.map((s) => {
      const pts = s.points.slice().sort((a, b) => a.t - b.t);
      const d = pts.map((p, i) => (i ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p.v).toFixed(1)).join(' ');
      const last = pts[pts.length - 1];
      return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="${X(last.t)}" cy="${Y(last.v)}" r="4" fill="${s.color}" stroke="var(--surface-solid)" stroke-width="2"/>`;
    }).join('');
    el.innerHTML = `<div class="lc"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${grid}${paths}<line class="lc-cross" x1="0" x2="0" y1="${pad.t}" y2="${H - pad.b}" visibility="hidden"/><g class="lc-dots"></g><rect x="${pad.l}" y="${pad.t}" width="${W - pad.l - pad.r}" height="${H - pad.t - pad.b}" fill="transparent" class="lc-hit"/></svg><div class="lc-tip" hidden></div></div>`;
    const svg = el.querySelector('svg'), cross = el.querySelector('.lc-cross'), dots = el.querySelector('.lc-dots'), tip = el.querySelector('.lc-tip');
    const hit = el.querySelector('.lc-hit');
    hit.addEventListener('mousemove', (e) => {
      const r = svg.getBoundingClientRect();
      let x = e.clientX - r.left;
      let frac = (x - pad.l) / (W - pad.l - pad.r);
      if (rtl) frac = 1 - (x - pad.r) / (W - pad.l - pad.r);
      const t = t0 + Math.max(0, Math.min(1, frac)) * (t1 - t0);
      const near = series.map((s) => { let best = s.points[0]; for (const p of s.points) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p; return { s, p: best }; });
      const cx = X(near[0].p.t);
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
      dots.innerHTML = near.map((n) => `<circle cx="${X(n.p.t)}" cy="${Y(n.p.v)}" r="4.5" fill="${n.s.color}" stroke="var(--surface-solid)" stroke-width="2"/>`).join('');
      tip.hidden = false;
      tip.innerHTML = `<b>${xFormat(near[0].p.t, true)}</b>` + near.map((n) => `<div><span class="cat-dot" style="--c:${n.s.color}"></span> ${n.s.label}: <b>${yFormat(n.p.v)}</b></div>`).join('');
      const tx = Math.min(W - tip.offsetWidth - 4, Math.max(4, cx + 12));
      tip.style.left = tx + 'px'; tip.style.top = '8px';
    });
    hit.addEventListener('mouseleave', () => { cross.setAttribute('visibility', 'hidden'); dots.innerHTML = ''; tip.hidden = true; });
    return true;
  }

  return { ring, donut, treemap, squarify, line };
})();
