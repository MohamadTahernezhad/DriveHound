'use strict';
const test = require('node:test');
const assert = require('node:assert');
const K = require('../shared/knowledge');

const U = 'C:\\Users\\Tester';
K.init({ WINDIR: 'C:\\Windows', SYSTEMDRIVE: 'C:', PROGRAMFILES: 'C:\\Program Files', PROGRAMFILES86: 'C:\\Program Files (x86)', PROGRAMDATA: 'C:\\ProgramData', USERPROFILE: U, APPDATA: U + '\\AppData\\Roaming', LOCALAPPDATA: U + '\\AppData\\Local', PUBLIC: 'C:\\Users\\Public' });

const c = (p, d) => K.classify(p, d);

test('system items are never safe', () => {
  assert.equal(c('C:\\Windows\\WinSxS', true).safety, 'danger');
  assert.equal(c('C:\\Windows\\System32\\drivers\\x.sys', false).safety, 'danger');
  assert.equal(c('C:\\pagefile.sys', false).safety, 'danger');
  assert.equal(c('C:\\Windows\\Installer', true).safety, 'danger');
  assert.equal(c('C:\\Program Files\\Adobe\\x.dll', false).safety, 'danger');
});

test('caches and temp are safe', () => {
  assert.equal(c(U + '\\AppData\\Local\\npm-cache', true).id, 'npm-cache');
  assert.equal(c(U + '\\AppData\\Local\\npm-cache', true).safety, 'safe');
  assert.equal(c(U + '\\AppData\\Local\\Temp', true).mode, 'contents');
  assert.equal(c(U + '\\.gradle\\caches', true).safety, 'safe');
  assert.equal(c(U + '\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Cache', true).safety, 'safe');
  assert.equal(c(U + '\\AppData\\Local\\Google\\Chrome\\User Data', true).safety, 'danger');
});

test('docker / wsl virtual disks are protected, with the right tool', () => {
  const d = c(U + '\\AppData\\Local\\Docker\\wsl\\disk\\docker_data.vhdx', false);
  assert.equal(d.safety, 'danger');
  assert.equal(d.action, 'dockerPrune');
  assert.equal(c(U + '\\AppData\\Local\\Packages\\CanonicalGroupLimited.Ubuntu_79rhkp1fndgsc\\LocalState\\ext4.vhdx', false).safety, 'danger');
});

test('name-based dev rules never fire inside Program Files or Windows', () => {
  K.setMarkers({ 'C:\\Program Files\\App\\resources\\app.asar.unpacked\\node_modules': ['package.json'] });
  assert.notEqual(c('C:\\Program Files\\App\\resources\\app.asar.unpacked\\node_modules', true).safety, 'safe');
  assert.notEqual(c('C:\\Windows\\SystemApps\\x\\node_modules', true).safety, 'safe');
});

test('node_modules is safe only when the project marker exists', () => {
  const p = U + '\\Desktop\\proj\\node_modules';
  assert.notEqual(c(p, true).id, 'node_modules');
  K.setMarkers({ [p]: ['package.json'] });
  assert.equal(c(p, true).id, 'node_modules');
  assert.equal(c(p, true).safety, 'safe');
});

test('container folders describe themselves but are not inherited', () => {
  assert.equal(c('C:\\Users', true).id, 'c-users');
  assert.equal(c(U + '\\AppData\\Local', true).id, 'c-appdata');
  assert.equal(c(U + '\\AppData\\Local\\SomeApp', true).source, 'location');
  assert.equal(c(U + '\\AppData\\Local\\SomeApp', true).app, 'SomeApp');      // original casing kept
});

test('old JetBrains versions are detected from siblings', () => {
  K.setFolders([U + '\\AppData\\Local\\JetBrains\\PhpStorm2025.3', U + '\\AppData\\Local\\JetBrains\\PhpStorm2026.2']);
  assert.equal(c(U + '\\AppData\\Local\\JetBrains\\PhpStorm2025.3', true).id, 'jetbrains-old');
  assert.notEqual(c(U + '\\AppData\\Local\\JetBrains\\PhpStorm2026.2', true).id, 'jetbrains-old');
});

test('file types inside Downloads', () => {
  assert.equal(c(U + '\\Downloads\\setup.exe', false).id, 'ext-installer');
  assert.equal(c(U + '\\Downloads\\movie.mkv', false).id, 'ext-video');
  assert.equal(c('D:\\data\\x.bin', false).safety, 'user');
});

test('user rules take priority and are validated', () => {
  assert.equal(K.validateUserRule({ match: 'path', pattern: 'C:\\x', safety: 'nope' }), null);
  assert.equal(K.validateUserRule({ match: 'ext', pattern: 'a/b', safety: 'safe' }), null);
  assert.equal(K.validateUserRule({ match: 'name', pattern: 'a\\b', safety: 'safe' }), null);
  assert.equal(K.validateUserRule({ match: 'path', pattern: 'relative', safety: 'safe' }), null);
  const n = K.setUserRules([
    { id: 'mycache', match: 'path', pattern: 'D:\\MyApp\\cache', safety: 'safe', title: 'My cache' },
    { id: 'keep', match: 'name', pattern: 'important', safety: 'danger', title: 'Keep' },
    { id: 'raw', match: 'ext', pattern: '.cr2', safety: 'user', title: 'Raw photo' },
  ]);
  assert.equal(n, 3);
  assert.equal(c('D:\\MyApp\\cache', true).safety, 'safe');
  assert.equal(c(U + '\\Desktop\\important', true).safety, 'danger');
  assert.equal(c(U + '\\Desktop\\important', true).mode, 'none');
  assert.equal(c('D:\\photos\\a.CR2', false).id, 'user-raw');
  // regex characters in user patterns are literal
  K.setUserRules([{ id: 'rx', match: 'path', pattern: 'C:\\a(b)+', safety: 'safe' }]);
  assert.equal(c('C:\\a(b)+', true).id, 'user-rx');
  assert.notEqual(c('C:\\abbb', true).id, 'user-rx');
  K.setUserRules([]);
  assert.notEqual(c('D:\\MyApp\\cache', true).id, 'user-mycache');
});

test('classification is fast enough for large scans', () => {
  const t0 = Date.now();
  for (let i = 0; i < 20000; i++) c(U + '\\Desktop\\PROJECT\\p' + (i % 500) + '\\src\\f' + i + '.js', false);
  assert.ok(Date.now() - t0 < 3000, 'too slow: ' + (Date.now() - t0) + 'ms');
});
