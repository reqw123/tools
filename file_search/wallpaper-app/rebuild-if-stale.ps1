<#
  Called by qi-dong-zhuo-mian-bian-li-tie-qiang.bat on every launch: checks
  whether the notes-web / files-web FRONTEND source (src\, index.html, the
  vite / tsconfig / tailwind / postcss / package.json files) is newer than
  the built dist\, and runs `npm run build` for the one(s) that changed.

  This keeps the wallpaper-app (which serves the pre-built dist\) in sync
  with frontend edits without a manual `npm run build:webs`. A missing
  dist\ always rebuilds.

  Exit code: 0 = all up to date / rebuilt OK; 1 = a build failed (the .bat
  turns that into the "Web build failed" popup). Server-side changes
  (server\, ai_bridge.py) do not affect dist\ and are out of scope -- those
  are picked up by the tray's "clear cache & reload".

  ASCII-only on purpose: Windows PowerShell 5.1 reads .ps1 as the system
  ANSI codepage unless there is a BOM, so non-ASCII here is fragile.
#>
param(
  [Parameter(Mandatory = $true)][string]$ProjectRoot
)

$ErrorActionPreference = 'Stop'

# Representative timestamp of a built dist: dist\index.html (vite rewrites it
# on every build). $null => no dist yet => must build.
function Get-DistStamp {
  param([string]$Dir)
  $idx = Join-Path $Dir 'dist\index.html'
  if (-not (Test-Path -LiteralPath $idx)) { return $null }
  (Get-Item -LiteralPath $idx).LastWriteTimeUtc
}

# Newest mtime among the files of this web project that end up in the bundle.
function Get-SrcNewest {
  param([string]$Dir)
  $newest = [datetime]::MinValue

  $srcDir = Join-Path $Dir 'src'
  if (Test-Path -LiteralPath $srcDir) {
    $m = Get-ChildItem -LiteralPath $srcDir -Recurse -File -ErrorAction SilentlyContinue |
      Measure-Object -Property LastWriteTimeUtc -Maximum
    if ($m.Maximum -and $m.Maximum -gt $newest) { $newest = $m.Maximum }
  }

  $globs = @('index.html', 'vite.config.*', 'tsconfig*.json', 'tailwind.config.*',
             'postcss.config.*', 'package.json')
  foreach ($g in $globs) {
    Get-ChildItem -LiteralPath $Dir -Filter $g -File -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.LastWriteTimeUtc -gt $newest) { $newest = $_.LastWriteTimeUtc }
    }
  }
  $newest
}

$projects = @('notes-web', 'files-web')
$failed = @()
$built  = @()

foreach ($name in $projects) {
  $dir = Join-Path $ProjectRoot $name
  if (-not (Test-Path -LiteralPath (Join-Path $dir 'package.json'))) {
    Write-Host "[rebuild-if-stale] $name not found, skipping"
    continue
  }

  $dist = Get-DistStamp -Dir $dir
  $src  = Get-SrcNewest -Dir $dir

  $reason = $null
  if ($null -eq $dist) {
    $reason = 'no dist yet'
  } elseif ($src -gt $dist) {
    $reason = "src newer ($($src.ToLocalTime().ToString('MM-dd HH:mm')) > dist $($dist.ToLocalTime().ToString('MM-dd HH:mm')))"
  }

  if (-not $reason) {
    Write-Host "[rebuild-if-stale] $name : dist up to date, skipping"
    continue
  }

  Write-Host "[rebuild-if-stale] $name : $reason -> npm run build"
  & npm.cmd --prefix $dir run build
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "[rebuild-if-stale] $name build failed (exit $LASTEXITCODE)"
    $failed += $name
  } else {
    $built += $name
  }
}

if ($built.Count)  { Write-Host "[rebuild-if-stale] rebuilt: $($built -join ', ')" }
if ($failed.Count) { Write-Host "[rebuild-if-stale] failed: $($failed -join ', ')"; exit 1 }
exit 0
