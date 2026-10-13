# Shared helpers for the setup / build / publish scripts (dot-sourced, not run directly).

function Step($text) { Write-Host ''; Write-Host "==> $text" -ForegroundColor Cyan }
function Ok($text)   { Write-Host ''; Write-Host "OK  $text" -ForegroundColor Green }
function Fail($text) { Write-Host ''; Write-Host "ERROR  $text" -ForegroundColor Red; exit 1 }

# Runs a native command and stops on a non-zero exit code.
function Invoke-Native {
  $cmd = $args[0]; $rest = @($args | Select-Object -Skip 1)
  if ($cmd -eq 'npm' -or $cmd -eq 'npx') { $cmd = "$cmd.cmd" }   # avoid npm.ps1 and its execution-policy prompt
  & $cmd @rest
  if ($LASTEXITCODE -ne 0) { Fail "'$($args -join ' ')' failed (exit code $LASTEXITCODE)" }
}

# Runs a native command, hides its stderr and returns its output; check $LASTEXITCODE afterwards.
# (Windows PowerShell 5.1 turns redirected stderr into errors, so relax the preference locally.)
function Quiet {
  $ErrorActionPreference = 'Continue'
  $cmd = $args[0]; $rest = @($args | Select-Object -Skip 1)
  & $cmd @rest 2>$null
}

function Assert-Node {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail 'Node.js was not found. Install Node.js 22 LTS or newer from https://nodejs.org and open a new terminal.'
  }
  $v = (& node -p "process.versions.node").Trim()
  if ([int]($v.Split('.')[0]) -lt 22) { Fail "Node.js $v is too old - version 22 or newer is required." }
  Write-Host "  Node.js $v"
}

function Assert-Csc {
  $fw = Join-Path $env:WINDIR 'Microsoft.NET'
  $found = (Test-Path (Join-Path $fw 'Framework64\v4.0.30319\csc.exe')) -or (Test-Path (Join-Path $fw 'Framework\v4.0.30319\csc.exe'))
  if (-not $found) { Fail 'The C# compiler of .NET Framework 4.x (csc.exe) was not found. Enable ".NET Framework 4.8" in Windows Features.' }
  Write-Host '  .NET Framework C# compiler found'
}

function Assert-Git {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Fail 'Git was not found. Install it from https://git-scm.com/download/win and open a new terminal.'
  }
  Write-Host "  $((& git --version).Trim())"
}

# VS Code terminals set ELECTRON_RUN_AS_NODE, which makes Electron start as plain Node.
function Clear-ElectronRunAsNode {
  if (Test-Path Env:ELECTRON_RUN_AS_NODE) { Remove-Item Env:ELECTRON_RUN_AS_NODE; Write-Host '  cleared ELECTRON_RUN_AS_NODE for this session' }
}

function Install-Packages {
  if (Test-Path 'package-lock.json') { Invoke-Native npm ci --no-fund --no-audit }
  else { Invoke-Native npm install --no-fund --no-audit }
}
