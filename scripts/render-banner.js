'use strict';
// Renders the README banner and the GitHub social preview (1280x640) with Electron.
// Usage: npx electron scripts/render-banner.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const b64 = (f) => fs.readFileSync(path.join(root, f)).toString('base64');
const font = b64('renderer/fonts/Vazirmatn.woff2');
const icon = b64('assets/icon.png');
const shotDark = b64('docs/screenshots/dashboard-fa.png');
const shotLight = b64('docs/screenshots/dashboard-en-light.png');
const version = require(path.join(root, 'package.json')).version;

const chips = ['Turbo MFT scan', 'Safe-delete knowledge base', 'Dependency check', 'What changed?', 'Docker & WSL', 'Any AI model', 'فارسی · English'];

const html = (w, h) => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:V;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:100 900}
*{box-sizing:border-box;margin:0}
body{width:${w}px;height:${h}px;overflow:hidden;font-family:'Segoe UI Variable Display','Segoe UI',V,sans-serif;color:#eceeff;
 background:radial-gradient(900px 520px at 8% 0%,rgba(139,92,246,.55),transparent 60%),radial-gradient(800px 520px at 100% 100%,rgba(34,211,238,.35),transparent 60%),#090a13}
.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.05) 1px,transparent 1px);background-size:40px 40px;mask-image:radial-gradient(ellipse at 30% 30%,#000,transparent 75%)}
.l{position:absolute;left:64px;top:${h > 500 ? 92 : 44}px;width:${Math.round(w * 0.47)}px}
.logo{display:flex;align-items:center;gap:16px;margin-bottom:${h > 500 ? 28 : 16}px}
.logo img{width:${h > 500 ? 76 : 58}px;height:${h > 500 ? 76 : 58}px;border-radius:20px;box-shadow:0 18px 50px -12px #8b5cf6}
.logo span{font-size:${h > 500 ? 26 : 20}px;color:#b9a3ff;font-weight:700}
h1{font-size:${h > 500 ? 64 : 46}px;font-weight:800;letter-spacing:-1px;line-height:1.05;padding-bottom:.12em;background:linear-gradient(135deg,#fff,#c4b5fd 60%,#67e8f9);-webkit-background-clip:text;color:transparent}
p{margin-top:${h > 500 ? 18 : 10}px;font-size:${h > 500 ? 22 : 17}px;color:#c3c6e6;line-height:1.45}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:${h > 500 ? 30 : 16}px}
.chip{padding:${h > 500 ? 8 : 6}px 14px;border-radius:99px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);font-size:${h > 500 ? 15 : 13}px;font-weight:600}
.chip:last-child{font-family:V}
.ver{position:absolute;left:64px;bottom:${h > 500 ? 40 : 22}px;font-size:14px;color:#8a8fb3}
.shots{position:absolute;right:-60px;top:${h > 500 ? 70 : 34}px;width:${Math.round(w * 0.52)}px;height:${h}px}
.shot{position:absolute;border-radius:16px;overflow:hidden;box-shadow:0 30px 90px -20px rgba(0,0,0,.85);border:1px solid rgba(255,255,255,.14)}
.shot img{display:block;width:100%}
.s1{width:100%;transform:perspective(1600px) rotateY(-14deg) rotateX(4deg);transform-origin:left center}
.s2{width:72%;left:-14%;top:${h > 500 ? 300 : 150}px;transform:perspective(1600px) rotateY(-14deg) rotateX(4deg)}
</style></head><body><div class="grid"></div>
<div class="l"><div class="logo"><img src="data:image/png;base64,${icon}"><span>Smart disk space analyzer</span></div>
<h1>DriveHound</h1><p>See what fills your Windows drives — and exactly what is safe to delete.</p>
<div class="chips">${(h > 500 ? chips : chips.slice(0, 3)).map((c) => `<span class="chip">${c}</span>`).join('')}</div></div>
${h > 500 ? `<div class="ver">v${version} · Windows 10 / 11 · MIT</div>` : ''}
<div class="shots"><div class="shot s1"><img src="data:image/png;base64,${shotDark}"></div><div class="shot s2"><img src="data:image/png;base64,${shotLight}"></div></div>
</body></html>`;

async function render(w, h, out) {
  const win = new BrowserWindow({ width: w, height: h, show: false, useContentSize: true, frame: false, webPreferences: { offscreen: true, javascript: false } });
  const tmp = path.join(require('os').tmpdir(), 'dh-banner-' + w + 'x' + h + '.html');
  fs.writeFileSync(tmp, html(w, h));
  await win.loadFile(tmp);
  await new Promise((r) => setTimeout(r, 800));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: w, height: h });
  fs.writeFileSync(out, img.resize({ width: w, height: h }).toPNG());
  win.destroy();
  fs.unlinkSync(tmp);
  console.log('wrote', out);
}

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});   // keep running between the two renders
app.whenReady().then(async () => {
  await render(1280, 640, path.join(root, 'docs', 'social-preview.png'));
  await render(1280, 420, path.join(root, 'docs', 'banner.png'));
  app.quit();
});
