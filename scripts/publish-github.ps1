<#
.SYNOPSIS
  Publishes this folder to your GitHub repository.
  1. points the docs and package.json at github.com/<user>/<repo>  (scripts\set-repo.js)
  2. creates the git repository and the first commit
  3. pushes to GitHub (asks before pushing)
  4. with -Release: pushes the v<version> tag -> GitHub Actions builds the installers and creates the Release
.NOTES
  Create an EMPTY repository on github.com first (no README, no license, no .gitignore),
  or install the GitHub CLI (gh) and log in - then the script can create it for you.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\publish-github.ps1
  powershell -ExecutionPolicy Bypass -File scripts\publish-github.ps1 -User myname -Release
#>
param(
  [string]$User,
  [string]$Repo = 'drivehound',
  [switch]$Release,     # also push the version tag (starts the release workflow)
  [switch]$Private      # with gh: create the repository as private
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
. "$PSScriptRoot\common.ps1"

Step 'Checking tools'
Assert-Node
Assert-Git
$hasGh = [bool](Get-Command gh -ErrorAction SilentlyContinue)

if (-not $User) { $User = (Read-Host 'Your GitHub user name').Trim() }
if ($User -notmatch '^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$') { Fail "'$User' is not a valid GitHub user name." }
if ($Repo -notmatch '^[A-Za-z0-9._-]{1,100}$') { Fail "'$Repo' is not a valid repository name." }
$url = "https://github.com/$User/$Repo"
$version = (& node -p "require('./package.json').version").Trim()

Step "Pointing the project at $url"
Invoke-Native node scripts/set-repo.js $User $Repo

Step 'Preparing the git repository'
if (-not (Test-Path .git)) { Invoke-Native git init -b main }
if (-not (Quiet git config user.name))  { Fail 'Set your git name first:  git config --global user.name "Your Name"' }
if (-not (Quiet git config user.email)) { Fail 'Set your git email first: git config --global user.email "you@example.com"' }

Invoke-Native git add -A
Quiet git diff --cached --quiet | Out-Null
if ($LASTEXITCODE -ne 0) {
  $first = -not (Quiet git rev-parse --verify --quiet HEAD)
  $msg = if ($first) { "DriveHound v$version" } else { "Update DriveHound v$version" }
  Invoke-Native git commit -m $msg
} else { Write-Host '  nothing new to commit' }

Write-Host ''
Write-Host "  Files that will be published:" -ForegroundColor Yellow
& git ls-files | Measure-Object | ForEach-Object { Write-Host "  $($_.Count) files tracked by git (node_modules, release, release-files are ignored)" }

$remote = (Quiet git remote get-url origin)
if (-not $remote) {
  Quiet git ls-remote "$url.git" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    if ($hasGh) {
      $vis = if ($Private) { '--private' } else { '--public' }
      $answer = Read-Host "Repository $url does not exist. Create it with the GitHub CLI? (y/n)"
      if ($answer -ne 'y') { Fail "Create an empty repository named '$Repo' on github.com, then run this script again." }
      Invoke-Native gh repo create "$User/$Repo" $vis --description 'Smart disk space analyzer for Windows - see what fills your drive and what is safe to delete.'
    } else {
      Fail "Repository $url was not found. Create an EMPTY repository named '$Repo' on github.com (no README/license), then run this script again."
    }
  }
  Invoke-Native git remote add origin "$url.git"
}

$answer = Read-Host "Push the code to $url now? (y/n)"
if ($answer -ne 'y') { Ok 'Stopped before pushing. Run this script again when you are ready.'; exit 0 }
$branch = (Quiet git branch --show-current)
if (-not $branch) { $branch = 'main' }
Invoke-Native git push -u origin $branch

if ($hasGh) {
  Quiet gh repo edit "$User/$Repo" --homepage "$url/releases/latest" `
    --add-topic windows --add-topic disk-space --add-topic disk-analyzer --add-topic storage `
    --add-topic cleanup --add-topic electron --add-topic ntfs --add-topic persian | Out-Null
}

if ($Release) {
  $tag = "v$version"
  Quiet git rev-parse --verify --quiet "refs/tags/$tag" | Out-Null
  if ($LASTEXITCODE -ne 0) { Invoke-Native git tag -a $tag -m "DriveHound $version" }
  Invoke-Native git push origin $tag
  Ok "Tag $tag pushed. GitHub Actions is building the installers now:"
  Write-Host "  $url/actions"
  Write-Host "  When it finishes (about 10 minutes) the release appears at $url/releases"
} else {
  Ok "Code published: $url"
  Write-Host "  To publish the installers, run again with -Release, or create a release manually (see docs\GITHUB-GUIDE-FA.md)."
}
