'use strict';
// Builds an anonymized demo profile (for README screenshots) from your last C: scan.
// The user name and personal project / site folder names are replaced; your real profile is never touched.
// Usage: node scripts/demo-profile.js <outDir> [fa|en] [dark|light]
const fs = require('fs');
const path = require('path');
const os = require('os');

const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'dh-demo'));
const lang = process.argv[3] || 'fa';
const theme = process.argv[4] || 'dark';
// profile of the current name, or of the former name before the app's first start after the rename
const src = ['DriveHound', 'Disk Insight'].map((n) => path.join(process.env.APPDATA, n, 'data', 'scans', 'C', 'last.json')).find((f) => fs.existsSync(f)) || '';
if (!fs.existsSync(src)) { console.error('No scan found. Scan drive C: in the app first.'); process.exit(1); }

const SEP = String.fromCharCode(92);           // backslash
const user = path.basename(process.env.USERPROFILE).toLowerCase();
const KEEP = new Set(['node_modules', 'build', 'vendor', '.venv', 'venv', '.git', '.dart_tool', '.gradle', 'src', 'android', 'ios', 'app', 'lib', 'public', 'dist', 'tmp', 'bin']);
const names = new Map();
let n = 0;
function alias(seg) {
  const low = seg.toLowerCase();
  if (KEEP.has(low)) return seg;
  if (low === 'project' || low === 'projects') return 'Projects';
  if (!names.has(low)) names.set(low, 'project-' + (++n));
  return names.get(low);
}
// rename the user name and the first two folder levels under Desktop / Documents / laragon\www
function anonPath(p) {
  const segs = p.split(SEP);
  for (let i = 0; i < segs.length; i++) {
    const low = segs[i].toLowerCase();
    if (low === user) segs[i] = 'User';
    if (low === 'desktop' || low === 'documents') {
      if (segs[i + 1]) segs[i + 1] = alias(segs[i + 1]);
      if (segs[i + 2]) segs[i + 2] = alias(segs[i + 2]);
    }
    if (low === 'www' && i > 0 && segs[i - 1].toLowerCase() === 'laragon' && segs[i + 1]) segs[i + 1] = alias(segs[i + 1]);
    if (/^[a-z]--users-/i.test(segs[i])) segs[i] = alias(segs[i]);                      // mangled project paths (.claude\projects, temp)
    if (i > 1 && /^mysql/i.test(segs[i - 1]) && segs[i - 2].toLowerCase() === 'data') segs[i] = alias(segs[i]);   // database names
  }
  return segs.join(SEP);
}
const isPath = (v) => v.length > 2 && v[1] === ':' && v[2] === SEP;
function deep(v) {
  if (typeof v === 'string') return isPath(v) ? anonPath(v) : v;
  if (Array.isArray(v)) return v.map(deep);
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = k === 'tree' ? x : deep(x); return o; }
  return v;
}
const join = (a, b) => (a.endsWith(SEP) ? a + b : a + SEP + b);
const last = (p) => p.slice(p.lastIndexOf(SEP) + 1);

const anon = deep(JSON.parse(fs.readFileSync(src, 'utf8')));
// the tree stores one name segment per node: anonymize with the full path as context
(function walk(node, full) {
  for (const c of node.c || []) { const p = join(full, c.n); c.n = last(anonPath(p)); walk(c, p); }
  for (const f of node.fl || []) f.n = last(anonPath(join(full, f.n)));
})(anon.tree, anon.tree.n);

// final pass: names also appear mangled inside other names (e.g. "c--Users-Name-Desktop-PROJECT-App")
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, (c) => SEP + c);
const pairs = [[user, 'User']];
// words that are never personal (tokens of folder names like "Windows Clear Data" must not leak into system paths)
const GENERIC = new Set(['project', 'projects', 'desktop', 'users', 'documents', 'users-user', 'windows', 'clear', 'system', 'program',
  'files', 'microsoft', 'local', 'android', 'flutter', 'laravel', 'react', 'server', 'client', 'tests', 'backup', 'estate', 'final',
  'admin', 'panel', 'store', 'service', 'services', 'mobile', 'design', 'website', 'master', 'source', 'build', 'release', 'debug',
  'config', 'public', 'assets', 'images', 'videos', 'music', 'shared', 'common', 'temp', 'cache', 'logs', 'driver', 'drivers', 'update']);
for (const [orig, al] of names) {
  if (orig.length >= 4 && /[a-z]/i.test(orig)) { pairs.push([orig, al]); if (orig.includes(' ')) pairs.push([orig.replace(/ /g, '-'), al]); }
  for (const tok of orig.split(/[\s_.-]+/)) if (tok.length >= 5 && /^[a-z]+$/i.test(tok) && !KEEP.has(tok) && !GENERIC.has(tok)) pairs.push([tok, al]);
}
pairs.sort((a, b) => b[0].length - a[0].length);
const RES = pairs.map(([o, a]) => [new RegExp(reEsc(o), 'gi'), a]);
const scrub = (str) => { for (const [re, a] of RES) str = str.replace(re, a); return str; };
// only string values are touched — numbers and keys stay intact
function scrubDeep(v) {
  if (typeof v === 'string') return scrub(v);
  if (Array.isArray(v)) return v.map(scrubDeep);
  if (v && typeof v === 'object') { for (const k of Object.keys(v)) v[k] = scrubDeep(v[k]); return v; }
  return v;
}
const text = JSON.stringify(scrubDeep(anon));

fs.mkdirSync(path.join(out, 'data', 'scans', 'C'), { recursive: true });
fs.writeFileSync(path.join(out, 'data', 'scans', 'C', 'last.json'), text);

// 30 days of free-space samples with a sudden drop (shows the monitoring chart)
const now = Date.now();
const lines = [];
let free = 120e9;
for (let i = 30 * 4; i >= 0; i--) {
  free -= (i === 28 ? 27e9 : 0.12e9) + Math.sin(i / 3) * 0.05e9;
  lines.push(JSON.stringify({ ts: now - i * 6 * 3600000, d: { 'C:': Math.max(40e9, free), 'D:': 78e9 + Math.cos(i / 5) * 2e9 }, s: { 'C:': 320e9, 'D:': 189e9 } }));
}
fs.writeFileSync(path.join(out, 'data', 'freespace.jsonl'), lines.join('\n') + '\n');
fs.writeFileSync(path.join(out, 'data', 'settings.json'), JSON.stringify({
  lang, theme, drive: 'C:', monitor: { enabled: false },
  ai: { mask: true, children: true, activeId: 'ollama', providers: [
    { id: 'ollama', name: 'Ollama (local)', type: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' },
    { id: 'claude', name: 'Claude (Anthropic)', type: 'anthropic', baseUrl: '', model: 'claude-opus-5-5' },
  ] },
}));
console.log('demo profile:', out, '·', names.size, 'folder names anonymized');
