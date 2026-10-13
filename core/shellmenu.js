'use strict';
// "Analyze with DriveHound" entry in the Explorer right-click menu (per-user, HKCU — no admin).

const { run } = require('./exec');

const KEYS = ['HKCU\Software\Classes\Directory\shell\DriveHound', 'HKCU\Software\Classes\Drive\shell\DriveHound'];
const LEGACY_KEYS = ['HKCU\Software\Classes\Directory\shell\DiskInsight', 'HKCU\Software\Classes\Drive\shell\DiskInsight'];   // the app's former name
// Always English: Explorer lays menus out left-to-right, so a mixed Persian/English label would read in the wrong order.
const LABEL = 'Analyze with DriveHound';

function commandLine(exe, appPath) {
  if (/"/.test(exe) || (appPath && /"/.test(appPath))) throw new Error('unsafe-path');
  return appPath ? `"${exe}" "${appPath}" --analyze "%1"` : `"${exe}" --analyze "%1"`;
}

async function install({ exe, appPath, label = LABEL }) {
  const cmd = commandLine(exe, appPath);
  for (const k of KEYS) {
    await run('reg.exe', ['add', k, '/ve', '/d', label, '/f']);
    await run('reg.exe', ['add', k, '/v', 'Icon', '/d', exe + ',0', '/f']);
    await run('reg.exe', ['add', k + '\command', '/ve', '/d', cmd, '/f']);
  }
  return isInstalled();
}

async function uninstall() {
  for (const k of KEYS) await run('reg.exe', ['delete', k, '/f']);
  return !(await isInstalled());
}

async function isInstalled() {
  const r = await run('reg.exe', ['query', KEYS[0] + '\command', '/ve']);
  return r.code === 0;
}

// Removes the entry left by the old name. Returns true when it existed, so the caller can re-add it under the new name.
async function removeLegacy() {
  const r = await run('reg.exe', ['query', LEGACY_KEYS[0] + '\command', '/ve']);
  if (r.code !== 0) return false;
  for (const k of LEGACY_KEYS) await run('reg.exe', ['delete', k, '/f']);
  return true;
}

// Parse our own command line: --analyze "<path>"
function parseArgs(argv) {
  const i = argv.indexOf('--analyze');
  const out = { hidden: argv.includes('--hidden') };
  if (i >= 0 && argv[i + 1]) out.analyze = argv[i + 1];
  return out;
}

module.exports = { install, uninstall, isInstalled, removeLegacy, parseArgs, commandLine, LABEL };
