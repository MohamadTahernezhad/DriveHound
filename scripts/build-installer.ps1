<#
.SYNOPSIS
  Builds the Windows installer and the portable exe in one command.
  Output: release\DriveHound-Setup-<version>.exe, release\DriveHound-Portable-<version>.exe, release\SHA256SUMS.txt
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\build-installer.ps1
  powershell -ExecutionPolicy Bypass -File scripts\build-installer.ps1 -Install   # build, then run the installer
#>
param(
  [switch]$Install,     # run the new installer at the end
  [switch]$SkipTests,
  [switch]$Clean        # reinstall node_modules from scratch
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
. "$PSScriptRoot\common.ps1"

$version = (& node -p "require('./package.json').version").Trim()
Write-Host "DriveHound $version - installer build" -ForegroundColor Magenta

Step 'Checking tools'
Assert-Node
Assert-Csc
Clear-ElectronRunAsNode

if ($Clean -and (Test-Path node_modules)) { Step 'Removing node_modules'; Remove-Item -Recurse -Force node_modules }
if ($Clean -or -not (Test-Path 'node_modules\electron-builder')) { Step 'Installing packages'; Install-Packages }

Step 'Building the turbo scan module'
Invoke-Native npm run build:native

if (-not $SkipTests) { Step 'Running tests'; Invoke-Native npm test }

Step 'Building installer + portable (this takes a few minutes)'
if (Test-Path release) { Get-ChildItem release -File | Remove-Item -Force }
Invoke-Native npx electron-builder --win nsis portable --publish never

$files = @(Get-ChildItem release -File -Filter *.exe)
if ($files.Count -eq 0) { Fail 'No installer was produced - see the output above.' }
$sums = foreach ($f in $files) { '{0}  {1}' -f (Get-FileHash $f.FullName -Algorithm SHA256).Hash.ToLower(), $f.Name }
[IO.File]::WriteAllLines((Join-Path (Resolve-Path release) 'SHA256SUMS.txt'), [string[]]$sums)

Ok 'Build finished. Files in the release folder:'
foreach ($f in $files) { Write-Host ('  {0,-40} {1,8:N1} MB' -f $f.Name, ($f.Length / 1MB)) }
Write-Host '  SHA256SUMS.txt'
if (-not (Select-String -Path package.json -Pattern '"publish"' -Quiet)) {
  Write-Host ''
  Write-Host '  Note: build.publish is not set, so this build will not auto-update.' -ForegroundColor Yellow
  Write-Host '  Run scripts\publish-github.ps1 (or node scripts\set-repo.js <user>) first if you want auto-updates.' -ForegroundColor Yellow
}

if ($Install) {
  $setup = $files | Where-Object { $_.Name -like 'DriveHound-Setup-*' } | Select-Object -First 1
  if ($setup) { Step "Starting $($setup.Name)"; Start-Process $setup.FullName }
}
