<#
  Babel — Discord translator plugin: Windows uninstaller (no Node.js required).

  Usage:
    powershell -ExecutionPolicy Bypass -File Uninstall-Babel.ps1

  Restores the original Discord loader from backup and removes the Babel payload
  from every Discord desktop core it finds. Restart Discord afterwards.
#>
[CmdletBinding()]
param(
  [string]$BaseDir = (Join-Path $env:LOCALAPPDATA "Discord")
)

$ErrorActionPreference = "Stop"

$LoaderMarker   = "DiscordTranslatorMod desktop-core loader"
$BlockStart     = "/* $LoaderMarker:start */"
$BlockEnd       = "/* $LoaderMarker:end */"
$PayloadDirName = "discord-translator-mod"
$BackupName     = "index.js.dtm-original"
$VanillaIndex   = "module.exports = require('./core.asar');`n"
$BlockPattern   = "(?s)" + [regex]::Escape($BlockStart) + ".*?" + [regex]::Escape($BlockEnd) + "\r?\n?"

function Get-NormalizedIndex {
  param([string]$content)
  $trimmed = $content.Trim()
  if ($trimmed -eq "") { return $VanillaIndex }
  return $trimmed + "`n"
}

# The index content with Babel's hook removed — keeps any other injector + core export.
function Get-BaseIndex {
  param([string]$content)
  if ($content.Contains($BlockStart)) {
    return Get-NormalizedIndex ([regex]::Replace($content, $BlockPattern, ""))
  }
  if ($content.Contains($LoaderMarker)) {
    return $VanillaIndex
  }
  return Get-NormalizedIndex $content
}

$changed = 0

if (Test-Path $BaseDir) {
  Get-ChildItem -Path $BaseDir -Directory |
    Where-Object { $_.Name -match '^app-\d+\.\d+\.\d+$' } |
    ForEach-Object {
      $modules = Join-Path $_.FullName "modules"
      if (-not (Test-Path $modules)) { return }
      Get-ChildItem -Path $modules -Directory |
        Where-Object { $_.Name -match '^discord_desktop_core-\d+$' } |
        ForEach-Object {
          $core = Join-Path $_.FullName "discord_desktop_core"
          $indexPath  = Join-Path $core "index.js"
          $backupPath = Join-Path $core $BackupName
          $payloadDest = Join-Path $core $PayloadDirName
          $currentIndex = if (Test-Path $indexPath) { Get-Content -Raw $indexPath } else { "" }
          $currentIndex = [string]$currentIndex

          if ($currentIndex.Contains($BlockStart)) {
            # New format: strip only our block; keep any other injector + core export.
            Set-Content -NoNewline -Path $indexPath -Value (Get-BaseIndex $currentIndex)
            $script:changed++
          }
          elseif ($currentIndex.Contains($LoaderMarker)) {
            # Legacy whole-file loader: restore the pre-Babel backup if present (may
            # hold BetterDiscord); otherwise fall back to vanilla.
            if (Test-Path $backupPath) {
              Copy-Item $backupPath $indexPath -Force
            } else {
              Set-Content -NoNewline -Path $indexPath -Value $VanillaIndex
            }
            $script:changed++
          }

          if (Test-Path $backupPath) { Remove-Item $backupPath -Force }

          if (Test-Path $payloadDest) {
            Remove-Item -Recurse -Force $payloadDest
            $script:changed++
          }
        }
    }
}

# Wipe stored config (settings, API keys, cache) so nothing is left behind. This
# lives under Electron's userData dir (Roaming), not the modules dir (Local).
$configStore = Join-Path (Join-Path $env:APPDATA "discord") $PayloadDirName
if (Test-Path $configStore) {
  Remove-Item -Recurse -Force $configStore
  $script:changed++
}

Write-Host "Removed Babel from $changed desktop core item(s). Restart Discord."
