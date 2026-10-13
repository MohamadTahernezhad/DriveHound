'use strict';
// End-to-end UI + security checks inside the real Electron app (dev mode only).
// Usage: node tests/e2e/run.js
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const root = path.join(__dirname, '..', '..');
const electron = require(path.join(root, 'node_modules', 'electron'));
// isolated profile: copy the last real scan (if any) so list/filter checks have data, never touch real history/settings
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-e2e-'));
const realScan = ['DriveHound', 'Disk Insight'].map((n) => path.join(process.env.APPDATA || '', n, 'data', 'scans', 'C', 'last.json')).find((f) => fs.existsSync(f)) || '';
if (fs.existsSync(realScan)) { fs.mkdirSync(path.join(profile, 'data', 'scans', 'C'), { recursive: true }); fs.copyFileSync(realScan, path.join(profile, 'data', 'scans', 'C', 'last.json')); }
fs.mkdirSync(path.join(profile, 'data'), { recursive: true });
fs.writeFileSync(path.join(profile, 'data', 'settings.json'), JSON.stringify({ lang: 'fa', theme: 'dark', drive: 'C:', monitor: { enabled: false } }));
const env = { ...process.env, DH_USERDATA: profile, DH_SHOT: path.join(os.tmpdir(), 'dh-e2e.png'), DH_WAIT: '4000', DH_WAIT2: '60000', DH_JS: fs.readFileSync(path.join(__dirname, 'checks.js'), 'utf8') };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [root], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let pass = 0, fail = 0, summary = null;
const onLine = (line) => {
  const m = line.match(/\[renderer\] \w+ (PASS|FAIL|SUMMARY)(.*)/);
  if (!m) return;
  if (m[1] === 'PASS') { pass++; console.log('  ✔' + m[2]); }
  else if (m[1] === 'FAIL') { fail++; console.log('  ✖' + m[2]); }
  else { summary = m[2].trim(); child.kill(); }
};
let buf = '';
child.stdout.on('data', (d) => { buf += d; const lines = buf.split(/\r?\n/); buf = lines.pop(); lines.forEach(onLine); });
child.stderr.on('data', () => {});
const timer = setTimeout(() => { console.log('timeout'); child.kill(); }, 180000);
child.on('exit', () => {
  clearTimeout(timer);
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* locked briefly */ } }, 1500);
  console.log(`\ne2e: ${pass} passed, ${fail} failed${summary ? ' (' + summary + ')' : ''}`);
  setTimeout(() => process.exit(fail || !summary ? 1 : 0), 2000);
});
