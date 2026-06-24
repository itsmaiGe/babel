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
$PayloadDirName = "discord-translator-mod"
$BackupName     = "index.js.dtm-original"
$VanillaIndex   = "module.exports = require('./core.asar');`n"
$TestOnlyPattern = '(?s)/\* @dtm-test-only:start.*?@dtm-test-only:end \*/\r?\n?'

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

if (-not (Test-Path $backupPath)) {
  $isVanilla = $currentIndex -match '^\s*module\.exports\s*=\s*require\(["'']\./core\.asar["'']\);\s*$'
  if (-not $isVanilla -and ($currentIndex -notlike "*$LoaderMarker*")) {
    throw "Refusing to overwrite an unknown Discord core index at $indexPath"
  }
  Set-Content -NoNewline -Path $backupPath -Value $currentIndex
}

Copy-Payload -source $PayloadSource -dest $payloadDest

$loader = "/* $LoaderMarker */`n" +
  "try {`n" +
  "  require(`"./$PayloadDirName/main.js`").install();`n" +
  "} catch (error) {`n" +
  "  console.error(`"[Babel] Failed to install hook:`", error);`n" +
  "}`n" +
  "module.exports = require(`"./core.asar`");`n"
Set-Content -NoNewline -Path $indexPath -Value $loader

Write-Host "Installed Babel into $core"
Write-Host "Now fully quit Discord (right-click the tray icon > Quit Discord) and reopen it."
