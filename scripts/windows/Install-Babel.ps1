<#
  Babel — Discord translator plugin: Windows installer (no Node.js required).

  Usage (right-click > Run with PowerShell, or):
    powershell -ExecutionPolicy Bypass -File Install-Babel.ps1

  It patches the Discord desktop core loader to load the Babel payload, after
  backing up the original loader. Fully quit Discord and reopen it afterwards.
#>
[CmdletBinding()]
param(
  [string]$PayloadSource,
  [string]$BaseDir = (Join-Path $env:LOCALAPPDATA "Discord")
)

$ErrorActionPreference = "Stop"

$LoaderMarker   = "DiscordTranslatorMod desktop-core loader"
$BlockStart     = "/* $LoaderMarker:start */"
$BlockEnd       = "/* $LoaderMarker:end */"
$PayloadDirName = "discord-translator-mod"
$BackupName     = "index.js.dtm-original"
$VanillaIndex   = "module.exports = require('./core.asar');`n"
$TestOnlyPattern = '(?s)/\* @dtm-test-only:start.*?@dtm-test-only:end \*/\r?\n?'
$BlockPattern   = "(?s)" + [regex]::Escape($BlockStart) + ".*?" + [regex]::Escape($BlockEnd) + "\r?\n?"

function Get-NormalizedIndex {
  param([string]$content)
  $trimmed = $content.Trim()
  if ($trimmed -eq "") { return $VanillaIndex }
  return $trimmed + "`n"
}

# The index content with any Babel hook removed — what we preserve and re-prepend.
function Get-BaseIndex {
  param([string]$content)
  if ($content.Contains($BlockStart)) {
    return Get-NormalizedIndex ([regex]::Replace($content, $BlockPattern, ""))
  }
  if ($content.Contains($LoaderMarker)) {
    return $VanillaIndex   # legacy whole-file loader; its base was always vanilla
  }
  return Get-NormalizedIndex $content
}

if (-not $PayloadSource) {
  $packaged = Join-Path $PSScriptRoot "payload"
  $repo = Join-Path $PSScriptRoot "..\..\src"
  $PayloadSource = if (Test-Path $packaged) { $packaged } else { $repo }
}

foreach ($f in @("mod\main.js", "mod\preload.js", "mod\renderer.js", "shared\settings.js")) {
  if (-not (Test-Path (Join-Path $PayloadSource $f))) {
    throw "Payload file is missing: $(Join-Path $PayloadSource $f)"
  }
}

function Resolve-CoreDir {
  param([string]$baseDir)
  if (-not (Test-Path $baseDir)) { throw "Discord folder not found at $baseDir. Is Discord installed?" }
  $versionDirs = Get-ChildItem -Path $baseDir -Directory |
    Where-Object { $_.Name -match '^app-\d+\.\d+\.\d+$' } |
    Sort-Object { [version]($_.Name -replace '^app-', '') } -Descending
  foreach ($vd in $versionDirs) {
    $modules = Join-Path $vd.FullName "modules"
    if (-not (Test-Path $modules)) { continue }
    $wrappers = Get-ChildItem -Path $modules -Directory |
      Where-Object { $_.Name -match '^discord_desktop_core-\d+$' } |
      Sort-Object { [int]($_.Name -replace '^discord_desktop_core-', '') } -Descending
    foreach ($w in $wrappers) {
      $core = Join-Path $w.FullName "discord_desktop_core"
      if ((Test-Path (Join-Path $core "core.asar")) -and (Test-Path (Join-Path $core "package.json"))) {
        return $core
      }
    }
  }
  throw "No Discord desktop core module was found under $baseDir."
}

function Copy-Payload {
  param([string]$source, [string]$dest)
  if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  Copy-Item (Join-Path $source "mod\preload.js") (Join-Path $dest "preload.js")
  # Strip test-only scaffolding so it never ships in the running plugin.
  foreach ($f in @("main.js", "renderer.js")) {
    $code = Get-Content -Raw (Join-Path $source "mod\$f")
    $code = [regex]::Replace($code, $TestOnlyPattern, "")
    Set-Content -NoNewline -Path (Join-Path $dest $f) -Value $code
  }
  Copy-Item (Join-Path $source "shared") (Join-Path $dest "shared") -Recurse
}

$core = Resolve-CoreDir -baseDir $BaseDir
$indexPath  = Join-Path $core "index.js"
$backupPath = Join-Path $core $BackupName
$payloadDest = Join-Path $core $PayloadDirName

$currentIndex = if (Test-Path $indexPath) { Get-Content -Raw $indexPath } else { $VanillaIndex }
$currentIndex = [string]$currentIndex

# For the legacy whole-file loader, recover from the pre-Babel backup if present — it
# may hold BetterDiscord's injection the old loader clobbered.
$legacyFormat = $currentIndex.Contains($LoaderMarker) -and (-not $currentIndex.Contains($BlockStart))
$source = $currentIndex
if ($legacyFormat -and (Test-Path $backupPath)) {
  $source = [string](Get-Content -Raw $backupPath)
}
$base = Get-BaseIndex $source

# Only patch a recognizable Discord core index (one that loads core.asar).
if (-not $base.Contains("core.asar")) {
  throw "Refusing to patch an unrecognized Discord core index at $indexPath"
}

Copy-Payload -source $PayloadSource -dest $payloadDest

# Additive: our delimited hook first, then the preserved base (other injectors + core).
$loaderBlock = "$BlockStart`n" +
  "try {`n" +
  "  require(`"./$PayloadDirName/main.js`").install();`n" +
  "} catch (error) {`n" +
  "  console.error(`"[Babel] Failed to install hook:`", error);`n" +
  "}`n" +
  "$BlockEnd`n"
Set-Content -NoNewline -Path $indexPath -Value ($loaderBlock + $base)

# The strip-based uninstall no longer needs a backup; drop any stale one.
if (Test-Path $backupPath) { Remove-Item -Force $backupPath }

Write-Host "Installed Babel into $core"
Write-Host "Now fully quit Discord (right-click the tray icon > Quit Discord) and reopen it."
