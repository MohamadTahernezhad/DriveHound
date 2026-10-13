'use strict';
// Renders docs/showcase.png (1920x1080): several screenshots on a tilted 3D stage, offscreen with Electron.
// Usage: npx electron scripts/render-showcase.js     (run scripts/screenshots.js first)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const b64 = (f) => fs.readFileSync(path.join(root, f)).toString('base64');
const shot = (n) => `data:image/png;base64,${b64('docs/screenshots/' + n + '.png')}`;
const icon = b64('assets/icon.png');
const W = 1920, H = 1080;

const tiles = [
  // [screenshot, left, top, width, z-index]
  ['dashboard-fa', 920, 110, 900, 1],
  ['explorer-safety-en-light', 860, 590, 620, 2],
  ['dupes-en', 1320, 540, 560, 3],
];

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
body{width:${W}px;height:${H}px;overflow:hidden;font-family:'Segoe UI Variable Display','Segoe UI',sans-serif;color:#eceeff;
 background:radial-gradient(1100px 700px at 0% 0%,rgba(139,92,246,.55),transparent 60%),radial-gradient(1000px 700px at 100% 100%,rgba(34,211,238,.35),transparent 60%),#07080f}
.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.05) 1px,transparent 1px);background-size:48px 48px;mask-image:radial-gradient(ellipse at 25% 35%,#000,transparent 70%)}
.l{position:absolute;left:96px;top:250px;width:640px}
.logo{display:flex;align-items:center;gap:18px;margin-bottom:34px}
.logo img{width:88px;height:88px;border-radius:24px;box-shadow:0 22px 60px -12px #8b5cf6}
.logo span{font-size:24px;color:#b9a3ff;font-weight:700;letter-spacing:.3px}
h1{font-size:96px;font-weight:800;letter-spacing:-2px;line-height:1;padding-bottom:.12em;background:linear-gradient(135deg,#fff,#c4b5fd 60%,#67e8f9);-webkit-background-clip:text;color:transparent}
p{margin-top:22px;font-size:28px;color:#c3c6e6;line-height:1.4}
.stats{display:flex;gap:14px;margin-top:40px}
.stat{padding:14px 20px;border-radius:16px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12)}
.stat b{display:block;font-size:26px}.stat span{font-size:14px;color:#a9add3}
.stage{position:absolute;inset:0;transform:rotate(-3deg);transform-origin:75% 50%}
.t{position:absolute;border-radius:18px;overflow:hidden;border:1px solid rgba(255,255,255,.16);box-shadow:0 40px 110px -24px rgba(0,0,0,.9),0 0 0 1px rgba(0,0,0,.4)}
.t img{display:block;width:100%}
.glow{position:absolute;right:240px;top:300px;width:700px;height:500px;background:radial-gradient(closest-side,rgba(139,92,246,.35),transparent);filter:blur(30px)}
</style></head><body><div class="grid"></div><div class="glow"></div>
<div class="stage">${tiles.map(([n, x, y, w, z]) => `<div class="t" style="left:${x}px;top:${y}px;width:${w}px;z-index:${z}"><img src="${shot(n)}"></div>`).join('')}</div>
<div class="l"><div class="logo"><img src="data:image/png;base64,${icon}"><span>Smart disk space analyzer for Windows</span></div>
<h1>DriveHound</h1><p>Sniffs out what fills your drives — and tells you exactly what is safe to delete.</p>
<div class="stats"><div class="stat"><b>100+</b><span>knowledge rules</span></div><div class="stat"><b>~25k/s</b><span>files scanned</span></div><div class="stat"><b>Any AI</b><span>model, or none</span></div></div></div>
</body></html>`;

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');   // lay out in real pixels whatever the Windows display scaling
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: W, height: H, show: false, useContentSize: true, frame: false, webPreferences: { offscreen: true, javascript: false } });
  const tmp = path.join(require('os').tmpdir(), 'dh-showcase.html');
  fs.writeFileSync(tmp, html);
  await win.loadFile(tmp);
  await new Promise((r) => setTimeout(r, 1200));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: W, height: H });
  const out = path.join(root, 'docs', 'showcase.png');
  fs.writeFileSync(out, img.resize({ width: W, height: H }).toPNG());
  fs.unlinkSync(tmp);
  console.log('wrote', out);
  app.quit();
});
