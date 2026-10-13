'use strict';
// Printable HTML report (also rendered to PDF by main). All values are escaped — data comes from file names.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SAFETY_COLOR = { safe: '#0a7d0a', caution: '#9a6200', user: '#2f5bd3', danger: '#c02626', unknown: '#555' };

function table(headers, rows) {
  return `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function buildHtml(d, fontUrl) {
  const rtl = d.lang === 'fa';
  const L = d.labels || {};
  const badge = (s, label) => `<span class="badge" style="color:${SAFETY_COLOR[s] || '#555'};border-color:${SAFETY_COLOR[s] || '#555'}">${esc(label)}</span>`;
  const bar = (pct) => `<div class="bar"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>`;
  return `<!doctype html><html lang="${rtl ? 'fa' : 'en'}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src file: data:; img-src data:">
<title>${esc(d.title)}</title>
<style>
@font-face{font-family:Vazirmatn;src:url('${esc(fontUrl)}') format('woff2');font-weight:100 900}
*{box-sizing:border-box}body{font-family:${rtl ? 'Vazirmatn,' : ''}'Segoe UI',Vazirmatn,sans-serif;color:#15172e;margin:0;padding:32px 36px;font-size:12.5px;line-height:1.55;background:#fff}
h1{font-size:24px;margin:0 0 4px}h2{font-size:15px;margin:26px 0 10px;padding-bottom:6px;border-bottom:2px solid #e6e7f2}
.sub{color:#6b6f8e}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:18px}
.kpi{border:1px solid #e6e7f2;border-radius:12px;padding:12px}.kpi b{display:block;font-size:19px}.kpi span{color:#6b6f8e;font-size:11.5px}
table{width:100%;border-collapse:collapse;margin-top:6px}th{text-align:start;font-size:11px;color:#6b6f8e;font-weight:700;padding:6px 8px;border-bottom:1px solid #e6e7f2}
td{padding:7px 8px;border-bottom:1px solid #f0f1f7;vertical-align:top}.path{font-family:Consolas,monospace;font-size:10.5px;color:#6b6f8e;direction:ltr;unicode-bidi:isolate;word-break:break-all}
.num{font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums}.badge{display:inline-block;border:1px solid;border-radius:99px;padding:1px 8px;font-size:10.5px;font-weight:700;white-space:nowrap}
.bar{height:6px;border-radius:4px;background:#eef0f7;min-width:80px}.bar i{display:block;height:100%;border-radius:4px;background:#7046f0}
.dot{display:inline-block;width:9px;height:9px;border-radius:3px;margin-inline-end:6px;vertical-align:middle}
.hint{color:#464a6b;font-size:11.5px}.foot{margin-top:30px;color:#8a8ea8;font-size:10.5px;border-top:1px solid #e6e7f2;padding-top:10px}
@page{size:A4;margin:14mm}
</style></head><body>
<h1>${esc(d.title)}</h1>
<div class="sub">${esc(d.subtitle || '')}</div>
<div class="kpis">${(d.kpis || []).map((k) => `<div class="kpi"><b>${esc(k.value)}</b><span>${esc(k.label)}</span></div>`).join('')}</div>
${d.diag && d.diag.length ? `<h2>${esc(L.diag)}</h2>${table([L.item, L.size, L.status], d.diag.map((x) => [`<b>${esc(x.title)}</b><div class="path">${esc(x.path)}</div><div class="hint">${esc(x.hint)}</div>`, `<span class="num">${esc(x.sizeLabel)}</span>`, badge(x.safety, x.safetyLabel)]))}` : ''}
${d.categories && d.categories.length ? `<h2>${esc(L.categories)}</h2>${table([L.type, L.size, L.share], d.categories.map((c) => [`<span class="dot" style="background:${esc(c.color)}"></span>${esc(c.label)}`, `<span class="num">${esc(c.sizeLabel)}</span>`, bar(c.pct) + `<span class="sub">${esc(c.pctLabel)}</span>`]))}` : ''}
${d.growth && d.growth.length ? `<h2>${esc(L.growth)}</h2>${table([L.path, L.g7, L.g30], d.growth.map((g) => [`<b>${esc(g.title)}</b><div class="path">${esc(g.path)}</div>`, `<span class="num">${esc(g.g7)}</span>`, `<span class="num">${esc(g.g30)}</span>`]))}` : ''}
${d.cleanup && d.cleanup.length ? `<h2>${esc(L.cleanup)}</h2>${table([L.item, L.size, L.status], d.cleanup.map((x) => [`<b>${esc(x.title)}</b><div class="path">${esc(x.path)}</div>`, `<span class="num">${esc(x.sizeLabel)}</span>`, badge(x.safety, x.safetyLabel)]))}` : ''}
${d.topFiles && d.topFiles.length ? `<h2>${esc(L.files)}</h2>${table([L.path, L.size, L.status], d.topFiles.map((f) => [`<div class="path">${esc(f.path)}</div><div class="hint">${esc(f.title)}</div>`, `<span class="num">${esc(f.sizeLabel)}</span>`, badge(f.safety, f.safetyLabel)]))}` : ''}
<div class="foot">${esc(d.footer || '')}</div>
</body></html>`;
}

module.exports = { buildHtml, esc };
