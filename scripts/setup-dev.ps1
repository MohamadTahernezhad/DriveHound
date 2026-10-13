<#
.SYNOPSIS
  Prepares a development copy of DriveHound: checks the tools, installs packages,
  builds the turbo (MFT) module and runs the tests.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\setup-dev.ps1
  powershell -ExecutionPolicy Bypass -File scripts\setup-dev.ps1 -Start
#>
param(
  [switch]$Start,      # launch the app when setup is done
  [switch]$SkipTests
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
. "$PSScriptRoot\common.ps1"

Step 'Checking tools'
Assert-Node
Assert-Csc
Clear-ElectronRunAsNode

Step 'Installing packages'
Install-Packages

Step 'Building the turbo scan module (native/mftscan.exe)'
Invoke-Native npm run build:native

if (-not $SkipTests) {
  Step 'Running tests'
  Invoke-Native npm test
}

Ok 'Development setup is ready.'
Write-Host '  Start the app:    npm start'
Write-Host '  UI tests:         npm run test:e2e'
Write-Host '  Build installer:  powershell -ExecutionPolicy Bypass -File scripts\build-installer.ps1'

if ($Start) { Invoke-Native npm start }
