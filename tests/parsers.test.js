'use strict';
const test = require('node:test');
const assert = require('node:assert');
const P = require('../core/parsers');
const { check, V } = require('../core/validate');
const Compare = require('../shared/compare');
const { buildHtml } = require('../core/report');

test('parseHumanSize', () => {
  assert.equal(P.parseHumanSize('1.5GB'), 1.5e9);
  assert.equal(P.parseHumanSize('512kB'), 512e3);
  assert.equal(P.parseHumanSize('12MB (virtual 1.2GB)'), 12e6);
  assert.equal(P.parseHumanSize('0B'), 0);
  assert.equal(P.parseHumanSize(''), 0);
  assert.equal(P.parseHumanSize(null), 0);
  assert.equal(P.parseHumanSize('1,234.5MB'), 1234.5e6);
});

const PNP = `Microsoft PnP Utility

Published Name:     oem36.inf
Original Name:      applekis.inf
Provider Name:      Apple, Inc.
Class Name:         USBDevice
Class GUID:         {88bae032-5a81-49f0-bc3d-a4ff138216d6}
Driver Version:     08/02/2023 1.1.5.0
Signer Name:        Microsoft Windows Hardware Compatibility Publisher
Attributes:         Universal

Published Name:     oem127.inf
Original Name:      nvblwi.inf
Provider Name:      NVIDIA
Class Name:         Display
Class GUID:         {4d36e968-e325-11ce-bfc1-08002be10318}
Driver Version:     09/19/2025 32.0.15.8157
Signer Name:        Microsoft Windows Hardware Compatibility Publisher
`;

test('parsePnputil (English)', () => {
  const r = P.parsePnputil(PNP);
  assert.equal(r.length, 2);
  assert.deepEqual([r[0].published, r[0].original, r[0].provider, r[0].cls, r[0].version], ['oem36.inf', 'applekis.inf', 'Apple, Inc.', 'USBDevice', '1.1.5.0']);
  assert.equal(r[1].date, Date.UTC(2025, 8, 19));
});

test('parsePnputil works with localized labels', () => {
  const de = PNP.replace(/Published Name/g, 'Veröffentlichter Name').replace(/Original Name/g, 'Originalname').replace(/Driver Version/g, 'Treiberversion');
  const r = P.parsePnputil(de);
  assert.equal(r.length, 2);
  assert.equal(r[1].original, 'nvblwi.inf');
  assert.equal(r[1].version, '32.0.15.8157');
});

test('parseInfVersion', () => {
  const r = P.parseInfVersion('[Version]\nSignature="$Windows NT$"\nClass=Display\nProvider=%NVIDIA%\nDriverVer = 09/19/2025,32.0.15.8157 ; comment\n[Manufacturer]\n');
  assert.equal(r.version, '32.0.15.8157');
  assert.equal(r.cls, 'Display');
  assert.equal(r.provider, 'NVIDIA');
});

test('parseWslList', () => {
  const txt = '  NAME              STATE           VERSION\r\n* Ubuntu-22.04      Running         2\r\n  docker-desktop    Stopped         2\r\n';
  const r = P.parseWslList(txt);
  assert.deepEqual(r.map((d) => [d.name, d.state, d.version, d.default]), [['Ubuntu-22.04', 'Running', 2, true], ['docker-desktop', 'Stopped', 2, false]]);
});

test('identifier validators reject injection', () => {
  assert.ok(P.isDockerId('a1b2c3d4e5f6'));
  assert.ok(P.isDockerId('sha256:' + 'a'.repeat(64)));
  assert.ok(!P.isDockerId('abc; rm -rf /'));
  assert.ok(P.isDockerName('my_volume-1'));
  assert.ok(!P.isDockerName('--force'));
  assert.ok(!P.isDockerName('a && b'));
  assert.ok(!P.isDockerName('../x'));
  assert.ok(P.isWslName('Ubuntu-22.04'));
  assert.ok(!P.isWslName('Ubuntu & calc'));
  assert.ok(P.isOemInf('oem12.inf'));
  assert.ok(!P.isOemInf('oem12.inf /force'));
  assert.ok(!P.isOemInf('C:\\x\\oem1.inf'));
});

test('IPC validation', () => {
  assert.deepEqual(check(['C:\\x', 5], [V.path(), V.num(0, 10)]), ['C:\\x', 5]);
  assert.throws(() => check(['relative'], [V.path()]));
  assert.throws(() => check([{ path: 'C:\\x', size: 'big' }], [V.obj({ path: V.path(), size: V.optNum(0, 1) })]));
  assert.throws(() => check(['x'], [V.oneOf('trash', 'permanent')]));
  assert.throws(() => check([new Array(20).fill('C:\\a')], [V.arr(V.path(), 10)]));
  assert.throws(() => check(['C:\\a\u0000b'], [V.path()]));
  assert.throws(() => check(['oem1.inf;calc'], [V.match(/^oem\d{1,5}\.inf$/i)]));
});

test('snapshot compare attributes growth to the deepest folder', () => {
  const GB = 1024 ** 3;
  const prev = [['C:\\Users', 100 * GB], ['C:\\Users\\me', 90 * GB], ['C:\\Users\\me\\AppData', 50 * GB], ['C:\\Users\\me\\AppData\\Docker', 10 * GB]];
  const cur = [['C:\\Users', 130 * GB], ['C:\\Users\\me', 120 * GB], ['C:\\Users\\me\\AppData', 79 * GB], ['C:\\Users\\me\\AppData\\Docker', 37 * GB], ['C:\\Users\\me\\New', 2 * GB]];
  const r = Compare.compare(cur, prev);
  assert.equal(r[0].p, 'C:\\Users\\me\\AppData\\Docker');
  assert.equal(Math.round(r[0].own / GB), 27);
  assert.ok(r.some((x) => x.p === 'C:\\Users\\me\\New' && x.isNew));
  assert.ok(!r.some((x) => x.p === 'C:\\Users'), 'parent fully explained by children must not be listed');
});

test('report escapes file names (no HTML injection)', () => {
  const html = buildHtml({ lang: 'en', title: '<script>alert(1)</script>', labels: {}, diag: [{ title: '<img src=x onerror=alert(1)>', path: 'C:\\"><b>', hint: '', sizeLabel: '1', safety: 'safe', safetyLabel: 'ok' }] }, 'file:///font.woff2');
  assert.ok(!html.includes('<script>alert'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes("default-src 'none'"));
});
