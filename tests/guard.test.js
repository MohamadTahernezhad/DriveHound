'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createGuard, canonical } = require('../core/guard');

const ENV = {
  WINDIR: 'C:\\Windows', SYSTEMDRIVE: 'C:', PROGRAMFILES: 'C:\\Program Files', PROGRAMFILES86: 'C:\\Program Files (x86)',
  PROGRAMDATA: 'C:\\ProgramData', USERPROFILE: 'C:\\Users\\Tester', APPDATA: 'C:\\Users\\Tester\\AppData\\Roaming',
  LOCALAPPDATA: 'C:\\Users\\Tester\\AppData\\Local', PUBLIC: 'C:\\Users\\Public', TEMP: 'C:\\Users\\Tester\\AppData\\Local\\Temp',
};
const g = createGuard(ENV, { selfPaths: ['C:\\Apps\\DriveHound'] });

test('blocks drive roots in every spelling', () => {
  for (const p of ['C:\\', 'C:', 'c:/', 'D:\\', 'C:\\.', 'C:\\Users\\..']) assert.ok(g.deleteReason(p), p);
});

test('blocks Windows and protected folders, allows Windows temp/log areas', () => {
  assert.equal(g.deleteReason('C:\\Windows'), 'protected-folder');
  assert.equal(g.deleteReason('C:\\Windows\\System32'), 'windows');
  assert.equal(g.deleteReason('C:\\Windows\\System32\\drivers\\etc\\hosts'), 'windows');
  assert.equal(g.deleteReason('C:\\WINDOWS\\WinSxS'), 'windows');
  assert.equal(g.deleteReason('C:\\Windows\\Temp'), 'protected-folder');           // the folder itself stays
  assert.equal(g.deleteReason('C:\\Windows\\Temp\\abc.tmp'), null);
  assert.equal(g.deleteReason('C:\\Windows\\SoftwareDistribution\\Download\\x'), null);
  assert.equal(g.deleteReason('C:\\Windows\\Logs\\CBS\\CBS.log'), null);
});

test('path tricks cannot escape the guard', () => {
  assert.equal(g.deleteReason('C:\\Users\\Tester\\..\\..\\Windows\\System32'), 'windows');
  assert.equal(g.deleteReason('C:/Windows/System32'), 'windows');
  assert.equal(g.deleteReason('C:\\Windows.\\System32'), 'windows');               // trailing dot is stripped by Windows
  assert.equal(g.deleteReason('C:\\Windows \\System32'), 'windows');               // trailing space too
  assert.equal(g.deleteReason('\\\\?\\C:\\Windows\\System32'), 'device-path');
  assert.equal(g.deleteReason('\\\\.\\C:'), 'device-path');
  assert.equal(g.deleteReason('\\\\server\\share\\x'), 'network-path');
  assert.equal(g.deleteReason('relative\\path'), 'not-absolute');
  assert.equal(g.deleteReason('C:\\Users\\Tester\\file.txt:Zone.Identifier'), 'alternate-stream');
  assert.equal(g.deleteReason('C:\\x\u0000y'), 'invalid-path');
  assert.equal(g.deleteReason(''), 'invalid-path');
  assert.equal(g.deleteReason(null), 'invalid-path');
});

test('protects profile roots and known folders but allows their contents', () => {
  for (const p of ['C:\\Users', 'C:\\Users\\Tester', 'C:\\Users\\Tester\\AppData', 'C:\\Users\\Tester\\AppData\\Local', 'C:\\Users\\Tester\\Desktop', 'C:\\Users\\Tester\\Documents', 'C:\\Program Files', 'C:\\ProgramData', 'C:\\Users\\Tester\\AppData\\Local\\Temp'])
    assert.equal(g.deleteReason(p), 'protected-folder', p);
  assert.equal(g.deleteReason('C:\\Users\\Tester\\Desktop\\old.zip'), null);
  assert.equal(g.deleteReason('C:\\Users\\Tester\\AppData\\Local\\npm-cache'), null);
});

test('system files at the drive root', () => {
  for (const f of ['pagefile.sys', 'hiberfil.sys', 'swapfile.sys', 'System Volume Information', '$Recycle.Bin', 'Recovery', '$MFT'])
    assert.equal(g.deleteReason('C:\\' + f), 'system-file', f);
  assert.equal(g.deleteReason('C:\\System Volume Information\\x'), 'system-file');
  assert.equal(g.deleteReason('D:\\pagefile.sys'), 'system-file');
});

test('never deletes the app itself or a folder containing it', () => {
  assert.equal(g.deleteReason('C:\\Apps\\DriveHound\\resources'), 'self');
  assert.equal(g.deleteReason('C:\\Apps'), 'self');
});

test('move guard is stricter than delete guard', () => {
  assert.equal(g.moveReason('C:\\Program Files\\Adobe'), 'program-files');
  assert.equal(g.moveReason('C:\\Windows\\Temp\\x'), 'windows');
  assert.equal(g.moveReason('C:\\Users\\Tester\\.gradle'), null);
});

test('compress guard', () => {
  assert.equal(g.compressReason('C:\\Windows\\System32'), 'windows');
  assert.equal(g.compressReason('C:\\'), 'drive-root');
  assert.equal(g.compressReason('C:\\Users\\Tester\\AppData\\Local\\Android\\Sdk'), null);
});

test('canonical() resolves 8.3 short names via realpath when the path exists', () => {
  // real system: PROGRA~1 must resolve to Program Files and be protected
  const real = createGuard(require('../core/guard').defaultEnv());
  if (fs.existsSync('C:\\PROGRA~1')) assert.ok(real.deleteReason('C:\\PROGRA~1'), 'short name must be blocked');
});

test('junction pointing into Windows is judged by its target', async (t) => {
  const real = createGuard(require('../core/guard').defaultEnv());
  const link = path.join(os.tmpdir(), 'dh-guard-junction-' + process.pid);
  try { fs.symlinkSync(process.env.WINDIR + '\\System32', link, 'junction'); } catch { t.skip('cannot create junction'); return; }
  try { assert.equal(real.deleteReason(link), 'windows'); } finally { fs.unlinkSync(link); }
});

test('canonical normalises', () => {
  assert.equal(canonical('c:/foo/bar/'), 'c:\\foo\\bar');
  assert.equal(canonical('C:\\foo\\..\\bar'), 'C:\\bar');
});
