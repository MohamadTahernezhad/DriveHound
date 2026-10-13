'use strict';
// Compiles native/MftScan.cs with the C# compiler that ships with every Windows (.NET Framework 4.x).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'native', 'MftScan.cs');
const out = path.join(root, 'native', 'mftscan.exe');
const windir = process.env.WINDIR || 'C:\\Windows';
const csc = [path.join(windir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'), path.join(windir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')].find((p) => fs.existsSync(p));
if (!csc) { console.error('csc.exe not found — .NET Framework 4.x is required to build the MFT reader'); process.exit(1); }
execFileSync(csc, ['/nologo', '/optimize+', '/platform:x64', '/target:exe', '/out:' + out, src], { stdio: 'inherit' });
console.log('built', out, fs.statSync(out).size, 'bytes');
