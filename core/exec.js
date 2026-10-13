'use strict';
// Process execution helpers. Everything goes through execFile with an argument array —
// never a shell string built from user input.

const { execFile, spawn } = require('child_process');

function run(file, args = [], opts = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, maxBuffer: 128 * 1024 * 1024, encoding: opts.encoding || 'utf8', timeout: opts.timeout || 120000, cwd: opts.cwd, env: opts.env }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: stdout || '', stderr: stderr || '', error: err ? String(err.message || err) : null });
    });
  });
}

const psQuote = (s) => "'" + String(s).replace(/'/g, "''") + "'";

function ps(script, timeout = 60000) {
  const full = '[Console]::OutputEncoding=[Text.Encoding]::UTF8;$ProgressPreference="SilentlyContinue";$ErrorActionPreference="Continue";' + script;
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', full], { timeout });
}

async function psJson(script, timeout) {
  const r = await ps(script, timeout);
  const txt = r.stdout.trim();
  if (!txt) return { ok: r.code === 0, data: null, error: r.stderr || r.error };
  try { return { ok: true, data: JSON.parse(txt) }; } catch (e) { return { ok: false, data: null, error: 'bad-json: ' + txt.slice(0, 200) }; }
}

let isAdminCached = null;
async function isAdmin() {
  if (isAdminCached !== null) return isAdminCached;
  const r = await run('net.exe', ['session']);
  isAdminCached = r.code === 0;
  return isAdminCached;
}

// Run an executable elevated (UAC) and wait for it. Arguments are quoted for PowerShell.
async function runElevated(exe, args = [], { timeout = 300000, hidden = true } = {}) {
  if (await isAdmin()) return run(exe, args, { timeout });
  const list = args.length ? ' -ArgumentList ' + args.map((a) => psQuote(/\s|"/.test(a) ? '"' + String(a).replace(/"/g, '\\"') + '"' : a)).join(',') : '';
  return ps(`try { $p = Start-Process ${psQuote(exe)}${list} -Verb RunAs -Wait -PassThru${hidden ? ' -WindowStyle Hidden' : ''}; exit $p.ExitCode } catch { exit 1223 }`, timeout);
}

// Open a visible console running a fixed command line. `command` must come from code, never from input.
function openTerminal(command, { elevated = false, admin = false } = {}) {
  if (elevated && !admin) {
    return ps(`try { Start-Process cmd.exe -Verb RunAs -ArgumentList '/k', ${psQuote('title DriveHound & ' + command)}; exit 0 } catch { exit 1223 }`, 30000);
  }
  const child = spawn('cmd.exe', ['/c', 'start', '"DriveHound"', 'cmd.exe', '/k', command], { detached: true, windowsVerbatimArguments: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
  return Promise.resolve({ code: 0 });
}

function launch(file, args = []) {
  const c = spawn(file, args, { detached: true, stdio: 'ignore' });
  c.on('error', () => {});
  c.unref();
  return { code: 0 };
}

module.exports = { run, ps, psJson, psQuote, isAdmin, runElevated, openTerminal, launch };
