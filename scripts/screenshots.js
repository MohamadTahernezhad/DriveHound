'use strict';
// Captures the README screenshots inside the app (dev-only DH_SHOT hook) from an anonymized demo profile.
// Nothing outside the app window is captured. Needs one finished scan of drive C: in the app.
// Usage: node scripts/screenshots.js [name ...]      (no names = all)
const { execFileSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'docs', 'screenshots');
const only = process.argv.slice(2);
const electron = require(path.join(root, 'node_modules', 'electron'));
// demo files for the duplicate finder; the path is visible in the screenshot, so keep it neutral
const DEMO = process.env.DH_DEMO_DIR || (fs.existsSync('D:\\') ? 'D:\\DriveHound-Demo' : 'C:\\DriveHound-Demo');

const boot = 'const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));for(let i=0;i<80&&!(state.drives&&state.drives.length);i++)await sleep(250);';
const nav = (v) => `document.querySelector('[data-view="${v}"]').click();await sleep(1500);`;
const openRow = (text) => `await sleep(800);[...document.querySelectorAll('[data-act="open"]')].find(e=>e.textContent.includes(${JSON.stringify(text)})).click();await sleep(1200);`;
const drillTo = (p) => `state.explorer.stack=findNodeChain(${JSON.stringify(p)})||state.explorer.stack;renderExplorer();await sleep(800);`;
const colorBy = (m) => `document.querySelector('[data-act="colorby"][data-m="${m}"]').click();await sleep(1200);`;
const dupes = `state.dupes.roots=[${JSON.stringify(DEMO)}];state.dupes.minMB=10;${nav('dupes')}document.querySelector('[data-act="dup-start"]').click();for(let i=0;i<120&&!state.dupes.result;i++)await sleep(500);await sleep(1000);`;

// name: [lang, theme, js, prep(profileDir)]
const SHOTS = {
  'dashboard-fa': ['fa', 'dark', ''],
  'dashboard-en-light': ['en', 'light', ''],
  'explorer-fa': ['fa', 'dark', nav('explorer')],
  'changes-fa': ['fa', 'dark', nav('changes')],
  'cleanup-fa': ['fa', 'dark', nav('cleanup')],
  'system-fa': ['fa', 'dark', nav('system') + 'await sleep(3000);'],
  'drawer-fa': ['fa', 'dark', openRow('WinSxS')],
  'files-filters-en': ['en', 'dark', nav('files') + `document.querySelector('.fbtn').click();await sleep(800);`],
  'settings-ai-en': ['en', 'dark', `document.querySelector('#settingsBtn').click();await sleep(1200);[...document.querySelectorAll('h3')].find(h=>h.textContent.includes('AI assistant')).closest('.card').scrollIntoView({block:'end'});await sleep(800);`],
  'welcome-monitor-en': ['en', 'dark', '', (p) => fs.rmSync(path.join(p, 'data', 'scans'), { recursive: true, force: true })],
  'explorer-safety-en-light': ['en', 'light', nav('explorer') + drillTo('C:\\Users\\User\\AppData\\Local') + colorBy('safety')],
  'drawer-safe-en-light': ['en', 'light', nav('cleanup') + openRow('NVIDIA')],
  'dupes-en': ['en', 'dark', dupes],
};

// a few realistic duplicate sets (same bytes = same SHA-256)
function makeDemoFiles() {
  const sets = [
    [80, ['Videos\\Wedding-final.mp4', 'Backup\\Phone-2025\\Wedding-final.mp4', 'Downloads\\Wedding-final (1).mp4']],
    [64, ['Downloads\\ubuntu-24.04-desktop-amd64.iso', 'ISO\\ubuntu-24.04-desktop-amd64.iso']],
    [42, ['Projects\\app\\build\\app-release.apk', 'Desktop\\app-release.apk']],
    [28, ['Photos\\Trip\\DJI_0042.MP4', 'Backup\\Drone\\DJI_0042.MP4']],
    [18, ['Music\\Live-Session.flac', 'Downloads\\Live-Session.flac']],
    [12, ['Documents\\Thesis\\dataset.zip', 'Backup\\Docs\\dataset.zip', 'Downloads\\dataset.zip']],
  ];
  sets.forEach(([mb, files], i) => {
    const buf = Buffer.alloc(mb * 1048576, i + 1);
    for (const f of files) { const p = path.join(DEMO, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, buf); }
  });
}

const names = Object.keys(SHOTS).filter((n) => !only.length || only.includes(n));
if (names.includes('dupes-en')) makeDemoFiles();
try {
  for (const name of names) {
    const [lang, theme, js, prep] = SHOTS[name];
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-shot-'));
    execFileSync(process.execPath, [path.join(__dirname, 'demo-profile.js'), profile, lang, theme], { stdio: 'ignore' });
    if (prep) prep(profile);
    const out = path.join(outDir, name + '.png');
    const env = {
      ...process.env, DH_USERDATA: profile, DH_SHOT: out, DH_WAIT: '4000', DH_WAIT2: '1500', DH_JS: `(async()=>{${boot}${js}})()`,
      // the knowledge base matches against these, so they must look like the anonymized paths in the demo scan
      USERPROFILE: 'C:\\Users\\User', APPDATA: 'C:\\Users\\User\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\User\\AppData\\Local',
    };
    delete env.ELECTRON_RUN_AS_NODE;
    if (fs.existsSync(out)) fs.unlinkSync(out);
    spawnSync(electron, [root], { env, stdio: 'ignore', timeout: 180000 });
    console.log(fs.existsSync(out) ? 'shot    ' + name : 'MISSING ' + name);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* locked briefly */ }
  }
} finally {
  if (fs.existsSync(DEMO) && names.includes('dupes-en')) fs.rmSync(DEMO, { recursive: true, force: true });
}
